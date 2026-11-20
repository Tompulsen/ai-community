import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { ModelPriceRow } from '../server/native-account/pricing'
import AxeBuilder from '@axe-core/playwright'

const image: ModelPriceRow = { model: 'gpt-image-2', group: 'image', price: '积分 150', billing: '每次请求', requestPrice: 150, imageCountMultiplier: true,
  details: { unit: 'request', tiers: [{ perRequest: '积分 150' }] } }
const wallet = { enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: '840', permanentPoints: '999597000',
  legacyApiQuota: 0, paidApiQuota: 99959700000, totalApiQuota: 99959784000, charityExpiringAt: null }

async function prepare(page: Page, rows = [image], autoGroups = ['image']) {
  const account = await mockUnifiedAccount(page, true)
  const state = { rows, autoGroups, wallet: { ...wallet }, failedPrice: false, failedBalance: false, userId: 17 }
  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [
    { id: 'gpt-image-2', kinds: ['image'] }, { id: 'gpt-5', kinds: ['text'] }, { id: 'sora-2', kinds: ['video'] },
  ] } }))
  await page.route('**/api/account', route => state.failedBalance
    ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    : route.fulfill({ json: { linked: true, subject: account.state.user.accountId, walletEnabled: true, points: state.wallet } }))
  await page.route('**/api/new-api/model-pricing', route => state.failedPrice
    ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    : route.fulfill({ json: { success: true, data: { rows: state.rows, autoGroups: state.autoGroups, currency: '积分', userId: state.userId } } }))
  return { ...account, state }
}

const pricingPanel = (page: Page) => page.getByRole('dialog', { name: '模型价格', exact: true })
test('homepage cost sits beside send, updates with quantity and opens details without submitting', async ({ page }, testInfo) => {
  await prepare(page)
  let submissions = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/creation/generate')) submissions++ })
  await page.goto('/discover')
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  const trigger = composer.getByRole('button', { name: /^预计积分消耗/ })
  await expect(trigger).toHaveText('150 积分')
  await expect(page.getByRole('button', { name: '模型价格', exact: true })).toHaveCount(0)
  await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('保留输入内容')
  await composer.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.getByRole('spinbutton', { name: '图片数量', exact: true }).fill('3')
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveText('450 积分')
  for (const [width, theme] of [[1440, 'light'], [390, 'dark'], [320, 'light']] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(mode => window.communityAppearance.set({ mode }), theme)
    const before = await composer.boundingBox(), cost = (await trigger.boundingBox())!
    const send = (await composer.getByRole('button', { name: '发送到创作台', exact: true }).boundingBox())!
    expect(cost.x + cost.width).toBeLessThanOrEqual(send.x)
    expect(send.x - cost.x - cost.width).toBeLessThanOrEqual(16)
    expect(Math.abs(cost.y + cost.height / 2 - send.y - send.height / 2)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('inline-cost-' + width + '-' + theme + '.png') })
    await trigger.click()
    await expect(pricingPanel(page).locator('.billing-cost-value')).toHaveText('450 积分')
    await expect(pricingPanel(page).locator('.billing-wallet-value')).toContainText('999,597,840')
    const panel = (await pricingPanel(page).boundingBox())!
    expect(panel.x).toBeGreaterThanOrEqual(0)
    expect(panel.x + panel.width).toBeLessThanOrEqual(width)
    expect(panel.y).toBeGreaterThanOrEqual(0)
    expect(panel.y + panel.height).toBeLessThanOrEqual(900)
    expect(await composer.boundingBox()).toEqual(before)
    await page.screenshot({ path: testInfo.outputPath('inline-cost-details-' + width + '-' + theme + '.png') })
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await expect(composer.getByRole('textbox', { name: '创作描述', exact: true })).toHaveValue('保留输入内容')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  expect(submissions).toBe(0)
})

test('homepage cost keeps ranges, actual-use pricing and unavailable prices distinct', async ({ page }) => {
  const { state } = await prepare(page, [image, { ...image, group: 'default', requestPrice: 50 }], ['default', 'image'])
  await page.goto('/discover')
  const trigger = page.getByRole('button', { name: /^预计积分消耗/ })
  await expect(trigger).toHaveText('50–150 积分')
  state.rows = [{ ...image, model: 'sora-2' }]
  await trigger.click()
  await pricingPanel(page).getByRole('button', { name: '刷新积分与价格', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '视频生成', exact: true }).click()
  await expect(trigger).toHaveText('按量计费')
  state.failedPrice = true
  await trigger.click()
  await pricingPanel(page).getByRole('button', { name: '刷新积分与价格', exact: true }).click()
  await expect(pricingPanel(page).getByRole('alert')).toContainText('价格读取失败')
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveText('查看价格')
})

async function openPrice(page: Page, kind = 'image') {
  await page.goto(`/create/${kind}`)
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(pricingPanel(page).getByRole('button', { name: '刷新积分与价格', exact: true })).toBeEnabled()
  return pricingPanel(page)
}

test('auto group resolves image pricing and keeps the full points balance inside the price panel', async ({ page }, testInfo) => {
  await prepare(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/create/image')
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '模型价格', exact: true })
  await page.screenshot({ path: testInfo.outputPath('price-panel.png') })
  await expect(panel).toContainText('150 积分')
  await expect(panel).toContainText('999,597,840')
  await expect(page.locator('.billing-account')).toHaveCount(0)
})

test('image quantity updates the cost while preserving prompt and allowing a single fixed expression request', async ({ page }) => {
  const { state } = await prepare(page)
  const panel = await openPrice(page)
  await expect(panel.locator('.billing-cost-value')).toHaveText('150 积分')
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保存草稿')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.getByRole('spinbutton', { name: '图片数量', exact: true }).fill('3')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(panel.locator('.billing-cost')).toContainText('本次 3 张，预计消耗')
  await expect(panel.locator('.billing-cost-value')).toHaveText('450 积分')
  state.rows = [{ ...image, imageCountMultiplier: false, billing: '动态 · 每次请求' }]
  await panel.getByRole('button', { name: '刷新积分与价格' }).click()
  await expect(panel.locator('.billing-cost-value')).toHaveText('150 积分')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保存草稿')
})

test('auto shows all candidate rates and never quotes only the known part of dynamic pricing', async ({ page }) => {
  const { state } = await prepare(page, [image, { ...image, group: 'default', requestPrice: 50 }], ['default', 'image'])
  const panel = await openPrice(page)
  await expect(panel.locator('.billing-cost-value')).toHaveText('50–150 积分')
  await expect(panel.locator('.billing-rate')).toHaveCount(2)
  state.rows[1] = { ...image, group: 'default', requestPrice: undefined, details: undefined, billing: '动态计费', price: '请查看模型广场' }
  await panel.getByRole('button', { name: '刷新积分与价格' }).click()
  await expect(panel.locator('.billing-cost')).toContainText('按实际用量结算')
  await expect(panel.locator('.billing-cost-value')).toHaveCount(0)
  await expect(panel.locator('.billing-wallet-value')).toContainText('999,597,840')
  state.autoGroups = []
  await panel.getByRole('button', { name: '刷新积分与价格' }).click()
  await expect(panel).toContainText('当前模型暂无可用定价')
})

test('changing the selected group replaces the auto range with that group price', async ({ page }) => {
  await prepare(page, [image, { ...image, group: 'default', requestPrice: 50 }], ['default', 'image'])
  let selectedGroup = 'auto'
  const groups = [{ id: 'auto', name: 'Auto' }, { id: 'image', name: '生图', ratio: 0.6 }]
  await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: { groups, selectedGroup, selectedTokenId: 41 } } }))
  await page.route('**/api/new-api/model-groups/select', route => {
    selectedGroup = route.request().postDataJSON().group
    return route.fulfill({ json: { success: true, data: { group: selectedGroup, selectedTokenId: 41 } } })
  })
  const panel = await openPrice(page)
  await expect(panel.locator('.billing-cost-value')).toHaveText('50–150 积分')
  await page.keyboard.press('Escape')
  await page.getByRole('combobox', { name: '模型', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择模型', exact: true })
  await picker.getByRole('button', { name: '选择分组', exact: true }).click()
  await picker.getByRole('button', { name: '生图 · 0.6×', exact: true }).click()
  await expect(picker.getByRole('button', { name: '选择分组', exact: true })).toBeEnabled()
  await picker.getByRole('button', { name: '关闭选择模型', exact: true }).click()
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(panel.locator('.billing-group')).toHaveText('生图')
  await expect(panel.locator('.billing-cost-value')).toHaveText('150 积分')
  await expect(panel.locator('.billing-rate')).toHaveCount(1)
})

test('balance and price failures recover independently without showing stale points', async ({ page }) => {
  const { state } = await prepare(page)
  const panel = await openPrice(page)
  state.failedBalance = true
  await panel.getByRole('button', { name: '刷新积分与价格' }).click()
  await expect(panel.getByRole('alert')).toContainText('积分读取失败')
  await expect(panel.locator('.billing-wallet-value')).toHaveCount(0)
  await expect(panel.locator('.billing-cost-value')).toHaveText('150 积分')
  state.failedBalance = false; state.failedPrice = true; state.wallet.permanentPoints = '100.125'; state.wallet.charityPoints = '0.125'
  await panel.getByRole('button', { name: '重试' }).click()
  await expect(panel.getByRole('alert')).toContainText('价格读取失败')
  await expect(panel.locator('.billing-wallet-value')).toHaveText('100.25 积分')
  await expect(panel.locator('.billing-cost-value')).toHaveCount(0)
  state.failedPrice = false
  await panel.getByRole('button', { name: '重试' }).click()
  await expect(panel.locator('.billing-cost-value')).toHaveText('150 积分')
})

test('a price response for another account is rejected', async ({ page }) => {
  const { state } = await prepare(page)
  state.userId = 99
  await page.goto('/create/image')
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(pricingPanel(page).getByRole('alert')).toContainText('价格读取失败')
  await expect(pricingPanel(page).locator('.billing-cost-value')).toHaveCount(0)
})

test('an account change clears old values and ignores its late price response', async ({ page }) => {
  const account = await prepare(page)
  await openPrice(page)
  await page.keyboard.press('Escape')
  let oldRequested = false
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/new-api/model-pricing', async route => {
    const owner = route.request().headers()['x-new-api-user']
    if (owner === '17') { oldRequested = true; await pending }
    await route.fulfill({ json: { success: true, data: { rows: [{ ...image, requestPrice: owner === '17' ? 777 : 25 }], autoGroups: ['image'], userId: Number(owner), currency: '积分' } } })
  })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => oldRequested).toBe(true)
  account.state.wallet.permanentPoints = '10'; account.state.wallet.charityPoints = '0'
  await page.route('**/api/account', route => route.fulfill({ json: { linked: true, subject: '19', walletEnabled: true, points: { ...wallet, permanentPoints: '10', charityPoints: '0' } } }))
  await page.evaluate(async () => {
    const stateUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/state.ts')?.name
    if (!stateUrl) throw new Error('Active session module was not loaded')
    const { session } = await import(stateUrl)
    session.user = { ...session.user, accountId: '19' }
  })
  release()
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(pricingPanel(page).locator('.billing-cost-value')).toHaveText('25 积分')
  await expect(pricingPanel(page).locator('.billing-wallet-value')).toHaveText('10 积分')
  await expect(pricingPanel(page)).not.toContainText('777')
  await expect(pricingPanel(page)).not.toContainText('999,597,840')
})

for (const kind of ['text', 'video']) test(`${kind} usage-dependent billing shows points rates without a fabricated total`, async ({ page }) => {
  const model = kind === 'text' ? 'gpt-5' : 'sora-2'
  await prepare(page, [{ model, group: 'image', price: '输入 2,000 积分 / 输出 8,000 积分', billing: '每百万 tokens', details: { unit: 'tokens', tiers: [{ input: '2,000 积分', output: '8,000 积分' }] } }])
  const panel = await openPrice(page, kind)
  await expect(panel.locator('.billing-cost')).toContainText('按实际用量结算')
  await expect(panel.locator('.billing-full-price')).toContainText('2,000 积分')
  await expect(panel.locator('.billing-wallet-value')).toContainText('999,597,840')
  await expect(panel.locator('.billing-cost-value')).toHaveCount(0)
})

test('fixed text pricing states the single-request scope', async ({ page }) => {
  await prepare(page, [{ ...image, model: 'gpt-5' }])
  const panel = await openPrice(page, 'text')
  await expect(panel.locator('.billing-cost')).toContainText('单次请求，预计消耗')
  await expect(panel.locator('.billing-note')).toContainText('额外请求另计')
})

test('zero prices, fractional and very large balances fit desktop and mobile in both themes', async ({ page }, testInfo) => {
  const { state } = await prepare(page, [{ ...image, requestPrice: 0 }])
  state.wallet.permanentPoints = '999999999999999999.123456'; state.wallet.charityPoints = '0.000001'
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const panel = await openPrice(page)
  for (const [width, height, theme] of [[1440, 900, 'light'], [390, 844, 'dark'], [320, 568, 'light'], [844, 390, 'dark']] as const) {
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width, height })
    await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), theme)
    const before = await page.locator('.studio-composer').boundingBox()
    const trigger = page.getByRole('button', { name: '模型价格', exact: true })
    await trigger.click()
    await expect(panel.locator('.billing-cost-value')).toHaveText('0 积分')
    await expect(panel.locator('.billing-wallet-value')).toHaveText('999,999,999,999,999,999.123457 积分')
    const box = await panel.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
    expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1)
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.locator('.studio-composer').boundingBox()).toEqual(before)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const audit = await new AxeBuilder({ page }).include('.billing-details').analyze()
    expect(audit.violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`points-${width}-${theme}.png`) })
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  }
  expect(errors).toEqual([])
})
