<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { isNavigationFailure, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Bell, Gift, Heart, House, LogOut, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Plus, RefreshCw, Search, Send, Settings, ShieldCheck, Sun, Users, X } from '@lucide/vue'
import WorkEditor from './components/WorkEditor.vue'
import BackgroundStudio from './components/BackgroundStudio.vue'
import CommunityTools from './components/CommunityTools.vue'
import AccountBalance from './components/AccountBalance.vue'
import MessageCenterDialog from './components/MessageCenterDialog.vue'
import GooeyInput from './components/GooeyInput.vue'
import type { Work } from './data'
import { errorMessage, loadSession, logout, notice, notify, rememberLotteryInvite, rememberReferralInvite, session, sessionStatus } from './state'
import { inbox, loadInbox, type InboxCategory } from './inbox'
import { lotteryBalance, lotteryCount, lotteryDescription, lotteryLabel, refreshLotteryBalance } from './lottery-balance'
import { loadSite, site } from './site'
import { studioSidebarWidth } from './studio-preferences'
import { appearance, themeState } from './appearance'

const route = useRoute(), router = useRouter()
const guestAccount = computed(() => route.path === '/account' && !session.user)
const accountSettings = computed(() => route.path === '/account' && !!session.user)
const accountSettingDetail = computed(() => accountSettings.value && typeof route.query.tab === 'string' && ['privacy', 'following', 'theme', 'security', 'balance'].includes(route.query.tab))
const studioPage = computed(() => route.path === '/create' || route.path.startsWith('/create/'))
const communityShell = computed(() => !guestAccount.value && !studioPage.value)
const wideViewport = ref(window.innerWidth >= 1000)
const desktopCommunity = computed(() => communityShell.value && wideViewport.value)
const mobileCommunity = computed(() => communityShell.value && !wideViewport.value)
const railExpanded = ref(false)
const railHint = ref<{ label: string; top: number } | null>(null)
const themeToggleLabel = computed(() => themeState.value.current === 'dark' ? '切换到明亮模式' : '切换到暗色模式')
function toggleTheme() {
  railHint.value = null
  appearance.set({ mode: themeState.value.current === 'dark' ? 'light' : 'dark' })
}
async function toggleRail() {
  railHint.value = null
  railExpanded.value = !railExpanded.value
  document.querySelectorAll<HTMLDetailsElement>('.community-rail .header-menu[open]').forEach(menu => { menu.open = false })
  await nextTick()
  document.querySelector<HTMLButtonElement>('.community-rail :is(.rail-toggle, .rail-brand-toggle)')?.focus({ preventScroll: true })
}
function showRailHint(event: Event) {
  if (!(event.target instanceof Element) || !desktopCommunity.value) return
  if (event.target.closest('.rail-tooltip')) return
  const control = event.target.closest<HTMLElement>('a, button, summary')
  const label = control?.getAttribute('aria-label')
  if (!control || !label) return
  if (control.closest('.tools-panel') || (railExpanded.value && !control.matches('.rail-toggle, .rail-theme'))) { railHint.value = null; return }
  const bounds = control.getBoundingClientRect()
  railHint.value = { label, top: Math.max(24, Math.min(window.innerHeight - 24, bounds.top + bounds.height / 2)) }
}
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
  { sort: 'recommended', label: '发现' }, { sort: 'latest', label: '最新' },
  { sort: 'featured', label: '热门' }, { sort: 'following', label: '关注' },
]
function discoveryDestination(sort: string) {
  const query = route.path === '/discover' ? route.query : {}
  return { path: '/discover', query: { ...query, sort: sort === 'recommended' ? undefined : sort } }
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
  railHint.value = null
  viewportHeight.value = window.visualViewport?.height || window.innerHeight
  const wide = window.innerWidth >= 1000
  if (wide !== wideViewport.value) {
    clearTimeout(hoverCloseTimer)
    document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { menu.open = false })
    wideViewport.value = wide
  }
}
const links = [
  { path: '/discover', label: '首页', icon: House },
  { path: '/community', label: '社区', icon: Users },
  { path: '/create', label: '创作台', icon: PanelsTopLeft },
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
const messageMenu = ref<HTMLDetailsElement>(), profileMenu = ref<HTMLDetailsElement>()
const messageCenter = ref<InstanceType<typeof MessageCenterDialog>>()
let poll: ReturnType<typeof setInterval> | undefined
let lotteryPoll: ReturnType<typeof setInterval> | undefined
let hoverCloseTimer: ReturnType<typeof setTimeout> | undefined
async function refreshActiveIdentity() {
  if (session.user && document.visibilityState !== 'hidden') {
    await loadSession(true)
    if (!document.hidden) void refreshLotteryBalance(true)
  }
}
function refreshVisibleLottery() { if (document.visibilityState !== 'hidden') void refreshLotteryBalance() }
watch([() => session.user?.id, () => session.user?.accountId, () => route.path], refreshVisibleLottery, { immediate: true })
watch(() => route.query.invite, value => { rememberLotteryInvite(value) }, { immediate: true })
watch(() => route.query.aff, value => { rememberReferralInvite(value) }, { immediate: true })
onMounted(() => {
  void loadSession()
  void loadSite()
  lotteryPoll = setInterval(refreshVisibleLottery, 30000)
  window.addEventListener('focus', refreshActiveIdentity)
  window.addEventListener('pageshow', refreshActiveIdentity)
  document.addEventListener('visibilitychange', refreshActiveIdentity)
  window.visualViewport?.addEventListener('resize', resizeViewport)
  window.addEventListener('resize', resizeViewport)
})
onBeforeUnmount(() => {
  clearInterval(poll); clearInterval(lotteryPoll); clearTimeout(hoverCloseTimer); clearTimeout(searchTimer)
  window.removeEventListener('focus', refreshActiveIdentity)
  window.removeEventListener('pageshow', refreshActiveIdentity)
  document.removeEventListener('visibilitychange', refreshActiveIdentity)
  window.visualViewport?.removeEventListener('resize', resizeViewport)
  window.removeEventListener('resize', resizeViewport)
})
watch(() => route.fullPath, () => {
  railHint.value = null
  clearTimeout(searchTimer)
  clearTimeout(hoverCloseTimer)
  searchQuery.value = typeof route.query.q === 'string' ? route.query.q : ''
  messageCenter.value?.close()
  document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => { menu.open = false })
})
watch([() => route.meta.title, () => site.brand], () => { document.title = `${String(route.meta.title || '首页')} · ${site.brand}` }, { immediate: true })
watch(() => session.user?.id, id => {
  clearInterval(poll)
  clearTimeout(hoverCloseTimer)
  messageCenter.value?.close()
  if (messageMenu.value) messageMenu.value.open = false
  if (profileMenu.value) profileMenu.value.open = false
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
  if (opened.classList.contains('messages-menu')) void loadInbox()
}
function openHoverMenu(event: Event, menu: HTMLDetailsElement | undefined) {
  if (event instanceof PointerEvent && event.pointerType !== 'mouse') return
  if (!(event instanceof FocusEvent && menu === profileMenu.value) && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
  clearTimeout(hoverCloseTimer)
  if (menu && !menu.open) menu.open = true
}
function leaveHoverMenu(event: Event, menu: HTMLDetailsElement | undefined) {
  const boundary = event.currentTarget as HTMLElement
  if (event instanceof FocusEvent && event.relatedTarget instanceof Node && boundary.contains(event.relatedTarget)) return
  clearTimeout(hoverCloseTimer)
  hoverCloseTimer = setTimeout(() => {
    if (menu && !boundary.matches(':hover') && !boundary.contains(document.activeElement)) menu.open = false
  }, 120)
}
function dismissMenus(event: Event) {
  const insideSearch = event.composedPath().some(node => node instanceof Element && node.matches('.mobile-community-header, .mobile-search-panel'))
  if (mobileSearchOpen.value && (event.type === 'keydown' || !insideSearch)) {
    mobileSearchOpen.value = false
    if (event.type === 'keydown') mobileSearchButton.value?.focus()
  }
  if (event.type === 'click' && (event.target as HTMLElement).closest('.header-menu')) return
  document.querySelectorAll<HTMLDetailsElement>('.header-menu[open]').forEach(menu => {
    if (event.type === 'keydown') {
      const trigger = menu === profileMenu.value ? menu.previousElementSibling : menu.querySelector('summary')
      if (trigger instanceof HTMLElement) trigger.focus()
    }
    menu.open = false
  })
}
function showMessageCenter(category: InboxCategory) {
  clearTimeout(hoverCloseTimer)
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
  <div class="app-shell" :class="{ 'account-entry-shell': guestAccount, 'account-settings-shell': accountSettings, 'studio-shell': studioPage, 'community-shell': communityShell, 'rail-expanded': desktopCommunity && railExpanded, 'work-shell': workPage, 'profile-shell': profilePage }" :style="studioPage ? { '--studio-visible-height': `${viewportHeight}px`, '--studio-sidebar-width': studioSidebarWidth ? `${studioSidebarWidth}px` : undefined } : undefined" @click="dismissMenus" @keydown.esc="dismissMenus">
    <a href="#main" class="skip-link">跳至内容</a>
    <aside v-show="communityShell" class="community-rail" aria-label="社区侧栏" @pointerover="showRailHint" @focusin="showRailHint" @pointerleave="railHint = null" @focusout="railHint = null" @pointerdown="railHint = null" @keydown.esc="railHint = null" @scroll.capture="railHint = null">
      <div class="rail-heading">
        <button v-if="!railExpanded" type="button" class="rail-brand rail-brand-toggle" aria-label="展开侧栏" title="展开侧栏" aria-controls="community-rail-navigation community-rail-actions" :aria-expanded="railExpanded" @click="toggleRail"><img v-if="site.logoUrl" :src="site.logoUrl" width="40" height="40" alt="" /><span v-else class="rail-brand-fallback" aria-hidden="true">{{ site.brand.slice(0, 1) }}</span><PanelLeftOpen class="rail-icon" :size="22" aria-hidden="true" /></button>
        <RouterLink v-else to="/discover" class="rail-brand" :aria-label="`${site.brand}首页`" :title="site.brand"><img v-if="site.logoUrl" :src="site.logoUrl" width="28" height="28" alt="" /><span v-else class="rail-brand-fallback">{{ site.brand.slice(0, 1) }}</span><span class="rail-brand-label">{{ site.brand }}</span></RouterLink>
        <button v-if="railExpanded" type="button" class="rail-toggle icon-button" aria-label="收起侧栏" title="收起侧栏" aria-controls="community-rail-navigation community-rail-actions" :aria-expanded="railExpanded" @click="toggleRail"><PanelLeftClose class="rail-icon" :size="22" aria-hidden="true" /></button>
      </div>
      <div class="rail-primary">
        <div class="rail-scroll"><div id="community-rail-navigation" /><div id="community-rail-actions" /></div>
      </div>
      <div class="rail-utilities">
        <RouterLink to="/account" class="rail-settings icon-button" aria-label="账号设置" title="账号设置" :aria-current="accountSettings ? 'page' : undefined"><Settings class="rail-icon" :size="22" aria-hidden="true" /><span class="rail-label">账号设置</span></RouterLink>
        <button type="button" class="rail-theme icon-button" :aria-label="themeToggleLabel" :title="themeToggleLabel" @click="toggleTheme"><component :is="themeState.current === 'dark' ? Sun : Moon" class="rail-icon" :size="22" aria-hidden="true" /></button>
      </div>
      <div v-if="railHint" class="rail-tooltip" role="tooltip" aria-hidden="true" :style="{ top: railHint.top + 'px' }"><span>{{ railHint.label }}</span></div>
    </aside>
    <header v-if="mobileCommunity" class="app-header mobile-community-header" :class="{ 'mobile-search-open': mobileSearchOpen, 'mobile-profile-header': profilePage }">
      <div class="mobile-header-row">
        <button v-if="accountSettingDetail" type="button" class="icon-button mobile-back" aria-label="返回账户设置" title="返回账户设置" @click="router.push('/account')"><ArrowLeft :size="22" /></button>
        <button v-else-if="profilePage || workPage" type="button" class="icon-button mobile-back" aria-label="返回上一页" @click="mobileBack"><ArrowLeft :size="22" /></button>
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
        <nav v-if="feedPage" class="mobile-discovery-nav" aria-label="作品浏览">
          <RouterLink v-for="link in discoveryLinks" :key="link.sort" :to="discoveryDestination(link.sort)" :aria-current="(route.query.sort || 'recommended') === link.sort ? 'page' : undefined">{{ link.label }}</RouterLink>
        </nav>
        <component v-else :is="profilePage || workPage ? 'strong' : 'h1'" class="mobile-page-title">{{ mobilePageTitle }}</component>
        <div class="mobile-header-actions"><button v-if="!accountSettings" ref="mobileSearchButton" type="button" class="icon-button mobile-search-toggle" :aria-label="mobileSearchOpen ? '收起搜索作品' : '展开搜索作品'" :aria-expanded="mobileSearchOpen" aria-controls="mobile-community-search" @click="toggleMobileSearch"><X v-if="mobileSearchOpen" :size="22" aria-hidden="true" /><Search v-else :size="22" aria-hidden="true" /></button><RouterLink v-if="profilePage" to="/account" class="icon-button" aria-label="账号设置"><Settings :size="22" /></RouterLink></div>
      </div>
    </header>
    <header v-else-if="!guestAccount" v-show="!accountSettings && !profilePage" class="app-header"><div class="header-inner">
      <RouterLink to="/discover" class="brand" :aria-label="`${site.brand}首页`"><img v-if="site.logoUrl" class="brand-mark" :src="site.logoUrl" width="32" height="32" alt="" /><span>{{ site.brand }}</span></RouterLink>
      <Teleport to="#community-rail-navigation" :disabled="!desktopCommunity" defer><nav class="desktop-nav" aria-label="主导航"><RouterLink v-for="link in links" :key="link.path" :to="link.path" class="nav-link" :class="{ active: isCurrent(link.path) }" :aria-label="link.label" :title="link.label" :aria-current="isCurrent(link.path) ? 'page' : undefined"><component v-if="communityShell" :is="link.icon" class="rail-icon" :size="22" aria-hidden="true" /><span class="rail-label">{{ link.label }}</span></RouterLink></nav></Teleport>
      <div v-if="studioPage" id="studio-header-conversation" class="studio-header-conversation"><RouterLink v-if="!session.user" to="/discover" class="studio-home-link"><House :size="16" />返回社区</RouterLink></div>
      <div class="header-tools"><form v-if="communityShell && !feedPage" id="header-search" class="header-search-slot" role="search" aria-label="作品搜索" @submit.prevent="searchWorks"><GooeyInput v-model="searchQuery" persistent placeholder="搜索作品、提示词或创作者" /></form>
      <div class="header-actions"><Teleport to="#community-rail-actions" :disabled="!desktopCommunity" defer><div class="community-actions"><CommunityTools @toggle="toggleHeaderMenu" /><RouterLink v-if="communityShell && (sessionStatus === 'authenticated' || sessionStatus === 'guest')" :to="session.user ? { path: route.path, query: { ...route.query, publish: '1' } } : { path: '/account' }" class="header-submission" aria-label="投稿" title="投稿"><Send class="submission-icon rail-icon" :size="22" aria-hidden="true" /><span class="submission-label rail-label">投稿</span></RouterLink></div></Teleport>
        <details ref="messageMenu" class="header-menu messages-menu" @toggle="toggleHeaderMenu" @pointerenter="openHoverMenu($event, messageMenu)" @pointerleave="leaveHoverMenu($event, messageMenu)" @focusin="openHoverMenu($event, messageMenu)" @focusout="leaveHoverMenu($event, messageMenu)">
          <summary class="icon-button message-trigger" :aria-label="unreadCount ? `消息，${unreadCount > 99 ? '99+' : unreadCount} 条未读` : '消息'" :aria-description="unreadCount > 99 ? `共 ${unreadCount} 条未读消息` : undefined" title="消息"><MessageSquare class="rail-icon" :size="22" aria-hidden="true" /><span v-if="unreadCount" class="message-count" aria-hidden="true">{{ unreadCount > 99 ? '99+' : unreadCount }}</span></summary>
          <div class="menu-popover message-popover">
            <template v-if="session.user"><button v-for="item in messageLinks" :key="item.category" type="button" class="message-menu-link" aria-haspopup="dialog" @click="showMessageCenter(item.category)"><component :is="item.icon" :size="17" /><span>{{ item.label }}</span><span v-if="inbox.counts[item.category]" class="message-category-count">{{ inbox.counts[item.category] > 99 ? '99+' : inbox.counts[item.category] }}</span></button></template>
            <div v-else-if="sessionStatus === 'guest'" class="message-login"><p>登录即可查看关注动态</p><RouterLink to="/account" class="button primary btn">立即登录</RouterLink></div>
            <div v-else class="message-login"><p>{{ sessionStatus === 'loading' ? '正在加载账号…' : '账号暂时无法加载' }}</p><button v-if="sessionStatus === 'error'" type="button" class="button btn subtle" @click="loadSession(true)">重新加载</button></div>
          </div>
        </details>
        <RouterLink v-if="desktopCommunity" to="/activities" class="icon-button header-welfare" :aria-label="lotteryLabel" :aria-description="lotteryDescription" :title="lotteryDescription || '福利中心'" :aria-current="isCurrent('/activities') ? 'page' : undefined"><Gift class="rail-icon" :size="22" aria-hidden="true" /><span v-if="lotteryCount" class="message-count lottery-count" aria-hidden="true">{{ lotteryCount > 99 ? '99+' : lotteryCount }}</span></RouterLink>
        <template v-if="session.user">
        <AccountBalance />
        <div class="profile-menu" @pointerleave="leaveHoverMenu($event, profileMenu)" @focusout="leaveHoverMenu($event, profileMenu)">
          <RouterLink :to="meDestination" class="profile-toggle" aria-label="个人主页" aria-describedby="account-preview-identity" :aria-current="ownProfile ? 'page' : undefined" @pointerenter="openHoverMenu($event, profileMenu)" @focus="openHoverMenu($event, profileMenu)"><span class="avatar blue"><img v-if="session.user.avatarUrl" :src="session.user.avatarUrl" alt="" /><span v-else>{{ (session.user.name || session.user.username).slice(0, 1) }}</span></span></RouterLink>
          <details ref="profileMenu" class="header-menu profile-disclosure" @toggle="toggleHeaderMenu"><summary hidden>账户预览</summary><div class="menu-popover account-popover" @pointerenter="openHoverMenu($event, profileMenu)"><div id="account-preview-identity" class="menu-title">{{ session.user.name || session.user.username }}<span v-if="session.user.accountId" class="caption-5">章鱼号：{{ session.user.accountId }}</span></div>
            <RouterLink :to="meDestination"><Users :size="16" />个人主页</RouterLink><RouterLink v-if="!desktopCommunity" to="/account"><Settings :size="16" />账号设置</RouterLink><RouterLink v-if="session.user.isAdmin || session.user.isModerator" to="/admin"><ShieldCheck :size="16" />内容管理</RouterLink><button v-if="!desktopCommunity" class="menu-command" :disabled="signingOut" @click="signOut"><LogOut :size="16" />退出登录</button></div></details>
        </div>
      </template><RouterLink v-else-if="sessionStatus === 'guest'" to="/account" class="button primary btn header-login">登录</RouterLink><span v-else-if="sessionStatus === 'loading' && !studioPage" class="header-session-status" role="status">账号加载中…</span><button v-else-if="sessionStatus === 'error'" type="button" class="icon-button" aria-label="重新加载账号" title="重新加载账号" @click="loadSession(true)"><RefreshCw :size="18" /></button></div></div>
    </div></header>
    <div v-show="mobileCommunity && mobileSearchOpen" id="mobile-community-search" class="mobile-search-panel" @keydown.esc.stop.prevent="toggleMobileSearch">
      <form v-if="mobileCommunity && mobileSearchOpen" ref="mobileSearchForm" class="mobile-community-search" role="search" aria-label="作品搜索" @submit.prevent="searchWorks"><GooeyInput v-model="searchQuery" persistent placeholder="搜索作品、提示词或创作者" /></form>
      <div id="mobile-discovery-filters" />
    </div>
    <p v-if="session.error && (!studioPage || !session.user)" class="notice-inline" role="alert">{{ session.error }} <button class="text-link" @click="loadSession(true)">重试</button></p>
    <main id="main" tabindex="-1"><RouterView :key="route.path.startsWith('/account') ? route.path : `${studioPage ? '/create' : route.path}:${session.user?.id || 'guest'}`" /></main>
    <BackgroundStudio />
    <footer v-if="!guestAccount && !studioPage" class="app-footer"><span>{{ site.brand }}</span><RouterLink to="/messages?tab=announcement">公告</RouterLink></footer>
    <nav v-if="!guestAccount && !workPage" class="mobile-nav" aria-label="手机导航">
      <RouterLink to="/discover" :class="{ active: feedPage }" :aria-current="feedPage ? 'page' : undefined">首页</RouterLink>
      <RouterLink to="/create/video" :class="{ active: studioPage }" :aria-current="studioPage ? 'page' : undefined">创作</RouterLink>
      <button type="button" class="mobile-publish" aria-label="发布作品" aria-haspopup="dialog" @click="openPublish"><span><Plus :size="24" aria-hidden="true" /></span></button>
      <RouterLink :to="session.user ? '/messages' : { path: '/account', query: { returnTo: '/messages' } }" :class="{ active: route.path.startsWith('/messages') }" :aria-current="route.path.startsWith('/messages') ? 'page' : undefined"><span>消息<span v-if="unreadCount" class="mobile-unread" :aria-label="`${unreadCount} 条未读`">{{ unreadCount > 99 ? '99+' : unreadCount }}</span></span></RouterLink>
      <RouterLink :to="meDestination" :class="{ active: ownProfile || route.path === '/account' || route.path === '/library' }" :aria-current="ownProfile || route.path === '/account' || route.path === '/library' ? 'page' : undefined">我</RouterLink>
    </nav>
    <span class="lottery-status" role="status" aria-atomic="true">{{ session.user && lotteryBalance.balance !== null ? `剩余 ${lotteryBalance.balance} 次抽奖机会` : '' }}</span>
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
.header-actions > .button.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 88%, var(--canvas)); color: var(--canvas); }
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
.profile-menu { position: relative; display: flex; flex: none; align-items: center; }
.profile-toggle { display: flex; align-items: center; justify-content: center; inline-size: 44px; min-block-size: 44px; padding: 0; border-radius: var(--radius); }
.profile-disclosure { position: static; }
.profile-toggle:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.account-popover::before { content: ''; position: absolute; inset: auto 0 100%; block-size: 12px; }
.account-popover > a[aria-current="page"] { color: var(--ink); background: var(--state-selected); }
.account-popover > a[aria-current="page"]:hover { background: var(--state-pressed); }
.message-trigger { position: relative; }
.message-count { position: absolute; right: 0; top: 0; min-width: 16px; height: 18px; display: grid; place-items: center; border: 2px solid var(--canvas); border-radius: 9px; background: var(--blue); color: var(--action-ink); font-size: 10px; line-height: 14px; padding: 0 3px; font-variant-numeric: tabular-nums; }
.lottery-status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.message-popover { min-width: 192px; padding: 8px; }
.message-popover::before { content: ''; position: absolute; bottom: 100%; left: 0; right: 0; height: 12px; }
.message-popover > .message-menu-link { display: flex; align-items: center; width: 100%; min-height: 44px; padding: 8px 12px; gap: 10px; border-radius: 4px; font-size: 14px; text-align: left; }
.message-menu-link:hover, .message-menu-link:focus-visible { color: var(--ink); background: var(--state-hover); }
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
  :global(:root:has(.community-shell)) { --header-height: 80px; }
  :global(:root:has(.community-shell:is(.account-settings-shell, .profile-shell))) { --header-height: 0px; }
  .community-shell { --community-rail-width: 92px; --rail-control-size: 44px; --rail-brand-size: 44px; margin-left: var(--community-rail-width); }
  .community-shell.rail-expanded { --community-rail-width: 248px; }
  .community-shell > .app-header { height: 80px; }
  .community-shell .header-inner { display: flex; }
  .community-shell .header-inner > .brand { display: none; }
  .community-shell .header-tools { justify-content: flex-end; gap: 16px; }
  .community-shell .header-search-slot { flex: 1; }
  .community-shell .header-actions { flex: none; }
  .community-shell .header-actions :is(.message-trigger, .header-welfare) { position: relative; flex: none; inline-size: 44px; block-size: 44px; min-block-size: 44px; padding: 0; border-radius: var(--radius); color: var(--muted); }
  .community-shell .header-actions :is(.message-trigger, .header-welfare) > .rail-icon { inline-size: var(--icon-size-nav); block-size: var(--icon-size-nav); stroke-width: var(--icon-stroke-width); }
  .community-shell .header-actions :is(.message-trigger, .header-welfare):hover { color: var(--ink); background: var(--state-hover); }
  .community-shell .messages-menu[open] > .message-trigger, .community-shell .header-actions .header-welfare[aria-current="page"] { color: var(--ink); background: var(--state-selected); }
  .community-shell .messages-menu[open] > .message-trigger:hover, .community-shell .header-actions .header-welfare[aria-current="page"]:hover { background: var(--state-pressed); }
  .community-shell .header-actions :is(.message-trigger, .header-welfare):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .community-rail { --icon-size-nav: 20px; position: fixed; z-index: 25; inset: 0 auto 0 0; display: flex; flex-direction: column; align-items: center; gap: 24px; width: var(--community-rail-width, 92px); padding: 16px 12px; }
  .rail-heading { display: flex; align-items: center; justify-content: center; flex: none; width: 64px; min-width: 0; height: var(--rail-brand-size); }
  .rail-primary, .rail-utilities { display: flex; flex-direction: column; align-items: center; width: 64px; padding: 8px; }
  .rail-primary { flex: 0 1 auto; min-height: 0; }
  .rail-utilities { flex: none; gap: 8px; border-top: 1px solid var(--border); }
  .rail-brand { display: flex; align-items: center; justify-content: center; flex: none; width: var(--rail-brand-size); height: var(--rail-brand-size); min-width: 0; border-radius: 12px; }
  .rail-brand img { flex: none; width: var(--rail-brand-size); height: var(--rail-brand-size); border-radius: 12px; }
  .rail-brand-fallback { display: grid; place-items: center; flex: none; width: var(--rail-brand-size); height: var(--rail-brand-size); }
  .rail-brand-label { display: none; }
  .rail-scroll { flex: 0 1 auto; width: 48px; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-width: none; }
  .community-rail .desktop-nav { display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
  .community-rail .nav-link, .community-rail .header-submission, .rail-settings, .rail-theme, .rail-toggle, .community-rail :deep(.tools-trigger) { position: relative; display: flex; align-items: center; justify-content: center; flex: none; width: var(--rail-control-size); height: var(--rail-control-size); min-height: var(--rail-control-size); padding: 0; margin: 0; border-radius: 12px; color: var(--muted); }
  .community-rail :deep(.rail-icon) { flex: none; width: var(--icon-size-nav); height: var(--icon-size-nav); stroke-width: var(--icon-stroke-width); }
  .community-rail .rail-label { display: none; }
  .community-rail .nav-link:hover, .community-rail .header-submission:hover, .rail-settings:hover, .rail-theme:hover, .rail-toggle:hover, .community-rail :deep(.tools-trigger:hover) { color: var(--ink); background: var(--state-hover); }
  .community-rail :is(.nav-link, .rail-settings, .rail-theme)[aria-current="page"] { color: var(--canvas); background: var(--ink); }
  .community-rail :is(.nav-link, .rail-settings, .rail-theme)[aria-current="page"]::after { display: none; }
  .header-welfare[aria-current="page"]::after { content: ''; display: block; position: absolute; bottom: 4px; left: calc(50% - 6px); width: 12px; height: 2px; border-radius: 1px; background: currentColor; }
  .community-rail :deep(.tools-trigger:focus-visible), .community-rail :is(.nav-link, .header-submission, .rail-settings, .rail-theme, .rail-toggle, .rail-brand-toggle):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .community-rail .community-actions { flex-direction: column; gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
  .community-rail :deep(.community-tools[open] > .tools-trigger) { color: var(--ink); background: var(--state-selected); }
  .community-rail :deep(.community-tools[open] > .tools-trigger:hover) { background: var(--state-pressed); }
  .community-rail :deep(.tools-panel) { left: calc(var(--community-rail-width) + 12px); right: auto; top: 72px; max-height: calc(100dvh - 88px); }
  .rail-tooltip { position: fixed; z-index: 60; left: calc(var(--community-rail-width) - 4px); transform: translateY(-50%); padding-left: 12px; max-width: calc(100vw - var(--community-rail-width) - 12px); }
  .rail-tooltip > span { display: block; padding: 8px 12px; border-radius: 6px; background: var(--ink); color: var(--canvas); font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
  .community-shell:not(.rail-expanded) .community-rail { padding: 20px 16px; padding-top: calc((80px - var(--rail-brand-size)) / 2); }
  .community-shell:not(.rail-expanded) .rail-heading { width: calc(var(--rail-control-size) + 16px); height: var(--rail-brand-size); }
  .community-shell:not(.rail-expanded) .rail-brand { width: var(--rail-brand-size); height: var(--rail-brand-size); border: 0; border-radius: 0; background: transparent; box-shadow: none; }
  .community-shell:not(.rail-expanded) .rail-brand :is(img, .rail-brand-fallback) { width: var(--rail-brand-size); height: var(--rail-brand-size); border-radius: 12px; }
  .community-shell:not(.rail-expanded) .rail-brand-toggle { position: relative; padding: 0; border-radius: 12px; color: var(--muted); }
  .rail-brand-toggle > .rail-icon { position: absolute; opacity: 0; }
  .community-shell:not(.rail-expanded) .rail-brand-toggle:is(:hover, :focus-visible) { color: var(--ink); background: var(--state-hover); }
  .rail-brand-toggle:is(:hover, :focus-visible) :is(img, .rail-brand-fallback) { opacity: 0; }
  .rail-brand-toggle:is(:hover, :focus-visible) > .rail-icon { opacity: 1; }
  .community-shell:not(.rail-expanded) :is(.rail-primary, .rail-utilities) { width: calc(var(--rail-control-size) + 16px); }
  .community-shell:not(.rail-expanded) .rail-scroll { width: var(--rail-control-size); }
  .community-shell:not(.rail-expanded) .community-rail :is(.nav-link, .header-submission, .rail-settings, .rail-theme, .rail-toggle), .community-shell:not(.rail-expanded) .community-rail :deep(.tools-trigger) { width: var(--rail-control-size); height: var(--rail-control-size); min-height: var(--rail-control-size); border-radius: 12px; }
  .rail-expanded .community-rail { align-items: stretch; padding: calc((80px - var(--rail-brand-size)) / 2) 20px 20px; }
  .rail-expanded .community-rail::before { content: ''; position: absolute; z-index: -1; inset: 12px; border-radius: 24px; background: var(--surface); box-shadow: 0 4px 16px #0000000d; }
  .rail-expanded .rail-heading { justify-content: space-between; width: 100%; }
  .rail-expanded .rail-brand { justify-content: flex-start; flex: 1; gap: 10px; width: auto; padding-inline-start: 4px; background: transparent; box-shadow: none; }
  .rail-expanded .rail-brand-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 600; }
  .rail-expanded .rail-primary, .rail-expanded .rail-utilities { width: 100%; padding: 0; border-radius: 0; background: transparent; box-shadow: none; }
  .rail-expanded .rail-primary { align-self: stretch; padding-block: 8px; }
  .rail-expanded .rail-scroll { width: 100%; height: 100%; }
  .rail-expanded .community-rail .desktop-nav { justify-self: stretch; gap: 8px; width: 100%; }
  .rail-expanded .community-rail :is(.nav-link, .header-submission) { justify-content: flex-start; gap: 12px; width: 100%; padding-inline: 16px; border-radius: 12px; }
  .rail-expanded .community-rail .rail-label { display: inline; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; }
  .rail-expanded .community-rail .community-actions { align-items: stretch; }
  .rail-expanded .community-rail :deep(.tools-trigger) { justify-content: flex-start; gap: 12px; width: 100%; padding-inline: 16px; border: 0; border-radius: 12px; }
  .rail-expanded .community-rail :deep(.tools-trigger)::after { content: '社区工具'; font-size: 14px; font-weight: 500; }
  .rail-expanded .rail-utilities { flex-direction: row; align-items: center; gap: 4px; padding-top: 8px; border-top: 1px solid var(--border); }
  .rail-expanded .rail-settings { justify-content: flex-start; flex: 1; gap: 12px; width: auto; padding-inline: 16px; border: 0; border-radius: 12px; }
  .rail-expanded .rail-theme, .rail-expanded .rail-toggle { width: 44px; height: 44px; min-height: 44px; border-radius: 12px; }
}
@media (min-width: 1000px) and (max-height: 640px) {
  .community-rail { gap: 12px; padding-block: 12px; }
  .rail-utilities { gap: 4px; }
  .community-rail .desktop-nav, .rail-expanded .community-rail .desktop-nav, .community-rail .community-actions { gap: 4px; }
  .community-rail .community-actions { margin-top: 8px; padding-top: 8px; }
  .rail-expanded .community-rail { gap: 12px; }
}
@media (max-width: 999px) {
  :global(:root:has(.community-shell)) { --header-height: calc(52px + env(safe-area-inset-top)); }
  .community-shell > .mobile-community-header { height: auto; padding: env(safe-area-inset-top) 6px 0; border-bottom: 1px solid var(--border); }
  .mobile-header-row { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; gap: 2px; height: 51px; max-width: 640px; margin-inline: auto; }
  .mobile-discovery-nav { display: flex; align-items: stretch; justify-content: space-evenly; min-width: 0; height: 100%; }
  .mobile-discovery-nav > a { position: relative; display: grid; place-items: center; min-width: 44px; min-height: 44px; padding: 0 6px; font-size: 16px; font-weight: 600; color: var(--muted); }
  .mobile-discovery-nav > a:hover, .mobile-discovery-nav > a[aria-current] { color: var(--ink); }
  .mobile-discovery-nav > a[aria-current] { font-weight: 750; }
  .mobile-discovery-nav > a[aria-current]::after { content: ''; position: absolute; bottom: 2px; left: calc(50% - 10px); width: 20px; height: 3px; border-radius: 2px; background: currentColor; }
  .mobile-discovery-nav > a:focus-visible { outline-offset: -4px; }
  .mobile-search-toggle { width: 44px; height: 44px; color: var(--ink); }
  .mobile-community-search { display: flex; gap: 8px; min-width: 0; height: 44px; }
  .mobile-community-search :deep(.gooey-input) { flex: 1; min-width: 0; }
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
