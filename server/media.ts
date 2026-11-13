/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { httpError, roleCondition } from './auth.ts';
import type { Database, RequestContext } from './types.ts';

const MiB = 1024 * 1024;
const kinds = ['image', 'video', 'audio', 'document', 'other'] as const;
type UploadKind = typeof kinds[number];
type Processing = 'pending' | 'processing' | 'ready' | 'failed';
type Values = Record<string, unknown>;
interface RolePolicy { priority?: number; useDefault?: boolean; value?: unknown }
interface UploadRole { id: string; target: string; condFormula: unknown; policies: Record<string, RolePolicy> }
interface UploadPolicy {
  maximum: number;
  capacity: number;
  limits: Record<UploadKind, number>;
  mimeTypes: string[];
}
interface MediaFile {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  thumbnailAccessKey: string | null;
  properties: Values | null;
}
interface WorkerFile extends MediaFile { accessKey: string; lease: string }

function record(value: unknown): value is Values {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function mediaState(properties: Values | null | undefined): Processing {
  const state = record(properties?.communityMedia) ? properties.communityMedia.state : undefined;
  return state === 'pending' || state === 'processing' || state === 'failed' ? state : 'ready';
}

export function fileDto(file: MediaFile) {
  return {
    id: file.id, name: file.name, type: file.type, size: file.size, url: `/legacy-files/${file.id}`,
    thumbnailUrl: file.thumbnailAccessKey ? `/legacy-files/${file.id}?variant=thumbnail` : '',
    processing: mediaState(file.properties),
  };
}

function validLimit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10240 ? value : fallback;
}

async function uploadPolicy(ctx: RequestContext): Promise<UploadPolicy> {
  const meta = (await ctx.db.query<{ policies: Values | null; clientOptions: Values | null }>('SELECT policies,"clientOptions" FROM meta LIMIT 1')).rows[0];
  const defaults: Values = {
    driveCapacityMb: 100, maxFileSizeMb: 30,
    uploadableFileTypes: ['text/*', 'application/json', 'image/*', 'video/*', 'audio/*'],
    ...meta?.policies,
  };
  let applicable: UploadRole[] = [];
  if (ctx.user) {
    const [roles, assignments, users] = await Promise.all([
      ctx.db.query<UploadRole>('SELECT id,target,"condFormula",policies FROM role'),
      ctx.db.query<{ roleId: string }>('SELECT "roleId" FROM role_assignment WHERE "userId"=$1 AND ("expiresAt" IS NULL OR "expiresAt">NOW())', [ctx.user.id]),
      ctx.db.query<Parameters<typeof roleCondition>[1]>('SELECT id,host,"createdAt","isSuspended","isLocked","isBot","isCat","isExplorable","followersCount","followingCount","notesCount" FROM "user" WHERE id=$1', [ctx.user.id]),
    ]);
    const assigned = new Set(assignments.rows.map(row => row.roleId));
    applicable = roles.rows.filter(role => role.target === 'manual' ? assigned.has(role.id) : roleCondition(role.condFormula, users.rows[0] ?? ctx.user ?? {}, assigned));
  }
  const values = (key: string): unknown[] => {
    if (!applicable.length) return [defaults[key]];
    const entries = applicable.map(role => role.policies?.[key] ?? { priority: 0, useDefault: true });
    const priority = Math.max(...entries.map(entry => entry.priority === 2 ? 2 : entry.priority === 1 ? 1 : 0));
    return entries.filter(entry => (entry.priority ?? 0) === priority).map(entry => entry.useDefault ? defaults[key] : entry.value);
  };
  const maximum = (key: string, fallback: number) => Math.max(0, ...values(key).map(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback));
  const configured = (ctx.config as typeof ctx.config & { maxFileSize?: number }).maxFileSize;
  const serverLimit = typeof configured === 'number' && Number.isFinite(configured) && configured > 0 ? configured : 1024 * MiB;
  const maxBytes = Math.floor(Math.min(2147483647, serverLimit, maximum('maxFileSizeMb', 30) * MiB));
  const oldLimits = record(meta?.clientOptions?.uploadLimits) ? meta.clientOptions.uploadLimits : {};
  const newLimits = record(meta?.clientOptions?.communityUploadLimits) ? meta.clientOptions.communityUploadLimits : {};
  const limits = {} as Record<UploadKind, number>;
  for (const kind of kinds) limits[kind] = Math.min(maxBytes / MiB, validLimit(oldLimits[kind] ?? newLimits[kind === 'document' ? 'resource' : kind], 20));
  const mimeTypes = [...new Set(values('uploadableFileTypes').flatMap(value => Array.isArray(value) ? value.filter((type): type is string => typeof type === 'string' && Boolean(type.trim())).map(type => type.trim().toLowerCase()) : []))];
  return { maximum: maxBytes, capacity: maximum('driveCapacityMb', 100) * MiB, limits, mimeTypes };
}

export async function uploadLimitsFor(ctx: RequestContext) {
  const policy = await uploadPolicy(ctx);
  return {
    maxFileSizeMb: policy.maximum / MiB, imagesMb: policy.limits.image, videosMb: policy.limits.video,
    filesMb: Math.min(policy.limits.audio, policy.limits.document, policy.limits.other),
    audioMb: policy.limits.audio, documentsMb: policy.limits.document, otherMb: policy.limits.other,
  };
}

export function sniffType(buffer: Buffer, requested = 'application/octet-stream'): string {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) return 'image/gif';
  if (buffer.subarray(4, 8).toString() === 'ftyp') return /^(avif|avis|heic|heix|mif1)$/.test(buffer.subarray(8, 12).toString()) ? 'image/avif' : 'video/mp4';
  if (buffer.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) return 'video/webm';
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buffer.subarray(0, 4).toString() === 'OggS') return requested.startsWith('video/') ? 'video/ogg' : requested === 'application/ogg' ? requested : 'audio/ogg';
  if (buffer.subarray(0, 4).toString() === 'fLaC') return 'audio/flac';
  if (buffer.subarray(0, 3).toString() === 'ID3' || buffer[0] === 255 && (buffer[1]! & 0xe0) === 0xe0) return 'audio/mpeg';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) {
    return /^(application\/(zip|epub\+zip|vnd\.openxmlformats-officedocument\.[a-z.-]+|vnd\.oasis\.opendocument\.[a-z.-]+))$/.test(requested) ? requested : 'application/zip';
  }
  return 'application/octet-stream';
}

function uploadKind(type: string): UploadKind {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/') || type === 'application/ogg') return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('text/') || /^application\/(pdf|json|ld\+json|xml|javascript|yaml|rtf|msword|vnd\.|epub\+zip)/.test(type)) return 'document';
  return 'other';
}

async function classify(path: string, size: number, requested: string): Promise<{ type: string; ambiguous: boolean }> {
  const descriptor = await open(path, 'r');
  const prefix = Buffer.alloc(Math.min(65536, size));
  try { await descriptor.read(prefix, 0, prefix.length, 0); } finally { await descriptor.close(); }
  const detected = sniffType(prefix, requested);
  if (detected !== 'application/octet-stream') return { type: detected, ambiguous: false };
  if (prefix[0] === 255 && prefix[1] === 254 || prefix[0] === 254 && prefix[1] === 255) return { type: detected, ambiguous: true };
  let xml = prefix.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  while (xml.startsWith('<?') || xml.startsWith('<!--')) {
    const end = xml.startsWith('<?') ? '?>' : '-->';
    const position = xml.indexOf(end);
    if (position < 0) return { type: detected, ambiguous: true };
    xml = xml.slice(position + end.length).trimStart();
  }
  if (!xml && size > prefix.length) return { type: detected, ambiguous: true };
  if (xml.startsWith('<')) {
    const root = /^<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?=[\s/>])/.exec(xml)?.[1];
    if (!root) return { type: detected, ambiguous: true };
    if (root.split(':').at(-1)?.toLowerCase() === 'svg') return { type: 'image/svg+xml', ambiguous: false };
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for await (const chunk of createReadStream(path)) {
      if (/[\u0000-\u0008\u000b\u000e-\u001f]/u.test(decoder.decode(chunk, { stream: true }))) return { type: detected, ambiguous: false };
    }
    decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) return { type: detected, ambiguous: false };
    throw error;
  }
  const type = /^(text\/[a-z0-9.+-]+|application\/(json|ld\+json|xml|javascript|yaml))$/.test(requested) ? requested : 'text/plain';
  return { type, ambiguous: false };
}

export async function uploadMedia(ctx: RequestContext) {
  const actor = ctx.requireUser();
  const policy = await uploadPolicy(ctx);
  const tempLimit = Math.floor(Math.min(policy.maximum, Math.max(...Object.values(policy.limits)) * MiB));
  if (tempLimit < 1 || policy.capacity < 1 || !policy.mimeTypes.length) throw httpError(403, '此账号暂不允许上传文件。');
  const root = resolve(ctx.filesRoot);
  await mkdir(root, { recursive: true });
  const accessKey = randomBytes(24).toString('hex'), target = resolve(root, accessKey);
  let size = 0, name = '', requested = 'application/octet-stream', wrote = false;
  let commitAttempted = false, fileId: string | undefined;
  const checksum = createHash('md5');
  const consume = async (stream: Readable) => {
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > tempLimit) { done(httpError(413, '文件超过当前上传限额。')); return; }
        checksum.update(chunk);
        done(null, chunk);
      },
    });
    wrote = true;
    await pipeline(stream, counter, createWriteStream(target, { flags: 'wx', mode: 0o640 }));
  };
  try {
    if (ctx.request.isMultipart()) {
      for await (const part of ctx.request.parts({ limits: { files: 1, fields: 4, parts: 5, fileSize: tempLimit } })) {
        if (part.type !== 'file') continue;
        if (wrote) throw httpError(400, '每次只能上传一个文件。');
        name = basename(part.filename.replace(/\\/g, '/'));
        requested = part.mimetype.toLowerCase().split(';')[0]!;
        await consume(part.file);
        if (part.file.truncated) throw httpError(413, '文件超过当前上传限额。');
      }
    } else {
      const encoded = ctx.body.data;
      name = typeof ctx.body.name === 'string' ? basename(ctx.body.name.replace(/\\/g, '/')) : '';
      requested = typeof ctx.body.type === 'string' ? ctx.body.type.toLowerCase().split(';')[0]! : requested;
      if (typeof encoded !== 'string' || encoded.length > Math.ceil(tempLimit / 3) * 4 || encoded.length % 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw httpError(400, '上传内容无效。');
      const data = Buffer.from(encoded, 'base64');
      if (data.toString('base64') !== encoded) throw httpError(400, '上传内容无效。');
      await consume(Readable.from([data]));
    }
    if (!wrote || !size || !name || name.length > 256 || /[\0-\x1f]/.test(name)) throw httpError(400, '请上传有效文件。');
    const { type, ambiguous } = await classify(target, size, requested);
    const limit = Math.min(policy.maximum, ambiguous ? Math.min(policy.limits.image, policy.limits.document, policy.limits.other) * MiB : policy.limits[uploadKind(type)] * MiB);
    if (size > limit) throw httpError(413, `文件超过当前分类限额（${limit / MiB} MiB）。`);
    if (!policy.mimeTypes.some(pattern => pattern === '*/*' || pattern === type || pattern.endsWith('/*') && type.startsWith(pattern.slice(0, -1)))) throw httpError(400, '当前角色不允许上传此文件类型。');
    const id = ctx.newId(), url = new URL(`/legacy-files/${id}`, ctx.config.url).href;
    fileId = id;
    const processing = type.startsWith('image/') || type.startsWith('video/') || type === 'application/ogg';
    const properties: Values = processing ? { communityMedia: { version: 1, state: 'pending', attempts: 0, updatedAt: Date.now() } } : {};
    const client = await ctx.db.connect();
    let discardClient = false;
    try {
      await client.query('BEGIN');
      const owner = await client.query('SELECT id FROM "user" WHERE id=$1 AND NOT "isDeleted" AND NOT "isSuspended" FOR UPDATE', [actor.id]);
      if (!owner.rows.length) throw httpError(403, '账号当前不可用。');
      const used = (await client.query<{ size: string }>('SELECT COALESCE(SUM(size),0)::text AS size FROM drive_file WHERE "userId"=$1 AND "storedInternal" AND NOT "isLink"', [actor.id])).rows[0];
      if (Number(used?.size ?? 0) + size > policy.capacity) throw httpError(413, '文件空间已不足。');
      await client.query(`INSERT INTO drive_file (id,"userId",md5,name,type,size,"storedInternal",url,"accessKey",properties)
        VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9)`, [id, actor.id, checksum.digest('hex'), name, type, size, url, accessKey, properties]);
      commitAttempted = true;
      await client.query('COMMIT');
    } catch (error) {
      discardClient = commitAttempted;
      try { await client.query('ROLLBACK'); } catch { discardClient = true; }
      throw error;
    } finally { client.release(discardClient); }
    return fileDto({ id, name, type, size, url, thumbnailAccessKey: null, properties });
  } catch (error) {
    // A lost commit response does not prove the file is unreferenced.
    if (commitAttempted) console.error(JSON.stringify({ code: 'UPLOAD_COMMIT_UNCERTAIN', fileId, storageKeys: [accessKey] }));
    else if (wrote) await unlink(target).catch(() => {});
    throw error;
  }
}

async function confinedFile(root: string, key: string): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/.test(key) || key === '.' || key === '..') throw new Error('Invalid media key');
  const source = await realpath(resolve(root, key));
  const displacement = relative(root, source);
  if (displacement === '..' || displacement.startsWith(`..${sep}`) || resolve(root, displacement) !== source) throw new Error('Invalid media path');
  return source;
}

async function videoThumbnail(source: string, target: string): Promise<void> {
  await new Promise<void>((accept, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '2', '-protocol_whitelist', 'file,pipe',
      '-i', source, '-frames:v', '1', '-vf', "scale=w='min(498,iw)':h='min(422,ih)':force_original_aspect_ratio=decrease",
      '-an', '-f', 'image2', '-c:v', 'mjpeg', '-n', target], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let detail = '';
    child.stderr.on('data', (data: Buffer) => { detail = (detail + data.toString()).slice(-4096); });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 90000);
    timeout.unref();
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => { clearTimeout(timeout); code === 0 ? accept() : reject(new Error(detail || 'Video processing failed')); });
  });
}

async function processFile(db: Database, root: string, file: WorkerFile): Promise<void> {
  const source = await confinedFile(root, file.accessKey);
  const thumb = randomBytes(24).toString('hex'), web = randomBytes(24).toString('hex');
  const thumbnail = resolve(root, thumb), webpublic = resolve(root, web);
  const temporary = `${thumbnail}.part`, webTemporary = `${webpublic}.part`;
  let webType: string | null = null;
  let publishAttempted = false;
  const extra: Values = {};
  try {
    if (file.type.startsWith('image/')) {
      const image = sharp(source, { limitInputPixels: 100_000_000, failOn: 'warning' });
      const info = await image.metadata();
      extra.width = info.width; extra.height = info.height;
      await image.rotate().resize({ width: 498, height: 422, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(temporary);
      await sharp(source, { animated: true, limitInputPixels: 100_000_000, failOn: 'warning' }).rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toFile(webTemporary);
      await rename(webTemporary, webpublic);
      webType = 'image/webp';
    } else await videoThumbnail(source, temporary);
    // A buffer avoids Sharp holding a file lock across rename on Windows.
    const preview = await sharp(await readFile(temporary)).metadata();
    if (preview.width && preview.height) extra.previewAspectRatio = preview.width / preview.height;
    await rename(temporary, thumbnail);
    publishAttempted = true;
    const updated = await db.query(`UPDATE drive_file SET "thumbnailAccessKey"=$2,"thumbnailUrl"=$3,
      "webpublicAccessKey"=$4,"webpublicUrl"=$5,"webpublicType"=$6,
      properties=jsonb_set(COALESCE(properties,'{}')||$7::jsonb,'{communityMedia}',(properties->'communityMedia')||jsonb_build_object('state','ready','updatedAt',$8::bigint))
      WHERE id=$1 AND properties->'communityMedia'->>'lease'=$9 RETURNING id`,
    [file.id, thumb, `${file.url}?variant=thumbnail`, webType ? web : null, webType ? `${file.url}?variant=webpublic` : null, webType, extra, Date.now(), file.lease]);
    if (!updated.rowCount) {
      publishAttempted = false;
      await unlink(thumbnail).catch(() => {});
      if (webType) await unlink(webpublic).catch(() => {});
    }
  } catch (error) {
    await Promise.all([temporary, webTemporary, ...(!publishAttempted ? [thumbnail, webpublic] : [])].map(path => unlink(path).catch(() => {})));
    if (publishAttempted) console.error(JSON.stringify({ code: 'MEDIA_PUBLISH_UNCERTAIN', fileId: file.id, storageKeys: [thumb, ...(webType ? [web] : [])] }));
    throw error;
  }
}

export function startMediaWorker({ db, filesRoot }: { db: Database; filesRoot: string }): () => Promise<void> {
  let stopped = false, running: Promise<void> | null = null;
  const run = async () => {
    const root = await realpath(filesRoot);
    await db.query(`UPDATE drive_file SET properties=jsonb_set(properties,'{communityMedia}',(properties->'communityMedia')||
      jsonb_build_object('state','failed','updatedAt',$1::bigint,'error','Media processing interrupted'))
      WHERE properties->'communityMedia'->>'version'='1' AND properties->'communityMedia'->>'state'='processing'
      AND (properties->'communityMedia'->>'attempts')::int>=3 AND (properties->'communityMedia'->>'updatedAt')::bigint<$1::bigint-900000::bigint`, [Date.now()]);
    for (let index = 0; index < 2 && !stopped; index++) {
      const lease = randomBytes(16).toString('hex'), now = Date.now();
      const result = await db.query<WorkerFile>(`WITH candidate AS (
        SELECT id FROM drive_file WHERE "storedInternal" AND NOT "isLink" AND properties->'communityMedia'->>'version'='1'
          AND COALESCE((properties->'communityMedia'->>'attempts')::int,0)<3
          AND (properties->'communityMedia'->>'state'='pending'
            OR (properties->'communityMedia'->>'state'='failed' AND COALESCE((properties->'communityMedia'->>'retryAt')::bigint,0)<=$1::bigint)
            OR (properties->'communityMedia'->>'state'='processing' AND (properties->'communityMedia'->>'updatedAt')::bigint<$1::bigint-900000::bigint))
        ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
        UPDATE drive_file f SET properties=jsonb_set(f.properties,'{communityMedia}',(f.properties->'communityMedia')||jsonb_build_object(
          'state','processing','lease',$2::text,'attempts',COALESCE((f.properties->'communityMedia'->>'attempts')::int,0)+1,'updatedAt',$1::bigint))
        FROM candidate WHERE f.id=candidate.id
        RETURNING f.id,f.name,f.type,f.size,f.url,f."accessKey",f."thumbnailAccessKey",f.properties,$2::text AS lease`, [now, lease]);
      const file = result.rows[0];
      if (!file) return;
      try { await processFile(db, root, file); } catch {
        const attempts = record(file.properties?.communityMedia) ? Number(file.properties.communityMedia.attempts ?? 1) : 1;
        await db.query(`UPDATE drive_file SET properties=jsonb_set(properties,'{communityMedia}',(properties->'communityMedia')||jsonb_build_object(
          'state','failed','updatedAt',$2::bigint,'retryAt',$3::bigint,'error','Media processing failed')) WHERE id=$1 AND properties->'communityMedia'->>'lease'=$4
          AND properties->'communityMedia'->>'state'='processing'`,
        [file.id, Date.now(), Date.now() + attempts * 30000, lease]);
      }
    }
  };
  const tick = () => {
    if (stopped || running) return;
    running = run().catch(error => { console.error('Media worker:', error instanceof Error ? error.message : 'Unavailable'); }).finally(() => { running = null; });
  };
  const timer = setInterval(tick, 2000);
  timer.unref();
  void mkdir(filesRoot, { recursive: true }).then(tick).catch(() => {});
  return async () => { stopped = true; clearInterval(timer); await running; };
}
