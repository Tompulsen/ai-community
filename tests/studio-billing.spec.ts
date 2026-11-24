import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { modelPriceRows } from '../server/native-account/pricing'
import AxeBuilder from '@axe-core/playwright'

const longPrice = '上下文 ≤ 272,000 tokens：输入 35,000 积分 / 输出 175,000 积分 / 缓存读取 3,500 积分；上下文 > 272,000 tokens：输入 70,000 积分 / 输出 262,500 积分 / 缓存读取 7,000 积分'
const models = [
  { id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] },
]
for (const kind of ['text', 'image', 'video']) {
  test(`pricing beside send opens without moving the ${kind} composer or submitting`, async ({ page }) => {
    await mockUnifiedAccount(page, true)
    let submissions = 0
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/creation/**', route => {
      if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/creation/generate') submissions++
      return route.fulfill({ json: { tokenId: 41, items: models } })
    })
    await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: {
      rows: models.map(model => ({ model: model.id, group: 'auto', price: longPrice, billing: '上下文分档 · 每百万 tokens' })), userId: 17, currency: '积分',
    } } }))
    await page.goto(`/create/${kind}`)
    await expect(page.getByRole('combobox', { name: '模型', exact: true })).not.toHaveValue('')
    const input = page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })
    await input.fill('保留输入内容')
    const trigger = page.getByRole('button', { name: '模型价格', exact: true })
    const panel = page.getByRole('dialog', { name: '模型价格', exact: true })
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      const before = await page.locator('.studio-composer').boundingBox()
      const summary = await trigger.boundingBox()
      const send = (await page.locator('.studio-composer .composer-submit').boundingBox())!
      expect(summary!.y).toBeGreaterThanOrEqual(before!.y)
      expect(summary!.x + summary!.width).toBeLessThanOrEqual(send.x)
      expect(send.x - summary!.x - summary!.width).toBeLessThanOrEqual(8)
      expect(Math.abs(summary!.y + summary!.height / 2 - send.y - send.height / 2)).toBeLessThanOrEqual(1)
      expect(await page.locator('.studio-composer .studio-billing').count()).toBe(1)
      await expect(trigger).not.toContainText('272,000')
      await trigger.click()
      await expect(panel).toBeVisible()
      await expect(panel.locator('.billing-full-price')).toHaveText(longPrice)
      const bounds = await panel.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.locator('.studio-composer').boundingBox()).toEqual(before)
      await page.screenshot({ path: `.taste-skill/pricing-disclosure-20261114/${kind}-${width}-open.png` })
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(trigger).toBeFocused()
      await expect(input).toHaveValue('保留输入内容')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await trigger.click()
    await panel.getByRole('button', { name: '查看全部定价', exact: true }).click()
    await expect(page.locator('.studio-account-view')).toBeVisible()
    await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
    await page.getByRole('button', { name: '返回创作', exact: true }).click()
    await expect(input).toHaveValue('保留输入内容')
    expect(submissions).toBe(0)
    expect(errors).toEqual([])
  })
}

test('pricing has error recovery and a missing-price state', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  let failed = true
  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: models } }))
  await page.route('**/api/new-api/model-pricing', route => failed
    ? route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    : route.fulfill({ json: { success: true, data: { rows: [], userId: 17, currency: '积分' } } }))
  await page.goto('/create/image')
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '模型价格', exact: true })
  await expect(panel.getByRole('alert')).toContainText('价格读取失败')
  failed = false
  await panel.getByRole('button', { name: '重试', exact: true }).click()
  await expect(panel).toContainText('当前模型暂无可用定价')
})

async function videoPricing(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  const schema = { seconds: { type: 'number', unit: 'second' }, resolution: { enum: ['480p', '720p', '1080p'] }, input_images: { type: 'number', unit: 'count' } }
  const model = { model_name: 'grok-imagine-video-1.5', enable_groups: ['视频'], billing_expr: 'tier("base", 0)', billing_mode: 'tiered_expr',
    billing_plugin_variants: [
      { plugin_name: 'xAI', billing_mode: 'tiered_expr', billing_expr: 'tier("base", u("input_images") * 0 + u("seconds") * 0.15)', billing_usage_schema: schema },
      { plugin_name: 'Sora', billing_mode: 'tiered_expr', billing_expr: 'tier("base", u("seconds") * 0.15)', billing_usage_schema: schema },
    ] }
  const state = { failed: false, model }
  await page.route('**/api/creation/**', route => route.fulfill({ json: { tokenId: 41, items: [{ id: model.model_name, kinds: ['video'] }] } }))
  await page.route('**/api/account', route => route.fulfill({ json: { linked: true, subject: '17', walletEnabled: true, points: {
    enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: '100', permanentPoints: '10000',
    legacyApiQuota: 0, paidApiQuota: 1000000, totalApiQuota: 1010000, charityExpiringAt: null,
  } } }))
  await page.route('**/api/new-api/model-pricing', route => route.fulfill(state.failed ? { status: 503, json: {} } : { json: { success: true, data: {
    ...modelPriceRows({ data: [state.model], group_ratio: { 视频: 1 }, auto_groups: ['视频'] }, { quota_display_type: 'CUSTOM', custom_currency_symbol: '积分', custom_currency_exchange_rate: 5000 }), userId: 17,
  } } }))
  return { state, account }
}

test('video task price uses live provider rates and duration in desktop and mobile themes', async ({ page }, testInfo) => {
  const { account } = await videoPricing(page)
  const errors: string[] = []
  let submissions = 0
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/creation/generate') submissions++ })
  await page.goto('/create/video')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.getByRole('slider', { name: '视频时长', exact: true }).fill('4')
  await page.getByRole('radiogroup', { name: '视频分辨率', exact: true }).getByRole('radio', { name: '480P', exact: true }).check()
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保存这个视频草稿')
  const trigger = page.getByRole('button', { name: '模型价格', exact: true })
  const panel = page.getByRole('dialog', { name: '模型价格', exact: true })
  for (const [width, theme] of [[1440, 'dark'], [1440, 'light'], [390, 'dark'], [390, 'light'], [320, 'dark'], [320, 'light']] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(mode => window.communityAppearance.set({ mode }), theme)
    await trigger.click()
    await expect(panel.locator('.billing-cost-value')).toHaveText('3,750 积分')
    await expect(panel).toContainText('本次 5 秒视频，预计消耗')
    await expect(panel).toContainText('750/秒')
    await expect(panel).toContainText('1 元 = 5,000 积分')
    const bounds = (await panel.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(900)
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('.billing-details').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`video-price-${width}-${theme}.png`) })
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  }
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.getByRole('slider', { name: '视频时长', exact: true }).fill('9')
  await page.keyboard.press('Escape')
  await trigger.click()
  await expect(panel.locator('.billing-cost-value')).toHaveText('7,500 积分')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保存这个视频草稿')
  expect(errors).toEqual([])
  expect(submissions).toBe(0)
  expect(account.mutations.filter(item => item.path === '/api/creation/generate')).toEqual([])
})

test('video prices follow resolution and refreshed admin prices without keeping failed estimates', async ({ page }) => {
  const { state } = await videoPricing(page)
  state.model.billing_plugin_variants = [state.model.billing_plugin_variants[1]!]
  state.model.billing_plugin_variants[0]!.billing_expr = 'u("resolution") == "480p" ? tier("low", u("seconds") * 0.15) : tier("high", u("seconds") * 0.32)'
  await page.goto('/create/video')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.getByRole('slider', { name: '视频时长', exact: true }).fill('4')
  await page.getByRole('radiogroup', { name: '视频分辨率', exact: true }).getByRole('radio', { name: '720P', exact: true }).check()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '模型价格', exact: true })
  await expect(panel.locator('.billing-cost-value')).toHaveText('8,000 积分')
  state.model.billing_plugin_variants[0]!.billing_expr = 'tier("base", u("seconds") * 0.65)'
  await panel.getByRole('button', { name: '刷新积分与价格', exact: true }).click()
  await expect(panel.locator('.billing-cost-value')).toHaveText('16,250 积分')
  state.failed = true
  await panel.getByRole('button', { name: '刷新积分与价格', exact: true }).click()
  await expect(panel.locator('.billing-cost-value')).toHaveCount(0)
  await expect(panel).toContainText('价格读取失败')
  state.failed = false
  await panel.getByRole('button', { name: '重试', exact: true }).click()
  await expect(panel.locator('.billing-cost-value')).toHaveText('16,250 积分')
})

test('homepage video estimate displays the same task cost beside send', async ({ page }) => {
  await videoPricing(page)
  await page.goto('/discover')
  await page.getByRole('button', { name: '视频生成', exact: true }).click()
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  await expect(composer.getByRole('button', { name: /^预计积分消耗/ })).toHaveText('6,000 积分')
})

test('video custom parameters do not show a misleading pre-override duration estimate', async ({ page }) => {
  await videoPricing(page)
  await page.goto('/create/video')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.getByText('自定义参数', { exact: true }).click()
  await page.getByLabel('自定义参数 JSON', { exact: true }).fill('{"seconds":15}')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '模型价格', exact: true })
  await expect(panel.locator('.billing-cost-value')).toHaveCount(0)
  await expect(panel).toContainText('自定义参数可能覆盖时长或分辨率')
})
