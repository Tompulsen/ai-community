import { expect, test, type Page } from '@playwright/test'
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
