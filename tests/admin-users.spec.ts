import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true); account.state.user.isAdmin = true
  const person = { id: '17', accountId: '17', name: '木白', username: 'public-renamed', host: null,
    avatarUrl: '/legacy-files/avatar1?variant=thumbnail', bannerUrl: '/legacy-files/banner1?variant=web',
    createdAt: '2026-11-01T01:00:00Z', lastActiveDate: null, isSuspended: false, isProtected: false,
    violationCount: 4, violationBaseline: 1, statusVersion: 'status-1', mediaVersion: 'media-1',
    moderationNote: '原有管理记录', noteVersion: 'note-1', canEditNote: true }
  const state = { person, conflict: false, failList: false, failDetail: false, failNote: false, failLogins: false }
  const reads: URL[] = [], writes: { path: string; body: any }[] = []
  await page.route('**/legacy-files/**', route => route.abort())
  await page.route('**/api/admin/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() !== 'GET') {
      const body = request.postDataJSON(); writes.push({ path, body })
      if (state.conflict) return route.fulfill({ status: 409, json: { message: '资料已变化' } })
      if (path.endsWith('/note')) {
        if (state.failNote) return route.fulfill({ status: 503, json: { message: '保存暂不可用' } })
        person.moderationNote = body.moderationNote.trim(); person.noteVersion = 'note-2'
        return route.fulfill({ json: { moderationNote: person.moderationNote, noteVersion: person.noteVersion } })
      }
      if (path.endsWith('/media')) { if (body.clear === 'avatar') person.avatarUrl = ''; else person.bannerUrl = ''; person.mediaVersion = 'media-2' }
      else if (path === '/api/admin/users/17') { person.isSuspended = body.isSuspended; person.statusVersion = 'status-2'; if (!body.isSuspended) person.violationBaseline = person.violationCount }
      return route.fulfill({ json: { user: person } })
    }
    reads.push(url)
    if (path === '/api/admin/overview') return route.fulfill({ json: { counts: { pending: 0, published: 0, rejected: 0, reports: 0 }, period: { days: 7, from: '2026-11-20', to: '2026-11-27', newWorks: 0 }, updatedAt: '2026-11-27T00:00:00Z' } })
    if (path === '/api/admin/users') {
      if (state.failList) return route.fulfill({ status: 503, json: { message: '用户列表加载失败' } })
      const remote = url.searchParams.get('origin') === 'remote'
      const list = url.searchParams.has('cursor') ? [{ ...person, id: '18', name: '第二页用户', username: 'second' }]
        : [{ ...person, ...(remote ? { host: 'remote.test' } : {}) }, { ...person, id: 'root1', name: '受保护管理员', username: 'admin', isProtected: true }, { ...person, id: '19', name: '很长的用户名称用于测试手机上的文字布局', username: 'verylongpublicaccountnamewithoutspaces', isSuspended: true }]
      return route.fulfill({ json: { items: list, nextCursor: url.searchParams.has('cursor') ? null : 'page2' } })
    }
    if (path.endsWith('/logins')) {
      if (state.failLogins) return route.fulfill({ status: 503, json: { message: '记录读取失败' } })
      return route.fulfill({ json: { items: [{ id: 'login1', ip: '192.0.2.1', userAgent: 'Test Browser', date: '2026-11-21T01:00:00Z', success: true }], nextCursor: null } })
    }
    if (/\/users\/(17|root1|19)$/.test(path)) {
      if (state.failDetail) return route.fulfill({ status: 503, json: { message: '详情读取失败' } })
      return route.fulfill({ json: { user: { ...person, ...(path.endsWith('/root1') ? { id: 'root1', name: '受保护管理员', isProtected: true } : {}) } } })
    }
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  return { account, reads, writes, state }
}
const openPerson = async (page: Page) => { await page.getByRole('link', { name: '查看 木白 的管理详情' }).click(); await expect(page.getByRole('heading', { name: '木白', exact: true })).toBeVisible() }

test('user cards filter on the server, page with applied filters and reset to local newest', async ({ page }) => {
  const f = await fixture(page); await page.goto('/admin?tab=users')
  const filters = page.getByRole('form', { name: '筛选用户' })
  await expect(page.locator('.user-card')).toHaveCount(3)
  await expect(filters.getByLabel('主机名')).toBeDisabled()
  await filters.getByRole('combobox', { name: '排序', exact: true }).selectOption('created-asc')
  await filters.getByRole('combobox', { name: '状态', exact: true }).selectOption('suspended')
  await filters.getByRole('combobox', { name: '来源服务器', exact: true }).selectOption('remote')
  await filters.getByLabel('主机名', { exact: true }).fill('remote.test')
  await filters.getByLabel('用户名 / 名称 / ID', { exact: true }).fill('public-renamed')
  await filters.getByRole('button', { name: '搜索', exact: true }).click()
  await expect.poll(() => f.reads.at(-1)?.searchParams.get('query')).toBe('public-renamed')
  await page.getByRole('button', { name: '加载更多用户' }).click()
  await expect(page.getByText('第二页用户', { exact: true })).toBeVisible()
  expect(Object.fromEntries(f.reads.at(-1)!.searchParams)).toMatchObject({ origin: 'remote', status: 'suspended', sort: 'created-asc', host: 'remote.test', query: 'public-renamed', cursor: 'page2' })
  await filters.getByRole('button', { name: '重置', exact: true }).click()
  await expect(filters.getByLabel('主机名')).toHaveValue('')
  await expect.poll(() => f.reads.at(-1)?.searchParams.get('sort')).toBe('created-desc')
  expect(f.reads.at(-1)!.searchParams.has('cursor')).toBe(false)
})

test('detail notes survive conflicts, navigation cancellation and save/reload; IP records load on demand', async ({ page }) => {
  const f = await fixture(page); await page.goto('/admin?tab=users'); await openPerson(page)
  await expect(page.getByLabel('管理笔记')).toHaveValue('原有管理记录')
  expect(f.reads.some(url => url.pathname.endsWith('/logins'))).toBe(false)
  await page.getByLabel('管理笔记').fill('待跟进的管理笔记')
  await page.getByRole('link', { name: '用户列表', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('管理笔记')).toHaveValue('待跟进的管理笔记')
  f.state.conflict = true
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('你的输入仍保留')
  f.state.conflict = false
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存笔记', exact: true })).toBeDisabled()
  await page.reload(); await expect(page.getByLabel('管理笔记')).toHaveValue('待跟进的管理笔记')
  expect(f.writes.at(-1)?.body).toEqual({ moderationNote: '待跟进的管理笔记', version: 'note-1' })
  f.state.failLogins = true; await page.getByText('社区登录记录与 IP', { exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('记录读取失败')
  f.state.failLogins = false; await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByText('192.0.2.1', { exact: true })).toBeVisible()
  await page.getByText('角色与账号安全', { exact: true }).click()
  await expect(page.getByRole('link', { name: '章鱼账户中心', exact: true }).last()).toHaveAttribute('href', 'https://accounts.example/')
  await expect(page.getByRole('button', { name: /重置密码|解除双重认证|删除账户/ })).toHaveCount(0)
})

test('suspension requires a reason, unban preserves totals and clearing media confirms a single reference', async ({ page }) => {
  const f = await fixture(page); await page.goto('/admin?tab=users&user=17')
  await page.getByRole('button', { name: '封禁社区账号', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '确认', exact: true }).click(); expect(f.writes).toHaveLength(0)
  await dialog.getByLabel('处理原因').fill('违规作品多次发布')
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(f.writes[0]?.body).toEqual({ isSuspended: true, reason: '违规作品多次发布', version: 'status-1' })
  await page.getByRole('button', { name: '解除社区封禁', exact: true }).click()
  await dialog.getByRole('button', { name: '确认', exact: true }).click(); await expect(dialog).not.toBeVisible()
  await expect(page.locator('.violation-counts')).toContainText('本轮违规 0')
  await expect(page.locator('.violation-counts')).toContainText('历史违规 4')
  await page.getByRole('button', { name: '清除头像', exact: true }).click()
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); expect(f.writes).toHaveLength(2)
  await page.getByRole('button', { name: '清除头像', exact: true }).click()
  await dialog.getByRole('button', { name: '确认', exact: true }).click(); await expect(dialog).not.toBeVisible()
  expect(f.writes.at(-1)?.body).toEqual({ clear: 'avatar', version: 'media-1' })
  await expect(page.getByRole('button', { name: '清除头像', exact: true })).toBeDisabled()
  expect(f.state.person.bannerUrl).toContain('banner1')
  await page.goto('/admin?tab=users&user=root1')
  await expect(page.getByRole('button', { name: '封禁社区账号', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '清除横幅', exact: true })).toBeDisabled()
})

test('browser back closes pending user actions without carrying their target to another detail', async ({ page }) => {
  const f = await fixture(page); await page.goto('/admin?tab=users'); await openPerson(page)
  await page.getByRole('button', { name: '封禁社区账号', exact: true }).click()
  await page.getByRole('dialog').getByLabel('处理原因').fill('仅针对当前用户')
  await page.goBack()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.locator('.user-card')).toHaveCount(3)
  await openPerson(page)
  await page.getByRole('button', { name: '封禁社区账号', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('处理原因')).toHaveValue('')
  expect(f.writes).toHaveLength(0)
})

test('failed reads retry and demoted accounts never read user details', async ({ page }) => {
  const f = await fixture(page); f.state.failList = true
  await page.goto('/admin?tab=users'); await expect(page.getByRole('alert')).toContainText('用户列表加载失败')
  f.state.failList = false; await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.locator('.user-card')).toHaveCount(3)
  f.state.failDetail = true; await page.getByRole('link', { name: '查看 木白 的管理详情' }).click()
  await expect(page.getByRole('alert')).toContainText('详情读取失败')
  f.state.failDetail = false; await page.getByRole('button', { name: '刷新详情' }).click()
  await expect(page.getByLabel('管理笔记')).toBeVisible()
  f.account.state.user.isAdmin = false; f.account.state.user.isModerator = true
  const count = f.reads.filter(url => url.pathname.startsWith('/api/admin/users')).length
  await page.reload(); await expect(page.getByRole('heading', { name: '管理概览', exact: true })).toBeVisible()
  expect(f.reads.filter(url => url.pathname.startsWith('/api/admin/users'))).toHaveLength(count)
})

test('delayed note saves cannot affect a switched or demoted account', async ({ page }) => {
  const f = await fixture(page)
  let release!: () => void, started = false
  const wait = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/admin/users/17/note', async route => { started = true; await wait; await route.fulfill({ json: { moderationNote: 'old response', noteVersion: 'late' } }).catch(() => {}) })
  await page.goto('/admin?tab=users&user=17'); await page.getByLabel('管理笔记').fill('old draft')
  await page.getByRole('button', { name: '保存笔记', exact: true }).click(); await expect.poll(() => started).toBe(true)
  f.account.state.user.id = 'newAccount'; f.account.state.user.isAdmin = false; f.account.state.user.isModerator = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: '管理概览', exact: true })).toBeVisible()
  release(); await page.waitForTimeout(150)
  await expect(page.getByLabel('管理笔记')).toHaveCount(0)
  await expect(page.getByText('管理笔记已保存。', { exact: true })).toHaveCount(0)
})

for (const mode of ['light', 'dark'] as const) test(`user list and detail fit desktop and phones in ${mode} theme`, async ({ page }) => {
  await fixture(page)
  await page.addInitScript(value => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode: value, light: 'cloud', dark: 'sage' })), mode)
  await mkdir('.impeccable/review/admin-users', { recursive: true })
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto('/admin?tab=users')
    await expect(page.locator('.user-card')).toHaveCount(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.impeccable/review/admin-users/list-${mode}-${width}.png`, fullPage: true })
    await openPerson(page); await page.getByText('社区登录记录与 IP', { exact: true }).click()
    await expect(page.getByText('192.0.2.1', { exact: true })).toBeVisible()
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.impeccable/review/admin-users/detail-${mode}-${width}.png`, fullPage: true })
    expect((await new AxeBuilder({ page }).include('.admin-users').analyze()).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
  }
  expect(errors).toEqual([])
})
