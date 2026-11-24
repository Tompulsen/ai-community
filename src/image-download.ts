import type { ImageDownloadFormat } from '../shared/image-download'

export function jpegMediaUrl(value: string): string {
  try {
    const url = new URL(value, location.href)
    if (url.origin !== location.origin || !/^\/(?:legacy-files|files)\/[^/]+$/.test(url.pathname)) return value
    url.searchParams.set('format', 'jpeg')
    return url.pathname + url.search + url.hash
  } catch { return value }
}

async function animated(blob: Blob): Promise<boolean> {
  if (blob.type === 'image/gif') return true
  const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer())
  const text = (bytes: Uint8Array) => String.fromCharCode(...bytes)
  if (blob.type === 'image/webp') return text(header.slice(12, 16)) === 'VP8X' && !!(header[20]! & 2)
  if (blob.type === 'image/avif') {
    if (header.length < 8) throw new Error('图片格式无效，请重新加载。')
    const size = new DataView(header.buffer).getUint32(0)
    return text(new Uint8Array(await blob.slice(0, Math.min(size, 4096)).arrayBuffer())).includes('avis')
  }
  if (blob.type === 'image/png') {
    let offset = 8
    for (let chunks = 0; offset + 8 <= blob.size && chunks < 1024; chunks++) {
      const chunk = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer())
      const type = text(chunk.slice(4))
      if (type === 'acTL') return true
      if (type === 'IDAT' || type === 'IEND') return false
      offset += new DataView(chunk.buffer).getUint32(0) + 12
    }
    if (offset + 8 <= blob.size) throw new Error('图片格式无法安全转换，请重新选择图片。')
  }
  return false
}

// Export a sharing copy; callers retain the original Blob in the local media library.
export async function jpegDownload(blob: Blob, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted()
  if (!/^image\/(png|webp|avif)$/.test(blob.type) || await animated(blob)) return blob
  return imageDownload(blob, 'jpeg', signal)
}

export async function imageDownload(blob: Blob, format: ImageDownloadFormat, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted()
  if (!blob.size || !/^image\/(jpeg|png|webp|gif|avif)$/.test(blob.type)) throw new Error('图片格式无效，请重新加载。')
  if (blob.size > 32 * 1024 ** 2) throw new Error('图片超过 32 MB，暂时无法转换下载。')
  const moving = await animated(blob)
  if (blob.type === `image/${format}` && !(format === 'png' && moving)) return blob
  if (format === 'gif' || format === 'webp' && moving) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1]!)
      reader.onerror = () => reject(new Error('图片读取失败，请重试。'))
      reader.readAsDataURL(blob)
    })
    signal?.throwIfAborted()
    const response = await fetch('/api/images/export', { method: 'POST', credentials: 'same-origin', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, data }) })
    if (!response.ok) {
      const error = await response.json().catch(() => undefined)
      throw new Error(error?.error?.message || '图片转换失败，请稍后重试。')
    }
    const result = await response.blob()
    signal?.throwIfAborted()
    if (!result.size || result.type !== `image/${format}`) throw new Error('图片转换格式不正确，请重试。')
    return result
  }
  const bitmap = await createImageBitmap(blob)
  try {
    signal?.throwIfAborted()
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图片转换失败，请重试。')
    if (format === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height) }
    context.drawImage(bitmap, 0, 0)
    const result = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, `image/${format}`, .95))
    signal?.throwIfAborted()
    if (!result?.size || result.type !== `image/${format}`) throw new Error('浏览器不支持此格式，请尝试其他格式。')
    return result
  } finally { bitmap.close() }
}
export function imageDownloadUrl(value: string, format: ImageDownloadFormat): string {
  try {
    const url = new URL(value, location.href)
    if (url.origin !== location.origin || !/^\/(?:legacy-files|files)\/[^/]+$/.test(url.pathname)) return value
    url.searchParams.delete('format'); url.searchParams.set('download', format)
    url.searchParams.set('variant', 'original')
    return url.pathname + url.search + url.hash
  } catch { return value }
}
