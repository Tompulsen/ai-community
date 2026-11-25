<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { mediaSource } from '../native-studio'
import { normalizeCanvasRect, type CanvasPoint, type CanvasReferenceRegion } from '../image-canvas'

const props = defineProps<{ src: string; label: string; region?: CanvasReferenceRegion; editable: boolean; disabled: boolean; cancel: number }>()
const emit = defineEmits<{ change: [region: CanvasReferenceRegion | undefined]; dimensions: [size: { width: number; height: number }]; select: [] }>()
const svg = ref<SVGSVGElement>(), loaded = ref(false), failed = ref(false), attempt = ref(0)
const draft = ref(props.region)
let gesture: { pointer: number; start: CanvasPoint; before?: CanvasReferenceRegion; mode: string } | undefined
watch(() => props.region, value => { if (!gesture) draft.value = value }, { deep: true })
watch(() => props.cancel, () => finish(true))
watch(() => props.editable, value => { if (!value) finish(true) })
watch(() => props.disabled, value => { if (value) finish(true) })
onBeforeUnmount(() => finish(true))
function imageLoaded(event: Event) {
  const image = event.target as HTMLImageElement
  emit('dimensions', { width: image.naturalWidth, height: image.naturalHeight }); loaded.value = true; failed.value = false
}
function point(event: PointerEvent) {
  const bounds = svg.value!.getBoundingClientRect()
  return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
}
function down(event: PointerEvent) {
  if (!props.editable || props.disabled || !loaded.value || gesture || event.button !== 0) return
  event.preventDefault(); event.stopPropagation(); emit('select'); svg.value!.focus({ preventScroll: true })
  const mode = (event.target as Element).getAttribute('data-region-handle') || ((event.target as Element).hasAttribute('data-reference-region') ? 'move' : 'draw')
  gesture = { pointer: event.pointerId, start: point(event), before: draft.value && { ...draft.value }, mode }
  svg.value!.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!gesture || gesture.pointer !== event.pointerId) return
  const p = point(event), { start, before, mode } = gesture
  if (mode === 'move' && before) {
    draft.value = { ...before, x: Math.max(0, Math.min(1 - before.width, before.x + p.x - start.x)), y: Math.max(0, Math.min(1 - before.height, before.y + p.y - start.y)) }
  } else if (mode !== 'draw' && before) {
    const opposite = { x: mode.includes('w') ? before.x + before.width : before.x, y: mode.includes('n') ? before.y + before.height : before.y }
    draft.value = normalizeCanvasRect(opposite, p)
  } else draft.value = normalizeCanvasRect(start, p)
}
function finish(cancel = false) {
  if (!gesture) return
  const previous = gesture; gesture = undefined
  if (cancel) draft.value = props.region
  else if (!draft.value || draft.value.width < .005 || draft.value.height < .005) draft.value = previous.before
  else if (JSON.stringify(previous.before) !== JSON.stringify(draft.value)) emit('change', draft.value)
  if (svg.value?.hasPointerCapture(previous.pointer)) svg.value.releasePointerCapture(previous.pointer)
}
function up(event: PointerEvent) {
  if (gesture?.pointer !== event.pointerId) return
  if (event.type === 'pointerup') move(event)
  finish(event.type !== 'pointerup')
}
function keys(event: KeyboardEvent) {
  if (!props.editable || props.disabled || event.isComposing) return
  if (!['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault(); event.stopPropagation()
  if (gesture || !draft.value) return
  if (['Delete', 'Backspace'].includes(event.key)) { emit('change', undefined); return }
  const delta = event.shiftKey ? .05 : .005, before = draft.value
  emit('change', { ...before, x: Math.max(0, Math.min(1 - before.width, before.x + (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0))), y: Math.max(0, Math.min(1 - before.height, before.y + (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0))) })
}
</script>

<template>
  <div class="reference-region-image" :class="{ editing: editable }">
    <img v-if="!failed" :key="attempt" :src="mediaSource(src, true)" :alt="label" draggable="false" @load="imageLoaded" @error="failed = true; loaded = false" />
    <button v-else type="button" class="reference-retry" @click="failed = false; attempt++">参考图加载失败，重试</button>
    <svg v-if="loaded" ref="svg" class="reference-region-svg" viewBox="0 0 1 1" preserveAspectRatio="none" :tabindex="editable ? 0 : -1" role="img" :aria-label="`${label}来源选区，拖动框选，选框可移动和调整四角`" :style="{ pointerEvents: editable ? 'auto' : 'none' }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="finish(true)" @keydown="keys">
      <template v-if="draft">
        <path :d="`M0 0H1V1H0Z M${draft.x} ${draft.y}v${draft.height}h${draft.width}v${-draft.height}Z`" fill="black" fill-opacity=".35" fill-rule="evenodd" pointer-events="none" />
        <rect v-bind="draft" data-reference-region fill="transparent" stroke="#087f95" stroke-width="2" vector-effect="non-scaling-stroke" :style="{ cursor: editable ? 'move' : 'default' }" />
        <template v-if="editable"><rect v-for="corner in ['nw','ne','sw','se']" :key="corner" :data-region-handle="corner" :x="(corner.includes('w') ? draft.x : draft.x + draft.width) - .022" :y="(corner.includes('n') ? draft.y : draft.y + draft.height) - .022" width=".044" height=".044" fill="white" stroke="#087f95" stroke-width="2" vector-effect="non-scaling-stroke" :style="{ cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize' }" /></template>
      </template>
    </svg>
  </div>
</template>

<style scoped>
.reference-region-image { width: 100%; height: 100%; position: relative; }.reference-region-image > img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }.reference-region-svg { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; overflow: visible; }.editing .reference-region-svg { cursor: crosshair; }.reference-region-svg:focus-visible { outline: 2px solid var(--focus-ring, #1593a8); }.reference-retry { width: 100%; min-height: 44px; background: var(--surface); color: var(--ink); border: 1px solid var(--border); cursor: pointer; }
</style>
