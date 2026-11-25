<!-- Adapted from QXChat image-canvas-editor / image-canvas-references (MIT, NextChat 2023-2025). -->
<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { ArrowLeft, ArrowUpRight, Circle, Download, Hand, Images, LoaderCircle, MousePointer2, Pencil, Redo2, Square, Trash2, Type, Undo2, Upload, X } from '@lucide/vue'
import { buildCanvasEditPrompt, canvasImageData, canvasRequestIssue, loadCanvasImage, MAX_CANVAS_REFERENCE_IMAGES, moveCanvasAnnotation, normalizeCanvasRect, renderCanvasImage, type CanvasAnnotation, type CanvasPoint, type CanvasReferenceImage } from '../image-canvas'
import { readCanvasDraft, saveCanvasDraft, studioCanvasKey } from '../studio-canvas'
import StudioCanvasBoard from './StudioCanvasBoard.vue'
import type { CanvasNode, CanvasPosition, CanvasViewport } from '../canvas-viewport'
import { mediaSource, prepareCreationHistory } from '../native-studio'
import { galleryOutputIndexes, getTaskPage } from '../studio-task-store'
import { prepareStudioImage } from '../studio-image-upload'
import { errorMessage, session } from '../state'

const props = defineProps<{ src: string; scope: string; attachments?: { src?: string; kind: string }[] }>()
const emit = defineEmits<{ back: []; close: [] }>()
const context = inject(studioCanvasKey, undefined)
const owner = session.user?.id, acceptedScope = props.scope, cacheKey = JSON.stringify([owner, props.scope, props.src])
const saved = readCanvasDraft(cacheKey)
const annotations = ref<CanvasAnnotation[]>(saved?.annotations || []), references = ref<CanvasReferenceImage[]>(saved?.references || []), overall = ref(saved?.overall || '')
const original = shallowRef<Awaited<ReturnType<typeof loadCanvasImage>>>()
const loading = ref(true), error = ref(''), busy = ref<'save' | 'submit' | 'upload'>(), selectedId = ref(saved?.annotations.at(-1)?.id || '')
const tool = ref<CanvasAnnotation['kind'] | 'select' | 'pan'>('select'), color = ref('#ef4444'), stroke = ref(4)
const positions = ref<Record<string, CanvasPosition>>(saved?.positions || {}), viewport = ref<CanvasViewport | undefined>(saved?.viewport), selectedNode = ref('')
type Snapshot = { annotations: CanvasAnnotation[]; references: CanvasReferenceImage[]; positions: Record<string, CanvasPosition> }
const undo = ref<Snapshot[]>([]), redo = ref<Snapshot[]>([])
const svg = ref<SVGSVGElement>(), board = ref<InstanceType<typeof StudioCanvasBoard>>(), back = ref<HTMLButtonElement>(), input = ref<HTMLInputElement>()
const markerId = useId()
const width = computed(() => original.value?.image.naturalWidth || 1), height = computed(() => original.value?.image.naturalHeight || 1)
const nodes = computed<CanvasNode[]>(() => [
  { id: 'source', label: '主图 · 标注在此图中绘制', src: props.src, width: 600, height: 600 * height.value / width.value, ...(positions.value.source || { x: 0, y: 0 }) },
  ...references.value.map((item, index) => ({ id: item.id, label: `参考图 ${index + 1}`, src: item.src, width: 260, height: 200, ...(positions.value[item.id] || { x: 680 + (index % 3) * 300, y: Math.floor(index / 3) * 280 }) })),
])
const selected = computed(() => annotations.value.find(item => item.id === selectedId.value))
const tools = [
  { id: 'select', label: '选择', icon: MousePointer2 }, { id: 'pan', label: '平移', icon: Hand }, { id: 'rect', label: '框选', icon: Square },
  { id: 'ellipse', label: '圈选', icon: Circle }, { id: 'arrow', label: '箭头', icon: ArrowUpRight },
  { id: 'pen', label: '画笔', icon: Pencil }, { id: 'text', label: '文字', icon: Type },
] as const
const labels = { rect: '框选', ellipse: '圈选', arrow: '箭头', pen: '画笔', text: '文字' }
const availableAttachments = computed(() => (props.attachments || []).filter(item => item.kind === 'image' && item.src && item.src !== props.src && !references.value.some(ref => ref.src === item.src)))
const clone = (items: CanvasAnnotation[]) => structuredClone(items.map(item => ({ ...item, points: item.points.map(point => ({ ...point })) })))
let live = true, loadController = new AbortController(), operation: AbortController | undefined
function current() { return live && owner === session.user?.id && acceptedScope === props.scope }
function persist() { if (current()) saveCanvasDraft(cacheKey, { annotations: annotations.value, references: references.value, overall: overall.value, positions: positions.value, viewport: viewport.value }) }
let persistTimer: ReturnType<typeof setTimeout> | undefined
watch([annotations, references, overall, positions, viewport], () => { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 150) }, { deep: true })
async function load() {
  loadController.abort(); loadController = new AbortController()
  const controller = loadController
  original.value?.dispose(); original.value = undefined; loading.value = true; error.value = ''
  try {
    const result = await loadCanvasImage(props.src, controller.signal)
    if (!current() || controller.signal.aborted) { result.dispose(); return }
    original.value = result
  } catch (cause) { if (current() && !controller.signal.aborted) error.value = errorMessage(cause) }
  finally { if (current() && controller === loadController) loading.value = false }
}
onMounted(() => {
  back.value?.focus()
  void load()
})
onBeforeUnmount(() => { finishGesture(true); board.value?.finish(true); clearTimeout(persistTimer); persist(); live = false; loadController.abort(); operation?.abort(); original.value?.dispose(); clearTimeout(searchTimer) })
function snapshot(): Snapshot {
  return { annotations: clone(annotations.value), references: references.value.map(item => ({ ...item })), positions: Object.fromEntries(Object.entries(positions.value).map(([id, point]) => [id, { ...point }])) }
}
function restore(value: Snapshot) { annotations.value = clone(value.annotations); references.value = value.references.map(item => ({ ...item })); positions.value = Object.fromEntries(Object.entries(value.positions).map(([id, point]) => [id, { ...point }])) }
function checkpoint(before = snapshot()) { undo.value = [...undo.value.slice(-49), before]; redo.value = [] }
let layoutBefore: Snapshot | undefined
function beginLayout() { finishGesture(true); layoutBefore = snapshot() }
function endLayout(cancel: boolean) {
  const previous = layoutBefore; layoutBefore = undefined
  if (!previous) return
  if (cancel) restore(previous)
  else if (JSON.stringify(previous.positions) !== JSON.stringify(positions.value)) checkpoint(previous)
}
function moveNode(id: string, point: CanvasPosition) { positions.value = { ...positions.value, [id]: point } }
function selectNode(id: string) { selectedNode.value = id; if (id) selectedId.value = '' }
function selectAnnotation(id: string) { selectedId.value = id; selectedNode.value = ''; tool.value = 'select' }
function removeReference(id: string) {
  if (busy.value || !references.value.some(item => item.id === id)) return
  board.value?.finish(); finishGesture()
  checkpoint(); references.value = references.value.filter(item => item.id !== id)
  const { [id]: removed, ...rest } = positions.value; positions.value = rest
  if (selectedNode.value === id) selectedNode.value = ''
}
function chooseTool(id: typeof tool.value) { finishGesture(); board.value?.finish(); tool.value = id; selectedNode.value = '' }
function history(direction: 'undo' | 'redo') {
  if (busy.value) return
  finishGesture(true); board.value?.finish(true)
  const from = direction === 'undo' ? undo : redo, to = direction === 'undo' ? redo : undo
  const value = from.value.at(-1)
  if (!value) return
  to.value = [...to.value.slice(-49), snapshot()]; from.value = from.value.slice(0, -1); restore(value)
  if (!nodes.value.some(item => item.id === selectedNode.value)) selectedNode.value = ''
  if (!annotations.value.some(item => item.id === selectedId.value)) selectedId.value = ''
}
function update(patch: Partial<CanvasAnnotation>) {
  if (!selected.value || busy.value) return
  checkpoint(); annotations.value = annotations.value.map(item => item.id === selectedId.value ? { ...item, ...patch } : item)
}
function remove() { if (selected.value && !busy.value) { checkpoint(); annotations.value = annotations.value.filter(item => item.id !== selectedId.value); selectedId.value = '' } }
function makeAnnotation(kind: CanvasAnnotation['kind'], points: CanvasPoint[]): CanvasAnnotation {
  return { id: crypto.randomUUID(), kind, points, color: color.value, strokeWidth: Math.max(1, Math.min(80, stroke.value || 4)), text: kind === 'text' ? '添加文字' : '', instruction: '', target: (kind === 'rect' || kind === 'ellipse') && !references.value.length ? 'text' : 'object', sourceText: '', replacement: '', fontSize: Math.max(18, Math.round(Math.min(width.value, height.value) * .045)), ...(references.value.length === 1 ? { referenceImageId: references.value[0]!.id } : {}) }
}
function addCenter() {
  if (!original.value || busy.value) return
  if (annotations.value.length >= 40) { error.value = '每张图片最多添加 40 个标注。'; return }
  checkpoint()
  const kind = tool.value === 'select' || tool.value === 'pan' ? 'rect' : tool.value
  const item = makeAnnotation(kind, kind === 'text' ? [{ x: width.value * .3, y: height.value * .4 }] : [{ x: width.value * .3, y: height.value * .3 }, { x: width.value * .7, y: height.value * .7 }])
  annotations.value = [...annotations.value, item]; selectAnnotation(item.id)
}
function point(event: PointerEvent) {
  const bounds = svg.value!.getBoundingClientRect()
  return { x: Math.max(0, Math.min(width.value, (event.clientX - bounds.left) / bounds.width * width.value)), y: Math.max(0, Math.min(height.value, (event.clientY - bounds.top) / bounds.height * height.value)) }
}
let gesture: { pointer: number; start: CanvasPoint; before: CanvasAnnotation[]; annotation: CanvasAnnotation; moving: boolean } | undefined
function down(event: PointerEvent) {
  if (busy.value || !original.value || event.button !== 0 || gesture || tool.value === 'pan') return
  const id = (event.target as Element).closest('[data-annotation]')?.getAttribute('data-annotation')
  const existing = tool.value === 'select' && annotations.value.find(item => item.id === id)
  if (tool.value === 'select' && !existing) { selectedId.value = ''; return }
  if (!existing && annotations.value.length >= 40) { error.value = '每张图片最多添加 40 个标注。'; return }
  event.preventDefault(); event.stopPropagation(); selectedNode.value = ''; svg.value!.focus({ preventScroll: true })
  const start = point(event), before = clone(annotations.value)
  const annotation = existing ? clone([existing])[0]! : makeAnnotation(tool.value as CanvasAnnotation['kind'], [start, start])
  if (!existing) annotations.value = [...annotations.value, annotation]
  selectedId.value = annotation.id
  gesture = { pointer: event.pointerId, start, before, annotation, moving: !!existing }
  svg.value!.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointer) return
  event.preventDefault()
  const next = point(event), { annotation, start, moving } = gesture
  if (moving) annotations.value = annotations.value.map(item => item.id === annotation.id ? moveCanvasAnnotation(annotation, next.x - start.x, next.y - start.y, width.value, height.value) : item)
  else annotations.value = annotations.value.map(item => {
    if (item.id !== annotation.id || item.kind === 'text') return item
    if (item.kind === 'pen') return item.points.length < 10000 ? { ...item, points: [...item.points, next] } : item
    return { ...item, points: [start, next] }
  })
}
function finishGesture(cancel = false) {
  if (!gesture) return
  const previous = gesture; gesture = undefined
  if (cancel) annotations.value = previous.before
  else if (JSON.stringify(previous.before) !== JSON.stringify(annotations.value)) { checkpoint({ ...snapshot(), annotations: previous.before }); tool.value = 'select' }
  if (svg.value?.hasPointerCapture(previous.pointer)) svg.value.releasePointerCapture(previous.pointer)
}
function up(event: PointerEvent) {
  if (event.pointerId !== gesture?.pointer) return
  if (event.type === 'pointerup') move(event)
  finishGesture(event.type !== 'pointerup')
}
function rect(item: CanvasAnnotation) { return normalizeCanvasRect(item.points[0]!, item.points.at(-1)!) }
function path(item: CanvasAnnotation) { return item.points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') }
function keys(event: KeyboardEvent) {
  if ((event.target as HTMLElement).matches('input, textarea, select, [contenteditable="true"]') || event.isComposing) return
  if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo'); return }
  if (['Delete', 'Backspace'].includes(event.key) || event.key.startsWith('Arrow')) finishGesture()
  if (['Delete', 'Backspace'].includes(event.key) && selected.value) { event.preventDefault(); remove(); return }
  if (event.key.startsWith('Arrow') && selected.value && !busy.value) {
    const distance = event.shiftKey ? 10 : 1
    event.preventDefault(); update(moveCanvasAnnotation(selected.value, event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0, event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0, width.value, height.value))
  }
}
function addReference(src: string, point?: CanvasPosition) {
  if (src === props.src || references.value.some(item => item.src === src)) return
  if (references.value.length >= MAX_CANVAS_REFERENCE_IMAGES) { error.value = '最多添加 14 张参考图。'; return }
  checkpoint()
  const id = crypto.randomUUID(), right = Math.max(...nodes.value.map(node => node.x + node.width))
  positions.value = { ...positions.value, [id]: point || { x: right + 80, y: positions.value.source?.y || 0 } }
  references.value = [...references.value, { id, src }]
  selectNode(id)
  if (!point) void board.value?.reveal()
}
async function uploadFiles(files: File[], point?: CanvasPosition) {
  if (!files.length || busy.value) return
  busy.value = 'upload'; error.value = ''
  try {
    for (const [index, file] of files.entries()) {
      if (references.value.length >= MAX_CANVAS_REFERENCE_IMAGES) throw new Error('最多添加 14 张参考图，已保留添加成功的图片。')
      const src = await prepareStudioImage(file, true)
      if (!current()) return
      addReference(src, point ? { x: point.x + index * 40, y: point.y + index * 40 } : undefined)
    }
  } catch (cause) { if (current()) error.value = errorMessage(cause) }
  finally { if (current()) busy.value = undefined }
}
async function upload(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || []); (event.target as HTMLInputElement).value = ''
  await uploadFiles(files)
}
const library = ref(false), libraryLoading = ref(false), libraryError = ref(''), query = ref('')
const libraryItems = ref<{ key: string; src: string; name: string }[]>([])
let cursor: { id: string; createdAt: number } | undefined, libraryRevision = 0, searchTimer: ReturnType<typeof setTimeout> | undefined
const more = ref(false)
async function loadLibrary(append = false) {
  if (!owner || !current()) return
  const revision = ++libraryRevision
  libraryLoading.value = true; libraryError.value = ''
  if (!append) { cursor = undefined; libraryItems.value = []; more.value = false }
  try {
    await prepareCreationHistory()
    if (!current() || revision !== libraryRevision) return
    const page = await getTaskPage(owner, { kind: 'image', gallery: true, query: query.value, after: cursor, limit: 12, summary: false })
    if (!current() || revision !== libraryRevision) return
    const items = page.tasks.flatMap(task => galleryOutputIndexes(task).map(index => ({ key: `${task.id}:${index}`, src: task.urls[index]!, name: task.prompt || '生成图片' })))
    libraryItems.value = append ? [...libraryItems.value, ...items] : items
    cursor = page.after; more.value = !!cursor
  } catch (cause) { if (current() && revision === libraryRevision) libraryError.value = errorMessage(cause) }
  finally { if (current() && revision === libraryRevision) libraryLoading.value = false }
}
watch(query, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => void loadLibrary(), 250) })
async function openLibrary() { library.value = true; await loadLibrary(); await nextTick() }
async function run(action: 'save' | 'submit') {
  if (!current() || !original.value || busy.value) return
  finishGesture(); board.value?.finish()
  const source = original.value, controller = new AbortController()
  operation = controller; busy.value = action; error.value = ''
  try {
    if (action === 'save') {
      const blob = await renderCanvasImage(source.image, annotations.value)
      if (!current() || controller.signal.aborted) return
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = '画布标注.png'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      return
    }
    if (!context || context.scope.value !== acceptedScope) throw new Error('请从创作对话中打开图片后使用 AI 修改。')
    const prompt = buildCanvasEditPrompt(annotations.value, width.value, height.value, overall.value, references.value)
    const sourceBlob = /^image\/(png|jpeg|webp)$/.test(source.blob.type) ? source.blob : await renderCanvasImage(source.image, [])
    const images = [await canvasImageData(sourceBlob, controller.signal)]
    if (annotations.value.length) images.push(await canvasImageData(await renderCanvasImage(source.image, annotations.value, { includeLabels: true }), controller.signal))
    for (const reference of references.value) {
      controller.signal.throwIfAborted()
      const loaded = await loadCanvasImage(reference.src, controller.signal)
      try { images.push(await canvasImageData(/^image\/(png|jpeg|webp)$/.test(loaded.blob.type) ? loaded.blob : await renderCanvasImage(loaded.image, []), controller.signal)) }
      finally { loaded.dispose() }
      const issue = canvasRequestIssue({ prompt, images }); if (issue) throw new Error(issue)
    }
    const draft = { prompt, images }, issue = canvasRequestIssue(draft)
    if (issue) throw new Error(issue)
    if (!current() || controller.signal.aborted) return
    await context.submit(draft, { scope: acceptedScope, signal: controller.signal, onRegistered: () => { if (current()) emit('close') } })
  } catch (cause) { if (current() && !controller.signal.aborted) error.value = errorMessage(cause) }
  finally { if (operation === controller) { operation = undefined; if (current()) busy.value = undefined } }
}
</script>

<template>
  <section class="image-canvas" aria-label="图片画布编辑器" @keydown.stop="keys">
    <header class="canvas-header">
      <button ref="back" type="button" class="canvas-button" @click="emit('back')"><ArrowLeft :size="18" /><span>返回预览</span></button>
      <div class="canvas-heading"><h2>图片画布</h2><p>拖动图片自由排列，标注主图并使用参考图修改</p></div>
      <button type="button" class="canvas-button canvas-save" :disabled="!original || !!busy" @click="run('save')"><LoaderCircle v-if="busy === 'save'" :size="18" /><Download v-else :size="18" /><span>保存标注图片</span></button>
      <button type="button" class="canvas-button canvas-close" aria-label="关闭画布" title="关闭画布" @click="emit('close')"><X :size="20" /></button>
    </header>
    <div class="canvas-layout">
      <nav class="canvas-tools" aria-label="画布工具">
        <button v-for="item in tools" :key="item.id" type="button" class="canvas-button" :aria-pressed="tool === item.id" :disabled="!!busy" @click="chooseTool(item.id)"><component :is="item.icon" :size="20" /><span>{{ item.label }}</span></button>
        <span class="canvas-tool-divider" />
        <button type="button" class="canvas-button" :disabled="!undo.length || !!busy" title="撤销 Ctrl+Z" @click="history('undo')"><Undo2 :size="20" /><span>撤销</span></button>
        <button type="button" class="canvas-button" :disabled="!redo.length || !!busy" title="重做 Ctrl+Shift+Z" @click="history('redo')"><Redo2 :size="20" /><span>重做</span></button>
      </nav>
      <div class="canvas-main">
        <div v-if="loading" class="canvas-load" role="status"><LoaderCircle :size="28" />正在加载原图…</div>
        <div v-else-if="!original" class="canvas-load"><p role="alert">{{ error }}</p><button type="button" class="canvas-button" @click="load">重新加载原图</button></div>
        <StudioCanvasBoard v-else ref="board" :nodes="nodes" :selected="selectedNode" :pan="tool === 'pan'" :disabled="!!busy" :viewport="viewport" :dimensions="`${width} × ${height}`"
          @select="selectNode" @move="moveNode" @begin="beginLayout" @end="endLayout" @viewport="viewport = $event" @remove="removeReference" @upload="input?.click()" @files="uploadFiles" @cancel-drawing="finishGesture(true)">
          <div class="canvas-sheet">
            <svg ref="svg" :viewBox="`0 0 ${width} ${height}`" tabindex="0" role="img" aria-label="图片标注画布，可用右侧添加中心选区及方向键操作" :style="{ cursor: tool === 'select' ? 'grab' : 'crosshair' }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="finishGesture(true)">
              <defs><marker :id="markerId" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="context-stroke" stroke-width="2" /></marker></defs>
              <image :href="original.image.src" :width="width" :height="height" />
              <g v-for="(item, position) in annotations" :key="item.id" :data-annotation="item.id" :stroke="item.color" :stroke-width="item.strokeWidth" fill="none" stroke-linecap="round" stroke-linejoin="round" :class="{ 'selected-annotation': selectedId === item.id }">
                <rect v-if="item.kind === 'rect'" v-bind="rect(item)" fill="transparent" />
                <ellipse v-else-if="item.kind === 'ellipse'" :cx="rect(item).x + rect(item).width / 2" :cy="rect(item).y + rect(item).height / 2" :rx="rect(item).width / 2" :ry="rect(item).height / 2" fill="transparent" />
                <text v-else-if="item.kind === 'text'" :x="item.points[0]!.x" :y="item.points[0]!.y" :font-size="item.fontSize" :fill="item.color" stroke="none" dominant-baseline="hanging"><tspan v-for="(line, lineIndex) in item.text.split('\n')" :key="lineIndex" :x="item.points[0]!.x" :dy="lineIndex ? `${item.fontSize * 1.3}` : 0">{{ line }}</tspan></text>
                <path v-else :d="path(item)" :marker-end="item.kind === 'arrow' ? `url(#${markerId})` : undefined" />
                <circle :cx="Math.max(12, Math.min(width - 12, item.points[0]!.x))" :cy="Math.max(12, Math.min(height - 12, item.points[0]!.y))" :r="Math.max(12, Math.min(width, height) * .018)" fill="#facc15" stroke="#fff" stroke-width="1" />
                <text :x="Math.max(12, Math.min(width - 12, item.points[0]!.x))" :y="Math.max(12, Math.min(height - 12, item.points[0]!.y))" :font-size="Math.max(12, Math.min(width, height) * .018)" fill="#422006" stroke="none" text-anchor="middle" dominant-baseline="central">{{ position + 1 }}</text>
              </g>
            </svg>
          </div>
        </StudioCanvasBoard>
        <p class="canvas-help">选择工具拖动图片；空白处拖动平移，滚轮 / 双指缩放。框选主图后填写修改要求。<a href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noopener noreferrer">Infinite Canvas</a></p>
      </div>
      <aside class="canvas-properties" aria-label="画布修改要求">
        <fieldset :disabled="!!busy">
          <section class="canvas-section">
            <h3>参考图合成 <small>{{ references.length }} / 14</small></h3>
            <p>拖入图片或点击添加。位置仅用于整理画布；修改时在主图上标注并指定参考图。</p>
            <button v-if="original" type="button" class="canvas-source" @click="selectNode('source'); board?.reveal('source')"><img :src="original.image.src" alt="主图" /><div><strong>主图</strong><small>点击定位主图</small></div></button>
            <div v-if="references.length" class="canvas-references"><div v-for="(item, index) in references" :key="item.id"><button type="button" class="canvas-reference-locate" :aria-label="`定位参考图 ${index + 1}`" @click="selectNode(item.id); board?.reveal(item.id)"><img :src="mediaSource(item.src, true)" :alt="`参考图 ${index + 1}`" /><span>参考图 {{ index + 1 }}</span></button><button type="button" class="canvas-button" :aria-label="`移除画布参考图 ${index + 1}`" @click="removeReference(item.id)"><X :size="16" /></button></div></div>
            <button class="canvas-button canvas-wide" type="button" :disabled="!owner || references.length >= 14" @click="openLibrary"><Images :size="16" />从作品库选择</button>
            <button class="canvas-button canvas-wide" type="button" :disabled="references.length >= 14" @click="input?.click()"><Upload :size="16" />上传本地参考图</button>
            <input ref="input" class="canvas-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif" multiple aria-label="上传画布参考图" @change="upload" />
            <button v-if="availableAttachments.length" class="canvas-button canvas-wide" type="button" :disabled="references.length >= 14" @click="availableAttachments.forEach(item => addReference(item.src!))">加入同组其他图片</button>
            <section v-if="library" class="canvas-library" aria-label="选择作品库参考图">
              <div class="canvas-library-heading"><strong>选择参考图</strong><button type="button" class="canvas-button" aria-label="收起参考图作品库" @click="library = false"><X :size="16" /></button></div>
              <input v-model="query" type="search" aria-label="搜索画布参考作品" placeholder="搜索提示词或模型" maxlength="300" />
              <div class="canvas-library-grid"><button v-for="item in libraryItems" :key="item.key" type="button" :aria-label="`添加参考图：${item.name}`" :title="item.name" :disabled="item.src === src || references.some(ref => ref.src === item.src) || references.length >= 14" @click="addReference(item.src)"><img :src="mediaSource(item.src, true)" :alt="item.name" loading="lazy" /></button></div>
              <p v-if="libraryLoading" role="status">正在读取作品…</p><p v-else-if="!libraryItems.length && !libraryError">没有匹配的图片作品</p>
              <p v-if="libraryError" role="alert">{{ libraryError }}<button type="button" class="canvas-button" @click="loadLibrary()">重试</button></p>
              <button v-if="more" type="button" class="canvas-button canvas-wide" :disabled="libraryLoading" @click="loadLibrary(true)">加载更多</button>
            </section>
          </section>
          <section class="canvas-section">
            <h3>标注与选区 <small>{{ annotations.length }} / 40</small></h3><p>框选和圈选默认修改原图文字；添加参考图后，新选区默认修改物品或画面。</p>
            <div class="canvas-style"><label>颜色<input :value="selected?.color || color" type="color" @input="color = ($event.target as HTMLInputElement).value; update({ color })" /></label><label>线宽<input :value="selected?.strokeWidth || stroke" type="number" min="1" max="80" @change="stroke = Math.max(1, Math.min(80, Number(($event.target as HTMLInputElement).value) || 4)); update({ strokeWidth: stroke })" /></label></div>
            <button type="button" class="canvas-button canvas-wide" :disabled="!original || annotations.length >= 40" @click="addCenter">添加中心选区</button>
            <div v-if="annotations.length" class="canvas-annotation-list" role="group" aria-label="标注列表"><button v-for="(item, index) in annotations" :key="item.id" class="canvas-button" type="button" :aria-pressed="selectedId === item.id" @click="selectAnnotation(item.id)">{{ index + 1 }} · {{ labels[item.kind] }}</button></div>
            <div v-if="selected" class="canvas-fields">
              <label v-if="selected.kind === 'text'">叠加文字<textarea :value="selected.text" rows="2" maxlength="2000" @input="update({ text: ($event.target as HTMLTextAreaElement).value })" /></label>
              <label v-if="selected.kind === 'text'">字号<input :value="selected.fontSize" type="number" min="8" max="500" @change="update({ fontSize: Math.max(8, Math.min(500, Number(($event.target as HTMLInputElement).value) || 24)) })" /></label>
              <label>修改目标<select :value="selected.target" @change="update({ target: ($event.target as HTMLSelectElement).value as 'text' | 'object' })"><option value="text">原图文字</option><option value="object">物品 / 画面</option></select></label>
              <template v-if="selected.target === 'text'"><label>原图文字<input :value="selected.sourceText" maxlength="2000" placeholder="例如：恐龙" @input="update({ sourceText: ($event.target as HTMLInputElement).value })" /></label><label>替换成的文字<input :value="selected.replacement" maxlength="2000" placeholder="例如：小猫" @input="update({ replacement: ($event.target as HTMLInputElement).value })" /></label></template>
              <label v-else>使用参考图<select :value="selected.referenceImageId || ''" @change="update({ referenceImageId: ($event.target as HTMLSelectElement).value || undefined })"><option value="">不指定参考图</option><option v-if="selected.referenceImageId && !references.some(item => item.id === selected!.referenceImageId)" :value="selected.referenceImageId" disabled>已移除，请重新选择</option><option v-for="(item, index) in references" :key="item.id" :value="item.id">参考图 {{ index + 1 }}</option></select></label>
              <label>此标注的修改要求<textarea :value="selected.instruction" rows="3" maxlength="5000" placeholder="说明这个区域要如何修改" @input="update({ instruction: ($event.target as HTMLTextAreaElement).value })" /></label>
              <button type="button" class="canvas-button canvas-wide canvas-delete" @click="remove"><Trash2 :size="16" />删除此标注</button>
            </div>
          </section>
          <section class="canvas-section"><label class="canvas-overall">整体修改要求<textarea v-model="overall" rows="4" maxlength="12000" placeholder="例如：仅修改标注区域，其余内容保持原样" /></label></section>
        </fieldset>
        <p v-if="error && original" class="canvas-error" role="alert">{{ error }}</p>
        <button type="button" class="canvas-button canvas-primary" :disabled="!original || !!busy || !context" @click="run('submit')"><LoaderCircle v-if="busy === 'submit' || busy === 'upload'" :size="18" />{{ busy === 'submit' ? '正在准备修改…' : context?.label.value || '请从创作对话中使用 AI 修改' }}</button>
        <p class="canvas-note">{{ context?.model.value ? `使用当前图片模型 ${context.model.value}，按现有规则计费。` : '导入图片对话后，选择支持改图的模型再发送。' }}主图、标注图和参考图一同提交，生成结果返回对话。局部修改效果取决于模型。</p>
        <p class="canvas-note">保存标注图片会下载原尺寸 PNG，不调用 AI。动图会以当前画面作为静态图片编辑。</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.image-canvas { height: 100%; display: flex; flex-direction: column; background: var(--surface); color: var(--ink); color-scheme: normal; font-size: 14px; line-height: 1.5; }
.canvas-header { display: flex; align-items: center; gap: 14px; padding: 16px 20px; border-bottom: 1px solid var(--border); flex: none; }
.canvas-heading { flex: 1; min-width: 0; }.canvas-heading h2 { margin: 0; font-size: 19px; }.canvas-heading p { margin: 3px 0 0; font-size: 12px; color: var(--muted); }
.canvas-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; cursor: pointer; }.canvas-button svg { flex: none; }.canvas-button:hover:not(:disabled) { background: var(--surface-soft); }.canvas-button:disabled { opacity: .45; cursor: default; }.canvas-button[aria-pressed="true"] { border-color: var(--accent, #1593a8); background: color-mix(in srgb, var(--accent, #1593a8) 12%, var(--surface)); color: var(--ink); }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, svg:focus-visible { outline: 2px solid var(--focus-ring, #1593a8); outline-offset: -2px; }
.canvas-layout { flex: 1; display: grid; grid-template-columns: 74px minmax(0, 1fr) 300px; min-height: 0; }.canvas-tools { display: flex; flex-direction: column; gap: 8px; padding: 12px 8px; border-right: 1px solid var(--border); overflow-y: auto; }.canvas-tools .canvas-button { flex-direction: column; gap: 4px; min-height: 62px; padding: 8px 2px; font-size: 12px; }.canvas-tool-divider { border-top: 1px solid var(--border); margin: 2px 0; }
.canvas-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }.canvas-sheet { width: 100%; height: 100%; }.canvas-sheet > svg { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; }.selected-annotation { filter: drop-shadow(0 0 2px rgb(0 0 0 / 40%)); }.canvas-help { flex: none; padding: 10px 14px; margin: 0; color: var(--muted); font-size: 12px; border-top: 1px solid var(--border); }.canvas-help a { color: var(--muted); margin-left: 6px; text-underline-offset: 2px; }
.canvas-load { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; min-height: 180px; text-align: center; }.canvas-properties { min-height: 0; overflow: auto; overscroll-behavior: contain; border-left: 1px solid var(--border); padding: 0 16px 20px; }.canvas-properties fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }.canvas-section { padding: 16px 0; border-bottom: 1px solid var(--border); }.canvas-section h3 { display: flex; align-items: center; justify-content: space-between; font-size: 14px; margin: 0 0 8px; }.canvas-section h3 small { font-size: 12px; font-weight: 400; color: var(--muted); }.canvas-section p, .canvas-note { font-size: 12px; color: var(--muted); margin: 8px 0; }.canvas-note { overflow-wrap: anywhere; }.canvas-wide { width: 100%; margin-top: 8px; }.canvas-source { width: 100%; font: inherit; color: var(--ink); background: var(--surface); text-align: left; cursor: pointer; display: flex; gap: 10px; padding: 6px; border: 1px solid var(--border); border-radius: 8px; }.canvas-source img { width: 54px; height: 54px; object-fit: cover; border-radius: 4px; }.canvas-source div { display: flex; flex-direction: column; justify-content: center; gap: 3px; }.canvas-source small { color: var(--muted); }
.canvas-file { display: none; }.canvas-reference-locate { width: 100%; padding: 0; background: var(--surface); color: var(--ink); border: 0; cursor: pointer; text-align: left; }.canvas-references { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }.canvas-references > div { position: relative; overflow: hidden; border: 1px solid var(--border); border-radius: 6px; }.canvas-references img { display: block; width: 100%; height: 90px; object-fit: cover; }.canvas-references span { display: block; padding: 4px; font-size: 12px; }.canvas-references .canvas-button { position: absolute; top: 0; right: 0; min-height: 32px; min-width: 32px; padding: 4px; border-radius: 0 0 0 8px; }
.canvas-style { display: flex; align-items: center; gap: 16px; }.canvas-style label { display: flex; align-items: center; gap: 6px; }.canvas-style input { width: 52px; min-height: 40px; padding: 4px; }.canvas-annotation-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }.canvas-annotation-list button { padding: 4px 8px; }.canvas-fields { display: grid; gap: 10px; margin-top: 14px; }.canvas-fields label, .canvas-overall { display: flex; flex-direction: column; gap: 6px; }.canvas-properties input, .canvas-properties textarea, .canvas-properties select { box-sizing: border-box; min-width: 0; max-width: 100%; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); font: inherit; padding: 8px; min-height: 40px; }.canvas-properties textarea { resize: vertical; }.canvas-properties select { width: 100%; }.canvas-properties input::placeholder, .canvas-properties textarea::placeholder { color: var(--muted); }.canvas-delete, .canvas-error { color: var(--danger, #b91c1c); }.canvas-error { overflow-wrap: anywhere; }
.canvas-primary { width: 100%; margin-top: 14px; background: #087f95; color: white; border-color: #087f95; font-weight: 600; }.canvas-primary:hover:not(:disabled) { background: #066778; }.canvas-close { padding: 8px; min-width: 44px; }.canvas-library { margin-top: 12px; }.canvas-library-heading { display: flex; justify-content: space-between; align-items: center; }.canvas-library input { width: 100%; }.canvas-library-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 8px; max-height: 260px; overflow: auto; }.canvas-library-grid button { border: 1px solid var(--border); border-radius: 6px; padding: 0; overflow: hidden; background: var(--surface-soft); cursor: pointer; }.canvas-library-grid button:disabled { opacity: .3; cursor: default; }.canvas-library-grid img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
@media (max-width: 800px) { .canvas-header { flex-wrap: wrap; gap: 8px; padding: 10px; }.canvas-heading { order: -1; flex-basis: calc(100% - 52px); }.canvas-heading p { font-size: 11px; }.canvas-close { order: -1; }.canvas-save { margin-left: auto; }.canvas-layout { display: flex; flex-direction: column; overflow: auto; }.canvas-tools { flex-direction: row; overflow-x: auto; overflow-y: hidden; flex: none; border-right: 0; border-bottom: 1px solid var(--border); gap: 6px; padding: 6px 8px; }.canvas-tools .canvas-button { flex: 0 0 48px; min-height: 52px; padding: 5px; }.canvas-tool-divider { border-left: 1px solid var(--border); border-top: 0; }.canvas-main { flex: none; height: 62dvh; min-height: 440px; }.canvas-help { font-size: 11px; }.canvas-properties { flex: none; overflow: visible; border-left: 0; border-top: 1px solid var(--border); padding-bottom: max(24px, env(safe-area-inset-bottom)); }.canvas-references { grid-template-columns: repeat(3, minmax(0, 1fr)); }.canvas-references .canvas-button { min-height: 44px; min-width: 44px; }.canvas-properties input, .canvas-properties textarea, .canvas-properties select { font-size: 16px; min-height: 44px; } }
</style>
