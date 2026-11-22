import { expect, test, type Page } from '@playwright/test'
import type { ModelTypeSetting } from '../shared/studio/model-types'
import { mockUnifiedAccount } from './helpers/account-fixture'

type CatalogModel = { id: string; name?: string; kinds: ('text' | 'image' | 'video')[]; tags?: string[] }
async function modelsFixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.isAdmin = true
  const state = {
    catalog: [
      { id: 'custom/text', name: '原始对话模型', kinds: ['text'], tags: ['写作'] },
      { id: 'custom/image', name: '原始图片模型', kinds: ['image'] },
      { id: 'custom/video', name: '原始视频模型', kinds: ['video'] },
      { id: 'alias/unclassified', name: '未识别别名', kinds: [] },
    ] as CatalogModel[],
    items: [] as ModelTypeSetting[], revision: 1, conflict: false,
    failCatalog: false, failConfig: false,
  }
  const reads: { path: string; url: string; headers: Record<string, string> }[] = []
  const writes: { path: string; body: Record<string, any>; headers: Record<string, string> }[] = []
  await page.route('**/api/site', route => route.fulfill({ json: { brand: '测试社区', logoUrl: '' } }))
  await page.route('**/api/creation/models*', route => {
    const request = route.request(), url = new URL(request.url())
    reads.push({ path: url.pathname, url: request.url(), headers: request.headers() })
    if (state.failCatalog) return route.fulfill({ status: 503, json: { message: '模型目录拉取失败，请重试。' } })
    if (url.searchParams.get('management') !== '1') return route.fulfill({ status: 400, json: { message: '管理目录需要 management=1' } })
    return route.fulfill({ json: { tokenId: 41, items: state.catalog } })
  })
  await page.route('**/api/admin/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() === 'GET') reads.push({ path, url: request.url(), headers: request.headers() })
    else writes.push({ path, body: request.postDataJSON(), headers: request.headers() })
    if (path === '/api/admin/models') {
      if (request.method() === 'GET' && state.failConfig) return route.fulfill({ status: 503, json: { message: '模型配置读取失败，请重试。' } })
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON()
        if (state.conflict || body.version !== `model-version-${state.revision}`) return route.fulfill({ status: 409, json: { message: '模型配置版本已变化' } })
        if (request.headers()['x-new-api-user'] !== account.state.user.id) return route.fulfill({ status: 409, json: { message: '账号已变化' } })
        if (Object.keys(body).sort().join(',') !== 'items,version') return route.fulfill({ status: 400, json: { message: '模型配置不能修改其他设置' } })
        state.items = structuredClone(body.items); state.revision++
      }
      return route.fulfill({ json: { items: state.items, version: `model-version-${state.revision}` } })
    }
    if (path === '/api/admin/overview') return route.fulfill({ json: { counts: { pending: 0, published: 0, rejected: 0, reports: 0 }, period: { days: 7, newWorks: 0, newUsers: 0 }, updatedAt: '2026-11-22T00:00:00Z' } })
    return route.fulfill({ json: { items: [] } })
  })
  return { state, reads, writes, account }
}
const editor = (page: Page) => page.locator('.model-editor')
const configure = (page: Page, id: string) => page.getByRole('button', { name: `配置：${id}`, exact: true })
const combo = (page: Page, name: string) => page.getByRole('combobox', { name, exact: true })
const save = (page: Page) => page.getByRole('button', { name: '保存模型配置', exact: true })
const pull = (page: Page) => page.getByRole('button', { name: '拉取模型', exact: true })
const item = (fixture: Awaited<ReturnType<typeof modelsFixture>>, id: string) => fixture.state.items.find(value => value.id === id)
async function keepDraft(page: Page) {
  const dialog = page.getByRole('dialog', { name: '保留这次修改？', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click()
}

test('model management loads the administrator directory, filters it and keeps model identifiers read only', async ({ page }) => {
  const fixture = await modelsFixture(page)
  fixture.state.items = [{ id: 'retired/private-model', name: '保留旧配置', kind: 'video', tags: ['历史'] }]
  await page.goto('/admin?tab=models')
  await expect(page.getByRole('heading', { name: '模型管理', exact: true })).toBeVisible()
  await expect(editor(page)).toHaveCount(0)
  await expect(configure(page, 'alias/unclassified')).toBeVisible()
  expect(fixture.reads.some(read => read.path === '/api/admin/models')).toBe(true)
  expect(fixture.reads.find(read => read.path === '/api/creation/models')!.headers['x-new-api-user']).toBe('17')
  expect(fixture.reads.some(read => read.path === '/api/admin/community/config')).toBe(false)
  await page.getByRole('searchbox', { name: '搜索模型', exact: true }).fill('历史')
  await expect(configure(page, 'retired/private-model')).toBeVisible()
  await expect(configure(page, 'custom/text')).toHaveCount(0)
  await page.getByRole('searchbox', { name: '搜索模型', exact: true }).fill('')
  await combo(page, '筛选模型来源').selectOption('available')
  await expect(configure(page, 'retired/private-model')).toHaveCount(0)
  await combo(page, '筛选模型类型').selectOption('image')
  await expect(configure(page, 'custom/image')).toBeVisible()
  await expect(configure(page, 'custom/video')).toHaveCount(0)
  await combo(page, '筛选模型类型').selectOption('all')
  await combo(page, '筛选模型来源').selectOption('configured')
  await expect(configure(page, 'retired/private-model')).toBeVisible()
  await expect(configure(page, 'custom/image')).toHaveCount(0)
  await combo(page, '筛选模型来源').selectOption('all')
  await configure(page, 'alias/unclassified').click()
  await expect(editor(page).locator('code')).toHaveText('alias/unclassified')
  await expect(editor(page).getByRole('textbox', { name: '模型 ID', exact: true })).toHaveCount(0)
  await expect(combo(page, '模型类型')).toHaveValue('text')
  await combo(page, '模型类型').selectOption('image')
  await page.getByLabel('显示名称', { exact: true }).fill('自定义别名图片')
  await save(page).click()
  await expect.poll(() => item(fixture, 'alias/unclassified')).toMatchObject({ id: 'alias/unclassified', name: '自定义别名图片', kind: 'image' })
  expect(item(fixture, 'retired/private-model')).toEqual({ id: 'retired/private-model', name: '保留旧配置', kind: 'video', tags: ['历史'] })
  await expect(page.getByRole('button', { name: '添加模型类型', exact: true })).toHaveCount(0)
})

test('selected models save names, tags, interfaces and typed automatic parameters through the isolated model API', async ({ page }) => {
  const fixture = await modelsFixture(page)
  const retained: ModelTypeSetting = { id: 'retired/private-model', kind: 'video', remark: '保留其他模型' }
  fixture.state.items = [retained]
  await page.goto('/admin?tab=models')
  await configure(page, 'custom/text').click()
  await page.getByLabel('显示名称', { exact: true }).fill('  推理助手  ')
  await page.getByLabel('模型标签', { exact: true }).fill('推理， 写作, 多模态')
  await combo(page, '接口格式').selectOption('responses')
  await combo(page, '自动推理强度').selectOption('high')
  await page.getByLabel('备注', { exact: true }).fill('管理员备注\n第二行')
  await save(page).click()
  await expect.poll(() => item(fixture, 'custom/text')).toEqual({
    id: 'custom/text', kind: 'text', name: '推理助手', tags: ['推理', '写作', '多模态'],
    apiFormat: 'responses', text: { autoReasoningEffort: 'high' }, remark: '管理员备注\n第二行',
  })
  await page.getByRole('button', { name: '返回模型列表', exact: true }).click()
  await configure(page, 'custom/image').click()
  await page.getByLabel('显示名称', { exact: true }).fill('图片创作')
  await page.getByLabel('模型标签', { exact: true }).fill('绘图, 透明背景')
  await combo(page, '接口格式').selectOption('images')
  await combo(page, '任务协议').selectOption('async')
  await combo(page, '自动分辨率').selectOption('2k')
  await combo(page, '自动画质').selectOption('high')
  await page.getByLabel('自动画面比例', { exact: true }).fill(' 3:2 ')
  await combo(page, '自动背景').selectOption('transparent')
  await save(page).click()
  await expect.poll(() => item(fixture, 'custom/image')).toEqual({
    id: 'custom/image', kind: 'image', name: '图片创作', tags: ['绘图', '透明背景'], apiFormat: 'images', protocol: 'async',
    image: { autoResolution: '2k', autoQuality: 'high', autoAspectRatio: '3:2', autoBackground: 'transparent' },
  })
  await page.getByRole('button', { name: '返回模型列表', exact: true }).click()
  await configure(page, 'custom/video').click()
  await combo(page, '接口格式').selectOption('openai')
  await combo(page, '任务协议').selectOption('sync')
  await page.getByLabel('自动分辨率', { exact: true }).fill('720P')
  await page.getByLabel('可选分辨率', { exact: true }).fill('480p，720p 1080p')
  await page.getByLabel('自动画面比例', { exact: true }).fill('16:9')
  await combo(page, '视频参数格式').selectOption('seedance')
  await save(page).click()
  await expect.poll(() => item(fixture, 'custom/video')).toEqual({
    id: 'custom/video', kind: 'video', apiFormat: 'openai', protocol: 'sync',
    video: { autoResolution: '720p', resolutions: ['480p', '720p', '1080p'], autoAspectRatio: '16:9', parameterFormat: 'seedance' },
  })
  expect(item(fixture, retained.id)).toEqual(retained)
  expect(fixture.writes).toHaveLength(3)
  for (const [index, write] of fixture.writes.entries()) {
    expect(write.path).toBe('/api/admin/models')
    expect(Object.keys(write.body).sort()).toEqual(['items', 'version'])
    expect(write.body.version).toBe(`model-version-${index + 1}`)
    expect(write.headers['x-new-api-user']).toBe(fixture.account.state.user.id)
    expect(write.body.items.every((value: Record<string, unknown>) => !('resolutionInput' in value) && !('tagsInput' in value))).toBe(true)
  }
  await page.reload()
  await configure(page, 'custom/image').click()
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('图片创作')
  await expect(page.getByLabel('模型标签', { exact: true })).toHaveValue('绘图, 透明背景')
  await expect(combo(page, '自动分辨率')).toHaveValue('2k')
})

test('model drafts survive cancelled selection, navigation, back and pull actions', async ({ page }) => {
  const fixture = await modelsFixture(page)
  await page.goto('/admin?tab=models')
  await configure(page, 'custom/text').click()
  await page.getByLabel('显示名称', { exact: true }).fill('未保存的模型名称')
  await configure(page, 'custom/image').click()
  await keepDraft(page)
  await expect(editor(page).locator('code')).toHaveText('custom/text')
  await page.getByRole('button', { name: '返回模型列表', exact: true }).click()
  await keepDraft(page)
  await page.getByRole('navigation', { name: '管理分类', exact: true }).getByRole('button', { name: '站点设置', exact: true }).click()
  await keepDraft(page)
  const beforePull = fixture.reads.length
  await pull(page).click()
  await keepDraft(page)
  expect(fixture.reads).toHaveLength(beforePull)
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('未保存的模型名称')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await page.getByRole('button', { name: '返回模型列表', exact: true }).click()
  await page.getByRole('dialog', { name: '保留这次修改？', exact: true }).getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await expect(editor(page)).toHaveCount(0)
  expect(fixture.writes).toEqual([])
})

test('conflicting model saves retain raw input and only a confirmed pull loads the newer version', async ({ page }) => {
  const fixture = await modelsFixture(page)
  fixture.state.items = [{ id: 'custom/video', kind: 'video', remark: '原始备注' }]
  await page.goto('/admin?tab=models')
  await configure(page, 'custom/video').click()
  await page.getByLabel('自动分辨率', { exact: true }).fill('720P')
  await page.getByLabel('可选分辨率', { exact: true }).fill('480p 720p')
  await page.getByLabel('模型标签', { exact: true }).fill('草稿, 视频')
  await page.getByLabel('备注', { exact: true }).fill('尚未保存\n第二行')
  fixture.state.items = [{ id: 'custom/video', kind: 'video', remark: '另一管理员的备注' }]
  fixture.state.revision++
  await save(page).click()
  await expect(page.getByRole('alert')).toContainText('你的输入仍保留')
  await expect(page.getByLabel('自动分辨率', { exact: true })).toHaveValue('720P')
  await expect(page.getByLabel('可选分辨率', { exact: true })).toHaveValue('480p 720p')
  await expect(page.getByLabel('模型标签', { exact: true })).toHaveValue('草稿, 视频')
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('尚未保存\n第二行')
  await pull(page).click(); await keepDraft(page)
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('尚未保存\n第二行')
  const previousReads = fixture.reads.filter(read => read.path === '/api/admin/models').length
  await pull(page).click()
  await page.getByRole('dialog', { name: '保留这次修改？', exact: true }).getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('另一管理员的备注')
  expect(fixture.reads.filter(read => read.path === '/api/admin/models').length).toBeGreaterThan(previousReads)
  await page.getByLabel('备注', { exact: true }).fill('基于新版本修改')
  await save(page).click()
  await expect.poll(() => item(fixture, 'custom/video')?.remark).toBe('基于新版本修改')
  expect(fixture.writes.at(-1)!.body.version).toBe('model-version-2')
})

test('unavailable saved models remain editable and a failed catalog pull retains the previous directory', async ({ page }) => {
  const fixture = await modelsFixture(page)
  const retained: ModelTypeSetting = { id: 'retired/private-model', kind: 'video', name: '旧模型', video: { autoResolution: '720p' }, remark: '保留的配置' }
  fixture.state.items = [retained, { id: 'custom/text', kind: 'text', name: '原配置' }]
  await page.goto('/admin?tab=models')
  await expect(configure(page, 'custom/image')).toBeVisible()
  const count = await page.getByRole('button', { name: /^配置：/ }).count()
  fixture.state.failCatalog = true
  await pull(page).click()
  await expect(page.getByRole('alert')).toContainText('模型目录拉取失败')
  await expect(page.getByRole('button', { name: /^配置：/ })).toHaveCount(count)
  await configure(page, retained.id).click()
  await expect(editor(page)).toContainText('当前分组不可用')
  await page.getByLabel('显示名称', { exact: true }).fill('旧模型重新命名')
  await page.getByLabel('备注', { exact: true }).fill('保留并继续修改')
  await save(page).click()
  await expect.poll(() => item(fixture, retained.id)).toEqual({ ...retained, name: '旧模型重新命名', remark: '保留并继续修改' })
  expect(item(fixture, 'custom/text')).toEqual({ id: 'custom/text', kind: 'text', name: '原配置' })
  fixture.state.failCatalog = false
  await pull(page).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(fixture.state.items).toHaveLength(2)
})

test('failed initial model configuration reads do not expose an editable empty configuration', async ({ page }) => {
  const fixture = await modelsFixture(page)
  fixture.state.failConfig = true
  fixture.state.items = [{ id: 'retired/private-model', kind: 'video', remark: '必须保留' }]
  await page.goto('/admin?tab=models')
  await expect(page.getByRole('alert')).toContainText('模型配置读取失败')
  await expect(editor(page)).toHaveCount(0)
  await expect(configure(page, 'custom/text')).toHaveCount(0)
  expect(fixture.writes).toHaveLength(0)
  fixture.state.failConfig = false
  await pull(page).click()
  await expect(configure(page, 'retired/private-model')).toBeVisible()
  expect(fixture.state.items).toEqual([{ id: 'retired/private-model', kind: 'video', remark: '必须保留' }])
})

test('restoring automatic recognition requires confirmation and removes only the selected override', async ({ page }) => {
  const fixture = await modelsFixture(page)
  const other: ModelTypeSetting = { id: 'retired/private-model', kind: 'text', remark: '保留其他配置' }
  fixture.state.items = [{ id: 'custom/image', kind: 'image', name: '自定义图片', tags: ['绘图'], image: { autoResolution: '2k' } }, other]
  await page.goto('/admin?tab=models')
  await configure(page, 'custom/image').click()
  await page.getByRole('button', { name: '恢复自动识别', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '恢复自动识别？', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  expect(fixture.writes).toHaveLength(0)
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('自定义图片')
  await page.getByRole('button', { name: '恢复自动识别', exact: true }).click()
  await page.getByRole('dialog', { name: '恢复自动识别？', exact: true }).getByRole('button', { name: '确认恢复', exact: true }).click()
  await expect.poll(() => fixture.state.items).toEqual([other])
  await expect(page.getByRole('dialog', { name: '恢复自动识别？', exact: true })).not.toBeVisible()
  await expect(combo(page, '自动分辨率')).toHaveValue('auto')
  await expect(configure(page, 'custom/image')).toHaveCount(1)
  expect(fixture.writes[0]!.body).toEqual({ items: [other], version: 'model-version-1' })
})

test('a late catalog pull after reset preserves a newly entered model draft and navigation protection', async ({ page }) => {
  const fixture = await modelsFixture(page)
  fixture.state.items = [{ id: 'custom/image', kind: 'image', name: '已保存的图片名称' }]
  let release!: () => void, waiting = false, calls = 0
  const wait = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/models*', async route => {
    calls++
    if (calls === 1) return route.fallback()
    waiting = true; await wait; await route.fallback()
  })
  await page.goto('/admin?tab=models')
  await configure(page, 'custom/image').click()
  await page.getByRole('button', { name: '恢复自动识别', exact: true }).click()
  await page.getByRole('dialog', { name: '恢复自动识别？', exact: true }).getByRole('button', { name: '确认恢复', exact: true }).click()
  await expect.poll(() => waiting).toBe(true)
  await expect(page.getByRole('dialog', { name: '恢复自动识别？', exact: true })).not.toBeVisible()
  await page.getByLabel('备注', { exact: true }).fill('恢复后新输入的备注')
  release()
  await expect(pull(page)).toBeEnabled()
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('恢复后新输入的备注')
  await expect(save(page)).toBeEnabled()
  await page.getByRole('button', { name: '返回模型列表', exact: true }).click()
  await keepDraft(page)
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('恢复后新输入的备注')
  expect(fixture.writes).toHaveLength(1)
})

test('invalid model tags, resolution choices and aspect ratios stay editable without a patch', async ({ page }) => {
  const fixture = await modelsFixture(page)
  await page.goto('/admin?tab=models')
  await configure(page, 'custom/video').click()
  await page.getByLabel('自动分辨率', { exact: true }).fill('720p')
  await page.getByLabel('可选分辨率', { exact: true }).fill('480p, 480p')
  await save(page).click()
  await expect(page.getByRole('alert')).toContainText('视频分辨率')
  await expect(page.getByLabel('可选分辨率', { exact: true })).toHaveValue('480p, 480p')
  await page.getByLabel('可选分辨率', { exact: true }).fill('480p, 720p')
  await page.getByLabel('模型标签', { exact: true }).fill('Video, video')
  await save(page).click()
  await expect(page.getByRole('alert')).toContainText('标签')
  await page.getByLabel('模型标签', { exact: true }).fill('视频')
  await page.getByLabel('自动画面比例', { exact: true }).fill('16/9')
  await save(page).click()
  await expect(page.getByRole('alert')).toContainText(/视频分辨率|画面比例/)
  await expect(page.getByLabel('自动画面比例', { exact: true })).toHaveValue('16/9')
  expect(fixture.writes).toHaveLength(0)
  await page.getByLabel('自动画面比例', { exact: true }).fill('16:9')
  await save(page).click()
  await expect.poll(() => fixture.writes.length).toBe(1)
})

test('changing model kinds clears incompatible options while image chat preserves inactive image defaults', async ({ page }) => {
  const fixture = await modelsFixture(page)
  fixture.state.items = [{ id: 'custom/image', kind: 'image', apiFormat: 'images', protocol: 'async',
    image: { autoResolution: '2k', autoQuality: 'high' }, remark: '保留备注' }]
  await page.goto('/admin?tab=models')
  await configure(page, 'custom/image').click()
  await combo(page, '接口格式').selectOption('chat-completions')
  await expect(combo(page, '自动分辨率')).toBeDisabled()
  await expect(combo(page, '自动画质')).toBeDisabled()
  await expect(combo(page, '任务协议')).toHaveValue('auto')
  await expect(editor(page)).toContainText('图片对话接口的尺寸、画质和背景由上游决定。')
  await combo(page, '接口格式').selectOption('images')
  await expect(combo(page, '自动分辨率')).toHaveValue('2k')
  await expect(combo(page, '自动画质')).toHaveValue('high')
  await combo(page, '模型类型').selectOption('video')
  await expect(combo(page, '接口格式')).toHaveValue('auto')
  await page.getByLabel('自动分辨率', { exact: true }).fill('720p')
  await combo(page, '模型类型').selectOption('text')
  await expect(combo(page, '任务协议')).toHaveCount(0)
  await combo(page, '自动推理强度').selectOption('ultra')
  await combo(page, '模型类型').selectOption('image')
  await expect(combo(page, '自动分辨率')).toHaveValue('auto')
  await save(page).click()
  await expect.poll(() => fixture.state.items).toEqual([{ id: 'custom/image', kind: 'image', remark: '保留备注' }])
})

for (const role of ['moderator', 'ordinary']) test(`${role} accounts cannot see model management or issue its privileged reads`, async ({ page }) => {
  const fixture = await modelsFixture(page)
  fixture.account.state.user.isAdmin = false
  fixture.account.state.user.isModerator = role === 'moderator'
  await page.goto('/admin?tab=models')
  await expect(page.getByRole('navigation', { name: '管理分类', exact: true }).getByRole('button', { name: '模型管理', exact: true })).toHaveCount(0)
  await expect(editor(page)).toHaveCount(0)
  expect(fixture.reads.filter(read => ['/api/admin/models', '/api/creation/models'].includes(read.path))).toEqual([])
})

test('model lists and image editors fit desktop and narrow phones', async ({ page }, info) => {
  test.setTimeout(60_000)
  const fixture = await modelsFixture(page)
  fixture.state.catalog[1]!.name = '用于移动端和桌面端检查的完整图片模型名称'
  fixture.state.items = [{ id: 'custom/image', kind: 'image', apiFormat: 'images', tags: ['绘图', '高画质'], image: { autoResolution: '2k', autoQuality: 'high' }, remark: '备注内容保持可读' }]
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/admin?tab=models')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(configure(page, 'custom/image')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`model-list-${width}.png`), fullPage: true })
    await configure(page, 'custom/image').click()
    await expect(combo(page, '自动画质')).toHaveValue('high')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await editor(page).evaluate(element => [...element.querySelectorAll('input,select,textarea,button')].every(control => {
      const bounds = control.getBoundingClientRect()
      return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth
    }))).toBe(true)
    await page.screenshot({ path: info.outputPath(`model-image-editor-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '返回模型列表', exact: true }).click()
  }
  expect(errors).toEqual([])
})
