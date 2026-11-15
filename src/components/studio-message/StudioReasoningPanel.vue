<!-- Adapted from octopus_chat reasoning-panel.tsx (MIT). -->
<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { BrainCircuit, Check, ChevronDown } from '@lucide/vue'
import StudioMarkdown from './StudioMarkdown.vue'

const props = defineProps<{ content?: string; streaming?: boolean; hasAnswer?: boolean; interrupted?: boolean }>()
const id = `reasoning-${useId()}`, expanded = ref<boolean | null>(null)
const active = computed(() => !!props.streaming && !props.hasAnswer)
const open = computed(() => expanded.value ?? active.value)
</script>

<template>
  <section v-if="content" class="reasoning" :data-active="active" data-chat-scroll-isolation>
    <button type="button" class="reasoning-trigger" :aria-expanded="open" :aria-controls="open ? id : undefined" @click="expanded = !open">
      <component :is="active ? BrainCircuit : Check" :size="16" aria-hidden="true" />
      <span>思考过程</span>
      <span class="reasoning-state" role="status">{{ active ? '思考中' : interrupted ? '已停止' : '已完成' }}</span>
      <ChevronDown :size="14" class="reasoning-chevron" :data-open="open" aria-hidden="true" />
    </button>
    <div v-if="open" :id="id" class="reasoning-content" dir="auto" tabindex="0" role="region" aria-label="思考过程">
      <StudioMarkdown :content="content" :streaming="active" />
    </div>
  </section>
</template>

<style scoped>
.reasoning { min-width: 0; margin-bottom: 12px; color: var(--ink); }
.reasoning-trigger { display: flex; align-items: center; gap: 8px; min-height: 36px; max-width: 100%; padding: 4px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: start; cursor: pointer; }
.reasoning-trigger:hover { background: var(--surface-soft); }
.reasoning-trigger:focus-visible, .reasoning-content:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.reasoning-trigger svg { flex: none; }
.reasoning-state { color: var(--muted); white-space: nowrap; }
.reasoning-chevron { margin-left: auto; }
.reasoning-chevron[data-open="true"] { transform: rotate(180deg); }
.reasoning-content { min-width: 0; max-height: 320px; overflow: auto; overscroll-behavior: contain; overflow-wrap: anywhere; padding: 8px 12px; border-radius: 8px; background: var(--surface-soft); font-size: 14px; line-height: 22px; scrollbar-width: thin; scrollbar-color: var(--muted) transparent; overflow-anchor: none; }
@media (max-width: 600px), (pointer: coarse) { .reasoning-trigger { min-height: 44px; }.reasoning-content { max-height: 240px; } }
</style>
