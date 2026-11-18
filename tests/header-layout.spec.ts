import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

test.beforeEach(async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.route('**/api/tags', route => route.fulfill({ json: { items: [
    { id: 'tag-1', name: 'Skill' },
    ...Array.from({ length: 16 }, (_, index) => ({ id: `tag-${index + 2}`, name: `主题${index + 1}` })),
  ] } }))
})

for (const width of [320, 390, 639, 640, 768, 1000, 1280, 1440, 1920, 2560]) {
  test(`responsive navigation and discovery controls fit at ${width}px`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    if (width >= 1000) await expect(page.getByLabel('账号菜单', { exact: true })).toBeVisible()
    else await expect(page.getByRole('navigation', { name: '作品分类', exact: true })).toBeVisible()
    const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
    if (width >= 1000) {
      await expect(input).toBeVisible()
      await expect(input).toBeEnabled()
    } else await expect(input).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '首页', exact: true })).toHaveCount(1)
    await expect(page).toHaveTitle('首页 · 章鱼社区')
    const header = (await page.locator('.app-header').boundingBox())!
    const main = (await page.locator('main').boundingBox())!
    const desktop = page.getByRole('navigation', { name: '主导航', exact: true })
    const mobile = page.getByRole('navigation', { name: '手机导航', exact: true })
    const nav = width >= 1000 ? desktop : mobile
    await expect(nav).toBeVisible()
    await expect(width >= 1000 ? mobile : desktop).toBeHidden()
    await expect(nav.getByRole('link')).toHaveText(width >= 1000 ? ['首页', '福利中心', '社区', '创作台'] : ['首页', '创作', '消息', '我'])
    await expect(nav.getByRole('link', { name: '首页', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: width >= 1000 ? '创作台' : '创作', exact: true })).toHaveAttribute('href', width >= 1000 ? '/create' : '/create/video')
    if (width >= 1000) {
      const search = (await page.locator('.header-search-slot').boundingBox())!
      const account = (await page.locator('.profile-toggle').boundingBox())!
      const rail = (await page.locator('.community-rail').boundingBox())!
      expect(rail.x).toBe(0)
      expect(rail.width).toBe(64)
      expect(rail.height).toBe(900)
      expect(header.x).toBe(64)
      expect(main.x).toBe(64)
      expect(header.height).toBe(64)
      expect(search.x).toBe(80)
      expect(search.width).toBeGreaterThan(width - 320)
      expect(search.x + search.width).toBeLessThanOrEqual(account.x)
      for (const link of await nav.getByRole('link').all()) {
        const bounds = (await link.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(64)
        await expect(link.locator('svg')).toHaveCount(1)
      }
      await expect(page.locator('.community-rail .community-actions')).toBeVisible()
      await expect(page.locator('.header-actions .community-actions')).toHaveCount(0)
    } else {
      expect(header.height).toBe(52)
      const categories = page.getByRole('navigation', { name: '作品分类', exact: true })
      await expect(categories.getByRole('link')).toHaveText(['发现', '视频', '图片', 'skill'])
      await expect(categories.getByRole('link', { name: '发现', exact: true })).toHaveAttribute('aria-current', 'page')
      for (const link of await categories.getByRole('link').all()) {
        const box = (await link.boundingBox())!
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
      }
      expect(main.x).toBe(0)
      await expect(page.locator('.community-rail')).toBeHidden()
      await expect(page.getByTitle('社区工具', { exact: true })).toBeVisible()
    }
    for (const selector of width >= 1000 ? ['.header-actions', '.header-search-slot', '.discovery-toolbar', '.profile-toggle'] : ['.mobile-header-row', '.mobile-search-toggle']) {
      const bounds = (await page.locator(selector).boundingBox())!
      expect(bounds.x, selector).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width, selector).toBeLessThanOrEqual(width)
    }
    if (width < 1000) {
      await expect(page.locator('.discovery-toolbar')).toBeHidden()
      await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
      await page.getByRole('button', { name: '筛选', exact: true }).click()
      expect((await page.locator('.app-header').boundingBox())!.height).toBe(52)
    }
    const modes = page.getByRole('group', { name: '浏览方式', exact: true })
    await expect(modes.getByRole('button')).toHaveText(['推荐', '最新', '关注'])
    await expect(modes.getByRole('button', { name: '推荐', exact: true })).toHaveAttribute('aria-pressed', 'true')
    if (width >= 1000) expect((await page.locator('.discovery-toolbar').boundingBox())!.y).toBeCloseTo(header.height + 16, 1)
    if (width >= 1000) await expect(page.getByRole('group', { name: '作品类型' }).getByRole('button')).toHaveCount(4)
    else await expect(page.getByRole('group', { name: '作品类型' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if ([320, 768, 1440, 2560].includes(width)) {
      expect((await new AxeBuilder({ page }).include('.community-shell').analyze()).violations).toEqual([])
      await page.screenshot({ path: test.info().outputPath(`community-shell-${width}.png`) })
    }
    expect(errors).toEqual([])
  })
}

for (const width of [320, 1440]) {
  test(`persistent search keeps filters, clears and supports keyboard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover?kind=image&tag=Skill')
    if (width < 1000) await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
    const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
    const before = await page.locator('.discovery-toolbar').boundingBox()
    const searched = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.pathname === '/api/works' && url.searchParams.get('query') === '中文搜索'
        && url.searchParams.get('kind') === 'image' && url.searchParams.get('tag') === 'Skill'
    })
    await input.fill('中文搜索')
    await searched
    await expect(page).toHaveURL(/q=/)
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    if (width >= 1000) await input.press('Escape')
    await expect(input).toBeVisible()
    await expect(input).toBeEnabled()
    expect(await page.locator('.discovery-toolbar').boundingBox()).toEqual(before)
    if (width >= 1000) await expect(page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '图片', exact: true })).toHaveAttribute('aria-pressed', 'true')
    else {
      await expect(page.getByRole('navigation', { name: '作品分类' }).getByRole('link', { name: '图片', exact: true })).toHaveAttribute('aria-current', 'page')
      await input.press('Escape')
      await expect(input).toHaveCount(0)
      await expect(page.getByRole('button', { name: '展开搜索作品', exact: true })).toBeFocused()
      expect((await page.locator('.app-header').boundingBox())!.height).toBe(52)
    }
  })

  test(`submission opens the existing editor without publishing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const writes: string[] = []
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url())
    })
    await page.goto('/discover?kind=image&tag=Skill')
    if (width < 1000) await page.getByRole('button', { name: '发布作品', exact: true }).click()
    else await page.getByRole('link', { name: '投稿', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发布作品', exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('kind')).toBe('image')
    expect(new URL(page.url()).searchParams.get('tag')).toBe('Skill')
    await page.getByRole('button', { name: '关闭作品编辑', exact: true }).click()
    await expect(page).not.toHaveURL(/publish=1/)
    if (width < 1000) await expect(page.getByRole('button', { name: '发布作品', exact: true })).toBeFocused()
    expect(writes).toEqual([])
  })
}

test('search is available on community pages and submits to discovery', async ({ page }) => {
  await page.goto('/community')
  const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
  await input.fill('从社区搜索')
  await expect(page).toHaveURL('/community')
  await input.press('Enter')
  await expect(page).toHaveURL(/\/discover\?q=/)
  await expect(page.locator('.active-conditions')).toContainText('搜索：从社区搜索')
  await page.goBack()
  await expect(input).toHaveValue('')
})

test('search restores URL queries and does not submit intermediate Chinese composition', async ({ page }) => {
  const queries: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/works' && url.searchParams.has('query')) queries.push(url.searchParams.get('query')!)
  })
  await page.goto('/discover?q=restored')
  const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
  await expect(input).toHaveValue('restored')
  queries.length = 0
  await input.dispatchEvent('compositionstart')
  await input.evaluate(element => {
    const field = element as HTMLInputElement
    field.value = '中文输入'
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '中文输入' }))
  })
  await page.waitForTimeout(240)
  expect(queries).toEqual([])
  const searched = page.waitForRequest(request => new URL(request.url()).searchParams.get('query') === '中文输入')
  await input.dispatchEvent('compositionend')
  await searched
  await expect(page.locator('.active-conditions')).toContainText('搜索：中文输入')
})

test('search, categories and sorting keep independent API behavior', async ({ page }) => {
  await page.goto('/discover')
  const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
  await input.fill('提示词')
  await expect(page.locator('.active-conditions')).toContainText('搜索：提示词')
  await page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '图片', exact: true }).click()
  await page.getByRole('button', { name: 'Skill', exact: true }).click()
  const sorted = page.waitForRequest(request => new URL(request.url()).searchParams.get('sort') === 'latest')
  await page.getByRole('button', { name: '最新', exact: true }).click()
  await sorted
  const cleared = page.waitForRequest(request => {
    const url = new URL(request.url())
    return url.pathname === '/api/works' && url.searchParams.get('sort') === 'latest'
      && url.searchParams.get('kind') === 'image' && !url.searchParams.has('query') && !url.searchParams.has('tag')
  })
  await page.getByRole('button', { name: '清除条件', exact: true }).click()
  await cleared
  await expect(input).toHaveValue('')
  await expect(page.locator('.active-conditions')).toContainText('类型：图片')
  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  await expect(page.getByRole('button', { name: '推荐', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

for (const width of [320, 1440]) {
  test(`tag rail remains keyboard accessible at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    const rail = page.getByRole('region', { name: '类型和标签', exact: true })
    const back = page.getByRole('button', { name: '向前浏览标签', exact: true, includeHidden: true })
    if (width < 1000) {
      await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
      await page.getByRole('button', { name: '筛选', exact: true }).click()
    } else {
      await page.getByRole('button', { name: '向后浏览标签', exact: true }).click()
      await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      await back.click()
    }
    const last = page.getByRole('button', { name: '主题16', exact: true })
    await last.focus()
    await last.press('Enter')
    await expect(last).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '清除条件', exact: true }).first().click()
    await expect(last).toHaveAttribute('aria-pressed', 'false')
  })
}

test('short desktop sidebar scrolls without covering settings and menus close across breakpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 360 })
  await page.goto('/discover')
  const settings = page.locator('.rail-settings')
  await expect(settings).toBeInViewport()
  const launcher = page.getByTitle('社区工具', { exact: true })
  await launcher.click()
  const panel = page.getByRole('dialog', { name: '社区工具', exact: true })
  await expect(panel).toBeVisible()
  const bounds = (await panel.boundingBox())!
  expect(bounds.x).toBe(76)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(360)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(panel).not.toBeVisible()
  await expect(page.getByRole('button', { name: '展开搜索作品', exact: true })).toBeVisible()
  await launcher.click()
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '关闭社区工具', exact: true }).click()
  await expect(launcher).toBeFocused()
})

test('guests keep login and submission destinations', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null } }))
  await page.goto('/discover')
  await expect(page.locator('.header-login')).toBeVisible()
  await page.getByRole('link', { name: '投稿', exact: true }).click()
  await expect(page).toHaveURL(/\/account(?:\?|$)/)
  await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
  await expect(page.locator('.community-rail')).toBeHidden()
  await expect(page.getByRole('searchbox', { name: '搜索作品', exact: true })).toBeHidden()
})

test('mobile categories retain pending search text, independent tags and browser history', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/discover?tag=Skill')
  await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
  const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
  const categories = page.getByRole('navigation', { name: '作品分类', exact: true })
  // Dispatch both actions in one browser task so the debounce cannot mask a lost query.
  await input.evaluate(async element => {
    const field = element as HTMLInputElement
    field.value = '测试保留'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
    document.querySelector<HTMLAnchorElement>('.mobile-discovery-nav a[href*="kind=video"]')!.click()
  })
  await expect(input).toHaveValue('测试保留')
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('测试保留')
  await expect.poll(() => new URL(page.url()).searchParams.get('kind')).toBe('video')
  expect(new URL(page.url()).searchParams.get('tag')).toBe('Skill')
  await categories.getByRole('link', { name: '图片', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('kind')).toBe('image')
  await page.goBack()
  await expect(categories.getByRole('link', { name: '视频', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(input).toHaveValue('测试保留')
  await categories.getByRole('link', { name: 'Skill 与资源', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('kind')).toBe('resource')
  await page.reload()
  await expect(categories.getByRole('link', { name: 'Skill 与资源', exact: true })).toHaveAttribute('aria-current', 'page')
  await categories.getByRole('link', { name: '发现', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.has('kind')).toBe(false)
  expect(new URL(page.url()).searchParams.has('tag')).toBe(false)
  await expect(input).toHaveValue('测试保留')
})

test('mobile menu closes on the current account and supports logout and guest entry', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/account')
  const trigger = page.getByTitle('社区工具', { exact: true })
  const menu = page.getByRole('dialog', { name: '社区工具', exact: true })
  await trigger.click()
  await page.locator('.mobile-account-identity').click()
  await expect(menu).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await menu.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page).toHaveURL('/discover')
  await trigger.click()
  await expect(menu.getByRole('link', { name: '登录章鱼账号', exact: true })).toBeVisible()
  await expect(menu.locator('.account-balance')).toHaveCount(0)
  await menu.getByRole('link', { name: '投稿', exact: true }).click()
  await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
})

test('mobile search submits from other pages and empty tag lists leave no unused filter row', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 })
  await page.route('**/api/tags', route => route.fulfill({ json: { items: [] } }))
  await page.goto('/community')
  await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
  const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
  await expect(input).toBeFocused()
  await input.fill('社区搜索')
  await expect(page).toHaveURL('/community')
  await input.press('Enter')
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('社区搜索')
  await expect(page.locator('.tag-navigation')).toBeHidden()
  await page.getByRole('button', { name: '收起搜索作品', exact: true }).click()
  await expect(page.locator('.active-conditions')).toContainText('社区搜索')
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('社区搜索')
  await expect(page.locator('.mobile-community-header')).toHaveCount(0)
})
