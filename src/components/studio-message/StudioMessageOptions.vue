<!-- Adapted from octopus_chat message-option-list.tsx (MIT). -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { Check, Send, X } from '@lucide/vue'
import { validateOptionSelection, type MessageInteractionOptions, type MessageInteractionReceipt } from '../../../shared/studio/message-interactions'

const props = defineProps<{
  definition: MessageInteractionOptions
  selectedIds?: readonly string[]
  receipt?: MessageInteractionReceipt
  disabled?: boolean
  onSubmit: (ids: string[]) => Promise<boolean>
}>()
const id = `message-options-${useId()}`
const selected = ref<string[]>([]), pending = ref(false), failed = ref(false), localReceipt = ref<MessageInteractionReceipt>()
const options = computed(() => props.definition.options.slice(0, 8)), single = computed(() => props.definition.selection === 'single')
const max = computed(() => single.value ? 1 : Math.max(0, Math.min(options.value.length, Math.floor(props.definition.maxSelections ?? options.value.length))))
const min = computed(() => Math.max(0, Math.min(max.value, Math.floor(props.definition.minSelections ?? 1))))
const receipt = computed(() => props.receipt ?? localReceipt.value)
const locked = computed(() => !!props.disabled || pending.value || !!receipt.value)
const validSelection = computed(() => validateOptionSelection(props.definition, selected.value))
const selectedOptions = computed(() => options.value.filter(option => receipt.value?.selectedIds.includes(option.id)))
const description = computed(() => single.value ? min.value === 0 ? '单选，可不选' : '单选' : min.value === max.value ? `多选，共 ${max.value} 项` : `多选，${min.value} 到 ${max.value} 项`)
let request: object | undefined, mounted = true
watch(() => JSON.stringify([props.definition, props.selectedIds]), () => {
  selected.value = options.value.filter(option => props.selectedIds?.includes(option.id)).slice(0, max.value).map(option => option.id)
  localReceipt.value = undefined; failed.value = false; request = undefined; pending.value = false
}, { immediate: true })
onBeforeUnmount(() => { mounted = false; request = undefined })
function choose(optionId: string, checked: boolean) {
  if (locked.value) return
  if (single.value) selected.value = [optionId]
  else if (checked && selected.value.length < max.value) selected.value = [...selected.value, optionId]
  else if (!checked) selected.value = selected.value.filter(id => id !== optionId)
  failed.value = false
}
async function submit() {
  const submitted = validSelection.value
  if (locked.value || request || !submitted) return
  const currentRequest = {}; request = currentRequest
  pending.value = true; failed.value = false
  try {
    const success = await props.onSubmit(submitted.slice())
    if (mounted && request === currentRequest) {
      if (success) localReceipt.value = { selectedIds: submitted.slice() }
      else failed.value = true
    }
  } catch { if (mounted && request === currentRequest) failed.value = true }
  finally { if (mounted && request === currentRequest) { request = undefined; pending.value = false } }
}
</script>

<template>
  <section v-if="options.length" class="message-options" data-testid="message-option-list">
    <fieldset v-if="receipt">
      <legend>{{ definition.question }}</legend>
      <p class="option-receipt-heading" role="status"><Check :size="16" aria-hidden="true" />已提交选择</p>
      <ul v-if="selectedOptions.length" class="option-receipt">
        <li v-for="option in selectedOptions" :key="option.id"><Check :size="16" aria-hidden="true" /><span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span></li>
      </ul>
      <p v-else class="option-limits">未选择任何选项</p>
    </fieldset>
    <form v-else @submit.prevent="submit">
      <fieldset :disabled="locked" :aria-busy="pending" :aria-describedby="failed ? `${id}-limits ${id}-error` : `${id}-limits`">
        <legend>{{ definition.question }}</legend>
        <p :id="`${id}-limits`" class="option-limits">{{ description }}</p>
        <div class="option-list" :role="single ? 'radiogroup' : 'group'" :aria-label="definition.question">
          <label v-for="(option, index) in options" :key="option.id" class="message-option" :data-selected="selected.includes(option.id)" :data-disabled="locked || (!single && !selected.includes(option.id) && selected.length >= max)">
            <input :type="single ? 'radio' : 'checkbox'" :name="`${id}-selection`" :value="option.id" :checked="selected.includes(option.id)" :disabled="locked || (!single && !selected.includes(option.id) && selected.length >= max)" :aria-labelledby="`${id}-label-${index}`" :aria-describedby="option.description ? `${id}-description-${index}` : undefined" @change="choose(option.id, ($event.target as HTMLInputElement).checked)" />
            <span><strong :id="`${id}-label-${index}`">{{ option.label }}</strong><small v-if="option.description" :id="`${id}-description-${index}`">{{ option.description }}</small></span>
          </label>
        </div>
      </fieldset>
      <p v-if="failed" :id="`${id}-error`" class="option-error" role="alert">选择暂未提交，请重试。</p>
      <div class="option-actions">
        <button v-if="min === 0 && selected.length" type="button" :disabled="locked" @click="selected = []; failed = false"><X :size="16" aria-hidden="true" />清除选择</button>
        <button type="submit" :disabled="locked || !validSelection"><Send :size="16" aria-hidden="true" />{{ pending ? '提交中' : '提交选择' }}</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.message-options { min-width: 0; margin-top: 16px; color: var(--ink); font-size: 14px; line-height: 20px; }
fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }legend { max-width: 100%; margin-bottom: 4px; padding: 0; font-weight: 500; overflow-wrap: anywhere; }
.option-limits { margin: 0 0 8px; color: var(--muted); font-size: 12px; }.option-list { display: grid; gap: 4px; min-width: 0; }
.message-option { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: start; gap: 10px; min-width: 0; min-height: 44px; padding: 12px 10px; border-radius: 6px; cursor: pointer; touch-action: manipulation; }
.message-option[data-selected="true"], .message-option:hover:not([data-disabled="true"]) { background: var(--surface-soft); }.message-option[data-disabled="true"] { cursor: default; }
.message-option:focus-within { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
input[type="checkbox"], input[type="radio"] { appearance: auto; width: 18px; height: 18px; margin: 1px 0 0; padding: 0; accent-color: var(--ink); cursor: inherit; }
input:disabled { opacity: .55; }input::after { display: none; }
.message-option > span, .option-receipt li > span { display: grid; gap: 4px; min-width: 0; }strong { font-weight: 400; overflow-wrap: anywhere; }small { color: var(--muted); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.option-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; max-width: 100%; padding: 8px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--ink); font: inherit; font-size: 13px; cursor: pointer; }
button:hover:not(:disabled) { background: var(--surface-soft); }button:disabled { opacity: .55; cursor: default; }button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }button svg { flex: none; }
.option-error { margin: 8px 0 0; color: var(--danger); font-size: 12px; }.option-receipt-heading { display: flex; align-items: center; gap: 8px; margin: 8px 0; color: var(--muted); font-size: 12px; }
.option-receipt { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }.option-receipt li { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: start; gap: 10px; }.option-receipt li > svg { margin-top: 2px; }
@media (pointer: coarse), (max-width: 600px) { button { min-height: 44px; } }
</style>
