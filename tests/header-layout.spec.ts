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

for (const width of [320, 390, 639, 640, 768, 1000, 1440]) {
  test(`authenticated header and discovery controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    await expect(page.getByLabel('账号菜单', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '展开搜索', exact: true })).toBeVisible()
    expect(await page.getByRole('heading', { name: '首页', exact: true }).evaluate(element => element.getBoundingClientRect().height)).toBe(1)
    await expect(page).toHaveTitle('首页 · 章鱼社区')
    await expect(page.locator('.discover-count')).toHaveCount(0)
    const categories = page.getByRole('group', { name: '作品类型' })
    await expect(categories).toHaveCount(0)
    await expect(page.locator('.discovery-toolbar').getByRole('button', { name: '推荐', exact: true })).toBeVisible()
    await expect(page.locator('.discovery-toolbar .category-tabs')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const brand = page.locator('.brand')
    await expect(brand).toBeVisible()
    const controls = page.locator('.brand, .header-actions, .discover-filters, .discover-search, .sort-control')
    for (const control of await controls.all()) {
      const bounds = await control.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    const brandBounds = await brand.boundingBox()
    const actions = await page.locator('.header-actions').boundingBox()
    expect(brandBounds!.x + brandBounds!.width).toBeLessThanOrEqual(actions!.x)
    const headerBounds = await page.locator('.app-header').boundingBox()
    expect(headerBounds!.x).toBe(0)
    expect(headerBounds!.width).toBe(width)
    if (width >= 1000) {
      await expect(page.getByRole('navigation', { name: '手机导航' })).toBeHidden()
      const nav = page.getByRole('navigation', { name: '主导航', exact: true })
      await expect(nav).toBeVisible()
      await expect(nav.getByRole('link', { name: '首页', exact: true })).toHaveAttribute('aria-current', 'page')
      const bounds = await nav.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(brandBounds!.x + brandBounds!.width)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(actions!.x)
    } else {
      await expect(page.getByRole('navigation', { name: '主导航', exact: true })).toBeHidden()
      const nav = page.getByRole('navigation', { name: '手机导航' })
      await expect(nav).toBeVisible()
      await expect(nav.getByRole('link', { name: '首页', exact: true })).toHaveAttribute('aria-current', 'page')
    }
    const navigation = page.getByRole('navigation', { name: width >= 1000 ? '主导航' : '手机导航', exact: true })
    await expect(navigation.getByRole('link', { name: '我的作品', exact: true })).toHaveCount(0)
    await expect(navigation.getByRole('link')).toHaveCount(width >= 1000 ? 3 : 4)
    const studio = width >= 1000 ? page.locator('.header-create') : navigation.getByRole('link', { name: '创作台', exact: true })
    await expect(studio).toBeVisible()
    await expect(studio).toHaveAttribute('href', '/create')
    await expect(navigation.getByRole('link', { name: '推广中心', exact: true })).toHaveAttribute('href', '/activities')
    const layout = await page.locator('.discovery-toolbar').evaluate(element => ({
      top: element.getBoundingClientRect().top,
      height: element.getBoundingClientRect().height,
      groups: Array.from(element.children).map(child => child.getBoundingClientRect().toJSON()),
    }))
    expect(layout.top).toBeLessThanOrEqual(width >= 1000 ? 104 : 96)
    expect(layout.height).toBeLessThanOrEqual(width >= 1000 ? 68 : 132)
    if (width >= 640) {
      expect(new Set(layout.groups.map(group => Math.round(group.y))).size).toBe(1)
      expect(layout.groups[0].right + 24).toBeLessThanOrEqual(layout.groups[1].left + 1)
    } else {
      expect(layout.groups[1].top).toBeGreaterThanOrEqual(layout.groups[0].bottom + 12)
    }
    const capsule = await page.locator('.gooey-input').evaluate(element => {
      const root = element.getBoundingClientRect()
      const surface = element.querySelector('.gooey-field-surface')!.getBoundingClientRect()
      return { right: surface.right, rootRight: root.right, width: surface.width, rootWidth: root.width }
    })
    expect(capsule.right).toBeCloseTo(capsule.rootRight, 1)
    expect(capsule.width).toBeCloseTo(width < 640 ? capsule.rootWidth : 128, 1)
    const tabOrder = await page.locator('.discovery-toolbar button, .discovery-toolbar select').evaluateAll(controls => controls
      .filter(control => (control as HTMLElement).offsetWidth > 0)
      .map(control => control.getAttribute('aria-label') || control.textContent?.trim()))
    expect(tabOrder).toEqual(['推荐', '标签', '浏览方式', '展开搜索'])
    if ([320, 640, 1440].includes(width)) await page.screenshot({ path: test.info().outputPath(`types-collapsed-${width}.png`) })
    await page.getByRole('button', { name: '标签', exact: true }).click()
    await expect(categories.getByRole('button')).toHaveCount(3)
    await expect(categories.getByRole('button', { name: /资源/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const targets = await categories.getByRole('button').evaluateAll(buttons => buttons.map(button => {
      const { width, height } = button.getBoundingClientRect()
      return { width, height }
    }))
    for (const target of targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44) }
    if ([320, 640, 1440].includes(width)) await page.screenshot({ path: test.info().outputPath(`types-expanded-${width}.png`) })
    await page.getByRole('button', { name: '展开搜索', exact: true }).click()
    await expect(page.getByRole('searchbox', { name: '搜索作品' })).toBeFocused()
    const focus = await page.locator('.gooey-field').evaluate(element => {
      const style = getComputedStyle(element)
      return {
        top: element.getBoundingClientRect().top - parseFloat(style.outlineWidth) - parseFloat(style.outlineOffset),
        headerBottom: document.querySelector('.app-header')!.getBoundingClientRect().bottom,
        outlineStyle: style.outlineStyle,
      }
    })
    expect(focus.outlineStyle).toBe('none')
    expect(focus.top).toBeGreaterThanOrEqual(focus.headerBottom)
    const accessibility = await new AxeBuilder({ page }).include('.app-header').include('.mobile-nav').include('main').analyze()
    expect(accessibility.violations).toEqual([])
  })
}

test('search, categories, tags and sorting keep their API behavior', async ({ page }) => {
  await page.goto('/discover')
  await page.getByRole('button', { name: '展开搜索', exact: true }).click()
  const query = page.getByRole('searchbox', { name: '搜索作品' })
  const search = page.waitForRequest(request => new URL(request.url()).searchParams.get('query') === '中文提示词')
  await query.fill('中文提示词')
  await search
  await expect(page).toHaveURL(/q=/)
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await expect(query).toHaveValue('')
  const filter = page.locator('.filter-toggle')
  await filter.click()
  await expect(filter).toHaveAttribute('aria-expanded', 'true')
  const category = page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: '图片', exact: true })
  const imageRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/works' && new URL(request.url()).searchParams.get('kind') === 'image')
  await category.click()
  await imageRequest
  await expect(category).toHaveAttribute('aria-pressed', 'true')
  await expect(filter).toHaveText('标签1')
  await page.getByRole('button', { name: 'Skill', exact: true }).click()
  await expect(page.getByRole('button', { name: '标签 2', exact: true })).toBeVisible()
  const sorted = page.waitForRequest(request => new URL(request.url()).searchParams.get('sort') === 'latest')
  await page.getByLabel('浏览方式', { exact: true }).selectOption('latest')
  await sorted
  await page.getByRole('button', { name: '展开搜索', exact: true }).click()
  await query.fill('保留当前浏览方式')
  await filter.click()
  await expect(page.locator('#discover-tags')).toHaveCount(0)
  await expect(page.locator('.active-conditions')).toContainText('标签：Skill')
  await expect(page.locator('.active-conditions')).toContainText('类型：图片')
  const cleared = page.waitForRequest(request => {
    const url = new URL(request.url())
    return url.pathname === '/api/works' && url.searchParams.get('sort') === 'latest' && url.searchParams.get('kind') === 'image' && !url.searchParams.has('query') && !url.searchParams.has('tag')
  })
  await page.getByRole('button', { name: '清除条件', exact: true }).click()
  await cleared
  await expect(page.locator('.gooey-input input')).toHaveValue('')
  await expect(page.locator('.active-conditions')).toContainText('类型：图片')
  await expect(filter).toHaveText('标签1')
  await expect(page.getByLabel('浏览方式', { exact: true })).toHaveValue('latest')
  const reset = page.waitForRequest(request => {
    const url = new URL(request.url())
    return url.pathname === '/api/works' && url.searchParams.get('sort') === 'featured' && !url.searchParams.has('kind')
  })
  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  await reset
  await expect(page.getByLabel('浏览方式', { exact: true })).toHaveValue('featured')
  await expect(page.getByRole('button', { name: '推荐', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(filter).toHaveText('标签')
})

for (const width of [320, 1440]) {
  test(`gooey search supports keyboard, persistent queries and clearing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover?kind=image&tag=Skill')
    const trigger = page.getByRole('button', { name: '展开搜索', exact: true })
    const filter = page.locator('.filter-toggle')
    const before = await filter.boundingBox()
    const origin = await page.locator('.gooey-input').evaluate(element => ({
      field: parseFloat(getComputedStyle(element.querySelector('.gooey-field-surface')!).left),
      bubble: parseFloat(getComputedStyle(element.querySelector('.gooey-bubble')!).left),
    }))
    expect(origin.bubble).toBeCloseTo(origin.field, 1)
    await trigger.focus()
    await trigger.press('Enter')
    const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
    await expect(input).toBeFocused()
    await page.locator('.gooey-input').evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
    })
    expect(await filter.boundingBox()).toEqual(before)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`gooey-expanded-${width}.png`) })
    const searched = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.pathname === '/api/works' && url.searchParams.get('query') === '中文搜索' && url.searchParams.get('kind') === 'image' && url.searchParams.get('tag') === 'Skill'
    })
    await input.fill('中文搜索')
    await searched
    await filter.click()
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('中文搜索')
    const cleared = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.pathname === '/api/works' && !url.searchParams.has('query') && url.searchParams.get('kind') === 'image' && url.searchParams.get('tag') === 'Skill'
    })
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await cleared
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    await input.press('Escape')
    await expect(trigger).toBeVisible()
    await expect(trigger).toBeFocused()
    await expect(page.locator('.gooey-input input')).toBeDisabled()
  })
}

test('gooey search restores URL queries and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/discover?q=${encodeURIComponent('预设搜索')}`)
  const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
  await expect(input).toHaveValue('预设搜索')
  await expect(input).toBeEnabled()
  const motion = await page.locator('.gooey-input').evaluate(element => ({
    filter: getComputedStyle(element.querySelector('.gooey-surfaces')!).filter,
    transitions: Array.from(element.querySelectorAll('.gooey-field-surface, .gooey-bubble, .gooey-search-icon, .gooey-field')).map(item => getComputedStyle(item).transitionDuration),
  }))
  expect(motion.filter).toBe('none')
  expect(motion.transitions.every(duration => duration === '0s')).toBe(true)
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await expect(input).toBeFocused()
  await page.getByLabel('浏览方式', { exact: true }).focus()
  await expect(page.getByRole('button', { name: '展开搜索', exact: true })).toBeVisible()
})

test('gooey search waits for Chinese input composition before searching', async ({ page }) => {
  const queries: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/works' && url.searchParams.has('query')) queries.push(url.searchParams.get('query')!)
  })
  await page.goto('/discover')
  await page.getByRole('button', { name: '展开搜索', exact: true }).click()
  const input = page.getByRole('searchbox', { name: '搜索作品', exact: true })
  await input.dispatchEvent('compositionstart')
  await input.evaluate(element => {
    const field = element as HTMLInputElement
    field.value = '中文输入'
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '中文输入' }))
  })
  await page.waitForTimeout(220)
  expect(queries).toEqual([])
  const searched = page.waitForRequest(request => new URL(request.url()).searchParams.get('query') === '中文输入')
  await input.dispatchEvent('compositionend')
  await searched
  await expect(page.locator('.active-conditions')).toContainText('搜索：中文输入')
})

for (const [kind, label] of [['image', '图片'], ['video', '视频'], ['resource', '资源']]) {
  test(`${kind} filtering is available inside tags and can be cleared from recommendations`, async ({ page }) => {
    await page.goto('/discover')
    const filter = page.locator('.filter-toggle')
    await filter.click()
    const selected = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.pathname === '/api/works' && url.searchParams.get('kind') === kind
    })
    const category = page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: new RegExp(`^${label}`) })
    await category.click()
    await selected
    await expect(category).toHaveAttribute('aria-pressed', 'true')
    await filter.click()
    await expect(page.getByRole('group', { name: '作品类型' })).toHaveCount(0)
    await expect(page.locator('.active-conditions')).toHaveText(`类型：${label}`)
    await expect(filter).toHaveText('标签1')
    const cleared = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.pathname === '/api/works' && !url.searchParams.has('kind')
    })
    await page.getByRole('button', { name: '推荐', exact: true }).click()
    await cleared
    await expect(page.locator('.active-conditions')).toHaveCount(0)
    await expect(filter).toHaveText('标签')
  })
}

for (const width of [320, 1440]) {
  test(`personal works remain reachable through the account menu at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    const menu = page.getByLabel('账号菜单', { exact: true })
    await menu.focus()
    await menu.press('Enter')
    await expect(page.locator('.account-popover').getByRole('link', { name: '我的收藏', exact: true })).toBeVisible()
    await page.locator('.account-popover').getByRole('link', { name: '我的作品', exact: true }).click()
    await expect(page).toHaveURL(/\/library$/)
    await expect(page.locator('.profile-menu')).not.toHaveAttribute('open', '')
    await menu.press('Enter')
    await expect(page.locator('.account-popover').getByRole('link', { name: '我的作品', exact: true })).toHaveAttribute('aria-current', 'page')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await menu.press('Escape')
    await expect(menu).toBeFocused()
    await expect(page.locator('.profile-menu')).not.toHaveAttribute('open', '')
  })
}

test('guests can find the studio and are asked to log in before viewing followed works', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null } }))
  let followingRequests = 0
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/works' && url.searchParams.get('sort') === 'following') followingRequests++
  })
  await page.goto('/discover')
  await expect(page.locator('.header-create')).toBeVisible()
  await page.getByLabel('浏览方式', { exact: true }).selectOption('following')
  await expect(page.getByRole('heading', { name: '登录后查看关注的作品', exact: true })).toBeVisible()
  await expect(page.locator('.empty-state').getByRole('link', { name: '登录', exact: true })).toHaveAttribute('href', '/account')
  expect(followingRequests).toBe(0)
})
