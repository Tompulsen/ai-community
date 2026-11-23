import { expect, test } from '@playwright/test'
import sharp from 'sharp'

for (const format of ['png', 'webp', 'avif'] as const) test(`${format} photo exports as a full-sized white JPEG`, async ({ page }) => {
  const bytes = await sharp({ create: { width: 213, height: 87, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).toFormat(format).toBuffer()
  await page.route('**/__jpeg', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>JPEG export</title>' }))
  await page.goto('/__jpeg')
  const result = await page.evaluate(async ({ bytes, format }) => {
    const path = '/src/image-download.ts', { jpegDownload } = await import(path)
    const original = new Blob([new Uint8Array(bytes)], { type: `image/${format}` })
    const exported = await jpegDownload(original)
    const controller = new AbortController(); controller.abort()
    let cancelled = false
    try { await jpegDownload(original, controller.signal) } catch (error) { cancelled = (error as DOMException).name === 'AbortError' }
    return { type: exported.type, bytes: Array.from(new Uint8Array(await exported.arrayBuffer())), original: Array.from(new Uint8Array(await original.arrayBuffer())), cancelled }
  }, { bytes: Array.from(bytes), format })
  expect(result.type).toBe('image/jpeg'); expect(result.cancelled).toBe(true); expect(Buffer.from(result.original)).toEqual(bytes)
  const exported = Buffer.from(result.bytes), metadata = await sharp(exported).metadata()
  expect(metadata).toMatchObject({ format: 'jpeg', width: 213, height: 87 })
  expect((await sharp(exported).raw().toBuffer()).every(value => value >= 254)).toBe(true)
})

test('animated WebP downloads preserve all frames', async ({ page }) => {
  const pixels = Buffer.concat([Buffer.alloc(16 * 16 * 3), Buffer.alloc(16 * 16 * 3, 255)])
  const original = await sharp(pixels, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } }).webp({ delay: [100, 200], loop: 0 }).toBuffer()
  await page.route('**/__jpeg', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Animation</title>' }))
  await page.goto('/__jpeg')
  expect(await page.evaluate(async bytes => {
    const path = '/src/image-download.ts', { jpegDownload } = await import(path)
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/webp' })
    return await jpegDownload(blob) === blob
  }, Array.from(original))).toBe(true)
})
