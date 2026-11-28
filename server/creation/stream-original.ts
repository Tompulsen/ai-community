import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import { httpError } from '../auth.ts'
import type { RequestContext } from '../types.ts'
import { createProxyLifecycle } from './proxy-lifecycle.ts'
import type { fetchPublicMedia } from './public-media.ts'

const maxBytes = 32 * 1024 * 1024
const incomplete = () => httpError(502, '原图传输中断，请重试保存图片。', 'ORIGINAL_IMAGE_READ_FAILED')
const oversized = () => httpError(413, '原图为空或超过 32 MB，请手动下载保存。')

export async function streamOriginal(ctx: RequestContext, url: string, publicMedia: typeof fetchPublicMedia, signal: AbortSignal) {
  const output = AbortSignal.any([signal, AbortSignal.timeout(300000)])
  const closed = new AbortController()
  const transfer = AbortSignal.any([output, closed.signal])
  const lifecycle = createProxyLifecycle(transfer, 60000)
  const response = ctx.res
  const onClose = () => closed.abort()
  const onAbort = () => response.destroy()
  response.once('close', onClose)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let completed: Promise<void> | undefined
  try {
    const original = await publicMedia(url, 'image', maxBytes, lifecycle.signal, undefined, 'stream-original')
    reader = lifecycle.stream(original.body)?.getReader()
    const encoding = original.headers.get('content-encoding')?.toLowerCase()
    const lengthHeader = !encoding || encoding === 'identity' ? original.headers.get('content-length') : null
    const length = lengthHeader === null ? undefined : Number(lengthHeader)
    if (length !== undefined) {
      if (!/^\d+$/.test(lengthHeader!) || !Number.isSafeInteger(length)) throw incomplete()
      if (!length || length > maxBytes) throw oversized()
    }
    if (!reader) throw oversized()
    let received = 0
    let lastByte: Uint8Array | undefined
    for (;;) {
      const { done, value } = await reader.read().catch(() => { throw incomplete() })
      transfer.throwIfAborted()
      if (done) break
      if (!value.byteLength) continue
      received += value.byteLength
      if (received > maxBytes) throw oversized()
      if (length !== undefined && received > length) throw incomplete()
      let chunk = value
      // With Content-Length, a browser would accept the last byte even if the upstream subsequently reset.
      if (received === length) {
        lastByte = Uint8Array.of(value[value.byteLength - 1]!)
        chunk = value.subarray(0, -1)
      }
      if (!completed) {
        ctx.reply.hijack()
        completed = finished(response, { cleanup: true }).catch(() => {})
        output.addEventListener('abort', onAbort, { once: true })
        for (const [name, value] of Object.entries(ctx.reply.getHeaders())) {
          if (value !== undefined) response.setHeader(name, value)
        }
        if (length !== undefined) response.setHeader('Content-Length', length)
        response.writeHead(200, {
          'Content-Type': original.headers.get('content-type') || 'application/octet-stream',
          'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no',
        })
      }
      if (chunk.byteLength && !response.write(chunk)) await once(response, 'drain', { signal: transfer })
    }
    if (!received) throw oversized()
    if (length !== undefined && length !== received) throw incomplete()
    response.end(lastByte)
  } catch (error) {
    if (!completed) throw error
    // Ending normally, or sending JSON after headers, would make a truncated image look successful.
    response.destroy()
  } finally {
    void reader?.cancel().catch(() => {})
    reader?.releaseLock()
    lifecycle.dispose()
    await completed
    output.removeEventListener('abort', onAbort)
    response.removeListener('close', onClose)
  }
}
