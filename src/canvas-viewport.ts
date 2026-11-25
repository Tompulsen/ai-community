// Viewport math adapted from basketikun/infinite-canvas (MIT, 2026).
export type CanvasPosition = { x: number; y: number }
export type CanvasViewport = CanvasPosition & { k: number }
export type CanvasNode = CanvasPosition & { id: string; label: string; src: string; width: number; height: number }
export const CANVAS_MIN_ZOOM = .05
export const CANVAS_MAX_ZOOM = 5

export function canvasWorldPoint(view: CanvasViewport, point: CanvasPosition): CanvasPosition {
  return { x: (point.x - view.x) / view.k, y: (point.y - view.y) / view.k }
}
export function zoomCanvasAt(view: CanvasViewport, point: CanvasPosition, scale: number): CanvasViewport {
  const k = Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, scale))
  const world = canvasWorldPoint(view, point)
  return { x: point.x - world.x * k, y: point.y - world.y * k, k }
}
export function fitCanvasNodes(nodes: CanvasNode[], width: number, height: number): CanvasViewport {
  if (!nodes.length) return { x: width / 2, y: height / 2, k: 1 }
  const left = Math.min(...nodes.map(node => node.x)), top = Math.min(...nodes.map(node => node.y))
  const right = Math.max(...nodes.map(node => node.x + node.width)), bottom = Math.max(...nodes.map(node => node.y + node.height))
  const k = Math.max(CANVAS_MIN_ZOOM, Math.min(1, (width - 48) / Math.max(1, right - left), (height - 104) / Math.max(1, bottom - top)))
  return { x: width / 2 - (left + right) / 2 * k, y: (height + 32) / 2 - (top + bottom) / 2 * k, k }
}
