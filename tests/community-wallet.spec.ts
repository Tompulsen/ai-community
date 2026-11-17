import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const authenticated of [true, false]) test(`lottery displays point equivalents with historical API restrictions for ${authenticated ? 'members' : 'guests'}`, async ({ page }) => {
  await mockUnifiedAccount(page, authenticated)
  await page.route('**/api/new-api/status', route => route.fulfill({ json: { success: true,
    data: { enabled: true, configured: true, currencySymbol: '积分', quotaPerUnit: 100, pointsPerUsd: 5000 } } }))
  const prize = { id: 'credit', name: '活动额度', description: '历史 API 奖励', amountCents: 50, kind: 'balance', weight: 1, stock: -1, enabled: true }
  const rule = { enabled: false, threshold: 1, tickets: 1 }
  await page.route('**/api/lottery/status', route => route.fulfill({ json: {
    settings: { enabled: true, prizes: [prize], invites: rule, likes: rule, followers: rule, likesMode: 'work',
      wheel: { theme: 'teal', title: '', subtitle: '', buttonText: 'GO', rulesText: '' } },
    balance: 1, counts: { invites: 0, likes: 0, followers: 0, bestWorkLikes: 0 },
    earned: { invites: 0, likes: 0, followers: 0 }, accountLinked: true, creditReady: true, inviteUrl: '',
  } }))
  await page.route('**/api/lottery/records', route => route.fulfill({ json: {
    items: [{ id: 'receipt', createdAt: '2026-11-16T00:00:00Z', prizes: [
      { ...prize, prizeId: prize.id, status: 'fulfilled', legacyPoints: '2500.000000' },
      { ...prize, prizeId: 'unknown', name: '无凭证旧奖励', status: 'fulfilled', legacyPoints: null },
    ] }], nextCursor: null,
  } }))
  await page.goto('/activities')
  await expect(page.locator('.prize-list')).toContainText('约 2,500 积分（历史 API 额度）')
  await expect(page.locator('.activity-page')).toContainText('不计入社区公益或永久积分余额')
  await expect(page.locator('.activity-page')).not.toContainText('$0.50')
  if (authenticated) {
    await page.getByRole('button', { name: '奖励记录', exact: true }).click()
    await expect(page.getByRole('row').nth(1)).toContainText('2,500 积分（历史 API 额度）')
    await expect(page.getByRole('row').nth(2)).toContainText('历史 API 额度，积分待核对')
  }
})

test('community points keep exact amounts, restrictions and unavailable state on desktop and mobile', async ({ page }, info) => {
  await mockUnifiedAccount(page, true)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const initialPoints = { enabled: true, currency: 'CNY', pointsPerCny: 5000,
    charityPoints: '123456789012345678.123456', permanentPoints: '5000.000001',
    legacyApiQuota: 1000000, legacyPoints: '10000', paidApiQuota: 500, totalApiQuota: 1000500, charityExpiringAt: 1800000000 }
  let points: object | null = initialPoints
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
  await expect(summary).toContainText('充值实付本金换算的积分')
  await expect(summary).toContainText('仅限社区使用')
  await expect(summary).toContainText('最近一批到期：')
  await expect(summary.locator('.legacy-balance')).toContainText('历史 API 额度（折合积分）10,000积分')
  await expect(summary).toContainText('仅限账户中心及原 API 使用，不计入社区可用积分')
  await expect(page.locator('.balance-panel .account-balance')).toHaveCount(0)
  const indicator = page.locator('.header-actions .account-balance')
  await expect(indicator).toHaveAttribute('title', '公益 123,456,789,012,345,678.123456 积分 · 永久 5,000.000001 积分 · 历史 API 额度 10,000 积分（仅账户中心使用）')
  await expect(indicator).toContainText('历史/API 10,000 积分')
  await expect(indicator).toHaveAccessibleName('我的账户，公益 123,456,789,012,345,678.123456 积分 · 永久 5,000.000001 积分 · 历史 API 额度 10,000 积分（仅账户中心使用）')
  await expect(indicator).toHaveAttribute('aria-description', '公益 123,456,789,012,345,678.123456 积分 · 永久 5,000.000001 积分 · 历史 API 额度 10,000 积分（仅账户中心使用）')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/discover')
    await expect(page.getByRole('searchbox', { name: '搜索作品', exact: true })).toBeVisible()
    if (width >= 1000) await expect(page.locator('.community-rail')).toBeVisible()
    else await expect(page.getByRole('navigation', { name: '手机导航', exact: true })).toBeVisible()
    await expect(indicator).toContainText('公益 123,456,789,012,345,678.123456 积分')
    const header = await page.locator('.header-actions').boundingBox()
    expect(header!.x).toBeGreaterThanOrEqual(0)
    expect(header!.x + header!.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`community-points-${width}.png`), fullPage: true })
    await indicator.click()
    await expect(page).toHaveURL(/\/account\?tab=balance$/)
    await expect(summary).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const layout = await summary.boundingBox()
    expect(layout!.x).toBeGreaterThanOrEqual(0)
    expect(layout!.x + layout!.width).toBeLessThanOrEqual(width)
    const appHeader = await page.locator('.app-header').boundingBox(), balance = await indicator.boundingBox()
    expect(balance!.y).toBeGreaterThanOrEqual(appHeader!.y)
    expect(balance!.y + balance!.height).toBeLessThanOrEqual(appHeader!.y + appHeader!.height)
    await page.screenshot({ path: info.outputPath(`wallet-${width}.png`), fullPage: true })
  }
  const a11y = await new AxeBuilder({ page }).include('.community-wallet-summary').analyze()
  expect(a11y.violations).toEqual([])
  const historicalOnly = { ...initialPoints, charityPoints: '0', permanentPoints: '0', paidApiQuota: 0, totalApiQuota: 1000000 }
  points = historicalOnly
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(summary).toContainText('公益积分0积分')
  await expect(summary).toContainText('永久积分0积分')
  await expect(summary.locator('.legacy-balance')).toContainText('10,000积分')
  await page.screenshot({ path: info.outputPath('wallet-history-only-320.png'), fullPage: true })
  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } }))
  await page.goto('/create/image')
  await expect(page.locator('.billing-balance')).toBeVisible()
  await expect(page.locator('.billing-balance')).toContainText('历史 API 额度 10,000 积分（仅账户中心使用）')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('studio-history-only-320.png'), fullPage: true })
  await page.goto('/account?tab=balance')
  points = { ...historicalOnly, legacyApiQuota: -2, legacyPoints: '-0.02', totalApiQuota: -2 }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(summary.locator('.legacy-balance')).toContainText('历史欠额（折合积分）-0.02积分')
  await expect(indicator).toContainText('历史欠额 -0.02 积分')
  points = { ...historicalOnly, legacyPoints: undefined }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(summary.locator('.legacy-balance')).toContainText('历史额度折合积分暂不可用')
  await expect(summary).toContainText('永久积分0积分')
  await expect(indicator).toContainText('历史/API 暂不可用')
  points = { ...historicalOnly, legacyApiQuota: 0, legacyPoints: '0', totalApiQuota: 0 }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(summary.locator('.legacy-balance')).toHaveCount(0)
  await expect(indicator).toHaveAttribute('title', '公益 0 积分 · 永久 0 积分')
  points = null
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(summary).toHaveCount(0)
  await expect(page.locator('.balance-panel')).toContainText('积分余额暂不可用')
  await expect(page.locator('.balance-panel')).not.toContainText('999999')
  await expect(indicator).toHaveText('—')
  expect(errors).toEqual([])
})
