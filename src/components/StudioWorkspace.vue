<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { ArrowUp, Eraser, LoaderCircle, Pencil, Plus, SlidersHorizontal, Square, X } from '@lucide/vue'
import type { Work, WorkFile } from '../data'
import { errorMessage, notify, session } from '../state'
import { creation, initializeCreation, loadCreationGroups, loadCreationModels, selectCreationGroup, submitCreation, type CreationTask, type CreationDestination, type CreationInput } from '../native-studio'
import { chats, createEmptyChat, flushChats, newChat, saveChats, type NativeChat } from '../native-chat'
import { createDeferredWriteQueue } from '../../shared/studio/latest-write-queue'
import { ensureMediaConversation, isConversationBusy, mediaTasksForConversation, syncMediaConversations } from '../studio-conversations'
import { buildImageContext, clearMediaContext, pinnedImageReferences, registerMediaTurn } from '../studio-image-conversation'
import StudioMediaParameters from './StudioMediaParameters.vue'
import StudioPopover from './StudioPopover.vue'
import StudioModePicker from './StudioModePicker.vue'
import StudioSkillPicker from './StudioSkillPicker.vue'
import { resolveMediaSkills, resolveRemixSkills, setSelectedSkillIds } from '../community-skill'
import StudioBilling from './StudioBilling.vue'
import StudioModelPicker from './StudioModelPicker.vue'
import StudioVideoPrompt from './StudioVideoPrompt.vue'
import StudioReferenceAttachments from './StudioReferenceAttachments.vue'
import StudioMaterialStatus from './studio-message/StudioMaterialStatus.vue'
import { useStudioMaterials, type StudioFile } from '../use-studio-materials'
import { remapVideoMentions } from '../../shared/studio/video-mentions'
import { modelsForKind, takeModelChoice } from '../model-preferences'
import { imageOptionsSchema, videoOptionsSchema } from '../../shared/studio/options'
import { modelApiFormatSchema, type ModelApiFormat } from '../../shared/studio/model-types'
import { imageRequestSize, usesGeminiImageChat } from '../../shared/studio/image-params'
import { normalizeVideoParameters, videoCapabilities } from '../../shared/studio/video-capabilities'
import { selectedVideoSize } from '../../shared/studio/video-size'
import { readRemixParameters } from '../../shared/studio/remix-parameters'
import { remixVideoMode } from '../studio-remix'
import { studioPreferences } from '../studio-preferences'
import { shouldSubmit } from '../../shared/studio/submit-key'
import { createImeGuard } from '../../shared/studio/ime-input'
import type { StudioEntry } from '../studio-entry'

const props = defineProps<{ kind: 'image' | 'video'; source?: Work | null; sourceBlocked?: boolean; remixPreparing?: boolean; entryOnly?: boolean; entryPending?: boolean }>()
const emit = defineEmits<{ prices: []; keys: []; publish: [task: CreationTask, destination: CreationDestination]; source: [id?: string]; remixError: [message: string]; model: []; entry: [value: StudioEntry]; kind: [value: 'text' | 'image' | 'video', model: string] }>()
const model = ref(''), prompt = ref(''), ratio = ref('auto'), count = ref(1), duration = ref(8)
const ime = createImeGuard()
const imageOptions = reactive(imageOptionsSchema.parse({}))
const videoOptions = reactive(videoOptionsSchema.parse({ mode: 'text-to-video' }))
const protocol = ref('auto'), apiFormat = ref<ModelApiFormat>('auto')
const manualSize = ref(''), restoringParameters = ref(false)
const remixApplied = ref(false)
const selectedModel = computed(() => creation.models.find(item => item.id === model.value))
const selectedApiFormat = computed(() => apiFormat.value === 'auto' ? selectedModel.value?.apiFormat : apiFormat.value)
const videoSetting = computed(() => selectedModel.value?.video)
const videoLimits = computed(() => videoCapabilities(model.value, videoOptions.mode, videoSetting.value))
const upscale = computed(() => props.kind === 'video' && videoSetting.value?.operation === 'upscale')
const referenceLimit = computed(() => upscale.value ? 1 : props.kind === 'video' ? 10 : 16)
const sourceVideo = computed(() => references.value.length === 1 && references.value[0]?.type?.startsWith('video/') ? references.value[0] : undefined)
const billingDuration = computed(() => upscale.value ? sourceVideo.value?.duration ? Math.ceil(sourceVideo.value.duration) : undefined : props.kind === 'video' ? duration.value : undefined)
const references = ref<CreationTask['references']>([])
const sourceWorkId = ref<string>()
const submissions = ref<Record<string, boolean>>({}), error = ref(''), waitingForMaterials = ref(false)
const promptInput = ref<HTMLTextAreaElement | InstanceType<typeof StudioVideoPrompt>>()
const blank = ref(false)
const branchTaskId = ref<string>(), editing = ref(false)
const imageEditTaskId = ref<string>()
const restoringTask = ref(false), parameterModel = ref('')
const submitting = computed(() => Boolean(props.entryPending || submissions.value[props.kind]))
const referenceUrls = computed(() => references.value.map(file => file.url))
const currentConversation = computed(() => props.entryOnly ? undefined : chats.sessions.find(chat => chat.id === chats.activeId))
const entryChat = ref(createEmptyChat())
const skillChat = computed(() => currentConversation.value || entryChat.value)
watch(() => session.user?.id, () => { entryChat.value = createEmptyChat() })
const composerReady = computed(() => props.entryOnly || chats.ready && !!currentConversation.value && !chats.initialSaving[currentConversation.value.id])
const currentTasks = computed(() => currentConversation.value ? mediaTasksForConversation(currentConversation.value) : [])
const selected = computed(() => blank.value ? undefined : currentTasks.value.find(task => task.id === creation.selectedId) || currentTasks.value[0])
const busy = computed(() => currentConversation.value && isConversationBusy(currentConversation.value))
const models = computed(() => modelsForKind(props.kind))
const selectedGroup = computed(() => creation.groups.find(group => group.id === creation.selectedGroup))
const videoParameterIssue = computed(() => {
  if (props.kind !== 'video' || !model.value) return ''
  if (upscale.value) {
    if (!sourceVideo.value || !/^\/legacy-files\/[A-Za-z0-9]{1,32}$/.test(sourceVideo.value.url)) return '视频超分需要上传一个 MP4 源视频。'
    return videoOptions.resolution !== 'auto' && videoLimits.value?.resolutions.length && !videoLimits.value.resolutions.includes(videoOptions.resolution) ? '当前模型不支持所选分辨率。' : ''
  }
  if (references.value.some(file => file.type?.startsWith('video/'))) return '当前视频生成模型仅支持图片参考，请移除源视频。'
  if (!Number.isInteger(duration.value) || duration.value < 1 || duration.value > 3600) return '视频时长需为 1 到 3600 的整数秒。'
  const limits = videoLimits.value
  if (limits?.durations.length && !limits.durations.includes(duration.value) || videoOptions.resolution !== 'auto' && limits?.resolutions.length && !limits.resolutions.includes(videoOptions.resolution)) return '原作时长或分辨率不受当前模型支持，请在高级参数中调整。'
  if (ratio.value !== 'auto' && limits?.aspectRatios?.length && !limits.aspectRatios.includes(ratio.value)) return '当前模型不支持所选画面比例，请在高级参数中调整。'
  if (size.value !== 'auto' && limits?.sizes && !Object.values(limits.sizes).some(ratios => Object.values(ratios).includes(size.value))) return '当前模型不支持所选精确尺寸，请在高级参数中调整。'
  return ''
})
const imageCountIssue = computed(() => props.kind === 'image' && (!Number.isInteger(count.value) || count.value < 1 || count.value > 10) ? '图片数量需为 1 到 10 的整数。' : '')
const submissionIssue = computed(() => error.value || imageCountIssue.value || videoParameterIssue.value)
const referenceLimitIssue = computed(() => references.value.length > referenceLimit.value ? upscale.value ? '视频超分每次仅支持一个源视频。' : '参考图数量超过当前创作类型上限，请减少所选图片。' : '')
const canGenerate = computed(() => composerReady.value && !referenceLimitIssue.value && !imageCountIssue.value && !busy.value && !props.sourceBlocked && (!props.source || sourceWorkId.value === props.source.id) && !videoParameterIssue.value && !submitting.value && !materials.failed.value && !restoringTask.value && !creation.modelLaunchPending && !creation.groupsLoading && !creation.groupSwitching && !creation.modelsLoading && (props.entryOnly && !session.user || models.value.some(item => item.id === model.value)) && (upscale.value ? !!sourceVideo.value : Boolean(prompt.value.trim())))
let live = true, draftRevision = 0, restoreRevision = 0
let materialSubmission: AbortController | undefined
function createDraftWrites() {
  return createDeferredWriteQueue(async ({ key, owner, draft }: { key: string; owner: string; draft: NativeChat['mediaDraft'] }) => {
    try { localStorage.setItem(key, JSON.stringify(draft)) }
    catch { if (owner === session.user?.id) creation.storageError = '当前草稿无法保存到浏览器，请保留提示词。' }
  }, 200)
}
let draftWrites = createDraftWrites()
function flushDrafts() { void draftWrites.flush(); void flushChats() }
function flushHiddenDrafts() { if (document.visibilityState === 'hidden') flushDrafts() }
window.addEventListener('pagehide', flushDrafts)
document.addEventListener('visibilitychange', flushHiddenDrafts)
onUnmounted(() => {
  flushDrafts(); live = false; draftRevision++; materialSubmission?.abort()
  window.removeEventListener('pagehide', flushDrafts)
  document.removeEventListener('visibilitychange', flushHiddenDrafts)
})
const draftScope = () => `${session.user?.id}:${currentConversation.value?.id}:${props.kind}:${draftRevision}`
const referenceFiles = computed<StudioFile[]>({
  get: () => references.value.map(file => ({
    name: file.name, content: file.url, type: file.type || /^data:([^;,]+)/.exec(file.url)?.[1] || 'image/png', size: 0, isText: false,
    referenceId: file.id, fromWorkId: file.fromWorkId, duration: file.duration,
  })),
  set: files => {
    const next = files.map(file => ({ name: file.name, url: file.content, id: file.referenceId, fromWorkId: file.fromWorkId, type: file.type, duration: file.duration }))
    if (props.kind === 'video' && !upscale.value) prompt.value = remapVideoMentions(prompt.value, references.value.map(file => file.url), next.map(file => file.url))
    references.value = next
    if (props.kind === 'video' && !upscale.value) videoOptions.mode = remixVideoMode(videoOptions.mode, next.length)
  },
})
const materials = useStudioMaterials(referenceFiles, computed(() => `${session.user?.id}:${currentConversation.value?.id}:${props.kind}`), {
  limit: referenceLimit, imagesOnly: true, videoOnly: upscale,
})
const uploading = materials.pending
const materialIssues = computed(() => materials.snapshot.value.items.filter(item => item.status !== 'ready'))
function finishRestore() {
  const scope = draftScope(), revision = ++restoreRevision
  void nextTick(() => { if (live && scope === draftScope() && revision === restoreRevision) restoringParameters.value = false })
}
const automaticSize = computed(() => props.kind === 'video' ? upscale.value || videoSetting.value?.sendSize === false ? 'auto' : selectedVideoSize({ resolution: videoOptions.resolution, aspectRatio: ratio.value }, videoSetting.value) : imageRequestSize(ratio.value, imageOptions.resolution, model.value, selectedApiFormat.value))
const size = computed({ get: () => manualSize.value || automaticSize.value, set: (value: string) => { manualSize.value = value.trim() } })
const requestSize = computed(() => props.kind === 'video' && (upscale.value || videoSetting.value?.sendSize === false) ? 'auto' : props.kind === 'image' && (!manualSize.value || manualSize.value === 'auto') && (imageOptions.resolution === 'auto' || ratio.value === 'auto') ? 'auto' : size.value)
const draftKey = () => `octopus:user-${session.user?.id}:native-creation-draft:${props.kind}`
function adaptVideoParameters() {
  if (props.kind !== 'video' || !model.value) return
  if (upscale.value) {
    manualSize.value = ''; ratio.value = 'auto'
    if (videoOptions.resolution === 'auto' || !videoLimits.value?.resolutions.includes(videoOptions.resolution)) videoOptions.resolution = videoLimits.value?.autoResolution || videoLimits.value?.resolutions[0] || 'auto'
    return
  }
  const next = normalizeVideoParameters({ model: model.value, mode: videoOptions.mode, resolution: videoOptions.resolution,
    duration: duration.value, aspectRatio: ratio.value, size: size.value }, videoSetting.value)
  if (next.resolution !== videoOptions.resolution || next.aspectRatio !== ratio.value || next.size !== size.value) manualSize.value = ''
  videoOptions.resolution = next.resolution; duration.value = next.duration; ratio.value = next.aspectRatio
}
function chooseModel() {
  if (props.remixPreparing || creation.modelLaunchPending || restoringTask.value || parameterModel.value || !creation.modelsLoaded || creation.modelsLoading || creation.groupsLoading || creation.groupSwitching) return
  const initializing = !model.value
  const choice = takeModelChoice(props.kind, models.value)
  if (choice) {
    if (model.value !== choice) manualSize.value = ''
    model.value = choice
  }
  else if (!models.value.some(item => item.id === model.value)) model.value = models.value[0]?.id || ''
  if (initializing && props.kind === 'video') duration.value = videoLimits.value?.autoDuration ?? duration.value
  adaptVideoParameters()
}
function legacyApiFormat(value: string): ModelApiFormat {
  return props.kind === 'image' ? usesGeminiImageChat(value) ? 'chat-completions' : 'images' : 'openai'
}
function loadDraft() {
  void draftWrites.flush()
  draftWrites = createDraftWrites()
  materialSubmission?.abort()
  if (props.entryOnly) {
    draftRevision++; model.value = ''; manualSize.value = ''; ratio.value = 'auto'
    if (props.kind === 'video') videoOptions.mode = remixVideoMode(videoOptions.mode, references.value.length)
    chooseModel(); return
  }
  restoringParameters.value = true
  draftRevision++
  branchTaskId.value = undefined; imageEditTaskId.value = undefined; editing.value = false; parameterModel.value = ''
  finishRestore()
  blank.value = false
  sourceWorkId.value = undefined
  prompt.value = ''; model.value = ''; manualSize.value = ''; ratio.value = 'auto'; count.value = 1; duration.value = 8; references.value = []; error.value = ''
  Object.assign(imageOptions, imageOptionsSchema.parse({})); Object.assign(videoOptions, videoOptionsSchema.parse({ mode: 'text-to-video' })); protocol.value = 'auto'; apiFormat.value = 'auto'
  if (!session.user) return
  try {
    const chat = currentConversation.value
    const saved = chat?.mediaDrafts?.[props.kind] || (chat?.creationKind === props.kind && !chat.mediaDrafts && (chat.mediaDraft || chat.draft) ? { ...chat.mediaDraft, prompt: chat.draft || '' } : null) ||
      (!chat?.messages.length && !chat?.mediaDrafts ? JSON.parse(localStorage.getItem(draftKey()) || 'null') : null)
    if (saved && typeof saved.prompt === 'string') {
      prompt.value = saved.prompt; model.value = typeof saved.model === 'string' ? saved.model : ''
      ratio.value = typeof saved.ratio === 'string' && /^(?:auto|[1-9]\d{0,2}:[1-9]\d{0,2})$/.test(saved.ratio) ? saved.ratio : ratio.value
      manualSize.value = typeof saved.manualSize === 'string' && /^(?:auto|[1-9]\d{0,4}x[1-9]\d{0,4}|[124]K)$/.test(saved.manualSize) ? saved.manualSize : ''
      count.value = Math.min(10, Math.max(1, Number(saved.count) || 1)); duration.value = Math.min(3600, Math.max(1, Number(saved.duration) || 8))
      const image = imageOptionsSchema.safeParse(saved.imageOptions || {}), video = videoOptionsSchema.safeParse(saved.videoOptions || { mode: 'text-to-video' })
      if (image.success) Object.assign(imageOptions, image.data)
      if (video.success) Object.assign(videoOptions, video.data)
      protocol.value = ['auto', 'openai', 'sync', 'async'].includes(saved.protocol) ? saved.protocol : 'openai'
      apiFormat.value = modelApiFormatSchema.safeParse(saved.apiFormat).data ?? legacyApiFormat(model.value)
      if (typeof saved.sourceWorkId === 'string') sourceWorkId.value = saved.sourceWorkId
      if (props.kind === 'image' && typeof saved.imageEditTaskId === 'string') imageEditTaskId.value = saved.imageEditTaskId
      if (Array.isArray(saved.references)) references.value = saved.references.filter((file: any) => file && typeof file.url === 'string' && typeof file.name === 'string').slice(0, props.kind === 'video' ? 10 : 16)
    }
  } catch { /* A malformed local draft does not prevent creation. */ }
  chooseModel()
}
watch([() => props.kind, () => session.user?.id, () => currentConversation.value?.id], loadDraft, { immediate: true })
watch(() => session.user?.id, () => {
  if (!props.entryOnly) return
  prompt.value = ''; references.value = []; error.value = ''; count.value = 1; duration.value = 8
  Object.assign(imageOptions, imageOptionsSchema.parse({})); Object.assign(videoOptions, videoOptionsSchema.parse({ mode: 'text-to-video' }))
  protocol.value = 'auto'; apiFormat.value = 'auto'
})
watch([models, () => creation.modelsLoaded, () => creation.groupsLoading, () => creation.groupSwitching, () => props.remixPreparing, () => creation.modelLaunchPending], chooseModel)
// Only editable parameters adapt; saved requests and restored originals remain unchanged.
watch([model, () => videoOptions.mode, videoSetting], () => { if (!creation.modelLaunchPending && !restoringParameters.value) adaptVideoParameters() }, { deep: true, flush: 'sync' })
watch([ratio, () => imageOptions.resolution, () => videoOptions.resolution, model], () => { if (!creation.modelLaunchPending && !restoringParameters.value) manualSize.value = '' })
watch([prompt, model, manualSize, ratio, count, duration, imageOptions, videoOptions, protocol, apiFormat, references, sourceWorkId, imageEditTaskId, restoringParameters], () => {
  if (props.entryOnly || creation.modelLaunchPending || !session.user || restoringParameters.value || !live || props.remixPreparing && !remixApplied.value) return
  const draft = { prompt: prompt.value, model: model.value, manualSize: manualSize.value, ratio: ratio.value, count: count.value, duration: duration.value,
    imageOptions: { ...imageOptions }, videoOptions: { ...videoOptions }, protocol: protocol.value, apiFormat: apiFormat.value,
    sourceWorkId: sourceWorkId.value, references: references.value.map(file => ({ ...file })), imageEditTaskId: imageEditTaskId.value }
  void draftWrites({ key: draftKey(), owner: session.user.id, draft })
  if (currentConversation.value) {
    currentConversation.value.mediaDrafts ||= {}
    currentConversation.value.mediaDrafts[props.kind] = draft
    void saveChats()
  }
}, { deep: true, flush: 'sync' })
watch(model, value => { if (!restoringTask.value && value !== parameterModel.value) parameterModel.value = '' })
watch([model, selectedApiFormat, () => props.kind, restoringParameters], () => {
  if (creation.modelLaunchPending || restoringParameters.value || props.kind !== 'image' || !usesGeminiImageChat(model.value, selectedApiFormat.value)) return
  manualSize.value = ''; imageOptions.seed = ''; count.value = 1
})
function modelChanged() {
  adaptVideoParameters()
  if (props.source && model.value !== props.source.model) { apiFormat.value = 'auto'; protocol.value = 'auto' }
  error.value = ''; emit('model')
}
watch([() => props.source, () => chats.ready], async () => {
  if (!props.source || !chats.ready || sourceWorkId.value === props.source.id) return
  const owner = session.user?.id, source = props.source, conversation = currentConversation.value
  try { await applyRemix(source) }
  catch (cause) { if (live && owner === session.user?.id && source === props.source && conversation === currentConversation.value) emit('remixError', errorMessage(cause)) }
}, { immediate: true })
async function applyRemix(source: Work, initialFiles: StudioFile[] = [], fresh = false, isCurrent = () => true) {
  const owner = session.user?.id, kind = props.kind
  if (!owner || !chats.ready || source.kind !== kind) return false
  const previous = currentConversation.value, parameters = readRemixParameters(source.generation?.parameters)
  const selected = parameters?.skills || []
  const skills = await resolveRemixSkills(selected, kind, owner)
  if (!live || !isCurrent() || owner !== session.user?.id || kind !== props.kind || previous !== currentConversation.value || !fresh && source !== props.source) return false
  if (fresh || currentConversation.value?.sourceWorkId !== source.id) {
    const chat = newChat(kind); chat.sourceWorkId = source.id; chat.mediaDrafts = {}
  }
  const conversation = currentConversation.value
  // Let the new conversation load its draft before applying the original parameters.
  await nextTick()
  if (!live || !isCurrent() || owner !== session.user?.id || !fresh && source !== props.source || kind !== props.kind || !conversation || conversation !== currentConversation.value) return false
  restoringParameters.value = true
  remixApplied.value = true
  sourceWorkId.value = source.id
  blank.value = true; prompt.value = source.prompt
  references.value = initialFiles.map(file => ({ name: file.name, url: file.content, fromWorkId: file.fromWorkId, type: file.type, duration: file.duration }))
  if (kind === 'video') prompt.value = remapVideoMentions(prompt.value, (source.referenceFiles || []).map(file => file.url), references.value.map(file => file.url), true)
  setSelectedSkillIds(conversation, kind, skills.map(skill => skill.id), skills)
  if (skills.length < selected.length) notify('原作部分技能已下架、更新或不可用，本次已跳过。')
  if (models.value.some(item => item.id === source.model)) model.value = source.model
  if (parameters?.kind === props.kind) {
    if (parameters.aspect_ratio !== undefined) ratio.value = parameters.aspect_ratio
    if (parameters.n !== undefined) count.value = parameters.n
    if (parameters.duration !== undefined) duration.value = parameters.duration
    protocol.value = parameters.protocol || 'openai'
    apiFormat.value = parameters.apiFormat || legacyApiFormat(source.model)
    if (parameters.imageOptions) Object.assign(imageOptions, parameters.imageOptions)
    Object.assign(videoOptions, { openaiReferenceSource: 'upload', openaiImageUrl: undefined, openaiLastImageUrl: undefined, openaiFileId: undefined }, parameters.videoOptions || {})
    if (parameters.size !== undefined) manualSize.value = parameters.size
  }
  if (kind === 'video') videoOptions.mode = remixVideoMode(videoOptions.mode, references.value.length)
  finishRestore()
  return true
}
function applySourceReferences(files: WorkFile[]) {
  if (!props.source) return
  const own = references.value.filter(file => file.fromWorkId !== props.source!.id)
  if (own.length + files.length > referenceLimit.value) { error.value = upscale.value ? '视频超分每次仅支持一个源视频。' : '参考图数量超过当前创作类型上限，请减少所选图片。'; return }
  const next = [...files.map(file => ({ name: file.name, url: file.url, fromWorkId: props.source!.id, type: file.type })), ...own]
  if (props.kind === 'video' && !upscale.value) prompt.value = remapVideoMentions(prompt.value, references.value.map(file => file.url), next.map(file => file.url))
  references.value = next
  if (props.kind === 'video' && !upscale.value) videoOptions.mode = remixVideoMode(videoOptions.mode, references.value.length)
  error.value = ''
}
watch(() => session.user?.id, async () => {
  if (!session.user) return
  const preparingRemix = props.remixPreparing
  await initializeCreation()
  // CreateView owns configuration restoration while preparing a remix.
  if (!preparingRemix) { await loadCreationGroups(); await loadCreationModels(); chooseModel() }
}, { immediate: true })
async function addReferences(event: Event) {
  const input = event.target as HTMLInputElement
  await addReferenceFiles([...(input.files || [])])
  input.value = ''
}
async function addReferenceFiles(files: File[]) {
  if (!files.length || submitting.value || busy.value || props.sourceBlocked) return
  error.value = ''
  const scope = draftScope()
  try {
    if (upscale.value && files.length + materials.snapshot.value.items.length > 1) throw new Error('视频超分每次仅支持一个源视频。')
    await materials.add(files)
  } catch (cause) { if (live && scope === draftScope()) error.value = errorMessage(cause) }
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
  materials.removeAt(index)
}
function sourceDuration(index: number, value: number) {
  const file = references.value[index]
  if (!file?.type?.startsWith('video/')) return
  file.duration = value
  if (upscale.value) duration.value = Math.ceil(value)
}
function generate() { return submit() }
async function sendEntry() {
  const scope = draftScope(), owner = session.user?.id, kind = props.kind, preparation = new AbortController()
  materialSubmission = preparation; submissions.value[kind] = true; waitingForMaterials.value = true; error.value = ''
  const parameters = JSON.parse(JSON.stringify({ skills: skillChat.value.mediaSkills?.[kind] || [], model: model.value, group: creation.selectedGroup, tokenId: creation.modelTokenId, ratio: ratio.value, manualSize: manualSize.value, count: count.value, duration: duration.value, protocol: protocol.value, apiFormat: apiFormat.value, imageOptions, videoOptions }))
  try {
    await materials.wait(preparation.signal)
    if (!live || preparation.signal.aborted || scope !== draftScope() || owner !== session.user?.id || kind !== props.kind) return
    parameters.videoOptions.mode = videoOptions.mode
    emit('entry', { owner: owner || null, kind, prompt: prompt.value, references: JSON.parse(JSON.stringify(references.value)), parameters })
  } catch (cause) { if (live && !preparation.signal.aborted && scope === draftScope()) error.value = errorMessage(cause) }
  finally {
    submissions.value[kind] = false
    if (materialSubmission === preparation) { materialSubmission = undefined; waitingForMaterials.value = false }
  }
}
async function submit(onRegistered?: () => void) {
  if (!canGenerate.value) {
    if (onRegistered && !imageCountIssue.value && !videoParameterIssue.value) error.value = '生成配置尚未就绪，请在工作台确认模型、提示词和参考图后再生成。'
    return
  }
  if (props.entryOnly) return sendEntry()
  const kind = props.kind, owner = session.user?.id
  const chat = currentConversation.value || ensureMediaConversation(props.kind)
  const scope = draftScope()
  const selectedSkills = (chat.mediaSkills?.[kind] || []).map(skill => ({ ...skill }))
  const conversationId = chat.mediaConversationId || chat.id
  let submittedPrompt = prompt.value
  const branchId = branchTaskId.value, imageEditId = imageEditTaskId.value, initialReferenceUrls = references.value.map(file => file.url)
  let submittedReferences = JSON.stringify(references.value)
  const branchEdited = editing.value
  const preparation = new AbortController()
  materialSubmission = preparation
  let preparing = true
  blank.value = false
  error.value = ''; submissions.value[kind] = true; chats.preparing[chat.id] = true
  try {
    const fixedReferences = kind === 'image' && !usesGeminiImageChat(model.value, selectedApiFormat.value) ? pinnedImageReferences(chat) : []
    const input: CreationInput = JSON.parse(JSON.stringify({ conversationId, kind: props.kind, model: model.value, prompt: prompt.value, size: requestSize.value, ...(manualSize.value && manualSize.value !== 'auto' ? { exactSize: true } : {}), aspect_ratio: ratio.value, n: props.kind === 'video' ? 1 : count.value, duration: duration.value, protocol: protocol.value, apiFormat: apiFormat.value, references: references.value, sourceWorkId: sourceWorkId.value,
      accountGroup: creation.selectedGroup, accountTokenId: creation.modelTokenId,
      ...(props.kind === 'image' ? { imageOptions, imageContext: buildImageContext(chat) } : { videoOptions }),
      ...(branchId ? { mediaBranch: { taskId: branchId, edited: branchEdited } } : {}) }))
    waitingForMaterials.value = true
    try { await materials.wait(preparation.signal) }
    finally { if (materialSubmission === preparation) waitingForMaterials.value = false }
    if (!live || scope !== draftScope() || owner !== session.user?.id) return
    submittedReferences = JSON.stringify(references.value)
    input.references = JSON.parse(JSON.stringify(references.value))
    if (fixedReferences.length) {
      input.references = [...new Map([...(input.references || []), ...fixedReferences].map(file => [file.url, file])).values()]
      if (input.references.length > 16) throw new Error('固定图片和本次参考图合计不能超过 16 张，请先取消部分固定。')
    }
    if (kind === 'image' && (!Number.isInteger(input.n) || input.n < 1 || input.n > 10)) throw new Error('图片数量需为 1 到 10 的整数。')
    if (input.videoOptions && !upscale.value) {
      submittedPrompt = remapVideoMentions(submittedPrompt, initialReferenceUrls, references.value.map(file => file.url))
      input.prompt = submittedPrompt
      input.videoOptions.mode = videoOptions.mode
      if (!Number.isInteger(input.duration) || input.duration < 1 || input.duration > 3600) throw new Error('视频时长需为 1 到 3600 的整数秒。')
      const limits = videoCapabilities(input.model, input.videoOptions.mode, creation.models.find(item => item.id === input.model)?.video)
      if (limits?.durations.length && !limits.durations.includes(input.duration) || input.videoOptions.resolution !== 'auto' && limits?.resolutions.length && !limits.resolutions.includes(input.videoOptions.resolution))
        throw new Error('当前参考图模式不支持所选时长或分辨率，请在高级参数中调整。')
      if (input.aspect_ratio !== 'auto' && limits?.aspectRatios?.length && !limits.aspectRatios.includes(input.aspect_ratio)) throw new Error('当前模型不支持所选画面比例，请在高级参数中调整。')
      if (input.size !== 'auto' && limits?.sizes && !Object.values(limits.sizes).some(ratios => Object.values(ratios).includes(input.size))) throw new Error('当前模型不支持所选精确尺寸，请在高级参数中调整。')
    }
    const skills = await resolveMediaSkills(selectedSkills, kind, owner)
    if (skills.length) input.skills = skills
    if (!live || scope !== draftScope() || owner !== session.user?.id) return
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
        branchTaskId.value = undefined; imageEditTaskId.value = undefined; editing.value = false
        await saveChats(true)
      } else if (owner === session.user?.id) {
        const draft = chat.mediaDrafts?.[kind]
        if (draft?.prompt === submittedPrompt) { draft.prompt = ''; if (draft.imageEditTaskId === imageEditId) delete draft.imageEditTaskId }
        if (draft && JSON.stringify(draft.references) === submittedReferences) draft.references = []
        await saveChats(true)
      }
      if (owner === session.user?.id) chats.preparing[chat.id] = false
      preparing = false
      if (materialSubmission === preparation) {
        materialSubmission = undefined; waitingForMaterials.value = false; submissions.value[kind] = false
      }
      onRegistered?.()
    }, () => owner === session.user?.id && chats.sessions.some(item => item.id === chat.id))
    if (result.phase === 'error' && creation.selectedId === result.id && owner === session.user?.id && live && scope === draftScope() && !prompt.value && !references.value.length) {
      prompt.value = submittedPrompt; references.value = JSON.parse(submittedReferences)
      if (branchId) { branchTaskId.value = result.id; editing.value = branchEdited }
      imageEditTaskId.value = imageEditId
    }
    await syncMediaConversations()
  } catch (cause) { if (owner === session.user?.id && live && scope === draftScope()) error.value = errorMessage(cause) }
  finally {
    if (materialSubmission === preparation) { materialSubmission = undefined; waitingForMaterials.value = false; submissions.value[kind] = false }
    if (preparing && owner === session.user?.id) chats.preparing[chat.id] = false
  }
}
async function useTask(task: CreationTask, generatedImages?: string[]) {
  if (restoringTask.value || task.owner !== session.user?.id || task.kind !== props.kind) return false
  restoringTask.value = true
  let scope = draftScope()
  try {
  ensureMediaConversation(task.kind === 'video' ? 'video' : 'image', task)
  const owner = session.user?.id, id = currentConversation.value?.id, kind = props.kind
  await nextTick()
  if (!live || owner !== session.user?.id || id !== currentConversation.value?.id || kind !== props.kind) return false
  scope = draftScope()
  if (task.group && task.group !== creation.selectedGroup) {
    if (!creation.groups.some(group => group.id === task.group)) throw new Error('原作分组当前不可用，请手动选择分组和模型。')
    await selectCreationGroup(task.group)
    if (creation.selectedGroup !== task.group) throw new Error('原作分组未能恢复，请重新选择。')
  }
  if (!live || scope !== draftScope()) return false
  restoringParameters.value = true
  blank.value = false
  branchTaskId.value = undefined; editing.value = false; imageEditTaskId.value = generatedImages ? task.id : undefined
  creation.selectedId = task.id; model.value = task.model; prompt.value = task.prompt
  setSelectedSkillIds(skillChat.value, kind, (task.request.skills || []).map(skill => skill.id), task.request.skills)
  parameterModel.value = task.model
  manualSize.value = task.request.exactSize ? task.request.size : ''; finishRestore()
  sourceWorkId.value = task.sourceWorkId
  ratio.value = task.request.aspect_ratio; count.value = task.request.n; duration.value = task.request.duration
  const image = imageOptionsSchema.safeParse(task.request.imageOptions || {}), video = videoOptionsSchema.safeParse(task.request.videoOptions || { mode: 'text-to-video' })
  Object.assign(imageOptions, image.success ? image.data : imageOptionsSchema.parse({}))
  Object.assign(videoOptions, video.success ? video.data : videoOptionsSchema.parse({ mode: 'text-to-video' }))
  protocol.value = task.request.protocol || (task.protocol === 'async' ? 'async' : 'openai')
  apiFormat.value = task.request.apiFormat || legacyApiFormat(task.model)
  references.value = generatedImages ? generatedImages.map((url, index) => ({ name: `生成图片 ${index + 1}`, url })) : task.references.map(file => ({ ...file }))
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
  if (busy.value || submitting.value) return
  if (await useTask(task)) {
    branchTaskId.value = task.id; editing.value = true
    void nextTick(() => promptInput.value?.focus())
  }
}
async function editImage(task: CreationTask, index?: number) {
  if (busy.value || submitting.value || task.owner !== session.user?.id || task.kind !== 'image' || task.phase !== 'complete') return
  if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= task.urls.length)) return
  const images = [...new Set(index === undefined ? task.urls : [task.urls[index]!])]
  if (!images.length) return
  if (images.length > 16) { error.value = '最多编辑 16 张参考图，请从图片右键菜单选择单张图片。'; return }
  await useTask(task, images)
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
  branchTaskId.value = undefined; imageEditTaskId.value = undefined; editing.value = false; prompt.value = ''; references.value = []; error.value = ''
}
function chooseReference(task: CreationTask, index: number) {
  if (task.owner !== session.user?.id || task.kind !== 'image' || task.phase !== 'complete') return
  const url = task.urls[index]
  if (!url) return
  references.value = [{ name: `历史生成图 ${index + 1}`, url }]
  void nextTick(() => promptInput.value?.focus())
}
async function clearContext() {
  if (!currentConversation.value) return
  try { await clearMediaContext(currentConversation.value); references.value = []; branchTaskId.value = undefined; imageEditTaskId.value = undefined; editing.value = false }
  catch (cause) { error.value = errorMessage(cause) }
}
function newCreation() {
  newChat(props.kind)
  blank.value = true; prompt.value = ''; references.value = []; error.value = ''; sourceWorkId.value = undefined
  emit('source')
  void nextTick(() => promptInput.value?.focus())
}
function handleEnter(event: KeyboardEvent) {
  if (ime.blocks(event)) { if (event.key === 'Enter' && !ime.isComposing(event)) event.preventDefault(); return }
  if (!shouldSubmit(event, studioPreferences.submitKey, window.matchMedia('(hover: hover) and (pointer: fine)').matches)) return
  event.preventDefault()
  void generate()
}
function openConversation() {
  blank.value = false
  loadDraft()
}
defineExpose({ newCreation, useTask, editTask, editImage, regenerate, chooseReference, openConversation, applyRemix, applySourceReferences, referenceUrls, uploading, sourceWorkId, model, clearContext, generateBackground: submit, submissionIssue, restoringParameters, canGenerate })
</script>

<template>
  <section class="native-studio" aria-label="创作工作台">
    <div v-if="!entryOnly" class="studio-context-tools"><StudioModePicker v-if="!entryOnly" /><button v-if="!entryOnly" type="button" class="studio-tool" title="清除上下文" :disabled="!currentConversation?.messages.length || busy" @click="clearContext"><Eraser :size="16" aria-hidden="true" />清除上下文</button><StudioSkillPicker :chat="skillChat" :kind="kind" :transient="entryOnly" :disabled="!composerReady || submitting || !!busy" /></div>
    <p v-if="creation.modelLaunchPending" class="muted" role="status">正在准备所选模型，请稍候…</p>
    <form class="creation-controls studio-composer" :aria-label="entryOnly ? '快捷创作' : '创作参数'" :inert="!composerReady || Boolean(creation.modelLaunchPending) || undefined" @submit.prevent="generate" @dragover.prevent @drop="dropReferences">
      <div v-if="branchTaskId || imageEditTaskId" class="creation-editing" role="status"><Pencil :size="14" aria-hidden="true" /><span>{{ imageEditTaskId ? '编辑图片 · 修改提示词后生成新图片' : editing ? '编辑原提问 · 生成后保留旧版本' : '重新生成此轮' }}</span><button class="icon-button" type="button" aria-label="取消编辑此轮" title="取消编辑" @click="cancelEditing"><X :size="16" aria-hidden="true" /></button></div>
      <StudioReferenceAttachments :references="references" :disabled="submitting" @remove="removeReference" @duration="sourceDuration" />
      <StudioMaterialStatus :items="materialIssues" :disabled="submitting" @remove="materials.remove" @retry="materials.retry" @cancel="materials.cancel" />
      <label class="field prompt-field"><span class="studio-sr-only">{{ entryOnly ? '创作描述' : '提示词' }}</span><StudioVideoPrompt v-if="kind === 'video' && !upscale" ref="promptInput" v-model="prompt" :label="entryOnly ? '创作描述' : '提示词'" :references="references" :disabled="!composerReady" @submit="generate" @paste="pasteReferences" /><textarea v-else ref="promptInput" v-model="prompt" :disabled="!composerReady" class="composer-input creation-prompt" rows="1" maxlength="100000" :placeholder="upscale ? '视频处理说明（可选）' : entryOnly ? '描述你想生成的图片…' : '发消息，描述你的想法…'" :required="!upscale" @keydown="handleEnter" @keyup="ime.release" @compositionstart="ime.start" @compositionend="ime.end" @paste="pasteReferences" /></label>
      <div class="studio-composer-tools">
        <div class="studio-composer-actions"><label class="reference-upload studio-tool composer-attachment" :title="upscale ? '添加源视频' : '添加参考图'"><LoaderCircle v-if="uploading" :size="18" /><Plus v-else :size="20" /><input type="file" :aria-label="upscale ? '添加源视频' : '添加参考图'" :accept="upscale ? 'video/mp4,.mp4' : 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'" :multiple="!upscale" :disabled="submitting || busy || materials.snapshot.value.items.length >= referenceLimit" @change="addReferences" /></label>
          <StudioPopover label="高级参数" :width="380"><template #trigger><SlidersHorizontal :size="20" /><span>高级参数</span></template>
            <StudioMediaParameters :image="imageOptions" :video="videoOptions" v-model:protocol="protocol" v-model:api-format="apiFormat" v-model:ratio="ratio" v-model:count="count" v-model:duration="duration" v-model:size="size" :kind="kind" :model="model" :model-api-format="selectedModel?.apiFormat" :video-setting="videoSetting" @update:image="Object.assign(imageOptions, $event)" @update:video="Object.assign(videoOptions, $event)" />
          </StudioPopover>
        </div>
        <div class="studio-composer-models"><StudioModelPicker v-model="model" :kind="kind" :inline-selection="entryOnly" @kind="(kind, model) => emit('kind', kind, model)" @update:model-value="modelChanged" @keys="emit('keys')" /></div>
        <StudioBilling :compact="entryOnly" :model="model" :kind="kind" :quantity="kind === 'image' ? count : undefined" :duration="billingDuration" :resolution="videoOptions.resolution" :custom-parameters="videoOptions.customParameters" :size="requestSize" :protocol="protocol" :api-format="apiFormat" :refresh-key="selected?.settledAt" @prices="emit('prices')" />
        <button v-if="waitingForMaterials" type="button" class="composer-submit generation-button" title="取消发送，保留草稿" aria-label="取消发送" @click="materialSubmission?.abort()"><Square :size="17" /></button>
        <button v-else class="composer-submit generation-button" :title="entryOnly ? '发送到创作台' : submitting ? '正在准备…' : upscale ? '开始超分' : '开始生成'" :aria-label="entryOnly ? '发送到创作台' : submitting ? '正在准备…' : upscale ? '开始超分' : '开始生成'" :disabled="!canGenerate"><LoaderCircle v-if="submitting" :size="18" /><ArrowUp v-else :size="21" /><span class="mobile-send-label">{{ upscale ? '超分' : '生成' }}</span></button>
      </div>
      <p v-if="selectedGroup?.description && selectedGroup.description !== selectedGroup.name" class="group-description">{{ selectedGroup.description }}</p>
      <p v-if="creation.groupSwitching" class="group-description" role="status">正在切换模型分组…</p>
      <p v-if="creation.groupsError" class="form-error" role="alert">{{ creation.groupsError }} <button type="button" class="text-link" :disabled="creation.groupSwitching" @click="loadCreationGroups(true)">重试</button></p>
      <p v-if="creation.modelsError" class="form-error" role="alert">{{ creation.modelsError }} <button type="button" class="text-link" @click="loadCreationModels(true)">重试</button></p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="creation.storageError" class="form-error" role="alert">{{ creation.storageError }}</p>
      <p v-if="videoParameterIssue" class="form-error" role="alert">{{ videoParameterIssue }}</p>
      <p v-if="imageCountIssue" class="form-error" role="alert">{{ imageCountIssue }}</p>
      <p v-if="referenceLimitIssue" class="form-error" role="alert">{{ referenceLimitIssue }}</p>
    </form>

  </section>
</template>

<style scoped>
.native-studio { display: flex; flex-direction: column; flex: none; min-height: 0; min-width: 0; }
.creation-editing { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.creation-editing { padding: 0 8px 8px; color: var(--muted); font-size: 13px; }.creation-editing > button { margin-inline-start: auto; }
.group-description { color: var(--muted); overflow-wrap: anywhere; font-size: 12px; margin: 4px 8px 0; }
.reference-upload { width: fit-content; position: relative; overflow: hidden; }
.reference-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
.reference-upload:focus-within { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
</style>
