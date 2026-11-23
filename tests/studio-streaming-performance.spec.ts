import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page, content: string) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  await page.route('**/api/creation/**', route => route.fulfill({ json: {
    tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }],
  } }))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { (window as any).__copiedCode = value },
    } })
  })
  await page.goto('/community')
  await page.evaluate(content => {
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'stream-performance', sessions: [{
        id: 'stream-performance', topic: 'Streaming performance', model: 'gpt-5', settings: {},
        skillIds: [], search: 'off', messages: [{ id: 'answer', role: 'assistant', content, createdAt: Date.now() }],
      }],
    } }))
  }, content)
  await page.goto('/create/text')
  await expect(page.locator('.studio-code-block code')).toBeVisible()
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name))!
    const { chats } = await import(/* @vite-ignore */ path)
    ;(window as any).__streamChat = chats.sessions.find((chat: any) => chat.id === chats.activeId)
  })
}

test('stream bursts batch Markdown work while complete blocks, code copying and the final packet stay correct', async ({ page }) => {
  const code = Array.from({ length: 80 }, (_, index) => `const line${index} = ${index};`).join('\n')
  const prefix = `Repeated paragraph.\n\nRepeated paragraph.\n\n\`\`\`javascript\n${code}\n`
  await fixture(page, prefix)
  const parsed = await page.evaluate(async () => {
    const state = window as any, message = state.__streamChat.messages[0]
    const parse = DOMParser.prototype.parseFromString
    let count = 0
    DOMParser.prototype.parseFromString = function (...args: Parameters<typeof parse>) {
      count++
      return parse.apply(this, args)
    }
    try {
      message.streaming = true
      for (let index = 0; index < 12; index++) {
        message.content += `const packet${index} = ${index};\n`
        await new Promise(resolve => setTimeout(resolve, 4))
      }
      await new Promise(resolve => setTimeout(resolve, 70))
      return count
    } finally { DOMParser.prototype.parseFromString = parse }
  })
  expect(parsed).toBeLessThan(12)
  const body = page.locator('.chat-message.assistant .studio-markdown-body')
  await expect(body.locator(':scope > p')).toHaveCount(2)
  await expect(body.locator(':scope > p').nth(0)).toHaveText('Repeated paragraph.')
  await expect(body.locator(':scope > p').nth(1)).toHaveText('Repeated paragraph.')
  await expect(body.locator('code')).toContainText('const packet11 = 11;')
  const finalCode = `${code}\n${Array.from({ length: 12 }, (_, index) => `const packet${index} = ${index};`).join('\n')}\n// final packet`
  await page.evaluate(() => {
    const message = (window as any).__streamChat.messages[0]
    message.content += '// final packet\n```'
    message.streaming = false
  })
  await expect(body).toHaveAttribute('data-output-active', 'false')
  await expect(body.locator('.hljs-comment')).toHaveText('// final packet')
  await body.getByRole('button', { name: '复制代码', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__copiedCode)).toBe(finalCode)
})

test('replacing streamed code flushes its language and escaped content without corrupting document references', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await fixture(page, '```javascript\nconst initial = 1;\n```')
  await page.evaluate(() => {
    const message = (window as any).__streamChat.messages[0]
    message.streaming = true
    message.content = '```python\nprint("<img src=x onerror=alert(1)>")\n```\n\n[Guide][docs]\n\n[docs]: https://example.com/guide'
  })
  const body = page.locator('.chat-message.assistant .studio-markdown-body')
  await expect(body.locator('.code-header > span').first()).toHaveText('python')
  await expect(body.locator('code')).toHaveText('print("<img src=x onerror=alert(1)>")')
  await expect(body.locator('.studio-code-block img, [onerror]')).toHaveCount(0)
  await expect(body.getByRole('link', { name: 'Guide', exact: true })).toHaveAttribute('href', 'https://example.com/guide')
  await page.evaluate(() => {
    const message = (window as any).__streamChat.messages[0]
    message.streaming = false
    message.content = '<form>&lt;p&gt;hi&lt;/p&gt;</form>'
  })
  await expect(body).toHaveText('<p>hi</p>')
  await expect(body.locator(':scope > p')).toHaveCount(0)
  await page.evaluate(() => { (window as any).__streamChat.messages[0].content = '<p>hi</p>' })
  await expect(body.locator(':scope > p')).toHaveText('hi')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('stopping a prose answer immediately displays its final text instead of waiting for the typewriter', async ({ page }) => {
  await fixture(page, '```text\ninitial\n```')
  await page.evaluate(() => {
    document.body.dataset.motion = 'full'
    const message = (window as any).__streamChat.messages[0]
    message.content = ''
    message.streaming = true
  })
  const text = 'A complete prose response. '.repeat(200)
  const final = await page.evaluate(async text => {
    const message = (window as any).__streamChat.messages[0]
    message.content = text
    message.streaming = false
    for (let tick = 0; tick < 4; tick++) await Promise.resolve()
    return document.querySelector('.chat-message.assistant .studio-markdown-body')?.textContent
  }, text)
  expect(final?.trim()).toBe(text.trim())
  await expect(page.locator('.chat-message.assistant .studio-markdown-body')).toHaveAttribute('data-output-active', 'false')
})
