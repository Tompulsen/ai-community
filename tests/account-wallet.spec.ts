import { mkdir } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function walletFixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  let balance = 12.5, balanceFails = false, redeemFails = false
  const writes: { path: string; body: any; user: string | undefined }[] = []
  const reads: string[] = []
  const overview = {
    userId: 17, currencySymbol: '\u2726', quotaPerUnit: 500000, quotaDisplayType: 'CUSTOM', creditExchangeRate: 2,
    topup: { enabled: true, redemptionEnabled: true, minAmount: 1, amountOptions: [10, 50, 100], discounts: { 50: .97 },
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
    if (req.method() === 'GET') { reads.push(req.headers()['x-new-api-user'] || ''); return route.fulfill({ json: { success: true, data: { ...overview, userId: Number(account.state.user.accountId) } } }) }
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
  return { ...account, overview, writes, reads, setBalanceFails: (value: boolean) => { balanceFails = value }, setRedeemFails: (value: boolean) => { redeemFails = value } }
}
const wallet = (page: Page) => page.locator('.account-wallet')

test('reuses account quote and signed POST checkout without automatically paying or claiming credit', async ({ page, context }) => {
  const fixture = await walletFixture(page)
  const gateways: string[] = []
  await context.route('https://pay.example.com/**', route => {
    gateways.push(route.request().postData() || '')
    return route.fulfill({ contentType: 'text/html', body: '<title>Mock checkout</title>Mock payment only' })
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
  await expect(form).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(form.locator('input[name="sign"]')).toHaveValue('fixture-signature')
  const opened = context.waitForEvent('page')
  await form.getByRole('button', { name: '打开支付页' }).click()
  const checkout = await opened
  await checkout.waitForLoadState()
  await expect(checkout).toHaveTitle('Mock checkout')
  expect(gateways).toHaveLength(1)
  expect(new URLSearchParams(gateways[0]).get('sign')).toBe('fixture-signature')
  await checkout.close()
  await wallet(page).getByRole('button', { name: '我已支付，刷新余额' }).click()
  await expect(wallet(page).getByRole('status')).not.toContainText('已到账')
})

test('redemption refreshes both balances, and a failed balance read does not imply redemption failed', async ({ page }) => {
  const fixture = await walletFixture(page)
  await page.goto('/account?tab=balance')
  await wallet(page).getByRole('button', { name: '使用兑换码' }).click()
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
  await wallet(page).getByRole('button', { name: '刷新充值记录' }).click()
  await expect(wallet(page).getByRole('status')).toContainText('订单状态已刷新，余额读取失败')
  fixture.setBalanceFails(false); fixture.setRedeemFails(true)
  await wallet(page).getByLabel('兑换码', { exact: true }).fill('uncertain-code')
  await wallet(page).getByRole('button', { name: '兑换', exact: true }).click()
  await expect(wallet(page).getByRole('alert')).toContainText('勿重复提交')
  expect(fixture.writes.filter(item => item.path.endsWith('/redeem'))).toHaveLength(3)
})

test('plans preserve expected price, purchase limits, expired subscriptions and legacy order timestamps', async ({ page }) => {
  const fixture = await walletFixture(page)
  await page.goto('/account?tab=balance')
  await wallet(page).getByRole('button', { name: '套餐与订阅' }).click()
  await expect(wallet(page).locator('.wallet-subscription')).toContainText('已过期')
  await wallet(page).getByRole('button', { name: '选择套餐' }).click()
  await wallet(page).getByRole('button', { name: '确认并创建订单' }).click()
  expect(fixture.writes.find(item => item.path.endsWith('/subscription'))?.body).toEqual({ planId: 2, paymentMethod: 'alipay', expectedPrice: { amount: 20, currency: 'CNY' } })
  await wallet(page).getByRole('button', { name: '返回充值' }).click()
  fixture.overview.plans[0].maxPurchases = 1
  await wallet(page).getByRole('button', { name: '刷新充值记录' }).click()
  await expect(wallet(page).getByRole('button', { name: '已达购买上限' })).toBeDisabled()
  await wallet(page).getByRole('button', { name: '充值记录', exact: true }).click()
  await expect(wallet(page).getByRole('row').nth(1)).toContainText('2023/10/8 12:34')
  await expect(wallet(page).getByRole('row').nth(1)).toContainText('2 \u2726')
  fixture.overview.quotaDisplayType = 'TOKENS'; fixture.overview.currencySymbol = 'tokens'; fixture.overview.creditExchangeRate = 1
  await wallet(page).getByRole('button', { name: '刷新充值记录' }).click()
  await expect(wallet(page).getByRole('row').nth(1)).toContainText('500,000 tokens')
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
  await expect(wallet(page).getByRole('button', { name: '打开支付页' })).toHaveCount(0)
  await expect(wallet(page).locator('input[name="sign"]')).toHaveCount(0)
  await expect(wallet(page).getByRole('button', { name: '确认金额，去支付' })).toBeEnabled()
})

test('wallet supports disabled payments and fits dark/light desktop and narrow mobile', async ({ page }) => {
  const fixture = await walletFixture(page)
  await mkdir('.taste-skill/wallet-reuse-20261114', { recursive: true })
  await page.goto('/account?tab=balance')
  await expect(wallet(page).getByRole('button', { name: '确认金额，去支付' })).toBeEnabled()
  for (const mode of ['dark', 'light']) {
    await page.evaluate(value => window.communityAppearance.set({ mode: value as 'light' | 'dark' }), mode)
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await wallet(page).scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `.taste-skill/wallet-reuse-20261114/${mode}-${width}.png` })
    }
  }
  const result = await new AxeBuilder({ page }).include('.account-wallet').analyze()
  expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([])
  fixture.overview.topup.enabled = false; fixture.overview.topup.paymentMethods = []
  await wallet(page).getByRole('button', { name: '刷新充值记录' }).click()
  await expect(wallet(page).getByText('当前暂无可用的在线充值方式。')).toBeVisible()
  await expect(wallet(page).getByRole('button', { name: '使用兑换码' })).toBeVisible()
  await expect(wallet(page).getByRole('button', { name: '确认金额，去支付' })).toHaveCount(0)
})
