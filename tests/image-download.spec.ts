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

for (const format of ['jpeg', 'png', 'webp', 'gif'] as const) test(`local image converts to requested ${format} with matching bytes and transparency`, async ({ page }) => {
  const input = await sharp({ create: { width: 77, height: 39, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).webp().toBuffer()
  await page.route('**/__export', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Image export</title>' }))
  await page.route('**/api/images/export', async route => {
    const body = route.request().postDataJSON()
    expect(body.format).toBe('gif')
    return route.fulfill({ contentType: 'image/gif', body: await sharp(Buffer.from(body.data, 'base64')).gif().toBuffer() })
  })
  await page.goto('/__export')
  const result = await page.evaluate(async ({ bytes, format }) => {
    const path = '/src/image-download.ts', { imageDownload } = await import(path)
    const input = new Blob([new Uint8Array(bytes)], { type: 'image/webp' })
    const result = await imageDownload(input, format)
    return { type: result.type, bytes: Array.from(new Uint8Array(await result.arrayBuffer())) }
  }, { bytes: Array.from(input), format })
  expect(result.type).toBe(`image/${format}`)
  const bytes = Buffer.from(result.bytes)
  expect(await sharp(bytes).metadata()).toMatchObject({ format, width: 77, height: 39 })
  expect((await sharp(bytes).ensureAlpha().raw().toBuffer())[3]).toBe(format === 'jpeg' ? 255 : 0)
})

test('failed local GIF conversion never downloads an incorrectly labelled PNG', async ({ page }) => {
  const input = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).png().toBuffer()
  await page.route('**/__export', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Image export</title>' }))
  await page.route('**/api/images/export', route => route.fulfill({ contentType: 'image/png', body: input }))
  await page.goto('/__export')
  expect(await page.evaluate(async bytes => {
    const path = '/src/image-download.ts', { imageDownload } = await import(path)
    try { await imageDownload(new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'gif'); return '' }
    catch (error) { return (error as Error).message }
  }, Array.from(input))).toContain('格式不正确')
})

test('format selection closes without a download when cancelled, aborted or the account changes', async ({ page }) => {
  await page.route('**/__choice', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Format choice</title><button>Download</button>' }))
  await page.goto('/__choice')
  await page.evaluate(async () => {
    const path = '/src/image-download-choice.ts', { chooseImageDownloadFormat } = await import(path)
    ;(window as any).chooseFormat = chooseImageDownloadFormat
  })
  const dialog = page.getByRole('dialog', { name: '选择图片下载格式', exact: true })
  for (const mode of ['cancel', 'abort', 'account']) {
    await page.evaluate(() => {
      ;(window as any).formatAnswer = 'pending'
      ;(window as any).formatController = new AbortController()
      void (window as any).chooseFormat((window as any).formatController.signal).then((value: unknown) => { (window as any).formatAnswer = value || 'cancelled' })
    })
    await expect(dialog).toBeVisible()
    if (mode === 'cancel') await page.keyboard.press('Escape')
    else if (mode === 'abort') await page.evaluate(() => (window as any).formatController.abort())
    else await page.evaluate(async () => { const path = '/src/state.ts', { session } = await import(path); session.user = { id: 'new-account', accountId: '42' } })
    await expect(dialog).not.toBeVisible()
    expect(await page.evaluate(() => (window as any).formatAnswer)).toBe('cancelled')
  }
})
