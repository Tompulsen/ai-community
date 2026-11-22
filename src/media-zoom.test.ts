import { describe, expect, it } from 'vitest'
import { clampMediaOffset, mediaScale, mediaZoomOffset } from './media-zoom'

describe('media zoom geometry', () => {
  it('keeps an off-center image pixel fixed and follows a moving pinch midpoint', () => {
    expect(mediaZoomOffset({ x: 20, y: -10 }, 2, { x: 50, y: 30 })).toEqual({ x: -10, y: -50 })
    expect(mediaZoomOffset({ x: 20, y: -10 }, 2, { x: 50, y: 30 }, { x: 80, y: 40 })).toEqual({ x: 20, y: -40 })
    expect(mediaZoomOffset({ x: 20, y: -10 }, 1, { x: 50, y: 30 }, { x: 80, y: 40 })).toEqual({ x: 50, y: 0 })
  })
  it('limits each axis by actual scaled image size and recenters an image smaller than the viewport', () => {
    expect(clampMediaOffset({ x: 9999, y: -9999 }, 2, { width: 300, height: 200 }, { width: 360, height: 600 })).toEqual({ x: 120, y: -0 })
    expect(clampMediaOffset({ x: -9999, y: 9999 }, 3, { width: 200, height: 400 }, { width: 360, height: 600 })).toEqual({ x: -120, y: 300 })
    expect(clampMediaOffset({ x: 20, y: 10 }, .5, { width: 300, height: 200 }, { width: 360, height: 600 })).toEqual({ x: 0, y: 0 })
  })
  it('keeps zoom within 10–500% and can reverse a proportional zoom', () => {
    expect(mediaScale(.01)).toBe(.1); expect(mediaScale(100)).toBe(5)
    const original = { x: 20, y: 30 }, anchor = { x: -80, y: 15 }
    const zoomed = mediaZoomOffset(original, 1.2, anchor)
    expect(mediaZoomOffset(zoomed, 1 / 1.2, anchor)).toEqual(original)
  })
})
