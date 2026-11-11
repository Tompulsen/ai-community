import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/session') return route.fulfill({ json: { user: { id: 'layout-user', username: 'creator', name: '布局测试创作者' } } })
    if (path === '/api/tags') return route.fulfill({ json: { items: [{ id: 'tag-1', name: 'Skill' }] } })
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
})

for (const width of [320, 390, 768, 1000, 1440]) {
  test(`authenticated header and discovery controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    await expect(page.getByLabel('账号菜单', { exact: true })).toBeVisible()
    await expect(page.getByLabel('搜索作品', { exact: true })).toBeVisible()
    const categories = page.getByRole('group', { name: '作品类型' })
    await expect(categories.getByRole('button')).toHaveCount(4)
    await expect(categories.getByRole('button', { name: /资源/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const controls = page.locator('.brand, .header-actions, .discover-search, .category-tabs, .toolbar-options')
    for (const control of await controls.all()) {
      const bounds = await control.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    const brand = await page.locator('.brand').boundingBox()
    const actions = await page.locator('.header-actions').boundingBox()
    expect(brand!.x + brand!.width).toBeLessThanOrEqual(actions!.x)
    if (width >= 1000) {
      const nav = page.getByRole('navigation', { name: '主导航', exact: true })
      await expect(nav.getByRole('link', { name: '发现', exact: true })).toHaveAttribute('aria-current', 'page')
      const bounds = await nav.boundingBox()
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(actions!.x)
    } else {
      await expect(page.getByRole('navigation', { name: '手机导航' }).getByRole('link', { name: '发现', exact: true })).toHaveAttribute('aria-current', 'page')
    }
    const accessibility = await new AxeBuilder({ page }).include('.app-header').include('.discover-heading').include('.discovery-toolbar').analyze()
    expect(accessibility.violations).toEqual([])
  })
}

test('search, categories, tags and sorting keep their API behavior', async ({ page }) => {
  await page.goto('/discover')
  const query = page.getByRole('searchbox', { name: '搜索作品' })
  const search = page.waitForRequest(request => new URL(request.url()).searchParams.get('query') === '中文提示词')
  await query.fill('中文提示词')
  await search
  await expect(page).toHaveURL(/q=/)
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await expect(query).toHaveValue('')
  const category = page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '图片', exact: true })
  const imageRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/works' && new URL(request.url()).searchParams.get('kind') === 'image')
  await category.click()
  await imageRequest
  await expect(category).toHaveAttribute('aria-pressed', 'true')
  const filter = page.getByRole('button', { name: '筛选', exact: true })
  await filter.click()
  await expect(filter).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Skill', exact: true }).click()
  await expect(page.getByRole('button', { name: '筛选 1', exact: true })).toBeVisible()
  const sorted = page.waitForRequest(request => new URL(request.url()).searchParams.get('sort') === 'latest')
  await page.getByLabel('作品排序', { exact: true }).selectOption('latest')
  await sorted
  await query.focus()
  await expect(query).toBeFocused()
})
