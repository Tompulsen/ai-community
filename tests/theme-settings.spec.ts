import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

const key = 'ai-community-next:appearance:v1'
test.beforeEach(async ({ page }) => { await mockUnifiedAccount(page, true) })

test('themes apply immediately and retain separate light/dark palettes after reload', async ({ page }) => {
  await page.goto('/account?tab=theme')
  await expect(page.getByRole('heading', { name: '主题与外观' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sage')
  await page.getByRole('radio', { name: '明亮模式', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')
  await page.getByRole('radio', { name: '暖纸', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f0e5')
  await page.getByRole('radio', { name: '暗色模式', exact: true }).check()
  await page.getByRole('radio', { name: '深海青', exact: true }).check()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'jade')
  await page.getByRole('radio', { name: '明亮模式', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper')
  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sage')
})

test('system changes are live until the user selects a fixed mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/account?tab=theme')
  await page.getByRole('radio', { name: '跟随系统' }).check()
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark')
  await page.getByRole('radio', { name: '明亮模式', exact: true }).check()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')
})

test('schedule switches at the boundary and reconciles after sleep', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 14, 18, 59, 45) })
  await page.goto('/account?tab=theme')
  await page.getByRole('radio', { name: '定时切换' }).check()
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')
  await page.clock.runFor(16000)
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark')
  await page.clock.setSystemTime(new Date(2026, 10, 15, 7, 0, 0))
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')
})

test('overnight schedules work and invalid/equal times never replace saved preferences', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 14, 12, 0, 0) })
  await page.goto('/account?tab=theme')
  await page.getByRole('radio', { name: '定时切换' }).check()
  const light = page.getByLabel('切换到明亮模式', { exact: true }), dark = page.getByLabel('切换到暗色模式', { exact: true })
  await light.fill('20:00'); await dark.fill('08:00')
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark')
  await page.clock.setSystemTime(new Date(2026, 10, 14, 22, 0, 0))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')
  await dark.fill('20:00')
  await expect(page.getByRole('alert')).toContainText('两个不同的有效时间')
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).toMatchObject({ lightStart: '20:00', darkStart: '08:00' })
  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  await page.getByRole('radio', { name: '定时切换' }).check()
  await expect(light).toHaveValue('07:00'); await expect(dark).toHaveValue('19:00')
})

test('saved theme is applied before the application bundle loads', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ mode: 'light', light: 'mist' })), key)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/src/main.ts', async route => { await held; await route.continue() })
  await page.goto('/account?tab=theme', { waitUntil: 'commit' })
  try {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'mist')
    expect(await page.locator('#app').innerHTML()).toBe('')
  } finally { release() }
  await expect(page.getByRole('heading', { name: '主题与外观' })).toBeVisible()
})

test('other tabs receive theme changes and corrupt storage falls back safely', async ({ page, context }) => {
  await page.addInitScript(key => { if (!localStorage.getItem(key)) localStorage.setItem(key, '{invalid') }, key)
  await page.goto('/account?tab=theme')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sage')
  const other = await context.newPage(); await mockUnifiedAccount(other, true)
  await other.goto('/account?tab=theme')
  await page.getByRole('radio', { name: '明亮模式', exact: true }).check()
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'cloud')
  await expect(other.getByRole('radio', { name: '明亮模式', exact: true })).toBeChecked()
  await other.close()
})

test('blocked preference storage keeps current theme usable and explains persistence failure', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError') } })
  await page.goto('/account?tab=theme')
  await page.getByRole('radio', { name: '明亮模式', exact: true }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'cloud')
  await expect(page.getByRole('alert')).toContainText('无法保存偏好')
})

test('all palettes provide accessible controls on desktop and mobile', async ({ page }) => {
  await page.goto('/account?tab=theme')
  for (const [mode, palettes] of [['明亮模式', ['云白', '暖纸', '晴空']], ['暗色模式', ['炭灰鼠尾草', '午夜蓝', '深海青']]] as const) {
    await page.getByRole('radio', { name: mode, exact: true }).check()
    for (const name of palettes) {
      await page.getByRole('radio', { name, exact: true }).check()
      expect((await new AxeBuilder({ page }).include('.theme-settings').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    }
  }
  await page.screenshot({ path: 'test-results/theme-desktop-dark.png', fullPage: true })
  await page.getByRole('radio', { name: '明亮模式', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light')
  await page.screenshot({ path: 'test-results/theme-desktop-light.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('radio', { name: '定时切换' }).check()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.theme-settings').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  await page.screenshot({ path: 'test-results/theme-mobile.png', fullPage: true })
})

test('light palettes keep resource text readable and media overlays bright', async ({ page }) => {
  const work = { id: 'themeResource', authorId: '25', author: '作品作者', avatar: '作', title: '主题适配创作笔记', kind: 'resource', body: '可阅读的创作经验与参考资料。', cover: '', tags: [], likes: 2, liked: true, saved: false, status: 'published', date: '2026-11-14T00:00:00Z' }
  await page.route('**/api/works?*', route => route.fulfill({ json: { items: [work, { ...work, id: 'themeImage', kind: 'image', title: '主题适配图片', cover: '/assets/brand/octopus-community.jpg' }], nextCursor: null } }))
  await page.goto('/account?tab=theme')
  await page.getByRole('radio', { name: '明亮模式', exact: true }).check()
  await page.locator('a[href="/discover"]').first().click()
  await expect(page.locator('[data-work-id="themeResource"]')).toBeVisible()
  for (const palette of ['cloud', 'paper', 'mist']) {
    await page.evaluate(light => window.communityAppearance.set({ light }), palette)
    expect((await new AxeBuilder({ page }).include('.works-grid').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    await expect(page.locator('[data-work-id="themeImage"] .work-title')).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(page.locator('[data-work-id="themeImage"] .like-button.selected')).toHaveCSS('color', 'rgb(174, 194, 168)')
  }
  await page.screenshot({ path: 'test-results/theme-gallery-light.png', fullPage: true })
})
