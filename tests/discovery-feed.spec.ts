import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { Work } from '../src/data'

const items: Work[] = Array.from({ length: 40 }, (_, i) => ({
  id: `feed${String(i).padStart(3, '0')}`, authorId: i % 2 ? 'followed' : 'another', version: 1, fileIds: [],
  kind: 'image', title: `作品 ${i}`, author: '创作者', avatar: '创', cover: '/assets/brand/octopus-community.jpg', coverAspectRatio: 1,
  tags: [i % 2 ? '海报' : '风景'], prompt: '公开提示词', model: '', likes: i, date: '2026-11-21T00:00:00Z',
  owned: false, liked: false, saved: false, status: 'published',
}))
async function fixture(page: Page, authenticated = true) {
  const account = await mockUnifiedAccount(page, authenticated)
  const requests: any[] = []
  let failNext = false
  await page.route('**/api/tags**', route => route.fulfill({ json: { items: [{ id: 'poster', name: '海报', category: 'image' }, { id: 'landscape', name: '风景', category: 'image' }] } }))
  await page.route('**/api/works/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/works/feed') {
      const body = route.request().postDataJSON(); requests.push(body)
      if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { message: '请重试' } }) }
      const offset = Number(body.cursor || 0)
      let source = items.filter(item => (!body.tag || item.tags.includes(body.tag)) && (!body.query || item.tags.some(tag => body.query.includes(tag)))
        && (body.sort !== 'following' || item.authorId === 'followed'))
      if (body.kind === 'video') source = []
      source.sort((a, b) => Number(body.previous.includes(a.id)) - Number(body.previous.includes(b.id)) ||
        (body.sort === 'featured' ? b.likes - a.likes : a.id.localeCompare(b.id)))
      return route.fulfill({ json: { items: source.slice(offset, offset + 12), nextCursor: offset + 12 < source.length ? String(offset + 12) : null,
        replaced: body.previous.length ? source.slice(0, 12).some(item => !body.previous.includes(item.id)) : null } })
    }
    if (path.endsWith('/view')) return route.fulfill({ json: { viewsCount: 1 } })
    if (path.endsWith('/comments')) return route.fulfill({ json: { items: [] } })
    const work = items.find(item => path === `/api/works/${item.id}`)
    if (work) return route.fulfill({ json: { work } })
    return route.fulfill({ json: { items: [] } })
  })
  return { requests, account, fail: () => { failNext = true } }
}
const ids = (page: Page) => page.locator('.discover-grid [data-work-id]').evaluateAll(cards => cards.map(card => card.getAttribute('data-work-id')))

for (const width of [320, 390, 1440]) test(`four browse modes, filtering and refresh fit ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page)
  await page.goto('/discover')
  await expect(page.locator('.discover-grid [data-work-id]')).toHaveCount(12)
  if (width < 1000) {
    const nav = page.getByRole('navigation', { name: '作品浏览', exact: true })
    await expect(nav.getByRole('link')).toHaveText(['发现', '最新', '热门', '关注'])
    for (const [label, sort] of [['最新', 'latest'], ['热门', 'featured'], ['关注', 'following'], ['发现', 'recommended']]) {
      await nav.getByRole('link', { name: label, exact: true }).click()
      await expect.poll(() => state.requests.at(-1)?.sort).toBe(sort)
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page')
    }
  } else await expect(page.getByRole('group', { name: '浏览方式', exact: true }).getByRole('button')).toHaveText(['发现', '最新', '热门', '关注'])
  const before = await ids(page)
  await page.getByRole('button', { name: '换一批', exact: true }).click()
  await expect.poll(async () => (await ids(page)).some(id => !before.includes(id))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath(`feed-${width}.png`) })
  expect((await new AxeBuilder({ page }).include('.discover-page').analyze()).violations).toEqual([])
})

test('reload replaces works while pagination freezes the original preference snapshot and deduplicates', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/discover'); await expect(page.locator('[data-work-id]')).toHaveCount(12)
  const original = await ids(page), first = state.requests.at(-1)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('[data-work-id]')).toHaveCount(24)
  expect(new Set(await ids(page)).size).toBe(24)
  expect(state.requests.at(-1)).toEqual({ ...first, cursor: '12' })
  await page.reload(); await expect(page.locator('[data-work-id]')).toHaveCount(12)
  expect((await ids(page)).some(id => !original.includes(id))).toBe(true)
})

test('back from a work preserves list and scroll; normal homepage navigation starts another batch', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/discover'); await expect(page.locator('[data-work-id]')).toHaveCount(12)
  await page.locator('[data-work-id]').last().scrollIntoViewIfNeeded()
  const original = await ids(page), requestCount = state.requests.length, scroll = await page.evaluate(() => scrollY)
  await page.locator('[data-work-id]').last().getByRole('link').first().click()
  await expect(page).toHaveURL(/\/work\//)
  await page.goBack(); await expect(page.locator('.discover-grid [data-work-id]')).toHaveCount(12)
  expect(await ids(page)).toEqual(original); expect(state.requests.length).toBe(requestCount)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0)
  await page.locator('[data-work-id]').first().getByRole('link').first().click()
  await page.locator('.community-rail .nav-link[href="/discover"]').click()
  await expect.poll(() => state.requests.length).toBeGreaterThan(requestCount)
  await expect.poll(async () => (await ids(page)).some(id => !original.includes(id))).toBe(true)
})

test('search learns bounded existing tags without retaining the query and can be cleared', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/discover'); await expect(page.locator('[data-work-id]')).toHaveCount(12)
  const search = page.getByRole('searchbox', { name: '搜索作品', exact: true })
  await search.fill('海报私人搜索原词')
  await expect.poll(() => state.requests.at(-1)?.query).toBe('海报私人搜索原词')
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('octopus:discovery-preferences:v1') || '{}').interests?.[0]?.name)).toBe('海报')
  expect(await page.evaluate(() => localStorage.getItem('octopus:discovery-preferences:v1'))).not.toContain('私人搜索原词')
  await search.fill(''); await expect.poll(() => state.requests.at(-1)?.query).toBe('')
  expect(state.requests.at(-1).interests.some((item: any) => item.name === '海报')).toBe(true)
  await page.getByRole('button', { name: '推荐偏好', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '推荐偏好', exact: true })
  await dialog.getByRole('button', { name: '清除推荐偏好', exact: true }).click()
  await expect.poll(() => state.requests.at(-1)?.interests.length).toBe(0)
})

test('failed refresh preserves the current works and guests can only view following after login', async ({ page }) => {
  const state = await fixture(page, false)
  await page.goto('/discover'); await expect(page.locator('[data-work-id]')).toHaveCount(12)
  const original = await ids(page)
  state.fail(); await page.getByRole('button', { name: '换一批', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('请重试'); expect(await ids(page)).toEqual(original)
  await page.getByRole('group', { name: '浏览方式' }).getByRole('button', { name: '关注', exact: true }).click()
  await expect(page.getByText('登录后查看关注的作品', { exact: true })).toBeVisible()
})

test('a cancelled A-B-A selection starts a replacement request and a late response cannot overwrite it', async ({ page }) => {
  const state = await fixture(page)
  let release!: () => void, intercepted = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/works/feed', async route => {
    if (!intercepted) { intercepted = true; await gate; await route.fulfill({ json: { items: [items[39]], nextCursor: null } }).catch(() => {}); return }
    await route.fallback()
  })
  await page.goto('/discover')
  await expect.poll(() => intercepted).toBe(true)
  const modes = page.getByRole('group', { name: '浏览方式', exact: true })
  await modes.getByRole('button', { name: '最新', exact: true }).click()
  await modes.getByRole('button', { name: '发现', exact: true }).click()
  await expect(page.locator('[data-work-id]')).toHaveCount(12)
  release()
  await expect(page.getByRole('button', { name: '换一批', exact: true })).toBeEnabled()
  expect((await ids(page)).includes(items[39]!.id)).toBe(false)
  expect(state.requests.at(-1).sort).toBe('recommended')
})

test('switching the active account clears old preference data and prevents delayed feed writes', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/discover'); await expect(page.locator('[data-work-id]')).toHaveCount(12)
  const first = state.account.state.user.id
  state.account.state.user = { ...state.account.state.user, id: 'secondAccount' }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => state.requests.length).toBeGreaterThan(1)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('octopus:discovery-preferences:v1') || '{}').owner)).toBe('secondAccount')
  expect(state.requests.at(-1).previous).toEqual([])
  expect(await page.evaluate(() => localStorage.getItem('octopus:discovery-preferences:v1'))).not.toContain(first)
})

test('a slow tag catalogue learns the current search after the feed has already rendered', async ({ page }) => {
  const state = await fixture(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/tags', async route => {
    await gate
    await route.fulfill({ json: { items: [{ id: 'poster', name: '海报', category: 'image' }] } })
  })
  await page.goto('/discover?q=海报')
  await expect(page.locator('[data-work-id]')).toHaveCount(12)
  const count = state.requests.length
  release()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('octopus:discovery-preferences:v1') || '{}').interests?.[0]?.name)).toBe('海报')
  expect(state.requests.length).toBe(count)
})
