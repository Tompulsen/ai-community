import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { defaultLotterySettings } from '../server/business/lottery'
import { defaultDailyLotteryPrizes, lotteryDay } from '../shared/lottery-daily'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { defaultWelfareTasks } from '../shared/welfare-tasks'

async function welfareFixture(page: Page, authenticated = true) {
  const account = await mockUnifiedAccount(page, authenticated)
  await page.route('**/api/welfare/tasks', route => route.fulfill({ json: { items: defaultWelfareTasks() } }))
  account.state.user.isAdmin = true
  const config = { version: 1, settings: { ...defaultLotterySettings(), enabled: true, dailyLimit: 200, prizes: defaultDailyLotteryPrizes(5000) } }
  const day = lotteryDay(new Date())
  const state = { participated: false, remaining: 200, balance: 3, failAfterDraw: false, failBeforeDraw: false,
    date: day.date, resetsAt: day.end.toISOString(), statusReads: 0, failStatus: false, statusDelay: Promise.resolve(),
    support: { checked: authenticated, eligible: authenticated, amountCnyFen: authenticated ? 1000 : null as number | null }, drawSupportError: '' }
  const writes: { path: string; body: any }[] = [], draws = new Map<string, object>()
  const referral = {
    config: { version: 1, enabled: true, inviterPoints: 5000, inviteePoints: 5000, inviterQuota: 500000, inviteeQuota: 500000, minTopupCny: 10, updatedAt: 0 },
    code: authenticated ? 'aB12' : '', inviteUrl: authenticated ? 'https://community.test/activities?aff=aB12' : '',
    invited: 0, credited: 0, pending: 0, waiting: 0, earnedPoints: 0, earnedQuota: 0, legacyInvited: 0,
    asInvitee: null as any, items: [] as any[], nextCursor: 0, fail: false,
  }
  await page.route('**/api/referrals/status*', route => referral.fail ? route.fulfill({ status: 503, json: { error: 'REFERRAL_UNAVAILABLE' } }) : route.fulfill({ json: referral }))
  await page.route('**/api/new-api/status', route => route.fulfill({ json: { success: true, data: {
    enabled: true, configured: true, publicUrl: 'https://accounts.example',
    passwordLoginEnabled: account.state.passwordLoginEnabled, turnstileSiteKey: account.state.turnstileSiteKey,
    registerEnabled: account.state.registerEnabled, passwordRegisterEnabled: account.state.passwordRegisterEnabled,
    emailVerificationEnabled: account.state.emailVerificationEnabled, userAgreementEnabled: account.state.userAgreementEnabled,
    privacyPolicyEnabled: account.state.privacyPolicyEnabled, currencySymbol: '积分', pointsPerUsd: 5000,
  } } }))
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
    if (path.endsWith('/public-records')) return route.fulfill({ json: { items: [], nextCursor: null, snapshot: null } })
    if (path.endsWith('/status')) {
      state.statusReads++
      await state.statusDelay
      if (state.failStatus) return route.fulfill({ status: 503, json: { error: 'LOTTERY_UNAVAILABLE' } })
      return route.fulfill({ json: {
      settings: { ...config.settings, prizes: config.settings.prizes.filter(p => p.enabled).map((p, i) => ({ ...p, dailyQuota: p.stock, stock: p.stock - (state.participated && i === 3 ? 1 : 0), weight: p.stock - (state.participated && i === 3 ? 1 : 0) })) },
      daily: { date: state.date, timezone: 'Asia/Shanghai', resetsAt: state.resetsAt, limit: config.settings.dailyLimit, remaining: state.remaining, used: 200 - state.remaining, participated: state.participated },
      balance: state.balance, creditReady: true, accountLinked: authenticated, inviteUrl: 'http://localhost/activities?invite=17',
      support: state.support,
      counts: { invites: 0, followers: 0, likes: 0, bestWorkLikes: 0 }, earned: { invites: 0, followers: 0, likes: 0 },
      } })
    }
    if (path.endsWith('/draw')) {
      const body = request.postDataJSON(); writes.push({ path, body })
      if (state.failBeforeDraw) return route.fulfill({ status: 409, json: { error: 'LOTTERY_DAILY_EXHAUSTED' } })
      if (!draws.has(body.requestId) && state.drawSupportError) return route.fulfill({
        status: state.drawSupportError === 'LOTTERY_SUPPORT_REQUIRED' ? 409 : 503, json: { error: state.drawSupportError },
      })
      if (!draws.has(body.requestId)) {
        state.participated = true; state.remaining--; state.balance--
        const prize = config.settings.prizes[3]!
        draws.set(body.requestId, { id: 'draw1', createdAt: new Date().toISOString(), prizes: [{ ...prize, prizeId: prize.id, status: 'pending', rewardKind: 'charity', validityHours: config.settings.rewardValidityHours }] })
      }
      if (state.failAfterDraw) { state.failAfterDraw = false; return route.abort('failed') }
      return route.fulfill({ json: draws.get(body.requestId) })
    }
    return route.fulfill({ json: { items: [...draws.values()], nextCursor: null } })
  })
  return { state, writes, config, referral, account, draws }
}

test('draw entry does not load history or rankings and does not wait for point display settings', async ({ page }) => {
  await welfareFixture(page)
  const reads: string[] = []
  page.on('request', request => { reads.push(new URL(request.url()).pathname) })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/new-api/status', async route => { await held; await route.fallback() })
  try {
    await page.goto('/activities')
    await expect(page.locator('.draw-console > .button')).toBeEnabled()
    expect(reads).not.toContain('/api/lottery/records')
    expect(reads).not.toContain('/api/lottery/public-summary')
    await page.getByRole('button', { name: '奖励记录', exact: true }).click()
    await expect(page.locator('.records-section .empty-state')).toBeVisible()
    expect(reads.filter(path => path === '/api/lottery/records')).toHaveLength(1)
    await page.getByRole('button', { name: '活动抽奖', exact: true }).click()
    await page.getByRole('button', { name: '奖励记录', exact: true }).click()
    expect(reads.filter(path => path === '/api/lottery/records')).toHaveLength(1)
  } finally { release() }
})

test('draw receipts display immediately while only the current status refreshes in the background', async ({ page }) => {
  const fixture = await welfareFixture(page)
  const reads: string[] = []
  page.on('request', request => { reads.push(new URL(request.url()).pathname) })
  await page.goto('/activities')
  const button = page.locator('.draw-console > .button')
  await expect(button).toBeEnabled()
  let release!: () => void
  fixture.state.statusDelay = new Promise<void>(resolve => { release = resolve })
  try {
    reads.length = 0
    await button.click()
    await expect(page.locator('.draw-result')).toContainText('待发放')
    await expect(button).not.toContainText('正在确认结果')
    await expect(page.locator('.activity-loading')).toHaveCount(0)
    expect(reads).not.toContain('/api/lottery/records')
    expect(reads).not.toContain('/api/lottery/public-summary')
  } finally { release() }
  await expect(button).toContainText('今日已参与')
  await expect(page.locator('.draw-controls')).toContainText('可用 2 次')
  expect(fixture.writes).toHaveLength(1)
})

test('a failed post-draw refresh preserves the receipt and blocks new draws until recovery', async ({ page }) => {
  const fixture = await welfareFixture(page)
  await page.goto('/activities')
  const button = page.locator('.draw-console > .button')
  await expect(button).toBeEnabled()
  fixture.state.failStatus = true
  await button.click()
  await expect(page.locator('.draw-result')).toContainText('待发放')
  await expect(page.getByRole('alert')).toContainText('活动或奖励发放暂不可用')
  await expect(button).toBeDisabled()
  await expect(page.locator('.activity-loading')).toHaveCount(0)
  fixture.state.failStatus = false
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(button).toContainText('今日已参与')
  await expect(page.locator('.draw-result')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(fixture.writes).toHaveLength(1)
})

test('new prizes show welfare validity while saved rewards retain their own amounts and deadlines', async ({ page }, info) => {
  const start = new Date('2026-11-21T10:00:00Z')
  await page.clock.install({ time: start })
  await page.clock.pauseAt(start)
  const fixture = await welfareFixture(page)
  const prize = fixture.config.settings.prizes[0]!
  fixture.draws.set('history', { id: 'history', createdAt: start.toISOString(), prizes: [
    { ...prize, prizeId: prize.id, status: 'fulfilled', rewardKind: 'charity', validityHours: 1, points: '500', expiresAt: start.getTime() / 1000 + 3 },
    { ...prize, prizeId: prize.id, name: '待发福利', status: 'pending', rewardKind: 'charity', validityHours: 2 },
    { ...prize, prizeId: prize.id, name: '历史永久奖励', status: 'fulfilled', legacyPoints: '2500' },
  ] })
  await page.goto('/activities')
  await expect(page.locator('.prize-list')).toContainText('6,000 福利积分 · 7 天有效')
  await expect(page.locator('.prize-list')).not.toContainText('永久积分')
  await page.getByRole('button', { name: '奖励记录', exact: true }).click()
  const rows = page.getByRole('row')
  await expect(rows.nth(1)).toContainText('500 福利积分')
  await expect(rows.nth(2)).toContainText('首次到账后 2 小时有效')
  await expect(rows.nth(3)).toContainText('2,500 积分')
  await expect(page.locator('.records-section')).not.toContainText('永久积分）')
  const timer = page.getByRole('timer', { name: '奖励到期倒计时' })
  await expect(timer).toHaveText('剩余 00:00:03')
  await expect(timer).toHaveAttribute('aria-live', 'off')
  await page.clock.runFor(3000)
  await expect(timer).toHaveText('已到期')
  fixture.config.settings.rewardValidityHours = 48
  await page.getByRole('button', { name: '刷新奖励记录', exact: true }).click()
  await expect(rows.nth(2)).toContainText('首次到账后 2 小时有效')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width < 640) {
      const label = await rows.nth(1).locator('.status').boundingBox()
      const deadline = await rows.nth(1).locator('.reward-expiry').boundingBox()
      expect(deadline!.x).toBeCloseTo(label!.x, 1)
    }
    await page.screenshot({ path: info.outputPath(`timed-rewards-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: '活动抽奖', exact: true }).click()
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(page.locator('.prize-list')).toContainText('6,000 福利积分 · 2 天有效')
  expect(fixture.writes).toHaveLength(0)
})

test('a delivered record updates the original draw result with its frozen expiry', async ({ page }) => {
  const start = new Date('2026-11-21T10:00:00Z')
  await page.clock.install({ time: start })
  await page.clock.pauseAt(start)
  const fixture = await welfareFixture(page)
  await page.route('**/api/lottery/records', route => route.fulfill({ json: {
    items: fixture.draws.size ? [{
      id: 'draw1', createdAt: start.toISOString(), prizes: [{
        ...fixture.config.settings.prizes[3]!, prizeId: fixture.config.settings.prizes[3]!.id,
        status: 'fulfilled', rewardKind: 'charity', validityHours: 1,
        points: '1000', expiresAt: start.getTime() / 1000 + 3600,
      }],
    }] : [], nextCursor: null,
  } }))
  await page.goto('/activities')
  await page.locator('.draw-console > .button').click()
  await expect(page.locator('.draw-result')).toContainText('待发放')
  await page.getByRole('button', { name: '查看奖励记录', exact: true }).click()
  await expect(page.locator('.records-section')).toContainText('已到账')
  await page.getByRole('button', { name: '活动抽奖', exact: true }).click()
  await expect(page.locator('.draw-result')).toContainText('已到账，1,000 福利积分')
  await expect(page.locator('.draw-result')).not.toContainText('待发放')
  await expect(page.locator('.draw-result').getByRole('timer')).toHaveText('剩余 01:00:00')
  expect(fixture.writes).toHaveLength(1)
})

test('admin controls reward validity in days or hours and preserves it after saving', async ({ page }, info) => {
  const fixture = await welfareFixture(page)
  await page.goto('/admin?tab=lottery')
  const validity = page.getByLabel('福利积分有效期', { exact: true })
  const unit = page.getByRole('combobox', { name: '有效期单位', exact: true })
  const save = page.getByRole('button', { name: '保存抽奖配置', exact: true })
  await expect(validity).toHaveValue('7')
  await expect(unit).toHaveValue('days')
  await expect(validity).toHaveAttribute('aria-describedby', 'lottery-validity-help')
  for (const invalid of ['', '0', '-1', '0.5', '366']) {
    await validity.fill(invalid)
    await save.click()
    expect(await validity.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false)
    expect(fixture.writes).toHaveLength(0)
  }
  await unit.selectOption('hours')
  await validity.fill('3')
  await save.click()
  await expect(page.locator('.config-actions')).toContainText('已保存')
  expect(fixture.writes[0]!.body.settings.rewardValidityHours).toBe(3)
  await page.reload()
  await expect(validity).toHaveValue('3')
  await expect(unit).toHaveValue('hours')
  await validity.fill('8761')
  await save.click()
  expect(fixture.writes).toHaveLength(1)
  await unit.selectOption('days')
  await validity.fill('2')
  await save.click()
  await expect(page.locator('.config-actions')).toContainText('已保存')
  expect(fixture.writes[1]!.body.settings.rewardValidityHours).toBe(48)
  await page.setViewportSize({ width: 390, height: 844 })
  await validity.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('reward-validity-390.png'), fullPage: true })
})

test('the shared midnight schedule stays the same after drawing and switching accounts', async ({ page }, info) => {
  const fixture = await welfareFixture(page)
  await page.goto('/activities')
  const schedule = page.locator('.reset-schedule')
  await expect(schedule).toContainText('每天 00:00 统一重置')
  await expect(schedule).toContainText('北京时间 · 所有用户同步')
  await expect(page.getByRole('timer', { name: '每日奖池重置倒计时' })).toHaveCount(0)
  await page.locator('.draw-console > .button').click()
  await expect(page.locator('.draw-console > .button')).toHaveText('今日已参与')
  await expect(page.getByRole('region', { name: '参与状态', exact: true })).toContainText('北京时间 00:00')
  await expect(schedule).toContainText('每天 00:00 统一重置')
  fixture.account.state.user = { ...fixture.account.state.user, id: 'otherUser', accountId: '18' }
  fixture.state.participated = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  await expect(schedule).toContainText('北京时间 · 所有用户同步')
  expect(fixture.writes).toHaveLength(1)
  await page.screenshot({ path: info.outputPath('midnight-schedule-1440.png'), fullPage: true })
})

test('the fixed midnight schedule refreshes daily eligibility at the server deadline', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T15:59:55Z') })
  await page.clock.pauseAt(new Date('2026-11-21T15:59:57Z'))
  const fixture = await welfareFixture(page)
  Object.assign(fixture.state, { date: '2026-11-21', resetsAt: '2026-11-21T16:00:00Z', participated: true, remaining: 199 })
  await page.goto('/activities')
  const schedule = page.locator('.reset-schedule')
  await expect(schedule).toHaveText('每天 00:00 统一重置北京时间 · 所有用户同步')
  await expect(page.locator('.daily-overview')).not.toContainText('每人每天限')
  await expect(page.locator('.draw-console > .button')).toHaveText('今日已参与')
  await page.clock.runFor(1000)
  await expect(page.locator('.draw-console > .button')).toBeDisabled()
  Object.assign(fixture.state, { date: '2026-11-22', resetsAt: '2026-11-22T16:00:00Z', participated: false, remaining: 200 })
  await page.clock.runFor(3000)
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  await expect(schedule).toContainText('每天 00:00 统一重置')
  await expect(page.locator('.draw-controls')).toContainText('可用 3 次')
  expect(fixture.state.statusReads).toBe(2)
  expect(fixture.writes).toHaveLength(0)
})

test('midnight reset reconciles after background sleep without duplicate refreshes', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T12:59:58Z') })
  await page.clock.pauseAt(new Date('2026-11-21T13:00:00Z'))
  const fixture = await welfareFixture(page)
  Object.assign(fixture.state, { date: '2026-11-21', resetsAt: '2026-11-21T16:00:00Z', participated: true })
  await page.goto('/activities')
  await expect(page.locator('.reset-schedule')).toContainText('每天 00:00 统一重置')
  await expect(page.locator('.draw-console > .button')).toHaveText('今日已参与')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.setSystemTime(new Date('2026-11-21T15:59:59Z'))
  await page.clock.runFor(1000)
  expect(fixture.state.statusReads).toBe(1)
  await page.clock.setSystemTime(new Date('2026-11-21T16:00:02Z'))
  Object.assign(fixture.state, { date: '2026-11-22', resetsAt: '2026-11-22T16:00:00Z', participated: false })
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  await expect(page.locator('.reset-schedule')).toContainText('每天 00:00 统一重置')
  expect(fixture.state.statusReads).toBe(2)
  expect(fixture.writes).toHaveLength(0)
})

test('midnight reset refreshes after an unfinished draw without resubmitting it', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T15:59:55Z') })
  await page.clock.pauseAt(new Date('2026-11-21T15:59:57Z'))
  const fixture = await welfareFixture(page)
  Object.assign(fixture.state, { date: '2026-11-21', resetsAt: '2026-11-21T16:00:00Z', drawSupportError: 'LOTTERY_SUPPORT_UNAVAILABLE' })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const submissions: { requestId: string }[] = []
  await page.route('**/api/lottery/draw', async route => {
    submissions.push(route.request().postDataJSON())
    await held
    await route.fallback()
  })
  await page.goto('/activities')
  const draw = page.locator('.draw-console > .button')
  await expect(draw).toBeEnabled()
  await draw.click()
  await expect.poll(() => submissions.length).toBe(1)
  await page.clock.runFor(4000)
  expect(fixture.state.statusReads).toBe(1)
  Object.assign(fixture.state, { date: '2026-11-22', resetsAt: '2026-11-22T16:00:00Z' })
  release()
  await expect(page.getByRole('alert')).toContainText('使用原凭证重新核对')
  await page.clock.runFor(1000)
  await expect.poll(() => fixture.state.statusReads).toBe(2)
  await expect(page.locator('.reset-schedule')).toContainText('每天 00:00 统一重置')
  await expect(draw).toContainText('核对上次抽奖')
  expect(fixture.state.statusReads).toBe(2)
  expect(submissions).toHaveLength(1)
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.state.balance).toBe(3)
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('ai-community-next:lottery-draw:fixtureAccountUser')!).requestId)).toBe(submissions[0]!.requestId)
})

test('midnight reset retries stale or failed status without polling rapidly and stops after leaving', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-21T15:59:55Z') })
  await page.clock.pauseAt(new Date('2026-11-21T15:59:57Z'))
  const fixture = await welfareFixture(page)
  Object.assign(fixture.state, { date: '2026-11-21', resetsAt: '2026-11-21T16:00:00Z' })
  await page.goto('/activities')
  await expect(page.locator('.reset-schedule')).toContainText('每天 00:00 统一重置')
  await page.clock.runFor(4000)
  await expect.poll(() => fixture.state.statusReads).toBe(2)
  expect(fixture.state.statusReads).toBe(2)
  await page.clock.runFor(4000)
  expect(fixture.state.statusReads).toBe(2)
  fixture.state.failStatus = true
  await page.clock.runFor(11000)
  await expect(page.getByRole('alert')).toContainText('活动或奖励发放暂不可用')
  expect(fixture.state.statusReads).toBe(3)
  fixture.state.failStatus = false
  let release!: () => void
  fixture.state.statusDelay = new Promise<void>(resolve => { release = resolve })
  await page.clock.runFor(15000)
  await expect(page.getByRole('status', { name: '正在加载活动' })).toBeVisible()
  expect(fixture.state.statusReads).toBe(4)
  await page.locator('.account-balance').first().click()
  await expect(page).toHaveURL(/\/account/)
  release()
  await page.clock.runFor(30000)
  expect(fixture.state.statusReads).toBe(4)
  expect(fixture.writes).toHaveLength(0)
})

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
    await expect(page.getByRole('heading', { name: '活动抽奖', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '今日福利' })).toContainText('600,000')
    await expect(page.locator('.prize-list')).toContainText('6,000 福利积分')
    await expect(page.locator('.prize-list')).toContainText('1,000 福利积分')
    await expect(page.locator('.prize-icon svg')).toHaveCount(3)
    await expect(page.locator('.prize-list').getByRole('img', { name: '小丑奖' })).toBeVisible()
    await expect(page.locator('.prize-list')).not.toContainText('非常遗憾')
    await expect(page.locator('.clown-icon')).toHaveCount(0)
    await expect(page.getByRole('group', { name: '本次抽奖次数' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator('.draw-console > .button')).toBeEnabled()
    await page.screenshot({ path: info.outputPath(`welfare-${width}-${scheme}.png`), fullPage: true })
    expect((await new AxeBuilder({ page }).include('.activity-page').analyze()).violations).toEqual([])
    expect(errors).toEqual([])
  })
}

test('a draw consumes one chance and hides multi-draw; confirmed participation prevents another draw', async ({ page }) => {
  const fixture = await welfareFixture(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/activities')
  await page.locator('.draw-console > .button').click()
  await expect(page.locator('.draw-result')).toContainText('🤡 非常遗憾')
  await expect(page.locator('.draw-result')).toContainText('1,000 福利积分')
  await expect(page.locator('.draw-console > .button')).toHaveText('今日已参与')
  await expect(page.locator('.draw-console > .button')).toBeDisabled()
  await expect(page.getByRole('region', { name: '今日福利' })).toContainText('199')
  expect(fixture.writes.map(w => w.body.count)).toEqual([1])
  expect(fixture.state.balance).toBe(2)
  await expect(page.locator('.wheel-disc')).toHaveCSS('transition-duration', '0s')
  const winner = await page.locator('.is-winner textPath').evaluate((label: SVGTextPathElement) => {
    const path = document.getElementById(label.getAttribute('href')!.slice(1)) as unknown as SVGPathElement
    const midpoint = path.getPointAtLength(path.getTotalLength() / 2)
    const point = new DOMPoint(midpoint.x, midpoint.y).matrixTransform(label.getCTM()!)
    const svg = label.ownerSVGElement!
    const scale = svg.getBoundingClientRect().width / 400
    return { x: point.x / scale, y: point.y / scale, radius: Math.hypot(midpoint.x - 200, midpoint.y - 200) }
  })
  expect(winner.x).toBeCloseTo(200, 3)
  expect(winner.y).toBeCloseTo(200 - winner.radius, 3)
  await page.locator('.lottery-wheel').screenshot({ path: test.info().outputPath('arc-winner.png') })
})

test('arc labels rotate with the wheel throughout the draw animation', async ({ page }) => {
  const fixture = await welfareFixture(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/activities')
  await page.locator('.wheel-center').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.draw-result')).toBeVisible()
  await expect(page.locator('.wheel-disc')).toHaveCSS('transition-duration', '1.6s')
  await page.waitForFunction(() => {
    const animation = document.querySelector('.wheel-disc')!.getAnimations()[0]
    const progress = animation?.effect?.getComputedTiming().progress
    return progress != null && progress > 0 && progress < 1
  })
  const transforms = await page.locator('.wheel-disc').evaluate((disc: SVGGraphicsElement) => {
    const values = (element: SVGGraphicsElement) => {
      const { a, b, c, d } = element.getCTM()!
      return [a, b, c, d]
    }
    return { disc: values(disc), labels: [...disc.querySelectorAll<SVGTextElement>('.wheel-label')].map(values) }
  })
  for (const matrix of transforms.labels) expect(matrix).toEqual(transforms.disc)
  await page.locator('.wheel-disc').evaluate(async disc => { await Promise.all(disc.getAnimations().map(animation => animation.finished)) })
  await expect(page.locator('.wheel-center')).toBeDisabled()
  expect(fixture.writes).toHaveLength(1)
})

test('a lost response reuses its original request even when the user already participated', async ({ page }) => {
  const fixture = await welfareFixture(page); fixture.state.failAfterDraw = true
  await page.goto('/activities'); await page.locator('.draw-console > .button').click()
  await expect(page.locator('.draw-console > .button')).toContainText('核对上次抽奖')
  fixture.state.support = { checked: false, eligible: false, amountCnyFen: null }
  await page.reload(); await expect(page.locator('.draw-console > .button')).toBeEnabled()
  await page.locator('.draw-console > .button').click()
  await expect(page.locator('.draw-result')).toContainText('非常遗憾')
  expect(fixture.writes).toHaveLength(2)
  expect(fixture.writes[0]!.body.requestId).toBe(fixture.writes[1]!.body.requestId)
  expect(fixture.state.remaining).toBe(199)
  expect(fixture.state.balance).toBe(2)
})

test('quota exhaustion refreshes stale availability', async ({ page }) => {
  const fixture = await welfareFixture(page)
  await page.goto('/activities')
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  fixture.state.remaining = 0; fixture.state.failBeforeDraw = true
  await page.locator('.draw-console > .button').click()
  await expect(page.locator('.draw-console > .button')).toHaveText('今日名额已领完')
  await expect(page.locator('.draw-console > .button')).toBeDisabled()
})

test('a guest sees a login action and the configured daily pool', async ({ page }) => {
  await welfareFixture(page, false)
  await page.goto('/activities')
  await expect(page.getByRole('link', { name: '登录后参与', exact: true })).toBeVisible()
  const conditions = page.getByRole('region', { name: '参与状态', exact: true })
  await expect(conditions).toContainText('累计支持 > ✦0.00')
  await expect(conditions).toContainText('登录后查看累计支持及资格')
  await expect(conditions).not.toContainText('当前累计支持')
})

test('cumulative support and tickets remain separate participation requirements', async ({ page }, info) => {
  const fixture = await welfareFixture(page)
  fixture.state.support = { checked: true, eligible: false, amountCnyFen: 0 }
  fixture.config.settings.wheel.title = '每日幸运转盘'
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/activities')
  const draw = page.locator('.draw-console > .button')
  const conditions = page.getByRole('region', { name: '参与状态', exact: true })
  await expect(page.getByRole('heading', { name: '活动抽奖', exact: true })).toBeVisible()
  await expect(draw).toBeDisabled()
  await expect(conditions).toContainText('累计支持 > ✦0.00')
  await expect(conditions).toContainText('当前累计支持 ✦0.00')
  await expect(conditions).toContainText('未满足')
  await expect(page.locator('.draw-controls')).toContainText('可用 3 次')
  expect(fixture.writes).toHaveLength(0)
  await page.screenshot({ path: info.outputPath('support-required-320.png'), fullPage: true })
  fixture.config.settings.minSupportCnyFen = 1001
  fixture.config.settings.wheel.title = '创作者周末活动'
  fixture.state.support.amountCnyFen = 1000
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(page.getByRole('heading', { name: '创作者周末活动', exact: true })).toBeVisible()
  await expect(conditions).toContainText('累计支持 ≥ ✦10.01')
  await expect(conditions).toContainText('当前累计支持 ✦10.00')
  await expect(conditions).toContainText('未满足')
  await expect(draw).toBeDisabled()
  fixture.state.support = { checked: true, eligible: true, amountCnyFen: 7145 }
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(draw).toBeEnabled()
  await expect(conditions).toContainText('已满足')
  await expect(conditions).toContainText('当前累计支持 ✦71.45')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: info.outputPath('support-eligible-1440.png'), fullPage: true })
  fixture.state.balance = 0
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(draw).toBeDisabled()
  await expect(conditions).toContainText('已满足')
  await expect(page.locator('.draw-console')).toContainText('完成任务获取抽奖次数')
  await page.getByRole('button', { name: '前往任务与邀请', exact: true }).click()
  await expect(page.getByRole('button', { name: '任务与邀请', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '查看邀请福利', exact: true }).click()
  await expect(page.getByRole('region', { name: '邀请朋友，共享积分', exact: true })).toBeVisible()
  expect(fixture.writes).toHaveLength(0)
})

test('historical and later support can qualify without consumption while tasks still supply tickets', async ({ page }) => {
  const fixture = await welfareFixture(page)
  fixture.config.settings.minSupportCnyFen = 1000
  const completedTopups = [300, 700]
  fixture.state.support = { checked: true, eligible: true, amountCnyFen: completedTopups.reduce((sum, amount) => sum + amount, 0) }
  fixture.state.balance = 0
  await page.goto('/activities')
  const conditions = page.getByRole('region', { name: '参与状态', exact: true })
  const draw = page.locator('.draw-console > .button')
  await expect(conditions).toContainText('累计支持 ≥ ✦10.00')
  await expect(conditions).toContainText('当前累计支持 ✦10.00')
  await expect(conditions).toContainText('已满足')
  await expect(conditions).not.toContainText('累计消费')
  await expect(draw).toBeDisabled()
  await expect(page.locator('.draw-console')).toContainText('完成任务获取抽奖次数')
  fixture.state.balance = 1
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(draw).toBeEnabled()
  expect(fixture.writes).toHaveLength(0)
})

test('zero threshold shows verified positive sub-fen support without rounding it to zero', async ({ page }) => {
  const fixture = await welfareFixture(page)
  fixture.state.support.amountCnyFen = 0
  await page.goto('/activities')
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  const conditions = page.getByRole('region', { name: '参与状态', exact: true })
  await expect(conditions).toContainText('累计支持 > ✦0.00')
  await expect(conditions).toContainText('当前累计支持 小于 ✦0.01')
  await expect(conditions).toContainText('已满足')
  await expect(conditions.locator('.support-status')).not.toContainText('✦0.00')
})

test('a support verification failure blocks new draws and can be retried', async ({ page }, info) => {
  const fixture = await welfareFixture(page)
  fixture.state.support = { checked: false, eligible: false, amountCnyFen: null }
  await page.goto('/activities')
  await expect(page.locator('.draw-console > .button')).toBeDisabled()
  await expect(page.getByRole('region', { name: '参与状态', exact: true })).toContainText('暂无法核验')
  await page.screenshot({ path: info.outputPath('support-unavailable.png'), fullPage: true })
  fixture.state.support = { checked: true, eligible: true, amountCnyFen: 1000 }
  await page.getByRole('button', { name: '重新核验', exact: true }).click()
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  expect(fixture.writes).toHaveLength(0)
})

test('a support rejection clears only an unexecuted request and refreshes eligibility', async ({ page }) => {
  const fixture = await welfareFixture(page)
  await page.goto('/activities')
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  fixture.state.support.eligible = false; fixture.state.support.amountCnyFen = 0
  fixture.state.drawSupportError = 'LOTTERY_SUPPORT_REQUIRED'
  await page.locator('.draw-console > .button').click()
  await expect(page.getByRole('alert')).toContainText('累计支持未满足参与条件')
  await expect(page.locator('.draw-console > .button')).toBeDisabled()
  expect(await page.evaluate(() => sessionStorage.getItem('ai-community-next:lottery-draw:fixtureAccountUser'))).toBeNull()
  expect(fixture.state.balance).toBe(3)
  expect(fixture.state.remaining).toBe(200)
})

test('a temporary support error retains the same request across reload and retry', async ({ page }) => {
  const fixture = await welfareFixture(page)
  fixture.state.drawSupportError = 'LOTTERY_SUPPORT_UNAVAILABLE'
  await page.goto('/activities')
  await page.locator('.draw-console > .button').click()
  await expect(page.getByRole('alert')).toContainText('使用原凭证重新核对')
  await expect(page.locator('.draw-console > .button')).toContainText('核对上次抽奖')
  fixture.state.support = { checked: false, eligible: false, amountCnyFen: null }
  await page.reload()
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  fixture.state.drawSupportError = ''
  await page.locator('.draw-console > .button').click()
  await expect(page.locator('.draw-result')).toBeVisible()
  expect(fixture.writes).toHaveLength(2)
  expect(fixture.writes[0]!.body.requestId).toBe(fixture.writes[1]!.body.requestId)
  expect(fixture.state.balance).toBe(2)
  expect(fixture.state.remaining).toBe(199)
})

test('admin saves exact support cents and rejects empty, negative, excessive or fractional-cent input', async ({ page }, info) => {
  const fixture = await welfareFixture(page)
  await page.goto('/admin?tab=lottery')
  const support = page.getByLabel('累计支持（✦）', { exact: true })
  await expect(support).toHaveValue('0')
  await expect(support).toHaveAttribute('aria-describedby', 'lottery-support-help')
  await expect(page.locator('#lottery-support-help')).toContainText('设为 0 时仍需累计支持大于 ✦0.00')
  for (const invalid of ['', '-0.01', '1000000.01', '0.001']) {
    await support.fill(invalid)
    await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
    expect(await support.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false)
    expect(fixture.writes).toHaveLength(0)
  }
  await support.fill('0.29')
  await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
  await expect(page.locator('.config-actions')).toContainText('已保存')
  expect(fixture.writes[0]!.body.settings.minSupportCnyFen).toBe(29)
  await page.reload()
  await expect(support).toHaveValue('0.29')
  await page.setViewportSize({ width: 390, height: 844 })
  await support.scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('admin-support-390.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await support.fill('1000000')
  await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
  await expect(page.locator('.config-actions')).toContainText('已保存')
  expect(fixture.writes[1]!.body.settings.minSupportCnyFen).toBe(100000000)
  await support.fill('0')
  await page.getByRole('button', { name: '保存抽奖配置', exact: true }).click()
  await expect(page.locator('.config-actions')).toContainText('已保存')
  expect(fixture.writes[2]!.body.settings.minSupportCnyFen).toBe(0)
})

for (const width of [1440, 390]) test(`admin edits every reward and daily quota independently at ${width}px`, async ({ page }, info) => {
  const fixture = await welfareFixture(page)
  await page.setViewportSize({ width, height: 1000 })
  await page.goto('/admin?tab=lottery')
  await expect(page.getByLabel('轮盘主题').locator('option[value="teal"]')).toHaveText('蓝金')
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

for (const [width, scheme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [320, 'dark']] as const) {
  test(`referral benefits and progress at ${width}px ${scheme}`, async ({ page, context }, info) => {
    const fixture = await welfareFixture(page)
    const record = { inviteeId: 20, inviterId: 17, configVersion: 0, inviterPoints: 5000, inviteePoints: 5000, minTopupCny: 9.99, boundAt: 1795000000, creditedAt: 0, state: 'waiting_topup' }
    Object.assign(fixture.referral, { invited: 10, credited: 1, pending: 1, waiting: 1, legacyInvited: 7, earnedPoints: 5000, earnedQuota: 500000,
      asInvitee: { ...record, inviteeId: 17, inviterId: 10 },
      items: [record, { ...record, inviteeId: 19, state: 'pending' }, { ...record, inviteeId: 18, state: 'credited', creditedAt: 1795000500 }], nextCursor: 18 })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.setViewportSize({ width, height: 1000 })
    await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'paper', dark: 'sage' })), scheme)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto('/activities?invite=wf' + 'b'.repeat(24))
    const panel = page.getByRole('region', { name: '邀请朋友，共享积分' })
    await expect(panel).toContainText('¥10.00')
    await expect(panel).toContainText('首笔未达标不影响后续领取')
    await expect(panel).toContainText('1 人待达标')
    await expect(panel).not.toContainText('8 人待达标')
    await expect(panel.getByText('待单笔充值达标', { exact: true })).toBeVisible()
    await expect(panel.locator('.referral-own')).toContainText('¥9.99')
    await expect(panel.getByText('待发放 · 自动重试', { exact: true })).toBeVisible()
    await expect(panel.getByRole('link', { name: '前往充值' })).toHaveAttribute('href', '/account?tab=balance')
    await panel.getByRole('button', { name: '复制我的邀请链接' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fixture.referral.inviteUrl)
    fixture.referral.items = [{ ...record, inviteeId: 16 }]; fixture.referral.nextCursor = 0
    await panel.getByRole('button', { name: '查看更多邀请' }).click()
    await expect(panel.locator('.referral-records li')).toHaveCount(4)
    await expect(panel.getByRole('button', { name: '查看更多邀请' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0) })
    await page.screenshot({ path: info.outputPath(`referrals-${width}-${scheme}.png`), fullPage: true })
    expect((await new AxeBuilder({ page }).include('.referral-benefits').analyze()).violations).toEqual([])
    expect(errors).toEqual([])
  })
}

for (const [query, code, storage] of [
  ['aff=aB12', 'aB12', 'ai-community-next:referral-invite'],
  ['aff=001234', '001234', 'ai-community-next:referral-invite'],
  ['invite=wf' + 'c'.repeat(24), 'wf' + 'c'.repeat(24), 'ai-community-next:invite'],
] as const) for (const entry of ['direct', 'spa'] as const) {
  test(`guest invitation ${query} survives ${entry} navigation and reaches registration`, async ({ page }) => {
    const fixture = await welfareFixture(page, false)
    const target = '/activities?' + query
    if (entry === 'direct') await page.goto(target)
    else {
      await page.goto('/discover')
      await page.waitForFunction(() => Boolean((document.querySelector('#app') as any)?.__vue_app__))
      await page.evaluate(target => (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$router.push(target), target)
    }
    await expect(page.getByRole('link', { name: '注册并绑定邀请' })).toHaveAttribute('href', '/account?mode=register')
    await page.getByRole('link', { name: '注册并绑定邀请' }).click()
    await expect(page.getByRole('form', { name: '注册章鱼账号', exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('mode')).toBe('register')
    await page.getByRole('textbox', { name: '用户名', exact: true }).fill('invited-creator')
    await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('invited@example.com')
    await page.getByRole('textbox', { name: '邮箱验证码', exact: true }).fill('a1b2c3')
    await page.getByLabel('密码', { exact: true }).fill('fixture-password')
    await page.getByLabel('确认密码', { exact: true }).fill('fixture-password')
    await page.getByRole('button', { name: '注册账号', exact: true }).click()
    await expect(page.getByText('注册成功，请登录章鱼账号。', { exact: true })).toBeVisible()
    const registration = fixture.account.mutations.find(item => item.path === '/api/new-api/register')
    expect(registration?.body.aff_code).toBe(code)
    expect(registration?.body).not.toHaveProperty('qx_invite_code')
    expect(await page.evaluate(key => sessionStorage.getItem(key), storage)).toBe(code)
  })
}

test('zero and fractional referral rewards retain the account-center values', async ({ page }) => {
  const fixture = await welfareFixture(page)
  Object.assign(fixture.referral.config, { inviterPoints: 0, inviteePoints: 0.25, inviterQuota: 0, inviteeQuota: 25, minTopupCny: 0 })
  await page.goto('/activities?invite=wf' + 'a'.repeat(24))
  const panel = page.getByRole('region', { name: '邀请朋友，共享积分' })
  await expect(panel.locator('.referral-award')).toContainText('你得 0')
  await expect(panel.locator('.referral-award')).toContainText('好友得 0.25')
  await expect(panel).toContainText('实际支付大于 0')
  await expect(panel).toContainText('首笔未达标不影响后续领取')
})

test('referral loading failure can recover and account changes remove previous private records', async ({ page }) => {
  const fixture = await welfareFixture(page); fixture.referral.fail = true
  await page.goto('/activities?invite=wf' + 'a'.repeat(24))
  const panel = page.getByRole('region', { name: '邀请朋友，共享积分' })
  await expect(panel.getByRole('alert')).toContainText('暂时无法读取')
  fixture.referral.fail = false
  await panel.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(panel).toContainText('还没有绑定的新人')
  fixture.account.state.authenticated = false; fixture.account.state.accountAuthenticated = false
  fixture.referral.code = ''; fixture.referral.inviteUrl = ''
  await page.reload()
  await expect(panel.getByRole('link', { name: '注册并绑定邀请' })).toBeVisible()
  await expect(panel.getByText('我的邀请记录', { exact: true })).toHaveCount(0)
})

for (const width of [1440, 390, 320]) test(`admin has no independent referral reward editor at ${width}px`, async ({ page }, info) => {
  const fixture = await welfareFixture(page), requests: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/admin/referrals/config') requests.push(request.method()) })
  await page.setViewportSize({ width, height: 1000 })
  await page.goto('/admin?tab=lottery')
  await expect(page.getByRole('heading', { name: '奖池与活动规则', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '邀请充值福利' })).toHaveCount(0)
  await expect(page.getByLabel('邀请人奖励（永久积分）')).toHaveCount(0)
  await expect(page.getByLabel('新人奖励（永久积分）')).toHaveCount(0)
  await expect(page.getByLabel('开放新邀请福利')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存邀请福利' })).toHaveCount(0)
  expect(requests).toEqual([])
  expect(fixture.writes).toHaveLength(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`admin-referrals-removed-${width}.png`), fullPage: true })
})
