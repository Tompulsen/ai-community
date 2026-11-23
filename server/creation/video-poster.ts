import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import { httpError } from '../auth.ts'

export const videoPosterSourceLimit = 64 * 1024 * 1024
interface Poster { bytes: Uint8Array<ArrayBuffer>; duration?: number; expires: number }
interface Job { controller: AbortController; promise: Promise<Poster>; users: number }
const cache = new Map<string, Poster>(), pending = new Map<string, Job>()
let active = 0
const waiting: (() => void)[] = []

async function acquire(signal: AbortSignal) {
  signal.throwIfAborted()
  if (active < 2) { active++; return }
  if (waiting.length >= 14) throw httpError(503, '视频封面处理中，请稍后重试。')
  await new Promise<void>((resolve, reject) => {
    const start = () => { signal.removeEventListener('abort', cancel); active++; resolve() }
    const cancel = () => { waiting.splice(waiting.indexOf(start), 1); reject(signal.reason) }
    waiting.push(start)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

function decode(source: string, signal: AbortSignal, seek: number, format: 'mov' | 'matroska') {
  const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'info', '-threads', '2',
    '-protocol_whitelist', 'file,pipe', '-probesize', '1048576', '-analyzeduration', '1000000',
    '-f', format, '-ss', String(seek), '-i', source, '-frames:v', '1',
    '-vf', "scale=w='min(480,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease",
    '-an', '-f', 'image2pipe', '-c:v', 'png', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let duration: number | undefined, detail = '', size = 0
  const chunks: Buffer[] = []
  const kill = () => { child.kill('SIGKILL') }
  const result = new Promise<{ bytes: Buffer; duration?: number }>((resolve, reject) => {
    signal.addEventListener('abort', kill, { once: true })
    if (signal.aborted) kill()
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 2 * 1024 * 1024) kill()
      else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      detail = (detail + chunk.toString()).slice(-8192)
      const found = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(detail)
      if (found) duration = Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3])
    })
    child.once('error', error => { signal.removeEventListener('abort', kill); reject(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', kill)
      if (signal.aborted) reject(signal.reason)
      else if (code !== 0 || !size || size > 2 * 1024 * 1024) reject(new Error('Video poster cannot be decoded'))
      else resolve({ bytes: Buffer.concat(chunks), duration })
    })
  })
  // A streaming demuxer can stop reading its input before the downloader finishes.
  child.stdin.on('error', () => {})
  child.once('exit', () => child.stdin.destroy())
  return { child, result, kill, get duration() { return duration } }
}

async function image(bytes: Buffer) {
  const { data, info } = await sharp(bytes, { limitInputPixels: 480 * 480, failOn: 'warning' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let sum = 0, squares = 0, peak = 0, count = 0
  for (let index = 0; index < data.length; index += info.channels * 16) {
    const brightness = data[index]! * .2126 + data[index + 1]! * .7152 + data[index + 2]! * .0722
    sum += brightness; squares += brightness * brightness
    peak = Math.max(peak, data[index]!, data[index + 1]!, data[index + 2]!); count++
  }
  if (sum / count < 10 && squares / count - (sum / count) ** 2 < 4 && peak < 24) return undefined
  const converted = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).webp({ quality: 80 }).toBuffer()
  return new Uint8Array(converted)
}

async function capture(load: (signal: AbortSignal) => Promise<Response>, signal: AbortSignal): Promise<Poster> {
  const download = new AbortController(), sourceSignal = AbortSignal.any([signal, download.signal])
  let directory = '', decoder: ReturnType<typeof decode> | undefined, source: Readable | undefined
  let saving: Promise<void> | undefined
  try {
    const response = await load(sourceSignal)
    const length = Number(response.headers.get('content-length'))
    if (!response.ok || !response.body || !/^video\/(?:mp4|webm|quicktime|x-matroska)(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel()
      throw httpError(415, '视频封面无法读取，可直接播放原视频。')
    }
    if (length > videoPosterSourceLimit) {
      await response.body.cancel()
      throw httpError(413, '视频较大，请直接播放原视频。')
    }
    const format = /^(?:video\/webm|video\/x-matroska)(?:;|$)/i.test(response.headers.get('content-type') || '') ? 'matroska' : 'mov'
    directory = await mkdtemp(join(tmpdir(), 'community-video-poster-'))
    const filename = join(directory, 'source')
    decoder = decode('pipe:0', signal, .75, format)
    const streamingDecoder = decoder
    const streamed = decoder.result.then(value => ({ value }), error => ({ error }))
    let size = 0
    source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>, { signal: sourceSignal })
    const tee = new Transform({ transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (size > videoPosterSourceLimit) { done(httpError(413, '视频较大，请直接播放原视频。')); return }
      if (streamingDecoder.child.stdin.destroyed || streamingDecoder.child.stdin.writableEnded) done(null, chunk)
      else streamingDecoder.child.stdin.write(chunk, () => done(null, chunk))
    } })
    saving = pipeline(source, tee, createWriteStream(filename, { flags: 'wx', mode: 0o600 }))
    void saving.then(() => streamingDecoder.child.stdin.end(), () => streamingDecoder.kill())
    const saved = saving.then(() => ({}), error => ({ error }))
    const first = await Promise.race([streamed, saved])
    if ('error' in first && signal.aborted) throw signal.reason
    const decoded = await streamed
    if ('value' in decoded) {
      const bytes = await image(decoded.value.bytes)
      if (bytes) {
        download.abort(); source.destroy()
        await saved
        return { bytes, duration: decoded.value.duration, expires: Date.now() + 15 * 60000 }
      }
    }
    // Tail-indexed files need a seekable local input; reuse the same bounded download.
    const complete = await saved
    if ('error' in complete) throw complete.error
    const duration = decoder.duration
    const times = duration && duration > 0 ? [Math.min(.5, duration * .1), duration * .25, duration * .5] : [.1, .5, 1]
    for (const time of new Set(times)) {
      decoder = decode(filename, signal, time, format)
      const frame = await decoder.result
      const bytes = await image(frame.bytes)
      if (bytes) return { bytes, duration: frame.duration || duration, expires: Date.now() + 15 * 60000 }
    }
    throw httpError(502, '视频暂无可用封面，可直接播放原视频。')
  } finally {
    download.abort(); decoder?.kill(); source?.destroy()
    await saving?.catch(() => {})
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}

async function run(load: (signal: AbortSignal) => Promise<Response>, controller: AbortController) {
  const timeout = setTimeout(() => controller.abort(new DOMException('Video poster timed out', 'TimeoutError')), 30000)
  let acquired = false
  try {
    await acquire(controller.signal); acquired = true
    return await capture(load, controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw httpError(504, '视频封面生成超时，请重试或直接播放原视频。')
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw httpError(503, '视频封面暂时不可用，可直接播放原视频。')
    throw error
  } finally {
    clearTimeout(timeout)
    if (acquired) { active--; waiting.shift()?.() }
  }
}

export async function videoPoster(key: string, load: (signal: AbortSignal) => Promise<Response>, signal: AbortSignal) {
  signal.throwIfAborted()
  let poster = cache.get(key)
  if (poster && poster.expires <= Date.now()) { cache.delete(key); poster = undefined }
  if (!poster) {
    let job = pending.get(key)
    if (job?.controller.signal.aborted) job = undefined
    if (!job) {
      const controller = new AbortController()
      const next: Job = { controller, users: 0, promise: run(load, controller).then(value => {
        cache.delete(key); cache.set(key, value)
        while (cache.size > 32) cache.delete(cache.keys().next().value!)
        return value
      }).finally(() => { if (pending.get(key) === next) pending.delete(key) }) }
      job = next
      pending.set(key, job)
    }
    job.users++
    const accepted = job
    poster = await new Promise<Poster>((resolve, reject) => {
      const cancel = () => reject(signal.reason)
      signal.addEventListener('abort', cancel, { once: true })
      accepted.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
    }).finally(() => { if (--accepted.users === 0) accepted.controller.abort() })
  }
  const headers = new Headers({ 'Content-Type': 'image/webp', 'Content-Length': String(poster.bytes.length) })
  if (poster.duration && Number.isFinite(poster.duration)) headers.set('X-Video-Duration', String(poster.duration))
  return new Response(poster.bytes, { headers })
}
