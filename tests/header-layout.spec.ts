import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/session') return route.fulfill({ json: { user: { id: 'layout-user', username: 'creator', name: '布局测试创作者' } } })
    if (path === '/api/tags') return route.fulfill({ json: { items: [{ id: 'tag-1', name: 'Skill' }, ...Array.from({ length: 16 }, (_, index) => ({ id: `tag-${index + 2}`, name: `主题${index + 1}` }))] } })
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
})

for (const width of [320, 390, 639, 640, 768, 1000, 1280, 1440, 1920, 2560]) {
  test(`authenticated header and discovery controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    await expect(page.getByLabel('账号菜单', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '展开搜索作品', exact: true })).toBeVisible()
    expect(await page.getByRole('heading', { name: '首页', exact: true }).evaluate(element => element.getBoundingClientRect().height)).toBe(1)
    await expect(page).toHaveTitle('首页 · 章鱼社区')
    await expect(page.locator('.discover-count')).toHaveCount(0)
    const categories = page.getByRole('group', { name: '作品类型' })
    await expect(categories.getByRole('button')).toHaveCount(4)
    await expect(page.locator('.discovery-toolbar').getByRole('button', { name: '推荐', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const brand = page.locator('.brand')
    await expect(brand).toBeVisible()
    const controls = page.locator('.brand, .header-actions, .browse-modes, .tag-navigation, .header-search-slot')
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
      const tools = await page.locator('.header-tools').boundingBox()
      expect(bounds!.x + bounds!.width + 24).toBeLessThanOrEqual(tools!.x + 1)
      if (width >= 1280) expect(bounds!.x + bounds!.width / 2).toBeCloseTo(width / 2, 1)
    } else {
      await expect(page.getByRole('navigation', { name: '主导航', exact: true })).toBeHidden()
      const nav = page.getByRole('navigation', { name: '手机导航' })
      await expect(nav).toBeVisible()
      await expect(nav.getByRole('link', { name: '首页', exact: true })).toHaveAttribute('aria-current', 'page')
    }
    if (width >= 640) {
      const search = await page.locator('.header-search-slot').boundingBox()
      expect(brandBounds!.x + brandBounds!.width + 24).toBeLessThanOrEqual(search!.x + 1)
      expect(search!.x + search!.width + 8).toBeLessThanOrEqual(actions!.x + 1)
      expect(search!.y + search!.height / 2).toBeCloseTo(actions!.y + actions!.height / 2, 1)
    }
    const navigation = page.getByRole('navigation', { name: width >= 1000 ? '主导航' : '手机导航', exact: true })
    await expect(navigation.getByRole('link', { name: '我的作品', exact: true })).toHaveCount(0)
    await expect(navigation.getByRole('link')).toHaveText(['首页', '推广中心', '社区', '创作台'])
    const studio = navigation.getByRole('link', { name: '创作台', exact: true })
    await expect(studio).toBeVisible()
    await expect(studio).toHaveAttribute('href', '/create')
    if (width >= 1000) {
      await studio.hover()
      await expect(studio).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(studio.locator('svg')).toHaveCount(0)
    }
    await expect(navigation.getByRole('link', { name: '推广中心', exact: true })).toHaveAttribute('href', '/activities')
    const layout = await page.locator('.discovery-toolbar').evaluate(element => ({
      top: element.getBoundingClientRect().top,
      height: element.getBoundingClientRect().height,
      groups: Array.from(element.children).map(child => child.getBoundingClientRect().toJSON()),
    }))
    expect(layout.top).toBeCloseTo(headerBounds!.height + 24, 1)
    expect(layout.height).toBeLessThanOrEqual(width >= 640 ? 57 : 105)
    for (const group of layout.groups) expect(group.height).toBe(36)
    if (width >= 640) {
      expect(new Set(layout.groups.map(group => Math.round(group.y + group.height / 2))).size).toBe(1)
      expect(layout.groups[0].right + 24).toBeLessThanOrEqual(layout.groups[1].left + 1)
    } else if (width < 640) {
      expect(layout.groups[1].top).toBeGreaterThanOrEqual(layout.groups[0].bottom + 12)
    }
    const capsule = await page.locator('.gooey-input').evaluate(element => {
      const root = element.getBoundingClientRect()
      const surface = element.querySelector('.gooey-field-surface')!.getBoundingClientRect()
      return { right: surface.right, rootRight: root.right, width: surface.width, rootWidth: root.width }
    })
    expect(capsule.right).toBeCloseTo(capsule.rootRight, 1)
    expect(capsule.width).toBe(44)
    expect(capsule.rootWidth).toBe(44)
    await expect(page.getByRole('button', { name: '展开搜索作品', exact: true })).toHaveText('')
    await expect(page.getByRole('searchbox', { name: '搜索作品', includeHidden: true })).toBeDisabled()
    await page.getByRole('button', { name: '展开搜索作品', exact: true }).hover()
    await expect(page.locator('.gooey-field-surface')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.app-header .gooey-input')).toHaveCount(1)
    await expect(page.locator('.discovery-toolbar .gooey-input')).toHaveCount(0)
    await expect(page.locator('.app-header .header-submission')).toHaveText('投稿')
    await expect(page.locator('.header-submission svg')).toHaveCount(1)
    await expect(page.locator('.discovery-toolbar').getByRole('link', { name: '投稿', exact: true })).toHaveCount(0)
    await expect(page.locator('.header-submission')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.header-submission')).toHaveCSS('border-top-width', '0px')
    const background = await page.evaluate(() => ({
      page: getComputedStyle(document.documentElement).backgroundColor,
      header: getComputedStyle(document.querySelector('.app-header')!).backgroundColor,
    }))
    expect(background).toEqual({ page: 'rgb(18, 18, 18)', header: 'rgb(18, 18, 18)' })
    const modes = page.getByRole('group', { name: '浏览方式', exact: true })
    await expect(modes.getByRole('button')).toHaveText(['推荐', '最新', '关注'])
    await expect(modes.getByRole('button', { name: '推荐' })).toHaveAttribute('aria-pressed', 'true')
    if ([320, 640, 1280, 1440, 2560].includes(width)) await page.screenshot({ path: test.info().outputPath(`types-collapsed-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const targets = await categories.getByRole('button').evaluateAll(buttons => buttons.map(button => {
      const { width, height } = button.getBoundingClientRect()
      return { width, height }
    }))
    for (const target of targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBe(width < 640 ? 36 : 28) }
    await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
    await expect(page.getByRole('searchbox', { name: '搜索作品' })).toBeFocused()
    expect((await page.locator('.gooey-field').boundingBox())!.width).toBeGreaterThanOrEqual(128)
    if (width >= 1000) {
      const nav = await page.locator('.desktop-nav').boundingBox()
      const search = await page.locator('.gooey-input').boundingBox()
      expect(nav!.x + nav!.width).toBeLessThanOrEqual(search!.x)
    }
    const focus = await page.locator('.gooey-field').evaluate(element => {
      const style = getComputedStyle(element)
      return {
        top: element.getBoundingClientRect().top - parseFloat(style.outlineWidth) - parseFloat(style.outlineOffset),
        bottom: element.getBoundingClientRect().bottom,
        header: document.querySelector('.app-header')!.getBoundingClientRect().toJSON(),
        outlineStyle: style.outlineStyle,
      }
    })
    expect(focus.outlineStyle).toBe('none')
    expect(focus.top).toBeGreaterThanOrEqual(focus.header.top)
    expect(focus.bottom).toBeLessThanOrEqual(focus.header.bottom)
    const accessibility = await new AxeBuilder({ page }).include('.app-header').include('.mobile-nav').include('main').analyze()
    expect(accessibility.violations).toEqual([])
  })
}

for (const width of [320, 1440]) {
  test(`submission opens the existing editor without submitting work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    let writes = 0
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes++ })
    await page.goto('/discover?kind=image&tag=Skill')
    await expect(page.getByLabel('账号菜单', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '投稿', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发布作品', exact: true })).toBeVisible()
    await expect(page).toHaveURL(/publish=1/)
    expect(new URL(page.url()).searchParams.get('kind')).toBe('image')
    expect(new URL(page.url()).searchParams.get('tag')).toBe('Skill')
    await page.getByRole('button', { name: '关闭作品编辑', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发布作品', exact: true })).not.toBeVisible()
    await expect(page).not.toHaveURL(/publish=1/)
    await expect(page.locator('.app-header .gooey-input')).toHaveCount(1)
    expect(writes).toBe(0)
  })
}

test('guests go to login from submission', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null } }))
  await page.goto('/discover')
  await expect(page.locator('.header-actions').getByRole('link', { name: '登录', exact: true })).toBeVisible()
  const submission = await page.getByRole('link', { name: '投稿', exact: true }).boundingBox()
  const login = await page.locator('.header-login').boundingBox()
  expect(submission!.x + submission!.width).toBeLessThanOrEqual(login!.x)
  const searchIcon = await page.locator('.gooey-search-icon').boundingBox()
  const submissionIcon = await page.locator('.submission-icon').boundingBox()
  const submissionLabel = await page.locator('.submission-label').boundingBox()
  expect(submissionIcon!.x - searchIcon!.x - searchIcon!.width).toBeCloseTo(login!.x - submissionLabel!.x - submissionLabel!.width, 1)
  await page.getByRole('link', { name: '投稿', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('form', { name: '登录社区', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '发布作品', exact: true })).not.toBeVisible()
})

test('search, categories, tags and sorting keep their API behavior', async ({ page }) => {
  await page.goto('/discover')
  await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
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
  await page.getByRole('button', { name: 'Skill', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Skill', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const sorted = page.waitForRequest(request => new URL(request.url()).searchParams.get('sort') === 'latest')
  await page.getByRole('button', { name: '最新', exact: true }).click()
  await sorted
  await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
  await query.fill('保留当前浏览方式')
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
  await expect(page.getByRole('button', { name: '最新', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const reset = page.waitForRequest(request => {
    const url = new URL(request.url())
    return url.pathname === '/api/works' && url.searchParams.get('sort') === 'featured' && !url.searchParams.has('kind')
  })
  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  await reset
  await expect(page.getByRole('button', { name: '推荐', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

for (const width of [320, 1440]) {
  test(`gooey search supports keyboard, persistent queries and clearing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover?kind=image&tag=Skill')
    const trigger = page.getByRole('button', { name: '展开搜索作品', exact: true })
    const filter = page.getByRole('group', { name: '浏览方式', exact: true }).getByRole('button', { name: '推荐', exact: true })
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
    expect(await filter.boundingBox()).toEqual({ ...before!, y: before!.y + (width < 640 ? 56 : 0) })
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
    expect(await filter.boundingBox()).toEqual(before)
  })
}

for (const width of [320, 1440]) {
  test(`tag rail scrolls in both directions and keeps selected tags at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    const rail = page.getByRole('region', { name: '类型和标签', exact: true })
    const back = page.getByRole('button', { name: '向前浏览标签', exact: true, includeHidden: true })
    const forward = page.getByRole('button', { name: '向后浏览标签', exact: true, includeHidden: true })
    await expect(back).toBeDisabled()
    await forward.click()
    await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    await expect(back).toBeEnabled()
    const before = await rail.evaluate(element => element.scrollLeft)
    await back.click()
    await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBeLessThan(before)
    const last = page.getByRole('button', { name: '主题16', exact: true })
    await last.focus()
    await last.press('Enter')
    await expect(last).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.active-conditions')).toContainText('标签：主题16')
    await expect(forward).toBeDisabled()
    await page.getByRole('button', { name: '清除条件', exact: true }).click()
    await expect(last).toHaveAttribute('aria-pressed', 'false')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
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
  await page.getByRole('button', { name: '最新', exact: true }).focus()
  await expect(page.getByRole('button', { name: '展开搜索作品', exact: true })).toBeVisible()
})

test('gooey search waits for Chinese input composition before searching', async ({ page }) => {
  const queries: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname === '/api/works' && url.searchParams.has('query')) queries.push(url.searchParams.get('query')!)
  })
  await page.goto('/discover')
  await page.getByRole('button', { name: '展开搜索作品', exact: true }).click()
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
  test(`${kind} filtering is available in the tag rail and can be cleared from all`, async ({ page }) => {
    await page.goto('/discover')
    const selected = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.pathname === '/api/works' && url.searchParams.get('kind') === kind
    })
    const category = page.getByRole('group', { name: '作品类型' }).getByRole('button', { name: new RegExp(`^${label}`) })
    await category.click()
    await selected
    await expect(category).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.active-conditions')).toHaveText(`类型：${label}`)
    const cleared = page.waitForRequest(request => {
      const url = new URL(request.url())
      return url.pathname === '/api/works' && !url.searchParams.has('kind')
    })
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await cleared
    await expect(page.locator('.active-conditions')).toHaveCount(0)
  })
}

for (const width of [320, 1440]) {
  test(`account menu uses the personal profile entry at ${width}px`, async ({ page }) => {
    const user = { id: '3', username: 'root', name: 'root', bio: '', isAdmin: false, isModerator: false }
    await page.route('**/api/session', route => route.request().method() === 'GET' ? route.fulfill({ json: { user } }) : route.fallback())
    await page.route('**/api/users/3', route => route.request().method() === 'GET' ? route.fulfill({ json: {
      user: { ...user, count: 0, followed: false, followersCount: 0, followingCount: 0, receivedLikesCount: 0 },
    } }) : route.fallback())
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    const menu = page.getByLabel('账号菜单', { exact: true })
    const popover = page.locator('.account-popover')
    await menu.focus()
    await menu.press('Enter')
    await expect(popover.getByRole('link', { name: '我的作品', exact: true })).toHaveCount(0)
    await expect(popover.getByRole('link', { name: '我的收藏', exact: true })).toHaveCount(0)
    await expect(popover.getByRole('link', { name: '私信', exact: true })).toHaveCount(0)
    for (const name of ['个人主页', '账号设置']) await expect(popover.getByRole('link', { name, exact: true })).toBeVisible()
    await expect(popover.getByRole('button', { name: '退出登录', exact: true })).toBeVisible()
    const profile = popover.getByRole('link', { name: '个人主页', exact: true })
    await expect(profile).toHaveAttribute('href', '/community?creator=3')
    await profile.click()
    await expect(page).toHaveURL('/community?creator=3')
    await expect(page.locator('.profile-copy h1')).toHaveText('root')
    await expect(page.locator('.profile-menu')).not.toHaveAttribute('open', '')
    await menu.focus()
    await menu.press('Enter')
    await expect(popover).toBeVisible()
    await expect(profile).toHaveAttribute('href', '/community?creator=3')
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
  await expect(page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '创作台', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关注', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录后查看关注的作品', exact: true })).toBeVisible()
  await expect(page.locator('.empty-state').getByRole('link', { name: '登录', exact: true })).toHaveAttribute('href', '/account')
  expect(followingRequests).toBe(0)
})
