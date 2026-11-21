<!-- Adapted from octopus_chat app/components/followup-suggestions.tsx (MIT). -->
<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpLeft } from '@lucide/vue'
const props = defineProps<{ suggestions: string[]; disabled?: boolean }>()
const emit = defineEmits<{ select: [text: string] }>()
const items = computed(() => [...new Set(props.suggestions.map(text => text.trim()).filter(Boolean))].slice(0, 3))
</script>
<template>
  <div v-if="items.length" class="followup-suggestions" role="group" aria-label="继续追问">
    <button v-for="text in items" :key="text" type="button" :disabled="disabled" @click="emit('select', text)"><span>{{ text }}</span><ArrowUpLeft :size="16" aria-hidden="true" /></button>
  </div>
</template>
<style scoped>
.followup-suggestions { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 12px; max-width: min(75ch, 100%); }
button { display: flex; align-items: center; gap: 12px; min-height: 36px; max-width: 100%; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font: inherit; font-size: 13px; text-align: start; cursor: pointer; }
button span { overflow-wrap: anywhere; }
svg { flex: none; }
button:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }
button:active:not(:disabled) { color: var(--ink); background: var(--state-pressed); }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
button:disabled { opacity: .6; cursor: default; }
@media (pointer: coarse), (max-width: 639px) { button { min-height: 44px; } }
</style>
