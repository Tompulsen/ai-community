/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { confinedFile, mediaState } from './media.ts';
import { readModerationSettings, type ModerationSettings } from './settings.ts';
import { readRemixParameters, type RemixParameters } from '../shared/studio/remix-parameters.ts';
import type { Queryable, RequestContext } from './types.ts';

interface Revision {
  title: string; text: string; model: string; license: string; sourceUrl: string; fileIds: string[];
  generation: { prompt: string; referenceFileIds: string[]; parameters?: RemixParameters; skill?: { installation?: string; platform?: string; version?: string; sourcePublic?: boolean } } | null;
}
interface ModerationFile {
  id: string; name: string; type: string; size: number; md5: string | null; accessKey: string | null;
  storedInternal: boolean; isLink: boolean; properties: Record<string, unknown> | null;
}
interface FileSnapshot { id: string; identity: string; path?: string; disk?: string }
export interface PreparedWorkModeration {
  ownerId: string; policy: string; enabled: boolean; decision: 'allow' | 'reject' | 'review'; reason?: string;
  files: FileSnapshot[];
}
const maxImageBytes = 20 * 1024 * 1024;
const maxTotalBytes = 80 * 1024 * 1024;
const maxResponseBytes = 128 * 1024;
const totalBudgetMs = 30000;
let activeChecks = 0;

function failure(statusCode: number, message: string, code: string): never {
  throw Object.assign(new Error(message), { statusCode, code });
}
async function policy(db: Queryable, lock = false): Promise<ModerationSettings> {
  const result = await db.query<{ clientOptions: { communityModeration?: unknown } | null }>(`SELECT "clientOptions" FROM meta ORDER BY id LIMIT 1${lock ? ' FOR SHARE' : ''}`);
  return readModerationSettings(result.rows[0]?.clientOptions?.communityModeration);
}
function policyKey(settings: ModerationSettings) {
  return createHash('sha256').update(JSON.stringify(settings)).digest('hex');
}
function fileIdentity(file: ModerationFile) {
  return JSON.stringify([file.id, file.type, file.name, file.accessKey, file.size, file.md5, file.storedInternal, file.isLink, mediaState(file.properties)]);
}
function diskIdentity(value: Awaited<ReturnType<typeof stat>>) {
  return JSON.stringify([String(value.dev), String(value.ino), value.size, value.mtimeMs, value.ctimeMs]);
}
async function filesFor(db: Queryable, ids: string[], ownerId: string, lock = false): Promise<ModerationFile[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<ModerationFile>(`SELECT id,name,type,size,md5,"accessKey","storedInternal","isLink",properties FROM drive_file WHERE id=ANY($1::varchar[]) AND "userId"=$2 ORDER BY id${lock ? ' FOR SHARE' : ''}`, [ids, ownerId]);
  if (rows.length !== ids.length) failure(400, '附件不存在或不属于此作品作者。', 'WORK_ATTACHMENT_UNAVAILABLE');
  return rows;
}
function hasSensitiveWord(value: string, words: string[]) {
  const normalized = value.normalize('NFKC').toLowerCase();
  return words.some(word => normalized.includes(word));
}
function parameterStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(parameterStrings);
  return [];
}
async function inspectImage(bytes: Buffer, remainingMs: number): Promise<{ nsfwScore: number; text: string }> {
  const endpoint = new URL(process.env.COMMUNITY_MODERATION_URL || 'invalid:');
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !process.env.COMMUNITY_MODERATION_TOKEN)
    throw new Error('Moderation service unavailable');
  endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + '/check';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(12000, remainingMs));
  try {
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${process.env.COMMUNITY_MODERATION_TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Moderation service unavailable'); }
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxResponseBytes) throw new Error('Moderation response too large');
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid moderation response');
    const value = result as Record<string, unknown>;
    if (typeof value.nsfwScore !== 'number' || !Number.isFinite(value.nsfwScore) || value.nsfwScore < 0 || value.nsfwScore > 1 ||
      typeof value.text !== 'string' || value.text.length > 20000 || typeof value.modelVersion !== 'string' || !value.modelVersion || value.modelVersion.length > 256)
      throw new Error('Invalid moderation response');
    return { nsfwScore: value.nsfwScore, text: value.text };
  } finally { clearTimeout(timer); }
}

/** Read only authorized local attachments. Inference runs before the publication transaction acquires locks. */
export async function prepareWorkModeration(ctx: RequestContext, ownerId: string, revision: Revision): Promise<PreparedWorkModeration> {
  const settings = await policy(ctx.db);
  const result: PreparedWorkModeration = { ownerId, policy: policyKey(settings), enabled: settings.enabled, decision: 'allow', files: [] };
  if (!settings.enabled) return result;
  const ids = [...new Set([...revision.fileIds, ...(revision.generation?.referenceFileIds ?? [])])].sort();
  const files = await filesFor(ctx.db, ids, ownerId);
  result.files = files.map(file => ({ id: file.id, identity: fileIdentity(file) }));
  const visibleText = [revision.title, revision.text, revision.model, revision.license, revision.generation?.prompt,
    revision.generation?.skill?.installation, revision.generation?.skill?.platform, revision.generation?.skill?.version,
    ...parameterStrings(readRemixParameters(revision.generation?.parameters)),
    revision.generation?.skill?.sourcePublic === false ? '' : revision.sourceUrl].filter(Boolean).join('\n');
  const rejectWords = () => { result.decision = 'reject'; result.reason = '作品文字或图片文字包含社区禁止发布的内容，请修改后重试，或联系管理员复核。'; };
  if (hasSensitiveWord(visibleText, settings.sensitiveWords)) { rejectWords(); return result; }
  if (!files.length) return result;
  result.decision = 'review';
  if (activeChecks >= 2) return result;
  activeChecks++;
  const deadline = Date.now() + totalBudgetMs;
  let bytesRead = 0, review = false;
  try {
    for (const file of files) {
      // Videos, animated formats and downloadable packages retain human review; no private package text is read.
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || !file.storedInternal || file.isLink ||
        mediaState(file.properties) !== 'ready' || !file.accessKey || file.size <= 0 || file.size > maxImageBytes || Date.now() >= deadline) { review = true; continue; }
      try {
        const path = await confinedFile(await realpath(ctx.filesRoot), file.accessKey);
        const handle = await open(path, 'r');
        let bytes: Buffer;
        const snapshot = result.files.find(item => item.id === file.id)!;
        try {
          const before = await handle.stat();
          if (!before.isFile() || before.size <= 0 || before.size > maxImageBytes || bytesRead + before.size > maxTotalBytes) { review = true; continue; }
          bytes = await handle.readFile();
          if (bytes.byteLength !== before.size || diskIdentity(before) !== diskIdentity(await handle.stat())) { review = true; continue; }
          bytesRead += bytes.byteLength;
          snapshot.path = path; snapshot.disk = diskIdentity(before);
        } finally { await handle.close(); }
        const remaining = deadline - Date.now();
        if (remaining <= 0) { review = true; continue; }
        const detected = await inspectImage(bytes, remaining);
        if (hasSensitiveWord(detected.text, settings.sensitiveWords)) { rejectWords(); return result; }
        if (detected.nsfwScore >= settings.rejectThreshold) {
          result.decision = 'reject'; result.reason = '检测到疑似色情或裸露内容，暂不能发布。请修改后重试，或联系管理员复核。'; return result;
        }
        if (detected.nsfwScore >= settings.reviewThreshold) review = true;
      } catch { review = true; }
    }
    result.decision = review ? 'review' : 'allow';
    return result;
  } finally { activeChecks--; }
}

/** Revalidate the policy and attachment snapshot under the same transaction that changes visibility. */
export async function commitWorkModeration(ctx: RequestContext, db: Queryable, prepared: PreparedWorkModeration): Promise<'allow' | 'review'> {
  if (policyKey(await policy(db, true)) !== prepared.policy) failure(409, '审核规则已更新，请重新提交作品。', 'WORK_MODERATION_CHANGED');
  if (prepared.enabled) {
    const files = await filesFor(db, prepared.files.map(file => file.id), prepared.ownerId, true);
    for (const snapshot of prepared.files) {
      const file = files.find(item => item.id === snapshot.id);
      if (!file || fileIdentity(file) !== snapshot.identity) failure(409, '作品附件已变化，请重新提交审核。', 'WORK_MODERATION_CHANGED');
      if (snapshot.path && snapshot.disk) {
        let unchanged = false;
        try {
          const current = await confinedFile(await realpath(ctx.filesRoot), file.accessKey!);
          unchanged = current === snapshot.path && diskIdentity(await stat(current)) === snapshot.disk;
        } catch { /* A vanished or replaced file never inherits an earlier result. */ }
        if (!unchanged) failure(409, '作品附件已变化，请重新提交审核。', 'WORK_MODERATION_CHANGED');
      }
    }
  }
  if (prepared.decision === 'reject') failure(422, prepared.reason || '作品未通过自动审核，请修改后重试。', 'WORK_MODERATION_REJECTED');
  return prepared.decision;
}
