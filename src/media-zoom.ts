export type MediaPoint = { x: number; y: number }
export type MediaSize = { width: number; height: number }
export const MIN_MEDIA_SCALE = .1, MAX_MEDIA_SCALE = 5
export function mediaScale(value: number) { return Math.min(MAX_MEDIA_SCALE, Math.max(MIN_MEDIA_SCALE, value)) }

export function clampMediaOffset(point: MediaPoint, scale: number, image: MediaSize, viewport: MediaSize): MediaPoint {
  const x = Math.max(0, (image.width * scale - viewport.width) / 2)
  const y = Math.max(0, (image.height * scale - viewport.height) / 2)
  return { x: Math.max(-x, Math.min(x, point.x)), y: Math.max(-y, Math.min(y, point.y)) }
}

// Keep the same image pixel under the cursor or moving midpoint of two fingers.
export function mediaZoomOffset(offset: MediaPoint, ratio: number, anchor: MediaPoint, destination = anchor): MediaPoint {
  return { x: destination.x - (anchor.x - offset.x) * ratio, y: destination.y - (anchor.y - offset.y) * ratio }
}
