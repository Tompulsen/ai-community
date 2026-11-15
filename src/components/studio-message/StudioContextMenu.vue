<!-- Adapted from octopus_chat app/components/chat-context-menu.tsx (MIT). -->
<script lang="ts">
import type { Component } from 'vue'
export interface StudioMenuAction { label: string; icon: Component; disabled?: boolean; danger?: boolean; run: () => unknown }
</script>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { errorMessage, notify } from '../../state'
const props = defineProps<{ items: StudioMenuAction[] }>()
const panel = ref<HTMLElement>(), visible = ref(false)
const position = ref({ left: '8px', top: '8px' })
let origin: HTMLElement | null = null
function close() { panel.value?.hidePopover() }
async function open(event: MouseEvent) {
  if ((event.target as Element)?.closest('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault(); event.stopPropagation()
  origin = event.currentTarget as HTMLElement
  panel.value?.showPopover()
  await nextTick()
  if (!panel.value?.matches(':popover-open')) return
  const bounds = panel.value.getBoundingClientRect()
  position.value = {
    left: `${Math.max(8, Math.min(event.clientX, innerWidth - bounds.width - 8))}px`,
    top: `${Math.max(8, Math.min(event.clientY, innerHeight - bounds.height - 8))}px`,
  }
  await nextTick()
  panel.value.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
}
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); origin?.focus({ preventScroll: true }); return }
  if (event.key === 'Tab') { close(); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = [...panel.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  if (!buttons.length) return
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
}
async function select(item: StudioMenuAction) {
  if (item.disabled) return
  close()
  try { await item.run() } catch (cause) { notify(errorMessage(cause)) }
}
onBeforeUnmount(close)
defineExpose({ open, close, visible })
</script>
<template>
  <Teleport to="body"><div ref="panel" popover="auto" class="message-context-menu" :style="position" role="menu" aria-label="消息操作" @toggle="visible = ($event as ToggleEvent).newState === 'open'" @keydown="keys">
    <button v-for="item in props.items" :key="item.label" type="button" role="menuitem" :disabled="item.disabled" :class="{ danger: item.danger }" @click="select(item)"><component :is="item.icon" :size="16" aria-hidden="true" />{{ item.label }}</button>
  </div></Teleport>
</template>
<style scoped>
.message-context-menu { position: fixed; inset: auto; margin: 0; min-width: 168px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); padding: 4px; border: 0; border-radius: 8px; background: var(--surface); color: var(--ink); box-shadow: 0 6px 24px rgb(0 0 0 / 20%); overflow-y: auto; }
button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 36px; padding: 8px 12px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-size: 13px; text-align: start; cursor: pointer; }
button:hover:not(:disabled), button:focus-visible { background: var(--surface-soft); }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
button.danger { color: var(--danger); }
button:disabled { opacity: .5; cursor: default; }
@media (pointer: coarse), (max-width: 639px) { button { min-height: 44px; } }
</style>
