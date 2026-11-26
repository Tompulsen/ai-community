import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function openLibrary(page: Page) {
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  if (await page.getByRole('button', { name: '创作台菜单', exact: true }).isVisible()) await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  await page.getByRole('button', { name: '作品库', exact: true }).click()
}

async function fixture(page: Page, options: { poster?: string; brokenPoster?: boolean; failedExtraction?: boolean } = {}) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const video = await readFile('tests/fixtures/poster-black-intro.mp4')
  const poster = await sharp({ create: { width: 192, height: 128, channels: 3, background: '#358bba' } }).webp().toBuffer()
  const reads: { source: string; kind: string; variant: string }[] = [], generations: string[] = []
  await page.route('**/api/creation/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'sora-2', kinds: ['video'] }] } })
    if (url.pathname === '/api/creation/media') {
      const variant = url.searchParams.get('variant') || '', source = url.searchParams.get('url') || ''
      reads.push({ source, kind: url.searchParams.get('kind') || '', variant })
      if (variant === 'preview' && options.brokenPoster) return route.fulfill({ contentType: 'video/mp4', body: video })
      if (variant === 'poster' && options.failedExtraction) return route.fulfill({ status: 503, json: { message: '封面不可用' } })
      if (variant) return route.fulfill({ contentType: 'image/webp', body: poster, headers: { 'x-video-duration': '2.5' } })
      return route.fulfill({ contentType: 'video/mp4', body: video })
    }
    if (url.pathname === '/api/creation/generate') { generations.push(route.request().method()); return route.fulfill({ status: 405, json: {} }) }
    if (url.pathname === '/api/creation/skills/catalog') return route.fulfill({ json: { items: [] } })
    if (url.pathname === '/api/creation/mcp/status') return route.fulfill({ json: { enabled: false, items: [] } })
    return route.fulfill({ json: {} })
  })
  await page.addInitScript(({ upstreamPoster }) => {
    if (sessionStorage.getItem('poster-performance-fixture')) return
    sessionStorage.setItem('poster-performance-fixture', '1')
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([{
      id: 'poster-task', owner: '17', kind: 'video', model: 'sora-2', prompt: '视频封面测试', createdAt: Date.now(), settledAt: Date.now(),
      phase: 'complete', protocol: 'sync', urls: ['https://media.example/video.mp4'], references: [], text: '',
      ...(upstreamPoster ? { poster: upstreamPoster } : {}), request: { size: '', aspect_ratio: '', n: 1, duration: 8 },
    }]))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      activeId: 'poster-chat', mediaConversationsMigrated: true, sessions: [{ id: 'poster-chat', creationKind: 'text', topic: '测试',
        lastUpdate: Date.now(), model: 'gpt-5', settings: {}, skillIds: [], messages: [] }],
    } }))
  }, { upstreamPoster: options.poster })
  await page.goto('/create/text')
  await openLibrary(page)
  const library = page.getByRole('dialog', { name: '作品库', exact: true })
  await expect(library.locator('.gallery-item')).toHaveCount(1)
  return { library, reads, generations }
}

async function savedPreview(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/studio-task-store.ts', { readTaskPreview, readTaskSnapshot } = await import(path)
    const tasks = await readTaskSnapshot('17')
    const task = tasks.find((item: { id: string }) => item.id === 'poster-task')
    if (!task) return false
    const base = JSON.stringify([task.kind, task.urls[0]])
    const identity = task.poster ? JSON.stringify([base, task.poster]) : base
    const result = await readTaskPreview('17', task.id, identity)
    return Boolean(result?.blob?.size)
  })
}

test('remote covers fetch a small poster and reuse it after reload while originals still open', async ({ page }) => {
  const { library, reads, generations } = await fixture(page)
  const cover = library.getByRole('button', { name: '预览 视频封面测试', exact: true })
  await expect(cover.locator('img')).toBeVisible()
  await expect(cover.getByLabel('实际视频时长', { exact: true })).toHaveText('0:02')
  expect(reads).toEqual([{ source: 'https://media.example/video.mp4', kind: 'video', variant: 'poster' }])
  await expect.poll(() => savedPreview(page)).toBe(true)
  reads.length = 0
  await page.reload(); await openLibrary(page)
  const reopened = page.getByRole('dialog', { name: '作品库', exact: true })
  await expect(reopened.getByRole('button', { name: '预览 视频封面测试', exact: true }).locator('img')).toBeVisible()
  expect(reads).toHaveLength(0)
  await reopened.getByRole('button', { name: '预览 视频封面测试', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '原始媒体预览', exact: true }).locator('video')).toBeVisible()
  expect(generations).toHaveLength(0)
})

test('explicit upstream posters use the safe image preview and invalidate a changed poster', async ({ page }) => {
  const { library, reads, generations } = await fixture(page, { poster: 'https://media.example/poster.jpg' })
  await expect(library.getByRole('button', { name: '预览 视频封面测试', exact: true }).locator('img')).toBeVisible()
  expect(reads).toEqual([{ source: 'https://media.example/poster.jpg', kind: 'image', variant: 'preview' }])
  await expect.poll(() => savedPreview(page)).toBe(true)
  reads.length = 0
  await page.reload(); await openLibrary(page)
  await expect(page.getByRole('dialog', { name: '作品库', exact: true }).locator('.cover-preview img')).toBeVisible()
  expect(reads).toHaveLength(0)
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('community-studio-media')
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('tasks', 'readwrite'), records = transaction.objectStore('tasks')
    const request = records.get(['17', 'poster-task'])
    request.onsuccess = () => { const record = request.result; record.value.poster = 'https://media.example/updated.jpg'; records.put(record) }
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) })
    db.close()
  })
  await page.reload(); await openLibrary(page)
  await expect.poll(() => reads).toEqual([{ source: 'https://media.example/updated.jpg', kind: 'image', variant: 'preview' }])
  await expect.poll(() => savedPreview(page)).toBe(true)
  expect(generations).toHaveLength(0)
})

test('invalid upstream poster content falls back once to the video poster', async ({ page }) => {
  const { library, reads, generations } = await fixture(page, { poster: 'https://media.example/not-image.mp4', brokenPoster: true })
  await expect(library.locator('.cover-preview img')).toBeVisible()
  expect(reads.map(read => read.variant)).toEqual(['preview', 'poster'])
  await expect.poll(() => savedPreview(page)).toBe(true)
  expect(generations).toHaveLength(0)
})

test('cover failure preserves retry and direct original playback on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const { library, reads, generations } = await fixture(page, { failedExtraction: true })
  const original = library.getByRole('button', { name: '查看原视频', exact: true })
  await expect(original).toBeVisible()
  await expect(library.getByRole('button', { name: '重新加载封面：视频封面测试', exact: true })).toBeVisible()
  expect(reads.map(read => read.variant)).toEqual(['poster'])
  await original.click()
  await expect(page.getByRole('dialog', { name: '原始媒体预览', exact: true }).locator('video')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(generations).toHaveLength(0)
})
