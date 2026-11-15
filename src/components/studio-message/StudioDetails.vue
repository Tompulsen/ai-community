<!-- Vue adaptation of octopus_chat SmoothDetails (MIT). -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import StudioCollapse from './StudioCollapse.vue'
import { useReducedMotion } from '../../studio-motion'
const props = defineProps<{ openOn?: boolean }>()
const open = ref(!!props.openOn), present = ref(!!props.openOn), summary = ref<HTMLElement>(), details = ref<HTMLDetailsElement>()
const id = `details-${useId()}`, reduced = useReducedMotion()
let timer: ReturnType<typeof setTimeout> | undefined, revision = 0
async function toggle(value = !open.value) {
  const current = ++revision
  clearTimeout(timer)
  if (value) {
    present.value = true
    await nextTick()
    details.value?.getBoundingClientRect()
    if (current === revision) open.value = true
  } else {
    open.value = false
    timer = setTimeout(() => { if (current === revision) present.value = false }, reduced.value ? 0 : 230)
  }
}
function nativeToggle(event: Event) {
  if (event.target !== event.currentTarget) return
  const value = (event.currentTarget as HTMLDetailsElement).open
  if (value === present.value) return
  revision++; clearTimeout(timer)
  open.value = present.value = value
}
watch(() => props.openOn, value => { if (value) void toggle(true) })
onBeforeUnmount(() => { revision++; clearTimeout(timer) })
</script>
<template>
  <details ref="details" :open="present" :data-expanded="open" @toggle="nativeToggle">
    <summary ref="summary" :aria-expanded="open" :aria-controls="id" @click.prevent="toggle()"><slot name="summary" /></summary>
    <StudioCollapse :id="id" :open="open" :trigger="summary"><slot /></StudioCollapse>
  </details>
</template>
