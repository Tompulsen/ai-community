import { expect, test } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import sharp from 'sharp'

const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex')

for (const format of ['png', 'jpeg', 'webp'] as const) test(`reference preparation preserves original ${format} bytes and dimensions`, async ({ page }) => {
  const input = await sharp(randomBytes(900 * 700 * 3), { raw: { width: 900, height: 700, channels: 3 } }).toFormat(format).toBuffer()
  await page.route('**/__lossless', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Image quality</title>' }))
  await page.route('**/__source.png', route => route.fulfill({ contentType: `image/${format}`, body: input }))
  await page.goto('/__lossless')
  const result = await page.evaluate(async () => {
    const path = '/src/studio-image-upload.ts', { prepareStudioImage } = await import(path)
    const blob = await (await fetch('/__source.png')).blob()
    const data = await prepareStudioImage(new File([blob], 'reference.png', { type: blob.type }), true)
    const bytes = await (await fetch(data)).arrayBuffer()
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('')
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const result = { hash, width: bitmap.width, height: bitmap.height }; bitmap.close(); return result
  })
  expect(result).toEqual({ hash: sha(input), width: 900, height: 700 })
})

test('original download returns the same encoded file without a conversion request', async ({ page }) => {
  const input = await sharp({ create: { width: 321, height: 217, channels: 4, background: '#1234ab80' } }).png().toBuffer()
  await page.route('**/__lossless', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Original image</title>' }))
  await page.route('**/__source.png', route => route.fulfill({ contentType: 'image/png', body: input }))
  let exports = 0
  await page.route('**/api/images/export', route => { exports++; return route.fulfill({ status: 500 }) })
  await page.goto('/__lossless')
  const result = await page.evaluate(async () => {
    const path = '/src/image-download.ts', { imageDownload } = await import(path)
    const original = await (await fetch('/__source.png')).blob()
    const output = await imageDownload(original, 'original')
    return { sameBlob: original === output, type: output.type }
  })
  expect(result).toEqual({ sameBlob: true, type: 'image/png' })
  expect(exports).toBe(0)
})

for (const format of ['gif', 'avif', 'webp'] as const) test(`${format} reference converts to a full-sized PNG first frame`, async ({ page }) => {
  const pixels = Buffer.concat([Buffer.alloc(91 * 61 * 3), Buffer.alloc(91 * 61 * 3, 255)])
  const animated = format !== 'avif'
  const input = await sharp(animated ? pixels : pixels.subarray(0, 91 * 61 * 3), {
    raw: { width: 91, height: animated ? 122 : 61, channels: 3, ...(animated ? { pageHeight: 61 } : {}) },
  }).toFormat(format).toBuffer()
  const expected = await sharp(input).png().toBuffer()
  await page.route('**/__lossless', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Reference</title>' }))
  await page.route('**/__source', route => route.fulfill({ contentType: `image/${format}`, body: input }))
  let conversions = 0
  await page.route('**/api/images/export', async route => {
    conversions++
    const body = route.request().postDataJSON()
    expect(body.format).toBe('png'); expect(Buffer.from(body.data, 'base64')).toEqual(input)
    return route.fulfill({ contentType: 'image/png', body: expected })
  })
  await page.goto('/__lossless')
  const output = await page.evaluate(async () => {
    const path = '/src/studio-image-upload.ts', { prepareStudioImage } = await import(path)
    const blob = await (await fetch('/__source')).blob()
    return prepareStudioImage(new File([blob], 'reference', { type: blob.type }), true)
  })
  expect(output).toBe(`data:image/png;base64,${expected.toString('base64')}`)
  expect(await sharp(expected).metadata()).toMatchObject({ width: 91, height: 61 })
  expect(conversions).toBe(1)
})

test('corrupt images and files above the original-size limit are rejected before generation', async ({ page }) => {
  await page.route('**/__lossless', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Validation</title>' }))
  let requests = 0
  await page.route('**/api/**', route => { requests++; return route.fulfill({ status: 500 }) })
  await page.goto('/__lossless')
  const messages = await page.evaluate(async () => {
    const path = '/src/studio-image-upload.ts', { prepareStudioImage } = await import(path)
    const files = ['png', 'jpeg', 'webp'].map(format => new File(['broken image'], 'invalid', { type: `image/${format}` }))
    files.push(new File([new Uint8Array(20 * 1024 ** 2 + 1)], 'large.png', { type: 'image/png' }))
    return Promise.all(files.map(async file => {
      try { await prepareStudioImage(file, true); return 'unexpected success' }
      catch (error) { return (error as Error).message }
    }))
  })
  expect(messages.slice(0, 3)).toEqual(Array(3).fill('图片无法读取，请选择完整有效的图片。'))
  expect(messages[3]).toContain('20 MB')
  expect(requests).toBe(0)
})
