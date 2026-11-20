import { createHash, randomBytes } from 'node:crypto';
import { stat, rename, unlink, readFile, chmod } from 'node:fs/promises';
import sharp from 'sharp';
import { httpError } from './auth.ts';

export const imageExtensions: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
};
export const videoExtensions: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'audio/ogg': 'ogg', 'application/ogg': 'ogg',
};

export function publicImageName(file: { id: string; name: string; type: string }): string {
  const extension = imageExtensions[file.type] ?? videoExtensions[file.type];
  return extension ? `zhangyu-${file.id}.${extension}` : file.name;
}

interface SanitizedImage { path: string; type: string; size: number; md5: string }
const processing = new Map<string, Promise<SanitizedImage>>();
const queues: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
let queueIndex = 0;

export async function privateMetadataFreeImage(source: string): Promise<SanitizedImage> {
  const existing = processing.get(source);
  if (existing) return existing;
  if (processing.size >= 32) throw httpError(503, '图片处理中，请稍后重试。');
  const index = queueIndex++ % queues.length;
  const task = queues[index]!.then(async () => {
    const temporary = source + '.' + randomBytes(8).toString('hex') + '.part';
    try {
      const info = await stat(source);
      const image = sharp(await readFile(source), { animated: true, limitInputPixels: 100_000_000, failOn: 'warning' });
      const details = await image.metadata();
      // WebP cannot encode a side above 16383 pixels; keep oversized static images as PNG.
      const png = (details.pages ?? 1) === 1 && Math.max(details.width ?? 0, details.height ?? 0) > 16383;
      const output = image.rotate().timeout({ seconds: 30 });
      await (png ? output.png() : output.webp({ lossless: true, effort: 0 })).toFile(temporary);
      await chmod(temporary, info.mode & 0o777);
      const bytes = await readFile(temporary);
      const result = { path: source, type: png ? 'image/png' : 'image/webp', size: bytes.length,
        md5: createHash('md5').update(bytes).digest('hex') };
      await rename(temporary, source);
      return result;
    } finally { await unlink(temporary).catch(() => {}); }
  });
  queues[index] = task.catch(() => {});
  processing.set(source, task);
  try { return await task; } finally { processing.delete(source); }
}
