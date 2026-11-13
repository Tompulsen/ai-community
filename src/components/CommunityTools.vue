<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Bell, Bookmark, Compass, FolderOpen, Gift, Image, LayoutGrid, LockKeyhole, Megaphone, MessageSquare, RefreshCw, Search, Settings, ShieldCheck, UserRound, Users, Video, Wallet, WandSparkles, X } from '@lucide/vue'
import { inbox, loadInbox } from '../inbox'
import { session } from '../state'

interface Tool { label: string; icon: Component; to?: string; member?: boolean; count?: number; action?: 'search' | 'refresh' }
const router = useRouter()
const menu = ref<HTMLDetailsElement>(), trigger = ref<HTMLElement>(), searchInput = ref<HTMLInputElement>()
const query = ref('')
const tools = computed<Tool[]>(() => [
  { label: '通知', icon: Bell, to: '/messages?tab=activity', member: true, count: inbox.counts.activity },
  { label: '发现', icon: Compass, to: '/discover' },
  { label: '公告', icon: Megaphone, to: '/community?tab=announcements', count: inbox.counts.announcement },
  { label: '搜索', icon: Search, action: 'search' },
  { label: '创作者', icon: Users, to: '/community?tab=creators' },
  { label: '收藏', icon: Bookmark, to: '/library?tab=saved', member: true },
  { label: '我的作品', icon: FolderOpen, to: '/library', member: true },
  { label: '消息', icon: MessageSquare, to: '/messages', member: true, count: inbox.counts.messages },
  { label: '图片', icon: Image, to: '/discover?kind=image' },
  { label: '视频', icon: Video, to: '/discover?kind=video' },
  { label: '创作台', icon: WandSparkles, to: '/create', member: true },
  { label: '推广中心', icon: Gift, to: '/activities' },
  { label: session.user ? '个人主页' : '个人资料', icon: UserRound, to: session.user ? `/community?creator=${encodeURIComponent(session.user.id)}` : '/account?tab=profile', member: true },
  { label: '账号设置', icon: Settings, to: '/account?tab=profile', member: true },
  { label: '账户余额', icon: Wallet, to: '/account?tab=balance', member: true },
  { label: '刷新', icon: RefreshCw, action: 'refresh' },
])
function destination(tool: Tool) {
  return tool.member && !session.user ? { path: '/account', query: { returnTo: tool.to } } : tool.to!
}
function close() {
  if (menu.value) menu.value.open = false
  trigger.value?.focus()
}
function toggle() { if (menu.value?.open) void loadInbox() }
function blur(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !menu.value?.contains(event.relatedTarget) && menu.value) menu.value.open = false
}
function searchWorks() {
  const value = query.value.trim()
  if (!value) { searchInput.value?.focus(); return }
  close()
  void router.push({ path: '/discover', query: { q: value } })
}
function run(action: Tool['action']) {
  if (action === 'search') searchInput.value?.focus()
  else if (action === 'refresh') { close(); window.location.reload() }
}
watch(() => session.user?.id, () => {
  query.value = ''
  if (menu.value) menu.value.open = false
})
</script>

<template>
  <details ref="menu" class="header-menu community-tools" @toggle="toggle" @focusout="blur">
    <summary ref="trigger" class="icon-button tools-trigger" aria-label="社区工具" title="社区工具" aria-haspopup="dialog"><LayoutGrid :size="19" aria-hidden="true" /></summary>
    <div class="tools-panel" role="dialog" aria-labelledby="community-tools-heading">
      <div class="tools-heading"><h2 id="community-tools-heading">社区工具</h2><button type="button" class="icon-button" aria-label="关闭社区工具" @click="close"><X :size="20" aria-hidden="true" /></button></div>
      <form class="tools-search search-control" role="search" aria-label="搜索社区作品" @submit.prevent="searchWorks"><Search :size="17" aria-hidden="true" /><input ref="searchInput" v-model="query" type="search" aria-label="搜索社区作品" placeholder="作品、提示词或创作者" maxlength="200" /><button type="submit" class="icon-button" aria-label="开始搜索"><ArrowRight :size="18" aria-hidden="true" /></button></form>
      <nav class="tools-grid" aria-label="社区工具入口">
        <template v-for="tool in tools" :key="tool.label">
          <RouterLink v-if="tool.to" :to="destination(tool)" class="tool-item" :aria-label="session.user && tool.count ? `${tool.label}，${tool.count > 99 ? '99+' : tool.count} 条未读` : tool.label" :aria-description="session.user && tool.count && tool.count > 99 ? `共 ${tool.count} 条未读` : undefined" :aria-describedby="tool.member && !session.user ? 'tools-member-hint' : undefined" @click="close">
            <component :is="tool.icon" :size="27" aria-hidden="true" /><span class="tool-label">{{ tool.label }}</span><span v-if="session.user && tool.count" class="tool-count" aria-hidden="true">{{ tool.count > 99 ? '99+' : tool.count }}</span><LockKeyhole v-if="tool.member && !session.user" class="tool-lock" :size="12" aria-hidden="true" />
          </RouterLink>
          <button v-else type="button" class="tool-item" @click="run(tool.action)"><component :is="tool.icon" :size="27" aria-hidden="true" /><span class="tool-label">{{ tool.label }}</span></button>
        </template>
      </nav>
      <div v-if="!session.user || session.user.isAdmin || session.user.isModerator" class="tools-footer"><p v-if="!session.user" id="tools-member-hint"><LockKeyhole :size="13" aria-hidden="true" />带锁的工具需要登录，完成后继续访问。</p><RouterLink v-else to="/admin" class="tools-admin" @click="close"><ShieldCheck :size="17" aria-hidden="true" />内容管理<ArrowRight :size="16" aria-hidden="true" /></RouterLink></div>
    </div>
  </details>
</template>

<style scoped>
.tools-trigger { width: 44px; min-height: 44px; border-radius: 6px; }
.community-tools[open] > .tools-trigger { background: var(--blue-soft); color: var(--blue-hover); }
.tools-panel { position: fixed; top: calc(var(--header-height) + 8px); right: max(24px, calc((100vw - 1512px) / 2 + 40px)); width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - var(--header-height) - var(--mobile-nav-height) - 24px); overflow-y: auto; overscroll-behavior: contain; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 16px 48px #0005; }
.tools-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.tools-heading h2 { font-size: 18px; line-height: 28px; font-weight: 600; }
.tools-heading .icon-button { width: 44px; min-height: 44px; }
.tools-search { width: 100%; min-height: 44px; padding-right: 0; margin-bottom: 12px; }
.tools-search .icon-button { width: 44px; min-width: 44px; min-height: 44px; }
.tools-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
.tool-item { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 92px; min-width: 0; padding: 12px 4px; border-radius: 10px; color: var(--ink); text-align: center; }
.tool-label { font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
.tool-item:hover, .tool-item:focus-visible { background: var(--blue-soft); color: var(--blue-hover); }
.tool-item:focus-visible { outline-offset: -3px; }
.tool-count { position: absolute; top: 12px; left: calc(50% + 6px); display: grid; place-items: center; min-width: 20px; height: 20px; padding-inline: 5px; border-radius: 10px; font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; background: var(--blue); color: var(--action-ink); }
.tool-lock { position: absolute; top: 12px; right: 12px; color: var(--muted); }
.tools-footer { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
.tools-footer p { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; line-height: 20px; }
.tools-footer svg { flex-shrink: 0; }
.tools-admin { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 12px; border-radius: 6px; }
.tools-admin > svg:last-child { margin-left: auto; }
.tools-admin:hover { background: var(--blue-soft); color: var(--blue-hover); }
@media (max-width: 639px) { .tools-panel { right: 16px; } }
@media (max-width: 479px) {
  .tools-grid { gap: 8px; }
  .tool-item { min-height: 84px; gap: 10px; padding-inline: 2px; }
  .tool-item > svg { width: 24px; height: 24px; }
  .tool-item > .tool-lock { width: 12px; height: 12px; top: 8px; right: 4px; }
  .tool-label { font-size: 12px; }
  .tools-panel { padding: 12px; }
}
</style>
