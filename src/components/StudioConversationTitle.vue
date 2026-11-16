<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { Pencil } from '@lucide/vue'
import { session, errorMessage } from '../state'
import type { NativeChat } from '../native-chat'
import { renameConversation } from '../studio-conversations'

const props = defineProps<{ conversation: NativeChat }>()
const editing = ref(false), pending = ref(false), draft = ref(''), error = ref('')
const input = ref<HTMLInputElement>(), trigger = ref<HTMLButtonElement>()
const errorId = `conversation-title-${useId()}`
const count = computed(() => props.conversation.messages.filter(message => message.role !== 'system').length)
let revision = 0
watch(() => [session.user?.id, props.conversation.id], () => {
  revision++; editing.value = pending.value = false; error.value = ''; draft.value = props.conversation.topic
}, { immediate: true, flush: 'sync' })

async function edit() {
  if (pending.value) return
  draft.value = props.conversation.topic; error.value = ''; editing.value = true
  await nextTick()
  input.value?.focus(); input.value?.select()
}
async function save(returnFocus = false) {
  if (!editing.value || pending.value) return
  const version = revision
  pending.value = true; error.value = ''
  try {
    await renameConversation(props.conversation.id, draft.value)
    if (version !== revision) return
    editing.value = false
    if (returnFocus) { await nextTick(); trigger.value?.focus({ preventScroll: true }) }
  } catch (cause) { if (version === revision) error.value = errorMessage(cause) }
  finally { if (version === revision) pending.value = false }
}
async function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); await save(true) }
  if (event.key === 'Escape' && !pending.value) {
    event.preventDefault(); event.stopPropagation()
    editing.value = false; error.value = ''
    await nextTick(); trigger.value?.focus({ preventScroll: true })
  }
}
</script>

<template>
  <div class="conversation-title-editor">
    <div class="conversation-title-row">
      <input v-if="editing" ref="input" v-model="draft" class="conversation-title-input" aria-label="会话名称" maxlength="100" :disabled="pending" :aria-invalid="!!error" :aria-describedby="error ? errorId : undefined" @keydown="keydown" @blur="save()" />
      <button v-else ref="trigger" type="button" class="conversation-title-trigger" :aria-label="`重命名会话：${conversation.topic}`" :title="conversation.topic" @click="edit"><span>{{ conversation.topic }}</span><Pencil :size="14" aria-hidden="true" /></button>
      <span class="conversation-message-count">{{ count }} 条消息</span>
    </div>
    <p v-if="error" :id="errorId" class="conversation-title-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.conversation-title-editor { flex: 1; min-width: 0; max-width: 640px; }
.conversation-title-row { display: flex; align-items: center; gap: 12px; min-width: 0; }
.conversation-title-trigger, .conversation-title-input { box-sizing: border-box; min-width: 0; min-height: 40px; max-width: 100%; padding: 8px; border: 0; border-radius: 6px; background: transparent; color: var(--ink); font: inherit; font-size: 14px; font-weight: 500; text-align: start; }
.conversation-title-trigger { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; overflow: hidden; }
.conversation-title-trigger span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }.conversation-title-trigger svg { flex: none; color: var(--muted); }
.conversation-title-trigger:hover, .conversation-title-input { background: var(--surface-soft); }
.conversation-title-trigger:focus-visible, .conversation-title-input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.conversation-title-input { flex: 1; width: 100%; caret-color: var(--ink); }.conversation-title-input:disabled { opacity: .6; }
.conversation-message-count { flex: none; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.conversation-title-error { margin: 4px 8px; color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 639px), (pointer: coarse) { .conversation-title-trigger, .conversation-title-input { min-height: 44px; }.conversation-title-row { gap: 8px; } }
@media (max-width: 359px) { .conversation-message-count { display: none; } }
</style>
