import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { defaultLotterySettings } from '../server/business/lottery'
import { mockUnifiedAccount } from './helpers/account-fixture'
import type { ModelTypeSetting } from '../shared/studio/model-types'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3YQAAAAASUVORK5CYII=', 'base64')
async function adminFixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.isAdmin = true
  const state = {
    settings: { brand: '旧站点名称', logoUrl: '', registrationOpen: false, defaultModels: { image: 'kept-model' } },
    config: { communityPublicationMode: 'before', communityAutoBanEnabled: true, communityViolationThreshold: 3,
      communityModelTypes: [] as ModelTypeSetting[],
      communityFeedMode: 'shuffle', communityFeedPoolSize: 200, communityPullToRefresh: true,
      communityFeedWeights: { interest: 60, fresh: 25, explore: 15 },
      uploadLimits: { image: 20, video: 100, audio: 20, document: 20, other: 10 } },
    ads: Array.from({ length: 4 }, (_, i) => ({ id: `communityAd${i + 1}`, enabled: false, title: i === 1 ? '保留在第二槽' : '', imageUrl: '', linkUrl: '' })),
    revision: 1, conflict: false, failRead: '',
  }
  const writes: { path: string; body: Record<string, any> }[] = []
  await page.route('**/api/site', route => route.fulfill({ json: { brand: state.settings.brand, logoUrl: state.settings.logoUrl } }))
  await page.route('**/legacy-files/logo1', route => route.fulfill({ contentType: 'image/png', body: png }))
  await page.route('**/api/uploads/limits', route => route.fulfill({ json: { imagesMb: 20, maxFileSizeMb: 20 } }))
  await page.route('**/api/uploads', route => route.fulfill({ json: { file: { id: 'logo1', url: '/legacy-files/logo1', name: 'logo.png', type: 'image/png', size: png.length } } }))
  await page.route('**/api/admin/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') {
      const body = request.postDataJSON(); writes.push({ path, body })
      if (state.conflict) return route.fulfill({ status: 409, json: { message: '配置版本已变化' } })
      if (body.version !== `version-${state.revision}`) return route.fulfill({ status: 409, json: { message: '版本不匹配' } })
      state.revision++
      if (path === '/api/admin/settings') Object.assign(state.settings, body.settings)
      if (path.endsWith('/config')) { const { version, ...config } = body; Object.assign(state.config, config) }
      if (path.endsWith('/ads')) state.ads = body.items
    } else if (state.failRead && path.endsWith(state.failRead)) return route.fulfill({ status: 503, json: { message: '配置加载失败，请重试' } })
    const version = `version-${state.revision}`
    if (path === '/api/admin/overview') return route.fulfill({ json: { counts: { pending: 135, published: 3240, rejected: 48, reports: 6 }, period: { days: 7, newWorks: 215, newUsers: 38 }, updatedAt: '2026-11-13T10:00:00Z' } })
    if (path === '/api/admin/settings') return route.fulfill({ json: { settings: state.settings, version } })
    if (path.endsWith('/config')) return route.fulfill({ json: { config: state.config, version } })
    if (path.endsWith('/ads')) return route.fulfill({ json: { items: state.ads, version } })
    return route.fulfill({ json: { items: [] } })
  })
  return { state, writes, account }
}
async function openTab(page: Page, name: string) {
  await page.getByRole('navigation', { name: '管理分类', exact: true }).getByRole('button', { name, exact: true }).click()
}

test('site branding and an uploaded logo save only their own fields and survive reload', async ({ page }) => {
  const fixture = await adminFixture(page)
  await page.goto('/admin'); await openTab(page, '站点设置')
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('旧站点名称')
  await page.getByLabel('站点名称', { exact: true }).fill('新的创作社区')
  await page.getByLabel('上传 Logo', { exact: true }).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByLabel('Logo 图片地址', { exact: true })).toHaveValue('/legacy-files/logo1')
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click()
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  await expect(page.getByRole('link', { name: '新的创作社区首页', exact: true })).toBeVisible()
  await expect(page).toHaveTitle('管理 · 新的创作社区')
  expect(fixture.writes[0]!.body).toEqual({ settings: { brand: '新的创作社区', logoUrl: '/legacy-files/logo1' }, version: 'version-1' })
  expect(fixture.state.settings.defaultModels.image).toBe('kept-model')
  expect(fixture.state.settings.registrationOpen).toBe(false)
  await page.reload(); await openTab(page, '站点设置')
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('新的创作社区')
  await expect(page.getByAltText('站点 Logo 预览')).toBeVisible()
  await page.getByRole('button', { name: '移除 Logo', exact: true }).click()
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click()
  await expect(page.locator('.brand img')).toHaveCount(0)
})

test('conflicting site changes keep the draft until the administrator explicitly reloads', async ({ page }) => {
  const fixture = await adminFixture(page)
  await page.goto('/admin'); await openTab(page, '站点设置')
  await page.getByLabel('站点名称', { exact: true }).fill('我的未保存名称')
  fixture.state.settings.brand = '另一管理员的名称'; fixture.state.revision++; fixture.state.conflict = true
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('你的输入仍保留')
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('我的未保存名称')
  await page.getByRole('button', { name: '刷新站点设置', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('我的未保存名称')
  await page.getByRole('button', { name: '刷新站点设置', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并刷新', exact: true }).click()
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('另一管理员的名称')
})

test('failed admin reads do not become empty editable ads or tags', async ({ page }) => {
  const fixture = await adminFixture(page)
  await page.goto('/admin')
  for (const [path, tab, control] of [['/ads', '广告位', '保存广告位'], ['/tags', '内容标签', '添加标签']]) {
    fixture.state.failRead = path!
    await openTab(page, tab!)
    await expect(page.getByRole('alert')).toContainText('配置加载失败')
    await expect(page.getByRole('button', { name: control!, exact: true })).toHaveCount(0)
    await expect(page.getByText('此分类暂无标签')).toHaveCount(0)
    fixture.state.failRead = ''
    await page.getByRole('button', { name: `刷新${tab}`, exact: true }).click()
    await expect(page.getByRole('button', { name: control!, exact: true })).toBeVisible()
  }
})

test('community settings and advertisements submit their loaded version without moving empty slots', async ({ page }) => {
  const fixture = await adminFixture(page)
  await page.goto('/admin'); await openTab(page, '社区设置')
  await page.getByLabel('违规次数阈值', { exact: true }).fill('5')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(1)
  expect(fixture.writes[0]!.body).toMatchObject({ version: 'version-1', communityViolationThreshold: 5 })
  await openTab(page, '广告位')
  await expect(page.locator('.ad-editor')).toHaveCount(4)
  await expect(page.getByLabel('标题', { exact: true }).nth(1)).toHaveValue('保留在第二槽')
  await page.getByRole('button', { name: '保存广告位', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(2)
  expect(fixture.writes[1]!.body.version).toBe('version-2')
  expect(fixture.writes[1]!.body.items.map((item: { title: string }) => item.title)).toEqual(['', '保留在第二槽', '', ''])
})

test('site settings remain usable on desktop and narrow phones', async ({ page }) => {
  await adminFixture(page)
  await mkdir('.impeccable/review/account-admin', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.goto('/admin'); await openTab(page, '站点设置')
    await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('旧站点名称')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '保存站点设置', exact: true })).toBeVisible()
    await page.screenshot({ path: `.impeccable/review/account-admin/site-${width}.png`, fullPage: true })
  }
})

test('administrators configure model types, retain invalid drafts and save or remove them on desktop and phones', async ({ page }, info) => {
  const fixture = await adminFixture(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/admin?tab=settings')
  await page.getByRole('button', { name: '添加模型类型', exact: true }).click()
  await page.getByLabel('模型 ID 1', { exact: true }).fill('custom/alias')
  await page.getByRole('combobox', { name: '类型 1', exact: true }).selectOption('image')
  await page.getByRole('button', { name: '添加模型类型', exact: true }).click()
  await page.getByLabel('模型 ID 2', { exact: true }).fill('custom/alias')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('不重复')
  expect(fixture.writes).toHaveLength(0)
  await page.getByLabel('模型 ID 2', { exact: true }).fill('自定义视频模型')
  await page.getByRole('combobox', { name: '类型 2', exact: true }).selectOption('video')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.state.config.communityModelTypes).toEqual([
    { id: 'custom/alias', kind: 'image' }, { id: '自定义视频模型', kind: 'video' },
  ])
  await page.reload()
  await expect(page.getByLabel('模型 ID 1', { exact: true })).toHaveValue('custom/alias')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.getByLabel('模型 ID 1', { exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('combobox', { name: '类型 1', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`model-types-${width}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: '删除模型类型 1', exact: true }).click()
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.state.config.communityModelTypes).toEqual([{ id: '自定义视频模型', kind: 'video' }])
  expect(errors).toEqual([])
})

test('administrators save video resolutions, restore them and clear optional or non-video settings', async ({ page }, info) => {
  const fixture = await adminFixture(page)
  fixture.state.config.communityModelTypes = [{ id: 'custom/video', kind: 'video' }]
  await page.goto('/admin?tab=settings')
  const automatic = page.getByLabel('自动分辨率 1', { exact: true })
  const resolutions = page.getByLabel('可选分辨率 1', { exact: true })
  await expect(automatic).toBeVisible()
  await automatic.fill('720p')
  await resolutions.fill('480p 720p, 1080p')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(1)
  expect(fixture.writes[0]!.body).toMatchObject({ version: 'version-1', communityModelTypes: [
    { id: 'custom/video', kind: 'video', video: { autoResolution: '720p', resolutions: ['480p', '720p', '1080p'] } },
  ] })
  expect(fixture.writes[0]!.body.communityModelTypes[0]).not.toHaveProperty('resolutionInput')
  await page.reload()
  await expect(automatic).toHaveValue('720p')
  await expect(resolutions).toHaveValue('480p, 720p, 1080p')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await automatic.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.model-type-row').evaluate(element => [...element.querySelectorAll('input,select,button')].every(control => {
      const bounds = control.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.width > 0
    }))).toBe(true)
    await page.screenshot({ path: info.outputPath(`video-resolutions-${width}.png`), fullPage: true })
  }
  await automatic.fill('')
  await resolutions.fill('')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(2)
  expect(fixture.writes[1]!.body).toMatchObject({ version: 'version-2', communityModelTypes: [{ id: 'custom/video', kind: 'video' }] })
  expect(fixture.writes[1]!.body.communityModelTypes[0]).not.toHaveProperty('video')
  await automatic.fill('480p')
  await resolutions.fill('480p, 720p')
  await page.getByRole('combobox', { name: '类型 1', exact: true }).selectOption('image')
  await expect(automatic).toHaveCount(0)
  await expect(resolutions).toHaveCount(0)
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(3)
  expect(fixture.writes[2]!.body).toMatchObject({ version: 'version-3', communityModelTypes: [{ id: 'custom/video', kind: 'image' }] })
  expect(fixture.writes[2]!.body.communityModelTypes[0]).not.toHaveProperty('video')
})

test('invalid video resolution drafts stay editable and send no configuration patch', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.state.config.communityModelTypes = [{ id: 'custom/video', kind: 'video' }]
  await page.goto('/admin?tab=settings')
  const automatic = page.getByLabel('自动分辨率 1', { exact: true })
  const resolutions = page.getByLabel('可选分辨率 1', { exact: true })
  await expect(automatic).toBeVisible()
  for (const [value, list] of [
    ['invalid', '480p, 720p'],
    ['1080p', '480p, 720p'],
    ['auto', '480p, 480p'],
    ['auto', '720p, invalid'],
    ['auto', Array.from({ length: 17 }, (_, index) => `${100 + index}p`).join(', ')],
    ['auto', ', ,'],
  ]) {
    await automatic.fill(value!)
    await resolutions.fill(list!)
    await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('视频分辨率')
    await expect(automatic).toHaveValue(value!)
    await expect(resolutions).toHaveValue(list!)
    expect(fixture.writes).toHaveLength(0)
  }
  await automatic.fill('540p')
  await resolutions.fill('480p，540p 720p')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(1)
  expect(fixture.state.config.communityModelTypes).toEqual([
    { id: 'custom/video', kind: 'video', video: { autoResolution: '540p', resolutions: ['480p', '540p', '720p'] } },
  ])
})

test('administrators configure model interfaces, automatic parameters and private remarks with responsive controls', async ({ page }, info) => {
  const fixture = await adminFixture(page)
  fixture.state.config.communityModelTypes = [
    { id: 'custom/text', kind: 'text' },
    { id: 'custom/image', kind: 'image' },
    { id: 'custom/video', kind: 'video' },
  ]
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/admin?tab=settings')
  await page.getByRole('combobox', { name: '接口格式 1', exact: true }).selectOption('responses')
  await page.getByRole('combobox', { name: '自动推理强度 1', exact: true }).selectOption('high')
  await page.getByLabel('备注 1', { exact: true }).fill('仅供管理员查看\n对话模型')
  await page.getByRole('combobox', { name: '接口格式 2', exact: true }).selectOption('images')
  await page.getByRole('combobox', { name: '任务协议 2', exact: true }).selectOption('async')
  await page.getByRole('combobox', { name: '自动分辨率 2', exact: true }).selectOption('2k')
  await page.getByRole('combobox', { name: '自动画质 2', exact: true }).selectOption('high')
  await page.getByLabel('自动画面比例 2', { exact: true }).fill(' 3:2 ')
  await page.getByRole('combobox', { name: '自动背景 2', exact: true }).selectOption('transparent')
  await page.getByLabel('备注 2', { exact: true }).fill('图片接口')
  await page.getByRole('combobox', { name: '接口格式 3', exact: true }).selectOption('openai')
  await page.getByRole('combobox', { name: '任务协议 3', exact: true }).selectOption('sync')
  await page.getByLabel('自动分辨率 3', { exact: true }).fill('720P')
  await page.getByLabel('可选分辨率 3', { exact: true }).fill('480p，720p 1080p')
  await page.getByLabel('自动画面比例 3', { exact: true }).fill('16:9')
  await page.getByRole('combobox', { name: '视频参数格式 3', exact: true }).selectOption('seedance')
  await page.getByLabel('备注 3', { exact: true }).fill('视频参数由后台统一设置')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  const expected: ModelTypeSetting[] = [
    { id: 'custom/text', kind: 'text', apiFormat: 'responses', text: { autoReasoningEffort: 'high' }, remark: '仅供管理员查看\n对话模型' },
    { id: 'custom/image', kind: 'image', apiFormat: 'images', protocol: 'async', image: {
      autoResolution: '2k', autoQuality: 'high', autoAspectRatio: '3:2', autoBackground: 'transparent',
    }, remark: '图片接口' },
    { id: 'custom/video', kind: 'video', apiFormat: 'openai', protocol: 'sync', video: {
      autoResolution: '720p', resolutions: ['480p', '720p', '1080p'], autoAspectRatio: '16:9', parameterFormat: 'seedance',
    }, remark: '视频参数由后台统一设置' },
  ]
  await expect.poll(() => fixture.state.config.communityModelTypes).toEqual(expected)
  expect(fixture.writes[0]!.body.version).toBe('version-1')
  expect(fixture.writes[0]!.body.communityModelTypes.every((item: Record<string, unknown>) => !('resolutionInput' in item))).toBe(true)
  await page.reload()
  await expect(page.getByRole('combobox', { name: '接口格式 1', exact: true })).toHaveValue('responses')
  await expect(page.getByRole('combobox', { name: '自动推理强度 1', exact: true })).toHaveValue('high')
  await expect(page.getByLabel('备注 1', { exact: true })).toHaveValue('仅供管理员查看\n对话模型')
  await expect(page.getByRole('combobox', { name: '任务协议 2', exact: true })).toHaveValue('async')
  await expect(page.getByRole('combobox', { name: '自动分辨率 2', exact: true })).toHaveValue('2k')
  await expect(page.getByRole('combobox', { name: '自动画质 2', exact: true })).toHaveValue('high')
  await expect(page.getByLabel('自动画面比例 2', { exact: true })).toHaveValue('3:2')
  await expect(page.getByRole('combobox', { name: '自动背景 2', exact: true })).toHaveValue('transparent')
  await expect(page.getByRole('combobox', { name: '视频参数格式 3', exact: true })).toHaveValue('seedance')
  await expect(page.getByLabel('可选分辨率 3', { exact: true })).toHaveValue('480p, 720p, 1080p')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.getByLabel('模型 ID 1', { exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.model-type-row').evaluateAll(elements => elements.every(element =>
      [...element.querySelectorAll('input,select,textarea,button')].every(control => {
        const bounds = control.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.width > 0
      })))).toBe(true)
    await page.screenshot({ path: info.outputPath(`model-settings-${width}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})

test('model automatic selections can clear every override without filling missing defaults', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.state.config.communityModelTypes = [
    { id: 'custom/text', kind: 'text', apiFormat: 'claude', text: { autoReasoningEffort: 'max' }, remark: '清除此备注' },
    { id: 'custom/image', kind: 'image', apiFormat: 'images', protocol: 'async', image: {
      autoResolution: '4k', autoQuality: 'max', autoAspectRatio: '1:1', autoBackground: 'opaque',
    } },
    { id: 'custom/video', kind: 'video', apiFormat: 'openai', protocol: 'sync', video: {
      autoResolution: '1080p', resolutions: ['720p', '1080p'], autoAspectRatio: '9:16', parameterFormat: 'xai',
    } },
  ]
  await page.goto('/admin?tab=settings')
  for (const label of ['接口格式 1', '自动推理强度 1', '接口格式 2', '任务协议 2', '自动分辨率 2',
    '自动画质 2', '自动背景 2', '接口格式 3', '任务协议 3', '视频参数格式 3']) {
    await page.getByRole('combobox', { name: label, exact: true }).selectOption('auto')
  }
  for (const label of ['备注 1', '自动画面比例 2', '自动分辨率 3', '可选分辨率 3', '自动画面比例 3']) {
    await page.getByLabel(label, { exact: true }).fill('')
  }
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.state.config.communityModelTypes).toEqual([
    { id: 'custom/text', kind: 'text' }, { id: 'custom/image', kind: 'image' }, { id: 'custom/video', kind: 'video' },
  ])
  await page.reload()
  await expect(page.getByRole('combobox', { name: '接口格式 1', exact: true })).toHaveValue('auto')
  await expect(page.getByRole('combobox', { name: '自动分辨率 2', exact: true })).toHaveValue('auto')
  await expect(page.getByRole('combobox', { name: '自动推理强度 1', exact: true })).toHaveValue('auto')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(2)
  expect(fixture.writes[1]!.body.communityModelTypes).toEqual(fixture.writes[0]!.body.communityModelTypes)
})

test('changing model interfaces and kinds clears incompatible settings while retaining remarks', async ({ page }, info) => {
  const fixture = await adminFixture(page)
  fixture.state.config.communityModelTypes = [{ id: 'custom/model', kind: 'image', apiFormat: 'images', protocol: 'async',
    image: { autoResolution: '2k', autoQuality: 'high', autoAspectRatio: '3:2', autoBackground: 'transparent' }, remark: '保留此模型备注' }]
  await page.goto('/admin?tab=settings')
  await page.getByRole('combobox', { name: '接口格式 1', exact: true }).selectOption('chat-completions')
  await expect(page.getByRole('combobox', { name: '任务协议 1', exact: true })).toHaveValue('auto')
  await expect(page.getByRole('combobox', { name: '任务协议 1', exact: true }).locator('option[value="auto"]')).toHaveText('沿用默认')
  await expect(page.getByRole('combobox', { name: '任务协议 1', exact: true }).locator('option[value="async"]')).toBeDisabled()
  const parameters = page.getByRole('group', { name: '图片自动参数 1', exact: true })
  await expect(parameters).toHaveAttribute('disabled', '')
  for (const name of ['自动分辨率 1', '自动画质 1', '自动背景 1']) {
    await expect(page.getByRole('combobox', { name, exact: true })).toBeDisabled()
  }
  await expect(page.getByLabel('自动画面比例 1', { exact: true })).toBeDisabled()
  const notice = page.getByText('图片对话接口的尺寸、画质和背景由上游决定。', { exact: true })
  await expect(notice).toBeVisible()
  await expect(page.getByLabel('备注 1', { exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.state.config.communityModelTypes[0]?.image).toEqual({
    autoResolution: '2k', autoQuality: 'high', autoAspectRatio: '3:2', autoBackground: 'transparent',
  })
  await page.getByRole('combobox', { name: '接口格式 1', exact: true }).selectOption('images')
  await expect(parameters).not.toHaveAttribute('disabled')
  await expect(notice).toHaveCount(0)
  await page.getByRole('combobox', { name: '任务协议 1', exact: true }).selectOption('async')
  await page.getByLabel('模型 ID 1', { exact: true }).fill('gemini-2.5-flash-image')
  await page.getByRole('combobox', { name: '接口格式 1', exact: true }).selectOption('auto')
  await expect(parameters).toHaveAttribute('disabled', '')
  await expect(notice).toBeVisible()
  await expect(page.getByRole('combobox', { name: '任务协议 1', exact: true })).toHaveValue('auto')
  await expect(page.getByRole('combobox', { name: '任务协议 1', exact: true }).locator('option[value="async"]')).toBeDisabled()
  await page.setViewportSize({ width: 320, height: 1000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('image-chat-parameters-320.png'), fullPage: true })
  await page.getByRole('combobox', { name: '接口格式 1', exact: true }).selectOption('images')
  await expect(parameters).not.toHaveAttribute('disabled')
  await expect(notice).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '任务协议 1', exact: true }).locator('option[value="async"]')).toBeEnabled()
  await expect(page.getByRole('combobox', { name: '自动分辨率 1', exact: true })).toHaveValue('2k')
  await expect(page.getByRole('combobox', { name: '自动画质 1', exact: true })).toHaveValue('high')
  await expect(page.getByLabel('自动画面比例 1', { exact: true })).toHaveValue('3:2')
  await expect(page.getByRole('combobox', { name: '自动背景 1', exact: true })).toHaveValue('transparent')
  await page.getByLabel('模型 ID 1', { exact: true }).fill('custom/model')
  await page.getByRole('combobox', { name: '任务协议 1', exact: true }).selectOption('sync')
  await page.getByRole('combobox', { name: '类型 1', exact: true }).selectOption('video')
  await expect(page.getByRole('combobox', { name: '接口格式 1', exact: true })).toHaveValue('auto')
  await expect(page.getByRole('combobox', { name: '任务协议 1', exact: true })).toHaveValue('sync')
  await expect(page.getByRole('combobox', { name: '自动画质 1', exact: true })).toHaveCount(0)
  await page.getByLabel('自动分辨率 1', { exact: true }).fill('720p')
  await page.getByRole('combobox', { name: '视频参数格式 1', exact: true }).selectOption('seedance')
  await page.getByRole('combobox', { name: '类型 1', exact: true }).selectOption('text')
  await expect(page.getByRole('combobox', { name: '任务协议 1', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '视频参数格式 1', exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: '接口格式 1', exact: true }).selectOption('claude')
  await page.getByRole('combobox', { name: '自动推理强度 1', exact: true }).selectOption('ultra')
  await page.getByRole('combobox', { name: '类型 1', exact: true }).selectOption('image')
  await expect(page.getByRole('combobox', { name: '接口格式 1', exact: true })).toHaveValue('auto')
  await expect(page.getByRole('combobox', { name: '自动推理强度 1', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '自动分辨率 1', exact: true })).toHaveValue('auto')
  await expect(page.getByLabel('备注 1', { exact: true })).toHaveValue('保留此模型备注')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.state.config.communityModelTypes).toEqual([
    { id: 'custom/model', kind: 'image', remark: '保留此模型备注' },
  ])
})

test('invalid automatic model parameters retain the draft and do not send configuration patches', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.state.config.communityModelTypes = [{ id: 'custom/image', kind: 'image', apiFormat: 'chat-completions', protocol: 'async' }]
  await page.goto('/admin?tab=settings')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('不支持异步任务协议')
  expect(fixture.writes).toHaveLength(0)
  await page.getByRole('combobox', { name: '接口格式 1', exact: true }).selectOption('images')
  const ratio = page.getByLabel('自动画面比例 1', { exact: true })
  for (const value of ['0:9', '16/9', '1000:9']) {
    await ratio.fill(value)
    await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('画面比例')
    await expect(ratio).toHaveValue(value)
    expect(fixture.writes).toHaveLength(0)
  }
  await ratio.fill('')
  await page.getByRole('combobox', { name: '任务协议 1', exact: true }).selectOption('sync')
  await page.getByLabel('备注 1', { exact: true }).fill('无效\u0001备注')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('备注')
  await expect(page.getByLabel('备注 1', { exact: true })).toHaveValue('无效\u0001备注')
  expect(fixture.writes).toHaveLength(0)
  await page.getByLabel('备注 1', { exact: true }).fill('修正后的备注')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(1)
  expect(fixture.state.config.communityModelTypes).toEqual([
    { id: 'custom/image', kind: 'image', apiFormat: 'images', protocol: 'sync', remark: '修正后的备注' },
  ])
})

test('conflicting model configuration saves preserve raw parameters and remarks until a successful save', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.state.config.communityModelTypes = [{ id: 'custom/video', kind: 'video' }]
  await page.goto('/admin?tab=settings')
  await page.getByRole('combobox', { name: '接口格式 1', exact: true }).selectOption('openai')
  await page.getByRole('combobox', { name: '任务协议 1', exact: true }).selectOption('async')
  await page.getByLabel('自动分辨率 1', { exact: true }).fill('720P')
  await page.getByLabel('可选分辨率 1', { exact: true }).fill('480p 720p')
  await page.getByLabel('自动画面比例 1', { exact: true }).fill(' 16:9 ')
  await page.getByLabel('备注 1', { exact: true }).fill('未保存的备注\n第二行')
  fixture.state.conflict = true
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('你的输入仍保留')
  await expect(page.getByLabel('自动分辨率 1', { exact: true })).toHaveValue('720P')
  await expect(page.getByLabel('可选分辨率 1', { exact: true })).toHaveValue('480p 720p')
  await expect(page.getByLabel('自动画面比例 1', { exact: true })).toHaveValue(' 16:9 ')
  await expect(page.getByLabel('备注 1', { exact: true })).toHaveValue('未保存的备注\n第二行')
  expect(fixture.state.config.communityModelTypes).toEqual([{ id: 'custom/video', kind: 'video' }])
  fixture.state.conflict = false
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect(page.locator('.editor-savebar')).toContainText('修改已保存')
  expect(fixture.writes[1]!.body).toMatchObject({ version: 'version-1', communityModelTypes: [
    { id: 'custom/video', kind: 'video', apiFormat: 'openai', protocol: 'async',
      video: { autoResolution: '720p', resolutions: ['480p', '720p'], autoAspectRatio: '16:9' }, remark: '未保存的备注\n第二行' },
  ] })
})

test('moderators and ordinary accounts cannot read site settings', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.account.state.user.isAdmin = false; fixture.account.state.user.isModerator = true
  const reads: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/admin/settings') reads.push(request.url()) })
  await page.goto('/admin')
  await expect(page.getByRole('navigation', { name: '管理分类', exact: true }).getByRole('button', { name: '站点设置' })).toHaveCount(0)
  expect(reads).toEqual([])
})

test('long configured names fit both the site header and guest login branding', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.state.settings.brand = 'Community'.repeat(8)
  for (const width of [1024, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/admin')
    await expect(page).toHaveTitle(`管理 · ${fixture.state.settings.brand}`)
    if (width >= 1000) {
      const brand = page.locator('.rail-brand')
      await expect(brand).toBeVisible()
      await expect(brand).toHaveAccessibleName('展开侧栏')
      await expect(brand.locator('.rail-brand-fallback')).toHaveText(fixture.state.settings.brand.slice(0, 1))
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  fixture.account.state.authenticated = false; fixture.account.state.accountAuthenticated = false
  await page.goto('/account')
  await expect(page.locator('.auth-mobile-brand')).toHaveText(fixture.state.settings.brand)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a save response from a closed settings tab cannot overwrite a newer saved brand', async ({ page }) => {
  const fixture = await adminFixture(page)
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  let delayed = false
  await page.route('**/api/admin/settings', async route => {
    const request = route.request()
    if (request.method() !== 'PATCH' || request.postDataJSON().settings.brand !== '第一次保存') return route.fallback()
    const body = request.postDataJSON()
    Object.assign(fixture.state.settings, body.settings); fixture.state.revision++
    const response = { settings: { ...fixture.state.settings }, version: `version-${fixture.state.revision}` }
    delayed = true; await wait
    await route.fulfill({ json: response })
  })
  await page.goto('/admin'); await openTab(page, '站点设置')
  await page.getByLabel('站点名称', { exact: true }).fill('第一次保存')
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click()
  await expect.poll(() => delayed).toBe(true)
  await openTab(page, '内容标签')
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await openTab(page, '站点设置')
  await page.getByLabel('站点名称', { exact: true }).fill('第二次保存')
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click()
  await expect(page.locator('.app-footer > span')).toHaveText('第二次保存')
  const completed = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/api/admin/settings'))
  release(); await completed; await page.waitForTimeout(100)
  await expect(page.locator('.app-footer > span')).toHaveText('第二次保存')
  await expect(page).toHaveTitle('管理 · 第二次保存')
})

test('direct links, browser back and leaving a dirty editor preserve the intended draft', async ({ page }) => {
  await adminFixture(page)
  await page.goto('/admin?tab=settings')
  await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('3')
  await page.getByLabel('违规次数阈值', { exact: true }).fill('7')
  await openTab(page, '站点设置')
  await expect(page.getByRole('dialog', { name: '保留这次修改？' })).toBeVisible()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page).toHaveURL(/tab=settings/)
  await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('7')
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false)
  await openTab(page, '站点设置')
  await page.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await expect(page.getByLabel('站点名称', { exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('3')
  await page.getByLabel('违规次数阈值', { exact: true }).fill('8')
  await page.getByRole('link', { name: '访问社区', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('8')
  await page.getByRole('button', { name: '保存社区设置', exact: true }).click()
  await expect(page.locator('.editor-savebar')).toContainText('修改已保存')
  await openTab(page, '站点设置')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('unfinished tag names prompt before leaving and survive cancel', async ({ page }) => {
  await adminFixture(page)
  await page.goto('/admin?tab=tags')
  await page.getByLabel('添加图片标签', { exact: true }).fill('还没添加的标签')
  await openTab(page, '管理概览')
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('添加图片标签', { exact: true })).toHaveValue('还没添加的标签')
})

test('lottery configuration changes survive cancelled refresh and cancelled navigation', async ({ page }) => {
  await adminFixture(page)
  await page.route('**/api/admin/lottery/config', route => route.fulfill({ json: { version: 1, settings: defaultLotterySettings() } }))
  await page.goto('/admin?tab=lottery')
  await page.getByLabel('活动标题', { exact: true }).fill('秋日创作活动')
  await page.getByRole('button', { name: '重新读取抽奖配置', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('活动标题', { exact: true })).toHaveValue('秋日创作活动')
  await openTab(page, '管理概览')
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('活动标题', { exact: true })).toHaveValue('秋日创作活动')
  await page.getByRole('button', { name: '重新读取抽奖配置', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并刷新', exact: true }).click()
  await expect(page.getByLabel('活动标题', { exact: true })).toHaveValue('')
})

const pendingWork = { id: 'work1', title: '山海之间的光', author: '木白', kind: 'image', status: 'pending', version: 1, date: '2026-11-13T02:20:00Z', cover: '' }

test('review requests server filters, loads the next page and keeps revision review semantics', async ({ page }) => {
  await adminFixture(page)
  const requests: URL[] = []
  await page.route('**/api/admin/submissions?**', route => {
    const url = new URL(route.request().url()); requests.push(url)
    if (url.searchParams.get('query')) return route.fulfill({ json: { items: [{ ...pendingWork, id: 'older', title: '更早的匹配作品' }], nextCursor: null } })
    if (url.searchParams.get('cursor')) return route.fulfill({ json: { items: [{ ...pendingWork, id: 'work2', title: '第二页作品' }], nextCursor: null } })
    return route.fulfill({ json: { items: [{ ...pendingWork, status: 'published', revisionPending: true }], nextCursor: 'next-page' } })
  })
  await page.goto('/admin?tab=review')
  await expect(page.getByText('修改待审核', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '通过：山海之间的光' })).toBeVisible()
  expect(requests.at(-1)!.searchParams.get('status')).toBe('pending')
  await page.getByRole('button', { name: '加载更多作品', exact: true }).click()
  await expect(page.getByRole('link', { name: '第二页作品', exact: true })).toBeVisible()
  expect(requests.at(-1)!.searchParams.get('cursor')).toBe('next-page')
  await page.getByRole('button', { name: '已公开', exact: true }).click()
  await expect.poll(() => requests.at(-1)!.searchParams.get('status')).toBe('published')
  expect(requests.at(-1)!.searchParams.has('cursor')).toBe(false)
  await page.getByLabel('搜索作品或作者', { exact: true }).fill('更早')
  await page.locator('.review-search').getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.getByRole('link', { name: '更早的匹配作品', exact: true })).toBeVisible()
  expect(requests.at(-1)!.searchParams.get('query')).toBe('更早')
  await expect(page.getByRole('link', { name: '第二页作品', exact: true })).toHaveCount(0)
})

test('admin overview and editor layouts fit desktop, tablet and narrow phones with accessible controls', async ({ page }) => {
  await adminFixture(page)
  await page.route('**/api/admin/submissions?**', route => route.fulfill({ json: { items: [pendingWork,
    { ...pendingWork, id: 'work2', title: '微缩城市 · 雨后的街道', author: '阿树', kind: 'video' },
    { ...pendingWork, id: 'work3', title: '创作灵感整理', kind: 'resource', status: 'published', revisionPending: true },
    { ...pendingWork, id: 'work4', status: 'published' }, { ...pendingWork, id: 'work5', status: 'rejected' }], nextCursor: 'more' } }))
  await mkdir('.impeccable/review/admin-panel', { recursive: true })
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const tab of ['overview', 'settings', 'ads', 'review']) {
      await page.goto('/admin?tab=' + tab)
      await expect(page.locator('.admin-layout')).toBeVisible()
      if (tab === 'overview') await expect(page.getByText('全量统计', { exact: false })).toBeVisible()
      else if (tab === 'settings') await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('3')
      else if (tab === 'ads') await expect(page.locator('.ad-editor')).toHaveCount(4)
      else await expect(page.locator('.review-table')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: '.impeccable/review/admin-panel/' + tab + '-' + width + '.png', fullPage: true })
      if (width === 1440 && ['overview', 'settings'].includes(tab)) {
        const result = await new AxeBuilder({ page }).include('.admin-page').analyze()
        expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
      }
    }
  }
})

test('a moderator deep link to site settings does not issue privileged reads', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.account.state.user.isAdmin = false; fixture.account.state.user.isModerator = true
  const privileged: string[] = []
  page.on('request', request => { if (/\/api\/admin\/(settings|community|users|tags|lottery)/.test(request.url())) privileged.push(request.url()) })
  await page.goto('/admin?tab=site')
  await expect(page.getByRole('heading', { name: '管理概览', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '站点设置', exact: true })).toHaveCount(0)
  expect(privileged).toEqual([])
})

test('review settings save publishing, suspension and refresh options without overwriting unrelated configuration', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.state.config.communityModelTypes = [{ id: 'keep-model', kind: 'video' }]
  await page.goto('/admin?tab=review')
  const settings = page.getByRole('region', { name: '审核设置', exact: true })
  await expect(settings.getByRole('radio', { name: /^先审后发/ })).toBeChecked()
  await settings.getByRole('radio', { name: /^先发后审/ }).check()
  await settings.getByLabel('违规次数阈值', { exact: true }).fill('5')
  await settings.getByRole('switch', { name: '达到阈值自动封禁' }).uncheck()
  await settings.getByRole('combobox', { name: '首页推荐排序', exact: true }).selectOption('latest')
  await settings.getByLabel('旧版随机接口候选池', { exact: true }).fill('300')
  await settings.getByRole('switch', { name: '手机下拉刷新' }).uncheck()
  await settings.getByRole('button', { name: '保存审核设置', exact: true }).click()
  await expect(settings.getByRole('status')).toContainText('修改已保存')
  expect(fixture.writes[0]!.body).toEqual({ version: 'version-1', communityPublicationMode: 'after', communityAutoBanEnabled: false,
    communityViolationThreshold: 5, communityFeedMode: 'latest', communityFeedPoolSize: 300, communityPullToRefresh: false,
    communityFeedWeights: { interest: 60, fresh: 25, explore: 15 } })
  expect(fixture.state.config.communityModelTypes).toEqual([{ id: 'keep-model', kind: 'video' }])
  expect(fixture.state.config.uploadLimits.image).toBe(20)
  await page.reload()
  await expect(settings.getByRole('radio', { name: /^先发后审/ })).toBeChecked()
  await expect(settings.getByLabel('违规次数阈值', { exact: true })).toHaveValue('5')
  await expect(settings.getByRole('switch', { name: '达到阈值自动封禁' })).not.toBeChecked()
  await settings.getByRole('radio', { name: /^先审后发/ }).check()
  await settings.getByRole('switch', { name: '达到阈值自动封禁' }).check()
  await settings.getByRole('button', { name: '保存审核设置', exact: true }).click()
  await expect.poll(() => fixture.writes.length).toBe(2)
  expect(fixture.writes[1]!.body).toMatchObject({ version: 'version-2', communityPublicationMode: 'before', communityAutoBanEnabled: true })
  await openTab(page, '社区设置')
  await expect(page.getByRole('combobox', { name: '内容发布方式', exact: true })).toHaveValue('before')
  await expect(page.getByLabel('违规次数阈值', { exact: true })).toHaveValue('5')
})

test('delayed review settings saves cannot update a switched or demoted account', async ({ page }) => {
  const fixture = await adminFixture(page)
  let release!: () => void, started = false
  const wait = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/admin/community/config', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    started = true; await wait
    await route.fulfill({ json: { config: { ...fixture.state.config, communityViolationThreshold: 8 }, version: 'late' } }).catch(() => {})
  })
  await page.goto('/admin?tab=review')
  await page.getByLabel('违规次数阈值', { exact: true }).fill('8')
  await page.getByRole('button', { name: '保存审核设置', exact: true }).click()
  await expect.poll(() => started).toBe(true)
  fixture.account.state.user.id = 'newModerator'; fixture.account.state.user.isAdmin = false; fixture.account.state.user.isModerator = true
  await page.evaluate(async () => { const state = await import('/src/state.ts'); await state.loadSession(true) })
  await expect(page.getByRole('region', { name: '审核设置', exact: true })).toHaveCount(0)
  release(); await page.waitForTimeout(150)
  await expect(page.getByRole('region', { name: '审核设置', exact: true })).toHaveCount(0)
  await expect(page.getByText('审核设置已保存。', { exact: true })).toHaveCount(0)
})

test('review settings validate ranges and preserve edits on conflicts and navigation', async ({ page }) => {
  const fixture = await adminFixture(page)
  await page.goto('/admin?tab=review')
  const settings = page.getByRole('region', { name: '审核设置', exact: true })
  const threshold = settings.getByLabel('违规次数阈值', { exact: true }), save = settings.getByRole('button', { name: '保存审核设置', exact: true })
  for (const value of ['0', '1001', '1.5', '']) {
    await threshold.fill(value)
    await expect(threshold).toHaveAttribute('aria-invalid', 'true')
    await expect(save).toBeDisabled()
  }
  await threshold.fill('5')
  await settings.getByLabel('旧版随机接口候选池', { exact: true }).fill('19')
  await expect(save).toBeDisabled()
  await settings.getByLabel('旧版随机接口候选池', { exact: true }).fill('200')
  await settings.getByLabel('兴趣权重', { exact: true }).fill('90')
  await expect(settings.getByRole('alert')).toContainText('三项合计为 100')
  await expect(save).toBeDisabled()
  await settings.getByLabel('兴趣权重', { exact: true }).fill('60')
  expect(fixture.writes).toHaveLength(0)
  await openTab(page, '管理概览')
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(threshold).toHaveValue('5')
  fixture.state.config.communityViolationThreshold = 8; fixture.state.revision++
  await save.click()
  await expect(settings.getByRole('alert')).toContainText('你的输入仍保留')
  await expect(threshold).toHaveValue('5')
  await settings.getByRole('button', { name: '刷新审核设置', exact: true }).click()
  await settings.getByRole('button', { name: '放弃修改并刷新', exact: true }).click()
  await expect(threshold).toHaveValue('8')
  await expect(save).toBeDisabled()
})

test('failed review settings can reload and moderators can review without reading administrator configuration', async ({ page }) => {
  const fixture = await adminFixture(page)
  fixture.state.failRead = '/config'
  await page.goto('/admin?tab=review')
  await expect(page.getByRole('region', { name: '审核设置' }).getByRole('alert')).toContainText('配置加载失败')
  await expect(page.getByRole('radio')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '保存审核设置', exact: true })).toHaveCount(0)
  fixture.state.failRead = ''
  await page.getByRole('button', { name: '刷新审核设置', exact: true }).click()
  await expect(page.getByRole('radio', { name: /^先审后发/ })).toBeChecked()
  fixture.account.state.user.isAdmin = false; fixture.account.state.user.isModerator = true
  const privileged: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/admin/community/config') privileged.push(request.url()) })
  await page.reload()
  await expect(page.getByRole('heading', { name: '作品审核', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '审核设置', exact: true })).toHaveCount(0)
  expect(privileged).toEqual([])
})

test('published unreviewed work can be approved once and ordinary rejections only count explicit violations', async ({ page }) => {
  await adminFixture(page)
  const items = [
    { ...pendingWork, id: 'public1', title: '先发后审作品', status: 'published', originalStatus: 'published' },
    { ...pendingWork, id: 'approved1', title: '已通过作品', status: 'published', originalStatus: 'approved' },
    { ...pendingWork, id: 'pending1', title: '未公开投稿', originalStatus: 'pending' },
  ]
  const decisions: { id: string; body: Record<string, any> }[] = []
  await page.route('**/api/admin/submissions?**', route => route.fulfill({ json: { items, pendingCount: 2, nextCursor: null } }))
  await page.route('**/api/admin/submissions/*/review', async route => {
    const body = route.request().postDataJSON(), id = new URL(route.request().url()).pathname.split('/').at(-2)!
    decisions.push({ id, body })
    const work = items.find(item => item.id === id)!
    work.originalStatus = body.action === 'approve' ? 'approved' : body.action === 'remove' ? 'removed' : 'rejected'
    work.version++
    await route.fulfill({ json: { work } })
  })
  await page.goto('/admin?tab=review')
  await expect(page.getByText('已公开 · 待审核', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '驳回：先发后审作品', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '通过：已通过作品', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '通过：先发后审作品', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('button', { name: '通过：先发后审作品', exact: true })).toHaveCount(0)
  expect(decisions[0]).toMatchObject({ id: 'public1', body: { action: 'approve', version: 1, recordViolation: false } })
  await page.getByRole('button', { name: '驳回：未公开投稿', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
  await dialog.getByLabel('审核说明').fill('内容信息不完整')
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => decisions.length).toBe(2)
  expect(decisions[1]!.body).toMatchObject({ action: 'reject', recordViolation: false, reason: '内容信息不完整' })
  await page.getByRole('button', { name: '撤下：已通过作品', exact: true }).click()
  await dialog.getByLabel('审核说明').fill('确认违规')
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await expect.poll(() => decisions.length).toBe(3)
  expect(decisions[2]!.body).toMatchObject({ action: 'remove', reason: '确认违规' })
})

for (const colorScheme of ['light', 'dark'] as const) test(`review policy layout works on desktop and phones in ${colorScheme}`, async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await adminFixture(page)
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
  await page.addInitScript(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'cloud', dark: 'sage' })), colorScheme)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/admin?tab=review')
    const policy = page.getByRole('region', { name: '审核设置', exact: true })
    await expect(policy.getByRole('radio', { name: /^先审后发/ })).toBeChecked()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await policy.getByRole('radio', { name: /^先审后发/ }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(policy.getByRole('radio', { name: /^先发后审/ })).toBeChecked()
    await policy.getByRole('button', { name: '保存审核设置', exact: true }).click()
    await expect(policy.getByRole('status')).toContainText('修改已保存')
    await policy.getByRole('radio', { name: /^先审后发/ }).check()
    await policy.getByRole('button', { name: '保存审核设置', exact: true }).click()
    await expect(policy.getByRole('status')).toContainText('修改已保存')
    if (width !== 390) {
      const audit = await new AxeBuilder({ page }).include('.admin-page').analyze()
      expect(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([])
    }
    await page.screenshot({ path: testInfo.outputPath(`review-${colorScheme}-${width}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})
