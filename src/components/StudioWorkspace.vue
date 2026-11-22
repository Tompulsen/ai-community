<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { ArrowUp, Eraser, LoaderCircle, Pencil, Plus, SlidersHorizontal, Square, X } from '@lucide/vue'
import type { Work, WorkFile } from '../data'
import { errorMessage, session } from '../state'
import { creation, initializeCreation, loadCreationGroups, loadCreationModels, selectCreationGroup, stopCreation, submitCreation, type CreationTask, type CreationDestination, type CreationInput } from '../native-studio'
import { chats, newChat, saveChats } from '../native-chat'
import { ensureMediaConversation, isConversationBusy, mediaTasksForConversation, syncMediaConversations } from '../studio-conversations'
import { buildImageContext, clearMediaContext, imageContinuationReferences, registerMediaTurn } from '../studio-image-conversation'
import StudioMediaParameters from './StudioMediaParameters.vue'
import StudioPopover from './StudioPopover.vue'
import StudioModePicker from './StudioModePicker.vue'
import StudioBilling from './StudioBilling.vue'
import StudioModelPicker from './StudioModelPicker.vue'
import StudioVideoPrompt from './StudioVideoPrompt.vue'
import StudioReferenceAttachments from './StudioReferenceAttachments.vue'
import StudioMaterialStatus from './studio-message/StudioMaterialStatus.vue'
import { useStudioMaterials, type StudioFile } from '../use-studio-materials'
import { remapVideoMentions } from '../../shared/studio/video-mentions'
import { modelsForKind, takeModelChoice } from '../model-preferences'
import { imageOptionsSchema, videoOptionsSchema } from '../../shared/studio/options'
import { imageRequestSize, usesGeminiImageChat } from '../../shared/studio/image-params'
import { videoCapabilities } from '../../shared/studio/video-capabilities'
import { selectedVideoSize } from '../../shared/studio/video-size'
import { readRemixParameters } from '../../shared/studio/remix-parameters'
import { remixVideoMode } from '../studio-remix'
import { studioPreferences } from '../studio-preferences'
import { shouldSubmit } from '../../shared/studio/submit-key'
import { createImeGuard } from '../../shared/studio/ime-input'
import type { StudioEntry } from '../studio-entry'

const props = defineProps<{ kind: 'image' | 'video'; source?: Work | null; sourceBlocked?: boolean; remixPreparing?: boolean; entryOnly?: boolean; entryPending?: boolean }>()
const emit = defineEmits<{ prices: []; keys: []; publish: [task: CreationTask, destination: CreationDestination]; source: [id?: string]; model: []; entry: [value: StudioEntry]; kind: [value: 'text' | 'image' | 'video', model: string] }>()
const model = ref(''), prompt = ref(''), ratio = ref('1:1'), count = ref(1), duration = ref(8)
const ime = createImeGuard()
const imageOptions = reactive(imageOptionsSchema.parse({}))
const videoOptions = reactive(videoOptionsSchema.parse({ mode: 'text-to-video' }))
const protocol = ref('openai')
const manualSize = ref(''), restoringParameters = ref(false)
const remixApplied = ref(false)
const videoLimits = computed(() => videoCapabilities(model.value, videoOptions.mode))
const references = ref<CreationTask['references']>([])
const sourceWorkId = ref<string>()
const submissions = ref<Record<string, boolean>>({}), error = ref(''), waitingForMaterials = ref(false)
const promptInput = ref<HTMLTextAreaElement | InstanceType<typeof StudioVideoPrompt>>()
const blank = ref(false)
const branchTaskId = ref<string>(), editing = ref(false)
const imageEditTaskId = ref<string>()
const skipAutomaticReference = ref(false), restoringTask = ref(false), parameterModel = ref('')
const submitting = computed(() => Boolean(props.entryPending || submissions.value[props.kind]))
const referenceUrls = computed(() => references.value.map(file => file.url))
const currentConversation = computed(() => props.entryOnly ? undefined : chats.sessions.find(chat => chat.id === chats.activeId))
const composerReady = computed(() => props.entryOnly || chats.ready && !!currentConversation.value)
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
const submissionIssue = computed(() => error.value || videoParameterIssue.value)
const referenceLimitIssue = computed(() => references.value.length > (props.kind === 'video' ? 10 : 16) ? '参考图数量超过当前创作类型上限，请减少所选图片。' : '')
const canGenerate = computed(() => composerReady.value && !referenceLimitIssue.value && !busy.value && !props.sourceBlocked && !videoParameterIssue.value && !submitting.value && !materials.failed.value && !restoringTask.value && !creation.groupsLoading && !creation.groupSwitching && !creation.modelsLoading && (props.entryOnly && !session.user || models.value.some(item => item.id === model.value)) && Boolean(prompt.value.trim()))
let live = true, draftRevision = 0, restoreRevision = 0
let materialSubmission: AbortController | undefined
onUnmounted(() => { live = false; draftRevision++; materialSubmission?.abort() })
const draftScope = () => `${session.user?.id}:${currentConversation.value?.id}:${props.kind}:${draftRevision}`
const referenceFiles = computed<StudioFile[]>({
  get: () => references.value.map(file => ({
    name: file.name, content: file.url, type: /^data:([^;,]+)/.exec(file.url)?.[1] || 'image/png', size: 0, isText: false,
    referenceId: file.id, fromWorkId: file.fromWorkId,
  })),
  set: files => {
    const next = files.map(file => ({ name: file.name, url: file.content, id: file.referenceId, fromWorkId: file.fromWorkId }))
    if (props.kind === 'video') prompt.value = remapVideoMentions(prompt.value, references.value.map(file => file.url), next.map(file => file.url))
    references.value = next
    if (props.kind === 'video') videoOptions.mode = remixVideoMode(videoOptions.mode, next.length)
  },
})
const materials = useStudioMaterials(referenceFiles, computed(() => `${session.user?.id}:${currentConversation.value?.id}:${props.kind}`), {
  limit: computed(() => props.kind === 'video' ? 10 : 16), imagesOnly: true,
})
const uploading = materials.pending
const materialIssues = computed(() => materials.snapshot.value.items.filter(item => item.status !== 'ready'))
function finishRestore() {
  const scope = draftScope(), revision = ++restoreRevision
  void nextTick(() => { if (live && scope === draftScope() && revision === restoreRevision) restoringParameters.value = false })
}
const automaticSize = computed(() => props.kind === 'video' ? selectedVideoSize({ resolution: videoOptions.resolution, aspectRatio: ratio.value }) : imageRequestSize(ratio.value, imageOptions.resolution, model.value))
const size = computed({ get: () => manualSize.value || automaticSize.value, set: (value: string) => { manualSize.value = value.trim() } })
const draftKey = () => `octopus:user-${session.user?.id}:native-creation-draft:${props.kind}`
function chooseModel() {
  if (props.remixPreparing || restoringTask.value || parameterModel.value || !creation.modelsLoaded || creation.modelsLoading || creation.groupsLoading || creation.groupSwitching) return
  const choice = takeModelChoice(props.kind, models.value)
  if (choice) model.value = choice
  else if (!models.value.some(item => item.id === model.value)) model.value = models.value[0]?.id || ''
}
function loadDraft() {
  materialSubmission?.abort()
  if (props.entryOnly) {
    draftRevision++; model.value = ''; manualSize.value = ''; ratio.value = props.kind === 'video' ? '16:9' : '1:1'
    if (props.kind === 'video') videoOptions.mode = remixVideoMode(videoOptions.mode, references.value.length)
    chooseModel(); return
  }
  restoringParameters.value = true
  draftRevision++
  branchTaskId.value = undefined; imageEditTaskId.value = undefined; editing.value = false; parameterModel.value = ''; skipAutomaticReference.value = false
  finishRestore()
  blank.value = false
  sourceWorkId.value = undefined
  prompt.value = ''; model.value = ''; manualSize.value = ''; ratio.value = props.kind === 'video' ? '16:9' : '1:1'; count.value = 1; duration.value = 8; references.value = []; error.value = ''
  Object.assign(imageOptions, imageOptionsSchema.parse({})); Object.assign(videoOptions, videoOptionsSchema.parse({ mode: 'text-to-video' })); protocol.value = 'openai'
  if (!session.user) return
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
  protocol.value = 'openai'
})
watch(() => [session.user?.id, currentConversation.value?.id, props.kind, currentConversation.value?.mediaDrafts?.[props.kind]?.skipAutomaticReference] as const, (value, before) => {
  if (value[0] === before[0] && value[1] === before[1] && value[2] === before[2] && typeof value[3] === 'boolean' && value[3] !== before[3]) skipAutomaticReference.value = value[3]
})
watch([models, () => creation.modelsLoaded, () => creation.groupsLoading, () => creation.groupSwitching, () => props.remixPreparing], chooseModel)
watch([ratio, () => imageOptions.resolution, () => videoOptions.resolution, model], () => { if (!restoringParameters.value) manualSize.value = '' })
watch([prompt, model, manualSize, ratio, count, duration, imageOptions, videoOptions, protocol, references, sourceWorkId, skipAutomaticReference, imageEditTaskId, restoringParameters], () => {
  if (props.entryOnly || !session.user || restoringParameters.value || !live || props.remixPreparing && !remixApplied.value) return
  const draft = JSON.parse(JSON.stringify({ prompt: prompt.value, model: model.value, manualSize: manualSize.value, ratio: ratio.value, count: count.value, duration: duration.value, imageOptions, videoOptions, protocol: protocol.value, sourceWorkId: sourceWorkId.value, references: references.value, skipAutomaticReference: skipAutomaticReference.value, imageEditTaskId: imageEditTaskId.value }))
  try { localStorage.setItem(draftKey(), JSON.stringify(draft)) }
  catch { creation.storageError = '当前草稿无法保存到浏览器，请保留提示词。' }
  if (currentConversation.value) {
    currentConversation.value.mediaDrafts ||= {}
    currentConversation.value.mediaDrafts[props.kind] = draft
    void saveChats()
  }
}, { deep: true, flush: 'sync' })
watch(model, value => { if (!restoringTask.value && value !== parameterModel.value) parameterModel.value = '' })
watch([model, () => props.kind, restoringParameters], () => {
  if (restoringParameters.value || props.kind !== 'image' || !usesGeminiImageChat(model.value)) return
  manualSize.value = ''; imageOptions.seed = ''; protocol.value = 'openai'; count.value = 1
})
function modelChanged() { error.value = ''; emit('model') }
watch(videoLimits, limits => {
  if (props.remixPreparing || !limits || props.kind !== 'video') return
  if (props.source?.generation?.parameters?.kind === 'video' && sourceWorkId.value === props.source.id) return
  if (!limits.resolutions.includes(videoOptions.resolution) && videoOptions.resolution !== 'auto') videoOptions.resolution = limits.resolutions[0]!
  if (!limits.durations.includes(duration.value)) duration.value = limits.durations.reduce((best, value) => Math.abs(value - duration.value) < Math.abs(best - duration.value) ? value : best)
})
watch([() => props.source?.id, () => chats.ready], async () => {
  if (!props.source || !chats.ready || sourceWorkId.value === props.source.id) return
  await applyRemix(props.source)
}, { immediate: true })
async function applyRemix(source: Work, initialFiles: StudioFile[] = [], fresh = false) {
  const owner = session.user?.id, kind = props.kind
  if (!owner || !chats.ready || source.kind !== kind) return false
  if (fresh || currentConversation.value?.sourceWorkId !== source.id) {
    const chat = newChat(kind); chat.sourceWorkId = source.id; chat.mediaDrafts = {}
  }
  const conversation = currentConversation.value
  // Let the new conversation load its draft before applying the original parameters.
  await nextTick()
  if (!live || owner !== session.user?.id || !fresh && source !== props.source || kind !== props.kind || conversation !== currentConversation.value) return false
  restoringParameters.value = true
  remixApplied.value = true
  sourceWorkId.value = source.id
  blank.value = true; prompt.value = source.prompt
  references.value = initialFiles.map(file => ({ name: file.name, url: file.content, fromWorkId: file.fromWorkId }))
  if (kind === 'video') prompt.value = remapVideoMentions(prompt.value, (source.referenceFiles || []).map(file => file.url), references.value.map(file => file.url), true)
  const parameters = readRemixParameters(source.generation?.parameters)
  if (models.value.some(item => item.id === source.model)) model.value = source.model
  if (parameters?.kind === props.kind) {
    if (parameters.aspect_ratio !== undefined) ratio.value = parameters.aspect_ratio
    if (parameters.n !== undefined) count.value = parameters.n
    if (parameters.duration !== undefined) duration.value = parameters.duration
    if (parameters.protocol !== undefined) protocol.value = parameters.protocol === 'async' ? 'async' : 'openai'
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
  if (own.length + files.length > (props.kind === 'video' ? 10 : 16)) { error.value = '参考图数量超过当前创作类型上限，请减少所选图片。'; return }
  const next = [...files.map(file => ({ name: file.name, url: file.url, fromWorkId: props.source!.id })), ...own]
  if (props.kind === 'video') prompt.value = remapVideoMentions(prompt.value, references.value.map(file => file.url), next.map(file => file.url))
  references.value = next
  if (props.kind === 'video') videoOptions.mode = remixVideoMode(videoOptions.mode, references.value.length)
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
  if (!references.value.length) skipAutomaticReference.value = true
  else materials.removeAt(index)
}
function generate() { return submit() }
async function sendEntry() {
  const scope = draftScope(), owner = session.user?.id, kind = props.kind, preparation = new AbortController()
  materialSubmission = preparation; submissions.value[kind] = true; waitingForMaterials.value = true; error.value = ''
  const parameters = JSON.parse(JSON.stringify({ model: model.value, group: creation.selectedGroup, tokenId: creation.modelTokenId, ratio: ratio.value, manualSize: manualSize.value, count: count.value, duration: duration.value, protocol: protocol.value, imageOptions, videoOptions }))
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
    if (onRegistered && !videoParameterIssue.value) error.value = '生成配置尚未就绪，请在工作台确认模型、提示词和参考图后再生成。'
    return
  }
  if (props.entryOnly) return sendEntry()
  const kind = props.kind, owner = session.user?.id
  const chat = currentConversation.value || ensureMediaConversation(props.kind)
  const scope = draftScope()
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
    const input: CreationInput = JSON.parse(JSON.stringify({ conversationId, kind: props.kind, model: model.value, prompt: prompt.value, size: size.value, ...(manualSize.value && manualSize.value !== 'auto' ? { exactSize: true } : {}), aspect_ratio: ratio.value, n: props.kind === 'video' ? 1 : count.value, duration: duration.value, protocol: protocol.value, references: references.value, sourceWorkId: sourceWorkId.value,
      accountGroup: creation.selectedGroup, accountTokenId: creation.modelTokenId,
      ...(props.kind === 'image' ? { imageOptions, references: requestReferences.value,
        imageContext: imageEditId && !chat.messages.some(message => message.role === 'assistant' && message.taskId === imageEditId)
          ? { turns: [] } : buildImageContext(chat, branchId || imageEditId) } : { videoOptions }),
      ...(branchId ? { mediaBranch: { taskId: branchId, edited: branchEdited } } : {}) }))
    waitingForMaterials.value = true
    try { await materials.wait(preparation.signal) }
    finally { if (materialSubmission === preparation) waitingForMaterials.value = false }
    if (!live || scope !== draftScope() || owner !== session.user?.id) return
    submittedReferences = JSON.stringify(references.value)
    input.references = JSON.parse(JSON.stringify(kind === 'image' ? requestReferences.value : references.value))
    if (input.videoOptions) {
      submittedPrompt = remapVideoMentions(submittedPrompt, initialReferenceUrls, references.value.map(file => file.url))
      input.prompt = submittedPrompt
      input.videoOptions.mode = videoOptions.mode
      const limits = videoCapabilities(input.model, input.videoOptions.mode)
      if (limits && (!limits.durations.includes(input.duration) || input.videoOptions.resolution !== 'auto' && !limits.resolutions.includes(input.videoOptions.resolution)))
        throw new Error('当前参考图模式不支持所选时长或分辨率，请在高级参数中调整。')
    }
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
        branchTaskId.value = undefined; imageEditTaskId.value = undefined; editing.value = false; skipAutomaticReference.value = false
        await saveChats()
      } else if (owner === session.user?.id) {
        const draft = chat.mediaDrafts?.[kind]
        if (draft?.prompt === submittedPrompt) { draft.prompt = ''; if (draft.imageEditTaskId === imageEditId) delete draft.imageEditTaskId }
        if (draft && JSON.stringify(draft.references) === submittedReferences) draft.references = []
        await saveChats()
      }
      if (owner === session.user?.id) chats.preparing[chat.id] = false
      preparing = false
      onRegistered?.()
    }, () => owner === session.user?.id && chats.sessions.some(item => item.id === chat.id))
    if (result.phase === 'error' && owner === session.user?.id && live && scope === draftScope() && !prompt.value && !references.value.length) {
      prompt.value = submittedPrompt; references.value = JSON.parse(submittedReferences)
      if (branchId) { branchTaskId.value = result.id; editing.value = branchEdited }
      imageEditTaskId.value = imageEditId
    }
    await syncMediaConversations()
  } catch (cause) { if (owner === session.user?.id && live && scope === draftScope()) error.value = errorMessage(cause) }
  finally {
    if (materialSubmission === preparation) { materialSubmission = undefined; waitingForMaterials.value = false }
    submissions.value[kind] = false
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
  parameterModel.value = task.model
  manualSize.value = task.request.exactSize ? task.request.size : ''; finishRestore()
  sourceWorkId.value = task.sourceWorkId
  ratio.value = task.request.aspect_ratio; count.value = task.request.n; duration.value = task.request.duration
  const image = imageOptionsSchema.safeParse(task.request.imageOptions || {}), video = videoOptionsSchema.safeParse(task.request.videoOptions || { mode: 'text-to-video' })
  Object.assign(imageOptions, image.success ? image.data : imageOptionsSchema.parse({}))
  Object.assign(videoOptions, video.success ? video.data : videoOptionsSchema.parse({ mode: 'text-to-video' }))
  protocol.value = task.protocol === 'async' ? 'async' : 'openai'
  references.value = generatedImages ? generatedImages.map((url, index) => ({ name: `生成图片 ${index + 1}`, url })) : task.references.map(file => ({ ...file }))
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
  branchTaskId.value = undefined; imageEditTaskId.value = undefined; editing.value = false; prompt.value = ''; references.value = []; skipAutomaticReference.value = false; error.value = ''
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
  try { await clearMediaContext(currentConversation.value); skipAutomaticReference.value = true; references.value = []; branchTaskId.value = undefined; imageEditTaskId.value = undefined; editing.value = false }
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
    <div v-if="!entryOnly" class="studio-context-tools"><StudioModePicker /><button type="button" class="studio-tool" title="清除上下文" :disabled="!currentConversation?.messages.length || busy" @click="clearContext"><Eraser :size="16" aria-hidden="true" />清除上下文</button></div>
    <form class="creation-controls studio-composer" :aria-label="entryOnly ? '快捷创作' : '创作参数'" :inert="!composerReady || undefined" @submit.prevent="generate" @dragover.prevent @drop="dropReferences">
      <div v-if="branchTaskId || imageEditTaskId" class="creation-editing" role="status"><Pencil :size="14" aria-hidden="true" /><span>{{ imageEditTaskId ? '编辑图片 · 修改提示词后生成新图片' : editing ? '编辑原提问 · 生成后保留旧版本' : '重新生成此轮' }}</span><button class="icon-button" type="button" aria-label="取消编辑此轮" title="取消编辑" @click="cancelEditing"><X :size="16" aria-hidden="true" /></button></div>
      <StudioReferenceAttachments :references="references" :disabled="submitting" @remove="removeReference" />
      <StudioMaterialStatus :items="materialIssues" :disabled="submitting" @remove="materials.remove" @retry="materials.retry" @cancel="materials.cancel" />
      <label class="field prompt-field"><span class="studio-sr-only">{{ entryOnly ? '创作描述' : '提示词' }}</span><StudioVideoPrompt v-if="kind === 'video'" ref="promptInput" v-model="prompt" :label="entryOnly ? '创作描述' : '提示词'" :references="references" :disabled="submitting || !composerReady" @submit="generate" @paste="pasteReferences" /><textarea v-else ref="promptInput" v-model="prompt" :disabled="submitting || !composerReady" class="composer-input creation-prompt" rows="1" maxlength="100000" :placeholder="entryOnly ? '描述你想生成的图片…' : '发消息，描述你的想法…'" required @keydown="handleEnter" @keyup="ime.release" @compositionstart="ime.start" @compositionend="ime.end" @paste="pasteReferences" /></label>
      <div class="studio-composer-tools">
        <div class="studio-composer-actions"><label class="reference-upload studio-tool composer-attachment" title="添加参考图"><LoaderCircle v-if="uploading" :size="18" /><Plus v-else :size="20" /><input type="file" aria-label="添加参考图" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple :disabled="submitting || busy || materials.snapshot.value.items.length >= (kind === 'video' ? 10 : 16)" @change="addReferences" /></label>
          <StudioPopover label="高级参数" :width="380"><template #trigger><SlidersHorizontal :size="20" /><span>高级参数</span></template>
            <StudioMediaParameters :image="imageOptions" :video="videoOptions" v-model:protocol="protocol" v-model:ratio="ratio" v-model:count="count" v-model:duration="duration" v-model:size="size" :kind="kind" :model="model" @update:image="Object.assign(imageOptions, $event)" @update:video="Object.assign(videoOptions, $event)" />
          </StudioPopover>
        </div>
        <div class="studio-composer-models"><StudioModelPicker v-model="model" :kind="kind" :inline-selection="entryOnly" @kind="(kind, model) => emit('kind', kind, model)" @update:model-value="modelChanged" @keys="emit('keys')" /></div>
        <StudioBilling :compact="entryOnly" :model="model" :kind="kind" :quantity="kind === 'image' ? count : undefined" :duration="kind === 'video' ? duration : undefined" :protocol="protocol" :refresh-key="selected?.settledAt" @prices="emit('prices')" />
        <button v-if="activeTask" type="button" class="composer-submit generation-button" title="停止本页等待，上游任务可能继续执行" aria-label="停止等待" @click="stopCreation(activeTask)"><Square :size="17" /><span class="mobile-send-label">停止</span></button>
        <button v-else-if="waitingForMaterials" type="button" class="composer-submit generation-button" title="取消发送，保留草稿" aria-label="取消发送" @click="materialSubmission?.abort()"><Square :size="17" /></button>
        <button v-else class="composer-submit generation-button" :title="entryOnly ? '发送到创作台' : submitting ? '正在准备…' : '开始生成'" :aria-label="entryOnly ? '发送到创作台' : submitting ? '正在准备…' : '开始生成'" :disabled="!canGenerate"><LoaderCircle v-if="submitting" :size="18" /><ArrowUp v-else :size="21" /><span class="mobile-send-label">生成</span></button>
      </div>
      <p v-if="selectedGroup?.description && selectedGroup.description !== selectedGroup.name" class="group-description">{{ selectedGroup.description }}</p>
      <p v-if="creation.groupSwitching" class="group-description" role="status">正在切换模型分组…</p>
      <p v-if="creation.groupsError" class="form-error" role="alert">{{ creation.groupsError }} <button type="button" class="text-link" :disabled="creation.groupSwitching" @click="loadCreationGroups">重试</button></p>
      <p v-if="creation.modelsError" class="form-error" role="alert">{{ creation.modelsError }} <button type="button" class="text-link" @click="loadCreationModels">重试</button></p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p><p v-if="creation.storageError" class="form-error" role="alert">{{ creation.storageError }}</p>
      <p v-if="videoParameterIssue" class="form-error" role="alert">{{ videoParameterIssue }}</p>
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
