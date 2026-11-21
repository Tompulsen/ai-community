import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

for (const authenticated of [true, false]) test(`lottery displays welfare prizes and preserves permanent historical rewards for ${authenticated ? 'members' : 'guests'}`, async ({ page }) => {
  await mockUnifiedAccount(page, authenticated)
  await page.route('**/api/new-api/status', route => route.fulfill({ json: { success: true,
    data: { enabled: true, configured: true, currencySymbol: '积分', quotaPerUnit: 100, pointsPerUsd: 5000 } } }))
  const prize = { id: 'credit', name: '活动额度', description: '历史 API 奖励', amountCents: 50, kind: 'balance', weight: 1, stock: -1, enabled: true }
  const rule = { enabled: false, threshold: 1, tickets: 1 }
  await page.route('**/api/lottery/status', route => route.fulfill({ json: {
    settings: { enabled: true, minConsumptionCnyFen: 0, rewardValidityHours: 168, prizes: [prize], invites: rule, likes: rule, followers: rule, likesMode: 'work',
      wheel: { theme: 'teal', title: '', subtitle: '', buttonText: 'GO', rulesText: '' } },
    balance: 1, counts: { invites: 0, likes: 0, followers: 0, bestWorkLikes: 0 },
    earned: { invites: 0, likes: 0, followers: 0 }, accountLinked: true, creditReady: true, inviteUrl: '',
    consumption: { checked: authenticated, eligible: authenticated, amountCnyFen: authenticated ? 1000 : null },
  } }))
  await page.route('**/api/lottery/records', route => route.fulfill({ json: {
    items: [{ id: 'receipt', createdAt: '2026-11-16T00:00:00Z', prizes: [
      { ...prize, prizeId: prize.id, status: 'fulfilled', legacyPoints: '2500.000000' },
      { ...prize, prizeId: 'unknown', name: '无凭证旧奖励', status: 'fulfilled', legacyPoints: null },
    ] }], nextCursor: null,
  } }))
  await page.goto('/activities')
  await expect(page.locator('.prize-list')).toContainText('约 2,500 福利积分')
  await expect(page.locator('.activity-page')).not.toContainText('$0.50')
  if (authenticated) {
    await page.getByRole('button', { name: '奖励记录', exact: true }).click()
    await expect(page.getByRole('row').nth(1)).toContainText('2,500 积分')
    await expect(page.getByRole('row').nth(2)).toContainText('积分数额待核对')
    await expect(page.locator('.records-section')).not.toContainText('永久')
  }
})

test('welfare details stay collapsed, show per-batch deadlines and refresh exact expiring amounts', async ({ page }, info) => {
  await mockUnifiedAccount(page, true)
  const initialTime = new Date('2026-11-21T12:00:00Z')
  await page.clock.install({ time: initialTime })
  await page.clock.pauseAt(new Date(initialTime.getTime() + 1000))
  const expiry = initialTime.getTime() / 1000 + 61
  let expired = false, requests = 0, fail = true
  await page.route('**/api/account', route => route.fulfill({ json: {
    linked: true, subject: '17', walletEnabled: true, points: {
      enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: expired ? '700' : '1200', permanentPoints: '5000',
      legacyApiQuota: 5000, paidApiQuota: 0, totalApiQuota: 5000,
      charityExpiringAt: expired ? null : expiry, charityExpiringPoints: expired ? null : '500', charityDetailsAvailable: true,
    },
  } }))
  await page.route('**/api/new-api/wallet/point-lots{,?*}', route => {
    requests++
    if (fail) return route.fulfill({ status: 503, json: { message: '福利明细暂不可用，请稍后刷新。' } })
    const more = new URL(route.request().url()).searchParams.get('cursor')
    return route.fulfill({ json: { success: true, data: {
      userId: 17,
      items: more ? [{ id: '1', source: 'qxchat_legacy', points: '300', expiresAt: null, createdAt: expiry - 86400 }] : [
        ...expired ? [] : [{ id: '3', source: 'community_lottery', points: '500', expiresAt: expiry, createdAt: expiry - 3600 }],
        { id: '2', source: 'community_lottery', points: '400', expiresAt: expiry + 86400, createdAt: expiry - 3600 },
      ],
      nextCursor: more ? null : '2', sharedPoints: '0',
    } } })
  })
  await page.route('**/api/new-api/wallet{,/**}', route => {
    if (route.request().url().includes('/point-lots')) return route.fallback()
    return route.fulfill({ json: { success: true, data: {
      userId: 17, currencySymbol: '¥', quotaPerUnit: 500000, quotaDisplayType: 'CNY', creditExchangeRate: 1,
      topup: { enabled: false, redemptionEnabled: false, minAmount: 1, amountOptions: [], discounts: {}, paymentMethods: [] },
      plans: [], subscriptions: [], history: [], historyTotal: 0,
    } } })
  })
  await page.goto('/account?tab=balance')
  const summary = page.getByRole('region', { name: '社区积分', exact: true })
  await expect(summary.locator('.point-balances > div')).toHaveCount(2)
  await expect(summary.locator('.welfare-expiry')).toContainText('其中 500 积分将在 00:01:00 后过期')
  await expect(summary.getByRole('button', { name: '福利积分' })).toHaveAttribute('aria-expanded', 'false')
  expect(requests).toBe(0)
  await summary.getByRole('button', { name: '福利积分' }).click()
  await expect(summary.getByRole('alert')).toContainText('福利明细暂不可用')
  fail = false
  await summary.getByRole('button', { name: '重新读取' }).click()
  await expect(summary.locator('.welfare-lots li')).toHaveCount(2)
  await expect(summary.locator('.welfare-lots li').first()).toContainText('500 积分')
  await summary.getByRole('button', { name: '加载更多' }).click()
  await expect(summary.locator('.welfare-lots li')).toHaveCount(3)
  await expect(summary.locator('.welfare-lots li').last().locator('time')).toHaveCount(0)
  await expect(summary.locator('.welfare-details')).not.toContainText('永久')
  await expect(summary.locator('.welfare-details')).not.toContainText('长期有效')
  await expect(summary.locator('.welfare-lots li').last()).toContainText('历史福利')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`welfare-details-${width}.png`), fullPage: true })
  }
  await page.clock.resume()
  const a11y = await new AxeBuilder({ page }).include('.community-wallet-summary').analyze()
  expect(a11y.violations).toEqual([])
  expired = true
  await page.clock.fastForward(61000)
  await expect(summary.locator('.point-amount').first()).toHaveText('700积分')
  await expect(summary.locator('.welfare-expiry')).toHaveCount(0)
  await expect(summary.locator('.welfare-lots li').first()).toContainText('400 积分')
})

test('unknown shared expiry amounts never label the whole welfare balance as expiring', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  const expiry = Math.floor(Date.now() / 1000) + 3600
  await page.route('**/api/account', route => route.fulfill({ json: {
    linked: true, subject: '17', walletEnabled: true, points: {
      enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: '1200', permanentPoints: '5000',
      legacyApiQuota: 5000, paidApiQuota: 0, totalApiQuota: 5000, charityExpiringAt: expiry,
      charityExpiringPoints: null, charityDetailsAvailable: true,
    },
  } }))
  await page.goto('/account?tab=balance')
  const reminder = page.locator('.welfare-expiry')
  await expect(reminder).toContainText('有福利积分将在')
  await expect(reminder).not.toContainText('1,200')
})

test('a failed expiry refresh can recover through the wallet retry without an unhandled error', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  const start = new Date('2026-11-21T10:00:00Z')
  await page.clock.install({ time: start })
  await page.clock.pauseAt(start)
  const errors: string[] = []
  page.on('pageerror', cause => errors.push(cause.message))
  let fail = false, expired = false
  await page.route('**/api/account', route => fail
    ? route.fulfill({ status: 503, json: { error: '余额暂不可用' } })
    : route.fulfill({ json: { linked: true, subject: '17', walletEnabled: true, points: {
      enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: expired ? '700' : '1200',
      permanentPoints: '5000', legacyApiQuota: 5000, paidApiQuota: 0, totalApiQuota: 5000,
      charityExpiringAt: expired ? null : start.getTime() / 1000 + 2,
      charityExpiringPoints: expired ? null : '500', charityDetailsAvailable: true,
    } } }))
  await page.goto('/account?tab=balance')
  await expect(page.locator('.community-wallet-summary')).toBeVisible()
  fail = true
  await page.clock.runFor(3000)
  await expect(page.locator('.balance-panel')).toContainText('积分余额暂不可用')
  fail = false; expired = true
  await page.locator('.balance-panel').getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.locator('.community-wallet-summary')).toContainText('700')
  await expect(page.locator('.welfare-expiry')).toHaveCount(0)
  expect(errors).toEqual([])
})

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
  await expect(summary).toContainText('福利积分')
  await expect(summary).toContainText('永久积分')
  await expect(summary.locator('.point-note, .points-rule')).toHaveCount(0)
  await expect(summary).not.toContainText('共用余额')
  await expect(summary).not.toContainText('最近一批到期：')
  await expect(summary).not.toContainText('社区优先使用福利积分')
  await expect(page.locator('.balance-panel .account-balance')).toHaveCount(0)
  const indicator = page.locator('.account-balance').first()
  await expect(indicator).toHaveAttribute('title', '可用 123,456,789,012,350,678.123457 积分')
  await expect(indicator).toHaveAttribute('aria-description', '可用 123,456,789,012,350,678.123457 积分')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/discover')
    if (width >= 1000) await expect(page.getByRole('searchbox', { name: '搜索作品', exact: true })).toBeVisible()
    else await page.getByTitle('社区工具', { exact: true }).click()
    if (width >= 1000) await expect(page.locator('.community-rail')).toBeVisible()
    else await expect(page.getByRole('navigation', { name: '手机导航', exact: true })).toBeVisible()
    await expect(indicator).toHaveText('123,456,789,012,350,678.123457 积分')
    await expect(indicator).toHaveAccessibleName('我的账户，可用 123,456,789,012,350,678.123457 积分')
    const header = await page.locator(width >= 1000 ? '.header-actions' : '.mobile-account-tools').boundingBox()
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
    await page.screenshot({ path: info.outputPath(`wallet-${width}.png`), fullPage: true })
  }
  const a11y = await new AxeBuilder({ page }).include('.community-wallet-summary').analyze()
  expect(a11y.violations).toEqual([])
  points = null
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(summary).toHaveCount(0)
  await expect(page.locator('.balance-panel')).toContainText('积分余额暂不可用')
  await expect(page.locator('.balance-panel')).not.toContainText('999999')
  await page.getByRole('button', { name: '返回账户设置', exact: true }).click()
  await page.getByTitle('社区工具', { exact: true }).click()
  await expect(indicator).toHaveText('—')
  expect(errors).toEqual([])
})

test('header refreshes the shared total when limited QX points expire or are spent', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.clock.install()
  let charityPoints = '1500'
  const expiry = Math.floor(Date.now() / 1000) + 60
  await page.route('**/api/account', route => route.fulfill({ json: {
    linked: true, subject: '17', walletEnabled: true, points: {
      enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints,
      permanentPoints: '50000', legacyApiQuota: 50000, paidApiQuota: 0,
      totalApiQuota: 50000, charityExpiringAt: charityPoints === '1500' ? expiry : null,
    },
  } }))
  await page.goto('/discover')
  const indicator = page.locator('.account-balance').first()
  await expect(indicator).toHaveText('51,500 积分')
  charityPoints = '1000'
  await page.clock.fastForward(61_000)
  await expect(indicator).toHaveText('51,000 积分')
  charityPoints = '999.999999'
  await page.clock.fastForward(15_000)
  await expect(indicator).toHaveText('50,999.999999 积分')
})
