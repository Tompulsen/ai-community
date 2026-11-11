import { expect, test } from '@playwright/test'
import type { Work } from '../src/data'

const user = { id: 'oldUser1', name: '测试创作者', username: 'creator', bio: '创作记录', isAdmin: false, isModerator: false }
const works: Work[] = [
  { id: 'oldWork1', authorId: 'oldUser2', noteId: 'oldNote1', version: 1, fileIds: [], title: '真实接口作品', author: '创作者', avatar: '创', kind: 'resource', cover: '', tags: ['Skill'], prompt: '测试提示词', model: 'model', likes: 7, date: '2026-11-12T00:00:00Z', owned: false, liked: false, saved: false, status: 'published', body: '来自业务接口的作品内容' },
]

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/session') return route.fulfill({ json: { user: null } })
    if (url.pathname === '/api/works') return route.fulfill({ json: { items: works, nextCursor: null } })
    if (url.pathname === '/api/works/oldWork1') return route.fulfill({ json: { work: works[0] } })
    if (url.pathname === '/api/tags') return route.fulfill({ json: { items: [{ id: 'tag1', name: 'Skill' }] } })
    if (url.pathname === '/api/creators' || url.pathname === '/api/announcements') return route.fulfill({ json: { items: [] } })
    if (url.pathname === '/api/notifications' || url.pathname === '/api/community/ads' || url.pathname === '/api/works/oldWork1/comments') return route.fulfill({ json: { items: [], nextCursor: null } })
    if (url.pathname === '/api/works/oldWork1/view' && route.request().method() === 'POST') return route.fulfill({ json: { viewsCount: 1 } })
    return route.fulfill({ status: 401, json: { error: '请先登录。' } })
  })
})

for (const width of [1440, 390]) {
  test(`renders API works without synthetic seeds at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    await expect(page.locator('article.work-card')).toHaveCount(1)
    await expect(page.getByRole('link', { name: '真实接口作品', exact: true })).toBeVisible()
    await expect(page.getByText('演示创作者', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('loads legacy IDs from the server and keeps guest actions unauthenticated', async ({ page }) => {
  await page.goto('/work/oldWork1')
  await expect(page.getByRole('heading', { name: '真实接口作品', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '收藏', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '请先登录' })).toBeVisible()
  await expect(page.getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

test('does not expose an administrator page to an ordinary member', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user } }))
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: '需要审核员权限', exact: true })).toBeVisible()
  await page.getByLabel('账号菜单', { exact: true }).click()
  await expect(page.getByRole('link', { name: '内容管理', exact: true })).toHaveCount(0)
})

test('failed bookmark calls do not show a successful saved state', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user } }))
  await page.route('**/api/works/oldWork1/save', route => route.fulfill({ status: 503, json: { error: '服务暂不可用' } }))
  await page.goto('/discover')
  await page.getByRole('button', { name: '收藏：真实接口作品', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '服务暂不可用' })).toBeVisible()
  await expect(page.getByRole('button', { name: '收藏：真实接口作品', exact: true })).toHaveAttribute('aria-pressed', 'false')
})
