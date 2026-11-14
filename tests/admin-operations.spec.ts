import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const shots = '.taste-skill/admin-complete-20261114/shots'
interface Announcement { id: string; title: string; text: string; isActive: boolean; updatedAt: string; version: string }
interface RoleUser { id: string; accountId?: string; username: string; name: string; roleIds: string[]; version: string; isRoot: boolean; isSelf: boolean; isProtected: boolean; canEdit: boolean }
type Mutation = { path: string; body: Record<string, unknown>; csrf?: string; account?: string }
const version = (index: number) => index.toString(16).padStart(64, '0')

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '3'; account.state.user.accountId = '3'; account.state.user.username = 'admin'; account.state.user.isAdmin = true
  const state = {
    user: account.state.user,
    announcements: [
      { id: 'announcement1', title: '社区创作维护安排', text: '今晚更新创作服务，已发布作品仍可正常浏览。', isActive: true, updatedAt: '2026-11-14T08:00:00Z', version: version(1) },
      { id: 'announcement2', title: '旧活动说明', text: '旧活动已结束。', isActive: false, updatedAt: '2026-11-13T08:00:00Z', version: version(2) },
    ] as Announcement[],
    users: [
      { id: '1', username: 'root', name: '根账号', roleIds: ['admin-role'], version: version(11), isRoot: true, isSelf: false, isProtected: true, canEdit: false },
      { id: '3', username: 'admin', name: '当前管理员', roleIds: ['admin-role'], version: version(12), isRoot: false, isSelf: true, isProtected: true, canEdit: false },
      { id: '42', accountId: '42', username: 'ocean', name: '海洋创作者', roleIds: [], version: version(13), isRoot: false, isSelf: false, isProtected: false, canEdit: true },
      { id: '7', username: 'river', name: '河流创作者', roleIds: ['moderator-role'], version: version(14), isRoot: false, isSelf: false, isProtected: false, canEdit: true },
    ] as RoleUser[],
    failAnnouncement: 0, failRoles: 0, failAudit: false, unsafeAudit: false, canAssign: true, serial: 20,
  }
  const roles = [
    { id: 'admin-role', name: '现有管理员', isAdmin: true, isModerator: false },
    { id: 'moderator-role', name: '现有审核员', isAdmin: false, isModerator: true },
  ]
  const audit = [
    { id: 'audit1', date: '2026-11-14T08:00:00Z', type: 'updateAnnouncement', label: '修改公告', actor: { id: 'legacy-admin-id', accountId: '3', username: 'admin', name: '当前管理员' }, details: { announcementId: 'announcement1', fields: ['title', 'text'] } },
    { id: 'audit2', date: '2026-11-14T07:30:00Z', type: 'updateCommunityRoles', label: '调整管理授权', actor: { id: '1', username: 'root', name: '根账号' }, details: { userId: '42', before: [], after: ['moderatorrole'] } },
  ]
  const reads: URL[] = [], mutations: Mutation[] = []
  await page.route('**/api/admin/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() === 'GET') reads.push(url)
    else mutations.push({ path, body: request.postDataJSON() || {}, csrf: request.headers()['x-csrf-token'], account: request.headers()['x-new-api-user'] })
    if (path === '/api/admin/overview') return route.fulfill({ json: {
      counts: { pending: 0, published: 0, rejected: 0, reports: 0 },
      period: { days: 7, newWorks: 0, newUsers: 0 }, updatedAt: '2026-11-14T08:00:00Z',
    } })
    if (path === '/api/admin/announcements' && request.method() === 'GET') {
      const query = url.searchParams.get('query') || '', status = url.searchParams.get('status') || 'all'
      const rows = state.announcements.filter(item => (!query || `${item.title} ${item.text}`.includes(query)) && (status === 'all' || item.isActive === (status === 'active')))
      const cursor = Number(url.searchParams.get('cursor') || 0)
      return route.fulfill({ json: { items: rows.slice(cursor, cursor + 1), nextCursor: rows.length > cursor + 1 ? String(cursor + 1) : null } })
    }
    if (path === '/api/admin/announcements' && request.method() === 'POST') {
      const body = request.postDataJSON()
      const announcement = { id: `announcement${++state.serial}`, title: body.title, text: body.text, isActive: true, updatedAt: '2026-11-14T08:00:00Z', version: version(state.serial) }
      state.announcements.unshift(announcement)
      return route.fulfill({ json: { id: announcement.id, announcement } })
    }
    if (path.startsWith('/api/admin/announcements/') && request.method() === 'PATCH') {
      const announcement = state.announcements.find(item => item.id === path.split('/').pop())!, body = request.postDataJSON()
      if (state.failAnnouncement) return route.fulfill({ status: state.failAnnouncement, json: { message: state.failAnnouncement === 409 ? '公告已经更新，请刷新后重试。' : '公告暂时无法保存，请稍后重试。' } })
      if (body.version !== announcement.version) return route.fulfill({ status: 409, json: { message: '公告版本已变化。' } })
      Object.assign(announcement, body, { version: version(++state.serial) })
      return route.fulfill({ json: { announcement } })
    }
    if (path === '/api/admin/audit') {
      if (state.failAudit) return route.fulfill({ status: 503, json: { message: '审计日志暂时无法读取。' } })
      const query = url.searchParams.get('query') || '', type = url.searchParams.get('type') || ''
      const rows = audit.filter(item => (!type || item.type === type) && (!query || JSON.stringify(item).includes(query)))
      const cursor = Number(url.searchParams.get('cursor') || 0)
      const items = rows.slice(cursor, cursor + 1).map(item => state.unsafeAudit ? { ...item, details: { ...item.details, unexpected: '<img src=x onerror=alert(1)>' } } : item)
      return route.fulfill({ json: { items, nextCursor: rows.length > cursor + 1 ? String(cursor + 1) : null, typeOptions: [{ value: 'updateAnnouncement', label: '修改公告' }, { value: 'updateCommunityRoles', label: '调整管理授权' }] } })
    }
    if (path === '/api/admin/roles') {
      const query = url.searchParams.get('query') || '', cursor = Number(url.searchParams.get('cursor') || 0)
      const rows = state.users.filter(item => !query || `${item.id} ${item.username} ${item.name}`.includes(query))
      return route.fulfill({ json: { roles: state.canAssign ? roles : [], items: rows.slice(cursor, cursor + 3), nextCursor: rows.length > cursor + 3 ? String(cursor + 3) : null, canAssign: state.canAssign, message: state.canAssign ? '' : '尚未配置可手动分配的管理角色。' } })
    }
    if (/\/api\/admin\/users\/[^/]+\/roles$/.test(path)) {
      const user = state.users.find(item => item.id === path.split('/')[4])!, body = request.postDataJSON()
      if (state.failRoles) return route.fulfill({ status: state.failRoles, json: { message: state.failRoles === 409 ? '授权已被其他管理员修改，请刷新。' : '没有权限修改此账号的授权。' } })
      if (!user.canEdit || body.version !== user.version) return route.fulfill({ status: 409, json: { message: '授权版本已变化或账号受保护。' } })
      user.roleIds = [...body.roleIds]; user.version = version(++state.serial)
      return route.fulfill({ json: { user } })
    }
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  return { ...account, state, reads, mutations }
}

async function openView(page: Page, label: '公告管理' | '操作审计' | '管理授权') {
  const tab = { 公告管理: 'announcements', 操作审计: 'audit', 管理授权: 'roles' }[label]
  await page.goto(`/admin?tab=${tab}`)
  await expect(page.getByRole('region', { name: label, exact: true })).toBeVisible()
}
async function capture(page: Page, name: string) {
  await mkdir(shots, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${shots}/${name}-${width}.png`, fullPage: true })
  }
}

test('announcements support filters, pagination, creation, editing and confirmed status changes', async ({ page }) => {
  const fixtureState = await fixture(page)
  const errors: string[] = []
  page.on('pageerror', cause => errors.push(cause.message))
  await openView(page, '公告管理')
  const section = page.getByRole('region', { name: '公告管理', exact: true })
  await expect(section.locator('tbody tr')).toHaveCount(1)
  await section.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(section.locator('tbody tr')).toHaveCount(2)
  await capture(page, 'announcements')
  await page.getByRole('combobox', { name: '公告状态', exact: true }).selectOption('inactive')
  await expect(section.locator('tbody tr')).toHaveCount(1)
  await expect(section.locator('tbody tr')).toContainText('旧活动说明')
  await section.getByRole('button', { name: '发布公告', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '发布公告', exact: true })
  await editor.getByRole('textbox', { name: '公告标题', exact: true }).fill('新的社区公告')
  await editor.getByRole('textbox', { name: '公告正文', exact: true }).fill('请查看新的创作安排。')
  await editor.getByRole('button', { name: '确认发布', exact: true }).click()
  await expect(editor).not.toBeVisible()
  expect(fixtureState.mutations.find(item => item.path === '/api/admin/announcements')?.body).toEqual({ title: '新的社区公告', text: '请查看新的创作安排。' })
  await page.getByRole('combobox', { name: '公告状态', exact: true }).selectOption('all')
  await section.getByRole('button', { name: '编辑公告：新的社区公告', exact: true }).click()
  const edit = page.getByRole('dialog', { name: '编辑公告', exact: true })
  await edit.getByRole('textbox', { name: '公告标题', exact: true }).fill('更新后的社区公告')
  await edit.getByRole('button', { name: '保存公告', exact: true }).click()
  await expect(edit).not.toBeVisible()
  const row = section.locator('tbody tr').filter({ hasText: '更新后的社区公告' })
  await row.getByRole('button', { name: '停用公告：更新后的社区公告', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '停用公告', exact: true })
  expect(fixtureState.state.announcements[0]!.isActive).toBe(true)
  await confirmation.getByRole('button', { name: '确认停用', exact: true }).click()
  await expect(confirmation).not.toBeVisible()
  await expect(row).toContainText('已停用')
  await row.getByRole('button', { name: '启用公告：更新后的社区公告', exact: true }).click()
  await page.getByRole('dialog', { name: '启用公告', exact: true }).getByRole('button', { name: '确认启用', exact: true }).click()
  await expect(row).toContainText('已启用')
  expect(fixtureState.mutations.at(-1)?.body).toEqual({ isActive: true, version: expect.any(String) })
  expect(fixtureState.mutations.every(item => item.csrf === 'unified-account-fixture' && item.account === '3')).toBe(true)
  expect(errors).toEqual([])
})

test('announcement failures preserve edits and conflicts never overwrite a different or newer record', async ({ page }) => {
  const fixtureState = await fixture(page)
  await openView(page, '公告管理')
  await page.getByRole('button', { name: '编辑公告：社区创作维护安排', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑公告', exact: true })
  const title = dialog.getByRole('textbox', { name: '公告标题', exact: true })
  await title.fill('未保存的管理员修改')
  const sessionRefresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await sessionRefresh
  await expect(dialog).toBeVisible()
  await expect(title).toHaveValue('未保存的管理员修改')
  fixtureState.state.failAnnouncement = 503
  await dialog.getByRole('button', { name: '保存公告', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('暂时无法保存')
  await expect(title).toHaveValue('未保存的管理员修改')
  fixtureState.state.failAnnouncement = 409
  fixtureState.state.announcements[0]!.title = '其他管理员的新标题'
  fixtureState.state.announcements[0]!.version = version(200)
  await dialog.getByRole('button', { name: '保存公告', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('已经更新')
  await expect(title).toHaveValue('未保存的管理员修改')
  await expect(dialog.getByRole('button', { name: '保存公告', exact: true })).toBeDisabled()
  expect(fixtureState.mutations.map(item => item.path)).toEqual(['/api/admin/announcements/announcement1', '/api/admin/announcements/announcement1'])
  expect(fixtureState.mutations.every(item => item.body.version === version(1))).toBe(true)
  expect(fixtureState.state.announcements[1]!.title).toBe('旧活动说明')
  expect(fixtureState.state.announcements[0]!.title).toBe('其他管理员的新标题')
})

test('pagination keeps applied filters when a new search is only drafted or fails', async ({ page }) => {
  const fixtureState = await fixture(page)
  for (const entry of [
    { label: '公告管理', path: '/api/admin/announcements', field: '搜索公告', query: '旧活动', expected: '旧活动说明', initialRows: 1, allRows: 2 },
    { label: '操作审计', path: '/api/admin/audit', field: '搜索审计日志', query: 'root', expected: 'root', initialRows: 1, allRows: 2 },
    { label: '管理授权', path: '/api/admin/roles', field: '搜索账号', query: 'river', expected: 'river', initialRows: 3, allRows: 4 },
  ] as const) {
    await openView(page, entry.label)
    const section = page.getByRole('region', { name: entry.label, exact: true })
    await expect(section.locator('tbody tr')).toHaveCount(entry.initialRows)
    await page.getByRole('searchbox', { name: entry.field, exact: true }).fill(entry.query)
    if (entry.label === '操作审计') {
      fixtureState.state.failAudit = true
      await section.getByRole('button', { name: '搜索', exact: true }).click()
      await expect(section.getByRole('alert')).toContainText('暂时无法读取')
      fixtureState.state.failAudit = false
    }
    await section.getByRole('button', { name: '加载更多', exact: true }).click()
    await expect(section.locator('tbody tr')).toHaveCount(entry.allRows)
    const appendedRead = fixtureState.reads.filter(url => url.pathname === entry.path).at(-1)!
    expect(appendedRead.searchParams.get('query')).toBeNull()
    expect(appendedRead.searchParams.get('cursor')).toBe(String(entry.initialRows))
    await section.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(section.locator('tbody tr')).toHaveCount(1)
    await expect(section.locator('tbody tr')).toContainText(entry.expected)
    const searchedRead = fixtureState.reads.filter(url => url.pathname === entry.path).at(-1)!
    expect(searchedRead.searchParams.get('query')).toBe(entry.query)
    expect(searchedRead.searchParams.get('cursor')).toBeNull()
  }
})

test('audit logs filter and paginate safe details, recover from failures and never mutate records', async ({ page }) => {
  const fixtureState = await fixture(page)
  await openView(page, '操作审计')
  const section = page.getByRole('region', { name: '操作审计', exact: true })
  await section.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect(section.locator('tbody tr')).toHaveCount(2)
  await section.getByText('查看详情', { exact: true }).first().click()
  await expect(section.locator('pre').first()).toHaveText(JSON.stringify({ announcementId: 'announcement1', fields: ['title', 'text'] }, null, 2))
  await expect(section.locator('tbody')).toContainText('账号ID:3')
  await capture(page, 'audit')
  fixtureState.state.unsafeAudit = true
  await page.getByRole('combobox', { name: '操作类型', exact: true }).selectOption('updateCommunityRoles')
  await expect(section.locator('tbody tr')).toHaveCount(1)
  await section.getByText('查看详情', { exact: true }).click()
  await expect(section.locator('pre')).toContainText('<img src=x onerror=alert(1)>')
  await expect(section.locator('pre img')).toHaveCount(0)
  fixtureState.state.failAudit = true
  await section.getByRole('button', { name: '刷新操作审计', exact: true }).click()
  await expect(section.getByRole('alert')).toContainText('暂时无法读取')
  await expect(section.locator('tbody tr')).toHaveCount(1)
  fixtureState.state.failAudit = false
  await page.getByRole('searchbox', { name: '搜索审计日志', exact: true }).fill('不存在的日志')
  await section.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(section.getByRole('heading', { name: '没有符合条件的审计日志', exact: true })).toBeVisible()
  expect(fixtureState.reads.at(-1)?.searchParams.get('query')).toBe('不存在的日志')
  expect(fixtureState.reads.at(-1)?.searchParams.get('type')).toBe('updateCommunityRoles')
  expect(fixtureState.mutations).toHaveLength(0)
})

test('management roles support account search, current assignments, confirmed grants and revocation while protecting root and self', async ({ page }) => {
  const fixtureState = await fixture(page)
  await openView(page, '管理授权')
  const section = page.getByRole('region', { name: '管理授权', exact: true })
  await expect(section.getByRole('button', { name: '管理授权：root', exact: true })).toBeDisabled()
  await expect(section.getByRole('button', { name: '管理授权：admin', exact: true })).toBeDisabled()
  await capture(page, 'roles')
  await page.getByRole('searchbox', { name: '搜索账号', exact: true }).fill('ocean')
  await section.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(section.locator('tbody tr')).toHaveCount(1)
  await expect(section.locator('tbody tr')).toContainText('无管理角色')
  await section.getByRole('button', { name: '管理授权：ocean', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '管理授权', exact: true })
  await dialog.getByRole('checkbox', { name: '现有审核员 审核员权限', exact: true }).check()
  await expect(dialog.getByLabel('授权变更', { exact: true })).toContainText('将授予：现有审核员')
  expect(fixtureState.mutations).toHaveLength(0)
  await dialog.getByRole('button', { name: '确认保存授权', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(fixtureState.mutations[0]).toMatchObject({ path: '/api/admin/users/42/roles', body: { roleIds: ['moderator-role'], version: version(13) }, account: '3' })
  await expect(section.locator('tbody tr')).toContainText('现有审核员')
  await section.getByRole('button', { name: '管理授权：ocean', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: '现有审核员 审核员权限', exact: true })).toBeChecked()
  await dialog.getByRole('checkbox', { name: '现有审核员 审核员权限', exact: true }).uncheck()
  await expect(dialog.getByLabel('授权变更', { exact: true })).toContainText('将撤销：现有审核员')
  await dialog.getByRole('button', { name: '确认保存授权', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(fixtureState.mutations[1]?.body).toEqual({ roleIds: [], version: version(21) })
  expect(fixtureState.state.users.find(user => user.id === '42')!.roleIds).toEqual([])
  expect(fixtureState.mutations.some(item => /\/(?:1|3)\/roles$/.test(item.path))).toBe(false)
})

test('authorization rejections retain the selected account and role choices and do not mark a change as successful', async ({ page }) => {
  const fixtureState = await fixture(page)
  fixtureState.state.users.find(user => user.username === 'ocean')!.id = 'legacy-ocean'
  await openView(page, '管理授权')
  await page.getByRole('button', { name: '管理授权：ocean', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '管理授权', exact: true })
  const checkbox = dialog.getByRole('checkbox', { name: '现有审核员 审核员权限', exact: true })
  await checkbox.check()
  fixtureState.state.failRoles = 403
  await dialog.getByRole('button', { name: '确认保存授权', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('没有权限')
  await expect(dialog).toContainText('账号ID:42')
  await expect(checkbox).toBeChecked()
  fixtureState.state.failRoles = 409
  await dialog.getByRole('button', { name: '确认保存授权', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('其他管理员')
  await expect(dialog.getByRole('button', { name: '确认保存授权', exact: true })).toBeDisabled()
  await expect(checkbox).toBeChecked()
  expect(fixtureState.state.users.find(user => user.id === 'legacy-ocean')!.roleIds).toEqual([])
  expect(fixtureState.mutations.every(item => item.path === '/api/admin/users/legacy-ocean/roles' && item.body.version === version(13))).toBe(true)
})

test('ordinary members and moderators do not expose operations pages, and missing manual roles disable changes', async ({ page }) => {
  const fixtureState = await fixture(page)
  fixtureState.state.canAssign = false
  await openView(page, '管理授权')
  const section = page.getByRole('region', { name: '管理授权', exact: true })
  await expect(section.getByRole('status')).toContainText('尚未配置')
  await expect(section.getByRole('button', { name: '管理授权：ocean', exact: true })).toBeDisabled()
  const existingReads = fixtureState.reads.length
  fixtureState.state.user.isAdmin = false
  fixtureState.state.user.isModerator = true
  await page.reload()
  const navigation = page.getByRole('navigation', { name: '管理分类', exact: true })
  await expect(navigation.getByRole('button', { name: '公告管理', exact: true })).toHaveCount(0)
  await expect(navigation.getByRole('button', { name: '操作审计', exact: true })).toHaveCount(0)
  await expect(navigation.getByRole('button', { name: '管理授权', exact: true })).toHaveCount(0)
  expect(fixtureState.reads.slice(existingReads).some(url => ['/api/admin/announcements', '/api/admin/audit', '/api/admin/roles'].includes(url.pathname))).toBe(false)
  fixtureState.state.user.isModerator = false
  await page.reload()
  await expect(page.getByRole('heading', { name: '需要审核员权限', exact: true })).toBeVisible()
  expect(fixtureState.mutations).toHaveLength(0)
})
