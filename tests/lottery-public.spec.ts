import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { defaultLotterySettings } from '../server/business/lottery'
import { defaultDailyLotteryPrizes, lotteryDay } from '../shared/lottery-daily'
import { defaultWelfareTasks } from '../shared/welfare-tasks'
import { lotteryPointUnits, lotteryPointsFromUnits, type PublicLotteryParticipant } from '../shared/lottery-public'
import { publicLotteryRange } from '../server/lottery'
import { mockUnifiedAccount } from './helpers/account-fixture'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
const statsNow = new Date('2026-11-22T12:00:00Z')
async function fixture(page: Page, authenticated = true) {
  await page.clock.setFixedTime(statsNow)
  await mockUnifiedAccount(page, authenticated)
  const settings = { ...defaultLotterySettings(), enabled: true, dailyLimit: 200,
    prizes: defaultDailyLotteryPrizes(5000).map(prize => ({ ...prize, dailyQuota: prize.stock })) }
  const state = { fail: false, participated: false, publicReads: 0, statusReads: 0, requests: [] as string[],
    items: [{ id: 'draw1', participant: '创***', drawCount: '7', totalPoints: '6100', charityPoints: '2000', permanentPoints: '4100',
      fulfilledCount: '3', pendingCount: '1', unverifiedCount: '2', emptyCount: '1' },
    { id: 'draw2', participant: '小***', drawCount: '12', totalPoints: '1000', charityPoints: '1000', permanentPoints: '0',
      fulfilledCount: '1', pendingCount: '0', unverifiedCount: '0', emptyCount: '11' },
    { id: 'draw3', participant: '匿名用户', drawCount: '1', totalPoints: '0', charityPoints: '0', permanentPoints: '0',
      fulfilledCount: '0', pendingCount: '0', unverifiedCount: '0', emptyCount: '1' }] as PublicLotteryParticipant[] }
  await page.route('**/api/welfare/tasks', route => route.fulfill({ json: { items: defaultWelfareTasks() } }))
  await page.route('**/api/lottery/public-summary*', route => {
    state.publicReads++
    state.requests.push(route.request().url())
    if (state.fail) return route.fulfill({ status: 503, json: { error: '稍后重试' } })
    const range = publicLotteryRange(new URL(route.request().url()).searchParams, statsNow)
    const points = (field: 'totalPoints' | 'charityPoints' | 'permanentPoints') => lotteryPointsFromUnits(state.items.reduce((sum, item) => sum + lotteryPointUnits(item[field]), 0n))
    const counts = (field: 'drawCount' | 'fulfilledCount') => state.items.reduce((sum, item) => sum + BigInt(item[field]), 0n).toString()
    const totals = { totalPoints: points('totalPoints'), charityPoints: points('charityPoints'), permanentPoints: points('permanentPoints'),
      drawCount: counts('drawCount'), fulfilledCount: counts('fulfilledCount'), participantCount: String(state.items.length), undatedPoints: '0' }
    const daily = Array.from({ length: range.days ?? 1 }, (_, index) => ({ date: new Date(Date.parse(range.end ?? '2026-11-22') - index * 86400000).toISOString().slice(0, 10),
      totalPoints: index ? '0' : totals.totalPoints, charityPoints: index ? '0' : totals.charityPoints, permanentPoints: index ? '0' : totals.permanentPoints,
      drawCount: index ? '0' : totals.drawCount, fulfilledCount: index ? '0' : totals.fulfilledCount }))
    return route.fulfill({ json: { items: state.items, range, totals, daily, updatedAt: statsNow.toISOString() } })
  })
  const day = lotteryDay(new Date())
  await page.route('**/api/lottery/status', route => { state.statusReads++; return route.fulfill({ json: { settings, balance: 1, creditReady: true, accountLinked: authenticated,
    daily: { date: day.date, timezone: 'Asia/Shanghai', resetsAt: day.end.toISOString(), limit: 200, remaining: 200, used: 0, participated: state.participated },
    support: { checked: true, eligible: true, amountCnyFen: 1000 }, counts: { invites: 0, likes: 0, bestWorkLikes: 0, followers: 0 }, earned: { invites: 0, likes: 0, followers: 0 } } }) })
  await page.route('**/api/new-api/status', route => route.fulfill({ json: { success: true, data: { currencySymbol: '积分', pointsPerUsd: 5000 } } }))
  await page.route('**/api/lottery/records*', route => route.fulfill({ json: { items: [], nextCursor: null } }))
  await page.route('**/api/lottery/draw', route => {
    state.participated = true; state.items[0]!.drawCount = String(BigInt(state.items[0]!.drawCount) + 1n)
    return route.fulfill({ json: { id: 'draw6', createdAt: new Date().toISOString(), prizes: [{ prizeId: 'daily-fourth', name: '🤡 非常遗憾', amountCents: 20, status: 'pending', rewardKind: 'charity', validityHours: 24 }] } })
  })
  return state
}

test('rankings load on demand and keep their result when switching tabs', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/activities')
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  expect(state.publicReads).toBe(0)
  await page.getByRole('button', { name: '排行榜', exact: true }).click()
  await expect(page.locator('.lottery-public-results tbody tr')).toHaveCount(3)
  expect(state.publicReads).toBe(1)
  await page.getByRole('button', { name: '活动抽奖', exact: true }).click()
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  await page.getByRole('button', { name: '排行榜', exact: true }).click()
  await expect(page.locator('.lottery-public-results')).toBeVisible()
  expect(state.publicReads).toBe(1)
  await page.getByRole('button', { name: '刷新排行榜', exact: true }).click()
  await expect.poll(() => state.publicReads).toBe(2)
})

for (const [width, mode] of [[320, 'dark'], [390, 'light'], [1440, 'dark'], [1440, 'light']] as const) test(`public lottery results and clown fit ${width}px ${mode}`, async ({ page }, info) => {
  await fixture(page, false)
  await page.setViewportSize({ width, height: 1000 })
  await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'paper', dark: 'sage' })), mode)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/activities')
  await expect(page.locator('.wheel-label')).toHaveText(['一等奖', '二等奖', '三等奖', '🤡'])
  await expect(page.locator('.prize-list').getByRole('img', { name: '小丑奖' })).toBeVisible()
  await expect(page.locator('.prize-list')).not.toContainText('非常遗憾')
  await expect(page.locator('.prize-list')).toContainText('1,000 福利积分')
  await page.getByRole('button', { name: '排行榜', exact: true }).click()
  const panel = page.locator('.lottery-public-results')
  await expect(panel.locator('tbody tr')).toHaveCount(3)
  await expect(panel).toContainText('6,100 积分')
  await expect(panel).toContainText('福利积分 2,000')
  await expect(panel).toContainText('账户积分 4,100')
  await expect(panel).toContainText('12 次')
  await expect(panel).toContainText('待发放 1 次')
  await expect(panel).toContainText('待核对 2 次')
  await expect(panel).not.toContainText('本次')
  await expect(panel.locator('.public-users time')).toHaveCount(0)
  await expect(panel.locator('.public-day-list time')).toHaveAttribute('datetime', '2026-11-22')
  await expect(panel.locator('.public-total')).toContainText('7,100')
  await expect(panel.getByRole('button', { name: '今日', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel).not.toContainText('抽奖时间')
  await expect(panel.getByText('创***', { exact: true })).toHaveCount(1)
  await expect(panel.getByLabel('排序方式')).toHaveValue('points-desc')
  await panel.getByLabel('排序方式').focus()
  await page.keyboard.press('ArrowDown')
  await expect(panel.getByLabel('排序方式')).toHaveValue('points-asc')
  const control = await panel.getByLabel('排序方式').boundingBox()
  expect(control!.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.lottery-public-results').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`lottery-public-${width}-${mode}.png`), fullPage: true })
  expect(errors).toEqual([])
})

test('all four sorts are numeric and stable; more users and refresh preserve one row per identity', async ({ page }) => {
  const state = await fixture(page)
  state.items.push({ ...state.items[0]!, id: 'draw4', participant: '同***' })
  await page.goto('/activities?tab=leaderboard')
  const panel = page.locator('.lottery-public-results'), names = panel.locator('tbody tr td:first-child')
  await expect(panel.locator('tbody tr')).toHaveCount(4)
  expect(state.statusReads).toBe(0)
  expect(state.publicReads).toBe(1)
  for (const [sort, order] of [
    ['points-desc', ['创***','同***','小***','匿名用户']],
    ['points-asc', ['匿名用户','小***','创***','同***']],
    ['draws-desc', ['小***','创***','同***','匿名用户']],
    ['draws-asc', ['匿名用户','创***','同***','小***']],
  ] as const) {
    await panel.getByLabel('排序方式').selectOption(sort)
    await expect(names).toHaveText([...order])
  }
  state.items = Array.from({length:25}, (_,i) => ({...state.items[0]!,id:`user${i}`,participant:`用户${i}`,totalPoints:String(i)}))
  await page.getByRole('button', { name: '刷新排行榜' }).click()
  await expect(panel.locator('tbody tr')).toHaveCount(20)
  await panel.getByRole('button', { name: '查看更多用户' }).click()
  await expect(panel.locator('tbody tr')).toHaveCount(25)
  await panel.getByLabel('排序方式').selectOption('points-desc')
  await expect(panel.locator('tbody tr')).toHaveCount(20)
  await expect(names.first()).toHaveText('用户24')
  await panel.getByRole('button', { name: '查看更多用户' }).click()
  expect(new Set(await names.allTextContents()).size).toBe(25)
})

test('failure, retry and empty results are explicit without affecting the draw controls', async ({ page }) => {
  const state = await fixture(page); state.fail = true
  await page.goto('/activities?tab=leaderboard')
  const panel = page.locator('.lottery-public-results')
  await expect(panel.getByRole('alert')).toContainText('排行榜读取失败')
  await page.getByRole('button', { name: '活动抽奖', exact: true }).click()
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  await page.getByRole('button', { name: '排行榜', exact: true }).click()
  state.fail = false; state.items = []
  await panel.getByRole('button', { name: '重新读取排行榜' }).click()
  await expect(panel).toContainText('还没有抽奖记录')
})

test('rankings stay cached across draws until explicitly refreshed and preserve precise historical points', async ({ page }) => {
  const state = await fixture(page)
  state.items[0]!.totalPoints = '9007199254740993.123456'
  state.items[1]!.totalPoints = '9007199254740993.123457'
  await page.goto('/activities?tab=leaderboard')
  const panel = page.locator('.lottery-public-results')
  await expect(panel).toContainText('9,007,199,254,740,993.123456 积分')
  await page.getByRole('button', { name: '活动抽奖', exact: true }).click()
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  const readsBeforeDraw = state.publicReads
  await page.locator('.draw-console > .button').click()
  await expect(page.locator('.draw-result')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '知道了' }).click()
  await page.getByRole('button', { name: '排行榜', exact: true }).click()
  expect(state.publicReads).toBe(readsBeforeDraw)
  await page.getByRole('button', { name: '刷新排行榜' }).click()
  await expect(panel.locator('tbody tr')).toHaveCount(3)
  await expect(panel.locator('tbody tr').filter({hasText:'创***'})).toContainText('8 次')
  await expect(panel.locator('tbody tr td:first-child').first()).toHaveText('小***')
  await panel.getByLabel('排序方式').selectOption('points-asc')
  await expect(panel.locator('tbody tr td:first-child')).toHaveText(['匿名用户','创***','小***'])
  state.items[0]!.drawCount = '9007199254740993'; state.items[1]!.drawCount = '9007199254740994'
  await page.getByRole('button', {name:'刷新排行榜'}).click()
  await panel.getByLabel('排序方式').selectOption('draws-desc')
  await expect(panel.locator('tbody tr td:first-child')).toHaveText(['小***','创***','匿名用户'])
  expect(state.publicReads).toBe(readsBeforeDraw + 2)
})

test('date presets, custom day totals and pagination keep the displayed range explicit', async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/activities?tab=leaderboard')
  const panel = page.locator('.lottery-public-results')
  await expect(panel.locator('.public-total')).toContainText('今日已发放积分')
  await panel.getByRole('button', { name: '近 7 天', exact: true }).click()
  await expect(panel.locator('.public-range')).toContainText('2026-11-16 至 2026-11-22 · 7 天')
  await expect(panel.locator('.public-day-list li')).toHaveCount(7)
  await panel.getByRole('button', { name: '近 30 天', exact: true }).click()
  await expect(panel.locator('.public-range')).toContainText('2026-10-24 至 2026-11-22 · 30 天')
  await panel.getByRole('button', { name: '查看更多日期' }).click()
  await expect(panel.locator('.public-day-list li')).toHaveCount(30)
  await panel.getByRole('button', { name: '自定义', exact: true }).click()
  await expect(panel.locator('.public-overview')).toHaveCount(0)
  await panel.getByLabel('开始日期').fill('2026-11-20')
  await panel.getByLabel('结束日期').fill('2026-11-21')
  await panel.getByRole('button', { name: '查询统计' }).click()
  await expect(panel.locator('.public-range')).toContainText('2026-11-20 至 2026-11-21 · 2 天')
  await expect(panel.locator('.public-day-list time')).toHaveText(['2026-11-21', '2026-11-20'])
  expect(new URL(state.requests.at(-1)!).search).toBe('?period=custom&start=2026-11-20&end=2026-11-21')
  await expect(panel.locator('.public-overview')).toContainText('7,100')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.lottery-public-results').analyze()).violations).toEqual([])
  const reads = state.publicReads
  await panel.getByLabel('开始日期').fill('2024-01-01')
  await panel.getByRole('button', { name: '查询统计' }).click()
  await expect(panel.getByRole('alert')).toContainText('最多 366 天')
  expect(state.publicReads).toBe(reads)
  await panel.getByRole('button', { name: '全部', exact: true }).click()
  await expect(panel.locator('.public-range')).toContainText('全部历史')
})

test('switching periods cancels stale responses and failures never relabel old totals', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/activities?tab=leaderboard')
  const panel = page.locator('.lottery-public-results')
  await expect(panel.locator('tbody tr')).toHaveCount(3)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const requested = new Promise<void>(resolve => { started = resolve })
  await page.route('**/api/lottery/public-summary?period=7d', async route => {
    started(); await held
    await route.fulfill({ json: { items: [], range: publicLotteryRange(new URLSearchParams('period=7d'), statsNow),
      totals: { totalPoints: '999', charityPoints: '999', permanentPoints: '0', drawCount: '0', fulfilledCount: '0', participantCount: '0', undatedPoints: '0' },
      daily: [], updatedAt: statsNow.toISOString() } }).catch(() => {})
  })
  await panel.getByRole('button', { name: '近 7 天', exact: true }).click()
  await requested
  await panel.getByRole('button', { name: '近 30 天', exact: true }).click()
  await expect(panel.locator('.public-range')).toContainText('30 天')
  release()
  await expect(panel.locator('.public-total')).toContainText('7,100')
  await expect(panel.locator('.public-range')).not.toContainText('7 天')
  state.fail = true
  await panel.getByRole('button', { name: '今日', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('排行榜读取失败')
  await expect(panel.locator('.public-overview')).toHaveCount(0)
  state.fail = false
  await panel.getByRole('button', { name: '重新读取排行榜' }).click()
  await expect(panel.locator('.public-total')).toContainText('今日已发放积分')
})
