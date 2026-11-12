import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Work } from '../src/data'

const image: Work = {
  id: 'grid-image', authorId: 'grid-creator', version: 1, fileIds: [], kind: 'image',
  title: '完整作品封面', author: '预览创作者', avatar: '创', cover: '/__preview-fixtures/cover.svg',
  tags: [], prompt: '保留完整画面与细节。', model: '模型', likes: 3, date: '2026-11-12T00:00:00Z',
  owned: false, liked: false, saved: false, status: 'published',
}
const resource: Work = {
  ...image, id: 'grid-resource', kind: 'resource', title: '可读的创作记录', cover: '',
  tags: ['Skill'], body: '第一段记录创作步骤。\n第二段保留参数与判断依据。',
}
const localCover = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#60765d"/><rect x="80" y="100" width="480" height="600" fill="#ccd6c9"/></svg>'

async function fixture(page: Page, brokenImage = false) {
  const writes: string[] = []
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== 'http://localhost:18775') return route.abort()
    if (url.pathname === '/__preview-fixtures/cover.svg') {
      return brokenImage
        ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'Missing fixture image' })
        : route.fulfill({ contentType: 'image/svg+xml', body: localCover })
    }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (request.method() !== 'GET') {
      writes.push(`${request.method()} ${url.pathname}`)
      return route.fulfill({ status: 204 })
    }
    if (url.pathname === '/api/session') return route.fulfill({ json: { user: null } })
    if (url.pathname === '/api/works') return route.fulfill({ json: { items: [image, resource], nextCursor: null } })
    const selected = [image, resource].find(work => url.pathname === `/api/works/${work.id}`)
    if (selected) return route.fulfill({ json: { work: selected } })
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  return writes
}

function preview(page: Page, work = image) {
  return page.getByRole('dialog', { name: `作品预览：${work.title}`, exact: true })
}

async function openPreview(page: Page, work = image) {
  const cover = page.locator(`.work-card[data-work-id="${work.id}"] .work-cover`)
  await cover.click()
  await expect(preview(page, work)).toBeVisible()
  await expect(page).toHaveURL(/\/discover$/)
  return cover
}

async function clickBackdrop(page: Page, dialog: Locator) {
  const bounds = await dialog.boundingBox()
  expect(bounds).not.toBeNull()
  const viewport = page.viewportSize()!
  const point = bounds!.y > 2
    ? { x: viewport.width / 2, y: Math.max(1, bounds!.y / 2) }
    : { x: Math.max(1, bounds!.x / 2), y: viewport.height / 2 }
  await page.mouse.click(point.x, point.y)
}

for (const width of [1440, 390]) {
  test(`work grid previews open and close without navigating at ${width}px`, async ({ page }) => {
    const writes = await fixture(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    const cover = await openPreview(page)
    const dialog = preview(page)
    await expect(dialog.locator('img')).toHaveAttribute('alt', image.title)
    await expect(dialog.locator('img')).toBeVisible()
    await expect(dialog.getByText(image.title, { exact: true }).first()).toBeVisible()
    await expect(dialog.getByRole('link', { name: '查看作品详情', exact: true })).toHaveAttribute('href', `/work/${image.id}`)
    await expect(dialog.getByRole('button', { name: '关闭作品预览', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(cover).toBeFocused()
    await cover.press('Enter')
    await expect(dialog).toBeVisible()
    await clickBackdrop(page, dialog)
    await expect(dialog).toBeHidden()
    await expect(cover).toBeFocused()
    await expect(page).toHaveURL(/\/discover$/)
    expect(writes).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('reduced motion previews remain usable without running animations', async ({ page }) => {
  await fixture(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/discover')
  const cover = await openPreview(page)
  const dialog = preview(page)
  expect(await dialog.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0)
  await dialog.getByRole('button', { name: '关闭作品预览', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(cover).toBeFocused()
})

test('a failed image still permits closing and opening the full work', async ({ page }) => {
  await fixture(page, true)
  await page.goto('/discover')
  const cover = await openPreview(page)
  const dialog = preview(page)
  await expect(dialog.getByText(/预览加载失败|暂无预览/)).toBeVisible()
  expect((await new AxeBuilder({ page }).include('.work-grid-preview[open]').analyze()).violations).toEqual([])
  await dialog.getByRole('button', { name: '关闭作品预览', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(cover).toBeFocused()
  expect((await new AxeBuilder({ page }).include('.bento-grid').analyze()).violations).toEqual([])
  await cover.click()
  await dialog.getByRole('link', { name: '查看作品详情', exact: true }).click()
  await expect(page).toHaveURL(`/work/${image.id}`)
  await expect(page.getByRole('heading', { name: image.title, exact: true }).first()).toBeVisible()
  await expect(page.locator('.work-grid-preview[open]')).toHaveCount(0)
})

test('resource previews retain readable content and a details link', async ({ page }) => {
  await fixture(page)
  await page.goto('/discover')
  await openPreview(page, resource)
  const dialog = preview(page, resource)
  await expect(dialog.getByText('第一段记录创作步骤。', { exact: false })).toBeVisible()
  await expect(dialog.getByText('第二段保留参数与判断依据。', { exact: false })).toBeVisible()
  await dialog.getByRole('link', { name: '查看作品详情', exact: true }).click()
  await expect(page).toHaveURL(`/work/${resource.id}`)
  await expect(page.getByRole('heading', { name: resource.title, exact: true }).first()).toBeVisible()
})

test('guest likes and saves retain authentication feedback without opening a preview', async ({ page }) => {
  const writes = await fixture(page)
  await page.goto('/discover')
  const card = page.locator(`.work-card[data-work-id="${image.id}"]`)
  const like = card.getByRole('button', { name: `喜欢：${image.title}，${image.likes} 赞`, exact: true })
  const save = card.getByRole('button', { name: `收藏：${image.title}`, exact: true })
  for (const action of [like, save]) {
    await action.click()
    await expect(page.getByRole('status').filter({ hasText: '请先登录后再操作。' })).toBeVisible()
    await expect(action).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.work-grid-preview[open]')).toHaveCount(0)
    await expect(page).toHaveURL(/\/discover$/)
  }
  expect(writes).toEqual([])
})
