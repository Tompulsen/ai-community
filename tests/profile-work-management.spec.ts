import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, own = true) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = own ? '3' : '42'
  account.state.user.accountId = account.state.user.id
  const errors: string[] = [], queries: URL[] = [], deleted: string[] = []
  let failId = ''
  page.on('pageerror', error => errors.push(error.message))
  const work = (id: string, title: string, status: string, kind = 'image', date = '2026-11-14T12:00:00Z') => ({
    id, title, status, kind, date, authorId: '3', author: 'root', avatar: '章', version: 2,
    fileIds: [], tags: [], prompt: '', model: '', likes: 0, owned: own, saved: false, liked: false,
    cover: '/assets/brand/octopus-community.jpg',
  })
  const items = [work('public1', '公开图片', 'published'), work('private1', '私密图片', 'pending'),
    work('draft1', '图片草稿', 'draft'), work('video1', '早期视频', 'published', 'video', '2026-10-01T12:00:00Z')]
  await page.route('**/api/users/3', route => route.fulfill({ json: { user: {
    id: '3', username: 'root', name: 'root', bio: '', count: 2, followed: false, followersCount: 0, followingCount: 0,
  } } }))
  await page.route('**/api/works/*', route => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!
    expect(route.request().postDataJSON()).toEqual({ version: 2 })
    deleted.push(id)
    if (id === failId) return route.fulfill({ status: 409, json: { message: '作品已变化，请刷新后重试。' } })
    const index = items.findIndex(item => item.id === id)
    if (index >= 0) items.splice(index, 1)
    return route.fulfill({ json: { ok: true } })
  })
  const listing = (route: any) => {
    const url = new URL(route.request().url())
    queries.push(url)
    let filtered = items.filter(item => own || item.status === 'published')
    if (url.searchParams.has('kind')) filtered = filtered.filter(item => item.kind === url.searchParams.get('kind'))
    if (url.searchParams.get('visibility') === 'public') filtered = filtered.filter(item => item.status === 'published')
    if (url.searchParams.get('visibility') === 'private') filtered = filtered.filter(item => item.status === 'pending')
    if (url.searchParams.get('status') === 'draft') filtered = filtered.filter(item => item.status === 'draft')
    if (url.searchParams.has('from')) filtered = filtered.filter(item => Date.parse(item.date) >= Date.parse(url.searchParams.get('from')!))
    if (url.searchParams.has('to')) filtered = filtered.filter(item => Date.parse(item.date) < Date.parse(url.searchParams.get('to')!))
    const cursor = url.searchParams.get('cursor')
    return route.fulfill({ json: { items: cursor ? filtered.slice(2) : filtered.slice(0, 2), nextCursor: !cursor && filtered.length > 2 ? 'page2' : null } })
  }
  await page.route('**/api/library**', listing)
  await page.route('**/api/works?**', listing)
  await page.goto('/community?creator=3')
  await expect(page.locator('.creator-page h1')).toHaveText('root')
  return { ...account, errors, queries, deleted, fail: (id: string) => { failId = id } }
}
const panel = (page: Page) => page.getByRole('dialog', { name: '批量管理', exact: true })
const open = (page: Page) => page.getByRole('button', { name: '批量管理', exact: true }).click()
async function selectStatus(page: Page, value: string) {
  await open(page)
  await panel(page).getByRole('combobox', { name: '作品状态', exact: true }).selectOption(value)
  await panel(page).getByRole('button', { name: '应用筛选', exact: true }).click()
}

test('profile toolbar consolidates type, status and inclusive local dates with pagination', async ({ page }) => {
  const state = await fixture(page)
  await expect(page.locator('.profile-work-heading')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '个人作品分类', exact: true })).toHaveCount(0)
  await expect(page.locator('.profile-content-toolbar').getByRole('button', { name: '批量管理', exact: true })).toBeVisible()
  await expect(page.locator('.profile-works .work-card')).toHaveCount(2)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.profile-works .work-card')).toHaveCount(4)
  await selectStatus(page, 'public')
  await expect(page.locator('.work-title')).toHaveText(['公开图片', '早期视频'])
  await selectStatus(page, 'private')
  await expect(page.locator('.work-title')).toHaveText(['私密图片'])
  await selectStatus(page, 'draft')
  await expect(page.locator('.work-title')).toHaveText(['图片草稿'])
  await open(page)
  await panel(page).getByRole('combobox', { name: '作品状态', exact: true }).selectOption('all')
  await panel(page).getByRole('combobox', { name: '作品类型', exact: true }).selectOption('image')
  await panel(page).getByLabel('开始日期', { exact: true }).fill('2026-11-14')
  await panel(page).getByLabel('结束日期', { exact: true }).fill('2026-11-14')
  await panel(page).getByRole('button', { name: '应用筛选', exact: true }).click()
  await expect(page.locator('.work-title')).toHaveText(['公开图片', '私密图片'])
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('.work-title')).toHaveText(['公开图片', '私密图片', '图片草稿'])
  const query = state.queries.at(-1)!
  expect(query.searchParams.get('kind')).toBe('image')
  expect(query.searchParams.get('cursor')).toBe('page2')
  const from = new Date(query.searchParams.get('from')!), to = new Date(query.searchParams.get('to')!)
  expect([from.getDate(), from.getHours(), to.getDate(), to.getHours()]).toEqual([14, 0, 15, 0])
  await open(page)
  await panel(page).getByRole('button', { name: '重置', exact: true }).click()
  await expect.poll(() => state.queries.at(-1)!.searchParams.has('from')).toBe(false)
  expect(state.errors).toEqual([])
})

test('bulk deletion cancels safely and preserves remaining works after a partial failure', async ({ page }) => {
  const state = await fixture(page)
  await open(page)
  await panel(page).getByRole('button', { name: '多选作品', exact: true }).click()
  await page.getByRole('checkbox', { name: '全选当前作品', exact: true }).check()
  await expect(page.getByRole('toolbar', { name: '作品批量操作', exact: true }).getByRole('status')).toHaveText('已选 2 件')
  await page.getByRole('button', { name: '删除所选作品', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '删除确认', exact: true })
  await confirm.getByRole('button', { name: '取消', exact: true }).click()
  expect(state.deleted).toEqual([])
  state.fail('private1')
  await page.getByRole('button', { name: '删除所选作品', exact: true }).click()
  await confirm.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('已删除 1 件')
  await expect(page.getByRole('checkbox', { name: '选择作品：私密图片', exact: true })).toBeChecked()
  await expect(page.getByRole('link', { name: '公开图片', exact: true })).toHaveCount(0)
  expect(state.deleted).toEqual(['public1', 'private1'])
  expect(state.errors).toEqual([])
})

test('visitors only get public filters and do not request the owners private library', async ({ page }) => {
  const state = await fixture(page, false)
  await expect(page.getByRole('button', { name: '批量管理', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '筛选作品', exact: true }).click()
  const filters = page.getByRole('dialog', { name: '筛选作品', exact: true })
  await expect(filters.getByRole('combobox', { name: '作品状态', exact: true })).toHaveCount(0)
  await expect(filters.getByRole('button', { name: '多选作品', exact: true })).toHaveCount(0)
  expect(state.queries.every(url => url.pathname === '/api/works' && !url.searchParams.has('visibility'))).toBe(true)
  expect(state.errors).toEqual([])
})

test('management toolbar and filters fit desktop and small phones', async ({ page }) => {
  const state = await fixture(page)
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), width === 390 ? 'dark' : 'light')
    await open(page)
    await expect(panel(page).getByRole('combobox', { name: '作品状态', exact: true })).toBeVisible()
    await expect.poll(() => panel(page).evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
        && element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight + 1
    })).toBe(true)
    if (width === 1440) {
      const anchor = (await page.getByRole('button', { name: '批量管理', exact: true }).boundingBox())!
      const bounds = (await panel(page).boundingBox())!
      expect(bounds.y - anchor.y - anchor.height).toBeCloseTo(8, 0)
      expect(bounds.x + bounds.width).toBeCloseTo(anchor.x + anchor.width, 0)
    }
    for (const name of ['重置', '应用筛选', '多选作品']) await expect(panel(page).getByRole('button', { name, exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.taste-skill/profile-management-20261116/filters-${width}.png`, fullPage: true })
    await panel(page).getByRole('button', { name: '关闭批量管理', exact: true }).click()
    await expect(page.getByRole('button', { name: '批量管理', exact: true })).toBeFocused()
    await page.screenshot({ path: `.taste-skill/profile-management-20261116/profile-${width}.png`, fullPage: true })
  }
  for (const [width, height] of [[1440, 600], [768, 650], [390, 520], [320, 400]]) {
    await page.setViewportSize({ width: width!, height: height! })
    await open(page)
    await expect.poll(() => panel(page).evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth
    })).toBe(true)
    for (const name of ['重置', '应用筛选', '多选作品']) await expect(panel(page).getByRole('button', { name, exact: true })).toBeInViewport()
    await panel(page).getByRole('button', { name: '关闭批量管理', exact: true }).click()
  }
  await page.setViewportSize({ width: 1440, height: 600 })
  await open(page)
  await page.evaluate(() => window.scrollBy(0, 80))
  await expect.poll(async () => {
    const anchor = (await page.getByRole('button', { name: '批量管理', exact: true }).boundingBox())!
    const bounds = (await panel(page).boundingBox())!
    return Math.min(Math.abs(bounds.y - anchor.y - anchor.height - 8), Math.abs(anchor.y - bounds.y - bounds.height - 8))
  }).toBeLessThan(1)
  expect(state.errors).toEqual([])
})
