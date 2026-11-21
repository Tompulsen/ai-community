<!-- Adapted from octopus_chat message-editor.tsx (MIT). -->
<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { RotateCw, X } from '@lucide/vue'
import { createImeGuard } from '../../../shared/studio/ime-input'

const props = defineProps<{ initialValue: string; disabled?: boolean; allowEmpty?: boolean; saveLabel?: string; onSave: (text: string) => Promise<boolean | void> }>()
const emit = defineEmits<{ cancel: [] }>()
const value = ref(props.initialValue), pending = ref(false), error = ref(''), input = ref<HTMLTextAreaElement>()
const errorId = `message-edit-error-${useId()}`, ime = createImeGuard()
watch(() => props.initialValue, async text => {
  value.value = text; error.value = ''
  await nextTick()
  input.value?.focus({ preventScroll: true })
  input.value?.setSelectionRange(text.length, text.length)
  input.value?.form?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}, { immediate: true })
async function save() {
  if (pending.value || props.disabled || (!props.allowEmpty && !value.value.trim())) return
  pending.value = true; error.value = ''
  try {
    if (await props.onSave(value.value) === false) error.value = '当前无法保存，请确认会话空闲后重试。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败，请重试。' }
  finally { pending.value = false }
}
function keydown(event: KeyboardEvent) {
  if (ime.blocks(event)) {
    if (event.key === 'Enter' && !ime.isComposing(event)) event.preventDefault()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation()
    if (!pending.value) emit('cancel')
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey) {
    event.preventDefault(); event.stopPropagation(); void save()
  }
}
</script>

<template>
  <form class="message-editor" aria-label="编辑消息" :aria-busy="pending" @submit.prevent="save">
    <textarea ref="input" v-model="value" rows="4" aria-label="消息内容" :disabled="disabled || pending" :aria-invalid="!!error" :aria-describedby="error ? errorId : undefined" @input="error = ''" @compositionstart="ime.start" @compositionend="ime.end" @keyup="ime.release" @keydown="keydown" />
    <p v-if="error" :id="errorId" class="editor-error" role="alert">{{ error }}</p>
    <div class="editor-actions">
      <button type="button" :disabled="pending" @click="emit('cancel')"><X :size="16" aria-hidden="true" />取消</button>
      <button type="submit" :disabled="disabled || pending || (!allowEmpty && !value.trim())"><RotateCw :size="16" aria-hidden="true" />{{ pending ? '正在保存' : saveLabel || '保存并重新生成' }}</button>
    </div>
  </form>
</template>

<style scoped>
.message-editor { min-width: 0; width: 100%; }
textarea { box-sizing: border-box; width: 100%; min-height: 120px; padding: 12px; resize: vertical; border: 0; border-radius: 8px; background: var(--surface-soft); color: var(--ink); caret-color: var(--ink); font: inherit; font-size: 16px; line-height: 26px; }
textarea:focus-visible, button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.editor-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; max-width: 100%; padding: 6px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--ink); font: inherit; font-size: 13px; cursor: pointer; }
button:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }button:active:not(:disabled) { color: var(--ink); background: var(--state-pressed); }button svg { flex: none; }button:disabled, textarea:disabled { cursor: default; opacity: .55; }
.editor-error { margin: 8px 0 0; color: var(--danger); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
@media (pointer: coarse), (max-width: 600px) { button { min-height: 44px; } }
</style>
