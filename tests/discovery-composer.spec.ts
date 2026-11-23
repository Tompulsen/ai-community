import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createHash } from 'node:crypto'
import { mockUnifiedAccount, fillAccountLogin } from './helpers/account-fixture'

async function fixture(page: Page, authenticated = true, delayed = false) {
  const account = await mockUnifiedAccount(page, authenticated)
  account.state.user.id = '17'
  const calls: any[] = []
  await page.route('**/api/creation/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') {
      if (delayed) await new Promise(resolve => setTimeout(resolve, 900))
      return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }, { id: 'gpt-image-1', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }, { id: 'gpt-5', kinds: ['text'] }, { id: 'claude-opus', kinds: ['text'] }] } })
    }
    if (path === '/api/creation/generate') {
      calls.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'succeeded', outputs: calls.at(-1).kind === 'text' ? [{ text: '文本生成完成' }] : [{ url: 'https://media.example/entry.png' }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  return { ...account, calls }
}

test('homepage loads text controls on first use, keeps the chosen model and retains each draft', async ({ page }) => {
  const { calls } = await fixture(page)
  const modules: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.searchParams.get('type') !== 'style') modules.push(url.pathname)
  })
  let release!: () => void
  const loading = new Promise<void>(resolve => { release = resolve })
  await page.route(/\/(?:src\/components\/StudioChat\.vue|assets\/StudioChat-[^/]+\.js)(?:\?.*)?$/, async route => {
    await loading
    await route.continue().catch(() => {})
  })
  try {
    await page.goto('/discover')
    const composer = page.getByRole('form', { name: '快捷创作', exact: true })
    await expect(composer.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
    expect(modules.some(path => /\/StudioChat(?:\.vue|-[^/]+\.js)$/.test(path))).toBe(false)
    await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('保留图片草稿')
    await composer.getByRole('combobox', { name: '模型', exact: true }).click()
    await page.getByRole('dialog', { name: '选择模型', exact: true }).getByRole('button', { name: 'claude-opus', exact: true }).click()
    await expect(page.getByText('正在加载文本创作…', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '图片生成', exact: true }).click()
    await expect(composer.getByRole('textbox', { name: '创作描述', exact: true })).toHaveValue('保留图片草稿')
    await page.getByRole('button', { name: '文本对话', exact: true }).click()
    await expect(page.getByText('正在加载文本创作…', { exact: true })).toBeVisible()
    release()
    await expect(composer.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('claude-opus')
    await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('保留文本草稿')
    await page.getByRole('button', { name: '图片生成', exact: true }).click()
    await expect(composer.getByRole('textbox', { name: '创作描述', exact: true })).toHaveValue('保留图片草稿')
    await page.getByRole('button', { name: '文本对话', exact: true }).click()
    await expect(composer.getByRole('textbox', { name: '创作描述', exact: true })).toHaveValue('保留文本草稿')
    await expect(composer.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('claude-opus')
    expect(modules.filter(path => /\/StudioChat(?:\.vue|-[^/]+\.js)$/.test(path))).toHaveLength(1)
    expect(modules.some(path => /\/(?:math|syntax)[-~]|\/(?:katex|highlight)[^/]*\.js/.test(path))).toBe(false)
    expect(calls).toHaveLength(0)
  } finally { release() }
})

test('homepage reuses text controls and carries configuration and files into Studio once', async ({ page }) => {
  const { calls } = await fixture(page)
  const body = '使用简短中文回答。'
  await page.route('**/api/creation/skills/catalog', route => route.fulfill({ json: { items: [{ id: 'short', name: '简短回答', description: '简洁表达', body, sha256: createHash('sha256').update(body).digest('hex') }] } }))
  const searches: unknown[] = []
  await page.route('**/api/creation/search', route => { searches.push(route.request().postDataJSON()); return route.fulfill({ json: { sources: [] } }) })
  await page.goto('/create/text')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('原有文本草稿保持完整')
  await page.locator('.studio-sidebar').getByRole('link', { name: '探索社区', exact: true }).click()
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  await composer.getByRole('combobox', { name: '模型', exact: true }).click()
  await page.getByRole('dialog', { name: '选择模型', exact: true }).getByRole('button', { name: 'claude-opus', exact: true }).click()
  await expect(page).toHaveURL('/discover')
  await expect(composer.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('claude-opus')
  await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('请整理这份材料')
  await composer.getByLabel('添加附件', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('首页附件内容') })
  await composer.getByRole('button', { name: '联网搜索：联网', exact: true }).click()
  await page.getByRole('button', { name: '快速搜索', exact: true }).click()
  await page.getByRole('button', { name: '技能与工具', exact: true }).click()
  await page.getByRole('checkbox', { name: /简短回答/ }).check()
  await page.keyboard.press('Escape')
  await composer.getByRole('button', { name: '对话参数', exact: true }).click()
  const parameters = page.getByRole('dialog', { name: '对话参数', exact: true })
  await parameters.getByRole('spinbutton', { name: '最大输出 Tokens', exact: true }).fill('2048')
  await parameters.getByRole('combobox', { name: '推理强度', exact: true }).selectOption('high')
  await parameters.getByRole('switch', { name: '流式输出', exact: true }).uncheck()
  await parameters.getByRole('textbox', { name: '系统提示词', exact: true }).fill('你是材料整理助手')
  await parameters.getByText('高级参数', { exact: true }).click()
  await parameters.getByRole('combobox', { name: '接口格式', exact: true }).selectOption('responses')
  await parameters.getByRole('spinbutton', { name: 'Top P', exact: true }).fill('0.85')
  await parameters.getByRole('spinbutton', { name: '历史压缩阈值', exact: true }).fill('12000')
  await parameters.getByRole('switch', { name: '保留历史摘要', exact: true }).uncheck()
  await page.keyboard.press('Escape')
  expect(calls).toHaveLength(0)
  await composer.getByRole('button', { name: '发送到创作台', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ kind: 'text', model: 'claude-opus', chatOptions: { format: 'responses', max_tokens: 2048, reasoningEffort: 'high', stream: false, top_p: 0.85 } })
  expect(JSON.stringify(calls[0].chatOptions.messages)).toContain('你是材料整理助手')
  const file = calls[0].chatOptions.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []).find((part: any) => part.type === 'file').file
  expect(file.filename).toBe('notes.txt')
  expect(Buffer.from(file.file_data.split(',')[1], 'base64').toString()).toBe('首页附件内容')
  expect(JSON.stringify(calls[0].chatOptions.messages)).toContain(body)
  expect(searches).toEqual([expect.objectContaining({ mode: 'quick', query: '请整理这份材料' })])
  await expect(page).toHaveURL(new RegExp('/create/text'))
  await expect.poll(() => new URL(page.url()).searchParams.has('start')).toBe(false)
  await page.reload()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  expect(calls).toHaveLength(1)
  const drafts = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/native-chat.ts')?.name
    if (!path) throw new Error('Active chat module was not loaded')
    const { chats } = await import(path)
    return chats.sessions.map((chat: any) => ({ draft: chat.draft, compressionThreshold: chat.compressionThreshold, sendMemory: chat.sendMemory, skillIds: chat.skillIds, textModel: chat.textModel }))
  })
  expect(drafts).toContainEqual(expect.objectContaining({ draft: '原有文本草稿保持完整' }))
  expect(drafts).toContainEqual(expect.objectContaining({ textModel: 'claude-opus', compressionThreshold: 12000, sendMemory: false, skillIds: ['short'] }))
})

test('homepage switches between text and media models without leaving the page or changing existing text drafts', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/discover')
  await page.getByRole('button', { name: '文本对话', exact: true }).click()
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('保留首页文本草稿')
  await composer.getByRole('button', { name: '对话参数', exact: true }).click()
  await page.getByRole('dialog', { name: '对话参数', exact: true }).getByRole('spinbutton', { name: '最大输出 Tokens', exact: true }).fill('1234')
  await page.keyboard.press('Escape')
  for (const model of ['gpt-image-1', 'sora-2', 'claude-opus']) {
    await composer.getByRole('combobox', { name: '模型', exact: true }).click()
    await page.getByRole('dialog', { name: '选择模型', exact: true }).getByRole('button', { name: model, exact: true }).click()
    await expect(composer.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(model)
    await expect(page).toHaveURL('/discover')
  }
  await expect(composer.getByRole('textbox', { name: '创作描述', exact: true })).toHaveValue('保留首页文本草稿')
  await composer.getByRole('button', { name: '对话参数', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '对话参数', exact: true }).getByRole('spinbutton', { name: '最大输出 Tokens', exact: true })).toHaveValue('1234')
  expect(calls).toHaveLength(0)
})

test('guest text input and configuration survive login before the single Studio send', async ({ page }) => {
  const { calls } = await fixture(page, false)
  await page.goto('/discover')
  await page.getByRole('button', { name: '文本对话', exact: true }).click()
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('登录后继续文本创作')
  await composer.getByRole('button', { name: '对话参数', exact: true }).click()
  await page.getByRole('dialog', { name: '对话参数', exact: true }).getByRole('spinbutton', { name: '最大输出 Tokens', exact: true }).fill('3072')
  await page.keyboard.press('Escape')
  await composer.getByRole('button', { name: '发送到创作台', exact: true }).click()
  await page.getByRole('main').getByRole('link', { name: '登录', exact: true }).click()
  await fillAccountLogin(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ kind: 'text', model: 'gpt-5', chatOptions: { max_tokens: 3072 } })
})

test('homepage keeps the latest text while attachment preparation finishes', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/discover')
  await page.getByRole('button', { name: '文本对话', exact: true }).click()
  await page.evaluate(() => {
    const read = FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL = function(file: Blob) {
      FileReader.prototype.readAsDataURL = read
      ;(window as any).releaseHomepageFile = () => read.call(this, file)
    }
  })
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  const input = composer.getByRole('textbox', { name: '创作描述', exact: true })
  await input.fill('等待附件时的初始文字')
  await composer.getByLabel('添加附件', { exact: true }).setInputFiles({ name: 'pending.txt', mimeType: 'text/plain', buffer: Buffer.from('附件') })
  await composer.getByRole('button', { name: '发送到创作台', exact: true }).click()
  await expect(composer.getByRole('button', { name: '取消发送', exact: true })).toBeVisible()
  await input.fill('等待期间补全的最新文字')
  await page.evaluate(() => (window as any).releaseHomepageFile())
  await expect.poll(() => calls.length).toBe(1)
  expect(JSON.stringify(calls[0].chatOptions.messages)).toContain('等待期间补全的最新文字')
  expect(JSON.stringify(calls[0].chatOptions.messages)).not.toContain('等待附件时的初始文字')
})

test('homepage text configuration fits both themes on desktop and phones and resets for a different account', async ({ page }, testInfo) => {
  const { calls } = await fixture(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/discover')
  await page.getByRole('button', { name: '文本对话', exact: true }).click()
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('跨屏幕排版检查')
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(mode => window.communityAppearance.set({ mode }), theme)
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 })
      await expect(composer.getByRole('button', { name: '发送到创作台', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const controls = await composer.locator('.studio-composer-models, .billing-compact, .composer-submit').evaluateAll(elements => elements.map(element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height } }))
      expect(controls.every(box => box.x >= 0 && box.x + box.width <= width)).toBe(true)
      for (let index = 1; index < controls.length; index++) expect(controls[index].x).toBeGreaterThanOrEqual(controls[index - 1].x + controls[index - 1].width - 1)
      await page.screenshot({ path: testInfo.outputPath('text-composer-' + width + '-' + theme + '.png'), fullPage: true })
      await composer.getByRole('button', { name: '对话参数', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '对话参数', exact: true })
      const box = await dialog.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath('text-' + width + '-' + theme + '.png'), fullPage: true })
      await page.keyboard.press('Escape')
    }
    expect((await new AxeBuilder({ page }).include('.discovery-creation').analyze()).violations).toEqual([])
  }
  await page.setViewportSize({ width: 1440, height: 950 })
  await composer.getByRole('button', { name: '对话参数', exact: true }).click()
  await page.getByRole('dialog', { name: '对话参数', exact: true }).getByRole('spinbutton', { name: '最大输出 Tokens', exact: true }).fill('9999')
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/state.ts')?.name
    if (!path) throw new Error('Active session module was not loaded')
    const { session } = await import(path)
    session.user = { ...session.user, id: '18', accountId: 18 }
  })
  await page.getByRole('button', { name: '文本对话', exact: true }).click()
  await expect(composer.getByRole('textbox', { name: '创作描述', exact: true })).toHaveValue('')
  await composer.getByRole('button', { name: '对话参数', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '对话参数', exact: true }).getByRole('spinbutton', { name: '最大输出 Tokens', exact: true })).toHaveValue('4096')
  expect(calls).toHaveLength(0)
  expect(errors).toEqual([])
})

for (const kind of ['image', 'video'] as const) {
  test('homepage hands ' + kind + ' prompt and reference to Studio once', async ({ page }) => {
    const { calls } = await fixture(page, true, true)
    await page.goto('/create/image')
    const oldPrompt = page.getByRole('textbox', { name: '提示词', exact: true })
    await expect(oldPrompt).toBeEnabled()
    await oldPrompt.fill('保留原会话的草稿')
    await page.locator('.studio-sidebar').getByRole('link', { name: '探索社区', exact: true }).click()
    const composer = page.getByRole('form', { name: '快捷创作', exact: true })
    if (kind === 'video') await page.getByRole('button', { name: '视频生成', exact: true }).click()
    await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('海边日落下的一座灯塔')
    await composer.getByLabel('添加参考图', { exact: true }).setInputFiles('public/assets/brand/octopus-community.jpg')
    await expect(composer.getByRole('button', { name: '预览参考图 1', exact: true })).toBeVisible()
    await composer.getByRole('button', { name: '发送到创作台', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/create/' + kind))
    await expect.poll(() => calls.length).toBe(1)
    expect(calls[0]).toMatchObject({ kind, prompt: '海边日落下的一座灯塔' })
    expect(calls[0].referenceUrls).toHaveLength(1)
    expect(new URL(page.url()).searchParams.has('start')).toBe(false)
    await page.reload()
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toBeVisible()
    expect(calls).toHaveLength(1)
    const drafts = await page.evaluate(async () => {
      const modulePath = '/src/native-chat.ts'
      const { chats, loadChats } = await import(modulePath)
      await loadChats()
      return chats.sessions.map((chat: any) => chat.mediaDrafts?.image?.prompt)
    })
    expect(drafts).toContain('保留原会话的草稿')
  })
}

test('homepage exposes Studio controls and carries image settings into generation', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/discover')
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  await expect(composer.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
  await composer.getByRole('combobox', { name: '模型', exact: true }).click()
  const models = page.getByRole('dialog', { name: '选择模型', exact: true })
  await expect(models.getByRole('button', { name: 'gpt-5', exact: true })).toBeVisible()
  await models.getByRole('button', { name: 'gpt-image-1', exact: true }).click()
  await expect(composer.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-1')
  await composer.getByRole('button', { name: '高级参数', exact: true }).click()
  const parameters = page.getByRole('dialog', { name: '高级参数', exact: true })
  await parameters.getByRole('radio', { name: '16:9', exact: true }).check()
  await parameters.getByRole('radio', { name: '2K', exact: true }).check()
  await parameters.getByRole('radio', { name: '高', exact: true }).check()
  await parameters.getByRole('spinbutton', { name: '图片数量', exact: true }).fill('2')
  await page.keyboard.press('Escape')
  await composer.getByRole('button', { name: /^预计积分消耗/ }).click()
  await expect(page.getByRole('dialog', { name: '模型价格', exact: true })).toContainText('gpt-image-1')
  await page.getByRole('button', { name: '查看全部定价', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '模型广场', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await composer.getByRole('combobox', { name: '模型', exact: true }).click()
  await models.getByRole('button', { name: '管理密钥', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '密钥', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('使用首页选定的全部生成参数')
  await composer.getByRole('button', { name: '发送到创作台', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ model: 'gpt-image-1', aspect_ratio: '16:9', n: 2, imageOptions: { resolution: '2k', quality: 'high' } })
})

test('inline video model preserves input and references and carries video parameters', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/discover')
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('保持同一份描述和参考图')
  await composer.getByLabel('添加参考图', { exact: true }).setInputFiles('public/assets/brand/octopus-community.jpg')
  await expect(composer.getByRole('button', { name: '预览参考图 1', exact: true })).toBeVisible()
  await composer.getByRole('combobox', { name: '模型', exact: true }).click()
  await page.getByRole('dialog', { name: '选择模型', exact: true }).getByRole('button', { name: 'sora-2', exact: true }).click()
  await expect(page).toHaveURL('/discover')
  await expect(composer.getByRole('textbox', { name: '创作描述', exact: true })).toHaveValue('保持同一份描述和参考图')
  await expect(composer.getByRole('button', { name: '预览参考图 1', exact: true })).toBeVisible()
  await composer.getByRole('button', { name: '高级参数', exact: true }).click()
  const parameters = page.getByRole('dialog', { name: '高级参数', exact: true })
  await parameters.getByRole('radio', { name: '9:16', exact: true }).check()
  await parameters.getByRole('radio', { name: '720P', exact: true }).check()
  await parameters.getByRole('radio', { name: '12 秒', exact: true }).check()
  await parameters.getByText('自定义参数', { exact: true }).click()
  await parameters.getByRole('textbox', { name: '尺寸', exact: true }).fill('720x1280')
  await page.keyboard.press('Escape')
  await composer.getByRole('button', { name: '发送到创作台', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0]).toMatchObject({ kind: 'video', model: 'sora-2', prompt: '保持同一份描述和参考图', aspect_ratio: '9:16', duration: 12, size: '720x1280', videoOptions: { mode: 'image-to-video', resolution: '720p' } })
  expect(calls[0].referenceUrls).toHaveLength(1)
})

test('switching to video retains image references above its lower limit', async ({ page }) => {
  await fixture(page)
  await page.goto('/discover')
  const composer = page.getByRole('form', { name: '快捷创作', exact: true })
  await composer.getByRole('textbox', { name: '创作描述', exact: true }).fill('参考图不会因切换模式丢失')
  await composer.getByLabel('添加参考图', { exact: true }).setInputFiles(Array(11).fill('public/assets/brand/octopus-community.jpg'))
  await expect(composer.getByRole('button', { name: /^预览参考图 / })).toHaveCount(11)
  await page.getByRole('button', { name: '视频生成', exact: true }).click()
  await expect(composer.getByRole('button', { name: /^预览参考图 / })).toHaveCount(11)
  await expect(composer.getByRole('alert')).toContainText('参考图数量超过当前创作类型上限')
  await expect(composer.getByRole('button', { name: '发送到创作台', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '图片生成', exact: true }).click()
  await expect(composer.getByRole('button', { name: /^预览参考图 / })).toHaveCount(11)
  await expect(composer.getByRole('button', { name: '发送到创作台', exact: true })).toBeEnabled()
})

for (const succeeds of [true, false]) {
  test('entry group restoration ' + (succeeds ? 'preserves selection' : 'fails once and retains input'), async ({ page }) => {
    const { calls } = await fixture(page)
    let selectedGroup = 'auto', attempts = 0
    await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: {
      selectedGroup, selectedTokenId: 41, groups: [{ id: 'auto', name: 'Auto', ratio: 1 }, { id: 'premium', name: 'Premium', ratio: 1 }],
    } } }))
    await page.route('**/api/creation/models', async route => {
      if (route.request().postDataJSON()?.group !== 'premium' || attempts > 0) return route.fallback()
      attempts++
      if (!succeeds) return route.fulfill({ status: 403, json: { success: false, message: '测试分组无权访问' } })
      selectedGroup = 'premium'
      return route.fulfill({ json: { tokenId: 41, items: ['gpt-image-1', 'gpt-image-2'].map(id => ({ id, kinds: ['image'] })) } })
    })
    await page.goto('/discover')
    await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gpt-image-2')
    const id = await page.evaluate(async () => {
      const entryPath = '/src/studio-entry.ts', optionsPath = '/shared/studio/options.ts'
      const { saveStudioEntry } = await import(entryPath)
      const { imageOptionsSchema, videoOptionsSchema } = await import(optionsPath)
      return saveStudioEntry({ owner: '17', kind: 'image', prompt: '分组恢复验证', references: [], parameters: {
        model: 'gpt-image-1', group: 'premium', tokenId: 41, ratio: '1:1', manualSize: '', count: 1, duration: 8, protocol: 'openai',
        imageOptions: imageOptionsSchema.parse({}), videoOptions: videoOptionsSchema.parse({ mode: 'text-to-video' }),
      } })
    })
    await page.goto('/create/image?entry=' + id)
    if (succeeds) {
      await expect.poll(() => calls.length).toBe(1)
      expect(calls[0]).toMatchObject({ model: 'gpt-image-1' })
      await page.getByRole('combobox', { name: '模型', exact: true }).click()
      await expect(page.getByRole('button', { name: '选择分组', exact: true })).toContainText('Premium')
    } else {
      await expect(page.getByText('测试分组无权访问', { exact: true }).first()).toBeVisible()
      await page.getByRole('combobox', { name: '模型', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '选择模型', exact: true }).getByRole('button', { name: 'gpt-image-1', exact: true })).toBeEnabled()
      await page.keyboard.press('Escape')
      await expect(page.getByText('无法恢复首页所选模型分组，请返回首页重试。', { exact: true })).toBeVisible()
      expect(calls).toHaveLength(0)
      expect(await page.evaluate(id => sessionStorage.getItem('ai-community-next:studio-entry:' + id), id)).toContain('分组恢复验证')
    }
    expect(attempts).toBe(1)
  })
}

test('guest input survives login and starts in Studio', async ({ page }) => {
  const { calls } = await fixture(page, false)
  await page.goto('/discover')
  await page.getByRole('textbox', { name: '创作描述', exact: true }).fill('访客输入的完整描述')
  await page.getByRole('button', { name: '发送到创作台', exact: true }).click()
  await page.getByRole('main').getByRole('link', { name: '登录', exact: true }).click()
  await expect(page.getByRole('form', { name: '登录章鱼账号', exact: true })).toBeVisible()
  await fillAccountLogin(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].prompt).toBe('访客输入的完整描述')
})

test('composition does not send, and lower search remains independent', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/discover')
  const prompt = page.getByRole('textbox', { name: '创作描述', exact: true })
  await prompt.fill('尚未发送的创作')
  await prompt.dispatchEvent('compositionstart')
  await prompt.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 })
  await prompt.dispatchEvent('compositionend')
  await expect(page).toHaveURL('/discover')
  expect(calls).toHaveLength(0)
  await page.getByRole('searchbox', { name: '搜索作品', exact: true }).fill('灯塔')
  await expect(page).toHaveURL(/q=/)
  await expect(prompt).toHaveValue('尚未发送的创作')
})

test('composer and lower filters fit desktop and phones in both themes', async ({ page }) => {
  await fixture(page)
  await page.goto('/discover')
  for (const mode of ['light', 'dark'] as const) {
    await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
    for (const width of [1440, 1000, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByRole('form', { name: '快捷创作', exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const actions = (await page.locator('.discovery-workspace .studio-composer-actions').boundingBox())!
      const send = (await page.getByRole('button', { name: '发送到创作台', exact: true }).boundingBox())!
      expect(actions.x + actions.width <= send.x || actions.y + actions.height <= send.y).toBe(true)
      if (width >= 1000) {
        const creation = (await page.locator('.discovery-creation').boundingBox())!
        const search = (await page.locator('.discovery-search').boundingBox())!
        expect(search.y).toBeGreaterThanOrEqual(creation.y + creation.height)
        await expect(page.locator('.app-header [role="search"]')).toHaveCount(0)
      }
      await page.screenshot({ path: test.info().outputPath('composer-' + mode + '-' + width + '.png'), animations: 'disabled' })
    }
    expect((await new AxeBuilder({ page }).include('.discovery-creation').analyze()).violations).toEqual([])
  }
})
