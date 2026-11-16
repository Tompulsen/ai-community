import { chromium, expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const width of [1440, 390, 320]) {
  test(`account navigation keeps its layout stable at ${width}px`, async ({ launchOptions, baseURL }) => {
    const browser = await chromium.launch({
      ...launchOptions,
      headless: true,
      ignoreDefaultArgs: ['--hide-scrollbars'],
      args: [...(launchOptions.args || []), '--disable-features=OverlayScrollbar,OverlayScrollbars'],
    })
    let release = () => {}
    try {
      const page = await browser.newPage({ baseURL, viewport: { width, height: 1000 } })
      await mockUnifiedAccount(page, true)
      const pending = new Promise<void>(resolve => { release = resolve })
      await page.route('**/api/security/**', async route => { await pending; await route.fallback() })
      await page.goto('/discover')
      await expect(page.getByLabel('账号菜单', { exact: true })).toBeVisible()
      const entry = (await page.locator('.profile-toggle').boundingBox())!
      await page.getByLabel('账号菜单', { exact: true }).click()
      await page.getByRole('link', { name: '账号设置', exact: true }).click()
      await expect(page.getByLabel('社区昵称', { exact: true })).toHaveValue('测试创作者')
      expect.soft((await page.locator('.profile-toggle').boundingBox())!.x).toBeCloseTo(entry.x, 1)

      const geometry = () => page.evaluate(() => ({
        scrollY,
        boxes: ['.header-inner', '.page-heading', '.settings-sidebar', '.settings-main'].map(selector => {
          const rect = document.querySelector(selector)!.getBoundingClientRect()
          return [rect.x, rect.y, rect.width].map(value => Math.round(value * 10) / 10)
        }),
      }))
      const baseline = await geometry()
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      const nav = page.getByRole('navigation', { name: '账户设置', exact: true })
      await nav.getByRole('button', { name: '账号安全', exact: true }).click()
      await expect(page.getByRole('status')).toHaveText('正在加载安全设置…')
      expect.soft(await geometry(), 'security loading').toEqual(baseline)
      release()
      await expect(page.getByRole('heading', { name: '登录会话', exact: true })).toBeVisible()
      expect.soft(await geometry(), 'security loaded').toEqual(baseline)
      for (const [label, tab] of [['我的账户', 'balance'], ['主题与外观', 'theme'], ['个人资料', 'profile']]) {
        await nav.getByRole('button', { name: label, exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`tab=${tab}$`))
        expect.soft(await geometry(), label).toEqual(baseline)
      }
      await page.goto('/create/text')
      await expect(page.locator('.studio-shell')).toBeVisible()
      expect((await page.locator('.studio-shell').boundingBox())!.width).toBeCloseTo(width, 0)
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight + 1)).toBe(true)
    } finally {
      release()
      await browser.close()
    }
  })
}
