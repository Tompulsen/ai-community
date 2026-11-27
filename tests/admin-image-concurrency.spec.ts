import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { ImageConcurrencyUserFilters, ImageConcurrencyUsersPatch } from '../shared/studio/image-concurrency'

const endpoint = '/api/admin/creation/image-concurrency'
const allFilters: ImageConcurrencyUserFilters = { query: '', status: 'all', mode: 'all' }

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.isAdmin = true
  const users = Array.from({ length: 35 }, (_, index) => ({
    id: index === 0 ? '17' : index === 1 ? 'protected' : `u${index + 1}`,
    accountId: index === 0 ? 'account-first' : `external-${index + 1}`,
    name: index === 0 ? '木白' : index === 1 ? '受保护管理员' : `用户${String(index + 1).padStart(3, '0')}`,
    username: index === 0 ? 'creator' : `member${index + 1}`,
    isSuspended: index % 7 === 6,
  }))
  const state = { defaultLimit: 2, globalLimit: 10, version: 'limits-1', overrides: { u3: 3, u4: 5 } as Record<string, number>, conflict: false, failRead: false, failList: false, failWrite: false }
  const userVersions: Record<string, number> = {}
  const reads: URL[] = [], writes: { path: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const settings = (id?: string) => ({ defaultLimit: state.defaultLimit, globalLimit: state.globalLimit, version: state.version,
    ...(id ? { userId: id, overrideLimit: state.overrides[id] ?? null, effectiveLimit: state.overrides[id] ?? state.defaultLimit, canEdit: id !== 'remote', version: state.version + '-next'.repeat(userVersions[id] || 0) } : {}) })
  const filtered = (filters: ImageConcurrencyUserFilters) => users.filter(user => {
    const override = state.overrides[user.id] !== undefined
    return (!filters.query || [user.id, user.accountId, user.username, user.name].some(value => value.toLowerCase().includes(filters.query.toLowerCase())))
      && (filters.status === 'all' || user.isSuspended === (filters.status === 'suspended'))
      && (filters.mode === 'all' || override === (filters.mode === 'override'))
  })
  const version = (filters: ImageConcurrencyUserFilters) => `${state.version}:${JSON.stringify(filters)}:${JSON.stringify(state.overrides)}`
  const update = (ids: string[], limit: number | null) => {
    let updated = 0
    for (const id of ids) {
      if ((state.overrides[id] ?? null) !== limit) updated++
      if (limit === null) delete state.overrides[id]; else state.overrides[id] = limit
      userVersions[id] = (userVersions[id] || 0) + 1
    }
    return updated
  }
  await page.route('**/api/admin/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() === 'GET') reads.push(url)
    else writes.push({ path, body: request.postDataJSON(), headers: request.headers() })
    if (path === '/api/admin/overview') return route.fulfill({ json: { counts: { pending: 0, published: 0, rejected: 0, reports: 0 }, period: { days: 7, from: '2026-11-20', to: '2026-11-27', newWorks: 0 }, updatedAt: '2026-11-27T00:00:00Z' } })
    if (path === `${endpoint}/users`) {
      if (request.method() === 'GET') {
        if (state.failList) return route.fulfill({ status: 503, json: { message: '用户额度列表暂不可用' } })
        const filters = { query: url.searchParams.get('query') || '', status: url.searchParams.get('status') || 'all', mode: url.searchParams.get('mode') || 'all' } as ImageConcurrencyUserFilters
        const matches = filtered(filters), offset = url.searchParams.has('cursor') ? 30 : 0
        return route.fulfill({ json: { items: matches.slice(offset, offset + 30).map(user => ({ ...user, ...settings(user.id) })), total: matches.length,
          nextCursor: matches.length > offset + 30 ? 'page-two' : null, selectionVersion: version(filters), filters, defaultLimit: state.defaultLimit, globalLimit: state.globalLimit } })
      }
      if (state.failWrite) return route.fulfill({ status: 503, json: { message: '保存暂不可用' } })
      const body = request.postDataJSON() as ImageConcurrencyUsersPatch
      if (state.conflict || body.version !== version(body.filters)) return route.fulfill({ status: 409, json: { message: '用户列表或图片额度已变化，请刷新后重新选择。' } })
      const ids = body.selection.type === 'all' ? filtered(body.filters).map(user => user.id) : body.selection.ids
      return route.fulfill({ json: { selectedCount: ids.length, updatedCount: update(ids, body.overrideLimit) } })
    }
    if (path.endsWith('/image-concurrency')) {
      const id = path.includes('/users/') ? path.split('/').at(-2) : undefined
      if (request.method() === 'GET' && state.failRead) return route.fulfill({ status: 503, json: { message: '并发配置暂不可用' } })
      if (request.method() === 'PATCH') {
        if (state.conflict) return route.fulfill({ status: 409, json: { message: '并发设置已被其他管理员修改' } })
        const body = request.postDataJSON()
        if (body.version !== settings(id).version) return route.fulfill({ status: 409, json: { message: '版本已变化' } })
        if (id) update([id], body.overrideLimit)
        else { state.defaultLimit = body.defaultLimit; state.globalLimit = body.globalLimit; state.version += '-next' }
      }
      return route.fulfill({ json: settings(id) })
    }
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  return { account, state, reads, writes, errors, settings, version }
}
async function openPanel(page: Page) {
  await page.goto('/admin?tab=image-concurrency')
  await expect(page.getByRole('heading', { name: '图片并发管理', exact: true })).toBeVisible()
  return page.getByRole('form', { name: '默认图片生成并发', exact: true })
}
async function openUser(page: Page, id = '17') {
  await page.goto(`/admin?tab=image-concurrency&user=${id}`)
  const form = page.getByRole('form', { name: '用户图片生成并发', exact: true })
  await expect(form).toBeVisible()
  return form
}
const selection = (page: Page, count: number) => expect(page.locator('.selection-toolbar > p')).toContainText(`已选择 ${count} 位用户`)
const bulkSave = (page: Page) => page.getByRole('button', { name: '保存批量设置', exact: true })

test('standalone navigation and default settings persist with independent image/request limits', async ({ page }) => {
  const f = await fixture(page)
  await page.goto('/admin')
  await page.getByRole('navigation', { name: '管理分类' }).getByRole('button', { name: '图片并发', exact: true }).click()
  await expect(page).toHaveURL(/tab=image-concurrency/)
  const form = page.getByRole('form', { name: '默认图片生成并发', exact: true })
  await form.getByLabel('默认用户同时生成图片数', { exact: true }).fill('4')
  await form.getByLabel('社区同时接纳的图片请求数', { exact: true }).fill('1')
  await form.getByRole('button', { name: '保存默认与社区并发', exact: true }).click()
  await expect(form.getByRole('button', { name: '保存默认与社区并发', exact: true })).toBeDisabled()
  expect(f.writes).toHaveLength(1)
  expect(f.writes[0]!.body).toEqual({ defaultLimit: 4, globalLimit: 1, version: 'limits-1' })
  expect(f.writes[0]!.headers).toMatchObject({ 'x-new-api-user': f.account.state.user.id, 'x-csrf-token': 'unified-account-fixture' })
  await page.reload()
  await expect(form.getByLabel('默认用户同时生成图片数', { exact: true })).toHaveValue('4')
  await expect(form.getByLabel('社区同时接纳的图片请求数', { exact: true })).toHaveValue('1')
  expect(f.errors).toEqual([])
})

test('numeric bounds block invalid defaults and community capacity before writing', async ({ page }) => {
  const f = await fixture(page), form = await openPanel(page)
  const user = form.getByLabel('默认用户同时生成图片数', { exact: true }), global = form.getByLabel('社区同时接纳的图片请求数', { exact: true })
  for (const value of ['', '0', '1.5', '1001']) {
    await user.fill(value); await form.getByRole('button', { name: '保存默认与社区并发', exact: true }).click()
    await expect(user).toHaveAttribute('aria-invalid', 'true')
  }
  await user.fill('4')
  for (const value of ['0', '10001']) {
    await global.fill(value); await form.getByRole('button', { name: '保存默认与社区并发', exact: true }).click()
    await expect(global).toHaveAttribute('aria-invalid', 'true')
  }
  expect(f.writes).toHaveLength(0)
})

test('search and status/source filters apply on the server and reset the selection', async ({ page }) => {
  const f = await fixture(page); await openPanel(page)
  for (const query of ['17', 'account-first', 'creator', '木白']) {
    await page.getByLabel('搜索用户', { exact: true }).fill(query)
    await page.getByRole('form', { name: '筛选图片并发用户' }).getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: '选择 木白', exact: true })).toBeVisible()
    await expect.poll(() => f.reads.at(-1)?.searchParams.get('query')).toBe(query)
    await expect(page.getByRole('checkbox', { name: '选择 受保护管理员', exact: true })).toHaveCount(0)
  }
  await page.getByRole('button', { name: '重置筛选', exact: true }).click()
  await page.getByRole('checkbox', { name: '选择 木白', exact: true }).check(); await selection(page, 1)
  await page.getByRole('combobox', { name: '账号状态', exact: true }).selectOption('suspended')
  await page.getByRole('combobox', { name: '额度来源', exact: true }).selectOption('default')
  await page.getByRole('form', { name: '筛选图片并发用户' }).getByRole('button', { name: '搜索', exact: true }).click()
  await expect.poll(() => Object.fromEntries(f.reads.at(-1)!.searchParams)).toMatchObject({ status: 'suspended', mode: 'default' })
  await selection(page, 0)
  await expect(page.getByRole('checkbox', { name: '选择 用户007', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: '账号状态', exact: true }).selectOption('active')
  await page.getByRole('combobox', { name: '额度来源', exact: true }).selectOption('override')
  await page.getByRole('form', { name: '筛选图片并发用户' }).getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '选择 用户003', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '选择 用户007', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '重置筛选', exact: true }).click()
  await expect(page.getByLabel('搜索用户', { exact: true })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: '账号状态', exact: true })).toHaveValue('all')
  await expect(page.getByRole('combobox', { name: '额度来源', exact: true })).toHaveValue('all')
  expect(f.writes).toHaveLength(0)
})

test('cross-page select all updates all 35 users and bulk restore removes overrides', async ({ page }) => {
  const f = await fixture(page); await openPanel(page)
  await page.getByRole('checkbox', { name: '全选当前页', exact: true }).check(); await selection(page, 30)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '选择 用户031', exact: true })).not.toBeChecked(); await selection(page, 30)
  await page.getByRole('button', { name: '全选全部筛选结果（35 人）', exact: true }).click(); await selection(page, 35)
  await expect(page.getByRole('checkbox', { name: '选择 用户035', exact: true })).toBeChecked()
  const input = page.getByLabel('批量图片数', { exact: true })
  for (const value of ['0', '1.5', '1001']) {
    await input.fill(value); await bulkSave(page).click()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
  }
  expect(f.writes).toHaveLength(0)
  await input.fill('4'); const initialVersion = f.version(allFilters)
  await bulkSave(page).click(); await selection(page, 0)
  expect(f.writes[0]!.body).toEqual({ selection: { type: 'all' }, filters: allFilters, overrideLimit: 4, version: initialVersion })
  expect(Object.keys(f.state.overrides)).toHaveLength(35)
  expect(f.writes[0]!.headers).toMatchObject({ 'x-new-api-user': f.account.state.user.id, 'x-csrf-token': 'unified-account-fixture' })
  await page.getByRole('button', { name: '全选全部筛选结果（35 人）', exact: true }).click()
  await page.getByRole('combobox', { name: '批量操作', exact: true }).selectOption({ label: '恢复默认' })
  await bulkSave(page).click(); await selection(page, 0)
  expect(f.writes.at(-1)!.body.overrideLimit).toBeNull()
  expect(f.state.overrides).toEqual({})
  expect(f.errors).toEqual([])
})

test('individual selection spans pages, clears explicitly, and restores only selected users', async ({ page }) => {
  const f = await fixture(page); f.state.overrides['17'] = 8; f.state.overrides.u31 = 9
  await openPanel(page)
  await page.getByRole('checkbox', { name: '选择 木白', exact: true }).check()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByRole('checkbox', { name: '选择 用户031', exact: true }).check(); await selection(page, 2)
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '选择 木白', exact: true })).toBeChecked()
  await page.getByRole('combobox', { name: '批量操作', exact: true }).selectOption({ label: '恢复默认' })
  await bulkSave(page).click(); await selection(page, 0)
  expect(f.writes[0]!.body.selection).toEqual({ type: 'ids', ids: ['17', 'u31'] })
  expect(f.state.overrides).toEqual({ u3: 3, u4: 5 })
  await page.getByRole('checkbox', { name: '全选当前页', exact: true }).check()
  await page.getByRole('button', { name: '清除选择', exact: true }).click(); await selection(page, 0)
  await expect(bulkSave(page)).toBeDisabled()
})

test('single-user editor saves an override and restores default; protected accounts are editable', async ({ page }) => {
  const f = await fixture(page); await openPanel(page)
  await page.getByRole('button', { name: '编辑 木白 的图片并发', exact: true }).click()
  const form = page.getByRole('form', { name: '用户图片生成并发', exact: true })
  await form.getByLabel('并发设置方式', { exact: true }).selectOption('override')
  await form.getByLabel('此用户同时生成图片数', { exact: true }).fill('4')
  await form.getByRole('button', { name: '保存用户并发', exact: true }).click()
  await expect(form.getByRole('status')).toContainText('同时生成 4 张图片')
  expect(f.writes[0]!.body).toEqual({ overrideLimit: 4, version: 'limits-1' })
  await form.getByLabel('并发设置方式', { exact: true }).selectOption('default')
  await form.getByRole('button', { name: '保存用户并发', exact: true }).click()
  await expect(form.getByRole('status')).toContainText('同时生成 2 张图片')
  expect(f.writes.at(-1)!.body).toEqual({ overrideLimit: null, version: 'limits-1-next' })
  await page.getByRole('button', { name: '关闭用户编辑', exact: true }).click()
  await page.getByRole('button', { name: '编辑 受保护管理员 的图片并发', exact: true }).click()
  await form.getByLabel('并发设置方式', { exact: true }).selectOption('override')
  await form.getByLabel('此用户同时生成图片数', { exact: true }).fill('6')
  await form.getByRole('button', { name: '保存用户并发', exact: true }).click()
  await expect(form.getByRole('status')).toContainText('同时生成 6 张图片')
  const remote = await openUser(page, 'remote')
  await expect(remote.getByText('此账号的并发设置仅供查看，不能在当前社区修改。')).toBeVisible()
  await expect(remote.getByRole('button', { name: '保存用户并发', exact: true })).toHaveCount(0)
})

test('saving defaults refreshes a clean open user editor and preserves an existing user draft', async ({ page }) => {
  const f = await fixture(page), user = await openUser(page)
  const defaults = page.getByRole('form', { name: '默认图片生成并发', exact: true })
  await defaults.getByLabel('默认用户同时生成图片数', { exact: true }).fill('4')
  await defaults.getByRole('button', { name: '保存默认与社区并发', exact: true }).click()
  await expect(user.getByRole('status')).toContainText('同时生成 4 张图片')
  await user.getByLabel('并发设置方式', { exact: true }).selectOption('override')
  await user.getByLabel('此用户同时生成图片数', { exact: true }).fill('6')
  await user.getByRole('button', { name: '保存用户并发', exact: true }).click()
  await expect(user.getByRole('status')).toContainText('同时生成 6 张图片')
  expect(f.writes.at(-1)!.body).toEqual({ overrideLimit: 6, version: 'limits-1-next' })
  await user.getByLabel('此用户同时生成图片数', { exact: true }).fill('8')
  await defaults.getByLabel('默认用户同时生成图片数', { exact: true }).fill('5')
  await defaults.getByRole('button', { name: '保存默认与社区并发', exact: true }).click()
  await expect(page.getByText('默认设置已更新，此用户的未保存输入已保留，请重新读取后核对。', { exact: true })).toBeVisible()
  await expect(user.getByLabel('此用户同时生成图片数', { exact: true })).toHaveValue('8')
  await user.getByRole('button', { name: '重新读取并发设置', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(user.getByLabel('此用户同时生成图片数', { exact: true })).toHaveValue('8')
  expect(f.errors).toEqual([])
})

for (const user of [false, true]) test(`conflicts preserve ${user ? 'single-user' : 'default'} edits until explicit discard`, async ({ page }) => {
  const f = await fixture(page), form = user ? await openUser(page) : await openPanel(page)
  if (user) await form.getByLabel('并发设置方式', { exact: true }).selectOption('override')
  const input = form.getByLabel(user ? '此用户同时生成图片数' : '默认用户同时生成图片数', { exact: true })
  await input.fill('4'); f.state.conflict = true
  await form.getByRole('button', { name: user ? '保存用户并发' : '保存默认与社区并发', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('你的输入仍保留')
  await page.getByRole('navigation', { name: '管理分类' }).getByRole('button', { name: '管理概览', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click(); await expect(input).toHaveValue('4')
  f.state.conflict = false; f.state.defaultLimit = 3; f.state.version = 'latest'
  await form.getByRole('button', { name: '重新读取并发设置', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click(); await expect(input).toHaveValue('4')
  await form.getByRole('button', { name: '重新读取并发设置', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  if (user) await form.getByLabel('并发设置方式', { exact: true }).selectOption('override')
  await expect(input).toHaveValue('3')
  await input.fill('4'); await form.getByRole('button', { name: user ? '保存用户并发' : '保存默认与社区并发', exact: true }).click()
  await expect(form.getByRole('button', { name: user ? '保存用户并发' : '保存默认与社区并发', exact: true })).toBeDisabled()
  expect(f.writes.at(-1)!.body.version).toBe('latest')
})

test('bulk failures preserve drafts while conflicts invalidate selection and retain input', async ({ page }) => {
  const f = await fixture(page); await openPanel(page)
  await page.getByRole('checkbox', { name: '选择 木白', exact: true }).check()
  await page.getByLabel('批量图片数', { exact: true }).fill('7')
  f.state.failWrite = true; await bulkSave(page).click()
  await expect(page.getByRole('alert')).toContainText('保存暂不可用')
  await selection(page, 1); await expect(page.getByLabel('批量图片数', { exact: true })).toHaveValue('7')
  await page.getByRole('navigation', { name: '管理分类' }).getByRole('button', { name: '管理概览', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.getByRole('button', { name: '刷新用户列表', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click(); await selection(page, 1)
  f.state.failWrite = false; f.state.conflict = true; await bulkSave(page).click()
  await expect(page.getByRole('alert')).toContainText('用户列表或图片额度已变化')
  await selection(page, 0); await expect(page.getByLabel('批量图片数', { exact: true })).toHaveValue('7')
  await expect(bulkSave(page)).toBeDisabled()
  await expect(page.getByText('用户列表已变化，已清除选择，请刷新后重新选择。', { exact: true })).toBeVisible()
  f.state.conflict = false; f.state.version = 'new-version'
  await page.getByRole('button', { name: '刷新用户列表', exact: true }).click()
  await selection(page, 0)
  await page.getByRole('checkbox', { name: '选择 木白', exact: true }).check()
  const refreshedVersion = f.version(allFilters)
  await page.getByLabel('批量图片数', { exact: true }).fill('7'); await bulkSave(page).click(); await selection(page, 0)
  expect(f.writes.at(-1)!.body.version).toBe(refreshedVersion)
})

test('failed settings and user-list reads can retry in place', async ({ page }) => {
  const f = await fixture(page); f.state.failRead = true; f.state.failList = true
  await openPanel(page)
  await expect(page.getByText('并发配置暂不可用', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: '用户额度列表暂不可用' })).toBeVisible()
  f.state.failRead = false; f.state.failList = false
  await page.getByRole('button', { name: '重新读取并发设置', exact: true }).click()
  await page.getByRole('button', { name: '刷新用户列表', exact: true }).click()
  await expect(page.getByLabel('默认用户同时生成图片数', { exact: true })).toHaveValue('2')
  await expect(page.getByRole('checkbox', { name: '选择 木白', exact: true })).toBeVisible()
})

for (const bulk of [false, true]) test(`late ${bulk ? 'bulk' : 'default'} saves cannot update a switched administrator`, async ({ page }) => {
  const f = await fixture(page); await openPanel(page)
  let started = false, release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  await page.route(`**${endpoint}${bulk ? '/users' : ''}`, async route => {
    if (route.request().method() === 'GET') return route.fallback()
    started = true; await wait
    await route.fulfill({ json: bulk ? { selectedCount: 1, updatedCount: 1 } : { ...f.settings(), defaultLimit: 4 } }).catch(() => {})
  })
  if (bulk) {
    await page.getByRole('checkbox', { name: '选择 木白', exact: true }).check()
    await page.getByLabel('批量图片数', { exact: true }).fill('4'); await bulkSave(page).click()
  } else {
    await page.getByLabel('默认用户同时生成图片数', { exact: true }).fill('4')
    await page.getByRole('button', { name: '保存默认与社区并发', exact: true }).click()
  }
  await expect.poll(() => started).toBe(true)
  f.account.state.user.id = 'changed'; f.account.state.user.isAdmin = false; f.account.state.user.isModerator = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: '管理概览', exact: true })).toBeVisible()
  release(); await page.waitForTimeout(100)
  await expect(page.getByRole('heading', { name: '图片并发管理', exact: true })).toHaveCount(0)
  await expect(page.getByText(/图片生成并发设置已保存|批量设置已保存/)).toHaveCount(0)
  expect(f.errors).toEqual([])
})

for (const width of [1440, 390, 320]) test(`concurrency page supports keyboard and fits ${width}px accessibly`, async ({ page }, info) => {
  const f = await fixture(page); await page.setViewportSize({ width, height: 1000 }); await openPanel(page)
  const checkbox = page.getByRole('checkbox', { name: '选择 木白', exact: true })
  await checkbox.focus(); await page.keyboard.press('Space'); await selection(page, 1)
  await page.getByRole('button', { name: '清除选择', exact: true }).click(); await selection(page, 0)
  const content = page.locator('.admin-content')
  for (const control of await content.locator('input:not([type="checkbox"]), select, button').all()) {
    if (await control.isVisible()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.admin-content').analyze()).violations).toEqual([])
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0) })
  await page.screenshot({ path: info.outputPath(`panel-${width}.png`), fullPage: true })
  const user = await openUser(page)
  await user.getByLabel('并发设置方式', { exact: true }).selectOption('override')
  await user.getByLabel('此用户同时生成图片数', { exact: true }).fill('4')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.admin-content').analyze()).violations).toEqual([])
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0) })
  await page.screenshot({ path: info.outputPath(`user-${width}.png`), fullPage: true })
  expect(f.errors).toEqual([])
})
