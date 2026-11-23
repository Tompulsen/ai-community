import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fillAccountLogin, mockUnifiedAccount } from './helpers/account-fixture'
import type { CommunitySkill } from '../shared/community-skills'

const body = '---\nname: composition\ndescription: 分析画面并提供构图建议\n---\n先分析主体与光线，再提供可执行的构图建议。'
const checksum = createHash('sha256').update(body).digest('hex')
const fixtureSkill: CommunitySkill = { id: 'skill01', authorId: 'anotherAuthor', authorName: '创作者小雨', name: '画面构图助手', description: '从主体、光线和层次出发，为照片与 AI 作品提供具体的构图建议。', status: 'published', official: false, version: 1, sha256: checksum, filename: 'composition.zip', size: 2680,
  files: [{ path: 'composition/SKILL.md', bytes: 210 }, { path: 'composition/references/guide.md', bytes: 2048 }, { path: 'composition/scripts/example.py', bytes: 422 }], body, createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z' }
async function fixture(page: Page, loggedIn = true, admin = false) {
  const account = await mockUnifiedAccount(page, loggedIn)
  account.state.user.isAdmin = admin
  const state = { skills: [structuredClone(fixtureSkill)], delay: 0, conflict: false, failure: false }
  const calls: { method: string; path: string; body: any }[] = []
  await page.route(/\/api\/(?:admin\/)?skills(?:[/?]|$)/, async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), path = url.pathname
    const data = method === 'GET' ? {} : request.postDataJSON()
    const id = path.split('/').at(-1)!, management = path.includes('/admin/')
    if (state.failure) return route.fulfill({ status: 503, json: { error: { message: '技能服务暂时不可用' } } })
    if (method !== 'GET') calls.push({ method, path, body: data })
    if (id === 'inspect') {
      const delay = state.delay; if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      return route.fulfill({ json: { body, name: 'composition', description: '分析画面并提供构图建议', files: fixtureSkill.files } })
    }
    if (method === 'GET' && id === 'skills') {
      let skills = state.skills.filter(skill => management ? url.searchParams.get('status') === 'all' || skill.status === url.searchParams.get('status') : url.searchParams.get('scope') === 'mine' ? skill.authorId === account.state.user.id : skill.status === 'published')
      const query = url.searchParams.get('query') || ''
      skills = skills.filter(skill => `${skill.name} ${skill.description}`.includes(query))
      return route.fulfill({ json: { items: skills, nextCursor: null } })
    }
    if (method === 'GET') {
      const skill = state.skills.find(skill => skill.id === id)
      return skill ? route.fulfill({ json: { skill } }) : route.fulfill({ status: 404, json: { message: '技能不存在或尚未公开。' } })
    }
    if (state.conflict) return route.fulfill({ status: 409, json: { message: '技能已被修改，请刷新后重新审核。' } })
    if (id === 'review') {
      const skill = state.skills.find(skill => skill.id === path.split('/').at(-2))!
      skill.status = data.action === 'approve' ? 'published' : data.action === 'reject' ? 'rejected' : 'removed'; skill.reviewNote = data.reason; skill.version++
    } else if (method === 'DELETE') state.skills = state.skills.filter(skill => skill.id !== id)
    else if (method === 'PATCH') Object.assign(state.skills.find(skill => skill.id === id)!, data, { status: management && data.publish ? 'published' : 'pending', version: data.version + 1 })
    else state.skills.push({ ...structuredClone(fixtureSkill), ...data, id: 'newskill', authorId: account.state.user.id, status: management && data.publish ? 'published' : 'pending', official: management })
    return route.fulfill({ json: { id: 'newskill' } })
  })
  return { account, state, calls }
}
const dialog = (page: Page) => page.getByRole('dialog', { name: /上传技能|编辑技能|画面构图助手|composition/ })
const upload = (page: Page, name = 'SKILL.md') => page.getByLabel('技能文件', { exact: true }).setInputFiles({ name, mimeType: name.endsWith('.zip') ? 'application/zip' : 'text/markdown', buffer: Buffer.from(body) })

test('community tools open the public square and guests return after login', async ({ page }) => {
  await fixture(page, false)
  await page.goto('/community')
  await page.getByTitle('社区工具', { exact: true }).click()
  await page.getByRole('link', { name: '技能广场', exact: true }).click()
  await expect(page).toHaveURL(/\/skills$/)
  await expect(page.getByRole('heading', { name: '技能广场', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '登录上传', exact: true }).click()
  await fillAccountLogin(page)
  await expect(page).toHaveURL(/\/skills$/)
  await expect(page.getByRole('button', { name: '上传技能', exact: true })).toBeVisible()
})
for (const filename of ['SKILL.md', 'composition.zip']) test(`user uploads ${filename}, previews files and submits for review`, async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/skills'); await page.getByRole('button', { name: '上传技能', exact: true }).click()
  await upload(page, filename)
  await expect(dialog(page).getByLabel('展示名称')).toHaveValue('composition')
  await dialog(page).getByLabel('展示名称').fill('我的构图技能')
  await dialog(page).getByText('包内文件 · 3 个').click()
  await expect(dialog(page).getByText('composition/scripts/example.py', { exact: true })).toBeVisible()
  await dialog(page).getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(dialog(page)).toBeHidden()
  await expect(page.locator('.skill-card')).toContainText('待审核')
  const saved = calls.find(call => call.path === '/api/skills')!
  expect(saved.body.upload.filename).toBe(filename); expect(saved.body.publish).toBeUndefined()
  expect(saved.body.requestId).toMatch(/^[0-9a-f-]{36}$/)
  await page.getByRole('button', { name: '发现技能', exact: true }).click()
  await expect(page.locator('.skill-card')).not.toContainText('我的构图技能')
})
test('published owner edit warns about re-review; cancellation retains the unsaved form', async ({ page }) => {
  const { state, account, calls } = await fixture(page); state.skills[0]!.authorId = account.state.user.id
  await page.goto('/skills'); await page.getByRole('button', { name: '编辑技能：画面构图助手' }).click()
  await expect(dialog(page)).toContainText('已发布的技能会暂时从广场和创作台隐藏')
  await dialog(page).getByLabel('SKILL.md 内容', { exact: true }).fill('')
  await expect(dialog(page).getByLabel('SKILL.md 内容', { exact: true })).toBeVisible()
  await expect(dialog(page).getByRole('button', { name: '提交审核', exact: true })).toBeDisabled()
  await dialog(page).getByLabel('SKILL.md 内容', { exact: true }).fill(body)
  await dialog(page).getByLabel('技能简介', { exact: true }).fill('更新的技能简介')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '放弃修改', exact: true }).getByRole('button', { name: '继续编辑' }).click()
  await expect(dialog(page).getByLabel('技能简介', { exact: true })).toHaveValue('更新的技能简介')
  await dialog(page).getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(page.locator('.skill-card')).toContainText('待审核')
  expect(calls.find(call => call.method === 'PATCH')!.body.version).toBe(1)
})
test('admin reviews actual detail version, requires reasons and preserves conflict feedback', async ({ page }) => {
  const { state, calls } = await fixture(page, true, true); state.skills[0]!.status = 'pending'
  await page.goto('/admin?tab=skills')
  await expect(page.getByRole('heading', { name: '技能管理', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看与审核', exact: true }).click()
  await dialog(page).getByRole('button', { name: '驳回投稿', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('请填写审核或下架原因')
  expect(calls).toHaveLength(0)
  state.conflict = true
  await dialog(page).getByRole('button', { name: '通过并发布', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('技能已被修改')
  state.conflict = false
  await dialog(page).getByRole('button', { name: '通过并发布', exact: true }).click()
  await expect(dialog(page)).toBeHidden()
  await expect(page.getByText('当前没有待处理的技能', { exact: true })).toBeVisible()
  await page.getByLabel('审核状态').selectOption('published')
  await page.getByRole('button', { name: '查看与审核', exact: true }).click()
  await dialog(page).getByLabel('审核 / 下架原因（驳回、下架时必填）').fill('配套文件待修订')
  await dialog(page).getByRole('button', { name: '下架技能', exact: true }).click()
  await expect(dialog(page)).toBeHidden()
  expect(calls.at(-1)!.body).toEqual({ version: 2, action: 'remove', reason: '配套文件待修订' })
})
test('admin uploads and edits a skill directly, with an option to leave it pending', async ({ page }) => {
  const { calls } = await fixture(page, true, true)
  await page.goto('/admin?tab=skills'); await page.getByRole('button', { name: '上传技能', exact: true }).click()
  await upload(page, 'composition.zip')
  await expect(dialog(page).getByLabel('保存后直接发布至技能广场')).toBeChecked()
  await dialog(page).getByRole('button', { name: '保存技能', exact: true }).click()
  await expect(dialog(page)).toBeHidden()
  expect(calls.find(call => call.path === '/api/admin/skills')!.body.publish).toBe(true)
  await page.getByLabel('审核状态').selectOption('published')
  await page.getByRole('button', { name: '编辑技能：composition', exact: true }).click()
  await dialog(page).getByLabel('保存后直接发布至技能广场').uncheck()
  await dialog(page).getByRole('button', { name: '保存技能', exact: true }).click()
  await expect(dialog(page)).toBeHidden()
  expect(calls.at(-1)!.body.publish).toBe(false)
})
test('account change discards in-flight upload inspection and private drafts', async ({ page }) => {
  const { state, account, calls } = await fixture(page)
  await page.goto('/skills'); await page.getByRole('button', { name: '上传技能', exact: true }).click()
  state.delay = 800; await upload(page)
  await expect.poll(() => calls.length).toBe(1)
  account.state.user = { ...account.state.user, id: 'changedUser', accountId: '18' }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(dialog(page)).toBeHidden()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '上传技能', exact: true }).click()
  await expect(dialog(page).getByLabel('SKILL.md 内容', { exact: true })).toHaveCount(0)
  expect(calls.filter(call => call.path === '/api/skills')).toHaveLength(0)
})
test('oversized files fail locally; search and server error have distinct recovery states', async ({ page }) => {
  const { state, calls } = await fixture(page)
  await page.goto('/skills'); await page.getByRole('button', { name: '上传技能', exact: true }).click()
  await page.getByLabel('技能文件').setInputFiles({ name: 'huge.zip', mimeType: 'application/zip', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
  await expect(dialog(page).getByRole('alert')).toContainText('不超过 5 MB'); expect(calls).toHaveLength(0)
  await dialog(page).getByRole('button', { name: '关闭技能窗口' }).click()
  await page.getByLabel('搜索技能', { exact: true }).fill('missing')
  await page.getByRole('search').filter({ has: page.getByLabel('搜索技能', { exact: true }) }).getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.getByText('没有找到相关技能', { exact: true })).toBeVisible()
  state.failure = true; await page.getByRole('button', { name: '刷新技能广场' }).click()
  await expect(page.locator('.community-skills').getByRole('alert')).toContainText('技能服务暂时不可用')
  state.failure = false; await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByText('没有找到相关技能', { exact: true })).toBeVisible()
})
test('a private detail response cannot reopen or populate the dialog after an account change', async ({ page }) => {
  const { account, state } = await fixture(page)
  state.skills[0]!.authorId = account.state.user.id; state.skills[0]!.status = 'pending'
  let requested = false
  await page.route('**/api/skills/skill01', async route => {
    requested = true; await new Promise(resolve => setTimeout(resolve, 800))
    return route.fulfill({ json: { skill: state.skills[0] } })
  })
  await page.goto('/skills'); await page.getByRole('button', { name: '我的上传', exact: true }).click()
  await page.getByRole('button', { name: '查看技能', exact: true }).click()
  await expect.poll(() => requested).toBe(true)
  account.state.user = { ...account.state.user, id: 'changedUser', accountId: '18' }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.skill-dialog[open]')).toHaveCount(0)
  await page.waitForTimeout(900)
  await expect(page.locator('.skill-dialog[open]')).toHaveCount(0)
  await expect(page.locator('.skill-preview')).toHaveCount(0)
})
test('community skills are revalidated before every send and withdrawal blocks stale cached use', async ({ page }) => {
  const { state } = await fixture(page)
  const generated: any[] = []
  let catalogReads = 0
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }] } })
    if (path.endsWith('/skills/catalog')) { catalogReads++; return route.fulfill({ json: { items: state.skills.filter(skill => skill.status === 'published').map(skill => ({ ...skill, id: `community-${skill.id}`, body: '' })) } }) }
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/generate')) generated.push(route.request().postDataJSON())
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ text: '已完成构图分析' }], tokenId: 41, protocol: 'sync' } })
  })
  await page.goto('/create/text'); await page.getByRole('button', { name: '技能与工具', exact: true }).click()
  await page.getByLabel('画面构图助手', { exact: true }).check()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('分析这幅画')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('已完成构图分析')
  expect(generated[0].chatOptions.messages.some((message: any) => message.role === 'system' && message.content.includes('先分析主体与光线'))).toBe(true)
  state.skills[0]!.status = 'removed'
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('再次分析')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant').last()).toContainText('部分技能尚未读取')
  expect(generated).toHaveLength(1); expect(catalogReads).toBeGreaterThanOrEqual(3)
  await page.getByRole('button', { name: '技能与工具', exact: true }).click()
  await page.getByRole('button', { name: '移除失效技能', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('不使用技能继续对话')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => generated.length).toBe(2)
  expect(generated[1].chatOptions.messages.some((message: any) => message.role === 'system' && message.content.includes('先分析主体与光线'))).toBe(false)
})
for (const [width, theme] of [[320, 'light'], [390, 'dark'], [1440, 'light']] as const) test(`square, detail and editor are accessible at ${width} ${theme}`, async ({ page }, info) => {
  await fixture(page)
  await page.setViewportSize({ width, height: 900 }); await page.goto('/skills')
  await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), theme)
  await expect(page.locator('.skill-card')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.community-skills').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath(`square-${width}-${theme}.png`), fullPage: true })
  await page.getByRole('button', { name: '查看技能', exact: true }).click()
  await expect(dialog(page).getByLabel('技能文本内容')).toContainText('先分析主体')
  expect((await new AxeBuilder({ page }).include('.skill-dialog[open]').analyze()).violations).toEqual([])
  await dialog(page).getByRole('button', { name: '关闭技能窗口' }).click()
  await page.getByRole('button', { name: '上传技能', exact: true }).click(); await upload(page)
  await expect(dialog(page).getByLabel('展示名称')).toHaveValue('composition')
  expect((await new AxeBuilder({ page }).include('.skill-dialog[open]').analyze()).violations).toEqual([])
  expect(await dialog(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath(`editor-${width}-${theme}.png`), fullPage: true })
})
