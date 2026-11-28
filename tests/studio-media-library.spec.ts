import { expect, test, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function openLibrary(page: Page) {
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  if (await page.getByRole('button', { name: '创作台菜单', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  }
  await page.getByRole('button', { name: '作品库', exact: true }).click()
}

async function fixture(page: Page, count = 125, videoOnly = false, failImageOnce = false) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#287acc' } }).jpeg().toBuffer()
  const poster = await sharp(image).resize(480).webp().toBuffer()
  const video = await readFile('tests/fixtures/poster-black-intro.mp4')
  const mediaReads: string[] = [], generationCalls: unknown[] = []
  await page.route('**/api/creation/**', route => {
    const url = new URL(route.request().url()), path = url.pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'flux', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] },
    ] } })
    if (path === '/api/creation/media') {
      mediaReads.push(url.searchParams.get('url') || '')
      if (failImageOnce && mediaReads.length === 1) return route.fulfill({ status: 503, json: { message: '模拟缩略图读取失败。' } })
      if (url.searchParams.get('variant') === 'poster') return route.fulfill({ contentType: 'image/webp', body: poster, headers: { 'x-video-duration': '2.5' } })
      return route.fulfill({ contentType: url.searchParams.get('kind') === 'video' ? 'video/mp4' : 'image/jpeg', body: url.searchParams.get('kind') === 'video' ? video : image })
    }
    if (path === '/api/creation/generate') { generationCalls.push(route.request().postDataJSON()); return route.fulfill({ status: 405, json: { message: '本测试不提交生成。' } }) }
    if (path === '/api/creation/skills/catalog') return route.fulfill({ json: { items: [] } })
    if (path === '/api/creation/mcp/status') return route.fulfill({ json: { enabled: false, items: [] } })
    return route.fulfill({ json: {} })
  })
  await page.addInitScript(({ count, videoOnly }) => {
    if (sessionStorage.getItem('media-library-fixture')) return
    sessionStorage.setItem('media-library-fixture', '1')
    const now = Date.now(), tasks = Array.from({ length: count }, (_, index) => ({
      id: `library-${String(index).padStart(3, '0')}`, owner: '17', kind: videoOnly ? 'video' : 'image',
      model: videoOnly ? 'sora-2' : index % 2 ? 'flux' : 'gpt-image-2', prompt: `作品 ${String(index).padStart(3, '0')}`,
      createdAt: index < 90 ? now - Math.floor(index / 3) * 60000 : now - 45 * 86400000 - index,
      settledAt: now, phase: 'complete', protocol: 'sync', references: [], text: '',
      urls: [`https://media.example/${index}.${videoOnly ? 'mp4' : 'jpg'}`],
      request: { size: '1280x720', aspect_ratio: '16:9', n: 1, duration: 8 },
    }))
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify(tasks))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'library-text', mediaConversationsMigrated: true,
      sessions: [{ id: 'library-text', creationKind: 'text', topic: '图库测试', model: 'gpt-5', lastUpdate: now, settings: {}, skillIds: [], messages: [] }],
    } }))
  }, { count, videoOnly })
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  await openLibrary(page)
  const library = page.getByRole('dialog', { name: '作品库', exact: true })
  await expect(library.locator('.gallery-item')).toHaveCount(Math.min(60, count))
  return { library, mediaReads, generationCalls }
}
async function previewMetadata(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('community-studio-media'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const values = await new Promise<any[]>(resolve => {
      const request = db.transaction('previews').objectStore('previews').getAll()
      request.onsuccess = () => resolve(request.result)
    })
    db.close()
    return values.map(value => ({ owner: value.owner, id: value.id, type: value.blob.type, size: value.blob.size, duration: value.duration }))
  })
}

test('gallery reads cursor pages without duplicate timestamps and combines model, date and search filters', async ({ page }) => {
  const { library, mediaReads, generationCalls } = await fixture(page)
  await expect(library.locator('.batch-toolbar')).toContainText('125 条')
  expect(mediaReads.length).toBeLessThan(30)
  await library.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(120)
  await library.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(library.locator('.gallery-item')).toHaveCount(125)
  const prompts = await library.locator('.task-prompt').allTextContents()
  expect(new Set(prompts).size).toBe(125)
  await expect(library.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0)
  await library.getByRole('combobox', { name: '按模型筛选', exact: true }).selectOption('gpt-image-2')
  await expect(library.locator('.batch-toolbar')).toContainText('63 条')
  await library.getByRole('combobox', { name: '按时间筛选', exact: true }).selectOption('week')
  await expect(library.locator('.gallery-item')).toHaveCount(45)
  await library.getByRole('searchbox', { name: '搜索生成记录', exact: true }).fill('作品 01')
  await expect(library.locator('.gallery-item')).toHaveCount(5)
  await library.getByRole('button', { name: '批量操作', exact: true }).click()
  await library.getByRole('checkbox', { name: '选择 作品 018', exact: true }).check()
  await library.getByRole('searchbox', { name: '搜索生成记录', exact: true }).fill('不存在的作品')
  await expect(library.locator('.gallery-item')).toHaveCount(0)
  await expect(library.locator('.gallery-item.selected')).toHaveCount(0)
  expect(generationCalls).toHaveLength(0)
})

test('visible images cache originals and 384px thumbnails for offline reload and activation', async ({ page }) => {
  const { library, mediaReads, generationCalls } = await fixture(page, 1)
  const cover = library.getByRole('button', { name: '预览 作品 000', exact: true })
  await expect(cover.locator('img')).toBeVisible()
  expect(await cover.locator('img').evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))).toEqual({ width: 384, height: 216 })
  await expect.poll(() => previewMetadata(page)).toEqual([expect.objectContaining({ owner: '17', id: 'library-000', type: 'image/webp' })])
  if (!await library.locator('video').count() && await library.locator('.browser-save').count()) await expect(library.locator('.browser-save').first()).toHaveText('图片已保存到此浏览器')
  mediaReads.length = 0
  await page.reload()
  await openLibrary(page)
  const reopened = page.getByRole('dialog', { name: '作品库', exact: true })
  await expect(reopened.getByRole('button', { name: '预览 作品 000', exact: true }).locator('img')).toBeVisible()
  expect(mediaReads).toHaveLength(0)
  await reopened.getByRole('button', { name: '预览 作品 000', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '原始媒体预览', exact: true })
  await expect.poll(() => preview.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1280)
  expect(mediaReads).toHaveLength(0)
  await page.getByRole('button', { name: '关闭媒体预览', exact: true }).click()
  await expect(reopened).toBeVisible()
  await mkdir('.taste-skill/media-library-20261115', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    if (!await reopened.isVisible()) await openLibrary(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(reopened.getByRole('combobox', { name: '按模型筛选', exact: true })).toBeVisible()
    await page.screenshot({ path: `.taste-skill/media-library-20261115/gallery-${width}.png` })
  }
  expect(generationCalls).toHaveLength(0)
})

test('video covers skip a black intro, show actual duration and reuse the cached poster without reloading video', async ({ page }) => {
  const { library, mediaReads, generationCalls } = await fixture(page, 1, true)
  const cover = library.getByRole('button', { name: '预览 作品 000', exact: true })
  await expect(cover.locator('img')).toBeVisible({ timeout: 15000 })
  await expect(cover.getByLabel('实际视频时长', { exact: true })).toHaveText('0:02')
  const brightness = await cover.locator('img').evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
    const pixel = context.getImageData(50, 50, 1, 1).data
    return pixel[0]! + pixel[1]! + pixel[2]!
  })
  expect(brightness).toBeGreaterThan(100)
  expect((await previewMetadata(page))[0]?.duration).toBeCloseTo(2.5, 1)
  await expect(library.locator('video')).toHaveCount(0)
  if (!await library.locator('video').count() && await library.locator('.browser-save').count()) await expect(library.locator('.browser-save').first()).toHaveText('图片已保存到此浏览器')
  mediaReads.length = 0
  await page.reload()
  await openLibrary(page)
  const reopened = page.getByRole('dialog', { name: '作品库', exact: true })
  await expect(reopened.getByRole('button', { name: '预览 作品 000', exact: true })).toBeVisible()
  expect(mediaReads).toHaveLength(0)
  await reopened.getByRole('button', { name: '预览 作品 000', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '原始媒体预览', exact: true }).locator('video')).toBeVisible()
  expect(generationCalls).toHaveLength(0)
})

test('automatic original download preference is persisted per account without re-downloading old records', async ({ page }) => {
  const { library, generationCalls } = await fixture(page, 1)
  await library.getByRole('button', { name: '作品库设置', exact: true }).click()
  const preference = library.getByRole('switch', { name: '自动下载作品', exact: true })
  await expect(preference).not.toBeChecked()
  await preference.check()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('octopus:user-17:native-media-settings') || '{}').autoDownload)).toBe(true)
  await page.reload()
  await openLibrary(page)
  await page.getByRole('button', { name: '作品库设置', exact: true }).click()
  await expect(page.getByRole('switch', { name: '自动下载作品', exact: true })).toBeChecked()
  expect(generationCalls).toHaveLength(0)
})

test('a failed remote thumbnail recovers from the saved original and fits both themes on desktop and mobile', async ({ page }) => {
  const { library, generationCalls } = await fixture(page, 1, false, true)
  await expect(library.locator('.browser-save')).toHaveText('图片已保存到此浏览器')
  await expect(library.getByRole('button', { name: '预览 作品 000', exact: true }).locator('img')).toBeVisible()
  await mkdir('.taste-skill/media-library-20261115', { recursive: true })
  for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), theme)
    if (!await library.isVisible()) await openLibrary(page)
    await expect(library.getByRole('combobox', { name: '按时间筛选', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.taste-skill/media-library-20261115/gallery-${theme}-${width}.png` })
  }
  expect(generationCalls).toHaveLength(0)
})

test('poster slots bound remote fetches, abort queued and active work, and reject oversized posters', async ({ page }) => {
  await fixture(page, 1)
  const poster = await sharp({ create: { width: 192, height: 128, channels: 3, background: 'red' } }).webp().toBuffer()
  await page.route('**/api/creation/media**', async route => {
    if (!new URL(route.request().url()).searchParams.has('captureQueue')) return route.fallback()
    await new Promise(resolve => setTimeout(resolve, 120))
    await route.fulfill({ contentType: 'image/webp', body: poster, headers: { 'x-video-duration': '2.5' } }).catch(() => {})
  })
  const result = await page.evaluate(async () => {
    const modulePath = '/src/studio-video-poster.ts', { extractVideoPoster } = await import(modulePath)
    const original = window.fetch.bind(window)
    let active = 0, maximum = 0
    window.fetch = async (...args) => {
      active++; maximum = Math.max(maximum, active)
      try { return await original(...args) }
      finally { active-- }
    }
    const controllers = Array.from({ length: 6 }, () => new AbortController())
    const work = controllers.map((controller, index) => extractVideoPoster(`/api/creation/media?url=https://media.example/${index}.mp4&kind=video&captureQueue=1`, controller.signal)
      .then((value: { duration: number }) => ({ duration: value.duration, error: '' }))
      .catch((error: Error) => ({ duration: 0, error: error.name })))
    setTimeout(() => { controllers[0]!.abort(); controllers[2]!.abort() }, 30)
    const values = await Promise.all(work)
    let cancelled = false
    window.fetch = async (source, init) => String(source).includes('oversized')
      ? new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'content-type': 'image/webp', 'content-length': String(1024 * 1024 + 1) } }) : original(source, init)
    let oversized = ''
    try { await extractVideoPoster('/api/creation/media?url=oversized&kind=video', new AbortController().signal) }
    catch (error) { oversized = (error as Error).message }
    finally { window.fetch = original }
    return { values, oversized, cancelled, maximum, active }
  })
  expect(result.maximum).toBe(2)
  expect(result.active).toBe(0)
  expect(result.values.filter(value => value.error === 'AbortError')).toHaveLength(2)
  expect(result.values.filter(value => Math.abs(value.duration - 2.5) < .1)).toHaveLength(4)
  expect(result.oversized).toContain('封面超过')
  expect(result.cancelled).toBe(true)
})
