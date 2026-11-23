<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { X } from '@lucide/vue'

const props = withDefaults(defineProps<{ label: string; triggerLabel?: string; width?: number; disabled?: boolean; placement?: 'auto' | 'bottom-end'; panelClass?: string }>(), { width: 360 })
const emit = defineEmits<{ toggle: [open: boolean] }>()
const id = `studio-${useId()}`
const trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>(), opened = ref(false)
const portalTarget = ref<string | HTMLElement>('body')
const resizeObserver = new ResizeObserver(() => position())
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
async function toggle(event: Event) {
  opened.value = (event as ToggleEvent).newState === 'open'
  emit('toggle', opened.value)
  window.removeEventListener('resize', position)
  window.removeEventListener('scroll', position, true)
  window.visualViewport?.removeEventListener('resize', position)
  window.visualViewport?.removeEventListener('scroll', position)
  resizeObserver.disconnect()
  if (opened.value) {
    await nextTick(); position()
    if (panel.value) {
      panel.value.style.removeProperty('visibility')
      resizeObserver.observe(panel.value)
      const content = panel.value.querySelector('.studio-popover-content')
      if (content) resizeObserver.observe(content)
    }
    window.addEventListener('resize', position)
    if (props.placement === 'bottom-end') window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
  }
}
function close() { panel.value?.hidePopover(); if (trigger.value?.isConnected) trigger.value.focus({ preventScroll: true }) }
onMounted(() => { portalTarget.value = trigger.value?.closest<HTMLElement>('dialog, [popover]') || 'body' })
onBeforeUnmount(() => {
  window.removeEventListener('resize', position)
  window.removeEventListener('scroll', position, true)
  window.visualViewport?.removeEventListener('resize', position)
  window.visualViewport?.removeEventListener('scroll', position)
  resizeObserver.disconnect()
})
defineExpose({ close, open: () => panel.value?.showPopover() })
</script>

<template>
  <button ref="trigger" type="button" class="studio-tool" :popovertarget="id" :title="label" :aria-label="triggerLabel || label" :disabled="disabled" aria-haspopup="dialog" :aria-expanded="opened"><slot name="trigger" /></button>
  <Teleport :to="portalTarget"><div :id="id" ref="panel" popover="auto" class="studio-popover" :class="panelClass" role="dialog" :aria-label="label" :style="{ '--studio-popover-width': `${props.width}px` }" @beforetoggle="beforeToggle" @toggle="toggle">
    <div class="studio-popover-heading"><strong>{{ label }}</strong><button type="button" class="icon-button" :aria-label="`关闭${label}`" :title="`关闭${label}`" :popovertarget="id" popovertargetaction="hide"><X :size="16" /></button></div>
    <div class="studio-popover-content"><slot /></div>
  </div></Teleport>
</template>
