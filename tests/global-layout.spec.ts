import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Work } from '../src/data'

const user = { id: 'layout-user', username: 'creator', name: '布局测试创作者', bio: '记录创作过程与提示词。', isAdmin: true, isModerator: true }
const peer = { ...user, id: 'layout-peer', username: 'peer', name: '有较长显示名称的社区创作者', isAdmin: false, isModerator: false }
const work: Work = {
  id: 'layout-work', authorId: user.id, title: '从构思到成品：保留细节的创作记录',
  author: user.name, avatar: '创', version: 1, fileIds: [], kind: 'resource', cover: '',
  tags: ['Skill'], prompt: '保留构图与细节，使用自然光线。', model: '模型名称与版本',
  likes: 7, date: '2026-11-12T00:00:00Z', owned: true, liked: false, saved: false,
  status: 'published', body: '先整理主题和参考资料，再逐步完善提示词。\n在每次迭代中记录判断依据，保留有价值的版本。', viewsCount: 23,
}
const works = Array.from({ length: 10 }, (_, index) => ({ ...work, id: index ? `layout-work${index}` : work.id }))
const creator = { ...user, count: 10, worksCount: 10, followersCount: 12, followingCount: 8, followed: false }

async function mockLayout(page: Page, authenticated = true) {
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== 'http://localhost:18775') return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const path = url.pathname
    if (request.method() !== 'GET') return route.fulfill({ status: 503, json: { error: '布局测试不执行业务写入。' } })
    if (path === '/api/session') return route.fulfill({ json: { user: authenticated ? user : null } })
    if (path === '/api/works' || path === '/api/library') return route.fulfill({ json: { items: works, nextCursor: null } })
    if (path === `/api/works/${work.id}`) return route.fulfill({ json: { work } })
    if (path === '/api/creators') return route.fulfill({ json: { items: [creator, { ...creator, ...peer }] } })
    if (path === `/api/users/${user.id}`) return route.fulfill({ json: { user: creator } })
    if (path === '/api/announcements') return route.fulfill({ json: { items: [{ id: 'news', title: '社区创作与发布说明', body: work.body, date: '2026-11-12' }] } })
    if (path === '/api/account') return route.fulfill({ json: { linked: true, subject: user.username, issuer: '章鱼账号', balance: 12.34, currency: 'USD' } })
    if (path === '/api/admin/submissions') return route.fulfill({ json: { items: [{ ...work, status: 'pending' }] } })
    if (path === '/api/messages/threads') return route.fulfill({ json: { items: [{ user: peer, lastMessage: { text: '分享了一件新作品' }, unread: 2 }], nextCursor: null } })
    if (path === `/api/messages/${peer.id}`) return route.fulfill({ json: {
      items: Array.from({ length: 12 }, (_, index) => ({ id: `message${index}`, text: '分享创作灵感', owned: index % 2 === 0, date: `2026-11-12T00:${String(index).padStart(2, '0')}:00Z` })),
      user: peer, canSend: true, nextCursor: null,
    } })
    if (path === '/api/lottery/status') return route.fulfill({ json: {
      settings: { enabled: true, prizes: [{ id: 'prize', name: '创作奖励', description: '活动测试奖项', amountCents: 100, kind: 'balance', weight: 1, stock: 10, enabled: true }], invites: { enabled: true, threshold: 1, tickets: 1 }, followers: { enabled: false }, likes: { enabled: false }, likesMode: 'work', wheel: { theme: 'teal', title: '创作抽奖', subtitle: '', buttonText: '抽奖', rulesText: '参与活动前请阅读规则。' } },
      balance: 3, counts: { invites: 2, followers: 0, likes: 0, bestWorkLikes: 0 }, earned: { invites: 2 }, accountLinked: true, creditReady: false, inviteUrl: '',
    } })
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
}

const pages = [
  { path: '/discover', title: '发现' },
  { path: '/library', title: '我的作品' },
  { path: '/community', title: '社区' },
  { path: '/community?creator=layout-user', title: user.name },
  { path: '/community?tab=announcements', title: '社区' },
  { path: '/account', title: '账户设置' },
  { path: '/activities', title: '活动' },
  { path: '/admin', title: '管理后台' },
  { path: `/messages/${peer.id}`, title: '私信' },
  { path: `/work/${work.id}`, title: work.title },
]

for (const width of [320, 390, 768, 1000, 1440]) {
  test(`global pages fit and remain accessible at ${width}px`, async ({ page }) => {
    await mockLayout(page)
    await page.setViewportSize({ width, height: 900 })
    for (const [index, target] of pages.entries()) {
      await page.goto(target.path)
      await expect(page.getByRole('heading', { name: target.title, exact: true }).first()).toBeVisible()
      await expect(page.locator('.content-loading')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), target.path).toBe(true)
      const content = await page.locator('.page-container').first().boundingBox()
      expect(content!.x, target.path).toBeGreaterThanOrEqual(0)
      expect(content!.x + content!.width, target.path).toBeLessThanOrEqual(width)
      if (target.path === '/library') {
        await expect(page.locator('.cover-status')).toHaveCount(10)
        await expect(page.locator('.resource-bottom')).toHaveCount(0)
      }
      if (target.path === '/discover') await expect(page.locator('.resource-bottom')).toHaveCount(10)
      if (target.path === '/admin') {
        const layout = await page.locator('.admin-layout').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)
        expect(layout).toBe(width > 899 ? 2 : 1)
      }
      if (target.path.startsWith('/messages/')) {
        const history = page.getByRole('region', { name: '消息记录', exact: true })
        await history.focus()
        await expect(history).toBeFocused()
      }
      if (width === 390 || width === 1440) {
        const accessibility = await new AxeBuilder({ page }).include('main').analyze()
        expect(accessibility.violations, target.path).toEqual([])
        await page.screenshot({ path: test.info().outputPath(`page-${index}-${width}.png`), fullPage: true })
      }
    }
  })
}

test('gallery loading keeps its columns and exposes an accessible status', async ({ page }) => {
  await mockLayout(page)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/works?*', async route => { await pending; await route.fulfill({ json: { items: works, nextCursor: null } }) })
  await page.goto('/discover')
  const loading = page.getByRole('status', { name: '正在加载作品…', exact: true })
  await expect(loading).toBeVisible()
  expect(await loading.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(5)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await loading.locator('.skeleton').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none')
  release()
  await expect(loading).toHaveCount(0)
  await expect(page.locator('.work-card')).toHaveCount(10)
})

test('guest account and library stay within a small viewport', async ({ page }) => {
  await mockLayout(page, false)
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: '登录社区', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto('/library')
  await expect(page.getByRole('heading', { name: '登录后查看我的作品', exact: true })).toBeVisible()
})
