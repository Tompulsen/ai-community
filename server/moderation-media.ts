import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { RequestContext } from './types.ts';
import type { ModerationSettings } from './settings.ts';

export const maxModerationBytes = 128 * 1024 * 1024;
export const moderationBudgetMs = 180000;
export interface MediaDecision { decision: 'allow' | 'reject' | 'review'; reason?: string }
const unavailable: MediaDecision = { decision: 'review', reason: '内容检查暂未完成，请稍后重试。检查通过后才能发布。' };
const execute = promisify(execFile);
let inferenceQueue: Promise<unknown> = Promise.resolve();
let queuedImages = 0;

export function hasSensitiveWord(value: string, words: string[]) {
  const normalized = value.normalize('NFKC').toLowerCase();
  return words.some(word => normalized.includes(word));
}

async function serviceResult(response: Response, maximum = 128 * 1024): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Moderation service unavailable'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) throw new Error('Moderation response too large');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid moderation response');
  return value;
}

function endpoint(path: string) {
  const endpoint = new URL(process.env.COMMUNITY_MODERATION_URL || 'invalid:');
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !process.env.COMMUNITY_MODERATION_TOKEN)
    throw new Error('Moderation service unavailable');
  endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + path;
  return endpoint;
}

async function currentModelVersion(): Promise<string> {
  const result = await serviceResult(await fetch(endpoint('/healthz'), { redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${process.env.COMMUNITY_MODERATION_TOKEN}` } }), 8192);
  if (result.ready !== true || typeof result.modelVersion !== 'string' || !result.modelVersion || result.modelVersion.length > 256) throw new Error('Moderation model unavailable');
  return result.modelVersion;
}

async function inspectImage(bytes: Buffer, deadline: number, rejectThreshold: number, modelVersion: string) {
  // The model has one inference slot. Queue locally; brief BUSY responses can occur during a rolling release.
  if (queuedImages >= 16) throw new Error('Moderation queue full');
  queuedImages++;
  const pending = inferenceQueue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() >= deadline) throw new Error('Moderation timeout');
      const response = await fetch(endpoint('/check'), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(Math.min(35000, deadline - Date.now())),
        headers: { Authorization: `Bearer ${process.env.COMMUNITY_MODERATION_TOKEN}`, 'Content-Type': 'application/octet-stream',
          'X-Moderation-Reject-Threshold': String(rejectThreshold) }, body: new Uint8Array(bytes) });
      if (response.status === 503 && attempt < 2) {
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 750));
        continue;
      }
      const value = await serviceResult(response);
      if (!value || typeof value.nsfwScore !== 'number' || !Number.isFinite(value.nsfwScore) || value.nsfwScore < 0 || value.nsfwScore > 1 ||
        typeof value.text !== 'string' || value.text.length > 20000 || value.modelVersion !== modelVersion ||
        ('ocrSkipped' in value && typeof value.ocrSkipped !== 'boolean')) throw new Error('Invalid moderation response');
      return { score: value.nsfwScore, text: value.text, ocrSkipped: value.ocrSkipped === true };
    }
    throw new Error('Moderation service unavailable');
  });
  inferenceQueue = pending.catch(() => {});
  try { return await pending; } finally { queuedImages--; }
}

async function checkImage(ctx: RequestContext, ownerId: string, bytes: Buffer, settings: ModerationSettings, deadline: number, modelVersion: string): Promise<MediaDecision> {
  // Cache the pixels the model sees, so metadata stripping and lossless upload conversion do not repeat inference.
  const normalized = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' }).rotate()
    .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).png().timeout({ seconds: 15 }).toBuffer();
  const digest = createHash('sha256').update(normalized).digest('hex');
  const policy = createHash('sha256').update(JSON.stringify([settings, process.env.COMMUNITY_MODERATION_URL, modelVersion, 'nsfw-ocr-pixels-v2'])).digest('hex');
  const key = `community-next:moderation:${ownerId}:${policy}:${digest}`;
  const cached = await ctx.redis?.get(key);
  if (cached) {
    try { const value = JSON.parse(cached) as MediaDecision; if (value.decision === 'allow' || value.decision === 'reject') return value; } catch { /* Recheck corrupt cache entries. */ }
  }
  const detected = await inspectImage(normalized, deadline, settings.rejectThreshold, modelVersion);
  let result: MediaDecision;
  if (detected.score >= settings.rejectThreshold) result = { decision: 'reject', reason: '检测到疑似色情或裸露内容，暂不能发布。请修改后重试，或联系管理员复核。' };
  else if (detected.ocrSkipped) return unavailable;
  else if (hasSensitiveWord(detected.text, settings.sensitiveWords)) result = { decision: 'reject', reason: '图片文字包含社区禁止发布的内容，请修改后重试。' };
  else if (detected.score >= settings.reviewThreshold) result = { decision: 'reject', reason: '作品存在疑似色情或裸露风险，暂不能发布。请修改内容，或联系管理员复核。' };
  else result = { decision: 'allow' };
  // These are results, never client-supplied authorization. Policy and actual pixels are checked again at publication.
  await ctx.redis?.set(key, JSON.stringify(result), 'EX', 86400);
  return result;
}

async function videoFrames(bytes: Buffer): Promise<Buffer[]> {
  const root = await mkdtemp(join(tmpdir(), 'community-moderation-'));
  try {
    const input = join(root, 'source');
    await writeFile(input, bytes, { mode: 0o600 });
    const formats = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,ogg';
    const probe = await execute('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', formats,
      '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', input], { timeout: 15000, maxBuffer: 65536, windowsHide: true });
    const info = JSON.parse(probe.stdout), duration = Number(info.format?.duration);
    const stream = info.streams?.find((item: { codec_type?: string }) => item.codec_type === 'video');
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120 || !stream || stream.width * stream.height > 40_000_000) throw new Error('Unsupported video');
    // shortcut: twelve sampled frames cannot detect every brief scene or the audio track; use a dedicated video model for full coverage.
    await execute('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '2', '-protocol_whitelist', 'file,pipe', '-format_whitelist', formats,
      '-i', input, '-an', '-sn', '-dn', '-vf', `fps=${12 / duration},scale=1280:1280:force_original_aspect_ratio=decrease`,
      '-frames:v', '12', '-threads', '2', join(root, 'frame-%02d.png')], { timeout: 30000, maxBuffer: 65536, windowsHide: true });
    const paths = (await readdir(root)).filter(name => /^frame-\d{2}\.png$/.test(name)).sort();
    if (!paths.length) throw new Error('No video frames');
    return await Promise.all(paths.map(name => readFile(join(root, name))));
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function checkModerationMedia(ctx: RequestContext, ownerId: string, bytes: Buffer, type: string, settings: ModerationSettings, deadline: number): Promise<MediaDecision> {
  if (!settings.enabled) return { decision: 'allow' };
  if (!bytes.length || bytes.length > maxModerationBytes || Date.now() >= deadline) return unavailable;
  try {
    if (['text/plain', 'text/markdown', 'text/x-markdown'].includes(type)) {
      if (bytes.length > 2 * 1024 * 1024) return { decision: 'review', reason: '文本超过 2 MB，暂无法完成内容检查。' };
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) return unavailable;
      return hasSensitiveWord(text, settings.sensitiveWords)
        ? { decision: 'reject', reason: '作品文字包含社区禁止发布的内容，请修改后重试。' } : { decision: 'allow' };
    }
    let frames: Buffer[];
    if (['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(type)) {
      if (bytes.length > 20 * 1024 * 1024) return { decision: 'review', reason: '图片超过 20 MB，暂无法完成内容检查。' };
      // libvips reads only the default APNG frame. Do not label that as a checked animation.
      if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        for (let offset = 8; offset + 12 <= bytes.length;) {
          const length = bytes.readUInt32BE(offset);
          if (length > bytes.length - offset - 12) return unavailable;
          if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') return { decision: 'review', reason: '暂不支持 APNG 动画初审，请转换为 GIF、WebP 或视频后重试。' };
          offset += length + 12;
        }
      }
      const metadata = await sharp(bytes, { animated: true, limitInputPixels: 40_000_000, failOn: 'warning' }).metadata();
      if (!['jpeg', 'png', 'webp', 'heif', 'avif', 'gif'].includes(metadata.format || '')) return unavailable;
      const pages = metadata.pages ?? 1;
      if (pages > 500) return { decision: 'review', reason: '动图帧数过多，暂无法完成内容检查。' };
      if (pages === 1) frames = [bytes];
      else {
        const indices = [...new Set(Array.from({ length: Math.min(pages, 12) }, (_, index) => Math.round(index * (pages - 1) / (Math.min(pages, 12) - 1))))];
        frames = [];
        for (const page of indices) frames.push(await sharp(bytes, { page, pages: 1, limitInputPixels: 40_000_000, failOn: 'warning' }).png().timeout({ seconds: 10 }).toBuffer());
      }
    } else if (['video/mp4', 'video/webm', 'video/ogg'].includes(type)) frames = await videoFrames(bytes);
    else return { decision: 'review', reason: '此文件类型暂不支持自动检查，请更换文件后发布。' };
    const modelVersion = await currentModelVersion();
    let uncertain: MediaDecision | undefined;
    for (const frame of frames) {
      if (Date.now() >= deadline) return unavailable;
      const result = await checkImage(ctx, ownerId, frame, settings, deadline, modelVersion);
      if (result.decision === 'reject') return result;
      if (result.decision !== 'allow') uncertain = result;
    }
    return uncertain ?? { decision: 'allow' };
  } catch { return unavailable; }
}
