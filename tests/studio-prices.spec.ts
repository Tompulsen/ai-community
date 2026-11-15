import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { ModelPriceRow } from '../server/native-account/pricing'

const longModel = 'claude-custom/long-model-name-with-a-complete-provider-configuration-20261115'
function priceRows(): ModelPriceRow[] {
  return [
    ...['auto', 'vip'].map(group => ({
      model: 'gpt-5', group, billing: '上下文分档 · 每百万 tokens', price: '使用后端原始价格',
      details: { unit: 'tokens' as const, tiers: [
        { context: '上下文 ≤ 128,000 tokens', input: group === 'auto' ? '$ 0.75' : '$ 0.375', output: group === 'auto' ? '$ 6' : '$ 3',
          extras: [{ label: '缓存读取', amount: '$ 0.075' }, { label: '缓存写入', amount: '$ 1.5' }] },
        { context: '上下文 > 128,000 tokens', input: '$ 1.5', output: '$ 12', extras: [{ label: '缓存读取', amount: '$ 0.15' }] },
      ] },
    })),
    { model: 'gpt-image-2', group: 'auto', billing: '每次请求', price: '$ 0', details: { unit: 'request', tiers: [{ perRequest: '$ 0' }] } },
    { model: 'sora-2', group: 'auto', billing: '动态计费', price: '按时长计费，请查看模型广场详情。' },
    { model: longModel, group: 'custom-group-with-a-long-name', billing: '每次请求', price: '$ 0.123456', details: { unit: 'request', tiers: [{ perRequest: '$ 0.123456' }] } },
  ]
}
async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const state = { failure: false, userId: 17, reads: 0, writes: 0 }
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { async writeText(text: string) { sessionStorage.setItem('pricing-copied-model', text) } } })
  })
  await page.route('**/api/creation/**', route => {
    if (route.request().method() !== 'GET') state.writes++
    return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }] } })
  })
  await page.route('**/api/new-api/model-groups/select', route => {
    state.writes++
    return route.fulfill({ json: { success: true, data: {} } })
  })
  await page.route('**/api/new-api/model-pricing', route => {
    state.reads++
    return route.fulfill(state.failure ? { status: 503, json: { success: false, message: '暂时无法读取模型价格，请重试。' } }
      : { json: { success: true, data: { userId: state.userId, account: 'root', currency: '$', fetchedAt: new Date().toISOString(), rows: priceRows() } } })
  })
  await page.goto('/create/text')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-5')
  return { ...account, state }
}
async function open(page: Page) {
  await page.locator('.studio-sidebar').getByRole('button', { name: '模型定价', exact: true }).click()
  return page.getByRole('region', { name: '模型价格', exact: true })
}
test('price cards merge groups, preserve zero and tier charges, copy names and keep the current model first', async ({ page }) => {
  const fixtureState = await fixture(page), catalog = await open(page)
  await expect(catalog.getByRole('article')).toHaveCount(4)
  await expect(catalog.getByRole('article').first()).toHaveAccessibleName('gpt-5 模型价格')
  const card = catalog.getByRole('article', { name: 'gpt-5 模型价格', exact: true })
  await expect(card).toContainText('本次调用模型')
  await expect(card.locator('.price-values dd')).toHaveText(['$ 0.75', '$ 6'])
  await expect(catalog.getByRole('article', { name: 'gpt-image-2 模型价格', exact: true }).locator('.price-values dd')).toHaveText('$ 0')
  await card.getByRole('combobox', { name: 'gpt-5 计费分组', exact: true }).selectOption('vip')
  await expect(card.locator('.price-values dd')).toHaveText(['$ 0.375', '$ 3'])
  await card.getByRole('button', { name: '2 项缓存费用', exact: true }).click()
  const details = page.getByRole('dialog', { name: '模型计费详情', exact: true })
  await expect(details).toBeVisible()
  await expect(details).toContainText('vip · 上下文分档')
  await expect(details).toContainText('上下文 > 128,000 tokens')
  await expect(details).toContainText('缓存写入')
  await expect(details).toContainText('$ 1.5')
  await page.keyboard.press('Escape')
  await expect(card.getByRole('button', { name: '2 项缓存费用', exact: true })).toBeFocused()
  await card.getByRole('button', { name: '复制 gpt-5 名称', exact: true }).click()
  expect(await page.evaluate(() => sessionStorage.getItem('pricing-copied-model'))).toBe('gpt-5')
  await catalog.getByRole('searchbox', { name: '搜索模型价格', exact: true }).fill('claude')
  await expect(catalog.getByRole('article')).toHaveCount(2)
  await expect(catalog.getByRole('status')).toHaveText('2 / 4 个模型')
  await catalog.getByRole('searchbox', { name: '搜索模型价格', exact: true }).fill('不存在')
  await expect(catalog.getByRole('article')).toHaveCount(1)
  await expect(card).toBeVisible()
  expect(fixtureState.state.writes).toBe(0)
})

test('price failures can retry and an account mismatch never displays another account prices', async ({ page }) => {
  const { state } = await fixture(page)
  state.failure = true
  const catalog = await open(page)
  await expect(catalog.getByRole('alert')).toContainText('暂时无法读取')
  await expect(catalog.getByRole('article')).toHaveCount(0)
  state.failure = false
  await catalog.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(catalog.getByRole('article')).toHaveCount(4)
  state.userId = 18
  await catalog.getByRole('button', { name: '刷新价格', exact: true }).click()
  await expect(catalog.getByRole('alert')).toContainText('账号已变化')
  await expect(catalog.getByRole('article')).toHaveCount(0)
  expect(state.writes).toBe(0)
})

test('price grid and details fit desktop, tablet and narrow phones in both themes', async ({ page }) => {
  await fixture(page)
  const catalog = await open(page), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const [width, theme, columns] of [[1440, 'dark', 3], [1024, 'light', 2], [390, 'dark', 1], [320, 'light', 1]] as const) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), theme)
    await expect(catalog.getByRole('article')).toHaveCount(4)
    expect(await catalog.locator('.model-price-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(columns)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await catalog.locator('.model-price-card').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true)
    await page.screenshot({ path: `.taste-skill/model-prices-20261115/grid-${width}-${theme}.png`, fullPage: true })
    await catalog.getByRole('button', { name: `查看 ${longModel} 价格详情`, exact: true }).click()
    const details = page.getByRole('dialog', { name: '模型计费详情', exact: true })
    await expect(details).toBeVisible()
    expect(await details.evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && element.scrollWidth <= element.clientWidth
    })).toBe(true)
    await page.keyboard.press('Escape')
  }
  const accessibility = await new AxeBuilder({ page }).include('.model-prices').withRules(['color-contrast', 'label', 'button-name']).analyze()
  expect(accessibility.violations).toEqual([])
  expect(errors).toEqual([])
})
