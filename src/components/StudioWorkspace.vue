<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowUp, Download, History, Images, LoaderCircle, Pause, Play, Plus, RefreshCw, SlidersHorizontal, Upload, X } from '@lucide/vue'
import type { Work } from '../data'
import { errorMessage, notify, session, uploadFile } from '../state'
import { creation, downloadCreation, initializeCreation, loadCreationGroups, loadCreationModels, mediaSource, publishCreation, resumeCreation, selectCreationGroup, stopCreation, submitCreation, type CreationTask } from '../native-studio'
import CreationAdvanced from './CreationAdvanced.vue'
import StudioGallery from './StudioGallery.vue'
import StudioPopover from './StudioPopover.vue'
import { imageOptionsSchema, videoOptionsSchema } from '../../shared/studio/options'
import { IMAGE_RATIOS, imageRequestSize } from '../../shared/studio/image-params'
import { videoCapabilities } from '../../shared/studio/video-capabilities'
import { selectedVideoSize } from '../../shared/studio/video-size'

const props = defineProps<{ kind: 'text' | 'image' | 'video'; source?: Work | null }>()
const model = ref(''), prompt = ref(''), ratio = ref('1:1'), count = ref(1), duration = ref(8)
const imageOptions = reactive(imageOptionsSchema.parse({}))
const videoOptions = reactive(videoOptionsSchema.parse({ mode: 'text-to-video' }))
const protocol = ref('openai')
const videoLimits = computed(() => videoCapabilities(model.value, videoOptions.mode))
const references = ref<CreationTask['references']>([])
const uploading = ref(false), submissions = ref<Record<string, boolean>>({}), error = ref('')
const historyMenu = ref<InstanceType<typeof StudioPopover>>(), galleryMenu = ref<InstanceType<typeof StudioPopover>>()
const submitting = computed(() => Boolean(submissions.value[props.kind]))
const publishing = ref(false), publishTitle = ref(''), publishDialog = ref<HTMLDialogElement>()
const selected = computed(() => creation.tasks.find(task => task.id === creation.selectedId && task.kind === props.kind) || creation.tasks.find(task => task.kind === props.kind))
const tasks = computed(() => creation.tasks.filter(task => task.kind === props.kind))
const groupKind = computed(() => {
  const group = creation.selectedGroup?.trim().toLowerCase()
  if (['生图', '生圖', '绘图', '繪圖', 'image', 'images'].includes(group || '')) return 'image'
  if (['视频', '視頻', 'video', 'videos'].includes(group || '')) return 'video'
})
const models = computed(() => creation.models.filter(item => groupKind.value ? groupKind.value === props.kind : !item.kinds?.length || item.kinds.includes(props.kind)))
const selectedGroup = computed(() => creation.groups.find(group => group.id === creation.selectedGroup))
const working = computed(() => selected.value && ['submitting', 'running'].includes(selected.value.phase))
const size = computed(() => props.kind === 'video' ? selectedVideoSize({ resolution: videoOptions.resolution, aspectRatio: ratio.value }) : imageRequestSize(ratio.value, imageOptions.resolution, model.value))
const phases: Record<string, string> = { submitting: '正在提交', running: '正在生成', paused: '等待已暂停', complete: '生成完成', error: '生成失败', attention: '需要核对' }
const draftKey = () => `octopus:user-${session.user?.id}:native-creation-draft:${props.kind}`
function chooseModel() { if (!models.value.some(item => item.id === model.value)) model.value = models.value[0]?.id || '' }
function loadDraft() {
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
    }
  } catch { /* A malformed local draft does not prevent creation. */ }
  chooseModel()
}
watch(() => [props.kind, session.user?.id], loadDraft, { immediate: true })
watch(models, chooseModel)
watch([prompt, model, ratio, count, duration, imageOptions, videoOptions, protocol], () => {
  if (!session.user) return
  try { localStorage.setItem(draftKey(), JSON.stringify({ prompt: prompt.value, model: model.value, ratio: ratio.value, count: count.value, duration: duration.value, imageOptions, videoOptions, protocol: protocol.value })) }
  catch { creation.storageError = '当前草稿无法保存到浏览器，请保留提示词。' }
})
watch(videoLimits, limits => {
  if (!limits || props.kind !== 'video') return
  if (!limits.resolutions.includes(videoOptions.resolution) && videoOptions.resolution !== 'auto') videoOptions.resolution = limits.resolutions[0]!
  if (!limits.durations.includes(duration.value)) duration.value = limits.durations.reduce((best, value) => Math.abs(value - duration.value) < Math.abs(best - duration.value) ? value : best)
})
watch(() => props.source?.id, () => {
  if (!props.source) return
  prompt.value = props.source.prompt; model.value = props.source.model
  references.value = (props.source.referenceFiles || []).filter(file => file.type.startsWith('image/')).map(file => ({ id: file.id, url: file.url, name: file.name }))
}, { immediate: true })
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
  if (submitting.value || uploading.value) return
  const kind = props.kind
  error.value = ''; submissions.value[kind] = true
  try {
    const pending = submitCreation({ kind: props.kind, model: model.value, prompt: prompt.value, size: size.value, aspect_ratio: ratio.value, n: props.kind === 'video' ? 1 : count.value, duration: duration.value, protocol: protocol.value, references: references.value.map(file => ({ ...file })), sourceWorkId: props.source?.id,
      ...(props.kind === 'image' ? { imageOptions: { ...imageOptions } } : props.kind === 'video' ? { videoOptions: { ...videoOptions } } : {}) })
    await pending
  } catch (cause) { error.value = errorMessage(cause) }
  finally { submissions.value[kind] = false }
}
async function download(task: CreationTask, index = 0) {
  try { await downloadCreation(task, index) } catch (cause) { error.value = errorMessage(cause) }
}
function openPublish() {
  if (!selected.value) return
  publishTitle.value = selected.value.prompt.slice(0, 50)
  publishDialog.value?.showModal()
}
async function publish() {
  if (!selected.value || publishing.value) return
  publishing.value = true; error.value = ''
  try {
    const result = await publishCreation(selected.value, publishTitle.value)
    publishDialog.value?.close()
    notify(result.work.status === 'pending' ? '作品已提交审核。' : '作品已发布。')
  } catch (cause) { error.value = errorMessage(cause) }
  finally { publishing.value = false }
}
function useTask(task: CreationTask) {
  historyMenu.value?.close(); galleryMenu.value?.close()
  creation.selectedId = task.id; model.value = task.model; prompt.value = task.prompt
  ratio.value = task.request.aspect_ratio; count.value = task.request.n; duration.value = task.request.duration
  if (task.request.imageOptions) Object.assign(imageOptions, task.request.imageOptions)
  if (task.request.videoOptions) Object.assign(videoOptions, task.request.videoOptions)
  protocol.value = task.protocol === 'async' ? 'async' : 'openai'
  references.value = task.references.map(file => ({ ...file }))
}
</script>

<template>
  <section class="native-studio" aria-label="创作工作台">
    <div class="creation-output">
      <div class="creation-output-toolbar"><h2>{{ kind === 'video' ? '视频创作' : '图片创作' }}</h2><div><button v-if="selected?.phase === 'complete'" class="studio-tool" @click="openPublish"><Upload :size="16" />发布作品</button><StudioPopover ref="historyMenu" label="生成历史" :width="480"><template #trigger><History :size="18" /></template><section class="creation-history" aria-label="生成历史"><p v-if="!tasks.length" class="muted">暂无记录</p><button v-for="task in tasks" :key="task.id" class="history-row" :class="{ selected: selected?.id === task.id }" @click="useTask(task)"><img v-if="task.kind === 'image' && task.urls[0]" :src="mediaSource(task.urls[0], true)" alt="" loading="lazy" /><span v-else class="history-kind">{{ task.kind === 'video' ? '视频' : task.kind === 'text' ? '文本' : '图片' }}</span><span class="history-content"><strong>{{ task.prompt || task.model }}</strong><span>{{ task.model }} · {{ new Date(task.createdAt).toLocaleString('zh-CN') }}</span></span><span class="history-status">{{ phases[task.phase] }}</span></button></section></StudioPopover><StudioPopover ref="galleryMenu" label="图库与任务管理" :width="880"><template #trigger><Images :size="18" /></template><StudioGallery :kind="kind" embedded @reuse="useTask" /></StudioPopover><button class="studio-tool" aria-label="刷新模型" title="刷新模型" :disabled="creation.modelsLoading" @click="loadCreationModels"><RefreshCw :size="18" /></button></div></div>
      <div class="creation-canvas" :class="{ 'has-result': selected?.phase === 'complete' }">
        <template v-if="selected"><div class="task-status" :role="selected.phase === 'error' || selected.phase === 'attention' ? 'alert' : 'status'"><div><LoaderCircle v-if="working" :size="18" /><strong>{{ phases[selected.phase] }}</strong><span v-if="selected.progress != null && selected.phase !== 'complete'" class="caption-5">{{ Math.round(selected.progress) }}%</span></div><button v-if="working" class="button subtle btn" @click="stopCreation(selected)"><Pause :size="15" />停止等待</button><button v-else-if="selected.phase !== 'complete' && selected.phase !== 'error'" class="button subtle btn" @click="resumeCreation(selected)"><Play :size="15" />继续查询</button></div><p v-if="selected.error" class="task-message">{{ selected.error }}</p><img v-if="selected.preview && selected.phase !== 'complete'" class="stream-preview" :src="selected.preview" alt="生成中的预览" />
        <div v-if="selected.urls.length" class="creation-media"><figure v-for="(url, index) in selected.urls" :key="url"><video v-if="selected.kind === 'video'" :src="mediaSource(url, false, 'video')" controls playsinline preload="metadata" /><img v-else :src="mediaSource(url)" :alt="selected.prompt" /><figcaption><button class="button subtle btn" @click="download(selected, index)"><Download :size="16" />下载{{ selected.urls.length > 1 ? ` ${index + 1}` : '' }}</button></figcaption></figure></div><div v-else-if="selected.text" class="creation-text"><pre>{{ selected.text }}</pre><button class="button subtle btn" @click="download(selected)"><Download :size="16" />下载文本</button></div><div v-else-if="working" class="canvas-waiting"><LoaderCircle :size="28" /><p>{{ selected.phase === 'submitting' ? '正在提交生成请求' : '等待生成结果' }}</p></div></template>
        <div v-else class="canvas-empty"><img src="/assets/brand/octopus-community.jpg" width="40" height="40" alt="" /><p>{{ kind === 'video' ? '开始视频创作' : '开始图片创作' }}</p></div>
      </div>
    </div>
    <form class="creation-controls studio-composer" aria-label="创作参数" @submit.prevent="generate">
      <ul v-if="references.length" class="reference-list"><li v-for="(file, index) in references" :key="file.url"><img :src="file.url" :alt="file.name" /><button type="button" class="icon-button" :aria-label="`移除参考图 ${index + 1}`" title="移除参考图" @click="references.splice(index, 1)"><X :size="14" /></button></li></ul>
      <label class="field prompt-field"><span class="studio-sr-only">提示词</span><textarea v-model="prompt" class="composer-input creation-prompt" rows="2" maxlength="100000" :placeholder="kind === 'video' ? '描述你想生成的视频…' : '描述你想创作的画面…'" required /></label>
      <div class="studio-composer-tools">
        <div class="studio-composer-actions"><label class="reference-upload studio-tool composer-attachment" title="添加参考图"><LoaderCircle v-if="uploading" :size="18" /><Plus v-else :size="20" /><input type="file" aria-label="添加参考图" accept="image/jpeg,image/png,image/webp" multiple :disabled="uploading || references.length >= (kind === 'video' ? 10 : 16)" @change="addReferences" /></label>
          <StudioPopover label="高级参数" :width="480"><template #trigger><SlidersHorizontal :size="17" /><span>{{ ratio === 'auto' ? '自动' : ratio }} · {{ kind === 'image' ? `${count} 张` : `${duration} 秒` }}</span></template>
            <div class="parameter-row"><label class="field"><span>画面比例</span><select v-model="ratio" class="control"><option v-for="value in IMAGE_RATIOS" :key="value" :value="value">{{ value === 'auto' ? '自动' : value }}</option></select></label><label v-if="kind === 'image'" class="field"><span>图片数量</span><input v-model.number="count" class="control" type="number" min="1" max="16" step="1" required /></label><label v-else class="field"><span>时长（秒）</span><select v-if="videoLimits" v-model.number="duration" class="control"><option v-for="value in videoLimits.durations" :key="value" :value="value">{{ value }}</option></select><input v-else v-model.number="duration" class="control" type="number" min="1" max="30" step="1" required /></label></div>
            <CreationAdvanced :image="imageOptions" :video="videoOptions" v-model:protocol="protocol" :kind="kind" :model="model" embedded @update:image="Object.assign(imageOptions, $event)" @update:video="Object.assign(videoOptions, $event)" />
          </StudioPopover>
        </div>
        <div class="studio-composer-models"><label class="studio-select studio-model-select"><span class="studio-sr-only">模型</span><select v-model="model" :disabled="creation.modelsLoading || creation.groupSwitching || !models.length"><option v-if="!models.length" value="">{{ creation.modelsLoading || creation.groupSwitching ? '正在读取模型…' : '暂无可用模型' }}</option><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name || item.id }}</option></select></label>
          <label class="studio-select studio-group-select"><span class="studio-sr-only">模型分组</span><select aria-label="模型分组" :aria-description="selectedGroup?.description" :title="selectedGroup?.description" :value="creation.selectedGroup ?? ''" :disabled="creation.groupsLoading || creation.groupSwitching || !creation.groups.length" @change="switchGroup"><option v-if="creation.selectedGroup === null" value="" disabled>{{ creation.groupsLoading ? '正在读取分组…' : '选择分组' }}</option><option v-for="group in creation.groups" :key="group.id" :value="group.id">{{ group.name }}{{ typeof group.ratio === 'number' && group.ratio !== 1 ? ` · ${group.ratio}×` : '' }}</option></select></label>
        </div>
        <button class="composer-submit generation-button" :title="submitting ? '正在生成…' : '开始生成'" :aria-label="submitting ? '正在生成…' : '开始生成'" :disabled="submitting || uploading || creation.groupsLoading || creation.groupSwitching || creation.modelsLoading || !model || !prompt.trim()"><LoaderCircle v-if="submitting" :size="18" /><ArrowUp v-else :size="21" /></button>
      </div>
      <p v-if="selectedGroup?.description && selectedGroup.description !== selectedGroup.name" class="group-description">{{ selectedGroup.description }}</p>
      <p v-if="creation.groupSwitching" class="group-description" role="status">正在切换模型分组…</p>
      <p v-if="creation.groupsError" class="form-error" role="alert">{{ creation.groupsError }} <button type="button" class="text-link" :disabled="creation.groupSwitching" @click="loadCreationGroups">重试</button></p>
      <p v-if="creation.modelsError" class="form-error" role="alert">{{ creation.modelsError }} <button type="button" class="text-link" @click="loadCreationModels">重试</button></p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="creation.storageError" class="form-error" role="alert">{{ creation.storageError }}</p>
    </form>
    <Teleport to="body"><dialog ref="publishDialog" class="compact-dialog" aria-labelledby="native-publish-title"><div class="dialog-heading"><h2 id="native-publish-title">发布作品</h2><button class="icon-button" aria-label="关闭发布作品" :disabled="publishing" @click="publishDialog?.close()"><X :size="18" /></button></div><form class="dialog-body stack" @submit.prevent="publish"><label class="field"><span>作品标题</span><input v-model="publishTitle" class="control" maxlength="100" required :disabled="publishing" /></label><p v-if="error" class="form-error" role="alert">{{ error }}</p><button class="button primary btn" :disabled="publishing"><Upload :size="16" />{{ publishing ? '正在提交…' : '提交作品' }}</button></form></dialog></Teleport>
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
.canvas-empty, .canvas-waiting { min-height: 80px; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: var(--muted); }
.canvas-empty img { border-radius: 10px; }.canvas-empty p { margin: 0; }
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
