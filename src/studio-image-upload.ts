// Adapted from octopus_chat/app/utils/chat.ts (MIT).
import { imageDownload, isAnimatedImage } from './image-download'

let heicConverter: Promise<typeof import('heic2any').default> | undefined

export async function prepareStudioImage(file: File, referencesOnly = false) {
  const limit = (referencesOnly ? 20 : 10) * 1024 * 1024
  if (!file.size || file.size > limit)
    throw new Error(`请选择非空图片，大小不超过 ${referencesOnly ? 20 : 10} MB。`)
  if (!/^image\/(?:png|jpeg|webp|gif|avif|heic|heif)$/.test(file.type))
    throw new Error('请选择 PNG、JPEG、WebP、GIF、AVIF 或 HEIC 图片。')
  let source: Blob = file
  if (/image\/hei[cf]/.test(file.type)) {
    const heic2any = await (heicConverter ??= import('heic2any').then(module => module.default).catch(error => {
      heicConverter = undefined
      throw error
    }))
    const converted = await heic2any({ blob: file, toType: 'image/png' })
    const image = Array.isArray(converted) ? converted[0] : converted
    if (!image || image.type !== 'image/png') throw new Error('HEIC 图片转换失败，请改用 PNG 或 JPEG。')
    source = image
  } else if (/^image\/(gif|avif)$/.test(file.type) || await isAnimatedImage(file)) {
    // Model reference protocols accept PNG/JPEG/WebP; animated references use the first frame.
    source = await imageDownload(file, 'png')
  }
  if (source.size > limit) throw new Error(`图片转换后超过 ${referencesOnly ? 20 : 10} MB，请选择较小的图片。`)
  const objectUrl = URL.createObjectURL(source)
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image()
      image.onload = () => image.naturalWidth && image.naturalHeight ? resolve() : reject()
      image.onerror = () => reject()
      image.src = objectUrl
    })
  } catch { throw new Error('图片无法读取，请选择完整有效的图片。') }
  finally { URL.revokeObjectURL(objectUrl) }
  // The final request-size check includes every reference and stops before paid submission.
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败。'))
    reader.onerror = () => reject(reader.error || new Error('图片读取失败。'))
    reader.onabort = () => reject(new DOMException('图片读取已取消。', 'AbortError'))
    reader.readAsDataURL(source)
  })
}
