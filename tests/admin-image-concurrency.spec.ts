import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.isAdmin = true
  const person = { id: '17', accountId: '17', name: '木白', username: 'creator', host: null as string | null,
    avatarUrl: null, bannerUrl: null, createdAt: null, lastActiveDate: null, isSuspended: false, isProtected: false,
    violationCount: 0, violationBaseline: 0, statusVersion: 'status-1', mediaVersion: 'media-1', moderationNote: '原有笔记', noteVersion: 'note-1', canEditNote: true }
  const state = { defaultLimit: 2, globalLimit: 10, version: 'limits-1', overrides: {} as Record<string, number>, conflict: false, failRead: false }
  const reads: string[] = [], writes: { path: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const settings = (id?: string) => ({ defaultLimit: state.defaultLimit, globalLimit: state.globalLimit, version: state.version,
    ...(id ? { userId: id, overrideLimit: state.overrides[id] ?? null, effectiveLimit: state.overrides[id] ?? state.defaultLimit, canEdit: id !== 'remote' } : {}) })
  await page.route('**/api/admin/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'GET') reads.push(path)
    else writes.push({ path, body: request.postDataJSON(), headers: request.headers() })
    if (path === '/api/admin/overview') return route.fulfill({ json: { counts: { pending: 0, published: 0, rejected: 0, reports: 0 }, period: { days: 7, from: '2026-11-20', to: '2026-11-27', newWorks: 0 }, updatedAt: '2026-11-27T00:00:00Z' } })
    if (path.endsWith('/image-concurrency')) {
      const id = path.includes('/users/') ? path.split('/').at(-2) : undefined
      if (request.method() === 'GET' && state.failRead) return route.fulfill({ status: 503, json: { message: '并发配置暂不可用' } })
      if (request.method() === 'PATCH') {
        if (state.conflict) return route.fulfill({ status: 409, json: { message: '并发设置已被其他管理员修改' } })
        const body = request.postDataJSON()
        if (body.version !== state.version) return route.fulfill({ status: 409, json: { message: '版本已变化' } })
        if (id) { if (body.overrideLimit === null) delete state.overrides[id]; else state.overrides[id] = body.overrideLimit }
        else { state.defaultLimit = body.defaultLimit; state.globalLimit = body.globalLimit }
        state.version += '-next'
      }
      return route.fulfill({ json: settings(id) })
    }
    if (path === '/api/admin/users') return route.fulfill({ json: { items: [person, { ...person, id: 'protected', name: '受保护管理员', isProtected: true }, { ...person, id: 'remote', name: '远程用户', host: 'remote.test' }], nextCursor: null } })
    if (path.endsWith('/note')) {
      person.moderationNote = request.postDataJSON().moderationNote; person.noteVersion = 'note-2'
      return route.fulfill({ json: { moderationNote: person.moderationNote, noteVersion: person.noteVersion } })
    }
    if (/\/users\/[^/]+$/.test(path)) {
      const id = path.split('/').at(-1)!
      return route.fulfill({ json: { user: { ...person, id, ...(id === 'protected' ? { name: '受保护管理员', isProtected: true } : id === 'remote' ? { name: '远程用户', host: 'remote.test', canEditNote: false } : {}) } } })
    }
    return route.fulfill({ json: { items: [], nextCursor: null } })
  })
  return { account, state, reads, writes, errors, settings }
}
async function openDefaults(page: Page) {
  await page.goto('/admin?tab=users')
  await page.getByText('图片生成并发设置', { exact: true }).click()
  const form = page.getByRole('form', { name: '默认图片生成并发', exact: true })
  await expect(form.getByLabel('默认用户同时生成图片数', { exact: true })).toBeVisible()
  return form
}
async function openUser(page: Page, id = '17') {
  await page.goto(`/admin?tab=users&user=${id}`)
  await page.getByText('此用户的图片生成并发', { exact: true }).click()
  const form = page.getByRole('form', { name: '用户图片生成并发', exact: true })
  await expect(form).toBeVisible()
  return form
}

test('default image counts and community request capacity save with the current version and account', async ({ page }) => {
  const f = await fixture(page), form = await openDefaults(page)
  await form.getByLabel('默认用户同时生成图片数', { exact: true }).fill('4')
  await form.getByLabel('社区同时接纳的图片请求数', { exact: true }).fill('1000')
  await form.getByRole('button', { name: '保存默认与社区并发', exact: true }).click()
  await expect(form.getByRole('button', { name: '保存默认与社区并发', exact: true })).toBeDisabled()
  expect(f.writes).toHaveLength(1)
  expect(f.writes[0]!.body).toEqual({ defaultLimit: 4, globalLimit: 1000, version: 'limits-1' })
  expect(f.writes[0]!.headers).toMatchObject({ 'x-new-api-user': f.account.state.user.id, 'x-csrf-token': 'unified-account-fixture' })
  await page.reload(); await page.getByText('图片生成并发设置', { exact: true }).click()
  await expect(form.getByLabel('默认用户同时生成图片数', { exact: true })).toHaveValue('4')
  await expect(form.getByLabel('社区同时接纳的图片请求数', { exact: true })).toHaveValue('1000')
  expect(f.errors).toEqual([])
})

test('numeric bounds reject invalid values while image and request limits remain independent', async ({ page }) => {
  const f = await fixture(page), form = await openDefaults(page)
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
  await global.fill('1'); await form.getByRole('button', { name: '保存默认与社区并发', exact: true }).click()
  await expect(form.getByRole('button', { name: '保存默认与社区并发', exact: true })).toBeDisabled()
  expect(f.writes[0]!.body).toEqual({ defaultLimit: 4, globalLimit: 1, version: 'limits-1' })
})

test('user overrides save and restore defaults independently of moderation notes', async ({ page }) => {
  const f = await fixture(page), form = await openUser(page)
  await form.getByLabel('并发设置方式', { exact: true }).selectOption('override')
  await form.getByLabel('此用户同时生成图片数', { exact: true }).fill('4')
  await expect(page.getByRole('button', { name: '保存笔记', exact: true })).toBeDisabled()
  await form.getByRole('button', { name: '保存用户并发', exact: true }).click()
  await expect(form.getByRole('status')).toContainText('同时生成 4 张图片')
  expect(f.writes[0]!.body).toEqual({ overrideLimit: 4, version: 'limits-1' })
  await page.getByLabel('管理笔记', { exact: true }).fill('独立的笔记修改')
  await form.getByLabel('此用户同时生成图片数', { exact: true }).fill('5')
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存笔记', exact: true })).toBeDisabled()
  await expect(form.getByLabel('此用户同时生成图片数', { exact: true })).toHaveValue('5')
  await expect(form.getByRole('button', { name: '保存用户并发', exact: true })).toBeEnabled()
  await form.getByLabel('并发设置方式', { exact: true }).selectOption('default')
  await form.getByRole('button', { name: '保存用户并发', exact: true }).click()
  await expect(form.getByRole('status')).toContainText('同时生成 2 张图片')
  expect(f.writes.at(-1)!.body).toEqual({ overrideLimit: null, version: 'limits-1-next' })
  await page.reload(); await page.getByText('此用户的图片生成并发', { exact: true }).click()
  await expect(form.getByLabel('并发设置方式', { exact: true })).toHaveValue('default')
  await expect(page.getByLabel('管理笔记', { exact: true })).toHaveValue('独立的笔记修改')
})

for (const user of [false, true]) test(`conflicts retain input and navigation or reload requires an explicit discard: ${user}`, async ({ page }) => {
  const f = await fixture(page), form = user ? await openUser(page) : await openDefaults(page)
  if (user) await form.getByLabel('并发设置方式', { exact: true }).selectOption('override')
  const input = form.getByLabel(user ? '此用户同时生成图片数' : '默认用户同时生成图片数', { exact: true })
  await input.fill('4'); f.state.conflict = true
  await form.getByRole('button', { name: user ? '保存用户并发' : '保存默认与社区并发', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('你的输入仍保留')
  await expect(input).toHaveValue('4')
  await page.getByRole('link', { name: user ? '用户列表' : '查看 木白 的管理详情', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(input).toHaveValue('4')
  f.state.conflict = false; f.state.defaultLimit = 3; f.state.version = 'latest'
  await form.getByRole('button', { name: '重新读取并发设置', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(input).toHaveValue('4')
  await form.getByRole('button', { name: '重新读取并发设置', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  if (user) { await expect(form.getByLabel('并发设置方式', { exact: true })).toHaveValue('default'); await form.getByLabel('并发设置方式', { exact: true }).selectOption('override') }
  await expect(input).toHaveValue('3')
  await input.fill('4'); await form.getByRole('button', { name: user ? '保存用户并发' : '保存默认与社区并发', exact: true }).click()
  await expect(form.getByRole('button', { name: user ? '保存用户并发' : '保存默认与社区并发', exact: true })).toBeDisabled()
  expect(f.writes.at(-1)!.body.version).toBe('latest')
})

test('protected local administrators can edit image limits and remote users remain read-only', async ({ page }) => {
  const f = await fixture(page), local = await openUser(page, 'protected')
  await expect(page.getByRole('button', { name: '封禁社区账号', exact: true })).toBeDisabled()
  await local.getByLabel('并发设置方式', { exact: true }).selectOption('override')
  await local.getByLabel('此用户同时生成图片数', { exact: true }).fill('4')
  await local.getByRole('button', { name: '保存用户并发', exact: true }).click()
  await expect(local.getByRole('status')).toContainText('同时生成 4 张图片')
  const remote = await openUser(page, 'remote')
  await expect(remote.getByText('此账号的并发设置仅供查看，不能在当前社区修改。')).toBeVisible()
  await expect(remote.getByRole('button', { name: '保存用户并发', exact: true })).toHaveCount(0)
  await expect(remote.getByRole('combobox')).toHaveCount(0)
  expect(f.writes).toHaveLength(1)
})

test('failed reads retry in place and late saves cannot update a changed administrator', async ({ page }) => {
  const f = await fixture(page)
  f.state.failRead = true
  await page.goto('/admin?tab=users'); await page.getByText('图片生成并发设置', { exact: true }).click()
  await expect(page.locator('.image-concurrency').getByRole('alert')).toContainText('并发配置暂不可用')
  f.state.failRead = false
  await page.getByRole('button', { name: '重新读取并发设置', exact: true }).click()
  await page.getByLabel('默认用户同时生成图片数', { exact: true }).fill('4')
  let started = false, release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/admin/creation/image-concurrency', async route => {
    if (route.request().method() === 'GET') return route.fallback()
    started = true; await wait; await route.fulfill({ json: { ...f.settings(), defaultLimit: 4 } }).catch(() => {})
  })
  await page.getByRole('button', { name: '保存默认与社区并发', exact: true }).click()
  await expect.poll(() => started).toBe(true)
  await expect(page.getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled()
  f.account.state.user.id = 'changed'; f.account.state.user.isAdmin = false; f.account.state.user.isModerator = true
  await page.evaluate(async () => { const state = await import('/src/state.ts'); await state.loadSession(true) })
  await expect(page.getByRole('heading', { name: '管理概览', exact: true })).toBeVisible()
  release(); await page.waitForTimeout(100)
  await expect(page.getByText('图片生成并发设置已保存。', { exact: true })).toHaveCount(0)
  await expect(page.locator('.image-concurrency')).toHaveCount(0)
  expect(f.errors).toEqual([])
})

for (const width of [1440, 390, 320]) test(`image concurrency controls are accessible and fit ${width}px`, async ({ page }, info) => {
  const f = await fixture(page)
  await page.setViewportSize({ width, height: 1000 })
  const defaults = await openDefaults(page)
  await expect(defaults).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.image-concurrency').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`defaults-${width}.png`), fullPage: true })
  const user = await openUser(page)
  await user.getByLabel('并发设置方式', { exact: true }).selectOption('override')
  await user.getByLabel('此用户同时生成图片数', { exact: true }).fill('4')
  for (const control of await user.locator('input, select, button').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.image-concurrency').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`user-${width}.png`), fullPage: true })
  expect(f.errors).toEqual([])
})
