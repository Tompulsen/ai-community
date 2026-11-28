<!-- Adapted from octopus_chat app/components/chat-context-menu.tsx (MIT). -->
<script lang="ts">
import type { Component } from 'vue'
export interface StudioMenuAction { label: string; text?: string; icon: Component; disabled?: boolean; danger?: boolean; run: () => unknown }
</script>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { errorMessage, notify } from '../../state'
import { addFallbackPopover, removeFallbackPopover, supportsNativePopover } from '../../studio-popover-fallback'
const props = defineProps<{ items: StudioMenuAction[]; label?: string; id?: string }>()
const panel = ref<HTMLElement>(), visible = ref(false)
const mounted = ref(false)
const portalTarget = ref<string | HTMLElement>('body')
const position = ref({ left: '8px', top: '8px' })
const nativePopover = supportsNativePopover()
let origin: HTMLElement | null = null
let opening = 0
function close() {
  opening++
  if (nativePopover) panel.value?.hidePopover()
  else {
    if (panel.value) removeFallbackPopover(panel.value)
  }
  visible.value = false; mounted.value = false
}
function toggle(event: Event) {
  if (!nativePopover || event.target !== panel.value) return
  visible.value = panel.value.matches(':popover-open')
  if (!visible.value) { opening++; mounted.value = false }
}
async function open(event: MouseEvent) {
  if ((event.target as Element)?.closest('input, textarea, select, [contenteditable="true"]')) return
  event.preventDefault(); event.stopPropagation()
  origin = event.currentTarget as HTMLElement
  const request = ++opening
  portalTarget.value = origin.closest<HTMLDialogElement>('dialog[open]') || 'body'
  mounted.value = true
  await nextTick()
  if (request !== opening || !origin.isConnected) return
  if (!panel.value) return
  panel.value.style.visibility = 'hidden'
  if (nativePopover) panel.value.showPopover()
  else {
    addFallbackPopover({ panel: panel.value, trigger: origin, close: (restoreFocus = true) => {
      close()
      if (restoreFocus && origin?.isConnected) origin.focus({ preventScroll: true })
    } })
    visible.value = true
  }
  await nextTick()
  if (request !== opening || !panel.value || (nativePopover ? !panel.value.matches(':popover-open') : !visible.value)) return
  const bounds = panel.value.getBoundingClientRect()
  const trigger = event.type === 'click' ? origin.getBoundingClientRect() : undefined
  const top = trigger ? trigger.bottom + bounds.height + 4 <= innerHeight - 8 ? trigger.bottom + 4 : trigger.top - bounds.height - 4 : event.clientY
  position.value = {
    left: `${Math.max(8, Math.min(trigger ? trigger.left : event.clientX, innerWidth - bounds.width - 8))}px`,
    top: `${Math.max(8, Math.min(top, innerHeight - bounds.height - 8))}px`,
  }
  await nextTick()
  if (request !== opening || !panel.value?.isConnected) return
  panel.value.style.removeProperty('visibility')
  panel.value.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
}
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); origin?.focus({ preventScroll: true }); return }
  if (event.key === 'Tab') { origin?.focus({ preventScroll: true }); close(); return }
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
  origin?.focus({ preventScroll: true })
  try { await item.run() } catch (cause) { notify(errorMessage(cause)) }
}
onBeforeUnmount(close)
defineExpose({ open, close, visible })
</script>
<template>
  <Teleport v-if="mounted" :to="portalTarget"><div :id="id" ref="panel" :popover="nativePopover ? 'auto' : undefined" :hidden="!nativePopover && !visible" class="message-context-menu" :class="{ 'studio-popover-fallback': !nativePopover }" :style="position" role="menu" :aria-label="label || '消息操作'" @toggle="toggle" @keydown="keys">
    <button v-for="item in props.items" :key="item.label" type="button" role="menuitem" :aria-label="item.label" :disabled="item.disabled" :class="{ danger: item.danger }" @click="select(item)"><component :is="item.icon" :size="16" aria-hidden="true" /><span>{{ item.text || item.label }}</span></button>
  </div></Teleport>
</template>
<style scoped>
.message-context-menu { position: fixed; inset: auto; margin: 0; min-width: 168px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); padding: 4px; border: 0; border-radius: 8px; background: var(--popover-surface); color: var(--ink); box-shadow: var(--popover-shadow); overflow-y: auto; }
.message-context-menu[hidden] { display: none; }
button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 36px; padding: 8px 12px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-size: 13px; text-align: start; cursor: pointer; }
button:hover:not(:disabled), button:focus-visible { background: var(--state-hover); }
button:active:not(:disabled) { background: var(--state-pressed); }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
button.danger { color: var(--danger); }
button:disabled { opacity: .5; cursor: default; }
button > svg { flex: none; }button > span { min-width: 0; overflow-wrap: anywhere; }
@media (pointer: coarse), (max-width: 639px) { button { min-height: 44px; } }
</style>
