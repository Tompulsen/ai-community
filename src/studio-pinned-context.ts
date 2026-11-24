import { branchMessages } from '../shared/studio/chat-branches'
import { MAX_IMAGE_CONTEXT_IMAGES, MAX_IMAGE_CONTEXT_TEXT, MAX_IMAGE_CONTEXT_TURNS, type ImageConversationTurn } from '../shared/studio/image-conversation'
import type { NativeChat, NativeMessage } from './native-chat'
import type { CreationTask } from './native-studio'

export function readPinnedMessageIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 160))].slice(0, MAX_IMAGE_CONTEXT_TURNS) : []
}
// Store only message IDs in the account's existing chat store. Images stay in the task store.
export function pinnedContext(chat: NativeChat, tasks: CreationTask[], owner: string) {
  const nodes = new Map((branchMessages(chat) as NativeMessage[]).map(message => [message.id, message]))
  return readPinnedMessageIds(chat.pinnedMessageIds).flatMap(id => {
    const message = nodes.get(id)
    if (!message || !['user', 'assistant'].includes(message.role) || message.streaming || message.error || message.interrupted) return []
    const task = tasks.find(task => task.id === message.taskId && task.owner === owner && task.kind !== 'text')
    if (message.taskId && tasks.some(task => task.id === message.taskId && task.kind !== 'text') && !task) return []
    if (task?.kind === 'video' || task && (chat.deletedMediaTaskIds?.includes(task.id) || message.role === 'assistant' && task.phase !== 'complete')) return []
    const text = task ? task.prompt : typeof message.content === 'string' ? message.content : message.content.flatMap(part => part.type === 'text' ? [part.text || ''] : []).join('\n')
    return text.trim() ? [{ message, task, text }] : []
  })
}
export function pinnedImageTurns(entries: ReturnType<typeof pinnedContext>) {
  const turns = new Map<string, ImageConversationTurn>()
  // Pinning both sides of a media turn must not duplicate its prompt or images.
  for (const { message, task, text } of entries) {
    const key = task?.id || message.id
    const previous = turns.get(key)
    if (previous?.images.length) continue
    const images = task ? message.role === 'assistant' ? task.urls : [] : []
    const references = task ? task.references.map(file => file.url) : typeof message.content === 'string' ? [] : message.content.flatMap(part => part.type === 'image_url' && part.image_url?.url ? [part.image_url.url] : [])
    turns.set(key, { prompt: text, images: [...new Set(images)], ...(references.length ? { references: [...new Set(references)] } : {}) })
  }
  return [...turns.values()]
}
export function validatePinnedContext(entries: ReturnType<typeof pinnedContext>) {
  const turns = pinnedImageTurns(entries)
  if (entries.length > MAX_IMAGE_CONTEXT_TURNS || turns.reduce((total, turn) => total + Array.from(turn.prompt).length, 0) > MAX_IMAGE_CONTEXT_TEXT ||
    turns.reduce((total, turn) => total + turn.images.length + (turn.references?.length || 0), 0) > MAX_IMAGE_CONTEXT_IMAGES)
    throw new Error('固定内容最多 20 条、16 张图片和 32000 字，请先取消部分固定。')
  return entries
}
