<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, Download, LoaderCircle, Minus, TriangleAlert, X } from '@lucide/vue'
import StudioWorkspace from './StudioWorkspace.vue'
import { studioAnchor, studioSession } from '../studio-state'
import { notify, session } from '../state'

interface Task { id: string; sessionId?: string; kind: 'image' | 'video'; title: string; model: string; createdAt: number; state: 'running' | 'complete' | 'error'; message?: string }
const router = useRouter()
const studio = ref<InstanceType<typeof StudioWorkspace>>()
const tasks = ref<Task[]>([])
const hidden = ref(false), taskIndex = ref(0)
const frameStyle = ref({ top: '0px', left: '0px', width: '1000px', height: '700px' })
const dockStyle = ref<{ left?: string; top?: string; right?: string; bottom?: string }>({})
const allTasks = computed<Task[]>(() => [...tasks.value, ...studioSession.pending.filter(item => !tasks.value.some(task => task.id === item.requestId)).map(item => ({ id: item.requestId, kind: item.kind, title: item.prompt.slice(0, 100), model: item.model, createdAt: Date.now(), state: 'running' as const }))])
const task = computed(() => allTasks.value[Math.min(taskIndex.value, allTasks.value.length - 1)])
const previewDialog = ref<HTMLDialogElement>(), previewTask = ref<Task | null>(null)
const files = ref<{ url: string; name: string; type: string }[]>([]), previewError = ref('')
const sent = new Set<string>()
let observer: ResizeObserver | undefined, resultTimeout: ReturnType<typeof setTimeout> | undefined
let dragging: { id: number; x: number; y: number; left: number; top: number; target: HTMLElement } | undefined

function place() {
  const rect = studioAnchor.value?.getBoundingClientRect()
  if (rect) frameStyle.value = { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` }
}
function flush() {
  for (const work of studioSession.pending) if (!sent.has(work.requestId) && studio.value?.sendBackground({ action: 'submit', work })) sent.add(work.requestId)
  if (studioSession.openTaskId && studioAnchor.value) studio.value?.sendBackground({ action: 'open', requestId: studioSession.openTaskId })
}
function connection(state: string) {
  if (state === 'loading') sent.clear()
  if (state === 'error' || state === 'authorize') for (const item of tasks.value) if (item.state === 'running') item.message = state === 'authorize' ? '工作台需要授权，请返回创作页。' : '连接中断，请返回工作台恢复查询。'
}
function validTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false
  const item = value as Task
  return typeof item.id === 'string' && typeof item.title === 'string' && typeof item.model === 'string' && ['image', 'video'].includes(item.kind) && ['running', 'complete', 'error'].includes(item.state)
}
function receive(data: Record<string, unknown>) {
  if (data.status === 'background-tasks' && Array.isArray(data.tasks)) {
    for (const item of data.tasks.filter(validTask)) {
      const previous = tasks.value.find(task => task.id === item.id)
      const previousState = previous?.state
      const wasPending = studioSession.pending.some(work => work.requestId === item.id)
      if (previous) Object.assign(previous, item)
      else tasks.value.push({ ...item, title: item.title.slice(0, 100), model: item.model.slice(0, 100) })
      studioSession.pending = studioSession.pending.filter(work => work.requestId !== item.id)
      if (item.state === 'complete' && (previousState === 'running' || wasPending)) { hidden.value = false; taskIndex.value = tasks.value.findIndex(task => task.id === item.id); notify(`${item.kind === 'video' ? '视频' : '图片'}已生成，点击任务查看结果。`) }
    }
    tasks.value = tasks.value.slice(-50)
  } else if (data.status === 'background-opened' && data.requestId === studioSession.openTaskId) studioSession.openTaskId = ''
  else if (data.status === 'background-error') {
    if (data.action === 'result' && previewTask.value?.id === data.requestId) { clearTimeout(resultTimeout); previewError.value = String(data.message || '结果读取失败，请重试。') }
    else {
      const item = tasks.value.find(task => task.id === data.requestId)
      const pending = studioSession.pending.find(work => work.requestId === data.requestId)
      if (item) { item.state = 'error'; item.message = String(data.message || '任务失败。').slice(0, 300) }
      else if (pending) tasks.value.push({ id: pending.requestId, kind: pending.kind, title: pending.prompt.slice(0, 100), model: pending.model, state: 'error', createdAt: Date.now(), message: String(data.message || '任务失败。').slice(0, 300) })
      studioSession.pending = studioSession.pending.filter(work => work.requestId !== data.requestId); hidden.value = false
    }
  } else if (data.status === 'background-result' && previewTask.value?.id === data.requestId) {
    clearTimeout(resultTimeout)
    if (!Array.isArray(data.files) || !data.files.length || data.files.length > 16 || data.files.some(file => !(file instanceof Blob) || !/^(image|video)\//.test(file.type) || file.size > 256 * 1024 * 1024)) { previewError.value = '结果文件无效，请到工作台查看。'; return }
    clearFiles()
    files.value = (data.files as Blob[]).map((blob, index) => ({ url: URL.createObjectURL(blob), name: `creation-${index + 1}.${blob.type.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin'}`, type: blob.type }))
  }
}
function clearFiles() { for (const file of files.value) URL.revokeObjectURL(file.url); files.value = [] }
async function openTask(value: Task) {
  studioSession.kind = value.kind; studioSession.source = null; studioSession.openTaskId = value.id
  await router.push(`/create/${value.kind}`); await nextTick(); flush()
}
function preview(value: Task) {
  clearFiles(); previewTask.value = value; previewError.value = ''; previewDialog.value?.showModal()
  if (!studio.value?.sendBackground({ action: 'result', requestId: value.id })) { previewError.value = '工作台尚未连接，请返回创作页重试。'; return }
  clearTimeout(resultTimeout)
  resultTimeout = setTimeout(() => { previewError.value = '读取结果超时，请重试。' }, 90000)
}
function clearPreview() { clearFiles(); clearTimeout(resultTimeout); previewTask.value = null }
function pointerDown(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('button')) return
  const target = event.currentTarget as HTMLElement, rect = target.parentElement!.getBoundingClientRect()
  dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, target }
  target.setPointerCapture(event.pointerId)
}
function pointerMove(event: PointerEvent) {
  if (!dragging || dragging.id !== event.pointerId) return
  dockStyle.value = { left: `${Math.max(8, Math.min(innerWidth - 312, dragging.left + event.clientX - dragging.x))}px`, top: `${Math.max(8, Math.min(innerHeight - 210, dragging.top + event.clientY - dragging.y))}px`, right: 'auto', bottom: 'auto' }
}
function pointerUp() { dragging = undefined }
watch(studioAnchor, async anchor => { observer?.disconnect(); if (anchor) { observer = new ResizeObserver(place); observer.observe(anchor); await nextTick(); place(); flush() } }, { flush: 'post' })
watch(() => studioSession.pending.length, flush)
watch(() => studioSession.openTaskId, flush)
watch(() => session.user?.id, id => {
  tasks.value = []; sent.clear(); studioSession.pending = []; studioSession.source = null; studioSession.openTaskId = ''; studioSession.enabled = false; previewDialog.value?.close(); clearPreview()
  if (!id) return
  try { const saved: unknown = JSON.parse(localStorage.getItem(`community-background:${id}`) || '[]'); if (Array.isArray(saved)) tasks.value = saved.filter(validTask).slice(-50) } catch { /* Invalid local task metadata does not block the workspace. */ }
  if (tasks.value.length || studioAnchor.value) studioSession.enabled = true
}, { immediate: true })
watch(tasks, value => { if (session.user) { try { localStorage.setItem(`community-background:${session.user.id}`, JSON.stringify(value)) } catch { /* Studio also keeps its task records. */ } } }, { deep: true })
onMounted(() => { window.addEventListener('resize', place); window.addEventListener('scroll', place, true) })
onBeforeUnmount(() => { observer?.disconnect(); clearPreview(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) })
</script>

<template>
  <div v-if="session.user && studioSession.enabled" class="studio-host" :class="{ 'studio-offscreen': !studioAnchor }" :style="frameStyle" :aria-hidden="!studioAnchor" :inert="!studioAnchor"><StudioWorkspace ref="studio" :kind="studioSession.kind" :source="studioSession.source" @ready="flush" @state="connection" @background="receive" /></div>
  <aside v-if="session.user && studioSession.enabled && task" class="background-dock" :class="{ minimized: hidden }" :style="dockStyle" aria-label="后台生成任务">
    <button v-if="hidden" class="button" @click="hidden = false"><LoaderCircle v-if="allTasks.some(task => task.state === 'running')" :size="17" /><CheckCircle2 v-else :size="17" />生成任务 · {{ allTasks.length }}</button>
    <template v-else><div class="dock-heading" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp"><strong>生成任务 · {{ taskIndex + 1 }}/{{ allTasks.length }}</strong><button class="icon-button" aria-label="收起生成任务" title="收起" @click="hidden = true"><Minus :size="17" /></button></div><div class="dock-content"><component :is="task.state === 'running' ? LoaderCircle : task.state === 'complete' ? CheckCircle2 : TriangleAlert" :size="20" /><div><strong>{{ task.state === 'running' ? '正在生成' : task.state === 'complete' ? '生成完成' : '需要处理' }}</strong><p>{{ task.title || task.model }}</p></div></div><p v-if="task.message" class="dock-message" role="status">{{ task.message }}</p><div class="dock-actions"><button v-if="task.state === 'complete'" class="button primary" @click="preview(task)">查看结果</button><button class="button subtle" @click="openTask(task)">工作台<ArrowUpRight :size="15" /></button><button class="icon-button" aria-label="上一个任务" title="上一个任务" :disabled="allTasks.length < 2" @click="taskIndex = (taskIndex + allTasks.length - 1) % allTasks.length"><ChevronLeft :size="17" /></button><button class="icon-button" aria-label="下一个任务" title="下一个任务" :disabled="allTasks.length < 2" @click="taskIndex = (taskIndex + 1) % allTasks.length"><ChevronRight :size="17" /></button></div></template>
  </aside>
  <dialog ref="previewDialog" class="background-preview" aria-label="生成结果预览" @close="clearPreview"><div class="dialog-heading"><h2>生成结果</h2><button class="icon-button" aria-label="关闭结果预览" @click="previewDialog?.close()"><X :size="20" /></button></div><div class="dialog-body stack"><p v-if="previewError" class="form-error" role="alert">{{ previewError }} <button v-if="previewTask" class="text-link" @click="preview(previewTask)">重试</button></p><p v-else-if="!files.length" role="status">正在读取生成结果…</p><div v-for="file in files" :key="file.url"><video v-if="file.type.startsWith('video/')" :src="file.url" controls playsinline /><img v-else :src="file.url" :alt="previewTask?.title || '生成结果'" /><a :href="file.url" :download="file.name" class="button subtle"><Download :size="16" />下载文件</a></div><button v-if="previewTask" class="button" @click="openTask(previewTask); previewDialog?.close()">打开工作台<ArrowUpRight :size="16" /></button></div></dialog>
</template>

<style scoped>
.studio-host { position: fixed; z-index: 10; background: var(--surface); }.studio-host :deep(.studio-stage) { height: 100%; min-height: 0; }
.studio-offscreen { left: -12000px !important; top: 0 !important; visibility: hidden; pointer-events: none; }
.background-dock { position: fixed; z-index: 45; right: 24px; bottom: 24px; width: min(320px, calc(100vw - 32px)); border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 12px 32px #1a263314; overflow: hidden; }
.background-dock.minimized { width: auto; }.dock-heading { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 4px 16px; border-bottom: 1px solid var(--border); touch-action: none; cursor: grab; }
.dock-content { display: flex; align-items: flex-start; gap: 12px; padding: 16px; }.dock-content > div { min-width: 0; }.dock-content p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; margin-top: 4px; }
.dock-message { margin: 0 16px 12px; font-size: 12px; max-height: 90px; overflow: auto; white-space: pre-wrap; }.dock-actions { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 12px 12px; }
.background-preview { width: min(960px, calc(100vw - 32px)); }.background-preview img, .background-preview video { display: block; width: 100%; max-height: 65svh; object-fit: contain; margin-bottom: 12px; }
@media (max-width: 999px) { .background-dock { right: 16px; bottom: calc(80px + env(safe-area-inset-bottom)); } }
</style>
