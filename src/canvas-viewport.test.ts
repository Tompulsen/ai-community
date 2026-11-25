import { describe, expect, it } from 'vitest'
import { canvasWorldPoint, fitCanvasNodes, zoomCanvasAt, type CanvasNode } from './canvas-viewport'

describe('infinite canvas viewport', () => {
  it('keeps the image point under the cursor fixed when zooming and at the limits', () => {
    const view = { x: -100, y: 60, k: .5 }, cursor = { x: 300, y: 200 }
    const point = canvasWorldPoint(view, cursor)
    for (const scale of [1.2, .001, 100]) {
      const next = zoomCanvasAt(view, cursor, scale)
      expect(canvasWorldPoint(next, cursor)).toEqual(point)
      expect(next.k).toBeGreaterThanOrEqual(.05)
      expect(next.k).toBeLessThanOrEqual(5)
    }
  })
  it('fits images on either side of the origin with space for node headings', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', label: '', src: '', x: -800, y: -300, width: 600, height: 400 },
      { id: 'b', label: '', src: '', x: 900, y: 600, width: 260, height: 200 },
    ]
    const view = fitCanvasNodes(nodes, 390, 400)
    for (const node of nodes) {
      expect(node.x * view.k + view.x).toBeGreaterThanOrEqual(20)
      expect(node.y * view.k + view.y).toBeGreaterThanOrEqual(44)
      expect((node.x + node.width) * view.k + view.x).toBeLessThanOrEqual(370)
      expect((node.y + node.height) * view.k + view.y).toBeLessThanOrEqual(380)
    }
    expect(fitCanvasNodes([], 390, 400)).toEqual({ x: 195, y: 200, k: 1 })
  })
})
