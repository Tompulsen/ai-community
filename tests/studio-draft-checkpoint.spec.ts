import { expect, test, type Page } from '@playwright/test'
import { mockUnifiedAccount } from './helpers/account-fixture'

const reference = { name: 'account-17-private.png', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5l8AAAAASUVORK5CYII=' }

async function fixture(page: Page) {
  const account = await mockUnifiedAccount(page, true)
  account.state.user.id = '17'
  const calls: unknown[] = []
  await page.route('**/api/creation/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/creation/models') return route.fulfill({ json: { tokenId: 41, items: [{ id: 'gpt-image-2', kinds: ['image'] }] } })
    if (path === '/api/creation/generate') { calls.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { error: '仅本地模拟，阻止真实生成' } }) }
    return route.fulfill({ json: { items: [] } })
  })
  await page.route('**/__draft-checkpoint-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>Draft checkpoint fixture</body>' }))
  await page.goto('/__draft-checkpoint-test')
  await page.evaluate(async reference => {
    const { writeChatSnapshot } = await import('/shared/studio/chat-persistence.ts')
    const source = { id: 'reference-source', creationKind: 'image', topic: '源参考图对话', messages: [], mediaDrafts: { image: { prompt: '账号17的参考图草稿', model: 'gpt-image-2', references: [reference] } } }
    await writeChatSnapshot('octopus:user-17:native-chat', { version: 1, state: { sessions: [source], activeId: source.id, mediaConversationsMigrated: true, _hasHydrated: true } })
    await writeChatSnapshot('octopus:user-18:native-chat', { version: 1, state: { sessions: [{ id: 'account-18-empty', creationKind: 'text', topic: '账号18空对话', messages: [] }], activeId: 'account-18-empty', mediaConversationsMigrated: true, _hasHydrated: true } })
    localStorage.setItem('octopus:user-17:native-creation-draft:image', JSON.stringify({ prompt: '账号17的参考图草稿', model: 'gpt-image-2', referenceConversationId: source.id }))
    localStorage.setItem('octopus:user-18:native-creation-draft:image', JSON.stringify({ prompt: '账号18自己的提示词', model: 'gpt-image-2', referenceConversationId: source.id }))
  }, reference)
  return { account, calls }
}

test('a checkpoint restores references into an empty conversation while its source still exists', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.evaluate(async () => {
    const { readChatSnapshot, writeChatSnapshot } = await import('/shared/studio/chat-persistence.ts')
    const snapshot = await readChatSnapshot('octopus:user-17:native-chat')
    snapshot!.state.sessions.unshift({ id: 'empty-target', creationKind: 'text', topic: '空对话', messages: [] })
    snapshot!.state.activeId = 'empty-target'
    await writeChatSnapshot('octopus:user-17:native-chat', snapshot!)
  })
  await page.goto('/create/image')
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('账号17的参考图草稿')
  await expect(page.getByRole('form', { name: '创作参数', exact: true }).getByRole('button', { name: /^预览参考图 / })).toHaveCount(1)
  expect(calls).toHaveLength(0)
})

test('deleting the source conversation cannot revive its reference files from the local checkpoint', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/create/image')
  const composer = page.getByRole('form', { name: '创作参数', exact: true })
  await expect(composer.getByRole('button', { name: /^预览参考图 / })).toHaveCount(1)
  await page.evaluate(async () => {
    const resource = performance.getEntriesByType('resource').map(item => item.name).filter(name => /\/src\/native-chat\.ts(?:\?|$)/.test(name)).at(-1)!
    const { chats, removeChat, flushChats } = await import(resource)
    await removeChat(chats.sessions.find(chat => chat.id === 'reference-source'))
    await flushChats()
  })
  await expect(composer.getByRole('button', { name: /^预览参考图 / })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('账号17的参考图草稿')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('账号17的参考图草稿')
  await expect(composer.getByRole('button', { name: /^预览参考图 / })).toHaveCount(0)
  expect(calls).toHaveLength(0)
})

test('switching accounts resolves checkpoint references only inside the new account conversations', async ({ page }) => {
  const { account, calls } = await fixture(page)
  await page.goto('/create/image')
  const composer = page.getByRole('form', { name: '创作参数', exact: true })
  await expect(composer.getByRole('button', { name: /^预览参考图 / })).toHaveCount(1)
  account.state.user.id = '18'; account.state.user.accountId = '18'
  await page.evaluate(async user => {
    const resource = performance.getEntriesByType('resource').map(item => item.name).filter(name => /\/src\/state\.ts(?:\?|$)/.test(name)).at(-1)!
    const { session } = await import(resource)
    session.user = user
  }, account.state.user)
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('账号18自己的提示词')
  await expect(composer.getByRole('button', { name: /^预览参考图 / })).toHaveCount(0)
  const preserved = await page.evaluate(async () => {
    const { readChatSnapshot } = await import('/shared/studio/chat-persistence.ts')
    const previous = await readChatSnapshot('octopus:user-17:native-chat')
    const current = await readChatSnapshot('octopus:user-18:native-chat')
    return { previous: previous?.state.sessions[0]?.mediaDrafts?.image?.references, current: current?.state.sessions.flatMap(chat => chat.mediaDrafts?.image?.references || []) }
  })
  expect(preserved.previous).toEqual([reference])
  expect(preserved.current).toEqual([])
  expect(calls).toHaveLength(0)
})
