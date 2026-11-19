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
      if (width >= 1000) {
        await expect(page.locator('.profile-toggle')).toBeVisible()
        await page.locator('.community-rail').getByRole('link', { name: '账号设置', exact: true }).click()
      } else await page.goto('/account?tab=privacy')
      await expect(page.locator('.privacy-settings')).toBeVisible()
      await expect(page.locator('.header-inner')).toBeHidden()
      if (width >= 1000) {
        await expect(page.locator('.community-rail .nav-link')).toHaveCount(3)
        await expect(page.locator('.community-rail').getByRole('link', { name: '首页', exact: true })).toBeVisible()
        expect(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--header-height'))).toBe('0px')
      } else await expect(page.locator('.mobile-community-header')).toBeVisible()

      const geometry = () => page.evaluate(wide => ({
        scrollY,
        boxes: ['.page-heading', '.settings-sidebar', '.settings-main'].map(selector => {
          const rect = document.querySelector(selector)!.getBoundingClientRect()
          // Mobile content can add a classic scrollbar without changing alignment.
          return [rect.x, rect.y, ...(wide ? [rect.width] : [])].map(value => Math.round(value * 10) / 10)
        }),
      }), width >= 1000)
      const baseline = await geometry()
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      const nav = page.getByRole('navigation', { name: '账户设置', exact: true })
      const openSetting = async (name: string) => {
        if (width < 1000) {
          await page.getByRole('button', { name: '返回账户设置', exact: true }).click()
          await expect(page.locator('.settings-main')).toBeHidden()
          await expect(page.locator('.settings-sidebar')).toBeVisible()
        }
        await nav.getByRole('button', { name, exact: true }).click()
      }
      await openSetting('账号安全')
      await expect(page.getByRole('status')).toHaveText('正在加载安全设置…')
      if (width >= 1000) expect.soft(await geometry(), 'security loading').toEqual(baseline)
      release()
      await expect(page.getByRole('heading', { name: '登录会话', exact: true })).toBeVisible()
      if (width >= 1000) expect.soft(await geometry(), 'security loaded').toEqual(baseline)
      for (const [label, tab] of [['我的账户', 'balance'], ['主题与外观', 'theme'], ['关注与隐私', 'privacy']]) {
        await openSetting(label)
        await expect(page).toHaveURL(new RegExp(`tab=${tab}$`))
        if (width < 1000) await expect(page.locator('.settings-sidebar')).toBeHidden()
        else expect.soft(await geometry(), label).toEqual(baseline)
        await expect(page.locator('.header-inner')).toBeHidden()
        expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      }
      await page.screenshot({ path: test.info().outputPath(`settings-header-${width}.png`), fullPage: true })
      if (width >= 1000) {
        await page.locator('.community-rail').getByRole('link', { name: '首页', exact: true }).click()
        await expect(page.getByRole('searchbox', { name: '搜索作品', exact: true })).toBeVisible()
        await expect(page.locator('.profile-toggle')).toBeVisible()
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
