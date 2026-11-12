import { test, expect, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'
const screenshots = '.impeccable/review/restored-studio'
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
    if (name === 'chat') await expect(page.getByRole('combobox', { name: '联网搜索', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${screenshots}/${name}-${width}.png`, fullPage: true })
  }
}
test('image advanced settings survive reload, reach the request, and streaming results enter the gallery', async ({ page }) => {
  const state = await fixture(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/image')
  await page.getByText('高级参数', { exact: true }).click()
  await page.getByRole('combobox', { name: '分辨率', exact: true }).selectOption('2k')
  await page.getByRole('combobox', { name: '画质', exact: true }).selectOption('high')
  await page.getByRole('combobox', { name: '输出格式', exact: true }).selectOption('webp')
  await page.getByRole('combobox', { name: '背景', exact: true }).selectOption('transparent')
  await page.getByLabel('流式预览', { exact: true }).check()
  await page.getByLabel('提示词', { exact: true }).fill('海底的章鱼书店')
  await page.reload()
  await page.getByText('高级参数', { exact: true }).click()
  await expect(page.getByRole('combobox', { name: '输出格式', exact: true })).toHaveValue('webp')
  await expect(page.getByLabel('流式预览', { exact: true })).toBeChecked()
  await page.route('**/api/creation/generate', route => {
    state.calls.push({ path: '/api/creation/generate', body: route.request().postDataJSON() })
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'preview', url: 'data:image/jpeg;base64,' + state.photo.toString('base64') })}\n\ndata: ${JSON.stringify({ type: 'result', status: 'succeeded', outputs: [{ url: 'https://media.example/final.jpg' }], tokenId: 41, protocol: 'sync' })}\n\n` })
  })
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.locator('.task-status')).toContainText('生成完成')
  expect(state.calls[0]?.body.imageOptions).toMatchObject({ resolution: '2k', quality: 'high', imageOutputFormat: 'webp', imageStream: true })
  await page.getByText('图库与任务管理', { exact: true }).click()
  await expect(page.locator('.gallery-item')).toHaveCount(1)
  await page.locator('.gallery-cover').click()
  await expect(page.getByRole('dialog', { name: '原始媒体预览' })).toBeVisible()
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await expect(page.locator('.media-lightbox output')).toHaveText('125%')
  await page.keyboard.press('Escape')
  await capture(page, 'image')
  expect(errors).toEqual([])
})
test('video controls follow model limits and retain first-last mode and custom parameters', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/video')
  await expect(page.getByLabel('时长（秒）')).toHaveValue('8')
  expect(await page.getByLabel('时长（秒）').locator('option').allTextContents()).toEqual(['4', '8', '12'])
  await page.getByText('高级参数', { exact: true }).click()
  await page.getByRole('combobox', { name: '生成方式', exact: true }).selectOption('first-last-frame')
  await page.getByRole('combobox', { name: '参考图来源', exact: true }).selectOption('image_url')
  await page.getByLabel('首张图片 URL', { exact: true }).fill('https://media.example/first.png')
  await page.getByLabel('尾帧图片 URL', { exact: true }).fill('https://media.example/last.png')
  await page.getByLabel('自定义参数 JSON', { exact: true }).fill('{"metadata":{"label":"test"}}')
  await page.getByLabel('提示词', { exact: true }).fill('水母游过海底')
  await capture(page, 'video')
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
  await page.getByText('技能与工具', { exact: true }).click()
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
  await page.getByRole('combobox', { name: '联网搜索', exact: true }).selectOption('quick')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('不应该发送的搜索')
  await page.evaluate(() => { (window as unknown as { slowWrites: boolean }).slowWrites = true })
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('button', { name: '停止等待', exact: true }).click()
  await page.evaluate(() => { (window as unknown as { slowWrites: boolean }).slowWrites = false })
  await expect.poll(() => page.evaluate(() => (window as unknown as { pendingWrites: number }).pendingWrites)).toBe(0)
  await page.getByRole('button', { name: '图片', exact: true }).click()
  await page.getByLabel('提示词', { exact: true }).fill('旧账号的任务')
  await page.evaluate(() => { (window as unknown as { slowWrites: boolean }).slowWrites = true })
  await page.getByRole('button', { name: '开始生成', exact: true }).click()
  state.state.user.id = '18'; state.state.user.accountId = '18'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.history-row')).toHaveCount(0)
  await page.evaluate(() => { (window as unknown as { slowWrites: boolean }).slowWrites = false })
  await expect.poll(() => page.evaluate(() => (window as unknown as { pendingWrites: number }).pendingWrites)).toBe(0)
  expect(state.calls.filter(call => ['/api/creation/search', '/api/creation/generate'].includes(call.path))).toHaveLength(0)
})
test('chat retains multi-turn context, branches, reasoning and search reuse without another search charge', async ({ page }) => {
  const state = await fixture(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/create/text')
  await page.getByRole('combobox', { name: '联网搜索', exact: true }).selectOption('quick')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('查询海洋信息')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('回答 1')
  await page.getByRole('button', { name: '重新生成回答', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('回答 2')
  expect(state.calls.filter(call => call.path === '/api/creation/search')).toHaveLength(1)
  await page.getByRole('button', { name: '上一个分支', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('回答 1')
  await page.getByRole('combobox', { name: '联网搜索', exact: true }).selectOption('off')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('继续说明')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toHaveCount(2)
  const generated = state.calls.filter(call => call.path === '/api/creation/generate')
  expect(generated.at(-1)?.body.chatOptions.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: expect.stringContaining('回答 1') }), expect.objectContaining({ role: 'user', content: '继续说明' })]))
  await page.reload()
  await expect(page.locator('.chat-message.assistant')).toHaveCount(2)
  expect(state.calls.filter(call => call.path === '/api/creation/generate')).toHaveLength(3)
  await page.getByText('对话参数', { exact: true }).click()
  await capture(page, 'chat')
  expect(errors).toEqual([])
})
test('chat attachments keep the original PDF bytes and active skills are scoped to the conversation', async ({ page }) => {
  const state = await fixture(page)
  const body = '---\nname: Editor\n---\nUse short sentences.'
  const { createHash } = await import('node:crypto')
  await page.route('**/api/creation/skills/catalog', route => route.fulfill({ json: { items: [{ id: 'editor', name: '编辑技能', description: '简洁表达', body, sha256: createHash('sha256').update(body).digest('hex') }] } }))
  await page.goto('/create/text')
  await page.getByText('技能与工具', { exact: true }).click()
  await page.getByLabel('编辑技能').check()
  await page.locator('.attachment-button input').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-test-bytes') })
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('理解附件')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  const sent = state.calls.find(call => call.path === '/api/creation/generate')!.body.chatOptions.messages
  expect(sent.some((message: any) => message.role === 'system' && message.content.includes('Use short sentences.'))).toBe(true)
  expect(JSON.stringify(sent)).toContain(Buffer.from('%PDF-test-bytes').toString('base64'))
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await expect(page.getByLabel('编辑技能')).not.toBeChecked()
  await expect(page.getByText('当前账号未启用 MCP 工具。', { exact: true })).toBeVisible()
})
test('legacy split chat attachments are hydrated into native conversation without rewriting the old snapshot', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/create/image')
  const original = await page.evaluate(async () => {
    const key = 'octopus:user-17:chat-next-web-store'
    const value = JSON.stringify({ version: 3.5, __octopusChatAssets: { format: 'octopus-chat-assets-v1', ids: ['old-pdf'] }, state: {
      _hasHydrated: true, sessions: [{ id: 'legacy-chat', topic: '历史附件会话', messages: [{ id: 'old-message', role: 'user', content: [{ type: 'file', file: { filename: 'old-report.pdf', file_data: { __octopusChatAsset: 'old-pdf' } } }] }] }],
    } })
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('community-studio', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('keyval', 'readwrite'), store = transaction.objectStore('keyval')
      store.put(value, key); store.put('data:application/pdf;base64,' + btoa('%PDF-original-bytes'), `${key}:asset:old-pdf`)
      transaction.oncomplete = () => { db.close(); resolve() }; transaction.onerror = () => reject(transaction.error)
    })
    return value
  })
  await page.goto('/create/text')
  await expect(page.getByLabel('对话名称')).toHaveValue('历史附件会话')
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
test('account tools use the configured quota ratio for logs and key budgets', async ({ page }) => {
  const state = await fixture(page)
  await page.route('**/api/new-api/**', route => {
    const url = new URL(route.request().url()), key = url.pathname.split('/api/new-api/')[1]!
    const data: Record<string, unknown> = { status: { quotaPerUnit: 250000, currencySymbol: '¥' }, session: { selectedTokenId: 41 },
      groups: [{ id: 'auto', name: 'Auto' }], 'auto-groups': { supported: false, defaultGroups: [], maxCount: 0 },
      logs: { items: [{ id: 1, created_at: 1700000000, model_name: 'gpt-5', token_name: '系统创建', prompt_tokens: 12, completion_tokens: 24, quota: 62500 }], total: 1 },
      tokens: { items: [{ id: 41, name: '系统创建', group: 'auto', status: 1, expired_time: -1, unlimited_quota: true, used_quota: 250000, remain_quota: 500000 }], total: 1 },
      'model-groups': { selectedGroup: 'auto', groups: [{ id: 'auto', name: 'Auto', ratio: 1 }] },
      'model-pricing': { account: 'root', currency: '¥', fetchedAt: new Date().toISOString(), rows: [{ model: 'gpt-5', group: 'auto', billing: 'Tokens', price: '¥2 / 百万输入' }] } }
    if (route.request().method() !== 'GET') state.calls.push({ path: url.pathname, body: route.request().postDataJSON() })
    return route.fulfill({ json: { success: true, data: data[key] || {} } })
  })
  await page.goto('/create/image')
  await page.getByRole('button', { name: '消费记录', exact: true }).click()
  await expect(page.getByRole('cell', { name: '¥ 0.25', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '密钥', exact: true }).click()
  await page.getByRole('button', { name: '创建密钥', exact: true }).click()
  await page.getByLabel('名称', { exact: true }).fill('测试额度')
  await page.getByLabel('不限额', { exact: true }).uncheck()
  await page.getByLabel('额度（¥）', { exact: true }).fill('1.25')
  await page.getByRole('button', { name: '保存密钥', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(state.calls.find(call => call.path === '/api/new-api/tokens')?.body.remain_quota).toBe(312500)
  await page.getByRole('button', { name: '模型价格', exact: true }).click()
  await expect(page.getByRole('cell', { name: '¥2 / 百万输入', exact: true })).toBeVisible()
  await capture(page, 'prices')
})
