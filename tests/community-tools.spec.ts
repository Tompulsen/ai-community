import { mkdir } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { fillAccountLogin, mockUnifiedAccount } from './helpers/account-fixture'

const launcher = (page: Page) => page.getByTitle('社区工具', { exact: true })
const panel = (page: Page) => page.getByRole('dialog', { name: '社区工具', exact: true })
async function toolsFixture(page: Page, authenticated = true) {
  const account = await mockUnifiedAccount(page, authenticated)
  const counts = { announcement: 2, activity: 7, messages: 135 }
  await page.route('**/api/notifications', route => route.fulfill({ json: { items: [], unreadCounts: counts } }))
  await page.route('**/api/messages/threads', route => route.fulfill({ json: { items: [], unreadCount: counts.messages, nextCursor: null } }))
  return { ...account, counts }
}

test('tools use real destinations and category counts without writing data', async ({ page }) => {
  const fixture = await toolsFixture(page)
  await page.goto('/community')
  await launcher(page).click()
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).locator('.tool-item')).toHaveCount(18)
  const destinations = {
    '发现': '/discover', '公告，2 条未读': '/community?tab=announcements', '通知，7 条未读': '/messages?tab=activity',
    '消息，99+ 条未读': '/messages', '收藏': '/library?tab=saved', '我的作品': '/library', '创作者': '/community?tab=creators',
    '图片': '/discover?kind=image', '视频': '/discover?kind=video', '创作台': '/create', '推广中心': '/activities',
    '账号设置': '/account?tab=profile', '账户余额': '/account?tab=balance', '个人主页': '/community?creator=fixtureAccountUser',
    '主题外观': '/account?tab=theme', '关注申请': '/account?tab=following',
  }
  for (const [name, path] of Object.entries(destinations)) await expect(panel(page).getByRole('link', { name, exact: true })).toHaveAttribute('href', path)
  await expect(panel(page).getByRole('link', { name: '消息，99+ 条未读', exact: true }).locator('.tool-count')).toHaveText('99+')
  await expect(panel(page).getByRole('link', { name: '消息，99+ 条未读', exact: true })).toHaveAttribute('aria-description', '共 135 条未读')
  await expect(panel(page).getByRole('link', { name: '内容管理', exact: true })).toHaveCount(0)
  expect(fixture.mutations).toEqual([])
})

test('search opens the existing work search with encoded keywords', async ({ page }) => {
  await toolsFixture(page)
  await page.goto('/community')
  await launcher(page).click()
  await panel(page).getByRole('button', { name: '搜索', exact: true }).click()
  const search = panel(page).getByRole('searchbox', { name: '搜索社区作品', exact: true })
  await expect(search).toBeFocused()
  const keywords = '海边 & 光影 / AI'
  await search.fill(keywords)
  const requested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/works' && new URL(request.url()).searchParams.get('query') === keywords)
  await search.press('Enter')
  await requested
  expect(new URL(page.url()).pathname).toBe('/discover')
  expect(new URL(page.url()).searchParams.get('q')).toBe(keywords)
  await expect(panel(page)).not.toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索作品', exact: true })).toHaveValue(keywords)
})

test('community tabs and launcher destinations stay in sync on repeated visits', async ({ page }) => {
  await toolsFixture(page)
  await page.goto('/community')
  await launcher(page).click()
  await panel(page).getByRole('link', { name: /^公告/ }).click()
  await expect(page.getByRole('region', { name: '社区公告', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '创作者', exact: true }).click()
  await expect(page.getByRole('region', { name: '社区创作者', exact: true })).toBeVisible()
  await launcher(page).click()
  await panel(page).getByRole('link', { name: /^公告/ }).click()
  await expect(page.getByRole('region', { name: '社区公告', exact: true })).toBeVisible()
  await launcher(page).click()
  await panel(page).getByRole('link', { name: '创作者', exact: true }).click()
  await expect(page).toHaveURL(/tab=creators$/)
  await page.getByRole('button', { name: '社区公告', exact: true }).click()
  await expect(page).toHaveURL(/tab=announcements$/)
  await page.goBack()
  await expect(page.getByRole('region', { name: '社区创作者', exact: true })).toBeVisible()
})

test('guest notification entry returns to its category after login', async ({ page }) => {
  const fixture = await toolsFixture(page, false)
  await page.goto('/community')
  await launcher(page).click()
  await expect(panel(page).locator('.tool-count')).toHaveCount(0)
  await expect(panel(page).getByRole('link', { name: '内容管理', exact: true })).toHaveCount(0)
  expect(fixture.reads.filter(path => path.startsWith('/api/messages') || path === '/api/notifications')).toEqual([])
  await expect(panel(page).getByRole('link', { name: '个人资料', exact: true })).toHaveAttribute('href', '/account?returnTo=/account?tab=profile')
  await panel(page).getByRole('link', { name: '通知', exact: true }).click()
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/messages?tab=activity')
  await fillAccountLogin(page)
  await expect(page).toHaveURL(/\/messages\?tab=activity$/)
  await expect(page.getByRole('navigation', { name: '消息分类', exact: true }).getByRole('link', { name: /互动消息/ })).toHaveAttribute('aria-current', 'page')
})

test('keyboard, outside click and other header menus close the launcher predictably', async ({ page }) => {
  await toolsFixture(page)
  await page.goto('/community')
  await launcher(page).focus()
  await page.keyboard.press('Enter')
  await expect(panel(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel(page)).not.toBeVisible()
  await expect(launcher(page)).toBeFocused()
  await launcher(page).click()
  await page.getByRole('heading', { name: '社区', exact: true }).click()
  await expect(panel(page)).not.toBeVisible()
  await page.getByLabel('账号菜单', { exact: true }).click()
  await expect(page.locator('.account-popover')).toBeVisible()
  await launcher(page).click()
  await expect(page.locator('.account-popover')).not.toBeVisible()
  await expect(panel(page)).toBeVisible()
  await page.locator('.message-trigger').hover()
  await expect(page.locator('.message-popover')).toBeVisible()
  await expect(panel(page)).not.toBeVisible()
  await page.mouse.move(24, 500)
  await launcher(page).click()
  await panel(page).getByRole('button', { name: '刷新', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(panel(page)).not.toBeVisible()
})

test('tool navigation and reload preserve the unsaved profile guard', async ({ page }) => {
  await toolsFixture(page)
  await page.goto('/account')
  await page.getByLabel('显示名称', { exact: true }).fill('尚未保存的个人资料')
  await launcher(page).click()
  await panel(page).getByRole('link', { name: '收藏', exact: true }).click()
  await expect(panel(page)).not.toBeVisible()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('尚未保存的个人资料')
  await launcher(page).click()
  const prompt = page.waitForEvent('dialog')
  const refresh = panel(page).getByRole('button', { name: '刷新', exact: true }).click()
  const confirm = await prompt
  expect(confirm.type()).toBe('beforeunload')
  await confirm.dismiss()
  await refresh
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('尚未保存的个人资料')
})

test('switching accounts closes tools and updates identity, privileges and unread counts', async ({ page }) => {
  const fixture = await toolsFixture(page)
  fixture.state.user.isAdmin = true
  await page.goto('/account')
  await launcher(page).click()
  await expect(panel(page).getByRole('link', { name: '内容管理', exact: true })).toBeVisible()
  await panel(page).getByRole('searchbox').fill('旧账号搜索')
  fixture.state.user = { ...fixture.state.user, id: 'secondAccount', isAdmin: false, isModerator: false, name: '另一个账号' }
  Object.assign(fixture.counts, { announcement: 0, activity: 0, messages: 0 })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('另一个账号')
  await expect(panel(page)).not.toBeVisible()
  await launcher(page).click()
  await expect(panel(page).getByRole('searchbox')).toHaveValue('')
  await expect(panel(page).getByRole('link', { name: '内容管理', exact: true })).toHaveCount(0)
  await expect(panel(page).getByRole('link', { name: '个人主页', exact: true })).toHaveAttribute('href', '/community?creator=secondAccount')
  await expect(panel(page).locator('.tool-count')).toHaveCount(0)
})

test('launcher fits narrow guest and member screens with accessible controls', async ({ page }) => {
  const fixture = await toolsFixture(page)
  await mkdir('.impeccable/review/community-tools', { recursive: true })
  for (const authenticated of [true, false]) {
    fixture.state.authenticated = authenticated; fixture.state.accountAuthenticated = authenticated
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width < 400 ? 740 : 900 })
      await page.goto('/discover')
      if (authenticated) await expect(page.getByLabel('账号菜单', { exact: true })).toBeVisible()
      else await expect(page.locator('.header-login')).toBeVisible()
      await launcher(page).click()
      await expect(panel(page)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const bounds = (await panel(page).boundingBox())!
      const header = (await page.locator('.app-header').boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      expect(bounds.y).toBeGreaterThanOrEqual(header.y + header.height)
      const bottom = width < 1000 ? (await page.getByRole('navigation', { name: '手机导航' }).boundingBox())!.y : page.viewportSize()!.height
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(bottom)
      await panel(page).getByRole('button', { name: '刷新', exact: true }).scrollIntoViewIfNeeded()
      await expect(panel(page).getByRole('button', { name: '刷新', exact: true })).toBeInViewport()
      await panel(page).evaluate(element => { element.scrollTop = 0 })
      await page.screenshot({ path: `.impeccable/review/community-tools/${authenticated ? 'member' : 'guest'}-${width}.png` })
      if (width === 1440 || width === 320) {
        const result = await new AxeBuilder({ page }).include('.app-header').analyze()
        expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
      }
    }
  }
})
