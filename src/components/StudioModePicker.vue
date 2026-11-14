<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChevronDown, Image, MessageSquare, Video } from '@lucide/vue'
import StudioPopover from './StudioPopover.vue'
import type { StudioKind } from '../studio-state'

const route = useRoute(), router = useRouter()
const menu = ref<InstanceType<typeof StudioPopover>>()
const modes = [
  { id: 'image', label: '图片生成', icon: Image },
  { id: 'video', label: '视频生成', icon: Video },
  { id: 'text', label: '对话', icon: MessageSquare },
] as const
const current = computed(() => modes.find(mode => mode.id === route.params.kind) || modes[0])
async function select(kind: StudioKind) {
  menu.value?.close()
  await router.replace({ path: `/create/${kind}`, query: route.query })
  await nextTick()
  document.querySelector<HTMLButtonElement>('.studio-mode-control > button')?.focus()
}
</script>

<template>
  <div class="studio-mode-control">
    <StudioPopover ref="menu" label="创作模式" :width="260">
      <template #trigger><component :is="current.icon" :size="18" /><span>{{ current.label }}</span><ChevronDown :size="14" /></template>
      <div class="studio-mode-options" role="group" aria-label="创作类型"><button v-for="mode in modes" :key="mode.id" type="button" class="studio-command" :class="{ active: current.id === mode.id }" :aria-pressed="current.id === mode.id" @click="select(mode.id)"><component :is="mode.icon" :size="20" /><span>{{ mode.label }}</span><Check v-if="current.id === mode.id" :size="19" /></button></div>
    </StudioPopover>
  </div>
</template>

<style scoped>
.studio-mode-control { flex: none; min-width: 0; }
.studio-mode-control :deep(> .studio-tool) { gap: 8px; color: var(--blue); background: var(--blue-soft); font-size: 14px; border-radius: 8px; }
.studio-mode-control :deep(> .studio-tool:hover) { background: var(--surface-soft); }
.studio-mode-options { display: grid; gap: 4px; }
.studio-mode-options .studio-command { min-height: 48px; padding: 12px; border-radius: 8px; gap: 12px; }
.studio-mode-options .studio-command > span { flex: 1; }
.studio-mode-options .active { background: var(--surface-soft); }
:global(.studio-popover:has(.studio-mode-options)) { background: var(--surface); border-radius: 12px; }
:global(.studio-popover:has(.studio-mode-options) .studio-popover-heading) { border: 0; color: var(--muted); }
:global(.studio-popover:has(.studio-mode-options) .studio-popover-content) { padding: 8px; }
</style>
