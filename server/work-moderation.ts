/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { confinedFile, mediaState } from './media.ts';
import { readModerationSettings, type ModerationSettings } from './settings.ts';
import { checkModerationMedia, hasSensitiveWord, maxModerationBytes, moderationBudgetMs } from './moderation-media.ts';
import type { CreationModeration } from '../shared/work-moderation.ts';
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
const maxTotalBytes = 256 * 1024 * 1024;
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
function parameterStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(parameterStrings);
  return [];
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
  if (activeChecks >= 4) { result.reason = '内容检查繁忙，请稍后重试。'; return result; }
  activeChecks++;
  const deadline = Date.now() + moderationBudgetMs;
  let bytesRead = 0, review = false;
  try {
    for (const file of files) {
      // Executable skill packages keep their separate administrator trust review.
      if (revision.generation?.skill && !file.type.startsWith('image/')) { review = true; continue; }
      if (!file.storedInternal || file.isLink || mediaState(file.properties) !== 'ready' ||
        !file.accessKey || file.size <= 0 || file.size > (file.type.startsWith('image/') ? 20 * 1024 * 1024 : maxModerationBytes) || Date.now() >= deadline) { review = true; continue; }
      try {
        const path = await confinedFile(await realpath(ctx.filesRoot), file.accessKey);
        const handle = await open(path, 'r');
        let bytes: Buffer;
        const snapshot = result.files.find(item => item.id === file.id)!;
        try {
          const before = await handle.stat();
          if (!before.isFile() || before.size <= 0 || before.size > maxModerationBytes || bytesRead + before.size > maxTotalBytes) { review = true; continue; }
          bytes = await handle.readFile();
          if (bytes.byteLength !== before.size || diskIdentity(before) !== diskIdentity(await handle.stat())) { review = true; continue; }
          bytesRead += bytes.byteLength;
          snapshot.path = path; snapshot.disk = diskIdentity(before);
        } finally { await handle.close(); }
        const detected = await checkModerationMedia(ctx, ownerId, bytes, file.type, settings, deadline);
        if (detected.decision === 'reject') { result.decision = 'reject'; result.reason = detected.reason; return result; }
        if (detected.decision !== 'allow') { review = true; result.reason = detected.reason; }
      } catch { review = true; }
    }
    result.decision = review ? 'review' : 'allow';
    return result;
  } finally { activeChecks--; }
}

/** Revalidate the policy and attachment snapshot under the same transaction that changes visibility. */
export async function commitWorkModeration(ctx: RequestContext, db: Queryable, prepared: PreparedWorkModeration, allowManualReview = false): Promise<'allow' | 'review'> {
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
  if (prepared.decision === 'review' && !allowManualReview) failure(503, prepared.reason || '内容检查暂未完成，请稍后重试。检查通过后才能发布。', 'WORK_MODERATION_UNAVAILABLE');
  return prepared.decision;
}

/** Transient inspection only: no drive file, community work or publication reward is created. */
export async function precheckCreation(ctx: RequestContext): Promise<true> {
  const actor = ctx.requireUser();
  if (ctx.req.headers?.['x-new-api-user'] !== actor.id) failure(409, '登录账号已变化，请刷新后重试。', 'WORK_MODERATION_ACCOUNT_CHANGED');
  const settings = await policy(ctx.db);
  const respond = (value: CreationModeration) => { ctx.json(200, { ...value, checkedAt: Date.now() }); return true as const; };
  if (!settings.enabled) return respond({ state: 'disabled' });
  const key = `community-next:moderation-rate:${actor.id}:${Math.floor(Date.now() / 60000)}`;
  const count = await ctx.redis.incr(key);
  if (count === 1) await ctx.redis.expire(key, 120);
  if (count > 30 || activeChecks >= 4) return respond({ state: 'unavailable', reason: '内容检查繁忙，请稍后重试。' });
  if (!ctx.request.isMultipart()) failure(400, '请提供待检查的作品文件。', 'WORK_MODERATION_INPUT');
  activeChecks++;
  try {
    const part = await ctx.request.file({ limits: { files: 1, fields: 0, parts: 1, fileSize: maxModerationBytes } });
    if (!part) failure(400, '请提供待检查的作品文件。', 'WORK_MODERATION_INPUT');
    const bytes = await part.toBuffer();
    if (part.file.truncated) failure(413, '作品超过自动检查的 128 MB 上限。', 'WORK_MODERATION_INPUT');
    const result = await checkModerationMedia(ctx, actor.id, bytes, part.mimetype, settings, Date.now() + moderationBudgetMs);
    // A concurrent policy update must never leave the UI displaying a stale pass.
    if (policyKey(settings) !== policyKey(await policy(ctx.db))) return respond({ state: 'unavailable', reason: '审核规则已更新，请重新检查。' });
    return respond({ state: result.decision === 'allow' ? 'passed' : result.decision === 'reject' ? 'rejected' : 'unavailable', reason: result.reason });
  } finally { activeChecks--; }
}
