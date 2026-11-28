import { mkdir } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

// Mock gateways are intercepted below; the UI preview's form-action policy would block them.
test.use({ bypassCSP: true })

async function walletFixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  let balance = 12.5, balanceFails = false, redeemFails = false
  const writes: { path: string; body: any; user: string | undefined }[] = []
  const reads: string[] = []
  const readPaths: string[] = []
  const overview = {
    userId: 17, currencySymbol: '\u2726', quotaPerUnit: 500000, quotaDisplayType: 'CUSTOM', creditExchangeRate: 2,
    topup: { enabled: true, redemptionEnabled: true, redemptionUrl: 'https://shop.example.com/codes', minAmount: 1, amountOptions: [10, 50, 100], discounts: { 50: .97 },
      paymentMethods: [{ type: 'alipay', name: '支付宝' }, { type: 'wxpay', name: '微信支付' }] },
    plans: [{ id: 2, title: '创作月包', subtitle: '图片与视频创作额度', priceAmount: 20, currency: 'CNY', durationUnit: 'month', durationValue: 1,
      customSeconds: 0, totalAmount: 5000000, resetPeriod: 'monthly', resetSeconds: 0, maxPurchases: 2, allowBalancePay: true }],
    subscriptions: [{ id: 3, planId: 2, status: 'active', startTime: 1700000000, endTime: 1700000060, amountTotal: 5000000, amountUsed: 100000, nextResetTime: 0 }],
    history: [{ id: 4, tradeNo: 'USR17NOold', amount: 1, money: 2, status: 'success', createdAt: 20231008123456, completedAt: 0, paymentMethod: 'alipay' }],
    historyTotal: 1,
  }
  const payment = { userId: 17, kind: 'topup', method: 'POST', action: 'https://pay.example.com/submit.php', tradeNo: 'USR17NOcheckout',
    paymentMethod: 'alipay', money: '2.75', fields: { pid: 'merchant', type: 'alipay', out_trade_no: 'USR17NOcheckout', money: '2.75', sign: 'fixture-signature', sign_type: 'MD5' } }
  await page.route('**/api/account', route => balanceFails ? route.fulfill({ status: 503, json: { message: '暂时无法读取余额' } })
    : route.fulfill({ json: { linked: true, subject: account.state.user.accountId, balance, currencySymbol: '\u2726', accountUrl: 'https://accounts.example' } }))
  await page.route('**/api/new-api/wallet{,/**}', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    if (req.method() === 'GET') {
      reads.push(req.headers()['x-new-api-user'] || ''); readPaths.push(path)
      const section = path.split('/').pop()
      return route.fulfill({ json: { success: true, data: { ...overview, userId: Number(account.state.user.accountId),
        plans: section === 'plans' ? overview.plans : [], subscriptions: section === 'plans' ? overview.subscriptions : [],
        history: section === 'history' ? overview.history : [], historyTotal: section === 'history' ? overview.historyTotal : 0 } } })
    }
    const body = req.postDataJSON()
    writes.push({ path, body, user: req.headers()['x-new-api-user'] })
    if (path.endsWith('/quote')) return route.fulfill({ json: { success: true, data: { userId: Number(account.state.user.accountId), amount: body.amount, money: '2.50' } } })
    if (path.endsWith('/redeem')) {
      if (redeemFails) return route.fulfill({ status: 502, json: { success: false, message: '兑换结果暂未确认' } })
      balance = 30
      return route.fulfill({ json: { success: true, data: { userId: 17, creditedQuota: 500000 } } })
    }
    return route.fulfill({ json: { success: true, data: { ...payment, kind: path.endsWith('/subscription') ? 'subscription' : 'topup' } } })
  })
  return { ...account, overview, payment, writes, reads, readPaths, setBalanceFails: (value: boolean) => { balanceFails = value }, setRedeemFails: (value: boolean) => { redeemFails = value } }
}
const wallet = (page: Page) => page.locator('.account-wallet')

test('wallet metadata shows point previews while the balance response is still pending', async ({ page }) => {
  const fixture = await walletFixture(page)
  Object.assign(fixture.overview, { quotaPerPoint: 100 })
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/account', async route => {
    await pending
    return route.fulfill({ json: { linked: true, subject: '17', balance: null, walletEnabled: true, points: null } })
  })
  try {
    await page.goto('/account?tab=balance')
    await expect(wallet(page).getByLabel('预计到账积分')).toHaveText('预计到账 12,500 积分')
    await expect(wallet(page)).not.toContainText('✦')
  } finally { release() }
})

for (const width of [1440, 390]) test(`community point previews use actual paid money and show a compact total at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 })
  const fixture = await walletFixture(page)
  Object.assign(fixture.overview, { quotaPerPoint: 100 })
  await page.route('**/api/account', route => route.fulfill({ json: {
    linked: true, subject: '17', balance: 8415.17, currencySymbol: '✦', walletEnabled: true,
    points: { enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: '100', permanentPoints: '50000',
      legacyApiQuota: 4207585000, paidApiQuota: 5000000, totalApiQuota: 4212585000, charityExpiringAt: null },
  } }))
  await page.route('**/api/new-api/wallet/quote', route => route.fulfill({ json: { success: true, data: {
    userId: 17, amount: route.request().postDataJSON().amount,
    money: route.request().postDataJSON().amount === 50 ? '8.00' : '10.00',
  } } }))
  await page.goto('/account?tab=balance')
  const summary = page.getByRole('region', { name: '社区积分', exact: true })
  await expect(summary).toContainText('积分100积分')
  await expect(summary).toContainText('当前余额✦ 16,850.34')
  await expect(page.locator('.header-actions .account-balance')).toBeHidden()
  await expect(page.locator('.balance-settings')).not.toContainText('8415.17')
  await expect(wallet(page).getByLabel('预计到账积分')).toHaveText('预计到账 50,000 积分')
  await expect(wallet(page).getByText('¥ 10.00', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath(`points-topup-${width}.png`), fullPage: true })
  await wallet(page).getByLabel('充值档位', { exact: true }).fill('50')
  await expect(wallet(page).getByLabel('预计到账积分')).toHaveText('预计到账 40,000 积分')
  await expect(wallet(page).getByText('¥ 8.00', { exact: true })).toBeVisible()
  await wallet(page).getByRole('button', { name: '确认金额，去支付' }).click()
  await expect(wallet(page)).toContainText('13,750 积分')
  await expect(wallet(page).getByRole('status')).toContainText('实付金额已变化为 ¥ 2.75')
  expect(fixture.writes.find(item => item.path.endsWith('/pay'))?.body).toEqual({ amount: 50, paymentMethod: 'alipay' })
  await wallet(page).getByRole('button', { name: '返回充值', exact: true }).click()
  await wallet(page).getByRole('button', { name: '充值记录', exact: true }).click()
  await expect(wallet(page).getByRole('columnheader', { name: '实付折合积分' })).toBeVisible()
  await expect(wallet(page).getByRole('row').nth(1)).toContainText('10,000 积分')
  await expect(wallet(page).getByRole('row').nth(1)).toContainText('¥ 2.00')
  await expect(wallet(page).getByRole('row').nth(1)).not.toContainText('永久')
  await wallet(page).getByRole('button', { name: '套餐与订阅', exact: true }).click()
  await expect(wallet(page)).toContainText('额度 50,000 积分')
  await expect(wallet(page)).not.toContainText('✦')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('preloads after deliberate hover, reuses reads on entry and loads other tabs only on demand', async ({ page }) => {
  const fixture = await walletFixture(page)
  await page.goto('/account')
  const entry = page.locator('.settings-nav-item').filter({ hasText: '我的账户' })
  await expect(entry).toBeVisible()
  await page.clock.install()
  await page.clock.runFor(500)
  expect(fixture.readPaths).toEqual([])
  await entry.dispatchEvent('pointerenter', { pointerType: 'mouse' })
  await page.clock.runFor(100)
  await entry.dispatchEvent('pointerleave', { pointerType: 'mouse' })
  await page.clock.runFor(300)
  expect(fixture.readPaths).toEqual([])
  await entry.dispatchEvent('pointerenter', { pointerType: 'mouse' })
  await page.clock.runFor(201)
  await expect.poll(() => fixture.writes.filter(item => item.path.endsWith('/quote')).length).toBe(1)
  expect(fixture.readPaths).toEqual(['/api/new-api/wallet/topup'])
  await entry.click()
  await expect(wallet(page).getByText('¥ 2.50', { exact: true })).toBeVisible()
  expect(fixture.readPaths).toEqual(['/api/new-api/wallet/topup'])
  expect(fixture.writes.map(item => item.path)).toEqual(['/api/new-api/wallet/quote'])
  await wallet(page).getByRole('button', { name: '套餐与订阅' }).click()
  await expect(wallet(page).getByText('创作月包', { exact: true }).first()).toBeVisible()
  await wallet(page).getByRole('button', { name: '充值记录', exact: true }).click()
  await expect(wallet(page).getByRole('row').nth(1)).toContainText('USR17NOold')
  await wallet(page).getByRole('button', { name: '余额充值', exact: true }).click()
  await expect(wallet(page).getByText('¥ 2.50', { exact: true })).toBeVisible()
  expect(fixture.readPaths).toEqual(['/api/new-api/wallet/topup', '/api/new-api/wallet/plans', '/api/new-api/wallet/history'])
  await page.locator('.settings-nav-item').filter({ hasText: '关注与隐私' }).click()
  await entry.click()
  await expect(wallet(page).getByText('¥ 2.50', { exact: true })).toBeVisible()
  expect(fixture.readPaths).toHaveLength(3)
})

for (const width of [1440, 390]) test(`payment directly submits the signed form in the same tab at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 1000 })
  const fixture = await walletFixture(page)
  fixture.payment.money = fixture.payment.fields.money = '2.50'
  const gateways: { method: string; body: string }[] = []
  await context.route('https://pay.example.com/**', route => {
    gateways.push({ method: route.request().method(), body: route.request().postData() || '' })
    return route.fulfill({ contentType: 'text/html', body: '<title>Mock checkout</title>Mock payment only' })
  })
  await page.goto('/account?tab=balance')
  await expect(wallet(page).getByRole('button', { name: '确认金额，去支付' })).toBeEnabled()
  await wallet(page).getByRole('button', { name: '确认金额，去支付' }).click()
  await expect(page).toHaveURL('https://pay.example.com/submit.php')
  await expect(page).toHaveTitle('Mock checkout')
  expect(context.pages()).toHaveLength(1)
  expect(gateways).toHaveLength(1)
  expect(gateways[0].method).toBe('POST')
  const fields = new URLSearchParams(gateways[0].body)
  expect(fields.get('sign')).toBe('fixture-signature')
  expect(fields.get('money')).toBe('2.50')
  expect(fields.get('out_trade_no')).toBe('USR17NOcheckout')
  expect(fixture.writes.filter(item => item.path.endsWith('/pay'))).toEqual([{ path: '/api/new-api/wallet/pay', body: { amount: 10, paymentMethod: 'alipay' }, user: '17' }])
})

test('changed prices require confirmation and refreshing a paid order prevents a second submission', async ({ page, context }) => {
  const fixture = await walletFixture(page)
  const gateways: string[] = []
  await context.route('https://pay.example.com/**', route => {
    gateways.push(route.request().postData() || '')
    return route.fulfill({ status: 204 })
  })
  await page.goto('/account?tab=balance')
  await expect(wallet(page).getByText('预计到账 20 \u2726')).toBeVisible()
  await expect(wallet(page).getByText('¥ 2.50', { exact: true })).toBeVisible()
  await wallet(page).getByRole('button', { name: '确认金额，去支付' }).click()
  await expect(wallet(page).getByRole('status')).toContainText('实付金额已变化为 ¥ 2.75')
  expect(gateways).toEqual([])
  expect(fixture.writes.filter(item => item.path.endsWith('/pay'))).toEqual([{ path: '/api/new-api/wallet/pay', body: { amount: 10, paymentMethod: 'alipay' }, user: '17' }])
  const form = wallet(page).locator('form')
  await expect(form).toHaveAttribute('action', 'https://pay.example.com/submit.php')
  await expect(form).toHaveAttribute('method', 'POST')
  await expect(form).toHaveAttribute('target', '_self')
  await expect(form.locator('input[name="sign"]')).toHaveValue('fixture-signature')
  await form.getByRole('button', { name: '继续支付' }).click()
  await expect.poll(() => gateways.length).toBe(1)
  expect(context.pages()).toHaveLength(1)
  expect(new URLSearchParams(gateways[0]).get('sign')).toBe('fixture-signature')
  fixture.overview.history.push({ ...fixture.overview.history[0], id: 5, tradeNo: 'USR17NOcheckout', status: 'success' })
  await wallet(page).getByRole('button', { name: '我已支付，刷新余额' }).click()
  await expect(wallet(page).getByRole('status')).toContainText('订单已到账')
  await expect(wallet(page).getByRole('button', { name: '继续支付' })).toBeDisabled()
  expect(fixture.readPaths).toContain('/api/new-api/wallet/history')
})

test('redemption refreshes both balances, and a failed balance read does not imply redemption failed', async ({ page }) => {
  const fixture = await walletFixture(page)
  await page.goto('/account?tab=balance')
  await wallet(page).getByRole('button', { name: '使用兑换码' }).click()
  const redemptionLink = wallet(page).getByRole('link', { name: '获取兑换码' })
  await expect(redemptionLink).toBeVisible()
  await expect(redemptionLink).toHaveAttribute('href', fixture.overview.topup.redemptionUrl)
  await expect(redemptionLink).toHaveAttribute('target', '_blank')
  await expect(redemptionLink).toHaveAttribute('rel', 'noopener noreferrer')
  await wallet(page).getByLabel('兑换码', { exact: true }).fill('  fixture-code  ')
  await wallet(page).getByRole('button', { name: '兑换', exact: true }).click()
  await expect(wallet(page).getByRole('status')).toContainText('兑换成功')
  await expect(page.locator('.balance-panel .account-balance')).toHaveText('30.00 \u2726')
  await expect(page.locator('.header-actions .account-balance')).toHaveText('30.00 \u2726')
  fixture.setBalanceFails(true)
  await wallet(page).getByLabel('兑换码', { exact: true }).fill('another-code')
  await wallet(page).getByRole('button', { name: '兑换', exact: true }).click()
  await expect(wallet(page).getByRole('status')).toContainText('兑换成功，但余额读取失败')
  await expect(wallet(page).getByLabel('兑换码', { exact: true })).toHaveValue('')
  expect(fixture.writes.filter(item => item.path.endsWith('/redeem'))).toHaveLength(2)
  fixture.setBalanceFails(false); fixture.setRedeemFails(true)
  await wallet(page).getByLabel('兑换码', { exact: true }).fill('uncertain-code')
  await wallet(page).getByRole('button', { name: '兑换', exact: true }).click()
  await expect(wallet(page).getByRole('alert')).toContainText('勿重复提交')
  expect(fixture.writes.filter(item => item.path.endsWith('/redeem'))).toHaveLength(3)
})

test('plans preserve expected price, purchase limits, expired subscriptions and legacy order timestamps', async ({ page }) => {
  const fixture = await walletFixture(page)
  fixture.payment.money = fixture.payment.fields.money = '20.00'
  let submitted = 0
  await page.route('https://pay.example.com/**', route => { submitted++; return route.fulfill({ status: 204 }) })
  await page.goto('/account?tab=balance')
  await wallet(page).getByRole('button', { name: '套餐与订阅' }).click()
  await expect(wallet(page).locator('.wallet-subscription')).toContainText('已过期')
  await wallet(page).getByRole('button', { name: '选择套餐' }).click()
  await wallet(page).getByRole('button', { name: '确认并创建订单' }).click()
  await expect.poll(() => submitted).toBe(1)
  expect(fixture.writes.find(item => item.path.endsWith('/subscription'))?.body).toEqual({ planId: 2, paymentMethod: 'alipay', expectedPrice: { amount: 20, currency: 'CNY' } })
  await wallet(page).getByRole('button', { name: '返回充值' }).click()
  fixture.overview.plans[0].maxPurchases = 1
  await page.reload()
  await wallet(page).getByRole('button', { name: '套餐与订阅' }).click()
  await expect(wallet(page).getByRole('button', { name: '已达购买上限' })).toBeDisabled()
  await wallet(page).getByRole('button', { name: '充值记录', exact: true }).click()
  await expect(wallet(page).getByRole('row').nth(1)).toContainText('2023/10/8 12:34')
  await expect(wallet(page).getByRole('row').nth(1)).toContainText('2 \u2726')
  fixture.overview.quotaDisplayType = 'TOKENS'; fixture.overview.currencySymbol = 'tokens'; fixture.overview.creditExchangeRate = 1
  await page.reload()
  await wallet(page).getByRole('button', { name: '充值记录', exact: true }).click()
  await expect(wallet(page).getByRole('row').nth(1)).toContainText('500,000 tokens')
})

for (const currency of ['CNY', 'USD']) test(`subscription confirms the final amount for changed or non-CNY pricing (${currency})`, async ({ page }) => {
  const fixture = await walletFixture(page)
  fixture.overview.plans[0].currency = currency
  fixture.payment.money = fixture.payment.fields.money = '21.00'
  let submitted = 0
  await page.route('https://pay.example.com/**', route => { submitted++; return route.fulfill({ status: 204 }) })
  await page.goto('/account?tab=balance')
  await wallet(page).getByRole('button', { name: '套餐与订阅' }).click()
  await wallet(page).getByRole('button', { name: '选择套餐' }).click()
  await wallet(page).getByRole('button', { name: '确认并创建订单' }).click()
  await expect(wallet(page).getByRole('status')).toContainText('¥ 21.00')
  expect(submitted).toBe(0)
  await wallet(page).getByRole('button', { name: '继续支付' }).click()
  await expect.poll(() => submitted).toBe(1)
})

test('account changes discard in-flight payment and redemption fields', async ({ page }) => {
  const fixture = await walletFixture(page)
  let release!: () => void
  const pending = new Promise<void>(done => { release = done })
  await page.route('**/api/new-api/wallet/pay', async route => {
    await pending
    await route.fulfill({ json: { success: true, data: { userId: 17, action: 'https://pay.example.com/submit.php', fields: {}, money: '2.50', tradeNo: 'USR17NOold', kind: 'topup' } } })
  })
  await page.goto('/account?tab=balance')
  await expect(wallet(page).getByRole('button', { name: '确认金额，去支付' })).toBeEnabled()
  await wallet(page).getByRole('button', { name: '确认金额，去支付' }).click()
  fixture.state.user = { ...fixture.state.user, id: 'secondAccount', accountId: '18', name: '另一个账号' }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => fixture.reads).toContain('18')
  release()
  await expect(wallet(page).getByRole('button', { name: '继续支付' })).toHaveCount(0)
  await expect(wallet(page).locator('input[name="sign"]')).toHaveCount(0)
  await expect(wallet(page).getByRole('button', { name: '确认金额，去支付' })).toBeEnabled()
})

test('wallet supports disabled payments and fits dark/light desktop and narrow mobile', async ({ page }) => {
  const fixture = await walletFixture(page)
  fixture.overview.topup.amountOptions = [10, 20, 50, 100, 200, 500, 1000, 2000]
  Object.assign(fixture.overview.topup.discounts, { 200: .97, 500: .96, 1000: .95, 2000: .94 })
  await mkdir('.taste-skill/wallet-reuse-20261114', { recursive: true })
  await page.goto('/account?tab=balance')
  await expect(wallet(page).getByRole('button', { name: '确认金额，去支付' })).toBeEnabled()
  await wallet(page).getByRole('button', { name: '使用兑换码' }).click()
  for (const mode of ['dark', 'light']) {
    await page.evaluate(value => window.communityAppearance.set({ mode: value as 'light' | 'dark' }), mode)
    for (const width of [1440, 1000, 768, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await wallet(page).scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const fields = (await wallet(page).locator('.wallet-topup-fields').boundingBox())!
      const quote = (await wallet(page).locator('.wallet-quote').boundingBox())!
      if (width >= 1000) {
        expect(quote.x).toBeGreaterThanOrEqual(fields.x + fields.width)
        expect(quote.y).toBeCloseTo(fields.y, 0)
      } else {
        const nav = (await page.locator('.mobile-nav').boundingBox())!
        expect(quote.y + quote.height).toBeLessThanOrEqual(nav.y + 1)
        expect(quote.y).toBeGreaterThanOrEqual(0)
      }
      const redemption = (await wallet(page).locator('.wallet-redemption').boundingBox())!
      const input = (await wallet(page).getByLabel('兑换码', { exact: true }).boundingBox())!
      const redeem = (await wallet(page).getByRole('button', { name: '兑换', exact: true }).boundingBox())!
      expect(input.x).toBeCloseTo(fields.x, 0)
      expect(input.y).toBeCloseTo(redeem.y, 0)
      expect(input.height).toBe(44)
      expect(redeem.height).toBe(44)
      expect(redeem.x + redeem.width).toBeCloseTo(redemption.x + redemption.width, 0)
      if (width >= 1000) expect(redemption.width).toBeCloseTo(fields.width, 0)
      const sizes = await wallet(page).locator('.wallet-amounts button').evaluateAll(items => items.map(item => {
        const bounds = item.getBoundingClientRect()
        return { width: bounds.width, height: bounds.height, fits: item.scrollWidth <= item.clientWidth }
      }))
      expect(Math.max(...sizes.map(item => item.width)) - Math.min(...sizes.map(item => item.width))).toBeLessThan(1)
      expect(sizes.every(item => item.height === (width >= 1000 ? 56 : 48) && item.fits)).toBe(true)
      await page.screenshot({ path: `.taste-skill/wallet-reuse-20261114/${mode}-${width}.png` })
    }
  }
  const result = await new AxeBuilder({ page }).include('.account-wallet').analyze()
  expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([])
  fixture.overview.topup.enabled = false; fixture.overview.topup.paymentMethods = []
  await page.reload()
  await expect(wallet(page).getByText('当前暂无可用的在线充值方式。')).toBeVisible()
  await expect(wallet(page).getByRole('button', { name: '使用兑换码' })).toBeVisible()
  await expect(wallet(page).getByRole('button', { name: '确认金额，去支付' })).toHaveCount(0)
})

test('topup amount, payment methods and confirmation stay in the first viewport', async ({ page }, info) => {
  const fixture = await walletFixture(page)
  Object.assign(fixture.overview, { quotaPerPoint: 100 })
  fixture.overview.topup.amountOptions = [10, 20, 50, 100, 200, 500, 1000, 2000]
  Object.assign(fixture.overview.topup.discounts, { 200: .97, 500: .96, 1000: .95, 2000: .94 })
  await page.route('**/api/account', route => route.fulfill({ json: {
    linked: true, subject: '17', walletEnabled: true, accountUrl: 'https://accounts.example',
    points: { enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: '99995750', permanentPoints: '0',
      legacyApiQuota: 0, paidApiQuota: 0, totalApiQuota: 0, charityExpiringAt: null },
  } }))
  for (const [width, height] of [[1440, 900], [1000, 768], [768, 1024], [390, 844], [320, 667]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/account?tab=balance')
    const submit = wallet(page).getByRole('button', { name: '确认金额，去支付', exact: true })
    await expect(submit).toBeEnabled()
    for (const control of [submit, wallet(page).getByLabel('充值档位', { exact: true }),
      wallet(page).getByLabel('微信支付', { exact: true }), wallet(page).locator('.wallet-amounts button').last()]) {
      await expect(control).toBeInViewport({ ratio: 1 })
    }
    if (width < 1000) {
      const methods = (await wallet(page).locator('.wallet-methods').boundingBox())!
      const quote = (await wallet(page).locator('.wallet-quote').boundingBox())!
      expect(methods.y + methods.height).toBeLessThanOrEqual(quote.y)
      await expect(page.getByRole('button', { name: '返回账户设置', exact: true })).toBeInViewport({ ratio: 1 })
    }
    expect(await page.evaluate(() => scrollY)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(wallet(page)).not.toContainText('支付确认后，实付人民币本金')
    await page.screenshot({ path: info.outputPath(`payment-first-${width}-${height}.png`), fullPage: false })
  }
})

test('mobile quote failures keep retry and focused redemption controls reachable', async ({ page }) => {
  await walletFixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  let failed = true
  await page.route('**/api/new-api/wallet/quote', route => failed
    ? route.fulfill({ status: 503, json: { success: false, message: '报价服务暂不可用，请稍后重试。'.repeat(12) } })
    : route.fulfill({ json: { success: true, data: { userId: 17, amount: route.request().postDataJSON().amount, money: '2.50' } } }))
  await page.goto('/account?tab=balance')
  const submit = wallet(page).getByRole('button', { name: '确认金额，去支付', exact: true })
  await expect(submit).toBeDisabled()
  await expect(wallet(page).getByRole('alert')).toContainText('报价服务暂不可用')
  await wallet(page).getByRole('button', { name: '使用兑换码', exact: true }).click()
  const code = wallet(page).getByLabel('兑换码', { exact: true })
  await code.scrollIntoViewIfNeeded()
  await code.focus()
  const input = (await code.boundingBox())!
  const quote = (await wallet(page).locator('.wallet-quote').boundingBox())!
  expect(input.y + input.height).toBeLessThanOrEqual(quote.y)
  failed = false
  await wallet(page).getByRole('button', { name: '重新报价', exact: true }).click()
  await expect(submit).toBeEnabled()
  await expect(wallet(page).locator('.wallet-quote').getByRole('alert')).toHaveCount(0)
})
