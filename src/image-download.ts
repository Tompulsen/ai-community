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
  const bitmap = await createImageBitmap(blob)
  try {
    signal?.throwIfAborted()
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('JPG 图片转换失败，请重试。')
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0)
    const result = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .95))
    signal?.throwIfAborted()
    if (!result || result.type !== 'image/jpeg') throw new Error('JPG 图片转换失败，请重试。')
    return result
  } finally { bitmap.close() }
}
