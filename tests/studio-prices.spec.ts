import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { ModelPriceRow } from '../server/native-account/pricing'
import type { CreationModel } from '../src/native-studio'

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
async function fixture(page: Page, navigate = true) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const state = { failure: false, catalogueFailure: false, userId: 17, reads: 0, writes: 0, rows: priceRows(), catalogue: [
    { id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] },
    { id: longModel, kinds: ['text'], configuredKind: 'image' },
  ] as CreationModel[] }
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { async writeText(text: string) { sessionStorage.setItem('pricing-copied-model', text) } } })
  })
  await page.route('**/api/creation/**', route => {
    if (route.request().method() !== 'GET' && !(route.request().url().endsWith('/api/creation/models') && route.request().postDataJSON()?.preload === true)) state.writes++
    if (new URL(route.request().url()).searchParams.get('scope') === 'all') {
      expect(route.request().method()).toBe('GET')
      expect(route.request().headers()['x-new-api-user']).toBe(account.state.user.accountId)
      return route.fulfill(state.catalogueFailure ? { status: 503, json: { error: { message: '分类目录暂时不可用。' } } } : { json: { items: state.catalogue } })
    }
    return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }] } })
  })
  await page.route('**/api/new-api/model-groups/select', route => {
    state.writes++
    return route.fulfill({ json: { success: true, data: {} } })
  })
  await page.route('**/api/new-api/model-pricing', route => {
    state.reads++
    return route.fulfill(state.failure ? { status: 503, json: { success: false, message: '暂时无法读取模型价格，请重试。' } }
      : { json: { success: true, data: { userId: state.userId, account: 'root', currency: '$', fetchedAt: new Date().toISOString(), rows: state.rows } } })
  })
  if (navigate) {
    await page.goto('/create/text')
    await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-5')
    state.writes = 0
  }
  return { ...account, accountState: account.state, state }
}
async function open(page: Page) {
  await page.locator('.studio-sidebar').getByRole('button', { name: '模型广场', exact: true }).click()
  return page.getByRole('region', { name: '模型广场', exact: true })
}
test('model plaza filters text, image and video models independently', async ({ page }) => {
  await fixture(page)
  const catalog = await open(page)
  const filters = catalog.getByRole('group', { name: '模型类型', exact: true })
  await expect(filters).toBeVisible()
  await filters.getByRole('button', { name: '图片模型', exact: true }).click()
  await expect(filters.getByRole('button', { name: '图片模型', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(filters.getByRole('button', { name: '图片模型', exact: true })).toHaveText('图片2')
  await expect(catalog.getByRole('article')).toHaveCount(2)
  await expect(catalog.getByRole('article', { name: 'gpt-5 模型价格', exact: true })).toHaveCount(0)
  await expect(catalog.getByRole('article', { name: 'gpt-image-2 模型价格', exact: true })).toBeVisible()
  await expect(catalog.getByRole('article', { name: `${longModel} 模型价格`, exact: true })).toBeVisible()
  await catalog.getByRole('searchbox').fill('gpt-5')
  await expect(catalog.getByRole('article')).toHaveCount(0)
  await expect(catalog.getByRole('button', { name: '查看全部模型', exact: true })).toBeVisible()
  await catalog.getByRole('button', { name: '查看全部模型', exact: true }).click()
  await expect(catalog.getByRole('article')).toHaveCount(4)
  await filters.getByRole('button', { name: '文本模型', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(catalog.getByRole('article')).toHaveCount(1)
  await expect(catalog.getByRole('article').first()).toHaveAccessibleName('gpt-5 模型价格')
  await filters.getByRole('button', { name: '视频模型', exact: true }).click()
  await expect(catalog.getByRole('article')).toHaveCount(1)
  await expect(catalog.getByRole('article').first()).toHaveAccessibleName('sora-2 模型价格')
})
test('price cards merge groups, preserve zero and tier charges, copy names and keep the current model first', async ({ page }) => {
  const fixtureState = await fixture(page), catalog = await open(page)
  await expect(catalog.getByRole('article')).toHaveCount(4)
  await expect(page.getByRole('heading', { name: '账户工具', exact: true })).toHaveCount(0)
  await expect(page.locator('.studio-page-toolbar h1')).toHaveCount(0)
  await expect(page.locator('.studio-account-view > button')).toHaveCount(0)
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
  await expect(catalog.getByRole('article')).toHaveCount(1)
  await expect(catalog.locator('.prices-count')).toHaveText('1 / 4 个模型')
  await catalog.getByRole('searchbox', { name: '搜索模型价格', exact: true }).fill('不存在')
  await expect(catalog.getByRole('article')).toHaveCount(0)
  await expect(catalog.getByRole('button', { name: '查看全部模型', exact: true })).toBeVisible()
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

test('classification failure preserves all prices and retries without losing uncategorized models', async ({ page }) => {
  const { state } = await fixture(page)
  state.catalogueFailure = true
  state.rows.push({ model: 'embedding-custom', group: 'auto', billing: '按量计费', price: '$ 0' })
  const catalog = await open(page)
  await expect(catalog.getByRole('article')).toHaveCount(5)
  await expect(catalog.getByRole('alert')).toContainText('模型分类暂不可用')
  await expect(catalog.getByRole('button', { name: '图片模型', exact: true })).toBeDisabled()
  state.catalogueFailure = false
  await catalog.getByRole('button', { name: '重试分类', exact: true }).click()
  await expect(catalog.getByRole('alert')).toHaveCount(0)
  await catalog.getByRole('button', { name: '图片模型', exact: true }).click()
  await expect(catalog.getByRole('article')).toHaveCount(2)
  state.catalogue = []
  await catalog.getByRole('button', { name: '刷新价格', exact: true }).click()
  await expect(catalog.getByRole('button', { name: '查看全部模型', exact: true })).toBeVisible()
  await catalog.getByRole('button', { name: '查看全部模型', exact: true }).click()
  await expect(catalog.getByRole('article')).toHaveCount(5)
  expect(state.writes).toBe(0)
})

test('slow classification does not block prices and multiple capabilities match each supported type', async ({ page }) => {
  const { state } = await fixture(page)
  state.catalogue[0]!.kinds = ['text', 'image']
  let finish!: () => void
  const held = new Promise<void>(resolve => { finish = resolve })
  await page.route('**/api/creation/models?scope=all', async route => {
    await held
    await route.fulfill({ json: { items: state.catalogue } })
  })
  const catalog = await open(page)
  try {
    await expect(catalog.getByRole('article')).toHaveCount(4)
    await expect(catalog.getByRole('button', { name: '图片模型', exact: true })).toBeDisabled()
    await expect(catalog.getByText('正在读取模型分类…', { exact: true })).toBeVisible()
  } finally { finish() }
  await catalog.getByRole('button', { name: '图片模型', exact: true }).click()
  await expect(catalog.getByRole('article')).toHaveCount(3)
  await catalog.getByRole('button', { name: '文本模型', exact: true }).click()
  await expect(catalog.getByRole('article')).toHaveCount(1)
})

test('switching accounts discards pending old prices and classification', async ({ page }) => {
  const { accountState, state } = await fixture(page, false)
  let finish!: () => void
  const held = new Promise<void>(resolve => { finish = resolve })
  const oldReads: string[] = []
  for (const endpoint of ['**/api/creation/models?scope=all', '**/api/new-api/model-pricing']) await page.route(endpoint, async route => {
    if (route.request().headers()['x-new-api-user'] !== '17') return route.fallback()
    oldReads.push(endpoint)
    await held
    await route.fulfill({ json: endpoint.includes('model-pricing')
      ? { success: true, data: { userId: 17, rows: priceRows() } }
      : { items: [{ id: 'gpt-5', kinds: ['video'] }] } }).catch(() => {})
  })
  await page.goto('/models')
  const catalog = page.getByRole('region', { name: '模型广场', exact: true })
  try {
    await expect.poll(() => oldReads.length).toBe(2)
    accountState.user = { ...accountState.user, id: '18', accountId: '18' }
    state.userId = 18
    state.rows = [{ model: 'second-account-image', group: 'auto', billing: '每次请求', price: '$ 1' }]
    state.catalogue = [{ id: 'second-account-image', kinds: ['image'] }]
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(catalog.getByRole('article')).toHaveCount(1)
    await expect(catalog.getByRole('article').first()).toHaveAccessibleName('second-account-image 模型价格')
  } finally { finish() }
  await catalog.getByRole('button', { name: '视频模型', exact: true }).click()
  await expect(catalog.getByRole('article')).toHaveCount(0)
  await catalog.getByRole('button', { name: '图片模型', exact: true }).click()
  await expect(catalog.getByRole('article').first()).toHaveAccessibleName('second-account-image 模型价格')
})

for (const width of [1440, 390, 320]) test(`community tools opens the model plaza directly at ${width}px`, async ({ page }) => {
  const { state } = await fixture(page, false)
  await page.setViewportSize({ width, height: 1000 })
  await page.goto('/community')
  await page.getByTitle('社区工具', { exact: true }).click()
  const panel = page.getByRole('dialog', { name: '社区工具', exact: true })
  await expect(panel.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0)
  await panel.getByRole('link', { name: '模型广场', exact: true }).click()
  await expect(page).toHaveURL(/\/models$/)
  await expect(panel).toBeHidden()
  await expect(page.getByRole('heading', { name: '模型广场', level: 1, exact: true })).toBeVisible()
  const catalog = page.getByRole('region', { name: '模型广场', exact: true })
  await expect(catalog.getByRole('article')).toHaveCount(4)
  await catalog.getByRole('button', { name: '视频模型', exact: true }).click()
  await expect(catalog.getByRole('article')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath(`models-entry-${width}.png`), fullPage: true })
  await page.reload()
  await expect(catalog.getByRole('article')).toHaveCount(4)
  await page.goBack()
  await expect(page).toHaveURL(/\/community$/)
  await page.goForward()
  await expect(page).toHaveURL(/\/models$/)
  await expect(catalog.getByRole('article')).toHaveCount(4)
  expect(state.writes).toBe(0)
})

test('guests keep the model plaza login return destination', async ({ page }) => {
  await mockUnifiedAccount(page, false)
  await page.goto('/discover')
  await page.getByTitle('社区工具', { exact: true }).click()
  await page.getByRole('dialog', { name: '社区工具', exact: true }).getByRole('link', { name: '模型广场', exact: true }).click()
  await expect(page).toHaveURL(/\/account\?returnTo=\/models$/)
  await page.goto('/models')
  await expect(page.getByRole('heading', { name: '登录后查看模型广场', exact: true })).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('link', { name: '登录', exact: true })).toHaveAttribute('href', '/account?returnTo=/models')
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
    await page.screenshot({ path: test.info().outputPath(`grid-${width}-${theme}.png`), fullPage: true })
    const filters = catalog.getByRole('group', { name: '模型类型', exact: true })
    for (const label of ['文本模型', '图片模型', '视频模型', '全部模型']) {
      const button = filters.getByRole('button', { name: label, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    }
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
  await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  await page.getByRole('dialog', { name: '创作台菜单', exact: true }).getByRole('button', { name: '返回创作', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  await expect(catalog).toHaveCount(0)
  expect(errors).toEqual([])
})
