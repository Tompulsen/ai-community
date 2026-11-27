import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { mockUnifiedAccount } from './helpers/account-fixture'

const shots = '.taste-skill/generation-feedback-20261115'
const answer = { id: 'feedback-answer', role: 'assistant', content: '', createdAt: Date.now() }
async function fixture(page: Page, messages: any[] = [answer]) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ text: '模拟回答' }] } })
  })
  await page.goto('/community')
  await page.evaluate(messages => localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
    _hasHydrated: true, activeId: 'feedback', sessions: [
      { id: 'feedback', topic: '加载反馈', model: 'gpt-5', settings: {}, skillIds: [], search: 'off', messages, lastUpdate: Date.now() },
      { id: 'another', topic: '另一个会话', model: 'gpt-5', settings: {}, skillIds: [], search: 'off', messages: [], lastUpdate: Date.now() },
    ],
  } })), messages)
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  return account
}
async function patchAnswer(page: Page, patch: Record<string, any>) {
  await page.evaluate(async patch => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!
    const { chats } = await import(/* @vite-ignore */ path)
    const chat = chats.sessions.find((item: any) => item.id === chats.activeId)
    Object.assign(chat.messages.at(-1), patch)
    if ('streaming' in patch) chats.busy[chat.id] = patch.streaming
  }, patch)
}

test('prose bursts reveal smoothly, finish within the catch-up budget and history never replays', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => { document.body.dataset.motion = 'full' })
  const text = '平滑文字输出🙂。'.repeat(200)
  await patchAnswer(page, { streaming: true })
  const shown = await page.evaluate(async text => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!
    const { chats } = await import(/* @vite-ignore */ path)
    chats.sessions.find((item: any) => item.id === chats.activeId).messages.at(-1).content = text
    await Promise.resolve(); await Promise.resolve()
    return document.querySelector('.chat-message.assistant .studio-markdown-body')?.textContent || ''
  }, text)
  expect(shown.length).toBeLessThan(text.length)
  const body = page.locator('.chat-message.assistant .studio-markdown-body')
  await expect.poll(async () => (await body.textContent())!.length).toBeGreaterThan(0)
  await patchAnswer(page, { streaming: false })
  await expect(body).toHaveText(text, { timeout: 1500 })
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!
    const { saveChats } = await import(/* @vite-ignore */ path)
    await saveChats(true)
  })
  await page.reload()
  await expect(body).toHaveText(text)
  await expect(body).toHaveAttribute('data-output-active', 'false')
})

test('reduced motion flushes prose, freezes the nonblank dot animation and retains state feedback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await fixture(page)
  await patchAnswer(page, { streaming: true })
  const orb = page.locator('canvas[data-slot="matrix-orb"]')
  await expect(orb).toHaveAttribute('data-animated', 'false')
  const pixels = await orb.evaluate((element: HTMLCanvasElement) => [...element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data].filter((_, index) => index % 4 === 3).filter(alpha => alpha > 0).length)
  expect(pixels).toBeGreaterThan(0)
  const text = '减少动态效果直接显示完整内容。'.repeat(40)
  await patchAnswer(page, { content: text })
  await expect(page.locator('.chat-message.assistant .studio-markdown-body')).toHaveText(text)
  await expect(page.locator('.ai-status')).toContainText('正在生成')
})

test('thinking dots move only while visible and turn static when the page is hidden', async ({ page }) => {
  await fixture(page)
  await patchAnswer(page, { streaming: true })
  const orb = page.locator('canvas[data-slot="matrix-orb"]')
  await expect(orb).toHaveAttribute('data-animated', 'true')
  const first = await orb.evaluate((element: HTMLCanvasElement) => element.toDataURL())
  await expect.poll(() => orb.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(first)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect(orb).toHaveAttribute('data-animated', 'false')
  const frozen = await orb.evaluate((element: HTMLCanvasElement) => element.toDataURL())
  await page.waitForTimeout(100)
  expect(await orb.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(frozen)
})

test('stream packets retain response metrics without displaying output speed', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      if (args[0] !== '/api/creation/generate') return original(...args)
      const encoder = new TextEncoder()
      return new Response(new ReadableStream({
        start(controller) {
          ;(window as any).__feedbackPacket = (data: unknown, close = false) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
            if (close) controller.close()
          }
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
  })
  await fixture(page, [])
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('请输出一段话')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__feedbackPacket)).toBe('function')
  await page.evaluate(() => (window as any).__feedbackPacket({ type: 'delta', text: '开始', reasoning: '' }))
  await expect(page.locator('.generation-speed')).toHaveCount(0)
  await page.waitForTimeout(100)
  const text = '真实流式回答。'.repeat(100)
  await page.evaluate(text => (window as any).__feedbackPacket({ type: 'delta', text, reasoning: '' }), text)
  await page.evaluate(text => (window as any).__feedbackPacket({ type: 'result', status: 'succeeded', outputs: [{ text }], usage: { outputTokens: 100 } }, true), text)
  await expect(page.locator('.generation-speed')).toHaveCount(0)
  await expect(page.locator('.chat-message.assistant .message-content > .studio-markdown-body')).toHaveText(text)
  expect(await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!
    const { chats } = await import(/* @vite-ignore */ path)
    const chat = chats.sessions.find((item: any) => item.id === chats.activeId)
    return chat.messages.at(-1).responseMetrics.usage.outputTokens
  })).toBe(100)
})

test('attachments show independent failures, retry and removal without submitting a generation', async ({ page }) => {
  await fixture(page, [])
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL
    let failed = false
    FileReader.prototype.readAsDataURL = function(blob) {
      if (!failed) { failed = true; queueMicrotask(() => this.dispatchEvent(new ProgressEvent('error'))); return }
      return original.call(this, blob)
    }
  })
  const input = page.locator('.chat-composer').getByLabel('添加附件', { exact: true })
  await input.setInputFiles([{ name: 'retry.txt', mimeType: 'text/plain', buffer: Buffer.from('retry') }, { name: 'ready.txt', mimeType: 'text/plain', buffer: Buffer.from('ready') }])
  const status = page.getByRole('region', { name: '附件处理状态' })
  await expect(status.locator('[data-file-status="failed"]')).toHaveCount(1)
  await expect(page.locator('.reference-list [data-attachment-kind="file"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await status.getByRole('button', { name: '重试失败附件' }).click()
  await expect(status).toHaveCount(0)
  const attachments = page.locator('.reference-list')
  await expect(attachments.locator('[data-attachment-kind="file"]')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await attachments.locator('li').filter({ hasText: 'retry.txt' }).hover()
  await attachments.getByRole('button', { name: '移除附件 retry.txt' }).click()
  await expect(attachments).not.toContainText('retry.txt')
  await expect(attachments).toContainText('ready.txt')
})

test('switching conversations prevents a delayed attachment read from entering the new draft', async ({ page }) => {
  await fixture(page, [])
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL
    ;(window as any).__releaseFile = () => {}
    FileReader.prototype.readAsDataURL = function(blob) { (window as any).__releaseFile = () => original.call(this, blob) }
  })
  await page.locator('.chat-composer').getByLabel('添加附件', { exact: true }).setInputFiles({ name: 'slow.txt', mimeType: 'text/plain', buffer: Buffer.from('slow') })
  await expect(page.locator('[data-file-status="processing"]')).toHaveCount(1)
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!
    const { chats } = await import(/* @vite-ignore */ path)
    chats.activeId = 'another'
    await Promise.resolve()
    ;(window as any).__releaseFile()
  })
  await expect(page.locator('.material-status')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('')
})

test('reasoning and tool panels animate, restore focus and follow native details toggles', async ({ page }) => {
  await fixture(page, [{ ...answer, content: '回答', reasoning: '思考内容', tools: [{ id: 'tool', name: 'fixture', status: 'complete', arguments: { q: 'query' }, result: { ok: true } }] }])
  const trigger = page.getByRole('button', { name: /思考过程/ }), region = page.getByRole('region', { name: '思考过程', exact: true })
  await trigger.click()
  await expect(region).toBeVisible()
  expect(await region.locator('..').locator('..').evaluate(element => getComputedStyle(element).transitionDuration)).toContain('0.22s')
  await region.focus()
  await patchAnswer(page, { content: '', streaming: true })
  await trigger.click()
  await expect(trigger).toBeFocused()
  await expect(page.locator('.reasoning .studio-collapse')).toHaveAttribute('inert', '')
  const tool = page.locator('.tool-activity')
  await tool.locator('summary').click()
  await expect(tool.getByRole('region', { name: '工具结果数据' })).toHaveCount(0)
  await expect(tool.locator('.tool-content')).toBeVisible()
  await tool.evaluate((element: HTMLDetailsElement) => { element.open = false })
  await expect(tool.locator('summary')).toHaveAttribute('aria-expanded', 'false')
  await tool.evaluate((element: HTMLDetailsElement) => { element.open = true })
  await expect(tool.locator('summary')).toHaveAttribute('aria-expanded', 'true')
  await expect(tool.locator('.studio-collapse')).not.toHaveAttribute('inert', '')
})

test('compression feedback remains compact across themes and mobile widths without output speed', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await fixture(page, [{ ...answer, content: '这里是输出预览。'.repeat(12), reasoning: '先确认用户目标，再组织回答。', contextCompressed: true, responseMetrics: { usage: { outputTokens: 80 }, generationDurationMs: 2000 } }])
  await expect(page.locator('.generation-speed')).toHaveCount(0)
  await patchAnswer(page, { contextCompressing: true, contextCompressed: false, streaming: true })
  await expect(page.locator('.context-compression-notice')).toContainText('上下文正在压缩')
  await patchAnswer(page, { contextCompressing: false, contextCompressed: true, streaming: false })
  await mkdir(shots, { recursive: true })
  for (const [width, mode] of [[1440, 'light'], [390, 'dark'], [320, 'light']] as const) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(mode => window.communityAppearance.set({ mode }), mode)
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
    await page.screenshot({ path: `${shots}/feedback-${width}-${mode}.png` })
  }
  expect(errors).toEqual([])
})
