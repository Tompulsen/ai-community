import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import 'vue'

const storage = vi.hoisted(() => ({ values: new Map<string, unknown>(), get: vi.fn(), write: vi.fn(), copied: [] as string[] }))
vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null as any }), api: vi.fn(), errorMessage: (error: Error) => error.message }
})
vi.mock('./native-studio', () => ({ creation: { tasks: [] }, resumeCreation: vi.fn(), stopCreation: vi.fn(), submitCreation: vi.fn() }))
vi.mock('./model-preferences', () => ({ modelFormat: () => undefined, configuredModelFormat: () => undefined }))
vi.mock('../shared/studio/studio-keyval', () => ({
  get: storage.get,
  studioStore: (_mode: string, action: (store: unknown) => unknown) => {
    const writes = new Map<string, unknown>()
    let pending = 0, aborted = false
    const transaction: any = { abort: () => { aborted = true; queueMicrotask(() => transaction.onabort?.()) } }
    const store = {
      transaction,
      get(key: string) {
        const request: any = {}; pending++
        queueMicrotask(() => {
          if (aborted) return
          storage.copied.push(key); request.result = storage.values.get(key); request.onsuccess?.(); pending--
          if (!pending && !aborted) { for (const [key, value] of writes) storage.values.set(key, value); transaction.oncomplete?.() }
        })
        return request
      },
      put(value: unknown, key: string) { writes.set(key, value) },
    }
    return action(store)
  },
}))
vi.mock('../shared/studio/indexedDB-storage', () => ({ indexedDBStorage: {
  getItem: async (key: string) => storage.values.get(key) || null,
  setItemWithAssets: storage.write,
} }))

const key = 'octopus:user-17:native-chat'
const reference = (id: string) => ({ __octopusChatAsset: id })
const payload = (label: string) => `data:image/png;base64,${label.repeat(70000)}`
function seed(name = key, activeId = 'one') {
  const source = {
    version: 1, __octopusChatAssets: { format: 'octopus-chat-assets-v1', ids: ['a', 'b'] },
    state: { _hasHydrated: true, activeId, mediaConversationsMigrated: true, sessions: [
      { id: 'one', topic: 'First', messages: [{ id: 'm1', role: 'user', content: [{ type: 'image_url', image_url: { url: reference('a') } }] }] },
      { id: 'two', topic: 'Second', messages: [{ id: 'm2', role: 'assistant', content: reference('b') }] },
    ] },
  }
  storage.values.set(name, JSON.stringify(source))
  storage.values.set(`${name}:asset:a`, payload('A')); storage.values.set(`${name}:asset:b`, payload('B'))
  return source
}
async function open() {
  const { session } = await import('./state'), logic = await import('./native-chat')
  session.user = { id: '17', accountId: '17' } as any
  await logic.loadChats()
  return { ...logic, session, one: logic.chats.sessions[0]!, two: logic.chats.sessions[1]! }
}
beforeEach(() => {
  vi.resetModules(); storage.values.clear(); storage.copied = []
  storage.get.mockReset().mockImplementation(async (name: string) => storage.values.get(name))
  storage.write.mockReset().mockImplementation(async (name: string, raw: string, assets: [string, unknown][], references: (raw?: string) => string[], retained: string[]) => {
    if (retained.some(key => !storage.values.has(key))) throw new Error('missing retained attachment')
    const keep = new Set([...retained, ...assets.map(([key]) => key)])
    for (const key of references(storage.values.get(name) as string | undefined)) if (!keep.has(key)) storage.values.delete(key)
    for (const [key, value] of assets) storage.values.set(key, value)
    storage.values.set(name, raw)
  })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('loads conversation metadata without reading any current or inactive attachment', async () => {
  seed(); const p = await open()
  expect(storage.get).not.toHaveBeenCalled()
  expect(p.chats.ready).toBe(true); expect(p.chatAssetsReady(p.one)).toBe(false)
  expect(p.one.messages[0]!.content).toEqual([{ type: 'image_url', image_url: { url: reference('a') } }])
})

it('restores only the requested conversation, releases inactive clean payloads, and can reopen them', async () => {
  seed(); const p = await open()
  await p.ensureChatAssets(p.one)
  expect(storage.get.mock.calls.map(call => call[0])).toEqual([`${key}:asset:a`])
  expect(p.chatAssetsReady(p.one)).toBe(true); expect(p.chatAssetsReady(p.two)).toBe(false)
  p.chats.activeId = 'two'; p.releaseInactiveChatAssets()
  expect(p.chatAssetsReady(p.one)).toBe(false)
  await p.ensureChatAssets(p.two)
  p.chats.activeId = 'one'; p.releaseInactiveChatAssets(); await p.ensureChatAssets(p.one)
  expect(p.one.messages[0]!.content).toEqual([{ type: 'image_url', image_url: { url: payload('A') } }])
  expect(p.chatAssetsReady(p.two)).toBe(false)
})

it('preserves draft and generating conversations when releasing inactive payloads', async () => {
  seed(); const p = await open(); await p.ensureChatAssets(p.one)
  p.one.draft = 'unsent'; p.releaseInactiveChatAssets('two')
  expect(p.chatAssetsReady(p.one)).toBe(true)
  p.one.draft = ''; p.chats.busy.one = true; p.releaseInactiveChatAssets('two')
  expect(p.chatAssetsReady(p.one)).toBe(true)
  p.chats.busy.one = false; p.releaseInactiveChatAssets('two')
  expect(p.chatAssetsReady(p.one)).toBe(false)
})

it('saves metadata changes while retaining unread attachment references and original bytes', async () => {
  seed(); const p = await open(); p.one.topic = 'Renamed'
  await p.saveChats(true)
  expect(storage.get).not.toHaveBeenCalled()
  expect(storage.values.get(`${key}:asset:a`)).toBe(payload('A'))
  expect(storage.values.get(`${key}:asset:b`)).toBe(payload('B'))
  expect(storage.write.mock.calls[0]![4]).toEqual([`${key}:asset:a`, `${key}:asset:b`])
  const { readChatSnapshot } = await import('../shared/studio/chat-persistence')
  const reopened = await readChatSnapshot(key)
  expect(reopened!.state.sessions[0].topic).toBe('Renamed')
  expect(reopened!.state.sessions[1].messages[0].content).toBe(payload('B'))
})

it('does not apply a late attachment read after switching accounts', async () => {
  seed(); const p = await open(); let finish!: (value: string) => void
  storage.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const reading = p.ensureChatAssets(p.one)
  p.session.user = { id: '18', accountId: '18' } as any
  finish(payload('A'))
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
  expect(p.chats.sessions).toEqual([]); expect(p.chatAssetsReady(p.one)).toBe(false)
})

it('cancelled conversation loads do not restore a conversation after it is left', async () => {
  seed(); const p = await open(); let finish!: (value: string) => void
  storage.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const reading = p.ensureChatAssets(p.one)
  p.chats.activeId = 'two'; p.releaseInactiveChatAssets()
  finish(payload('A'))
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
  expect(p.chatAssetsReady(p.one)).toBe(false)
})

it('retains unread data after a missing attachment and allows a later retry', async () => {
  seed(); const p = await open(); storage.values.delete(`${key}:asset:a`)
  await expect(p.ensureChatAssets(p.one)).rejects.toThrow('原始记录已保留')
  expect(p.chatAssetsReady(p.one)).toBe(false); expect(p.chats.assetsLoading.one).toBeUndefined()
  expect(storage.write).not.toHaveBeenCalled()
  storage.values.set(`${key}:asset:a`, payload('A'))
  await p.ensureChatAssets(p.one); expect(p.chatAssetsReady(p.one)).toBe(true)
})

it('shares at most two simultaneous attachment reads across conversation requests', async () => {
  const { loadChatSessionAssets } = await import('../shared/studio/chat-assets')
  let active = 0, maximum = 0
  storage.get.mockImplementation(async (name: string) => {
    active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 2)); active--
    return name
  })
  await Promise.all([1, 2, 3].map(index => loadChatSessionAssets(key, [reference(`${index}a`), reference(`${index}b`), reference(`${index}c`)])))
  expect(maximum).toBe(2); expect(storage.get).toHaveBeenCalledTimes(9)
})

it('uses activeId when deferring only inactive attachments in native version-one snapshots', async () => {
  seed(key, 'two')
  const { readChatSnapshot } = await import('../shared/studio/chat-persistence')
  const value = await readChatSnapshot(key, { deferInactiveSessions: true })
  expect(storage.get.mock.calls.map(call => call[0])).toEqual([`${key}:asset:b`])
  expect(value!.state.sessions[1].messages[0].content).toBe(payload('B'))
})

it('migrates legacy attachment keys without loading the payload set into the conversation', async () => {
  const legacy = 'octopus:user-17:chat-next-web-store'; seed(legacy)
  const p = await open(); expect(storage.get).not.toHaveBeenCalled()
  await p.saveChats(true)
  expect(storage.copied).toEqual([`${legacy}:asset:a`, `${legacy}:asset:b`])
  expect(storage.get).not.toHaveBeenCalled()
  expect(storage.values.get(`${legacy}:asset:a`)).toBe(payload('A'))
  expect(storage.values.get(`${key}:asset:a`)).toBe(payload('A'))
  await p.ensureChatAssets(p.one)
  expect(storage.get).toHaveBeenCalledWith(`${key}:asset:a`)
})

it('keeps the old snapshot and copied keys unchanged when legacy migration cannot read a reference', async () => {
  const legacy = 'octopus:user-17:chat-next-web-store'; seed(legacy); const before = storage.values.get(legacy)
  storage.values.delete(`${legacy}:asset:b`)
  const p = await open()
  await expect(p.saveChats(true)).rejects.toThrow('原数据已保留')
  expect(storage.values.get(legacy)).toBe(before)
  expect(storage.values.has(key)).toBe(false); expect(storage.values.has(`${key}:asset:a`)).toBe(false)
})

it('structure snapshots avoid JSON serialization and retain immutable attachment strings', async () => {
  const { cloneChatValue } = await import('../shared/studio/chat-assets')
  const source = { value: payload('A'), messages: [{ text: 'first' }] }, stringify = vi.spyOn(JSON, 'stringify')
  const copy = cloneChatValue(source)
  source.messages[0]!.text = 'second'
  expect(copy.messages[0]!.text).toBe('first'); expect(copy.value).toBe(source.value)
  expect(stringify).not.toHaveBeenCalled()
})

it('retains unread attachments while deleting and undoing a conversation', async () => {
  seed(); const p = await open()
  await p.removeChats(['one'])
  expect(p.chats.sessions.map(chat => chat.id)).toEqual(['two'])
  expect(storage.values.get(`${key}:asset:a`)).toBe(payload('A'))
  expect(storage.get).not.toHaveBeenCalled()
  await p.undoRemovedChats()
  const restored = p.chats.sessions.find(chat => chat.id === 'one')!
  expect(restored).toBe(p.one)
  await p.ensureChatAssets(restored)
  expect(p.chatAssetsReady(restored)).toBe(true)
})

it('can clone an unread conversation and retain shared attachments after the source is deleted', async () => {
  seed(); const p = await open(); p.cloneChat(p.one); await p.flushChats()
  const copy = p.chats.sessions[0]!
  expect(copy.id).not.toBe(p.one.id); expect(storage.get).not.toHaveBeenCalled()
  await p.removeChats(['one']); await p.ensureChatAssets(copy)
  expect(p.chatAssetsReady(copy)).toBe(true)
  expect(copy.messages[0]!.content).toEqual([{ type: 'image_url', image_url: { url: payload('A') } }])
})

it('releases a departed clean conversation after its pending save commits', async () => {
  seed(); const p = await open(); await p.ensureChatAssets(p.one)
  p.one.draft = 'unsent'; await p.saveChats(true)
  p.one.draft = ''
  let finish!: () => void
  const write = storage.write.getMockImplementation()!
  storage.write.mockImplementationOnce(async (...args: unknown[]) => { await new Promise<void>(resolve => { finish = resolve }); await write(...args) })
  const saving = p.saveChats(true)
  p.releaseInactiveChatAssets('')
  expect(p.chatAssetsReady(p.one)).toBe(true)
  finish(); await saving
  expect(p.chatAssetsReady(p.one)).toBe(false)
})

it('notifies storage observers after durable saves and reports final quota failures', async () => {
  seed(); const p = await open(), changed = vi.fn()
  const storageStatus = await import('./browser-storage')
  window.addEventListener(storageStatus.browserStorageChangedEvent, changed)
  await p.saveChats(true)
  expect(changed).toHaveBeenCalledTimes(1)
  storage.write.mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
  await expect(p.saveChats(true)).rejects.toMatchObject({ name: 'QuotaExceededError' })
  expect(storageStatus.browserStorageWriteFailure()).toBe('quota')
  expect(changed).toHaveBeenCalledTimes(2)
})

it('preserves deferred drafts and quoted attachment text until their conversation is opened', async () => {
  const source: any = seed()
  const quote = { messageId: 'm1', role: 'user', text: reference('a') }
  Object.assign(source.state.sessions[0], { draft: reference('a'), draftQuote: quote, mediaDrafts: { image: { prompt: reference('a'), references: [] } } })
  source.state.sessions[0].messages[0].quote = quote
  storage.values.set(key, JSON.stringify(source))
  const p = await open()
  p.releaseInactiveChatAssets('two')
  expect(p.one.draft).toEqual(reference('a')); expect(p.one.draftQuote).toEqual(quote)
  expect(p.one.messages[0]!.quote).toEqual(quote)
  expect(storage.get).not.toHaveBeenCalled()
  await p.saveChats(true); await p.ensureChatAssets(p.one)
  expect(p.one.draft).toBe(payload('A'))
  expect(p.one.draftQuote?.text).toBe(payload('A'))
  expect(p.one.messages[0]!.quote?.text).toBe(payload('A'))
})
