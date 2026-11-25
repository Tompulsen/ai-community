<!-- Pan/zoom and movable nodes adapted from basketikun/infinite-canvas (MIT, 2026). -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Focus, Minus, Plus, Trash2, Upload } from '@lucide/vue'
import { canvasWorldPoint, fitCanvasNodes, zoomCanvasAt, CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM, type CanvasNode, type CanvasPosition, type CanvasViewport } from '../canvas-viewport'
import { mediaSource } from '../native-studio'

const props = defineProps<{ nodes: CanvasNode[]; selected: string; pan: boolean; disabled: boolean; viewport?: CanvasViewport; dimensions: string }>()
const emit = defineEmits<{
  select: [id: string]; move: [id: string, position: CanvasPosition]; begin: []; end: [cancel: boolean]
  viewport: [value: CanvasViewport]; remove: [id: string]; upload: []; files: [files: File[], position: CanvasPosition]
  cancelDrawing: []
}>()
const stage = ref<HTMLElement>(), view = ref<CanvasViewport>(props.viewport || { x: 0, y: 0, k: 1 })
const space = ref(false), dragging = ref(false), dropping = ref(false)
const selectedNode = computed(() => props.nodes.find(node => node.id === props.selected))
const selectedLabel = computed(() => selectedNode.value?.label || '')
let observer: ResizeObserver | undefined, sized = false
type Drag = { pointer: number; start: CanvasPosition; origin: CanvasPosition; node?: string; moved: boolean }
let drag: Drag | undefined
const touches = new Map<number, CanvasPosition>()
let pinch: { distance: number; world: CanvasPosition; scale: number } | undefined
function position(event: { clientX: number; clientY: number }) {
  const rect = stage.value!.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}
function setView(value: CanvasViewport) { view.value = value; emit('viewport', value) }
function fit(id?: string) {
  if (!stage.value) return
  setView(fitCanvasNodes(id ? props.nodes.filter(node => node.id === id) : props.nodes, stage.value.clientWidth, stage.value.clientHeight))
}
function scale(factor: number, point = { x: stage.value!.clientWidth / 2, y: stage.value!.clientHeight / 2 }) {
  if (drag || pinch) return
  setView(zoomCanvasAt(view.value, point, view.value.k * factor))
}
function wheel(event: WheelEvent) {
  if ((event.target as Element).closest('button,a')) return
  event.preventDefault()
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.value!.clientHeight : 1)
  scale(Math.exp(-Math.max(-300, Math.min(300, delta)) * .002), position(event))
}
function finish(cancel = false) {
  const previous = drag; drag = undefined; dragging.value = false
  if (previous?.node && previous.moved) emit('end', cancel)
  if (previous && stage.value?.hasPointerCapture(previous.pointer)) stage.value.releasePointerCapture(previous.pointer)
}
function capture(event: PointerEvent) {
  if (props.disabled || (event.target as Element).closest('button,a')) return
  if (event.pointerType === 'touch') {
    touches.set(event.pointerId, position(event))
    if (touches.size === 2) {
      finish(true); emit('cancelDrawing')
      const [a, b] = [...touches.values()] as [CanvasPosition, CanvasPosition]
      pinch = { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), world: canvasWorldPoint(view.value, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), scale: view.value.k }
      for (const id of touches.keys()) stage.value!.setPointerCapture(id)
    }
    if (pinch || touches.size > 1) { event.preventDefault(); event.stopPropagation(); return }
  }
  if (event.button === 1 || ((space.value || props.pan) && event.button === 0)) {
    event.stopPropagation(); start(event)
  }
}
function start(event: PointerEvent, id?: string) {
  if (props.disabled || pinch || drag || ![0, 1].includes(event.button) || (event.target as Element).closest('button,a')) return
  event.preventDefault(); stage.value!.focus({ preventScroll: true })
  const node = id && props.nodes.find(node => node.id === id)
  emit('select', id || '')
  drag = { pointer: event.pointerId, start: position(event), origin: node ? { x: node.x, y: node.y } : { x: view.value.x, y: view.value.y }, node: id, moved: false }
  stage.value!.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (touches.has(event.pointerId)) touches.set(event.pointerId, position(event))
  if (pinch && touches.size >= 2) {
    const [a, b] = [...touches.values()] as [CanvasPosition, CanvasPosition]
    const k = Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, pinch.scale * Math.hypot(b.x - a.x, b.y - a.y) / pinch.distance))
    setView({ x: (a.x + b.x) / 2 - pinch.world.x * k, y: (a.y + b.y) / 2 - pinch.world.y * k, k })
    return
  }
  if (!drag || drag.pointer !== event.pointerId) return
  const p = position(event), dx = p.x - drag.start.x, dy = p.y - drag.start.y
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 3) return
    if (drag.node) emit('begin')
    drag.moved = true; dragging.value = true
  }
  if (drag.node) emit('move', drag.node, { x: drag.origin.x + dx / view.value.k, y: drag.origin.y + dy / view.value.k })
  else setView({ ...view.value, x: drag.origin.x + dx, y: drag.origin.y + dy })
}
function up(event: PointerEvent) {
  if (event.type === 'pointerup') move(event)
  touches.delete(event.pointerId)
  if (pinch) {
    if (touches.size < 2) pinch = undefined
    if (stage.value?.hasPointerCapture(event.pointerId)) stage.value.releasePointerCapture(event.pointerId)
  }
  if (drag?.pointer === event.pointerId) finish(event.type !== 'pointerup')
}
function nudge(dx: number, dy: number) {
  if (!selectedNode.value || props.disabled) return
  finish()
  emit('begin'); emit('move', selectedNode.value.id, { x: selectedNode.value.x + dx, y: selectedNode.value.y + dy }); emit('end', false)
}
function keys(event: KeyboardEvent) {
  if ((event.target as Element).closest('input,textarea,select,[contenteditable="true"]') || event.isComposing) return
  if (event.code === 'Space' && !(event.target as Element).closest('button,a')) { event.preventDefault(); space.value = true; return }
  if ((drag || pinch) && (['Delete', 'Backspace'].includes(event.key) || event.key.startsWith('Arrow'))) { event.preventDefault(); event.stopPropagation(); return }
  if (props.disabled || !selectedNode.value) return
  if (['Delete', 'Backspace'].includes(event.key) && props.selected !== 'source') { event.preventDefault(); event.stopPropagation(); emit('remove', props.selected) }
  else if (event.key.startsWith('Arrow')) {
    event.preventDefault(); event.stopPropagation()
    const delta = event.shiftKey ? 10 : 1
    nudge(event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0, event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0)
  }
}
function releaseSpace(event: KeyboardEvent) { if (event.code === 'Space') space.value = false }
function blur() { space.value = false; touches.clear(); pinch = undefined; finish(true); emit('cancelDrawing') }
function drop(event: DragEvent) {
  event.preventDefault(); dropping.value = false
  if (!props.disabled && event.dataTransfer?.files.length) emit('files', Array.from(event.dataTransfer.files), canvasWorldPoint(view.value, position(event)))
}
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (!stage.value?.clientWidth || !stage.value.clientHeight) return
    if (!sized) { if (!props.viewport) fit(); sized = true }
  })
  if (stage.value) observer.observe(stage.value)
  window.addEventListener('keyup', releaseSpace); window.addEventListener('blur', blur)
})
onBeforeUnmount(() => { blur(); observer?.disconnect(); window.removeEventListener('keyup', releaseSpace); window.removeEventListener('blur', blur) })
async function reveal(id?: string) { await nextTick(); fit(id) }
defineExpose({ reveal, finish })
</script>

<template>
  <div class="canvas-board" @keydown="keys">
    <div class="board-toolbar">
      <span class="board-dimensions">{{ dimensions }}</span>
      <button type="button" aria-label="缩小画布" :disabled="view.k <= CANVAS_MIN_ZOOM" @click="scale(.8)"><Minus :size="16" /></button>
      <output aria-label="画布缩放比例">{{ Math.round(view.k * 100) }}%</output>
      <button type="button" aria-label="放大画布" :disabled="view.k >= CANVAS_MAX_ZOOM" @click="scale(1.25)"><Plus :size="16" /></button>
      <button type="button" title="适应主图" @click="fit('source')">主图</button>
      <button type="button" title="查看全部图片" @click="fit()"><Focus :size="16" /><span>全部</span></button>
    </div>
    <div ref="stage" class="canvas-stage" :class="{ 'is-panning': pan || space, 'is-dragging': dragging, 'is-dropping': dropping }" tabindex="0" role="group" aria-label="无限画布，可拖动图片、空白平移、滚轮或双指缩放"
      :style="{ backgroundSize: `${24 * view.k}px ${24 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }"
      @wheel="wheel" @pointerdown.capture="capture" @pointerdown="start($event)" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="drag?.pointer === $event.pointerId && finish(true)"
      @dragover.prevent="dropping = !disabled" @dragleave.self="dropping = false" @drop="drop">
      <div class="canvas-world" :style="{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }">
        <div v-for="node in nodes" :key="node.id" class="canvas-node" :class="{ 'is-selected': selected === node.id }" :data-canvas-node="node.id" :style="{ width: `${node.width}px`, height: `${node.height}px`, transform: `translate(${node.x}px, ${node.y}px)` }" @pointerdown.stop="start($event, node.id)">
          <div class="canvas-node-heading" :style="{ transform: `scale(${1 / view.k})`, width: `${node.width * view.k}px` }"><span>{{ node.label }}</span><button v-if="node.id !== 'source'" type="button" :aria-label="`删除${node.label}`" :disabled="disabled" @click.stop="emit('remove', node.id)"><Trash2 :size="16" /></button></div>
          <slot v-if="node.id === 'source'" />
          <img v-else :src="mediaSource(node.src, true)" :alt="node.label" draggable="false" />
        </div>
      </div>
      <div class="board-actions"><button type="button" :disabled="disabled || nodes.length >= 15" @click="emit('upload')"><Upload :size="17" />添加参考图</button></div>
      <p v-if="dropping" class="board-drop" role="status">松开即可添加参考图</p>
    </div>
    <div class="board-selection" aria-label="图片位置操作">
      <span>{{ selectedLabel || '选择图片可移动位置' }}</span>
      <button v-for="item in [{ label: '向左移动图片', x: -20, y: 0, icon: ArrowLeft }, { label: '向上移动图片', x: 0, y: -20, icon: ArrowUp }, { label: '向下移动图片', x: 0, y: 20, icon: ArrowDown }, { label: '向右移动图片', x: 20, y: 0, icon: ArrowRight }]" :key="item.label" type="button" :aria-label="item.label" :disabled="!selectedNode || disabled" @click="nudge(item.x, item.y)"><component :is="item.icon" :size="16" /></button>
      <button v-if="selected && selected !== 'source'" type="button" :disabled="disabled" aria-label="删除选中参考图" @click="emit('remove', selected)"><Trash2 :size="16" /></button>
    </div>
  </div>
</template>

<style scoped>
.canvas-board { flex: 1; min-height: 0; display: flex; flex-direction: column; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 44px; min-height: 44px; border: 0; padding: 8px; background: var(--surface); color: var(--ink); border-radius: 8px; cursor: pointer; font: inherit; }
button:hover:not(:disabled) { background: var(--surface-soft); } button:disabled { opacity: .4; cursor: default; }
button:focus-visible, .canvas-stage:focus-visible { outline: 2px solid var(--focus-ring, #1593a8); outline-offset: -2px; }
.board-toolbar, .board-selection { display: flex; align-items: center; gap: 2px; padding: 4px 8px; background: var(--surface); flex: none; font-size: 12px; }
.board-toolbar { flex-wrap: wrap; border-bottom: 1px solid var(--border); }.board-dimensions { flex: 1; white-space: nowrap; }.board-toolbar output { min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; }
.canvas-stage { flex: 1; min-height: 180px; position: relative; overflow: hidden; isolation: isolate; background-color: var(--surface-soft); background-image: radial-gradient(var(--border) 1px, transparent 1px); touch-action: none; user-select: none; overscroll-behavior: contain; cursor: grab; }
.canvas-stage.is-panning :deep(*) { cursor: grab !important; }.canvas-stage.is-dragging, .canvas-stage.is-dragging :deep(*) { cursor: grabbing !important; }
.canvas-world { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.canvas-node { position: absolute; top: 0; left: 0; background: var(--surface); outline: 1px solid var(--border); box-shadow: 0 4px 18px #0002; cursor: grab; }.canvas-node.is-selected { outline: 3px solid var(--accent, #1593a8); z-index: 2; }
.canvas-node-heading { position: absolute; bottom: 100%; left: 0; transform-origin: left bottom; display: flex; align-items: center; gap: 6px; min-height: 44px; color: var(--ink); font-size: 12px; }.canvas-node-heading span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px var(--surface); }.canvas-node-heading button { flex: none; }
.canvas-node > img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.board-actions { position: absolute; left: 12px; bottom: 12px; }.board-actions button { box-shadow: 0 2px 12px #0002; border: 1px solid var(--border); }
.board-drop { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; background: color-mix(in srgb, var(--surface) 80%, transparent); border: 2px dashed var(--accent, #1593a8); pointer-events: none; font-size: 16px; }
.board-selection { border-top: 1px solid var(--border); flex-wrap: wrap; }.board-selection > span { flex: 1; min-width: 60px; color: var(--muted); }
@media (max-width: 480px) { .board-dimensions { flex-basis: 100%; }.board-toolbar { padding: 3px 8px; }.board-selection { padding: 2px 6px; } }
</style>
