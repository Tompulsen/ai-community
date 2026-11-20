import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function expectRail(page: Page) {
  const rail = page.getByRole('complementary', { name: '社区侧栏' })
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveCount(3)
  await expect(rail.getByRole('link', { name: '首页', exact: true })).toBeVisible()
  await expect(rail.getByTitle('社区工具', { exact: true })).toBeVisible()
  await expect(rail.getByTitle('消息', { exact: true })).toHaveCount(0)
  await expect(rail.getByRole('link', { name: '福利中心', exact: true })).toHaveCount(0)
  await expect(page.locator('.header-actions').getByTitle('消息', { exact: true })).toBeVisible()
  await expect(page.locator('.header-actions').getByRole('link', { name: '福利中心', exact: true })).toBeVisible()
}

for (const initialPath of ['/discover', '/create/text']) {
  test(`community rail survives Studio round trips from ${initialPath}`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await page.goto(initialPath)
    if (initialPath === '/create/text') {
      await page.locator('.studio-sidebar').getByRole('link', { name: '探索社区', exact: true }).click()
    }
    await expectRail(page)
    for (let trip = 0; trip < 2; trip++) {
      await page.locator('.community-rail').getByRole('link', { name: '创作台', exact: true }).click()
      await expect(page.locator('.studio-sidebar')).toBeVisible()
      await expect(page.locator('.community-rail')).toBeHidden()
      if (trip === 0) await page.goBack()
      else await page.locator('.studio-sidebar').getByRole('link', { name: '探索社区', exact: true }).click()
      await expectRail(page)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('.community-rail')).toBeHidden()
    await expect(page.locator('.mobile-community-header')).toBeVisible()
    await expect(page.locator('.mobile-nav a[href="/messages"]')).toBeVisible()
    await page.getByTitle('社区工具', { exact: true }).click()
    await expect(page.getByRole('dialog', { name: '社区工具', exact: true }).getByRole('link', { name: '福利中心', exact: true })).toHaveAttribute('href', '/activities')
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expectRail(page)
    await page.screenshot({ path: test.info().outputPath('community-rail-restored.png') })
  })
}

test('guest login entry returns to a complete community rail', async ({ page }) => {
  await mockUnifiedAccount(page)
  await page.goto('/discover')
  await expectRail(page)
  await page.locator('.community-rail').getByRole('link', { name: '账号设置', exact: true }).click()
  await expect(page.locator('.community-rail')).toBeHidden()
  await page.getByRole('link', { name: '浏览社区', exact: true }).click()
  await expectRail(page)
})

for (const mode of ['light', 'dark'] as const) {
  test('guest login stays readable on hover and keyboard focus in ' + mode, async ({ page }) => {
    await mockUnifiedAccount(page)
    await page.goto('/discover')
    await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
    const login = page.locator('.header-login')
    await expect(login).toBeVisible()
    const resting = await login.boundingBox()
    for (const state of ['hover', 'focus', 'rest']) {
      if (state === 'hover') await login.hover()
      else { await page.mouse.move(400, 80); if (state === 'focus') await login.focus(); else await login.blur() }
      await login.evaluate(element => element.getAnimations().forEach(animation => animation.finish()))
      await expect(login).toHaveText('登录')
      expect(await login.boundingBox()).toEqual(resting)
      expect((await new AxeBuilder({ page }).include('.header-login').withRules(['color-contrast']).analyze()).violations).toEqual([])
      if (state === 'hover') await page.screenshot({ path: test.info().outputPath('login-hover-' + mode + '.png') })
    }
    await login.click()
    await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
  })
}

for (const mode of ['light', 'dark']) {
  test(`rail icons have hover names and consistent targets in ${mode} mode`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await page.addInitScript(mode => {
      if (!localStorage.getItem('ai-community-next:appearance:v1')) localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'paper', dark: 'jade' }))
    }, mode)
    await page.route('**/api/notifications', route => route.fulfill({ json: {
      items: [], unreadCounts: { announcement: 2, activity: 7, messages: 135 },
    } }))
    await page.route('**/api/messages/threads', route => route.fulfill({ json: {
      items: [], unreadCount: 135, nextCursor: null,
    } }))
    await page.goto('/discover')
    await expectRail(page)
    const rail = page.locator('.community-rail')
    const controls = rail.locator('.nav-link, .tools-trigger, .header-submission, .rail-settings, .rail-theme, .rail-toggle')
    await expect(controls).toHaveCount(7)
    for (const control of await controls.all()) {
      const title = await control.getAttribute('title')
      expect(title).toBeTruthy()
      expect(await control.getAttribute('aria-label')).toContain(title)
      await expect(control.locator('.rail-label')).toBeHidden()
      const box = (await control.boundingBox())!
      expect(box.width).toBe(44)
      expect(box.height).toBe(44)
      expect(await control.locator('svg').evaluate(element => {
        const box = element.getBoundingClientRect()
        return [box.width, box.height, getComputedStyle(element).strokeWidth, element.getAttribute('aria-hidden')]
      })).toEqual([20, 20, '1.8px', 'true'])
    }
    expect(await rail.locator('.rail-brand').evaluate(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element)
      return [box.width, box.height, style.backgroundColor, style.boxShadow, style.borderWidth]
    })).toEqual([44, 44, 'rgba(0, 0, 0, 0)', 'none', '0px'])
    const logo = (await rail.locator('.rail-brand img, .rail-brand-fallback').boundingBox())!
    const search = (await page.locator('.header-search-slot').boundingBox())!
    expect([logo.width, logo.height, logo.y]).toEqual([44, 44, 18])
    const railBox = (await rail.boundingBox())!
    const railCenter = railBox.x + railBox.width / 2
    expect(logo.x + logo.width / 2).toBe(railCenter)
    for (const selector of ['.rail-primary', '.rail-utilities']) {
      const box = (await rail.locator(selector).boundingBox())!
      expect(box.x - railBox.x).toBe(16)
      expect(railBox.x + railBox.width - box.x - box.width).toBe(16)
    }
    const header = (await page.locator('.app-header').boundingBox())!
    expect(logo.y + logo.height / 2).toBe(header.y + header.height / 2)
    expect(search.height).toBe(44)
    expect(search.y).toBeGreaterThan((await page.locator('.discovery-creation').boundingBox())!.y)
    const current = rail.getByRole('link', { name: '首页', exact: true })
    await expect(current).toHaveAttribute('aria-current', 'page')
    expect(await current.evaluate(element => getComputedStyle(element, '::after').display)).toBe('none')
    expect(await current.evaluate(element => {
      const style = getComputedStyle(element)
      return style.backgroundColor !== getComputedStyle(element.parentElement!).backgroundColor && style.boxShadow === 'none'
    })).toBe(true)
    expect(await rail.locator('.header-submission').evaluate(element => getComputedStyle(element, '::after').content)).toBe('none')
    await expect(page.locator('.header-actions .message-count')).toHaveText('99+')
    const badge = (await page.locator('.header-actions .message-count').boundingBox())!
    const trigger = (await page.locator('.header-actions .message-trigger').boundingBox())!
    expect(badge.x + badge.width).toBeLessThanOrEqual(trigger.x + trigger.width)
    expect(badge.y).toBeGreaterThanOrEqual(trigger.y)
    await current.focus()
    await expect(rail.locator('.rail-tooltip')).toHaveText('首页')
    await page.keyboard.press('Escape')
    await expect(rail.locator('.rail-tooltip')).toHaveCount(0)
    await page.keyboard.press('Tab')
    await expect(rail.getByRole('link', { name: '社区', exact: true })).toBeFocused()
    await expect(rail.locator('.rail-tooltip')).toHaveText('社区')
    await page.locator('main').click()
    const toggleLabel = mode === 'dark' ? '切换到明亮模式' : '切换到暗色模式'
    const theme = rail.getByRole('button', { name: toggleLabel, exact: true })
    await theme.hover()
    await expect(rail.locator('.rail-tooltip')).toHaveText(toggleLabel)
    await rail.locator('.rail-tooltip').hover()
    await expect(rail.locator('.rail-tooltip')).toBeVisible()
    await page.keyboard.press('Escape')
    const result = await new AxeBuilder({ page }).include('.community-rail').include('.app-header').analyze()
    expect(result.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) }))).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`community-rail-${mode}.png`) })
    await rail.getByRole('link', { name: '账号设置', exact: true }).click()
    await expect(rail.getByRole('link', { name: '账号设置', exact: true })).toHaveAttribute('aria-current', 'page')
    await theme.click()
    const nextMode = mode === 'dark' ? 'light' : 'dark'
    await expect(page).toHaveURL('http://localhost:18775/account')
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', nextMode)
    await expect(page.locator('html')).toHaveAttribute('data-theme', nextMode === 'dark' ? 'jade' : 'paper')
    const reverseToggle = rail.getByRole('button', { name: mode === 'dark' ? '切换到暗色模式' : '切换到明亮模式', exact: true })
    await expect(reverseToggle).toBeFocused()
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', nextMode)
    await reverseToggle.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', mode)
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode === 'dark' ? 'jade' : 'paper')
    await page.goto('/account?tab=theme')
    await expect(rail.getByRole('link', { name: '账号设置', exact: true })).toHaveAttribute('aria-current', 'page')
  })
}

test('guest theme shortcut overrides automatic modes without leaving discovery', async ({ page }) => {
  await mockUnifiedAccount(page)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/discover')
  for (const mode of ['system', 'schedule'] as const) {
    await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
    const current = await page.locator('html').getAttribute('data-color-scheme')
    const next = current === 'dark' ? 'light' : 'dark'
    await page.locator('.rail-theme').focus()
    await page.keyboard.press('Space')
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', next)
    await expect(page).toHaveURL('http://localhost:18775/discover')
    expect(await page.evaluate(() => window.communityAppearance.settings.mode)).toBe(next)
  }
})

test('continuous rail stays below the logo without floating panels and preserves short-screen and mobile navigation', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.goto('/discover')
  for (const height of [900, 480, 360]) {
    await page.setViewportSize({ width: 1280, height })
    const primary = (await page.locator('.rail-primary').boundingBox())!
    const utilities = (await page.locator('.rail-utilities').boundingBox())!
    const brand = (await page.locator('.rail-heading').boundingBox())!
    const gap = height > 640 ? 24 : 12
    expect(brand.y).toBe(18)
    expect(primary.y).toBe(brand.y + brand.height + gap)
    expect(utilities.y).toBe(primary.y + primary.height + gap)
    expect(utilities.y + utilities.height).toBeLessThanOrEqual(height - 20)
    if (height === 900) expect(height - utilities.y - utilities.height).toBeGreaterThan(200)
    for (const selector of ['.rail-primary', '.rail-utilities']) {
      expect(await page.locator(selector).evaluate(element => {
        const style = getComputedStyle(element)
        return [style.backgroundColor, style.boxShadow]
      })).toEqual(['rgba(0, 0, 0, 0)', 'none'])
    }
    await expect(page.locator('.rail-primary .rail-brand')).toHaveCount(0)
    const publish = page.locator('.community-rail .header-submission')
    await publish.focus()
    await expect(publish).toBeInViewport({ ratio: 1 })
    await page.locator('.community-rail .tools-trigger').click()
    await expect(page.getByRole('dialog', { name: '社区工具', exact: true })).toBeInViewport()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('rail-short-' + height + '.png') })
  }
  await page.locator('.rail-settings').focus()
  await expect(page.locator('.rail-tooltip')).toHaveText('账号设置')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.community-rail')).toBeHidden()
  await expect(page.locator('.rail-tooltip')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '手机导航', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('rail keeps logo and navigation icons stationary while expanding and collapsing', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.goto('/discover')
  const rail = page.locator('.community-rail')
  const controls = rail.locator('.nav-link, .tools-trigger, .header-submission')
  const geometry = () => controls.evaluateAll(elements => elements.map(element => {
    const icon = element.querySelector('svg')!.getBoundingClientRect()
    return { x: icon.x, y: icon.y, width: icon.width, height: icon.height, rowHeight: element.getBoundingClientRect().height }
  }))
  for (const height of [900, 360]) {
    await page.setViewportSize({ width: 1440, height })
    await rail.locator('.rail-scroll').evaluate(element => { element.scrollTop = 0 })
    const collapsed = await geometry()
    const logo = await rail.locator('.rail-brand img, .rail-brand-fallback').boundingBox()
    for (const row of collapsed) expect([row.width, row.height, row.rowHeight]).toEqual([20, 20, 44])
    for (const control of await controls.all()) expect((await control.boundingBox())!.width).toBe(44)
    await rail.getByRole('button', { name: '展开侧栏', exact: true }).click()
    await rail.locator('.rail-scroll').evaluate(element => { element.scrollTop = 0 })
    expect(await geometry()).toEqual(collapsed)
    expect(await rail.locator('.rail-brand img, .rail-brand-fallback').boundingBox()).toEqual(logo)
    for (const control of await controls.all()) expect((await control.boundingBox())!.width).toBe(208)
    await page.screenshot({ path: test.info().outputPath('stable-expanded-' + height + '.png') })
    await rail.getByRole('button', { name: '收起侧栏', exact: true }).click()
    await rail.locator('.rail-scroll').evaluate(element => { element.scrollTop = 0 })
    expect(await geometry()).toEqual(collapsed)
  }
})

test.describe('touchscreen sidebar', () => {
  test.use({ hasTouch: true })
  test('logo expands the sidebar without hover or navigation', async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await page.goto('/community')
    const expand = page.getByRole('button', { name: '展开侧栏', exact: true })
    expect((await expand.boundingBox())!.width).toBe(44)
    await expand.tap()
    await expect(page.getByRole('button', { name: '收起侧栏', exact: true })).toBeFocused()
    await expect(page).toHaveURL('http://localhost:18775/community')
  })
})

for (const mode of ['light', 'dark'] as const) {
  test('expanded sidebar preserves navigation, focus and content space in ' + mode, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await page.route('**/api/site', route => route.fulfill({ json: { brand: '章鱼社区与创作灵感分享平台', logoUrl: '/assets/brand/octopus-community.jpg' } }))
    await page.goto('/discover')
    await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
    const rail = page.getByRole('complementary', { name: '社区侧栏' })
    const brand = rail.getByRole('button', { name: '展开侧栏', exact: true })
    await expect(brand).toHaveClass('rail-brand rail-brand-toggle')
    await expect(rail.locator('.rail-utilities .rail-toggle')).toHaveCount(0)
    const brandBox = await brand.boundingBox()
    const logo = brand.locator('img, .rail-brand-fallback')
    const expandIcon = brand.locator('svg')
    await expect(logo).toHaveCSS('opacity', '1')
    await expect(expandIcon).toHaveCSS('opacity', '0')
    await brand.hover()
    await expect(logo).toHaveCSS('opacity', '0')
    await expect(expandIcon).toHaveCSS('opacity', '1')
    await expect(rail.locator('.rail-tooltip')).toHaveText('展开侧栏')
    expect(await brand.boundingBox()).toEqual(brandBox)
    await page.screenshot({ path: test.info().outputPath('logo-hover-' + mode + '.png') })
    await page.mouse.move(400, 80)
    await expect(logo).toHaveCSS('opacity', '1')
    await brand.focus()
    await expect(expandIcon).toHaveCSS('opacity', '1')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL('http://localhost:18775/discover')
    const collapse = rail.getByRole('button', { name: '收起侧栏', exact: true })
    await expect(collapse).toBeFocused()
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    const home = rail.getByRole('link', { name: '首页', exact: true })
    const settings = rail.getByRole('link', { name: '账号设置', exact: true })
    for (const selector of ['svg', '.rail-label']) {
      expect((await settings.locator(selector).boundingBox())!.x).toBe((await home.locator(selector).boundingBox())!.x)
    }
    const toggleLabel = mode === 'dark' ? '切换到明亮模式' : '切换到暗色模式'
    const theme = rail.getByRole('button', { name: toggleLabel, exact: true })
    await theme.hover()
    await expect(rail.locator('.rail-tooltip')).toHaveText(toggleLabel)
    await rail.locator('.rail-tooltip').hover()
    await expect(rail.locator('.rail-tooltip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(rail.locator('.rail-tooltip')).toHaveCount(0)
    await theme.focus()
    await expect(rail.locator('.rail-tooltip')).toHaveText(toggleLabel)
    await home.focus()
    await expect(rail.locator('.rail-tooltip')).toHaveCount(0)
    expect(await rail.locator('.rail-scroll').evaluate(element => getComputedStyle(element).overscrollBehaviorY)).toBe('contain')
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1000, height: 900 }, { width: 1000, height: 360 }]) {
      await page.setViewportSize(viewport)
      expect((await rail.boundingBox())!.width).toBe(248)
      expect((await page.locator('main').boundingBox())!.x).toBe(248)
      await expect(rail.locator('.rail-brand-label')).toBeVisible()
      expect((await rail.locator('.nav-link').first().boundingBox())!.width).toBe((await rail.locator('.rail-scroll').boundingBox())!.width)
      for (const label of await rail.locator('.nav-link .rail-label').all()) await expect(label).toBeVisible()
      const publish = rail.getByRole('link', { name: '投稿', exact: true })
      await publish.focus()
      await expect(publish).toBeInViewport({ ratio: 1 })
      await rail.getByTitle('社区工具', { exact: true }).click()
      const panel = page.getByRole('dialog', { name: '社区工具', exact: true })
      await expect(panel).toBeInViewport()
      expect((await panel.boundingBox())!.x).toBe(260)
      await page.keyboard.press('Escape')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath('expanded-' + mode + '-' + viewport.width + '-' + viewport.height + '.png') })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await rail.getByRole('link', { name: '社区', exact: true }).click()
    await expect(collapse).toBeVisible()
    await rail.getByRole('link', { name: '创作台', exact: true }).click()
    await expect(rail).toBeHidden()
    await page.locator('.studio-sidebar').getByRole('link', { name: '探索社区', exact: true }).click()
    await expect(collapse).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(rail).toBeHidden()
    await expect(page.getByRole('navigation', { name: '手机导航', exact: true })).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(collapse).toBeVisible()
    expect((await new AxeBuilder({ page }).include('.community-rail').include('.app-header').analyze()).violations).toEqual([])
    await collapse.click()
    const expand = rail.getByRole('button', { name: '展开侧栏', exact: true })
    await expect(expand).toBeFocused()
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect((await page.locator('main').boundingBox())!.x).toBe(92)
    await expect(rail.locator('.nav-link .rail-label').first()).toBeHidden()
    await expand.click()
    await expect(collapse).toBeFocused()
    await collapse.click()
    await page.keyboard.press('Space')
    await expect(collapse).toBeFocused()
  })
}
