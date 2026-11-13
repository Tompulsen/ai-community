import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const activity = (n: number) => ({ id: `redis:${1794435800000 + n}-0`, type: 'activity', title: `互动 ${n}`, text: '作品收到互动', isRead: false, url: '/community' })
const announcement = (n: number) => ({ id: `notice${String(n).padStart(3, '0')}`, type: 'announcement', title: `公告 ${n}`, text: '社区公告', isRead: false, url: '/community?tab=announcements' })
async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  const state = { notices: [...Array.from({ length: 75 }, (_, n) => activity(n + 1)), ...Array.from({ length: 65 }, (_, n) => announcement(n + 1))], failRead: false, failMore: false, concurrentArrival: false }
  const writes: any[] = [], reads: URL[] = []
  const snapshots = new Map<string, string[]>()
  await page.route('**/api/notifications**', route => {
    const url = new URL(route.request().url()); reads.push(url)
    if (url.pathname === '/api/notifications/read-all') {
      const body = route.request().postDataJSON(); writes.push(body)
      if (state.failRead) return route.fulfill({ status: 503, json: { message: '已读保存失败' } })
      if (state.concurrentArrival) { state.notices.push(activity(200)); state.concurrentArrival = false }
      const boundary = body.category === 'activity' ? `redis:${body.through}` : body.through
      state.notices.forEach(n => { if (n.type === body.category && (body.category === 'activity' ? n.id <= boundary : snapshots.get(body.through)?.includes(n.id))) n.isRead = true })
      return route.fulfill({ json: { ok: true } })
    }
    const category = url.searchParams.get('category'), cursor = url.searchParams.get('cursor')
    if (cursor && state.failMore) return route.fulfill({ status: 503, json: { message: '历史通知加载失败' } })
    const items: typeof state.notices = [], nextCursors: Record<string, string | null> = {}, readThrough: Record<string, string | null> = {}, unreadCounts: Record<string, number> = {}
    for (const type of ['activity', 'announcement']) {
      const notices = state.notices.filter(n => n.type === type).sort((a, b) => b.id.localeCompare(a.id))
      const id = (value: string) => type === 'activity' ? value.slice(6) : value
      readThrough[type] = notices[0] ? id(notices[0].id) : null
      unreadCounts[type] = notices.filter(n => !n.isRead).length
      const older = notices.filter(n => category !== type || !cursor || id(n.id) < cursor)
      nextCursors[type] = older.length > 30 ? id(older[29]!.id) : null
      if (!category || category === type) items.push(...older.slice(0, 30))
    }
    const token = `snapshot${snapshots.size}`
    snapshots.set(token, state.notices.filter(n => n.type === 'announcement' && !n.isRead).map(n => n.id))
    readThrough.announcement = token
    return route.fulfill({ json: { items, unreadCounts, nextCursors, readThrough } })
  })
  return { account, state, writes, reads }
}

test('history pagination is independent from totals and a refresh resets both hidden history and cursor gaps', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/messages?tab=activity')
  await expect(page.locator('.inbox-notification')).toHaveCount(30)
  await expect(page.getByRole('link', { name: /互动消息/ }).filter({ has: page.locator('.unread-badge') })).toContainText('75')
  await page.getByRole('button', { name: '加载更早通知' }).click()
  await expect(page.locator('.inbox-notification')).toHaveCount(60)
  f.state.notices = f.state.notices.filter(n => n.id !== activity(20).id)
  f.state.notices.push(...Array.from({ length: 50 }, (_, n) => activity(76 + n)))
  await page.getByRole('button', { name: '刷新消息' }).click()
  await expect(page.locator('.inbox-notification')).toHaveCount(30)
  await expect(page.getByText('互动 20', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '加载更早通知' }).click()
  await expect(page.getByText('互动 76', { exact: true })).toBeVisible()
  expect(f.reads.at(-1)!.searchParams.get('cursor')).toBe('1794435800096-0')
  await page.getByRole('navigation', { name: '消息分类', exact: true }).getByRole('link', { name: /系统公告/ }).click()
  await expect(page.locator('.inbox-notification')).toHaveCount(30)
  await page.getByRole('button', { name: '加载更早通知' }).click()
  await expect(page.locator('.inbox-notification')).toHaveCount(60)
  await page.getByRole('button', { name: '加载更早通知' }).click()
  await expect(page.locator('.inbox-notification')).toHaveCount(65)
  await expect(page.getByRole('button', { name: '加载更早通知' })).toHaveCount(0)
})

test('category mark-all uses the page boundary, keeps concurrent arrivals and leaves the other category unread', async ({ page }) => {
  const f = await fixture(page); f.state.concurrentArrival = true
  await page.goto('/messages?tab=activity')
  await page.getByRole('button', { name: '全部标记已读' }).click()
  await expect(page.locator('.inbox-notification.unread')).toHaveCount(1)
  await expect(page.locator('.inbox-notification.unread')).toContainText('互动 200')
  expect(f.writes).toEqual([{ category: 'activity', through: '1794435800075-0' }])
  const categories = page.getByRole('navigation', { name: '消息分类', exact: true })
  await expect(categories.getByRole('link', { name: /系统公告/ })).toContainText('65')
  await categories.getByRole('link', { name: /系统公告/ }).click()
  await page.getByRole('button', { name: '全部标记已读' }).click()
  await expect(page.locator('.inbox-notification.unread')).toHaveCount(0)
  await expect(categories.getByRole('link', { name: /互动消息/ })).toContainText('1')
  expect(f.state.notices.filter(n => n.type === 'announcement' && !n.isRead)).toHaveLength(0)
})

test('history and read failures preserve visible notifications and allow a retry', async ({ page }) => {
  const f = await fixture(page); f.state.failMore = true; f.state.failRead = true
  await page.goto('/messages?tab=activity')
  await page.getByRole('button', { name: '加载更早通知' }).click()
  await expect(page.getByRole('alert')).toContainText('历史通知加载失败')
  await expect(page.locator('.inbox-notification')).toHaveCount(30)
  f.state.failMore = false
  await page.getByRole('button', { name: '加载更早通知' }).click()
  await expect(page.locator('.inbox-notification')).toHaveCount(60)
  await page.getByRole('button', { name: '全部标记已读' }).click()
  await expect(page.getByRole('alert')).toContainText('已读保存失败')
  await expect(page.locator('.inbox-notification.unread')).toHaveCount(60)
  f.state.failRead = false
  await page.getByRole('button', { name: '全部标记已读' }).click()
  await expect(page.locator('.inbox-notification.unread')).toHaveCount(0)
})
