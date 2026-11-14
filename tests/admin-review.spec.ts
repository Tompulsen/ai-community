import { expect, test } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

test('review queries older submissions on the server, paginates and keeps the global pending count', async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.isAdmin = true
  account.state.user.isModerator = true
  const reads: URLSearchParams[] = []
  const base = { authorId: '42', author: '创作者', avatar: '创', kind: 'resource', tags: [], cover: '',
    likes: 0, date: '2026-11-14T00:00:00Z', status: 'pending', version: 2, body: '作品内容',
    prompt: '', model: '', owned: false, fileIds: [] }
  await page.route('**/api/admin/submissions?*', async route => {
    const params = new URL(route.request().url()).searchParams
    reads.push(params)
    if (params.get('query')) return route.fulfill({ json: {
      items: [{ ...base, id: 'oldest', title: '最早待审核作品' }], nextCursor: null, pendingCount: 101,
    } })
    if (params.get('status') === 'all') return route.fulfill({ json: {
      items: [{ ...base, id: 'published', title: '已公开内容', status: 'published' }], nextCursor: null, pendingCount: 101,
    } })
    return route.fulfill({ json: {
      items: [{ ...base, id: params.has('cursor') ? 'second' : 'first', title: params.has('cursor') ? '第二页待审核作品' : '第一页待审核作品' }],
      nextCursor: params.has('cursor') ? null : 'page2', pendingCount: 101,
    } })
  })
  await page.goto('/admin?tab=review')
  await expect(page.getByRole('status').filter({ hasText: '101 件待审核' })).toBeVisible()
  await expect(page.getByRole('link', { name: '第一页待审核作品', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '加载更多作品', exact: true }).click()
  await expect(page.getByRole('link', { name: '第二页待审核作品', exact: true })).toBeVisible()
  expect(reads.some(params => params.get('cursor') === 'page2' && params.get('status') === 'pending')).toBe(true)
  await page.getByLabel('搜索作品或作者', { exact: true }).fill('最早')
  await expect(page.getByRole('link', { name: '最早待审核作品', exact: true })).toBeVisible()
  expect(reads.find(params => params.get('query') === '最早')?.has('cursor')).toBe(false)
  await expect(page.getByRole('link', { name: '第二页待审核作品', exact: true })).toHaveCount(0)
  await page.getByLabel('搜索作品或作者', { exact: true }).fill('')
  await page.getByRole('button', { name: '全部内容', exact: true }).click()
  await expect(page.getByRole('link', { name: '已公开内容', exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '101 件待审核' })).toBeVisible()
  expect(reads.at(-1)?.get('status')).toBe('all')
  expect(reads.at(-1)?.has('cursor')).toBe(false)
})

test('a failed review page can be retried and an ordinary member makes no privileged reads', async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.isModerator = true
  let broken = true
  const requests: string[] = []
  await page.route('**/api/admin/submissions?*', route => {
    requests.push(route.request().url())
    return broken ? route.fulfill({ status: 503, json: { error: { message: '审核列表暂不可用' } } })
      : route.fulfill({ json: { items: [], nextCursor: null, pendingCount: 0 } })
  })
  await page.goto('/admin?tab=review')
  await expect(page.getByRole('alert')).toContainText('审核列表暂不可用')
  broken = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('heading', { name: '当前状态下暂无作品' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '管理分类' }).getByRole('button', { name: '操作审计' })).toHaveCount(0)
  account.state.user.isModerator = false
  const previous = requests.length
  await page.reload()
  await expect(page.getByRole('heading', { name: '需要审核员权限' })).toBeVisible()
  expect(requests).toHaveLength(previous)
})

test('an old review failure cannot update another administrator session', async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  Object.assign(account.state.user, { id: '17', accountId: '17', isAdmin: true, isModerator: true })
  let release!: () => void, started!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const sent = new Promise<void>(resolve => { started = resolve })
  await page.route('**/api/admin/submissions?*', route => route.fulfill({ json: {
    items: [{ id: 'work1', authorId: '42', author: '作者', avatar: '作', kind: 'resource',
      title: `账号 ${account.state.user.id} 审核作品`, status: 'pending', date: '2026-11-14',
      version: 1, fileIds: [], tags: [], cover: '', prompt: '', model: '', likes: 0, owned: false }],
    nextCursor: null, pendingCount: 1,
  } }))
  await page.route('**/api/admin/submissions/work1/review', async route => {
    started(); await held
    await route.fulfill({ status: 503, json: { error: { message: '旧账号的审核失败' } } })
  })
  try {
    await page.goto('/admin?tab=review')
    await page.getByRole('button', { name: '通过：账号 17 审核作品', exact: true }).click()
    await page.getByRole('button', { name: '确认', exact: true }).click()
    await sent
    Object.assign(account.state.user, { id: '18', accountId: '18', username: 'other-admin' })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('link', { name: '账号 18 审核作品', exact: true })).toBeVisible()
    const completed = page.waitForResponse(response => response.url().endsWith('/api/admin/submissions/work1/review'))
    release(); await (await completed).finished()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(page.getByText('旧账号的审核失败', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '通过：账号 18 审核作品', exact: true })).toBeEnabled()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  } finally { release() }
})
