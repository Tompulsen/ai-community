import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

const shotDir = '.taste-skill/studio-message-reuse-20261115'
const source = { title: '官方资料', url: 'https://reference.example/guide', snippet: '引用摘要' }
const longCode = Array.from({ length: 22 }, (_, index) => `const line${index} = ${index};`).join('\n')
const richAnswer = [
  '## 消息组件预览', '这段文字可以选中引用。 **粗体**、*斜体*和 `inlineCode`。',
  '> 引用段落', '- [x] 已完成\n- [ ] 待确认',
  '| 模型 | 状态 |\n| --- | --- |\n| gpt-5 | 可用 |',
  '公式 $E=mc^2$，以及：\n\n$$\\frac{a}{b}+\\sqrt{x}$$',
  `\`\`\`typescript\n${longCode}\n\`\`\``,
  '1. 嵌套代码\n\n   ```js\n   console.log("nested")\n   ```',
  '```mermaid\nflowchart LR\n  A[开始] --> B[完成]\n```',
  '```html\n<!doctype html><html><head><title>隔离示例</title></head><body><h1>HTML 预览</h1><p id="isolated">检查中</p><script>try{parent.__escaped=true}catch(e){document.querySelector("#isolated").textContent="已隔离"}</script></body></html>\n```',
  '[1](https://reference.example/guide)',
  '![作品示例](/assets/brand/octopus-community.jpg)',
  '[声音](https://media.fixture.test/audio.mp3)\n\n[视频](https://media.fixture.test/video.mp4)',
  '<p style="position:fixed;inset:0" onclick="window.__escaped=true">安全正文</p>',
  '<img src="x" onerror="window.__escaped=true">',
].join('\n\n')

async function fixture(page: Page, messages: any[] = []) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const calls: { path: string; body: any }[] = []
  await page.route('https://media.fixture.test/**', route => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }] } })
    if (path === '/api/creation/skills/catalog') return route.fulfill({ json: { items: [] } })
    if (path === '/api/creation/mcp/status') return route.fulfill({ json: { enabled: true, items: [{ id: 'fixture-server', status: 'active' }] } })
    calls.push({ path, body: route.request().method() === 'POST' ? route.request().postDataJSON() : undefined })
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ text: '新的回答' }], tokenId: 41, protocol: 'sync' } })
  })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__copied = text } } })
  })
  await page.goto('/community')
  await page.evaluate(data => {
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'messages-fixture', sessions: [{
        id: 'messages-fixture', topic: '消息组件', model: 'gpt-5', settings: { mcpServers: ['fixture-server'] },
        skillIds: [], search: 'off', messages: data, lastUpdate: Date.now(),
      }],
    } }))
  }, messages)
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible({ timeout: 15_000 })
  return { ...account, calls }
}
const assistant = (content: string, extra = {}) => ({ id: 'answer-fixture', role: 'assistant', content, createdAt: Date.now(), ...extra })
const user = { id: 'user-fixture', role: 'user', content: '请展示消息组件', createdAt: Date.now() }

test('ELK layouts use disposable same-origin workers while parser-based diagrams still render', async ({ page }) => {
  const errors: string[] = [], workers: string[] = [], closed: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('worker', worker => { workers.push(worker.url()); worker.on('close', () => closed.push(worker.url())) })
  const content = [
    '```mermaid\n---\nconfig:\n  layout: elk\n---\nflowchart LR\n A[Worker开始] --> B[Worker完成]\n```',
    '```mermaid\n---\nconfig:\n  layout: elk\n---\nflowchart LR\n subgraph group[布局分组]\n C[再次布局] --> D[布局完成]\n end\n```',
    '```mermaid\npie title 图表占比\n "图片": 60\n "视频": 40\n```',
  ].join('\n\n')
  await page.route('**/create/text', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" } })
  })
  await fixture(page, [user, assistant(content)])
  await expect(page.locator('.diagram-preview svg')).toHaveCount(3)
  await expect(page.locator('.diagram-preview').nth(0)).toContainText('Worker完成')
  await expect(page.locator('.diagram-preview').nth(1)).toContainText('布局分组')
  await expect(page.locator('.diagram-preview').nth(2)).toContainText('图表占比')
  await expect.poll(() => workers.length).toBe(2)
  expect(workers.every(url => new URL(url).origin === new URL(page.url()).origin && url.includes('elk-worker'))).toBe(true)
  await expect.poll(() => closed.length).toBe(2)
  expect(errors).toEqual([])
})

test('ELK worker failures preserve source code and release the next diagram in the render queue', async ({ page }) => {
  const errors: string[] = [], closed: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('worker', worker => worker.on('close', () => closed.push(worker.url())))
  await page.route('**/*elk-worker*.js*', route => {
    if (new URL(route.request().url()).searchParams.has('url')) return route.continue()
    return route.fulfill({ contentType: 'application/javascript', body: 'throw new Error("fixture worker initialization failed")' })
  })
  const content = [
    '```mermaid\n---\nconfig:\n  layout: elk\n---\nflowchart LR\n A[失败源代码] --> B[保留]\n```',
    '```mermaid\n---\nconfig:\n  layout: dagre\n---\nflowchart LR\n C[后续图表] --> D[正常渲染]\n```',
  ].join('\n\n')
  await fixture(page, [user, assistant(content)])
  await expect(page.locator('.diagram-error')).toContainText('已保留源代码')
  await expect(page.locator('.studio-code-block').first().locator('code')).toContainText('失败源代码')
  await expect(page.locator('.diagram-preview svg')).toHaveCount(1)
  await expect(page.locator('.diagram-preview')).toContainText('正常渲染')
  await expect.poll(() => closed.length).toBe(1)
  expect(errors).toEqual([])
})

test('rich Markdown, formulas, diagrams, media and citations render safely across themes and viewports', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const state = await fixture(page, [user, assistant(richAnswer, { sources: [source], reasoning: '先整理资料，再组织回答。' })])
  const answer = page.locator('.chat-message.assistant')
  await expect(answer.locator('.katex')).toHaveCount(2)
  await expect(answer.locator('.katex-mathml')).toHaveCount(2)
  await expect(answer.locator('.studio-code-block')).toHaveCount(4)
  await expect(answer.getByRole('button', { name: '放大图表', exact: true })).toBeVisible()
  await expect(answer.locator('.diagram-preview svg')).toContainText('开始')
  await answer.getByRole('button', { name: '放大图表', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '放大图表', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(answer.locator('audio')).toHaveAttribute('controls', '')
  await expect(answer.locator('video')).toHaveAttribute('controls', '')
  expect(await answer.locator('.message-content > .studio-markdown-body').evaluate(element => !!element.querySelector('[onclick],[onerror],script,p[style]'))).toBe(false)
  expect(await page.evaluate(() => (window as any).__escaped)).toBeUndefined()
  await answer.locator('.studio-source-citation').click()
  await expect(page.getByRole('dialog', { name: '引用来源', exact: true })).toContainText('引用摘要')
  await page.keyboard.press('Escape')
  await answer.locator('.message-sources summary').click()
  await expect(answer.locator('.message-sources a')).toContainText('官方资料')
  await answer.getByRole('button', { name: '放大图片', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '放大图片', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await mkdir(shotDir, { recursive: true })
  for (const [width, mode] of [[1440, 'light'], [390, 'dark'], [320, 'light']] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(value => (window as any).communityAppearance.set({ mode: value }), mode)
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }) })
    await page.locator('.chat-messages').evaluate(element => element.scrollTop = 0)
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
    await page.screenshot({ path: `${shotDir}/messages-${width}-${mode}.png` })
    const layout = await page.evaluate(() => ({
      width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      overflow: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 10).map(element => [element.tagName, element.className]),
      outside: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().bottom > innerHeight + 1 && !element.closest('.chat-messages')).slice(0, 15).map(element => [element.tagName, element.className, element.getBoundingClientRect().top, element.getBoundingClientRect().bottom, getComputedStyle(element).position]),
      scrollY, dialogs: [...document.querySelectorAll('dialog')].map(element => [element.className, element.open, getComputedStyle(element).display, element.getBoundingClientRect().bottom]),
    }))
    expect(layout.scrollWidth <= layout.width && layout.scrollHeight <= layout.height + 1, JSON.stringify(layout)).toBe(true)
    const code = answer.locator('.studio-code-block').first()
    expect(await code.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true)
    const contrast = await code.evaluate(element => {
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
      canvas.width = canvas.height = 1
      const luminance = (color: string) => {
        context.fillStyle = color; context.fillRect(0, 0, 1, 1)
        const values = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722
      }
      const background = luminance(getComputedStyle(element).backgroundColor)
      return Math.min(...[...element.querySelectorAll('.hljs-keyword, .hljs-number')].map(token => {
        const text = luminance(getComputedStyle(token).color)
        return (Math.max(text, background) + .05) / (Math.min(text, background) + .05)
      }))
    })
    expect(contrast).toBeGreaterThanOrEqual(4.5)
    await code.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${shotDir}/code-${width}-${mode}.png` })
  }
  expect(state.calls).toHaveLength(0)
  expect(errors).toEqual([])
})

test('long code folds, highlights and copies the complete source', async ({ page }) => {
  await fixture(page, [user, assistant(`\`\`\`typescript\n${longCode}\n\`\`\``)])
  const code = page.locator('.studio-code-block')
  await expect(code.locator('.hljs-keyword')).not.toHaveCount(0)
  await expect(code.locator('pre')).toHaveClass('collapsed')
  await code.getByRole('button', { name: /展开.*22 行/ }).click()
  await expect(code.locator('pre')).not.toHaveClass('collapsed')
  await code.getByRole('button', { name: '复制代码', exact: true }).click()
  await expect(code.getByRole('button', { name: '已复制', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__copied)).toBe(longCode)
  await code.getByRole('button', { name: /收起.*22 行/ }).click()
  await expect(code.locator('pre')).toHaveClass('collapsed')
})

test('HTML and SVG previews remain isolated and support refresh, full screen and source view', async ({ page }) => {
  await page.route('**/create/text', async route => {
    const response = await route.fetch(), headers = { ...response.headers() }
    // Exercise the iframe sandbox independently of the local preview's inline-script restriction.
    delete headers['content-security-policy']
    await route.fulfill({ response, headers })
  })
  await fixture(page, [user, assistant(richAnswer)])
  const preview = page.locator('.studio-html-preview')
  await expect(preview.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-modals')
  await expect(preview.frameLocator('iframe').locator('#isolated')).toHaveText('已隔离')
  await preview.getByRole('button', { name: '刷新预览', exact: true }).click()
  await expect(preview.frameLocator('iframe').locator('#isolated')).toHaveText('已隔离')
  await preview.getByRole('button', { name: '全屏预览', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'HTML 预览', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(preview.getByRole('button', { name: '全屏预览', exact: true })).toBeFocused()
  const htmlBlock = page.locator('.studio-code-block').nth(3)
  await htmlBlock.getByRole('button', { name: '查看源代码', exact: true }).click()
  await expect(htmlBlock.locator('pre')).toContainText('<!doctype html>')
  expect(await page.evaluate(() => (window as any).__escaped)).toBeUndefined()
})

test('SVG code renders inside the isolated preview rather than injecting SVG into the message', async ({ page }) => {
  await fixture(page, [user, assistant('```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="teal"/><text x="20" y="50">SVG示例</text></svg>\n```')])
  const preview = page.locator('.studio-html-preview')
  await expect(preview.frameLocator('iframe').locator('svg text')).toHaveText('SVG示例')
  await expect(preview.locator('iframe')).not.toHaveAttribute('sandbox', /allow-same-origin/)
  await page.locator('.studio-code-block').getByRole('button', { name: '查看源代码', exact: true }).click()
  await expect(page.locator('.studio-code-block pre')).toContainText('<svg')
})

test('message attachments use native media controls and clicking an image opens its preview', async ({ page }) => {
  await fixture(page, [{
    ...user, content: [
      { type: 'text', text: '查看这些附件' },
      { type: 'image_url', image_url: { url: '/assets/brand/octopus-community.jpg' } },
      { type: 'video_url', video_url: { url: 'https://media.fixture.test/video.mp4' } },
      { type: 'input_audio', input_audio: { format: 'wav', data: 'UklGRg==' } },
    ],
  }])
  const attachments = page.locator('.message-attachments')
  await expect(attachments.locator('audio')).toHaveAttribute('controls', '')
  await expect(attachments.locator('video')).toHaveAttribute('controls', '')
  await attachments.getByRole('button', { name: '放大图片附件', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '图片附件预览', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '图片附件预览', exact: true })).not.toBeVisible()
})

test('the latest typed draft survives an immediate reload before batched persistence', async ({ page }) => {
  await fixture(page)
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('刷新前最后输入的草稿')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('刷新前最后输入的草稿')
})

test('selected-text quotes persist in the draft and are sent without changing the visible question', async ({ page }) => {
  const state = await fixture(page, [user, assistant('这段文字可以选中引用。')])
  const paragraph = page.locator('.chat-message.assistant .studio-markdown-body p')
  await paragraph.scrollIntoViewIfNeeded()
  await paragraph.evaluate(element => {
    (document.activeElement as HTMLElement)?.blur()
    const range = document.createRange(); range.selectNodeContents(element)
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.getByRole('button', { name: '引用选中文字', exact: true }).click()
  await expect(page.getByTestId('composer-quote')).toContainText('这段文字可以选中引用。')
  await page.reload()
  await expect(page.getByTestId('composer-quote')).toContainText('这段文字可以选中引用。')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('请继续解释')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.locator('.chat-message.assistant')).toHaveCount(2)
  await expect(page.locator('.chat-message.user').last().locator('.user-text')).toHaveText('请继续解释')
  await expect(page.locator('.chat-message.user').last().getByTestId('message-quote')).toContainText('这段文字可以选中引用。')
  await expect.poll(() => JSON.stringify(state.calls.find(call => call.path === '/api/creation/generate')?.body.chatOptions.messages || [])).toContain('引用内容：')
  await expect(page.getByTestId('composer-quote')).toHaveCount(0)
})

test('inline edits preserve the composer draft and user edits keep both answer branches', async ({ page }) => {
  const state = await fixture(page, [user, assistant('原始回答')])
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('待发送的草稿')
  await page.locator('.chat-message.assistant').hover()
  await page.getByRole('button', { name: '编辑回答', exact: true }).click()
  const editor = page.getByRole('form', { name: '编辑消息', exact: true })
  await editor.getByRole('textbox', { name: '消息内容', exact: true }).fill('手动修订的回答')
  await editor.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('手动修订的回答')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('待发送的草稿')
  expect(state.calls).toHaveLength(0)
  await page.locator('.chat-message.user').hover()
  await page.getByRole('button', { name: '编辑提问', exact: true }).click()
  await editor.getByRole('textbox', { name: '消息内容', exact: true }).fill('修改后的提问')
  await editor.getByRole('button', { name: '保存并重新生成', exact: true }).click()
  await expect(page.locator('.chat-message.user .user-text')).toHaveText('修改后的提问')
  await page.locator('.chat-message.user').hover()
  await page.getByRole('button', { name: '上一个分支', exact: true }).click()
  await expect(page.locator('.chat-message.user .user-text')).toHaveText(user.content)
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('手动修订的回答')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('待发送的草稿')
  expect(state.calls.filter(call => call.path === '/api/creation/generate')).toHaveLength(1)
})

for (const selection of ['single', 'multiple']) test(`${selection} options bind to the generated answer and persist one submission receipt`, async ({ page }) => {
  const state = await fixture(page)
  let generation = 0
  await page.route('**/api/creation/generate', route => {
    const body = route.request().postDataJSON()
    state.calls.push({ path: '/api/creation/generate', body }); generation++
    const messageId = /"messageId":"([^"]+)"/.exec(JSON.stringify(body.chatOptions.messages).replaceAll('\\"', '"'))?.[1]
    const options = { id: 'purpose', question: '选择用途', selection, maxSelections: selection === 'single' ? 1 : 2, options: [{ id: 'a', label: '创作' }, { id: 'b', label: '学习' }, { id: 'c', label: '工作' }] }
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ text: generation === 1 ? `请确认用途。\n\n\`\`\`chat-ui\n${JSON.stringify({ version: 1, messageId, options })}\n\`\`\`` : '已根据选择继续回答。' }] } })
  })
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('帮我确认用途')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const options = page.getByTestId('message-option-list')
  await expect(options).toBeVisible()
  const role = selection === 'single' ? 'radio' : 'checkbox'
  await options.getByRole(role, { name: '创作', exact: true }).check()
  if (selection === 'multiple') {
    await options.getByRole(role, { name: '学习', exact: true }).check()
    await expect(options.getByRole(role, { name: '工作', exact: true })).toBeDisabled()
  }
  await options.getByRole('button', { name: '提交选择', exact: true }).click()
  await expect(options).toContainText('已提交选择')
  await expect(page.locator('.chat-message.assistant').last()).toContainText('已根据选择继续回答。')
  await page.reload()
  await expect(options).toContainText('已提交选择')
  await expect(options.getByRole('button', { name: '提交选择', exact: true })).toHaveCount(0)
  expect(generation).toBe(2)
  expect(state.calls.filter(call => call.path === '/api/creation/generate').at(-1)?.body.chatOptions.messages.at(-1).content).toContain('创作')
})

test('tool parameter editing confirms each rerun, preserves results on failure and never reruns on reload', async ({ page }) => {
  const tool = { id: 'call-fixture', name: 'mcp_fixture', arguments: { query: '海洋', count: 2 }, servers: ['fixture-server'], status: 'complete', result: { rows: [{ name: '原结果', score: 2 }] } }
  const toolRounds = [{ role: 'assistant', content: '', tool_calls: [{ id: tool.id, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] }, { role: 'tool', tool_call_id: tool.id, content: JSON.stringify(tool.result) }]
  await fixture(page, [user, assistant('工具已完成。', { tools: [tool], toolRounds })])
  let toolCalls = 0
  await page.route('**/api/creation/mcp/call', route => {
    toolCalls++
    expect(route.request().postDataJSON()).toMatchObject({ name: tool.name, arguments: { query: '星空', count: 3 }, servers: ['fixture-server'] })
    return route.fulfill({ status: 500, json: { message: '模拟失败' } })
  })
  const card = page.getByTestId('tool-result-card')
  await card.locator('summary').click()
  await card.getByRole('button', { name: '调整参数', exact: true }).click()
  await card.getByLabel('query', { exact: true }).fill('星空')
  await card.getByLabel('count', { exact: true }).fill('3')
  page.once('dialog', dialog => dialog.dismiss())
  await card.getByRole('button', { name: '重新执行', exact: true }).click()
  expect(toolCalls).toBe(0)
  await card.getByRole('button', { name: '调整参数', exact: true }).click()
  await card.getByLabel('query', { exact: true }).fill('星空')
  await card.getByLabel('count', { exact: true }).fill('3')
  page.once('dialog', dialog => dialog.accept())
  await card.getByRole('button', { name: '重新执行', exact: true }).click()
  await expect(card).toContainText('执行失败')
  await expect(card).toContainText('原结果')
  await page.reload()
  await expect(card).toContainText('执行失败')
  expect(toolCalls).toBe(1)
})

test('generation shows stage and timer before completion, then offers a collapsed reasoning panel', async ({ page }) => {
  await fixture(page)
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/creation/generate', async route => {
    await gate
    await route.fulfill({ json: { status: 'succeeded', reasoning: '先分析用户的问题。', outputs: [{ text: '最终回答。' }] } })
  })
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('分析一下')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const status = page.locator('.chat-message.assistant .message-heading .ai-status')
  await expect(status).toContainText('正在思考')
  await expect(status.locator('.ai-elapsed')).not.toHaveText('0s')
  release()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText('最终回答。')
  const reasoning = page.getByRole('button', { name: /思考过程/ })
  await expect(reasoning).toHaveAttribute('aria-expanded', 'false')
  await reasoning.click()
  await expect(page.getByRole('region', { name: '思考过程', exact: true })).toContainText('先分析用户的问题。')
  await expect(status).toHaveCount(0)
})

test('reasoning-only updates follow the conversation bottom while preserving an explicit scroll position', async ({ page }) => {
  await fixture(page, [user, assistant('历史回答。\n\n'.repeat(100)), { id: 'reasoning-live', role: 'assistant', content: '', reasoning: '开始分析。' }])
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!
    const { chats } = await import(/* @vite-ignore */ path)
    const chat = chats.sessions.find((item: any) => item.id === chats.activeId)
    chats.busy[chat.id] = true; chat.messages.at(-1).streaming = true
  })
  const messages = page.locator('.chat-messages')
  await messages.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!
    const { chats } = await import(/* @vite-ignore */ path)
    chats.sessions.find((item: any) => item.id === chats.activeId).messages.at(-1).reasoning = '分析进行中。\n\n'.repeat(30)
  })
  await expect.poll(() => messages.evaluate(element => Math.round(element.scrollHeight - element.scrollTop - element.clientHeight))).toBeLessThanOrEqual(2)
  await messages.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!
    const { chats } = await import(/* @vite-ignore */ path)
    chats.sessions.find((item: any) => item.id === chats.activeId).messages.at(-1).reasoning += '继续分析。'
  })
  await expect.poll(() => messages.evaluate(element => element.scrollTop)).toBe(0)
})
