<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { CircleDollarSign, Compass, Images, Settings2, SquarePen, X } from '@lucide/vue'
import { session } from '../state'
import { site } from '../site'
import { loadChats } from '../native-chat'
import { initializeCreation, type CreationTask } from '../native-studio'
import type { StudioKind } from '../studio-state'
import StudioConversations from './StudioConversations.vue'

defineProps<{ kind: StudioKind; accountTool: string }>()
const emit = defineEmits<{ kind: [value: StudioKind]; new: []; reuse: [task: CreationTask]; prices: []; library: []; settings: []; conversation: [id: string] }>()
const route = useRoute(), media = window.matchMedia('(max-width: 999px)')
const mobile = ref(media.matches), visible = ref(false), drawer = ref<HTMLDialogElement>()
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
function resize() { close(); mobile.value = media.matches }
watch(() => route.fullPath, close)
watch(() => session.user?.id, async id => {
  close()
  if (id) { await initializeCreation(); await loadChats() }
}, { immediate: true })
onMounted(() => media.addEventListener('change', resize))
onBeforeUnmount(() => { close(); media.removeEventListener('change', resize) })
defineExpose({ open, close, visible })
</script>

<template>
  <dialog id="studio-sidebar-drawer" ref="drawer" class="studio-sidebar-drawer" aria-label="工作台侧边栏" @cancel="visible = false" @close="visible = false" @click="outside" />
  <Teleport defer to="#studio-sidebar-drawer" :disabled="!mobile">
  <aside class="studio-sidebar" aria-label="创作导航与历史">
    <div class="studio-sidebar-brand">
      <RouterLink to="/discover" class="studio-brand" :aria-label="`${site.brand}首页`" @click="close"><img v-if="site.logoUrl" :src="site.logoUrl" width="32" height="32" alt="" /><strong>{{ site.brand }}</strong></RouterLink>
      <button v-if="mobile" type="button" class="icon-button studio-sidebar-close" aria-label="关闭侧边栏" title="关闭侧边栏" autofocus @click="close"><X :size="20" /></button>
    </div>
    <nav class="studio-sidebar-links" aria-label="工作台导航">
      <button type="button" class="studio-sidebar-create" :class="{ active: !accountTool }" @click="close(); emit('new')"><SquarePen :size="20" /><span>新对话</span></button>
      <RouterLink to="/discover" @click="close"><Compass :size="20" /><span>探索社区</span></RouterLink>
      <button type="button" aria-haspopup="dialog" @click="close(); emit('library')"><Images :size="20" /><span>作品库</span></button>
    </nav>
    <section class="studio-sidebar-history" aria-label="会话记录">
      <StudioConversations :unified="!mobile" :kind="kind" @select="close(); emit('conversation', $event)" @reuse="close(); emit('reuse', $event)" />
    </section>
    <div class="studio-sidebar-bottom"><button @click="close(); emit('prices')"><CircleDollarSign :size="18" />模型定价</button><div id="studio-sidebar-menu" /></div>
    <footer v-if="mobile && session.user" class="studio-sidebar-footer">
      <RouterLink to="/account" class="studio-sidebar-account" :aria-label="`账号设置：${session.user.username || session.user.name}`" @click="close"><img v-if="session.user.avatarUrl" class="avatar" :src="session.user.avatarUrl" width="32" height="32" alt="" /><span v-else class="avatar blue" aria-hidden="true">{{ (session.user.name || session.user.username || '章').slice(0, 1) }}</span><span class="studio-sidebar-account-name">{{ session.user.username || session.user.name }}</span></RouterLink>
      <button type="button" class="icon-button studio-sidebar-settings" aria-label="创作台设置" title="创作台设置" @click="close(); emit('settings')"><Settings2 :size="20" /></button>
    </footer>
  </aside>
  </Teleport>
</template>

<style scoped>
.studio-sidebar { position: fixed; inset: 0 auto 0 0; z-index: 40; display: flex; flex-direction: column; width: var(--studio-sidebar-width, 248px); padding: 20px 16px 16px; background: var(--studio-sidebar-surface, var(--surface)); }
.studio-sidebar-brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; margin-bottom: 32px; }
.studio-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }.studio-brand img { flex: none; border-radius: 8px; }.studio-brand strong { font-size: 18px; font-weight: 600; white-space: nowrap; }
.studio-sidebar-links { display: grid; gap: 4px; }
.studio-sidebar-links :is(a, button), .studio-sidebar-bottom > :is(button, a) { display: flex; align-items: center; justify-content: flex-start; gap: 12px; width: 100%; min-height: 44px; padding: 12px; font-size: 14px; text-align: left; color: var(--muted); border: 0; border-radius: 8px; }
.studio-sidebar-links :is(a, button):hover, .studio-sidebar-bottom > :is(button, a):hover { background: var(--surface-soft); color: var(--ink); }
.studio-sidebar-create.active { color: var(--ink); }
.studio-sidebar-history { display: flex; flex-direction: column; flex: 1; min-height: 0; margin-top: 32px; }
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
  .studio-sidebar-account:hover { background: var(--surface-soft); }
  .studio-sidebar-account > .avatar { flex: none; object-fit: cover; }
  .studio-sidebar-account-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
}
</style>
