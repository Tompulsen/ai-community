import sharp from 'sharp'
import { httpError } from '../auth.ts'
import type { fetchPublicMedia } from './public-media.ts'
import { createProxyLifecycle } from './proxy-lifecycle.ts'

let active = 0
const waiting: (() => void)[] = []

export async function acquireImageRead(signal: AbortSignal) {
  signal.throwIfAborted()
  if (active < 2) { active++; return }
  if (waiting.length >= 14) throw httpError(503, '图片读取繁忙，请稍后重试。')
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      signal.removeEventListener('abort', cancel)
      active++
      resolve()
    }
    const cancel = () => {
      waiting.splice(waiting.indexOf(start), 1)
      reject(signal.reason)
    }
    waiting.push(start)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

export function releaseImageRead() { active--; waiting.shift()?.() }

export async function imagePreview(url: string, publicMedia: typeof fetchPublicMedia, clientSignal: AbortSignal) {
  const deadline = Date.now() + 65000
  const lifecycle = createProxyLifecycle(clientSignal, 65000)
  let acquired = false
  try {
    await acquireImageRead(lifecycle.signal)
    acquired = true
    lifecycle.signal.throwIfAborted()
    const original = await publicMedia(url, 'image', 32 * 1024 * 1024, lifecycle.signal)
    const bytes = Buffer.from(await original.arrayBuffer())
    lifecycle.signal.throwIfAborted()
    const image = sharp(bytes, { pages: 1, limitInputPixels: 100_000_000, failOn: 'warning' })
    try {
      // Hold the slot until native decoding finishes, even if the caller disconnects.
      const preview = await image.rotate().resize(960, 960, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 }).timeout({ seconds: Math.max(1, Math.min(20, Math.ceil((deadline - Date.now()) / 1000))) }).toBuffer()
      lifecycle.signal.throwIfAborted()
      return new Response(new Uint8Array(preview), { headers: { 'Content-Type': 'image/webp', 'Content-Length': String(preview.length) } })
    } catch {
      throw httpError(502, '图片预览暂时无法读取，请重试或下载原图。')
    } finally { image.destroy() }
  } catch (error) {
    if (lifecycle.signal.aborted) throw httpError(504, '图片预览读取超时，请重试。')
    throw error
  } finally {
    lifecycle.dispose()
    if (acquired) releaseImageRead()
  }
}
