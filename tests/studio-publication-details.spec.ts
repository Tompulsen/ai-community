import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, kind: 'image' | 'video' | 'text' = 'image', legacy = false, catalog?: { id: string; name: string; category: string }[]) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const submissions: any[] = [], uploads: string[] = []
  let reject = 0, rejectCode = '', failTags = false, removedTag = ''
  const category = kind === 'text' ? 'resource' : kind
  await page.route('**/api/tags**', route => failTags ? route.fulfill({ status: 503, json: { message: '标签暂时不可用' } }) : route.fulfill({ json: { items: (catalog ?? ['动物', '摄影', '插画', '风景'].map((name, i) => ({ id: `tag${i}`, name, category }))).filter(tag => tag.id !== removedTag && (!new URL(route.request().url()).searchParams.get('kind') || tag.category === new URL(route.request().url()).searchParams.get('kind'))) } }))
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'fixture-model', kinds: [kind] }] } })
    if (path.endsWith('/media')) return route.fulfill({ body: image, contentType: kind === 'video' && new URL(route.request().url()).searchParams.get('kind') === 'video' ? 'video/mp4' : 'image/jpeg' })
    return route.fulfill({ json: { items: [] } })
  })
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { maxFileSizeMb: 100, imagesMb: 20, videosMb: 100, filesMb: 20 } }))
  await page.route('**/api/uploads', route => {
    uploads.push(route.request().postData() || '')
    return route.fulfill({ json: { file: { id: `upload${uploads.length}`, name: 'file.jpg', type: 'image/jpeg', url: `/files/upload${uploads.length}`, size: image.length } } })
  })
  await page.route('**/api/works', route => {
    const body = route.request().postDataJSON(); submissions.push(body)
    if (reject) { const status = reject; reject = 0; return route.fulfill({ status, json: { code: rejectCode, message: rejectCode === 'WORK_MODERATION_REJECTED' ? '作品包含敏感词，请修改后重新提交。' : status === 400 ? '所选标签已失效' : '连接中断，请重试' } }) }
    return route.fulfill({ json: { work: { id: 'published1', title: body.title, status: 'pending' } } })
  })
  await page.addInitScript(({ kind, legacy }) => {
    if (sessionStorage.getItem('publication-seeded')) return
    sessionStorage.setItem('publication-seeded', '1')
    const task = { id: 'publication-case', conversationId: 'publication-chat', owner: '17', kind, phase: 'complete', model: 'fixture-model', protocol: 'sync', prompt: '原始小猫提示词', text: kind === 'text' ? '完整文本生成内容' : '', urls: kind === 'text' ? [] : ['https://media.example/output.jpg'], references: [{ name: '第一张参考图', url: 'https://media.example/ref1.jpg' }, { name: '第二张参考图', url: 'https://media.example/ref2.jpg' }], createdAt: Date.now(), request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 }, ...(legacy ? { publications: { community: { title: '旧标题', text: '旧说明' } } } : {}) }
    localStorage.setItem('octopus:user-17:native-creation-history:fallback', JSON.stringify([task]))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: { _hasHydrated: true, activeId: 'publication-chat', mediaConversationsMigrated: true, sessions: [{ id: 'publication-chat', mediaConversationId: 'publication-chat', creationKind: kind, topic: '小猫创作', model: 'fixture-model', settings: {}, skillIds: [], messages: [] }] } }))
  }, { kind, legacy })
  await page.goto('/create/' + kind)
  await expect(page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })).toBeVisible()
  if (kind !== 'text') await page.getByRole('button', { name: '发布作品', exact: true }).click()
  else {
    // Text history uses the same dialog; open its completed record without another paid generation.
    await page.evaluate(async () => {
      const { createApp, h, ref } = await import('/node_modules/.vite/deps/vue.js')
      const { createRouter, createMemoryHistory } = await import('/node_modules/.vite/deps/vue-router.js')
      const { default: Dialog } = await import('/src/components/StudioPublishDialog.vue')
      const { readTaskSnapshot } = await import('/src/studio-task-store.ts')
      const node = document.createElement('div'); document.body.append(node)
      const component = ref(), app = createApp({ render: () => h(Dialog, { ref: component }) })
      app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] }))
      app.mount(node)
      await component.value.open((await readTaskSnapshot('17')).find(task => task.id === 'publication-case'))
    })
  }
  return { submissions, uploads, rejectNext: (status: number, code = '') => { reject = status; rejectCode = code }, failTags: (value: boolean) => { failTags = value }, removeTag: (id: string) => { removedTag = id } }
}
const dialog = (page: Page) => page.getByRole('dialog', { name: '发布作品', exact: true })
async function choose(page: Page) {
  if (await dialog(page).locator('.publish-extras').getAttribute('open') === null) await dialog(page).getByText('补充信息（选填）', { exact: true }).click()
  await dialog(page).getByRole('button', { name: '# 动物', exact: true }).click()
  await dialog(page).getByRole('checkbox', { name: '我确认拥有作品发布权，并已核实所填写的来源与授权说明。', exact: true }).check()
}

for (const width of [320, 390, 1440]) test(`publication fields submit selected tags and references separately from the original task at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page)
  if (width === 320) await page.evaluate(() => (window as any).communityAppearance.set({ mode: 'light' }))
  const form = dialog(page)
  await expect(form.getByRole('textbox', { name: '作品简介', exact: true })).toBeHidden()
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('至少选择 1 个作品标签')
  await expect(form.getByRole('button', { name: '# 动物', exact: true })).toBeFocused()
  expect(state.uploads).toHaveLength(0)
  await choose(page)
  await expect(form.getByRole('textbox', { name: '作品简介', exact: true })).toHaveValue('')
  await expect(form.getByRole('textbox', { name: '生成提示词（选填）', exact: true })).toHaveValue('原始小猫提示词')
  await form.getByRole('button', { name: '# 摄影', exact: true }).click()
  await form.getByRole('button', { name: '# 插画', exact: true }).click()
  await expect(form.getByRole('button', { name: '# 风景', exact: true })).toBeDisabled()
  await form.getByRole('button', { name: '# 插画', exact: true }).click()
  await form.getByRole('textbox', { name: '作品简介', exact: true }).fill('窗边的小猫，柔和自然光')
  await form.getByRole('textbox', { name: '生成提示词（选填）', exact: true }).fill('公开的小猫提示词')
  await form.getByRole('checkbox', { name: '第一张参考图', exact: true }).uncheck()
  await form.getByRole('textbox', { name: '来源链接', exact: true }).fill('https://example.com/source')
  await form.getByRole('textbox', { name: '授权说明', exact: true }).fill('署名分享')
  await form.evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: test.info().outputPath(`form-${width}.png`) })
  expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.studio-publish-dialog[open]').analyze()).violations).toEqual([])
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('作品已提交审核。')
  expect(state.submissions[0]).toMatchObject({ title: '原始小猫提示词', body: '窗边的小猫，柔和自然光', prompt: '公开的小猫提示词', tagIds: ['tag0', 'tag1'], sourceUrl: 'https://example.com/source', license: '署名分享', generation: { prompt: '公开的小猫提示词', model: 'fixture-model', referenceFileIds: ['upload2'] } })
  expect(state.uploads).toHaveLength(2)
  expect(await page.evaluate(async () => { const store = await import('/src/studio-task-store.ts'); return (await store.readTaskSnapshot('17')).find(task => task.id === 'publication-case').prompt })).toBe('原始小猫提示词')
})

test('failed response freezes new publication metadata for reload retries without reuploading', async ({ page }) => {
  const state = await fixture(page)
  await choose(page)
  await dialog(page).getByRole('checkbox', { name: '第一张参考图', exact: true }).uncheck()
  state.rejectNext(503)
  await dialog(page).getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('连接中断')
  await expect(dialog(page).getByRole('textbox', { name: '作品标题', exact: true })).toBeDisabled()
  const result = await page.evaluate(async () => {
    const store = await import('/src/studio-task-store.ts')
    const task = (await store.readTaskSnapshot('17')).find(task => task.id === 'publication-case')
    return task.publications.community.details
  })
  expect(result.referenceIndices).toEqual([1])
  await page.reload()
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(dialog(page).getByRole('textbox', { name: '作品标题', exact: true })).toBeDisabled()
  await dialog(page).getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(dialog(page).getByRole('status')).toHaveText('作品已提交审核。')
  expect(state.submissions[1]).toEqual(state.submissions[0])
  expect(state.uploads).toHaveLength(2)
})

test('confirmed moderation rejection keeps publication fields editable and permits a corrected retry', async ({ page }) => {
  const state = await fixture(page)
  const form = dialog(page)
  await choose(page)
  await form.getByRole('textbox', { name: '作品标题', exact: true }).fill('需要修改的标题')
  state.rejectNext(422, 'WORK_MODERATION_REJECTED')
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('作品包含敏感词')
  await expect(form.getByRole('textbox', { name: '作品标题', exact: true })).toBeEnabled()
  await expect(form.getByRole('textbox', { name: '生成提示词（选填）', exact: true })).toBeEnabled()
  await expect(form.getByRole('textbox', { name: '作品标题', exact: true })).toHaveValue('需要修改的标题')
  await form.getByRole('textbox', { name: '作品标题', exact: true }).fill('修改后的安全标题')
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('status')).toContainText('作品已提交审核')
  expect(state.submissions).toHaveLength(2)
  expect(state.submissions[1].title).toBe('修改后的安全标题')
  expect(state.submissions[1].fileIds).toEqual(state.submissions[0].fileIds)
  expect(state.submissions[1].idempotencyKey).toBe(state.submissions[0].idempotencyKey)
})

test('old publication retries retain the old payload without requiring new fields', async ({ page }) => {
  const state = await fixture(page, 'image', true)
  await dialog(page).getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(dialog(page).getByRole('status')).toHaveText('作品已提交审核。')
  expect(state.submissions[0]).toMatchObject({ title: '旧标题', body: '旧说明', prompt: '原始小猫提示词', tags: [], generation: { referenceFileIds: ['upload2', 'upload3'] } })
  expect(state.submissions[0].tagIds).toBeUndefined()
})

test('invalid URL and confirmed tag rejection remain editable while preserving outputs', async ({ page }) => {
  const state = await fixture(page)
  await choose(page)
  const form = dialog(page)
  await form.getByRole('textbox', { name: '来源链接', exact: true }).fill('https://user:pass@example.com/')
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('不能包含登录信息')
  await expect(form.getByRole('textbox', { name: '作品标题', exact: true })).toBeEnabled()
  expect(state.uploads).toHaveLength(0)
  await form.getByRole('textbox', { name: '来源链接', exact: true }).fill('')
  state.rejectNext(400)
  state.removeTag('tag0')
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('已失效')
  await expect(form.getByRole('textbox', { name: '作品标题', exact: true })).toBeEnabled()
  await expect(form.getByRole('button', { name: '# 动物', exact: true })).toHaveCount(0)
  await form.getByRole('button', { name: '# 摄影', exact: true }).click()
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('作品已提交审核。')
  expect(state.submissions[1].tagIds).toEqual(['tag1'])
})

for (const kind of ['video', 'text'] as const) test(`${kind} uses its category and keeps generation content`, async ({ page }) => {
  const state = await fixture(page, kind)
  await choose(page)
  await dialog(page).getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(dialog(page).getByRole('status')).toHaveText('作品已提交审核。')
  expect(state.submissions[0].kind).toBe(kind === 'text' ? 'resource' : kind)
  expect(state.submissions[0].tagIds).toEqual(['tag0'])
  if (kind === 'text') expect(state.submissions[0].body).toBe('完整文本生成内容')
})

test('tag loading failure preserves input and supports a retry before publication', async ({ page }) => {
  const state = await fixture(page)
  await page.getByRole('button', { name: '关闭发布作品', exact: true }).click()
  state.failTags(true)
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await dialog(page).getByText('补充信息（选填）', { exact: true }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('标签加载失败')
  await dialog(page).getByRole('textbox', { name: '作品标题', exact: true }).fill('保留我的作品标题')
  state.failTags(false)
  await dialog(page).getByRole('button', { name: '重新加载标签', exact: true }).click()
  await choose(page)
  await expect(dialog(page).getByRole('textbox', { name: '作品标题', exact: true })).toHaveValue('保留我的作品标题')
  await dialog(page).getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(dialog(page).getByRole('status')).toHaveText('作品已提交审核。')
})

for (const width of [320, 390, 1440]) test(`publication requires a visible tag before uploading at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page)
  const form = dialog(page)
  await expect(form.locator('.publish-extras')).not.toHaveAttribute('open')
  expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.studio-publish-dialog[open]').analyze()).violations).toEqual([])
  await form.evaluate(element => { element.scrollTop = 0 })
  await page.screenshot({ path: test.info().outputPath(`required-tags-studio-${width}.png`) })
  await expect(form.locator('.publish-extras summary')).toContainText('含提示词 · 2 张公开参考图')
  await form.getByRole('checkbox', { name: '我确认拥有作品发布权，并已核实所填写的来源与授权说明。', exact: true }).check()
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('至少选择 1 个作品标签')
  expect(state.submissions).toHaveLength(0)
  expect(state.uploads).toHaveLength(0)
  await form.getByRole('button', { name: '# 动物', exact: true }).click()
  await expect(form.getByRole('alert')).toHaveCount(0)
  await expect(form.locator('.publish-extras')).not.toHaveAttribute('open')
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('作品已提交审核。')
  expect(state.submissions[0]).toMatchObject({ tagIds: ['tag0'], prompt: '原始小猫提示词', generation: { referenceFileIds: ['upload2', 'upload3'] } })
})

test('a legacy unaccepted publication unlocks only after confirmed missing-tag rejection', async ({ page }) => {
  const state = await fixture(page, 'image', true)
  const form = dialog(page)
  state.rejectNext(400, 'WORK_TAGS_REQUIRED')
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('textbox', { name: '作品标题', exact: true })).toBeEnabled()
  await expect(form.getByRole('button', { name: '# 动物', exact: true })).toBeEnabled()
  await choose(page)
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('作品已提交审核。')
  expect(state.submissions[1].tagIds).toEqual(['tag0'])
  expect(state.submissions[1].idempotencyKey).toBe(state.submissions[0].idempotencyKey)
  expect(state.submissions[1].fileIds).toEqual(state.submissions[0].fileIds)
})

test('an ordinary validation error on a legacy retry keeps its content frozen', async ({ page }) => {
  const state = await fixture(page, 'image', true)
  const form = dialog(page)
  state.rejectNext(400)
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('已失效')
  await expect(form.getByRole('textbox', { name: '作品标题', exact: true })).toBeDisabled()
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('作品已提交审核。')
  expect(state.submissions[1]).toEqual(state.submissions[0])
})

test('an empty studio tag list blocks publication and supports reloading available tags', async ({ page }) => {
  const state = await fixture(page)
  await page.getByRole('button', { name: '关闭发布作品', exact: true }).click()
  const empty = (route: any) => route.fulfill({ json: { items: [] } })
  await page.route('**/api/tags**', empty)
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  const form = dialog(page)
  await expect(form.getByText('暂无可用标签，请联系管理员添加后再发布。')).toBeVisible()
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.locator('#publish-tags-error')).toContainText('至少选择 1 个作品标签')
  expect(state.submissions).toHaveLength(0); expect(state.uploads).toHaveLength(0)
  await page.unroute('**/api/tags**', empty)
  await form.getByRole('button', { name: '重新加载标签', exact: true }).click()
  await choose(page)
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('作品已提交审核。')
})


test('more publication tags searches every admin category and submits the exact selected ids', async ({ page }) => {
  const catalog = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `image${i}`, name: i === 0 ? '摄影' : `图片标签${i}`, category: 'image' })),
    { id: 'video-photo', name: '摄影', category: 'video' },
    { id: 'video-edit', name: '镜头剪辑', category: 'video' },
    { id: 'resource-last', name: '管理员新增教程', category: 'resource' },
  ]
  const state = await fixture(page, 'image', false, catalog)
  const form = dialog(page)
  await expect(form.getByRole('button', { name: '更多标签（15）', exact: true })).toBeVisible()
  await expect(form.getByRole('button', { name: '# 图片标签11', exact: true })).toBeHidden()
  await form.getByRole('button', { name: '更多标签（15）', exact: true }).click()
  await form.getByRole('group', { name: '视频标签', exact: true }).getByRole('button', { name: '# 摄影', exact: true }).click()
  await form.getByRole('searchbox', { name: '搜索全部标签', exact: true }).fill('管理员新增')
  await form.getByRole('button', { name: '# 管理员新增教程', exact: true }).click()
  await expect(form.getByRole('button', { name: '移除标签 摄影（视频）', exact: true })).toBeVisible()
  await form.getByRole('searchbox', { name: '搜索全部标签', exact: true }).fill('不存在')
  await expect(form.getByText('没有匹配的标签，试试其他关键词。', { exact: true })).toBeVisible()
  await form.getByRole('button', { name: '收起标签', exact: true }).click()
  await expect(form.getByRole('button', { name: '移除标签 管理员新增教程（文本 · 代码 · Skill）', exact: true })).toBeVisible()
  await form.getByRole('button', { name: '# 摄影', exact: true }).click()
  await expect(form.getByRole('button', { name: '# 图片标签1', exact: true })).toBeDisabled()
  await form.getByRole('checkbox', { name: '我确认拥有作品发布权，并已核实所填写的来源与授权说明。', exact: true }).check()
  await form.getByRole('button', { name: '更多标签（15）', exact: true }).click()
  await form.getByRole('searchbox', { name: '搜索全部标签', exact: true }).fill('摄影')
  await form.getByRole('searchbox', { name: '搜索全部标签', exact: true }).press('Enter')
  await expect(form.getByRole('searchbox', { name: '搜索全部标签', exact: true })).toBeFocused()
  expect(state.submissions).toHaveLength(0)
  await form.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(form.getByRole('status')).toHaveText('作品已提交审核。')
  expect(state.submissions[0].tagIds).toEqual(['video-photo', 'resource-last', 'image0'])
})


test('expanded all-category tags remain accessible and scroll within the publication dialog', async ({ page }) => {
  const catalog = ['image', 'video', 'resource'].flatMap(category => Array.from({ length: 16 }, (_, index) => ({ id: `${category}${index}`, category, name: `${category === 'image' ? '图片' : category === 'video' ? '视频' : '资源'}标签${index}` })))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await fixture(page, 'image', false, catalog)
  const form = dialog(page), more = form.getByRole('button', { name: '更多标签（48）', exact: true })
  await more.focus(); await page.keyboard.press('Enter')
  await expect(form.getByRole('button', { name: '收起标签', exact: true })).toHaveAttribute('aria-expanded', 'true')
  for (const [width, theme] of [[320, 'light'], [390, 'dark'], [1440, 'light']] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), theme)
    await form.getByRole('searchbox', { name: '搜索全部标签', exact: true }).fill('标签15')
    const last = form.getByRole('button', { name: '# 资源标签15', exact: true })
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeVisible()
    await last.click()
    await form.getByRole('button', { name: '移除标签 资源标签15（文本 · 代码 · Skill）', exact: true }).click()
    expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('.studio-publish-dialog[open]').analyze()).violations).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`all-tags-${width}-${theme}.png`) })
  }
  await form.getByRole('button', { name: '# 资源标签15', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(form.getByRole('button', { name: '移除标签 资源标签15（文本 · 代码 · Skill）', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
