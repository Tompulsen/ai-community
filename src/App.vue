<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isNavigationFailure, useRoute, useRouter } from 'vue-router'
import { Bell, ChevronDown, Heart, House, Gift, LogOut, MessageSquare, Plus, Settings, ShieldCheck, Users, WandSparkles } from '@lucide/vue'
import WorkEditor from './components/WorkEditor.vue'
import BackgroundStudio from './components/BackgroundStudio.vue'
import type { Work } from './data'
import { errorMessage, loadSession, logout, notice, notify, rememberLotteryInvite, session } from './state'
import { inbox, loadInbox, type InboxCategory } from './inbox'
import { loadSite, site } from './site'

const route = useRoute(), router = useRouter()
const guestAccount = computed(() => route.path === '/account' && !session.user)
const studioPage = computed(() => Boolean(session.user) && (route.path === '/create' || route.path.startsWith('/create/')))
const links = [
  { path: '/discover', label: '首页', icon: House },
  { path: '/activities', label: '推广中心', icon: Gift },
  { path: '/community', label: '社区', icon: Users },
  { path: '/create', label: '创作台', icon: WandSparkles },
]
function isCurrent(path: string) {
  return route.path === path || (path === '/create' && route.path.startsWith('/create/')) || (path === '/discover' && route.path.startsWith('/work/'))
}
const signingOut = ref(false), publicationNavigation = ref(false)
const messageLinks: { category: InboxCategory; label: string; to: string; icon: typeof Bell }[] = [
  { category: 'announcement', label: '系统公告', to: '/messages?tab=announcement', icon: Bell },
  { category: 'messages', label: '我的消息', to: '/messages', icon: MessageSquare },
  { category: 'activity', label: '互动消息', to: '/messages?tab=activity', icon: Heart },
]
const unreadCount = computed(() => session.user ? inbox.counts.announcement + inbox.counts.messages + inbox.counts.activity : 0)
const messageMenu = ref<HTMLDetailsElement>()
let poll: ReturnType<typeof setInterval> | undefined
let messageCloseTimer: ReturnType<typeof setTimeout> | undefined
function refreshActiveIdentity() {
  if (session.user && document.visibilityState !== 'hidden') void loadSession(true)
}
onMounted(() => {
  rememberLotteryInvite(route.query.invite); void loadSession()
  void loadSite()
  window.addEventListener('focus', refreshActiveIdentity)
  window.addEventListener('pageshow', refreshActiveIdentity)
  document.addEventListener('visibilitychange', refreshActiveIdentity)
})
onBeforeUnmount(() => {
  clearInterval(poll); clearTimeout(messageCloseTimer)
  window.removeEventListener('focus', refreshActiveIdentity)
  window.removeEventListener('pageshow', refreshActiveIdentity)
  document.removeEventListener('visibilitychange', refreshActiveIdentity)
})
watch(() => route.fullPath, () => document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { menu.open = false }))
watch([() => route.meta.title, () => site.brand], () => { document.title = `${String(route.meta.title || '首页')} · ${site.brand}` }, { immediate: true })
watch(() => session.user?.id, id => {
  clearInterval(poll)
  if (messageMenu.value) messageMenu.value.open = false
  if (!id) return
  void loadInbox()
  poll = setInterval(() => { if (document.visibilityState === 'visible') void loadInbox(true) }, 45000)
}, { immediate: true })
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
  if (signingOut.value) return
  signingOut.value = true
  try {
    if (route.path !== '/discover' && isNavigationFailure(await router.push('/discover'))) return
    await logout(); notify('已退出登录。')
  }
  catch (cause) { notify(errorMessage(cause)) }
  finally { signingOut.value = false }
}
function toggleHeaderMenu(event: Event) {
  const opened = event.target as HTMLDetailsElement
  if (!opened.open) return
  document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { if (menu !== opened) menu.open = false })
  if (opened.classList.contains('messages-menu')) void loadInbox()
}
function openMessages(event: Event) {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches || event instanceof PointerEvent && event.pointerType !== 'mouse') return
  clearTimeout(messageCloseTimer)
  if (messageMenu.value && !messageMenu.value.open) {
    messageMenu.value.open = true
  }
}
function leaveMessages(event: Event) {
  if (event instanceof FocusEvent && event.relatedTarget instanceof Node && messageMenu.value?.contains(event.relatedTarget)) return
  clearTimeout(messageCloseTimer)
  messageCloseTimer = setTimeout(() => {
    if (messageMenu.value && !messageMenu.value.contains(document.activeElement)) messageMenu.value.open = false
  }, 120)
}
function dismissMenus(event: Event) {
  if (event.type === 'click' && (event.target as HTMLElement).closest('.header-menu')) return
  document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { if (event.type === 'keydown') menu.querySelector('summary')?.focus(); menu.open = false })
}
</script>

<template>
  <div class="app-shell" :class="{ 'account-entry-shell': guestAccount, 'studio-shell': studioPage }" @click="dismissMenus" @keydown.esc="dismissMenus">
    <a href="#main" class="skip-link">跳至内容</a>
    <header v-if="!guestAccount" class="app-header"><div class="header-inner">
      <RouterLink to="/discover" class="brand" :aria-label="`${site.brand}首页`"><img v-if="site.logoUrl" class="brand-mark" :src="site.logoUrl" width="32" height="32" alt="" /><span>{{ site.brand }}</span></RouterLink>
      <nav class="desktop-nav" aria-label="主导航"><RouterLink v-for="link in links" :key="link.path" :to="link.path" class="nav-link" :class="{ active: isCurrent(link.path) }" :aria-current="isCurrent(link.path) ? 'page' : undefined">{{ link.label }}</RouterLink></nav>
      <div class="header-tools"><div id="header-search" class="header-search-slot" />
      <div class="header-actions"><RouterLink v-if="route.path === '/discover'" :to="session.user ? { path: route.path, query: { ...route.query, publish: '1' } } : { path: '/account' }" class="header-submission" aria-label="投稿" title="投稿"><Plus class="submission-icon" :size="18" aria-hidden="true" /><span class="submission-label">投稿</span></RouterLink>
        <details ref="messageMenu" class="header-menu messages-menu" @toggle="toggleHeaderMenu" @pointerenter="openMessages" @pointerleave="leaveMessages" @focusin="openMessages" @focusout="leaveMessages">
          <summary class="icon-button message-trigger" :aria-label="unreadCount ? `消息，${unreadCount} 条未读` : '消息'" title="消息"><MessageSquare :size="19" /><span v-if="unreadCount" class="message-count">{{ unreadCount > 99 ? '99+' : unreadCount }}</span></summary>
          <div class="menu-popover message-popover">
            <template v-if="session.user"><RouterLink v-for="item in messageLinks" :key="item.category" :to="item.to" class="message-menu-link"><component :is="item.icon" :size="17" /><span>{{ item.label }}</span><span v-if="inbox.counts[item.category]" class="message-category-count">{{ inbox.counts[item.category] > 99 ? '99+' : inbox.counts[item.category] }}</span></RouterLink></template>
            <div v-else class="message-login"><p>登录即可查看关注动态</p><RouterLink to="/account" class="button primary btn">立即登录</RouterLink></div>
          </div>
        </details>
        <template v-if="session.user">
        <RouterLink v-if="route.path !== '/discover'" :to="{ path: route.path, query: { ...route.query, publish: '1' } }" class="button primary publish-button btn" aria-label="发布作品" title="发布作品"><Plus :size="17" /><span>发布作品</span></RouterLink>
        <details class="header-menu profile-menu" @toggle="toggleHeaderMenu"><summary class="profile-toggle" :class="{ selected: route.path === '/library' }" aria-label="账号菜单" title="账号菜单"><span class="avatar blue"><img v-if="session.user.avatarUrl" :src="session.user.avatarUrl" :alt="session.user.name || session.user.username" /><span v-else>{{ (session.user.name || session.user.username).slice(0, 1) }}</span></span><ChevronDown :size="13" /></summary><div class="menu-popover account-popover"><div class="menu-title">{{ session.user.name || session.user.username }}<span class="caption-5">账号ID:{{ session.user.id }}</span></div>
          <RouterLink :to="{ path: '/community', query: { creator: session.user.id } }"><Users :size="16" />个人主页</RouterLink><RouterLink to="/account"><Settings :size="16" />账号设置</RouterLink><RouterLink v-if="session.user.isAdmin || session.user.isModerator" to="/admin"><ShieldCheck :size="16" />内容管理</RouterLink><button class="menu-command" :disabled="signingOut" @click="signOut"><LogOut :size="16" />退出登录</button></div></details>
      </template><RouterLink v-else to="/account" class="button primary btn header-login">登录</RouterLink></div></div>
    </div></header>
    <p v-if="session.error" class="notice-inline" role="alert">{{ session.error }} <button class="text-link" @click="loadSession(true)">重试</button></p>
    <main id="main" tabindex="-1"><RouterView :key="route.path.startsWith('/account') ? route.path : `${route.path}:${session.user?.id || 'guest'}`" /></main>
    <BackgroundStudio />
    <footer v-if="!guestAccount && !studioPage" class="app-footer"><span>{{ site.brand }}</span><RouterLink to="/community?tab=announcements">社区公告</RouterLink></footer>
    <nav v-if="!guestAccount" class="mobile-nav" aria-label="手机导航"><RouterLink v-for="link in links" :key="link.path" :to="link.path" :class="{ active: isCurrent(link.path) }" :aria-current="isCurrent(link.path) ? 'page' : undefined"><component :is="link.icon" :size="21" /><span>{{ link.label }}</span></RouterLink></nav>
    <Transition name="toast"><div v-if="notice" class="toast-message" role="status">{{ notice }}</div></Transition>
    <WorkEditor :open="route.query.publish === '1'" @close="closePublish" @saved="published" />
  </div>
</template>

<style scoped>
.studio-shell { flex: none; height: calc(100dvh - var(--mobile-nav-height)); min-height: 0; }
.studio-shell > main { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.header-inner { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 32px; }
.brand { justify-self: start; min-width: 0; max-width: min(280px, 100%); }
.brand > span { overflow: hidden; text-overflow: ellipsis; }
.app-footer > span { min-width: 0; overflow-wrap: anywhere; }
.desktop-nav { align-items: center; justify-self: center; gap: 24px; }
.header-tools { display: flex; align-items: center; justify-self: end; min-width: 0; gap: 8px; }
.header-actions { margin-left: 0; gap: 8px; }
.header-submission { display: flex; align-items: center; justify-content: center; flex: none; gap: 6px; width: max-content; height: 36px; margin-right: 14px; color: var(--muted); white-space: nowrap; }
.header-submission:hover { color: var(--ink); }
.submission-icon { flex: none; }
.submission-label { font-size: 14px; line-height: 20px; font-weight: 500; }
.nav-link { align-self: center; padding: 10px 0; min-height: 44px; }
.nav-link::after { display: none; }
.header-actions > .button { border-radius: 24px; min-height: 44px; padding-inline: 16px; }
.header-actions > .header-login { min-height: 36px; padding-block: 6px; border-radius: 18px; }
.header-actions > .button.primary { background: var(--ink); color: var(--canvas); border-color: transparent; }
.header-actions > .button.primary:hover { background: #ffffff; }
.header-search-slot { position: relative; width: 44px; height: 44px; min-width: 0; --gooey-expanded-width: clamp(180px, calc(100vw - 1056px), 280px); }
.header-search-slot:empty { display: none; }
@media (min-width: 1000px) and (max-width: 1279px) {
  .header-inner { grid-template-columns: auto minmax(0, 1fr) auto; gap: 24px; }
}
@media (min-width: 640px) and (max-width: 999px) {
  .header-inner { grid-template-columns: auto minmax(0, 1fr); gap: 24px; }
  .header-search-slot { --gooey-expanded-width: clamp(180px, calc(100vw - 460px), 280px); }
}
@media (max-width: 639px) {
  .header-inner { grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
  .header-tools { gap: 4px; }
  .header-actions { justify-self: end; }
  .header-submission { width: 44px; height: 44px; margin-right: 0; }
  .header-actions:has(.header-login) { gap: 18px; }
  .submission-icon { width: 22px; height: 22px; }
  .submission-label { display: none; }
  :global(:root:has(#header-search .expanded)) { --header-height: 120px; }
  .app-header:has(#header-search .expanded) { height: 120px; }
  .header-inner:has(#header-search .expanded) { grid-template-rows: 64px 56px; row-gap: 0; }
  .header-inner:has(#header-search .expanded) .header-tools { display: contents; }
  .header-inner:has(#header-search .expanded) .brand { grid-column: 1; grid-row: 1; }
  .header-inner:has(#header-search .expanded) .header-actions { grid-column: 2; grid-row: 1; }
  .header-search-slot { --gooey-expanded-width: 100%; }
  .header-search-slot:has(.expanded) { grid-column: 1 / -1; grid-row: 2; width: 100%; align-self: start; }
}
@media (max-width: 639px) { .header-actions > .publish-button { padding: 0; } }
:global(#app:has(.account-entry-shell)) { padding-bottom: 0; }
.avatar { overflow: hidden; }.avatar img { width: 100%; height: 100%; object-fit: cover; }
.account-popover > a[aria-current="page"] { color: var(--blue); background: var(--blue-soft); }
.message-trigger { position: relative; }
.message-count { position: absolute; right: -3px; top: -2px; min-width: 16px; height: 16px; display: grid; place-items: center; border-radius: 8px; background: var(--blue); color: var(--action-ink); font-size: 10px; padding: 0 3px; font-variant-numeric: tabular-nums; }
.message-popover { min-width: 192px; padding: 8px; }
.message-popover::before { content: ''; position: absolute; bottom: 100%; left: 0; right: 0; height: 12px; }
.message-popover > .message-menu-link { min-height: 44px; gap: 10px; font-size: 14px; }
.message-menu-link > span:first-of-type { flex: 1; }
.message-category-count { display: grid; place-items: center; min-width: 20px; height: 20px; border-radius: 10px; padding: 0 5px; background: var(--blue); color: var(--action-ink); font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; }
.message-login { min-width: 224px; display: grid; justify-items: center; gap: 16px; padding: 20px 12px; }
.message-login p { color: var(--muted); font-size: 14px; line-height: 24px; }
.message-login .button { min-height: 44px; padding-inline: 24px; }
@media (max-width: 639px) { .header-actions { gap: 4px; }.message-popover { position: fixed; right: 16px; top: 64px; max-width: calc(100vw - 32px); } }
</style>
