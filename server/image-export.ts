import type { Stats } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { httpError } from './auth.ts';
import { createHash } from 'node:crypto';
import { sniffType } from './media.ts';
import type { RequestContext } from './types.ts';
import { isImageDownloadFormat, type ImageDownloadFormat } from '../shared/image-download.ts';

const cache = new Map<string, Buffer | null>();
const pending = new Map<string, Promise<Buffer | null>>();
const queues: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
const maxBytes = 32 * 1024 * 1024;
let bytes = 0, nextQueue = 0, queued = 0;

async function enqueue<T>(work: () => Promise<T>): Promise<T> {
  if (queued >= 16) throw httpError(503, '图片处理中，请稍后重试。');
  queued++;
  const slot = nextQueue++ % queues.length;
  const task = queues[slot]!.then(work);
  queues[slot] = task.catch(() => {});
  try { return await task; } finally { queued--; }
}

function ensureSupportedAnimation(source: Buffer) {
  const inputType = sniffType(source.subarray(0, 64), 'application/octet-stream');
  let unsupportedAnimation = inputType === 'image/avif' && source.subarray(0, Math.min(source.readUInt32BE(0), 4096)).includes(Buffer.from('avis'));
  if (inputType === 'image/png') for (let offset = 8; offset + 8 <= source.length;) {
    const type = source.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') { unsupportedAnimation = true; break; }
    if (type === 'IDAT' || type === 'IEND') break;
    offset += source.readUInt32BE(offset) + 12;
  }
  if (unsupportedAnimation) throw httpError(400, '此动图暂不支持保留动画转换，请选择 JPG / PNG 保存首帧。');
}

async function encodeDownload(source: Buffer, format: ImageDownloadFormat): Promise<Buffer> {
  if (!source.length || source.length > maxBytes) throw httpError(413, '图片超过 32 MB，暂时无法转换下载。');
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(sniffType(source.subarray(0, 64), 'application/octet-stream')))
    throw httpError(400, '不支持的图片格式。');
  if (format === 'gif' || format === 'webp') ensureSupportedAnimation(source);
  try {
    const image = sharp(source, { animated: format === 'webp' || format === 'gif', limitInputPixels: 100_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 500) throw httpError(413, '动画帧数过多，请使用较小的图片。');
    const oriented = image.rotate().timeout({ seconds: 30 });
    if (format === 'png' || format === 'webp') oriented.keepIccProfile();
    if (format === 'png' && (metadata.depth === 'ushort' || (metadata.bitsPerSample ?? 8) > 8)) oriented.toColourspace('rgb16');
    const output = await (format === 'jpeg' ? oriented.flatten({ background: '#ffffff' }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      : format === 'png' ? oriented.png() : format === 'webp' ? oriented.webp({ lossless: true, exact: true }) : oriented.gif()).toBuffer();
    if (output.length > maxBytes) throw httpError(413, '转换后的图片超过 32 MB，请选择其他格式。');
    return output;
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) throw error;
    throw httpError(400, '图片无法转换，请检查文件或选择其他格式。');
  }
}

export async function handleImageExport(ctx: RequestContext): Promise<boolean> {
  if (ctx.req.method !== 'POST' || ctx.url.pathname !== '/api/images/export') return false;
  const identity = createHash('sha256').update(ctx.user?.id ? `user:${ctx.user.id}` : `ip:${ctx.ip}`).digest('hex');
  const count = Number(await ctx.redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],60) end; return n',
    1, `community-next:image-export:${identity}`));
  if (count > 30) throw httpError(429, '下载过于频繁，请稍后再试。');
  const { data, format } = ctx.body;
  if (!isImageDownloadFormat(format)) throw httpError(400, '请选择有效的图片格式。');
  if (typeof data !== 'string' || !data.length || data.length > Math.ceil(maxBytes / 3) * 4 || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    throw httpError(400, '图片数据无效或超过 32 MB。');
  const output = await enqueue(async () => {
    const source = Buffer.from(data, 'base64');
    if (source.toString('base64') !== data) throw httpError(400, '图片数据无效。');
    return encodeDownload(source, format);
  });
  ctx.reply.header('Content-Type', `image/${format}`).header('Cache-Control', 'private, no-store')
    .header('X-Content-Type-Options', 'nosniff').header('Content-Disposition', `attachment; filename="image.${format === 'jpeg' ? 'jpg' : format}"`)
    .send(output);
  return true;
}

export async function downloadImage(source: string, metadata: Stats, format: ImageDownloadFormat): Promise<Buffer> {
  if (metadata.size > maxBytes) throw httpError(413, '图片超过 32 MB，暂时无法转换下载。');
  return (await cachedImage(source, metadata, format))!;
}

// Call only after media authorization, path validation and privacy sanitization.
export async function jpegImage(source: string, metadata: Stats): Promise<Buffer | null> {
  return cachedImage(source, metadata, 'jpeg-v1');
}

export async function coverImage(source: string, metadata: Stats): Promise<Buffer | null> {
  return cachedImage(source, metadata, 'cover-v1');
}

export type PreviewWidth = 96 | 256 | 498;

export async function sizedPreviewImage(source: string, metadata: Stats, width: PreviewWidth, animatedOnly = false): Promise<Buffer | null> {
  // Route common static covers to the stored thumbnail even when every conversion slot is busy.
  if (animatedOnly) {
    const handle = await open(source, 'r');
    try {
      const header = Buffer.alloc(32);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const type = sniffType(header.subarray(0, bytesRead), 'application/octet-stream');
      if (type === 'image/jpeg' || (type === 'image/webp' && bytesRead > 20 &&
        (header.toString('ascii', 12, 16) !== 'VP8X' || !(header[20] & 2)))) return null;
    } finally { await handle.close(); }
  }
  return cachedConversion(source, metadata, `preview-v1-${width}-${animatedOnly}`, async () => {
    if (metadata.size > maxBytes) throw httpError(413, '预览文件过大。');
    const input = await readFile(source);
    ensureSupportedAnimation(input);
    const image = sharp(input, { animated: true, limitInputPixels: 100_000_000, failOn: 'warning' });
    const details = await image.metadata();
    if (animatedOnly && (details.pages ?? 1) === 1) return null;
    if ((details.pages ?? 1) > 500) throw httpError(413, '动画帧数过多。');
    return image.rotate().resize({ width, height: width * 2, fit: 'inside', withoutEnlargement: true })
      .keepIccProfile().webp({ quality: 80, effort: 3 }).timeout({ seconds: 30 }).toBuffer();
  });
}

function cachedImage(source: string, metadata: Stats, format: 'jpeg-v1' | 'cover-v1' | ImageDownloadFormat): Promise<Buffer | null> {
  return cachedConversion(source, metadata, format, async () => {
    const input = await readFile(source);
    const image = sharp(input, { animated: format === 'cover-v1', limitInputPixels: 100_000_000, failOn: 'warning' });
    const details = await image.metadata();
    const animated = (details.pages ?? 1) > 1;
    // Static covers reuse stored thumbnails; animated covers and JPEG downloads retain every frame.
    const output = isImageDownloadFormat(format) ? await encodeDownload(input, format) : format === 'cover-v1'
      ? animated ? await image.rotate().resize({ width: 498, height: 422, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 }).timeout({ seconds: 30 }).toBuffer() : null
      : animated ? null : await image.rotate().flatten({ background: '#ffffff' })
        .jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).timeout({ seconds: 30 }).toBuffer();
    return output;
  });
}

async function cachedConversion(source: string, metadata: Stats, format: string, convert: () => Promise<Buffer | null>): Promise<Buffer | null> {
  const key = JSON.stringify([format, source, metadata.size, metadata.mtimeMs, metadata.ctimeMs]);
  if (cache.has(key)) {
    const value = cache.get(key)!;
    cache.delete(key); cache.set(key, value);
    return value;
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const task = enqueue(async () => {
    const output = await convert();
    if (!output || output.length <= maxBytes) {
      while (cache.size && (cache.size >= 128 || bytes + (output?.length ?? 0) > maxBytes)) {
        const oldest = cache.keys().next().value!;
        bytes -= cache.get(oldest)?.length ?? 0; cache.delete(oldest);
      }
      cache.set(key, output); bytes += output?.length ?? 0;
    }
    return output;
  });
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
