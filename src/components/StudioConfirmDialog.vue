<!-- Confirmation layout adapted from octopus_chat ui-lib.tsx (MIT). -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Trash2, X } from '@lucide/vue'
import { session } from '../state'
defineProps<{ message: string }>()
const emit = defineEmits<{ decision: [accepted: boolean] }>()
const dialog = ref<HTMLDialogElement>(), cancel = ref<HTMLButtonElement>(), id = useId()
watch(() => `${session.user?.id}:${session.user?.accountId}`, () => emit('decision', false))
onMounted(() => { dialog.value?.showModal(); cancel.value?.focus() })
onBeforeUnmount(() => dialog.value?.close())
</script>
<template>
  <dialog ref="dialog" class="studio-confirm-dialog" aria-label="删除确认" :aria-describedby="`${id}-message`" @cancel.prevent="emit('decision', false)" @close="emit('decision', false)">
    <header><h2>删除确认</h2><button type="button" class="icon-button" aria-label="关闭删除确认" @click="emit('decision', false)"><X :size="18" /></button></header>
    <p :id="`${id}-message`">{{ message }}</p>
    <footer><button ref="cancel" type="button" class="button subtle btn" @click="emit('decision', false)">取消</button><button type="button" class="button btn confirm-delete" @click="emit('decision', true)"><Trash2 :size="16" />确认删除</button></footer>
  </dialog>
</template>
<style scoped>
.studio-confirm-dialog { width: min(400px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 20px; border: 0; border-radius: 8px; background: var(--surface); color: var(--ink); box-shadow: 0 12px 40px rgb(0 0 0 / 24%); }
.studio-confirm-dialog::backdrop { background: rgb(0 0 0 / 48%); }
header, footer { display: flex; align-items: center; gap: 8px; }header { justify-content: space-between; }h2 { margin: 0; font-size: 16px; font-weight: 500; }p { margin: 16px 0 24px; font-size: 14px; line-height: 24px; overflow-wrap: anywhere; white-space: pre-wrap; }footer { justify-content: flex-end; }.confirm-delete { background: var(--surface-soft); color: var(--danger); }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
footer button { border: 0; }
@media (pointer: coarse), (max-width: 639px) { button { min-height: 44px; } }
</style>
