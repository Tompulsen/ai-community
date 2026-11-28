import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const calls: unknown[] = []
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/models')) return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-5', kinds: ['text'] }] } })
    if (path.endsWith('/skills/catalog')) return route.fulfill({ json: { items: [] } })
    if (path.endsWith('/mcp/status')) return route.fulfill({ json: { enabled: false, items: [] } })
    if (path.endsWith('/generate')) {
      calls.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: 'succeeded', outputs: [{ text: 'Completed answer' }], tokenId: 41, protocol: 'sync' } })
    }
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto('/community')
  await page.evaluate(() => {
    localStorage.setItem('octopus:user-17:native-chat', JSON.stringify({ version: 1, state: {
      _hasHydrated: true, activeId: 'draft-recovery', sessions: [{
        id: 'draft-recovery', topic: 'Persisted conversation', model: 'gpt-5', settings: {},
        skillIds: [], search: 'off', draft: 'Old unsent draft',
        messages: [{ id: 'question', role: 'user', content: 'Existing question', createdAt: Date.now() }],
      }],
    } }))
  })
  await page.goto('/create/text')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('Old unsent draft')
  return calls
}

test('a newly created conversation keeps its last input across an immediate reload', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '新对话', exact: true }).first().click()
  const input = page.getByRole('textbox', { name: '消息', exact: true })
  await expect(input).toHaveValue('')
  await input.fill('Last input in the new conversation')
  await page.reload()
  await expect(input).toHaveValue('Last input in the new conversation')
})

test('clearing a saved draft and immediately reloading never restores its previous text', async ({ page }) => {
  await fixture(page)
  const input = page.getByRole('textbox', { name: '消息', exact: true })
  await input.fill('')
  await page.reload()
  await expect(input).toHaveValue('')
  await expect(page.locator('.chat-message.user .user-text')).toHaveText('Existing question')
})

test('sending and reloading does not restore a sent draft or submit it again', async ({ page }) => {
  const calls = await fixture(page)
  const input = page.getByRole('textbox', { name: '消息', exact: true })
  await input.fill('Sent once')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => calls.length).toBe(1)
  await page.reload()
  await expect(input).toHaveValue('')
  await expect(page.locator('.chat-message.user .user-text').last()).toHaveText('Sent once')
  expect(calls).toHaveLength(1)
})

async function holdHistoryWrites(page: Page, addConversation = false) {
  await page.evaluate(async addConversation => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name)
    const chatPath = resources.find(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name))!
    const storagePath = resources.find(name => /\/shared\/studio\/indexedDB-storage\.ts(?:\?|$)/.test(name))!
    const { chats, createEmptyChat, flushChats, saveChats } = await import(/* @vite-ignore */ chatPath)
    if (addConversation) {
      const second = createEmptyChat()
      second.id = 'second-saved'; second.topic = 'Second saved conversation'
      chats.sessions.push(second)
      await saveChats(true)
    }
    await flushChats()
    const { indexedDBStorage } = await import(/* @vite-ignore */ storagePath)
    indexedDBStorage.setItemWithAssets = () => new Promise(() => {})
  }, addConversation)
}

test('the latest input survives reload even while history storage cannot finish', async ({ page }) => {
  await fixture(page)
  await holdHistoryWrites(page)
  const input = page.getByRole('textbox', { name: '消息', exact: true })
  await input.fill('Draft kept while IndexedDB is pending')
  await page.reload()
  await expect(input).toHaveValue('Draft kept while IndexedDB is pending')
})

test('switching conversations during a pending write keeps both drafts after reload', async ({ page }) => {
  await fixture(page)
  await holdHistoryWrites(page, true)
  const input = page.getByRole('textbox', { name: '消息', exact: true })
  await input.fill('First conversation draft')
  await page.locator('.studio-sidebar').getByRole('button', { name: 'Second saved conversation', exact: true }).click()
  await expect(input).toHaveValue('')
  await input.fill('Second conversation draft')
  await page.reload()
  await page.locator('.studio-sidebar').getByRole('button', { name: 'Second saved conversation', exact: true }).click()
  await expect(input).toHaveValue('Second conversation draft')
  await page.locator('.studio-sidebar').getByRole('button', { name: 'Persisted conversation', exact: true }).click()
  await expect(input).toHaveValue('First conversation draft')
})

for (const kind of ['text', 'image'] as const) {
  test(`a failed initial ${kind} conversation save offers a usable retry before accepting input`, async ({ page }) => {
    await fixture(page)
    if (kind === 'image') await page.goto('/create/image')
    await expect(page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const resources = performance.getEntriesByType('resource').map(entry => entry.name)
      const chatPath = resources.find(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name))!
      const storagePath = resources.find(name => /\/shared\/studio\/indexedDB-storage\.ts(?:\?|$)/.test(name))!
      const { flushChats } = await import(/* @vite-ignore */ chatPath)
      await flushChats()
      const { indexedDBStorage } = await import(/* @vite-ignore */ storagePath)
      const write = indexedDBStorage.setItemWithAssets
      ;(window as any).__restoreDraftWrites = () => { indexedDBStorage.setItemWithAssets = write }
      indexedDBStorage.setItemWithAssets = async () => { throw new Error('Fixture storage unavailable') }
    })
    await page.getByRole('button', { name: '新对话', exact: true }).first().click()
    const input = page.getByRole('textbox', { name: kind === 'text' ? '消息' : '提示词', exact: true })
    await expect(input).toBeDisabled()
    const retry = page.getByRole('button', { name: '重试保存', exact: true })
    await expect(retry).toBeVisible()
    await expect(retry).toBeEnabled()
    await page.evaluate(() => (window as any).__restoreDraftWrites())
    await retry.click()
    await expect(input).toBeEnabled()
    await input.fill('Input after storage recovery')
    await expect(input).toHaveValue('Input after storage recovery')
  })
}
