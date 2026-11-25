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
export function visibleConversationMessages(chat: NativeChat): NativeMessage[] {
  if (!session.user || !chats.sessions.includes(chat)) return []
  const tasks = new Map(mediaTasksForConversation(chat).map(task => [task.id, task]))
  const images = (branchMessages(chat) as NativeMessage[]).filter(message => message.role === 'assistant' && message.taskId
    && tasks.get(message.taskId)?.kind === 'image' && !chat.deletedMediaTaskIds?.includes(message.taskId))
  const imageIds = new Set(images.map(message => message.id))
  const otherParents = new Set(chat.messages.filter(message => message.role === 'assistant' && !imageIds.has(message.id)).map(message => message.parentId))
  const imageQuestions = new Set(images.map(message => message.parentId).filter(id => !otherParents.has(id)))
  const messages = chat.messages.filter(message => !imageQuestions.has(message.id))
  const activeIds = new Set(messages.map(message => message.id))
  const createdAt = (message: NativeMessage) => message.createdAt ?? tasks.get(message.taskId || '')?.createdAt ?? 0
  // Expand saved image versions for display without changing text/video branches or stored history.
  for (const image of images.filter(message => !activeIds.has(message.id)).sort((left, right) => createdAt(left) - createdAt(right))) {
    const index = messages.findIndex(message => createdAt(message) > createdAt(image))
    messages.splice(index < 0 ? messages.length : index, 0, image)
  }
  return messages
}
export function visibleMediaTasks(chat: NativeChat): CreationTask[] {
  const tasks = new Map(mediaTasksForConversation(chat).map(task => [task.id, task])), seen = new Set<string>()
  return visibleConversationMessages(chat).flatMap(message => {
    const task = message.role === 'assistant' && message.taskId && tasks.get(message.taskId)
    if (!task || seen.has(task.id) || chat.deletedMediaTaskIds?.includes(task.id)) return []
    seen.add(task.id)
    return [task]
  })
}
export function buildImageContext(chat: NativeChat): ImageConversationContext {
  const fixed = validatePinnedContext(pinnedContext(chat, creation.tasks, session.user?.id || ''))
  // Only explicitly pinned messages carry over into a new image request.
  return { turns: pinnedImageTurns(fixed) }
}
export function pinnedImageReferences(chat: NativeChat): CreationTask['references'] {
  return [...new Set(buildImageContext(chat).turns.flatMap(turn => [...(turn.references || []), ...turn.images]))].map((url, index) => ({ name: `固定参考图 ${index + 1}`, url }))
}
export async function registerMediaTurn(chat: NativeChat, task: CreationTask, branchTaskId?: string, edited?: boolean) {
  registered(chat)
  if (task.owner !== session.user!.id || task.kind === 'text' || (task.conversationId || task.id) !== (chat.mediaConversationId || chat.id)) throw new Error('生成记录不属于当前会话。')
  if (task.kind === 'video' && branchTaskId && !task.mediaBranch) task.mediaBranch = { taskId: branchTaskId, edited }
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
  await savedMutation(chat, () => {
    chat.clearContextIndex = undefined
    chat.mediaContextExcludedTaskIds = []
    chat.lastSummarizeIndex = 0
  })
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
    if (task.kind === 'image') { removed.add(answer!.id); continue }
    // A selected turn includes its alternate prompts/answers, but not later turns.
    const questions = nodes.filter(message => message.role === 'user' && message.parentId === question.parentId)
    for (const user of questions) {
      removed.add(user.id)
      nodes.filter(message => message.role === 'assistant' && message.parentId === user.id).forEach(message => removed.add(message.id))
    }
  }
  for (const question of nodes.filter(message => message.role === 'user')) {
    const answers = nodes.filter(message => message.role === 'assistant' && message.parentId === question.id)
    if (answers.length && answers.every(message => removed.has(message.id))) removed.add(question.id)
  }
  const removedTaskIds = nodes.filter(message => removed.has(message.id)).flatMap(message => message.taskId ? [message.taskId] : [])
  const imageTaskIds = new Set(mediaTasksForConversation(chat).filter(task => task.kind === 'image').map(task => task.id))
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
      if (message.role === 'user' && message.taskId && removedTaskIds.includes(message.taskId)) {
        const remaining = nodes.filter(answer => answer.role === 'assistant' && answer.parentId === message.id && !removed.has(answer.id))
        message.taskId = (remaining.find(answer => imageTaskIds.has(answer.taskId || '')) || remaining[0])?.taskId
      }
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
