import { beforeEach, expect, it, vi } from 'vitest'
import type { CreationTask } from './native-studio'

const storage = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn() }))
vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null as any }), errorMessage: (error: Error) => error.message, api: vi.fn() }
})
vi.mock('./native-studio', async () => {
  const { reactive } = await import('vue')
  return { creation: reactive({ tasks: [] as CreationTask[], selectedId: '', loaded: true }), portableImage: vi.fn(async (url: string) => url), resumeCreation: vi.fn(), stopCreation: vi.fn(), submitCreation: vi.fn() }
})
vi.mock('./model-preferences', () => ({ modelFormat: () => undefined, configuredModelFormat: () => undefined }))
vi.mock('../shared/studio/chat-persistence', () => ({ readChatSnapshot: storage.read, writeChatSnapshot: storage.write }))
beforeEach(() => { vi.resetModules(); storage.write.mockReset().mockResolvedValue(undefined); storage.read.mockReset() })
function task(id: string, conversationId: string, time: number, extra: Partial<CreationTask> = {}): CreationTask {
  return { id, conversationId, kind: 'image', owner: '17', createdAt: time, phase: 'complete', protocol: 'sync', model: 'gpt-image-2', prompt: id,
    urls: [`https://example.test/${id}.png`], references: [], text: '', request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 }, ...extra }
}
async function fixture() {
  const { session } = await import('./state'), chat = await import('./native-chat')
  const media = await import('./studio-conversations'), logic = await import('./studio-image-conversation')
  const { creation } = await import('./native-studio')
  session.user = { id: '17' } as any; chat.chats.ready = true
  creation.tasks = []; creation.selectedId = ''; creation.loaded = true
  const thread = chat.newChat('image')
  creation.tasks.push(task('one', thread.id, 1), task('two', thread.id, 2), task('three', thread.id, 3))
  await media.syncMediaConversations()
  storage.write.mockClear()
  return { ...chat, ...media, ...logic, session, creation, thread }
}
it('registers image and video turns in a text conversation and reuses text generation afterward', async () => {
  const p = await fixture(), mixed = p.newChat()
  const image = task('mixed-image', mixed.id, 4), video = task('mixed-video', mixed.id, 5, { kind: 'video' })
  p.creation.tasks.push(image, video)
  await p.registerMediaTurn(mixed, image); await p.registerMediaTurn(mixed, video)
  await p.syncMediaConversations()
  expect(p.visibleMediaTasks(mixed).map(task => task.id)).toEqual(['mixed-image', 'mixed-video'])
  expect(p.buildImageContext(mixed).turns).toEqual([])
  expect(p.chats.sessions.filter(chat => p.mediaTasksForConversation(chat).some(task => task.id === image.id))).toHaveLength(1)
  await p.deleteMediaTurns(mixed, [image.id])
  await p.syncMediaConversations()
  expect(p.visibleMediaTasks(mixed).map(task => task.id)).toEqual(['mixed-video'])
  expect(await p.sendChat(mixed, '继续对话', [], 'gpt-5')).toBe(true)
  expect(mixed.messages.some(message => message.role === 'user' && message.content === '继续对话')).toBe(true)
})
it('never carries unselected historical images, including other owners and conversations', async () => {
  const p = await fixture()
  p.creation.tasks.push(task('foreign', p.thread.id, 4, { owner: '18' }), task('other-chat', 'other', 5), task('waiting', p.thread.id, 6, { phase: 'attention', urls: ['https://example.test/preview.png'] }))
  await p.syncMediaConversations()
  expect(p.buildImageContext(p.thread).turns).toEqual([])
  expect(p.pinnedImageReferences(p.thread)).toEqual([])
})
it('keeps pinned media after clearing, deduplicates both sides, and removes pins with the source', async () => {
  const p = await fixture()
  await p.togglePinnedMessage(p.thread, 'media-user:one')
  expect(p.buildImageContext(p.thread).turns).toEqual([{ prompt: 'one', images: [] }])
  expect(p.pinnedImageReferences(p.thread)).toEqual([])
  await p.togglePinnedMessage(p.thread, 'media-assistant:one')
  expect(p.buildImageContext(p.thread).turns.map(turn => turn.prompt)).toEqual(['one'])
  await p.clearMediaContext(p.thread)
  expect(p.buildImageContext(p.thread).turns).toEqual([{ prompt: 'one', images: ['https://example.test/one.png'] }])
  expect(p.pinnedImageReferences(p.thread)).toEqual([{ name: '固定参考图 1', url: 'https://example.test/one.png' }])
  expect(JSON.stringify(p.thread.pinnedMessageIds)).not.toContain('https:')
  await p.deleteMediaTurns(p.thread, ['one'])
  expect(p.thread.pinnedMessageIds).toEqual([])
  expect(p.buildImageContext(p.thread).turns).toEqual([])
})
it('pins a specific image version without following regenerated results and remaps cloned message IDs', async () => {
  const p = await fixture()
  await p.togglePinnedMessage(p.thread, 'media-assistant:two')
  const version = task('two-v2', p.thread.id, 4, { prompt: 'updated', mediaBranch: { taskId: 'two' } })
  p.creation.tasks.push(version); await p.registerMediaTurn(p.thread, version)
  await p.clearMediaContext(p.thread)
  expect(p.buildImageContext(p.thread).turns[0]!.images).toEqual(['https://example.test/two.png'])
  p.cloneChat(p.thread)
  const copy = p.chats.sessions[0]!
  expect(copy.pinnedMessageIds).toHaveLength(1)
  expect(copy.pinnedMessageIds![0]).not.toBe('media-assistant:two')
  expect(p.buildImageContext(copy).turns[0]!.images).toEqual(['https://example.test/two.png'])
})
it('rolls back a pin when saving fails and rejects foreign or oversized pinned context', async () => {
  const p = await fixture()
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.togglePinnedMessage(p.thread, 'media-assistant:one')).rejects.toThrow('disk full')
  expect(p.thread.pinnedMessageIds || []).toEqual([])
  await expect(p.togglePinnedMessage(p.thread, 'missing')).rejects.toThrow('无法固定')
  p.creation.tasks[0]!.urls = Array.from({ length: 17 }, (_, i) => `https://example.test/${i}.png`)
  await expect(p.togglePinnedMessage(p.thread, 'media-assistant:one')).rejects.toThrow('16 张图片')
  p.creation.tasks[0]!.urls = ['https://example.test/one.png']
  await p.togglePinnedMessage(p.thread, 'media-assistant:one')
  p.session.user = { id: '18' } as any
  expect(p.buildImageContext(p.thread).turns).toEqual([])
  await expect(p.togglePinnedMessage(p.thread, 'media-assistant:one')).rejects.toThrow('当前对话不可用')
})
it('sends pinned text with its original role once and preserves it after history clearing', async () => {
  const p = await fixture(), textChat = p.newChat()
  const { submitCreation } = await import('./native-studio')
  vi.mocked(submitCreation).mockResolvedValue(task('answer', textChat.id, 10, { kind: 'text', text: 'done', urls: [] }))
  await p.sendChat(textChat, '始终使用中文', [], 'gpt-5')
  const answer = textChat.messages.find(message => message.role === 'assistant')!
  await p.togglePinnedMessage(textChat, answer.id)
  vi.mocked(submitCreation).mockClear()
  await p.sendChat(textChat, '继续', [], 'gpt-5')
  const sent = vi.mocked(submitCreation).mock.calls[0]![0].chatOptions!.messages
  expect(sent.filter(message => message.content === 'done')).toEqual([{ role: 'assistant', content: 'done' }])
  await p.clearMediaContext(textChat)
  vi.mocked(submitCreation).mockClear()
  await p.sendChat(textChat, '下一条', [], 'gpt-5')
  expect(vi.mocked(submitCreation).mock.calls[0]![0].chatOptions!.messages).toContainEqual({ role: 'assistant', content: 'done' })
  await p.togglePinnedMessage(textChat, answer.id)
  expect(textChat.pinnedMessageIds).toEqual([])
})
it('passes pinned media to text models as image content instead of just the old prompt', async () => {
  const p = await fixture()
  const { submitCreation, portableImage } = await import('./native-studio')
  vi.mocked(submitCreation).mockResolvedValue(task('text-answer', p.thread.id, 10, { kind: 'text', text: 'done', urls: [] }))
  await p.togglePinnedMessage(p.thread, 'media-assistant:one')
  await p.clearMediaContext(p.thread)
  vi.mocked(submitCreation).mockClear()
  await p.sendChat(p.thread, '解释固定的图片', [], 'gpt-5')
  expect(portableImage).toHaveBeenCalledWith('https://example.test/one.png')
  expect(vi.mocked(submitCreation).mock.calls[0]![0].chatOptions!.messages).toContainEqual({ role: 'assistant', content: [
    { type: 'text', text: 'one' }, { type: 'image_url', image_url: { url: 'https://example.test/one.png' } },
  ] })
})
it('keeps displayed records after clearing without implicitly attaching subsequent results', async () => {
  const p = await fixture()
  await p.clearMediaContext(p.thread)
  expect(p.visibleMediaTasks(p.thread)).toHaveLength(3)
  expect(p.buildImageContext(p.thread)).toEqual({ turns: [] })
  p.creation.tasks.push(task('four', p.thread.id, 4))
  await p.syncMediaConversations()
  expect(p.buildImageContext(p.thread).turns).toEqual([])
  expect(p.visibleMediaTasks(p.thread)).toHaveLength(4)
})
it('restores the clear boundary without adding image references or removing later turns', async () => {
  const p = await fixture()
  await p.clearMediaContext(p.thread)
  p.thread.mediaDrafts = { image: { prompt: '继续创作', references: [] } }
  p.creation.tasks.push(task('four', p.thread.id, 4))
  await p.syncMediaConversations()
  await p.restoreMediaContext(p.thread)
  expect(p.thread.clearContextIndex).toBeUndefined()
  expect(p.thread.mediaDrafts!.image!.references).toEqual([])
  expect(p.thread.mediaDrafts!.image!.prompt).toBe('继续创作')
  expect(p.buildImageContext(p.thread).turns).toEqual([])
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'two', 'three', 'four'])
})
it('keeps the clear boundary and excluded images when restoring cannot be saved', async () => {
  const p = await fixture()
  await p.clearMediaContext(p.thread)
  const draft = { prompt: '保留草稿', references: [] }
  p.thread.mediaDrafts = { image: draft }
  let failSave!: (cause: Error) => void
  storage.write.mockImplementationOnce(() => new Promise((_, reject) => { failSave = reject }))
  const restoring = expect(p.restoreMediaContext(p.thread)).rejects.toThrow('disk full')
  await vi.waitFor(() => expect(failSave).toBeTypeOf('function'))
  draft.prompt = '保存期间的新输入'
  failSave(new Error('disk full'))
  await restoring
  expect(p.thread.clearContextIndex).toBe(p.thread.messages.length)
  expect(p.thread.mediaDrafts!.image!.references).toEqual([])
  expect(p.thread.mediaDrafts!.image!.prompt).toBe('保存期间的新输入')
  expect(p.buildImageContext(p.thread)).toEqual({ turns: [] })
})
it('keeps clearing effective after switching to archived prompt and answer versions', async () => {
  const p = await fixture()
  const version = task('two-v2', p.thread.id, 4, { prompt: 'two', mediaBranch: { taskId: 'two' } })
  p.creation.tasks.push(version); await p.registerMediaTurn(p.thread, version)
  await p.clearMediaContext(p.thread)
  await p.selectMediaVersion(p.thread, 'two-v2', -1)
  expect(p.buildImageContext(p.thread)).toEqual({ turns: [] })
  p.creation.tasks.push(task('after-clear', p.thread.id, 5))
  await p.syncMediaConversations()
  expect(p.buildImageContext(p.thread).turns).toEqual([])
  expect(p.visibleMediaTasks(p.thread).at(-1)?.id).toBe('after-clear')
})
it('never activates a branch whose local registration failed before upstream submission', async () => {
  const p = await fixture()
  const pending = task('unsent', p.thread.id, 4, { mediaBranch: { taskId: 'two' }, conversationPending: true, phase: 'submitting' })
  p.creation.tasks.push(pending)
  await p.syncMediaConversations()
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'two', 'three'])
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.registerMediaTurn(p.thread, pending)).rejects.toThrow('disk full')
  pending.phase = 'error'
  await p.syncMediaConversations()
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'two', 'three'])
})
it('includes only original attachments when a user pins the question, then its result when pinning the answer', async () => {
  const p = await fixture()
  p.creation.tasks[0]!.references = [{ name: '人物参考', url: '/legacy-files/reference1' }]
  expect(p.buildImageContext(p.thread).turns).toEqual([])
  await p.togglePinnedMessage(p.thread, 'media-user:one')
  expect(p.buildImageContext(p.thread).turns).toEqual([{ prompt: 'one', images: [], references: ['/legacy-files/reference1'] }])
  await p.togglePinnedMessage(p.thread, 'media-assistant:one')
  expect(p.buildImageContext(p.thread).turns[0]).toEqual({
    prompt: 'one', images: ['https://example.test/one.png'], references: ['/legacy-files/reference1'],
  })
})
it('appends regenerated images without hiding earlier or later turns, including after sync', async () => {
  const p = await fixture()
  const regenerated = task('two-v2', p.thread.id, 4, { prompt: 'two', mediaBranch: { taskId: 'two' } })
  p.creation.tasks.push(regenerated)
  await p.registerMediaTurn(p.thread, regenerated)
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'two', 'three', 'two-v2'])
  expect(p.mediaVersion(p.thread, 'two-v2')).toMatchObject({ index: 0, total: 1 })
  await p.syncMediaConversations()
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'two', 'three', 'two-v2'])
})
it('appends edited image prompts without overwriting or hiding any previous result', async () => {
  const p = await fixture()
  const edited = task('two-edited', p.thread.id, 4, { prompt: '把背景改成蓝色', mediaBranch: { taskId: 'two', edited: true } })
  p.creation.tasks.push(edited)
  await p.registerMediaTurn(p.thread, edited)
  expect(p.visibleMediaTasks(p.thread).map(task => task.prompt)).toEqual(['one', 'two', 'three', '把背景改成蓝色'])
  expect(p.creation.tasks.find(task => task.id === 'two')?.prompt).toBe('two')
  expect(p.mediaVersion(p.thread, 'two-edited')).toMatchObject({ index: 0, total: 1 })
})
it('removes only selected image results, retains regenerated results and gallery data, and cannot resurrect deleted turns', async () => {
  const p = await fixture()
  const regenerated = task('two-v2', p.thread.id, 4, { prompt: 'two', mediaBranch: { taskId: 'two' } })
  p.creation.tasks.push(regenerated)
  await p.registerMediaTurn(p.thread, regenerated)
  await p.deleteMediaTurns(p.thread, ['one', 'two'])
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['three', 'two-v2'])
  expect(p.creation.tasks).toHaveLength(4)
  expect(p.thread.deletedMediaTaskIds?.sort()).toEqual(['one', 'two'])
  await p.syncMediaConversations()
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['three', 'two-v2'])
  const persisted = storage.write.mock.calls.at(-1)![1]
  expect(persisted.state.sessions[0].deletedMediaTaskIds).not.toContain('two-v2')
})
it('expands legacy image answers in order without changing stored history or hiding an active text answer', async () => {
  const p = await fixture(), { createAnswerBranch } = await import('../shared/studio/chat-branches')
  const legacy = task('two-old-version', p.thread.id, 4)
  p.creation.tasks.push(legacy)
  expect(createAnswerBranch(p.thread, 'media-user:two', {
    id: 'legacy-answer', role: 'assistant', content: '', taskId: legacy.id, createdAt: 4,
  } as any, true)).toBe(true)
  const before = JSON.stringify(p.thread)
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'two', 'three', legacy.id])
  expect(p.visibleConversationMessages(p.thread).map(message => message.id)).toEqual(['media-assistant:one', 'media-assistant:two', 'media-assistant:three', 'legacy-answer'])
  expect(JSON.stringify(p.thread)).toBe(before)
  expect(storage.write).not.toHaveBeenCalled()
  expect(createAnswerBranch(p.thread, 'media-user:two', {
    id: 'text-answer', role: 'assistant', content: '文字回答', createdAt: 5,
  }, true)).toBe(true)
  expect(p.visibleConversationMessages(p.thread).map(message => message.id)).toContain('media-user:two')
  expect(p.visibleConversationMessages(p.thread).at(-1)?.id).toBe('text-answer')
  expect(p.buildImageContext(p.thread).turns).toEqual([])
  p.session.user = { id: '18' } as any
  expect(p.visibleMediaTasks(p.thread)).toEqual([])
})
it('orders old image messages by task time when message timestamps are missing', async () => {
  const p = await fixture(), { createAnswerBranch, branchMessages } = await import('../shared/studio/chat-branches')
  const legacy = task('legacy', p.thread.id, 4)
  p.creation.tasks.push(legacy)
  createAnswerBranch(p.thread, 'media-user:two', {
    id: 'legacy-answer', role: 'assistant', content: '', taskId: legacy.id,
  } as any, true)
  for (const message of branchMessages(p.thread)) delete message.createdAt
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'two', 'three', 'legacy'])
})
it('keeps an image question pinnable when an older video shares the same question', async () => {
  const p = await fixture(), { createAnswerBranch } = await import('../shared/studio/chat-branches')
  const video = task('old-video', p.thread.id, 4, { kind: 'video' }), image = task('old-image', p.thread.id, 5, { prompt: 'two' })
  p.creation.tasks.push(video, image)
  for (const item of [video, image]) createAnswerBranch(p.thread, 'media-user:two', {
    id: `answer:${item.id}`, role: 'assistant', content: '', taskId: item.id, createdAt: item.createdAt,
  } as any, true)
  await p.deleteMediaTurns(p.thread, ['two'])
  await p.togglePinnedMessage(p.thread, 'media-user:two')
  expect(p.thread.messages.find(message => message.id === 'media-user:two')?.taskId).toBe(image.id)
  expect(p.buildImageContext(p.thread).turns).toEqual([{ prompt: 'two', images: [] }])
})
it('deletes a legacy image independently and keeps its shared question pinnable for the remaining result', async () => {
  const p = await fixture(), { createAnswerBranch } = await import('../shared/studio/chat-branches')
  const legacy = task('two-old-version', p.thread.id, 4, { prompt: 'two' })
  p.creation.tasks.push(legacy)
  createAnswerBranch(p.thread, 'media-user:two', {
    id: 'legacy-answer', role: 'assistant', content: '', taskId: legacy.id, createdAt: 4,
  } as any, true)
  await p.togglePinnedMessage(p.thread, 'media-user:two')
  const before = JSON.stringify(p.thread)
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.deleteMediaTurns(p.thread, ['two'])).rejects.toThrow('disk full')
  expect(JSON.stringify(p.thread)).toBe(before)
  await p.deleteMediaTurns(p.thread, ['two'])
  expect(p.thread.messages.find(message => message.id === 'media-user:two')?.taskId).toBe(legacy.id)
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'three', legacy.id])
  expect(p.buildImageContext(p.thread).turns).toEqual([{ prompt: 'two', images: [] }])
  await p.togglePinnedMessage(p.thread, 'legacy-answer')
  expect(p.buildImageContext(p.thread).turns).toEqual([{ prompt: 'two', images: legacy.urls }])
  await p.syncMediaConversations()
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'three', legacy.id])
  await p.deleteMediaTurns(p.thread, [legacy.id])
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'three'])
  expect(p.thread.pinnedMessageIds).toEqual([])
  expect(p.creation.tasks).toHaveLength(4)
})
it('deleting a legacy image keeps a shared active text question and answer', async () => {
  const p = await fixture(), { createAnswerBranch } = await import('../shared/studio/chat-branches')
  createAnswerBranch(p.thread, 'media-user:two', {
    id: 'text-answer', role: 'assistant', content: '文字回答', createdAt: 4,
  }, true)
  await p.deleteMediaTurns(p.thread, ['two'])
  expect(p.thread.messages.find(message => message.id === 'media-user:two')).toMatchObject({ content: 'two', taskId: undefined })
  expect(p.thread.messages.at(-1)?.id).toBe('text-answer')
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'three'])
  await p.togglePinnedMessage(p.thread, 'media-user:two')
  expect(p.buildImageContext(p.thread).turns).toEqual([{ prompt: 'two', images: [] }])
})
it('rolls back failed mutations without losing the current draft', async () => {
  const p = await fixture()
  p.thread.draft = '新草稿'
  storage.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.deleteMediaTurns(p.thread, ['two'])).rejects.toThrow('disk full')
  expect(p.visibleMediaTasks(p.thread).map(task => task.id)).toEqual(['one', 'two', 'three'])
  expect(p.thread.deletedMediaTaskIds).toBeUndefined()
  expect(p.thread.draft).toBe('新草稿')
})
it('does not interleave a second mutation while a conversation save is unresolved', async () => {
  const p = await fixture()
  let release!: () => void
  storage.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  const clearing = p.clearMediaContext(p.thread)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  await expect(p.deleteMediaTurns(p.thread, ['two'])).rejects.toThrow('正在保存')
  release(); await clearing
  expect(p.visibleMediaTasks(p.thread)).toHaveLength(3)
})
it('keeps context and message interactions available without cancelling active or uncertain tasks', async () => {
  for (const phase of ['submitting', 'running', 'attention'] as const) {
    const p = await fixture()
    p.creation.tasks[0]!.phase = phase
    await p.clearMediaContext(p.thread)
    expect(p.buildImageContext(p.thread)).toEqual({ turns: [] })
    await p.restoreMediaContext(p.thread)
    await p.selectMediaVersion(p.thread, 'two', -1)
    await p.deleteMediaTurns(p.thread, ['one'])
    expect(p.visibleMediaTasks(p.thread).map(task => task.id)).not.toContain('one')
    expect(p.creation.tasks[0]!.phase).toBe(phase)
  }
})
it('cannot bind another owner task or restore old-account state after a rejected write', async () => {
  const p = await fixture()
  await expect(p.registerMediaTurn(p.thread, task('foreign', p.thread.id, 4, { owner: '18' }))).rejects.toThrow('不属于')
  let reject!: (error: Error) => void
  storage.write.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail }))
  const clearing = p.clearMediaContext(p.thread)
  await vi.waitFor(() => expect(reject).toBeTypeOf('function'))
  p.session.user = { id: '18' } as any; reject(new Error('disk full'))
  await expect(clearing).rejects.toThrow('disk full')
  expect(p.chats.sessions).toEqual([])
})
it('does not serialize a long image history into a new request', async () => {
  const p = await fixture()
  for (let index = 4; index <= 30; index++) p.creation.tasks.push(task(`round-${index}`, p.thread.id, index, { urls: [`https://example.test/${index}-a.png`, `https://example.test/${index}-b.png`] }))
  await p.syncMediaConversations()
  const context = p.buildImageContext(p.thread)
  expect(context.turns).toEqual([])
  expect(p.visibleMediaTasks(p.thread)).toHaveLength(30)
})
for (const kind of ['image', 'video'] as const) {
  for (const edited of [false, true]) {
    it(`${edited ? 'edits' : 'regenerates'} copied ${kind} turns without changing the original conversation`, async () => {
      const p = await fixture(), original = p.newChat(kind)
      p.creation.tasks.push(task('original-result', original.id, 10, { kind }))
      const source = p.creation.tasks.at(-1)!
      p.attachMediaTask(original, source)
      const originalMessages = original.messages.map(message => ({ ...message }))
      p.cloneChat(original)
      const copy = p.chats.sessions.find(chat => chat.id === p.chats.activeId)!
      expect(p.ensureMediaConversation(kind, source)).toBe(copy)
      expect(p.mediaBranchTask(kind, copy.mediaConversationId || copy.id, source.id)).toBe(source)
      const generated = task('copy-branch', copy.mediaConversationId || copy.id, 11, {
        kind, prompt: edited ? 'edited in copy' : source.prompt, mediaBranch: { taskId: source.id, edited },
      })
      p.creation.tasks.push(generated)
      await p.registerMediaTurn(copy, generated)
      await p.syncMediaConversations()
      expect(original.messages).toEqual(originalMessages)
      expect(p.visibleMediaTasks(original).map(task => task.id)).toEqual([source.id])
      expect(p.visibleMediaTasks(copy).map(task => task.id)).toEqual(kind === 'image' ? [source.id, generated.id] : [generated.id])
      expect(p.mediaVersion(copy, generated.id)).toMatchObject(kind === 'image' ? { index: 0, total: 1 } : { index: 1, total: 2 })
    })
  }
}
