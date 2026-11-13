<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from 'vue'
import { X } from '@lucide/vue'

const props = withDefaults(defineProps<{ label: string; width?: number }>(), { width: 360 })
const id = `studio-${useId()}`
const trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>(), opened = ref(false)
function position() {
  if (!panel.value || !trigger.value || !opened.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const viewport = window.visualViewport
  const top = viewport?.offsetTop || 0, bottom = top + (viewport?.height || innerHeight)
  const availableAbove = anchor.top - top - 16, availableBelow = bottom - anchor.bottom - 16
  const above = availableAbove >= Math.min(240, availableBelow)
  panel.value.style.maxHeight = `${Math.max(80, above ? availableAbove : availableBelow)}px`
  const bounds = panel.value.getBoundingClientRect()
  panel.value.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - bounds.width - 12))}px`
  panel.value.style.top = `${above ? Math.max(top + 8, anchor.top - bounds.height - 8) : anchor.bottom + 8}px`
}
async function toggle(event: Event) {
  opened.value = (event as ToggleEvent).newState === 'open'
  window.removeEventListener('resize', position)
  window.visualViewport?.removeEventListener('resize', position)
  if (opened.value) {
    await nextTick(); position()
    window.addEventListener('resize', position)
    window.visualViewport?.addEventListener('resize', position)
  }
}
function close() { panel.value?.hidePopover() }
onBeforeUnmount(() => {
  window.removeEventListener('resize', position)
  window.visualViewport?.removeEventListener('resize', position)
})
defineExpose({ close })
</script>

<template>
  <button ref="trigger" type="button" class="studio-tool" :popovertarget="id" :title="label" :aria-label="label" aria-haspopup="dialog" :aria-expanded="opened"><slot name="trigger" /></button>
  <Teleport to="body"><div :id="id" ref="panel" popover="auto" class="studio-popover" role="dialog" :aria-label="label" :style="{ width: `min(${props.width}px, calc(100vw - 24px))` }" @toggle="toggle">
    <header class="studio-popover-heading"><strong>{{ label }}</strong><button type="button" class="icon-button" :aria-label="`关闭${label}`" :title="`关闭${label}`" :popovertarget="id" popovertargetaction="hide"><X :size="16" /></button></header>
    <div class="studio-popover-content"><slot /></div>
  </div></Teleport>
</template>
