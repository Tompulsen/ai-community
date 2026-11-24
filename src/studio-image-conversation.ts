// Conversation and branch adaptation of Octopus Chat's MIT chat store.
import { branchMessages, answerBranches, selectAnswerBranch, synchronizeBranches } from '../shared/studio/chat-branches'
import type { ImageConversationContext } from '../shared/studio/image-conversation'
import { chats, conversationBusy, saveChats, type NativeChat, type NativeMessage } from './native-chat'
import { creation, type CreationTask } from './native-studio'
import { attachMediaTask, mediaTasksForConversation } from './studio-conversations'
import { session } from './state'
import { pinnedContext, pinnedImageTurns, readPinnedMessageIds, validatePinnedContext } from './studio-pinned-context'

const saving = new WeakSet<NativeChat>()
function registered(chat: NativeChat) {
  if (!session.user || !chats.ready || !chats.sessions.includes(chat)) throw new Error('当前创作会话不可用。')
}
function snapshot(chat: NativeChat) {
  return {
    messages: JSON.parse(JSON.stringify(chat.messages)) as NativeMessage[],
    messageBranches: JSON.parse(JSON.stringify(chat.messageBranches || [])) as NativeMessage[],
    branchSelections: { ...chat.branchSelections }, clearContextIndex: chat.clearContextIndex,
    memoryPrompt: chat.memoryPrompt, lastSummarizeIndex: chat.lastSummarizeIndex, lastUpdate: chat.lastUpdate,
    deletedMediaTaskIds: chat.deletedMediaTaskIds && [...chat.deletedMediaTaskIds],
    mediaContextExcludedTaskIds: chat.mediaContextExcludedTaskIds && [...chat.mediaContextExcludedTaskIds],
    pinnedMessageIds: chat.pinnedMessageIds && [...chat.pinnedMessageIds],
  }
}
async function savedMutation(chat: NativeChat, update: () => void) {
  registered(chat)
  if (saving.has(chat)) throw new Error('会话正在保存，请稍后再操作。')
  const owner = session.user!.id, before = snapshot(chat)
  const alreadyPreparing = chats.preparing[chat.id]
  chats.preparing[chat.id] = true
  saving.add(chat)
  try { update(); await saveChats(true) }
  catch (error) {
    if (session.user?.id === owner && chats.sessions.includes(chat)) {
      Object.assign(chat, before); synchronizeBranches(chat)
    }
    throw error
  } finally {
    saving.delete(chat)
    if (!alreadyPreparing && session.user?.id === owner) chats.preparing[chat.id] = false
  }
}
export function visibleMediaTasks(chat: NativeChat): CreationTask[] {
  if (!session.user || !chats.sessions.includes(chat)) return []
  const tasks = new Map(mediaTasksForConversation(chat).map(task => [task.id, task]))
  return chat.messages.flatMap(message => {
    const task = message.role === 'assistant' && message.taskId && tasks.get(message.taskId)
    return task && !chat.deletedMediaTaskIds?.includes(task.id) ? [task] : []
  })
}
function contextTasks(chat: NativeChat, beforeTaskId?: string) {
  const tasks = visibleMediaTasks(chat)
  const end = beforeTaskId ? tasks.findIndex(task => task.id === beforeTaskId) : tasks.length
  if (end < 0) throw new Error('原消息已不在当前版本，请重新选择。')
  return tasks.slice(0, end).filter(task => task.kind === 'image' && task.phase === 'complete' && task.urls.length && !chat.mediaContextExcludedTaskIds?.includes(task.id) &&
    chat.messages.findIndex(message => message.taskId === task.id && message.role === 'assistant') >= (chat.clearContextIndex || 0))
}
export function buildImageContext(chat: NativeChat, beforeTaskId?: string): ImageConversationContext {
  const fixed = validatePinnedContext(pinnedContext(chat, creation.tasks, session.user?.id || ''))
  const pinned = pinnedImageTurns(fixed)
  const pinnedTasks = new Set(fixed.flatMap(entry => entry.task ? [entry.task.id] : []))
  const turns: ImageConversationContext['turns'] = []
  let images = pinned.reduce((total, turn) => total + turn.images.length + (turn.references?.length || 0), 0), characters = pinned.reduce((total, turn) => total + Array.from(turn.prompt).length, 0)
  const recent = contextTasks(chat, beforeTaskId)
  // A pinned question must not remove its completed answer from ordinary history.
  const keys = [...new Set(fixed.map(entry => entry.task?.id || entry.message.id))]
  for (const task of recent) {
    const turn = pinned[keys.indexOf(task.id)]
    if (turn && !turn.images.length && images + task.urls.length <= 16) {
      turn.images = [...task.urls]; images += task.urls.length
    }
  }
  // Keep whole recent turns; never split a turn or count base64 as prompt text.
  for (const task of recent.reverse()) {
    if (pinnedTasks.has(task.id)) continue
    const references = [...new Set(task.references.map(file => file.url))]
    if (turns.length + pinned.length >= 20 || images + task.urls.length + references.length > 16 || characters + Array.from(task.prompt).length > 32000) break
    turns.unshift({ prompt: task.prompt, images: [...task.urls], ...(references.length ? { references } : {}) })
    images += task.urls.length + references.length; characters += Array.from(task.prompt).length
  }
  return { turns: [...pinned, ...turns] }
}
export function pinnedImageReferences(chat: NativeChat): CreationTask['references'] {
  const fixed = validatePinnedContext(pinnedContext(chat, creation.tasks, session.user?.id || ''))
  return [...new Set(pinnedImageTurns(fixed).flatMap(turn => [...(turn.references || []), ...turn.images]))].map((url, index) => ({ name: `固定参考图 ${index + 1}`, url }))
}
export function imageContinuationReferences(chat: NativeChat, beforeTaskId?: string): CreationTask['references'] {
  const last = contextTasks(chat, beforeTaskId).at(-1)
  return last?.urls[0] ? [{ name: '上一轮生成图片', url: last.urls[0] }] : []
}
export async function registerMediaTurn(chat: NativeChat, task: CreationTask, branchTaskId?: string, edited?: boolean) {
  registered(chat)
  if (task.owner !== session.user!.id || task.kind === 'text' || (task.conversationId || task.id) !== (chat.mediaConversationId || chat.id)) throw new Error('生成记录不属于当前会话。')
  if (branchTaskId && !task.mediaBranch) task.mediaBranch = { taskId: branchTaskId, edited }
  await savedMutation(chat, () => {
    attachMediaTask(chat, task)
    if (!chat.messages.some(message => message.role === 'assistant' && message.taskId === task.id)) throw new Error('原消息已切换或删除，未提交生成。')
    chat.model = task.model; chat.lastUpdate = task.createdAt
    if (chat.topic === '新对话' && !chat.renamed) chat.topic = task.prompt.slice(0, 100)
  })
}
function versionMessages(chat: NativeChat, taskId: string) {
  const answer = chat.messages.find(message => message.role === 'assistant' && message.taskId === taskId)
  if (!answer) return { answer: undefined, versions: [] as NativeMessage[] }
  const question = chat.messages.find(message => message.id === answer.parentId && message.role === 'user')
  const users = new Set(question ? answerBranches(chat, question.id).messageIds : [])
  return { answer, versions: (branchMessages(chat) as NativeMessage[]).filter(message => message.role === 'assistant' && users.has(message.parentId || '')) }
}
export function mediaVersion(chat: NativeChat, taskId: string) {
  const { answer, versions } = versionMessages(chat, taskId)
  return { index: Math.max(0, versions.findIndex(message => message.id === answer?.id)), total: Math.max(1, versions.length), messageIds: versions.map(message => message.id) }
}
function ensureSettled(chat: NativeChat) {
  if (saving.has(chat)) throw new Error('会话正在保存，请稍后再操作。')
  if (conversationBusy(chat))
    throw new Error('请先完成生成或核对待确认的任务。')
}
export async function selectMediaVersion(chat: NativeChat, taskId: string, direction: -1 | 1) {
  registered(chat); ensureSettled(chat)
  const { answer, versions } = versionMessages(chat, taskId)
  const target = versions[versions.findIndex(message => message.id === answer?.id) + direction]
  if (!answer || !target) return
  await savedMutation(chat, () => {
    if (answer.parentId !== target.parentId && !selectAnswerBranch(chat, answer.parentId!, target.parentId!, true)) throw new Error('当前无法切换版本。')
    const current = chat.messages.find(message => message.role === 'assistant' && message.parentId === target.parentId)
    if (current?.id !== target.id && (!current || !selectAnswerBranch(chat, current.id, target.id, true))) throw new Error('当前无法切换版本。')
  })
  creation.selectedId = visibleMediaTasks(chat).at(-1)?.id || ''
}
export async function clearMediaContext(chat: NativeChat) {
  ensureSettled(chat)
  await savedMutation(chat, () => {
    chat.clearContextIndex = chat.messages.length
    chat.mediaContextExcludedTaskIds = [...new Set([...(chat.mediaContextExcludedTaskIds || []), ...mediaTasksForConversation(chat).map(task => task.id)])]
    chat.memoryPrompt = ''; chat.lastSummarizeIndex = 0
  })
}
export async function restoreMediaContext(chat: NativeChat) {
  ensureSettled(chat)
  const owner = session.user?.id
  const flags = Object.values(chat.mediaDrafts || {}).map(draft => ({ draft, flag: draft.skipAutomaticReference }))
  try {
    await savedMutation(chat, () => {
      chat.clearContextIndex = undefined
      chat.mediaContextExcludedTaskIds = []
      chat.lastSummarizeIndex = 0
      for (const draft of Object.values(chat.mediaDrafts || {})) draft.skipAutomaticReference = false
    })
  } catch (error) {
    if (owner === session.user?.id && chats.sessions.includes(chat)) {
      for (const { draft, flag } of flags) {
        if (Object.values(chat.mediaDrafts || {}).includes(draft) && draft.skipAutomaticReference === false) draft.skipAutomaticReference = flag
      }
    }
    throw error
  }
}
export async function deleteMediaTurns(chat: NativeChat, ids: string[]) {
  registered(chat); ensureSettled(chat)
  const selected = new Set(ids), visible = visibleMediaTasks(chat)
  if (!visible.some(task => selected.has(task.id))) return
  const nodes = branchMessages(chat) as NativeMessage[], removed = new Set<string>()
  for (const task of visible.filter(task => selected.has(task.id))) {
    const answer = nodes.find(message => message.role === 'assistant' && message.taskId === task.id)
    const question = answer && nodes.find(message => message.id === answer.parentId)
    if (!question) continue
    // A selected turn includes its alternate prompts/answers, but not later turns.
    const questions = nodes.filter(message => message.role === 'user' && message.parentId === question.parentId)
    for (const user of questions) {
      removed.add(user.id)
      nodes.filter(message => message.role === 'assistant' && message.parentId === user.id).forEach(message => removed.add(message.id))
    }
  }
  const removedTaskIds = nodes.filter(message => removed.has(message.id)).flatMap(message => message.taskId ? [message.taskId] : [])
  const parent = new Map(nodes.map(message => [message.id, message.parentId]))
  const before = chat.messages.slice(0, chat.clearContextIndex || 0)
  await savedMutation(chat, () => {
    // Resolve parents through removed nodes so deleting an early turn keeps later work.
    const keep = (message: NativeMessage) => {
      if (removed.has(message.id)) return []
      let next = message.parentId
      const seen = new Set<string>()
      while (next && removed.has(next) && !seen.has(next)) { seen.add(next); next = parent.get(next) }
      if (message.parentId !== next) message.parentId = next
      return [message]
    }
    chat.messages = chat.messages.flatMap(keep)
    chat.messageBranches = (chat.messageBranches || []).flatMap(keep)
    chat.pinnedMessageIds = readPinnedMessageIds(chat.pinnedMessageIds).filter(id => !removed.has(id))
    chat.clearContextIndex = before.filter(message => !removed.has(message.id)).length
    chat.deletedMediaTaskIds = [...new Set([...(chat.deletedMediaTaskIds || []), ...removedTaskIds])]
    chat.memoryPrompt = ''; chat.lastSummarizeIndex = 0; chat.lastUpdate = Date.now()
    synchronizeBranches(chat)
  })
  creation.selectedId = visibleMediaTasks(chat).at(-1)?.id || ''
}
