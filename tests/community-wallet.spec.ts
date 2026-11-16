import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test('community points keep exact amounts, restrictions and unavailable state on desktop and mobile', async ({ page }, info) => {
  await mockUnifiedAccount(page, true)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let points: object | null = { enabled: true, currency: 'CNY', pointsPerCny: 5000,
    charityPoints: '123456789012345678.123456', permanentPoints: '5000.000001',
    legacyApiQuota: 1000000, paidApiQuota: 500, totalApiQuota: 1000500, charityExpiringAt: 1800000000 }
  await page.route('**/api/account', route => route.fulfill({ json: {
    linked: true, subject: '17', balance: 999999, walletEnabled: true, points, accountUrl: 'https://accounts.example',
  } }))
  await page.route('**/api/new-api/wallet{,/**}', route => route.fulfill({ json: { success: true, data: {
    userId: 17, currencySymbol: '¥', quotaPerUnit: 500000, quotaDisplayType: 'CNY', creditExchangeRate: 1,
    topup: { enabled: false, redemptionEnabled: false, minAmount: 1, amountOptions: [], discounts: {}, paymentMethods: [] },
    plans: [], subscriptions: [], history: [], historyTotal: 0,
  } } }))
  await page.goto('/account?tab=balance')
  const summary = page.getByRole('region', { name: '社区积分', exact: true })
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('123,456,789,012,345,678.123456')
  await expect(summary).toContainText('5,000.000001')
  await expect(summary).toContainText('对应充值余额 ¥ 1.0000000002')
  await expect(summary).toContainText('仅限社区使用')
  await expect(summary).toContainText('最近一批到期：')
  await expect(summary).toContainText('历史额度保留在账户中心使用，未计入充值永久积分')
  await expect(page.locator('.balance-panel .account-balance')).toHaveCount(0)
  const indicator = page.locator('.header-actions .account-balance')
  await expect(indicator).toHaveAttribute('title', '公益 123,456,789,012,345,678.123456 积分 · 永久 5,000.000001 积分')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(summary).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const layout = await summary.boundingBox()
    expect(layout!.x).toBeGreaterThanOrEqual(0)
    expect(layout!.x + layout!.width).toBeLessThanOrEqual(width)
    await page.screenshot({ path: info.outputPath(`wallet-${width}.png`), fullPage: true })
  }
  const a11y = await new AxeBuilder({ page }).include('.community-wallet-summary').analyze()
  expect(a11y.violations).toEqual([])
  points = null
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(summary).toHaveCount(0)
  await expect(page.locator('.balance-panel')).toContainText('积分余额暂不可用')
  await expect(page.locator('.balance-panel')).not.toContainText('999999')
  await expect(indicator).toHaveText('—')
  expect(errors).toEqual([])
})
