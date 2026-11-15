<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { ArrowUp, Check, ChevronLeft, ChevronRight, Clock, Copy, Download, Eraser, ImagePlus, ListChecks, LoaderCircle, Pencil, Play, Plus, RefreshCw, SlidersHorizontal, Square, Trash2, Upload, X } from '@lucide/vue'
import type { Work, WorkFile } from '../data'
import { errorMessage, notify, session, uploadFile } from '../state'
import { creation, copyCreationImage, downloadCreation, initializeCreation, loadCreationGroups, loadCreationModels, mediaSource, resumeCreation, selectCreationGroup, stopCreation, submitCreation, type CreationTask, type CreationDestination, type CreationInput } from '../native-studio'
import { chats, newChat, saveChats } from '../native-chat'
import { conversationKind, ensureMediaConversation, mediaTasksForConversation, syncMediaConversations } from '../studio-conversations'
import { buildImageContext, clearMediaContext, deleteMediaTurns, imageContinuationReferences, mediaVersion, registerMediaTurn, selectMediaVersion, visibleMediaTasks } from '../studio-image-conversation'
import CreationAdvanced from './CreationAdvanced.vue'
import StudioGallery from './StudioGallery.vue'
import StudioPopover from './StudioPopover.vue'
import StudioModePicker from './StudioModePicker.vue'
import StudioBilling from './StudioBilling.vue'
import StudioModelPicker from './StudioModelPicker.vue'
import StudioConversationTitle from './StudioConversationTitle.vue'
import StudioCreationImage from './studio-message/StudioCreationImage.vue'
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
const gallery = ref<InstanceType<typeof StudioGallery>>(), canvas = ref<HTMLElement>(), promptInput = ref<HTMLTextAreaElement | InstanceType<typeof StudioVideoPrompt>>()
const transcript = ref<HTMLElement>(), nearBottom = ref(true)
const blank = ref(false), now = ref(Date.now())
const branchTaskId = ref<string>(), editing = ref(false), selectedTurns = ref<string[]>([]), selecting = ref(false)
const skipAutomaticReference = ref(false), restoringTask = ref(false), parameterModel = ref('')
const submitting = computed(() => Boolean(submissions.value[props.kind]))
const referenceUrls = computed(() => references.value.map(file => file.url))
const tasks = computed(() => creation.tasks.filter(task => task.kind === props.kind && task.owner === session.user?.id))
const currentConversation = computed(() => chats.sessions.find(chat => chat.id === chats.activeId && conversationKind(chat) === props.kind))
const currentTasks = computed(() => currentConversation.value ? mediaTasksForConversation(currentConversation.value) : [])
const selected = computed(() => blank.value ? undefined : currentTasks.value.find(task => task.id === creation.selectedId) || currentTasks.value[0])
const conversationTasks = computed(() => currentConversation.value ? visibleMediaTasks(currentConversation.value) : [])
const automaticReferences = computed(() => props.kind === 'image' && currentConversation.value && !references.value.length && !skipAutomaticReference.value
  ? imageContinuationReferences(currentConversation.value, branchTaskId.value) : [])
const displayedReferences = computed(() => references.value.length ? references.value : automaticReferences.value)
const activeTask = computed(() => tasks.value.find(task => ['submitting', 'running'].includes(task.phase)))
const models = computed(() => modelsForKind(props.kind))
const selectedGroup = computed(() => creation.groups.find(group => group.id === creation.selectedGroup))
function working(task: CreationTask) { return ['submitting', 'running'].includes(task.phase) }
const videoParameterIssue = computed(() => props.kind === 'video' && videoLimits.value && (!videoLimits.value.durations.includes(duration.value) || videoOptions.resolution !== 'auto' && !videoLimits.value.resolutions.includes(videoOptions.resolution)) ? '原作时长或分辨率不受当前模型支持，请在高级参数中调整。' : '')
const imageParameterIssue = computed(() => props.kind === 'image' && usesGeminiImageChat(model.value) && (imageOptions.seed || manualSize.value && manualSize.value !== 'auto') ? '当前 Gemini 图片兼容接口不支持固定尺寸或随机种子，请使用自动尺寸并清空 seed，或选择其他模型。' : '')
const canGenerate = computed(() => chats.ready && !props.sourceBlocked && !videoParameterIssue.value && !imageParameterIssue.value && !submitting.value && !activeTask.value && !uploading.value && !restoringTask.value && !creation.groupsLoading && !creation.groupSwitching && !creation.modelsLoading && models.value.some(item => item.id === model.value) && Boolean(prompt.value.trim()))
function elapsed(task: CreationTask) {
  if (!Number.isFinite(task.createdAt) || !working(task) && !Number.isFinite(task.settledAt)) return ''
  const seconds = Math.max(0, Math.floor(((working(task) ? now.value : task.settledAt!) - task.createdAt) / 1000))
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}
function waitingMessage(task: CreationTask) {
  if (task.preview) return '预览已返回，正在等待最终画面。'
  if (task.phase === 'submitting') return '正在等待模型响应，返回后会在这里显示结果。'
  return props.kind === 'video' ? '视频正在生成，结果会自动更新。' : '模型正在生成画面，结果会自动更新。'
}
let timer: ReturnType<typeof setInterval> | undefined
watch(activeTask, value => { clearInterval(timer); now.value = Date.now(); if (value) timer = setInterval(() => { now.value = Date.now() }, 1000) }, { immediate: true })
onUnmounted(() => clearInterval(timer))
function followOutput() { if (nearBottom.value && canvas.value) canvas.value.scrollTop = canvas.value.scrollHeight }
function trackScroll() { if (canvas.value) nearBottom.value = canvas.value.scrollHeight - canvas.value.scrollTop - canvas.value.clientHeight < 80 }
const transcriptObserver = new ResizeObserver(followOutput)
watch(transcript, element => { transcriptObserver.disconnect(); if (element) transcriptObserver.observe(element) }, { flush: 'post' })
onUnmounted(() => transcriptObserver.disconnect())
watch(() => selected.value?.id, async (id, previousId) => {
  const current = tasks.value.find(task => task.id === id), previous = tasks.value.find(task => task.id === previousId)
  const continuing = current && previous && current.conversationId === previous.conversationId
  await nextTick()
  nearBottom.value = Boolean(current && (!previous || continuing))
  if (canvas.value) canvas.value.scrollTop = nearBottom.value ? canvas.value.scrollHeight : 0
})
const automaticSize = computed(() => props.kind === 'video' ? selectedVideoSize({ resolution: videoOptions.resolution, aspectRatio: ratio.value }) : imageRequestSize(ratio.value, imageOptions.resolution, model.value))
const size = computed({ get: () => manualSize.value || automaticSize.value, set: (value: string) => { manualSize.value = value.trim() } })
const phases: Record<string, string> = { submitting: '正在提交', running: '正在生成', paused: '等待已暂停', complete: '生成完成', error: '生成失败', attention: '需要核对' }
const draftKey = () => `octopus:user-${session.user?.id}:native-creation-draft:${props.kind}`
function chooseModel() {
  if (restoringTask.value || parameterModel.value || !creation.modelsLoaded || creation.modelsLoading || creation.groupsLoading || creation.groupSwitching) return
  const choice = takeModelChoice(props.kind, models.value)
  if (choice) model.value = choice
  else if (!models.value.some(item => item.id === model.value)) model.value = models.value[0]?.id || ''
}
function loadDraft() {
  restoringParameters.value = true; void nextTick(() => { restoringParameters.value = false })
  blank.value = false
  sourceWorkId.value = undefined
  prompt.value = ''; model.value = ''; manualSize.value = ''; ratio.value = props.kind === 'video' ? '16:9' : '1:1'; count.value = 1; duration.value = 8; references.value = []; error.value = ''
  Object.assign(imageOptions, imageOptionsSchema.parse({})); Object.assign(videoOptions, videoOptionsSchema.parse({ mode: 'text-to-video' })); protocol.value = 'openai'
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey()) || 'null')
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
      if (Array.isArray(saved.references)) references.value = saved.references.filter((file: any) => file && typeof file.url === 'string' && typeof file.name === 'string').slice(0, props.kind === 'video' ? 10 : 16)
    }
  } catch { /* A malformed local draft does not prevent creation. */ }
  chooseModel()
}
watch(() => [props.kind, session.user?.id], loadDraft, { immediate: true })
watch([models, () => creation.modelsLoaded, () => creation.groupsLoading, () => creation.groupSwitching], chooseModel)
watch([ratio, () => imageOptions.resolution, () => videoOptions.resolution, model], () => { if (!restoringParameters.value) manualSize.value = '' })
watch([prompt, model, manualSize, ratio, count, duration, imageOptions, videoOptions, protocol, references, sourceWorkId], () => {
  if (!session.user) return
  try { localStorage.setItem(draftKey(), JSON.stringify({ prompt: prompt.value, model: model.value, manualSize: manualSize.value, ratio: ratio.value, count: count.value, duration: duration.value, imageOptions, videoOptions, protocol: protocol.value, sourceWorkId: sourceWorkId.value, references: references.value })) }
  catch { creation.storageError = '当前草稿无法保存到浏览器，请保留提示词。' }
  if (currentConversation.value) {
    currentConversation.value.draft = prompt.value
    currentConversation.value.mediaDraft = JSON.parse(JSON.stringify({ references: references.value, sourceWorkId: sourceWorkId.value, skipAutomaticReference: skipAutomaticReference.value }))
    void saveChats()
  }
}, { deep: true })
watch(skipAutomaticReference, () => {
  if (currentConversation.value?.mediaDraft) { currentConversation.value.mediaDraft.skipAutomaticReference = skipAutomaticReference.value; void saveChats() }
})
let restoredConversation = ''
watch(() => currentConversation.value?.id, id => {
  selectedTurns.value = []; selecting.value = false; branchTaskId.value = undefined; editing.value = false; parameterModel.value = ''; error.value = ''
  if (!id) { restoredConversation = ''; return }
  const chat = currentConversation.value!
  // Migrate the existing mode draft once; subsequent conversations own their drafts.
  if (chat.draft !== undefined || restoredConversation) prompt.value = chat.draft || ''
  references.value = chat.mediaDraft?.references?.map(file => ({ ...file })) || []
  sourceWorkId.value = chat.mediaDraft?.sourceWorkId || chat.sourceWorkId
  skipAutomaticReference.value = chat.mediaDraft?.skipAutomaticReference === true
  restoredConversation = id
})
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
  void nextTick(() => { restoringParameters.value = false })
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
  const owner = session.user?.id, chatId = currentConversation.value?.id
  try {
    if (files.length + references.value.length > (props.kind === 'video' ? 10 : 16)) throw new Error('参考图数量超过上限，请减少所选图片。')
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('参考文件请选择 PNG、JPEG 或 WebP 图片。')
      const uploaded = await uploadFile(file)
      if (owner !== session.user?.id || chatId !== currentConversation.value?.id) return
      references.value.push({ id: uploaded.id, url: uploaded.url, name: file.name })
      if (props.kind === 'video') videoOptions.mode = references.value.length > 1 ? 'reference-to-video' : 'image-to-video'
    }
  } catch (cause) { if (owner === session.user?.id && chatId === currentConversation.value?.id) error.value = errorMessage(cause) }
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
  const conversationId = chat.mediaConversationId || chat.id
  const submittedPrompt = prompt.value, submittedReferences = JSON.stringify(references.value), branchId = branchTaskId.value
  const branchEdited = editing.value
  blank.value = false
  error.value = ''; submissions.value[kind] = true
  try {
    const input: CreationInput = JSON.parse(JSON.stringify({ conversationId, kind: props.kind, model: model.value, prompt: prompt.value, size: size.value, ...(manualSize.value && manualSize.value !== 'auto' ? { exactSize: true } : {}), aspect_ratio: ratio.value, n: props.kind === 'video' ? 1 : count.value, duration: duration.value, protocol: protocol.value, references: references.value, sourceWorkId: sourceWorkId.value,
      ...(props.kind === 'image' ? { imageOptions, references: displayedReferences.value, imageContext: buildImageContext(chat, branchId) } : { videoOptions }),
      ...(branchId ? { mediaBranch: { taskId: branchId, edited: branchEdited } } : {}) }))
    await saveChats(true)
    if (owner !== session.user?.id || kind !== props.kind || chats.activeId !== chat.id || !chats.sessions.some(item => item.id === chat.id)) return
    let registered = false
    const result = await submitCreation(input, async task => {
      if (registered) return
      registered = true
      await registerMediaTurn(chat, task, branchId, branchEdited)
      if (owner === session.user?.id && chats.activeId === chat.id && kind === props.kind) {
        if (prompt.value === submittedPrompt) prompt.value = ''
        if (JSON.stringify(references.value) === submittedReferences) references.value = []
        branchTaskId.value = undefined; editing.value = false; skipAutomaticReference.value = false
        chat.draft = prompt.value
        await saveChats()
      }
    }, () => owner === session.user?.id && chats.sessions.some(item => item.id === chat.id))
    if (result.phase === 'error' && owner === session.user?.id && chats.activeId === chat.id && kind === props.kind && !prompt.value && !references.value.length) {
      prompt.value = submittedPrompt; references.value = JSON.parse(submittedReferences)
      if (branchId) { branchTaskId.value = result.id; editing.value = branchEdited }
    }
    await syncMediaConversations()
  } catch (cause) { if (owner === session.user?.id && kind === props.kind) error.value = errorMessage(cause) }
  finally { submissions.value[kind] = false }
}
async function download(task: CreationTask, index = 0) {
  try { await downloadCreation(task, index) } catch (cause) { error.value = errorMessage(cause) }
}
function openPublish(task: CreationTask, destination: CreationDestination = 'community') { emit('publish', task, destination) }
async function useTask(task: CreationTask) {
  if (restoringTask.value || task.owner !== session.user?.id) return
  restoringTask.value = true
  ensureMediaConversation(task.kind === 'video' ? 'video' : 'image', task)
  const owner = session.user?.id, chatId = currentConversation.value?.id
  try {
  if (task.group && task.group !== creation.selectedGroup) {
    if (!creation.groups.some(group => group.id === task.group)) throw new Error('原作分组当前不可用，请手动选择分组和模型。')
    await selectCreationGroup(task.group)
    if (creation.selectedGroup !== task.group) throw new Error('原作分组未能恢复，请重新选择。')
  }
  if (owner !== session.user?.id || chatId !== currentConversation.value?.id) return
  blank.value = false
  creation.selectedId = task.id; model.value = task.model; prompt.value = task.prompt
  parameterModel.value = task.model
  restoringParameters.value = true; manualSize.value = task.request.size; void nextTick(() => { restoringParameters.value = false })
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
  if (owner === session.user?.id && chatId === currentConversation.value?.id && !error.value) promptInput.value?.focus()
  } catch (cause) { if (owner === session.user?.id && chatId === currentConversation.value?.id) error.value = errorMessage(cause) }
  finally { restoringTask.value = false }
}
async function editTask(task: CreationTask) {
  await useTask(task)
  if (currentConversation.value && !error.value && task.owner === session.user?.id) {
    branchTaskId.value = task.id; editing.value = true
    void nextTick(() => promptInput.value?.focus())
  }
}
async function regenerate(task: CreationTask) {
  if (activeTask.value || submitting.value) return
  await useTask(task)
  if (error.value || task.owner !== session.user?.id) return
  branchTaskId.value = task.id; editing.value = false
  await nextTick()
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
async function copyImage(task: CreationTask, index: number) {
  const owner = session.user?.id
  try { await copyCreationImage(task, index); if (owner === session.user?.id) notify('图片已复制') }
  catch (cause) { if (owner === session.user?.id) error.value = errorMessage(cause) }
}
function version(task: CreationTask) { return currentConversation.value ? mediaVersion(currentConversation.value, task.id) : { index: 0, total: 1 } }
async function switchVersion(task: CreationTask, direction: -1 | 1) {
  if (!currentConversation.value || activeTask.value || submitting.value) return
  try { await selectMediaVersion(currentConversation.value, task.id, direction); cancelEditing() }
  catch (cause) { error.value = errorMessage(cause) }
}
async function removeTurns(ids: string[]) {
  if (!currentConversation.value || !ids.length || !confirm(`删除 ${ids.length} 轮对话记录？生成图片仍保留在图库。`)) return
  try { await deleteMediaTurns(currentConversation.value, ids); selectedTurns.value = []; cancelEditing() }
  catch (cause) { error.value = errorMessage(cause) }
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
  const chat = currentConversation.value
  if (!chat) return
  prompt.value = chat.draft || ''
  references.value = chat.mediaDraft?.references?.map(file => ({ ...file })) || []
  sourceWorkId.value = chat.mediaDraft?.sourceWorkId || chat.sourceWorkId
  skipAutomaticReference.value = chat.mediaDraft?.skipAutomaticReference === true
  branchTaskId.value = undefined; editing.value = false; error.value = ''
}
defineExpose({ newCreation, useTask, openConversation, applySourceReferences, referenceUrls, uploading, sourceWorkId, model })
</script>

<template>
  <section class="native-studio" aria-label="创作工作台">
    <header v-if="currentConversation" class="creation-conversation-header"><StudioConversationTitle :conversation="currentConversation" /><button v-if="conversationTasks.length" class="icon-button" type="button" :aria-pressed="selecting" aria-label="多选消息" title="多选消息" @click="selecting = !selecting; selectedTurns = []"><ListChecks :size="18" /></button></header>
    <div v-if="selecting" class="creation-selection" role="group" aria-label="消息多选操作"><label><input type="checkbox" aria-label="全选当前消息" :checked="!!conversationTasks.length && selectedTurns.length === conversationTasks.length" @change="selectedTurns = ($event.target as HTMLInputElement).checked ? conversationTasks.map(task => task.id) : []" />全选</label><span role="status">已选 {{ selectedTurns.length }} 轮</span><button class="icon-button" type="button" :disabled="!selectedTurns.length || !!activeTask || submitting" aria-label="删除所选消息" title="删除所选消息" @click="removeTurns(selectedTurns)"><Trash2 :size="17" /></button><button class="icon-button" type="button" aria-label="退出消息多选" title="退出多选" @click="selecting = false; selectedTurns = []"><X :size="17" /></button></div>
    <div class="creation-output">
      <div ref="canvas" class="creation-canvas" :class="{ 'has-result': selected?.phase === 'complete' }" tabindex="0" aria-label="创作对话" @scroll="trackScroll">
        <div v-if="conversationTasks.length" ref="transcript" class="creation-conversation">
          <div v-for="selected in conversationTasks" :key="selected.id" class="creation-turn">
          <label v-if="selecting" class="creation-select-turn"><input v-model="selectedTurns" type="checkbox" :value="selected.id" :aria-label="`选择消息：${selected.prompt}`" /><span class="studio-sr-only">选择此轮</span></label>
          <article class="creation-request" aria-label="已发送的创作请求">
            <header class="creation-message-heading"><span class="creation-avatar" aria-hidden="true">{{ (session.user?.name || session.user?.username || '你').slice(0, 1) }}</span><strong>你</strong><time>{{ new Date(selected.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</time></header>
            <div class="creation-request-body"><p>{{ selected.prompt }}</p><div v-if="selected.references.length" class="sent-references"><img v-for="(file, index) in selected.references" :key="file.url" :src="mediaSource(file.url)" :alt="`参考图 ${index + 1}：${file.name}`" loading="lazy" /></div></div>
            <div class="request-summary"><span>{{ selected.request.aspect_ratio === 'auto' ? '自动比例' : selected.request.aspect_ratio }}</span><span>{{ kind === 'video' ? `${selected.request.duration} 秒视频` : `${selected.request.n} 张图片` }}</span><span v-if="selected.request.imageOptions?.resolution">{{ selected.request.imageOptions.resolution === 'auto' ? '自动分辨率' : selected.request.imageOptions.resolution.toUpperCase() }}</span></div>
            <div class="creation-turn-tools"><button class="icon-button" type="button" aria-label="编辑并重新生成" title="编辑并重新生成" :disabled="!!activeTask || submitting || ['paused', 'attention'].includes(selected.phase)" @click="editTask(selected)"><Pencil :size="15" /></button><button class="icon-button" type="button" aria-label="删除此轮消息" title="删除此轮消息" :disabled="!!activeTask || submitting" @click="removeTurns([selected.id])"><Trash2 :size="15" /></button></div>
          </article>
          <article class="creation-response" aria-label="模型生成结果">
            <header class="creation-message-heading"><img src="/assets/brand/octopus-community.jpg" width="28" height="28" alt="" /><strong>{{ selected.model }}</strong><span v-if="elapsed(selected)" class="task-elapsed" :title="'从首次提交起计算，包含暂停等待的时间'"><Clock :size="13" />{{ working(selected) ? '已等待' : '自提交起' }} {{ elapsed(selected) }}</span></header>
            <div class="task-status"><div :role="selected.phase === 'error' || selected.phase === 'attention' ? 'alert' : 'status'"><LoaderCircle v-if="working(selected)" :size="18" /><Check v-else-if="selected.phase === 'complete'" :size="18" /><strong>{{ phases[selected.phase] }}</strong><span v-if="selected.progress != null && working(selected)">{{ Math.round(selected.progress) }}%</span></div><button v-if="selected.phase === 'paused' || selected.phase === 'attention'" class="button subtle btn" @click="resumeCreation(selected)"><Play :size="15" />继续查询</button><button v-else-if="selected.phase === 'error'" class="button subtle btn" @click="editTask(selected)"><Pencil :size="15" />编辑后重试</button></div>
            <p v-if="selected.error" class="task-message">{{ selected.error }}</p>
            <div v-if="working(selected)" class="generation-feedback">
              <p>{{ waitingMessage(selected) }}</p>
              <ol class="generation-steps" aria-label="生成阶段"><li :class="{ current: selected.phase === 'submitting', done: selected.phase === 'running' }"><Check v-if="selected.phase === 'running'" :size="13" />发送请求</li><li :class="{ current: selected.phase === 'running' }">模型生成</li><li>结果就绪</li></ol>
              <progress v-if="selected.progress != null" :value="selected.progress" max="100" aria-label="模型返回的生成进度" />
              <p v-if="now - selected.createdAt >= 30000" class="long-wait">等待时间较长，你可以继续编辑提示词或停止本页等待，稍后查询这次任务。</p>
            </div>
            <img v-if="selected.preview && selected.phase !== 'complete'" class="stream-preview" :src="mediaSource(selected.preview)" alt="生成中的预览" />
            <div v-if="selected.urls.length" class="creation-media"><figure v-for="(url, index) in selected.urls" :key="url"><video v-if="selected.kind === 'video'" :src="mediaSource(url, false, 'video')" controls playsinline preload="metadata" /><template v-else><StudioCreationImage :src="mediaSource(url) || ''" :alt="selected.prompt" :label="`查看大图：预览生成图片 ${index + 1}`" @open="gallery?.open(selected, index)" /><figcaption class="creation-image-tools"><button class="icon-button" type="button" :aria-label="`使用第 ${index + 1} 张图片继续创作`" title="使用此图继续创作" :disabled="selected.phase !== 'complete'" @click="chooseReference(selected, index)"><ImagePlus :size="16" /></button><button class="icon-button" type="button" :aria-label="`复制第 ${index + 1} 张图片`" title="复制图片" @click="copyImage(selected, index)"><Copy :size="16" /></button></figcaption></template></figure></div>
            <div v-else-if="selected.text" class="creation-text"><pre>{{ selected.text }}</pre></div>
            <div v-if="selected.phase === 'complete'" class="creation-message-actions" role="group" aria-label="生成结果操作">
              <button class="studio-tool" @click="openPublish(selected)"><Upload :size="15" />发布作品</button>
              <button v-for="(url, index) in selected.urls" :key="url" class="studio-tool" @click="download(selected, index)"><Download :size="16" />下载{{ selected.urls.length > 1 ? ` ${index + 1}` : '' }}</button>
              <button v-if="!selected.urls.length && selected.text" class="studio-tool" @click="download(selected)"><Download :size="16" />下载文本</button>
              <button v-if="selected.kind !== 'video' && selected.sourceWorkId" class="studio-tool" @click="openPublish(selected, 'source-comment')"><Upload :size="15" />发送到源作品评论区</button>
              <button class="studio-tool" @click="useTask(selected)"><Pencil :size="15" />复用参数</button>
              <button class="icon-button" type="button" aria-label="重新生成此轮" title="重新生成此轮" :disabled="!!activeTask || submitting" @click="regenerate(selected)"><RefreshCw :size="16" /></button>
            </div>
            <div v-if="version(selected).total > 1" class="creation-versions" role="group" aria-label="生成版本"><button class="icon-button" type="button" aria-label="上一个版本" title="上一个版本" :disabled="version(selected).index === 0 || !!activeTask || submitting" @click="switchVersion(selected, -1)"><ChevronLeft :size="16" /></button><output aria-label="当前生成版本">{{ version(selected).index + 1 }} / {{ version(selected).total }}</output><button class="icon-button" type="button" aria-label="下一个版本" title="下一个版本" :disabled="version(selected).index >= version(selected).total - 1 || !!activeTask || submitting" @click="switchVersion(selected, 1)"><ChevronRight :size="16" /></button></div>
          </article>
          </div>
        </div>
        <div v-else class="canvas-empty"><img src="/assets/brand/octopus-community.jpg" width="40" height="40" alt="" /><p>{{ kind === 'video' ? '开始视频创作' : '开始图片创作' }}</p><span>写下你的想法，也可以添加参考图。</span></div>
      </div>
    </div>
    <StudioBilling :model="model" :quantity="kind === 'image' ? count : undefined" :refresh-key="selected?.settledAt" @prices="emit('prices')"><StudioModePicker /></StudioBilling>
    <form class="creation-controls studio-composer" aria-label="创作参数" @submit.prevent="generate" @dragover.prevent @drop="dropReferences">
      <div v-if="branchTaskId" class="creation-editing" role="status"><Pencil :size="14" /><span>{{ editing ? '编辑此轮' : '重新生成此轮' }}</span><button class="icon-button" type="button" aria-label="取消编辑此轮" title="取消编辑" @click="cancelEditing"><X :size="16" /></button></div>
      <ul v-if="displayedReferences.length" class="reference-list"><li v-for="(file, index) in displayedReferences" :key="file.url"><img :src="mediaSource(file.url)" :alt="automaticReferences.length ? '接着上一张生成图修改' : file.name" :title="automaticReferences.length ? '接着上一张生成图修改' : file.name" /><button type="button" class="icon-button" :aria-label="`移除参考图 ${index + 1}`" title="移除参考图" @click="removeReference(index)"><X :size="14" /></button></li></ul>
      <label class="field prompt-field"><span class="studio-sr-only">提示词</span><StudioVideoPrompt v-if="kind === 'video'" ref="promptInput" v-model="prompt" :references="references" @submit="generate" @paste="pasteReferences" /><textarea v-else ref="promptInput" v-model="prompt" class="composer-input creation-prompt" rows="1" maxlength="100000" placeholder="发消息，描述你的想法…" required @keydown.enter="handleEnter" @paste="pasteReferences" /></label>
      <div class="studio-composer-tools">
        <div class="studio-composer-actions"><label class="reference-upload studio-tool composer-attachment" title="添加参考图"><LoaderCircle v-if="uploading" :size="18" /><Plus v-else :size="20" /><input type="file" aria-label="添加参考图" accept="image/jpeg,image/png,image/webp" multiple :disabled="uploading || references.length >= (kind === 'video' ? 10 : 16)" @change="addReferences" /></label>
          <StudioPopover label="高级参数" :width="480"><template #trigger><SlidersHorizontal :size="17" /><span>高级参数</span></template>
            <div class="parameter-row"><label class="field"><span>画面比例</span><select v-model="ratio" class="control"><option v-if="!(IMAGE_RATIOS as readonly string[]).includes(ratio)" :value="ratio">{{ ratio }}</option><option v-for="value in IMAGE_RATIOS" :key="value" :value="value">{{ value === 'auto' ? '自动' : value }}</option></select></label><label v-if="kind === 'image'" class="field"><span>图片数量</span><input v-model.number="count" class="control" type="number" min="1" max="16" step="1" required /></label><label v-else class="field"><span>时长（秒）</span><select v-if="videoLimits" v-model.number="duration" class="control"><option v-if="!videoLimits.durations.includes(duration)" :value="duration">{{ duration }}（当前模型不支持）</option><option v-for="value in videoLimits.durations" :key="value" :value="value">{{ value }}</option></select><input v-else v-model.number="duration" class="control" type="number" min="1" max="3600" step="1" required /></label><label class="field"><span>尺寸</span><input v-model="size" class="control" pattern="auto|[1-9][0-9]{0,4}x[1-9][0-9]{0,4}|[124]K" required /></label></div>
            <CreationAdvanced :image="imageOptions" :video="videoOptions" v-model:protocol="protocol" :kind="kind" :model="model" embedded @update:image="Object.assign(imageOptions, $event)" @update:video="Object.assign(videoOptions, $event)" />
          </StudioPopover>
          <button class="studio-tool" type="button" aria-label="清除上下文" title="清除上下文" :disabled="!conversationTasks.length || !!activeTask || submitting" @click="clearContext"><Eraser :size="17" /></button>
        </div>
        <div class="studio-composer-models"><StudioModelPicker v-model="model" :kind="kind" @keys="emit('keys')" /></div>
        <button v-if="activeTask" type="button" class="composer-submit generation-button" title="停止本页等待，上游任务可能继续执行" aria-label="停止等待" @click="stopCreation(activeTask)"><Square :size="17" /><span class="mobile-send-label">停止</span></button>
        <button v-else class="composer-submit generation-button" :title="submitting ? '正在准备…' : '开始生成'" :aria-label="submitting ? '正在准备…' : '开始生成'" :disabled="!canGenerate"><LoaderCircle v-if="submitting" :size="18" /><ArrowUp v-else :size="21" /><span class="mobile-send-label">生成</span></button>
      </div>
      <p v-if="selectedGroup?.description && selectedGroup.description !== selectedGroup.name" class="group-description">{{ selectedGroup.description }}</p>
      <p v-if="creation.groupSwitching" class="group-description" role="status">正在切换模型分组…</p>
      <p v-if="activeTask" class="composer-hint">生成期间可以继续编辑。停止等待不会取消上游任务。</p>
      <p v-if="creation.groupsError" class="form-error" role="alert">{{ creation.groupsError }} <button type="button" class="text-link" :disabled="creation.groupSwitching" @click="loadCreationGroups">重试</button></p>
      <p v-if="creation.modelsError" class="form-error" role="alert">{{ creation.modelsError }} <button type="button" class="text-link" @click="loadCreationModels">重试</button></p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="creation.storageError" class="form-error" role="alert">{{ creation.storageError }}</p>
      <p v-if="videoParameterIssue" class="form-error" role="alert">{{ videoParameterIssue }}</p>
      <p v-if="imageParameterIssue" class="form-error" role="alert">{{ imageParameterIssue }}</p>
    </form>

    <StudioGallery ref="gallery" :kind="kind" preview-only />
  </section>
</template>

<style scoped>
.native-studio { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.creation-conversation-header { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; min-height: 44px; }
.creation-selection, .creation-editing, .creation-select-turn, .creation-turn-tools, .creation-image-tools, .creation-versions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.creation-selection { flex: none; min-height: 44px; padding-inline: 8px; color: var(--muted); font-size: 13px; }
.creation-selection label { display: flex; align-items: center; gap: 8px; }.creation-selection > span { margin-inline-end: auto; }
.creation-turn { position: relative; }.creation-select-turn { position: absolute; inset-inline-start: 0; top: 0; min-height: 28px; }
.creation-turn:has(> .creation-select-turn) { padding-inline-start: 32px; }
.creation-turn-tools { justify-content: flex-end; }.creation-turn-tools .icon-button, .creation-image-tools .icon-button { width: 32px; min-height: 32px; }
.creation-image-tools { justify-content: flex-start; margin-top: 4px; }.creation-versions { margin-top: 8px; width: fit-content; }
.creation-versions output { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; min-width: 40px; text-align: center; }
.creation-editing { padding: 0 8px 8px; color: var(--muted); font-size: 13px; }.creation-editing > button { margin-inline-start: auto; }
.task-status, .task-status > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
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
.creation-output { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.stream-preview { display: block; max-width: 100%; max-height: 480px; margin: auto; }
.creation-canvas { flex: 1; min-height: 0; display: block; margin: 0; background: transparent; overflow-y: auto; overscroll-behavior: contain; padding: 16px 8px; scrollbar-color: var(--border) transparent; }
.canvas-empty { min-height: 160px; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: var(--muted); text-align: center; }
.canvas-empty img { border-radius: 10px; }.canvas-empty p { margin: 0; }
.canvas-empty > span { font-size: 14px; }
.creation-conversation { width: min(100%, 960px); margin-inline: auto; padding-block: 8px 24px; }
.creation-turn + .creation-turn { margin-top: 32px; }
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
.creation-image-preview { position: relative; display: block; width: fit-content; max-width: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.creation-image-preview:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 4px; }
.composer-hint { color: var(--muted); font-size: 12px; line-height: 20px; margin: 4px 8px 0; }
@media (hover: none), (pointer: coarse) { .keyboard-hint { display: none; } }
@media (max-width: 639px) { .creation-request { max-width: 92%; margin-bottom: 28px; }.creation-request-body { padding: 12px; }.creation-message-heading { gap: 6px; }.creation-response .task-elapsed { flex-basis: 100%; padding-left: 36px; }.generation-steps { gap: 12px; }.creation-conversation { padding-bottom: 12px; }.creation-message-actions { gap: 4px; } }
.task-status { min-height: 40px; margin-bottom: 16px; }
.task-status > div { justify-content: flex-start; flex-wrap: wrap; }
.task-message { color: var(--amber); font-size: 14px; line-height: 24px; margin-block: 0 16px; overflow-wrap: anywhere; }
.creation-media { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 16px; }
.creation-media figure { margin: 0; min-width: 0; }
.creation-media img, .creation-media video { max-width: 100%; max-height: 600px; display: block; object-fit: contain; }
.creation-media img { width: auto; height: auto; }
.creation-media video { width: 100%; }
@media (min-width: 1000px) {
  .creation-conversation { width: 100%; padding-block: 8px 24px; }
  .creation-request { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; width: 100%; max-width: none; margin: 0 0 12px; }
  .creation-request > .creation-message-heading { display: none; }
  .creation-request-body { padding: 0; border-radius: 0; background: transparent; }
  .creation-request-body p { font-size: 16px; line-height: 28px; }
  .request-summary { justify-content: flex-start; margin-top: 0; }
  .creation-response > .creation-message-heading { margin-bottom: 8px; }
  .creation-response .task-status { min-height: 24px; margin-bottom: 12px; }
  .creation-media { max-width: 880px; gap: 4px; }
  .creation-media img { max-height: min(440px, 32dvh); }
  .creation-media video { height: min(440px, 32dvh); background: var(--surface); }
  .creation-canvas { padding: 16px 0; }
}
.creation-text pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 28px; margin: 0 0 16px; max-width: 72ch; }
@media (max-width: 639px) { .creation-canvas { padding: 16px 0; }.creation-media img, .creation-media video { max-height: 44dvh; } }
@media (pointer: coarse), (max-width: 639px) { .creation-turn-tools .icon-button, .creation-image-tools .icon-button { min-height: 44px; width: 44px; } }
</style>
