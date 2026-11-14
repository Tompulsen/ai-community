<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { ArrowUp, Check, Clock, Copy, Download, History, Images, LoaderCircle, Maximize, Pencil, Play, Plus, RefreshCw, SlidersHorizontal, Square, Upload, X } from '@lucide/vue'
import type { Work, WorkFile } from '../data'
import { errorMessage, notify, session, uploadFile } from '../state'
import { creation, downloadCreation, initializeCreation, loadCreationGroups, loadCreationModels, mediaSource, resumeCreation, selectCreationGroup, stopCreation, submitCreation, type CreationTask, type CreationDestination } from '../native-studio'
import CreationAdvanced from './CreationAdvanced.vue'
import StudioGallery from './StudioGallery.vue'
import StudioPopover from './StudioPopover.vue'
import StudioBilling from './StudioBilling.vue'
import { imageOptionsSchema, videoOptionsSchema } from '../../shared/studio/options'
import { IMAGE_RATIOS, imageRequestSize } from '../../shared/studio/image-params'
import { videoCapabilities } from '../../shared/studio/video-capabilities'
import { selectedVideoSize } from '../../shared/studio/video-size'

const props = defineProps<{ kind: 'text' | 'image' | 'video'; source?: Work | null }>()
const emit = defineEmits<{ prices: []; publish: [task: CreationTask, destination: CreationDestination]; source: [id?: string] }>()
const model = ref(''), prompt = ref(''), ratio = ref('1:1'), count = ref(1), duration = ref(8)
const imageOptions = reactive(imageOptionsSchema.parse({}))
const videoOptions = reactive(videoOptionsSchema.parse({ mode: 'text-to-video' }))
const protocol = ref('openai')
const videoLimits = computed(() => videoCapabilities(model.value, videoOptions.mode))
const references = ref<CreationTask['references']>([])
const sourceWorkId = ref<string>()
const uploading = ref(false), submissions = ref<Record<string, boolean>>({}), error = ref('')
const historyMenu = ref<InstanceType<typeof StudioPopover>>(), galleryMenu = ref<InstanceType<typeof StudioPopover>>()
const gallery = ref<InstanceType<typeof StudioGallery>>(), canvas = ref<HTMLElement>(), promptInput = ref<HTMLTextAreaElement>()
const blank = ref(false), now = ref(Date.now())
const submitting = computed(() => Boolean(submissions.value[props.kind]))
const referenceUrls = computed(() => references.value.map(file => file.url))
const selected = computed(() => blank.value ? undefined : creation.tasks.find(task => task.id === creation.selectedId && task.kind === props.kind) || creation.tasks.find(task => task.kind === props.kind))
const tasks = computed(() => creation.tasks.filter(task => task.kind === props.kind))
const activeTask = computed(() => tasks.value.find(task => ['submitting', 'running'].includes(task.phase)))
const groupKind = computed(() => {
  const group = creation.selectedGroup?.trim().toLowerCase()
  if (['生图', '生圖', '绘图', '繪圖', 'image', 'images'].includes(group || '')) return 'image'
  if (['视频', '視頻', 'video', 'videos'].includes(group || '')) return 'video'
})
const models = computed(() => creation.models.filter(item => groupKind.value ? groupKind.value === props.kind : !item.kinds?.length || item.kinds.includes(props.kind)))
const selectedGroup = computed(() => creation.groups.find(group => group.id === creation.selectedGroup))
const working = computed(() => selected.value && ['submitting', 'running'].includes(selected.value.phase))
const canGenerate = computed(() => !submitting.value && !activeTask.value && !uploading.value && !creation.groupsLoading && !creation.groupSwitching && !creation.modelsLoading && Boolean(model.value && prompt.value.trim()))
const elapsed = computed(() => {
  const task = selected.value
  if (!task || !Number.isFinite(task.createdAt) || !working.value && !Number.isFinite(task.settledAt)) return ''
  const seconds = Math.max(0, Math.floor(((working.value ? now.value : task.settledAt!) - task.createdAt) / 1000))
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
})
const waitingMessage = computed(() => {
  if (selected.value?.preview) return '预览已返回，正在等待最终画面。'
  if (selected.value?.phase === 'submitting') return '正在等待模型响应，返回后会在这里显示结果。'
  return props.kind === 'video' ? '视频正在生成，结果会自动更新。' : '模型正在生成画面，结果会自动更新。'
})
let timer: ReturnType<typeof setInterval> | undefined
watch(working, value => { clearInterval(timer); now.value = Date.now(); if (value) timer = setInterval(() => { now.value = Date.now() }, 1000) }, { immediate: true })
onUnmounted(() => clearInterval(timer))
watch(() => selected.value?.id, async () => { await nextTick(); if (canvas.value) canvas.value.scrollTop = 0 })
const size = computed(() => props.kind === 'video' ? selectedVideoSize({ resolution: videoOptions.resolution, aspectRatio: ratio.value }) : imageRequestSize(ratio.value, imageOptions.resolution, model.value))
const phases: Record<string, string> = { submitting: '正在提交', running: '正在生成', paused: '等待已暂停', complete: '生成完成', error: '生成失败', attention: '需要核对' }
const draftKey = () => `octopus:user-${session.user?.id}:native-creation-draft:${props.kind}`
function chooseModel() { if (!models.value.some(item => item.id === model.value)) model.value = models.value[0]?.id || '' }
function loadDraft() {
  blank.value = false
  sourceWorkId.value = undefined
  prompt.value = ''; model.value = ''; ratio.value = props.kind === 'video' ? '16:9' : '1:1'; count.value = 1; duration.value = 8; references.value = []; error.value = ''
  Object.assign(imageOptions, imageOptionsSchema.parse({})); Object.assign(videoOptions, videoOptionsSchema.parse({ mode: 'text-to-video' })); protocol.value = 'openai'
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey()) || 'null')
    if (saved && typeof saved.prompt === 'string') {
      prompt.value = saved.prompt; model.value = typeof saved.model === 'string' ? saved.model : ''
      ratio.value = (IMAGE_RATIOS as readonly string[]).includes(saved.ratio) ? saved.ratio : ratio.value
      count.value = Math.min(16, Math.max(1, Number(saved.count) || 1)); duration.value = Math.min(30, Math.max(1, Number(saved.duration) || 8))
      const image = imageOptionsSchema.safeParse(saved.imageOptions || {}), video = videoOptionsSchema.safeParse(saved.videoOptions || { mode: 'text-to-video' })
      if (image.success) Object.assign(imageOptions, image.data)
      if (video.success) Object.assign(videoOptions, video.data)
      if (saved.protocol === 'async') protocol.value = 'async'
      if (typeof saved.sourceWorkId === 'string') sourceWorkId.value = saved.sourceWorkId
      if (Array.isArray(saved.references)) references.value = saved.references.filter((file: any) => file && typeof file.url === 'string' && typeof file.name === 'string').slice(0, props.kind === 'video' ? 10 : 16)
    }
  } catch { /* A malformed local draft does not prevent creation. */ }
  chooseModel()
}
watch(() => [props.kind, session.user?.id], loadDraft, { immediate: true })
watch(models, chooseModel)
watch([prompt, model, ratio, count, duration, imageOptions, videoOptions, protocol, references, sourceWorkId], () => {
  if (!session.user) return
  try { localStorage.setItem(draftKey(), JSON.stringify({ prompt: prompt.value, model: model.value, ratio: ratio.value, count: count.value, duration: duration.value, imageOptions, videoOptions, protocol: protocol.value, sourceWorkId: sourceWorkId.value, references: references.value })) }
  catch { creation.storageError = '当前草稿无法保存到浏览器，请保留提示词。' }
}, { deep: true })
watch(videoLimits, limits => {
  if (!limits || props.kind !== 'video') return
  if (!limits.resolutions.includes(videoOptions.resolution) && videoOptions.resolution !== 'auto') videoOptions.resolution = limits.resolutions[0]!
  if (!limits.durations.includes(duration.value)) duration.value = limits.durations.reduce((best, value) => Math.abs(value - duration.value) < Math.abs(best - duration.value) ? value : best)
})
watch(() => props.source?.id, () => {
  if (!props.source || sourceWorkId.value === props.source.id) return
  sourceWorkId.value = props.source.id
  blank.value = true; prompt.value = props.source.prompt; references.value = []
}, { immediate: true })
function applySourceReferences(files: WorkFile[]) {
  if (!props.source) return
  const own = references.value.filter(file => file.fromWorkId !== props.source!.id)
  if (own.length + files.length > (props.kind === 'video' ? 10 : 16)) { error.value = '参考图数量超过当前创作类型上限，请减少所选图片。'; return }
  references.value = [...own, ...files.map(file => ({ name: file.name, url: file.url, fromWorkId: props.source!.id }))]
  if (props.kind === 'video') videoOptions.mode = references.value.length > 1 ? 'reference-to-video' : references.value.length ? 'image-to-video' : 'text-to-video'
  error.value = ''
}
watch(() => session.user?.id, async () => {
  if (!session.user) return
  await initializeCreation(); await loadCreationGroups(); await loadCreationModels(); chooseModel()
}, { immediate: true })
async function switchGroup(event: Event) {
  const select = event.target as HTMLSelectElement
  await selectCreationGroup(select.value)
  select.value = creation.selectedGroup ?? ''
}
async function addReferences(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  uploading.value = true; error.value = ''
  const owner = session.user?.id
  try {
    for (const file of files) {
      if (references.value.length >= (props.kind === 'video' ? 10 : 16)) throw new Error('参考图已达到数量上限。')
      if (!file.type.startsWith('image/')) throw new Error('参考文件请选择图片。')
      const uploaded = await uploadFile(file)
      if (owner !== session.user?.id) return
      references.value.push({ id: uploaded.id, url: uploaded.url, name: file.name })
      if (props.kind === 'video') videoOptions.mode = references.value.length > 1 ? 'reference-to-video' : 'image-to-video'
    }
  } catch (cause) { error.value = errorMessage(cause) }
  finally { uploading.value = false; input.value = '' }
}
async function generate() {
  if (!canGenerate.value) return
  const kind = props.kind, owner = session.user?.id
  blank.value = false
  error.value = ''; submissions.value[kind] = true
  try {
    const pending = submitCreation({ kind: props.kind, model: model.value, prompt: prompt.value, size: size.value, aspect_ratio: ratio.value, n: props.kind === 'video' ? 1 : count.value, duration: duration.value, protocol: protocol.value, references: references.value.map(file => ({ ...file })), sourceWorkId: sourceWorkId.value,
      ...(props.kind === 'image' ? { imageOptions: { ...imageOptions } } : props.kind === 'video' ? { videoOptions: { ...videoOptions } } : {}) })
    await pending
  } catch (cause) { if (owner === session.user?.id && kind === props.kind) error.value = errorMessage(cause) }
  finally { submissions.value[kind] = false }
}
async function download(task: CreationTask, index = 0) {
  try { await downloadCreation(task, index) } catch (cause) { error.value = errorMessage(cause) }
}
function openPublish(destination: CreationDestination = 'community') { if (selected.value) emit('publish', selected.value, destination) }
function useTask(task: CreationTask) {
  historyMenu.value?.close(); galleryMenu.value?.close()
  blank.value = false
  creation.selectedId = task.id; model.value = task.model; prompt.value = task.prompt
  sourceWorkId.value = task.sourceWorkId
  ratio.value = task.request.aspect_ratio; count.value = task.request.n; duration.value = task.request.duration
  const image = imageOptionsSchema.safeParse(task.request.imageOptions || {}), video = videoOptionsSchema.safeParse(task.request.videoOptions || { mode: 'text-to-video' })
  Object.assign(imageOptions, image.success ? image.data : imageOptionsSchema.parse({}))
  Object.assign(videoOptions, video.success ? video.data : videoOptionsSchema.parse({ mode: 'text-to-video' }))
  protocol.value = task.protocol === 'async' ? 'async' : 'openai'
  references.value = task.references.map(file => ({ ...file }))
  emit('source', sourceWorkId.value)
}
function editTask(task: CreationTask) { useTask(task); void nextTick(() => promptInput.value?.focus()) }
async function copyPrompt(task: CreationTask) {
  try { await navigator.clipboard.writeText(task.prompt); notify('提示词已复制。') }
  catch { error.value = '复制失败，请选中提示词后复制。' }
}
function newCreation() {
  blank.value = true; prompt.value = ''; references.value = []; error.value = ''; sourceWorkId.value = undefined
  emit('source')
  void nextTick(() => promptInput.value?.focus())
}
function handleEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || event.shiftKey || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
  event.preventDefault()
  void generate()
}
defineExpose({ newCreation, useTask, applySourceReferences, referenceUrls, uploading, sourceWorkId })
</script>

<template>
  <section class="native-studio" aria-label="创作工作台">
    <div class="creation-output">
      <div class="creation-output-toolbar"><h2>{{ kind === 'video' ? '视频创作' : '图片创作' }}</h2><div><button v-if="selected?.phase === 'complete'" class="studio-tool" @click="openPublish()"><Upload :size="16" />发布作品</button><StudioPopover ref="historyMenu" label="生成历史" :width="480"><template #trigger><History :size="18" /></template><section class="creation-history" aria-label="生成历史"><p v-if="!tasks.length" class="muted">暂无记录</p><button v-for="task in tasks" :key="task.id" class="history-row" :class="{ selected: selected?.id === task.id }" @click="useTask(task)"><img v-if="task.kind === 'image' && task.urls[0]" :src="mediaSource(task.urls[0], true)" alt="" loading="lazy" /><span v-else class="history-kind">{{ task.kind === 'video' ? '视频' : task.kind === 'text' ? '文本' : '图片' }}</span><span class="history-content"><strong>{{ task.prompt || task.model }}</strong><span>{{ task.model }} · {{ new Date(task.createdAt).toLocaleString('zh-CN') }}</span></span><span class="history-status">{{ phases[task.phase] }}</span></button></section></StudioPopover><StudioPopover ref="galleryMenu" label="图库与任务管理" :width="880"><template #trigger><Images :size="18" /></template><StudioGallery ref="gallery" :kind="kind" embedded @reuse="useTask" @publish="(task, destination) => emit('publish', task, destination)" /></StudioPopover><button class="studio-tool" aria-label="刷新模型" title="刷新模型" :disabled="creation.modelsLoading" @click="loadCreationModels"><RefreshCw :size="18" /></button></div></div>
      <div ref="canvas" class="creation-canvas" :class="{ 'has-result': selected?.phase === 'complete' }" tabindex="0" aria-label="创作对话">
        <div v-if="selected" class="creation-conversation">
          <article class="creation-request" aria-label="已发送的创作请求">
            <header class="creation-message-heading"><span class="creation-avatar" aria-hidden="true">{{ (session.user?.name || session.user?.username || '你').slice(0, 1) }}</span><strong>你</strong><time>{{ new Date(selected.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</time></header>
            <div class="creation-request-body"><p>{{ selected.prompt }}</p><div v-if="selected.references.length" class="sent-references"><img v-for="(file, index) in selected.references" :key="file.url" :src="file.url" :alt="`参考图 ${index + 1}：${file.name}`" /></div></div>
            <div class="request-summary"><span>{{ selected.request.aspect_ratio === 'auto' ? '自动比例' : selected.request.aspect_ratio }}</span><span>{{ kind === 'video' ? `${selected.request.duration} 秒视频` : `${selected.request.n} 张图片` }}</span><span v-if="selected.request.imageOptions?.resolution">{{ selected.request.imageOptions.resolution === 'auto' ? '自动分辨率' : selected.request.imageOptions.resolution.toUpperCase() }}</span></div>
            <div class="creation-message-actions"><button class="studio-tool" @click="copyPrompt(selected)"><Copy :size="15" />复制提示词</button><button class="studio-tool" @click="editTask(selected)"><Pencil :size="15" />编辑提示词</button></div>
          </article>
          <article class="creation-response" aria-label="模型生成结果">
            <header class="creation-message-heading"><img src="/assets/brand/octopus-community.jpg" width="28" height="28" alt="" /><strong>{{ selected.model }}</strong><span v-if="elapsed" class="task-elapsed" :title="'从首次提交起计算，包含暂停等待的时间'"><Clock :size="13" />{{ working ? '已等待' : '自提交起' }} {{ elapsed }}</span></header>
            <div class="task-status"><div :role="selected.phase === 'error' || selected.phase === 'attention' ? 'alert' : 'status'"><LoaderCircle v-if="working" :size="18" /><Check v-else-if="selected.phase === 'complete'" :size="18" /><strong>{{ phases[selected.phase] }}</strong><span v-if="selected.progress != null && working">{{ Math.round(selected.progress) }}%</span></div><button v-if="selected.phase === 'paused' || selected.phase === 'attention'" class="button subtle btn" @click="resumeCreation(selected)"><Play :size="15" />继续查询</button><button v-else-if="selected.phase === 'error'" class="button subtle btn" @click="editTask(selected)"><Pencil :size="15" />编辑后重试</button></div>
            <p v-if="selected.error" class="task-message">{{ selected.error }}</p>
            <div v-if="working" class="generation-feedback">
              <p>{{ waitingMessage }}</p>
              <ol class="generation-steps" aria-label="生成阶段"><li :class="{ current: selected.phase === 'submitting', done: selected.phase === 'running' }"><Check v-if="selected.phase === 'running'" :size="13" />发送请求</li><li :class="{ current: selected.phase === 'running' }">模型生成</li><li>结果就绪</li></ol>
              <progress v-if="selected.progress != null" :value="selected.progress" max="100" aria-label="模型返回的生成进度" />
              <p v-if="now - selected.createdAt >= 30000" class="long-wait">等待时间较长，你可以继续编辑提示词或停止本页等待，稍后查询这次任务。</p>
            </div>
            <img v-if="selected.preview && selected.phase !== 'complete'" class="stream-preview" :src="selected.preview" alt="生成中的预览" />
            <div v-if="selected.urls.length" class="creation-media"><figure v-for="(url, index) in selected.urls" :key="url"><video v-if="selected.kind === 'video'" :src="mediaSource(url, false, 'video')" controls playsinline preload="metadata" /><button v-else class="creation-image-preview" :aria-label="`查看大图：预览生成图片 ${index + 1}`" @click="gallery?.open(selected, index)"><img :src="mediaSource(url)" :alt="selected.prompt" /><span><Maximize :size="16" />查看大图</span></button><figcaption><button class="studio-tool" @click="download(selected, index)"><Download :size="16" />下载{{ selected.urls.length > 1 ? ` ${index + 1}` : '' }}</button></figcaption></figure></div>
            <div v-else-if="selected.text" class="creation-text"><pre>{{ selected.text }}</pre><button class="button subtle btn" @click="download(selected)"><Download :size="16" />下载文本</button></div>
            <div v-if="selected.phase === 'complete'" class="creation-message-actions"><button class="studio-tool mobile-result-publish" @click="openPublish()"><Upload :size="15" />发布作品</button><button v-if="selected.kind !== 'video' && selected.sourceWorkId" class="studio-tool" @click="openPublish('source-comment')"><Upload :size="15" />发送到源作品评论区</button><button class="studio-tool" @click="editTask(selected)"><Pencil :size="15" />复用参数</button><button class="studio-tool" @click="newCreation"><Plus :size="15" />新的创作</button></div>
          </article>
        </div>
        <div v-else class="canvas-empty"><img src="/assets/brand/octopus-community.jpg" width="40" height="40" alt="" /><p>{{ kind === 'video' ? '开始视频创作' : '开始图片创作' }}</p><span>写下你的想法，也可以添加参考图。</span><button class="button subtle btn" @click="promptInput?.focus()"><Pencil :size="16" />写下创作描述</button></div>
      </div>
    </div>
    <form class="creation-controls studio-composer" aria-label="创作参数" @submit.prevent="generate">
      <StudioBilling :model="model" :quantity="kind === 'image' ? count : undefined" :refresh-key="selected?.settledAt" @prices="emit('prices')" />
      <ul v-if="references.length" class="reference-list"><li v-for="(file, index) in references" :key="file.url"><img :src="file.url" :alt="file.name" /><button type="button" class="icon-button" :aria-label="`移除参考图 ${index + 1}`" title="移除参考图" @click="references.splice(index, 1)"><X :size="14" /></button></li></ul>
      <label class="field prompt-field"><span class="studio-sr-only">提示词</span><textarea ref="promptInput" v-model="prompt" class="composer-input creation-prompt" rows="1" maxlength="100000" :placeholder="kind === 'video' ? '描述你想生成的视频…' : '发消息，描述你的想法…'" required @keydown.enter="handleEnter" /></label>
      <div class="studio-composer-tools">
        <div class="studio-composer-actions"><label class="reference-upload studio-tool composer-attachment" title="添加参考图"><LoaderCircle v-if="uploading" :size="18" /><Plus v-else :size="20" /><input type="file" aria-label="添加参考图" accept="image/jpeg,image/png,image/webp" multiple :disabled="uploading || references.length >= (kind === 'video' ? 10 : 16)" @change="addReferences" /></label>
          <StudioPopover label="高级参数" :width="480"><template #trigger><SlidersHorizontal :size="17" /><span>高级参数</span></template>
            <div class="parameter-row"><label class="field"><span>画面比例</span><select v-model="ratio" class="control"><option v-for="value in IMAGE_RATIOS" :key="value" :value="value">{{ value === 'auto' ? '自动' : value }}</option></select></label><label v-if="kind === 'image'" class="field"><span>图片数量</span><input v-model.number="count" class="control" type="number" min="1" max="16" step="1" required /></label><label v-else class="field"><span>时长（秒）</span><select v-if="videoLimits" v-model.number="duration" class="control"><option v-for="value in videoLimits.durations" :key="value" :value="value">{{ value }}</option></select><input v-else v-model.number="duration" class="control" type="number" min="1" max="30" step="1" required /></label></div>
            <CreationAdvanced :image="imageOptions" :video="videoOptions" v-model:protocol="protocol" :kind="kind" :model="model" embedded @update:image="Object.assign(imageOptions, $event)" @update:video="Object.assign(videoOptions, $event)" />
          </StudioPopover>
        </div>
        <div class="studio-composer-models"><label class="studio-select studio-model-select"><span class="studio-sr-only">模型</span><select v-model="model" :disabled="creation.modelsLoading || creation.groupSwitching || !models.length"><option v-if="!models.length" value="">{{ creation.modelsLoading || creation.groupSwitching ? '正在读取模型…' : '暂无可用模型' }}</option><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name || item.id }}</option></select></label>
          <label class="studio-select studio-group-select"><span class="studio-sr-only">模型分组</span><select aria-label="模型分组" :aria-description="selectedGroup?.description" :title="selectedGroup?.description" :value="creation.selectedGroup ?? ''" :disabled="creation.groupsLoading || creation.groupSwitching || !creation.groups.length" @change="switchGroup"><option v-if="creation.selectedGroup === null" value="" disabled>{{ creation.groupsLoading ? '正在读取分组…' : '选择分组' }}</option><option v-for="group in creation.groups" :key="group.id" :value="group.id">{{ group.name }}{{ typeof group.ratio === 'number' && group.ratio !== 1 ? ` · ${group.ratio}×` : '' }}</option></select></label>
        </div>
        <button v-if="activeTask" type="button" class="composer-submit generation-button" title="停止本页等待，上游任务可能继续执行" aria-label="停止等待" @click="stopCreation(activeTask)"><Square :size="17" /><span class="mobile-send-label">停止</span></button>
        <button v-else class="composer-submit generation-button" :title="submitting ? '正在准备…' : '开始生成'" :aria-label="submitting ? '正在准备…' : '开始生成'" :disabled="!canGenerate"><LoaderCircle v-if="submitting" :size="18" /><ArrowUp v-else :size="21" /><span class="mobile-send-label">生成</span></button>
      </div>
      <p v-if="selectedGroup?.description && selectedGroup.description !== selectedGroup.name" class="group-description">{{ selectedGroup.description }}</p>
      <p v-if="creation.groupSwitching" class="group-description" role="status">正在切换模型分组…</p>
      <p v-if="activeTask" class="composer-hint">生成期间可以继续编辑。停止等待不会取消上游任务。</p><p v-else class="composer-hint keyboard-hint">Enter 发送 · Shift + Enter 换行</p>
      <p v-if="creation.groupsError" class="form-error" role="alert">{{ creation.groupsError }} <button type="button" class="text-link" :disabled="creation.groupSwitching" @click="loadCreationGroups">重试</button></p>
      <p v-if="creation.modelsError" class="form-error" role="alert">{{ creation.modelsError }} <button type="button" class="text-link" @click="loadCreationModels">重试</button></p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="creation.storageError" class="form-error" role="alert">{{ creation.storageError }}</p>
    </form>

  </section>
</template>

<style scoped>
.native-studio { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.creation-section-heading, .creation-output-toolbar, .creation-output-toolbar > div, .task-status, .task-status > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.creation-section-heading h2, .creation-output-toolbar h2, .creation-section-heading h3 { margin: 0; font-size: 16px; line-height: 24px; }
.creation-section-heading > span { color: var(--muted); }
.group-description { color: var(--muted); overflow-wrap: anywhere; font-size: 12px; margin: 4px 8px 0; }
.parameter-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.parameter-row .control { width: 100%; min-width: 0; }
.reference-upload { width: fit-content; position: relative; overflow: hidden; }
.reference-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
.reference-upload:focus-within { outline: 2px solid var(--blue); outline-offset: 2px; }
.reference-list { display: flex; flex-wrap: wrap; list-style: none; padding: 0 8px; margin: 0 0 8px; gap: 8px; max-height: 80px; overflow-y: auto; }
.reference-list li { position: relative; width: 64px; height: 64px; }
.reference-list img { width: 100%; height: 100%; object-fit: cover; border-radius: 4px; }
.reference-list button { position: absolute; right: 0; top: 0; min-width: 24px; width: 24px; height: 24px; min-height: 24px; background: var(--surface); }
.creation-output { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.stream-preview { display: block; max-width: 100%; max-height: 480px; margin: auto; }
.creation-output-toolbar { min-height: 44px; flex: none; }
.creation-output-toolbar h2 { font-size: 14px; font-weight: 500; }
.creation-output-toolbar > div { gap: 8px; }
.creation-canvas { flex: 1; min-height: 0; display: block; margin: 0; background: transparent; overflow-y: auto; overscroll-behavior: contain; padding: 16px 8px; scrollbar-color: var(--border) transparent; }
.canvas-empty { min-height: 160px; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: var(--muted); text-align: center; }
.canvas-empty img { border-radius: 10px; }.canvas-empty p { margin: 0; }
.canvas-empty > span { font-size: 14px; }
.creation-conversation { width: min(100%, 960px); margin-inline: auto; padding-block: 8px 24px; }
.creation-request { width: fit-content; max-width: min(78%, 72ch); margin-left: auto; margin-bottom: 40px; }
.creation-message-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; min-height: 28px; font-size: 14px; color: var(--muted); }
.creation-message-heading strong { font-weight: 500; color: var(--ink); overflow-wrap: anywhere; min-width: 0; }
.creation-message-heading img, .creation-avatar { flex: none; width: 28px; height: 28px; border-radius: 50%; }
.creation-avatar { display: grid; place-items: center; background: var(--surface-soft); color: var(--ink); }
.creation-request .creation-message-heading { justify-content: flex-end; }
.creation-message-heading time, .task-elapsed { font-size: 12px; font-variant-numeric: tabular-nums; }
.creation-request-body { background: var(--surface); border-radius: 16px; padding: 14px 18px; }
.creation-request-body p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; line-height: 28px; }
.sent-references { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }.sent-references img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; }
.request-summary, .creation-message-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
.request-summary { font-size: 12px; color: var(--muted); margin-top: 10px; justify-content: flex-end; }
.creation-request .creation-message-actions { justify-content: flex-end; margin-top: 4px; }
.creation-response { min-width: 0; }.creation-response > .creation-message-heading { margin-bottom: 16px; }
.task-elapsed { display: inline-flex; align-items: center; gap: 4px; }
.creation-response .task-status { justify-content: flex-start; flex-wrap: wrap; margin-bottom: 12px; font-size: 14px; }
.creation-response .task-status strong { font-weight: 500; }
.generation-feedback { max-width: 640px; margin: 0 0 24px; }.generation-feedback > p { margin: 0 0 16px; font-size: 14px; line-height: 24px; color: var(--muted); }
.generation-steps { display: flex; flex-wrap: wrap; list-style: none; padding: 0; margin: 0; gap: 12px 24px; color: var(--muted); font-size: 12px; }
.generation-steps li { display: flex; align-items: center; gap: 6px; }.generation-steps .current { color: var(--ink); font-weight: 600; }.generation-steps .done { color: var(--blue); }
.generation-feedback progress { display: block; width: min(100%, 360px); height: 6px; margin-top: 16px; accent-color: var(--blue); }
.generation-feedback .long-wait { margin-top: 20px; font-size: 14px; }
.creation-response > .creation-message-actions { margin-top: 12px; }
.creation-image-preview { position: relative; display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.creation-image-preview > span { position: absolute; right: 12px; bottom: 12px; display: inline-flex; align-items: center; gap: 6px; background: var(--canvas); color: var(--ink); padding: 6px 10px; border-radius: 6px; font-size: 12px; }
.creation-image-preview:focus-visible { outline: 2px solid var(--blue); outline-offset: 4px; }
.composer-hint { color: var(--muted); font-size: 12px; line-height: 20px; margin: 4px 8px 0; }
@media (hover: none), (pointer: coarse) { .keyboard-hint { display: none; } }
@media (max-width: 639px) { .creation-request { max-width: 92%; margin-bottom: 28px; }.creation-request-body { padding: 12px; }.creation-message-heading { gap: 6px; }.creation-response .task-elapsed { flex-basis: 100%; padding-left: 36px; }.generation-steps { gap: 12px; }.creation-conversation { padding-bottom: 12px; }.creation-message-actions { gap: 4px; } }
.task-status { min-height: 40px; margin-bottom: 16px; }
.task-status > div { justify-content: flex-start; flex-wrap: wrap; }
.task-message { color: var(--amber); font-size: 14px; line-height: 24px; margin-block: 0 16px; overflow-wrap: anywhere; }
.creation-media { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 16px; }
.creation-media figure { margin: 0; min-width: 0; }
.creation-media img, .creation-media video { width: 100%; max-height: 600px; display: block; object-fit: contain; }
.creation-media figcaption { margin-top: 12px; }
.creation-text pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 28px; margin: 0 0 16px; max-width: 72ch; }
.creation-history { padding-block: 0; }
.creation-history > .creation-section-heading { margin-bottom: 16px; }
.history-row { display: flex; align-items: center; gap: 12px; padding: 12px 8px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--ink); width: 100%; min-width: 0; text-align: left; cursor: pointer; }
.history-row:hover, .history-row.selected { background: var(--surface-soft); }
.history-row > img, .history-kind { width: 48px; height: 48px; flex: none; object-fit: cover; border-radius: 4px; }
.history-kind { display: grid; place-items: center; font-size: 12px; background: var(--surface-soft); }
.history-content { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
.history-content strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; }
.history-content > span, .history-status { font-size: 12px; color: var(--muted); }
.history-content > span { overflow-wrap: anywhere; }
.history-status { white-space: nowrap; }
@media (max-width: 639px) { .history-row { gap: 8px; }.creation-output-toolbar { gap: 8px; }.creation-output-toolbar > div { gap: 0; }.creation-canvas { padding: 16px 0; }.creation-media img, .creation-media video { max-height: 44dvh; } }
</style>
