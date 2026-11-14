import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const origin = process.env.COMMUNITY_REGRESSION_ORIGIN || 'http://localhost:18775'
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Lottery fixtures must run against a local preview.')
test.use({ baseURL: origin, serviceWorkers: 'block' })
const screenshots = '.taste-skill/admin-complete-20261114/shots'
const ratio = '500000.000000000000000000000000000001'
const baseAward = { name: '余额奖励', amountCents: 50, note: '', reference: '', status: 'fulfilled', deliveryStatus: 'fulfilled', blockedReason: null, receiptStatus: 'missing', creditReceipt: null, amountMatches: null }

function recordsFixture() {
  const draw = (id: string, award: Record<string, unknown>, pending = false, attempts = 1) => ({
    id, userId: '17', username: 'root', createdAt: '2026-11-14T01:00:00Z', creditAttempts: attempts,
    creditPending: pending, creditAccountId: 17, creditRetryAt: pending ? '2026-11-14T01:03:00Z' : null,
    prizes: [{ ...baseAward, ...award, reference: `community_lottery_${id}_0` }],
  })
  return [
    draw('paidDraw', { name: '已核验奖励', receiptStatus: 'verified', creditReceipt: { id: 81, quotaAdded: 250000, quotaPerUsd: ratio }, amountMatches: true }),
    draw('legacyDraw', { name: '旧记录奖励' }),
    draw('blockedDraw', { name: '异常凭证奖励', status: 'pending', deliveryStatus: 'blocked', receiptStatus: 'invalid', blockedReason: 'UPSTREAM_REJECTED_OR_INVALID_RECEIPT' }, true, 3),
    draw('pendingDraw', { name: '待到账奖励', status: 'pending', deliveryStatus: 'pending' }, true),
    draw('emptyDraw', { name: '未中奖记录', status: 'empty', deliveryStatus: 'empty', amountCents: 0, receiptStatus: 'not-required' }, false, 0),
  ]
}

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  account.state.user.isAdmin = true
  account.state.user.isModerator = true
  const queries: URLSearchParams[] = []
  const writes: { path: string; body: Record<string, unknown>; csrf?: string }[] = []
  const outside: string[] = []
  const controls = { failRecords: false }
  const draws = recordsFixture()
  await page.route('**/api/admin/lottery/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() !== 'GET') {
      writes.push({ path: url.pathname, body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] })
      return route.fulfill({ json: { id: request.postDataJSON().drawId, prizes: [] } })
    }
    if (url.pathname.endsWith('/config')) return route.fulfill({ json: {
      version: 1, settings: {
        enabled: false, invites: { enabled: true, threshold: 1, tickets: 1 },
        likes: { enabled: true, threshold: 100, tickets: 1 }, followers: { enabled: true, threshold: 100, tickets: 1 },
        likesMode: 'work', prizes: [], wheel: { theme: 'teal', title: '', subtitle: '', buttonText: 'GO', rulesText: '' },
      },
    } })
    if (url.pathname.endsWith('/records')) {
      queries.push(url.searchParams)
      if (controls.failRecords) return route.fulfill({ status: 503, json: { error: '奖励记录暂不可用，请重试。' } })
      const params = url.searchParams, status = params.get('status') || 'all'
      const filtered = draws.filter(draw => (!params.get('userId') || draw.userId === params.get('userId'))
        && (status === 'all' || draw.prizes.some(award => award.deliveryStatus === status)))
      const paged = !params.get('userId') && status === 'all'
      return route.fulfill({ json: {
        items: paged ? params.has('cursor') ? filtered.slice(4) : filtered.slice(0, 4) : filtered,
        nextCursor: paged && !params.has('cursor') ? 'recordPage2' : null,
      } })
    }
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(origin).origin) {
      outside.push(`${route.request().method()} ${url.origin}${url.pathname}`)
      return route.abort()
    }
    return route.fallback()
  })
  return { account, queries, writes, outside, controls }
}

async function openLottery(page: Page) {
  await page.goto('/admin?tab=lottery')
  await expect(page.locator('tr[data-draw-id]')).toHaveCount(4)
}

async function expand(page: Page, id: string) {
  const button = page.getByRole('button', { name: `查看对账：${id}`, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  return page.getByRole('region', { name: `发放对账：${id}`, exact: true })
}

for (const width of [1440, 390]) {
  test(`saved credit evidence distinguishes valid, missing and invalid receipts at ${width}px`, async ({ page }) => {
    const state = await fixture(page)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height: 1000 })
    await openLottery(page)
    const paid = await expand(page, 'paidDraw')
    await expect(paid).toContainText('已保存的到账凭证')
    await expect(paid).toContainText('账号 ID：17')
    await expect(paid).toContainText('community_lottery_paidDraw_0')
    await expect(paid).toContainText('250,000 quota')
    await expect(paid).toContainText(`${ratio} quota / USD`)
    await expect(paid).toContainText('金额与凭证兑换比例一致')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await mkdir(screenshots, { recursive: true })
    await page.locator('.lottery-records .table-wrap').evaluate(element => { element.scrollLeft = 0 })
    await page.locator('.lottery-records').screenshot({ path: `${screenshots}/lottery-receipts-${width}.png` })

    const legacy = await expand(page, 'legacyDraw')
    await expect(legacy).toContainText('缺少凭证，无法核对')
    await expect(legacy).toContainText('此记录未保存到账凭证，无法核对实际额度。')
    await expect(legacy).not.toContainText('金额与凭证兑换比例一致')
    await expect(legacy).not.toContainText('实际添加额度')
    const blocked = await expand(page, 'blockedDraw')
    await expect(blocked).toContainText('凭证校验未通过')
    await expect(blocked).toContainText('3 / 3 次')
    await expect(blocked).toContainText('自动重试已暂停')
    await expect(blocked).toContainText('上游拒绝或回执校验失败，原记录未留存具体原因。')
    await expect(blocked).not.toContainText('实际添加额度')
    await expect(blocked).not.toContainText('金额与凭证兑换比例一致')
    expect(state.writes).toEqual([])
    expect(state.account.mutations).toEqual([])
    expect(state.outside).toEqual([])
    expect(errors).toEqual([])
  })
}

test('award state and user filters start without an old pagination cursor', async ({ page }) => {
  const state = await fixture(page)
  await openLottery(page)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(page.locator('tr[data-draw-id]')).toHaveCount(5)
  expect(state.queries.at(-1)?.get('cursor')).toBe('recordPage2')
  await page.getByLabel('用户编号', { exact: true }).fill('17')
  await page.getByRole('combobox', { name: '奖项状态', exact: true }).selectOption('pending')
  await page.getByRole('button', { name: '筛选记录', exact: true }).click()
  await expect(page.locator('tr[data-draw-id]')).toHaveCount(1)
  await expect(page.locator('tr[data-draw-id="pendingDraw"]')).toBeVisible()
  expect(state.queries.at(-1)?.get('userId')).toBe('17')
  expect(state.queries.at(-1)?.get('status')).toBe('pending')
  expect(state.queries.at(-1)?.has('cursor')).toBe(false)
  await page.getByRole('combobox', { name: '奖项状态', exact: true }).selectOption('blocked')
  await page.getByRole('button', { name: '筛选记录', exact: true }).click()
  await expect(page.locator('tr[data-draw-id="blockedDraw"]')).toBeVisible()
  await page.getByLabel('用户编号', { exact: true }).fill('404')
  await page.getByRole('button', { name: '筛选记录', exact: true }).click()
  await expect(page.getByText('没有符合筛选条件的奖励记录。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0)
  expect(state.writes).toEqual([])
  expect(state.outside).toEqual([])
})

test('a retry requires an explicit confirmation and submits the original draw with CSRF', async ({ page }) => {
  const state = await fixture(page)
  await openLottery(page)
  const row = page.locator('tr[data-draw-id="pendingDraw"]')
  await row.getByRole('button', { name: '重试发放', exact: true }).click()
  await expect(row.getByText('核对并重试此笔奖励？', { exact: true })).toBeVisible()
  expect(state.writes).toEqual([])
  await row.getByRole('button', { name: '取消', exact: true }).click()
  expect(state.writes).toEqual([])
  await row.getByRole('button', { name: '重试发放', exact: true }).click()
  await row.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已重新核对发放结果。' })).toBeVisible()
  expect(state.writes).toEqual([{ path: '/api/admin/lottery/retry', body: { drawId: 'pendingDraw' }, csrf: 'unified-account-fixture' }])
  expect(state.outside).toEqual([])
})

test('a failed records read preserves the filter and can be retried', async ({ page }) => {
  const state = await fixture(page)
  await openLottery(page)
  state.controls.failRecords = true
  await page.getByLabel('用户编号', { exact: true }).fill('17')
  await page.getByRole('combobox', { name: '奖项状态', exact: true }).selectOption('blocked')
  await page.getByRole('button', { name: '筛选记录', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('奖励记录暂不可用，请重试。')
  await expect(page.getByLabel('用户编号', { exact: true })).toHaveValue('17')
  await expect(page.getByRole('combobox', { name: '奖项状态', exact: true })).toHaveValue('blocked')
  state.controls.failRecords = false
  await page.getByRole('button', { name: '刷新奖励记录', exact: true }).click()
  await expect(page.locator('tr[data-draw-id="blockedDraw"]')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(state.writes).toEqual([])
  expect(state.outside).toEqual([])
})
