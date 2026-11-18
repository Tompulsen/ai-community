import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { defaultLotterySettings } from '../server/business/lottery'
import { defaultDailyLotteryPrizes, lotteryDay } from '../shared/lottery-daily'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function welfareFixture(page: Page, authenticated = true) {
  const account = await mockUnifiedAccount(page, authenticated)
  account.state.user.isAdmin = true
  const config = { version: 1, settings: { ...defaultLotterySettings(), enabled: true, dailyLimit: 200, prizes: defaultDailyLotteryPrizes(5000) } }
  const day = lotteryDay(new Date())
  const state = { participated: false, remaining: 200, balance: 3, failAfterDraw: false, failBeforeDraw: false }
  const writes: { path: string; body: any }[] = [], draws = new Map<string, object>()
  await page.route('**/api/new-api/status', route => route.fulfill({ json: { success: true, data: { currencySymbol: '积分', pointsPerUsd: 5000 } } }))
  await page.route('**/api/admin/lottery/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path.endsWith('/config')) {
      if (request.method() === 'PATCH') {
        writes.push({ path, body: request.postDataJSON() })
        config.version++; config.settings = request.postDataJSON().settings
      }
      return route.fulfill({ json: config })
    }
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  await page.route('**/api/lottery/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path.endsWith('/status')) return route.fulfill({ json: {
      settings: { ...config.settings, prizes: config.settings.prizes.filter(p => p.enabled).map((p, i) => ({ ...p, dailyQuota: p.stock, stock: p.stock - (state.participated && i === 3 ? 1 : 0), weight: p.stock - (state.participated && i === 3 ? 1 : 0) })) },
      daily: { date: day.date, timezone: 'Asia/Shanghai', resetsAt: day.end.toISOString(), limit: config.settings.dailyLimit, remaining: state.remaining, used: 200 - state.remaining, participated: state.participated },
      balance: state.balance, creditReady: true, accountLinked: authenticated, inviteUrl: 'http://localhost/activities?invite=17',
      counts: { invites: 0, followers: 0, likes: 0, bestWorkLikes: 0 }, earned: { invites: 0, followers: 0, likes: 0 },
    } })
    if (path.endsWith('/draw')) {
      const body = request.postDataJSON(); writes.push({ path, body })
      if (state.failBeforeDraw) return route.fulfill({ status: 409, json: { error: 'LOTTERY_DAILY_EXHAUSTED' } })
      if (!draws.has(body.requestId)) {
        state.participated = true; state.remaining--; state.balance--
        const prize = config.settings.prizes[3]!
        draws.set(body.requestId, { id: 'draw1', createdAt: new Date().toISOString(), prizes: [{ ...prize, prizeId: prize.id, status: 'pending' }] })
      }
      if (state.failAfterDraw) { state.failAfterDraw = false; return route.abort('failed') }
      return route.fulfill({ json: draws.get(body.requestId) })
    }
    return route.fulfill({ json: { items: [...draws.values()], nextCursor: null } })
  })
  return { state, writes, config }
}

for (const [width, scheme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [320, 'dark']] as const) {
  test(`welfare wheel and daily pool at ${width}px ${scheme}`, async ({ page }, info) => {
    await welfareFixture(page)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'paper', dark: 'sage', lightStart: '07:00', darkStart: '19:00' })), scheme)
    await page.goto('/activities')
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', scheme)
    await expect(page.getByRole('heading', { name: '福利中心', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '今日福利' })).toContainText('600,000')
    await expect(page.locator('.prize-list')).toContainText('6,000 积分')
    await expect(page.locator('.prize-list')).toContainText('1,000 积分')
    await expect(page.locator('.clown-icon')).toHaveText('🤡')
    await expect(page.getByRole('group', { name: '本次抽奖次数' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator('.draw-section > .button')).toBeEnabled()
    await page.screenshot({ path: info.outputPath(`welfare-${width}-${scheme}.png`), fullPage: true })
    expect((await new AxeBuilder({ page }).include('.activity-page').analyze()).violations).toEqual([])
    expect(errors).toEqual([])
  })
}

test('a draw consumes one chance and hides multi-draw; confirmed participation prevents another draw', async ({ page }) => {
  const fixture = await welfareFixture(page)
  await page.goto('/activities')
  await page.locator('.draw-section > .button').click()
  await expect(page.locator('.draw-result')).toContainText('🤡 非常遗憾')
  await expect(page.locator('.draw-result')).toContainText('1,000 积分')
  await expect(page.locator('.draw-section > .button')).toHaveText('今日已参与')
  await expect(page.locator('.draw-section > .button')).toBeDisabled()
  await expect(page.getByRole('region', { name: '今日福利' })).toContainText('199')
  expect(fixture.writes.map(w => w.body.count)).toEqual([1])
})

test('a lost response reuses its original request even when the user already participated', async ({ page }) => {
  const fixture = await welfareFixture(page); fixture.state.failAfterDraw = true
  await page.goto('/activities'); await page.locator('.draw-section > .button').click()
  await expect(page.locator('.draw-section > .button')).toContainText('核对上次抽奖')
  await page.reload(); await expect(page.locator('.draw-section > .button')).toBeEnabled()
  await page.locator('.draw-section > .button').click()
  await expect(page.locator('.draw-result')).toContainText('非常遗憾')
  expect(fixture.writes).toHaveLength(2)
  expect(fixture.writes[0]!.body.requestId).toBe(fixture.writes[1]!.body.requestId)
  expect(fixture.state.remaining).toBe(199)
})

test('quota exhaustion refreshes stale availability', async ({ page }) => {
  const fixture = await welfareFixture(page)
  await page.goto('/activities')
  await expect(page.locator('.draw-section > .button')).toBeEnabled()
  fixture.state.remaining = 0; fixture.state.failBeforeDraw = true
  await page.locator('.draw-section > .button').click()
  await expect(page.locator('.draw-section > .button')).toHaveText('今日名额已领完')
  await expect(page.locator('.draw-section > .button')).toBeDisabled()
})

test('a guest sees a login action and the configured daily pool', async ({ page }) => {
  await welfareFixture(page, false)
  await page.goto('/activities')
  await expect(page.getByRole('link', { name: '登录后参与', exact: true })).toBeVisible()
})

for (const width of [1440, 390]) test(`admin edits every reward and daily quota independently at ${width}px`, async ({ page }, info) => {
  const fixture = await welfareFixture(page)
  await page.setViewportSize({ width, height: 1000 })
  await page.goto('/admin?tab=lottery')
  const editors = page.locator('.prize-editor')
  await expect(editors).toHaveCount(4)
  for (const [index, points] of [6500, 4500, 2500, 1500].entries()) {
    await editors.nth(index).getByLabel('单次奖励（积分）', { exact: true }).fill(String(points))
  }
  await editors.nth(0).getByLabel('名称', { exact: true }).fill('超级一等奖')
  await editors.nth(0).getByLabel('每日名额', { exact: true }).fill('45')
  await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('每日名额合计必须等于每日总人数上限')
  expect(fixture.writes).toHaveLength(0)
  await editors.nth(1).getByLabel('每日名额', { exact: true }).fill('45')
  await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
  await expect(page.locator('.config-actions')).toContainText('已保存')
  expect(fixture.config.settings.prizes.map(p => p.amountCents)).toEqual([130, 90, 50, 30])
  expect(fixture.config.settings.prizes.map(p => p.stock)).toEqual([45, 45, 50, 60])
  expect(fixture.config.settings.prizes[0]!.name).toBe('超级一等奖')
  await page.getByLabel('每日总人数上限', { exact: true }).fill('220')
  await editors.nth(3).getByLabel('每日名额', { exact: true }).fill('80')
  await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
  await expect(page.locator('.config-actions')).toContainText('已保存')
  expect(fixture.config.settings.dailyLimit).toBe(220)
  await page.reload()
  await expect(page.getByLabel('每日总人数上限', { exact: true })).toHaveValue('220')
  await expect(editors.nth(3).getByLabel('单次奖励（积分）', { exact: true })).toHaveValue('1500')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('.prize-heading').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath(`admin-welfare-${width}.png`), fullPage: true })
  expect((await new AxeBuilder({ page }).include('.lottery-config').analyze()).violations).toEqual([])
})

test('admin rejects unrepresentable point amounts and default preset stays editable', async ({ page }) => {
  const fixture = await welfareFixture(page)
  await page.goto('/admin?tab=lottery')
  const amount = page.getByLabel('单次奖励（积分）', { exact: true }).first()
  await amount.fill('6001')
  await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
  expect(await amount.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false)
  expect(fixture.writes).toHaveLength(0)
  await page.getByRole('button', { name: '填入默认 200 名奖池', exact: true }).click()
  await expect(amount).toHaveValue('6000')
  await expect(page.getByLabel('每日名额', { exact: true }).last()).toHaveValue('60')
  await expect(page.locator('.prize-editor').last()).toContainText('30.00%')
  await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
  await expect(page.locator('.config-actions')).toContainText('已保存')
  expect(fixture.writes).toHaveLength(1)
})
