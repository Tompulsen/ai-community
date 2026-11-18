import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function expectRail(page: Page) {
  const rail = page.getByRole('complementary', { name: '社区侧栏' })
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveCount(4)
  await expect(rail.getByRole('link', { name: '首页', exact: true })).toBeVisible()
  await expect(rail.getByTitle('社区工具', { exact: true })).toBeVisible()
  await expect(rail.getByTitle('消息', { exact: true })).toBeVisible()
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

for (const mode of ['light', 'dark']) {
  test(`rail icons have hover names and consistent targets in ${mode} mode`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await page.addInitScript(mode => {
      localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode }))
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
    const controls = rail.locator('.nav-link, .tools-trigger, .header-submission, .message-trigger, .rail-settings')
    await expect(controls).toHaveCount(8)
    for (const control of await controls.all()) {
      const title = await control.getAttribute('title')
      expect(title).toBeTruthy()
      expect(await control.getAttribute('aria-label')).toContain(title)
      await expect(control.locator('.rail-label')).toBeHidden()
      const box = (await control.boundingBox())!
      expect(box.width).toBe(48)
      expect(box.height).toBe(48)
      expect(await control.locator('svg').evaluate(element => {
        const box = element.getBoundingClientRect()
        return [box.width, box.height, getComputedStyle(element).strokeWidth, element.getAttribute('aria-hidden')]
      })).toEqual([22, 22, '1.8px', 'true'])
    }
    const current = rail.getByRole('link', { name: '首页', exact: true })
    await expect(current).toHaveAttribute('aria-current', 'page')
    expect(await current.evaluate(element => getComputedStyle(element, '::after').display)).toBe('block')
    expect(await rail.locator('.header-submission').evaluate(element => getComputedStyle(element, '::after').content)).toBe('none')
    await expect(rail.locator('.message-count')).toHaveText('99+')
    const badge = (await rail.locator('.message-count').boundingBox())!
    const trigger = (await rail.locator('.message-trigger').boundingBox())!
    expect(badge.x + badge.width).toBeLessThanOrEqual(trigger.x + trigger.width)
    expect(badge.y).toBeGreaterThanOrEqual(trigger.y)
    await current.focus()
    await page.keyboard.press('Tab')
    await expect(rail.getByRole('link', { name: '福利中心', exact: true })).toBeFocused()
    const result = await new AxeBuilder({ page }).include('.community-rail').analyze()
    expect(result.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) }))).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`community-rail-${mode}.png`) })
    await rail.getByRole('link', { name: '账号设置', exact: true }).click()
    await expect(rail.getByRole('link', { name: '账号设置', exact: true })).toHaveAttribute('aria-current', 'page')
  })
}
