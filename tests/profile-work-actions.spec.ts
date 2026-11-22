import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, role: 'owner' | 'admin' | 'visitor' | 'moderator' | 'guest' = 'owner', destination = 'profile') {
  const account = await mockUnifiedAccount(page, role !== 'guest')
  Object.assign(account.state.user, { id: role === 'owner' ? '3' : '42', isAdmin: role === 'admin', isModerator: role === 'admin' || role === 'moderator' })
  const control = { detailError: false, saveError: false, deleteError: false, pending: false }
  const mutations: { method: string; body: any; expected?: string }[] = [], uploads: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const items: any[] = [{ id: 'work1', title: '光影作品', authorId: '3', author: '原作者', avatar: '原', kind: 'image', version: 2,
    cover: '/assets/brand/octopus-community.jpg', fileIds: ['file1'], files: [{ id: 'file1', name: '作品图片', type: 'image/jpeg', url: '/assets/brand/octopus-community.jpg' }],
    referenceFiles: [], tags: ['摄影'], tagIds: ['tag1'], prompt: '原提示词', body: '原作品简介', model: '', date: '2026-11-22T08:00:00Z',
    likes: 0, owned: role === 'owner', status: 'published', originalStatus: 'approved', saved: false, liked: false }]
  await page.route('**/api/users/3', route => route.fulfill({ json: { user: { id: '3', name: '原作者', username: 'original', bio: '', count: 1 } } }))
  for (const pattern of ['**/api/library**', '**/api/works?**', '**/api/admin/submissions?**']) await page.route(pattern, route => route.fulfill({ json: { items, nextCursor: null, pendingCount: 0 } }))
  await page.route('**/api/tags**', route => route.fulfill({ json: { items: [{ id: 'tag1', name: '摄影', category: 'image' }] } }))
  await page.route('**/api/uploads**', route => {
    const request = route.request(), url = new URL(request.url())
    uploads.push(url.pathname + url.search)
    if (url.pathname.endsWith('/limits')) return route.fulfill({ json: { maxFileSizeMb: 20, imagesMb: 20, videosMb: 20, filesMb: 20 } })
    expect(request.headers()['x-new-api-user']).toBe(role === 'owner' ? '3' : '42')
    return route.fulfill({ json: { file: { id: 'uploaded1', name: '新图片', type: 'image/jpeg', url: '/assets/brand/octopus-community.jpg' } } })
  })
  await page.route('**/api/works/work1', async route => {
    const request = route.request(), method = request.method()
    if (method === 'GET') return control.detailError ? route.fulfill({ status: 503, json: { message: '作品详情暂时不可用' } }) : route.fulfill({ json: { work: items[0] } })
    const body = request.postDataJSON()
    mutations.push({ method, body, expected: request.headers()['x-new-api-user'] })
    if (method === 'PATCH') {
      if (control.saveError) return route.fulfill({ status: 409, json: { message: '作品已变化，请刷新后重新核对。' } })
      Object.assign(items[0], body, { version: 3, revisionPending: control.pending })
      return route.fulfill({ json: { work: items[0] } })
    }
    if (control.deleteError) return route.fulfill({ status: 503, json: { message: '删除暂时失败，请重试。' } })
    items.splice(0)
    return route.fulfill({ json: { deleted: true } })
  })
  if (destination === 'admin') await page.route('**/api/admin/settings', route => route.fulfill({ json: { settings: { publicationMode: 'before', violationThreshold: 3, autoBan: true }, version: '1' } }))
  await page.goto(destination === 'admin' ? '/admin?tab=review' : '/community?creator=3')
  await expect(destination === 'admin' ? page.getByRole('link', { name: '光影作品', exact: true }) : page.locator('.profile-works .work-cover')).toBeVisible()
  return { ...account, control, mutations, uploads, errors, image, items }
}
const editor = (page: Page) => page.getByRole('dialog', { name: '编辑作品', exact: true })
const deletion = (page: Page) => page.getByRole('dialog', { name: '删除这件作品？', exact: true })

for (const width of [320, 390, 1440]) test(`owner directly edits and deletes profile work at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 320 ? 650 : 900 })
  await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode })), width === 390 ? 'light' : 'dark')
  const state = await fixture(page)
  const edit = page.getByRole('button', { name: '编辑作品：光影作品', exact: true })
  const remove = page.getByRole('button', { name: '删除作品：光影作品', exact: true })
  await expect(edit).toBeVisible(); await expect(remove).toBeVisible()
  expect((await edit.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect((await new AxeBuilder({ page }).include('.profile-works').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath(`profile-actions-${width}.png`), fullPage: true })
  await edit.focus(); await page.keyboard.press('Enter')
  await expect(editor(page).getByLabel('作品标题', { exact: true })).toHaveValue('光影作品')
  await editor(page).getByLabel('作品标题', { exact: true }).fill('修改后的作品')
  await editor(page).getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(editor(page)).not.toBeVisible()
  await expect(page.locator('.profile-works .work-cover')).toHaveAttribute('aria-label', /修改后的作品/)
  expect(state.mutations).toHaveLength(1); expect(state.mutations[0]).toMatchObject({ method: 'PATCH', expected: '3', body: { version: 2, fileIds: ['file1'], title: '修改后的作品' } })
  await page.getByRole('button', { name: '删除作品：修改后的作品', exact: true }).click()
  await expect(deletion(page)).toContainText('删除后无法恢复')
  await expect(deletion(page).getByRole('button', { name: '取消', exact: true })).toBeFocused()
  expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([])
  await page.screenshot({ path: test.info().outputPath(`delete-confirm-${width}.png`) })
  await deletion(page).getByRole('button', { name: '取消', exact: true }).click()
  expect(state.mutations).toHaveLength(1)
  await page.getByRole('button', { name: '删除作品：修改后的作品', exact: true }).click()
  await deletion(page).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.profile-works .work-card')).toHaveCount(0)
  expect(state.mutations[1]).toMatchObject({ method: 'DELETE', expected: '3', body: { version: 3 } })
  expect(state.errors).toEqual([])
})

for (const role of ['guest', 'visitor', 'moderator'] as const) test(`${role} cannot manage someone else's profile works`, async ({ page }) => {
  const state = await fixture(page, role)
  await expect(page.getByRole('button', { name: /^编辑作品：/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^删除作品：/ })).toHaveCount(0)
  expect(state.mutations).toEqual([])
})

for (const destination of ['profile', 'admin']) test(`administrator edits another author's work from ${destination} and uploads under that work`, async ({ page }) => {
  const state = await fixture(page, 'admin', destination)
  state.control.pending = true
  await page.getByRole('button', { name: '编辑作品：光影作品', exact: true }).click()
  await expect(editor(page).getByRole('button', { name: '保存修改', exact: true })).toBeEnabled()
  await editor(page).getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'updated.jpg', mimeType: 'image/jpeg', buffer: state.image })
  await editor(page).getByLabel('作品标题', { exact: true }).fill('管理员修改')
  await editor(page).getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(editor(page)).not.toBeVisible()
  expect(state.uploads).toContain('/api/uploads/limits?workId=work1'); expect(state.uploads).toContain('/api/uploads?workId=work1')
  expect(state.mutations[0]).toMatchObject({ method: 'PATCH', expected: '42', body: { fileIds: ['file1', 'uploaded1'], title: '管理员修改' } })
  expect(state.items[0].authorId).toBe('3')
  await page.getByRole('button', { name: '删除作品：管理员修改', exact: true }).click()
  await expect(deletion(page)).toContainText('管理员身份删除 原作者')
  await deletion(page).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(deletion(page)).not.toBeVisible()
  expect(state.mutations[1]).toMatchObject({ method: 'DELETE', expected: '42', body: { version: 3 } })
  expect(state.errors).toEqual([])
})

test('failed detail loading blocks saving and conflict preserves edited input', async ({ page }) => {
  const state = await fixture(page); state.control.detailError = true
  await page.getByRole('button', { name: '编辑作品：光影作品', exact: true }).click()
  await expect(editor(page).getByRole('alert')).toContainText('作品详情暂时不可用')
  await expect(editor(page).getByRole('button', { name: '保存修改', exact: true })).toBeDisabled()
  state.control.detailError = false
  await editor(page).getByRole('button', { name: '重新加载作品', exact: true }).click()
  await expect(editor(page).getByRole('button', { name: '保存修改', exact: true })).toBeEnabled()
  await editor(page).getByLabel('作品标题', { exact: true }).fill('保留我的输入')
  state.control.saveError = true
  await editor(page).getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(editor(page).getByRole('alert')).toContainText('作品已变化')
  await expect(editor(page).getByLabel('作品标题', { exact: true })).toHaveValue('保留我的输入')
  await editor(page).getByRole('button', { name: '关闭作品编辑', exact: true }).click()
  await page.getByRole('dialog', { name: '保留作品修改？', exact: true }).getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(editor(page).getByLabel('作品标题', { exact: true })).toHaveValue('保留我的输入')
  expect(state.mutations).toHaveLength(1)
})

test('failed deletion retains the work and retry requires another explicit submit', async ({ page }) => {
  const state = await fixture(page); state.control.deleteError = true
  await page.getByRole('button', { name: '删除作品：光影作品', exact: true }).click()
  await deletion(page).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(deletion(page).getByRole('alert')).toContainText('删除暂时失败')
  expect(state.items).toHaveLength(1); expect(state.mutations).toHaveLength(1)
  state.control.deleteError = false
  await deletion(page).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(deletion(page)).not.toBeVisible(); expect(state.mutations).toHaveLength(2)
})

test('administrator role loss closes work editing and deletion controls', async ({ page }) => {
  const state = await fixture(page, 'admin')
  await page.getByRole('button', { name: '编辑作品：光影作品', exact: true }).click()
  await expect(editor(page)).toBeVisible()
  state.state.user.isAdmin = false; state.state.user.isModerator = false
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(editor(page)).not.toBeVisible()
  await expect(page.getByRole('button', { name: /^编辑作品：/ })).toHaveCount(0)
  expect(state.mutations).toEqual([])
})
