import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const mode of ['light', 'dark']) {
  test(`compact settings keep their controls visible in ${mode} mode`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode })), mode)
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 740 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport)
      for (const tab of ['privacy', 'security', 'theme']) {
        await page.goto('/account?tab=' + tab)
        await expect(page.locator('.settings-main')).toBeVisible()
        if (tab === 'privacy') {
          await expect(page.getByRole('button', { name: '保存隐私设置', exact: true })).toBeInViewport()
          const rows = page.locator('.privacy-fields > .field')
          for (const row of await rows.all()) {
            const label = (await row.locator(':scope > span').boundingBox())!
            const select = (await row.locator('select').boundingBox())!
            expect(select.x).toBeGreaterThan(label.x + label.width)
          }
          const controls = await page.locator('.privacy-settings select').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().right))
          expect(Math.max(...controls) - Math.min(...controls)).toBeLessThan(1)
        } else if (tab === 'security') {
          await expect(page.getByRole('button', { name: '退出当前设备', exact: true })).toBeInViewport()
          const identity = (await page.locator('.security-identity').boundingBox())!
          const devices = (await page.locator('.security-sessions').boundingBox())!
          expect(devices.x).toBeGreaterThan(identity.x)
        } else {
          await expect(page.locator('.palette-option')).toHaveCount(6)
          await expect(page.locator('.theme-footnote')).toBeInViewport()
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        if (viewport.width === 1440) {
          const result = await new AxeBuilder({ page }).include('.settings-page').analyze()
          expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([])
          await page.screenshot({ path: test.info().outputPath(`hallmark-${tab}-${mode}.png`) })
        }
      }
    }
  })

  test(`phone settings preserve labels and keyboard focus in ${mode} mode`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode })), mode)
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/account?tab=privacy')
      await expect(page.locator('.privacy-settings select')).toHaveCount(3)
      const visibility = page.locator('.privacy-settings select').nth(1)
      const label = (await visibility.locator('..').locator(':scope > span').boundingBox())!
      const input = (await visibility.boundingBox())!
      expect(input.y).toBeGreaterThanOrEqual(label.y + label.height)
      await visibility.focus()
      await expect(visibility).toBeFocused()
      expect(await visibility.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (width === 390) {
        expect((await new AxeBuilder({ page }).include('.settings-page').analyze()).violations).toEqual([])
        await page.screenshot({ path: test.info().outputPath(`hallmark-phone-${mode}.png`), fullPage: true })
      }
    }
  })
}
