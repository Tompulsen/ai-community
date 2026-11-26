export const imageDownloadFormats = ['jpeg', 'png', 'webp', 'gif'] as const
export type ImageDownloadFormat = typeof imageDownloadFormats[number]
export type ImageDownloadChoice = ImageDownloadFormat | 'original'
export function isImageDownloadFormat(value: unknown): value is ImageDownloadFormat {
  return imageDownloadFormats.some(format => format === value)
}
