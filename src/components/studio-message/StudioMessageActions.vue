<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from 'vue'
import { ImageUp, MessageCircleReply } from '@lucide/vue'
import editImage from '../../assets/message-actions/rename.svg'
import edit from '../../assets/message-actions/edit.svg'
import retry from '../../assets/message-actions/reload.svg'
import remove from '../../assets/message-actions/clear.svg'
import pin from '../../assets/message-actions/pin.svg'
import copy from '../../assets/message-actions/copy.svg'
import download from '../../assets/message-actions/download.svg'
import { supportsNativePopover } from '../../studio-popover-fallback'

const icons = { editImage, edit, retry, delete: remove, pin, copy, download }
export interface MessageAction {
  icon: keyof typeof icons | 'publish' | 'comment'
  label: string
  hint?: string
  disabled?: boolean
  pressed?: boolean
  run: () => unknown
}
defineProps<{ label: string; actions: MessageAction[] }>()
const id = `message-action-${useId()}`
const tooltip = ref<HTMLElement>(), tip = ref(''), described = ref<string>()
const portal = ref<string | HTMLElement>('body')
const nativePopover = supportsNativePopover()
let anchor: HTMLButtonElement | undefined, hideTimer: ReturnType<typeof setTimeout> | undefined
let dismissed = false
function resumeHover() { dismissed = false }
function close() {
  clearTimeout(hideTimer)
  if (nativePopover) tooltip.value?.hidePopover()
  tip.value = ''; described.value = undefined; anchor = undefined
  window.removeEventListener('scroll', close, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('keydown', escape)
  window.removeEventListener('pointerdown', outside, true)
  window.visualViewport?.removeEventListener('resize', close)
  window.visualViewport?.removeEventListener('scroll', close)
}
function outside(event: PointerEvent) { if (event.target instanceof Node && !anchor?.contains(event.target) && !tooltip.value?.contains(event.target)) close() }
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  dismissed = true; close()
  // Removing a tooltip can reveal a button under a stationary mouse.
  window.addEventListener('pointermove', resumeHover, { once: true })
}
async function show(event: MouseEvent | FocusEvent, action: MessageAction) {
  if (!nativePopover) return
  const target = event.currentTarget as HTMLButtonElement
  if (event.type === 'pointerenter' && dismissed) return
  if (event.type === 'pointerenter' && (event as PointerEvent).pointerType === 'touch' || event.type === 'focus' && !target.matches(':focus-visible')) return
  close()
  anchor = target; tip.value = action.hint || action.label; described.value = action.icon
  portal.value = target.closest<HTMLElement>('dialog, [popover]') || 'body'
  await nextTick()
  if (anchor !== target || !tooltip.value) return
  const panel = tooltip.value
  panel.style.visibility = 'hidden'; panel.showPopover()
  const bounds = target.getBoundingClientRect(), size = panel.getBoundingClientRect(), viewport = window.visualViewport
  const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0
  const right = left + (viewport?.width || innerWidth), bottom = top + (viewport?.height || innerHeight)
  panel.style.left = `${Math.max(left + 8, Math.min(bounds.left + (bounds.width - size.width) / 2, right - size.width - 8))}px`
  panel.style.top = `${Math.max(top + 8, Math.min(bounds.top - size.height - 6 >= top + 8 ? bounds.top - size.height - 6 : bounds.bottom + 6, bottom - size.height - 8))}px`
  panel.style.visibility = 'visible'
  window.addEventListener('scroll', close, true)
  window.addEventListener('resize', close)
  window.addEventListener('keydown', escape)
  window.addEventListener('pointerdown', outside, true)
  window.visualViewport?.addEventListener('resize', close)
  window.visualViewport?.addEventListener('scroll', close)
}
function leave() {
  if (anchor === document.activeElement && anchor?.matches(':focus-visible')) return
  hideTimer = setTimeout(close, 120)
}
function keepOpen() { clearTimeout(hideTimer) }
function activate(event: MouseEvent, action: MessageAction) {
  if (action.disabled) { void show(event, action); return }
  close(); action.run()
}
onBeforeUnmount(() => { close(); window.removeEventListener('pointermove', resumeHover) })
</script>

<template>
  <div class="studio-message-actions" role="group" :aria-label="label">
    <button v-for="action in actions" :key="action.icon" type="button" class="message-action" :class="{ 'is-danger': action.icon === 'delete' }"
      :data-action="action.icon" :aria-label="action.label" :title="nativePopover ? undefined : action.hint || action.label" :aria-pressed="action.pressed" :aria-disabled="action.disabled || undefined"
      :aria-describedby="described === action.icon ? id : undefined" @pointerenter="show($event, action)" @pointerleave="leave"
      @focus="show($event, action)" @blur="close" @click="activate($event, action)">
      <ImageUp v-if="action.icon === 'publish'" :size="16" :stroke-width="1.8" aria-hidden="true" />
      <MessageCircleReply v-else-if="action.icon === 'comment'" :size="16" :stroke-width="1.8" aria-hidden="true" />
      <span v-else class="message-action-icon" :style="{ maskImage: `url(&quot;${icons[action.icon]}&quot;)` }" aria-hidden="true" />
    </button>
    <Teleport :to="portal"><div v-if="tip" :id="id" ref="tooltip" popover="manual" role="tooltip" class="message-action-tooltip" @pointerenter="keepOpen" @pointerleave="leave">{{ tip }}</div></Teleport>
  </div>
</template>

<style scoped>
/* QXChat's compact message actions (MIT / NextChat), with community publishing. */
.studio-message-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; max-width: 100%; width: fit-content; padding: 2px; margin-top: 8px; border-radius: 6px; }
.message-action { box-sizing: border-box; display: inline-flex; flex: 0 0 38px; align-items: center; justify-content: center; width: 38px; height: 32px; padding: 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--muted); cursor: pointer; transition: background-color 140ms ease, color 140ms ease; }
.message-action-icon { display: block; flex: 0 0 16px; width: 16px; height: 16px; background: currentColor; mask-repeat: no-repeat; mask-position: center; mask-size: contain; }
.message-action:hover, .message-action:focus-visible { background: var(--surface-soft); color: var(--ink); }
.message-action:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
.message-action:active { background: var(--state-pressed); }
.message-action[aria-pressed="true"] { color: var(--blue); background: color-mix(in srgb, var(--blue) 12%, transparent); border-color: color-mix(in srgb, var(--blue) 30%, transparent); }
.message-action[aria-pressed="true"] { position: relative; }
.message-action[aria-pressed="true"]::after { content: ''; width: 4px; height: 4px; border-radius: 50%; background: currentColor; position: absolute; right: 5px; bottom: 5px; }
.message-action.is-danger:hover { color: var(--danger); }
.message-action[aria-disabled="true"] { opacity: .4; cursor: not-allowed; }
.message-action-tooltip { position: fixed; inset: auto; margin: 0; width: max-content; max-width: min(280px, calc(100vw - 16px)); padding: 7px 10px; border: 0; border-radius: 7px; background: var(--ink); color: var(--canvas); font-family: inherit; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; box-shadow: 0 3px 14px rgb(0 0 0 / 16%); }
@media (hover: none), (pointer: coarse), (max-width: 639px) { .message-action { flex-basis: 44px; width: 44px; height: 44px; } }
@media (prefers-reduced-motion: reduce) { .message-action { transition: none; } }
</style>
