<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { ArrowUp, Eraser, LoaderCircle, Pencil, Plus, SlidersHorizontal, Square, X } from '@lucide/vue'
import type { Work, WorkFile } from '../data'
import { errorMessage, notify, session, uploadFile } from '../state'
import { creation, initializeCreation, loadCreationGroups, loadCreationModels, mediaSource, selectCreationGroup, stopCreation, submitCreation, type CreationTask, type CreationDestination, type CreationInput } from '../native-studio'
import { chats, newChat, saveChats } from '../native-chat'
import { ensureMediaConversation, isConversationBusy, mediaTasksForConversation, syncMediaConversations } from '../studio-conversations'
import { buildImageContext, clearMediaContext, imageContinuationReferences, registerMediaTurn } from '../studio-image-conversation'
import CreationAdvanced from './CreationAdvanced.vue'
import StudioPopover from './StudioPopover.vue'
import StudioModePicker from './StudioModePicker.vue'
import StudioBilling from './StudioBilling.vue'
import StudioModelPicker from './StudioModelPicker.vue'
import StudioVideoPrompt from './StudioVideoPrompt.vue'
import { remapVideoMentions, removeVideoMention } from '../../shared/studio/video-mentions'
import { modelsForKind, takeModelChoice } from '../model-preferences'
import { imageOptionsSchema, videoOptionsSchema } from '../../shared/studio/options'
import { IMAGE_RATIOS, imageRequestSize, usesGeminiImageChat } from '../../shared/studio/image-params'
import { videoCapabilities } from '../../shared/studio/video-capabilities'
import { selectedVideoSize } from '../../shared/studio/video-size'
import { readRemixParameters } from '../../shared/studio/remix-parameters'

const props = defineProps<{ kind: 'image' | 'video'; source?: Work | null; sourceBlocked?: boolean }>()
const emit = defineEmits<{ prices: []; keys: []; publish: [task: CreationTask, destination: CreationDestination]; source: [id?: string] }>()
const model = ref(''), prompt = ref(''), ratio = ref('1:1'), count = ref(1), duration = ref(8)
const imageOptions = reactive(imageOptionsSchema.parse({}))
const videoOptions = reactive(videoOptionsSchema.parse({ mode: 'text-to-video' }))
const protocol = ref('openai')
const manualSize = ref(''), restoringParameters = ref(false)
const videoLimits = computed(() => videoCapabilities(model.value, videoOptions.mode))
const references = ref<CreationTask['references']>([])
const sourceWorkId = ref<string>()
const uploading = ref(false), submissions = ref<Record<string, boolean>>({}), error = ref('')
const promptInput = ref<HTMLTextAreaElement | InstanceType<typeof StudioVideoPrompt>>()
const blank = ref(false)
const branchTaskId = ref<string>(), editing = ref(false)
const skipAutomaticReference = ref(false), restoringTask = ref(false), parameterModel = ref('')
const submitting = computed(() => Boolean(submissions.value[props.kind]))
const referenceUrls = computed(() => references.value.map(file => file.url))
const currentConversation = computed(() => chats.sessions.find(chat => chat.id === chats.activeId))
const currentTasks = computed(() => currentConversation.value ? mediaTasksForConversation(currentConversation.value) : [])
const selected = computed(() => blank.value ? undefined : currentTasks.value.find(task => task.id === creation.selectedId) || currentTasks.value[0])
const automaticReferences = computed(() => props.kind === 'image' && currentConversation.value && !references.value.length && !skipAutomaticReference.value
  ? imageContinuationReferences(currentConversation.value, branchTaskId.value) : [])
const requestReferences = computed(() => references.value.length ? references.value : automaticReferences.value)
const activeTask = computed(() => currentTasks.value.find(task => ['submitting', 'running'].includes(task.phase)))
const busy = computed(() => currentConversation.value && isConversationBusy(currentConversation.value))
const models = computed(() => modelsForKind(props.kind))
const selectedGroup = computed(() => creation.groups.find(group => group.id === creation.selectedGroup))
const videoParameterIssue = computed(() => props.kind === 'video' && videoLimits.value && (!videoLimits.value.durations.includes(duration.value) || videoOptions.resolution !== 'auto' && !videoLimits.value.resolutions.includes(videoOptions.resolution)) ? '原作时长或分辨率不受当前模型支持，请在高级参数中调整。' : '')
const imageParameterIssue = computed(() => props.kind === 'image' && usesGeminiImageChat(model.value) && (imageOptions.seed || manualSize.value && manualSize.value !== 'auto') ? '当前 Gemini 图片兼容接口不支持固定尺寸或随机种子，请使用自动尺寸并清空 seed，或选择其他模型。' : '')
const canGenerate = computed(() => chats.ready && !busy.value && !props.sourceBlocked && !videoParameterIssue.value && !imageParameterIssue.value && !submitting.value && !uploading.value && !restoringTask.value && !creation.groupsLoading && !creation.groupSwitching && !creation.modelsLoading && models.value.some(item => item.id === model.value) && Boolean(prompt.value.trim()))
let live = true, draftRevision = 0
onUnmounted(() => { live = false; draftRevision++ })
const draftScope = () => `${session.user?.id}:${currentConversation.value?.id}:${props.kind}:${draftRevision}`
function finishRestore() {
  const scope = draftScope()
  void nextTick(() => { if (live && scope === draftScope()) restoringParameters.value = false })
}
const automaticSize = computed(() => props.kind === 'video' ? selectedVideoSize({ resolution: videoOptions.resolution, aspectRatio: ratio.value }) : imageRequestSize(ratio.value, imageOptions.resolution, model.value))
const size = computed({ get: () => manualSize.value || automaticSize.value, set: (value: string) => { manualSize.value = value.trim() } })
const draftKey = () => `octopus:user-${session.user?.id}:native-creation-draft:${props.kind}`
function chooseModel() {
  if (restoringTask.value || parameterModel.value || !creation.modelsLoaded || creation.modelsLoading || creation.groupsLoading || creation.groupSwitching) return
  const choice = takeModelChoice(props.kind, models.value)
  if (choice) model.value = choice
  else if (!models.value.some(item => item.id === model.value)) model.value = models.value[0]?.id || ''
}
function loadDraft() {
  restoringParameters.value = true
  draftRevision++
  branchTaskId.value = undefined; editing.value = false; parameterModel.value = ''; skipAutomaticReference.value = false
  finishRestore()
  blank.value = false
  sourceWorkId.value = undefined
  prompt.value = ''; model.value = ''; manualSize.value = ''; ratio.value = props.kind === 'video' ? '16:9' : '1:1'; count.value = 1; duration.value = 8; references.value = []; error.value = ''
  Object.assign(imageOptions, imageOptionsSchema.parse({})); Object.assign(videoOptions, videoOptionsSchema.parse({ mode: 'text-to-video' })); protocol.value = 'openai'
  try {
    const chat = currentConversation.value
    const saved = chat?.mediaDrafts?.[props.kind] || (chat?.creationKind === props.kind && !chat.mediaDrafts ? { ...chat.mediaDraft, prompt: chat.draft || '' } : null) ||
      (!chat?.messages.length && !chat?.mediaDrafts ? JSON.parse(localStorage.getItem(draftKey()) || 'null') : null)
    if (saved && typeof saved.prompt === 'string') {
      prompt.value = saved.prompt; model.value = typeof saved.model === 'string' ? saved.model : ''
      ratio.value = typeof saved.ratio === 'string' && /^(?:auto|[1-9]\d{0,2}:[1-9]\d{0,2})$/.test(saved.ratio) ? saved.ratio : ratio.value
      manualSize.value = typeof saved.manualSize === 'string' && /^(?:auto|[1-9]\d{0,4}x[1-9]\d{0,4}|[124]K)$/.test(saved.manualSize) ? saved.manualSize : ''
      count.value = Math.min(16, Math.max(1, Number(saved.count) || 1)); duration.value = Math.min(3600, Math.max(1, Number(saved.duration) || 8))
      const image = imageOptionsSchema.safeParse(saved.imageOptions || {}), video = videoOptionsSchema.safeParse(saved.videoOptions || { mode: 'text-to-video' })
      if (image.success) Object.assign(imageOptions, image.data)
      if (video.success) Object.assign(videoOptions, video.data)
      if (saved.protocol === 'async') protocol.value = 'async'
      if (typeof saved.sourceWorkId === 'string') sourceWorkId.value = saved.sourceWorkId
      skipAutomaticReference.value = saved.skipAutomaticReference === true
      if (Array.isArray(saved.references)) references.value = saved.references.filter((file: any) => file && typeof file.url === 'string' && typeof file.name === 'string').slice(0, props.kind === 'video' ? 10 : 16)
    }
  } catch { /* A malformed local draft does not prevent creation. */ }
  chooseModel()
}
watch(() => [props.kind, session.user?.id, currentConversation.value?.id], loadDraft, { immediate: true })
watch([models, () => creation.modelsLoaded, () => creation.groupsLoading, () => creation.groupSwitching], chooseModel)
watch([ratio, () => imageOptions.resolution, () => videoOptions.resolution, model], () => { if (!restoringParameters.value) manualSize.value = '' })
watch([prompt, model, manualSize, ratio, count, duration, imageOptions, videoOptions, protocol, references, sourceWorkId, skipAutomaticReference, restoringParameters], () => {
  if (!session.user || restoringParameters.value || !live) return
  const draft = JSON.parse(JSON.stringify({ prompt: prompt.value, model: model.value, manualSize: manualSize.value, ratio: ratio.value, count: count.value, duration: duration.value, imageOptions, videoOptions, protocol: protocol.value, sourceWorkId: sourceWorkId.value, references: references.value, skipAutomaticReference: skipAutomaticReference.value }))
  try { localStorage.setItem(draftKey(), JSON.stringify(draft)) }
  catch { creation.storageError = '当前草稿无法保存到浏览器，请保留提示词。' }
  if (currentConversation.value) {
    currentConversation.value.mediaDrafts ||= {}
    currentConversation.value.mediaDrafts[props.kind] = draft
    void saveChats()
  }
}, { deep: true, flush: 'sync' })
watch(model, value => { if (!restoringTask.value && value !== parameterModel.value) parameterModel.value = '' })
watch(videoLimits, limits => {
  if (!limits || props.kind !== 'video') return
  if (props.source?.generation?.parameters?.kind === 'video' && sourceWorkId.value === props.source.id) return
  if (!limits.resolutions.includes(videoOptions.resolution) && videoOptions.resolution !== 'auto') videoOptions.resolution = limits.resolutions[0]!
  if (!limits.durations.includes(duration.value)) duration.value = limits.durations.reduce((best, value) => Math.abs(value - duration.value) < Math.abs(best - duration.value) ? value : best)
})
watch([() => props.source?.id, () => chats.ready], () => {
  if (!props.source || sourceWorkId.value === props.source.id) return
  if (chats.ready && currentConversation.value?.sourceWorkId !== props.source.id) {
    const chat = newChat(props.kind); chat.sourceWorkId = props.source.id
  }
  sourceWorkId.value = props.source.id
  blank.value = true; prompt.value = props.source.prompt; references.value = []
  restoringParameters.value = true
  const parameters = readRemixParameters(props.source.generation?.parameters)
  if (models.value.some(item => item.id === props.source!.model)) model.value = props.source.model
  if (parameters?.kind === props.kind) {
    if (parameters.aspect_ratio !== undefined) ratio.value = parameters.aspect_ratio
    if (parameters.n !== undefined) count.value = parameters.n
    if (parameters.duration !== undefined) duration.value = parameters.duration
    if (parameters.protocol !== undefined) protocol.value = parameters.protocol === 'async' ? 'async' : 'openai'
    if (parameters.imageOptions) Object.assign(imageOptions, parameters.imageOptions)
    Object.assign(videoOptions, { openaiReferenceSource: 'upload', openaiImageUrl: undefined, openaiLastImageUrl: undefined, openaiFileId: undefined }, parameters.videoOptions || {})
    if (parameters.size !== undefined) manualSize.value = parameters.size
  }
  finishRestore()
}, { immediate: true })
function applySourceReferences(files: WorkFile[]) {
  if (!props.source) return
  const own = references.value.filter(file => file.fromWorkId !== props.source!.id)
  if (own.length + files.length > (props.kind === 'video' ? 10 : 16)) { error.value = '参考图数量超过当前创作类型上限，请减少所选图片。'; return }
  const next = [...own, ...files.map(file => ({ name: file.name, url: file.url, fromWorkId: props.source!.id }))]
  if (props.kind === 'video') prompt.value = remapVideoMentions(prompt.value, references.value.map(file => file.url), next.map(file => file.url))
  references.value = next
  if (props.kind === 'video') videoOptions.mode = videoOptions.mode === 'first-last-frame' && references.value.length === 2 ? 'first-last-frame' : references.value.length > 1 ? 'reference-to-video' : references.value.length ? 'image-to-video' : 'text-to-video'
  error.value = ''
}
watch(() => session.user?.id, async () => {
  if (!session.user) return
  await initializeCreation(); await loadCreationGroups(); await loadCreationModels(); chooseModel()
}, { immediate: true })
async function addReferences(event: Event) {
  const input = event.target as HTMLInputElement
  await addReferenceFiles([...(input.files || [])])
  input.value = ''
}
async function addReferenceFiles(files: File[]) {
  if (!files.length || uploading.value) return
  uploading.value = true; error.value = ''
  const scope = draftScope()
  try {
    if (files.length + references.value.length > (props.kind === 'video' ? 10 : 16)) throw new Error('参考图数量超过上限，请减少所选图片。')
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('参考文件请选择 PNG、JPEG 或 WebP 图片。')
      const uploaded = await uploadFile(file)
      if (!live || scope !== draftScope()) return
      references.value.push({ id: uploaded.id, url: uploaded.url, name: file.name })
      if (props.kind === 'video') videoOptions.mode = references.value.length > 1 ? 'reference-to-video' : 'image-to-video'
    }
  } catch (cause) { if (live && scope === draftScope()) error.value = errorMessage(cause) }
  finally { uploading.value = false }
}
function pasteReferences(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'))
  if (files.length) { event.preventDefault(); void addReferenceFiles(files) }
}
function dropReferences(event: DragEvent) {
  if (!event.dataTransfer?.files.length) return
  event.preventDefault()
  void addReferenceFiles([...event.dataTransfer.files])
}
function removeReference(index: number) {
  if (props.kind === 'video') prompt.value = removeVideoMention(prompt.value, index + 1)
  if (!references.value.length) skipAutomaticReference.value = true
  else references.value.splice(index, 1)
}
async function generate() {
  if (!canGenerate.value) return
  const kind = props.kind, owner = session.user?.id
  const chat = currentConversation.value || ensureMediaConversation(props.kind)
  const scope = draftScope()
  const conversationId = chat.mediaConversationId || chat.id
  const submittedPrompt = prompt.value, submittedReferences = JSON.stringify(references.value), branchId = branchTaskId.value
  const branchEdited = editing.value
  let preparing = true
  blank.value = false
  error.value = ''; submissions.value[kind] = true; chats.preparing[chat.id] = true
  try {
    const input: CreationInput = JSON.parse(JSON.stringify({ conversationId, kind: props.kind, model: model.value, prompt: prompt.value, size: size.value, ...(manualSize.value && manualSize.value !== 'auto' ? { exactSize: true } : {}), aspect_ratio: ratio.value, n: props.kind === 'video' ? 1 : count.value, duration: duration.value, protocol: protocol.value, references: references.value, sourceWorkId: sourceWorkId.value,
      ...(props.kind === 'image' ? { imageOptions, references: requestReferences.value, imageContext: buildImageContext(chat, branchId) } : { videoOptions }),
      ...(branchId ? { mediaBranch: { taskId: branchId, edited: branchEdited } } : {}) }))
    await saveChats(true)
    if (owner !== session.user?.id || !chats.sessions.includes(chat)) return
    let registered = false
    const result = await submitCreation(input, async task => {
      if (registered) return
      registered = true
      await registerMediaTurn(chat, task, branchId, branchEdited)
      if (owner === session.user?.id && live && scope === draftScope()) {
        if (prompt.value === submittedPrompt) prompt.value = ''
        if (JSON.stringify(references.value) === submittedReferences) references.value = []
        branchTaskId.value = undefined; editing.value = false; skipAutomaticReference.value = false
        await saveChats()
      } else if (owner === session.user?.id) {
        const draft = chat.mediaDrafts?.[kind]
        if (draft?.prompt === submittedPrompt) draft.prompt = ''
        if (draft && JSON.stringify(draft.references) === submittedReferences) draft.references = []
        await saveChats()
      }
      if (owner === session.user?.id) chats.preparing[chat.id] = false
      preparing = false
    }, () => owner === session.user?.id && chats.sessions.some(item => item.id === chat.id))
    if (result.phase === 'error' && owner === session.user?.id && live && scope === draftScope() && !prompt.value && !references.value.length) {
      prompt.value = submittedPrompt; references.value = JSON.parse(submittedReferences)
      if (branchId) { branchTaskId.value = result.id; editing.value = branchEdited }
    }
    await syncMediaConversations()
  } catch (cause) { if (owner === session.user?.id && live && scope === draftScope()) error.value = errorMessage(cause) }
  finally { submissions.value[kind] = false; if (preparing && owner === session.user?.id) chats.preparing[chat.id] = false }
}
async function useTask(task: CreationTask) {
  if (restoringTask.value || task.owner !== session.user?.id || task.kind !== props.kind) return false
  restoringTask.value = true
  ensureMediaConversation(task.kind === 'video' ? 'video' : 'image', task)
  const owner = session.user?.id, id = currentConversation.value?.id, kind = props.kind
  await nextTick()
  if (!live || owner !== session.user?.id || id !== currentConversation.value?.id || kind !== props.kind) { restoringTask.value = false; return false }
  const scope = draftScope()
  try {
  if (task.group && task.group !== creation.selectedGroup) {
    if (!creation.groups.some(group => group.id === task.group)) throw new Error('原作分组当前不可用，请手动选择分组和模型。')
    await selectCreationGroup(task.group)
    if (creation.selectedGroup !== task.group) throw new Error('原作分组未能恢复，请重新选择。')
  }
  if (!live || scope !== draftScope()) return false
  blank.value = false
  creation.selectedId = task.id; model.value = task.model; prompt.value = task.prompt
  parameterModel.value = task.model
  restoringParameters.value = true; manualSize.value = task.request.size; finishRestore()
  sourceWorkId.value = task.sourceWorkId
  ratio.value = task.request.aspect_ratio; count.value = task.request.n; duration.value = task.request.duration
  const image = imageOptionsSchema.safeParse(task.request.imageOptions || {}), video = videoOptionsSchema.safeParse(task.request.videoOptions || { mode: 'text-to-video' })
  Object.assign(imageOptions, image.success ? image.data : imageOptionsSchema.parse({}))
  Object.assign(videoOptions, video.success ? video.data : videoOptionsSchema.parse({ mode: 'text-to-video' }))
  protocol.value = task.protocol === 'async' ? 'async' : 'openai'
  references.value = task.references.map(file => ({ ...file }))
  skipAutomaticReference.value = true
  emit('source', sourceWorkId.value)
  if (!models.value.some(item => item.id === task.model)) error.value = '原作模型在当前分组不可用，请选择可用模型后生成。'
  else error.value = ''
  await nextTick()
  if (live && scope === draftScope() && !error.value) promptInput.value?.focus()
  return live && scope === draftScope() && !error.value
  } catch (cause) { if (live && scope === draftScope()) error.value = errorMessage(cause); return false }
  finally { restoringTask.value = false }
}
async function editTask(task: CreationTask) {
  if (await useTask(task)) {
    branchTaskId.value = task.id; editing.value = true
    void nextTick(() => promptInput.value?.focus())
  }
}
async function regenerate(task: CreationTask) {
  if (busy.value || submitting.value || !await useTask(task)) return
  const scope = draftScope()
  branchTaskId.value = task.id; editing.value = false
  await nextTick()
  if (!live || scope !== draftScope()) return
  await generate()
}
function cancelEditing() {
  branchTaskId.value = undefined; editing.value = false; prompt.value = ''; references.value = []; skipAutomaticReference.value = false; error.value = ''
}
function chooseReference(task: CreationTask, index: number) {
  if (task.owner !== session.user?.id || task.kind !== 'image' || task.phase !== 'complete') return
  const url = task.urls[index]
  if (!url) return
  references.value = [{ name: `历史生成图 ${index + 1}`, url }]
  skipAutomaticReference.value = true
  void nextTick(() => promptInput.value?.focus())
}
async function clearContext() {
  if (!currentConversation.value || activeTask.value || submitting.value) return
  try { await clearMediaContext(currentConversation.value); skipAutomaticReference.value = true; references.value = []; branchTaskId.value = undefined; editing.value = false; notify('上下文已清除') }
  catch (cause) { error.value = errorMessage(cause) }
}
function newCreation() {
  newChat(props.kind)
  blank.value = true; prompt.value = ''; references.value = []; error.value = ''; sourceWorkId.value = undefined
  emit('source')
  void nextTick(() => promptInput.value?.focus())
}
function handleEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || event.shiftKey || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
  event.preventDefault()
  void generate()
}
function openConversation() {
  blank.value = false
  loadDraft()
}
defineExpose({ newCreation, useTask, editTask, regenerate, chooseReference, openConversation, applySourceReferences, referenceUrls, uploading, sourceWorkId, model, clearContext })
</script>

<template>
  <section class="native-studio" aria-label="创作工作台">
    <StudioBilling :model="model" :quantity="kind === 'image' ? count : undefined" :refresh-key="selected?.settledAt" @prices="emit('prices')"><StudioModePicker /><button type="button" class="studio-tool" title="清除上下文" :disabled="!currentConversation?.messages.length || busy" @click="clearContext"><Eraser :size="16" aria-hidden="true" />清除上下文</button></StudioBilling>
    <form class="creation-controls studio-composer" aria-label="创作参数" @submit.prevent="generate" @dragover.prevent @drop="dropReferences">
      <div v-if="branchTaskId" class="creation-editing" role="status"><Pencil :size="14" /><span>{{ editing ? '编辑此轮' : '重新生成此轮' }}</span><button class="icon-button" type="button" aria-label="取消编辑此轮" title="取消编辑" @click="cancelEditing"><X :size="16" /></button></div>
      <ul v-if="references.length" class="reference-list"><li v-for="(file, index) in references" :key="file.url"><img :src="mediaSource(file.url)" :alt="file.name" :title="file.name" /><button type="button" class="icon-button" :aria-label="`移除参考图 ${index + 1}`" title="移除参考图" @click="removeReference(index)"><X :size="14" /></button></li></ul>
      <label class="field prompt-field"><span class="studio-sr-only">提示词</span><StudioVideoPrompt v-if="kind === 'video'" ref="promptInput" v-model="prompt" :references="references" @submit="generate" @paste="pasteReferences" /><textarea v-else ref="promptInput" v-model="prompt" class="composer-input creation-prompt" rows="1" maxlength="100000" placeholder="发消息，描述你的想法…" required @keydown.enter="handleEnter" @paste="pasteReferences" /></label>
      <div class="studio-composer-tools">
        <div class="studio-composer-actions"><label class="reference-upload studio-tool composer-attachment" title="添加参考图"><LoaderCircle v-if="uploading" :size="18" /><Plus v-else :size="20" /><input type="file" aria-label="添加参考图" accept="image/jpeg,image/png,image/webp" multiple :disabled="uploading || references.length >= (kind === 'video' ? 10 : 16)" @change="addReferences" /></label>
          <StudioPopover label="高级参数" :width="480"><template #trigger><SlidersHorizontal :size="17" /><span>高级参数</span></template>
            <div class="parameter-row"><label class="field"><span>画面比例</span><select v-model="ratio" class="control"><option v-if="!(IMAGE_RATIOS as readonly string[]).includes(ratio)" :value="ratio">{{ ratio }}</option><option v-for="value in IMAGE_RATIOS" :key="value" :value="value">{{ value === 'auto' ? '自动' : value }}</option></select></label><label v-if="kind === 'image'" class="field"><span>图片数量</span><input v-model.number="count" class="control" type="number" min="1" max="16" step="1" required /></label><label v-else class="field"><span>时长（秒）</span><select v-if="videoLimits" v-model.number="duration" class="control"><option v-if="!videoLimits.durations.includes(duration)" :value="duration">{{ duration }}（当前模型不支持）</option><option v-for="value in videoLimits.durations" :key="value" :value="value">{{ value }}</option></select><input v-else v-model.number="duration" class="control" type="number" min="1" max="3600" step="1" required /></label><label class="field"><span>尺寸</span><input v-model="size" class="control" pattern="auto|[1-9][0-9]{0,4}x[1-9][0-9]{0,4}|[124]K" required /></label></div>
            <CreationAdvanced :image="imageOptions" :video="videoOptions" v-model:protocol="protocol" :kind="kind" :model="model" embedded @update:image="Object.assign(imageOptions, $event)" @update:video="Object.assign(videoOptions, $event)" />
          </StudioPopover>
        </div>
        <div class="studio-composer-models"><StudioModelPicker v-model="model" :kind="kind" @keys="emit('keys')" /></div>
        <button v-if="activeTask" type="button" class="composer-submit generation-button" title="停止本页等待，上游任务可能继续执行" aria-label="停止等待" @click="stopCreation(activeTask)"><Square :size="17" /><span class="mobile-send-label">停止</span></button>
        <button v-else class="composer-submit generation-button" :title="submitting ? '正在准备…' : '开始生成'" :aria-label="submitting ? '正在准备…' : '开始生成'" :disabled="!canGenerate"><LoaderCircle v-if="submitting" :size="18" /><ArrowUp v-else :size="21" /><span class="mobile-send-label">生成</span></button>
      </div>
      <p v-if="selectedGroup?.description && selectedGroup.description !== selectedGroup.name" class="group-description">{{ selectedGroup.description }}</p>
      <p v-if="creation.groupSwitching" class="group-description" role="status">正在切换模型分组…</p>
      <p v-if="creation.groupsError" class="form-error" role="alert">{{ creation.groupsError }} <button type="button" class="text-link" :disabled="creation.groupSwitching" @click="loadCreationGroups">重试</button></p>
      <p v-if="creation.modelsError" class="form-error" role="alert">{{ creation.modelsError }} <button type="button" class="text-link" @click="loadCreationModels">重试</button></p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="creation.storageError" class="form-error" role="alert">{{ creation.storageError }}</p>
      <p v-if="videoParameterIssue" class="form-error" role="alert">{{ videoParameterIssue }}</p>
      <p v-if="imageParameterIssue" class="form-error" role="alert">{{ imageParameterIssue }}</p>
    </form>

  </section>
</template>

<style scoped>
.native-studio { display: flex; flex-direction: column; flex: none; min-height: 0; min-width: 0; }
.creation-editing { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.creation-editing { padding: 0 8px 8px; color: var(--muted); font-size: 13px; }.creation-editing > button { margin-inline-start: auto; }
.group-description { color: var(--muted); overflow-wrap: anywhere; font-size: 12px; margin: 4px 8px 0; }
.parameter-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.parameter-row .control { width: 100%; min-width: 0; }
.reference-upload { width: fit-content; position: relative; overflow: hidden; }
.reference-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
.reference-upload:focus-within { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.reference-list { display: flex; flex-wrap: wrap; list-style: none; padding: 0 8px; margin: 0 0 8px; gap: 8px; max-height: 80px; overflow-y: auto; }
.reference-list li { position: relative; width: 64px; height: 64px; }
.reference-list img { width: 100%; height: 100%; object-fit: cover; border-radius: 4px; }
.reference-list button { position: absolute; right: 0; top: 0; min-width: 24px; width: 24px; height: 24px; min-height: 24px; background: var(--surface); }
</style>
