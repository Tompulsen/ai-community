import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import { defaultWelfareTasks } from '../shared/welfare-tasks'
import { defaultLotterySettings } from '../server/business/lottery'

const explanation = '当前可用积分不足以再次调用该模型，请获取积分后重试。'
const failure = { status: 'failed', outputs: [], errorCode: 'INSUFFICIENT_CREDITS', error: explanation, errorStage: '网关提交', errorStatus: 403, tokenId: 41, protocol: 'sync' }
const notice = (page: Page) => page.getByRole('region', { name: '积分不足', exact: true })
async function setup(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const state = { requests: 0, reads: 0, points: '12.5', failBalance: false, error: { ...failure } as any, stream: false, http: false }
  await page.route('**/api/account', route => {
    state.reads++
    return state.failBalance ? route.fulfill({ status: 503, json: { error: 'Unavailable' } }) : route.fulfill({ json: {
      linked: true, subject: account.state.user.accountId, walletEnabled: true, studioReady: true,
      points: { enabled: true, currency: 'CNY', pointsPerCny: 5000, charityPoints: '0', permanentPoints: state.requests ? state.points : '5000', legacyApiQuota: 0, paidApiQuota: 0, totalApiQuota: 0, charityExpiringAt: null },
    } })
  })
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }, { id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }] } })
    if (path.endsWith('/generate')) {
      state.requests++
      if (state.http) return route.fulfill({ status: 403, json: { ...state.error, notAccepted: true } })
      if (state.stream) return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'result', ...state.error })}\n\n` })
      return route.fulfill({ json: state.error })
    }
    if (path.includes('/requests/')) return route.fulfill({ json: state.error })
    return route.fulfill({ json: { items: [], enabled: false } })
  })
  await page.route('**/api/welfare/tasks', route => route.fulfill({ json: { items: defaultWelfareTasks() } }))
  await page.route('**/api/referrals/status*', route => route.fulfill({ json: {
    config: { enabled: true, inviterPoints: 5000, inviteePoints: 5000, minTopupCny: 10 },
    inviteUrl: 'https://example.test/activities?aff=real-code', invited: 0, credited: 0, pending: 0, waiting: 0, earnedPoints: 0, items: [],
  } }))
  await page.route('**/api/lottery/status', route => route.fulfill({ json: {
    settings: defaultLotterySettings(), balance: 1, counts: { invites: 0, followers: 0, likes: 0 }, earned: {}, accountLinked: true, creditReady: true,
    support: { checked: true, eligible: true, amountCnyFen: 1000 },
  } }))
  await page.route('**/api/new-api/wallet{,/**}', route => route.fulfill({ json: { success: true, data: {
    userId: 17, currencySymbol: 'CNY', quotaPerUnit: 500000, quotaPerPoint: 100, quotaDisplayType: 'CNY', creditExchangeRate: 1,
    topup: { enabled: true, minAmount: 1, amountOptions: [10, 50], discounts: {}, paymentMethods: [] }, plans: [], subscriptions: [], history: [], historyTotal: 0,
  } } }))
  await page.route('**/api/documents/capabilities', route => route.fulfill({ json: { enabled: true, docx: true, xlsx: true } }))
  return { state, account }
}
async function send(page: Page, kind: string, prompt = '积分不足展示验证') {
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).not.toHaveValue('')
  await page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true }).fill(prompt)
  await page.getByRole('button', { name: kind === 'text' ? '发送' : '开始生成', exact: true }).click()
}

for (const kind of ['text', 'image', 'video']) test(`${kind} shows the same current balance and recovers from browser history`, async ({ page }) => {
  const { state } = await setup(page)
  state.stream = kind === 'text'
  if (kind === 'video') state.points = '0'
  await page.goto(`/create/${kind}`)
  await send(page, kind)
  await expect(notice(page)).toContainText(explanation)
  await expect(notice(page).locator('.credits-balance')).toContainText(`当前可用积分 ${state.points}`)
  await expect(notice(page).getByRole('link')).toHaveCount(3)
  await expect(page.getByText('生成失败', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(notice(page)).toBeVisible()
  await expect(notice(page).locator('.credits-balance')).toContainText(state.points)
  expect(state.requests).toBe(1)
})

test('all three links open existing modules and preserve the original conversation', async ({ page }) => {
  const { state } = await setup(page)
  await page.goto('/create/image'); await send(page, 'image')
  const draft = page.getByRole('textbox', { name: '提示词', exact: true })
  await draft.fill('保留这份未发送的草稿')
  await notice(page).getByRole('link', { name: '获取积分：活动抽奖福利', exact: true }).click()
  await expect(page).toHaveURL(/\/activities$/)
  await expect(page.getByRole('button', { name: '活动抽奖', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.goBack(); await expect(notice(page)).toBeVisible()
  await notice(page).getByRole('link', { name: '获取积分：推广福利', exact: true }).click()
  await expect(page).toHaveURL(/tab=tasks&section=invite/)
  await expect(page.getByRole('button', { name: '复制我的邀请链接', exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('ai-community-next:referral-invite'))).toBeNull()
  await page.goBack(); await expect(notice(page)).toBeVisible()
  await notice(page).getByRole('link', { name: '获取积分：在线支持社区（￥）', exact: true }).click()
  await expect(page).toHaveURL(/\/account\?tab=balance/)
  await expect(page.locator('.account-wallet')).toBeVisible()
  await expect(page.getByRole('button', { name: '余额充值', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.goBack(); await expect(notice(page)).toBeVisible()
  await expect(draft).toHaveValue('保留这份未发送的草稿')
  expect(state.requests).toBe(1)
})

test('failed balance reads never claim zero and retry reads the current wallet', async ({ page }) => {
  const { state } = await setup(page)
  await page.goto('/create/image'); state.failBalance = true; await send(page, 'image')
  await expect(notice(page)).toContainText('当前可用积分暂无法读取')
  await expect(notice(page).locator('.credits-balance strong')).toHaveCount(0)
  state.failBalance = false; state.points = '15000.25'
  await notice(page).getByRole('button', { name: '刷新当前可用积分' }).click()
  await expect(notice(page).locator('.credits-balance')).toContainText('15,000.25')
  expect(state.requests).toBe(1)
})

for (const [label, error] of [
  ['legacy', '网关提交失败（HTTP 403）：用户额度不足, 剩余额度: $0.00'],
  ['permission', '网关提交失败（HTTP 403）：无权使用此模型'],
  ['token', '网关提交失败（HTTP 403）：令牌额度不足'],
  ['subscription', '网关提交失败（HTTP 403）：订阅额度不足或未配置订阅'],
]) test(`recognizes ${label} correctly`, async ({ page }) => {
  const { state } = await setup(page)
  state.error = { ...failure, errorCode: undefined, error }
  await page.goto('/create/image'); await send(page, 'image')
  if (label === 'legacy') await expect(notice(page)).toBeVisible()
  else { await expect(page.getByText(error, { exact: true })).toBeVisible(); await expect(notice(page)).toHaveCount(0) }
})

test('HTTP rejection and document model rejection use the same notice', async ({ page }) => {
  const { state } = await setup(page)
  state.http = true
  await page.goto('/create/text'); await send(page, 'text')
  await expect(notice(page)).toBeVisible()
  await page.getByRole('button', { name: '文档工作区', exact: true }).click()
  await expect(page.getByText('文档已开启', { exact: true })).toBeVisible()
  await send(page, 'text', '生成一个 Word 文档，内容是项目计划。')
  await expect(page.locator('.document-result .credits-notice')).toBeVisible()
  expect(state.requests).toBe(2)
})

test('notice fits small screens and supports both themes and keyboard navigation', async ({ page }, info) => {
  await setup(page)
  await page.goto('/create/image'); await send(page, 'image')
  for (const [width, mode] of [[1440, 'dark'], [390, 'dark'], [320, 'light']] as const) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
    await expect(notice(page).getByRole('button')).toBeEnabled()
    await notice(page).scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const box = (await notice(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width)
    expect(await notice(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('.credits-notice').analyze()).violations).toEqual([])
    await page.screenshot({ path: info.outputPath(`credits-${width}-${mode}.png`) })
  }
  await notice(page).getByRole('button').focus()
  await page.keyboard.press('Tab')
  await expect(notice(page).getByRole('link').first()).toBeFocused()
})

test('recovering an interrupted document retains the notice without another model call', async ({ page }) => {
  const { state } = await setup(page)
  state.stream = true
  state.error = { ...failure, status: 'indeterminate' }
  await page.goto('/create/text')
  await page.getByRole('button', { name: '文档工作区', exact: true }).click()
  await send(page, 'text', '生成一个 Word 文档，内容是项目计划。')
  const card = page.locator('.document-result')
  await expect(card.locator('.credits-notice')).toBeVisible()
  await card.getByRole('button', { name: '恢复原模型请求', exact: true }).click()
  await expect(card.getByRole('button', { name: '恢复原模型请求', exact: true })).toBeEnabled()
  await expect(card.locator('.credits-notice')).toBeVisible()
  await expect(card.getByRole('link')).toHaveCount(3)
  expect(state.requests).toBe(1)
})

for (const kind of ['text', 'image']) test(`explicit non-wallet classification survives misleading text and reload in ${kind}`, async ({ page }) => {
  const { state } = await setup(page)
  state.error = { ...failure, errorCode: 'GENERATION_ERROR', error: '网关提交失败（HTTP 403）：用户额度不足, 剩余额度: 0' }
  await page.goto(`/create/${kind}`); await send(page, kind)
  await expect(page.getByText(state.error.error, { exact: true })).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  await page.reload()
  await expect(page.getByText(state.error.error, { exact: true })).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  expect(state.requests).toBe(1)
})
