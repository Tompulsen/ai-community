// Adapted from octopus_chat/app/utils/chat.ts (MIT).
let heicConverter: Promise<typeof import('heic2any').default> | undefined

export async function compressImage(file: Blob, maxSize = 512 * 1024): Promise<string> {
  function readDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败。'))
      reader.onerror = () => reject(reader.error || new Error('图片读取失败。'))
      reader.onabort = () => reject(new DOMException('图片读取已取消。', 'AbortError'))
      reader.readAsDataURL(blob)
    })
  }
  const dataUrlLength = (blob: Blob) => Math.ceil(blob.size / 3) * 4 + `data:${blob.type || 'application/octet-stream'};base64,`.length
  function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片转换失败，请更换图片后重试。')), type, quality)
    })
  }
  let source = file
  if (/image\/hei[cf]/i.test(file.type)) {
    const heic2any = await (heicConverter ??= import('heic2any').then(module => module.default).catch(error => {
      heicConverter = undefined
      throw error
    }))
    const converted = await heic2any({ blob: file, toType: 'image/jpeg' })
    const image = Array.isArray(converted) ? converted[0] : converted
    if (!image) throw new Error('HEIC 图片转换失败，请重试或改用 JPEG。')
    source = image
  }
  const originalSizeKB = dataUrlLength(source) / 1024
  if (originalSizeKB < 200 && /^image\/(?:png|jpeg|webp)$/.test(source.type)) return readDataUrl(source)
  const image = new Image(), objectUrl = URL.createObjectURL(source)
  let canvas: HTMLCanvasElement | undefined, bitmap: ImageBitmap | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('图片无法解码，请更换图片或重试。'))
      image.onabort = () => reject(new DOMException('图片读取已取消。', 'AbortError'))
      image.src = objectUrl
    })
    if (typeof image.decode === 'function') await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效。')
    canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法处理图片，请更换浏览器或重试。')
    const isPng = source.type === 'image/png' || source.type === 'image/gif'
    let quality = originalSizeKB < 512 ? .9 : originalSizeKB < 1024 ? .85 : originalSizeKB < 2048 ? .75 : .65
    const maxDimension = originalSizeKB < 1024 ? 2048 : originalSizeKB < 2048 ? 1536 : 1280
    const scale = Math.min(Math.sqrt(maxSize / (originalSizeKB * 768)), maxDimension / image.naturalWidth, maxDimension / image.naturalHeight, 1)
    let width = Math.max(1, Math.floor(image.naturalWidth * scale)), height = Math.max(1, Math.floor(image.naturalHeight * scale))
    if (typeof createImageBitmap === 'function') {
      try { bitmap = await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' }) }
      catch { /* Browsers without bitmap resizing use the decoded image. */ }
    }
    let outputFormat = isPng ? 'image/png' : 'image/webp', encoded: Blob | undefined
    for (let attempt = 0; attempt < 15; attempt++) {
      canvas.width = width; canvas.height = height
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap ?? image, 0, 0, width, height)
      encoded = await encode(canvas, outputFormat, quality)
      if (!isPng && outputFormat === 'image/webp' && encoded.type !== outputFormat) {
        outputFormat = 'image/jpeg'; encoded = await encode(canvas, outputFormat, quality)
      }
      if (dataUrlLength(encoded) <= maxSize) break
      if (!isPng && quality > .5) quality -= .1
      else { width = Math.max(1, Math.floor(width * .85)); height = Math.max(1, Math.floor(height * .85)) }
    }
    if (!encoded || dataUrlLength(encoded) > maxSize) throw new Error('图片压缩后仍然过大，请缩小图片后重试。')
    return await readDataUrl(encoded)
  } finally {
    image.onload = null; image.onerror = null; image.onabort = null; image.src = ''
    URL.revokeObjectURL(objectUrl); bitmap?.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}

export async function prepareStudioImage(file: File, referencesOnly = false) {
  if (!file.size || file.size > (referencesOnly ? 20 : 10) * 1024 * 1024)
    throw new Error(`请选择非空图片，大小不超过 ${referencesOnly ? 20 : 10} MB。`)
  if (referencesOnly && !/^image\/(?:png|jpeg|webp|gif|avif|heic|heif)$/.test(file.type))
    throw new Error('请选择 PNG、JPEG、WebP、GIF、AVIF 或 HEIC 图片。')
  return compressImage(file)
}
