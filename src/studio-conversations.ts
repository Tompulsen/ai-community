// Vue/store adapter of octopus_chat chat.ts, chat-projects.ts and chat-list.tsx (MIT).
import { chats, conversationBusy, conversationMediaTasks, createEmptyChat, newChat, saveChats, type NativeChat, type NativeMessage } from './native-chat'
import { creation, type CreationKind, type CreationTask } from './native-studio'
import { session } from './state'
import { chatProjectNameSchema } from '../shared/studio/chat-projects'
import { branchMessages, createAnswerBranch, createEditedMessageBranch, initializeBranches } from '../shared/studio/chat-branches'

const owner = () => session.user?.id || ''
const taskConversationId = (task: CreationTask) => task.conversationId || task.id
const mediaKey = (kind: CreationKind, id: string) => `${kind}:${id}`
function requireReady() {
  if (!owner() || !chats.ready) throw new Error('会话尚未读取，请稍后重试。')
}
function mediaChat(kind: 'image' | 'video', id: string) {
  return chats.sessions.find(chat => chat.id === id) ||
    chats.sessions.find(chat => conversationKind(chat) === kind && (chat.mediaConversationId || chat.id) === id)
}
export function conversationKind(chat: NativeChat): CreationKind {
  return chat.creationKind === 'image' || chat.creationKind === 'video' ? chat.creationKind : 'text'
}
export function mediaTasksForConversation(chat: NativeChat): CreationTask[] {
  return conversationMediaTasks(chat).sort((left, right) => right.createdAt - left.createdAt)
}
export function isConversationBusy(chat: NativeChat) {
  return conversationBusy(chat)
}
export function mediaBranchTask(kind: 'image' | 'video', conversationId: string | undefined, taskId: string): CreationTask | undefined {
  if (!owner() || !chats.ready || !conversationId) return
  const chat = chats.sessions.find(item => (item.mediaConversationId || item.id) === conversationId)
  const task = creation.tasks.find(item => item.id === taskId && item.owner === owner() && item.kind === kind)
  if (!chat || !task || chat.deletedMediaTaskIds?.includes(taskId)) return
  const answer = chat.messages.find(message => message.role === 'assistant' && message.taskId === taskId)
  if (answer && chat.messages.some(message => message.role === 'user' && message.id === answer.parentId)) return task
}
export function attachMediaTask(chat: NativeChat, task: CreationTask) {
  if (chat.deletedMediaTaskIds?.includes(task.id) || branchMessages(chat).some(message => (message as NativeMessage).taskId === task.id && message.role === 'assistant')) return false
  const question: NativeMessage = { id: `media-user:${task.id}`, role: 'user', content: task.prompt, createdAt: task.createdAt, taskId: task.id }
  const answer: NativeMessage = { id: `media-assistant:${task.id}`, role: 'assistant', content: '', taskId: task.id, parentId: question.id, createdAt: task.createdAt }
  if (task.kind === 'video' && task.mediaBranch) {
    const oldAnswer = chat.messages.find(message => message.role === 'assistant' && message.taskId === task.mediaBranch!.taskId)
    const oldQuestion = oldAnswer && chat.messages.find(message => message.id === oldAnswer.parentId && message.role === 'user')
    if (!oldQuestion) return false
    return task.mediaBranch.edited
      ? createEditedMessageBranch(chat, oldQuestion.id, question, answer, true)
      : createAnswerBranch(chat, oldQuestion.id, answer, true)
  }
  chat.messages.push(question, answer)
  initializeBranches(chat)
  return true
}

// Media bytes and generation/publication state remain in the existing task store.
// The canonical message only references that task, so migration never copies base64.
export async function syncMediaConversations() {
  if (!owner() || !chats.ready || !creation.loaded) return
  const grouped = new Map<string, CreationTask[]>()
  for (const task of creation.tasks) {
    if (task.owner !== owner() || task.kind === 'text' || task.conversationPending) continue
    // Registered mixed turns already belong to their canonical conversation, including archived branches.
    if (chats.sessions.some(chat => chat.deletedMediaTaskIds?.includes(task.id) ||
      (branchMessages(chat) as NativeMessage[]).some(message => message.taskId === task.id))) continue
    const key = mediaKey(task.kind, taskConversationId(task))
    if (chats.deletedMediaConversationIds.includes(key)) continue
    const tasks = grouped.get(key) || []
    tasks.push(task); grouped.set(key, tasks)
  }
  let changed = false
  for (const tasks of grouped.values()) {
    tasks.sort((left, right) => left.createdAt - right.createdAt)
    const first = tasks[0]!, last = tasks.at(-1)!, kind = first.kind as 'image' | 'video'
    const id = taskConversationId(first)
    let chat = mediaChat(kind, id)
    if (!chat) {
      const legacy = createEmptyChat(kind)
      legacy.id = `media:${kind}:${id}`; legacy.mediaConversationId = id
      legacy.lastUpdate = last.createdAt; legacy.topic = (first.prompt || first.model).slice(0, 100)
      legacy.model = last.model; legacy.sourceWorkId = last.sourceWorkId
      chats.sessions.push(legacy); chat = chats.sessions.at(-1)!
      changed = true
    }
    for (const task of tasks) {
      if (task.conversationPending) continue
      if (attachMediaTask(chat, task)) changed = true
    }
    if (chat.topic === '新对话' && !chat.renamed) { chat.topic = (first.prompt || first.model).slice(0, 100); changed = true }
    if (chat.lastUpdate < last.createdAt || !chat.model) {
      chat.lastUpdate = last.createdAt; chat.model = last.model; chat.sourceWorkId = last.sourceWorkId
      changed = true
    }
  }
  if (!chats.mediaConversationsMigrated) {
    chats.sessions.sort((left, right) => right.lastUpdate - left.lastUpdate)
    chats.mediaConversationsMigrated = true; changed = true
  }
  if (changed) await saveChats(true)
}

export function activateConversation(id: string) {
  if (!owner() || !chats.ready) return
  const chat = chats.sessions.find(item => item.id === id)
  if (!chat) return
  chats.activeId = id
  if (conversationKind(chat) !== 'text') creation.selectedId = mediaTasksForConversation(chat)[0]?.id || ''
  void saveChats(true).catch(() => {})
  return chat
}
export function ensureMediaConversation(kind: 'image' | 'video', existingTask?: CreationTask): NativeChat {
  requireReady()
  if (existingTask) {
    if (existingTask.owner !== owner() || existingTask.kind !== kind || !creation.tasks.some(task => task.id === existingTask.id && task.owner === owner())) throw new Error('该生成记录不属于当前账号。')
    const key = mediaKey(kind, taskConversationId(existingTask))
    // Explicitly reopening a gallery item is allowed; ordinary sync respects tombstones.
    if (chats.deletedMediaConversationIds.includes(key)) chats.deletedMediaConversationIds = chats.deletedMediaConversationIds.filter(id => id !== key)
    void syncMediaConversations()
    const containsTask = (chat: NativeChat) => !chat.deletedMediaTaskIds?.includes(existingTask.id) &&
      (branchMessages(chat) as NativeMessage[]).some(message => message.role === 'assistant' && message.taskId === existingTask.id)
    const active = chats.sessions.find(chat => chat.id === chats.activeId && containsTask(chat))
    const existing = active || chats.sessions.find(containsTask) || mediaChat(kind, taskConversationId(existingTask))
    if (existing) { activateConversation(existing.id); creation.selectedId = existingTask.id; return existing }
  } else {
    const active = chats.sessions.find(chat => chat.id === chats.activeId)
    if (active) return active
  }
  return newChat(kind)
}

export async function renameConversation(id: string, title: string) {
  requireReady()
  const value = title.trim()
  if (!value || value.length > 100) throw new Error('会话名称请输入 1 到 100 个字符。')
  const chat = chats.sessions.find(item => item.id === id)
  if (!chat) throw new Error('该会话已不存在。')
  const accepted = owner(), previous = { topic: chat.topic, renamed: chat.renamed }
  chat.topic = value; chat.renamed = true
  try { await saveChats(true) }
  catch (error) { if (accepted === owner() && chat.topic === value) Object.assign(chat, previous); throw error }
}

export async function moveConversations(ids: string[], projectId?: string) {
  requireReady()
  if (projectId !== undefined && !chats.projects.some(project => project.id === projectId)) throw new Error('目标项目已不存在。')
  const selected = new Set(ids), accepted = owner()
  const previous = chats.sessions.filter(chat => selected.has(chat.id) && chat.projectId !== projectId).map(chat => ({ chat, projectId: chat.projectId }))
  if (!previous.length) return
  previous.forEach(({ chat }) => { chat.projectId = projectId })
  try { await saveChats(true) }
  catch (error) {
    if (accepted === owner()) previous.forEach(item => { if (item.chat.projectId === projectId) item.chat.projectId = item.projectId })
    throw error
  }
}

export async function reorderConversation(sourceId: string, targetId: string) {
  requireReady()
  const from = chats.sessions.findIndex(chat => chat.id === sourceId), to = chats.sessions.findIndex(chat => chat.id === targetId)
  if (from < 0 || to < 0 || from === to) return
  if (chats.sessions[from]!.projectId !== chats.sessions[to]!.projectId) throw new Error('请在同一个项目内调整顺序。')
  const previous = chats.sessions, accepted = owner(), next = [...previous]
  const [moving] = next.splice(from, 1); next.splice(to, 0, moving!)
  chats.sessions = next
  const applied = chats.sessions
  try { await saveChats(true) }
  catch (error) { if (accepted === owner() && chats.sessions === applied) chats.sessions = previous; throw error }
}

export async function createConversationProject(name: string) {
  requireReady()
  const parsed = chatProjectNameSchema.safeParse(name)
  if (!parsed.success) throw new Error('项目名称请输入 1 到 80 个字符。')
  const project = { id: crypto.randomUUID(), name: parsed.data, createdAt: Date.now() }, accepted = owner()
  chats.projects.push(project)
  try { await saveChats(true); return project.id }
  catch (error) { if (accepted === owner()) chats.projects = chats.projects.filter(item => item.id !== project.id); throw error }
}
export async function renameConversationProject(id: string, name: string) {
  requireReady()
  const parsed = chatProjectNameSchema.safeParse(name), project = chats.projects.find(item => item.id === id)
  if (!parsed.success) throw new Error('项目名称请输入 1 到 80 个字符。')
  if (!project) throw new Error('该项目已不存在。')
  const accepted = owner(), previous = project.name
  project.name = parsed.data
  try { await saveChats(true) }
  catch (error) { if (accepted === owner() && project.name === parsed.data) project.name = previous; throw error }
}
export async function removeConversationProject(id: string) {
  requireReady()
  const index = chats.projects.findIndex(project => project.id === id)
  if (index < 0) return
  const accepted = owner(), [project] = chats.projects.splice(index, 1)
  const previous = chats.sessions.filter(chat => chat.projectId === id)
  previous.forEach(chat => { chat.projectId = undefined })
  try { await saveChats(true) }
  catch (error) {
    if (accepted === owner()) {
      if (!chats.projects.some(item => item.id === id)) chats.projects.splice(Math.min(index, chats.projects.length), 0, project!)
      previous.forEach(chat => { if (chat.projectId === undefined) chat.projectId = id })
    }
    throw error
  }
}
