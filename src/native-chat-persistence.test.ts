import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import 'vue'

const storage = vi.hoisted(() => ({ write: vi.fn(async (_key: string, _snapshot: any) => {}), read: vi.fn() }))
vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null as any }), errorMessage: (error: Error) => error.message }
})
vi.mock('./native-studio', () => ({
  creation: { tasks: [] }, resumeCreation: vi.fn(), stopCreation: vi.fn(), submitCreation: vi.fn(),
}))
vi.mock('./model-preferences', () => ({ modelFormat: () => undefined, configuredModelFormat: () => undefined }))
vi.mock('../shared/studio/chat-persistence', () => ({ readChatSnapshot: storage.read, writeChatSnapshot: storage.write }))
let localValues: Map<string, string>

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers()
  storage.write.mockReset().mockResolvedValue(undefined)
  storage.read.mockReset()
  localValues = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => localValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localValues.set(key, value) },
    removeItem: (key: string) => { localValues.delete(key) },
  })
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function fixture() {
  const { session } = await import('./state'), logic = await import('./native-chat')
  session.user = { id: '17' } as any
  logic.chats.ready = true
  logic.chats.sessions = [logic.createEmptyChat()]
  logic.chats.activeId = logic.chats.sessions[0]!.id
  const chat = logic.chats.sessions[0]!
  return { ...logic, session, chat }
}
async function reopen(snapshot: unknown) {
  vi.resetModules()
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  storage.read.mockResolvedValue(snapshot)
  const { session } = await import('./state'), logic = await import('./native-chat')
  session.user = { id: '17' } as any
  await logic.loadChats()
  return logic
}
const checkpointKey = 'octopus:user-17:native-chat:draft-checkpoint'

it('recovers the last media model selection when a reload interrupts its history write', async () => {
  const p = await fixture()
  const references = [{ name: 'reference.png', url: `data:image/png;base64,${'A'.repeat(600000)}` }]
  p.chat.mediaDrafts = { image: { prompt: '', model: 'gpt-image-2', references } }
  await p.saveChats(true)
  const previous = storage.write.mock.calls.at(-1)![1]
  let release!: () => void
  storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  p.chat.mediaDrafts.image = { prompt: 'latest prompt', model: 'image-alias', references }
  const saving = p.saveChats()
  window.dispatchEvent(new Event('pagehide'))
  try {
    expect(localValues.get(checkpointKey)!.length).toBeLessThan(2000)
    const restored = await reopen(previous)
    expect(restored.chats.sessions[0]!.mediaDrafts?.image).toMatchObject({ model: 'image-alias', prompt: 'latest prompt' })
    expect(restored.chats.sessions[0]!.mediaDrafts?.image?.references).toEqual(references)
    await restored.flushChats()
  } finally { release(); await saving }
})

it('coalesces typing before the expensive history snapshot is encoded', async () => {
  const p = await fixture(), encode = vi.fn(() => ({ id: p.chat.id, messages: [], draft: p.chat.draft }))
  Object.assign(p.chat, { toJSON: encode })
  p.chat.draft = 'a'; const first = p.saveChats()
  p.chat.draft = 'ab'; const second = p.saveChats()
  p.chat.draft = 'abc'; const third = p.saveChats()
  expect(encode).not.toHaveBeenCalled()
  expect(storage.write).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(200)
  await Promise.all([first, second, third])
  expect(encode).toHaveBeenCalledTimes(1)
  expect(storage.write).toHaveBeenCalledTimes(1)
  expect(storage.write.mock.calls[0]![1].state.sessions[0].draft).toBe('abc')
})

it('persists a required operation immediately together with the pending draft', async () => {
  const p = await fixture()
  p.chat.draft = 'pending'; const draft = p.saveChats()
  p.chat.draft = 'accepted'; const required = p.saveChats(true)
  expect(storage.write).toHaveBeenCalledTimes(1)
  expect(storage.write.mock.calls[0]![1].state.sessions[0].draft).toBe('accepted')
  await Promise.all([draft, required])
  await vi.advanceTimersByTimeAsync(200)
  expect(storage.write).toHaveBeenCalledTimes(1)
})

it('keeps an in-flight snapshot immutable and immediately writes the latest required state afterward', async () => {
  const p = await fixture()
  let release!: () => void
  storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  p.chat.draft = 'first'; const first = p.saveChats(true)
  p.chat.draft = 'intermediate'; const intermediate = p.saveChats()
  p.chat.draft = 'last'; const last = p.saveChats(true)
  expect(storage.write).toHaveBeenCalledTimes(1)
  expect(storage.write.mock.calls[0]![1].state.sessions[0].draft).toBe('first')
  release()
  await Promise.all([first, intermediate, last])
  expect(storage.write).toHaveBeenCalledTimes(2)
  expect(storage.write.mock.calls[1]![1].state.sessions[0].draft).toBe('last')
})

it('does not delay a required save behind a draft added during its write', async () => {
  const p = await fixture()
  let release!: () => void
  storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  p.chat.draft = 'accepted'; const required = p.saveChats(true)
  p.chat.draft = 'cleared'; const draft = p.saveChats()
  release()
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(storage.write).toHaveBeenCalledTimes(2)
    expect(storage.write.mock.calls[1]![1].state.sessions[0].draft).toBe('cleared')
  } finally {
    await vi.advanceTimersByTimeAsync(200)
    await Promise.all([required, draft])
  }
})

it('flushes the old owner before clearing its state and gives the next owner an independent queue', async () => {
  const p = await fixture()
  p.chat.draft = 'owner 17'; const previous = p.saveChats()
  p.session.user = { id: '18' } as any
  expect(storage.write).toHaveBeenCalledTimes(1)
  expect(storage.write.mock.calls[0]).toMatchObject(['octopus:user-17:native-chat', { state: { sessions: [{ draft: 'owner 17' }] } }])
  expect(p.chats.sessions).toEqual([])
  p.chats.ready = true; p.chats.sessions = [p.createEmptyChat()]
  p.chats.sessions[0]!.draft = 'owner 18'
  await Promise.all([previous, p.saveChats(true)])
  expect(storage.write.mock.calls[1]).toMatchObject(['octopus:user-18:native-chat', { state: { sessions: [{ draft: 'owner 18' }] } }])
})

it('finishes a retired queue before a quick return reads the same account history', async () => {
  const p = await fixture()
  const saved = new Map<string, any>()
  let release!: () => void
  storage.write.mockImplementation(async (key, snapshot) => { saved.set(key, snapshot) })
  storage.write.mockImplementationOnce(async (key, snapshot) => {
    await new Promise<void>(resolve => { release = resolve })
    saved.set(key, snapshot)
  })
  storage.read.mockImplementation(async key => saved.get(key))
  p.chat.draft = 'first'; const first = p.saveChats(true)
  p.chat.draft = 'last'; const last = p.saveChats()
  p.session.user = { id: '18' } as any
  p.session.user = { id: '17' } as any
  const loading = p.loadChats()
  expect(storage.read).not.toHaveBeenCalled()
  release()
  await Promise.all([first, last, loading])
  expect(storage.write).toHaveBeenCalledTimes(2)
  expect(storage.write.mock.calls[1]![1].state.sessions[0].draft).toBe('last')
  expect(storage.read).toHaveBeenCalledWith('octopus:user-17:native-chat')
  expect(p.chats.sessions[0]!.draft).toBe('last')
  expect(p.chats.activeId).toBe(p.chat.id)
})

for (const event of ['pagehide', 'visibilitychange']) {
  it(`starts the final draft write on ${event} without waiting for the timer`, async () => {
    const p = await fixture()
    p.chat.draft = 'last input'; const pending = p.saveChats()
    if (event === 'visibilitychange') Object.assign(document, { visibilityState: 'hidden' })
    const target = event === 'pagehide' ? window : document
    target.dispatchEvent(new Event(event))
    expect(storage.write).toHaveBeenCalledTimes(1)
    expect(storage.write.mock.calls[0]![1].state.sessions[0].draft).toBe('last input')
    await pending
  })
}

it('reports draft storage failures and still rejects required writes', async () => {
  const p = await fixture()
  storage.write.mockRejectedValue(new Error('disk full'))
  const saving = p.saveChats()
  await vi.advanceTimersByTimeAsync(200)
  await saving
  expect(p.chats.error).toContain('对话未能保存')
  await expect(p.saveChats(true)).rejects.toThrow('disk full')
})

it('does not show an old owner write error in the next account', async () => {
  const p = await fixture()
  let reject!: (error: Error) => void
  storage.write.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail }))
  const saving = expect(p.saveChats(true)).rejects.toThrow('disk full')
  p.session.user = { id: '18' } as any
  reject(new Error('disk full'))
  await saving
  expect(p.chats.error).toBe('')
})

it('accepts another required save as soon as the previous queue completes', async () => {
  const p = await fixture()
  await p.saveChats(true).then(() => { p.chat.draft = 'after completion'; return p.saveChats(true) })
  expect(storage.write).toHaveBeenCalledTimes(2)
  expect(storage.write.mock.calls[1]![1].state.sessions[0].draft).toBe('after completion')
})

for (const draft of ['last input', '']) {
  it(`recovers the ${draft ? 'latest' : 'cleared'} draft even when the unload database write has not finished`, async () => {
    const p = await fixture()
    p.chat.draft = 'previous input'
    await p.saveChats(true)
    const durable = storage.write.mock.calls.at(-1)![1]
    let release!: () => void
    storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    p.chat.draft = draft; const saving = p.saveChats()
    window.dispatchEvent(new Event('pagehide'))
    const checkpoint = JSON.parse(localValues.get(checkpointKey)!)
    expect(checkpoint).toMatchObject({ owner: '17', drafts: [{ conversationId: p.chat.id, draft, quote: null }] })
    const restored = await reopen(durable)
    expect(restored.chats.sessions[0]!.draft).toBe(draft)
    release(); await saving
    await restored.saveChats(true)
  })
}

for (const change of ['sent', 'deleted', 'newer draft']) {
  it(`does not replay an old checkpoint after the conversation has a ${change} state`, async () => {
    const p = await fixture()
    p.chat.draft = 'old draft'; const saving = p.saveChats()
    window.dispatchEvent(new Event('pagehide'))
    const stale = localValues.get(checkpointKey)!
    await saving
    if (change === 'deleted') await p.removeChats([p.chat.id])
    else {
      p.chat.draft = change === 'sent' ? '' : 'newer persisted draft'
      if (change === 'sent') p.chat.messages.push({ id: 'sent', role: 'user', content: 'old draft' })
      await p.saveChats(true)
    }
    const durable = storage.write.mock.calls.at(-1)![1]
    localValues.set(checkpointKey, stale)
    const restored = await reopen(durable)
    expect(restored.chats.sessions.find(chat => chat.id === p.chat.id)?.draft).toBe(change === 'deleted' ? undefined : change === 'sent' ? '' : 'newer persisted draft')
    expect(localValues.has(checkpointKey)).toBe(false)
  })
}

it('never restores another owner checkpoint and does not include media bytes in the journal', async () => {
  const p = await fixture()
  p.chat.draft = 'last input'
  p.chat.messages.push({ id: 'history', role: 'assistant', content: 'large history payload' })
  p.chat.draftFiles = [{ name: 'image.png', type: 'image/png', content: 'large attachment payload', size: 24, isText: false }]
  const saving = p.saveChats(); window.dispatchEvent(new Event('pagehide'))
  const raw = localValues.get(checkpointKey)!
  expect(raw).not.toContain('large history payload')
  expect(raw).not.toContain('large attachment payload')
  await saving
  const foreign = JSON.parse(raw)
  foreign.owner = '18'; foreign.drafts[0].draft = 'foreign input'; foreign.drafts[0].updatedAt += 100
  localValues.set(checkpointKey, JSON.stringify(foreign))
  const restored = await reopen(storage.write.mock.calls.at(-1)![1])
  expect(restored.chats.sessions[0]!.draft).toBe('last input')
  expect(localValues.has(checkpointKey)).toBe(false)
})

it('clears mismatched old attachments when only the latest text can be recovered', async () => {
  const p = await fixture()
  p.chat.draftFiles = [{ name: 'old.png', type: 'image/png', content: 'old image', size: 9, isText: false }]
  await p.saveChats(true)
  const durable = storage.write.mock.calls.at(-1)![1]
  let release!: () => void
  storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  p.chat.draft = 'new input'
  p.chat.draftFiles = [{ name: 'new.png', type: 'image/png', content: 'new image', size: 9, isText: false }]
  const saving = p.saveChats(); window.dispatchEvent(new Event('pagehide'))
  const restored = await reopen(durable)
  expect(restored.chats.sessions[0]!.draft).toBe('new input')
  expect(restored.chats.sessions[0]!.draftFiles).toEqual([])
  expect(restored.chats.error).toContain('重新选择')
  release(); await saving
  await restored.saveChats(true)
})

it('does not delete a newer checkpoint when an older snapshot finishes writing', async () => {
  const p = await fixture()
  let releaseFirst!: () => void, releaseLast!: () => void
  storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { releaseFirst = resolve }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { releaseLast = resolve }))
  p.chat.draft = 'first'; const first = p.saveChats(true)
  p.chat.draft = 'last'; const last = p.saveChats()
  window.dispatchEvent(new Event('pagehide'))
  const latest = localValues.get(checkpointKey)
  releaseFirst()
  await vi.advanceTimersByTimeAsync(0)
  expect(localValues.get(checkpointKey)).toBe(latest)
  releaseLast(); await Promise.all([first, last])
  expect(localValues.has(checkpointKey)).toBe(false)
})

it('recovers both dirty conversations after switching while an older snapshot is still writing', async () => {
  const p = await fixture(), second = p.createEmptyChat()
  p.chats.sessions.push(second)
  await p.saveChats(true)
  const durable = storage.write.mock.calls.at(-1)![1]
  let release!: () => void
  storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  p.chat.draft = 'first conversation'; const first = p.saveChats()
  await vi.advanceTimersByTimeAsync(200)
  p.chats.activeId = second.id; p.chats.sessions[1]!.draft = 'second conversation'
  const last = p.saveChats()
  window.dispatchEvent(new Event('pagehide'))
  expect(JSON.parse(localValues.get(checkpointKey)!).drafts).toHaveLength(2)
  const restored = await reopen(durable)
  expect(restored.chats.sessions.map(chat => chat.draft)).toEqual(['first conversation', 'second conversation'])
  release(); await Promise.all([first, last])
  await restored.saveChats(true)
})

it('recovers a legacy conversation whose stored snapshot has no lastUpdate', async () => {
  const legacy = { version: 1, state: { activeId: 'legacy', sessions: [{ id: 'legacy', messages: [], settings: {}, skillIds: [] }] } }
  const p = await reopen(legacy)
  let release!: () => void
  storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  p.chats.sessions[0]!.draft = 'legacy draft'; const saving = p.saveChats()
  window.dispatchEvent(new Event('pagehide'))
  await vi.advanceTimersByTimeAsync(1)
  const restored = await reopen(legacy)
  expect(restored.chats.sessions[0]!.draft).toBe('legacy draft')
  release(); await saving
  await restored.saveChats(true)
})

it('does not overwrite or clear a newer checkpoint that another tab wrote before this snapshot started', async () => {
  const p = await fixture()
  p.chat.draft = 'old local draft'; await p.saveChats(true)
  const foreign = JSON.stringify({ owner: '17', revision: 'other-tab', activeId: p.chat.id, drafts: [{
    conversationId: p.chat.id, updatedAt: p.chat.draftUpdatedAt! + 1000, lastMessageId: '',
    draft: 'new other tab draft', quote: null, filesUpdatedAt: p.chat.draftFilesUpdatedAt, fileCount: 0,
  }] })
  localValues.set(checkpointKey, foreign)
  p.chat.settings.temperature = 0.5
  await p.saveChats(true)
  expect(localValues.get(checkpointKey)).toBe(foreign)
  window.dispatchEvent(new Event('pagehide'))
  expect(localValues.get(checkpointKey)).toBe(foreign)
  const restored = await reopen(storage.write.mock.calls.at(-1)![1])
  expect(restored.chats.sessions[0]!.draft).toBe('new other tab draft')
  await restored.saveChats(true)
})

it('keeps a new conversation marked as saving until its first durable snapshot succeeds', async () => {
  const p = await fixture()
  let release!: () => void
  storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  const created = p.newChat()
  expect(p.chats.initialSaving[created.id]).toBe(true)
  expect(p.conversationBusy(created)).toBe(false)
  release(); await p.flushChats()
  expect(p.chats.initialSaving[created.id]).toBeUndefined()
})

it('retains the initial-save guard on failure and clears it after a successful retry', async () => {
  const p = await fixture()
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  const created = p.newChat()
  await p.flushChats()
  expect(p.chats.initialSaving[created.id]).toBe(true)
  expect(p.chats.error).toContain('对话未能保存')
  await p.saveChats(true)
  expect(p.chats.initialSaving[created.id]).toBeUndefined()
})
