<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Aperture, Bell, Bookmark, CheckCheck, ChevronDown, Compass, Gift, Images, LogIn, LogOut, MessageSquare, Plus, RefreshCw, Settings, ShieldCheck, Users, WandSparkles } from '@lucide/vue'
import WorkEditor from './components/WorkEditor.vue'
import BackgroundStudio from './components/BackgroundStudio.vue'
import type { Work } from './data'
import { api, errorMessage, loadSession, logout, notice, notify, rememberLotteryInvite, session } from './state'

interface Notification { id: string; title?: string; text?: string; body?: string; createdAt?: string; isRead?: boolean; url?: string; actor?: { id: string; name?: string; username?: string; avatarUrl?: string } }
const route = useRoute(), router = useRouter()
const links = [
  { path: '/discover', label: '发现', icon: Compass },
  { path: '/create', label: '创作', icon: WandSparkles },
  { path: '/library', label: '我的作品', icon: Images },
  { path: '/activities', label: '活动', icon: Gift },
]
function isCurrent(path: string) {
  return route.path === path || (path === '/create' && route.path.startsWith('/create/')) || (path === '/discover' && route.path.startsWith('/work/'))
}
const signingOut = ref(false), publicationNavigation = ref(false)
const notifications = ref<Notification[]>([]), notificationError = ref(''), notificationsLoading = ref(false), markingRead = ref(false)
const unreadCount = computed(() => notifications.value.filter(item => !item.isRead).length)
let poll: ReturnType<typeof setInterval> | undefined
let notificationGeneration = 0
onMounted(() => { rememberLotteryInvite(route.query.invite); void loadSession() })
onBeforeUnmount(() => { clearInterval(poll); notificationGeneration++ })
watch(() => route.fullPath, () => document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { menu.open = false }))
watch(() => session.user?.id, id => {
  clearInterval(poll); notificationGeneration++; notifications.value = []; notificationError.value = ''; notificationsLoading.value = false
  if (!id) return
  void loadNotifications()
  poll = setInterval(() => { if (document.visibilityState === 'visible') void loadNotifications() }, 45000)
})
function closePublish() {
  if (publicationNavigation.value || route.query.publish !== '1') return
  const { publish: _, ...query } = route.query
  void router.replace({ path: route.path, query, hash: route.hash })
}
async function published(work: Work) {
  publicationNavigation.value = true
  try { await router.push({ path: '/library', query: { tab: work.status === 'draft' ? 'draft' : work.status === 'pending' ? 'pending' : 'all' } }) }
  finally { publicationNavigation.value = false }
}
async function signOut() {
  signingOut.value = true
  try { await logout(); await router.push('/discover'); notify('已退出登录。') }
  catch (cause) { notify(errorMessage(cause)) }
  finally { signingOut.value = false }
}
async function loadNotifications() {
  if (!session.user || notificationsLoading.value) return
  const current = notificationGeneration
  notificationsLoading.value = true; notificationError.value = ''
  try { const result = await api<{ items: Notification[] }>('/api/notifications'); if (current === notificationGeneration) notifications.value = result.items }
  catch (cause) { if (current === notificationGeneration) notificationError.value = errorMessage(cause) }
  finally { if (current === notificationGeneration) notificationsLoading.value = false }
}
function destination(item: Notification) {
  if (item.url === '/community' && !item.actor && !item.id.startsWith('redis:')) return '/community?tab=announcements'
  if (item.url && /^\/(work\/|community(?:\?|$)|messages(?:\/|\?|$)|library(?:\?|$)|activities(?:\?|$)|account(?:\?|$))/.test(item.url)) return item.url
  return item.actor?.id ? `/community?creator=${encodeURIComponent(item.actor.id)}` : '/library'
}
async function markRead(ids: string[]) {
  if (!ids.length || markingRead.value) return
  markingRead.value = true
  try { await api('/api/notifications/read', { method: 'POST', body: { ids } }); notifications.value.forEach(item => { if (ids.includes(item.id)) item.isRead = true }) }
  catch (cause) { notificationError.value = errorMessage(cause) }
  finally { markingRead.value = false }
}
function toggleHeaderMenu(event: Event) {
  const opened = event.target as HTMLDetailsElement
  if (!opened.open) return
  document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { if (menu !== opened) menu.open = false })
  if (opened.classList.contains('notifications')) void loadNotifications()
}
function dismissMenus(event: Event) {
  if (event.type === 'click' && (event.target as HTMLElement).closest('.header-menu')) return
  document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { menu.open = false; if (event.type === 'keydown') menu.querySelector('summary')?.focus() })
}
</script>

<template>
  <div class="app-shell" @click="dismissMenus" @keydown.esc="dismissMenus">
    <a href="#main" class="skip-link">跳至内容</a>
    <header class="app-header"><div class="header-inner">
      <RouterLink to="/discover" class="brand" aria-label="AI 创作社区首页"><span class="brand-mark"><Aperture :size="21" /></span><span>AI 创作社区</span></RouterLink>
      <nav class="desktop-nav" aria-label="主导航"><RouterLink v-for="link in links" :key="link.path" :to="link.path" class="nav-link" :class="{ active: isCurrent(link.path) }" :aria-current="isCurrent(link.path) ? 'page' : undefined">{{ link.label }}</RouterLink><RouterLink to="/community" class="nav-link" :class="{ active: route.path === '/community' }" :aria-current="route.path === '/community' ? 'page' : undefined">社区</RouterLink></nav>
      <div class="header-actions"><template v-if="session.user">
        <RouterLink to="/messages" class="icon-button header-messages" aria-label="私信" title="私信"><MessageSquare :size="19" /></RouterLink>
        <details class="header-menu notifications" @toggle="toggleHeaderMenu"><summary class="icon-button notification-trigger" :aria-label="unreadCount ? `通知，${unreadCount} 条未读` : '通知'" title="通知"><Bell :size="19" /><span v-if="unreadCount" class="notification-count">{{ unreadCount > 99 ? '99+' : unreadCount }}</span></summary><div class="menu-popover notification-popover"><div class="menu-title"><strong>通知</strong><div><button class="icon-button" aria-label="刷新通知" title="刷新通知" :disabled="notificationsLoading" @click="loadNotifications"><RefreshCw :size="16" /></button><button class="icon-button" aria-label="全部标记已读" title="全部标记已读" :disabled="markingRead || !unreadCount" @click="markRead(notifications.filter(item => !item.isRead).map(item => item.id))"><CheckCheck :size="17" /></button></div></div><p v-if="notificationsLoading && !notifications.length" role="status">正在加载…</p><p v-if="notificationError" class="form-error" role="alert">{{ notificationError }}</p><div v-if="notifications.length" class="notification-list"><article v-for="item in notifications" :key="item.id" class="notification-item" :class="{ unread: !item.isRead }"><RouterLink v-if="item.actor" :to="{ path: '/community', query: { creator: item.actor.id } }" class="notification-actor" @click="!item.isRead && markRead([item.id])"><span class="avatar blue"><img v-if="item.actor.avatarUrl" :src="item.actor.avatarUrl" :alt="item.actor.name || item.actor.username" /><span v-else>{{ (item.actor.name || item.actor.username || '用').slice(0, 1) }}</span></span></RouterLink><RouterLink :to="destination(item)" class="notification-content" @click="!item.isRead && markRead([item.id])"><strong v-if="item.title">{{ item.title }}</strong><span>{{ item.text || item.body }}</span><time v-if="item.createdAt" class="caption-5">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</time></RouterLink></article></div><p v-else-if="!notificationsLoading && !notificationError">暂无通知</p></div></details>
        <RouterLink :to="{ path: route.path, query: { ...route.query, publish: '1' } }" class="button primary publish-button btn" aria-label="发布作品" title="发布作品"><Plus :size="17" /><span>发布作品</span></RouterLink>
        <details class="header-menu profile-menu" @toggle="toggleHeaderMenu"><summary class="profile-toggle" aria-label="账号菜单" title="账号菜单"><span class="avatar blue"><img v-if="session.user.avatarUrl" :src="session.user.avatarUrl" :alt="session.user.name || session.user.username" /><span v-else>{{ (session.user.name || session.user.username).slice(0, 1) }}</span></span><ChevronDown :size="13" /></summary><div class="menu-popover account-popover"><div class="menu-title">{{ session.user.name || session.user.username }}<span class="caption-5">@{{ session.user.username }}</span></div><RouterLink :to="{ path: '/community', query: { creator: session.user.id } }"><Users :size="16" />个人主页</RouterLink><RouterLink to="/library?tab=saved"><Bookmark :size="16" />我的收藏</RouterLink><RouterLink to="/messages"><MessageSquare :size="16" />私信</RouterLink><RouterLink to="/account"><Settings :size="16" />账号设置</RouterLink><RouterLink v-if="session.user.isAdmin || session.user.isModerator" to="/admin"><ShieldCheck :size="16" />内容管理</RouterLink><button class="menu-command" :disabled="signingOut" @click="signOut"><LogOut :size="16" />退出登录</button></div></details>
      </template><RouterLink v-else to="/account" class="button primary btn"><LogIn :size="17" />登录</RouterLink></div>
    </div></header>
    <p v-if="session.error" class="notice-inline" role="alert">{{ session.error }} <button class="text-link" @click="loadSession(true)">重试</button></p>
    <main id="main" tabindex="-1"><RouterView :key="`${route.path}:${session.user?.id || 'guest'}`" /></main>
    <BackgroundStudio />
    <footer class="app-footer"><span>AI 创作社区</span><RouterLink to="/community?tab=announcements">社区公告</RouterLink></footer>
    <nav class="mobile-nav" aria-label="手机导航"><RouterLink v-for="link in links" :key="link.path" :to="link.path" :class="{ active: isCurrent(link.path) }" :aria-current="isCurrent(link.path) ? 'page' : undefined"><component :is="link.icon" :size="21" /><span>{{ link.label === '我的作品' ? '我的' : link.label }}</span></RouterLink><RouterLink to="/community" :class="{ active: route.path === '/community' }"><Users :size="21" /><span>社区</span></RouterLink></nav>
    <Transition name="toast"><div v-if="notice" class="toast-message" role="status">{{ notice }}</div></Transition>
    <WorkEditor :open="route.query.publish === '1'" @close="closePublish" @saved="published" />
  </div>
</template>

<style scoped>
.avatar { overflow: hidden; }.avatar img { width: 100%; height: 100%; object-fit: cover; }
.notification-trigger { position: relative; }.notification-count { position: absolute; right: -3px; top: -2px; min-width: 16px; height: 16px; display: grid; place-items: center; border-radius: 8px; background: var(--blue); color: var(--action-ink); font-size: 10px; padding: 0 3px; }
.notification-popover { width: min(360px, calc(100vw - 32px)); }.menu-title > div { display: flex; align-items: center; }.notification-list { max-height: min(480px, 65svh); overflow-y: auto; }
.notification-item { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--border); }.notification-item.unread { background: var(--blue-soft); }.notification-actor { padding: 0; flex: none; }
.notification-content { display: grid; gap: 4px; min-width: 0; padding: 0; }.notification-content span { overflow-wrap: anywhere; }.notification-content time { color: var(--muted); }
@media (max-width: 639px) { .header-actions { gap: 8px; }.notification-popover { position: fixed; left: 16px; right: 16px; top: 64px; width: auto; } }
</style>
