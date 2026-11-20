import { test, expect, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'
const screenshots = '.impeccable/review/restored-studio'
async function selectSearch(page: Page, name: string) {
  await page.getByRole('button', { name: /^联网搜索：/ }).click()
  await page.getByRole('dialog', { name: '联网搜索', exact: true }).getByRole('button', { name, exact: true }).click()
}

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const photo = await readFile('public/assets/brand/octopus-community.jpg')
  const calls: { path: string; body: any }[] = []
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname, body = route.request().method() === 'POST' ? route.request().postDataJSON() : {}
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }, { id: 'sora-2', kinds: ['video'] }, { id: 'gpt-5', kinds: ['text'] }] } })
    if (path === '/api/creation/skills/catalog') return route.fulfill({ json: { items: [] } })
    if (path === '/api/creation/mcp/status') return route.fulfill({ json: { enabled: false, items: [] } })
    if (path === '/api/creation/media') return route.fulfill({ contentType: 'image/jpeg', body: photo })
    calls.push({ path, body })
    if (path === '/api/creation/search') return route.fulfill({ json: { sources: [{ title: 'Official reference', url: 'https://example.org', snippet: 'source' }] } })
    return route.fulfill({ json: body.kind === 'text' ? { status: 'succeeded', outputs: [{ text: `## 回答 ${calls.filter(call => call.body.kind === 'text').length}\n\n\`\`\`js\nconsole.log("hello")\n\`\`\`` }], tokenId: 41, protocol: 'sync' }
      : { status: 'succeeded', outputs: [{ url: 'https://media.example/result.jpg' }], tokenId: 41, protocol: 'sync' } })
  })
  return { ...account, calls, photo }
}
async function capture(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }) })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    if (name === 'chat') await expect(page.getByRole('combobox', { name: '模型', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${screenshots}/${name}-${width}.png`, fullPage: true })
  }
}
test('search menu matches shared popovers, preserves choices and fits desktop and phones', async ({ page }) => {
  await fixture(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/text')
  for (const [width, theme] of [[1440, 'dark'], [390, 'light'], [320, 'dark']] as const) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    await page.evaluate(mode => (window as any).communityAppearance.set({ mode }), theme)
    await page.getByRole('button', { name: /^创作模式：/ }).click()
    const expectedBackground = await page.getByRole('dialog', { name: '创作模式', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)
    await page.keyboard.press('Escape')
    if (width < 640) await page.getByRole('button', { name: '对话参数', exact: true }).click()
    const trigger = page.getByRole('button', { name: /^联网搜索：/ })
    const menu = page.getByRole('dialog', { name: '联网搜索', exact: true })
    await trigger.focus(); await trigger.press('Enter')
    await expect(menu).toBeVisible()
    expect(await menu.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(expectedBackground)
    await expect(menu.getByRole('group', { name: '搜索模式' }).getByRole('button')).toHaveCount(3)
    await menu.getByRole('button', { name: '快速搜索', exact: true }).click()
    await expect(menu).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await expect(trigger).toContainText('快速搜索')
    await expect(trigger).toHaveAccessibleName('联网搜索：快速搜索')
    await trigger.click()
    const selected = menu.getByRole('button', { name: '快速搜索', exact: true })
    await expect(selected).toHaveAttribute('aria-pressed', 'true')
    await menu.getByRole('button', { name: '深度搜索', exact: true }).hover()
    const selectedBackground = await selected.evaluate(element => getComputedStyle(element).backgroundColor)
    await expect.poll(() => menu.getByRole('button', { name: '深度搜索', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)).toBe(selectedBackground)
    expect(await menu.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && element.scrollWidth <= element.clientWidth
    })).toBe(true)
    await page.screenshot({ path: `.taste-skill/search-popover-20261114/${width}-${theme}.png`, fullPage: true })
    await menu.getByRole('button', { name: '深度搜索', exact: true }).click()
    if (width < 640) await expect(page.getByRole('dialog', { name: '对话参数', exact: true })).toBeVisible()
    await page.reload()
    if (width < 640) await page.getByRole('button', { name: '对话参数', exact: true }).click()
    await expect(trigger).toContainText('深度搜索')
    await trigger.click(); await page.keyboard.press('Escape')
    await expect(menu).not.toBeVisible()
    await expect(trigger).toBeFocused()
    if (width < 640) await page.keyboard.press('Escape')
  }
  expect(errors).toEqual([])
})

for (const path of ['/discover', '/create/text']) {
  test('search options show account points, auto ranges and unavailable prices on ' + path, async ({ page }) => {
    await fixture(page)
    let invalid = false, unavailable = false
    await page.route('**/api/new-api/model-groups', route => route.fulfill({ json: { success: true, data: { selectedGroup: 'auto', groups: [{ id: 'auto', name: 'Auto' }, { id: 'discount', name: '优惠分组' }] } } }))
    await page.route('**/api/new-api/model-groups/select', route => route.fulfill({ json: { success: true, data: { group: route.request().postDataJSON().group, selectedTokenId: 42 } } }))
    await page.route('**/api/new-api/model-pricing', route => route.fulfill({ json: unavailable ? { success: false, message: 'offline' } : { success: true, data: {
      userId: invalid ? 18 : 17, currency: '积分', autoGroups: ['default', 'premium'], rows: [
        { model: 'tavily-quick', group: 'default', requestPrice: 20 },
        { model: 'tavily-quick', group: 'premium', requestPrice: 30 },
        { model: 'tavily-deep', group: 'default', requestPrice: 80 },
        { model: 'tavily-deep', group: 'premium', requestPrice: 80 },
        { model: 'tavily-quick', group: 'discount', requestPrice: 0 },
        { model: 'tavily-deep', group: 'discount', requestPrice: 0.125 },
      ],
    } } }))
    await page.goto(path)
    if (path === '/discover') await page.getByRole('button', { name: '文本对话', exact: true }).click()
    for (const [width, mode] of [[1440, 'light'], [390, 'dark']] as const) {
      await page.setViewportSize({ width, height: 950 })
      await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
      if (width < 640) await page.getByRole('button', { name: '对话参数', exact: true }).click()
      await page.getByRole('button', { name: /^联网搜索：/ }).click()
      const menu = page.getByRole('dialog', { name: '联网搜索', exact: true })
      const quick = menu.getByRole('button', { name: '快速搜索', exact: true })
      const deep = menu.getByRole('button', { name: '深度搜索', exact: true })
      await expect(quick).toContainText('20–30 积分/次')
      await expect(deep).toContainText('80 积分/次')
      await expect(quick).toHaveAttribute('aria-description', '20–30 积分/次')
      await expect(menu.getByRole('button', { name: '关闭联网', exact: true })).not.toContainText('积分')
      expect(await menu.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath((path === '/discover' ? 'home' : 'studio') + '-search-price-' + width + '.png') })
      await quick.click()
      await expect(page.getByRole('button', { name: '联网搜索：快速搜索', exact: true })).toBeFocused()
      if (width < 640) await page.keyboard.press('Escape')
    }
    await page.setViewportSize({ width: 1440, height: 950 })
    await page.getByRole('combobox', { name: '模型', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择模型', exact: true })
    await picker.getByRole('button', { name: '选择分组', exact: true }).click()
    await picker.getByRole('button', { name: '优惠分组', exact: true }).click()
    await picker.getByRole('button', { name: 'gpt-5', exact: true }).click()
    await page.getByRole('button', { name: /^联网搜索：/ }).click()
    const updated = page.getByRole('dialog', { name: '联网搜索', exact: true })
    await expect(updated.getByRole('button', { name: '快速搜索', exact: true })).toContainText('0 积分/次')
    await expect(updated.getByRole('button', { name: '深度搜索', exact: true })).toContainText('0.125 积分/次')
    await page.keyboard.press('Escape')
    for (const failure of ['account', 'network']) {
      invalid = failure === 'account'; unavailable = failure === 'network'
      await page.getByRole('button', { name: /^联网搜索：/ }).click()
      const menu = page.getByRole('dialog', { name: '联网搜索', exact: true })
      await expect(menu.getByRole('button', { name: '快速搜索', exact: true })).toContainText('暂不可用')
      await expect(menu).not.toContainText('20–30')
      await page.keyboard.press('Escape')
    }
  })
}

test('clear context sits above the composer and excludes old messages without deleting them', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/text')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('旧的上下文内容')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toHaveCount(1)
  const conversationMenu = page.getByRole('dialog', { name: '创作台菜单', exact: true })
  await expect(page.locator('.studio-page-toolbar')).toBeHidden()
  await expect(page.locator('.chat-toolbar')).toBeVisible()
  await expect(page.locator('.studio-sidebar-history')).toContainText('旧的上下文内容')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    if (width < 1000) {
      await expect(page.locator('.chat-toolbar')).toBeHidden()
      await expect(page.locator('.studio-page-toolbar')).toBeVisible()
      await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
      await expect(conversationMenu).toBeVisible()
    }
    const clear = (width < 1000 ? conversationMenu : page.locator('.studio-billing')).getByRole('button', { name: '清除上下文', exact: true })
    await expect(clear).toBeVisible()
    const bounds = await clear.boundingBox()
    if (width >= 1000) {
      const composer = await page.locator('.chat-composer').boundingBox()
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(composer!.y)
    }
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.taste-skill/chat-clear-context-20261115/toolbar-${width}.png` })
    if (width < 1000) await page.keyboard.press('Escape')
  }
  await page.getByRole('button', { name: '创作台菜单', exact: true }).click()
  await conversationMenu.getByRole('button', { name: '清除上下文', exact: true }).click()
  await expect(page.locator('.chat-message')).toHaveCount(2)
  await page.reload()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('新的提问内容')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toHaveCount(2)
  const messages = state.calls.filter(call => call.body.kind === 'text').at(-1)!.body.chatOptions.messages
  expect(JSON.stringify(messages)).not.toContain('旧的上下文内容')
  expect(JSON.stringify(messages)).toContain('新的提问内容')
})

test('image advanced settings survive reload, reach the request, and streaming results enter the gallery', async ({ page }) => {
  const state = await fixture(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/image')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.getByRole('radiogroup', { name: '分辨率', exact: true }).getByRole('radio', { name: '2K', exact: true }).check()
  await page.getByRole('radiogroup', { name: '画质', exact: true }).getByRole('radio', { name: '高', exact: true }).check()
  await page.locator('.parameter-advanced > summary').click()
  await page.getByRole('combobox', { name: '输出格式', exact: true }).selectOption('webp')
  await page.getByRole('combobox', { name: '背景', exact: true }).selectOption('transparent')
  await page.getByLabel('流式预览', { exact: true }).check()
  await page.getByLabel('提示词', { exact: true }).fill('海底的章鱼书店')
  await page.reload()
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await page.locator('.parameter-advanced > summary').click()
  await expect(page.getByRole('combobox', { name: '输出格式', exact: true })).toHaveValue('webp')
  await expect(page.getByLabel('流式预览', { exact: true })).toBeChecked()
  await page.route('**/api/creation/generate', route => {
    state.calls.push({ path: '/api/creation/generate', body: route.request().postDataJSON() })
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'preview', url: 'data:image/jpeg;base64,' + state.photo.toString('base64') })}\n\ndata: ${JSON.stringify({ type: 'result', status: 'succeeded', outputs: [{ url: 'https://media.example/final.jpg' }], tokenId: 41, protocol: 'sync' })}\n\n` })
  })
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  expect(state.calls[0]?.body.imageOptions).toMatchObject({ resolution: '2k', quality: 'high', imageOutputFormat: 'webp', imageStream: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  await page.locator('.studio-sidebar').getByRole('button', { name: '作品库', exact: true }).click()
  await expect(page.locator('.gallery-item')).toHaveCount(1)
  await page.locator('.gallery-cover').click()
  await expect(page.getByRole('dialog', { name: '原始媒体预览' })).toBeVisible()
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await expect(page.locator('.media-lightbox output')).toHaveText('150%')
  await page.keyboard.press('Escape')
  await capture(page, 'image')
  expect(errors).toEqual([])
})
test('video controls follow model limits and retain first-last mode and custom parameters', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/video')
  await page.getByRole('button', { name: '高级参数', exact: true }).click()
  await expect(page.getByRole('slider', { name: '视频时长', exact: true })).toHaveAttribute('aria-valuetext', '8 秒')
  expect(await page.getByRole('radiogroup', { name: '时长档位', exact: true }).getByRole('radio').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(['4', '8', '12'])
  await page.getByRole('radiogroup', { name: '生成方式', exact: true }).getByRole('radio', { name: '首尾帧', exact: true }).check()
  await page.locator('.parameter-advanced > summary').click()
  await page.getByRole('combobox', { name: '参考图来源', exact: true }).selectOption('image_url')
  await page.getByLabel('首张图片 URL', { exact: true }).fill('https://media.example/first.png')
  await page.getByLabel('尾帧图片 URL', { exact: true }).fill('https://media.example/last.png')
  await page.getByLabel('自定义参数 JSON', { exact: true }).fill('{"metadata":{"label":"test"}}')
  await page.getByLabel('提示词', { exact: true }).fill('水母游过海底')
  await capture(page, 'video')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  expect(state.calls[0]?.body.videoOptions).toMatchObject({ mode: 'first-last-frame', openaiImageUrl: 'https://media.example/first.png' })
})
test('model-directed MCP calls require approval and their results continue the same conversation', async ({ page }) => {
  const state = await fixture(page)
  let generations = 0, toolCalls = 0
  await page.route('**/api/creation/mcp/status', route => route.fulfill({ json: { enabled: true, items: [{ id: 'test-server', status: 'active' }] } }))
  await page.route('**/api/creation/mcp/call', route => {
    toolCalls++
    expect(route.request().postDataJSON()).toMatchObject({ servers: ['test-server'], name: 'mcp_fixture', arguments: { query: '海洋' } })
    return route.fulfill({ json: { content: [{ type: 'text', text: 'tool evidence' }] } })
  })
  await page.route('**/api/creation/generate', route => {
    generations++
    const body = route.request().postDataJSON()
    if (generations === 2) expect(body.chatOptions.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool', tool_call_id: 'call-1', content: expect.stringContaining('tool evidence') })]))
    return route.fulfill({ json: generations === 1 ? { status: 'succeeded', outputs: [], toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'mcp_fixture', arguments: '{"query":"海洋"}' } }] }
      : { status: 'succeeded', outputs: [{ text: '根据工具结果生成的回答' }] } })
  })
  await page.goto('/create/text')
  await page.getByRole('button', { name: '技能与工具', exact: true }).click()
  await page.locator('.mcp-section > summary').click()
  await page.getByLabel('允许模型使用 test-server', { exact: true }).check()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('用工具查询海洋')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('根据工具结果生成的回答')
  expect(generations).toBe(2); expect(toolCalls).toBe(1)
  expect(state.calls.filter(call => call.path === '/api/creation/search')).toHaveLength(0)
})
test('stopping during persistence and switching identity during initialization prevent an unsubmitted paid request', async ({ page }) => {
  const state = await fixture(page)
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!
    const flags = window as unknown as { slowWrites: boolean; pendingWrites: number }
    flags.slowWrites = false; flags.pendingWrites = 0
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      configurable: true, get: descriptor.get,
      set(handler) {
        descriptor.set!.call(this, !handler ? handler : function (this: IDBTransaction, event: Event) {
          if (this.mode === 'readwrite' && flags.slowWrites) {
            flags.pendingWrites++
            setTimeout(() => { try { handler.call(this, event) } finally { flags.pendingWrites-- } }, 350)
          } else handler.call(this, event)
        })
      },
    })
  })
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  await selectSearch(page, '快速搜索')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('不应该发送的搜索')
  await page.evaluate(() => { (window as unknown as { slowWrites: boolean }).slowWrites = true })
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('button', { name: '停止等待', exact: true }).click()
  await page.evaluate(() => { (window as unknown as { slowWrites: boolean }).slowWrites = false })
  await expect.poll(() => page.evaluate(() => (window as unknown as { pendingWrites: number }).pendingWrites)).toBe(0)
  await page.getByRole('button', { name: /^创作模式：/ }).click()
  await page.getByRole('button', { name: '图片生成', exact: true }).click()
  await page.getByLabel('提示词', { exact: true }).fill('旧账号的任务')
  await page.evaluate(() => { (window as unknown as { slowWrites: boolean }).slowWrites = true })
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  state.state.user.id = '18'; state.state.user.accountId = '18'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.studio-sidebar .studio-record[data-kind="image"]')).toHaveCount(0)
  await page.evaluate(() => { (window as unknown as { slowWrites: boolean }).slowWrites = false })
  await expect.poll(() => page.evaluate(() => (window as unknown as { pendingWrites: number }).pendingWrites)).toBe(0)
  expect(state.calls.filter(call => ['/api/creation/search', '/api/creation/generate'].includes(call.path))).toHaveLength(0)
})
test('chat retains multi-turn context, branches, reasoning and search reuse without another search charge', async ({ page }) => {
  const state = await fixture(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/text')
  await selectSearch(page, '快速搜索')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('查询海洋信息')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('回答 1')
  await page.getByRole('button', { name: '重新生成回答', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('回答 2')
  expect(state.calls.filter(call => call.path === '/api/creation/search')).toHaveLength(1)
  await page.getByRole('button', { name: '上一个分支', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('回答 1')
  await selectSearch(page, '关闭联网')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('继续说明')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toHaveCount(2)
  await expect(page.locator('.chat-message.assistant .message-content').last()).toContainText('回答 3')
  const generated = state.calls.filter(call => call.path === '/api/creation/generate')
  expect(generated.at(-1)?.body.chatOptions.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: expect.stringContaining('回答 1') }), expect.objectContaining({ role: 'user', content: '继续说明' })]))
  await page.reload()
  await expect(page.locator('.chat-message.assistant')).toHaveCount(2)
  expect(state.calls.filter(call => call.path === '/api/creation/generate')).toHaveLength(3)
  await page.getByRole('button', { name: '对话参数', exact: true }).click()
  await page.keyboard.press('Escape')
  await capture(page, 'chat')
  expect(errors).toEqual([])
})
test('chat attachments keep the original PDF bytes and active skills are scoped to the conversation', async ({ page }) => {
  const state = await fixture(page)
  const body = '---\nname: Editor\n---\nUse short sentences.'
  const { createHash } = await import('node:crypto')
  await page.route('**/api/creation/skills/catalog', route => route.fulfill({ json: { items: [{ id: 'editor', name: '编辑技能', description: '简洁表达', body, sha256: createHash('sha256').update(body).digest('hex') }] } }))
  await page.goto('/create/text')
  await page.getByRole('button', { name: '技能与工具', exact: true }).click()
  await page.getByLabel('编辑技能').check()
  await page.locator('.attachment-button input').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-test-bytes') })
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('理解附件')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  const sent = state.calls.find(call => call.path === '/api/creation/generate')!.body.chatOptions.messages
  expect(sent.some((message: any) => message.role === 'system' && message.content.includes('Use short sentences.'))).toBe(true)
  expect(JSON.stringify(sent)).toContain(Buffer.from('%PDF-test-bytes').toString('base64'))
  await page.reload()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('继续按技能写作')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content').last()).toContainText('回答 2')
  const restored = state.calls.filter(call => call.path === '/api/creation/generate').at(-1)!.body.chatOptions.messages
  expect(restored.some((message: any) => message.role === 'system' && message.content.includes('Use short sentences.'))).toBe(true)
  await page.locator('.studio-sidebar').getByRole('button', { name: '新对话', exact: true }).click()
  await page.getByRole('button', { name: '技能与工具', exact: true }).click()
  await expect(page.getByLabel('编辑技能')).not.toBeChecked()
  await page.locator('.mcp-section > summary').click()
  await expect(page.getByText('当前账号未启用 MCP 工具。', { exact: true })).toBeVisible()
})
test('legacy split chat attachments are hydrated into native conversation without rewriting the old snapshot', async ({ page }) => {
  const state = await fixture(page)
  // Seed legacy data before Studio creates its first native conversation.
  await page.goto('/community')
  const original = await page.evaluate(async () => {
    const key = 'octopus:user-17:chat-next-web-store'
    const value = JSON.stringify({ version: 3.5, __octopusChatAssets: { format: 'octopus-chat-assets-v1', ids: ['old-pdf'] }, state: {
      _hasHydrated: true, sessions: [{ id: 'legacy-chat', topic: '历史附件会话', messages: [{ id: 'old-message', role: 'user', content: [{ type: 'file', file: { filename: 'old-report.pdf', file_data: { __octopusChatAsset: 'old-pdf' } } }] }] }],
    } })
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('community-studio', 1); request.onupgradeneeded = () => { request.result.createObjectStore('keyval') }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('keyval', 'readwrite'), store = transaction.objectStore('keyval')
      store.put(value, key); store.put('data:application/pdf;base64,' + btoa('%PDF-original-bytes'), `${key}:asset:old-pdf`)
      transaction.oncomplete = () => { db.close(); resolve() }; transaction.onerror = () => reject(transaction.error)
    })
    return value
  })
  await page.goto('/create/text')
  await expect(page.getByRole('button', { name: '重命名会话：历史附件会话', exact: true })).toBeVisible()
  await expect(page.getByText('old-report.pdf', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '重命名会话：历史附件会话', exact: true })).toBeVisible()
  await expect(page.getByText('old-report.pdf', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('继续阅读原附件')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  expect(JSON.stringify(state.calls.find(call => call.path === '/api/creation/generate')?.body)).toContain(Buffer.from('%PDF-original-bytes').toString('base64'))
  expect(await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('community-studio', 1); request.onsuccess = () => resolve(request.result) })
    return new Promise(resolve => { const transaction = db.transaction('keyval', 'readonly'), request = transaction.objectStore('keyval').get('octopus:user-17:chat-next-web-store'); request.onsuccess = () => resolve(request.result); transaction.oncomplete = () => db.close() })
  })).toBe(original)
})
for (const display of [
  { name: 'legacy currency', symbol: '¥', scale: 250000, log: '¥ 0.25', budget: '1.25', rawQuota: 312500, price: '¥2 / 百万输入' },
  { name: 'community points', symbol: '积分', scale: 100, log: '积分 625', budget: '1250', rawQuota: 125000, price: '积分 100 / 百万输入' },
]) test(`account tools use the configured quota ratio for logs and key budgets in ${display.name}`, async ({ page }) => {
  const state = await fixture(page)
  await page.route('**/api/new-api/**', route => {
    const url = new URL(route.request().url()), key = url.pathname.split('/api/new-api/')[1]!
    const data: Record<string, unknown> = { status: { quotaPerUnit: display.scale, currencySymbol: display.symbol }, session: { selectedTokenId: 41 },
      groups: [{ id: 'auto', name: 'Auto' }], 'auto-groups': { supported: false, defaultGroups: [], maxCount: 0 },
      logs: { items: [{ id: 1, created_at: 1700000000, model_name: 'gpt-5', token_name: '系统创建', prompt_tokens: 12, completion_tokens: 24, quota: 62500 }], total: 1 },
      tokens: { items: [{ id: 41, name: '系统创建', group: 'auto', status: 1, expired_time: -1, unlimited_quota: true, used_quota: 250000, remain_quota: 500000 }], total: 1 },
      'model-groups': { selectedGroup: 'auto', groups: [{ id: 'auto', name: 'Auto', ratio: 1 }] },
      'model-pricing': { userId: 17, account: 'root', currency: display.symbol, fetchedAt: new Date().toISOString(), rows: [{ model: 'gpt-5', group: 'auto', billing: 'Tokens', price: display.price }] } }
    if (route.request().method() !== 'GET') state.calls.push({ path: url.pathname, body: route.request().postDataJSON() })
    return route.fulfill({ json: { success: true, data: data[key] || {} } })
  })
  await page.goto('/create/image')
  await page.getByRole('button', { name: /^创作台菜单/ }).click()
  await page.getByRole('button', { name: '消费记录', exact: true }).click()
  await expect(page.getByRole('cell', { name: display.log, exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^创作台菜单/ }).click()
  await page.getByRole('button', { name: '密钥', exact: true }).click()
  await page.getByRole('button', { name: '创建密钥', exact: true }).click()
  await page.getByLabel('名称', { exact: true }).fill('测试额度')
  await page.getByLabel('不限额', { exact: true }).uncheck()
  await page.getByLabel(`额度（${display.symbol}）`, { exact: true }).fill(display.budget)
  await page.getByRole('button', { name: '保存密钥', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(state.calls.find(call => call.path === '/api/new-api/tokens')?.body.remain_quota).toBe(display.rawQuota)
  await page.getByRole('button', { name: /^创作台菜单/ }).click()
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(page.getByRole('article', { name: 'gpt-5 模型价格', exact: true })).toContainText(display.price)
  await capture(page, 'prices')
})

test('composer remains visible across viewports and tool popovers preserve drafts without paid submissions', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/text')
  const message = page.getByRole('textbox', { name: '消息', exact: true })
  await message.fill('保留正在输入的内容')
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height })
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
    const bounds = await page.locator('.studio-composer').boundingBox()
    await expect(page.locator('.mobile-nav')).toBeHidden()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1)
    await expect(page.locator('.studio-page-toolbar h1')).toHaveCount(0)
    if (width < 640) {
      const tools = await page.locator('.studio-composer-actions').boundingBox()
      const send = await page.getByRole('button', { name: '发送', exact: true }).boundingBox()
      const models = await page.locator('.studio-composer-models').boundingBox()
      for (const box of [tools!, send!, models!]) {
        expect(box.x).toBeGreaterThanOrEqual(bounds!.x)
        expect(box.x + box.width).toBeLessThanOrEqual(bounds!.x + bounds!.width)
        expect(box.y + box.height).toBeLessThanOrEqual(bounds!.y + bounds!.height)
      }
      expect(send!.x).toBeGreaterThanOrEqual(tools!.x + tools!.width - 1)
      expect(bounds!.height).toBeLessThanOrEqual(155)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
    await page.getByRole('button', { name: '对话参数', exact: true }).click()
    const panel = page.getByRole('dialog', { name: '对话参数', exact: true })
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(height)
    const advanced = panel.locator('.chat-advanced-settings')
    if (await advanced.getAttribute('open') === null) await advanced.locator('summary').click()
    await panel.getByLabel('Top P', { exact: true }).fill('0.8')
    await page.keyboard.press('Escape')
    await expect(panel).not.toBeVisible()
    await expect(page.getByRole('button', { name: '对话参数', exact: true })).toBeFocused()
    await expect(message).toHaveValue('保留正在输入的内容')
  }
  await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  const sidebar = page.getByRole('dialog', { name: '工作台侧边栏', exact: true })
  await expect(sidebar.getByRole('searchbox', { name: '搜索对话', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sidebar).not.toBeVisible()
  await expect(message).toHaveValue('保留正在输入的内容')
  expect(state.calls.filter(call => ['/api/creation/generate', '/api/creation/search'].includes(call.path))).toHaveLength(0)
})

test('IME confirmation does not send a message and a plain Enter submits once', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/text')
  const message = page.getByRole('textbox', { name: '消息', exact: true })
  await message.fill('中文输入确认')
  await message.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  await expect(message).toHaveValue('中文输入确认')
  expect(state.calls.filter(call => call.path === '/api/creation/generate')).toHaveLength(0)
  await message.press('Enter')
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('回答 1')
  expect(state.calls.filter(call => call.path === '/api/creation/generate')).toHaveLength(1)
})
