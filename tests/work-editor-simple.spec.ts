import { expect, test, type Page, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

const editor = (page: Page) => page.getByRole('dialog', { name: '发布作品', exact: true })
async function fixture(page: Page, type = 'image/jpeg') {
  const account = await mockUnifiedAccount(page, true)
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const writes: Record<string, any>[] = []
  let uploads = 0
  await page.route('**/simple-preview.jpg', route => route.fulfill({ body: image, contentType: 'image/jpeg' }))
  await page.route('**/api/tags**', route => route.fulfill({ json: { items: ['image', 'video', 'resource'].flatMap(category => ['摄影', '插画', '角色', '海报'].map((name, index) => ({ id: `${category}tag${index}`, name, category }))) } }))
  await page.route('**/api/creation/models**', route => route.fulfill({ json: {
    groups: [{ id: 'text', name: '文本分组' }, { id: 'vip', name: '高级文本' }, { id: 'images', name: '图片分组' }, { id: 'videos', name: '视频分组' }],
    items: [{ id: 'chat-test', kinds: ['text'], groups: ['text'] }, { id: 'chat-vip', kinds: ['text'], groups: ['vip'] }, { id: 'gpt-image-2', kinds: ['image'], groups: ['text', 'images'] }, { id: 'sora-2', kinds: ['video'], groups: ['videos'] }, { id: 'custom-model', kinds: ['text'], configuredKind: 'image', groups: ['images'] }],
  } }))
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { maxFileSizeMb: 100, imagesMb: 20, videosMb: 100, filesMb: 20 } }))
  await page.route('**/api/uploads', route => {
    const payload = route.request().postDataBuffer()?.toString() || ''
    if (payload.includes('filename="SKILL.md"')) return route.fulfill({ json: { file: { id: 'skillsource', name: 'SKILL.md', type: 'text/plain', url: '/source.md' } } })
    if (payload.includes('filename="cover.png"')) return route.fulfill({ json: { file: { id: 'skillcover', name: 'cover.png', type: 'image/png', url: '/simple-preview.jpg' } } })
    const index = payload.includes('filename="second.jpg"') ? 2 : payload.includes('filename="first.jpg"') ? 1 : ++uploads
    return route.fulfill({ json: { file: { id: `file${index}`, name: `作品${index}`, type, url: '/simple-preview.jpg' } } })
  })
  await page.route('**/api/works', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON()
    writes.push(body)
    return route.fulfill({ json: { work: { id: 'submitted', status: body.status === 'draft' || body.skill ? body.status : 'approved', title: body.title } } })
  })
  return { ...account, image, writes }
}

async function configureSkill(form: Locator, image: Buffer) {
  await form.getByRole('combobox', { name: '模型分组（必选）', exact: true }).selectOption('text')
  await form.getByRole('combobox', { name: '文本模型（必选）', exact: true }).selectOption('chat-test')
  await form.getByLabel('上传技能封面', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: image })
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'SKILL.md', mimeType: 'text/plain', buffer: Buffer.from('---\nname: helper\ndescription: Helper\n---\nHelp the user.') })
  await expect(form.getByText('SKILL.md', { exact: true })).toBeVisible()
}

async function prepareModerationSubmission(page: Page, image: Buffer) {
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: image })
  await form.getByLabel('作品标题', { exact: true }).fill('等待修改的作品')
  await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
  return form
}

for (const width of [390, 1440]) test(`moderation rejection preserves a new work and requires correction before retry at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode })), width === 390 ? 'dark' : 'light')
  const state = await fixture(page)
  await page.route('**/api/works', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON(); state.writes.push(body)
    return state.writes.length === 1
      ? route.fulfill({ status: 422, json: { error: { code: 'WORK_MODERATION_REJECTED', message: '检测到疑似色情或裸露内容，暂不能发布。请修改后重试，或联系管理员复核。' } } })
      : route.fulfill({ json: { work: { id: 'submitted', title: body.title, status: 'approved' } } })
  })
  const form = await prepareModerationSubmission(page, state.image)
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  const notice = form.getByRole('alert', { name: '发布被拦截', exact: true })
  await expect(notice).toContainText('暂不能发布作品')
  await expect(notice).toContainText('本次提交已被拦截，作品未公开。')
  await expect(notice).toContainText('检测到疑似色情或裸露内容')
  await expect(notice).toBeFocused()
  await expect(notice).toBeInViewport()
  await expect(form.getByLabel('作品标题', { exact: true })).toHaveValue('等待修改的作品')
  await expect(form.getByLabel('作品标题', { exact: true })).toBeEnabled()
  await expect(form.locator('.attachment-preview img')).toHaveCount(1)
  await expect(form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ })).toBeDisabled()
  await form.locator('form').evaluate((element: HTMLFormElement) => element.requestSubmit())
  expect(state.writes).toHaveLength(1)
  expect((await new AxeBuilder({ page }).include('.editor-dialog[open]').analyze()).violations).toEqual([])
  expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath(`moderation-new-work-${width}.png`) })
  await notice.getByRole('button', { name: '修改作品信息', exact: true }).click()
  await expect(notice).toHaveCount(0)
  await expect(form.getByLabel('作品标题', { exact: true })).toBeFocused()
  await form.getByLabel('作品标题', { exact: true }).fill('修改后的作品')
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  await expect(form).not.toBeVisible()
  await expect(page).toHaveURL(/\/library\?tab=all$/)
  await expect(page.getByText('作品已保存。', { exact: true })).toBeVisible()
  expect(state.writes).toHaveLength(2)
  expect(state.writes[1]).toMatchObject({ title: '修改后的作品', idempotencyKey: state.writes[0]!.idempotencyKey, fileIds: state.writes[0]!.fileIds })
})

test('moderation rejection on a published edit preserves original work and clears after editing', async ({ page }) => {
  const state = await fixture(page)
  const work = { id: 'moderatededit', title: '原来的公开作品', authorId: state.state.user.id, author: '测试创作者', avatar: '测', version: 4,
    kind: 'image', status: 'published', files: [{ id: 'original', name: 'original.jpg', type: 'image/jpeg', url: '/simple-preview.jpg' }],
    fileIds: ['original'], tags: ['摄影'], tagIds: ['imagetag0'], body: '原简介', prompt: '原提示词', model: '', owned: true, likes: 0, date: '2026-11-27', cover: '/simple-preview.jpg' }
  await page.route('**/api/library**', route => route.fulfill({ json: { items: [work], nextCursor: null } }))
  await page.route('**/api/works/moderatededit', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { work } })
    state.writes.push(route.request().postDataJSON())
    return route.fulfill({ status: 422, json: { error: { code: 'WORK_MODERATION_REJECTED', message: '作品文字或图片文字包含社区禁止发布的内容，请修改后重试，或联系管理员复核。' } } })
  })
  await page.goto('/library')
  await page.getByRole('button', { name: '编辑作品：原来的公开作品', exact: true }).click()
  const form = page.getByRole('dialog', { name: '编辑作品', exact: true })
  await form.getByLabel('作品标题', { exact: true }).fill('本次修改的作品')
  await form.getByRole('button', { name: '保存修改', exact: true }).click()
  const notice = form.getByRole('alert', { name: '发布被拦截', exact: true })
  await expect(notice).toContainText('暂不能发布修改')
  await expect(notice).toContainText('本次修改未发布，原作品保持不变。')
  await expect(notice).not.toContainText('作品未公开')
  await expect(notice).toBeFocused()
  await expect(form.getByLabel('作品标题', { exact: true })).toHaveValue('本次修改的作品')
  await expect(form.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled()
  await page.screenshot({ path: test.info().outputPath('moderation-published-edit.png') })
  await form.getByLabel('作品标题', { exact: true }).fill('重新修改的作品')
  await expect(notice).toHaveCount(0)
  await expect(form.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled()
  expect(state.writes).toHaveLength(1)
  expect(work.title).toBe('原来的公开作品')
})

test('ordinary errors and changed moderation rules never appear as a rejected work', async ({ page }) => {
  const state = await fixture(page)
  let failure = { status: 404, code: 'WORK_MODERATION_REJECTED', message: '记录不存在，请刷新后重试。' }
  await page.route('**/api/works', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    state.writes.push(route.request().postDataJSON())
    return route.fulfill({ status: failure.status, json: { error: { code: failure.code, message: failure.message } } })
  })
  const form = await prepareModerationSubmission(page, state.image)
  for (const scenario of [failure, { status: 409, code: 'WORK_MODERATION_CHANGED', message: '审核规则已更新，请重新提交作品。' },
    { status: 503, code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试。' }, { status: 422, code: 'OTHER_VALIDATION', message: '请检查作品资料。' }]) {
    failure = scenario
    await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
    await expect(form.getByRole('alert')).toHaveText(scenario.message)
    await expect(form.locator('.work-moderation-notice')).toHaveCount(0)
    await expect(form.getByLabel('作品标题', { exact: true })).toHaveValue('等待修改的作品')
    await expect(form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ })).toBeEnabled()
  }
  expect(state.writes).toHaveLength(4)
})

test('moderation rejection clears when the editor closes or the account changes', async ({ page }) => {
  const state = await fixture(page)
  await page.route('**/api/works', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 422, json: { error: { code: 'WORK_MODERATION_REJECTED', message: '测试审核拒绝。' } } }) : route.fallback())
  let form = await prepareModerationSubmission(page, state.image)
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  await expect(form.locator('.work-moderation-notice')).toBeVisible()
  await form.getByRole('button', { name: '关闭作品编辑', exact: true }).click()
  await page.getByRole('dialog', { name: '保留作品修改？', exact: true }).getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(form).not.toBeVisible()
  await page.getByRole('link', { name: '投稿', exact: true }).click()
  form = editor(page)
  await expect(form).toBeVisible()
  await expect(form.locator('.work-moderation-notice')).toHaveCount(0)
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: state.image })
  await form.getByLabel('作品标题', { exact: true }).fill('再次提交')
  await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  await expect(form.locator('.work-moderation-notice')).toBeVisible()
  state.state.user.id = 'another-account'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(form).not.toBeVisible()
  await expect(page.locator('.work-moderation-notice')).toHaveCount(0)
})

for (const width of [320, 390, 800, 1440]) {
  test(`simple editor keeps upload, title and submission visible at ${width}px`, async ({ page }) => {
    const state = await fixture(page)
    await page.setViewportSize({ width, height: width === 800 ? 560 : 740 })
    if (width === 800) await page.addInitScript(() => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode: 'light' })))
    await page.goto('/discover?publish=1')
    const form = editor(page)
    await expect(form.getByRole('combobox')).toHaveCount(0)
    await expect(form.getByRole('textbox')).toHaveCount(1)
    await expect(form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ })).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`empty-editor-${width}.png`) })
    await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: state.image })
    await expect(form.locator('.attachment-preview img')).toBeVisible()
    const preview = await form.locator('.attachment-preview img').boundingBox()
    expect(preview!.width).toBeGreaterThan(150)
    expect(preview!.height).toBeGreaterThan(150)
    await form.getByLabel('作品标题', { exact: true }).fill('简单投稿')
    await expect(form.locator('.editor-extras')).not.toHaveAttribute('open')
    await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
    await expect(form.getByRole('alert')).toHaveText('请至少选择 1 个作品标签后再发布。')
    expect(state.writes).toHaveLength(0)
    await expect(form.getByRole('checkbox', { name: '摄影', exact: true })).toBeFocused()
    for (const name of ['摄影', '插画', '角色']) await form.getByRole('checkbox', { name, exact: true }).check()
    await expect(form.getByRole('checkbox', { name: '海报', exact: true })).toBeDisabled()
    await expect(form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ })).toBeInViewport()
    expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('.editor-dialog[open]').analyze()).violations).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`simple-editor-${width}.png`) })
    await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
    expect(state.writes[0]).toMatchObject({ title: '简单投稿', kind: 'image', tags: ['摄影', '插画', '角色'], fileIds: ['file1'], status: 'pending' })
  })
}

test('media layout retains file ordering and public reference selection on mobile', async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width: 390, height: 740 })
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles([
    { name: 'first.jpg', mimeType: 'image/jpeg', buffer: state.image },
    { name: 'second.jpg', mimeType: 'image/jpeg', buffer: state.image },
  ])
  await expect(form.locator('.featured > li')).toHaveCount(2)
  await form.locator('.featured > li').first().getByRole('button', { name: '向后移动' }).click()
  await expect(form.locator('.attachment-preview')).toHaveAttribute('aria-label', '查看 作品2')
  await form.locator('.featured > li').last().getByRole('button', { name: '移至参考图' }).click()
  await expect(form.locator('.editor-extras')).toHaveAttribute('open')
  await expect(form.getByRole('region', { name: '参考图', exact: true }).getByRole('button', { name: '移至作品文件' })).toBeVisible()
  await form.getByLabel('作品标题', { exact: true }).fill('保留作品与参考图')
  await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  expect(state.writes[0]).toMatchObject({ fileIds: ['file2'], referenceFileIds: ['file1'] })
})

test('explicit video publication selects its files and parameters', async ({ page }) => {
  const state = await fixture(page, 'video/mp4')
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await form.getByRole('radio', { name: '视频', exact: true }).check()
  await form.getByText('补充信息（选填）', { exact: true }).click()
  await form.getByLabel('视频时长（秒）', { exact: true }).fill('8.001')
  await form.getByLabel('帧率（FPS）', { exact: true }).fill('23.976')
  await form.getByLabel('视频分辨率', { exact: true }).fill('1080p')
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fixture') })
  await expect(form.getByText('视频 · 1/16', { exact: true })).toBeVisible()
  await form.getByLabel('作品标题', { exact: true }).fill('视频作品')
  await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  expect(state.writes[0]).toMatchObject({ kind: 'video', tags: ['摄影'], status: 'pending', parameters: { kind: 'video', duration: 8.001, videoOptions: { resolution: '1080p', customParameters: '{"fps":23.976}' } } })
})

test('skill source links cannot replace the cover and package; title-only drafts remain available', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/discover?publish=1')
  await editor(page).getByLabel('作品标题', { exact: true }).fill('待补充的草稿')
  await editor(page).getByRole('button', { name: '存为草稿', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ status: 'draft', fileIds: [], tags: [] })
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await form.getByRole('radio', { name: '技能', exact: true }).check()
  await form.getByLabel('仓库 / 资源链接').fill('https://example.com/skill')
  await form.getByLabel('使用说明（必填）', { exact: true }).fill('技能使用说明')
  await form.getByLabel('作品标题', { exact: true }).fill('我的技能')
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  await expect(form.getByRole('alert')).toContainText('封面')
  await form.getByLabel('上传技能封面', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: state.image })
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  await expect(form.getByRole('alert')).toContainText('SKILL.md')
  await configureSkill(form, state.image)
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  await expect(form.getByRole('alert')).toContainText('至少选择 1 个作品标签')
  expect(state.writes).toHaveLength(1)
  await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
  await form.getByRole('radio', { name: /^不公开技能/ }).check()
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  expect(state.writes[1]).toMatchObject({ kind: 'resource', model: 'chat-test', tags: ['摄影'], fileIds: ['skillcover', 'skillsource'], status: 'pending', skill: { group: 'text', coverFileId: 'skillcover', sourcePublic: false } })
})

test('invalid optional URL reopens its section and preserves entered information', async ({ page }) => {
  await fixture(page)
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await form.getByLabel('作品标题').fill('保留标题')
  await form.getByText('补充信息（选填）', { exact: true }).click()
  await form.getByLabel('来源链接').fill('invalid-url')
  await form.getByText('补充信息（选填）', { exact: true }).click()
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  await expect(form.getByLabel('来源链接')).toBeVisible()
  await expect(form.getByLabel('来源链接')).toBeFocused()
  await expect(form.getByLabel('作品标题')).toHaveValue('保留标题')
})

for (const unavailable of ['empty', 'error', 'loading']) test(`editor blocks ${unavailable} tags, retains a draft and recovers on reload`, async ({ page }) => {
  const state = await fixture(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/tags**', async route => {
    if (unavailable === 'loading') await gate
    await route.fulfill(unavailable === 'error' ? { status: 503, json: { message: '暂不可用' } } : { json: { items: [] } })
  })
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await form.getByRole('radio', { name: '技能', exact: true }).check()
  await configureSkill(form, state.image)
  await form.getByLabel('仓库 / 资源链接').fill('https://example.com/skill')
  await form.getByLabel('作品标题', { exact: true }).fill('待选标签')
  await form.getByLabel('使用说明（必填）', { exact: true }).fill('保留正文')
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  await expect(form.locator('#editor-tags-error')).toBeVisible()
  expect(state.writes).toHaveLength(0)
  await form.getByRole('button', { name: '存为草稿', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ status: 'draft', title: '待选标签', body: '保留正文', tags: [] })
  release()
  await page.route('**/api/tags**', route => route.fulfill({ json: { items: [{ id: 'fixed', name: '教程', category: 'resource' }] } }))
  await page.goto('/discover?publish=1')
  await form.getByRole('radio', { name: '技能', exact: true }).check()
  await configureSkill(form, state.image)
  await form.getByLabel('仓库 / 资源链接').fill('https://example.com/skill')
  await form.getByLabel('作品标题', { exact: true }).fill('选择标签后发布')
  await form.getByLabel('使用说明（必填）', { exact: true }).fill('正文')
  await form.getByRole('checkbox', { name: '教程', exact: true }).check()
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  expect(state.writes[1]).toMatchObject({ status: 'pending', tags: ['教程'] })
})

test('a saved empty draft reloads tag choices and accepts a video or text content', async ({ page }) => {
  const state = await fixture(page, 'video/mp4')
  const work = { id: 'emptydraft', title: '待补充的草稿', authorId: state.state.user.id, author: '测试创作者', avatar: '测', version: 4,
    kind: 'image', status: 'draft', files: [], fileIds: [], tags: [], body: '', prompt: '', model: '', owned: true, likes: 0, date: '2026-11-19', cover: '' }
  await page.route('**/api/library**', route => route.fulfill({ json: { items: [work], nextCursor: null } }))
  await page.route('**/api/works/emptydraft', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { work } })
    const body = route.request().postDataJSON(); state.writes.push(body)
    return route.fulfill({ json: { work: { ...work, ...body } } })
  })
  await page.goto('/library?tab=draft')
  await page.getByRole('button', { name: '编辑作品：待补充的草稿', exact: true }).click()
  const form = page.getByRole('dialog', { name: '编辑作品', exact: true })
  await expect(form.getByLabel('作品标题')).toBeEnabled()
  await form.getByText('补充信息（选填）', { exact: true }).click()
  await expect(form.getByRole('checkbox', { name: '摄影', exact: true })).toBeVisible()
  await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
  await form.getByRole('radio', { name: '技能', exact: true }).check()
  await form.getByLabel('模型分组（必选）').selectOption('text')
  await form.getByLabel('文本模型（必选）').selectOption('chat-test')
  await form.getByLabel('仓库 / 资源链接').fill('https://example.com/skill')
  await expect(form.getByRole('button', { name: '移除标签 摄影（图片）', exact: true })).toBeVisible()
  await form.getByLabel('使用说明（必填）').fill('保留的文字')
  await form.getByRole('radio', { name: '视频', exact: true }).check()
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'result.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fixture') })
  await expect(form.getByText('视频 · 1/16', { exact: true })).toBeVisible()
  await expect(form.getByRole('button', { name: '移除标签 摄影（图片）', exact: true })).toBeVisible()
  await form.getByRole('button', { name: '保存修改', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ kind: 'video', body: '', version: 4, status: 'pending', fileIds: ['file1'] })
})

test('pending source comments can be edited without choosing community tags', async ({ page }) => {
  const state = await fixture(page)
  const work = { id: 'pendingcomment', destination: 'source-comment', title: '同款评论', authorId: state.state.user.id,
    author: '测试创作者', avatar: '测', version: 1, kind: 'resource', status: 'pending', files: [], fileIds: [], tags: [],
    body: '我的同款文字', prompt: '原提示词', model: '原模型', owned: true, likes: 0, date: '2026-11-21', cover: '' }
  await page.route('**/api/library**', route => route.fulfill({ json: { items: [work], nextCursor: null } }))
  await page.route('**/api/works/pendingcomment', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { work } })
    const body = route.request().postDataJSON(); state.writes.push(body)
    return route.fulfill({ json: { work: { ...work, ...body } } })
  })
  await page.goto('/library')
  await page.getByRole('button', { name: '编辑作品：同款评论', exact: true }).click()
  const form = page.getByRole('dialog', { name: '编辑作品', exact: true })
  await expect(form.getByLabel('作品标题')).toBeEnabled()
  await expect(form.locator('.editor-tags')).toHaveCount(0)
  await form.getByLabel('资源内容').fill('修改后的同款文字')
  await form.getByRole('button', { name: '保存修改', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ body: '修改后的同款文字', tags: [], version: 1 })
})

test('adding a document to an existing image preserves its type and collapsed metadata', async ({ page }) => {
  const state = await fixture(page, 'application/pdf')
  const work = { id: 'publishedimage', title: '已有图片', authorId: state.state.user.id, author: '测试创作者', avatar: '测', version: 4,
    kind: 'image', status: 'published', files: [{ id: 'original', name: 'original.jpg', type: 'image/jpeg', url: '/simple-preview.jpg' }],
    fileIds: ['original'], referenceFiles: [{ id: 'reference', name: 'ref.jpg', type: 'image/jpeg', url: '/simple-preview.jpg' }],
    tags: ['摄影'], body: '原简介', prompt: '原提示词', model: '原模型', sourceUrl: 'https://example.com/source', license: 'CC0',
    owned: true, likes: 0, date: '2026-11-19', cover: '/simple-preview.jpg', generation: { parameters: { version: 1, kind: 'image', size: '1024x1024', group: 'vip' } } }
  await page.route('**/api/library**', route => route.fulfill({ json: { items: [work], nextCursor: null } }))
  await page.route('**/api/works/publishedimage', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { work } })
    const body = route.request().postDataJSON(); state.writes.push(body)
    return route.fulfill({ json: { work: { ...work, ...body } } })
  })
  await page.goto('/library')
  await page.getByRole('button', { name: '编辑作品：已有图片', exact: true }).click()
  const form = page.getByRole('dialog', { name: '编辑作品', exact: true })
  await expect(form.getByLabel('作品标题')).toBeEnabled()
  await expect(form.locator('.editor-extras')).not.toHaveAttribute('open')
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'guide.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture') })
  await expect(form.getByText('图片 · 2/16', { exact: true })).toBeVisible()
  await form.getByRole('button', { name: '保存修改', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ kind: 'image', body: '原简介', prompt: '原提示词', model: '原模型', tags: ['摄影'],
    sourceUrl: 'https://example.com/source', license: 'CC0', version: 4, fileIds: ['original', 'file1'], referenceFileIds: ['reference'] })
  expect(state.writes[0]).not.toHaveProperty('generation')
  expect(state.writes[0].parameters).toEqual(work.generation.parameters)
})


test('editing duplicate tag names preserves their exact ids and allows other admin categories', async ({ page }) => {
  const state = await fixture(page)
  const catalog = [{ id: 'image-photo', name: '摄影', category: 'image' }, { id: 'video-photo', name: '摄影', category: 'video' }, { id: 'resource-guide', name: '新增教程', category: 'resource' }]
  const work = { id: 'alltagswork', title: '保留同名标签', authorId: state.state.user.id, author: '作者', avatar: '作', version: 3,
    kind: 'resource', status: 'draft', files: [], fileIds: [], tags: ['摄影', '摄影'], tagIds: ['image-photo', 'video-photo'], body: '资源正文', prompt: '', model: '', owned: true, likes: 0, date: '2026-11-22', cover: '' }
  await page.route('**/api/tags**', route => route.fulfill({ json: { items: catalog } }))
  await page.route('**/api/library**', route => route.fulfill({ json: { items: [work], nextCursor: null } }))
  await page.route('**/api/works/alltagswork', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { work } })
    const body = route.request().postDataJSON(); state.writes.push(body)
    return route.fulfill({ json: { work: { ...work, ...body } } })
  })
  await page.goto('/library?tab=draft')
  const open = page.getByRole('button', { name: '编辑作品：保留同名标签', exact: true })
  await open.click()
  const form = page.getByRole('dialog', { name: '编辑作品', exact: true })
  await expect(form.getByRole('button', { name: '移除标签 摄影（图片）', exact: true })).toBeVisible()
  await expect(form.getByRole('button', { name: '移除标签 摄影（视频）', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(form).toBeHidden()
  await open.click()
  await form.getByRole('button', { name: '移除标签 摄影（视频）', exact: true }).click()
  await form.getByRole('checkbox', { name: '新增教程', exact: true }).check()
  await form.getByRole('button', { name: '保存修改', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ kind: 'resource', tagIds: ['image-photo', 'resource-guide'], tags: ['摄影', '新增教程'], version: 3 })
})

for (const width of [320, 390, 1440]) test(`skill form is usable with required information and independent type drafts at ${width}px`, async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width, height: 800 })
  if (width === 390) await page.addInitScript(() => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode: 'light' })))
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await expect(form.getByRole('radio')).toHaveCount(3)
  await form.getByLabel('作品标题').fill('可复用的技能')
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: state.image })
  await expect(form.getByRole('radio', { name: '技能', exact: true })).toBeEnabled()
  await form.getByText('补充信息（选填）', { exact: true }).click()
  await form.getByLabel('生成提示词', { exact: true }).fill('图片自己的提示词')
  await form.getByLabel('画面尺寸', { exact: true }).fill('1024x1024')
  await form.getByRole('radio', { name: '技能', exact: true }).check()
  await expect(form.getByLabel('添加作品文件', { exact: true })).toHaveAttribute('accept', '.md,.zip')
  await expect(form.getByLabel('生成提示词', { exact: true })).toHaveCount(0)
  await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  await expect(form.getByRole('alert')).toContainText('封面')
  expect(state.writes).toHaveLength(0)
  await configureSkill(form, state.image)
  await expect(form.getByLabel('模型分组（必选）').locator('option[value="images"]')).toHaveCount(0)
  await expect(form.getByLabel('文本模型（必选）').locator('option[value="gpt-image-2"]')).toHaveCount(0)
  await form.getByLabel('使用说明（必填）').fill('将技能安装后，根据描述使用。')
  await form.getByLabel('仓库 / 资源链接').fill('https://example.com/skills')
  await form.getByLabel('适用版本（选填）').fill('1.0+')
  await form.getByLabel('安装方式（选填）').fill('复制到 skills 目录')
  await form.getByRole('radio', { name: '图片', exact: true }).check()
  await expect(form.locator('.attachment-preview img')).toHaveCount(1)
  await expect(form.getByLabel('生成提示词', { exact: true })).toHaveValue('图片自己的提示词')
  await expect(form.getByLabel('画面尺寸', { exact: true })).toHaveValue('1024x1024')
  await form.getByRole('radio', { name: '技能', exact: true }).check()
  await expect(form.locator('.featured > li')).toHaveCount(2)
  await expect(form.getByLabel('安装方式（选填）')).toHaveValue('复制到 skills 目录')
  expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.editor-dialog[open]').analyze()).violations).toEqual([])
  await form.locator('.editor-scroll').evaluate(element => { element.scrollTop = 0 })
  await expect(form.getByRole('radio', { name: '技能', exact: true })).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath(`skill-${width}.png`) })
  await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
  expect(state.writes[0]).toMatchObject({ kind: 'resource', fileIds: ['skillcover', 'skillsource'], parameters: null, prompt: '', body: '将技能安装后，根据描述使用。', skill: { platform: 'chat-test', group: 'text', coverFileId: 'skillcover', sourcePublic: true, version: '1.0+', installation: '复制到 skills 目录' } })
})

test('wrong file types are rejected and hidden unsaved type content keeps the leave guard active', async ({ page }) => {
  await fixture(page)
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fixture') })
  await expect(form.getByRole('alert')).toContainText('请选择图片文件')
  await form.getByRole('radio', { name: '图片', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(form.getByRole('radio', { name: '视频', exact: true })).toBeChecked()
  await page.keyboard.press('ArrowRight')
  await expect(form.getByRole('radio', { name: '技能', exact: true })).toBeChecked()
  await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'program.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('fixture') })
  await expect(form.getByRole('alert')).toContainText('SKILL.md 或 ZIP')
  await form.getByLabel('使用说明（必填）').fill('未保存的技能说明')
  await form.getByRole('radio', { name: '图片', exact: true }).check()
  await form.getByRole('button', { name: '关闭作品编辑', exact: true }).click()
  const leave = page.getByRole('dialog', { name: '保留作品修改？', exact: true })
  await expect(leave).toBeVisible()
  await leave.getByRole('button', { name: '继续编辑', exact: true }).click()
  await form.getByRole('radio', { name: '技能', exact: true }).check()
  await expect(form.getByLabel('使用说明（必填）')).toHaveValue('未保存的技能说明')
})

test('editing a published skill restores its metadata and saves a partial revision without changing its type', async ({ page }) => {
  const state = await fixture(page)
  const skill = { platform: 'chat-test', group: 'text', coverFileId: 'cover1', sourcePublic: true, version: '0.3+', installation: '导入 SKILL.md' }
  const work = { id: 'publishedskill', title: '技能工作流', authorId: state.state.user.id, author: '作者', avatar: '作', version: 3,
    kind: 'resource', isSkill: true, status: 'published', files: [{ id: 'cover1', name: 'cover.png', type: 'image/png', url: '/simple-preview.jpg' }, { id: 'workflow1', name: 'SKILL.md', type: 'text/plain', url: '/source.md' }], fileIds: ['cover1', 'workflow1'],
    tags: ['摄影'], tagIds: ['resourcetag0'], body: '加载后运行', sourceUrl: '', prompt: '', model: 'chat-test', owned: true, likes: 0, date: '2026-11-23', cover: '',
    generation: { skill } }
  await page.route('**/api/library**', route => route.fulfill({ json: { items: [work], nextCursor: null } }))
  await page.route('**/api/works/publishedskill', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { work } })
    const body = route.request().postDataJSON(); state.writes.push(body)
    return route.fulfill({ json: { work: { ...work, ...body } } })
  })
  await page.goto('/library')
  await page.getByRole('button', { name: '编辑作品：技能工作流', exact: true }).click()
  const form = page.getByRole('dialog', { name: '编辑作品', exact: true })
  await expect(form.getByLabel('模型分组（必选）')).toHaveValue('text')
  await expect(form.getByLabel('文本模型（必选）')).toHaveValue('chat-test')
  await expect(form.getByLabel('适用版本（选填）')).toHaveValue('0.3+')
  await expect(form.getByRole('radio', { name: '图片', exact: true })).toBeDisabled()
  await expect(form.getByRole('radio', { name: '技能', exact: true })).toBeChecked()
  await form.getByLabel('作品标题').fill('更新技能标题')
  await form.getByRole('button', { name: '保存修改', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ title: '更新技能标题', kind: 'resource', skill, fileIds: ['cover1', 'workflow1'], body: '加载后运行', version: 3 })
  expect(state.writes[0]).not.toHaveProperty('generation')
})


for (const [kind, label, group, model, width] of [['image', '图片', 'images', 'gpt-image-2', 320], ['video', '视频', 'videos', 'sora-2', 1440]] as const) {
  test(`skill publication selects ${kind} groups and models at ${width}px`, async ({ page }, info) => {
    const state = await fixture(page)
    await page.setViewportSize({ width, height: 900 }); await page.goto('/discover?publish=1')
    const form = editor(page)
    await form.getByRole('radio', { name: '技能', exact: true }).check()
    await configureSkill(form, state.image)
    await form.getByLabel('作品标题', { exact: true }).fill('视觉创作技能')
    await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
    await form.getByLabel('使用说明（必填）').fill('根据要求生成画面。')
    await form.getByLabel('适用模型类型（必选）').selectOption(kind)
    await expect(form.getByLabel(`${label}模型（必选）`)).toHaveValue('')
    await expect(form.getByLabel('模型分组（必选）').locator('option[value="vip"]')).toHaveCount(0)
    await form.getByLabel('模型分组（必选）').selectOption(group)
    await expect(form.getByLabel(`${label}模型（必选）`).locator('option[value="chat-test"]')).toHaveCount(0)
    if (kind === 'image') await expect(form.getByLabel(`${label}模型（必选）`).locator('option[value="custom-model"]')).toHaveCount(1)
    await form.getByLabel(`${label}模型（必选）`).selectOption(model)
    await form.getByRole('radio', { name: '图片', exact: true }).check()
    await form.getByRole('radio', { name: '技能', exact: true }).check()
    await expect(form.getByLabel('适用模型类型（必选）')).toHaveValue(kind)
    await expect(form.getByLabel(`${label}模型（必选）`)).toHaveValue(model)
    expect((await new AxeBuilder({ page }).include('.editor-dialog[open]').analyze()).violations).toEqual([])
    expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await form.getByLabel('适用模型类型（必选）').scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`skill-${kind}-${width}.png`) })
    await form.getByRole('button', { name: /^(检查并公开|提交技能审核)$/ }).click()
    expect(state.writes[0]).toMatchObject({ model, skill: { kind, group, sourcePublic: true }, status: 'pending' })
  })
}
