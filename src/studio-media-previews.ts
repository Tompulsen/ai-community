// Thumbnail dimensions and encoding adapted from Octopus Chat's MIT gallery store.
import type { CreationTask } from './native-studio'
import { taskAssetUrl } from './studio-task-store'

export function mediaPreviewIdentity(task: CreationTask) {
  const source = task.urls[0] || ''
  return JSON.stringify([task.kind, source.startsWith('data:image/') ? taskAssetUrl(task.id, 0) : source])
}
export async function imageThumbnail(blob: Blob, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted()
  if (!blob.size || !blob.type.startsWith('image/')) throw new Error('图片缩略图无法读取。')
  const source = URL.createObjectURL(blob), image = new Image()
  try {
    image.src = source; await image.decode(); signal.throwIfAborted()
    const scale = Math.min(1, 384 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图片缩略图暂时无法生成。')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const result = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .8))
    canvas.width = canvas.height = 0
    signal.throwIfAborted()
    if (!result) throw new Error('图片缩略图暂时无法生成。')
    return result
  } finally { URL.revokeObjectURL(source) }
}
