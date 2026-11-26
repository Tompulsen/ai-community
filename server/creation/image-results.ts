import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, realpath, rm, statfs, unlink } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { CreationOutput } from '../creation-contract.ts'
import type { fetchPublicMedia } from './public-media.ts'
import { acquireImageRead, releaseImageRead } from './image-preview.ts'
import { createProxyLifecycle } from './proxy-lifecycle.ts'

const limit = 32 * 1024 * 1024
const types: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-ms-bmp': 'bmp',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' }
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const failure = (message: string, statusCode = 502) => Object.assign(new Error(message), { statusCode })
interface ImageFile { name: string; hash: string; type: string; size: number }
interface Checkpoint { version: 1; source: string; file: ImageFile }
const pending = new Map<string, { fingerprint: string; promise: Promise<CreationOutput[]> }>()

function identity(key: string) {
  const match = /^community-next:creation:request:([a-f0-9]{64}):([A-Za-z0-9_-]{1,128})$/.exec(key)
  if (!match) throw failure('图片保存归属无效。', 400)
  return { namespace: match[1]!, requestId: match[2]! }
}
function mediaUrl(requestId: string, index: number) {
  return `/api/creation/media?${new URLSearchParams({ requestId, index: String(index) })}`
}
async function syncDirectory(directory: string) {
  if (process.platform === 'win32') return
  const handle = await open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
async function directory(filesRoot: string, key: string, create: boolean) {
  const owner = identity(key)
  if (create) await mkdir(filesRoot, { recursive: true, mode: 0o700 })
  let current = await realpath(filesRoot)
  for (const part of ['.creation-images', owner.namespace, hash(owner.requestId)]) {
    const parent = current
    current = path.join(parent, part)
    if (create) {
      try { await mkdir(current, { mode: 0o700 }); await syncDirectory(parent) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink() || path.relative(current, await realpath(current)))
      throw failure('图片保存目录无效。')
  }
  return current
}
async function readFile(directory: string, name: string, maximum: number, expected?: ImageFile) {
  const target = path.join(directory, name), before = await lstat(target)
  if (!before.isFile() || before.isSymbolicLink() || path.relative(target, await realpath(target)))
    throw failure('图片保存文件无效。')
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev || !info.size || info.size > maximum
      || expected && info.size !== expected.size) throw failure('图片保存文件大小无效。')
    const bytes = Buffer.alloc(info.size)
    let offset = 0
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!result.bytesRead) break
      offset += result.bytesRead
    }
    if (offset !== bytes.length || (await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead
      || expected && hash(bytes) !== expected.hash) throw failure('图片保存文件已损坏。')
    return bytes
  } finally { await handle.close() }
}
async function publish(directory: string, name: string, bytes: Buffer) {
  const temporary = path.join(directory, `.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    try { await link(temporary, path.join(directory, name)) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (!(await readFile(directory, name, bytes.length)).equals(bytes)) throw failure('原任务图片记录不能被替换。', 409)
    }
    await syncDirectory(directory)
  } finally { await unlink(temporary).catch(() => {}) }
}
async function checkpoint(directory: string, index: number): Promise<Checkpoint | undefined> {
  let bytes: Buffer
  try { bytes = await readFile(directory, `${index}.json`, 2048) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  let value: Partial<Checkpoint>
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw failure('图片保存记录无效。') }
  const file = value.file
  if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.source || '') || !file
    || !Object.hasOwn(types, file.type) || !/^[a-f0-9]{64}$/.test(file.hash)
    || file.name !== `${file.hash}.${types[file.type]}` || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > limit)
    throw failure('图片保存记录无效。')
  return value as Checkpoint
}
async function download(source: string, publicMedia: typeof fetchPublicMedia, signal: AbortSignal) {
  let bytes: Buffer, type: string
  if (source.startsWith('data:')) {
    const data = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(source)
    if (!data || data[2]!.length > Math.ceil(limit / 3) * 4 + 1024) throw failure('生成图片数据无效。')
    type = data[1]!
    bytes = Buffer.from(data[2]!, 'base64')
  } else {
    const lifecycle = createProxyLifecycle(signal, 65000)
    try {
    let abortHeaders: () => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      abortHeaders = () => reject(lifecycle.signal.reason)
      lifecycle.signal.addEventListener('abort', abortHeaders, { once: true })
      if (lifecycle.signal.aborted) abortHeaders()
    })
    const fetched = publicMedia(source, 'image', limit, lifecycle.signal)
    void fetched.then(response => {
      if (lifecycle.signal.aborted) void response.body?.cancel(lifecycle.signal.reason).catch(() => {})
    }, () => {})
    let response: Response
    try { response = await Promise.race([fetched, aborted]) }
    finally { lifecycle.signal.removeEventListener('abort', abortHeaders) }
    if (!response.ok || Number(response.headers.get('content-length')) > limit || !response.body) {
      void response.body?.cancel().catch(() => {}); throw failure('生成原图暂时无法保存。')
    }
    type = response.headers.get('content-type')?.split(';')[0] || ''
    if (!Object.hasOwn(types, type)) { void response.body.cancel().catch(() => {}); throw failure('生成原图格式不受支持。') }
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = lifecycle.stream(response.body)!.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        if (done) break
        total += value.byteLength
        if (total > limit) throw failure('生成原图超过 32 MB。', 413)
        chunks.push(value)
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
    bytes = Buffer.concat(chunks)
    } finally { lifecycle.dispose() }
  }
  if (!bytes.length || bytes.length > limit) throw failure('生成原图为空或超过 32 MB。', 413)
  if (types[type] === 'bmp' || types[type] === 'ico') {
    if (!(types[type] === 'bmp' ? bytes.subarray(0, 2).equals(Buffer.from('BM'))
      : bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])))) throw failure('生成原图内容无效。')
  } else {
    const metadata = await sharp(bytes, { limitInputPixels: 100000000, failOn: 'warning' }).metadata()
    const expected = type === 'image/avif' ? 'heif' : type === 'image/jpeg' ? 'jpeg' : types[type]
    if (!metadata.width || !metadata.height || metadata.format !== expected) throw failure('生成原图内容无效。')
  }
  return { bytes, type }
}

/** Original bytes are published before each immutable per-image checkpoint. */
export async function saveImageOutputs(filesRoot: string, key: string, outputs: CreationOutput[], publicMedia: typeof fetchPublicMedia): Promise<CreationOutput[]> {
  const deadline = AbortSignal.timeout(90000)
  const owner = identity(key)
  if (!Array.isArray(outputs) || outputs.length > 10) throw failure('生成图片数量超过安全上限。', 413)
  const target = await directory(filesRoot, key, true), fingerprint = hash(JSON.stringify(outputs))
  const existing = pending.get(target)
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw failure('原任务图片内容不一致。', 409)
    return existing.promise
  }
  const promise = (async () => {
    const saved: CreationOutput[] = []
    for (const [index, output] of outputs.entries()) {
      deadline.throwIfAborted()
      const source = output.url
      if (!source) { saved.push(output); continue }
      let previous = await checkpoint(target, index)
      const url = mediaUrl(owner.requestId, index)
      if (source === url && !previous) throw failure('原任务图片保存记录不存在。', 404)
      if (previous && source !== url && previous.source !== hash(source)) throw failure('原任务图片来源不一致。', 409)
      if (previous) {
        try { await readFile(target, previous.file.name, limit, previous.file); saved.push({ ...output, url }); continue }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || source === url) throw error }
      }
      const signal = AbortSignal.any([deadline, AbortSignal.timeout(65000)])
      let acquired = false
      try {
        await acquireImageRead(signal); acquired = true
        const space = await statfs(target)
        if (space.bavail * space.bsize < limit + 1024 * 1024) throw failure('服务器图片保存空间不足。', 503)
        const { bytes, type } = await download(source, publicMedia, signal), digest = hash(bytes)
        signal.throwIfAborted()
        const file = { name: `${digest}.${types[type]}`, hash: digest, type, size: bytes.length }
        if (previous && JSON.stringify(previous.file) !== JSON.stringify(file)) throw failure('原任务图片内容发生变化。', 409)
        await directory(filesRoot, key, false)
        signal.throwIfAborted()
        await publish(target, file.name, bytes)
        previous = { version: 1, source: hash(source), file }
        await publish(target, `${index}.json`, Buffer.from(JSON.stringify(previous)))
        saved.push({ ...output, url })
      } finally { if (acquired) releaseImageRead() }
    }
    return saved
  })()
  pending.set(target, { fingerprint, promise })
  try { return await promise } finally { if (pending.get(target)?.promise === promise) pending.delete(target) }
}

export async function readSavedImage(filesRoot: string, key: string, index: number): Promise<Response> {
  identity(key)
  if (!Number.isInteger(index) || index < 0 || index > 9) throw failure('图片序号无效。', 400)
  try {
    const target = await directory(filesRoot, key, false), saved = await checkpoint(target, index)
    if (!saved) throw failure('图片尚未保存。', 404)
    const bytes = await readFile(target, saved.file.name, limit, saved.file)
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': saved.file.type, 'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw failure('图片尚未保存。', 404)
    throw error
  }
}

export async function removeSavedImages(filesRoot: string, key: string) {
  try {
    const target = await directory(filesRoot, key, false)
    if (pending.has(target)) throw failure('图片仍在保存中。', 409)
    // directory validates every path component before removing this request's directory.
    await rm(target, { recursive: true, force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
