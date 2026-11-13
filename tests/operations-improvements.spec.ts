import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

const nav = (page: Page) => page.getByRole('navigation', { name: '管理分类', exact: true })
const pendingWork = { id: 'olderwork', title: '更早提交的待审作品', author: '创作者', kind: 'resource', status: 'published', revisionPending: true, version: 1, date: '2026-11-01T00:00:00Z', cover: '' }
async function operationsFixture(page: Page) {
  const account = await mockUnifiedAccount(page, true); account.state.user.isAdmin = true
  const requests: URL[] = [], writes: { path: string; body: any }[] = []
  const state = { failLogs: false, emptyLogs: false }
  await page.route('**/api/admin/**', route => {
    const request = route.request(), url = new URL(request.url()); requests.push(url)
    if (request.method() !== 'GET') { writes.push({ path: url.pathname, body: request.postDataJSON() }); return route.fulfill({ json: { ok: true } }) }
    if (url.pathname.endsWith('/overview')) return route.fulfill({ json: { counts: { pending: 135, published: 3240, rejected: 48, reports: 6 },
      period: { days: Number(url.searchParams.get('days')), newWorks: url.searchParams.get('days') === '30' ? 860 : 215, newUsers: 38 }, updatedAt: '2026-11-13T10:00:00Z' } })
    if (url.pathname.endsWith('/submissions')) return route.fulfill({ json: { items: [pendingWork], nextCursor: null } })
    if (url.pathname.endsWith('/reports')) return route.fulfill({ json: { items: [1, 2].map(n => ({ id: `report${n}`, targetUserId: 'target', targetUsername: 'target', reporterUsername: 'reporter', resolved: false, moderationNote: '', comment: `举报内容 ${n}` })), nextCursor: null } })
    if (url.pathname.endsWith('/logs')) {
      if (state.failLogs) return route.fulfill({ status: 503, json: { message: '日志加载失败' } })
      return route.fulfill({ json: { items: state.emptyLogs ? [] : [{ id: url.searchParams.has('cursor') ? 'olderlog' : 'latestlog', label: url.searchParams.has('cursor') ? '更早审核' : '作品审核', date: '2026-11-13T03:00:00Z',
        actor: { id: 'admin', name: '审核管理员', username: 'operator' }, details: [{ label: '结果', value: '通过' }, { label: '说明', value: '已核对来源和作品内容。' }], target: { label: '查看作品', to: '/work/olderwork' } }],
        nextCursor: state.emptyLogs || url.searchParams.has('cursor') ? null : 'latestlog', types: [{ value: 'communityReview', label: '作品审核' }] } })
    }
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  return { account, requests, writes, state }
}

test('editor Escape, close, history navigation and refresh protect unsaved input; explicit discard clears it', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  await page.goto('/discover'); await page.getByRole('link', { name: '投稿', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '发布作品', exact: true })
  await editor.getByLabel('作品标题').fill('保留我的标题')
  await editor.getByLabel('生成提示词').fill('保留完整提示词')
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(editor.getByLabel('生成提示词')).toHaveValue('保留完整提示词')
  await page.goBack()
  await expect(page.getByRole('dialog', { name: '保留作品修改？' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/publish=1/)
  await expect(editor.getByLabel('作品标题')).toHaveValue('保留我的标题')
  await editor.getByRole('button', { name: '关闭作品编辑' }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await page.getByRole('link', { name: '投稿', exact: true }).click()
  await expect(editor.getByLabel('作品标题')).toHaveValue('')
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
})

test('successful draft save leaves without a second warning; a failed save preserves input', async ({ page }) => {
  await mockUnifiedAccount(page, true)
  let fail = true
  await page.route('**/api/works', route => route.request().method() === 'POST'
    ? route.fulfill(fail ? { status: 503, json: { message: '保存失败，请重试' } } : { json: { work: { id: 'saved', status: 'draft' } } }) : route.fallback())
  await page.goto('/discover?publish=1')
  const editor = page.getByRole('dialog', { name: '发布作品', exact: true })
  await editor.getByLabel('作品类型').selectOption('resource')
  await editor.getByLabel('作品标题').fill('资源草稿')
  await editor.getByLabel('资源内容').fill('资源正文')
  await editor.getByRole('button', { name: '存为草稿', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('保存失败')
  await expect(editor.getByLabel('资源内容')).toHaveValue('资源正文')
  fail = false
  await editor.getByRole('button', { name: '存为草稿', exact: true }).click()
  await expect(page).toHaveURL('/library?tab=draft')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('switching accounts clears the editor and ignores a late save response', async ({ page }) => {
  const account = await mockUnifiedAccount(page, true)
  let release!: () => void, started = false
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/works', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    started = true; await held; await route.fulfill({ json: { work: { id: 'oldusersaved', status: 'draft' } } })
  })
  try {
    await page.goto('/discover?publish=1')
    await page.getByRole('dialog', { name: '发布作品', exact: true }).getByLabel('作品类型').selectOption('resource'); await page.getByLabel('作品标题').fill('旧账号作品'); await page.getByLabel('资源内容').fill('旧账号正文')
    await page.getByRole('button', { name: '存为草稿', exact: true }).click(); await expect.poll(() => started).toBe(true)
    account.state.user.id = 'newaccount'; account.state.user.name = '新账号'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('dialog', { name: '发布作品', exact: true })).not.toBeVisible()
    const response = page.waitForResponse(r => r.url().endsWith('/api/works') && r.request().method() === 'POST')
    release(); await response
    await expect(page).toHaveURL('/discover')
    await page.getByRole('link', { name: '投稿', exact: true }).click()
    await expect(page.getByLabel('作品标题')).toHaveValue('')
    await expect(page.getByRole('button', { name: '存为草稿', exact: true })).toBeEnabled()
  } finally { release() }
})

test('saving from a dirty admin panel closes the saved editor even if the next navigation is cancelled', async ({ page }) => {
  const f = await operationsFixture(page)
  await page.route('**/api/admin/settings', route => route.fulfill({ json: { settings: { brand: '原社区', logoUrl: '' }, version: 'version-1' } }))
  let saves = 0
  await page.route('**/api/works', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    saves++; return route.fulfill({ json: { work: { id: 'saved', status: 'draft' } } })
  })
  await page.goto('/admin?tab=site')
  await page.getByLabel('站点名称', { exact: true }).fill('未保存社区名')
  await page.getByRole('link', { name: '发布作品', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '发布作品', exact: true })
  await expect(editor).toBeVisible()
  await editor.getByLabel('作品类型').selectOption('resource'); await editor.getByLabel('作品标题').fill('从管理页创建'); await editor.getByLabel('资源内容').fill('草稿正文')
  await editor.getByRole('button', { name: '存为草稿', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page).toHaveURL('/admin?tab=site')
  await expect(editor).not.toBeVisible()
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('未保存社区名')
  expect(saves).toBe(1); expect(f.writes).toHaveLength(0)
})

test('report notes survive cancelled navigation, refresh, report switching and filter changes; save submits once', async ({ page }) => {
  const f = await operationsFixture(page)
  await page.goto('/admin?tab=reports')
  await page.getByRole('button', { name: '处理举报', exact: true }).first().click()
  await page.getByLabel('处理说明', { exact: true }).fill('尚未提交的核对结论')
  for (const action of [
    () => nav(page).getByRole('button', { name: '管理概览', exact: true }).click(),
    () => page.getByRole('button', { name: '刷新举报列表' }).click(),
    () => page.getByRole('button', { name: '处理举报', exact: true }).click(),
    () => page.locator('.people-filters select').selectOption('resolved'),
    () => page.getByRole('button', { name: '取消', exact: true }).click(),
  ]) {
    await action(); await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(page.getByLabel('处理说明', { exact: true })).toHaveValue('尚未提交的核对结论')
    await expect(page.locator('.people-filters select')).toHaveValue('open')
  }
  expect(f.writes).toHaveLength(0)
  await page.getByRole('button', { name: '确认处理', exact: true }).click()
  await expect(page.getByLabel('处理说明', { exact: true })).toHaveCount(0)
  expect(f.writes).toEqual([{ path: '/api/admin/reports/report1', body: { resolvedAs: 'accept', moderationNote: '尚未提交的核对结论' } }])
})

test('overview shows complete totals, period switches and a directly queried pending queue', async ({ page }) => {
  const f = await operationsFixture(page)
  await page.goto('/admin')
  await expect(page.locator('.overview-metric').filter({ hasText: '待审核' })).toContainText('135')
  await expect(page.locator('.overview-metric').filter({ hasText: '已公开' })).toContainText('3,240')
  await expect(page.locator('.overview-queue')).toContainText('更早提交的待审作品')
  const queue = f.requests.find(url => url.pathname.endsWith('/submissions'))!
  expect(queue.searchParams.get('status')).toBe('pending'); expect(queue.searchParams.get('limit')).toBe('5')
  await page.getByRole('button', { name: '近 30 天', exact: true }).click()
  await expect(page.locator('.overview-period')).toContainText('860')
  await expect(page.getByRole('button', { name: '近 30 天', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await nav(page).getByRole('button', { name: '操作日志', exact: true }).click()
  await expect(page.locator('.log-list')).toBeVisible()
})

test('log filters apply as a group, pagination retains them, and failures can be retried', async ({ page }) => {
  const f = await operationsFixture(page)
  await page.goto('/admin?tab=logs'); await expect(page.locator('.log-list > li')).toHaveCount(1)
  await page.getByLabel('操作类型').selectOption('communityReview'); await page.getByLabel('操作人').fill('operator')
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  await expect.poll(() => f.requests.at(-1)!.searchParams.get('actor')).toBe('operator')
  await page.getByLabel('操作人').fill('未提交筛选')
  await page.getByRole('button', { name: '加载更早记录', exact: true }).click()
  await expect(page.locator('.log-list > li')).toHaveCount(2)
  expect(f.requests.at(-1)!.searchParams.get('actor')).toBe('operator')
  expect(f.requests.at(-1)!.searchParams.get('cursor')).toBe('latestlog')
  f.state.failLogs = true
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('日志加载失败')
  f.state.failLogs = false; f.state.emptyLogs = true
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('heading', { name: '没有匹配的操作记录' })).toBeVisible()
})

test('moderators cannot enter logs or see user aggregates even through a privileged deep link', async ({ page }) => {
  const f = await operationsFixture(page)
  f.account.state.user.isAdmin = false; f.account.state.user.isModerator = true
  await page.goto('/admin?tab=logs')
  await expect(page.getByRole('heading', { name: '管理概览', exact: true })).toBeVisible()
  await expect(page.getByText('新增本地用户', { exact: true })).toHaveCount(0)
  await expect(nav(page).getByRole('button', { name: '操作日志', exact: true })).toHaveCount(0)
  expect(f.requests.some(url => url.pathname.endsWith('/logs'))).toBe(false)
})

test('operation logs fit desktop and small phones with accessible controls', async ({ page }) => {
  await operationsFixture(page); await mkdir('.impeccable/review/operations', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto('/admin?tab=logs')
    await expect(page.locator('.log-list')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.impeccable/review/operations/logs-${width}.png`, fullPage: true })
    const result = await new AxeBuilder({ page }).include('.admin-page').analyze()
    expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
  }
})
