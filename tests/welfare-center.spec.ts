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
  const state = { participated: false, remaining: 200, balance: 3, failAfterDraw: false, failBeforeDraw: false,
    support: { checked: true, eligible: true, amountCnyFen: 1000 as number | null }, drawSupportError: '' }
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
    if (path.endsWith('/status')) return route.fulfill({ json: {
      settings: { ...config.settings, prizes: config.settings.prizes.filter(p => p.enabled).map((p, i) => ({ ...p, dailyQuota: p.stock, stock: p.stock - (state.participated && i === 3 ? 1 : 0), weight: p.stock - (state.participated && i === 3 ? 1 : 0) })) },
      daily: { date: day.date, timezone: 'Asia/Shanghai', resetsAt: day.end.toISOString(), limit: config.settings.dailyLimit, remaining: state.remaining, used: 200 - state.remaining, participated: state.participated },
      balance: state.balance, creditReady: true, accountLinked: authenticated, inviteUrl: 'http://localhost/activities?invite=17',
      support: state.support,
      counts: { invites: 0, followers: 0, likes: 0, bestWorkLikes: 0 }, earned: { invites: 0, followers: 0, likes: 0 },
    } })
    if (path.endsWith('/draw')) {
      const body = request.postDataJSON(); writes.push({ path, body })
      if (state.failBeforeDraw) return route.fulfill({ status: 409, json: { error: 'LOTTERY_DAILY_EXHAUSTED' } })
      if (!draws.has(body.requestId) && state.drawSupportError) return route.fulfill({
        status: state.drawSupportError === 'LOTTERY_SUPPORT_REQUIRED' ? 409 : 503, json: { error: state.drawSupportError },
      })
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
  return { state, writes, config, referral, account }
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
    await expect(page.getByRole('heading', { name: '活动抽奖', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '今日福利' })).toContainText('600,000')
    await expect(page.locator('.prize-list')).toContainText('6,000 积分')
    await expect(page.locator('.prize-list')).toContainText('1,000 积分')
    await expect(page.locator('.prize-icon svg')).toHaveCount(4)
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
  await expect(page.locator('.draw-result')).toContainText('1,000 积分')
  await expect(page.locator('.draw-console > .button')).toHaveText('今日已参与')
  await expect(page.locator('.draw-console > .button')).toBeDisabled()
  await expect(page.getByRole('region', { name: '今日福利' })).toContainText('199')
  expect(fixture.writes.map(w => w.body.count)).toEqual([1])
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
})

test('cumulative support gates new draws while the original ticket requirement remains', async ({ page }, info) => {
  const fixture = await welfareFixture(page)
  fixture.state.support = { checked: true, eligible: false, amountCnyFen: 0 }
  fixture.config.settings.wheel.title = '每日幸运转盘'
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/activities')
  const draw = page.locator('.draw-console > .button')
  await expect(page.getByRole('heading', { name: '活动抽奖', exact: true })).toBeVisible()
  await expect(draw).toBeDisabled()
  await expect(page.locator('.draw-console')).toContainText('累计支持需有有效实付大于 0')
  expect(fixture.writes).toHaveLength(0)
  await page.screenshot({ path: info.outputPath('support-required-320.png'), fullPage: true })
  fixture.config.settings.minSupportCnyFen = 1001
  fixture.config.settings.wheel.title = '创作者周末活动'
  fixture.state.support.amountCnyFen = 1000
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(page.getByRole('heading', { name: '创作者周末活动', exact: true })).toBeVisible()
  await expect(page.locator('.draw-console')).toContainText('累计支持 ¥10.00 / ¥10.01，尚未达标')
  await expect(draw).toBeDisabled()
  fixture.state.support = { checked: true, eligible: true, amountCnyFen: 1001 }
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(draw).toBeEnabled()
  await expect(page.locator('.draw-console')).toContainText('已满足参与条件')
  fixture.state.balance = 0
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(draw).toBeDisabled()
  await expect(page.locator('.draw-console')).toContainText('当前次数不足')
  expect(fixture.writes).toHaveLength(0)
})

test('zero threshold accepts verified non-CNY support without presenting it as a zero payment', async ({ page }) => {
  const fixture = await welfareFixture(page)
  fixture.state.support.amountCnyFen = 0
  await page.goto('/activities')
  await expect(page.locator('.draw-console > .button')).toBeEnabled()
  await expect(page.locator('.draw-console')).toContainText('累计支持已满足参与条件')
  await expect(page.locator('.draw-console')).not.toContainText('¥0.00')
})

test('a support verification failure blocks new draws and can be retried', async ({ page }, info) => {
  const fixture = await welfareFixture(page)
  fixture.state.support = { checked: false, eligible: false, amountCnyFen: null }
  await page.goto('/activities')
  await expect(page.locator('.draw-console > .button')).toBeDisabled()
  await expect(page.locator('.draw-console')).toContainText('累计支持暂时无法核验')
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
  const support = page.getByLabel('累计支持（元）', { exact: true })
  await expect(support).toHaveValue('0')
  await expect(support).toHaveAttribute('aria-describedby', 'lottery-support-help')
  await expect(page.locator('#lottery-support-help')).toContainText('0 仍需有效实付大于 0')
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
