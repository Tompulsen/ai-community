<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ArrowLeft, ArrowUpRight, Bell, CheckCheck, Images, MessageSquare, RefreshCw, Search, Send, X } from '@lucide/vue'
import type { Creator, Work, WorkFile } from '../data'
import { api, errorMessage, loadSession, queryString, session } from '../state'
import { inbox, loadInbox, loadMoreNotifications, markAllInboxRead, markDirectRead, markInboxRead, notificationCategory, notificationDestination, type InboxCategory } from '../inbox'

interface Message { id: string; text: string; date: string; owned: boolean; read?: boolean; file?: WorkFile; sharedWorkId?: string }
interface Thread { user: Creator; lastMessage?: Message | null; unread: number; canSend?: boolean; reason?: string }
const props = defineProps<{ embedded?: boolean; category?: InboxCategory }>()
const route = useRoute()
const floatingTab = ref<InboxCategory>(props.category || 'messages'), floatingPeer = ref('')
watch(() => props.category, category => { if (category) { floatingTab.value = category; floatingPeer.value = '' } })
const userId = computed(() => props.embedded ? floatingPeer.value : typeof route.params.userId === 'string' ? route.params.userId : typeof route.query.peer === 'string' ? route.query.peer : '')
const categories = [
  { value: 'announcement', label: '公告', to: '/messages?tab=announcement' },
  { value: 'messages', label: '我的消息', to: '/messages' },
  { value: 'activity', label: '互动消息', to: '/messages?tab=activity' },
] as const
const activeTab = computed(() => props.embedded ? floatingTab.value : !userId.value && (route.query.tab === 'announcement' || route.query.tab === 'activity') ? route.query.tab : 'messages')
function selectCategory(category: InboxCategory) { if (props.embedded) { floatingPeer.value = ''; floatingTab.value = category } }
function selectPeer(id: string) { if (props.embedded) floatingPeer.value = id }
const currentCategory = computed(() => categories.find(item => item.value === activeTab.value)!)
const notifications = computed(() => inbox.notifications.filter(item => notificationCategory(item) === activeTab.value))
const threads = ref<Thread[]>([]), threadCursor = ref<string | null>(null), threadLoading = ref(false)
const user = ref<Creator | null>(null), messages = ref<Message[]>([]), messageCursor = ref<string | null>(null), messageLoading = ref(false)
const canSend = ref(false), reason = ref(''), error = ref(''), sendError = ref(''), sending = ref(false)
const pending = ref<{ text: string; sharedWorkId?: string; requestId: string } | null>(null)
const messageEnd = ref<HTMLElement>(), shareDialog = ref<HTMLDialogElement>()
const shareWorks = ref<Work[]>([]), shareQuery = ref(''), shareCursor = ref<string | null>(null), shareLoading = ref(false), shareError = ref('')
const emojis = ['👍', '❤️', '👏', '🎉', '😊', '🙏', '🔥', '👀']
const controller = new AbortController()
let poll: ReturnType<typeof setInterval> | undefined, searchTimer: ReturnType<typeof setTimeout> | undefined
let pageGeneration = 0, searchGeneration = 0
const orderedMessages = computed(() => [...messages.value].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)))
async function loadThreads(append = false) {
  if (!session.user || threadLoading.value) return
  const owner = session.user.id
  threadLoading.value = true
  try {
    const result = await api<{ items: Thread[]; nextCursor?: string | null }>(`/api/messages/threads${queryString({ cursor: append ? threadCursor.value || undefined : undefined })}`, { signal: controller.signal })
    if (owner !== session.user?.id) return
    threads.value = append ? [...threads.value, ...result.items] : result.items; threadCursor.value = result.nextCursor || null
  } catch (cause) { if (!controller.signal.aborted && owner === session.user?.id) error.value = errorMessage(cause) }
  finally { if (owner === session.user?.id) threadLoading.value = false }
}
async function loadMessages(older = false, quiet = false) {
  if (!session.user || activeTab.value !== 'messages' || !userId.value || messageLoading.value) return
  const current = pageGeneration, peerId = userId.value
  messageLoading.value = true
  if (!quiet) error.value = ''
  try {
    const result = await api<{ items: Message[]; nextCursor?: string | null; user: Creator; canSend: boolean; reason?: string }>(`/api/messages/${encodeURIComponent(peerId)}${queryString({ cursor: older ? messageCursor.value || undefined : undefined })}`, { signal: controller.signal })
    if (current !== pageGeneration) return
    user.value = result.user; canSend.value = result.canSend; reason.value = result.reason || ''
    const hadMessages = messages.value.length > 0
    const byId = new Map(messages.value.map(item => [item.id, item])); result.items.forEach(item => byId.set(item.id, item)); messages.value = [...byId.values()]
    if (older || !hadMessages) messageCursor.value = result.nextCursor || null
    if (document.visibilityState === 'visible') void markDirectRead(peerId).then(() => {
      if (current !== pageGeneration) return
      const thread = threads.value.find(item => item.user.id === peerId)
      if (thread) thread.unread = 0
    }).catch(() => {})
    if (!older && !quiet) { await nextTick(); messageEnd.value?.scrollIntoView({ block: 'nearest' }) }
  } catch (cause) { if (!controller.signal.aborted && current === pageGeneration) error.value = errorMessage(cause) }
  finally { if (current === pageGeneration) messageLoading.value = false }
}
watch([userId, () => session.user?.id], (next, previous) => {
  pageGeneration++; messages.value = []; user.value = null; messageCursor.value = null; canSend.value = false; pending.value = null; error.value = ''; sendError.value = ''; messageLoading.value = false
  if (next[1] !== previous?.[1]) {
    threads.value = []; threadCursor.value = null; threadLoading.value = false
    searchGeneration++; shareWorks.value = []; shareCursor.value = null; shareDialog.value?.close()
    if (activeTab.value === 'messages') void loadThreads()
  }
  void loadMessages()
})
watch(activeTab, tab => {
  if (!session.user) return
  if (tab === 'messages') { void loadThreads(); void loadMessages() }
  else void loadInbox(true)
})
onMounted(async () => {
  await loadSession()
  if (controller.signal.aborted) return
  await Promise.all([loadInbox(true), ...(activeTab.value === 'messages' ? [loadThreads(), loadMessages()] : [])])
  if (controller.signal.aborted) return
  poll = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    void loadInbox()
    if (activeTab.value === 'messages') { void loadThreads(); void loadMessages(false, true) }
  }, 20000)
})
onBeforeUnmount(() => { pageGeneration++; searchGeneration++; controller.abort(); clearInterval(poll); clearTimeout(searchTimer); shareDialog.value?.close() })
function refresh() {
  void loadInbox(true)
  if (activeTab.value === 'messages') { void loadThreads(); void loadMessages() }
}
async function send(text: string, sharedWorkId?: string) {
  if (!canSend.value || sending.value || !userId.value) return
  const current = pageGeneration, peerId = userId.value
  if (!pending.value) pending.value = { text, sharedWorkId, requestId: crypto.randomUUID() }
  sending.value = true; sendError.value = ''
  try {
    const result = await api<{ message: Message }>(`/api/messages/${encodeURIComponent(peerId)}`, { method: 'POST', body: pending.value, signal: controller.signal })
    if (current !== pageGeneration) return
    if (!messages.value.some(item => item.id === result.message.id)) messages.value.push(result.message)
    pending.value = null; shareDialog.value?.close(); await nextTick(); messageEnd.value?.scrollIntoView({ block: 'nearest' }); void loadThreads()
  } catch (cause) { if (!controller.signal.aborted && current === pageGeneration) sendError.value = errorMessage(cause) }
  finally { sending.value = false }
}
async function loadShareWorks(append = false) {
  const current = ++searchGeneration
  shareLoading.value = true; shareError.value = ''
  try {
    const result = await api<{ items: Work[]; nextCursor?: string | null }>(`/api/works${queryString({ query: shareQuery.value.trim(), cursor: append ? shareCursor.value || undefined : undefined })}`, { signal: controller.signal })
    if (current === searchGeneration) { shareWorks.value = append ? [...shareWorks.value, ...result.items] : result.items; shareCursor.value = result.nextCursor || null }
  } catch (cause) { if (!controller.signal.aborted && current === searchGeneration) shareError.value = errorMessage(cause) }
  finally { if (current === searchGeneration) shareLoading.value = false }
}
watch(shareQuery, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { void loadShareWorks() }, 200) })
function openShare() { shareDialog.value?.showModal(); void loadShareWorks() }
</script>

<template>
  <div class="page-container messages-page" :class="{ embedded }"><div class="page-heading"><h1>{{ embedded ? '消息中心' : '消息' }}</h1><div v-if="session.user" class="inbox-actions"><button v-if="activeTab !== 'messages'" class="button subtle btn" :disabled="inbox.markingRead || inbox.loading || !inbox.counts[activeTab] || !inbox.readThrough[activeTab]" @click="markAllInboxRead(activeTab)"><CheckCheck :size="17" />全部标记已读</button><button class="icon-button" aria-label="刷新消息" title="刷新消息" :disabled="inbox.loading || activeTab === 'messages' && (threadLoading || messageLoading)" @click="refresh"><RefreshCw :size="18" /></button><slot name="close" /></div></div>
    <nav v-if="session.user" class="tabs inbox-categories" aria-label="消息分类"><component :is="embedded ? 'button' : RouterLink" v-for="item in categories" :key="item.value" :to="embedded ? undefined : item.to" :type="embedded ? 'button' : undefined" class="tab" :class="{ active: activeTab === item.value }" :aria-current="activeTab === item.value ? 'page' : undefined" @click="selectCategory(item.value)"><span>{{ item.label }}</span><span v-if="inbox.counts[item.value]" class="unread-badge" :aria-label="`${inbox.counts[item.value]} 条未读`">{{ inbox.counts[item.value] > 99 ? '99+' : inbox.counts[item.value] }}</span></component></nav>
    <div v-if="!session.user && session.ready" class="empty-state"><MessageSquare :size="28" /><h2>登录后查看消息</h2><RouterLink :to="{ path: '/account', query: { returnTo: route.fullPath } }" class="button primary btn">登录</RouterLink></div>
    <section v-else-if="activeTab !== 'messages'" class="inbox-panel" :aria-label="currentCategory.label">
      <p v-if="inbox.notificationError" class="form-error" role="alert">{{ inbox.notificationError }} <button class="text-link" :disabled="inbox.loading" @click="loadInbox(true)">重试</button></p>
      <div v-if="inbox.loading && !notifications.length" class="empty-state" role="status">正在加载消息…</div>
      <div v-else-if="!notifications.length && !inbox.notificationError" class="empty-state"><Bell :size="28" /><h2>暂无{{ currentCategory.label }}</h2></div>
      <article v-for="item in notifications" :key="item.id" class="inbox-notification" :class="{ unread: !item.isRead }">
        <RouterLink v-if="item.actor" :to="{ path: '/community', query: { creator: item.actor.id } }" class="inbox-actor" @click="!item.isRead && markInboxRead([item.id])"><span class="avatar blue"><img v-if="item.actor.avatarUrl" :src="item.actor.avatarUrl" :alt="item.actor.name || item.actor.username" /><span v-else>{{ (item.actor.name || item.actor.username || '用').slice(0, 1) }}</span></span></RouterLink>
        <RouterLink :to="notificationDestination(item)" class="inbox-notification-link" @click="!item.isRead && markInboxRead([item.id])"><strong>{{ item.title || currentCategory.label }}</strong><p v-if="item.text || item.body">{{ item.text || item.body }}</p><time v-if="item.createdAt" class="caption-5">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</time></RouterLink>
        <span v-if="!item.isRead" class="inbox-unread" aria-label="未读">未读</span>
      </article>
      <div class="notification-pagination"><button v-if="inbox.nextCursors[activeTab]" class="button btn" :disabled="inbox.loadingMore[activeTab] || inbox.loading || inbox.markingRead" @click="loadMoreNotifications(activeTab)">{{ inbox.loadingMore[activeTab] ? '正在加载…' : '加载更早通知' }}</button><p v-if="activeTab === 'activity' && notifications.length" class="form-note">显示当前保留的互动通知；全部已读仅处理本次查看时已有的通知。</p></div>
    </section>
    <div v-else class="messages-layout" :class="{ 'has-conversation': !!userId }"><aside class="thread-pane" aria-label="私信会话"><div v-if="threadLoading && !threads.length" class="empty-state" role="status">正在加载会话…</div><component :is="embedded ? 'button' : RouterLink" v-for="thread in threads" :key="thread.user.id" :to="embedded ? undefined : `/messages/${thread.user.id}`" :type="embedded ? 'button' : undefined" class="thread-row" :class="{ active: thread.user.id === userId }" @click="selectPeer(thread.user.id)"><span class="avatar blue"><img v-if="thread.user.avatarUrl" :src="thread.user.avatarUrl" :alt="thread.user.name || thread.user.username" /><span v-else>{{ (thread.user.name || thread.user.username).slice(0, 1) }}</span></span><div><strong>{{ thread.user.name || thread.user.username }}</strong><p>{{ thread.lastMessage?.sharedWorkId ? '分享了一件作品' : thread.lastMessage?.text || '暂无消息' }}</p></div><span v-if="thread.unread" class="unread-badge">{{ thread.unread }}</span></component><p v-if="!threadLoading && !threads.length" class="form-note">暂无私信会话</p><button v-if="threadCursor" class="button subtle btn" :disabled="threadLoading" @click="loadThreads(true)">更多会话</button><RouterLink to="/community" class="text-link">查找创作者<ArrowUpRight :size="15" /></RouterLink></aside>
      <section class="conversation-pane" aria-label="私信内容"><template v-if="userId"><div class="conversation-heading"><component :is="embedded ? 'button' : RouterLink" :to="embedded ? undefined : '/messages'" :type="embedded ? 'button' : undefined" class="icon-button conversation-back" aria-label="返回会话列表" @click="selectPeer('')"><ArrowLeft :size="18" /></component><RouterLink v-if="user" :to="{ path: '/community', query: { creator: user.id } }" class="person-link"><span class="avatar blue"><img v-if="user.avatarUrl" :src="user.avatarUrl" :alt="user.name || user.username" /><span v-else>{{ (user.name || user.username).slice(0, 1) }}</span></span><strong>{{ user.name || user.username }}</strong></RouterLink></div>
        <p v-if="error" class="form-error" role="alert">{{ error }} <button class="text-link" @click="loadMessages()">重试</button></p><div class="message-history" role="region" aria-label="消息记录" tabindex="0"><div v-if="messageCursor" class="history-more"><button class="button subtle btn" :disabled="messageLoading" @click="loadMessages(true)">加载更早消息</button></div><p v-if="messageLoading && !messages.length" class="form-note" role="status">正在加载消息…</p><p v-else-if="!messages.length && !error" class="form-note">暂无消息</p><article v-for="message in orderedMessages" :key="message.id" class="message-row" :class="{ owned: message.owned }"><div class="message-bubble"><RouterLink v-if="message.sharedWorkId" :to="`/work/${message.sharedWorkId}`" class="shared-work"><Images :size="22" /><span>查看分享作品</span><ArrowUpRight :size="16" /></RouterLink><p v-if="message.text">{{ message.text }}</p><a v-if="message.file" :href="message.file.url" target="_blank" rel="noopener noreferrer"><img v-if="message.file.type.startsWith('image/')" :src="message.file.url" :alt="message.file.name" /><span v-else>{{ message.file.name }}</span></a><time class="caption-5">{{ new Date(message.date).toLocaleString('zh-CN') }}<span v-if="message.owned"> · {{ message.read ? '已读' : '未读' }}</span></time></div></article><div ref="messageEnd"></div></div>
        <div class="message-composer"><p v-if="!canSend" class="notice-inline">{{ reason || '互相关注后可分享作品和发送表情。' }}</p><p v-if="sendError" class="form-error" role="alert">{{ sendError }} <button class="text-link" :disabled="sending" @click="send(pending?.text || '', pending?.sharedWorkId)">重试发送</button><button class="text-link" :disabled="sending" @click="pending = null; sendError = ''">取消重试</button></p><div class="emoji-list" aria-label="发送表情"><button v-for="emoji in emojis" :key="emoji" class="icon-button emoji-button" :aria-label="`发送表情 ${emoji}`" :title="`发送 ${emoji}`" :disabled="!canSend || sending || !!pending" @click="send(emoji)">{{ emoji }}</button><button class="button subtle btn" :disabled="!canSend || sending || !!pending" @click="openShare"><Send :size="16" />分享作品</button></div></div>
      </template><div v-else class="empty-state"><MessageSquare :size="30" /><h2>选择一个会话</h2><p v-if="error" class="form-error" role="alert">{{ error }}</p></div></section>
    </div>
    <dialog ref="shareDialog" class="compact-dialog" aria-labelledby="message-share-heading"><div class="dialog-heading"><h2 id="message-share-heading">分享作品</h2><button class="icon-button" aria-label="关闭作品选择" :disabled="sending" @click="shareDialog?.close()"><X :size="20" /></button></div><div class="dialog-body stack"><label class="search-control"><Search :size="16" /><input v-model="shareQuery" type="search" aria-label="搜索要分享的作品" placeholder="搜索作品" /></label><p v-if="shareError || sendError" class="form-error" role="alert">{{ shareError || sendError }}</p><button v-for="item in shareWorks" :key="item.id" class="share-work-row" :disabled="sending || !!pending" @click="send('', item.id)"><img v-if="item.cover" :src="item.cover" :alt="item.title" /><Images v-else :size="24" /><span><strong>{{ item.title }}</strong><span class="caption-5">{{ item.author }}</span></span><Send :size="16" /></button><p v-if="shareLoading" role="status">正在加载作品…</p><p v-else-if="!shareWorks.length && !shareError" class="form-note">没有匹配的公开作品</p><button v-if="shareCursor" class="button subtle btn" :disabled="shareLoading" @click="loadShareWorks(true)">加载更多</button></div></dialog>
  </div>
</template>

<style scoped>
.messages-page { max-width: 1280px; }
.messages-page.embedded { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 24px; }
.embedded > .page-heading { flex: none; min-height: 44px; margin-bottom: 16px; gap: 12px; }
.embedded > .page-heading h1 { font-size: 20px; line-height: 28px; }
.embedded > .inbox-categories { flex: none; margin-bottom: 16px; }
.embedded > .inbox-panel { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.embedded > .messages-layout { flex: 1; min-height: 0; height: auto; }
.embedded .thread-row { width: 100%; text-align: left; }
.notification-pagination { display: grid; justify-items: center; gap: 12px; padding-block: 24px; }
.inbox-actions { display: flex; align-items: center; gap: 8px; }
.inbox-categories { gap: 32px; }
.inbox-panel { min-height: 480px; border-top: 1px solid var(--border); }
.inbox-panel > .form-error { padding-block: 16px; }
.inbox-notification { display: flex; align-items: flex-start; gap: 16px; padding: 24px 16px; border-bottom: 1px solid var(--border); min-width: 0; }
.inbox-notification.unread { background: var(--surface); }
.inbox-actor { flex-shrink: 0; }
.inbox-notification-link { display: block; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.inbox-notification-link strong { display: block; color: var(--ink); font-size: 14px; line-height: 24px; font-weight: 500; }
.inbox-notification-link p { margin-top: 8px; max-width: 72ch; color: var(--muted); white-space: pre-wrap; font-size: 14px; line-height: 24px; }
.inbox-notification-link time { display: block; margin-top: 12px; }
.inbox-notification-link:hover strong { color: var(--blue); }
.inbox-unread { flex-shrink: 0; font-size: 12px; line-height: 24px; color: var(--blue); }
.messages-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 480px; height: max(480px, calc(100svh - var(--header-height) - var(--mobile-nav-height) - 160px)); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--canvas); }
.thread-pane { padding: 12px; border-right: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; gap: 4px; min-width: 0; min-height: 0; overflow-y: auto; }
.thread-row { display: flex; align-items: center; flex-shrink: 0; gap: 12px; padding: 12px; min-height: 72px; border: 1px solid transparent; border-radius: 4px; }
.thread-row:hover { background: var(--surface-soft); }
.thread-row.active { background: var(--surface-soft); border-color: var(--focus-ring); }
.thread-row > div { min-width: 0; flex: 1; }
.thread-row strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; font-weight: 500; }
.thread-row p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 20px; color: var(--muted); margin-top: 4px; }
.thread-pane > .text-link { margin-top: auto; padding: 16px 12px 4px; font-size: 12px; }
.thread-pane > .form-note { padding: 12px; }
.unread-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; min-height: 20px; background: var(--blue); color: var(--action-ink); border-radius: 6px; padding: 0 5px; font-size: 12px; font-variant-numeric: tabular-nums; }
.avatar { flex-shrink: 0; width: 36px; height: 36px; overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.conversation-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.conversation-heading { padding: 16px 24px; min-height: 72px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.person-link { display: flex; align-items: center; gap: 12px; min-width: 0; overflow-wrap: anywhere; }
.person-link strong { font-size: 14px; line-height: 20px; font-weight: 500; }
.conversation-back { display: none; }
.conversation-pane > .form-error { margin: 16px 24px 0; }
.message-history { min-height: 0; overflow: auto; padding: 24px; flex: 1; scrollbar-gutter: stable; }
.history-more { text-align: center; margin-bottom: 20px; }
.message-row { display: flex; margin-bottom: 16px; }
.message-row.owned { justify-content: flex-end; }
.message-bubble { min-width: 0; max-width: min(82%, 520px); background: var(--surface); padding: 12px 16px; border-radius: 6px; }
.owned .message-bubble { background: var(--blue-soft); }
.message-bubble p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; line-height: 24px; }
.message-bubble time { display: block; margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 20px; }
.message-bubble img { max-width: 100%; max-height: 240px; border-radius: 4px; }
.message-bubble a { overflow-wrap: anywhere; }
.shared-work { display: flex; align-items: center; gap: 12px; min-height: 44px; font-size: 14px; }
.shared-work > span { flex: 1; }
.shared-work > svg { flex-shrink: 0; }
.message-composer { padding: 16px 20px; border-top: 1px solid var(--border); background: var(--surface); flex-shrink: 0; }
.message-composer > p { margin-top: 0; margin-bottom: 12px; }
.emoji-list { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.emoji-button { width: 40px; height: 40px; font-size: 21px; }
.emoji-list > .button { margin-left: auto; }
.share-work-row { display: flex; align-items: center; gap: 12px; text-align: left; padding: 12px 0; min-width: 0; border: 0; border-bottom: 1px solid var(--border); background: transparent; cursor: pointer; }
.share-work-row > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.share-work-row > svg { flex-shrink: 0; }
.share-work-row strong { font-size: 14px; line-height: 20px; font-weight: 500; }
.share-work-row span span { display: block; margin-top: 4px; color: var(--muted); }
.share-work-row img { width: 48px; height: 48px; flex-shrink: 0; object-fit: cover; border-radius: 4px; }
@media (max-width: 999px) {
  .messages-layout { grid-template-columns: 248px minmax(0, 1fr); }
  .emoji-list > .button { margin-left: 4px; }
}
@media (max-width: 767px) {
  .messages-page.embedded { padding: 16px 12px; }
  .embedded .inbox-actions { flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
  .embedded .inbox-actions > .button { font-size: 12px; padding-inline: 8px; }
  .inbox-categories { gap: 20px; }
  .inbox-categories .tab { gap: 6px; }
  .inbox-notification { gap: 12px; padding: 20px 12px; }
  .messages-layout { grid-template-columns: 1fr; }
  .conversation-pane { display: none; }
  .thread-pane { border-right: 0; padding: 8px; }
  .has-conversation .thread-pane { display: none; }
  .has-conversation .conversation-pane { display: flex; }
  .conversation-back { display: inline-flex; }
  .conversation-heading { padding: 12px; min-height: 68px; }
  .message-history { padding: 20px 12px; }
  .message-composer { padding: 12px; }
  .message-bubble { max-width: 92%; padding: 12px; }
  .emoji-button { width: 44px; height: 44px; }
  .emoji-list > .button { margin: 8px 0 0; width: 100%; }
  .conversation-pane > .form-error { margin: 12px 12px 0; }
}
</style>
