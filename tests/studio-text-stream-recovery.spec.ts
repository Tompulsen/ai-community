import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, mode: 'append' | 'snapshot' | 'interrupted') {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  let submissions = 0, queries = 0, requestId = '', protocol = ''
  const text = '你好🌊，这段回答已保存。'
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/generate')) {
      submissions++
      requestId = route.request().postDataJSON().requestId
      protocol = route.request().headers()['x-creation-stream'] || ''
      const events: object[] = [{ type: 'accepted', requestId, deadline: Date.now() + 31 * 60_000 }]
      if (mode === 'snapshot') events.push({ type: 'delta', text: '你好🌊' }, { type: 'delta', text })
      else events.push({ type: 'delta', append: true, text: '你好🌊', reasoning: '先思考' },
        { type: 'delta', append: true, text: mode === 'interrupted' ? '' : '，这段回答已保存。', reasoning: '再回答', usage: { outputTokens: 12 } })
      if (mode !== 'interrupted') events.push({ type: 'result', status: 'succeeded', outputs: [{ text }], usage: { outputTokens: 12 } })
      return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
    }
    if (path.includes('/requests/')) {
      queries++
      expect(path).toBe('/api/creation/requests/' + requestId)
      return route.fulfill({ json: { requestId, status: 'indeterminate', outputs: [{ text }], reasoning: '已保存的推理',
        usage: { outputTokens: 12 }, error: '回答已中断。已保留部分回答，内容尚未完整生成。' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto('/create/text')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('测试长回答恢复')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const answer = page.locator('.chat-message.assistant .message-content')
  await expect(answer).toContainText(text)
  return { text, submissions: () => submissions, queries: () => queries, protocol: () => protocol }
}

for (const mode of ['append', 'snapshot'] as const) test(`${mode} text streams render exactly once and preserve the final answer`, async ({ page }) => {
  const f = await fixture(page, mode)
  expect(f.protocol()).toBe('append-v1')
  expect(f.submissions()).toBe(1)
  expect(f.queries()).toBe(0)
  const answer = page.locator('.chat-message.assistant .message-content .studio-markdown-body')
  await expect(answer).toHaveText(f.text)
  await page.reload()
  await expect(answer).toHaveText(f.text)
  expect(f.submissions()).toBe(1)
})

test('mobile interruption restores server partial text through GET and survives reload without another paid POST', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const f = await fixture(page, 'interrupted')
  await expect(page.locator('.chat-message.assistant')).toContainText('内容尚未完整生成')
  expect(f.queries()).toBeGreaterThan(0)
  expect(f.submissions()).toBe(1)
  await page.reload()
  await expect(page.locator('.chat-message.assistant .message-content')).toContainText(f.text)
  await expect(page.locator('.chat-message.assistant')).toContainText('内容尚未完整生成')
  expect(f.submissions()).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
