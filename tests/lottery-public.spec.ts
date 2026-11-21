import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { defaultLotterySettings } from '../server/business/lottery'
import { defaultDailyLotteryPrizes, lotteryDay } from '../shared/lottery-daily'
import { defaultWelfareTasks } from '../shared/welfare-tasks'
import type { PublicLotteryParticipant } from '../shared/lottery-public'
import { mockUnifiedAccount } from './helpers/account-fixture'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
async function fixture(page: Page, authenticated = true) {
  await mockUnifiedAccount(page, authenticated)
  const settings = { ...defaultLotterySettings(), enabled: true, dailyLimit: 200,
    prizes: defaultDailyLotteryPrizes(5000).map(prize => ({ ...prize, dailyQuota: prize.stock })) }
  const state = { fail: false, participated: false, publicReads: 0,
    items: [{ id: 'draw1', participant: '创***', drawCount: '7', totalPoints: '6100', charityPoints: '2000', permanentPoints: '4100',
      fulfilledCount: '3', pendingCount: '1', unverifiedCount: '2', emptyCount: '1' },
    { id: 'draw2', participant: '小***', drawCount: '12', totalPoints: '1000', charityPoints: '1000', permanentPoints: '0',
      fulfilledCount: '1', pendingCount: '0', unverifiedCount: '0', emptyCount: '11' },
    { id: 'draw3', participant: '匿名用户', drawCount: '1', totalPoints: '0', charityPoints: '0', permanentPoints: '0',
      fulfilledCount: '0', pendingCount: '0', unverifiedCount: '0', emptyCount: '1' }] as PublicLotteryParticipant[] }
  await page.route('**/api/welfare/tasks', route => route.fulfill({ json: { items: defaultWelfareTasks() } }))
  await page.route('**/api/lottery/public-summary', route => {
    state.publicReads++
    if (state.fail) return route.fulfill({ status: 503, json: { error: '稍后重试' } })
    return route.fulfill({ json: { items: state.items } })
  })
  const day = lotteryDay(new Date())
  await page.route('**/api/lottery/status', route => route.fulfill({ json: { settings, balance: 1, creditReady: true, accountLinked: authenticated,
    daily: { date: day.date, timezone: 'Asia/Shanghai', resetsAt: day.end.toISOString(), limit: 200, remaining: 200, used: 0, participated: state.participated },
    consumption: { checked: true, eligible: true, amountCnyFen: 1000 }, counts: { invites: 0, likes: 0, bestWorkLikes: 0, followers: 0 }, earned: { invites: 0, likes: 0, followers: 0 } } }))
  await page.route('**/api/new-api/status', route => route.fulfill({ json: { success: true, data: { currencySymbol: '积分', pointsPerUsd: 5000 } } }))
  await page.route('**/api/lottery/records*', route => route.fulfill({ json: { items: [], nextCursor: null } }))
  await page.route('**/api/lottery/draw', route => {
    state.participated = true; state.items[0]!.drawCount = String(BigInt(state.items[0]!.drawCount) + 1n)
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
  await expect(panel).toContainText('6,100 积分')
  await expect(panel).toContainText('福利积分 2,000')
  await expect(panel).toContainText('永久积分 4,100')
  await expect(panel).toContainText('12 次')
  await expect(panel).toContainText('待发放 1 次')
  await expect(panel).toContainText('待核对 2 次')
  await expect(panel).not.toContainText('本次')
  await expect(panel.locator('time')).toHaveCount(0)
  await expect(panel).not.toContainText('抽奖时间')
  await expect(panel.getByText('创***', { exact: true })).toHaveCount(1)
  await expect(panel.getByLabel('排序方式')).toHaveValue('points-desc')
  await panel.getByLabel('排序方式').focus()
  await page.keyboard.press('ArrowDown')
  await expect(panel.getByLabel('排序方式')).toHaveValue('points-asc')
  const control = await panel.getByLabel('排序方式').boundingBox()
  expect(control!.height).toBeGreaterThanOrEqual(44)
  await expect(page.locator('.wheel-label')).toHaveText(['一等奖', '二等奖', '三等奖', '🤡'])
  await expect(page.locator('.prize-list').getByRole('img', { name: '小丑奖' })).toBeVisible()
  await expect(page.locator('.prize-list')).not.toContainText('非常遗憾')
  await expect(page.locator('.prize-list')).toContainText('1,000 福利积分')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.lottery-public-results').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`lottery-public-${width}-${mode}.png`), fullPage: true })
  expect(errors).toEqual([])
})

test('all four sorts are numeric and stable; more users and refresh preserve one row per identity', async ({ page }) => {
  const state = await fixture(page)
  state.items.push({ ...state.items[0]!, id: 'draw4', participant: '同***' })
  await page.goto('/activities')
  const panel = page.locator('.lottery-public-results'), names = panel.locator('tbody tr td:first-child')
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
  await panel.getByRole('button', { name: '刷新抽奖统计' }).click()
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
  await page.goto('/activities')
  const panel = page.locator('.lottery-public-results')
  await expect(panel.getByRole('alert')).toContainText('抽奖统计读取失败')
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  state.fail = false; state.items = []
  await panel.getByRole('button', { name: '重新读取抽奖统计' }).click()
  await expect(panel).toContainText('还没有抽奖记录')
})

test('successful draws refresh public records and precise historical points are never rounded', async ({ page }) => {
  const state = await fixture(page)
  state.items[0]!.totalPoints = '9007199254740993.123456'
  state.items[1]!.totalPoints = '9007199254740993.123457'
  await page.goto('/activities')
  const panel = page.locator('.lottery-public-results')
  await expect(panel).toContainText('9,007,199,254,740,993.123456 积分')
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  const readsBeforeDraw = state.publicReads
  await page.locator('.draw-console > .button').click()
  await expect(panel.locator('tbody tr')).toHaveCount(3)
  await expect(panel.locator('tbody tr').filter({hasText:'创***'})).toContainText('8 次')
  await expect(panel.locator('tbody tr td:first-child').first()).toHaveText('小***')
  await panel.getByLabel('排序方式').selectOption('points-asc')
  await expect(panel.locator('tbody tr td:first-child')).toHaveText(['匿名用户','创***','小***'])
  state.items[0]!.drawCount = '9007199254740993'; state.items[1]!.drawCount = '9007199254740994'
  await panel.getByRole('button', {name:'刷新抽奖统计'}).click()
  await panel.getByLabel('排序方式').selectOption('draws-desc')
  await expect(panel.locator('tbody tr td:first-child')).toHaveText(['小***','创***','匿名用户'])
  expect(state.publicReads).toBe(readsBeforeDraw + 2)
})
