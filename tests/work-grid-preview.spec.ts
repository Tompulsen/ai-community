import { expect, test, type Page } from '@playwright/test'
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

async function fixture(page: Page, items = [image, resource], brokenImage = false) {
  const writes: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== 'http://localhost:18775') return route.abort()
    if (url.pathname === '/__preview-fixtures/cover.svg') {
      const ratio = Number(url.searchParams.get('ratio')) || 4 / 5
      return brokenImage
        ? route.fulfill({ status: 404, body: 'Missing fixture image' })
        : route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(800 * ratio)}" height="800"><rect width="100%" height="100%" fill="#60765d"/><rect x="10%" y="10%" width="80%" height="80%" fill="#ccd6c9"/></svg>` })
    }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (request.method() !== 'GET') {
      if (request.method() === 'POST' && url.pathname.endsWith('/view')) return route.fulfill({ json: { viewsCount: 1 } })
      writes.push(`${request.method()} ${url.pathname}`)
      return route.fulfill({ status: 204 })
    }
    if (url.pathname === '/api/session') return route.fulfill({ json: { user: null } })
    if (url.pathname === '/api/works') return route.fulfill({ json: { items, nextCursor: null } })
    const selected = items.find(work => url.pathname === `/api/works/${work.id}`)
    if (selected) return route.fulfill({ json: { work: selected } })
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  return { writes, errors }
}

async function openWork(page: Page, work = image) {
  await page.locator(`.work-card[data-work-id="${work.id}"] .work-cover`).click()
  await expect(page).toHaveURL(`/work/${work.id}`)
  await expect(page.getByRole('heading', { name: work.title, exact: true }).first()).toBeVisible()
  await expect(page.locator('.work-grid-preview')).toHaveCount(0)
}

async function expectPacked(page: Page, count: number) {
  const cards = page.locator('.bento-grid > .work-card')
  await expect(cards).toHaveCount(count)
  await expect.poll(() => cards.evaluateAll(elements => elements.every(element => {
    const style = getComputedStyle(element)
    return parseInt(style.gridRowEnd.replace('span ', '')) === Math.ceil(element.getBoundingClientRect().height + 24)
  }))).toBe(true)
  const bounds = await cards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))
  for (const [index, box] of bounds.entries()) {
    expect(box.width).toBeCloseTo(bounds[0]!.width, 1)
    if (index) expect(box.top).toBeGreaterThanOrEqual(bounds[index - 1]!.top)
    for (const other of bounds.slice(index + 1)) {
      const horizontal = box.left < other.right - 1 && box.right > other.left + 1
      const vertical = box.top < other.bottom - 1 && box.bottom > other.top + 1
      expect(horizontal && vertical).toBe(false)
      if (Math.abs(box.left - other.left) < 1) expect(other.top - box.bottom).toBeGreaterThanOrEqual(23.9)
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

for (const width of [1440, 390]) {
  test(`cards open details by click and keyboard at ${width}px`, async ({ page }) => {
    const state = await fixture(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    await openWork(page)
    await page.goBack()
    const cover = page.locator(`[data-work-id="${image.id}"] .work-cover`)
    await expect(cover).toHaveAttribute('href', `/work/${image.id}`)
    await cover.focus()
    await cover.press('Enter')
    await expect(page).toHaveURL(`/work/${image.id}`)
    expect(state.writes).toEqual([])
    expect(state.errors).toEqual([])
  })
}

test('masonry preserves natural image proportions and feed order across viewport changes', async ({ page }) => {
  const ratios = [16 / 9, 9 / 16, 1, 4 / 5, 2, 3 / 4, 1, 9 / 16, 4 / 3, 1, 4 / 5, 2]
  const items = ratios.map((coverAspectRatio, index) => ({
    ...image, id: `proportion-${index}`, cover: `${image.cover}?ratio=${coverAspectRatio}`, coverAspectRatio,
    kind: index === 3 ? 'video' as const : 'image' as const,
  }))
  const state = await fixture(page, items)
  await page.goto('/discover')
  for (const width of [2560, 1440, 1100, 768, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('.work-cover > img').evaluateAll(images => Promise.all(images.map(img => (img as HTMLImageElement).decode())))
    await expectPacked(page, items.length)
    const layout = await page.locator('.bento-grid').evaluate(grid => ({
      width: grid.getBoundingClientRect().width,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      cards: Array.from(grid.children, card => {
        const cover = card.querySelector('.work-cover')!, media = cover.querySelector('img')!
        const box = cover.getBoundingClientRect(), information = card.querySelector('.work-information')!.getBoundingClientRect()
        return { id: card.getAttribute('data-work-id'), ratio: box.width / box.height, fit: getComputedStyle(media).objectFit,
          mediaWidth: media.getBoundingClientRect().width, width: box.width, bottom: box.bottom, infoTop: information.top,
          radius: getComputedStyle(cover).borderRadius }
      }),
    }))
    expect(layout.columns).toBe(width < 640 ? 2 : Math.floor((layout.width + 16) / 216))
    expect(layout.cards.map(card => card.id)).toEqual(items.map(item => item.id))
    for (const [index, card] of layout.cards.entries()) {
      expect(card.ratio).toBeCloseTo(ratios[index]!, 2)
      expect(card.fit).toBe('contain')
      expect(card.mediaWidth).toBeCloseTo(card.width, 1)
      expect(card.infoTop).toBeGreaterThanOrEqual(card.bottom)
      expect(card.radius).toBe('8px')
    }
  }
  expect(state.errors).toEqual([])
  await openWork(page, items[0]!)
})

test('legacy covers use decoded dimensions and repack after delayed loading', async ({ page }) => {
  const landscape = { ...image, id: 'legacy-landscape', cover: `${image.cover}?ratio=2` }
  const items = [landscape, ...Array.from({ length: 10 }, (_, index) => ({ ...image, id: `legacy-${index}` }))]
  const state = await fixture(page, items)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/cover.svg?ratio=2', async route => { await pending; await route.fallback() })
  await page.goto('/discover', { waitUntil: 'domcontentloaded' })
  const cover = page.locator(`[data-work-id="${landscape.id}"] .work-cover`)
  await expect(cover).toHaveCSS('aspect-ratio', '0.8 / 1')
  release()
  await cover.locator('img').evaluate((img: HTMLImageElement) => img.decode())
  await expect(cover).toHaveCSS('aspect-ratio', '2 / 1')
  await expectPacked(page, items.length)
  expect(state.errors).toEqual([])
})

test('pagination and filtering register and remove masonry cards', async ({ page }) => {
  const items = Array.from({ length: 18 }, (_, index) => ({ ...image, id: `page-${index}` }))
  const state = await fixture(page, items)
  await page.route('**/api/works?*', route => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('kind') === 'video') return route.fulfill({ json: { items: [items[0]], nextCursor: null } })
    return route.fulfill({ json: url.searchParams.has('cursor')
      ? { items: items.slice(8), nextCursor: null }
      : { items: items.slice(0, 8), nextCursor: 'page2' } })
  })
  await page.goto('/discover')
  await expectPacked(page, 8)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expectPacked(page, 18)
  await page.getByRole('group', { name: '作品类型', exact: true }).getByRole('button', { name: '视频', exact: true }).click()
  await expectPacked(page, 1)
  expect(state.errors).toEqual([])
})

test('failed images and resources remain accessible and navigate directly', async ({ page }) => {
  await fixture(page, [image, resource], true)
  await page.goto('/discover')
  await expect(page.locator(`[data-work-id="${image.id}"] .work-cover`)).toContainText('封面加载失败')
  await expectPacked(page, 2)
  expect((await new AxeBuilder({ page }).include('.bento-grid').analyze()).violations).toEqual([])
  await openWork(page)
  await page.goBack()
  await openWork(page, resource)
  await expect(page.getByText('第一段记录创作步骤。', { exact: false })).toBeVisible()
})

test('guest likes and saves retain authentication feedback without navigating', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/discover')
  const card = page.locator(`.work-card[data-work-id="${image.id}"]`)
  for (const name of [`喜欢：${image.title}，${image.likes} 赞`, `收藏：${image.title}`]) {
    const action = card.getByRole('button', { name, exact: true })
    await action.click()
    await expect(page.getByRole('status').filter({ hasText: '请先登录后再操作。' })).toBeVisible()
    await expect(action).toHaveAttribute('aria-pressed', 'false')
    await expect(page).toHaveURL(/\/discover$/)
  }
  await expect(card.locator('.work-author')).toHaveAttribute('href', `/community?creator=${image.authorId}`)
  expect(state.writes).toEqual([])
  expect(state.errors).toEqual([])
})

test('hover leaves masonry geometry stable in both themes and reduced motion', async ({ page }) => {
  const state = await fixture(page)
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.goto('/discover')
    await expectPacked(page, 2)
    const card = page.locator(`[data-work-id="${image.id}"]`)
    const bounds = await card.boundingBox()
    await card.locator('.work-cover').hover()
    await expect(card).toHaveCSS('transform', 'none')
    await expect(card.locator('img')).toHaveCSS('transform', 'none')
    expect(await card.boundingBox()).toEqual(bounds)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(card.locator('.work-cover')).toHaveCSS('transition-duration', '0s')
    expect((await new AxeBuilder({ page }).include('.bento-grid').analyze()).violations).toEqual([])
  }
  expect(state.errors).toEqual([])
})

test.describe('touch cards', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('tap opens details with two columns and usable controls', async ({ page }) => {
    await fixture(page)
    await page.goto('/discover')
    await expectPacked(page, 2)
    for (const selector of ['.save-work', '.like-button']) {
      const bounds = await page.locator(`[data-work-id="${image.id}"] ${selector}`).boundingBox()
      expect(bounds!.width).toBeGreaterThanOrEqual(44)
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
    }
    await page.locator(`[data-work-id="${image.id}"] .work-cover`).tap()
    await expect(page).toHaveURL(`/work/${image.id}`)
  })
})
