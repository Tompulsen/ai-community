import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const peer = { id: '42', accountId: '42', username: 'ocean', name: '海洋创作者', bio: '', count: 0 }
const menu = (page: Page) => page.locator('.header-menu.messages-menu')
const trigger = (page: Page) => menu(page).locator('summary.message-trigger')
const popover = (page: Page) => menu(page).locator('.message-popover')
const categories = [
  { label: '系统公告', href: '/messages?tab=announcement', unread: 2 },
  { label: '我的消息', href: '/messages', unread: 4 },
  { label: '互动消息', href: '/messages?tab=activity', unread: 3 },
]

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}

async function messageFixture(page: Page, delayOldNotifications = false) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  account.state.user.accountId = '17'
  const notifications = [
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `announcement${index + 1}`, type: 'announcement', title: `测试系统公告${index + 1}`,
      text: '系统公告内容', isRead: false, url: '/community?tab=announcements', createdAt: '2026-11-13T10:00:00Z',
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `redis:179443580000${index}-1`, type: 'activity', title: `测试互动${index + 1}`,
      text: '作品收到互动', isRead: false, url: '/community', createdAt: '2026-11-13T09:00:00Z',
    })),
    { id: 'redis:1794435800010-1', type: 'message', title: '同一私信的通知',
      text: '这条提醒不能重复计数', isRead: false, url: '/messages?peer=42', createdAt: '2026-11-13T08:00:00Z' },
  ]
  let directUnread = 4, peerUnread = 1
  const held = deferred(), oldStarted = deferred(), oldFinished = deferred(), newStarted = deferred()
  let heldOnce = false
  const mutations: { path: string; body: Record<string, unknown> }[] = []
  const privateReads: string[] = []
  const counters = () => ({
    announcement: notifications.filter(item => item.type === 'announcement' && !item.isRead).length,
    activity: notifications.filter(item => item.type === 'activity' && !item.isRead).length,
  })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (path === '/api/notifications' && request.method() === 'GET') {
      privateReads.push(path)
      const owner = account.state.user.id
      if (delayOldNotifications && owner === '17' && !heldOnce) {
        heldOnce = true
        oldStarted.resolve()
        await held.promise
        await route.fulfill({ json: { items: notifications, unreadCounts: { announcement: 70, activity: 80 } } }).catch(() => {})
        oldFinished.resolve()
        return
      }
      if (owner !== '17') {
        newStarted.resolve()
        return route.fulfill({ json: { items: [], unreadCounts: { announcement: 0, activity: 0 } } })
      }
      return route.fulfill({ json: { items: notifications, unreadCounts: counters() } })
    }
    if (path === '/api/notifications/read') {
      const body = request.postDataJSON() as { ids: string[] }
      mutations.push({ path, body })
      notifications.forEach(item => { if (body.ids.includes(item.id)) item.isRead = true })
      return route.fulfill({ json: { ok: true } })
    }
    if (path === '/api/messages/threads') {
      privateReads.push(path)
      if (account.state.user.id !== '17') return route.fulfill({ json: { items: [], unreadCount: 0, nextCursor: null } })
      return route.fulfill({ json: {
        items: [{ user: peer, unread: peerUnread, lastMessage: { text: '一条未读私信', date: '2026-11-13T10:00:00Z' } }],
        unreadCount: directUnread, nextCursor: null,
      } })
    }
    if (path === '/api/messages/42') return route.fulfill({ json: {
      user: peer, items: [{ id: 'message1', text: '来自海洋创作者的消息', owned: false, date: '2026-11-13T10:00:00Z' }],
      nextCursor: null, canSend: false, reason: '互相关注后可发送消息。',
    } })
    if (path === '/api/messages/42/read') {
      mutations.push({ path, body: request.postDataJSON() as Record<string, unknown> })
      directUnread -= peerUnread
      peerUnread = 0
      return route.fulfill({ json: { ok: true } })
    }
    return route.fallback()
  })
  return { ...account, mutations, privateReads, oldStarted: oldStarted.promise, oldFinished: oldFinished.promise,
    newStarted: newStarted.promise, releaseOld: held.resolve }
}

test('desktop message menu survives pointer entry and supports keyboard focus and Escape with deduplicated totals', async ({ page }) => {
  const fixture = await messageFixture(page)
  await page.goto('/community')
  await expect(trigger(page)).toHaveAttribute('aria-label', '消息，9 条未读')
  await expect(page.locator('header').getByTitle('通知', { exact: true })).toHaveCount(0)
  await trigger(page).hover()
  await expect(popover(page)).toBeVisible()
  for (const category of categories) {
    const link = popover(page).getByRole('link', { name: new RegExp(category.label) })
    await expect(link).toHaveAttribute('href', category.href)
    await expect(link).toContainText(String(category.unread))
  }
  const target = await popover(page).getByRole('link', { name: /互动消息/ }).boundingBox()
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 12 })
  await expect(popover(page)).toBeVisible()
  await page.mouse.move(24, 500)
  await expect(popover(page)).not.toBeVisible()
  await trigger(page).focus()
  await expect(popover(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover(page)).not.toBeVisible()
  await expect(trigger(page)).toBeFocused()

  const authenticatedReads = fixture.privateReads.length
  fixture.state.authenticated = false
  fixture.state.accountAuthenticated = false
  await page.goto('/community')
  await expect(trigger(page)).toHaveAttribute('aria-label', '消息')
  await trigger(page).hover()
  await expect(popover(page)).toBeVisible()
  await expect(popover(page).getByText('登录即可查看关注动态', { exact: true })).toBeVisible()
  await expect(popover(page).getByRole('link', { name: '立即登录', exact: true })).toHaveAttribute('href', '/account')
  await expect(popover(page).getByRole('link', { name: /系统公告|我的消息|互动消息/ })).toHaveCount(0)
  expect(fixture.privateReads).toHaveLength(authenticatedReads)
})

test.describe('touch message entry', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('a tap opens the single menu and category navigation remains usable on a phone', async ({ page }) => {
    await messageFixture(page)
    await page.goto('/community')
    await expect(trigger(page)).toHaveAttribute('aria-label', '消息，9 条未读')
    await trigger(page).tap()
    await expect(popover(page)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await popover(page).getByRole('link', { name: /系统公告/ }).tap()
    await expect(page).toHaveURL('/messages?tab=announcement')
    await expect(page.getByRole('heading', { name: '消息', exact: true })).toBeVisible()
    await expect(popover(page)).not.toBeVisible()
    const navigation = page.getByRole('navigation', { name: '消息分类', exact: true })
    await expect(navigation.getByRole('link', { name: /系统公告/ })).toHaveAttribute('href', '/messages?tab=announcement')
    await navigation.getByRole('link', { name: /互动消息/ }).tap()
    await expect(page).toHaveURL('/messages?tab=activity')
    await expect(page.getByRole('region', { name: '互动消息', exact: true }).or(page.locator('section[aria-label="互动消息"]'))).toBeVisible()
  })
})

test('reading each message class updates the shared header without double-counting direct-message notifications', async ({ page }) => {
  const fixture = await messageFixture(page)
  await page.goto('/messages?tab=announcement')
  await expect(trigger(page)).toHaveAttribute('aria-label', '消息，9 条未读')
  await page.locator('.inbox-notification').filter({ hasText: '测试系统公告1' }).locator('.inbox-notification-link').click()
  await expect(page).toHaveURL('/community?tab=announcements')
  await expect(trigger(page)).toHaveAttribute('aria-label', '消息，8 条未读')
  expect(fixture.mutations.find(item => item.path === '/api/notifications/read')?.body.ids).toEqual(['announcement1'])

  await trigger(page).hover()
  await popover(page).getByRole('link', { name: /互动消息/ }).click()
  await expect(page).toHaveURL('/messages?tab=activity')
  await page.locator('.inbox-notification').filter({ hasText: '测试互动1' }).locator('.inbox-notification-link').click()
  await expect(page).toHaveURL('/community')
  await expect(trigger(page)).toHaveAttribute('aria-label', '消息，7 条未读')

  await trigger(page).hover()
  await popover(page).getByRole('link', { name: /我的消息/ }).click()
  await page.locator('.thread-row').click()
  await expect(page).toHaveURL('/messages/42')
  await expect(page.getByRole('region', { name: '消息记录', exact: true })).toContainText('来自海洋创作者的消息')
  await expect(trigger(page)).toHaveAttribute('aria-label', '消息，6 条未读')
  expect(fixture.mutations.filter(item => item.path === '/api/messages/42/read')).toHaveLength(1)
  await trigger(page).hover()
  await expect(popover(page).getByRole('link', { name: /我的消息/ })).toContainText('3')
})

test('switching accounts prevents an older inbox response from restoring another account unread counts', async ({ page }) => {
  const fixture = await messageFixture(page, true)
  try {
    await page.goto('/community')
    await fixture.oldStarted
    fixture.state.user.id = '18'
    fixture.state.user.accountId = '18'
    fixture.state.user.username = 'new-account'
    fixture.state.user.name = '新的章鱼用户'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await fixture.newStarted
    await expect(trigger(page)).toHaveAttribute('aria-label', '消息')
    fixture.releaseOld()
    await fixture.oldFinished
    await trigger(page).hover()
    await expect(popover(page)).toBeVisible()
    await expect(trigger(page)).toHaveAttribute('aria-label', '消息')
    for (const category of categories) {
      await expect(popover(page).getByRole('link', { name: new RegExp(category.label) })).not.toContainText(/70|80|150/)
    }
  } finally { fixture.releaseOld() }
})
