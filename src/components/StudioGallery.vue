<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, Maximize, Minus, Plus, RefreshCw, RotateCcw, Trash2, Upload, X } from '@lucide/vue'
import { creation, downloadCreation, mediaSource, removeCreationTasks, resumeCreation, type CreationTask, type CreationDestination } from '../native-studio'
import { errorMessage, session } from '../state'
const props = defineProps<{ kind?: string; embedded?: boolean }>()
const emit = defineEmits<{ reuse: [task: CreationTask]; publish: [task: CreationTask, destination: CreationDestination] }>()
const view = ref('gallery'), filter = ref('all'), query = ref(''), limit = ref(60), selected = ref<string[]>([]), error = ref(''), busy = ref(false)
const preview = ref<{ task: CreationTask; index: number }>(), dialog = ref<HTMLDialogElement>(), scale = ref(1), offset = ref({ x: 0, y: 0 })
let dragging: { x: number; y: number; left: number; top: number } | undefined
watch(() => session.user?.id, () => { dialog.value?.close(); preview.value = undefined; selected.value = []; error.value = '' })
const phases: Record<string, string> = { complete: '已完成', error: '失败', attention: '需要核对', submitting: '提交中', running: '进行中', paused: '已暂停' }
const items = computed(() => creation.tasks.filter(task => (!props.kind || task.kind === props.kind) && (view.value === 'tasks' || task.kind !== 'text' && task.phase === 'complete')
  && (filter.value === 'all' || task.phase === filter.value || task.kind === filter.value)
  && `${task.prompt} ${task.model}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const visible = computed(() => items.value.slice(0, limit.value))
async function run(action: () => Promise<unknown>) { if (busy.value) return; busy.value = true; error.value = ''; try { await action() } catch (cause) { error.value = errorMessage(cause) } finally { busy.value = false } }
function open(task: CreationTask, index = 0) { preview.value = { task, index }; reset(); dialog.value?.showModal() }
defineExpose({ open })
function reset() { scale.value = 1; offset.value = { x: 0, y: 0 } }
function zoom(value: number) { scale.value = Math.min(5, Math.max(0.25, value)) }
function startPan(event: PointerEvent) { if (event.button !== 0 || scale.value <= 1) return; dragging = { x: event.clientX, y: event.clientY, left: offset.value.x, top: offset.value.y }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }
function pan(event: PointerEvent) { if (dragging) offset.value = { x: dragging.left + event.clientX - dragging.x, y: dragging.top + event.clientY - dragging.y } }
async function removeSelected() {
  if (!selected.value.length || !confirm(`删除 ${selected.value.length} 条本地记录？此操作不撤销上游任务，也不会删除社区作品。`)) return
  await run(async () => { await removeCreationTasks(selected.value); selected.value = [] })
}
async function downloadSelected() { await run(async () => { for (const task of items.value.filter(item => selected.value.includes(item.id))) for (let index = 0; index < Math.max(1, task.urls.length); index++) await downloadCreation(task, index) }) }
</script>
<template>
  <details class="studio-gallery" :class="{ embedded }" :open="embedded">
    <summary v-show="!embedded">图库与任务管理</summary>
    <div class="gallery-toolbar">
      <div class="tabs"><button class="tab" :class="{ active: view === 'gallery' }" type="button" @click="view = 'gallery'; filter = 'all'">图库</button><button class="tab" :class="{ active: view === 'tasks' }" type="button" @click="view = 'tasks'; filter = 'all'">任务</button></div>
      <input v-model="query" class="control gallery-search" type="search" aria-label="搜索生成记录" placeholder="搜索提示词或模型" />
      <select v-model="filter" class="control" aria-label="筛选生成记录"><option value="all">全部</option><template v-if="view === 'gallery'"><option value="image">图片</option><option value="video">视频</option></template><template v-else><option v-for="(label, value) in phases" :key="value" :value="value">{{ label }}</option></template></select>
    </div>
    <div class="batch-toolbar"><label><input type="checkbox" :checked="visible.length > 0 && visible.every(item => selected.includes(item.id))" @change="selected = ($event.target as HTMLInputElement).checked ? visible.map(item => item.id) : []" />选择当前页</label><span>{{ items.length }} 条 · 已选 {{ selected.length }}</span><button class="icon-button" type="button" title="下载选中记录" aria-label="下载选中记录" :disabled="busy || !selected.length" @click="downloadSelected"><Download :size="16" /></button><button class="icon-button" type="button" title="删除选中记录" aria-label="删除选中记录" :disabled="busy || !selected.length" @click="removeSelected"><Trash2 :size="16" /></button></div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="!visible.length" class="muted">暂无符合条件的记录</p>
    <div :class="view === 'gallery' ? 'gallery-grid' : 'task-list'">
      <article v-for="task in visible" :key="task.id" class="gallery-item">
        <div class="item-heading"><input v-model="selected" type="checkbox" :value="task.id" :aria-label="`选择 ${task.prompt}`" /><span>{{ phases[task.phase] }}</span></div>
        <button v-if="view === 'gallery'" class="gallery-cover" type="button" :aria-label="`预览 ${task.prompt}`" @click="open(task)"><img v-if="task.kind === 'image'" :src="mediaSource(task.urls[0]!, true)" :alt="task.prompt" loading="lazy" /><video v-else :src="mediaSource(task.urls[0]!, false, 'video')" preload="metadata" muted /><Maximize :size="16" /></button>
        <p class="task-prompt">{{ task.prompt }}</p><p class="task-meta">{{ task.model }} · {{ new Date(task.createdAt).toLocaleString('zh-CN') }}</p>
        <p v-if="view === 'tasks' && task.error" class="form-error">{{ task.error }}</p>
        <div class="item-actions"><template v-if="task.phase === 'complete'"><button class="button subtle btn" type="button" @click="emit('publish', task, 'community')"><Upload :size="14" />发布到社区</button><button v-if="task.kind !== 'video' && task.sourceWorkId" class="button subtle btn" type="button" @click="emit('publish', task, 'source-comment')">发送到源作品评论区</button></template><button class="button subtle btn" type="button" @click="emit('reuse', task)"><RotateCcw :size="14" />复用参数</button><button v-if="task.phase === 'complete'" class="icon-button" type="button" title="下载" aria-label="下载此记录" @click="run(() => downloadCreation(task))"><Download :size="16" /></button><button v-if="['paused', 'attention'].includes(task.phase)" class="icon-button" type="button" title="查询结果" aria-label="查询此任务" @click="run(() => resumeCreation(task))"><RefreshCw :size="16" /></button></div>
      </article>
    </div>
    <button v-if="items.length > limit" class="button subtle btn" type="button" @click="limit += 60">加载更多</button>
    <Teleport to="body"><dialog ref="dialog" class="media-lightbox" aria-label="原始媒体预览" @close="preview = undefined" @click="($event.target === dialog) && dialog?.close()">
      <template v-if="preview"><header><span>{{ preview.task.model }}</span><div><button class="icon-button" aria-label="缩小" title="缩小" @click="zoom(scale - 0.25)"><Minus :size="18" /></button><output>{{ Math.round(scale * 100) }}%</output><button class="icon-button" aria-label="放大" title="放大" @click="zoom(scale + 0.25)"><Plus :size="18" /></button><button class="icon-button" aria-label="重置缩放" title="重置缩放" @click="reset"><RotateCcw :size="18" /></button><button class="icon-button" aria-label="关闭媒体预览" title="关闭" @click="dialog?.close()"><X :size="20" /></button></div></header><div class="lightbox-stage" @pointerdown="startPan" @pointermove="pan" @pointerup="dragging = undefined" @pointercancel="dragging = undefined" @wheel.prevent="zoom(scale + ($event.deltaY < 0 ? 0.1 : -0.1))"><img v-if="preview.task.kind === 'image'" draggable="false" :src="mediaSource(preview.task.urls[preview.index]!)" :alt="preview.task.prompt" :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }" /><video v-else controls playsinline :src="mediaSource(preview.task.urls[preview.index]!, false, 'video')" /></div><footer><select v-if="preview.task.urls.length > 1" v-model.number="preview.index" class="control" aria-label="预览图片序号" @change="reset"><option v-for="(_, index) in preview.task.urls" :key="index" :value="index">第 {{ index + 1 }} 张</option></select><p>{{ preview.task.prompt }}</p><button class="button subtle btn" @click="run(() => downloadCreation(preview!.task, preview!.index))"><Download :size="16" />下载原文件</button></footer></template>
    </dialog></Teleport>
  </details>
</template>
<style scoped>
.studio-gallery { border-top: 1px solid var(--border); padding-block: 24px; margin-top: 24px; }
.studio-gallery.embedded { border: 0; padding: 0; margin: 0; }
.embedded .gallery-toolbar { margin-top: 0; }
summary { cursor: pointer; font-size: 16px; font-weight: 600; }
.gallery-toolbar, .batch-toolbar, .item-actions, .item-heading { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.gallery-toolbar { margin-top: 24px; }.gallery-search { flex: 1; min-width: 160px; }.gallery-toolbar select { width: auto; }
.batch-toolbar { margin-block: 16px; font-size: 12px; color: var(--muted); }.batch-toolbar label { display: flex; align-items: center; gap: 8px; }.batch-toolbar > span { margin-right: auto; }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr)); gap: 16px; }.gallery-item { min-width: 0; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
.gallery-cover { padding: 0; border: 0; display: block; position: relative; width: 100%; aspect-ratio: 1; background: var(--surface); margin-top: 8px; overflow: hidden; cursor: zoom-in; border-radius: 6px; }
.gallery-cover img, .gallery-cover video { width: 100%; height: 100%; object-fit: cover; }.gallery-cover svg { position: absolute; bottom: 8px; right: 8px; background: var(--canvas); }
.item-heading, .task-meta { color: var(--muted); font-size: 12px; }.task-prompt { margin-block: 12px 4px; font-size: 14px; overflow-wrap: anywhere; }.task-meta { margin-block: 0 12px; overflow-wrap: anywhere; }.task-list { display: grid; gap: 16px; }
.media-lightbox { width: min(1200px, 96vw); max-width: 96vw; max-height: 94dvh; padding: 16px; background: var(--canvas); color: var(--ink); border: 1px solid var(--border); border-radius: 6px; }
.media-lightbox::backdrop { background: rgb(0 0 0 / 80%); }.media-lightbox header, .media-lightbox header > div, .media-lightbox footer { display: flex; align-items: center; gap: 12px; }.media-lightbox header { justify-content: space-between; }.media-lightbox output { min-width: 40px; font-size: 12px; text-align: center; }
.lightbox-stage { overflow: hidden; height: 65dvh; display: flex; justify-content: center; align-items: center; touch-action: none; margin-block: 16px; }.lightbox-stage img, .lightbox-stage video { max-width: 100%; max-height: 100%; object-fit: contain; }.media-lightbox footer { flex-wrap: wrap; }.media-lightbox footer p { flex: 1; min-width: 160px; overflow-wrap: anywhere; font-size: 14px; }.media-lightbox footer select { width: auto; }
</style>
