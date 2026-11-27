import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { modelPriceRows } from '../server/native-account/pricing'

test.use({ locale: 'zh-CN' })

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const state = { selected: 'auto', autoGroups: ['default', '生图'], groups: ['对接', 'default'],
    modelGroups: [] as string[], generations: 0, waitGroups: Promise.resolve() }
  const model = () => ({ id: 'gpt-image-2', kinds: ['image'], groups: ['auto', ...state.groups] })
  await page.route('**/api/new-api/model-groups', async route => {
    await state.waitGroups
    await route.fulfill({ json: { success: true, data: { selectedGroup: state.selected,
      groups: ['auto', 'default', '对接', '生图'].map(id => ({ id, name: id, ratio: id === 'default' ? 0.08 : id === '生图' ? 0.6 : 1 })),
    } } })
  })
  await page.route('**/api/creation/**', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/models')) {
      if (url.searchParams.get('scope') !== 'all') state.modelGroups.push(request.method() === 'POST' ? request.postDataJSON().group : 'auto')
      return route.fulfill({ json: { tokenId: 41, items: [model()] } })
    }
    if (request.method() !== 'GET') state.generations++
    return route.fulfill({ json: { items: [] } })
  })
  await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: { success: true, data: {
    userId: 17, ...modelPriceRows({ data: [{ model_name: 'gpt-image-2', enable_groups: state.groups, quota_type: 1, model_price: 0.25 }],
      group_ratio: { default: 0.08, 对接: 1, 生图: 0.6 }, auto_groups: state.autoGroups },
    { quota_display_type: 'CUSTOM', custom_currency_symbol: '积分', custom_currency_exchange_rate: 5000 }),
  } } }))
  return state
}
const card = (page: Page) => page.getByRole('article', { name: 'gpt-image-2 模型价格', exact: true })
const group = (page: Page) => card(page).getByRole('combobox', { name: 'gpt-image-2 计费分组', exact: true })

for (const width of [1440, 390]) test(`auto image price matches the workbench and selected group at ${width}px`, async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width, height: 1000 })
  await page.goto('/create/image')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  // Opening the same full catalog from the cost panel reproduces the reported path.
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(page.locator('.billing-cost-value')).toHaveText('100 积分')
  await page.getByRole('button', { name: '查看全部定价', exact: true }).click()
  await expect(group(page)).toHaveValue('default')
  await expect(card(page).locator('.price-values dd')).toHaveText('积分 100')
  await expect(group(page).locator('option:checked')).toHaveText('default · 0.08×')
  await expect(card(page)).toContainText('已含 0.08× 分组倍率')
  await group(page).selectOption('对接')
  await expect(card(page).locator('.price-values dd')).toHaveText('积分 1,250')
  await card(page).getByRole('button', { name: '查看 gpt-image-2 价格详情', exact: true }).click()
  const details = page.getByRole('dialog', { name: '模型计费详情', exact: true })
  await expect(details).toContainText('已含 1× 分组倍率')
  await page.keyboard.press('Escape')
  await expect(card(page).getByRole('button', { name: '查看 gpt-image-2 价格详情', exact: true })).toBeFocused()
  expect((await new AxeBuilder({ page }).include('.model-price-card').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath(`price-groups-${width}.png`), fullPage: true })
  await card(page).getByRole('button', { name: '调用 gpt-image-2', exact: true }).click()
  await expect(card(page)).toHaveCount(0)
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(page.locator('.billing-cost-value')).toHaveText('1,250 积分')
  await expect(page.locator('.billing-group')).toHaveText('对接')
  await expect(page.locator('.billing-rates')).toContainText('1×')
  expect(state.modelGroups).toContain('对接')
  expect(state.generations).toBe(0)
})

for (const manual of [false, true]) test(`standalone prices follow late account groups and preserve manual selection: ${manual}`, async ({ page }) => {
  const state = await fixture(page)
  state.selected = '对接'
  let finish!: () => void
  state.waitGroups = new Promise<void>(resolve => { finish = resolve })
  await page.goto('/models')
  try {
    await expect(group(page)).toHaveValue('default')
    if (manual) { await group(page).selectOption('对接'); await group(page).selectOption('default') }
  } finally { finish() }
  await expect.poll(() => state.modelGroups.length).toBeGreaterThan(0)
  await expect(group(page)).toHaveValue(manual ? 'default' : '对接')
  await expect(card(page).locator('.price-values dd')).toHaveText(manual ? '积分 100' : '积分 1,250')
  expect(state.generations).toBe(0)
})

test('auto candidates follow routing order instead of alphabetical or cheapest prices', async ({ page }) => {
  const state = await fixture(page)
  state.groups = ['对接', 'default', '生图']
  state.autoGroups = ['unavailable', '生图', 'default']
  await page.goto('/models')
  await expect(group(page)).toHaveValue('生图')
  await expect(card(page).locator('.price-values dd')).toHaveText('积分 750')
  await expect(page.getByText(/自动分组优先展示/)).toBeVisible()
  await group(page).selectOption('对接')
  state.groups = ['default', '生图']
  await page.getByRole('button', { name: '刷新价格', exact: true }).click()
  await expect(group(page)).toHaveValue('生图')
  await expect(card(page).locator('.price-values dd')).toHaveText('积分 750')
  expect(state.generations).toBe(0)
})

test('failed group reads keep explicit prices and retry the selected group without generating', async ({ page }) => {
  const state = await fixture(page)
  state.selected = '对接'
  let failed = true
  await page.route('**/api/new-api/model-groups', route => failed
    ? route.fulfill({ status: 503, json: { success: false, message: '分组读取失败' } }) : route.fallback())
  await page.goto('/models')
  await expect(page.getByRole('alert')).toContainText('以下价格按卡片标注的分组展示')
  await expect(group(page)).toHaveValue('default')
  await expect(card(page).locator('.price-values dd')).toHaveText('积分 100')
  failed = false
  await page.getByRole('button', { name: '重试分组', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(group(page)).toHaveValue('对接')
  await expect(card(page).locator('.price-values dd')).toHaveText('积分 1,250')
  expect(state.generations).toBe(0)
})
