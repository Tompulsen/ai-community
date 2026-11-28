import { expect, test, type Page } from '@playwright/test'
import type { Work } from '../src/data'
import { mockUnifiedAccount } from './helpers/account-fixture'

const works: Work[] = [
  { id: 'oldWork1', authorId: 'oldUser2', noteId: 'oldNote1', version: 1, fileIds: [], title: '真实接口作品', author: '创作者', avatar: '创', kind: 'resource', cover: '', tags: ['Skill'], prompt: '测试提示词', model: 'model', likes: 7, date: '2026-11-12T00:00:00Z', owned: false, liked: false, saved: false, status: 'published', body: '来自业务接口的作品内容' },
]

async function preview(page: Page, authenticated = false) {
  await mockUnifiedAccount(page, authenticated)
  await page.route('**/api/works**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/works' || url.pathname === '/api/works/feed') return route.fulfill({ json: { items: works, nextCursor: null } })
    if (url.pathname === '/api/works/oldWork1') return route.fulfill({ json: { work: works[0] } })
    await route.fallback()
  })
}

for (const width of [1440, 390]) {
  test(`renders API works without synthetic seeds at ${width}px`, async ({ page }) => {
    await preview(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/discover')
    await expect(page.locator('article.work-card')).toHaveCount(1)
    await expect(page.getByRole('link', { name: '真实接口作品', exact: true })).toBeVisible()
    await expect(page.getByText('演示创作者', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('a guest bookmarking a discovery card is sent to login for that specific work', async ({ page }) => {
  await preview(page)
  await page.goto('/discover')
  await page.getByRole('link', { name: '登录后收藏：真实接口作品', exact: true }).click()
  await expect(page).toHaveURL(url => url.pathname === '/account' && url.searchParams.get('returnTo') === '/work/oldWork1')
})

test('does not expose an administrator page to an ordinary member', async ({ page }) => {
  await preview(page, true)
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: '需要审核员权限', exact: true })).toBeVisible()
  await page.locator('.profile-toggle').hover()
  await expect(page.getByRole('link', { name: '内容管理', exact: true })).toHaveCount(0)
})

test('failed bookmark calls do not show a successful saved state', async ({ page }) => {
  await preview(page, true)
  await page.route('**/api/works/oldWork1/save', route => route.fulfill({ status: 503, json: { error: '服务暂不可用' } }))
  await page.goto('/discover')
  await page.getByRole('button', { name: '收藏：真实接口作品', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '服务暂不可用' })).toBeVisible()
  await expect(page.getByRole('button', { name: '收藏：真实接口作品', exact: true })).toHaveAttribute('aria-pressed', 'false')
})
