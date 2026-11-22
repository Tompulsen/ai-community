import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CreationTask } from './native-studio'

const storage = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn() }))
vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null as any }), errorMessage: (error: Error) => error.message, api: vi.fn() }
})
vi.mock('./native-studio', async () => {
  const { reactive } = await import('vue')
  return {
    creation: reactive({ tasks: [] as CreationTask[], selectedId: '', loaded: true }),
    resumeCreation: vi.fn(), stopCreation: vi.fn(), submitCreation: vi.fn(),
  }
})
vi.mock('./model-preferences', () => ({ modelFormat: () => undefined }))
vi.mock('../shared/studio/chat-persistence', () => ({ readChatSnapshot: storage.read, writeChatSnapshot: storage.write }))
beforeEach(() => {
  vi.resetModules(); storage.read.mockReset(); storage.write.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())
async function fixture() {
  const { session } = await import('./state')
  const logic = await import('./native-chat')
  const management = await import('./studio-conversations')
  const { creation } = await import('./native-studio')
  session.user = { id: '17' } as any; logic.chats.ready = true
  creation.tasks = []; creation.selectedId = ''; creation.loaded = true
  return { ...logic, ...management, session, creation }
}
function task(id: string, kind: 'image' | 'video' = 'image', conversationId = id, createdAt = 1): CreationTask {
  return {
    id, owner: '17', kind, conversationId, createdAt, settledAt: createdAt + 1, phase: 'complete',
    model: `fixture-${kind}`, prompt: `prompt-${id}`, urls: [`data:image/png;base64,${'A'.repeat(100)}`], text: '',
    references: [], protocol: 'sync', request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 },
  }
}
async function seed() {
  const p = await fixture()
  const text = p.createEmptyChat(); text.id = 'text'; text.topic = '文字会话'; text.lastUpdate = 0; text.draft = '待发送'
  p.chats.sessions.push(text); p.chats.activeId = text.id
  p.creation.tasks.push(task('image-1', 'image', 'image-thread', 1), task('image-2', 'image', 'image-thread', 2), task('video-1', 'video', 'video-thread', 3))
  await p.syncMediaConversations(); storage.write.mockClear()
  return p
}
it('groups legacy image and video tasks into canonical sessions with one pair per turn and no duplicated media bytes', async () => {
  const p = await seed()
  expect(p.chats.sessions.map(p.conversationKind)).toEqual(['video', 'image', 'text'])
  const image = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  expect(image.messages).toHaveLength(4)
  expect(image.messages.map(message => message.taskId)).toEqual(['image-1', 'image-1', 'image-2', 'image-2'])
  expect(JSON.stringify(image)).not.toContain('base64')
  expect(JSON.stringify(image)).not.toContain(p.creation.tasks[0]!.urls[0])
  expect(p.mediaTasksForConversation(image).map(task => task.id)).toEqual(['image-2', 'image-1'])
  await p.syncMediaConversations()
  expect(image.messages).toHaveLength(4); expect(storage.write).not.toHaveBeenCalled()
  p.activateConversation(image.id)
  expect(p.chats.activeId).toBe(image.id); expect(p.creation.selectedId).toBe('image-2')
})
it('only synchronizes after both stores are ready and never imports another account task', async () => {
  const p = await fixture()
  p.creation.tasks.push(task('mine'), { ...task('other'), owner: '18' })
  p.creation.loaded = false; await p.syncMediaConversations(); expect(p.chats.sessions).toEqual([])
  p.creation.loaded = true; p.chats.ready = false; await p.syncMediaConversations(); expect(p.chats.sessions).toEqual([])
  p.chats.ready = true; await p.syncMediaConversations()
  expect(p.chats.sessions).toHaveLength(1); expect(p.chats.sessions[0]!.mediaConversationId).toBe('mine')
})
it('adds subsequent generation turns to the current canonical image conversation without replacing a manual title', async () => {
  const p = await seed(), image = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  await p.renameConversation(image.id, '我的画册')
  p.ensureMediaConversation('image', p.creation.tasks[0])
  const same = p.ensureMediaConversation('image')
  expect(same.id).toBe(image.id)
  p.creation.tasks.push(task('image-3', 'image', 'image-thread', 4))
  await p.syncMediaConversations()
  expect(image.topic).toBe('我的画册'); expect(image.messages).toHaveLength(6)
  expect(p.chats.sessions.filter(chat => p.conversationKind(chat) === 'image')).toHaveLength(1)
})
it('deletes all selected kinds in one save, retains the gallery and uses a neighboring fallback', async () => {
  const p = await seed(), media = p.chats.sessions.filter(chat => p.conversationKind(chat) !== 'text')
  p.chats.activeId = media[0]!.id
  await p.removeChats(media.map(chat => chat.id))
  expect(p.chats.sessions.map(chat => chat.id)).toEqual(['text'])
  expect(p.chats.activeId).toBe('text'); expect(p.creation.tasks).toHaveLength(3)
  expect(p.chats.deletedMediaConversationIds.sort()).toEqual(['image:image-thread', 'video:video-thread'])
  expect(storage.write).toHaveBeenCalledTimes(1)
  await p.syncMediaConversations(); expect(p.chats.sessions).toHaveLength(1)
})
it('persists tombstones so reloading cannot recreate a deleted media conversation', async () => {
  const p = await seed(), image = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  await p.removeChats([image.id])
  const snapshot = storage.write.mock.calls.at(-1)![1]
  p.session.user = { id: '18' } as any; p.session.user = { id: '17' } as any
  storage.read.mockResolvedValue(snapshot)
  await p.loadChats(); await p.syncMediaConversations()
  expect(p.chats.sessions.some(chat => p.conversationKind(chat) === 'image')).toBe(false)
  expect(p.chats.deletedMediaConversationIds).toContain('image:image-thread')
})
it('reopens a deleted media conversation only when the owner explicitly selects its retained gallery item', async () => {
  const p = await seed(), image = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  await p.removeChats([image.id]); await p.syncMediaConversations()
  expect(p.chats.sessions.some(chat => chat.id === image.id)).toBe(false)
  const reopened = p.ensureMediaConversation('image', p.creation.tasks[0])
  expect(reopened.id).toBe(image.id); expect(reopened.messages).toHaveLength(4)
  expect(p.chats.activeId).toBe(image.id); expect(p.chats.deletedMediaConversationIds).toEqual([])
  expect(() => p.ensureMediaConversation('image', { ...p.creation.tasks[0]!, owner: '18' })).toThrow('当前账号')
})
it('undo restores removed kinds and active state without overwriting surviving drafts or newly created sessions', async () => {
  const p = await seed(), image = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  p.chats.activeId = image.id
  await p.removeChats([image.id])
  p.chats.sessions.find(chat => chat.id === 'text')!.draft = '修改后的草稿'
  const added = p.newChat(); added.topic = '删除后新建'; added.draft = '新内容'
  await p.undoRemovedChats()
  expect(p.chats.activeId).toBe(added.id); expect(p.chats.sessions.find(chat => chat.id === added.id)?.draft).toBe('新内容')
  expect(p.chats.sessions.find(chat => chat.id === 'text')?.draft).toBe('修改后的草稿')
  expect(p.chats.sessions.some(chat => chat.id === image.id)).toBe(true)
  expect(p.chats.deletedMediaConversationIds).not.toContain('image:image-thread')
  expect(p.chatDeletion.count).toBe(0)
})
it('undo removes an untouched automatic blank but keeps content typed into that blank', async () => {
  const p = await seed()
  await p.removeChats(p.chats.sessions.map(chat => chat.id))
  expect(p.chats.sessions).toHaveLength(1)
  const blank = p.chats.sessions[0]!
  await p.undoRemovedChats()
  expect(p.chats.sessions).toHaveLength(3); expect(p.chats.sessions.some(chat => chat.id === blank.id)).toBe(false)
  await p.removeChats(p.chats.sessions.map(chat => chat.id))
  p.chats.sessions[0]!.draft = '不能丢失'
  await p.undoRemovedChats()
  expect(p.chats.sessions).toHaveLength(4); expect(p.chats.sessions.some(chat => chat.draft === '不能丢失')).toBe(true)
})
it('expires undo after five seconds and clears it immediately on an account switch', async () => {
  vi.useFakeTimers()
  const p = await seed()
  await p.removeChats(['text']); expect(p.chatDeletion.count).toBe(1)
  await vi.advanceTimersByTimeAsync(5000); await p.undoRemovedChats()
  expect(p.chats.sessions.some(chat => chat.id === 'text')).toBe(false); expect(p.chatDeletion.count).toBe(0)
  await p.removeChats([p.chats.sessions[0]!.id]); expect(p.chatDeletion.count).toBe(1)
  p.session.user = { id: '18' } as any; await p.undoRemovedChats()
  expect(p.chatDeletion.count).toBe(0); expect(p.chats.sessions).toEqual([])
})
it('rejects deletion of running or uncertain media tasks before changing either store', async () => {
  const p = await seed(), image = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  for (const phase of ['submitting', 'running', 'attention'] as const) {
    p.creation.tasks[0]!.phase = phase
    expect(p.conversationGenerating(image)).toBe(phase !== 'attention')
    expect(p.isConversationBusy(image)).toBe(true)
    await expect(p.removeChats([image.id, 'text'])).rejects.toThrow('核对')
    expect(p.chats.sessions).toHaveLength(3)
  }
  expect(storage.write).not.toHaveBeenCalled()
})
it('paused media does not lock the conversation and removing the conversation retains its task', async () => {
  const p = await seed(), image = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  p.creation.tasks[0]!.phase = 'paused'
  expect(p.isConversationBusy(image)).toBe(false)
  await p.removeChats([image.id])
  expect(p.chats.sessions.some(chat => chat.id === image.id)).toBe(false)
  expect(p.creation.tasks).toHaveLength(3)
  expect(p.creation.tasks[0]!.phase).toBe('paused')
})
it('rolls back media deletion and tombstones when its snapshot cannot be saved', async () => {
  const p = await seed(), image = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.removeChats([image.id])).rejects.toThrow('disk full')
  expect(p.chats.sessions.some(chat => chat.id === image.id)).toBe(true)
  expect(p.chats.deletedMediaConversationIds).toEqual([])
})
it('keeps the delete undo available when restoring it fails to save', async () => {
  const p = await seed()
  await p.removeChats(['text'])
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.undoRemovedChats()).rejects.toThrow()
  expect(p.chats.sessions.some(chat => chat.id === 'text')).toBe(false); expect(p.chatDeletion.count).toBe(1)
  await p.undoRemovedChats(); expect(p.chats.sessions.some(chat => chat.id === 'text')).toBe(true)
})
it('moves mixed conversations into a project, preserves object references and unassigns rather than deleting project contents', async () => {
  const p = await seed(), chats = [...p.chats.sessions], projectId = await p.createConversationProject('  海洋  ')
  await p.moveConversations(chats.map(chat => chat.id), projectId)
  expect(p.chats.projects[0]!.name).toBe('海洋')
  expect(p.chats.sessions.every(chat => chat.projectId === projectId)).toBe(true)
  expect(p.chats.sessions.every((chat, index) => chat === chats[index])).toBe(true)
  await p.renameConversationProject(projectId, '海洋创作')
  expect(p.chats.projects[0]!.name).toBe('海洋创作')
  await p.removeConversationProject(projectId)
  expect(p.chats.projects).toEqual([]); expect(p.chats.sessions).toHaveLength(3)
  expect(p.chats.sessions.every(chat => chat.projectId === undefined)).toBe(true)
})
it('reorders within a project in both directions and subsequent synchronization preserves manual order', async () => {
  const p = await seed(), [first, second, third] = p.chats.sessions.map(chat => chat.id)
  await p.reorderConversation(first!, third!); expect(p.chats.sessions.map(chat => chat.id)).toEqual([second, third, first])
  await p.reorderConversation(first!, second!); expect(p.chats.sessions.map(chat => chat.id)).toEqual([first, second, third])
  await p.reorderConversation(first!, third!); await p.syncMediaConversations()
  expect(p.chats.sessions.map(chat => chat.id)).toEqual([second, third, first])
  const project = await p.createConversationProject('分组')
  await p.moveConversations([first!], project)
  await expect(p.reorderConversation(first!, second!)).rejects.toThrow('同一个项目')
})
it('validates names and rolls management changes back after storage failures', async () => {
  const p = await seed(), first = p.chats.sessions[0]!, original = first.topic
  await expect(p.renameConversation(first.id, ' ')).rejects.toThrow('会话名称')
  await expect(p.createConversationProject('x'.repeat(81))).rejects.toThrow('项目名称')
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.renameConversation(first.id, '未保存')).rejects.toThrow()
  expect(first.topic).toBe(original)
  const project = await p.createConversationProject('项目')
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.moveConversations([first.id], project)).rejects.toThrow()
  expect(first.projectId).toBeUndefined()
  const before = p.chats.sessions.map(chat => chat.id)
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.reorderConversation(before[0]!, before[1]!)).rejects.toThrow()
  expect(p.chats.sessions.map(chat => chat.id)).toEqual(before)
})
it('does not restore another account during a failed management write and blocks text while media is preparing', async () => {
  const p = await seed(), image = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  p.chats.preparing[image.id] = true
  expect(await p.sendChat(image, 'wait for registration', [], 'model')).toBe(false)
  p.chats.preparing[image.id] = false
  let fail!: (error: Error) => void
  storage.write.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject }))
  const moving = p.createConversationProject('旧账号项目')
  await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
  p.session.user = { id: '18' } as any; fail(new Error('disk full'))
  await expect(moving).rejects.toThrow()
  expect(p.chats.sessions).toEqual([]); expect(p.chats.projects).toEqual([])
})
it('reuses the active conversation for all modes and never migrates pending tasks into a second session', async () => {
  const p = await fixture(), chat = p.newChat()
  expect(p.ensureMediaConversation('image').id).toBe(chat.id)
  expect(p.ensureMediaConversation('video').id).toBe(chat.id)
  p.creation.tasks.push({ ...task('not-registered', 'image', chat.id), conversationPending: true })
  await p.syncMediaConversations()
  expect(p.chats.sessions).toHaveLength(1)
  expect(chat.messages).toEqual([])
  expect(p.chats.activeId).toBe(chat.id)
})
it('keeps mixed media, archived versions and deletion tombstones in the original text conversation', async () => {
  const p = await fixture(), chat = p.newChat()
  const image = task('mixed-image', 'image', chat.id), video = task('mixed-video', 'video', chat.id, 2)
  p.creation.tasks.push(image, video)
  p.attachMediaTask(chat, image); p.attachMediaTask(chat, video)
  await p.syncMediaConversations()
  expect(p.chats.sessions).toHaveLength(1)
  expect(p.mediaTasksForConversation(chat).map(task => task.id)).toEqual(['mixed-video', 'mixed-image'])
  video.phase = 'running'
  expect(p.isConversationBusy(chat)).toBe(true)
  await expect(p.removeChats([chat.id])).rejects.toThrow('核对')
  video.phase = 'complete'
  await p.removeChats([chat.id])
  expect(p.chats.deletedMediaConversationIds.sort()).toEqual([`image:${chat.id}`, `video:${chat.id}`].sort())
  await p.syncMediaConversations()
  expect(p.chats.sessions).toHaveLength(1)
  expect(p.chats.sessions[0]!.messages).toEqual([])
  await p.undoRemovedChats()
  expect(p.chats.sessions.find(item => item.id === chat.id)?.messages).toHaveLength(4)
})
it('keeps a media draft typed into the fallback conversation when undoing deletion', async () => {
  const p = await seed()
  await p.removeChats(p.chats.sessions.map(chat => chat.id))
  const fallback = p.chats.sessions[0]!
  fallback.mediaDrafts = { image: { prompt: '新的图片草稿', references: [] } }
  await p.undoRemovedChats()
  expect(p.chats.sessions.find(chat => chat.id === fallback.id)?.mediaDrafts?.image?.prompt).toBe('新的图片草稿')
})
it('does not assign newly generated copy tasks to the original legacy conversation', async () => {
  const p = await seed(), original = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  p.cloneChat(original)
  const copy = p.chats.sessions.find(chat => chat.id === p.chats.activeId)!
  const generated = task('copy-only', 'image', copy.mediaConversationId!, 4)
  p.creation.tasks.push(generated); p.attachMediaTask(copy, generated)
  await p.syncMediaConversations()
  expect(p.mediaTasksForConversation(original).some(task => task.id === generated.id)).toBe(false)
  expect(p.mediaTasksForConversation(copy).some(task => task.id === generated.id)).toBe(true)
})
for (const kind of ['image', 'video'] as const) {
  it(`keeps reused ${kind} turns in the selected original or copied conversation`, async () => {
    const p = await fixture(), original = p.newChat(kind)
    p.creation.tasks.push(task('shared-result', kind, original.id))
    const source = p.creation.tasks.at(-1)!
    p.attachMediaTask(original, source)
    p.cloneChat(original)
    const copy = p.chats.sessions.find(chat => chat.id === p.chats.activeId)!
    p.activateConversation(original.id)
    expect(p.ensureMediaConversation(kind, source)).toBe(original)
    expect(p.chats.activeId).toBe(original.id)
    p.activateConversation(copy.id)
    expect(p.ensureMediaConversation(kind, source)).toBe(copy)
    expect(p.chats.activeId).toBe(copy.id)
    expect(p.mediaBranchTask(kind, original.id, source.id)).toBe(source)
    expect(p.mediaBranchTask(kind, copy.id, source.id)).toBe(source)
  })
}
it('accepts media branch anchors only from the requested registered conversation and owner', async () => {
  const p = await seed(), original = p.chats.sessions.find(chat => p.conversationKind(chat) === 'image')!
  const source = p.creation.tasks.find(task => task.id === 'image-1')!
  const conversationId = original.mediaConversationId!
  expect(p.mediaBranchTask('image', conversationId, source.id)).toBe(source)
  expect(p.mediaBranchTask('image', 'text', source.id)).toBeUndefined()
  expect(p.mediaBranchTask('video', conversationId, source.id)).toBeUndefined()
  expect(p.mediaBranchTask('image', undefined, source.id)).toBeUndefined()
  expect(p.mediaBranchTask('image', conversationId, 'missing')).toBeUndefined()
  source.owner = '18'
  expect(p.mediaBranchTask('image', conversationId, source.id)).toBeUndefined()
  source.owner = '17'
  original.deletedMediaTaskIds = [source.id]
  expect(p.mediaBranchTask('image', conversationId, source.id)).toBeUndefined()
  original.deletedMediaTaskIds = []
  const answer = original.messages.find(message => message.role === 'assistant' && message.taskId === source.id)!
  const parent = answer.parentId
  answer.parentId = 'missing-parent'
  expect(p.mediaBranchTask('image', conversationId, source.id)).toBeUndefined()
  answer.parentId = parent
  const question = original.messages.find(message => message.id === parent)!
  original.messages = original.messages.filter(message => message !== answer && message !== question)
  original.messageBranches = [question, answer]
  expect(p.mediaBranchTask('image', conversationId, source.id)).toBeUndefined()
  original.messages.push(question, answer); original.messageBranches = []
  p.chats.ready = false
  expect(p.mediaBranchTask('image', conversationId, source.id)).toBeUndefined()
  p.chats.ready = true; p.chats.sessions = p.chats.sessions.filter(chat => chat !== original)
  expect(p.mediaBranchTask('image', conversationId, source.id)).toBeUndefined()
  p.session.user = { id: '18' } as any
  expect(p.mediaBranchTask('image', conversationId, source.id)).toBeUndefined()
})
