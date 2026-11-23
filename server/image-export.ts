import type { Stats } from 'node:fs';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { httpError } from './auth.ts';

const cache = new Map<string, Buffer | null>();
const pending = new Map<string, Promise<Buffer | null>>();
const queues: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
const maxBytes = 32 * 1024 * 1024;
let bytes = 0, nextQueue = 0;

// Call only after media authorization, path validation and privacy sanitization.
export async function jpegImage(source: string, metadata: Stats): Promise<Buffer | null> {
  const key = JSON.stringify(['jpeg-v1', source, metadata.size, metadata.mtimeMs, metadata.ctimeMs]);
  if (cache.has(key)) {
    const value = cache.get(key)!;
    cache.delete(key); cache.set(key, value);
    return value;
  }
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 16) throw httpError(503, '图片处理中，请稍后重试。');
  const slot = nextQueue++ % queues.length;
  const task = queues[slot]!.then(async () => {
    const image = sharp(await readFile(source), { limitInputPixels: 100_000_000, failOn: 'warning' });
    const details = await image.metadata();
    // JPEG has no animation; keep every frame of animated originals.
    const output = (details.pages ?? 1) > 1 ? null : await image.rotate().flatten({ background: '#ffffff' })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).timeout({ seconds: 30 }).toBuffer();
    if (!output || output.length <= maxBytes) {
      while (cache.size && (cache.size >= 128 || bytes + (output?.length ?? 0) > maxBytes)) {
        const oldest = cache.keys().next().value!;
        bytes -= cache.get(oldest)?.length ?? 0; cache.delete(oldest);
      }
      cache.set(key, output); bytes += output?.length ?? 0;
    }
    return output;
  });
  queues[slot] = task.catch(() => {});
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
