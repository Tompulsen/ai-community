<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Compass, Images, LayoutGrid, PanelLeftClose, PanelLeftOpen, Settings2, SquarePen, X } from '@lucide/vue'
import { errorMessage, notify, session } from '../state'
import { sidebarPreviewWidth, studioPreferences, studioSidebarWidth, updateStudioPreferences } from '../studio-preferences'
import { site } from '../site'
import { loadChats } from '../native-chat'
import { initializeCreation, type CreationTask } from '../native-studio'
import type { StudioKind } from '../studio-state'
import StudioConversations from './StudioConversations.vue'

defineProps<{ kind: StudioKind; accountTool: string }>()
const emit = defineEmits<{ kind: [value: StudioKind]; new: []; reuse: [task: CreationTask]; prices: []; library: []; settings: []; conversation: [id: string] }>()
const route = useRoute(), media = window.matchMedia('(max-width: 999px)')
const mobile = ref(media.matches), visible = ref(false), drawer = ref<HTMLDialogElement>()
const sidebarElement = ref<HTMLElement>()
const collapsed = computed(() => !mobile.value && (sidebarPreviewWidth.value === undefined
  ? studioPreferences.sidebarCollapsed : sidebarPreviewWidth.value < 160))
let drag: { pointer: number; startX: number; width: number; moved: boolean; handle: HTMLElement } | undefined
function cancelResize() {
  const active = drag
  drag = undefined; sidebarPreviewWidth.value = undefined
  if (active?.handle.hasPointerCapture(active.pointer)) active.handle.releasePointerCapture(active.pointer)
}
function saveWidth(width?: number) {
  try {
    updateStudioPreferences(width === undefined ? { sidebarCollapsed: !studioPreferences.sidebarCollapsed }
      : width < 160 ? { sidebarCollapsed: true } : { sidebarWidth: Math.round(Math.max(220, Math.min(420, width))), sidebarCollapsed: false })
  } catch (cause) { notify(errorMessage(cause)) }
}
function startResize(event: PointerEvent) {
  if (mobile.value || event.button !== 0 || !event.isPrimary) return
  cancelResize(); event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.focus({ preventScroll: true })
  drag = { pointer: event.pointerId, startX: event.clientX, width: sidebarElement.value!.getBoundingClientRect().width, moved: false, handle }
  handle.setPointerCapture(event.pointerId)
}
function moveResize(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  const delta = event.clientX - drag.startX
  drag.moved ||= Math.abs(delta) > 4
  sidebarPreviewWidth.value = Math.max(72, Math.min(420, drag.width + delta))
}
function endResize(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  moveResize(event)
  const width = sidebarPreviewWidth.value, moved = drag.moved
  cancelResize(); saveWidth(moved ? width : undefined)
}
function resizeKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); cancelResize(); return }
  if (mobile.value) return
  const width = sidebarElement.value?.getBoundingClientRect().width || 248
  if (['Enter', ' '].includes(event.key)) { event.preventDefault(); saveWidth(); return }
  const next = event.key === 'Home' ? 72 : event.key === 'End' ? 420 :
    event.key === 'ArrowLeft' ? width <= 220 ? 72 : Math.max(220, width - 24) :
      event.key === 'ArrowRight' ? Math.min(420, Math.max(220, width + 24)) : undefined
  if (next !== undefined) { event.preventDefault(); saveWidth(next) }
}
function cancelKey(event: KeyboardEvent) { if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); cancelResize() } }
function open() {
  if (!mobile.value || !session.user || !drawer.value || drawer.value.open) return
  drawer.value.showModal(); visible.value = true
}
function close() { drawer.value?.close(); visible.value = false }
function outside(event: MouseEvent) {
  if (event.target !== drawer.value || !drawer.value) return
  const bounds = drawer.value.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
}
function resize() { cancelResize(); close(); mobile.value = media.matches }
watch(() => route.fullPath, close)
watch(() => session.user?.id, async id => {
  cancelResize(); close()
  if (id) { await initializeCreation(); await loadChats() }
}, { immediate: true })
onMounted(() => { media.addEventListener('change', resize); window.addEventListener('blur', cancelResize); window.addEventListener('keydown', cancelKey, true) })
onBeforeUnmount(() => { cancelResize(); close(); media.removeEventListener('change', resize); window.removeEventListener('blur', cancelResize); window.removeEventListener('keydown', cancelKey, true) })
defineExpose({ open, close, visible })
</script>

<template>
  <dialog id="studio-sidebar-drawer" ref="drawer" class="studio-sidebar-drawer" aria-label="工作台侧边栏" @cancel="visible = false" @close="visible = false" @click="outside" />
  <Teleport defer to="#studio-sidebar-drawer" :disabled="!mobile">
  <aside ref="sidebarElement" class="studio-sidebar" :class="{ collapsed }" aria-label="创作导航与历史">
    <div class="studio-sidebar-brand">
      <RouterLink to="/discover" class="studio-brand" :aria-label="`${site.brand}首页`" @click="close"><img v-if="site.logoUrl" :src="site.logoUrl" width="32" height="32" alt="" /><strong>{{ site.brand }}</strong></RouterLink>
      <button v-if="mobile" type="button" class="icon-button studio-sidebar-close" aria-label="关闭侧边栏" title="关闭侧边栏" autofocus @click="close"><X :size="20" /></button>
      <button v-else type="button" class="icon-button sidebar-collapse" :aria-label="collapsed ? '展开侧栏' : '折叠侧栏'" :title="collapsed ? '展开侧栏' : '折叠侧栏'" :aria-expanded="!collapsed" @click="saveWidth()"><PanelLeftOpen v-if="collapsed" :size="18" /><PanelLeftClose v-else :size="18" /></button>
    </div>
    <nav class="studio-sidebar-links" aria-label="工作台导航">
      <button type="button" class="studio-sidebar-create" :class="{ active: !accountTool }" aria-label="新对话" title="新对话" @click="close(); emit('new')"><SquarePen :size="20" /><span>新对话</span></button>
      <RouterLink to="/discover" aria-label="探索社区" title="探索社区" @click="close"><Compass :size="20" /><span>探索社区</span></RouterLink>
      <button type="button" aria-label="作品库" title="作品库" aria-haspopup="dialog" @click="close(); emit('library')"><Images :size="20" /><span>作品库</span></button>
    </nav>
    <section class="studio-sidebar-history" aria-label="会话记录">
      <StudioConversations :unified="!mobile" :kind="kind" @select="close(); emit('conversation', $event)" @reuse="close(); emit('reuse', $event)" />
    </section>
    <div class="studio-sidebar-bottom"><button aria-label="模型广场" title="模型广场" @click="close(); emit('prices')"><LayoutGrid :size="20" /><span>模型广场</span></button><div id="studio-sidebar-menu" /></div>
    <footer v-if="mobile && session.user" class="studio-sidebar-footer">
      <RouterLink to="/account" class="studio-sidebar-account" :aria-label="`账号设置：${session.user.name || session.user.username}`" @click="close"><img v-if="session.user.avatarUrl" class="avatar" :src="session.user.avatarUrl" width="32" height="32" alt="" /><span v-else class="avatar blue" aria-hidden="true">{{ (session.user.name || session.user.username || '章').slice(0, 1) }}</span><span class="studio-sidebar-account-name">{{ session.user.name || session.user.username }}</span></RouterLink>
      <button type="button" class="icon-button studio-sidebar-settings" aria-label="创作台设置" title="创作台设置" @click="close(); emit('settings')"><Settings2 :size="20" /></button>
    </footer>
    <div v-if="!mobile" class="studio-sidebar-resize" role="separator" tabindex="0" aria-label="调整侧栏宽度" aria-orientation="vertical" :aria-valuenow="Math.round(studioSidebarWidth || sidebarElement?.getBoundingClientRect().width || 248)" :aria-valuemin="72" :aria-valuemax="420" @pointerdown="startResize" @pointermove="moveResize" @pointerup="endResize" @pointercancel="cancelResize" @lostpointercapture="cancelResize" @keydown="resizeKey" />
  </aside>
  </Teleport>
</template>

<style scoped>
.studio-sidebar { position: fixed; inset: 0 auto 0 0; z-index: 40; display: flex; flex-direction: column; width: var(--studio-sidebar-width, 248px); padding: 16px; background: var(--studio-sidebar-surface, var(--surface)); }
.studio-sidebar-brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; margin-bottom: 32px; }
.studio-brand { overflow: hidden; }.studio-brand strong { overflow: hidden; text-overflow: ellipsis; }
.sidebar-collapse { flex: none; width: 32px; height: 32px; min-height: 32px; padding: 6px; }
.studio-sidebar-resize { position: absolute; top: 0; bottom: 0; right: -4px; width: 8px; cursor: col-resize; touch-action: none; }
.studio-sidebar-resize:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.studio-sidebar.collapsed { padding-inline: 12px; }
.collapsed .studio-sidebar-brand { justify-content: center; }
.collapsed .studio-brand, .collapsed .studio-sidebar-history, .collapsed .studio-sidebar-links span, .collapsed .studio-sidebar-bottom > button span, .collapsed #studio-sidebar-menu :deep(> .studio-tool > span) { display: none; }
.collapsed .studio-sidebar-links :is(a, button), .collapsed .studio-sidebar-bottom > button, .collapsed #studio-sidebar-menu :deep(> .studio-tool) { justify-content: center; padding-inline: 12px; }
.collapsed .studio-sidebar-bottom { margin-top: auto; }
.studio-brand { display: flex; align-items: center; gap: 6px; min-width: 0; padding-inline: 6px; }.studio-brand img { flex: none; border-radius: 8px; }.studio-brand strong { font-size: 18px; font-weight: 600; white-space: nowrap; }
.studio-sidebar-links { display: grid; gap: 4px; }
.studio-sidebar-links :is(a, button), .studio-sidebar-bottom > :is(button, a) { display: flex; align-items: center; justify-content: flex-start; gap: 12px; width: 100%; min-height: 44px; padding: 12px; font-size: 14px; text-align: left; color: var(--muted); border: 0; border-radius: 8px; }
.studio-sidebar-links :is(a, button) > svg, .studio-sidebar-bottom > :is(button, a) > svg, #studio-sidebar-menu :deep(> .studio-tool > svg) { flex: none; width: 20px; height: 20px; }
.studio-sidebar-links :is(a, button):hover:not(:disabled), .studio-sidebar-bottom > :is(button, a):hover:not(:disabled) { background: var(--state-hover); color: var(--ink); }
.studio-sidebar-links :is(a, button):active:not(:disabled), .studio-sidebar-bottom > :is(button, a):active:not(:disabled) { background: var(--state-pressed); color: var(--ink); }
.studio-sidebar-create.active { color: var(--ink); }
.studio-sidebar-history { display: flex; flex-direction: column; flex: 1; min-height: 0; margin-top: 32px; }
.studio-sidebar-history :deep(.conversation-record) { padding-inline: 12px; gap: 12px; }
.studio-sidebar-history :deep(button.conversation-record) { padding-inline-end: calc(var(--conversation-tool-size) * 2 + 12px); gap: 8px; }
.studio-sidebar-history :deep(.conversation-record > svg:first-child), .studio-sidebar-history :deep(.conversation-record > input) { width: 20px; height: 20px; }
.studio-sidebar-history :deep(.conversation-search > .studio-tool) { width: 44px; min-width: 44px; min-height: 44px; padding: 12px; }
.studio-sidebar-history :deep(.conversation-search > .studio-tool > svg) { width: 20px; height: 20px; }
.studio-sidebar-bottom { display: grid; gap: 4px; padding-top: 16px; }
#studio-sidebar-menu:empty { display: none; }
#studio-sidebar-menu :deep(> .studio-tool) { justify-content: flex-start; gap: 12px; width: 100%; min-height: 44px; padding: 12px; font-size: 14px; border-radius: 8px; }
.studio-sidebar-drawer { position: fixed; inset: 0 auto 0 0; width: min(86vw, 340px); max-width: none; height: 100dvh; max-height: 100dvh; margin: 0; padding: 0; border: 0; border-radius: 0; background: var(--studio-sidebar-surface, var(--surface)); box-shadow: 12px 0 32px rgb(0 0 0 / 16%); overflow: hidden; }
.studio-sidebar-drawer::backdrop { background: rgb(0 0 0 / 45%); }
:global(html:has(.studio-sidebar-drawer[open])) { overflow: hidden; }
@media (max-width: 999px) {
  .studio-sidebar { position: static; inset: auto; width: 100%; height: 100%; min-height: 0; padding: max(16px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)); }
  .studio-sidebar-brand { gap: 8px; margin-bottom: 24px; }
  .studio-brand { flex: 1; }
  .studio-brand strong { overflow: hidden; text-overflow: ellipsis; }
  .studio-sidebar-close, .studio-sidebar-settings { width: 44px; height: 44px; min-height: 44px; }
  .studio-sidebar-history { margin-top: 24px; }
  .studio-sidebar-history :deep(.conversation-search input) { font-size: 16px; }
  .studio-sidebar-footer { display: flex; align-items: center; gap: 4px; flex: none; padding-top: 12px; min-width: 0; }
  .studio-sidebar-account { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; min-height: 44px; padding: 6px 12px; border-radius: 8px; }
  .studio-sidebar-account:hover { color: var(--ink); background: var(--state-hover); }
  .studio-sidebar-account:active { color: var(--ink); background: var(--state-pressed); }
  .studio-sidebar-account > .avatar { flex: none; object-fit: cover; }
  .studio-sidebar-account-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
}
</style>
