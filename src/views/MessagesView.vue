<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, ArrowUpRight, Images, MessageSquare, RefreshCw, Search, Send, X } from '@lucide/vue'
import type { Creator, Work, WorkFile } from '../data'
import { api, errorMessage, loadSession, queryString, session } from '../state'

interface Message { id: string; text: string; date: string; owned: boolean; read?: boolean; file?: WorkFile; sharedWorkId?: string }
interface Thread { user: Creator; lastMessage?: Message | null; unread: number; canSend?: boolean; reason?: string }
const route = useRoute()
const userId = computed(() => typeof route.params.userId === 'string' ? route.params.userId : typeof route.query.peer === 'string' ? route.query.peer : '')
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
  threadLoading.value = true
  try {
    const result = await api<{ items: Thread[]; nextCursor?: string | null }>(`/api/messages/threads${queryString({ cursor: append ? threadCursor.value || undefined : undefined })}`, { signal: controller.signal })
    threads.value = append ? [...threads.value, ...result.items] : result.items; threadCursor.value = result.nextCursor || null
  } catch (cause) { if (!controller.signal.aborted) error.value = errorMessage(cause) }
  finally { threadLoading.value = false }
}
async function loadMessages(older = false, quiet = false) {
  if (!session.user || !userId.value || messageLoading.value) return
  const current = pageGeneration
  messageLoading.value = true
  if (!quiet) error.value = ''
  try {
    const result = await api<{ items: Message[]; nextCursor?: string | null; user: Creator; canSend: boolean; reason?: string }>(`/api/messages/${encodeURIComponent(userId.value)}${queryString({ cursor: older ? messageCursor.value || undefined : undefined })}`, { signal: controller.signal })
    if (current !== pageGeneration) return
    user.value = result.user; canSend.value = result.canSend; reason.value = result.reason || ''
    const hadMessages = messages.value.length > 0
    const byId = new Map(messages.value.map(item => [item.id, item])); result.items.forEach(item => byId.set(item.id, item)); messages.value = [...byId.values()]
    if (older || !hadMessages) messageCursor.value = result.nextCursor || null
    if (document.visibilityState === 'visible') void api(`/api/messages/${encodeURIComponent(userId.value)}/read`, { method: 'POST', body: {} }).then(() => { const thread = threads.value.find(item => item.user.id === userId.value); if (thread) thread.unread = 0 }).catch(() => {})
    if (!older && !quiet) { await nextTick(); messageEnd.value?.scrollIntoView({ block: 'nearest' }) }
  } catch (cause) { if (!controller.signal.aborted && current === pageGeneration) error.value = errorMessage(cause) }
  finally { if (current === pageGeneration) messageLoading.value = false }
}
watch(userId, () => { pageGeneration++; messages.value = []; user.value = null; messageCursor.value = null; canSend.value = false; pending.value = null; sendError.value = ''; messageLoading.value = false; void loadMessages() })
onMounted(async () => {
  await loadSession()
  await Promise.all([loadThreads(), loadMessages()])
  poll = setInterval(() => { if (document.visibilityState === 'visible') { void loadThreads(); void loadMessages(false, true) } }, 20000)
})
onBeforeUnmount(() => { controller.abort(); clearInterval(poll); clearTimeout(searchTimer) })
async function send(text: string, sharedWorkId?: string) {
  if (!canSend.value || sending.value || !userId.value) return
  if (!pending.value) pending.value = { text, sharedWorkId, requestId: crypto.randomUUID() }
  sending.value = true; sendError.value = ''
  try {
    const result = await api<{ message: Message }>(`/api/messages/${encodeURIComponent(userId.value)}`, { method: 'POST', body: pending.value, signal: controller.signal })
    if (!messages.value.some(item => item.id === result.message.id)) messages.value.push(result.message)
    pending.value = null; shareDialog.value?.close(); await nextTick(); messageEnd.value?.scrollIntoView({ block: 'nearest' }); void loadThreads()
  } catch (cause) { if (!controller.signal.aborted) sendError.value = errorMessage(cause) }
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
  <div class="page-container messages-page"><div class="page-heading"><h1>私信</h1><button class="icon-button" aria-label="刷新私信" title="刷新私信" :disabled="threadLoading || messageLoading" @click="loadThreads(); loadMessages()"><RefreshCw :size="18" /></button></div>
    <div v-if="!session.user && session.ready" class="empty-state"><MessageSquare :size="28" /><h2>登录后查看私信</h2><RouterLink to="/account" class="button primary">登录</RouterLink></div>
    <div v-else class="messages-layout" :class="{ 'has-conversation': !!userId }"><aside class="thread-pane" aria-label="私信会话"><div v-if="threadLoading && !threads.length" class="empty-state" role="status">正在加载会话…</div><RouterLink v-for="thread in threads" :key="thread.user.id" :to="`/messages/${thread.user.id}`" class="thread-row" :class="{ active: thread.user.id === userId }"><span class="avatar blue"><img v-if="thread.user.avatarUrl" :src="thread.user.avatarUrl" :alt="thread.user.name || thread.user.username" /><span v-else>{{ (thread.user.name || thread.user.username).slice(0, 1) }}</span></span><div><strong>{{ thread.user.name || thread.user.username }}</strong><p>{{ thread.lastMessage?.sharedWorkId ? '分享了一件作品' : thread.lastMessage?.text || '暂无消息' }}</p></div><span v-if="thread.unread" class="unread-badge">{{ thread.unread }}</span></RouterLink><p v-if="!threadLoading && !threads.length" class="form-note">暂无私信会话</p><button v-if="threadCursor" class="button subtle" :disabled="threadLoading" @click="loadThreads(true)">更多会话</button><RouterLink to="/community" class="text-link">查找创作者<ArrowUpRight :size="15" /></RouterLink></aside>
      <section class="conversation-pane" aria-label="私信内容"><template v-if="userId"><div class="conversation-heading"><RouterLink to="/messages" class="icon-button conversation-back" aria-label="返回会话列表"><ArrowLeft :size="18" /></RouterLink><RouterLink v-if="user" :to="{ path: '/community', query: { creator: user.id } }" class="person-link"><span class="avatar blue"><img v-if="user.avatarUrl" :src="user.avatarUrl" :alt="user.name || user.username" /><span v-else>{{ (user.name || user.username).slice(0, 1) }}</span></span><strong>{{ user.name || user.username }}</strong></RouterLink></div>
        <p v-if="error" class="form-error" role="alert">{{ error }} <button class="text-link" @click="loadMessages()">重试</button></p><div class="message-history" role="region" aria-label="消息记录" tabindex="0"><div v-if="messageCursor" class="history-more"><button class="button subtle" :disabled="messageLoading" @click="loadMessages(true)">加载更早消息</button></div><p v-if="messageLoading && !messages.length" class="form-note" role="status">正在加载消息…</p><p v-else-if="!messages.length && !error" class="form-note">暂无消息</p><article v-for="message in orderedMessages" :key="message.id" class="message-row" :class="{ owned: message.owned }"><div class="message-bubble"><RouterLink v-if="message.sharedWorkId" :to="`/work/${message.sharedWorkId}`" class="shared-work"><Images :size="22" /><span>查看分享作品</span><ArrowUpRight :size="16" /></RouterLink><p v-if="message.text">{{ message.text }}</p><a v-if="message.file" :href="message.file.url" target="_blank" rel="noopener noreferrer"><img v-if="message.file.type.startsWith('image/')" :src="message.file.url" :alt="message.file.name" /><span v-else>{{ message.file.name }}</span></a><time class="caption-5">{{ new Date(message.date).toLocaleString('zh-CN') }}<span v-if="message.owned"> · {{ message.read ? '已读' : '未读' }}</span></time></div></article><div ref="messageEnd"></div></div>
        <div class="message-composer"><p v-if="!canSend" class="notice-inline">{{ reason || '互相关注后可分享作品和发送表情。' }}</p><p v-if="sendError" class="form-error" role="alert">{{ sendError }} <button class="text-link" :disabled="sending" @click="send(pending?.text || '', pending?.sharedWorkId)">重试发送</button><button class="text-link" :disabled="sending" @click="pending = null; sendError = ''">取消重试</button></p><div class="emoji-list" aria-label="发送表情"><button v-for="emoji in emojis" :key="emoji" class="icon-button emoji-button" :aria-label="`发送表情 ${emoji}`" :title="`发送 ${emoji}`" :disabled="!canSend || sending || !!pending" @click="send(emoji)">{{ emoji }}</button><button class="button subtle" :disabled="!canSend || sending || !!pending" @click="openShare"><Send :size="16" />分享作品</button></div></div>
      </template><div v-else class="empty-state"><MessageSquare :size="30" /><h2>选择一个会话</h2><p v-if="error" class="form-error" role="alert">{{ error }}</p></div></section>
    </div>
    <dialog ref="shareDialog" class="compact-dialog" aria-labelledby="message-share-heading"><div class="dialog-heading"><h2 id="message-share-heading">分享作品</h2><button class="icon-button" aria-label="关闭作品选择" :disabled="sending" @click="shareDialog?.close()"><X :size="20" /></button></div><div class="dialog-body stack"><label class="search-control"><Search :size="16" /><input v-model="shareQuery" type="search" aria-label="搜索要分享的作品" placeholder="搜索作品" /></label><p v-if="shareError || sendError" class="form-error" role="alert">{{ shareError || sendError }}</p><button v-for="item in shareWorks" :key="item.id" class="share-work-row" :disabled="sending || !!pending" @click="send('', item.id)"><img v-if="item.cover" :src="item.cover" :alt="item.title" /><Images v-else :size="24" /><span><strong>{{ item.title }}</strong><span class="caption-5">{{ item.author }}</span></span><Send :size="16" /></button><p v-if="shareLoading" role="status">正在加载作品…</p><p v-else-if="!shareWorks.length && !shareError" class="form-note">没有匹配的公开作品</p><button v-if="shareCursor" class="button subtle" :disabled="shareLoading" @click="loadShareWorks(true)">加载更多</button></div></dialog>
  </div>
</template>

<style scoped>
.messages-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 480px; height: max(480px, calc(100svh - var(--header-height) - var(--mobile-nav-height) - 160px)); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.thread-pane { padding: 16px 16px 16px 0; border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; overflow-y: auto; }.thread-row { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 6px; }.thread-row.active { background: var(--blue-soft); }.thread-row > div { min-width: 0; flex: 1; }.thread-row p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--muted); }.unread-badge { background: var(--blue); color: white; border-radius: 8px; padding: 0 5px; font-size: 12px; }
.avatar { overflow: hidden; }.avatar img { width: 100%; height: 100%; object-fit: cover; }.conversation-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; }.conversation-heading { padding: 16px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; flex-shrink: 0; }.person-link { display: flex; align-items: center; gap: 12px; min-width: 0; overflow-wrap: anywhere; }.conversation-back { display: none; }
.message-history { min-height: 0; overflow: auto; padding: 24px; flex: 1; }.history-more { text-align: center; margin-bottom: 16px; }.message-row { display: flex; margin-bottom: 16px; }.message-row.owned { justify-content: flex-end; }.message-bubble { max-width: min(80%, 520px); background: var(--surface-soft); padding: 12px; border-radius: 6px; }.owned .message-bubble { background: var(--blue-soft); }.message-bubble p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 20px; }.message-bubble time { display: block; margin-top: 8px; color: var(--muted); }.message-bubble img { max-width: 100%; max-height: 240px; }.shared-work { display: flex; align-items: center; gap: 12px; }.message-composer { padding: 16px 24px; border-top: 1px solid var(--border); flex-shrink: 0; }.emoji-list { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }.emoji-button { font-size: 21px; }.share-work-row { display: flex; align-items: center; gap: 12px; text-align: left; padding: 12px 0; border: 0; border-bottom: 1px solid var(--border); background: transparent; cursor: pointer; }.share-work-row > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }.share-work-row span span { display: block; }.share-work-row img { width: 48px; height: 48px; object-fit: cover; border-radius: 4px; }
@media (max-width: 767px) { .messages-layout { grid-template-columns: 1fr; }.conversation-pane { display: none; }.thread-pane { border-right: 0; padding-right: 0; }.has-conversation .thread-pane { display: none; }.has-conversation .conversation-pane { display: flex; }.conversation-back { display: inline-flex; }.conversation-heading, .message-history, .message-composer { padding: 16px 0; }.message-bubble { max-width: 92%; } }
</style>
