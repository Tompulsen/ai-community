import { reactive, watch } from 'vue'
import { api, errorMessage, queryString, session } from './state'

export type InboxCategory = 'announcement' | 'messages' | 'activity'
type NotificationCategory = 'announcement' | 'activity'
interface NotificationPage {
  items: InboxNotification[]
  unreadCounts?: Record<NotificationCategory, number>
  nextCursors?: Record<NotificationCategory, string | null>
  readThrough?: Record<NotificationCategory, string | null>
}
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
  nextCursors: { announcement: null, activity: null } as Record<NotificationCategory, string | null>,
  readThrough: { announcement: null, activity: null } as Record<NotificationCategory, string | null>,
  loadingMore: { announcement: false, activity: false },
  error: '', notificationError: '', messageError: '',
})
let generation = 0, loadedAt = 0, pageRevision = 0
let controller: AbortController | undefined
let pending: Promise<void> | undefined

function invalidate() {
  generation++
  inbox.loadingMore = { announcement: false, activity: false }
  controller?.abort()
  controller = undefined
  pending = undefined
  loadedAt = 0
}
watch(() => session.user?.id, () => {
  invalidate()
  inbox.notifications = []
  inbox.counts = { announcement: 0, messages: 0, activity: 0 }
  inbox.nextCursors = { announcement: null, activity: null }
  inbox.readThrough = { announcement: null, activity: null }
  inbox.loadingMore = { announcement: false, activity: false }
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
function compareNoticeIds(a: string, b: string) {
  if (!a.startsWith('redis:') || !b.startsWith('redis:')) return a < b ? -1 : a > b ? 1 : 0
  const aa = a.slice(6).split('-').map(BigInt), bb = b.slice(6).split('-').map(BigInt)
  return aa[0] === bb[0] ? aa[1]! < bb[1]! ? -1 : aa[1]! > bb[1]! ? 1 : 0 : aa[0]! < bb[0]! ? -1 : 1
}
function mergeNotifications(items: InboxNotification[], keep: InboxNotification[]) {
  inbox.notifications = [...new Map([...keep, ...items].map(item => [item.id, item])).values()].sort((a, b) => compareNoticeIds(b.id, a.id))
}

export async function loadInbox(force = false): Promise<void> {
  if (!session.user) return
  if (pending) return pending
  if (!force && loadedAt && Date.now() - loadedAt < 10000) return
  const current = generation, owner = session.user.id
  pageRevision++
  inbox.loadingMore = { announcement: false, activity: false }
  const request = new AbortController()
  controller = request
  inbox.loading = true
  inbox.notificationError = ''; inbox.messageError = ''; inbox.error = ''
  pending = (async () => {
    const [notices, threads] = await Promise.allSettled([
      api<NotificationPage>('/api/notifications', { signal: request.signal }),
      api<{ items: { unread: number }[]; unreadCount?: number }>('/api/messages/threads', { signal: request.signal }),
    ])
    if (current !== generation || session.user?.id !== owner) return
    if (notices.status === 'fulfilled') {
      // Refresh from the head so hidden/deleted history and pagination gaps cannot survive a refresh.
      mergeNotifications(notices.value.items, [])
      for (const category of ['announcement', 'activity'] as const) {
        const unread = inbox.notifications.filter(item => !item.isRead && notificationCategory(item) === category).length
        inbox.counts[category] = validCount(notices.value.unreadCounts?.[category], unread)
        inbox.nextCursors[category] = notices.value.nextCursors?.[category] ?? null
        inbox.readThrough[category] = notices.value.readThrough?.[category] ?? null
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

export async function loadMoreNotifications(category: NotificationCategory): Promise<void> {
  const cursor = inbox.nextCursors[category], owner = session.user?.id, current = generation, revision = pageRevision
  if (!owner || !cursor || inbox.loadingMore[category] || inbox.loading || inbox.markingRead) return
  inbox.loadingMore[category] = true; inbox.notificationError = ''
  try {
    const result = await api<NotificationPage>('/api/notifications' + queryString({ category, cursor }))
    if (current !== generation || revision !== pageRevision || session.user?.id !== owner) return
    mergeNotifications(result.items, inbox.notifications)
    inbox.nextCursors[category] = result.nextCursors?.[category] ?? null
    inbox.counts[category] = validCount(result.unreadCounts?.[category], inbox.counts[category])
  } catch (cause) { if (current === generation && revision === pageRevision && session.user?.id === owner) inbox.notificationError = errorMessage(cause) }
  finally { if (current === generation && revision === pageRevision && session.user?.id === owner) inbox.loadingMore[category] = false }
}

export async function markAllInboxRead(category: NotificationCategory): Promise<void> {
  const through = inbox.readThrough[category], owner = session.user?.id, current = generation
  if (!owner || !through || inbox.markingRead) return
  inbox.markingRead = true; inbox.notificationError = ''
  try {
    await api('/api/notifications/read-all', { method: 'POST', body: { category, through } })
    if (current !== generation || session.user?.id !== owner) return
    invalidate()
    if (category === 'activity') for (const item of inbox.notifications) if (notificationCategory(item) === category && compareNoticeIds(item.id, `redis:${through}`) <= 0) item.isRead = true
    await loadInbox(true)
  } catch (cause) { if (session.user?.id === owner) inbox.notificationError = errorMessage(cause) }
  finally { if (session.user?.id === owner) inbox.markingRead = false }
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
  } catch (cause) {
    if (session.user?.id === owner) inbox.notificationError = errorMessage(cause)
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
