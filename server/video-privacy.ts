import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, rename, stat, unlink } from 'node:fs/promises';
import { httpError } from './auth.ts';

interface SanitizedVideo { path: string; type: string; size: number; md5: string }
const processing = new Map<string, Promise<SanitizedVideo>>();
const queues: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
let queueIndex = 0;

export async function privateMetadataFreeVideo(source: string, type: string, maximumSize = Number.MAX_SAFE_INTEGER): Promise<SanitizedVideo> {
  const format = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogg', 'audio/ogg': 'ogg', 'application/ogg': 'ogg' }[type];
  if (!format) throw httpError(400, '不支持此媒体格式。');
  const existing = processing.get(source);
  if (existing) return existing;
  if (processing.size >= 8) throw httpError(503, '媒体处理中，请稍后重试。');
  const index = queueIndex++ % queues.length;
  const task = queues[index]!.then(async () => {
    const temporary = source + '.' + randomBytes(8).toString('hex') + '.part';
    try {
      const info = await stat(source);
      const safeOutputLimit = Math.min(info.size * 2, maximumSize + 1);
      const outputLimit = safeOutputLimit + 1024 * 1024;
      await new Promise<void>((accept, reject) => {
        const child = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '2', '-protocol_whitelist', 'file,pipe',
          '-f', format, '-i', source, '-map', '0:v:0?', '-map', '0:a?', '-c', 'copy', '-map_metadata', '-1', '-map_metadata:s', '-1',
          '-map_chapters', '-1', '-metadata', 'encoder=', '-metadata:s', 'encoder=', '-fs', String(outputLimit),
          '-f', format, '-n', temporary], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
        const timeout = setTimeout(() => child.kill('SIGKILL'), 90000);
        timeout.unref();
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('close', code => { clearTimeout(timeout); code === 0 ? accept() : reject(new Error('Video privacy processing failed')); });
      });
      const output = await stat(temporary);
      // Reject below FFmpeg's hard stop: a size-limited mux can exit successfully with incomplete content.
      if (!output.size || output.size >= safeOutputLimit) throw new Error('Video privacy output exceeds limit');
      await chmod(temporary, info.mode & 0o777);
      const checksum = createHash('md5');
      for await (const chunk of createReadStream(temporary)) checksum.update(chunk);
      await rename(temporary, source);
      return { path: source, type, size: output.size, md5: checksum.digest('hex') };
    } finally { await unlink(temporary).catch(() => {}); }
  });
  queues[index] = task.catch(() => {});
  processing.set(source, task);
  try { return await task; } finally { processing.delete(source); }
}
