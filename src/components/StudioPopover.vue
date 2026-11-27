<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { X } from '@lucide/vue'
import { addFallbackPopover, removeFallbackPopover, supportsNativePopover } from '../studio-popover-fallback'

const props = withDefaults(defineProps<{ label: string; triggerLabel?: string; width?: number; disabled?: boolean; placement?: 'auto' | 'bottom-end'; panelClass?: string }>(), { width: 360 })
const emit = defineEmits<{ toggle: [open: boolean] }>()
const id = `studio-${useId()}`
const trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>(), opened = ref(false)
const portalTarget = ref<string | HTMLElement>('body')
const nativePopover = supportsNativePopover()
const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => position())
let opening = 0
function beforeToggle(event: Event) {
  // Measure the open panel before allowing its first visible frame.
  if ((event as ToggleEvent).newState === 'open' && panel.value) panel.value.style.visibility = 'hidden'
}
function position() {
  if (!panel.value || !trigger.value || !opened.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const viewport = window.visualViewport
  const top = viewport?.offsetTop || 0, bottom = top + (viewport?.height || innerHeight)
  if (window.matchMedia('(max-width: 600px)').matches) {
    panel.value.style.maxHeight = `${Math.max(80, Math.min((bottom - top) * .8, bottom - top - 16))}px`
    panel.value.style.left = `${viewport?.offsetLeft || 0}px`
    panel.value.style.top = `${Math.max(top + 8, bottom - panel.value.getBoundingClientRect().height)}px`
    return
  }
  const availableAbove = anchor.top - top - 16, availableBelow = bottom - anchor.bottom - 16
  const above = props.placement === 'bottom-end'
    ? availableBelow < Math.min(panel.value.scrollHeight + 2, availableAbove)
    : availableAbove >= Math.min(240, availableBelow)
  panel.value.style.maxHeight = `${Math.max(80, above ? availableAbove : availableBelow)}px`
  const bounds = panel.value.getBoundingClientRect()
  const left = props.placement === 'bottom-end' ? anchor.right - bounds.width : anchor.left
  panel.value.style.left = `${Math.max(12, Math.min(left, innerWidth - bounds.width - 12))}px`
  panel.value.style.top = `${above ? Math.max(top + 8, anchor.top - bounds.height - 8) : anchor.bottom + 8}px`
}
function stopTracking() {
  window.removeEventListener('resize', position)
  window.removeEventListener('scroll', position, true)
  window.visualViewport?.removeEventListener('resize', position)
  window.visualViewport?.removeEventListener('scroll', position)
  resizeObserver?.disconnect()
}
async function setOpened(value: boolean) {
  const request = ++opening
  opened.value = value
  emit('toggle', value)
  stopTracking()
  if (value) {
    await nextTick()
    if (request !== opening || !panel.value?.isConnected) return
    position()
    if (panel.value) {
      panel.value.style.removeProperty('visibility')
      resizeObserver?.observe(panel.value)
      const content = panel.value.querySelector('.studio-popover-content')
      if (content) resizeObserver?.observe(content)
    }
    window.addEventListener('resize', position)
    if (props.placement === 'bottom-end') window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    if (!nativePopover) panel.value.querySelector<HTMLElement>('[autofocus], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')?.focus({ preventScroll: true })
  }
}
function toggle(event: Event) { if (nativePopover) void setOpened((event as ToggleEvent).newState === 'open') }
function close(restoreFocus = true) {
  if (nativePopover) panel.value?.hidePopover()
  else {
    if (panel.value) removeFallbackPopover(panel.value)
    if (opened.value) void setOpened(false)
  }
  if (restoreFocus && trigger.value?.isConnected) trigger.value.focus({ preventScroll: true })
}
function open() {
  if (props.disabled || !panel.value || !trigger.value) return
  if (nativePopover) { panel.value.showPopover(); return }
  if (opened.value) return
  panel.value.style.visibility = 'hidden'
  addFallbackPopover({ panel: panel.value, trigger: trigger.value, close })
  void setOpened(true)
}
function clickTrigger() { if (!nativePopover) { if (opened.value) close(); else open() } }
onMounted(() => { portalTarget.value = trigger.value?.closest<HTMLElement>(nativePopover ? 'dialog, [popover]' : 'dialog') || 'body' })
onBeforeUnmount(() => {
  opening++; stopTracking()
  if (!nativePopover && panel.value) removeFallbackPopover(panel.value)
})
defineExpose({ close, open })
</script>

<template>
  <button ref="trigger" type="button" class="studio-tool" :popovertarget="nativePopover ? id : undefined" :title="label" :aria-label="triggerLabel || label" :disabled="disabled" aria-haspopup="dialog" :aria-expanded="opened" :aria-controls="id" @click="clickTrigger"><slot name="trigger" /></button>
  <Teleport :to="portalTarget"><div :id="id" ref="panel" :popover="nativePopover ? 'auto' : undefined" :hidden="!nativePopover && !opened" class="studio-popover" :class="[panelClass, { 'studio-popover-fallback': !nativePopover }]" role="dialog" :aria-label="label" :style="{ '--studio-popover-width': `${props.width}px` }" @beforetoggle="beforeToggle" @toggle="toggle">
    <div class="studio-popover-heading"><strong>{{ label }}</strong><button type="button" class="icon-button" :aria-label="`关闭${label}`" :title="`关闭${label}`" @click="close()"><X :size="16" /></button></div>
    <div class="studio-popover-content"><slot /></div>
  </div></Teleport>
</template>
