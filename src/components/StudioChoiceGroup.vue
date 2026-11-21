<!-- Native radio layout adapted from octopus_chat choice-group.tsx (MIT). -->
<script setup lang="ts">
import { useId } from 'vue'
import { Check } from '@lucide/vue'
defineProps<{ label: string; modelValue: string; options: { value: string; label: string; disabled?: boolean }[]; grid?: boolean; columns?: number; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId()
</script>
<template>
  <fieldset class="studio-choice-group" :class="{ grid }" role="radiogroup" :aria-label="label" :disabled="disabled" :style="{ '--choice-columns': columns || options.length }">
    <label v-for="option in options" :key="option.value" class="choice">
      <input type="radio" :name="id" :value="option.value" :checked="modelValue === option.value" :disabled="option.disabled" @change="$emit('update:modelValue', option.value)" />
      <span class="choice-body"><Check v-if="grid" class="choice-check" :size="12" aria-hidden="true" /><slot name="visual" :value="option.value" /><span>{{ option.label }}</span></span>
    </label>
  </fieldset>
</template>
<style scoped>
.studio-choice-group { display: grid; grid-template-columns: repeat(var(--choice-columns), minmax(0, 1fr)); gap: 4px; min-width: 0; margin: 0; padding: 4px; border: 0; border-radius: 6px; background: var(--canvas); }
.choice { position: relative; min-width: 0; cursor: pointer; }.choice input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: inherit; }.choice-body { display: flex; position: relative; pointer-events: none; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 4px; border-radius: 4px; color: var(--ink); font-size: 12px; line-height: 20px; text-align: center; overflow-wrap: anywhere; }
.choice input:checked + .choice-body { background: var(--state-selected); }
.choice:hover:not(:has(input:disabled)) .choice-body { background: var(--state-hover); }
.choice:has(input:checked):hover:not(:has(input:disabled)) .choice-body, .choice:active:not(:has(input:disabled)) .choice-body { background: var(--state-pressed); }
.choice input:focus-visible + .choice-body { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }.choice:has(input:disabled) { opacity: .45; cursor: default; }.grid { background: transparent; padding: 0; gap: 6px; }.grid .choice-body { flex-direction: column; min-height: 60px; background: var(--canvas); }.choice-check { position: absolute; top: 6px; right: 6px; visibility: hidden; }input:checked + .choice-body .choice-check { visibility: visible; }
@media (pointer: coarse), (max-width: 639px) { .choice-body { min-height: 44px; } }
</style>
