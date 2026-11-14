<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Check, ChevronDown, Globe } from '@lucide/vue'
import type { NativeChat } from '../native-chat'
import StudioPopover from './StudioPopover.vue'

const props = defineProps<{ modelValue: NativeChat['search']; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: NativeChat['search']] }>()
const menu = ref<InstanceType<typeof StudioPopover>>(), root = ref<HTMLDivElement>()
const modes = [
  { id: 'off', label: '关闭联网', trigger: '联网' },
  { id: 'quick', label: '快速搜索', trigger: '快速搜索' },
  { id: 'deep', label: '深度搜索', trigger: '深度搜索' },
] as const

async function select(value: NativeChat['search']) {
  if (props.disabled) return
  emit('update:modelValue', value)
  menu.value?.close()
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>('button')?.focus()
}
</script>

<template>
  <div ref="root" class="studio-search-control" :class="{ enabled: modelValue !== 'off' }">
    <StudioPopover ref="menu" label="联网搜索" :width="260" :disabled="disabled">
      <template #trigger><Globe :size="17" /><span>{{ modes.find(mode => mode.id === modelValue)?.trigger || '联网' }}</span><ChevronDown :size="14" /></template>
      <div class="studio-search-options" role="group" aria-label="搜索模式">
        <button v-for="mode in modes" :key="mode.id" type="button" class="studio-command" :aria-pressed="modelValue === mode.id" :disabled="disabled" @click="select(mode.id)"><span>{{ mode.label }}</span><Check v-if="modelValue === mode.id" :size="19" /></button>
      </div>
    </StudioPopover>
  </div>
</template>

<style scoped>
.studio-search-control { flex: none; width: max-content; max-width: 100%; }
.studio-search-control.enabled :deep(> .studio-tool) { color: var(--ink); background: var(--surface-soft); }
.studio-search-control :deep(> .studio-tool) { gap: 6px; }
.studio-search-options { display: grid; gap: 4px; }
.studio-search-options .studio-command { min-height: 48px; padding: 12px; border-radius: 8px; }
.studio-search-options .studio-command > span { flex: 1; }
:global(.studio-popover:has(.studio-search-options) .studio-popover-content) { padding: 8px; }
</style>
