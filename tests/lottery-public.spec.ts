import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { defaultLotterySettings } from '../server/business/lottery'
import { defaultDailyLotteryPrizes, lotteryDay } from '../shared/lottery-daily'
import { defaultWelfareTasks } from '../shared/welfare-tasks'
import type { PublicLotteryDraw } from '../shared/lottery-public'
import { mockUnifiedAccount } from './helpers/account-fixture'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
async function fixture(page: Page, authenticated = true) {
  await mockUnifiedAccount(page, authenticated)
  const settings = { ...defaultLotterySettings(), enabled: true, dailyLimit: 200,
    prizes: defaultDailyLotteryPrizes(5000).map(prize => ({ ...prize, dailyQuota: prize.stock })) }
  const state = { fail: false, participated: false, publicReads: 0, more: false, cursors: [] as string[],
    items: [{ id: 'draw5', participant: '创***', createdAt: '2026-11-21T12:03:00Z', drawCount: 1, totalDrawCount: '7',
      prizes: [{ name: '一等奖', status: 'fulfilled', rewardKind: 'charity', points: '6000' }] },
    { id: 'draw4', participant: '小***', createdAt: '2026-11-21T11:02:00Z', drawCount: 3, totalDrawCount: '12',
      prizes: [{ name: '🤡 非常遗憾', status: 'fulfilled', rewardKind: 'charity', points: '1000' },
        { name: '二等奖', status: 'pending', rewardKind: 'charity', points: null },
        { name: '旧奖励', status: 'fulfilled', rewardKind: 'balance', points: null }] },
    { id: 'draw3', participant: '匿名用户', createdAt: '2026-11-21T10:00:00Z', drawCount: 1, totalDrawCount: null,
      prizes: [{ name: '未中奖', status: 'empty', rewardKind: 'balance', points: null }] }] as PublicLotteryDraw[] }
  await page.route('**/api/welfare/tasks', route => route.fulfill({ json: { items: defaultWelfareTasks() } }))
  await page.route('**/api/lottery/public-records*', route => {
    state.publicReads++
    const url = new URL(route.request().url()); state.cursors.push(url.search)
    if (state.fail) return route.fulfill({ status: 503, json: { error: '稍后重试' } })
    return route.fulfill({ json: { items: url.searchParams.has('cursor') ? [{ ...state.items[0]!, id: 'draw2' }] : state.items,
      snapshot: 'draw5', nextCursor: state.more && !url.searchParams.has('cursor') ? 'draw3' : null } })
  })
  const day = lotteryDay(new Date())
  await page.route('**/api/lottery/status', route => route.fulfill({ json: { settings, balance: 1, creditReady: true, accountLinked: authenticated,
    daily: { date: day.date, timezone: 'Asia/Shanghai', resetsAt: day.end.toISOString(), limit: 200, remaining: 200, used: 0, participated: state.participated },
    consumption: { checked: true, eligible: true, amountCnyFen: 1000 }, counts: { invites: 0, likes: 0, bestWorkLikes: 0, followers: 0 }, earned: { invites: 0, likes: 0, followers: 0 } } }))
  await page.route('**/api/new-api/status', route => route.fulfill({ json: { success: true, data: { currencySymbol: '积分', pointsPerUsd: 5000 } } }))
  await page.route('**/api/lottery/records*', route => route.fulfill({ json: { items: [], nextCursor: null } }))
  await page.route('**/api/lottery/draw', route => {
    state.participated = true; state.items.unshift({ ...state.items[0]!, id: 'draw6', participant: '我***' })
    return route.fulfill({ json: { id: 'draw6', createdAt: new Date().toISOString(), prizes: [{ prizeId: 'daily-fourth', name: '🤡 非常遗憾', amountCents: 20, status: 'pending', rewardKind: 'charity', validityHours: 24 }] } })
  })
  return state
}

for (const [width, mode] of [[320, 'dark'], [390, 'light'], [1440, 'dark'], [1440, 'light']] as const) test(`public lottery results and clown fit ${width}px ${mode}`, async ({ page }, info) => {
  await fixture(page, false)
  await page.setViewportSize({ width, height: 1000 })
  await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'paper', dark: 'sage' })), mode)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/activities')
  const panel = page.locator('.lottery-public-results')
  await expect(panel.locator('tbody tr')).toHaveCount(3)
  await expect(panel).toContainText('6,000 福利积分')
  await expect(panel).toContainText('本次 3 次')
  await expect(panel).toContainText('累计 12 次')
  await expect(panel).toContainText('待发放')
  await expect(panel).toContainText('发放记录待核对')
  await expect(panel.locator('.public-awards li').filter({ hasText: '旧奖励' })).not.toContainText('已到账')
  await expect(panel).toContainText('累计次数待核对')
  await expect(panel).toContainText('2026/11/21')
  await expect(page.locator('.wheel-label')).toHaveText(['一等奖', '二等奖', '三等奖', '🤡'])
  await expect(page.locator('.prize-list').getByRole('img', { name: '小丑奖' })).toBeVisible()
  await expect(page.locator('.prize-list')).not.toContainText('非常遗憾')
  await expect(page.locator('.prize-list')).toContainText('1,000 福利积分')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.lottery-public-results').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`lottery-public-${width}-${mode}.png`), fullPage: true })
  expect(errors).toEqual([])
})

test('pagination preserves the snapshot and refresh replaces the list without duplicates', async ({ page }) => {
  const state = await fixture(page); state.more = true
  await page.goto('/activities')
  const panel = page.locator('.lottery-public-results')
  await panel.getByRole('button', { name: '查看更多抽奖记录' }).click()
  await expect(panel.locator('tbody tr')).toHaveCount(4)
  expect(state.cursors.at(-1)).toBe('?cursor=draw3&snapshot=draw5')
  await expect(panel.getByRole('button', { name: '查看更多抽奖记录' })).toHaveCount(0)
  await panel.getByRole('button', { name: '刷新中奖动态' }).click()
  await expect(panel.locator('tbody tr')).toHaveCount(3)
  expect(state.cursors.at(-1)).toBe('')
})

test('failure, retry and empty results are explicit without affecting the draw controls', async ({ page }) => {
  const state = await fixture(page); state.fail = true
  await page.goto('/activities')
  const panel = page.locator('.lottery-public-results')
  await expect(panel.getByRole('alert')).toContainText('中奖动态读取失败')
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  state.fail = false; state.items = []
  await panel.getByRole('button', { name: '重新读取中奖动态' }).click()
  await expect(panel).toContainText('还没有抽奖记录')
})

test('successful draws refresh public records and precise historical points are never rounded', async ({ page }) => {
  const state = await fixture(page)
  state.items[0]!.prizes[0]!.points = '9007199254740993.123456'
  await page.goto('/activities')
  const panel = page.locator('.lottery-public-results')
  await expect(panel).toContainText('9,007,199,254,740,993.123456 福利积分')
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  const readsBeforeDraw = state.publicReads
  await page.locator('.draw-console > .button').click()
  await expect(panel.locator('tbody tr')).toHaveCount(4)
  await expect(panel).toContainText('我***')
  expect(state.publicReads).toBe(readsBeforeDraw + 1)
})
