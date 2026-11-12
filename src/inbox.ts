import { reactive, watch } from 'vue'
import { api, errorMessage, session } from './state'

export type InboxCategory = 'announcement' | 'messages' | 'activity'
export interface InboxNotification {
  id: string
  type?: 'announcement' | 'activity' | 'message'
  title?: string
  text?: string
  body?: string
  createdAt?: string | null
  isRead?: boolean
  url?: string
  actor?: { id: string; name?: string; username?: string; avatarUrl?: string | null }
}

export const inbox = reactive({
  notifications: [] as InboxNotification[],
  counts: { announcement: 0, messages: 0, activity: 0 },
  loading: false, markingRead: false,
  error: '', notificationError: '', messageError: '',
})
let generation = 0, loadedAt = 0
let controller: AbortController | undefined
let pending: Promise<void> | undefined

function invalidate() {
  generation++
  controller?.abort()
  controller = undefined
  pending = undefined
  loadedAt = 0
}
watch(() => session.user?.id, () => {
  invalidate()
  inbox.notifications = []
  inbox.counts = { announcement: 0, messages: 0, activity: 0 }
  inbox.loading = false; inbox.markingRead = false
  inbox.error = ''; inbox.notificationError = ''; inbox.messageError = ''
}, { flush: 'sync' })

export function notificationCategory(item: InboxNotification): 'announcement' | 'activity' | 'message' {
  if (item.type) return item.type
  return item.id.startsWith('redis:') ? 'activity' : 'announcement'
}
export function notificationDestination(item: InboxNotification): string {
  if (notificationCategory(item) === 'announcement') return '/community?tab=announcements'
  if (item.url && /^\/(?:work\/|community(?:\?|$)|messages(?:\/|\?|$)|library(?:\?|$)|activities(?:\?|$)|account(?:\?|$))/.test(item.url)) return item.url
  return item.actor?.id ? `/community?creator=${encodeURIComponent(item.actor.id)}` : '/community'
}
const validCount = (value: unknown, fallback: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback

export async function loadInbox(force = false): Promise<void> {
  if (!session.user) return
  if (pending) return pending
  if (!force && loadedAt && Date.now() - loadedAt < 10000) return
  const current = generation, owner = session.user.id
  const request = new AbortController()
  controller = request
  inbox.loading = true
  inbox.notificationError = ''; inbox.messageError = ''; inbox.error = ''
  pending = (async () => {
    const [notices, threads] = await Promise.allSettled([
      api<{ items: InboxNotification[]; unreadCounts?: { announcement: number; activity: number } }>('/api/notifications', { signal: request.signal }),
      api<{ items: { unread: number }[]; unreadCount?: number }>('/api/messages/threads', { signal: request.signal }),
    ])
    if (current !== generation || session.user?.id !== owner) return
    if (notices.status === 'fulfilled') {
      inbox.notifications = notices.value.items
      for (const category of ['announcement', 'activity'] as const) {
        const unread = inbox.notifications.filter(item => !item.isRead && notificationCategory(item) === category).length
        inbox.counts[category] = validCount(notices.value.unreadCounts?.[category], unread)
      }
    } else inbox.notificationError = errorMessage(notices.reason)
    if (threads.status === 'fulfilled') {
      const fallback = threads.value.items.reduce((total, thread) => total + validCount(thread.unread, 0), 0)
      inbox.counts.messages = validCount(threads.value.unreadCount, fallback)
    } else inbox.messageError = errorMessage(threads.reason)
    inbox.error = inbox.notificationError || inbox.messageError
    if (!inbox.error) loadedAt = Date.now()
  })().finally(() => {
    if (current === generation) { inbox.loading = false; controller = undefined; pending = undefined }
  })
  return pending
}

export async function markInboxRead(ids: string[]): Promise<void> {
  if (!session.user || !ids.length || inbox.markingRead) return
  const owner = session.user.id, current = generation
  inbox.markingRead = true
  try {
    await api('/api/notifications/read', { method: 'POST', body: { ids } })
    if (current !== generation || session.user?.id !== owner) return
    invalidate()
    inbox.loading = false
    const selected = new Set(ids)
    for (const item of inbox.notifications) {
      if (!selected.has(item.id) || item.isRead) continue
      const category = notificationCategory(item)
      if (category !== 'message') inbox.counts[category] = Math.max(0, inbox.counts[category] - 1)
      item.isRead = true
    }
  } finally {
    if (session.user?.id === owner) inbox.markingRead = false
  }
}

export async function markDirectRead(peerId: string): Promise<void> {
  if (!session.user) return
  const owner = session.user.id, current = generation
  await api(`/api/messages/${encodeURIComponent(peerId)}/read`, { method: 'POST', body: {} })
  if (current !== generation || session.user?.id !== owner) return
  invalidate()
  await loadInbox(true)
}
