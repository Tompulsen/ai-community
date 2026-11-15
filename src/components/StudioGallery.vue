<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Download, LoaderCircle, Minus, Plus, RefreshCw, RotateCcw, Trash2, Upload, X } from '@lucide/vue'
import { canonicalCreationTask, creation, downloadCreation, mediaSettings, mediaSource, prepareCreationHistory, removeCreationTasks, resumeCreation, saveCreationLocally, updateMediaSettings, type CreationTask, type CreationDestination, type CreationKind } from '../native-studio'
import { errorMessage, session } from '../state'
import { getTaskPage } from '../studio-task-store'
import StudioGalleryCover from './StudioGalleryCover.vue'
const props = defineProps<{ kind?: string; embedded?: boolean; previewOnly?: boolean }>()
const emit = defineEmits<{ reuse: [task: CreationTask]; publish: [task: CreationTask, destination: CreationDestination] }>()
const view = ref('gallery'), filter = ref('all'), query = ref(''), modelFilter = ref(''), timeFilter = ref('')
const selected = ref<string[]>([]), error = ref(''), busy = ref(false), loading = ref(false)
const rows = ref<CreationTask[]>([]), total = ref(0), modelOptions = ref<string[]>([])
const after = ref<{ createdAt: number; id: string }>(), pageSize = 60
const preview = ref<{ task: CreationTask; index: number }>(), dialog = ref<HTMLDialogElement>(), scale = ref(1), offset = ref({ x: 0, y: 0 })
let dragging: { x: number; y: number; left: number; top: number } | undefined
let revision = 0, refreshTimer: ReturnType<typeof setTimeout> | undefined, preparing = false
watch(() => session.user?.id, () => { revision++; dialog.value?.close(); preview.value = undefined; selected.value = []; rows.value = []; total.value = 0; after.value = undefined; error.value = ''; busy.value = false })
const phases: Record<string, string> = { complete: '已完成', error: '失败', attention: '需要核对', submitting: '提交中', running: '进行中', paused: '已暂停' }
const visible = computed(() => rows.value.map(task => creation.tasks.find(current => current.id === task.id && current.owner === session.user?.id) || task))
function since() {
  if (!timeFilter.value) return undefined
  if (timeFilter.value === 'today') { const day = new Date(); day.setHours(0, 0, 0, 0); return day.getTime() }
  const days: Record<string, number> = { week: 7, month: 30, year: 365 }
  return Date.now() - (days[timeFilter.value] || 0) * 86400000
}
async function loadPage(append = false, prepare = false) {
  const owner = session.user?.id
  if (!owner || props.previewOnly || append && (loading.value || !after.value)) return
  const accepted = append ? revision : ++revision, cursor = append ? after.value : undefined
  loading.value = true; error.value = ''
  try {
    if (prepare) { preparing = true; try { await prepareCreationHistory() } finally { preparing = false } }
    if (accepted !== revision || owner !== session.user?.id) return
    const kind = props.kind && ['image', 'video', 'text'].includes(props.kind) ? props.kind as CreationKind
      : view.value === 'gallery' && ['image', 'video'].includes(filter.value) ? filter.value as CreationKind : undefined
    const page = await getTaskPage(owner, { kind, ...(view.value === 'tasks' && filter.value !== 'all' ? { phase: filter.value as CreationTask['phase'] } : {}),
      gallery: view.value === 'gallery', query: query.value.trim(), model: modelFilter.value || undefined, since: since(), after: cursor, limit: pageSize })
    if (accepted !== revision || owner !== session.user?.id) return
    const current = append ? [...rows.value] : [], known = new Set(current.map(task => task.id))
    rows.value = [...current, ...page.tasks.filter(task => !known.has(task.id))]
    after.value = page.after; total.value = page.total; modelOptions.value = page.models
    selected.value = selected.value.filter(id => rows.value.some(task => task.id === id))
  } catch (cause) { if (accepted === revision && owner === session.user?.id) error.value = errorMessage(cause) }
  finally { if (accepted === revision) loading.value = false }
}
function scheduleRefresh(prepare = false) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => { void loadPage(false, prepare) }, 150)
}
watch([() => session.user?.id, () => props.kind, () => props.previewOnly], () => { void loadPage(false, true) }, { immediate: true })
watch([view, filter, query, modelFilter, timeFilter], () => { selected.value = []; scheduleRefresh(true) })
watch(() => creation.historyRevision, () => { if (!preparing) scheduleRefresh() })
onBeforeUnmount(() => { revision++; clearTimeout(refreshTimer) })
async function run(action: () => Promise<unknown>) {
  if (busy.value) return
  const owner = session.user?.id
  busy.value = true; error.value = ''
  try { await action() }
  catch (cause) { if (owner === session.user?.id) error.value = errorMessage(cause) }
  finally { if (owner === session.user?.id) busy.value = false }
}
function open(task: CreationTask, index = 0) { preview.value = { task: canonicalCreationTask(task), index }; reset(); dialog.value?.showModal() }
defineExpose({ open })
function reset() { scale.value = 1; offset.value = { x: 0, y: 0 } }
function zoom(value: number) { scale.value = Math.min(5, Math.max(0.25, value)) }
function startPan(event: PointerEvent) { if (event.button !== 0 || scale.value <= 1) return; dragging = { x: event.clientX, y: event.clientY, left: offset.value.x, top: offset.value.y }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }
function pan(event: PointerEvent) { if (dragging) offset.value = { x: dragging.left + event.clientX - dragging.x, y: dragging.top + event.clientY - dragging.y } }
async function removeSelected() {
  if (!selected.value.length || !confirm(`删除 ${selected.value.length} 条本地记录？此操作不撤销上游任务，也不会删除社区作品。`)) return
  await run(async () => { await removeCreationTasks(selected.value); selected.value = []; await loadPage() })
}
async function downloadSelected() { await run(async () => { for (const task of visible.value.filter(item => selected.value.includes(item.id))) for (let index = 0; index < Math.max(1, task.urls.length); index++) await downloadCreation(canonicalCreationTask(task), index) }) }
function publish(task: CreationTask, destination: CreationDestination) { emit('publish', canonicalCreationTask(task), destination) }
function reuse(task: CreationTask) { emit('reuse', canonicalCreationTask(task)) }
</script>
<template>
  <details v-if="!previewOnly" class="studio-gallery" :class="{ embedded }" :open="embedded">
    <summary v-show="!embedded">图库与任务管理</summary>
    <div class="gallery-toolbar">
      <div class="tabs"><button class="tab" :class="{ active: view === 'gallery' }" type="button" @click="view = 'gallery'; filter = 'all'">图库</button><button class="tab" :class="{ active: view === 'tasks' }" type="button" @click="view = 'tasks'; filter = 'all'">任务</button></div>
      <input v-model="query" class="control gallery-search" type="search" aria-label="搜索生成记录" placeholder="搜索提示词或模型" />
      <select v-model="filter" class="control" aria-label="筛选生成记录"><option value="all">全部</option><template v-if="view === 'gallery'"><option value="image">图片</option><option value="video">视频</option></template><template v-else><option v-for="(label, value) in phases" :key="value" :value="value">{{ label }}</option></template></select>
      <select v-model="modelFilter" class="control" aria-label="按模型筛选"><option value="">全部模型</option><option v-if="modelFilter && !modelOptions.includes(modelFilter)" :value="modelFilter">{{ modelFilter }}</option><option v-for="model in modelOptions" :key="model" :value="model">{{ model }}</option></select>
      <select v-model="timeFilter" class="control" aria-label="按时间筛选"><option value="">全部时间</option><option value="today">今天</option><option value="week">最近 7 天</option><option value="month">最近 30 天</option><option value="year">最近一年</option></select>
    </div>
    <div class="gallery-preferences"><label><input type="checkbox" role="switch" :checked="mediaSettings.autoDownload" :disabled="!mediaSettings.loaded || busy" @change="run(() => updateMediaSettings(($event.target as HTMLInputElement).checked))" />自动下载原文件</label></div>
    <div class="batch-toolbar"><label><input type="checkbox" :checked="visible.length > 0 && visible.every(item => selected.includes(item.id))" @change="selected = ($event.target as HTMLInputElement).checked ? visible.map(item => item.id) : []" />选择当前页</label><span>{{ total }} 条 · 已选 {{ selected.length }}</span><button class="icon-button" type="button" title="下载选中记录" aria-label="下载选中记录" :disabled="busy || !selected.length" @click="downloadSelected"><Download :size="16" /></button><button class="icon-button" type="button" title="删除选中记录" aria-label="删除选中记录" :disabled="busy || !selected.length" @click="removeSelected"><Trash2 :size="16" /></button></div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="loading && !visible.length" class="gallery-loading" role="status"><LoaderCircle :size="16" />正在读取作品记录…</p>
    <p v-else-if="!visible.length" class="muted">暂无符合条件的记录</p>
    <div :class="view === 'gallery' ? 'gallery-grid' : 'task-list'" :aria-busy="loading">
      <article v-for="task in visible" :key="task.id" class="gallery-item">
        <div class="item-heading"><input v-model="selected" type="checkbox" :value="task.id" :aria-label="`选择 ${task.prompt}`" /><span>{{ phases[task.phase] }}</span></div>
        <StudioGalleryCover v-if="view === 'gallery' && task.urls.length" :task="task" @open="open(task)" />
        <p class="task-prompt">{{ task.prompt }}</p><p class="task-meta">{{ task.model }} · {{ new Date(task.createdAt).toLocaleString('zh-CN') }}</p>
        <p v-if="view === 'tasks' && task.error" class="form-error">{{ task.error }}</p>
        <div v-if="task.localSave" class="local-save-status" :class="{ failed: task.localSave.state === 'failed' }" role="status"><template v-if="task.localSave.state === 'saving'"><LoaderCircle :size="14" /><span>正在准备下载</span></template><span v-else-if="task.localSave.state === 'downloadRequested'">已发起下载</span><template v-else><span :title="task.localSave.error">原文件下载失败</span><button class="icon-button" type="button" aria-label="重试原文件下载" title="重试原文件下载" :disabled="busy" @click="run(() => saveCreationLocally(canonicalCreationTask(task)))"><RefreshCw :size="15" /></button></template></div>
        <div class="item-actions"><template v-if="task.phase === 'complete'"><button class="button subtle btn" type="button" @click="publish(task, 'community')"><Upload :size="14" />发布到社区</button><button v-if="task.kind !== 'video' && task.sourceWorkId" class="button subtle btn" type="button" @click="publish(task, 'source-comment')">发送到源作品评论区</button></template><button class="button subtle btn" type="button" @click="reuse(task)"><RotateCcw :size="14" />复用参数</button><button v-if="task.phase === 'complete'" class="icon-button" type="button" title="下载" aria-label="下载此记录" @click="run(() => downloadCreation(canonicalCreationTask(task)))"><Download :size="16" /></button><button v-if="['paused', 'attention'].includes(task.phase)" class="icon-button" type="button" title="查询结果" aria-label="查询此任务" @click="run(() => resumeCreation(canonicalCreationTask(task)))"><RefreshCw :size="16" /></button></div>
      </article>
    </div>
    <button v-if="after" class="button subtle btn gallery-more" type="button" :disabled="loading" @click="loadPage(true)"><LoaderCircle v-if="loading" :size="15" />{{ loading ? '正在读取…' : '加载更多' }}</button>
  </details>
    <Teleport to="body"><dialog ref="dialog" class="media-lightbox" aria-label="原始媒体预览" @close="preview = undefined" @click="($event.target === dialog) && dialog?.close()">
      <template v-if="preview"><header><span>{{ preview.task.model }}</span><div><button class="icon-button" aria-label="缩小" title="缩小" @click="zoom(scale - 0.25)"><Minus :size="18" /></button><output>{{ Math.round(scale * 100) }}%</output><button class="icon-button" aria-label="放大" title="放大" @click="zoom(scale + 0.25)"><Plus :size="18" /></button><button class="icon-button" aria-label="重置缩放" title="重置缩放" @click="reset"><RotateCcw :size="18" /></button><button class="icon-button" aria-label="关闭媒体预览" title="关闭" @click="dialog?.close()"><X :size="20" /></button></div></header><div class="lightbox-stage" @pointerdown="startPan" @pointermove="pan" @pointerup="dragging = undefined" @pointercancel="dragging = undefined" @wheel.prevent="zoom(scale + ($event.deltaY < 0 ? 0.1 : -0.1))"><img v-if="preview.task.kind === 'image'" draggable="false" :src="mediaSource(preview.task.urls[preview.index]!)" :alt="preview.task.prompt" :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }" /><video v-else controls playsinline :src="mediaSource(preview.task.urls[preview.index]!, false, 'video')" /></div><footer><select v-if="preview.task.urls.length > 1" v-model.number="preview.index" class="control" aria-label="预览图片序号" @change="reset"><option v-for="(_, index) in preview.task.urls" :key="index" :value="index">第 {{ index + 1 }} 张</option></select><p>{{ preview.task.prompt }}</p><button class="button subtle btn" @click="run(() => downloadCreation(preview!.task, preview!.index))"><Download :size="16" />下载原文件</button></footer></template>
    </dialog></Teleport>
</template>
<style scoped>
.studio-gallery { border-top: 1px solid var(--border); padding-block: 24px; margin-top: 24px; }
.studio-gallery.embedded { border: 0; padding: 0; margin: 0; }
.embedded .gallery-toolbar { margin-top: 0; }
summary { cursor: pointer; font-size: 16px; font-weight: 600; }
.gallery-toolbar, .batch-toolbar, .item-actions, .item-heading { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.gallery-toolbar { margin-top: 24px; }.gallery-search { flex: 1; min-width: 160px; }.gallery-toolbar select { width: auto; }
.gallery-toolbar select { max-width: 100%; min-width: 0; }.gallery-preferences { display: flex; justify-content: flex-end; margin-top: 12px; color: var(--muted); font-size: 13px; }.gallery-preferences label { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.gallery-loading, .local-save-status { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }.local-save-status { min-height: 28px; margin-block: 0 8px; }.local-save-status.failed { color: var(--amber); }.local-save-status .icon-button { width: 28px; min-height: 28px; }.gallery-more { margin-top: 16px; }
.batch-toolbar { margin-block: 16px; font-size: 12px; color: var(--muted); }.batch-toolbar label { display: flex; align-items: center; gap: 8px; }.batch-toolbar > span { margin-right: auto; }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr)); gap: 16px; }.gallery-item { min-width: 0; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
.item-heading, .task-meta { color: var(--muted); font-size: 12px; }.task-prompt { margin-block: 12px 4px; font-size: 14px; overflow-wrap: anywhere; }.task-meta { margin-block: 0 12px; overflow-wrap: anywhere; }.task-list { display: grid; gap: 16px; }
.media-lightbox { width: min(1200px, 96vw); max-width: 96vw; max-height: 94dvh; padding: 16px; background: var(--canvas); color: var(--ink); border: 1px solid var(--border); border-radius: 6px; }
.media-lightbox::backdrop { background: rgb(0 0 0 / 80%); }.media-lightbox header, .media-lightbox header > div, .media-lightbox footer { display: flex; align-items: center; gap: 12px; }.media-lightbox header { justify-content: space-between; }.media-lightbox output { min-width: 40px; font-size: 12px; text-align: center; }
.lightbox-stage { overflow: hidden; height: 65dvh; display: flex; justify-content: center; align-items: center; touch-action: none; margin-block: 16px; }.lightbox-stage img, .lightbox-stage video { max-width: 100%; max-height: 100%; object-fit: contain; }.media-lightbox footer { flex-wrap: wrap; }.media-lightbox footer p { flex: 1; min-width: 160px; overflow-wrap: anywhere; font-size: 14px; }.media-lightbox footer select { width: auto; }
</style>
