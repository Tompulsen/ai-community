import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const turns = 160

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    return route.fulfill({ json: { status: 'succeeded', outputs: [{ text: 'Fixture response' }], tokenId: 41, protocol: 'sync' } })
  })
  await page.addInitScript(({ turns }) => {
    performance.setResourceTimingBufferSize(3000)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { (window as any).__longCopied = text },
    } })
    if (sessionStorage.getItem('long-history-fixture')) return
    sessionStorage.setItem('long-history-fixture', '1')
    const messages = Array.from({ length: turns }, (_, index) => [
      { id: `user-${index}`, role: 'user', branchOrder: index * 2, content: `History question ${index}: inspect earlier messages and preserve my reading position.`, createdAt: Date.now() - (turns - index) * 2000 },
      { id: `answer-${index}`, role: 'assistant', content: [
        `## History answer ${index}`,
        ...Array.from({ length: 4 }, (_, paragraph) => `Paragraph ${paragraph}. ` + 'This complete record remains searchable, selectable, and copyable while a later response streams. '.repeat(6)),
        '| Column | Value |\n| --- | --- |\n| First | 123 |\n| Second | 456 |',
        '```javascript\n' + Array.from({ length: 8 }, (_, line) => `const history${index}line${line} = ${line};`).join('\n') + '\n```',
      ].join('\n\n'), branchOrder: index * 2 + 1, createdAt: Date.now() - (turns - index) * 2000 + 1000 },
    ]).flat()
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'long-history', sessions: [
        { id: 'long-history', topic: 'Long history', model: 'gpt-5', settings: {}, skillIds: [], search: 'off', messages, lastUpdate: Date.now(),
          messageBranches: [{ id: 'first-alternate', role: 'assistant', parentId: 'user-0', branchOrder: 100000, content: 'Alternate first answer' }] },
        { id: 'short-history', topic: 'Other history', model: 'gpt-5', settings: {}, skillIds: [], search: 'off', messages: [{ id: 'other-answer', role: 'assistant', content: 'Other conversation content' }], lastUpdate: Date.now() - 1000000 },
      ],
    } }))
  }, { turns })
  await page.goto('/create/text')
  await expect(page.locator('.chat-message')).toHaveCount(turns * 2, { timeout: 15_000 })
  await expect(page.locator('.studio-markdown-body')).toHaveCount(turns)
  await expect(page.locator('.chat-message').last().locator('.studio-code-block code')).toContainText(`history${turns - 1}line7`)
  await expect.poll(() => page.locator('.chat-messages').evaluate(element => Math.round(element.scrollHeight - element.scrollTop - element.clientHeight))).toBeLessThanOrEqual(2)
  return account
}

async function liveChat(page: Page) {
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!
    const { chats } = await import(/* @vite-ignore */ path)
    ;(window as any).__longChats = chats
    ;(window as any).__longChat = chats.sessions.find((chat: any) => chat.id === 'long-history')
  })
}

async function layoutCost(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const before = (await cdp.send('Performance.getMetrics')).metrics
  await page.locator('.chat-transcript').evaluate(async element => {
    for (let index = 0; index < 18; index++) {
      ;(element as HTMLElement).style.width = index % 2 ? '100%' : '93%'
      await new Promise(requestAnimationFrame)
      void element.scrollHeight
    }
    ;(element as HTMLElement).style.width = ''
    await new Promise(requestAnimationFrame)
  })
  const after = (await cdp.send('Performance.getMetrics')).metrics
  await cdp.detach()
  const delta = (name: string) => ((after.find(item => item.name === name)?.value || 0) - (before.find(item => item.name === name)?.value || 0)) * 1000
  return { layout: delta('LayoutDuration'), styles: delta('RecalcStyleDuration'), scripts: delta('ScriptDuration') }
}

test('long conversations skip offscreen layout while keeping all original messages in the document', async ({ page }) => {
  await fixture(page)
  const optimized = await layoutCost(page)
  const skipped = await page.locator('.chat-message .message-heading').evaluateAll(headings => headings.filter(heading => !heading.checkVisibility({ contentVisibilityAuto: true })).length)
  await page.addStyleTag({ content: '.chat-transcript > .chat-message { content-visibility: visible !important; contain-intrinsic-block-size: none !important; }' })
  const eager = await layoutCost(page)
  console.log(JSON.stringify({ longHistory: { messages: turns * 2, skipped, optimized, eager } }))
  expect(skipped).toBeGreaterThan(turns)
  expect(optimized.layout).toBeLessThan(eager.layout * 0.75)
  expect(await page.locator('.chat-transcript').textContent()).toContain('history0line0')
  expect(await page.locator('.chat-transcript').textContent()).toContain(`history${turns - 1}line7`)
})

test('native find, whole-history selection and old message copying reach offscreen text', async ({ page }) => {
  await fixture(page)
  const found = await page.evaluate(() => {
    getSelection()?.removeAllRanges()
    return (window as any).find('History answer 0', false, false, true)
  })
  expect(found).toBe(true)
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('History answer 0')
  const first = page.locator('[data-message-id="answer-0"]')
  await expect.poll(() => first.locator('.message-heading').evaluate(element => element.checkVisibility({ contentVisibilityAuto: true }))).toBe(true)
  await first.scrollIntoViewIfNeeded()
  await first.hover()
  await first.getByRole('button', { name: '复制回答', exact: true }).click()
  const copied = await page.evaluate(() => (window as any).__longCopied as string)
  expect(copied).toContain('## History answer 0')
  expect(copied).toContain('const history0line7 = 7;')
  const complete = await page.locator('.chat-transcript').evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    getSelection()?.removeAllRanges(); getSelection()?.addRange(range)
    const selected = getSelection()?.toString() || ''
    return { first: selected.includes('History question 0:'), last: selected.includes('history159line7') }
  })
  expect(complete).toEqual({ first: true, last: true })
})

test('keyboard traversal crosses deferred messages and old edits and branches stay available', async ({ page }) => {
  test.setTimeout(45_000)
  await fixture(page)
  const first = page.locator('[data-message-id="answer-0"]')
  await first.getByRole('button', { name: '下一个分支', exact: true }).focus()
  for (let step = 0; step < 120; step++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate(() => Number(document.activeElement?.closest<HTMLElement>('[data-message-id]')?.dataset.messageId?.split('-')[1]) > 8)) break
  }
  const active = await page.evaluate(() => document.activeElement?.closest<HTMLElement>('[data-message-id]')?.dataset.messageId)
  expect(Number(active?.split('-')[1])).toBeGreaterThan(8)
  await first.getByRole('button', { name: '编辑回答', exact: true }).click()
  const editor = page.getByRole('form', { name: '编辑消息', exact: true })
  await expect(editor.getByRole('textbox', { name: '消息内容', exact: true })).toBeFocused()
  await expect(first).not.toHaveClass(/history-deferred/)
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await first.getByRole('button', { name: '下一个分支', exact: true }).click()
  await expect(page.locator('.chat-message')).toHaveCount(2)
  await expect(page.locator('[data-message-id="first-alternate"]')).toContainText('Alternate first answer')
  await page.getByRole('button', { name: '上一个分支', exact: true }).click()
  await expect(page.locator('.chat-message')).toHaveCount(turns * 2)
  await expect(page.locator('[data-message-id="answer-159"]')).toContainText('history159line7')
})

test('long-history streaming preserves an older reading anchor and keeps the latest answer and return navigation intact', async ({ page }) => {
  test.setTimeout(45_000)
  await fixture(page)
  await liveChat(page)
  const messages = page.locator('.chat-messages'), anchor = page.locator('[data-message-id="user-100"]')
  await anchor.scrollIntoViewIfNeeded()
  await messages.evaluate(element => element.dispatchEvent(new Event('scroll')))
  const top = await anchor.evaluate(element => element.getBoundingClientRect().top)
  await page.evaluate(() => {
    const chat = (window as any).__longChat
    ;(window as any).__longChats.busy[chat.id] = true
    chat.messages.at(-1).streaming = true
    chat.messages.at(-1).content += '\n\nStreaming while an old message is being read.\n\n'.repeat(15)
  })
  await expect(page.locator('[data-message-id="answer-159"] .studio-markdown-body')).toContainText('Streaming while an old message is being read.')
  expect(Math.abs(await anchor.evaluate(element => element.getBoundingClientRect().top) - top)).toBeLessThanOrEqual(2)
  await page.getByRole('button', { name: '回到最新消息', exact: true }).click()
  await page.evaluate(() => { (window as any).__longChat.messages.at(-1).content += '\n\nLast live packet' })
  await expect(page.locator('[data-message-id="answer-159"] .studio-markdown-body')).toContainText('Last live packet')
  await expect.poll(() => messages.evaluate(element => Math.round(element.scrollHeight - element.scrollTop - element.clientHeight))).toBeLessThanOrEqual(2)
  await page.evaluate(() => {
    ;(window as any).__longChat.messages.at(-1).streaming = false
    ;(window as any).__longChats.busy['long-history'] = false
  })
  await page.locator('.studio-sidebar').getByRole('button', { name: 'Other history', exact: true }).click()
  await expect(page.locator('.chat-message')).toHaveCount(1)
  await expect(page.locator('.chat-message')).not.toHaveClass(/history-deferred/)
  await page.locator('.studio-sidebar').getByRole('button', { name: 'Long history', exact: true }).click()
  await expect(page.locator('.chat-message')).toHaveCount(turns * 2)
  await expect.poll(() => messages.evaluate(element => Math.round(element.scrollHeight - element.scrollTop - element.clientHeight))).toBeLessThanOrEqual(2)
  await page.setViewportSize({ width: 390, height: 900 })
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('Draft remains responsive')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('Draft remains responsive')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('Draft remains responsive')
  await expect(page.locator('[data-message-id="answer-159"] .studio-markdown-body')).toContainText('Last live packet')
})
