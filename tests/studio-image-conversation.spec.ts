import { confirmImageDownload } from './helpers/image-download'
import { expect, test, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, kind = 'image') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const image = await readFile('public/assets/brand/octopus-community.jpg')
  const calls: any[] = [], uploads: string[] = []
  let selectedGroup = 'auto'
  await page.route('**/api/new-api/model-groups**', route => {
    const select = new URL(route.request().url()).pathname.endsWith('/select')
    if (select) { selectedGroup = route.request().postDataJSON().group; return route.fulfill({ json: { success: true, data: { group: selectedGroup, selectedTokenId: 41 } } }) }
    return route.fulfill({ json: { success: true, data: { selectedGroup, groups: [{ id: 'auto', name: 'Auto', ratio: 1 }, { id: 'image', name: '图片', ratio: 1 }], selectedTokenId: 41 } } })
  })
  await page.route('**/api/uploads**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { imagesMb: 20, filesMb: 20, videosMb: 100 } })
    uploads.push('uploaded')
    return route.fulfill({ json: { file: { id: `upload${uploads.length}`, name: 'reference.png', url: `/legacy-files/upload${uploads.length}`, type: 'image', size: image.length } } })
  })
  await page.route('**/legacy-files/**', route => route.fulfill({ contentType: 'image/jpeg', body: image }))
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [
      { id: 'gpt-image-2', kinds: ['image'] }, { id: 'gemini-3-pro-image-preview', kinds: ['image'] },
      { id: 'sora-2', kinds: ['video'] }, { id: 'gpt-5', kinds: ['text'] },
    ] } })
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: image })
    if (path === '/api/creation/skills/catalog') return route.fulfill({ json: { items: [] } })
    if (path === '/api/creation/mcp/status') return route.fulfill({ json: { enabled: false, items: [] } })
    if (path === '/api/creation/generate') {
      calls.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: `https://media.example/output-${calls.length}.png` }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: {} })
  })
  await page.addInitScript(() => {
    if (sessionStorage.getItem('image-conversation-fixture')) return
    sessionStorage.setItem('image-conversation-fixture', '1')
    localStorage.setItem('octopus:user-17:native-media-settings', JSON.stringify({ autoDownload: false, autoSaveGallery: true }))
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'image-a', mediaConversationsMigrated: true, sessions: [
        { id: 'image-a', mediaConversationId: 'image-a', creationKind: 'image', topic: '图片对话', model: 'gpt-image-2', lastUpdate: Date.now(), settings: {}, skillIds: [], messages: [] },
        { id: 'image-b', mediaConversationId: 'image-b', creationKind: 'image', topic: '另一图片对话', model: 'gpt-image-2', lastUpdate: Date.now() - 1, settings: {}, skillIds: [], messages: [] },
      ],
    } }))
  })
  await page.goto(new URL(`/create/${kind}`, String(test.info().project.use.baseURL)).href)
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(kind === 'video' ? 'sora-2' : kind === 'text' ? 'gpt-5' : 'gpt-image-2')
  await expect(page.locator('.studio-composer')).not.toHaveAttribute('inert')
  return { calls, uploads, image }
}
const imageReference = (image: Buffer, type = 'jpeg') => `data:image/${type};base64,${image.toString('base64')}`

for (const [model, format, width] of [['gpt-image-2', 'images', 1440], ['gemini-3-pro-image-preview', 'gemini', 1440], ['gemini-3-pro-image-preview', 'chat-completions', 390]] as const) test(`prompt-only ${model} ${format} requests never reuse previous images after sending or refreshing`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const { calls } = await fixture(page)
  await page.getByRole('combobox', { name: '模型', exact: true }).click()
  await page.getByRole('button', { name: model, exact: true }).click()
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.locator('.parameter-advanced > summary').click()
  await page.getByRole('dialog', { name: '高级参数', exact: true }).getByRole('combobox', { name: '接口格式', exact: true }).selectOption(format)
  await page.keyboard.press('Escape')
  await send(page, '一组猫头鹰', 1)
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await send(page, '户外海报', 2)
  expect(calls[1].referenceUrls).toEqual([])
  expect(calls[1].imageContext.turns).toEqual([])
  expect(calls[1].apiFormat).toBe(format)
  await expect(page.locator('.creation-request .sent-references img')).toHaveCount(0)
  await page.reload()
  await send(page, '海边日落', 3)
  expect(calls[2].referenceUrls).toEqual([])
  expect(calls[2].imageContext.turns).toEqual([])
  await expect(page.locator('.creation-request .sent-references img')).toHaveCount(0)
})

test('removing the last selected reference never falls back to a previous result', async ({ page }) => {
  const { calls, image } = await fixture(page)
  await send(page, '先生成一张人物图片', 1)
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'reference.jpg', mimeType: 'image/jpeg', buffer: image })
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await page.getByRole('button', { name: '移除参考图 1', exact: true }).click()
  await send(page, '全新的城市海报', 2)
  expect(calls[1].referenceUrls).toEqual([])
  expect(calls[1].imageContext.turns).toEqual([])
  await page.locator('.creation-response').first().getByRole('button', { name: '编辑图片', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await page.getByRole('button', { name: '移除参考图 1', exact: true }).click()
  await send(page, '不使用编辑图片', 3)
  expect(calls[2].referenceUrls).toEqual([])
  expect(calls[2].imageContext.turns).toEqual([])
})

test('pinning only a question never selects its generated image', async ({ page }) => {
  const { calls } = await fixture(page)
  await send(page, '猫头鹰海报', 1)
  await page.locator('.creation-request').first().getByRole('button', { name: '固定到上下文', exact: true }).click()
  await send(page, '保持构图风格重新绘制', 2)
  expect(calls[1].referenceUrls).toEqual([])
  expect(calls[1].imageContext.turns).toEqual([{ prompt: '猫头鹰海报', images: [] }])
})

for (const width of [390, 1440]) test(`large pinned image editing sends original bytes once at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const { calls, image } = await fixture(page)
  const original = Buffer.alloc(12 * 1024 ** 2)
  image.copy(original)
  await page.route('**/api/creation/media?**', route => route.fulfill({ contentType: 'image/jpeg',
    body: new URL(route.request().url()).searchParams.has('variant') ? image : original }))
  await send(page, '原产品图片', 1)
  const first = page.locator('.creation-response').first()
  await first.getByRole('button', { name: '固定到上下文', exact: true }).click()
  await first.getByRole('button', { name: '编辑图片', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await send(page, '移除背景文案，保持产品包装文案不变', 2)
  expect(calls).toHaveLength(2)
  expect(calls[1].referenceUrls).toHaveLength(1)
  expect(Buffer.from(calls[1].referenceUrls[0].split(',')[1], 'base64').equals(original)).toBe(true)
  expect(calls[1].imageContext.turns).toEqual([{ prompt: '原产品图片', images: [] }])
  expect(Buffer.byteLength(JSON.stringify(calls[1]))).toBeLessThan(27 * 1024 ** 2)
})

test('oversized pinned originals keep the draft and explain why clearing context does not help', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  const { image } = await fixture(page)
  const originals = [1, 2].map(value => { const data = Buffer.alloc(11 * 1024 ** 2, value); image.copy(data); return data })
  let calls = 0
  await page.route('**/api/creation/generate', route => {
    calls++
    return route.fulfill({ json: { status: 'succeeded', outputs: [1, 2].map(id => ({ url: `https://media.example/large-${id}.jpg` })), tokenId: 41, protocol: 'sync' } })
  })
  await page.route('**/api/creation/media?**', route => {
    const query = new URL(route.request().url()).searchParams
    return route.fulfill({ contentType: 'image/jpeg', body: query.has('variant') ? image : originals[query.get('url')?.includes('large-2') ? 1 : 0] })
  })
  await send(page, '两张产品原图', 1)
  await page.locator('.creation-response').first().getByRole('button', { name: '固定到上下文', exact: true }).click()
  await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  await page.getByRole('button', { name: '清除上下文', exact: true }).click()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留这条修改要求')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.studio-composer')).toContainText('超过 27 MiB 上限')
  await expect(page.locator('.studio-composer')).toContainText('清除上下文不会移除已固定内容')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留这条修改要求')
  await expect(page.locator('.creation-turn')).toHaveCount(1)
  expect(calls).toBe(1)
})

for (const width of [320, 390, 1440]) test(`QX message toolbar has nine unique icon actions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await fixture(page)
  await send(page, '工具栏展示验证', 1)
  const toolbar = page.getByRole('group', { name: '生成结果操作', exact: true })
  await toolbar.scrollIntoViewIfNeeded()
  await expect(toolbar.getByRole('button')).toHaveCount(9)
  expect(await toolbar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-action')))).toEqual(['editImage', 'edit', 'retry', 'delete', 'pin', 'copy', 'download', 'publish', 'comment'])
  expect(await toolbar.getByRole('button').allTextContents()).toEqual(Array(9).fill(''))
  expect(await toolbar.locator('.message-action-icon').evaluateAll(icons => icons.every(icon => getComputedStyle(icon).maskImage !== 'none'))).toBe(true)
  await expect(page.getByRole('group', { name: '提问操作', exact: true }).getByRole('button')).toHaveCount(6)
  const comment = toolbar.getByRole('button', { name: '发送到源作品评论区', exact: true })
  await expect(comment).toBeDisabled()
  await comment.hover()
  await expect(page.getByRole('tooltip')).toHaveText('从源作品制作同款后，可发布至其评论区')
  const tipBounds = (await page.getByRole('tooltip').boundingBox())!
  expect(tipBounds.x).toBeGreaterThanOrEqual(0)
  expect(tipBounds.x + tipBounds.width).toBeLessThanOrEqual(width)
  await page.getByRole('tooltip').hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await toolbar.getByRole('button', { name: '复制提示词', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tooltip')).toContainText('下载图片')
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '提示词', exact: true }).focus()
  await toolbar.scrollIntoViewIfNeeded()
  const buttons = await toolbar.getByRole('button').evaluateAll(buttons => buttons.map(button => { const b = button.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }))
  expect(buttons.every(button => button.x >= 0 && button.x + button.w <= width)).toBe(true)
  if (width < 640) expect(buttons.every(button => button.w >= 44 && button.h >= 44)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.communityAppearance.set({ mode: theme as 'light' | 'dark' }), theme)
    await page.screenshot({ path: `../studio-toolbar-20261124/toolbar-${width}-${theme}.png` })
    expect((await new AxeBuilder({ page }).include('.studio-message-actions').analyze()).violations).toEqual([])
  }
})

for (const model of ['gpt-image-2', 'gemini-3-pro-image-preview']) test(`pinning an image persists and reaches ${model} after clearing history`, async ({ page }) => {
  const { calls } = await fixture(page)
  if (model !== 'gpt-image-2') {
    await page.getByRole('combobox', { name: '模型', exact: true }).click()
    await page.getByRole('dialog', { name: '选择模型', exact: true })
      .getByRole('button', { name: model, exact: true }).click()
    await page.getByRole('button', { name: '高级参数', exact: true }).click()
    await page.locator('.parameter-advanced > summary').click()
    await page.getByRole('dialog', { name: '高级参数', exact: true }).getByRole('combobox', { name: '接口格式', exact: true }).selectOption('chat-completions')
    await page.keyboard.press('Escape')
  }
  await send(page, '固定这张角色图', 1)
  const first = page.locator('.creation-response').first()
  await first.getByRole('button', { name: '固定到上下文', exact: true }).click()
  await expect(first.getByRole('button', { name: '取消固定', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(first.getByRole('button', { name: '取消固定', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '清除上下文', exact: true }).click()
  await send(page, '保持角色继续创作', 2)
  expect(calls[1].model).toBe(model)
  expect(calls[1].imageContext.turns.map((turn: any) => turn.prompt)).toEqual(['固定这张角色图'])
  if (model === 'gpt-image-2') {
    expect(calls[1].imageContext.turns[0].images).toEqual([])
    expect(calls[1].referenceUrls).toHaveLength(1)
  } else {
    expect(calls[1].imageContext.turns[0].images).toHaveLength(1)
    expect(calls[1].referenceUrls).toEqual([])
  }
  await first.getByRole('button', { name: '取消固定', exact: true }).click()
  await page.getByRole('button', { name: '清除上下文', exact: true }).click()
  await send(page, '重新开始', 3)
  expect(calls[2].imageContext.turns).toEqual([])
})

test('one download action saves every image in a group without adding duplicate tools', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/creation/generate', route => route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/first.png' }, { url: 'https://media.example/second.png' }], tokenId: 41, protocol: 'sync' } }))
  await send(page, '生成一组图片', 1)
  const toolbar = page.getByRole('group', { name: '生成结果操作', exact: true }), downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await expect(toolbar.getByRole('button')).toHaveCount(9)
  await toolbar.getByRole('button', { name: '下载图片', exact: true }).click()
  await confirmImageDownload(page)
  await expect.poll(() => downloads.length).toBe(2)
  expect(new Set(downloads).size).toBe(2)
  expect(downloads.every(name => name.endsWith('.jpg'))).toBe(true)
})

test('touch users can read unavailable action hints without publishing', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  try {
    await fixture(page)
    await send(page, '手机工具栏', 1)
    const toolbar = page.getByRole('group', { name: '生成结果操作', exact: true })
    const comment = toolbar.getByRole('button', { name: '发送到源作品评论区', exact: true })
    await comment.scrollIntoViewIfNeeded()
    const bounds = (await comment.boundingBox())!
    await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await expect(page.getByRole('tooltip')).toContainText('从源作品制作同款后')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.setViewportSize({ width: 812, height: 375 })
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await toolbar.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: '../studio-toolbar-20261124/touch-landscape.png' })
  } finally { await context.close() }
})

async function send(page: Page, prompt: string, turns: number) {
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill(prompt)
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.creation-turn')).toHaveCount(turns)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: '停止等待', exact: true })).toHaveCount(0)
  if (await page.locator('.creation-response .browser-save').count()) await expect(page.locator('.creation-response .browser-save').last()).toHaveText('图片已保存到此浏览器')
}

for (const width of [390, 1440]) test(`image results load lightweight previews and retain original editing and downloads at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const { calls, image } = await fixture(page)
  const { default: sharp } = await import('sharp')
  const original = await sharp(image).resize(2160, 3840, { fit: 'cover' }).png().toBuffer()
  const preview = await sharp(original).resize(960, 960, { fit: 'inside' }).webp({ quality: 82 }).toBuffer()
  const reads: URL[] = []
  await page.route('**/api/creation/media?**', route => {
    const url = new URL(route.request().url())
    reads.push(url)
    return route.fulfill({ contentType: url.searchParams.get('variant') === 'preview' ? 'image/webp' : 'image/png',
      body: url.searchParams.get('variant') === 'preview' ? preview : original })
  })
  await send(page, '轻量图片预览', 1)
  const first = page.locator('.creation-response').first()
  await expect(first.locator('.creation-image-preview')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(() => first.locator('.creation-image img').evaluate((element: HTMLImageElement) => element.naturalHeight)).toBe(384)
  expect(reads.length).toBeGreaterThan(0)
  expect(reads.some(url => url.searchParams.get('variant') === 'preview')).toBe(true)
  expect(reads.filter(url => !url.searchParams.has('variant'))).toHaveLength(1)
  await first.getByRole('button', { name: '编辑图片', exact: true }).click()
  await send(page, '保留原图继续编辑', 2)
  expect(calls[1].referenceUrls).toEqual([imageReference(original, 'png')])
  await first.locator('.creation-image-preview').click()
  const viewer = page.getByRole('dialog', { name: '原始媒体预览', exact: true })
  await expect(viewer).toBeVisible()
  await expect.poll(() => viewer.locator('img').evaluate((element: HTMLImageElement) => element.naturalHeight)).toBe(3840)
  expect(reads.some(url => !url.searchParams.has('variant'))).toBe(true)
  const pending = page.waitForEvent('download')
  await viewer.getByRole('button', { name: '下载图片', exact: true }).click()
  await confirmImageDownload(page)
  const download = await pending
  const metadata = await sharp(await readFile((await download.path())!)).metadata()
  expect(metadata).toMatchObject({ format: 'jpeg', width: 2160, height: 3840 })
})

test('editing a result restores its image and prompt without generating until sent', async ({ page }) => {
  const { calls, image } = await fixture(page)
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'source.jpg', mimeType: 'image/jpeg', buffer: image })
  await send(page, '原始海报', 1)
  await send(page, '另一张海报', 2)
  const first = page.locator('.creation-response').first()
  await expect(first.getByRole('button', { name: '编辑图片', exact: true })).toBeVisible({ timeout: 3000 })
  await first.getByRole('button', { name: '编辑图片', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('原始海报')
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await expect(page.locator('.reference-list img')).toHaveAttribute('src', /^blob:/)
  await expect(page.locator('.creation-editing')).toContainText('编辑图片')
  expect(calls).toHaveLength(2)
  await page.reload()
  await expect(page.locator('.creation-editing')).toContainText('编辑图片')
  await expect(page.locator('.reference-list img')).toHaveAttribute('src', /^blob:/)
  await send(page, '将原始海报改为蓝色', 3)
  expect(calls[2].referenceUrls).toEqual([imageReference(image)])
  expect(calls[2].imageContext.turns).toEqual([])
  await expect(page.locator('.creation-request').first()).toContainText('原始海报')
  await expect(page.locator('.creation-request').nth(1)).toContainText('另一张海报')
})

test('editing the original prompt restores original attachments and reuse clears the edit branch', async ({ page }) => {
  const { calls, image } = await fixture(page)
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'source.jpg', mimeType: 'image/jpeg', buffer: image })
  await send(page, '原提问', 1)
  const response = page.locator('.creation-response').first()
  await response.getByRole('button', { name: '编辑图片', exact: true }).click()
  await response.getByRole('button', { name: '编辑原提问', exact: true }).click()
  await expect(page.locator('.creation-editing')).toContainText('编辑原提问')
  await expect(page.locator('.reference-list img')).toHaveAttribute('src', /^data:image\/jpeg/)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('原提问')
  expect(calls).toHaveLength(1)
  await response.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '复用参数', exact: true }).click()
  await expect(page.locator('.creation-editing')).toHaveCount(0)
  await send(page, '复用参数的新一轮', 2)
  expect(calls[1].referenceUrls).toEqual(calls[0].referenceUrls)
  await expect(page.locator('.creation-request').first()).toContainText('原提问')
})

test('multi-image edit restores all outputs and the context menu selects the exact image', async ({ page }) => {
  const { image, calls } = await fixture(page)
  const { default: sharp } = await import('sharp')
  const newImage = await sharp(image).flop().jpeg().toBuffer()
  await page.route('**/api/creation/generate', route => {
    calls.push(route.request().postDataJSON())
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/a.png' }, { url: 'https://media.example/b.png' }], tokenId: 41, protocol: 'sync' } })
  })
  await send(page, '两款海报', 1)
  const response = page.locator('.creation-response')
  await response.getByRole('button', { name: '编辑图片', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(2)
  await page.getByRole('button', { name: '取消编辑此轮', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
  await response.locator('.creation-media figure').nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '编辑这张图片', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await expect(page.locator('.reference-list img')).toHaveAttribute('src', /^blob:/)
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'new.jpg', mimeType: 'image/jpeg', buffer: newImage })
  await expect(page.locator('.reference-list img')).toHaveCount(2)
  expect(calls).toHaveLength(1)
  await send(page, '使用第二张和新上传图', 2)
  expect(calls[1].referenceUrls).toEqual([imageReference(image), imageReference(newImage)])
})

test('an image edit survives deleting its source turn without pulling in unrelated context', async ({ page }) => {
  const { calls, image } = await fixture(page)
  await send(page, '待编辑图片', 1)
  await send(page, '保留的另一张图', 2)
  const first = page.locator('.creation-response').first()
  await first.getByRole('button', { name: '编辑图片', exact: true }).click()
  await first.getByRole('button', { name: '删除生成记录', exact: true }).click()
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.creation-turn')).toHaveCount(1)
  await expect(page.locator('.reference-list img')).toHaveAttribute('src', /^blob:/)
  await send(page, '修改已载入的图片', 2)
  expect(calls[2].referenceUrls).toEqual([imageReference(image)])
  expect(calls[2].imageContext.turns).toEqual([])
})

test('image edit drafts stay in their conversation and remain editable during another generation', async ({ page }) => {
  const { calls } = await fixture(page)
  await send(page, '会话里的图片', 1)
  await page.getByRole('button', { name: '编辑图片', exact: true }).click()
  await page.locator('.studio-sidebar').getByRole('button', { name: '另一图片对话', exact: true }).click()
  await expect(page.locator('.creation-editing')).toHaveCount(0)
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await page.locator('.studio-sidebar').getByRole('button', { name: '图片对话', exact: true }).click()
  await expect(page.locator('.creation-editing')).toContainText('编辑图片')
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/generate', async route => {
    calls.push(route.request().postDataJSON())
    await held
    await route.fulfill({ json: { status: 'succeeded', outputs: [{ url: 'https://media.example/finished.png' }], tokenId: 41, protocol: 'sync' } }).catch(() => {})
  })
  try {
    await page.getByRole('button', { name: '开始生成', exact: true }).click()
    await expect.poll(() => calls.length).toBe(2)
    await expect(page.getByRole('button', { name: '编辑图片', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: '编辑原提问', exact: true })).toBeEnabled()
  } finally { release() }
  await expect(page.getByRole('button', { name: '停止等待', exact: true })).toHaveCount(0)
  if (await page.locator('.creation-response .browser-save').count()) await expect(page.locator('.creation-response .browser-save').last()).toHaveText('图片已保存到此浏览器')
})

test('result tools remain reachable on mobile and support keyboard copy and cancel', async ({ page }, info) => {
  test.setTimeout(60000)
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text: string) => { (window as any).copiedPrompt = text } })
  })
  await send(page, '手机海报', 1)
  const response = page.locator('.creation-response')
  for (const button of await response.getByRole('group', { name: '生成结果操作', exact: true }).getByRole('button').all()) {
    const box = await button.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const copy = page.locator('.creation-request').getByRole('button', { name: '复制提示词', exact: true })
  await copy.focus(); await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).copiedPrompt)).toBe('手机海报')
  await response.getByRole('button', { name: '编辑图片', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeFocused()
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => localStorage.setItem('ai-community-next:appearance:v1', JSON.stringify({ mode, light: 'paper', dark: 'sage' })), mode)
    await page.reload()
    await expect(page.locator('.creation-editing')).toContainText('编辑图片')
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(response.getByRole('button', { name: '编辑图片', exact: true })).toBeVisible()
      expect((await new AxeBuilder({ page }).include('.creation-message-actions').include('.creation-editing').analyze()).violations).toEqual([])
      await page.screenshot({ path: info.outputPath(`editor-${width}-${mode}.png`) })
    }
  }
  await page.getByRole('button', { name: '取消编辑此轮', exact: true }).click()
  await expect(page.locator('.creation-turn')).toHaveCount(1)
})

test('new prompts keep independent images and drafts within one session', async ({ page }) => {
  const { calls } = await fixture(page)
  await send(page, '一只白猫', 1)
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await send(page, '背景改成蓝色', 2)
  expect(calls[0].imageContext.turns).toEqual([])
  expect(calls[1].referenceUrls).toEqual([])
  expect(calls[1].imageContext.turns).toEqual([])
  expect(calls[1].conversationId).toBeUndefined()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('当前对话的草稿')
  const sidebar = page.locator('.studio-sidebar')
  await sidebar.getByRole('button', { name: '另一图片对话', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await sidebar.getByRole('button', { name: '图片对话', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('当前对话的草稿')
  await expect(page.locator('.creation-turn')).toHaveCount(2)
})

test('regeneration and edited prompts preserve alternate versions without attaching the branch to new prompts', async ({ page }) => {
  const { calls } = await fixture(page)
  await send(page, '一只白猫', 1)
  await page.getByRole('button', { name: '重新生成此轮', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止等待', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('当前生成版本', { exact: true })).toHaveText('2 / 2')
  await expect(page.locator('.creation-turn')).toHaveCount(1)
  await page.getByRole('button', { name: '上一个版本', exact: true }).click()
  await expect(page.getByLabel('当前生成版本', { exact: true })).toHaveText('1 / 2')
  await send(page, '戴上帽子', 2)
  expect(calls[2].referenceUrls).toEqual([])
  expect(calls[2].imageContext.turns).toEqual([])
  await page.getByRole('button', { name: '编辑并重新生成', exact: true }).first().click()
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('一只黑猫')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.creation-turn')).toHaveCount(1)
  await expect(page.locator('.creation-request')).toContainText('一只黑猫')
  expect(calls[3].imageContext.turns).toEqual([])
  await page.reload()
  await expect(page.locator('.creation-turn')).toHaveCount(1)
  await expect(page.locator('.creation-request')).toContainText('一只黑猫')
})

test('new results never become automatic references; clearing and deleting turns keep gallery data', async ({ page }) => {
  const { calls } = await fixture(page)
  await send(page, '第一张', 1)
  await send(page, '第二张', 2)
  await send(page, '修改第二张', 3)
  expect(calls[2].referenceUrls).toEqual([])
  expect(calls[2].imageContext.turns).toEqual([])
  await page.getByRole('button', { name: '清除上下文', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await send(page, '全新图片', 4)
  expect(calls[3].imageContext.turns).toEqual([])
  expect(calls[3].referenceUrls).toEqual([])
  const viewport = page.viewportSize()!
  await page.setViewportSize({ width: 800, height: viewport.height })
  await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  await page.getByRole('button', { name: '多选消息', exact: true }).click()
  await page.setViewportSize(viewport)
  await page.getByRole('checkbox', { name: '选择消息：第二张', exact: true }).check()
  await page.getByRole('checkbox', { name: '选择消息：修改第二张', exact: true }).check()
  await page.getByRole('button', { name: '删除所选消息', exact: true }).click()
  await page.getByRole('dialog', { name: '删除确认', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.creation-turn')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.creation-turn')).toHaveCount(2)
  const count = await page.evaluate(async () => {
    const { readTaskSnapshot } = await import('/src/studio-task-store.ts')
    return (await readTaskSnapshot('17'))?.length
  })
  expect(count).toBe(4)
})

test('restoring the inline clear boundary never reattaches unselected image history', async ({ page }) => {
  const { calls } = await fixture(page)
  await send(page, '清除前的图片', 1)
  await page.getByRole('button', { name: '清除上下文', exact: true }).click()
  const marker = page.locator('.chat-transcript .clear-context-divider')
  await expect(marker).toBeVisible()
  await expect(page.locator('.toast-message')).toHaveCount(0)
  await send(page, '清除后的图片', 2)
  expect(calls[1].imageContext.turns).toEqual([])
  expect(await marker.evaluate(element => element.previousElementSibling?.classList.contains('creation-turn') && element.nextElementSibling?.classList.contains('creation-turn'))).toBe(true)
  await mkdir('.taste-skill/context-project-layout-20261115', { recursive: true })
  await page.screenshot({ path: '.taste-skill/context-project-layout-20261115/context-desktop.png' })
  await marker.click()
  await expect(marker).toHaveCount(0)
  await send(page, '恢复后继续', 3)
  expect(calls[2].imageContext.turns).toEqual([])
  expect(calls[2].referenceUrls).toEqual([])
  await page.reload()
  await expect(page.locator('.creation-turn')).toHaveCount(3)
  await expect(marker).toHaveCount(0)
})

test('upload, clipboard and drop references share the same attachment flow', async ({ page }) => {
  const { calls, uploads, image } = await fixture(page)
  const { default: sharp } = await import('sharp')
  const variants = [image, await sharp(image).flop().jpeg().toBuffer(), await sharp(image).rotate(90).jpeg().toBuffer()]
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'upload.jpg', mimeType: 'image/jpeg', buffer: image })
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await page.getByRole('textbox', { name: '提示词', exact: true }).evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    const data = new DataTransfer(); data.items.add(new File([bytes], 'pasted.jpg', { type: 'image/jpeg' }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, variants[1]!.toString('base64'))
  await expect(page.locator('.reference-list img')).toHaveCount(2)
  await page.locator('.studio-composer').evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    const data = new DataTransfer(); data.items.add(new File([bytes], 'dropped.jpg', { type: 'image/jpeg' }))
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  }, variants[2]!.toString('base64'))
  await expect(page.locator('.reference-list img')).toHaveCount(3)
  await send(page, '使用这三张参考图', 1)
  expect(uploads).toHaveLength(0)
  expect(calls[0].referenceUrls).toEqual(variants.map(value => imageReference(value)))
})

test('sending keeps uploaded images in the record but never reuses them for a new prompt', async ({ page }) => {
  const { calls, image } = await fixture(page)
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'reference.jpg', mimeType: 'image/jpeg', buffer: image })
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await send(page, '使用上传的参考图', 1)
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await expect(page.locator('.creation-request .sent-references img')).toHaveCount(1)
  expect(calls[0].referenceUrls).toEqual([`data:image/jpeg;base64,${image.toString('base64')}`])
  await page.reload()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('')
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  await expect(page.locator('.creation-request .sent-references img')).toHaveCount(1)
  await send(page, '把背景改成蓝色', 2)
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  expect(calls[1].referenceUrls).toEqual([])
  expect(calls[1].imageContext.turns).toEqual([])
})

async function controlledReader(page: Page) {
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsDataURL
    let failed = false
    FileReader.prototype.readAsDataURL = function (blob: Blob) {
      if (blob instanceof File && blob.name === 'slow.jpg' && !(window as any).__materialReleased) {
        (window as any).__releaseMaterial = () => { (window as any).__materialReleased = true; read.call(this, blob) }
        return
      }
      if (blob instanceof File && blob.name === 'retry.jpg' && !failed) {
        failed = true
        queueMicrotask(() => this.dispatchEvent(new ProgressEvent('error')))
        return
      }
      read.call(this, blob)
    }
  })
}

test('reference thumbnails scroll horizontally, preview and delete on desktop and touch', async ({ page }) => {
  const { image, uploads } = await fixture(page)
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles(Array.from({ length: 9 }, (_, index) => ({ name: `${index}.jpg`, mimeType: 'image/jpeg', buffer: image })))
  const list = page.locator('.reference-list')
  await expect(list.locator('li')).toHaveCount(9)
  expect(await list.evaluate(element => getComputedStyle(element).flexWrap)).toBe('nowrap')
  await page.getByRole('button', { name: '预览参考图 1', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '参考图预览', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭参考图预览', exact: true }).click()
  await list.locator('li').first().hover()
  await page.getByRole('button', { name: '移除参考图 1', exact: true }).click()
  await expect(list.locator('li')).toHaveCount(8)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.screenshot({ path: `.taste-skill/reference-upload-20261115/references-${width}.png` })
    expect(await list.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(width < 1000)
  }
  expect(uploads).toHaveLength(0)
})

test('removing a ready thumbnail preserves pending files and failed items can be retried', async ({ page }) => {
  await controlledReader(page)
  const { image, uploads } = await fixture(page)
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles([
    { name: 'ready.jpg', mimeType: 'image/jpeg', buffer: image },
    { name: 'slow.jpg', mimeType: 'image/jpeg', buffer: image },
    { name: 'retry.jpg', mimeType: 'image/jpeg', buffer: image },
  ])
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await expect(page.locator('.material-status li[data-file-status="processing"]')).toHaveCount(2)
  await page.locator('.reference-list li').first().hover()
  await page.getByRole('button', { name: '移除参考图 1', exact: true }).click()
  await expect(page.locator('.material-status li[data-file-status="processing"]')).toHaveCount(2)
  await page.evaluate(() => (window as any).__releaseMaterial())
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await expect(page.locator('.material-status li[data-file-status="failed"]')).toHaveCount(1)
  await page.getByRole('button', { name: '重试失败附件', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(2)
  await expect(page.locator('.material-status')).toHaveCount(0)
  expect(uploads).toHaveLength(0)
})

test('retrying a video image preserves the identity of numbered prompt references', async ({ page }) => {
  await controlledReader(page)
  const state = await fixture(page, 'video')
  await page.locator('.studio-composer').getByLabel('添加参考素材', { exact: true }).setInputFiles(['ready.jpg', 'retry.jpg', 'last.jpg'].map((name, index) => ({
    name, mimeType: 'image/jpeg', buffer: Buffer.concat([state.image, Buffer.from(String(index))]),
  })))
  await expect(page.locator('.reference-list img')).toHaveCount(2)
  await expect(page.locator('.material-status li[data-file-status="failed"]')).toHaveCount(1)
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await prompt.fill('让 @图片2 动起来')
  await page.getByRole('button', { name: '重试失败附件', exact: true }).click()
  await expect(page.locator('.reference-list img')).toHaveCount(3)
  await expect(prompt).toHaveValue('让 @图片3 动起来')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => state.calls.length).toBe(1)
  expect(state.calls[0].prompt).toBe('让 @图片3 动起来')
  expect(state.calls[0].videoOptions.mode).toBe('reference-to-video')
})

test('touch reference previews and delete controls have separate hit areas', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    const page = await context.newPage(), state = await fixture(page)
    await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'touch.jpg', mimeType: 'image/jpeg', buffer: state.image })
    await expect(page.locator('.reference-list img')).toHaveCount(1)
    await page.getByRole('button', { name: '预览参考图 1', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: '参考图预览', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '关闭参考图预览', exact: true }).tap()
    const remove = page.getByRole('button', { name: '移除参考图 1', exact: true })
    expect((await remove.boundingBox())!.width).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: '.taste-skill/reference-upload-20261115/references-touch.png' })
    await remove.tap()
    await expect(page.locator('.reference-list img')).toHaveCount(0)
  } finally { await context.close() }
})

for (const kind of ['image', 'video', 'text']) {
  test(`${kind} waits for local image preparation after send and submits once`, async ({ page }) => {
    await controlledReader(page)
    const state = await fixture(page, kind)
    await page.locator('.studio-composer').getByLabel(kind === 'text' ? '添加附件' : kind === 'video' ? '添加参考素材' : '添加参考图', { exact: true }).setInputFiles({ name: 'slow.jpg', mimeType: 'image/jpeg', buffer: state.image })
    await expect(page.locator('.material-status li[data-file-status="processing"]')).toHaveCount(1)
    await page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true }).fill('使用这张图片')
    await page.getByRole('button', { name: kind === 'text' ? '发送' : '开始生成', exact: true }).click()
    await expect(page.getByRole('button', { name: '取消发送', exact: true })).toBeVisible()
    expect(state.calls).toHaveLength(0)
    await page.evaluate(() => (window as any).__releaseMaterial())
    await expect.poll(() => state.calls.length).toBe(1)
    if (kind === 'video') expect(state.calls[0].videoOptions.mode).toBe('image-to-video')
    if (kind === 'text') expect(state.calls[0].chatOptions.messages.at(-1).content.some((part: any) => part.type === 'image_url')).toBe(true)
    else expect(state.calls[0].referenceUrls).toHaveLength(1)
    await expect(page.locator('.reference-list img')).toHaveCount(0)
    expect(state.uploads).toHaveLength(0)
  })
}

test('cancelling material preparation keeps the draft and switching conversations never submits a late read', async ({ page }) => {
  await controlledReader(page)
  const state = await fixture(page)
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'slow.jpg', mimeType: 'image/jpeg', buffer: state.image })
  const prompt = page.getByRole('textbox', { name: '提示词', exact: true })
  await prompt.fill('保留我的草稿')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await page.getByRole('button', { name: '取消发送', exact: true }).click()
  await expect(prompt).toHaveValue('保留我的草稿')
  await expect(page.locator('.material-status li[data-file-status="failed"]')).toHaveCount(1)
  await page.locator('.studio-sidebar').getByRole('button', { name: '另一图片对话', exact: true }).click()
  await page.evaluate(() => (window as any).__releaseMaterial())
  await expect(prompt).toHaveValue('')
  await expect(page.locator('.reference-list img')).toHaveCount(0)
  expect(state.calls).toHaveLength(0)
})

test('large local images are compressed before generation without a community upload', async ({ page }) => {
  const state = await fixture(page)
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 700
    const context = canvas.getContext('2d')!, pixels = context.createImageData(canvas.width, canvas.height)
    for (let index = 0; index < pixels.data.length; index += 4) {
      pixels.data[index] = Math.random() * 256; pixels.data[index + 1] = Math.random() * 256; pixels.data[index + 2] = Math.random() * 256; pixels.data[index + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') })
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  const prepared = await page.locator('.reference-list img').getAttribute('src')
  expect(prepared!.length).toBeLessThanOrEqual(512 * 1024)
  expect(prepared!.length).toBeLessThan(encoded.length)
  await send(page, '使用压缩参考图', 1)
  expect(state.calls[0].referenceUrls[0]).toBe(prepared)
  expect(state.uploads).toHaveLength(0)
})

test('model and group changes keep displayed history without attaching old images on mobile', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', cause => errors.push(cause.message))
  const { calls, image } = await fixture(page)
  await send(page, '保留人物', 1)
  await page.getByRole('combobox', { name: '模型', exact: true }).click()
  await page.getByRole('button', { name: '选择分组', exact: true }).click()
  await page.getByRole('button', { name: '图片 · 1×', exact: true }).click()
  await page.getByRole('button', { name: 'gemini-3-pro-image-preview', exact: true }).click()
  await send(page, '让人物微笑', 2)
  expect(calls[1].model).toBe('gemini-3-pro-image-preview')
  expect(calls[1].imageContext.turns).toEqual([])
  expect(calls[1].referenceUrls).toEqual([])
  await mkdir('.taste-skill/image-conversation-20261115', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('button', { name: '开始生成', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const images = page.locator('.creation-image-preview img')
    await expect(images.last()).toBeVisible()
    const ratio = await images.last().evaluate((element: HTMLImageElement) => {
      const rect = element.getBoundingClientRect()
      return Math.abs(rect.width / rect.height - element.naturalWidth / element.naturalHeight)
    })
    expect(ratio).toBeLessThan(.02)
    await page.screenshot({ path: `.taste-skill/image-conversation-20261115/conversation-${width}.png` })
  }
  expect(errors).toEqual([])
})

test('compatible streamed responses still render previews when an async submission returns a stream', async ({ page }) => {
  const { image } = await fixture(page)
  await page.evaluate(base64 => {
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      if (String(input) !== '/api/creation/generate') return original(input, init)
      ;(window as any).__streamInput = JSON.parse(String(init?.body))
      ;(window as any).__streamPrefer = new Headers(init?.headers).get('prefer')
      const encode = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => controller.enqueue(encode({ type: 'preview', url: `data:image/jpeg;base64,${base64}` })), 100)
          setTimeout(() => {
            controller.enqueue(encode({ type: 'result', status: 'succeeded', outputs: [{ url: 'https://media.example/final.png' }] }))
            controller.close()
          }, 1500)
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream', 'X-New-Api-Token': '41' } })
    }
  }, image.toString('base64'))
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('预览画面')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByRole('img', { name: '生成中的预览', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '停止等待', exact: true })).toBeVisible()
  await expect(page.locator('.creation-image-preview img')).toBeVisible()
  await expect(page.getByRole('img', { name: '生成中的预览', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__streamPrefer)).toBe('respond-async')
  await expect(page.locator('.creation-turn')).toHaveCount(1)
})

test('a rejected generation preserves its prompt and references without automatic resubmission', async ({ page }) => {
  const { image } = await fixture(page)
  let rejected = 0
  await page.route('**/api/creation/generate', route => { rejected++; return route.fulfill({ status: 400, json: { message: '参考图超过当前模型限制，请减少图片。' } }) })
  await page.locator('.studio-composer').getByLabel('添加参考图', { exact: true }).setInputFiles({ name: 'reference.jpg', mimeType: 'image/jpeg', buffer: image })
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('保留这个提示词')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成失败')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('保留这个提示词')
  await expect(page.locator('.reference-list img')).toHaveCount(1)
  expect(rejected).toBe(1)
})
