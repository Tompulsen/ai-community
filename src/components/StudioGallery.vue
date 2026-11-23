<!-- Layout and library interactions adapted from octopus_chat gallery/gallery.tsx (MIT). -->
<script setup lang="ts">
import { confirmStudioDelete } from '../studio-confirm'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { CopyPlus, Download, ImagePlus, Images, LoaderCircle, RefreshCw, Search, SlidersHorizontal, SquareMousePointer, Trash2, Upload, X } from '@lucide/vue'
import { canonicalCreationTask, copyCreationImage, creation, downloadCreation, hideGalleryOutputs, mediaSettings, mediaSource, prepareCreationHistory, removeCreationTasks, saveCreationLocally, updateMediaSettings, type CreationTask, type CreationDestination, type CreationKind } from '../native-studio'
import { errorMessage, session } from '../state'
import { galleryOutputIndexes, getTaskPage, getTaskStorageSize, getTaskSummary, type TaskPageQuery } from '../studio-task-store'
import StudioGalleryCover from './StudioGalleryCover.vue'
import StudioBrowserSave from './StudioBrowserSave.vue'
import StudioMediaPreview from './studio-message/StudioMediaPreview.vue'

const props = defineProps<{ kind?: string; embedded?: boolean; previewOnly?: boolean }>()
const emit = defineEmits<{ reuse: [task: CreationTask]; publish: [task: CreationTask, destination: CreationDestination]; create: [] }>()
const view = ref('gallery'), filter = ref('all'), query = ref(''), modelFilter = ref(''), timeFilter = ref('')
const batchMode = ref(false), selected = ref<string[]>([]), error = ref(''), busy = ref(false), loading = ref(false)
const rows = ref<CreationTask[]>([]), total = ref<number>(), modelOptions = ref<string[]>([]), storageBytes = ref<number>()
const after = ref<{ createdAt: number; id: string }>(), pageSize = 60
const exportProgress = ref<{ current: number; total: number }>()
const settingsId = `gallery-settings-${useId()}`, settingsButton = ref<HTMLButtonElement>(), settingsOpen = ref(false)
const preview = ref<{ task: CreationTask; indexes: number[] }>(), previewer = ref<InstanceType<typeof StudioMediaPreview>>()
const previewItems = computed(() => preview.value ? preview.value.indexes.map(index => ({
  src: mediaSource(preview.value!.task.urls[index]!, false, preview.value!.task.kind),
  kind: preview.value!.task.kind === 'video' ? 'video' as const : 'image' as const, alt: preview.value!.task.prompt,
})) : [])
let previewRevision = 0, revision = 0, summaryRevision = 0, operation = 0, preparing = false, refreshTimer: ReturnType<typeof setTimeout> | undefined
let downloadController: AbortController | undefined
let currentFilters: TaskPageQuery | undefined
const phases: Record<string, string> = { complete: '已完成', error: '失败', attention: '请求异常', submitting: '提交中', running: '进行中', paused: '已暂停' }
const visible = computed(() => rows.value.map(task => creation.tasks.find(current => current.id === task.id && current.owner === session.user?.id) || task))
type GalleryItem = { key: string; task: CreationTask; index: number }
const items = computed<GalleryItem[]>(() => visible.value.flatMap(task => view.value === 'gallery'
  ? galleryOutputIndexes(task).map(index => ({ key: `${task.id}:${index}`, task, index }))
  : [{ key: `${task.id}:task`, task, index: 0 }]))
const hasFilters = computed(() => !!(query.value.trim() || modelFilter.value || timeFilter.value || filter.value !== 'all'))
const storageLabel = computed(() => {
  const bytes = storageBytes.value
  if (bytes === undefined) return '—'
  return bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`
})
function since() {
  if (!timeFilter.value) return undefined
  if (timeFilter.value === 'today') { const day = new Date(); day.setHours(0, 0, 0, 0); return day.getTime() }
  const days: Record<string, number> = { week: 7, month: 30, year: 365 }
  return Date.now() - (days[timeFilter.value] || 0) * 86400000
}
function filters(): TaskPageQuery {
  const kind = props.kind && ['image', 'video', 'text'].includes(props.kind) ? props.kind as CreationKind
    : view.value === 'gallery' && ['image', 'video'].includes(filter.value) ? filter.value : undefined
  return { kind, ...(view.value === 'tasks' && filter.value !== 'all' ? { phase: filter.value } : {}),
    gallery: view.value === 'gallery', query: query.value.trim(), model: modelFilter.value || undefined, since: since() }
}
function cancelOperation() {
  operation++; downloadController?.abort(); downloadController = undefined
  busy.value = false; exportProgress.value = undefined
}
watch(() => session.user?.id, () => {
  revision++; previewRevision++; cancelOperation(); previewer.value?.close(); preview.value = undefined
  currentFilters = undefined
  batchMode.value = false; selected.value = []; rows.value = []; total.value = undefined; modelOptions.value = []; after.value = undefined; error.value = ''; storageBytes.value = undefined; loading.value = false
})
function loadSummary(owner: string, options: TaskPageQuery, accepted: number) {
  const request = ++summaryRevision
  const current = () => accepted === revision && request === summaryRevision && owner === session.user?.id
  void getTaskSummary(owner, options).then(summary => {
    if (current()) { total.value = options.gallery ? summary.mediaCount : summary.total; modelOptions.value = summary.models }
  }).catch(cause => { if (current()) error.value = errorMessage(cause) })
  void getTaskStorageSize(owner).then(bytes => { if (current()) storageBytes.value = bytes })
    .catch(cause => { if (current()) error.value = errorMessage(cause) })
}
async function loadPage(append = false, prepare = false) {
  const owner = session.user?.id
  if (!owner || props.previewOnly || append && (loading.value || !after.value)) return
  const accepted = append ? revision : ++revision, cursor = append ? after.value : undefined
  const options = append && currentFilters ? currentFilters : filters()
  if (!append) currentFilters = options
  loading.value = true; error.value = ''
  if (!append) total.value = undefined
  try {
    if (prepare) { preparing = true; try { await prepareCreationHistory() } finally { preparing = false } }
    if (accepted !== revision || owner !== session.user?.id) return
    const page = await getTaskPage(owner, { ...options, after: cursor, limit: pageSize, summary: false })
    if (accepted !== revision || owner !== session.user?.id) return
    const current = append ? [...rows.value] : [], known = new Set(current.map(task => task.id))
    rows.value = [...current, ...page.tasks.filter(task => !known.has(task.id))]
    after.value = page.after
    loadSummary(owner, options, accepted)
  } catch (cause) { if (accepted === revision && owner === session.user?.id) error.value = errorMessage(cause) }
  finally { if (accepted === revision) loading.value = false }
}
function scheduleRefresh(prepare = false) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => { void loadPage(false, prepare) }, 150)
}
watch([() => session.user?.id, () => props.kind, () => props.previewOnly], () => { void loadPage(false, true) }, { immediate: true })
watch([view, filter, query, modelFilter, timeFilter], () => { revision++; currentFilters = undefined; after.value = undefined; total.value = undefined; cancelOperation(); selected.value = []; batchMode.value = false; scheduleRefresh(true) })
watch(() => creation.historyRevision, () => { if (!preparing) scheduleRefresh() })
onBeforeUnmount(() => { revision++; cancelOperation(); clearTimeout(refreshTimer) })
async function run(action: (current: () => boolean) => Promise<unknown>) {
  if (busy.value) return
  const owner = session.user?.id, accepted = ++operation
  const current = () => accepted === operation && owner === session.user?.id
  busy.value = true; error.value = ''
  try { await action(current) }
  catch (cause) { if (current()) error.value = errorMessage(cause) }
  finally { if (current()) { busy.value = false; downloadController = undefined; exportProgress.value = undefined } }
}
async function allMatching(current: () => boolean) {
  const owner = session.user?.id, options = currentFilters || filters(), found: GalleryItem[] = []
  if (!owner) return found
  let cursor: TaskPageQuery['after']
  do {
    const page = await getTaskPage(owner, { ...options, after: cursor, limit: 200, summary: false })
    if (!current()) return []
    for (const task of page.tasks) {
      if (options.gallery) for (const index of galleryOutputIndexes(task)) found.push({ key: `${task.id}:${index}`, task, index })
      else found.push({ key: `${task.id}:task`, task, index: 0 })
    }
    cursor = page.after
  } while (cursor)
  return found
}
function toggle(key: string) { selected.value = selected.value.includes(key) ? selected.value.filter(value => value !== key) : [...selected.value, key] }
function clearFilters() { query.value = ''; modelFilter.value = ''; timeFilter.value = ''; filter.value = 'all' }
async function toggleSettings(event: Event) {
  settingsOpen.value = (event as ToggleEvent).newState === 'open'
  if (!settingsOpen.value) return
  const panel = event.target as HTMLElement
  const owner = session.user?.id, accepted = revision
  if (owner) void getTaskStorageSize(owner).then(bytes => { if (owner === session.user?.id && accepted === revision) storageBytes.value = bytes }).catch(() => {})
  await nextTick()
  const anchor = settingsButton.value?.getBoundingClientRect()
  if (!anchor) return
  const bounds = panel.getBoundingClientRect()
  panel.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 12))}px`
  panel.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, innerHeight - bounds.height - 12))}px`
}
async function selectAll() { await run(async current => { const found = await allMatching(current); if (current()) selected.value = found.map(item => item.key) }) }
async function removeItems(chosen: GalleryItem[], current: () => boolean) {
  if (!chosen.length || !current()) return
  if (view.value === 'gallery') {
    if (!await confirmStudioDelete(`从作品库移除 ${chosen.length} 件作品？会话中的生成记录和原文件会保留。`, current)) return
    await hideGalleryOutputs(chosen)
  } else {
    const removable = chosen.filter(item => ['complete', 'error'].includes(item.task.phase))
    if (!removable.length) throw new Error('所选任务仍在进行或需要核对，暂无可删除记录。')
    const kept = chosen.length - removable.length
    if (!await confirmStudioDelete(`删除 ${removable.length} 条任务记录？${kept ? `另外 ${kept} 条进行中或待核对的任务会保留。` : '此操作不会撤销上游生成。'}`, current)) return
    await removeCreationTasks([...new Set(removable.map(item => item.task.id))])
  }
  if (current()) { selected.value = []; batchMode.value = false; await loadPage() }
}
async function removeSelected() { await run(async current => { const found = await allMatching(current); await removeItems(found.filter(item => selected.value.includes(item.key)), current) }) }
async function exportItems(onlySelected = false) {
  await run(async current => {
    const found = await allMatching(current)
    if (!current()) return
    const picked = onlySelected ? found.filter(item => selected.value.includes(item.key)) : found
    const completed = picked.filter(item => item.task.phase === 'complete' && (item.task.urls.length || item.task.kind === 'text' && item.task.text.trim()))
    const chosen = view.value === 'gallery' ? picked : completed.flatMap(item => item.task.urls.length
      ? item.task.urls.map((_, index) => ({ ...item, index })) : [item])
    if (!chosen.length) throw new Error('所选记录没有可下载的已完成结果。')
    const controller = new AbortController()
    downloadController = controller; exportProgress.value = { current: 0, total: chosen.length }
    for (const [position, item] of chosen.entries()) {
      if (!current()) return
      await downloadCreation(canonicalCreationTask(item.task), item.index, controller.signal)
      if (!current()) return
      exportProgress.value = { current: position + 1, total: chosen.length }
    }
  })
}
async function clearFailed() {
  await run(async current => {
    const ids = creation.tasks.filter(task => task.owner === session.user?.id && task.phase === 'error').map(task => task.id)
    if (!ids.length) { error.value = '没有失败记录需要清理。'; return }
    if (!await confirmStudioDelete(`删除 ${ids.length} 条失败任务记录？进行中及待核对的任务会保留。`, current)) return
    await removeCreationTasks(ids)
    if (current()) await loadPage()
  })
}
async function open(task: CreationTask, index = 0, library = false) {
  const owner = session.user?.id, accepted = ++previewRevision, canonical = canonicalCreationTask(task)
  const indexes = library ? galleryOutputIndexes(canonical) : canonical.urls.map((_, position) => position)
  if (!indexes.includes(index)) return
  preview.value = { task: canonical, indexes }
  await nextTick()
  if (owner === session.user?.id && accepted === previewRevision) await previewer.value?.open(indexes.indexOf(index))
}
defineExpose({ open, cancelOperation })
async function downloadPreview(index: number) { if (preview.value) await downloadCreation(preview.value.task, preview.value.indexes[index]!) }
async function copyPreview(index: number) { if (preview.value) await copyCreationImage(preview.value.task, preview.value.indexes[index]!) }
function dimensions(task: CreationTask) {
  const size = task.request.size
  if (typeof size === 'string' && /^\d+x\d+$/.test(size)) return size.replace('x', ' × ')
  return task.request.aspect_ratio && task.request.aspect_ratio !== 'auto' ? task.request.aspect_ratio : ''
}
function publish(task: CreationTask, destination: CreationDestination) { emit('publish', canonicalCreationTask(task), destination) }
function reuse(task: CreationTask) { emit('reuse', canonicalCreationTask(task)) }
</script>

<template>
  <section v-if="!previewOnly" class="studio-gallery" :class="{ embedded }" aria-label="作品记录">
    <div class="gallery-controls">
      <div class="gallery-view-tabs" role="tablist" aria-label="作品库视图"><button type="button" class="gallery-tab" role="tab" :aria-selected="view === 'gallery'" @click="view = 'gallery'; filter = 'all'">作品</button><button type="button" class="gallery-tab" role="tab" :aria-selected="view === 'tasks'" @click="view = 'tasks'; filter = 'all'">任务</button></div>
      <div class="gallery-toolbar">
        <label class="gallery-search"><Search :size="17" aria-hidden="true" /><input class="control" type="search" v-model="query" aria-label="搜索生成记录" placeholder="搜索提示词或模型" /></label>
        <select v-model="filter" class="control" aria-label="筛选生成记录"><option value="all">{{ view === 'gallery' ? '全部作品' : '全部任务' }}</option><template v-if="view === 'gallery'"><option value="image">图片</option><option value="video">视频</option></template><template v-else><option v-for="(label, value) in phases" :key="value" :value="value">{{ label }}</option></template></select>
        <select v-model="modelFilter" class="control" aria-label="按模型筛选"><option value="">全部模型</option><option v-if="modelFilter && !modelOptions.includes(modelFilter)" :value="modelFilter">{{ modelFilter }}</option><option v-for="model in modelOptions" :key="model" :value="model">{{ model }}</option></select>
        <select v-model="timeFilter" class="control" aria-label="按时间筛选"><option value="">全部时间</option><option value="today">今天</option><option value="week">最近 7 天</option><option value="month">最近 30 天</option><option value="year">最近一年</option></select>
      </div>
      <div class="gallery-info-bar batch-toolbar">
        <div class="gallery-stats"><span>{{ total ?? '—' }} 条<span v-if="batchMode"> · 已选 {{ selected.length }}</span></span><span>本地缓存 {{ storageLabel }}</span></div>
        <div class="gallery-actions">
          <template v-if="batchMode"><button class="gallery-action" type="button" :disabled="busy" aria-label="全选筛选结果" @click="selectAll"><SquareMousePointer :size="15" />全选</button><button class="gallery-action" type="button" :disabled="busy || !selected.length" aria-label="下载选中记录" @click="exportItems(true)"><Download :size="15" /><span>下载 {{ selected.length || '' }}</span></button><button class="gallery-action danger" type="button" :disabled="busy || !selected.length" aria-label="删除选中记录" @click="removeSelected"><Trash2 :size="15" /><span>{{ view === 'gallery' ? '移除' : '删除' }}</span></button><button class="gallery-action" type="button" :disabled="busy" aria-label="取消选择" @click="batchMode = false; selected = []"><X :size="15" />取消</button></template>
          <template v-else><button class="gallery-action" type="button" :disabled="busy || !total" @click="batchMode = true"><SquareMousePointer :size="15" />批量选择</button><button class="gallery-action" type="button" :disabled="busy || !total" aria-label="导出全部筛选结果" @click="exportItems()"><Download :size="15" />导出全部</button></template>
          <button ref="settingsButton" class="gallery-settings-trigger" type="button" :popovertarget="settingsId" aria-label="作品库设置" title="作品库设置" aria-haspopup="dialog" :aria-expanded="settingsOpen"><SlidersHorizontal :size="18" /></button>
          <div :id="settingsId" popover="auto" role="dialog" aria-label="作品库设置" class="gallery-settings-content" @toggle="toggleSettings"><label><span>自动收录作品</span><input type="checkbox" role="switch" :checked="mediaSettings.autoSaveGallery" :disabled="!mediaSettings.loaded || busy" @change="run(() => updateMediaSettings({ autoSaveGallery: ($event.target as HTMLInputElement).checked }))" /></label><label><span>自动下载原文件</span><input type="checkbox" role="switch" :checked="mediaSettings.autoDownload" :disabled="!mediaSettings.loaded || busy" @change="run(() => updateMediaSettings(($event.target as HTMLInputElement).checked))" /></label><div class="gallery-location"><span>下载位置</span><span>浏览器默认</span></div><button class="gallery-action" type="button" :disabled="busy" @click="clearFailed"><Trash2 :size="15" />清理失败记录</button></div>
        </div>
      </div>
      <div v-if="batchMode" class="gallery-page-selection"><label><input type="checkbox" aria-label="选择当前页" :checked="items.length > 0 && items.every(item => selected.includes(item.key))" :disabled="busy" @change="selected = ($event.target as HTMLInputElement).checked ? [...new Set([...selected, ...items.map(item => item.key)])] : selected.filter(key => !items.some(item => item.key === key))" />选择当前页</label><span role="status">已选 {{ selected.length }} 件</span></div>
      <p v-if="error" class="gallery-error" role="alert">{{ error }}<button class="gallery-action" type="button" :disabled="busy || loading" @click="loadPage(false, true)">重试</button></p>
    </div>
    <div class="gallery-scroll" :aria-busy="loading">
      <p v-if="loading && !items.length" class="gallery-empty" role="status"><LoaderCircle :size="24" />正在读取作品记录…</p>
      <div v-else-if="!items.length" class="gallery-empty" role="status"><Images :size="32" /><p>{{ hasFilters ? '没有找到匹配的作品' : '还没有作品' }}</p><button v-if="hasFilters" type="button" class="gallery-action" @click="clearFilters"><X :size="15" />清除筛选</button><button v-else type="button" class="gallery-action" @click="emit('create')"><ImagePlus :size="15" />开始生图</button></div>
      <div v-else :class="view === 'gallery' ? 'gallery-grid' : 'task-list'">
        <article v-for="item in items" :key="item.key" class="gallery-item" :class="{ selected: selected.includes(item.key), selecting: batchMode }" @click="batchMode && !busy && toggle(item.key)">
          <label v-if="batchMode" class="card-select" @click.stop><input v-model="selected" type="checkbox" :value="item.key" :disabled="busy" :aria-label="`选择 ${item.task.prompt}${item.task.urls.length > 1 && view === 'gallery' ? ` · ${item.index + 1}` : ''}`" /></label>
          <StudioGalleryCover v-if="view === 'gallery'" :task="item.task" :index="item.index" :selecting="batchMode" :selected="selected.includes(item.key)" @open="!batchMode && open(item.task, item.index, true)" />
          <StudioBrowserSave :task="item.task" />
          <div class="card-info"><span v-if="view === 'tasks'" class="task-phase">{{ phases[item.task.phase] }}</span><p class="task-prompt" :title="item.task.prompt">{{ item.task.prompt }}</p><p class="task-model" :title="item.task.model">{{ item.task.model }}</p><div class="task-meta"><span>{{ dimensions(item.task) }}</span><span>{{ new Date(item.task.createdAt).toLocaleDateString('zh-CN') }} · 本地</span></div><p v-if="view === 'tasks' && item.task.error" class="form-error">{{ item.task.error }}</p></div>
          <div v-if="item.task.localSave" class="local-save-status" :class="{ failed: item.task.localSave.state === 'failed' }" role="status"><template v-if="item.task.localSave.state === 'saving'"><LoaderCircle :size="14" /><span>正在准备下载</span></template><span v-else-if="item.task.localSave.state === 'downloadRequested'">已发起下载</span><template v-else><span :title="item.task.localSave.error">原文件下载失败</span><button class="icon-button" type="button" aria-label="重试原文件下载" title="重试原文件下载" :disabled="busy" @click="run(() => saveCreationLocally(canonicalCreationTask(item.task)))"><RefreshCw :size="15" /></button></template></div>
          <div v-if="!batchMode" class="item-actions"><button v-if="item.task.phase === 'complete'" class="card-action" type="button" :aria-label="item.task.urls.length > 1 ? '发布本组到社区' : '发布到社区'" :title="item.task.urls.length > 1 ? '发布本组到社区' : '发布到社区'" @click="publish(item.task, 'community')"><Upload :size="16" /></button><button v-if="item.task.phase === 'complete'" class="card-action" type="button" title="下载" aria-label="下载此记录" :disabled="busy" @click="run(() => downloadCreation(canonicalCreationTask(item.task), item.index))"><Download :size="16" /></button><button class="card-action" type="button" title="复用参数" aria-label="复用参数" @click="reuse(item.task)"><CopyPlus :size="16" /></button><button v-if="view === 'gallery'" class="card-action danger" type="button" title="从作品库移除" aria-label="从作品库移除" :disabled="busy" @click="run(current => removeItems([item], current))"><Trash2 :size="16" /></button><button v-if="item.task.kind !== 'video' && item.task.sourceWorkId && item.task.phase === 'complete'" class="card-action" type="button" title="发送到源作品评论区" aria-label="发送到源作品评论区" @click="publish(item.task, 'source-comment')"><Upload :size="16" /></button></div>
        </article>
      </div>
      <button v-if="after" class="gallery-action gallery-more" type="button" :disabled="loading || busy" @click="loadPage(true)"><LoaderCircle v-if="loading" :size="15" />{{ loading ? '正在读取…' : '加载更多' }}</button>
    </div>
    <div v-if="exportProgress" class="gallery-export" role="status"><progress :value="exportProgress.current" :max="exportProgress.total" aria-label="作品导出进度" /><span>{{ exportProgress.current }} / {{ exportProgress.total }}</span><button class="gallery-action" type="button" @click="cancelOperation">停止下载</button></div>
  </section>
  <StudioMediaPreview ref="previewer" :items="previewItems" label="原始媒体预览" close-label="关闭媒体预览" :on-download="downloadPreview" :on-copy="copyPreview" @close="preview = undefined; previewRevision++" />
</template>

<style scoped>
.studio-gallery { display: flex; flex-direction: column; min-height: 0; min-width: 0; height: 100%; color: var(--ink); }
.gallery-controls { flex: none; padding: 0 24px 16px; }.gallery-view-tabs { display: flex; gap: 4px; margin-bottom: 16px; }
.gallery-tab { min-height: 32px; padding: 6px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; }.gallery-tab:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }.gallery-tab[aria-selected="true"] { color: var(--ink); background: var(--state-selected); }.gallery-tab[aria-selected="true"]:hover:not(:disabled) { background: var(--state-pressed); }
.gallery-toolbar { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(100px, 120px) minmax(120px, 180px) minmax(110px, 140px); gap: 12px; align-items: center; }
.gallery-toolbar .control { width: 100%; min-width: 0; height: 38px; border: 0; border-radius: 8px; font-size: 13px; }
.gallery-toolbar select.control { height: auto; font-size: var(--control-font-size, var(--font-size-input)); }
.gallery-search { display: flex; align-items: center; position: relative; min-width: 0; color: var(--muted); }.gallery-search > svg { position: absolute; left: 12px; pointer-events: none; }.gallery-search input { padding-left: 38px; }
.gallery-info-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding-top: 12px; }
.gallery-stats, .gallery-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }.gallery-stats { font-size: 12px; color: var(--muted); }.gallery-actions { gap: 6px; }
.gallery-action { display: inline-flex; justify-content: center; align-items: center; gap: 6px; min-height: 32px; max-width: 100%; border: 0; border-radius: 6px; padding: 5px 9px; font: inherit; font-size: 12px; color: var(--ink); background: var(--surface); cursor: pointer; }.gallery-action svg { flex: none; }.gallery-action:disabled, .card-action:disabled { opacity: .4; cursor: default; }
.gallery-action:hover:not(:disabled), .card-action:hover:not(:disabled), .gallery-settings-trigger:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }.danger:hover:not(:disabled) { color: var(--danger, #b64646); }
.gallery-settings-trigger { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--ink); cursor: pointer; }
.gallery-settings-trigger[aria-expanded="true"] { background: var(--state-selected); }
.gallery-settings-trigger[aria-expanded="true"]:hover:not(:disabled) { background: var(--state-pressed); }
.gallery-settings-content { position: fixed; inset: auto; margin: 0; width: min(300px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow-y: auto; box-sizing: border-box; padding: 16px; border: 0; border-radius: 8px; color: var(--ink); background: var(--popover-surface); box-shadow: var(--popover-shadow); }
.gallery-settings-content > label, .gallery-location { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 44px; font-size: 13px; }.gallery-location { color: var(--muted); font-size: 12px; }.gallery-settings-content input { width: 16px; height: 16px; accent-color: var(--ink); }
.gallery-page-selection { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding-top: 12px; font-size: 12px; color: var(--muted); }.gallery-page-selection label { display: flex; align-items: center; gap: 8px; }
.gallery-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-color: var(--border) transparent; padding: 4px 24px 24px; }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 20px 16px; align-content: start; }
.gallery-item { position: relative; display: flex; flex-direction: column; min-width: 0; border-radius: 8px; background: var(--surface); overflow: hidden; }
.gallery-item.selected { color: var(--ink); background: var(--state-selected); outline: 2px solid var(--state-selected-border); outline-offset: -2px; }.gallery-item.selecting { cursor: pointer; }.gallery-item.selecting:hover:not(.selected):not(:has(:disabled)) { color: var(--ink); background: var(--state-hover); }.gallery-item.selected.selecting:hover:not(:has(:disabled)) { background: var(--state-pressed); }.card-select { position: absolute; z-index: 2; top: 8px; left: 8px; padding: 4px; border-radius: 4px; background: var(--surface); display: flex; }.card-select input { width: 18px; height: 18px; margin: 0; accent-color: var(--ink); }
.card-info { min-width: 0; padding: 10px 12px; }.task-prompt { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; height: 38px; font-size: 12px; line-height: 19px; margin: 0 0 6px; overflow-wrap: anywhere; }
.task-model { margin: 0 0 6px; font-size: 11px; line-height: 18px; height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); }
.task-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 8px; min-width: 0; color: var(--muted); font-size: 11px; line-height: 18px; font-variant-numeric: tabular-nums; }.task-meta > span { min-width: 0; overflow-wrap: anywhere; }
.item-actions { display: flex; margin-top: auto; gap: 4px; padding: 0 12px 10px; }.card-action { display: grid; place-items: center; flex: 1; min-width: 0; min-height: 32px; padding: 5px 0; border: 0; border-radius: 6px; background: transparent; color: var(--ink); cursor: pointer; }
.local-save-status { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 12px 8px; font-size: 11px; color: var(--muted); }.local-save-status.failed { color: var(--amber); }.local-save-status .icon-button { width: 28px; min-height: 28px; }
.task-list { display: grid; gap: 12px; }.task-list .gallery-item { padding-top: 8px; }.task-list .task-prompt { height: auto; }.task-list .card-info { padding-top: 4px; }.task-phase { color: var(--muted); font-size: 12px; }.task-list .card-select { position: static; width: fit-content; margin-left: 12px; }.task-list .item-actions { width: min(300px, 100%); }
.gallery-item:is(.selected, .selecting:hover:not(:has(:disabled))) :is(.task-model, .task-meta, .task-phase, .local-save-status:not(.failed)) { color: var(--ink); }
.gallery-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 240px; margin: 0; color: var(--muted); font-size: 14px; text-align: center; }.gallery-empty p { margin: 0; }.gallery-more { display: flex; margin: 20px auto 0; }
.gallery-error { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--danger, #b64646); font-size: 13px; overflow-wrap: anywhere; margin: 12px 0 0; }
.gallery-export { display: flex; flex: none; justify-content: center; align-items: center; gap: 12px; padding: 8px 16px; font-size: 12px; font-variant-numeric: tabular-nums; }.gallery-export progress { width: min(160px, 30%); height: 6px; accent-color: var(--ink); }
.studio-gallery :is(button, input, select, summary):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
@media (max-width: 800px) { .gallery-toolbar { grid-template-columns: repeat(3, minmax(0, 1fr)); }.gallery-search { grid-column: 1 / -1; } }
@media (max-width: 600px) { .gallery-controls { padding: 0 16px 12px; }.gallery-view-tabs { margin-bottom: 12px; }.gallery-toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.gallery-toolbar .control { min-height: 40px; font-size: 13px; }.gallery-search input.control { font-size: 16px; }.gallery-info-bar { align-items: flex-start; flex-direction: column; gap: 8px; }.gallery-actions { width: 100%; justify-content: flex-end; gap: 4px; }.gallery-action { min-height: 44px; padding-inline: 8px; }.gallery-settings-trigger { width: 44px; height: 44px; }.gallery-scroll { padding: 4px 16px 16px; }.gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 10px; }.card-info { padding: 10px 8px; }.item-actions { padding: 0 4px 6px; gap: 0; }.card-action { min-height: 44px; }.local-save-status { padding-inline: 8px; } }
</style>
