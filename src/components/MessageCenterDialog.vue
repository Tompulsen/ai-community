<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { X } from '@lucide/vue'
import type { InboxCategory } from '../inbox'
import MessagesView from '../views/MessagesView.vue'

const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>(), category = ref<InboxCategory | null>(null)
async function open(value: InboxCategory) {
  category.value = value
  await nextTick()
  if (category.value && !dialog.value?.open) dialog.value?.showModal()
}
function close() { category.value = null; dialog.value?.close() }
function closed() { category.value = null; emit('close') }
defineExpose({ open, close })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="message-center-dialog" aria-label="消息中心" @close="closed" @click="($event.target === dialog) && close()">
      <MessagesView v-if="category" embedded :category="category">
        <template #close><button type="button" class="icon-button" aria-label="关闭消息中心" title="关闭消息中心" @click="close"><X :size="20" /></button></template>
      </MessagesView>
    </dialog>
  </Teleport>
</template>

<style scoped>
.message-center-dialog { width: min(1000px, calc(100vw - 32px)); height: min(760px, calc(100dvh - 48px)); max-height: calc(100dvh - 48px); border: 0; border-radius: 12px; overflow: hidden; background: var(--canvas); }
:global(html:has(.message-center-dialog[open])) { overflow: hidden; scrollbar-gutter: stable; }
@media (max-width: 639px) {
  .message-center-dialog { width: calc(100vw - 16px); max-width: calc(100vw - 16px); height: calc(100dvh - 24px); max-height: calc(100dvh - 24px); }
}
</style>
