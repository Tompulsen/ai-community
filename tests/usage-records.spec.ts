import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount, fillAccountLogin } from './helpers/account-fixture'

const specialModel = 'vendor/模型_%&+legacy'
async function fixture(page: Page, authenticated = true) {
  const account = await mockUnifiedAccount(page, authenticated)
  const state = { failure: false, empty: false, delay: 0 }
  const queries: URLSearchParams[] = []
  await page.route('**/api/new-api/status', route => route.fulfill({ json: { success: true, data: { quotaPerUnit: 100, currencySymbol: '积分', enabled: true, configured: true, passwordLoginEnabled: true } } }))
  await page.route('**/api/new-api/logs?**', async route => {
    const query = new URL(route.request().url()).searchParams
    queries.push(query)
    const delayed = state.delay
    if (delayed) await new Promise(resolve => setTimeout(resolve, delayed))
    if (state.failure) return route.fulfill({ status: 503, json: { success: false, message: '消费记录读取失败' } })
    const models = state.empty ? [] : [
      { model: 'gpt-image-2', totals: { consumeQuota: 62500, refundQuota: 2500, netQuota: 60000, consumeRecords: 22, refundRecords: 1, promptTokens: 12345, completionTokens: 2345 } },
      { model: specialModel, totals: { consumeQuota: 0, refundQuota: 1500, netQuota: -1500, consumeRecords: 0, refundRecords: 1, promptTokens: 0, completionTokens: 0 } },
    ]
    const summary = { consumeQuota: 0, refundQuota: 0, netQuota: 0, consumeRecords: 0, refundRecords: 0, promptTokens: 0, completionTokens: 0 }
    for (const item of models.filter(item => !query.has('model') || query.get('model') === item.model)) for (const key of Object.keys(summary) as (keyof typeof summary)[]) summary[key] += item.totals[key]
    const secondPage = query.get('page') === '2'
    const refundOnly = query.get('model') === specialModel
    const items = state.empty ? [] : [{ id: secondPage ? 21 : 1, created_at: Number(query.get('end')) - 20,
      model_name: refundOnly ? specialModel : 'gpt-image-2', token_name: '社区创作', type: refundOnly ? 6 : 2, quota: refundOnly ? 1500 : secondPage ? 123 : 62500, prompt_tokens: 120, completion_tokens: 24 }]
    return route.fulfill({ json: { success: true, data: { items, models, summary, total: summary.consumeRecords + summary.refundRecords, page: Number(query.get('page')), size: 20, start: Number(query.get('start')), end: Number(query.get('end')) } } })
  })
  return { account, state, queries }
}
const records = (page: Page) => page.getByRole('region', { name: '消费记录', exact: true })

test('community tool and studio share statistics; paging preserves the full interval and totals', async ({ page }) => {
  const { queries } = await fixture(page)
  await page.goto('/community')
  await page.getByTitle('社区工具', { exact: true }).click()
  await page.getByRole('dialog', { name: '社区工具', exact: true }).getByRole('link', { name: '消费记录', exact: true }).click()
  await expect(page).toHaveURL(/\/usage-logs$/)
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('585')
  await expect(records(page).getByRole('article', { name: '消费积分', exact: true })).toContainText('22 条消费记录')
  await expect(page.getByRole('cell', { name: '− 积分 625', exact: true })).toBeVisible()
  const first = queries[0]!
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByRole('cell', { name: '− 积分 1.23', exact: true })).toBeVisible()
  expect(queries.at(-1)!.get('end')).toBe(first.get('end'))
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('585')
  await page.goto('/create/image')
  await page.getByRole('button', { name: /^创作台菜单/ }).click()
  await page.getByRole('button', { name: '消费记录', exact: true }).click()
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('585')
})

test('historical model selection is exact, handles refund-only periods and resets paging', async ({ page }) => {
  const { queries } = await fixture(page)
  await page.goto('/usage-logs')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByRole('cell', { name: '− 积分 1.23', exact: true })).toBeVisible()
  await records(page).getByLabel('模型', { exact: true }).selectOption(specialModel)
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('-15')
  await expect(page.getByRole('cell', { name: '+ 积分 15', exact: true })).toBeVisible()
  expect(queries.at(-1)!.get('page')).toBe('1')
  expect(queries.at(-1)!.get('model')).toBe(specialModel)
  await page.getByLabel('时间范围', { exact: true }).selectOption('30')
  await expect.poll(() => Number(queries.at(-1)!.get('end')) - Number(queries.at(-1)!.get('start'))).toBe(30 * 86400)
  await page.getByRole('button', { name: '重置筛选', exact: true }).click()
  await expect(records(page).getByLabel('模型', { exact: true }).locator('option:checked')).toHaveText('全部模型')
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('585')
})

test('empty and unavailable results are distinct and retry restores full statistics', async ({ page }) => {
  const { state } = await fixture(page)
  state.empty = true
  await page.goto('/usage-logs')
  await expect(page.getByRole('heading', { name: '暂无消费记录', exact: true })).toBeVisible()
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('0')
  state.failure = true
  await page.getByRole('button', { name: '刷新消费记录' }).click()
  await expect(records(page).getByRole('alert')).toContainText('消费记录读取失败')
  await expect(page.getByRole('heading', { name: '暂无消费记录', exact: true })).toHaveCount(0)
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toHaveCount(0)
  state.failure = false; state.empty = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('585')
})

test('guest entry returns to usage records after login', async ({ page }) => {
  await fixture(page, false)
  await page.goto('/usage-logs')
  await expect(page.getByRole('heading', { name: '登录后查看消费记录' })).toBeVisible()
  await page.getByRole('link', { name: '登录', exact: true }).last().click()
  await fillAccountLogin(page)
  await expect(page).toHaveURL(/\/usage-logs$/)
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('585')
})

test('a slow old filter cannot overwrite a newer selection', async ({ page }) => {
  const { state, queries } = await fixture(page)
  await page.goto('/usage-logs')
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toBeVisible()
  state.delay = 500
  await page.getByLabel('时间范围', { exact: true }).selectOption('1')
  await expect.poll(() => queries.length).toBe(2)
  state.delay = 0
  await records(page).getByLabel('模型', { exact: true }).selectOption(specialModel)
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('-15')
  await page.waitForTimeout(600)
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('-15')
})

test('account changes clear old records, model filters and in-flight results', async ({ page }) => {
  const { account, state } = await fixture(page)
  await page.goto('/usage-logs')
  await records(page).getByLabel('模型', { exact: true }).selectOption(specialModel)
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('-15')
  state.delay = 600
  await page.getByRole('button', { name: '刷新消费记录' }).click()
  account.state.user = { ...account.state.user, id: 'anotherAccount', accountId: '18' }
  state.delay = 0; state.empty = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: '暂无消费记录' })).toBeVisible()
  await expect(records(page).getByLabel('模型', { exact: true }).locator('option:checked')).toHaveText('全部模型')
  await expect(page.getByRole('option', { name: specialModel, exact: true })).toHaveCount(0)
  await page.waitForTimeout(650)
  await expect(page.getByRole('heading', { name: '暂无消费记录' })).toBeVisible()
})

test('mobile community tools expose the usage shortcut and close after navigation', async ({ page }) => {
  await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/community')
  await page.getByTitle('社区工具', { exact: true }).click()
  const panel = page.getByRole('dialog', { name: '社区工具', exact: true })
  await panel.getByRole('link', { name: '消费记录', exact: true }).click()
  await expect(panel).toBeHidden()
  await expect(page).toHaveURL(/\/usage-logs$/)
  await expect(page.locator('.usage-record').first()).toBeVisible()
})

for (const [width, theme] of [[320, 'light'], [390, 'dark'], [1440, 'light']] as const) test(`usage is readable and accessible at ${width} in ${theme}`, async ({ page }, info) => {
  await fixture(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/usage-logs')
  await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), theme)
  await expect(records(page).getByRole('article', { name: '积分净消耗', exact: true })).toContainText('585')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (width < 700) {
    await expect(page.getByRole('table')).toBeHidden()
    await expect(page.locator('.usage-record').first()).toContainText('625')
  }
  const violations = (await new AxeBuilder({ page }).include('.usage-records').analyze()).violations
  expect(violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`usage-${width}-${theme}.png`), fullPage: true })
})
