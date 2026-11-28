import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const state = { generations: 0, originals: 0 }
  await page.route('**/api/creation/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    if (url.pathname === '/api/creation/media') {
      if (!url.searchParams.has('variant')) state.originals++
      return route.fulfill({ contentType: 'image/jpeg', body: image })
    }
    if (url.pathname === '/api/creation/generate') {
      state.generations++
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/slow-original.jpg' }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto('/create/image')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  return { state, image }
}
async function send(page: Page) {
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('完整保存并预览原图')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
}

async function openGalleryPreview(page: Page) {
  await page.getByRole('button', { name: '作品库', exact: true }).click()
  await page.getByRole('button', { name: '预览 完整保存并预览原图', exact: true }).click()
  return page.getByRole('dialog', { name: '原始媒体预览', exact: true })
}

async function slowTransfer(page: Page, image: Buffer, stalled = false) {
  await page.evaluate(({ data, stalled }) => {
    const bytes = Uint8Array.from(atob(data), value => value.charCodeAt(0))
    const originalFetch = window.fetch, timeout = window.setTimeout.bind(window), abortTimeout = AbortSignal.timeout.bind(AbortSignal)
    // Scale only network deadlines, retaining the relationship between progress and timeout.
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: any[]) => timeout(handler, ms && ms >= 30000 ? ms / 200 : ms, ...args)) as typeof setTimeout
    AbortSignal.timeout = ms => abortTimeout(ms >= 30000 ? ms / 200 : ms)
    ;(window as any).originalReads = 0
    ;(window as any).stallOriginal = stalled
    window.fetch = async (...args) => {
      const url = new URL(String(args[0]), location.href)
      if (url.pathname !== '/api/creation/media' || url.searchParams.has('variant')) return originalFetch(...args)
      ;(window as any).originalReads++
      const signal = args[1]?.signal
      let cursor = 0, timer: ReturnType<typeof setTimeout> | undefined, aborted = false
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener('abort', () => { aborted = true; clearTimeout(timer); controller.error(signal.reason) }, { once: true })
        },
        async pull(controller) {
          if (aborted || (window as any).stallOriginal) return new Promise<void>(() => {})
          await new Promise<void>(resolve => { timer = timeout(resolve, 80) })
          if (aborted) return
          const next = Math.min(bytes.length, cursor + Math.ceil(bytes.length / 7))
          controller.enqueue(bytes.slice(cursor, next)); cursor = next
          if (cursor === bytes.length) controller.close()
        },
        cancel() { aborted = true; clearTimeout(timer) },
      }, { highWaterMark: 0 })
      return new Response(body, { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length) } })
    }
  }, { data: image.toString('base64'), stalled })
}

test('an original making steady progress survives the old total timeout without repeating generation', async ({ page }) => {
  const { state, image } = await fixture(page)
  await slowTransfer(page, image)
  await send(page)
  await expect(page.locator('.browser-save')).toHaveText('图片已保存到此浏览器', { timeout: 6000 })
  expect(await page.evaluate(() => (window as any).originalReads)).toBe(1)
  expect(state.generations).toBe(1)
})

test('opening an image shows a preview and closing it leaves the shared original save running', async ({ page }) => {
  const { state, image } = await fixture(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/media?**', async route => {
    if (!new URL(route.request().url()).searchParams.has('variant')) { state.originals++; await gate }
    await route.fulfill({ contentType: 'image/jpeg', body: image })
  })
  try {
    await send(page)
    const save = page.getByLabel('模型生成结果', { exact: true }).locator('.browser-save')
    await expect(save).toContainText('（0/1）')
    const viewer = await openGalleryPreview(page)
    await expect(viewer).toBeVisible()
    await expect.poll(() => viewer.locator('img').evaluateAll(images => images.some(image => (image as HTMLImageElement).naturalWidth > 0)), { timeout: 1500 }).toBe(true)
    expect(state.originals).toBe(1)
    await page.keyboard.press('Escape')
    await expect(viewer).not.toBeVisible()
    await page.getByRole('button', { name: '关闭作品库', exact: true }).click()
    release()
    await expect(save).toHaveText('图片已保存到此浏览器')
    expect(state.originals).toBe(1)
    expect(state.generations).toBe(1)
  } finally { release() }
})

test('stalled originals stop loading and can be retried while the preview stays visible', async ({ page }) => {
  const { state, image } = await fixture(page)
  let nativeOriginals = 0
  page.on('request', request => {
    const url = new URL(request.url())
    if (request.resourceType() === 'image' && url.pathname === '/api/creation/media' && !url.searchParams.has('variant')) nativeOriginals++
  })
  await slowTransfer(page, image, true)
  await send(page)
  const viewer = await openGalleryPreview(page)
  await expect(viewer.getByRole('button', { name: '重新加载', exact: true })).toBeVisible({ timeout: 6000 })
  await expect(viewer.locator('.lightbox-loading')).toHaveCount(0)
  expect(nativeOriginals).toBe(0)
  await expect.poll(() => viewer.locator('img').evaluateAll(images => images.some(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await mkdir('.taste-skill/original-transfer', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const bounds = await viewer.locator('.lightbox-original-status').boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await expect(viewer.getByRole('button', { name: '重新加载', exact: true })).toBeInViewport()
    await page.screenshot({ path: `.taste-skill/original-transfer/fallback-${width}.png` })
  }
  expect((await new AxeBuilder({ page }).include('.media-lightbox[open]').analyze()).violations).toEqual([])
  await page.evaluate(() => { (window as any).stallOriginal = false })
  await viewer.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect(viewer.locator('.lightbox-original-status')).toHaveCount(0)
  await expect(viewer.locator('img')).toHaveAttribute('src', /^blob:/)
  await expect(viewer.getByRole('button', { name: '放大', exact: true })).toBeEnabled()
  await expect(viewer.getByRole('button', { name: '重新加载', exact: true })).toHaveCount(0)
  expect(state.generations).toBe(1)
})
