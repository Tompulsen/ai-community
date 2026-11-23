import { expect, test, type Page } from '@playwright/test'
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
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { maxFileSizeMb: 100, imagesMb: 20, videosMb: 100, filesMb: 20 } }))
  await page.route('**/api/uploads', route => {
    const payload = route.request().postDataBuffer()?.toString() || ''
    const index = payload.includes('filename="second.jpg"') ? 2 : payload.includes('filename="first.jpg"') ? 1 : ++uploads
    return route.fulfill({ json: { file: { id: `file${index}`, name: `作品${index}`, type, url: '/simple-preview.jpg' } } })
  })
  await page.route('**/api/works', route => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON()
    writes.push(body)
    return route.fulfill({ json: { work: { id: 'submitted', status: body.status, title: body.title } } })
  })
  return { ...account, image, writes }
}

for (const width of [320, 390, 800, 1440]) {
  test(`simple editor keeps upload, title and submission visible at ${width}px`, async ({ page }) => {
    const state = await fixture(page)
    await page.setViewportSize({ width, height: width === 800 ? 560 : 740 })
    if (width === 800) await page.addInitScript(() => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode: 'light' })))
    await page.goto('/discover?publish=1')
    const form = editor(page)
    await expect(form.getByRole('combobox')).toHaveCount(0)
    await expect(form.getByRole('textbox')).toHaveCount(1)
    await expect(form.getByRole('button', { name: '提交审核', exact: true })).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`empty-editor-${width}.png`) })
    await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: state.image })
    await expect(form.locator('.attachment-preview img')).toBeVisible()
    const preview = await form.locator('.attachment-preview img').boundingBox()
    expect(preview!.width).toBeGreaterThan(150)
    expect(preview!.height).toBeGreaterThan(150)
    await form.getByLabel('作品标题', { exact: true }).fill('简单投稿')
    await expect(form.locator('.editor-extras')).not.toHaveAttribute('open')
    await form.getByRole('button', { name: '提交审核', exact: true }).click()
    await expect(form.getByRole('alert')).toHaveText('请至少选择 1 个作品标签后再发布。')
    expect(state.writes).toHaveLength(0)
    await expect(form.getByRole('checkbox', { name: '摄影', exact: true })).toBeFocused()
    for (const name of ['摄影', '插画', '角色']) await form.getByRole('checkbox', { name, exact: true }).check()
    await expect(form.getByRole('checkbox', { name: '海报', exact: true })).toBeDisabled()
    await expect(form.getByRole('button', { name: '提交审核', exact: true })).toBeInViewport()
    expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).include('.editor-dialog[open]').analyze()).violations).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`simple-editor-${width}.png`) })
    await form.getByRole('button', { name: '提交审核', exact: true }).click()
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
  await form.getByRole('button', { name: '提交审核', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ fileIds: ['file2'], referenceFileIds: ['file1'] })
})

for (const [type, kind, name] of [['video/mp4', 'video', 'video.mp4'], ['application/json', 'resource', 'workflow.json']]) {
  test(`explicit ${kind} publication selects its files and parameters`, async ({ page }) => {
    const state = await fixture(page, type)
    await page.goto('/discover?publish=1')
    const form = editor(page)
    await form.getByRole('radio', { name: kind === 'video' ? '视频' : '技能', exact: true }).check()
    if (kind === 'resource') {
      await form.getByLabel('适用工具（必填）', { exact: true }).fill('ComfyUI')
      await form.getByLabel('使用说明（必填）', { exact: true }).fill('导入工作流后运行')
      await form.getByLabel('安装方式（选填）', { exact: true }).fill('安装依赖并导入 JSON')
    } else {
      await form.getByText('补充信息（选填）', { exact: true }).click()
      await form.getByLabel('视频时长（秒）', { exact: true }).fill('8.001')
      await form.getByLabel('帧率（FPS）', { exact: true }).fill('23.976')
      await form.getByLabel('视频分辨率', { exact: true }).fill('1080p')
    }
    await form.getByLabel('添加作品文件', { exact: true }).setInputFiles({ name, mimeType: type, buffer: Buffer.from('fixture') })
    await expect(form.getByText(`${kind === 'video' ? '视频' : '技能'} · 1/16`, { exact: true })).toBeVisible()
    await form.getByLabel('作品标题', { exact: true }).fill('自动识别作品')
    await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
    await form.getByRole('button', { name: '提交审核', exact: true }).click()
    expect(state.writes[0]).toMatchObject({ kind, tags: ['摄影'], status: 'pending' })
    if (kind === 'resource') expect(state.writes[0]).toMatchObject({ skill: { platform: 'ComfyUI', installation: '安装依赖并导入 JSON' } })
    else expect(state.writes[0]).toMatchObject({ parameters: { kind: 'video', duration: 8.001, videoOptions: { resolution: '1080p', customParameters: '{"fps":23.976}' } } })
  })
}

test('link-based skill publication requires a tag while title-only drafts remain available', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/discover?publish=1')
  await editor(page).getByLabel('作品标题', { exact: true }).fill('待补充的草稿')
  await editor(page).getByRole('button', { name: '存为草稿', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ status: 'draft', fileIds: [], tags: [] })
  await page.goto('/discover?publish=1')
  await editor(page).getByRole('radio', { name: '技能', exact: true }).check()
  await editor(page).getByLabel('适用工具（必填）').fill('Claude Code')
  await editor(page).getByLabel('仓库 / 资源链接').fill('https://example.com/skill')
  await editor(page).getByLabel('使用说明（必填）', { exact: true }).fill('可以独立发布的资源正文')
  await editor(page).getByLabel('作品标题', { exact: true }).fill('纯文字资源')
  await editor(page).getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(editor(page).getByRole('alert')).toContainText('至少选择 1 个作品标签')
  expect(state.writes).toHaveLength(1)
  await editor(page).getByRole('checkbox', { name: '摄影', exact: true }).check()
  await editor(page).getByRole('button', { name: '提交审核', exact: true }).click()
  expect(state.writes[1]).toMatchObject({ kind: 'resource', body: '可以独立发布的资源正文', tags: ['摄影'], fileIds: [], status: 'pending' })
})

test('invalid optional URL reopens its section and preserves entered information', async ({ page }) => {
  await fixture(page)
  await page.goto('/discover?publish=1')
  const form = editor(page)
  await form.getByLabel('作品标题').fill('保留标题')
  await form.getByText('补充信息（选填）', { exact: true }).click()
  await form.getByLabel('来源链接').fill('invalid-url')
  await form.getByText('补充信息（选填）', { exact: true }).click()
  await form.getByRole('button', { name: '提交审核', exact: true }).click()
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
  await form.getByLabel('适用工具（必填）').fill('ComfyUI')
  await form.getByLabel('仓库 / 资源链接').fill('https://example.com/skill')
  await form.getByLabel('作品标题', { exact: true }).fill('待选标签')
  await form.getByLabel('使用说明（必填）', { exact: true }).fill('保留正文')
  await form.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(form.locator('#editor-tags-error')).toBeVisible()
  expect(state.writes).toHaveLength(0)
  await form.getByRole('button', { name: '存为草稿', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ status: 'draft', title: '待选标签', body: '保留正文', tags: [] })
  release()
  await page.route('**/api/tags**', route => route.fulfill({ json: { items: [{ id: 'fixed', name: '教程', category: 'resource' }] } }))
  await page.goto('/discover?publish=1')
  await form.getByRole('radio', { name: '技能', exact: true }).check()
  await form.getByLabel('适用工具（必填）').fill('ComfyUI')
  await form.getByLabel('仓库 / 资源链接').fill('https://example.com/skill')
  await form.getByLabel('作品标题', { exact: true }).fill('选择标签后发布')
  await form.getByLabel('使用说明（必填）', { exact: true }).fill('正文')
  await form.getByRole('checkbox', { name: '教程', exact: true }).check()
  await form.getByRole('button', { name: '提交审核', exact: true }).click()
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
  await form.getByLabel('适用工具（必填）').fill('ComfyUI')
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
  await expect(form.getByLabel('添加作品文件', { exact: true })).toHaveAttribute('accept', '.zip,.json,.md,.txt,.yaml,.yml')
  await expect(form.getByLabel('生成提示词', { exact: true })).toHaveCount(0)
  await form.getByRole('checkbox', { name: '摄影', exact: true }).check()
  await form.getByRole('button', { name: '提交审核', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('适用工具')
  expect(state.writes).toHaveLength(0)
  await form.getByLabel('适用工具（必填）').fill('Claude Code')
  await form.getByLabel('使用说明（必填）').fill('将技能安装后，根据描述使用。')
  await form.getByLabel('仓库 / 资源链接').fill('https://example.com/skills')
  await form.getByLabel('适用版本（选填）').fill('1.0+')
  await form.getByLabel('安装方式（选填）').fill('复制到 skills 目录')
  await form.getByRole('radio', { name: '图片', exact: true }).check()
  await expect(form.locator('.attachment-preview img')).toHaveCount(1)
  await expect(form.getByLabel('生成提示词', { exact: true })).toHaveValue('图片自己的提示词')
  await expect(form.getByLabel('画面尺寸', { exact: true })).toHaveValue('1024x1024')
  await form.getByRole('radio', { name: '技能', exact: true }).check()
  await expect(form.locator('.featured > li')).toHaveCount(0)
  await expect(form.getByLabel('安装方式（选填）')).toHaveValue('复制到 skills 目录')
  expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.editor-dialog[open]').analyze()).violations).toEqual([])
  await form.locator('.editor-scroll').evaluate(element => { element.scrollTop = 0 })
  await expect(form.getByRole('radio', { name: '技能', exact: true })).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath(`skill-${width}.png`) })
  await form.getByRole('button', { name: '提交审核', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ kind: 'resource', fileIds: [], parameters: null, prompt: '', body: '将技能安装后，根据描述使用。', skill: { platform: 'Claude Code', version: '1.0+', installation: '复制到 skills 目录' } })
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
  await expect(form.getByRole('alert')).toContainText('技能文件请选择')
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
  const skill = { platform: 'ComfyUI', version: '0.3+', installation: '解压后导入工作流' }
  const work = { id: 'publishedskill', title: '技能工作流', authorId: state.state.user.id, author: '作者', avatar: '作', version: 3,
    kind: 'resource', isSkill: true, status: 'published', files: [{ id: 'workflow1', name: 'workflow.json', type: 'application/json', url: '/workflow.json' }], fileIds: ['workflow1'],
    tags: ['摄影'], tagIds: ['resourcetag0'], body: '加载后运行', sourceUrl: '', prompt: '', model: '', owned: true, likes: 0, date: '2026-11-23', cover: '',
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
  await expect(form.getByLabel('适用工具（必填）')).toHaveValue('ComfyUI')
  await expect(form.getByLabel('适用版本（选填）')).toHaveValue('0.3+')
  await expect(form.getByRole('radio', { name: '图片', exact: true })).toBeDisabled()
  await expect(form.getByRole('radio', { name: '技能', exact: true })).toBeChecked()
  await form.getByLabel('作品标题').fill('更新技能标题')
  await form.getByRole('button', { name: '保存修改', exact: true }).click()
  expect(state.writes[0]).toMatchObject({ title: '更新技能标题', kind: 'resource', skill, fileIds: ['workflow1'], body: '加载后运行', version: 3 })
  expect(state.writes[0]).not.toHaveProperty('generation')
})
