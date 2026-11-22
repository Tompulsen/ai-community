import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { defaultWelfareTasks } from '../shared/welfare-tasks'
import { defaultLotterySettings } from '../server/business/lottery'
import { mockUnifiedAccount } from './helpers/account-fixture'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
async function fixture(page: Page, authenticated = true) {
  const account = await mockUnifiedAccount(page, authenticated)
  account.state.user.isAdmin = true
  const state = { items: defaultWelfareTasks(), version: 1, catalogFailure: false, ruleFailure: false, conflict: false, adminFailure: false,
    publication: { count: 0, rewardedAt: null as string | null, rewardTickets: 0, resetsAt: null as string | null, serverTime: new Date().toISOString() },
    lottery: { settings: { ...defaultLotterySettings(), enabled: true }, counts: { likes: 27, bestWorkLikes: 14, followers: 9 } },
    referral: { config: { version: 1, enabled: true, inviterPoints: 7200, inviteePoints: 3600, inviterQuota: 720000, inviteeQuota: 360000, minTopupCny: 0, updatedAt: 0 },
      code: 'testCode', inviteUrl: 'https://community.test/activities?aff=testCode', invited: 0, credited: 0, pending: 0, waiting: 0, earnedPoints: 0,
      earnedQuota: 0, legacyInvited: 0, asInvitee: null, items: [], nextCursor: 0 }, writes: [] as any[] }
  state.lottery.settings.likes.enabled = false; state.lottery.settings.followers.enabled = false
  await page.route('**/api/welfare/tasks', route => route.fulfill(state.catalogFailure ? { status: 503, json: { error: '任务暂时不可用' } } : { json: { items: state.items.filter(item => item.enabled), publication: authenticated ? { ...state.publication, serverTime: new Date().toISOString() } : null } }))
  await page.route('**/api/admin/welfare/tasks', route => {
    if (state.adminFailure) return route.fulfill({ status: 503, json: { error: '配置暂时不可用' } })
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); state.writes.push(body)
      if (state.conflict || body.version !== String(state.version)) return route.fulfill({ status: 409, json: { error: '设置已变化，请刷新后重新核对。' } })
      state.items = body.items; state.version++
    }
    return route.fulfill({ json: { items: state.items, version: String(state.version) } })
  })
  await page.route('**/api/referrals/status*', route => route.fulfill({ json: state.referral }))
  await page.route('**/api/lottery/status', route => route.fulfill(state.ruleFailure ? { status: 503, json: { error: 'LOTTERY_UNAVAILABLE' } } : { json: {
    ...state.lottery, earned: { invites: 0, likes: 0, followers: 0 }, balance: 0, accountLinked: authenticated, creditReady: true, inviteUrl: '',
    support: { checked: true, eligible: true, amountCnyFen: 1000 },
  } }))
  await page.route('**/api/lottery/records*', route => route.fulfill({ json: { items: [], nextCursor: null } }))
  return { state, account }
}

for (const mode of ['light', 'dark']) for (const width of [320, 390, 1440]) test(`current welfare tasks at ${width}px ${mode}`, async ({ page }, info) => {
  await fixture(page)
  await page.setViewportSize({ width, height: 1000 })
  await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'paper', dark: 'sage' })), mode)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/activities?tab=tasks')
  const list = page.getByRole('list', { name: '社区福利任务' })
  await expect(list.getByRole('heading')).toHaveText(['邀请', '用户发作品', '敬请期待未开放'])
  await expect(list).toContainText('你得 7,200 · 好友得 3,600 永久积分')
  await expect(list).toContainText('任意一笔充值实际支付大于 0')
  await expect(list).toContainText('发布 1 个作品，获得 1 次抽奖机会')
  await expect(list).toContainText('本轮进度：0 / 1 个作品')
  await expect(list).toContainText('到账后满 24 小时重置')
  await expect(list.getByRole('button', { name: '敬请期待', exact: true })).toBeDisabled()
  const toggle = list.getByRole('button', { name: '查看邀请福利', exact: true })
  await toggle.focus(); await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('region', { name: '邀请朋友，共享积分' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.welfare-tasks').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`tasks-${width}-${mode}.png`), fullPage: true })
  expect(errors).toEqual([])
})

test('live rules, single-work and total likes, pauses and fractional referral values stay authoritative', async ({ page }) => {
  const { state } = await fixture(page)
  Object.assign(state.lottery.settings.likes, { enabled: true, threshold: 12, tickets: 3 })
  Object.assign(state.lottery.settings.followers, { enabled: true, threshold: 8, tickets: 2 })
  Object.assign(state.referral.config, { inviterPoints: 0, inviteePoints: 0.25, minTopupCny: 8.88 })
  await page.goto('/activities?tab=tasks')
  const list = page.locator('.welfare-task-list')
  await expect(list).toContainText('每件公开作品每获 12 赞，获得 3 次抽奖机会')
  await expect(list).toContainText('最高单件作品获赞：14 赞')
  await expect(list).toContainText('每收获 8 位关注者，获得 2 次抽奖机会')
  await expect(list).toContainText('当前关注者：9 人')
  await expect(list).toContainText('发布本身不直接赠送积分')
  await expect(list).toContainText('你得 0 · 好友得 0.25 永久积分')
  await expect(list).toContainText('实付满 ¥8.88')
  state.referral.config.enabled = false
  state.lottery.settings.likesMode = 'total'
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(list).toContainText('公开作品累计每获 12 赞')
  await expect(list).toContainText('作品累计获赞：27 赞')
  await expect(list).toContainText('新邀请已暂停')
  await expect(list).not.toContainText('双方自动获奖')
  await page.getByRole('button', { name: '查看邀请福利', exact: true }).click()
  await expect(page.locator('.referral-benefits')).not.toContainText('双方自动获得奖励')
  state.lottery.settings.enabled = false
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(list).toContainText('发布 1 个作品，获得 1 次抽奖机会')
  await expect(list).not.toContainText('获得 3 次')
})

test('catalog failures retry and hiding all tasks produces a real empty state', async ({ page }) => {
  const { state } = await fixture(page); state.catalogFailure = true
  await page.goto('/activities?tab=tasks')
  await expect(page.locator('.welfare-tasks')).toContainText('任务暂时不可用')
  await expect(page.locator('.welfare-task-list')).toHaveCount(0)
  state.catalogFailure = false
  await page.getByRole('button', { name: '重新读取任务' }).click()
  await expect(page.locator('[data-task]')).toHaveCount(3)
  state.items.forEach(item => { item.enabled = false })
  await page.getByRole('button', { name: '刷新活动', exact: true }).click()
  await expect(page.locator('.welfare-tasks')).toContainText('暂无开放的福利任务')
  await expect(page.locator('.referral-benefits')).toHaveCount(0)
})

test('lottery service failure does not block invitation details or the publish entry', async ({ page }) => {
  const { state } = await fixture(page); state.ruleFailure = true
  await page.goto('/activities?aff=testCode')
  await expect(page.locator('.referral-benefits')).toBeVisible()
  await expect(page.locator('[data-task="publish"]')).toContainText('作品福利规则暂时无法读取')
  await page.locator('[data-task="publish"]').getByRole('button').click()
  await expect(page.getByRole('dialog', { name: '发布作品', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭作品编辑' }).click()
  await expect(page.getByRole('button', { name: '任务与邀请', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('guest publishing returns to the existing editor after login', async ({ page }) => {
  await fixture(page, false)
  await page.goto('/activities?tab=tasks')
  await page.locator('[data-task="publish"]').getByRole('button').click()
  await expect(page).toHaveURL(/\/account\?/)
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/activities?tab=tasks&publish=1')
  await page.getByRole('textbox', { name: '用户名或邮箱', exact: true }).fill('octopusfixture')
  await page.getByLabel('密码', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '发布作品', exact: true })).toBeVisible()
})

for (const width of [320, 390, 1440]) test(`admin edits, reorders and hides tasks at ${width}px`, async ({ page }, info) => {
  const { state } = await fixture(page)
  await page.setViewportSize({ width, height: 1000 })
  await page.goto('/admin?tab=welfare')
  await page.getByLabel('邀请福利名称', { exact: true }).fill('邀请好友')
  await page.getByLabel('作品福利补充说明', { exact: true }).fill('分享你的创作过程。')
  await page.getByLabel('作品福利按钮文字', { exact: true }).fill('去投稿')
  await page.getByRole('checkbox', { name: '显示后续预告' }).uncheck()
  await page.getByRole('button', { name: '上移作品福利', exact: true }).click()
  await page.getByRole('button', { name: '保存福利任务', exact: true }).click()
  await expect(page.getByText('已保存，福利中心会自动同步最新规则。', { exact: true })).toBeVisible()
  expect(state.writes).toHaveLength(1)
  expect(Object.keys(state.writes[0]).sort()).toEqual(['items', 'version'])
  expect(state.items.map(item => item.id)).toEqual(['publish', 'invite', 'upcoming'])
  await page.reload()
  await expect(page.getByLabel('邀请福利名称', { exact: true })).toHaveValue('邀请好友')
  await expect(page.getByRole('checkbox', { name: '显示后续预告' })).not.toBeChecked()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.admin-welfare-tasks').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`admin-tasks-${width}.png`), fullPage: true })
  await page.goto('/activities?tab=tasks')
  await expect(page.locator('[data-task] h2')).toHaveText(['用户发作品', '邀请好友'])
  await expect(page.getByRole('button', { name: '去投稿', exact: true })).toBeVisible()
})

test('publication reward controls validate, save and appear in the user task', async ({ page }) => {
  const { state } = await fixture(page)
  await page.goto('/admin?tab=welfare')
  await page.getByLabel('每轮需发布作品数', { exact: true }).fill('0')
  await expect(page.getByRole('button', { name: '保存福利任务', exact: true })).toBeDisabled()
  await page.getByLabel('每轮需发布作品数', { exact: true }).fill('3')
  await page.getByLabel('每轮奖励抽奖次数', { exact: true }).fill('5')
  await expect(page.locator('.reward-preview')).toHaveText('发布 3 个作品，获得 5 次抽奖机会')
  await page.getByRole('button', { name: '保存福利任务', exact: true }).click()
  await expect(page.getByText('已保存，福利中心会自动同步最新规则。', { exact: true })).toBeVisible()
  expect(state.items.find(item => item.id === 'publish')!.publicationReward).toEqual({ enabled: true, threshold: 3, tickets: 5 })
  state.publication.count = 2
  await page.goto('/activities?tab=tasks')
  await expect(page.locator('[data-task="publish"]')).toContainText('发布 3 个作品，获得 5 次抽奖机会')
  await expect(page.locator('[data-task="publish"]')).toContainText('本轮进度：2 / 3 个作品')
})

test('earned reward keeps its snapshot, countdown expires, and open pages sync changed rules', async ({ page }) => {
  const { state } = await fixture(page)
  const time = Date.now()
  state.publication = { count: 1, rewardTickets: 1, rewardedAt: new Date(time - 86400000 + 3000).toISOString(), resetsAt: new Date(time + 3000).toISOString(), serverTime: new Date(time).toISOString() }
  await page.goto('/activities?tab=tasks')
  const work = page.locator('[data-task="publish"]')
  await expect(work).toContainText('本轮已到账 1 次抽奖机会')
  await expect(work).toContainText('距离下一轮')
  await expect(work).toContainText('本轮进度：0 / 1 个作品', { timeout: 10000 })
  state.items[1]!.publicationReward = { enabled: true, threshold: 2, tickets: 4 }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(work).toContainText('发布 2 个作品，获得 4 次抽奖机会')
  state.items[1]!.publicationReward.enabled = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(work).toContainText('发作品送抽奖次数已暂停')
  await expect(work).not.toContainText('发布 2 个作品，获得 4 次抽奖机会')
})

test('admin conflicts preserve drafts and refresh/navigation both require deliberate discard', async ({ page }) => {
  const { state } = await fixture(page)
  await page.goto('/admin?tab=welfare')
  await page.getByLabel('邀请福利名称', { exact: true }).fill('草稿名称')
  state.conflict = true
  await page.getByRole('button', { name: '保存福利任务', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('设置已变化')
  await expect(page.getByLabel('邀请福利名称', { exact: true })).toHaveValue('草稿名称')
  await page.getByRole('button', { name: '重新读取配置', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.getByRole('link', { name: '活动抽奖', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '保留这次修改？' })).toBeVisible()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('邀请福利名称', { exact: true })).toHaveValue('草稿名称')
  await page.getByRole('button', { name: '刷新福利任务配置', exact: true }).click()
  await page.getByRole('button', { name: '丢弃修改并重新读取', exact: true }).click()
  await expect(page.getByLabel('邀请福利名称', { exact: true })).toHaveValue('邀请')
})

test('record failures preserve successfully loaded welfare rules and the wheel', async ({ page }) => {
  const { state } = await fixture(page)
  state.lottery.settings.likes.enabled = true
  await page.route('**/api/lottery/records*', route => route.fulfill({ status: 503, json: { error: '记录暂时不可用' } }))
  await page.goto('/activities?tab=tasks')
  await expect(page.locator('[data-task="publish"]')).toContainText('每件公开作品每获 100 赞')
  await expect(page.getByRole('alert')).toContainText('奖励记录读取失败')
  await page.getByRole('button', { name: '活动抽奖', exact: true }).click()
  await expect(page.locator('.draw-console')).toBeVisible()
})

test('admin load failure recovers and moderators have no welfare configuration entry', async ({ page }) => {
  const { state, account } = await fixture(page); state.adminFailure = true
  await page.goto('/admin?tab=welfare')
  await expect(page.getByRole('alert')).toContainText('配置暂时不可用')
  state.adminFailure = false
  await page.getByRole('button', { name: '重新读取配置', exact: true }).click()
  await expect(page.getByLabel('邀请福利名称', { exact: true })).toHaveValue('邀请')
  account.state.user.isAdmin = false; account.state.user.isModerator = true
  await page.reload()
  await expect(page.getByRole('navigation', { name: '管理分类' }).getByRole('button', { name: '福利任务', exact: true })).toHaveCount(0)
  await expect(page.locator('.admin-welfare-tasks')).toHaveCount(0)
})
