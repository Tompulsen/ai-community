import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function library(page: Page) {
  await mockUnifiedAccount(page, true)
  const works = Array.from({ length: 103 }, (_, index) => ({
    id: String(index + 1), title: `作品 ${index + 1}`, kind: 'image', status: 'published', author: '作者',
    tags: index >= 100 ? ['分页', '远山'] : ['分页'], likes: 0, owned: true, saved: index !== 102,
  }))
  let releaseSlow!: () => void
  const delayed = new Promise<void>(resolve => { releaseSlow = resolve })
  await page.route('**/api/library**', async route => {
    const params = new URL(route.request().url()).searchParams
    const q = params.get('q') || ''
    if (q === '列表出错') return route.fulfill({ status: 503, json: { message: '作品暂不可用' } })
    const matches = works.filter(work => (params.get('status') !== 'saved' || work.saved)
      && [work.title, ...work.tags].some(value => value.includes(q)))
    const offset = Number(params.get('cursor') || 0), end = offset + 100
    if (q === '作品 99') await delayed
    await route.fulfill({ json: { items: matches.slice(offset, end), nextCursor: end < matches.length ? String(end) : null } })
  })
  await page.goto('/library')
  const search = page.getByRole('searchbox', { name: '搜索我的作品' })
  const cards = page.locator('.library-grid .work-title')
  await expect(cards).toHaveCount(100)
  return { search, cards, releaseSlow }
}

test('mine and saved search beyond the loaded page and paginate inside the active search', async ({ page }) => {
  const { search, cards } = await library(page)
  const count = page.locator('.library-toolbar').getByRole('status')
  await expect(search).toHaveAttribute('maxlength', '200')
  await expect(count).toHaveText('已显示 100 件作品')
  await search.fill('远山')
  await expect(cards).toHaveText(['作品 101', '作品 102', '作品 103'])
  await page.getByRole('link', { name: '我的收藏', exact: true }).click()
  await expect(cards).toHaveText(['作品 101', '作品 102'])
  await search.fill('分页')
  await expect(cards).toHaveCount(100)
  const next = page.waitForRequest(request => {
    const url = new URL(request.url())
    return url.pathname === '/api/library' && url.searchParams.get('cursor') === '100'
      && url.searchParams.get('q') === '分页' && url.searchParams.get('status') === 'saved'
  })
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await next
  await expect(cards).toHaveCount(102)
  await expect(count).toHaveText('102 件收藏')
  await search.fill('没有这件作品')
  await expect(page.getByRole('heading', { name: '没有匹配的作品' })).toBeVisible()
  await expect(count).toHaveText('0 件收藏')
  await search.fill('列表出错')
  await expect(page.getByRole('alert')).toContainText('作品暂不可用')
  await expect(count).toHaveCount(0)
  await page.getByRole('button', { name: '清空搜索', exact: true }).first().click()
  await expect(cards).toHaveCount(100)
  await expect(page.getByRole('button', { name: '加载更多', exact: true })).toBeVisible()
})

test('a delayed previous search cannot overwrite the current library results', async ({ page }) => {
  const { search, cards, releaseSlow } = await library(page)
  const slow = page.waitForRequest(request => new URL(request.url()).searchParams.get('q') === '作品 99')
  await search.fill('作品 99')
  await slow
  try {
    await expect(page.locator('.library-toolbar').getByRole('status')).toHaveCount(0)
    await search.fill('作品 101')
    await expect(cards).toHaveText(['作品 101'])
  } finally { releaseSlow() }
  await page.waitForLoadState('networkidle')
  await expect(cards).toHaveText(['作品 101'])
})
