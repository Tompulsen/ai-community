import { mkdir, readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { Work } from '../src/data'

async function openGroupPicker(page: Page) {
  await page.getByRole('combobox', { name: '模型', exact: true }).click()
  return page.getByRole('dialog', { name: '选择模型', exact: true })
}

async function fixture(page: Page, kind: 'image' | 'video' | 'resource' = 'image') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  const source: Work = { id: 'source42', title: '原作海底城市', authorId: '26', author: '原作者', avatar: '原', kind, prompt: '海底城市与发光的水母', model: `fixture-${kind === 'resource' ? 'text' : kind}`, version: 1, tags: [], status: 'published', date: '2026-11-13', likes: 0, owned: false, saved: false, liked: false,
    fileIds: ['authorResult'], cover: '/legacy-files/authorResult', files: [{ id: 'authorResult', name: '原作成品.jpg', type: 'image/jpeg', url: '/legacy-files/authorResult' }],
    referenceFiles: [1, 2].map(n => ({ id: `authorRef${n}`, name: `作者参考图${n}.jpg`, type: 'image/jpeg', url: `/legacy-files/authorRef${n}` })) }
  const generated: any[] = [], submitted: any[] = [], saved = new Map<string, any>()
  let uploads = 0, loseResponse = false, unavailable = false
  await page.route('**/legacy-files/**', route => route.fulfill({ body: photo, contentType: 'image/jpeg' }))
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { maxFileSizeMb: 100, imagesMb: 20, videosMb: 100, filesMb: 20 } }))
  await page.route('**/api/uploads', route => { uploads++; return route.fulfill({ json: { file: { id: `upload${uploads}`, name: 'uploaded.jpg', type: 'image/jpeg', url: `/legacy-files/upload${uploads}`, size: photo.length } } }) })
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { items: ['image', 'video', 'text'].map(kind => ({ id: `fixture-${kind}`, kinds: [kind] })) } })
    if (path === '/api/creation/media') return route.fulfill({ body: photo, contentType: 'image/jpeg' })
    if (path === '/api/creation/generate') {
      const body = route.request().postDataJSON(); generated.push(body)
      return route.fulfill({ json: { status: 'succeeded', outputs: body.kind === 'text' ? [{ text: '水母点亮了海底城市。' }] : [{ url: `https://media.example/result.${body.kind === 'video' ? 'mp4' : 'jpg'}` }] } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.route('**/api/works**', route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'POST' && path === '/api/works') {
      const body = route.request().postDataJSON(); submitted.push(body)
      if (unavailable) return route.fulfill({ status: 404, json: { message: '源作品已不可访问。' } })
      expect([...body.fileIds, ...body.generation.referenceFileIds].every(id => /^upload\d+$/.test(id))).toBe(true)
      const key = `${body.destination}:${body.resultId}`
      const previous = saved.get(key)
      if (previous) expect(body).toEqual(previous.body)
      const work = previous?.work || { ...source, id: `shared${saved.size + 1}`, noteId: `note${saved.size + 1}`, title: body.title, status: 'published', owned: true }
      saved.set(key, { body, work })
      if (loseResponse) { loseResponse = false; return route.fulfill({ status: 503, json: { message: '连接中断，请重试。' } }) }
      return route.fulfill({ json: { work } })
    }
    if (path === '/api/works/source42') return route.fulfill({ json: { work: source } })
    if (path === '/api/works/sourceB') return route.fulfill({ json: { work: { ...source, id: 'sourceB', title: '原作森林', prompt: '森林里的萤火虫', referenceFiles: [] } } })
    if (path.startsWith('/api/works/shared')) return route.fulfill({ json: { work: [...saved.values()].find(value => path.endsWith(value.work.id))?.work } })
    return route.fulfill({ json: { items: [], viewsCount: 1 } })
  })
  return { ...account, source, photo, generated, submitted, saved, uploads: () => uploads, loseNextResponse: () => { loseResponse = true }, hideSource: () => { unavailable = true } }
}

test('remix starts with the prompt only, keeps selected and uploaded references, and shares each destination', async ({ page }) => {
  const state = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/work/source42')
  await page.getByRole('link', { name: '制作同款', exact: true }).click()
  await expect(page).toHaveURL(/create\/image\?remix=source42$/)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue(state.source.prompt)
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('fixture-image')
  await expect(page.locator('.reference-list li')).toHaveCount(0)
  expect(state.generated).toHaveLength(0)
  await page.getByRole('button', { name: '选择原作参考图', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择原作参考图', exact: true })
  await expect(picker.getByRole('checkbox')).toHaveCount(2)
  await expect(picker.getByRole('checkbox', { name: '作者参考图1.jpg', exact: true })).not.toBeChecked()
  await picker.getByRole('checkbox', { name: '作者参考图1.jpg', exact: true }).check()
  await mkdir('.impeccable/review/studio-mobile', { recursive: true })
  await page.screenshot({ path: '.impeccable/review/studio-mobile/remix-references-390.png', fullPage: true })
  await picker.getByRole('button', { name: '使用选中的 1 张参考图', exact: true }).click()
  await page.locator('.reference-upload input').setInputFiles({ name: '自己的参考图.jpg', mimeType: 'image/jpeg', buffer: state.photo })
  await expect(page.locator('.reference-list li')).toHaveCount(2)
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill(`${state.source.prompt}，采用蓝色光线`)
  await page.reload()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue(`${state.source.prompt}，采用蓝色光线`)
  await expect(page.locator('.reference-list li')).toHaveCount(2)
  await page.getByRole('button', { name: '模型定价', exact: true }).click()
  await page.getByRole('button', { name: '返回创作', exact: true }).click()
  await expect(page.locator('.reference-list li')).toHaveCount(2)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  expect(state.generated).toHaveLength(1)
  expect(state.generated[0]).toMatchObject({ sourceWorkId: 'source42', model: 'fixture-image', referenceUrls: ['/legacy-files/authorRef1', '/legacy-files/upload1'] })
  await page.getByRole('button', { name: '发送到源作品评论区', exact: true }).click()
  await page.getByRole('textbox', { name: '评论内容', exact: true }).fill('我的海底城市同款')
  await page.screenshot({ path: '.impeccable/review/studio-mobile/source-comment-390.png', fullPage: true })
  expect((await new AxeBuilder({ page }).include('.studio-publish-dialog').analyze()).violations).toEqual([])
  await page.getByRole('button', { name: '提交评论', exact: true }).click()
  await expect(page.getByRole('link', { name: '查看源作品评论', exact: true })).toHaveAttribute('href', '/work/source42#comment-note1')
  expect(state.submitted[0]).toMatchObject({ destination: 'source-comment', resultId: state.generated[0].requestId, fileIds: ['upload2'], body: '我的海底城市同款', generation: { sourceWorkId: 'source42', referenceFileIds: [] } })
  await page.getByRole('button', { name: '关闭发布作品', exact: true }).click()
  const comment = [...state.saved.values()][0].work
  comment.status = 'rejected'; comment.noteId = null
  await page.getByRole('button', { name: '发送到源作品评论区', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('未通过审核或已撤回，请查看提交记录。')
  await expect(page.getByRole('link', { name: '查看源作品评论', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '查看提交', exact: true })).toHaveAttribute('href', `/work/${comment.id}`)
  await page.getByRole('button', { name: '关闭发布作品', exact: true }).click()
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await page.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(page.getByRole('link', { name: '查看提交', exact: true })).toBeVisible()
  expect(state.submitted[1]).toMatchObject({ destination: 'community', fileIds: ['upload2'], generation: { sourceWorkId: 'source42', referenceFileIds: ['upload3', 'upload4'] } })
  expect(state.uploads()).toBe(4)
  expect(state.generated).toHaveLength(1)
  expect(state.saved.size).toBe(2)
})

test('a lost publish response can be retried after reload with identical attachments and no duplicate work', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/image')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('只生成一次的小猫')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  state.loseNextResponse()
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await page.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('连接中断')
  await page.reload()
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '作品标题', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect(page.getByRole('link', { name: '查看提交', exact: true })).toBeVisible()
  expect(state.submitted).toHaveLength(2)
  expect(state.submitted[1]).toEqual(state.submitted[0])
  expect(state.uploads()).toBe(1)
  expect(state.saved.size).toBe(1)
  expect(state.generated).toHaveLength(1)
})

test('reusing image history synchronizes the source and a new creation clears it', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/image?remix=source42')
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await expect(prompt).toHaveValue(state.source.prompt)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  await page.goto('/create/image?remix=sourceB')
  await expect(prompt).toHaveValue('森林里的萤火虫')
  await page.locator('.studio-sidebar .studio-record').filter({ hasText: state.source.prompt }).click()
  await expect(page).toHaveURL(/create\/image\?remix=source42$/)
  await expect(page.locator('.source-label')).toContainText(state.source.title)
  await expect(prompt).toHaveValue(state.source.prompt)
  await page.getByRole('button', { name: '选择原作参考图', exact: true }).click()
  await expect(page.getByRole('checkbox')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await prompt.fill('复用原作后的修改')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  expect(state.generated[1].sourceWorkId).toBe('source42')
  await page.getByRole('button', { name: '新的创作', exact: true }).click()
  await expect(page).toHaveURL(/create\/image$/)
  await expect(page.locator('.source-label')).toHaveCount(0)
  await expect(prompt).toHaveValue('')
  await prompt.fill('独立的新作品')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  expect(state.generated[2].sourceWorkId).toBeUndefined()
})

test('chat history restores its own source and preserves an edited draft', async ({ page }) => {
  const state = await fixture(page, 'resource')
  await page.goto('/create/text?remix=source42')
  const prompt = page.getByRole('textbox', { name: '消息', exact: true })
  await expect(prompt).toHaveValue(state.source.prompt)
  await page.getByRole('textbox', { name: '对话名称', exact: true }).fill('海底同款对话')
  await prompt.fill('保留我的海底草稿')
  await page.goto('/create/text?remix=sourceB')
  await expect(prompt).toHaveValue('森林里的萤火虫')
  await page.getByRole('button', { name: '历史对话', exact: true }).click()
  await page.getByRole('navigation', { name: '历史对话', exact: true }).getByRole('button', { name: '海底同款对话', exact: true }).click()
  await expect(page).toHaveURL(/create\/text\?remix=source42$/)
  await expect(page.locator('.source-label')).toContainText(state.source.title)
  await expect(prompt).toHaveValue('保留我的海底草稿')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('水母点亮')
  expect(state.generated[0]).toMatchObject({ sourceWorkId: 'source42', prompt: '保留我的海底草稿' })
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await expect(page).toHaveURL(/create\/text$/)
  await expect(page.locator('.source-label')).toHaveCount(0)
  await expect(prompt).toHaveValue('')
})

test('loading author references does not restore an attachment removed during the fetch', async ({ page }) => {
  const state = await fixture(page, 'resource')
  await page.goto('/create/text?remix=source42')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(state.source.prompt)
  await page.locator('.chat-composer').getByLabel('添加附件', { exact: true }).setInputFiles({ name: '自己的参考图.jpg', mimeType: 'image/jpeg', buffer: state.photo })
  await expect(page.locator('.composer-files li')).toHaveCount(1)
  await page.getByRole('button', { name: '选择原作参考图', exact: true }).click()
  await page.getByRole('checkbox', { name: '作者参考图1.jpg', exact: true }).check()
  let release!: () => void, loading = false
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/legacy-files/authorRef1', async route => {
    if (route.request().resourceType() !== 'fetch') return route.fallback()
    loading = true; await pending
    await route.fulfill({ body: state.photo, contentType: 'image/jpeg' }).catch(() => {})
  })
  await page.getByRole('button', { name: '使用选中的 1 张参考图', exact: true }).click()
  try {
    await expect.poll(() => loading).toBe(true)
    await page.getByRole('button', { name: '移除附件 自己的参考图.jpg', exact: true }).click()
    await expect(page.locator('.composer-files li')).toHaveCount(0)
  } finally { release() }
  await expect(page.locator('.composer-files li')).toHaveCount(1)
  await expect(page.locator('.composer-files li')).toHaveText('作者参考图1.jpg')
  expect(state.generated).toHaveLength(0)
})

test('video remix opens the video workspace and only offers community publication', async ({ page }) => {
  const state = await fixture(page, 'video')
  await page.goto('/work/source42')
  await page.getByRole('link', { name: '制作同款', exact: true }).click()
  await expect(page).toHaveURL(/create\/video\?remix=source42$/)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue(state.source.prompt)
  await expect(page.locator('.reference-list li')).toHaveCount(0)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  await expect(page.getByRole('button', { name: '发布作品', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '发送到源作品评论区', exact: true })).toHaveCount(0)
  expect(state.generated[0]).toMatchObject({ kind: 'video', model: 'fixture-video', referenceUrls: [] })
})

test('text remix keeps source attribution and selected images when sharing only the generated answer', async ({ page }) => {
  const state = await fixture(page, 'resource')
  await page.goto('/work/source42')
  await page.getByRole('link', { name: '制作同款', exact: true }).click()
  await expect(page).toHaveURL(/create\/text\?remix=source42$/)
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(state.source.prompt)
  await page.getByRole('button', { name: '选择原作参考图', exact: true }).click()
  await page.getByRole('checkbox', { name: '作者参考图2.jpg', exact: true }).check()
  await page.getByRole('button', { name: '使用选中的 1 张参考图', exact: true }).click()
  await expect(page.locator('.composer-files li')).toHaveCount(1)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('水母点亮')
  await page.getByRole('button', { name: '发送到源作品评论区', exact: true }).click()
  await page.getByRole('button', { name: '提交评论', exact: true }).click()
  await expect(page.getByRole('link', { name: '查看源作品评论', exact: true })).toBeVisible()
  expect(state.generated[0]).toMatchObject({ sourceWorkId: 'source42', kind: 'text' })
  expect(state.submitted[0]).toMatchObject({ destination: 'source-comment', kind: 'resource', body: '水母点亮了海底城市。', generation: { referenceFileIds: [] } })
  expect(state.generated).toHaveLength(1)
})

test('unavailable source errors remain visible without claiming that a comment was posted', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/image?remix=source42')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue(state.source.prompt)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  state.hideSource()
  await page.getByRole('button', { name: '发送到源作品评论区', exact: true }).click()
  await page.getByRole('button', { name: '提交评论', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('源作品已不可访问')
  await expect(page.getByRole('link', { name: '查看源作品评论', exact: true })).toHaveCount(0)
  expect(state.saved.size).toBe(0)
  expect(state.generated).toHaveLength(1)
})

test('switching accounts during result upload cannot publish under the new identity', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/image')
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('旧账号的作品')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  let release!: () => void, uploading = false
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/uploads', async route => { uploading = true; await pending; await route.fulfill({ json: { file: { id: 'upload1', name: 'result.jpg', type: 'image/jpeg', url: '/legacy-files/upload1' } } }).catch(() => {}) })
  await page.getByRole('button', { name: '发布作品', exact: true }).click()
  await page.getByRole('button', { name: '提交作品', exact: true }).click()
  try {
    await expect.poll(() => uploading).toBe(true)
    state.state.user.id = '18'
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('.studio-publish-dialog')).not.toBeVisible()
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
  } finally { release() }
  await page.waitForLoadState('networkidle')
  expect(state.submitted).toHaveLength(0)
  expect(state.generated).toHaveLength(1)
})

test('image remix restores model, group and full public settings, then republishes its generation snapshot', async ({ page }) => {
  const state = await fixture(page)
  state.source.model = 'gpt-image-2'
  state.source.generation = { parameters: { version: 1, kind: 'image', group: '生图', protocol: 'async',
    size: '1200x900', aspect_ratio: '4:3', n: 3, duration: 8,
    imageOptions: { resolution: '2k', quality: 'high', seed: '42', style: 'vivid', imageOutputFormat: 'webp', imageBackground: 'transparent', imageOutputCompression: 85 } } }
  let group = 'auto'
  await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: { selectedGroup: group, groups: [{ id: 'auto', name: 'Auto' }, { id: '生图', name: '生图', ratio: 0.6 }] } } }))
  await page.route('**/api/new-api/model-groups/select', route => { group = route.request().postDataJSON().group; return route.fulfill({ json: { success: true, data: { group, selectedTokenId: 52 } } }) })
  await page.route('**/api/creation/models', route => route.fulfill({ json: { tokenId: group === '生图' ? 52 : 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } }))
  await page.goto('/create/image?remix=source42')
  const groupPicker = await openGroupPicker(page)
  await expect(groupPicker.getByRole('button', { name: '选择分组', exact: true })).toContainText('生图 · 0.6×')
  await groupPicker.getByRole('button', { name: '关闭选择模型', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await expect(page.getByLabel('尺寸', { exact: true })).toHaveValue('1200x900')
  await expect(page.getByRole('combobox', { name: '画面比例', exact: true })).toHaveValue('4:3')
  await expect(page.getByLabel('图片数量', { exact: true })).toHaveValue('3')
  await expect(page.getByLabel('随机种子', { exact: true })).toHaveValue('42')
  await expect(page.getByRole('combobox', { name: '画质', exact: true })).toHaveValue('high')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await expect(page.getByRole('dialog', { name: '高级参数', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.taste-skill/remix-parameters-20261114/image-settings-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.keyboard.press('Escape')
  await page.screenshot({ path: '.taste-skill/remix-parameters-20261114/image.png', fullPage: true })
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  expect(state.generated[0]).toMatchObject({ model: 'gpt-image-2', size: '1200x900', aspect_ratio: '4:3', n: 3, protocol: 'async', imageOptions: { seed: '42', quality: 'high' } })
  // Publishing after a later group switch must keep the generation-time group.
  await openGroupPicker(page)
  await groupPicker.getByRole('button', { name: '选择分组', exact: true }).click()
  await groupPicker.getByRole('button', { name: 'Auto 系统', exact: true }).click()
  await expect(groupPicker.getByRole('button', { name: '选择分组', exact: true })).toBeEnabled()
  await groupPicker.getByRole('button', { name: '关闭选择模型', exact: true }).click()
  await page.getByRole('button', { name: '发布作品', exact: true }).last().click()
  await page.getByRole('button', { name: '提交作品', exact: true }).click()
  await expect.poll(() => state.submitted.length).toBe(1)
  expect(state.submitted[0].generation.parameters).toMatchObject({ version: 1, kind: 'image', group: '生图', size: '1200x900', n: 3, protocol: 'async', imageOptions: { seed: '42', imageOutputCompression: 85 } })
  expect(JSON.stringify(state.submitted[0].generation.parameters)).not.toMatch(/tokenId|accountTokenId|apiKey/)
})

test('video remix restores duration, size, seed and advanced parameters without silently normalizing them', async ({ page }) => {
  const state = await fixture(page, 'video')
  state.source.model = 'sora-2'
  state.source.generation = { parameters: { version: 1, kind: 'video', group: 'auto', size: '720x1280', aspect_ratio: '9:16', n: 1, duration: 8,
    videoOptions: { mode: 'text-to-video', resolution: '720p', seed: '42', negativePrompt: '模糊', generateAudio: true, customParameters: '{"fps":24}' } } }
  await page.route('**/api/creation/models', route => route.fulfill({ json: { tokenId: 41, items: [{ id: 'sora-2', kinds: ['video'] }] } }))
  await page.goto('/create/video?remix=source42')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue(state.source.prompt)
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '时长（秒）', exact: true })).toHaveValue('8')
  await expect(page.getByLabel('尺寸', { exact: true })).toHaveValue('720x1280')
  await expect(page.getByLabel('随机种子', { exact: true })).toHaveValue('42')
  await expect(page.getByLabel('负面提示词', { exact: true })).toHaveValue('模糊')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => state.generated.length).toBe(1)
  expect(state.generated[0]).toMatchObject({ model: 'sora-2', duration: 8, size: '720x1280', aspect_ratio: '9:16', videoOptions: { seed: '42', generateAudio: true, customParameters: '{"fps":24}' } })
})

test('unavailable original model requires an explicit fallback and never submits on entry', async ({ page }) => {
  const state = await fixture(page)
  state.source.model = 'retired-model'
  await page.goto('/create/image?remix=source42')
  await expect(page.getByRole('alert')).toContainText('retired-model')
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeDisabled()
  expect(state.generated).toHaveLength(0)
  await page.getByRole('button', { name: '使用当前配置', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeEnabled()
})

test('failed original group selection does not replay its POST or silently generate with a different group', async ({ page }) => {
  const state = await fixture(page)
  state.source.generation = { parameters: { version: 1, kind: 'image', group: 'original' } }
  let attempts = 0
  await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: { selectedGroup: 'auto', groups: [{ id: 'auto', name: 'Auto' }, { id: 'original', name: '原作分组' }] } } }))
  await page.route('**/api/new-api/model-groups/select', route => { attempts++; return route.fulfill({ status: 409, json: { success: false, message: '原作分组不可用。' } }) })
  await page.goto('/create/image?remix=source42')
  await expect(page.getByRole('alert').filter({ hasText: '原作分组不可用' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeDisabled()
  expect(attempts).toBe(1); expect(state.generated).toEqual([])
})

test('text remix restores public chat settings without importing the authors conversation', async ({ page }) => {
  const state = await fixture(page, 'resource')
  state.source.generation = { parameters: { version: 1, kind: 'text', group: 'auto',
    chatOptions: { format: 'responses', temperature: 0.2, max_tokens: 1234, reasoningEffort: 'high', stop: 'END' } } }
  await page.goto('/create/text?remix=source42')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(state.source.prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => state.generated.length).toBe(1)
  expect(state.generated[0].chatOptions).toMatchObject({ format: 'responses', temperature: 0.2, max_tokens: 1234, reasoningEffort: 'high', stop: 'END' })
  expect(state.generated[0].chatOptions.messages.map((message: { role: string; content: unknown }) => ({ role: message.role, content: message.content }))).toEqual([{ role: 'user', content: state.source.prompt }])
})

test('pending source restoration blocks regenerating an old answer', async ({ page }) => {
  const state = await fixture(page, 'resource')
  await page.goto('/create/text')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('原有对话')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('水母点亮')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/works/source42', async route => { await gate; await route.fallback() })
  await page.goto('/create/text?remix=source42')
  await expect(page.getByRole('button', { name: '重新生成回答', exact: true })).toBeDisabled()
  expect(state.generated).toHaveLength(1)
  release()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue(state.source.prompt)
})

test('switching source during a slow group restore leaves the newer source and group authoritative', async ({ page }) => {
  const state = await fixture(page)
  state.source.generation = { parameters: { version: 1, kind: 'image', group: 'original', aspect_ratio: '4:3', n: 3 } }
  let group = 'auto', release!: () => void, started = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: { selectedGroup: group, groups: [{ id: 'auto', name: 'Auto' }, { id: 'original', name: '原作分组' }] } } }))
  await page.route('**/api/new-api/model-groups/select', async route => {
    started = true; await gate; group = route.request().postDataJSON().group
    return route.fulfill({ json: { success: true, data: { group, selectedTokenId: group === 'auto' ? 41 : 52 } } })
  })
  await page.route('**/api/works/sourceB', route => route.fulfill({ json: { work: { ...state.source, id: 'sourceB', title: '原作森林', prompt: '森林里的萤火虫',
    generation: { parameters: { version: 1, kind: 'image', group: 'auto', aspect_ratio: '1:1', n: 1 } } } } }))
  await page.goto('/create/image?remix=source42')
  await expect.poll(() => started).toBe(true)
  await page.evaluate(() => {
    history.pushState({ ...history.state, current: '/create/image?remix=sourceB' }, '', '/create/image?remix=sourceB')
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  })
  release()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('森林里的萤火虫')
  await expect(page.locator('.source-label')).toContainText('原作森林')
  const groupPicker = await openGroupPicker(page)
  await expect(groupPicker.getByRole('button', { name: '选择分组', exact: true })).toContainText('Auto')
  await groupPicker.getByRole('button', { name: '关闭选择模型', exact: true }).click()
  expect(state.generated).toEqual([])
})
