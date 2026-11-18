<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { isNavigationFailure, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Bell, ChevronDown, Heart, House, Gift, LogOut, MessageSquare, Plus, RefreshCw, Search, Settings, ShieldCheck, Users, WandSparkles, X } from '@lucide/vue'
import WorkEditor from './components/WorkEditor.vue'
import BackgroundStudio from './components/BackgroundStudio.vue'
import CommunityTools from './components/CommunityTools.vue'
import AccountBalance from './components/AccountBalance.vue'
import MessageCenterDialog from './components/MessageCenterDialog.vue'
import GooeyInput from './components/GooeyInput.vue'
import type { Work } from './data'
import { errorMessage, loadSession, logout, notice, notify, rememberLotteryInvite, session, sessionStatus } from './state'
import { inbox, loadInbox, type InboxCategory } from './inbox'
import { loadSite, site } from './site'
import { studioSidebarWidth } from './studio-preferences'

const route = useRoute(), router = useRouter()
const guestAccount = computed(() => route.path === '/account' && !session.user)
const accountSettings = computed(() => route.path === '/account' && !!session.user)
const studioPage = computed(() => route.path === '/create' || route.path.startsWith('/create/'))
const communityShell = computed(() => !guestAccount.value && !studioPage.value)
const wideViewport = ref(window.innerWidth >= 1000)
const desktopCommunity = computed(() => communityShell.value && wideViewport.value)
const mobileCommunity = computed(() => communityShell.value && !wideViewport.value)
provide('mobile-community', mobileCommunity)
const feedPage = computed(() => route.path === '/discover')
const profilePage = computed(() => route.path === '/community' && !!route.query.creator)
const workPage = computed(() => route.path.startsWith('/work/'))
const ownProfile = computed(() => profilePage.value && route.query.creator === session.user?.id)
const mobilePageTitle = computed(() => profilePage.value ? (ownProfile.value ? '我的主页' : '个人主页') : workPage.value ? '作品预览' : String(route.meta.title || '社区'))
const meDestination = computed(() => session.user ? { path: '/community', query: { creator: session.user.id } } : { path: '/account' })
let publishTrigger: HTMLElement | null = null
function rememberMenuPublish() { publishTrigger = document.querySelector<HTMLElement>('.mobile-community-header .tools-trigger') }
function openPublish(event: MouseEvent) {
  publishTrigger = event.currentTarget as HTMLElement
  const target = { path: route.path, query: { ...route.query, publish: '1' } }
  void router.push(session.user ? target : { path: '/account', query: { returnTo: router.resolve(target).fullPath } })
}
function mobileBack() {
  if (router.options.history.state.back) router.back()
  else void router.push('/discover')
}
const searchQuery = ref(typeof route.query.q === 'string' ? route.query.q : '')
const mobileSearchOpen = ref(!!searchQuery.value)
const mobileSearchButton = ref<HTMLButtonElement>()
const mobileSearchForm = ref<HTMLFormElement>()
const discoveryLinks = [
  { kind: 'all', label: '发现' }, { kind: 'video', label: '视频' },
  { kind: 'image', label: '图片' }, { kind: 'resource', label: 'skill', description: 'Skill 与资源' },
]
function discoveryDestination(kind: string) {
  const query = route.path === '/discover' ? route.query : {}
  return { path: '/discover', query: { ...query, q: searchQuery.value.trim() || undefined, kind: kind === 'all' ? undefined : kind, tag: kind === 'all' ? undefined : query.tag } }
}
async function toggleMobileSearch() {
  mobileSearchOpen.value = !mobileSearchOpen.value
  if (mobileSearchOpen.value) document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { menu.open = false })
  await nextTick()
  if (mobileSearchOpen.value) mobileSearchForm.value?.querySelector('input')?.focus()
  else mobileSearchButton.value?.focus()
}
watch(() => route.path, () => { mobileSearchOpen.value = !!route.query.q })
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchQuery, value => {
  clearTimeout(searchTimer)
  if (route.path !== '/discover' || value === (route.query.q || '')) return
  searchTimer = setTimeout(searchWorks, 180)
})
function searchWorks() {
  clearTimeout(searchTimer)
  const query = searchQuery.value.trim()
  if (route.path === '/discover') void router.replace({ query: { ...route.query, q: query || undefined } })
  else void router.push({ path: '/discover', query: { q: query || undefined } })
}
const viewportHeight = ref(window.visualViewport?.height || window.innerHeight)
function resizeViewport() {
  viewportHeight.value = window.visualViewport?.height || window.innerHeight
  const wide = window.innerWidth >= 1000
  if (wide !== wideViewport.value) {
    document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { menu.open = false })
    wideViewport.value = wide
  }
  positionMessagePopover()
}
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
const messageLinks: { category: InboxCategory; label: string; icon: typeof Bell }[] = [
  { category: 'announcement', label: '公告', icon: Bell },
  { category: 'messages', label: '我的消息', icon: MessageSquare },
  { category: 'activity', label: '互动消息', icon: Heart },
]
const unreadCount = computed(() => session.user ? inbox.counts.announcement + inbox.counts.messages + inbox.counts.activity : 0)
const messageMenu = ref<HTMLDetailsElement>()
const messagePopoverTop = ref(80)
const messageCenter = ref<InstanceType<typeof MessageCenterDialog>>()
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
  window.visualViewport?.addEventListener('resize', resizeViewport)
  window.addEventListener('resize', resizeViewport)
})
onBeforeUnmount(() => {
  clearInterval(poll); clearTimeout(messageCloseTimer); clearTimeout(searchTimer)
  window.removeEventListener('focus', refreshActiveIdentity)
  window.removeEventListener('pageshow', refreshActiveIdentity)
  document.removeEventListener('visibilitychange', refreshActiveIdentity)
  window.visualViewport?.removeEventListener('resize', resizeViewport)
  window.removeEventListener('resize', resizeViewport)
})
watch(() => route.fullPath, () => {
  clearTimeout(searchTimer)
  searchQuery.value = typeof route.query.q === 'string' ? route.query.q : ''
  messageCenter.value?.close()
  document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { menu.open = false })
})
watch([() => route.meta.title, () => site.brand], () => { document.title = `${String(route.meta.title || '首页')} · ${site.brand}` }, { immediate: true })
watch(() => session.user?.id, id => {
  clearInterval(poll)
  messageCenter.value?.close()
  if (messageMenu.value) messageMenu.value.open = false
  if (!id) return
  void loadInbox()
  poll = setInterval(() => { if (document.visibilityState === 'visible') void loadInbox(true) }, 45000)
}, { immediate: true })
async function closePublish() {
  if (publicationNavigation.value || route.query.publish !== '1') return
  const { publish: _, ...query } = route.query
  await router.replace({ path: route.path, query, hash: route.hash })
  await nextTick()
  if (mobileCommunity.value && route.query.publish !== '1') (publishTrigger?.isConnected ? publishTrigger : document.querySelector<HTMLElement>('.mobile-publish'))?.focus({ preventScroll: true })
}
async function published(work: Work) {
  const owner = session.user?.id
  publicationNavigation.value = true
  try { await router.push({ path: '/library', query: { tab: work.status === 'draft' ? 'draft' : work.status === 'pending' ? 'pending' : 'all' } }) }
  finally { publicationNavigation.value = false; if (owner === session.user?.id) closePublish() }
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
  if (mobileCommunity.value) mobileSearchOpen.value = false
  document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { if (menu !== opened) menu.open = false })
  if (opened.classList.contains('messages-menu')) { void loadInbox(); positionMessagePopover() }
}
function positionMessagePopover() {
  if (!desktopCommunity.value || !messageMenu.value?.open) return
  void nextTick(() => {
    const menu = messageMenu.value
    const popover = menu?.querySelector<HTMLElement>('.message-popover')
    if (menu && popover) messagePopoverTop.value = Math.max(8, Math.min(menu.getBoundingClientRect().top, window.innerHeight - popover.offsetHeight - 12))
  })
}
function openMessages(event: Event) {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches || event instanceof PointerEvent && event.pointerType !== 'mouse') return
  clearTimeout(messageCloseTimer)
  if (messageMenu.value && !messageMenu.value.open) {
    messageMenu.value.open = true
    positionMessagePopover()
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
  const insideSearch = event.composedPath().some(node => node instanceof Element && node.matches('.mobile-community-header, .mobile-search-panel'))
  if (mobileSearchOpen.value && (event.type === 'keydown' || !insideSearch)) {
    mobileSearchOpen.value = false
    if (event.type === 'keydown') mobileSearchButton.value?.focus()
  }
  if (event.type === 'click' && (event.target as HTMLElement).closest('.header-menu')) return
  document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { if (event.type === 'keydown') menu.querySelector('summary')?.focus(); menu.open = false })
}
function showMessageCenter(category: InboxCategory) {
  clearTimeout(messageCloseTimer)
  if (messageMenu.value) messageMenu.value.open = false
  messageCenter.value?.open(category)
}
function restoreMessageTrigger() {
  messageMenu.value?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
  if (mobileCommunity.value) document.querySelector<HTMLElement>('.mobile-community-header .tools-trigger')?.focus({ preventScroll: true })
  if (messageMenu.value) messageMenu.value.open = false
}
</script>

<template>
  <div class="app-shell" :class="{ 'account-entry-shell': guestAccount, 'account-settings-shell': accountSettings, 'studio-shell': studioPage, 'community-shell': communityShell, 'work-shell': workPage }" :style="studioPage ? { '--studio-visible-height': `${viewportHeight}px`, '--studio-sidebar-width': studioSidebarWidth ? `${studioSidebarWidth}px` : undefined } : undefined" @click="dismissMenus" @keydown.esc="dismissMenus">
    <a href="#main" class="skip-link">跳至内容</a>
    <aside v-if="communityShell" class="community-rail" aria-label="社区侧栏">
      <RouterLink to="/discover" class="rail-brand" :aria-label="`${site.brand}首页`" :title="site.brand"><img v-if="site.logoUrl" :src="site.logoUrl" width="28" height="28" alt="" /><span v-else>{{ site.brand.slice(0, 1) }}</span></RouterLink>
      <div class="rail-scroll" @scroll.passive="positionMessagePopover"><div id="community-rail-navigation" /><div id="community-rail-actions" /></div>
      <RouterLink to="/account" class="rail-settings icon-button" aria-label="账号设置" title="账号设置"><Settings :size="22" aria-hidden="true" /></RouterLink>
    </aside>
    <header v-if="mobileCommunity" class="app-header mobile-community-header" :class="{ 'mobile-search-open': mobileSearchOpen, 'mobile-profile-header': profilePage }">
      <div class="mobile-header-row">
        <button v-if="profilePage || workPage" type="button" class="icon-button mobile-back" aria-label="返回上一页" @click="mobileBack"><ArrowLeft :size="22" /></button>
        <CommunityTools v-else v-slot="{ close }" compact @toggle="toggleHeaderMenu" @message="showMessageCenter">
          <div class="mobile-account-tools">
            <template v-if="session.user">
              <RouterLink to="/account" class="mobile-account-identity" @click="close"><span class="avatar blue"><img v-if="session.user.avatarUrl" :src="session.user.avatarUrl" alt="" /><span v-else>{{ (session.user.name || session.user.username).slice(0, 1) }}</span></span><span>{{ session.user.name || session.user.username }}<small v-if="session.user.accountId">章鱼号：{{ session.user.accountId }}</small></span></RouterLink>
              <AccountBalance @click="close" />
            </template>
            <RouterLink v-else-if="sessionStatus === 'guest'" to="/account" class="button primary btn" @click="close">登录章鱼账号</RouterLink>
            <span v-else-if="sessionStatus === 'loading'" role="status">账号加载中…</span>
            <button v-else type="button" class="button btn" @click="loadSession(true)"><RefreshCw :size="16" />重新加载账号</button>
            <div class="mobile-account-actions">
              <RouterLink v-if="sessionStatus === 'authenticated' || sessionStatus === 'guest'" :to="session.user ? { path: route.path, query: { ...route.query, publish: '1' } } : { path: '/account' }" class="button btn mobile-submission" @click="rememberMenuPublish(); close()"><Plus :size="18" aria-hidden="true" />投稿</RouterLink>
              <button v-if="session.user" class="mobile-sign-out" :disabled="signingOut" @click="close(); signOut()"><LogOut :size="16" aria-hidden="true" />退出登录</button>
            </div>
          </div>
        </CommunityTools>
        <nav v-if="feedPage" class="mobile-discovery-nav" aria-label="作品分类">
          <RouterLink v-for="link in discoveryLinks" :key="link.kind" :to="discoveryDestination(link.kind)" :aria-label="link.description || link.label" :title="link.description" :aria-current="route.path === '/discover' && (route.query.kind || 'all') === link.kind ? 'page' : undefined">{{ link.label }}</RouterLink>
        </nav>
        <component v-else :is="profilePage || workPage ? 'strong' : 'h1'" class="mobile-page-title">{{ mobilePageTitle }}</component>
        <div class="mobile-header-actions"><button ref="mobileSearchButton" type="button" class="icon-button mobile-search-toggle" :aria-label="mobileSearchOpen ? '收起搜索作品' : '展开搜索作品'" :aria-expanded="mobileSearchOpen" aria-controls="mobile-community-search" @click="toggleMobileSearch"><X v-if="mobileSearchOpen" :size="22" aria-hidden="true" /><Search v-else :size="22" aria-hidden="true" /></button><RouterLink v-if="profilePage" to="/account" class="icon-button" aria-label="账号设置"><Settings :size="22" /></RouterLink></div>
      </div>
    </header>
    <header v-else-if="!guestAccount" v-show="!accountSettings" class="app-header"><div class="header-inner">
      <RouterLink to="/discover" class="brand" :aria-label="`${site.brand}首页`"><img v-if="site.logoUrl" class="brand-mark" :src="site.logoUrl" width="32" height="32" alt="" /><span>{{ site.brand }}</span></RouterLink>
      <Teleport to="#community-rail-navigation" :disabled="!desktopCommunity" defer><nav class="desktop-nav" aria-label="主导航"><RouterLink v-for="link in links" :key="link.path" :to="link.path" class="nav-link" :class="{ active: isCurrent(link.path) }" :aria-label="link.label" :title="link.label" :aria-current="isCurrent(link.path) ? 'page' : undefined"><component v-if="communityShell" :is="link.icon" :size="22" aria-hidden="true" /><span>{{ link.label }}</span></RouterLink></nav></Teleport>
      <div v-if="studioPage" id="studio-header-conversation" class="studio-header-conversation"><RouterLink v-if="!session.user" to="/discover" class="studio-home-link"><House :size="16" />返回社区</RouterLink></div>
      <div class="header-tools"><form v-if="communityShell" id="header-search" class="header-search-slot" role="search" aria-label="作品搜索" @submit.prevent="searchWorks"><GooeyInput v-model="searchQuery" persistent placeholder="搜索作品、提示词或创作者" /></form>
      <div class="header-actions"><Teleport to="#community-rail-actions" :disabled="!desktopCommunity" defer><div class="community-actions"><CommunityTools @toggle="toggleHeaderMenu" /><RouterLink v-if="communityShell && (sessionStatus === 'authenticated' || sessionStatus === 'guest')" :to="session.user ? { path: route.path, query: { ...route.query, publish: '1' } } : { path: '/account' }" class="header-submission" aria-label="投稿" title="投稿"><Plus class="submission-icon" :size="22" aria-hidden="true" /><span class="submission-label">投稿</span></RouterLink>
        <details ref="messageMenu" class="header-menu messages-menu" @toggle="toggleHeaderMenu" @pointerenter="openMessages" @pointerleave="leaveMessages" @focusin="openMessages" @focusout="leaveMessages">
          <summary class="icon-button message-trigger" :aria-label="unreadCount ? `消息，${unreadCount > 99 ? '99+' : unreadCount} 条未读` : '消息'" :aria-description="unreadCount > 99 ? `共 ${unreadCount} 条未读消息` : undefined" title="消息"><MessageSquare :size="19" /><span v-if="unreadCount" class="message-count">{{ unreadCount > 99 ? '99+' : unreadCount }}</span></summary>
          <div class="menu-popover message-popover" :style="desktopCommunity ? { top: `${messagePopoverTop}px` } : undefined">
            <template v-if="session.user"><button v-for="item in messageLinks" :key="item.category" type="button" class="message-menu-link" aria-haspopup="dialog" @click="showMessageCenter(item.category)"><component :is="item.icon" :size="17" /><span>{{ item.label }}</span><span v-if="inbox.counts[item.category]" class="message-category-count">{{ inbox.counts[item.category] > 99 ? '99+' : inbox.counts[item.category] }}</span></button></template>
            <div v-else-if="sessionStatus === 'guest'" class="message-login"><p>登录即可查看关注动态</p><RouterLink to="/account" class="button primary btn">立即登录</RouterLink></div>
            <div v-else class="message-login"><p>{{ sessionStatus === 'loading' ? '正在加载账号…' : '账号暂时无法加载' }}</p><button v-if="sessionStatus === 'error'" type="button" class="button btn subtle" @click="loadSession(true)">重新加载</button></div>
          </div>
        </details></div></Teleport>
        <template v-if="session.user">
        <AccountBalance />
        <details class="header-menu profile-menu" @toggle="toggleHeaderMenu"><summary class="profile-toggle" :class="{ selected: route.path === '/library' }" aria-label="账号菜单" title="账号菜单"><span class="avatar blue"><img v-if="session.user.avatarUrl" :src="session.user.avatarUrl" :alt="session.user.name || session.user.username" /><span v-else>{{ (session.user.name || session.user.username).slice(0, 1) }}</span></span><ChevronDown :size="13" /></summary><div class="menu-popover account-popover"><div class="menu-title">{{ session.user.name || session.user.username }}<span v-if="session.user.accountId" class="caption-5">章鱼号：{{ session.user.accountId }}</span></div>
          <RouterLink :to="{ path: '/community', query: { creator: session.user.id } }"><Users :size="16" />个人主页</RouterLink><RouterLink to="/account"><Settings :size="16" />账号设置</RouterLink><RouterLink v-if="session.user.isAdmin || session.user.isModerator" to="/admin"><ShieldCheck :size="16" />内容管理</RouterLink><button class="menu-command" :disabled="signingOut" @click="signOut"><LogOut :size="16" />退出登录</button></div></details>
      </template><RouterLink v-else-if="sessionStatus === 'guest'" to="/account" class="button primary btn header-login">登录</RouterLink><span v-else-if="sessionStatus === 'loading' && !studioPage" class="header-session-status" role="status">账号加载中…</span><button v-else-if="sessionStatus === 'error'" type="button" class="icon-button" aria-label="重新加载账号" title="重新加载账号" @click="loadSession(true)"><RefreshCw :size="18" /></button></div></div>
    </div></header>
    <div v-show="mobileCommunity && mobileSearchOpen" id="mobile-community-search" class="mobile-search-panel" @keydown.esc.stop.prevent="toggleMobileSearch">
      <form v-if="mobileCommunity && mobileSearchOpen" ref="mobileSearchForm" class="mobile-community-search" role="search" aria-label="作品搜索" @submit.prevent="searchWorks"><GooeyInput v-model="searchQuery" persistent placeholder="搜索作品、提示词或创作者" /><button type="submit" class="button btn">搜索</button></form>
      <div id="mobile-discovery-filters" />
    </div>
    <p v-if="session.error && (!studioPage || !session.user)" class="notice-inline" role="alert">{{ session.error }} <button class="text-link" @click="loadSession(true)">重试</button></p>
    <main id="main" tabindex="-1"><RouterView :key="route.path.startsWith('/account') ? route.path : `${studioPage ? '/create' : route.path}:${session.user?.id || 'guest'}`" /></main>
    <BackgroundStudio />
    <footer v-if="!guestAccount && !studioPage" class="app-footer"><span>{{ site.brand }}</span><RouterLink to="/community?tab=announcements">社区公告</RouterLink></footer>
    <nav v-if="!guestAccount && !workPage" class="mobile-nav" aria-label="手机导航">
      <RouterLink to="/discover" :class="{ active: feedPage }" :aria-current="feedPage ? 'page' : undefined">首页</RouterLink>
      <RouterLink to="/create/video" :class="{ active: studioPage }" :aria-current="studioPage ? 'page' : undefined">创作</RouterLink>
      <button type="button" class="mobile-publish" aria-label="发布作品" aria-haspopup="dialog" @click="openPublish"><span><Plus :size="24" aria-hidden="true" /></span></button>
      <RouterLink :to="session.user ? '/messages' : { path: '/account', query: { returnTo: '/messages' } }" :class="{ active: route.path.startsWith('/messages') }" :aria-current="route.path.startsWith('/messages') ? 'page' : undefined"><span>消息<span v-if="unreadCount" class="mobile-unread" :aria-label="`${unreadCount} 条未读`">{{ unreadCount > 99 ? '99+' : unreadCount }}</span></span></RouterLink>
      <RouterLink :to="meDestination" :class="{ active: ownProfile || route.path === '/account' || route.path === '/library' }" :aria-current="ownProfile || route.path === '/account' || route.path === '/library' ? 'page' : undefined">我</RouterLink>
    </nav>
    <Transition name="toast"><div v-if="notice" class="toast-message" role="status">{{ notice }}</div></Transition>
    <WorkEditor :open="route.query.publish === '1'" @close="closePublish" @saved="published" />
    <MessageCenterDialog v-if="session.user" ref="messageCenter" @close="restoreMessageTrigger" />
  </div>
</template>

<style scoped>
.studio-shell { flex: none; height: calc(100dvh - var(--mobile-nav-height)); min-height: 0; }
.studio-shell > main { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.studio-header-conversation { display: flex; align-items: center; min-width: 0; }
.studio-home-link { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; color: var(--muted); }
.studio-home-link:hover { color: var(--ink); }
.header-session-status { display: inline-flex; align-items: center; min-height: 36px; min-width: 80px; font-size: 12px; line-height: 20px; color: var(--muted); white-space: nowrap; }
@media (min-width: 1000px) {
  .studio-shell { --studio-sidebar-width: clamp(248px, 14.6vw, 420px); --studio-sidebar-surface: color-mix(in srgb, var(--canvas) 76%, var(--surface)); }
  .studio-shell > main { margin-left: var(--studio-sidebar-width); }
  .studio-shell .header-inner { max-width: none; padding-left: calc(var(--studio-sidebar-width) + 32px); grid-template-columns: minmax(0, 1fr) auto; }
  .studio-shell .brand, .studio-shell .desktop-nav { display: none; }
  .studio-shell .header-tools { grid-column: 2; }
}
@media (max-width: 999px) {
  :global(#app:has(.studio-shell)) { padding-bottom: 0; }
  .studio-shell { height: var(--studio-visible-height, 100dvh); padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
  .studio-shell > .app-header, .studio-shell > .mobile-nav { display: none; }
}
.header-inner { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 32px; }
.brand { justify-self: start; min-width: 0; max-width: min(280px, 100%); }
.brand > span { overflow: hidden; text-overflow: ellipsis; }
.app-footer > span { min-width: 0; overflow-wrap: anywhere; }
.desktop-nav { align-items: center; justify-self: start; gap: 24px; }
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
  .header-inner:has(.account-balance) { grid-template-columns: auto minmax(0, 1fr); }
  .header-inner:has(.account-balance) .brand > span { display: none; }
  .header-inner:has(.account-balance) .header-tools { width: 100%; }
  .header-inner:has(.account-balance) .header-actions { flex: 1; min-width: 0; justify-content: flex-end; }
  .header-tools { gap: 4px; }
  .header-actions { justify-self: end; }
  .header-submission { width: 44px; height: 44px; margin-right: 0; }
  .header-actions:has(.header-login) { gap: 4px; }
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
@media (max-width: 379px) {
  .brand > span { display: none; }
  .header-inner:has(.account-balance) .header-search-slot { display: none; }
  .header-actions > .header-login { padding-inline: 10px; }
}
:global(#app:has(.account-entry-shell)) { padding-bottom: 0; }
.avatar { overflow: hidden; }.avatar img { width: 100%; height: 100%; object-fit: cover; }
.account-popover > a[aria-current="page"] { color: var(--blue); background: var(--blue-soft); }
.message-trigger { position: relative; }
.message-count { position: absolute; right: -3px; top: -2px; min-width: 16px; height: 16px; display: grid; place-items: center; border-radius: 8px; background: var(--blue); color: var(--action-ink); font-size: 10px; padding: 0 3px; font-variant-numeric: tabular-nums; }
.message-popover { min-width: 192px; padding: 8px; }
.message-popover::before { content: ''; position: absolute; bottom: 100%; left: 0; right: 0; height: 12px; }
.message-popover > .message-menu-link { display: flex; align-items: center; width: 100%; min-height: 44px; padding: 8px 12px; gap: 10px; border-radius: 4px; font-size: 14px; text-align: left; }
.message-menu-link:hover, .message-menu-link:focus-visible { background: var(--surface-soft); }
.message-menu-link > span:first-of-type { flex: 1; }
.message-category-count { display: grid; place-items: center; min-width: 20px; height: 20px; border-radius: 10px; padding: 0 5px; background: var(--blue); color: var(--action-ink); font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; }
.message-login { min-width: 224px; display: grid; justify-items: center; gap: 16px; padding: 20px 12px; }
.message-login p { color: var(--muted); font-size: 14px; line-height: 24px; }
.message-login .button { min-height: 44px; padding-inline: 24px; }
@media (max-width: 639px) { .header-actions { gap: 4px; }.message-popover { position: fixed; right: 16px; top: 64px; max-width: calc(100vw - 32px); } }
.community-actions { display: flex; align-items: center; gap: 8px; }
.community-rail { display: none; }
.community-shell { --page-gutter: 16px; }
.community-shell .header-inner { max-width: none; gap: 16px; padding-inline: 16px; }
.community-shell > main :deep(.page-container) { padding-inline: 16px; }
.community-shell .header-search-slot { position: relative; width: 100%; height: 44px; min-width: 0; margin: 0; }
.community-shell .header-tools { width: 100%; min-width: 0; }
@media (min-width: 1000px) {
  :global(:root:has(.community-shell)) { --header-height: 64px; }
  :global(:root:has(.community-shell.account-settings-shell)) { --header-height: 0px; }
  .community-shell { margin-left: 64px; }
  .community-shell > .app-header { height: 64px; }
  .community-shell .header-inner { display: flex; }
  .community-shell .header-inner > .brand { display: none; }
  .community-shell .header-tools { gap: 16px; }
  .community-shell .header-search-slot { flex: 1; }
  .community-shell .header-actions { flex: none; }
  .community-rail { position: fixed; z-index: 25; inset: 0 auto 0 0; display: flex; flex-direction: column; align-items: center; width: 64px; padding: 8px 0; background: var(--canvas); border-right: 1px solid var(--border); }
  .rail-brand { display: grid; place-items: center; flex: none; width: 48px; height: 48px; margin-bottom: 24px; border-radius: 8px; }
  .rail-brand img { border-radius: 6px; }
  .rail-scroll { flex: 1; width: 100%; min-height: 0; padding: 0 10px 16px; overflow-y: auto; scrollbar-width: none; }
  .rail-scroll::-webkit-scrollbar { display: none; }
  .community-rail .desktop-nav { display: flex; flex-direction: column; align-items: stretch; gap: 12px; }
  .community-rail .nav-link { display: flex; justify-content: center; flex: none; width: 44px; min-height: 44px; padding: 0; border-radius: 8px; color: var(--muted); }
  .community-rail .nav-link > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .community-rail .nav-link:hover, .community-rail .nav-link:focus-visible, .community-rail .nav-link.active { color: var(--ink); background: var(--surface-soft); }
  .community-rail .nav-link.active > svg { stroke-width: 2.4; }
  .community-rail .community-actions { flex-direction: column; gap: 12px; margin-top: 24px; }
  .community-rail .header-submission, .community-rail .message-trigger { width: 44px; height: 44px; margin: 0; border-radius: 8px; }
  .community-rail .submission-label { display: none; }
  .community-rail .header-submission:hover, .rail-settings:hover { background: var(--surface-soft); }
  .community-rail :deep(.tools-trigger) { border-radius: 8px; }
  .community-rail :deep(.tools-panel) { left: 76px; right: auto; top: 72px; max-height: calc(100dvh - 88px); }
  .community-rail .message-popover { position: fixed; left: 76px; right: auto; max-width: calc(100vw - 88px); }
  .community-rail .message-popover::before { inset: 0 auto 0 -12px; width: 12px; height: auto; }
  .rail-settings { display: grid; place-items: center; flex: none; width: 44px; height: 44px; margin-top: 8px; border-radius: 8px; }
}
@media (max-width: 999px) {
  :global(:root:has(.community-shell)) { --header-height: calc(52px + env(safe-area-inset-top)); }
  .community-shell > .mobile-community-header { height: auto; padding: env(safe-area-inset-top) 6px 0; border-bottom: 1px solid var(--border); }
  .mobile-header-row { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; gap: 2px; height: 51px; max-width: 640px; margin-inline: auto; }
  .mobile-discovery-nav { display: flex; align-items: stretch; justify-content: space-evenly; min-width: 0; height: 100%; }
  .mobile-discovery-nav > a { position: relative; display: grid; place-items: center; min-width: 44px; min-height: 44px; padding: 0 6px; font-size: 16px; font-weight: 600; color: var(--muted); }
  .mobile-discovery-nav > a:hover, .mobile-discovery-nav > a[aria-current] { color: var(--blue); }
  .mobile-discovery-nav > a[aria-current] { font-weight: 750; }
  .mobile-discovery-nav > a[aria-current]::after { content: ''; position: absolute; bottom: 2px; left: calc(50% - 10px); width: 20px; height: 3px; border-radius: 2px; background: var(--blue); }
  .mobile-discovery-nav > a:focus-visible { outline-offset: -4px; }
  .mobile-search-toggle { width: 44px; height: 44px; color: var(--ink); }
  .mobile-community-search { display: flex; gap: 8px; min-width: 0; height: 44px; }
  .mobile-community-search :deep(.gooey-input) { flex: 1; min-width: 0; }
  .mobile-community-search > .button { flex: none; min-height: 44px; }
  .mobile-community-search :deep(input) { font-size: 16px; }
  .mobile-account-tools { display: grid; gap: 4px; margin-bottom: 16px; padding: 12px; border-radius: 10px; background: var(--canvas); }
  .mobile-account-identity { display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 44px; font-weight: 600; }
  .mobile-account-identity > span:last-child { min-width: 0; overflow-wrap: anywhere; }
  .mobile-account-identity small { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }
  .mobile-account-tools :deep(.account-balance) { justify-content: flex-start; width: 100%; max-width: none; padding-inline: 0; }
  .mobile-account-tools :deep(.account-balance > span) { overflow: visible; white-space: normal; overflow-wrap: anywhere; }
  .mobile-account-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .mobile-submission { min-height: 44px; padding-inline: 16px; }
  .mobile-sign-out { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 8px 0; color: var(--muted); }
}
.mobile-search-panel { display: none; }
@media (max-width: 999px) {
  .mobile-search-panel { display: block; position: fixed; z-index: 24; top: var(--header-height); left: 0; right: 0; padding: 12px; max-height: calc(100dvh - var(--header-height) - var(--mobile-nav-height) - 12px); overflow: auto; background: var(--surface); border-bottom: 1px solid var(--border); box-shadow: 0 12px 28px #0003; }
  .mobile-page-title { margin: 0; text-align: center; font-size: 17px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-header-actions { display: flex; align-items: center; }
  .mobile-header-actions > .icon-button { width: 44px; height: 48px; }
  :global(:root:has(.mobile-profile-header)) { --header-height: calc(56px + env(safe-area-inset-top)); }
  .mobile-profile-header .mobile-header-row { height: 55px; grid-template-columns: 44px minmax(0, 1fr) 88px; }
  .mobile-back, .mobile-header-row > .icon-button { width: 44px; height: 48px; }
  .community-shell > main :deep(.discover-page) { padding: 8px 10px 20px; }
  .community-shell > main :deep(.creator-page), .community-shell > main :deep(.detail-page), .community-shell > main :deep(.messages-page:not(.embedded)) { padding-inline: 0; }
  .community-shell > .app-footer { display: none; }
  :global(:root:has(.work-shell)) { --mobile-nav-height: 0px; }
  .work-shell .mobile-page-title { font-size: 15px; }
}
@media (max-width: 360px) { .mobile-discovery-nav > a { font-size: 14px; padding-inline: 4px; } }
</style>
