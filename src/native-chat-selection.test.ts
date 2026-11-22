import { beforeEach, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({ write: vi.fn(async () => {}) }))
vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null as any }), errorMessage: (error: Error) => error.message }
})
vi.mock('./native-studio', () => ({
  creation: { tasks: [] }, resumeCreation: vi.fn(), stopCreation: vi.fn(), submitCreation: vi.fn(),
}))
vi.mock('./model-preferences', () => ({ modelFormat: () => undefined, configuredModelFormat: () => undefined }))
vi.mock('../shared/studio/chat-persistence', () => ({ readChatSnapshot: vi.fn(), writeChatSnapshot: storage.write }))
beforeEach(() => { vi.resetModules(); storage.write.mockReset().mockResolvedValue(undefined) })
async function fixture(activeId = 'b') {
  const { session } = await import('./state')
  const chat = await import('./native-chat')
  session.user = { id: '17' } as any
  chat.chats.ready = true
  const entries = ['a', 'b', 'c', 'd'].map(id => ({ id, topic: id, messages: [], draft: `draft-${id}`, settings: {}, skillIds: [] })) as any
  chat.chats.sessions = entries; chat.chats.activeId = activeId
  return { ...chat, session }
}
it('removes selected IDs in one save and preserves the active chat and untouched drafts', async () => {
  const p = await fixture()
  await p.removeChats(['a', 'c', 'c', 'unknown'])
  expect(p.chats.sessions.map(chat => chat.id)).toEqual(['b', 'd'])
  expect(p.chats.activeId).toBe('b')
  expect(p.chats.sessions[0]!.draft).toBe('draft-b')
  expect(storage.write).toHaveBeenCalledTimes(1)
  expect(storage.write.mock.calls[0]).toMatchObject(['octopus:user-17:native-chat', { state: { activeId: 'b' } }])
})
it('chooses the neighboring remaining chat after removing the active chat', async () => {
  const p = await fixture()
  await p.removeChats(['b', 'c'])
  expect(p.chats.activeId).toBe('d')
  await p.removeChat(p.chats.sessions.find(chat => chat.id === 'd')!)
  expect(p.chats.activeId).toBe('a')
})
it('creates one empty chat and persists once when all chats are deleted', async () => {
  const p = await fixture()
  await p.removeChats(['a', 'b', 'c', 'd'])
  expect(p.chats.sessions).toHaveLength(1)
  expect(p.chats.sessions[0]).toMatchObject({ topic: '新对话', messages: [], memoryPrompt: '' })
  expect(p.chats.activeId).toBe(p.chats.sessions[0]!.id)
  expect(storage.write).toHaveBeenCalledTimes(1)
})
it('rejects a selection containing a running chat without partially deleting or saving', async () => {
  const p = await fixture()
  p.chats.busy.c = true
  await expect(p.removeChats(['a', 'c'])).rejects.toThrow('请先停止')
  expect(p.chats.sessions.map(chat => chat.id)).toEqual(['a', 'b', 'c', 'd'])
  expect(storage.write).not.toHaveBeenCalled()
  await p.removeChats(['unknown'])
  expect(storage.write).not.toHaveBeenCalled()
})
it('restores the original chats when persistence fails', async () => {
  const p = await fixture()
  storage.write.mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(p.removeChats(['a', 'b'])).rejects.toThrow()
  expect(p.chats.sessions.map(chat => chat.id)).toEqual(['a', 'b', 'c', 'd'])
  expect(p.chats.activeId).toBe('b')
})
it('cannot restore a previous account snapshot after an identity change during a failed save', async () => {
  const p = await fixture()
  let reject!: (error: Error) => void
  storage.write.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail }))
  const deleting = p.removeChats(['a'])
  await vi.waitFor(() => expect(storage.write).toHaveBeenCalled())
  p.session.user = { id: '18' } as any
  reject(new Error('storage unavailable'))
  await expect(deleting).rejects.toThrow()
  expect(p.chats.sessions).toEqual([])
  expect(p.chats.activeId).toBe('')
  expect(p.chats.error).toBe('')
})
