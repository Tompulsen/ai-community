// Thumbnail dimensions and encoding adapted from Octopus Chat's MIT gallery store.
import type { CreationTask } from './native-studio'
import { taskAssetUrl } from './studio-task-store'

export function mediaPreviewIdentity(task: CreationTask, index = 0) {
  const source = task.urls[index] || ''
  return JSON.stringify([task.kind, source.startsWith('data:image/') ? taskAssetUrl(task.id, index) : source])
}
let activeThumbnails = 0
const thumbnailQueue: (() => void)[] = []
function thumbnailSlot(signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = () => { const index = thumbnailQueue.indexOf(start); if (index >= 0) thumbnailQueue.splice(index, 1); reject(signal.reason) }
    const start = () => {
      signal.removeEventListener('abort', aborted); activeThumbnails++
      resolve(() => { activeThumbnails--; thumbnailQueue.shift()?.() })
    }
    if (activeThumbnails < 2) start()
    else { thumbnailQueue.push(start); signal.addEventListener('abort', aborted, { once: true }) }
  })
}
async function preserveAnimation(blob: Blob) {
  if (blob.type === 'image/jpeg') return false
  if (blob.type !== 'image/png') return true
  const header = new Uint8Array(await blob.slice(0, 65536).arrayBuffer()), view = new DataView(header.buffer)
  for (let offset = 8; offset + 8 <= header.length;) {
    const type = String.fromCharCode(...header.subarray(offset + 4, offset + 8))
    if (type === 'acTL') return true
    if (type === 'IDAT') return false
    offset += view.getUint32(offset) + 12
  }
  return true
}
export async function imageThumbnail(input: Blob | (() => Promise<Blob>), signal: AbortSignal, edge = 384): Promise<Blob> {
  const release = await thumbnailSlot(signal)
  let source = '', image: HTMLImageElement | undefined, canvas: HTMLCanvasElement | undefined, abort: (() => void) | undefined
  try {
    signal.throwIfAborted()
    // Defer reading gallery originals until a decoder is available.
    const blob = typeof input === 'function' ? await input() : input
    signal.throwIfAborted()
    if (!blob.size || !blob.type.startsWith('image/')) throw new Error('图片缩略图无法读取。')
    if (edge > 384 && await preserveAnimation(blob)) { signal.throwIfAborted(); return blob }
    signal.throwIfAborted()
    image = new Image(); source = URL.createObjectURL(blob)
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => { image?.removeAttribute('src'); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
    })
    image.src = source
    await Promise.race([image.decode(), cancelled]); signal.throwIfAborted()
    const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight))
    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图片缩略图暂时无法生成。')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const result = await Promise.race([new Promise<Blob | null>(resolve => canvas!.toBlob(resolve, 'image/webp', .8)), cancelled])
    signal.throwIfAborted()
    if (!result) throw new Error('图片缩略图暂时无法生成。')
    return result
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
    image?.removeAttribute('src')
    if (canvas) canvas.width = canvas.height = 0
    if (source) URL.revokeObjectURL(source)
    release()
  }
}
