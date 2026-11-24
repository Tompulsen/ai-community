<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Eraser, History, LoaderCircle, Maximize, MoreHorizontal, Pencil, Plus, Quote, RefreshCw, Settings2, Square, Trash2, X } from '@lucide/vue'
import { session, errorMessage, notify } from '../state'
import type { Work, WorkFile } from '../data'
import { creation, downloadCreation, initializeCreation, loadCreationGroups, loadCreationModels, mediaSource, selectCreationGroup, stopCreation, waitCreationGroup, type CreationTask, type CreationDestination } from '../native-studio'
import { chats, createEmptyChat, newChat, loadChats, saveChats as persistChats, removeChat, cloneChat, sendChat, stopChat, switchBranch, removeMessage as deleteChatMessage, submitMessageOptions, rerunMessageTool, editAssistantMessage, type NativeMessage, type NativeChat } from '../native-chat'
import { answerBranches } from '../../shared/studio/chat-branches'
import { getFileAccept, type ParsedFile } from '../../shared/studio/file-upload'
import { prepareStudioImage } from '../studio-image-upload'
import StudioSkillPicker from './StudioSkillPicker.vue'
import StudioChatParameters from './StudioChatParameters.vue'
import StudioResponseMetrics from './StudioResponseMetrics.vue'
import { confirmStudioDelete } from '../studio-confirm'
import StudioPopover from './StudioPopover.vue'
import StudioModePicker from './StudioModePicker.vue'
import StudioSearchPicker from './StudioSearchPicker.vue'
import StudioBilling from './StudioBilling.vue'
import StudioModelPicker from './StudioModelPicker.vue'
import StudioConversations from './StudioConversations.vue'
import StudioConversationTitle from './StudioConversationTitle.vue'
import StudioGallery from './StudioGallery.vue'
import StudioAiStatus from './studio-message/StudioAiStatus.vue'
import StudioMessageSources from './studio-message/StudioMessageSources.vue'
import StudioMessageQuote from './studio-message/StudioMessageQuote.vue'
import StudioQuoteSelection from './studio-message/StudioQuoteSelection.vue'
import StudioMessageEditor from './studio-message/StudioMessageEditor.vue'
import StudioMessageOptions from './studio-message/StudioMessageOptions.vue'
import StudioToolActivity from './studio-message/StudioToolActivity.vue'
import StudioMaterialStatus from './studio-message/StudioMaterialStatus.vue'
import StudioMessageFrame from './studio-message/StudioMessageFrame.vue'
import StudioMediaPreview from './studio-message/StudioMediaPreview.vue'
import StudioMediaTurn from './studio-message/StudioMediaTurn.vue'
import StudioMessageActions, { type MessageAction } from './studio-message/StudioMessageActions.vue'
import { togglePinnedMessage } from '../native-chat'
import StudioContextMenu, { type StudioMenuAction } from './studio-message/StudioContextMenu.vue'
import StudioFollowupSuggestions from './studio-message/StudioFollowupSuggestions.vue'
import StudioReferenceAttachments from './StudioReferenceAttachments.vue'
import StudioClearContext from './studio-message/StudioClearContext.vue'
import { studioPreferences } from '../studio-preferences'
import { shouldSubmit } from '../../shared/studio/submit-key'
import { createImeGuard } from '../../shared/studio/ime-input'
import { useStudioMaterials, type StudioFile } from '../use-studio-materials'
import { createMessageQuote, type MessageQuote } from '../../shared/studio/message-quote'
import { isConversationBusy, mediaTasksForConversation } from '../studio-conversations'
import { clearMediaContext, restoreMediaContext, deleteMediaTurns, visibleMediaTasks } from '../studio-image-conversation'
import { configuredModelFormat, modelFormat, modelsForKind, setModelFormat, takeModelChoice } from '../model-preferences'
import { CHAT_API_FORMATS, type ChatApiFormat } from '../../shared/studio/chat-api-format'
import { readRemixParameters } from '../../shared/studio/remix-parameters'
import { resolveRemixSkills } from '../community-skill'
import type { StudioEntry } from '../studio-entry'
const markdownRetry = ref<() => void>(), reasoningRetry = ref<() => void>()
const StudioMarkdown = defineAsyncComponent({
  loader: () => import('./studio-message/StudioMarkdown.vue'),
  onError: (_error, retry) => { markdownRetry.value = () => { markdownRetry.value = undefined; retry() } },
})
const StudioReasoningPanel = defineAsyncComponent({
  loader: () => import('./studio-message/StudioReasoningPanel.vue'),
  onError: (_error, retry) => { reasoningRetry.value = () => { reasoningRetry.value = undefined; retry() } },
})
const props = withDefaults(defineProps<{ mode?: 'text' | 'image' | 'video'; source?: Work | null; sourceBlocked?: boolean; remixPreparing?: boolean; headerVisible?: boolean; entryOnly?: boolean; entryPending?: boolean }>(), { mode: 'text', headerVisible: true })
const emit = defineEmits<{ prices: []; keys: []; entry: [value: StudioEntry]; kind: [value: 'text' | 'image' | 'video', model: string]; publish: [task: CreationTask, destination: CreationDestination, content?: string]; source: [id?: string]; remixError: [message: string]; conversation: [id: string]; mediaAction: [action: 'editTask' | 'editImage' | 'regenerate' | 'useTask' | 'chooseReference', task: CreationTask, index?: number] }>()
const entryChat = ref(props.entryOnly ? createEmptyChat() : undefined)
const current = computed(() => props.entryOnly ? entryChat.value : chats.sessions.find(chat => chat.id === chats.activeId))
function saveChats(required = false) { if (!props.entryOnly) return persistChats(required) }
const currentFormat = computed(() => current.value?.formatOverride || modelFormat(model.value) || (current.value?.formatAutomatic === true ? 'auto' : current.value?.settings.format || 'auto'))
const effectiveFormat = computed(() => currentFormat.value === 'auto' ? configuredModelFormat(model.value) || 'chat-completions' : currentFormat.value)
const ready = computed(() => Boolean(current.value))
const sourceWorkId = computed(() => current.value?.sourceWorkId)
const prompt = ref(''), model = ref(''), files = ref<(ParsedFile & { sourceUrl?: string; fromWorkId?: string })[]>([]), error = ref(''), referenceLoading = ref(false), edited = ref<NativeMessage>(), messagesElement = ref<HTMLElement>(), composerElement = ref<HTMLTextAreaElement>()
const materials = useStudioMaterials(files, computed(() => `${session.user?.id || ''}:${current.value?.id || ''}`))
const uploading = computed(() => referenceLoading.value || materials.pending.value)
const waitingForMaterials = ref(false)
let materialSubmission: AbortController | undefined
let live = true
const draftImages = computed(() => files.value.flatMap((file, index) => file.type.startsWith('image/') ? [{ name: file.name, url: file.content, index }] : []))
const materialItems = computed(() => materials.snapshot.value.items.filter(item => item.status !== 'ready' || !item.type.startsWith('image/')))
function removeDraftImage(index: number) {
  const position = draftImages.value[index]?.index
  if (position !== undefined) materials.removeAt(position)
}
watch([() => current.value?.id, () => session.user?.id, () => props.mode], () => materialSubmission?.abort())
onBeforeUnmount(() => { live = false; materialSubmission?.abort() })
const draftQuote = computed({ get: () => current.value?.draftQuote, set: value => { if (current.value) { current.value.draftQuote = value; void saveChats(true)?.catch(() => {}) } } })
const referenceUrls = computed(() => files.value.flatMap(file => file.sourceUrl ? [file.sourceUrl] : []))
const historyMenu = ref<InstanceType<typeof StudioPopover>>(), nearBottom = ref(true)
const messagesContent = ref<HTMLElement>()
const ime = createImeGuard(), dragging = ref(false)
let dragDepth = 0
const contextMenu = ref<InstanceType<typeof StudioContextMenu>>(), menuMessage = ref<NativeMessage>(), menuSelection = ref('')
const menuItems = computed<StudioMenuAction[]>(() => {
  const chat = current.value, message = menuMessage.value
  if (!chat || !message || !chat.messages.includes(message)) return []
  const blocked = Boolean(busy.value || props.sourceBlocked)
  const quote = createMessageQuote(message, menuSelection.value || messageText(message))
  return [
    { label: menuSelection.value ? '复制选中文字' : '复制消息', icon: Copy, run: () => copy(message, menuSelection.value) },
    ...(quote ? [{ label: '引用消息', icon: Quote, disabled: blocked || props.mode !== 'text', run: () => quoteSelection(quote) }] : []),
    { label: message.role === 'user' ? '编辑提问' : '编辑回答', icon: Pencil, disabled: blocked, run: () => edit(message) },
    ...(message.role === 'assistant' ? [{ label: '重新生成回答', icon: RefreshCw, disabled: blocked || !models.value.some(item => item.id === model.value), run: () => regenerate(message) }] : []),
    { label: '删除消息', icon: Trash2, danger: true, disabled: blocked, run: () => removeMessage(chat, message) },
  ]
})
function openMessageMenu(event: MouseEvent, message: NativeMessage) {
  if (message.role === 'system') return
  menuMessage.value = message; menuSelection.value = ''
  const selection = document.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
  const root = event.currentTarget as HTMLElement
  if (range && root.contains(range.startContainer) && root.contains(range.endContainer)) menuSelection.value = selection!.toString()
  void contextMenu.value?.open(event)
}
watch([() => current.value?.id, () => session.user?.id, () => props.mode, () => props.headerVisible], () => {
  contextMenu.value?.close(); menuMessage.value = undefined; dragging.value = false; dragDepth = 0
})
const mediaGallery = ref<InstanceType<typeof StudioGallery>>()
const transcriptObserver = new ResizeObserver(() => followOutput())
watch(messagesContent, element => { transcriptObserver.disconnect(); if (element) transcriptObserver.observe(element) }, { flush: 'post' })
onBeforeUnmount(() => transcriptObserver.disconnect())
const restoringTask = ref(false)
const models = computed(() => modelsForKind('text'))
const busy = computed(() => props.entryPending || restoringTask.value || props.source && sourceWorkId.value !== props.source.id || !props.entryOnly && current.value && (isConversationBusy(current.value) || chats.initialSaving[current.value.id]))
const canSend = computed(() => Boolean(current.value && props.mode === 'text' && !busy.value && !props.sourceBlocked && !referenceLoading.value && !waitingForMaterials.value && !materials.failed.value && (props.entryOnly && !session.user || models.value.some(item => item.id === model.value)) && !creation.groupSwitching && !creation.modelsLoading && !creation.groupsLoading && (prompt.value.trim() || files.value.length || materials.snapshot.value.items.length)))
const canStop = computed(() => current.value && !chats.preparing[current.value.id] && (chats.busy[current.value.id] || mediaTasksForConversation(current.value).some(task => ['submitting', 'running'].includes(task.phase))))
const mediaTasks = computed(() => current.value ? visibleMediaTasks(current.value) : [])
const mediaByMessage = computed(() => {
  const tasks = new Map(mediaTasks.value.map(task => [task.id, task])), result = new Map<string, CreationTask>()
  for (const message of current.value?.messages || []) {
    const task = message.role === 'assistant' && message.taskId && tasks.get(message.taskId)
    if (task) { result.set(message.id, task); if (message.parentId) result.set(message.parentId, task) }
  }
  return result
})
const selecting = ref(false), selectedTurns = ref<string[]>([])
function mediaTask(message: NativeMessage) { return mediaByMessage.value.get(message.id) }
async function removeTurns() {
  const chat = current.value, ids = [...selectedTurns.value]
  if (!chat || busy.value || !ids.length || !await confirmStudioDelete(`删除 ${ids.length} 轮对话记录？生成图片仍保留在图库。`, () => current.value === chat && !busy.value)) return
  try { await deleteMediaTurns(chat, ids); selectedTurns.value = [] }
  catch (cause) { error.value = errorMessage(cause) }
}
async function clearContext() {
  if (!current.value || busy.value) return
  try { await clearMediaContext(current.value) } catch (cause) { error.value = errorMessage(cause) }
}
async function restoreContext() {
  if (!current.value || busy.value) return
  try { await restoreMediaContext(current.value) } catch (cause) { error.value = errorMessage(cause) }
}
function stop(message?: NativeMessage) {
  if (!current.value || chats.preparing[current.value.id]) return
  if (message) { stopChat(current.value, message); return }
  if (chats.busy[current.value.id]) stopChat(current.value)
  for (const task of mediaTasksForConversation(current.value)) if (['submitting', 'running'].includes(task.phase)) stopCreation(task)
}
const latestTask = computed(() => creation.tasks.find(task => task.id === current.value?.messages.at(-1)?.taskId))
function messageText(message: NativeMessage) { return typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') }
function messageModel(message: NativeMessage) { return creation.tasks.find(task => task.id === message.taskId)?.model || current.value?.model || '助手' }
function branch(message: NativeMessage) { return current.value ? answerBranches(current.value, message.id) : { index: 0, total: 1, messageIds: [] } }
function pending(message: NativeMessage) { return message.role === 'assistant' && Boolean(message.streaming || message.contextCompressing) }
function messageStage(message: NativeMessage) {
  if (message.error) return 'error'
  if (!pending(message)) return 'done'
  if (message.tools?.some(tool => tool.status === 'pending' || tool.status === 'running')) return 'researching'
  if (messageText(message)) return 'writing'
  if (current.value?.search !== 'off' && !message.taskId) return 'researching'
  return 'thinking'
}
function statusLabel(message: NativeMessage) {
  if (message.error) return '生成失败'
  if (message.interrupted && !pending(message)) return '已停止'
  const tool = message.tools?.find(tool => tool.status === 'pending' || tool.status === 'running')
  if (message.contextCompressing) return '正在压缩上下文'
  return tool ? `正在执行 ${tool.name}` : undefined
}
function mediaUrl(value: string | undefined, type: 'image' | 'video' | 'audio') {
  if (!value) return
  if (value.startsWith(`data:${type}/`)) return value
  try { const url = new URL(value, location.origin); if (['http:', 'https:', 'blob:'].includes(url.protocol)) return url.href } catch {}
}
function audioUrl(part: NonNullable<Exclude<NativeMessage['content'], string>[number]['input_audio']>) {
  const format = part.format?.toLowerCase()
  return ['mp3', 'wav', 'ogg', 'webm', 'flac', 'm4a', 'aac'].includes(format) && /^[A-Za-z0-9+/=\s]+$/.test(part.data) ? `data:audio/${format === 'mp3' ? 'mpeg' : format};base64,${part.data}` : undefined
}
const attachmentImage = ref<string>(), attachmentKind = ref<'image' | 'video'>('image'), attachmentDialog = ref<InstanceType<typeof StudioMediaPreview>>()
const attachmentItems = computed(() => attachmentImage.value ? [{ src: attachmentImage.value, kind: attachmentKind.value, alt: attachmentKind.value === 'image' ? '放大图片附件' : '放大视频附件' }] : [])
async function openAttachment(url: string | undefined, kind: 'image' | 'video' = 'image') {
  if (!url) return
  const owner = session.user?.id, conversation = current.value?.id
  attachmentImage.value = url; attachmentKind.value = kind
  await nextTick()
  if (owner === session.user?.id && conversation === current.value?.id && attachmentImage.value === url) await attachmentDialog.value?.open()
}
watch(() => current.value?.id, () => { attachmentDialog.value?.close(); attachmentImage.value = undefined })
watch(() => session.user?.id, () => { attachmentDialog.value?.close(); attachmentImage.value = undefined; error.value = ''; edited.value = undefined })
watch(() => session.user?.id, async () => {
  if (props.entryOnly) { entryChat.value = createEmptyChat(); model.value = '' }
  if (!session.user) return
  const preparingRemix = props.remixPreparing
  await initializeCreation()
  if (!preparingRemix && props.mode === 'text') { await loadCreationGroups(); await loadCreationModels() }
  if (!props.entryOnly) await loadChats()
}, { immediate: true })
function chooseModel() {
  if (props.mode !== 'text' || props.remixPreparing || !current.value || !creation.modelsLoaded || creation.modelsLoading || creation.groupsLoading || creation.groupSwitching) return
  const saved = current.value.textModel || current.value.model
  const next = (!props.entryOnly && takeModelChoice('text', models.value)) || (models.value.some(item => item.id === saved) ? saved! : models.value[0]?.id || '')
  model.value = next
  if (next && current.value.textModel !== next) { current.value.textModel = next; void saveChats() }
}
watch([models, () => creation.modelsLoaded, () => creation.groupsLoading, () => creation.groupSwitching, () => props.remixPreparing, () => props.mode], chooseModel)
function changeFormat(event: Event) {
  if (!current.value) return
  const format = (event.target as HTMLSelectElement).value
  if (format !== 'auto' && !CHAT_API_FORMATS.includes(format as ChatApiFormat)) return
  if (modelFormat(model.value)) {
    try { setModelFormat(model.value, format as ChatApiFormat | 'auto') } catch (cause) { error.value = errorMessage(cause); return }
  }
  current.value.formatOverride = format === 'auto' ? undefined : format as ChatApiFormat
  current.value.formatAutomatic = format === 'auto'
  void saveChats()
}
watch(() => current.value?.id, () => { chooseModel(); files.value = current.value?.draftFiles || []; prompt.value = current.value?.draft || ''; edited.value = undefined; selecting.value = false; selectedTurns.value = []; nearBottom.value = true; void nextTick(scrollToBottom) }, { immediate: true })
let appliedSource = ''
watch([() => props.source, ready], () => {
  if (!props.source) { appliedSource = ''; return }
  if (!ready.value || appliedSource === props.source.id) return
  if (current.value?.sourceWorkId === props.source.id) { appliedSource = props.source.id; return }
  const source = props.source, owner = session.user?.id, conversation = current.value
  void applyRemix(source).then(applied => { if (applied && source === props.source) appliedSource = source.id })
    .catch(cause => { if (live && owner === session.user?.id && source === props.source && conversation === current.value) emit('remixError', errorMessage(cause)) })
}, { immediate: true })
async function applyRemix(source: Work, initialFiles: StudioFile[] = [], fresh = false, isCurrent = () => true) {
  if (!session.user || !chats.ready || source.kind !== 'resource') return false
  const owner = session.user.id, previous = current.value, parameters = readRemixParameters(source.generation?.parameters)
  const selected = parameters?.skills || [], skills = await resolveRemixSkills(selected, 'text', owner)
  if (!live || !isCurrent() || owner !== session.user?.id || previous !== current.value || props.mode !== 'text' || !fresh && source !== props.source) return false
  const next = newChat(); next.sourceWorkId = source.id; next.draft = source.prompt; next.draftFiles = initialFiles
  next.skillIds = skills.map(skill => skill.id); next.remixSkills = skills
  if (skills.length < selected.length) notify('原作部分技能已下架、更新或不可用，本次已跳过。')
  if (models.value.some(item => item.id === source.model)) { next.model = source.model; next.textModel = source.model; model.value = source.model }
  if (parameters?.kind === 'text' && parameters.chatOptions) {
    Object.assign(next.settings, parameters.chatOptions)
    next.formatOverride = parameters.apiFormat === 'auto' ? undefined : parameters.chatOptions.format
    next.formatAutomatic = parameters.apiFormat === 'auto'
  }
  prompt.value = source.prompt; files.value = initialFiles
  await saveChats(true)
  return live && isCurrent() && owner === session.user?.id && next === current.value && props.mode === 'text'
}
watch([prompt, files], (_value, previous) => { if (current.value) { current.value.draft = prompt.value; current.value.draftFiles = files.value; void saveChats(files.value !== previous[1])?.catch(() => {}) } }, { deep: true })
watch(model, () => { if (current.value && model.value) { current.value.textModel = model.value; void saveChats() } })
watch(() => current.value?.messages.map(message => [message.id, messageText(message), message.reasoning, message.streaming, message.tools?.map(tool => [tool.id, tool.status])]), async () => { if (nearBottom.value) { await nextTick(); scrollToBottom() } }, { deep: true })
function followOutput() { if (nearBottom.value) scrollToBottom() }
function scrollToBottom() { if (messagesElement.value) messagesElement.value.scrollTop = messagesElement.value.scrollHeight; nearBottom.value = true }
function trackScroll() { const el = messagesElement.value; if (el) nearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
function selectChat(id: string) { historyMenu.value?.close(); emit('conversation', id) }
function createChat() { const next = newChat(props.mode); historyMenu.value?.close(); emit('conversation', next.id) }
function duplicate() { if (current.value) { cloneChat(current.value); emit('conversation', chats.activeId) } }
function handleEnter(event: KeyboardEvent) {
  if (ime.blocks(event)) { if (event.key === 'Enter' && !ime.isComposing(event)) event.preventDefault(); return }
  if (!shouldSubmit(event, studioPreferences.submitKey, window.matchMedia('(hover: hover) and (pointer: fine)').matches)) return
  event.preventDefault(); void send()
}
async function attachFiles(values: File[]) {
  if (!current.value || props.mode !== 'text' || busy.value || props.sourceBlocked) return
  const owner = session.user?.id, id = current.value.id
  error.value = ''
  try { await materials.add(values) }
  catch (cause) { if (owner === session.user?.id && id === current.value?.id) error.value = errorMessage(cause) }
}
function pasteFiles(event: ClipboardEvent) {
  const values = [...(event.clipboardData?.files || [])]
  if (!values.length) return
  event.preventDefault(); void attachFiles(values)
}
function dragEnter(event: DragEvent) {
  if (props.mode !== 'text' || !event.dataTransfer?.types.includes('Files')) return
  event.preventDefault(); dragDepth++; dragging.value = !busy.value && !props.sourceBlocked
}
function dragOver(event: DragEvent) {
  if (props.mode !== 'text' || !event.dataTransfer?.types.includes('Files')) return
  event.preventDefault(); event.dataTransfer.dropEffect = busy.value || props.sourceBlocked ? 'none' : 'copy'
}
function dragLeave(event: DragEvent) {
  if (props.mode !== 'text' || !event.dataTransfer?.types.includes('Files')) return
  event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dragging.value = false
}
function dropFiles(event: DragEvent) {
  if (props.mode !== 'text' || !event.dataTransfer?.types.includes('Files')) return
  event.preventDefault(); dragging.value = false; dragDepth = 0
  void attachFiles([...event.dataTransfer.files])
}
async function addFiles(event: Event) {
  const input = event.target as HTMLInputElement
  try { await attachFiles([...(input.files || [])]) }
  finally { input.value = '' }
}
async function applySourceReferences(selected: WorkFile[]) {
  if (!props.source || !current.value || uploading.value) return
  if (materials.failed.value) { error.value = '请先重试或移除失败的附件，再选择参考图。'; return }
  const owner = session.user?.id, chatId = current.value.id, sourceId = props.source.id
  const own = () => files.value.filter(file => file.fromWorkId !== sourceId)
  if (own().length + selected.length > 10) { error.value = '每轮最多添加 10 个附件。'; return }
  referenceLoading.value = true; error.value = ''
  try {
    const added = []
    for (const file of selected) {
      const response = await fetch(mediaSource(file.url)!, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('参考图无法读取，请重新选择或上传。')
      const blob = await response.blob()
      if (!blob.type.startsWith('image/')) throw new Error('参考文件请选择图片。')
      const content = await prepareStudioImage(new File([blob], file.name, { type: blob.type }), true)
      const parsed = { name: file.name, type: /^data:([^;,]+)/.exec(content)?.[1] || blob.type, size: blob.size, content, isText: false }
      if (owner !== session.user?.id || current.value?.id !== chatId || props.source?.id !== sourceId) return
      added.push({ ...parsed, sourceUrl: file.url, fromWorkId: sourceId })
    }
    const remaining = own()
    if (remaining.length + added.length > 10) throw new Error('每轮最多添加 10 个附件。')
    files.value = [...remaining, ...added]
  } catch (cause) { if (owner === session.user?.id && current.value?.id === chatId) error.value = errorMessage(cause) }
  finally { referenceLoading.value = false }
}
async function send() {
  if (props.entryOnly) return sendEntry()
  if (!current.value || props.sourceBlocked || busy.value || waitingForMaterials.value || referenceLoading.value || materials.failed.value || !models.value.some(item => item.id === model.value)) return
  nearBottom.value = true
  const text = prompt.value, quote = draftQuote.value, chat = current.value, owner = session.user?.id
  const acceptedModel = model.value, group = creation.selectedGroup, tokenId = creation.modelTokenId
  const preparation = new AbortController()
  materialSubmission = preparation; waitingForMaterials.value = true; chats.preparing[chat.id] = true; error.value = ''
  try {
    await materials.wait(preparation.signal)
    if (preparation.signal.aborted || owner !== session.user?.id || current.value?.id !== chat.id || props.mode !== 'text') return
    if (group !== creation.selectedGroup || tokenId !== creation.modelTokenId || acceptedModel !== model.value)
      throw new Error('模型或分组已变化，请重新发送。')
  } catch (cause) {
    if (owner === session.user?.id && current.value?.id === chat.id) error.value = errorMessage(cause)
    return
  } finally {
    if (owner === session.user?.id) chats.preparing[chat.id] = false
    if (materialSubmission === preparation) { materialSubmission = undefined; waitingForMaterials.value = false }
  }
  const attached = [...files.value]
  prompt.value = ''; files.value = []; draftQuote.value = undefined
  function restoreDraft() {
    if (owner !== session.user?.id || !chats.sessions.includes(chat) || chat.draft || chat.draftFiles?.length || chat.draftQuote) return
    chat.draft = text; chat.draftFiles = attached; chat.draftQuote = quote
    if (current.value?.id === chat.id) { prompt.value = text; files.value = attached }
    void saveChats(true)?.catch(() => {})
  }
  try {
    const submitted = await sendChat(chat, text, attached, acceptedModel, undefined, undefined, { quote })
    if (!submitted) restoreDraft()
  } catch (cause) { restoreDraft(); if (current.value?.id === chat.id && owner === session.user?.id) error.value = errorMessage(cause) }
}
async function sendEntry() {
  if (!canSend.value || !current.value) return
  const chat = current.value, owner = session.user?.id, preparation = new AbortController()
  const acceptedModel = model.value, group = creation.selectedGroup, tokenId = creation.modelTokenId
  materialSubmission = preparation; waitingForMaterials.value = true; error.value = ''
  try {
    await materials.wait(preparation.signal)
    if (!live || preparation.signal.aborted || owner !== session.user?.id || current.value?.id !== chat.id || props.mode !== 'text') return
    if (acceptedModel !== model.value || group !== creation.selectedGroup || tokenId !== creation.modelTokenId) throw new Error('模型或分组已变化，请重新发送。')
    const parameters = JSON.parse(JSON.stringify({ model: acceptedModel, group, tokenId, apiFormat: currentFormat.value, settings: { ...chat.settings, format: effectiveFormat.value }, system: chat.system, skillIds: chat.skillIds, search: chat.search, compressionThreshold: chat.compressionThreshold, sendMemory: chat.sendMemory, toolContext: chat.toolContext, files: files.value }))
    emit('entry', { owner: owner || null, kind: 'text', prompt: prompt.value, parameters })
  } catch (cause) { if (live && !preparation.signal.aborted && owner === session.user?.id) error.value = errorMessage(cause) }
  finally { if (materialSubmission === preparation) { materialSubmission = undefined; waitingForMaterials.value = false } }
}
async function regenerate(message: NativeMessage) {
  if (!current.value || props.sourceBlocked || busy.value || !models.value.some(item => item.id === model.value)) return
  const index = current.value.messages.indexOf(message)
  const user = current.value.messages.slice(0, index + 1).reverse().find(item => item.role === 'user')
  if (user) {
    const chat = current.value, owner = session.user?.id
    try { await sendChat(chat, messageText(user), [], model.value, user) }
    catch (cause) { if (current.value?.id === chat.id && owner === session.user?.id) error.value = errorMessage(cause) }
  }
}
function edit(message: NativeMessage) { edited.value = message }
async function saveEdit(message: NativeMessage, text: string) {
  if (!current.value || busy.value || props.sourceBlocked) return false
  const chat = current.value, owner = session.user?.id
  try {
    if (message.role === 'assistant') await editAssistantMessage(chat, message, text)
    else if (!await sendChat(chat, text, [], model.value, undefined, message, { quote: message.quote })) return false
    if (current.value?.id === chat.id && owner === session.user?.id) edited.value = undefined
    return true
  } catch (cause) { if (current.value?.id === chat.id && owner === session.user?.id) error.value = errorMessage(cause); return false }
}
function quoteSelection(quote: MessageQuote) { if (busy.value) return; draftQuote.value = quote; void nextTick(() => composerElement.value?.focus()) }
async function copy(message: NativeMessage, selected = '') { try { await navigator.clipboard.writeText(selected || messageText(message)); notify('已复制。') } catch { error.value = '复制失败，请选择内容后复制。' } }
async function fillSuggestion(message: NativeMessage, text: string) {
  if (!current.value || props.mode !== 'text' || busy.value || props.sourceBlocked || message !== current.value.messages.at(-1) || message.interrupted || message.error || pending(message)) return
  if ((prompt.value.trim() || files.value.length || draftQuote.value) && !confirm('替换当前输入的草稿？附件会保留。')) return
  prompt.value = text
  await nextTick(); composerElement.value?.focus()
}
async function remove() {
  const chat = current.value
  if (!chat || busy.value || !await confirmStudioDelete(`删除对话“${chat.topic}”？`, () => current.value === chat && !busy.value)) return
  const owner = session.user?.id, activeId = chats.activeId
  try { await removeChat(chat); if (owner === session.user?.id && chats.activeId !== activeId) emit('conversation', chats.activeId) }
  catch (cause) { if (owner === session.user?.id) error.value = errorMessage(cause) }
}
async function removeMessage(chat: NativeChat, message: NativeMessage) {
  if (busy.value || !await confirmStudioDelete('删除这条消息？', () => current.value === chat && chat.messages.includes(message) && !busy.value)) return
  deleteChatMessage(chat, message)
}
async function download(message: NativeMessage) { const task = creation.tasks.find(item => item.id === message.taskId); if (task) try { await downloadCreation(task, 0, undefined, messageText(message)) } catch (cause) { error.value = errorMessage(cause) } }
async function pin(message: NativeMessage) {
  const chat = current.value, owner = session.user?.id
  if (!chat) return
  try {
    const value = await togglePinnedMessage(chat, message.id)
    if (value !== undefined && current.value === chat && session.user?.id === owner) notify(value ? '已固定至当前对话上下文' : '已取消固定')
  } catch (cause) { if (current.value === chat && session.user?.id === owner) error.value = errorMessage(cause) }
}
function messageActions(message: NativeMessage): MessageAction[] {
  const chat = current.value!, pinned = !!chat.pinnedMessageIds?.includes(message.id), blocked = Boolean(busy.value || props.sourceBlocked)
  const task = creation.tasks.find(item => item.owner === session.user?.id && item.id === message.taskId)
  const items: MessageAction[] = [
    { icon: 'edit', label: message.role === 'user' ? '编辑提问' : '编辑回答', disabled: blocked || pending(message) || message.role === 'user' && !models.value.some(item => item.id === model.value), run: () => edit(message) },
    { icon: 'retry', label: message.role === 'user' ? '重新发送提问' : '重新生成回答', disabled: blocked || pending(message) || !models.value.some(item => item.id === model.value), run: () => regenerate(message) },
    { icon: 'delete', label: '删除消息', disabled: busy.value, run: () => removeMessage(chat, message) },
    { icon: 'pin', label: pinned ? '取消固定' : '固定到上下文', hint: pinned ? '取消固定：后续不再保留此条上下文' : '固定到上下文：清除历史后仍可用于图片和对话', pressed: pinned, disabled: blocked || pending(message) || !!message.interrupted || !!message.error, run: () => pin(message) },
    { icon: 'copy', label: message.role === 'user' ? '复制提问' : '复制回答', run: () => copy(message) },
  ]
  if (message.role === 'assistant' && task?.phase === 'complete' && !pending(message) && !message.interrupted) items.push(
    { icon: 'download', label: '下载文本', run: () => download(message) },
    { icon: 'publish', label: '发布作品', run: () => publish(message) },
    { icon: 'comment', label: '发送到源作品评论区', hint: task.sourceWorkId ? '发布至源作品评论区' : '从源作品制作同款后，可发布至其评论区', disabled: !task.sourceWorkId, run: () => publish(message, 'source-comment') },
  )
  return items
}
function publish(message: NativeMessage, destination: CreationDestination = 'community') {
  const task = creation.tasks.find(item => item.id === message.taskId)
  if (task) emit('publish', task, destination, messageText(message))
}
async function useTask(task: CreationTask) {
  if (restoringTask.value || task.kind !== 'text' || task.owner !== session.user?.id) return false
  const owner = session.user?.id
  let conversation = current.value?.id
  const currentScope = () => live && props.mode === 'text' && owner === session.user?.id && conversation === current.value?.id
  restoringTask.value = true; error.value = ''
  try {
    const parameters = readRemixParameters({ version: 1, kind: 'text', group: task.group, apiFormat: task.request.apiFormat, chatOptions: task.request.chatOptions, skills: task.request.skills })
    if (!parameters) throw new Error('原任务生成参数无效，请使用当前配置。')
    await waitCreationGroup(); await loadCreationGroups()
    if (!currentScope()) return false
    if (creation.groupsError) throw new Error(creation.groupsError)
    if (parameters.group && parameters.group !== creation.selectedGroup) {
      if (!creation.groups.some(group => group.id === parameters.group)) throw new Error('原作分组当前不可用，请手动选择分组和模型。')
      await selectCreationGroup(parameters.group)
      if (!currentScope()) return false
      if (creation.groupsError || creation.selectedGroup !== parameters.group) throw new Error(creation.groupsError || '原作分组未能恢复，请重新选择。')
    } else await loadCreationModels()
    if (!currentScope()) return false
    if (creation.modelsError) throw new Error(creation.modelsError)
    if (!models.value.some(item => item.id === task.model)) throw new Error('原作模型在当前分组不可用，请选择可用配置。')
    const skills = await resolveRemixSkills(parameters.skills || [], 'text', owner)
    if (!currentScope()) return false
    const next = newChat()
    conversation = next.id
    next.model = task.model; next.textModel = task.model; next.draft = task.prompt; next.sourceWorkId = task.sourceWorkId
    next.skillIds = skills.map(skill => skill.id); next.remixSkills = skills
    if (skills.length < (parameters.skills?.length || 0)) notify('原作部分技能已下架、更新或不可用，本次已跳过。')
    if (parameters.chatOptions) {
      Object.assign(next.settings, parameters.chatOptions)
      next.formatOverride = parameters.apiFormat === 'auto' ? undefined : parameters.chatOptions.format
      next.formatAutomatic = parameters.apiFormat === 'auto'
    }
    prompt.value = task.prompt; model.value = task.model; files.value = []
    await saveChats(true)
    if (!currentScope()) return false
    emit('source', task.sourceWorkId)
    return true
  } catch (cause) { if (currentScope()) error.value = errorMessage(cause); return false }
  finally { restoringTask.value = false }
}
function toggleSelection() { selecting.value = !selecting.value; selectedTurns.value = [] }
const hasMedia = computed(() => mediaTasks.value.length > 0)
defineExpose({ createChat, useTask, ready, applyRemix, applySourceReferences, referenceUrls, uploading, sourceWorkId, model, busy, canSend, send, hasMedia, clearContext, remove, toggleSelection, duplicate })
</script>
<template>
  <div class="native-chat" aria-label="对话工作台" @dragenter="dragEnter" @dragover="dragOver" @dragleave="dragLeave" @drop="dropFiles">
    <div v-if="dragging" class="attachment-drop-hint" role="status"><Plus :size="24" />添加附件</div>
    <section v-if="current" class="chat-main">
      <Teleport v-if="!entryOnly" defer to="#studio-header-conversation">
        <header v-show="headerVisible" class="chat-toolbar"><StudioConversationTitle :conversation="current" /><div class="chat-toolbar-actions"><StudioPopover ref="historyMenu" label="历史对话"><template #trigger><History :size="20" /></template><StudioConversations class="chat-history" @select="selectChat" /></StudioPopover><button class="studio-tool" title="新建对话" aria-label="新建对话" @click="createChat"><Plus :size="20" /></button><StudioPopover label="对话菜单" :width="240"><template #trigger><MoreHorizontal :size="20" /></template><button class="studio-command" :disabled="busy" @click="duplicate"><Copy :size="16" />复制对话</button><button class="studio-command danger" :disabled="busy" @click="remove"><Trash2 :size="16" />删除对话</button></StudioPopover></div></header>
      </Teleport>
      <div v-if="selecting" class="creation-selection" role="group" aria-label="消息多选操作"><label><input type="checkbox" aria-label="全选当前消息" :checked="!!mediaTasks.length && selectedTurns.length === mediaTasks.length" @change="selectedTurns = ($event.target as HTMLInputElement).checked ? mediaTasks.map(task => task.id) : []" />全选</label><span role="status">已选 {{ selectedTurns.length }} 轮</span><button class="icon-button" type="button" :disabled="!selectedTurns.length || busy" aria-label="删除所选消息" title="删除所选消息" @click="removeTurns"><Trash2 :size="17" /></button><button class="icon-button" type="button" aria-label="退出消息多选" title="退出多选" @click="selecting = false; selectedTurns = []"><X :size="17" /></button></div>
      <p v-if="creation.groupsError || creation.modelsError" class="form-error" role="alert">{{ creation.groupsError || creation.modelsError }}</p>
      <div v-if="!entryOnly" class="chat-messages-wrap"><div ref="messagesElement" class="chat-messages" tabindex="0" aria-label="对话消息" aria-live="polite" aria-relevant="additions" @scroll.passive="trackScroll">
        <div v-if="!current.messages.length" class="chat-empty"><img src="/assets/brand/octopus-community.jpg" width="40" height="40" alt="" /><p>开始新的对话</p></div>
        <div v-else ref="messagesContent" class="chat-transcript">
        <template v-for="(message, messageIndex) in current.messages" :key="message.id">
        <div v-if="mediaTask(message) && message.role === 'user'" class="creation-turn">
          <label v-if="selecting" class="creation-select-turn"><input v-model="selectedTurns" type="checkbox" :value="mediaTask(message)!.id" :aria-label="`选择消息：${mediaTask(message)!.prompt}`" /><span class="studio-sr-only">选择此轮</span></label>
          <StudioMediaTurn v-for="role in (['user', 'assistant'] as const)" :key="role" :role="role" :task="mediaTask(message)!" :conversation="current" @action="(action, task, index) => emit('mediaAction', action, task, index)" @publish="(task, destination) => emit('publish', task, destination)" @preview="(task, index) => mediaGallery?.open(task, index)" />
        </div>
        <StudioMessageFrame v-else-if="!mediaTask(message)" class="chat-message" :class="{ 'history-deferred': current.messages.length > 80 && messageIndex < current.messages.length - 12 && !pending(message) && edited?.id !== message.id }" :role="message.role === 'system' ? 'system' : message.role === 'user' ? 'user' : 'assistant'" :model="messageModel(message)" :created-at="message.createdAt" data-quotable-message :data-message-id="message.id" :data-message-role="message.role" tabindex="-1" @contextmenu="openMessageMenu($event, message)">
          <template #status><StudioAiStatus v-if="message.role === 'assistant' && !message.contextCompressing && (pending(message) || message.interrupted || message.error)" :state="messageStage(message)" :label="statusLabel(message)" :timer="pending(message)" /></template>
          <StudioMessageQuote v-if="message.quote" :quote="message.quote" />
          <p v-if="message.contextCompressing || message.contextCompressed" class="context-compression-notice" role="status" :data-compressing="message.contextCompressing">{{ message.contextCompressing ? '上下文正在压缩 · 可能需要几分钟' : '上下文已自动压缩' }}</p>
          <Suspense v-if="message.reasoning"><StudioReasoningPanel :content="message.reasoning" :streaming="pending(message)" :has-answer="Boolean(messageText(message))" :interrupted="message.interrupted" /><template #fallback><div><p class="reasoning-loading">{{ message.reasoning }}</p><button v-if="reasoningRetry" type="button" class="icon-button" title="重新加载思考过程" aria-label="重新加载思考过程" @click="reasoningRetry?.()"><RefreshCw :size="16" /></button></div></template></Suspense>
          <button v-if="canStop && pending(message)" class="icon-button" type="button" title="停止本页等待" aria-label="停止等待" @click="stop(message)"><Square :size="16" /></button>
          <StudioMessageEditor v-if="edited?.id === message.id" :initial-value="messageText(message)" :disabled="sourceBlocked || busy" :save-label="message.role === 'assistant' ? '保存修改' : '保存并重新生成'" :on-save="text => saveEdit(message, text)" @cancel="edited = undefined" />
          <Suspense v-else-if="message.role === 'assistant'"><StudioMarkdown class="message-content" :content="messageText(message)" :streaming="pending(message)" :sources="message.sources" @render="followOutput" /><template #fallback><div class="message-content"><p class="markdown-loading">{{ messageText(message) }}</p><button v-if="markdownRetry" type="button" class="icon-button" title="重新加载正文" aria-label="重新加载正文" @click="markdownRetry?.()"><RefreshCw :size="16" /></button></div></template></Suspense><p v-else class="user-text message-bubble">{{ messageText(message) }}</p>
          <div v-if="Array.isArray(message.content)" class="message-attachments"><template v-for="(part, index) in message.content" :key="index">
            <button v-if="part.type === 'image_url' && mediaUrl(part.image_url?.url, 'image')" class="attachment-image" type="button" title="放大图片" aria-label="放大图片附件" @click="openAttachment(mediaUrl(part.image_url?.url, 'image'))"><img :src="mediaUrl(part.image_url?.url, 'image')" alt="图片附件" loading="lazy" /></button>
            <div v-else-if="part.type === 'video_url' && mediaUrl(part.video_url?.url, 'video')" class="attachment-video"><video :src="mediaUrl(part.video_url?.url, 'video')" controls playsinline preload="metadata" aria-label="视频附件" /><button class="icon-button attachment-expand" type="button" title="放大视频附件" aria-label="放大视频附件" @click="openAttachment(mediaUrl(part.video_url?.url, 'video'), 'video')"><Maximize :size="17" /></button></div>
            <audio v-else-if="part.type === 'input_audio' && part.input_audio && audioUrl(part.input_audio)" :src="audioUrl(part.input_audio)" controls preload="none" aria-label="音频附件" />
            <span v-else-if="part.type !== 'text'">{{ part.file?.filename || (part.type === 'video_url' ? '视频附件' : part.type === 'image_url' ? '图片附件无法显示' : '音频附件') }}</span>
          </template></div>
          <StudioMessageSources v-if="message.role === 'assistant' && message.sources?.length" :sources="message.sources" />
          <StudioToolActivity v-for="tool in message.tools || []" :key="tool.id" :tool="tool" :disabled="sourceBlocked || busy" :on-rerun="args => rerunMessageTool(current!, message, tool, args)" />
          <StudioMessageOptions v-if="message.role === 'assistant' && message.interactions?.options" :definition="message.interactions.options" :receipt="message.optionReceipt" :disabled="sourceBlocked || busy || message.interrupted || current.messages.at(-1)?.id !== message.id || !models.some(item => item.id === model)" :on-submit="ids => submitMessageOptions(current!, message, ids, model)" />
          <StudioFollowupSuggestions v-if="mode === 'text' && message.role === 'assistant' && message === current.messages.at(-1) && message.interactions?.suggestions?.length && !pending(message) && !message.interrupted && !message.error" :suggestions="message.interactions.suggestions" :disabled="Boolean(busy || sourceBlocked)" @select="fillSuggestion(message, $event)" />
          <p v-if="message.error" class="form-error" role="alert">{{ message.error }}</p>
          <StudioMessageActions class="message-actions" :label="message.role === 'user' ? '提问操作' : '回答操作'" :actions="messageActions(message)" />
          <div v-if="branch(message).total > 1 || message.usage" class="message-meta">
            <template v-if="branch(message).total > 1"><button class="icon-button" title="上一个分支" aria-label="上一个分支" :disabled="busy || branch(message).index <= 0" @click="switchBranch(current, message.id, branch(message).messageIds[branch(message).index - 1]!)"><ChevronLeft :size="16" /></button><span>{{ branch(message).index + 1 }} / {{ branch(message).total }}</span><button class="icon-button" title="下一个分支" aria-label="下一个分支" :disabled="busy || branch(message).index >= branch(message).total - 1" @click="switchBranch(current, message.id, branch(message).messageIds[branch(message).index + 1]!)"><ChevronRight :size="16" /></button></template><span v-if="message.usage" class="message-usage">输入 {{ message.usage.inputTokens ?? '—' }} · 输出 {{ message.usage.outputTokens ?? '—' }}</span>
          </div>
        </StudioMessageFrame>
        <StudioClearContext v-if="messageIndex + 1 === current.clearContextIndex" :disabled="Boolean(busy)" @restore="restoreContext" />
        </template>
        </div>
      </div><StudioQuoteSelection :container="messagesElement" :disabled="Boolean(busy || contextMenu?.visible)" @quote="quoteSelection" /><button v-if="!nearBottom" class="icon-button jump-latest" title="回到最新消息" aria-label="回到最新消息" @click="scrollToBottom"><ArrowDown :size="18" /></button></div>
      <StudioResponseMetrics v-if="mode === 'text' && !entryOnly" :key="current.id" :messages="current.messages" />
      <div v-if="mode === 'text' && !entryOnly" class="studio-context-tools"><StudioModePicker v-if="!entryOnly" /><button v-if="!entryOnly" type="button" class="studio-tool" title="清除上下文" :disabled="busy" @click="clearContext"><Eraser :size="16" aria-hidden="true" />清除上下文</button><StudioSkillPicker :chat="current" :transient="entryOnly" :disabled="busy" /></div>
      <form v-if="mode === 'text'" class="chat-composer studio-composer" :aria-label="entryOnly ? '快捷创作' : undefined" @submit.prevent="send">
        <StudioMessageQuote v-if="draftQuote" :quote="draftQuote" :on-remove="() => draftQuote = undefined" />
        <StudioReferenceAttachments :references="draftImages" :disabled="busy" @remove="removeDraftImage" />
        <label class="field"><span class="studio-sr-only">{{ entryOnly ? '创作描述' : '消息' }}</span><textarea ref="composerElement" v-model="prompt" class="composer-input" rows="1" maxlength="100000" placeholder="发消息，描述你的想法…" :disabled="busy" @keydown="handleEnter" @keyup="ime.release" @compositionstart="ime.start" @compositionend="ime.end" @paste="pasteFiles" /></label>
        <StudioMaterialStatus :items="materialItems" :disabled="busy" @remove="materials.remove" @retry="materials.retry" @cancel="materials.cancel" />
        <div class="studio-composer-tools">
          <div class="studio-composer-actions"><label class="studio-tool composer-attachment attachment-button" title="添加附件"><LoaderCircle v-if="uploading" :size="18" /><Plus v-else :size="20" /><input type="file" aria-label="添加附件" multiple :accept="`${getFileAccept()},image/*,.heic,.heif`" :disabled="busy || uploading" @change="addFiles" /></label><StudioSearchPicker v-model="current.search" class="search-mode" :disabled="busy" @update:model-value="saveChats()" />
            <StudioPopover label="对话参数" :width="480"><template #trigger><Settings2 :size="20" /></template>
              <div class="mobile-chat-tools"><div class="field"><span>联网搜索</span><StudioSearchPicker v-model="current.search" :disabled="busy" @update:model-value="saveChats()" /></div></div>
              <StudioChatParameters :key="current.id" :chat="current" :format="currentFormat" :transient="entryOnly" @format="changeFormat" />
            </StudioPopover>
          </div>
          <div class="studio-composer-models chat-models"><StudioModelPicker v-model="model" kind="text" :inline-selection="entryOnly" @kind="(kind, model) => emit('kind', kind, model)" @keys="emit('keys')" /></div>
          <StudioBilling :compact="entryOnly" :model="model" :refresh-key="latestTask?.settledAt" @prices="emit('prices')" />
          <button v-if="waitingForMaterials" class="composer-submit" type="button" title="取消发送，保留草稿" aria-label="取消发送" @click="materialSubmission?.abort()"><Square :size="17" /></button>
          <button v-else class="composer-submit send-button" :title="entryOnly ? '发送到创作台' : '发送'" :aria-label="entryOnly ? '发送到创作台' : '发送'" :disabled="!canSend"><ArrowUp :size="21" /><span class="mobile-send-label">发送</span></button>
        </div>
        <p v-if="error || chats.error && (entryOnly || !chats.initialSaving[current.id])" class="form-error" role="alert">{{ error || chats.error }}</p>
      </form>
    </section>
    <section v-else class="chat-main">
      <div class="chat-messages-wrap"><div class="chat-messages"><div class="chat-empty"><img src="/assets/brand/octopus-community.jpg" width="40" height="40" alt="" /><p>开始新的对话</p></div></div></div>
      <div v-if="mode === 'text'" class="chat-composer studio-composer">
        <label class="field"><span class="studio-sr-only">消息</span><textarea class="composer-input" rows="1" placeholder="发消息，描述你的想法…" disabled /></label>
        <div class="studio-composer-tools"><button class="composer-submit send-button" type="button" aria-label="发送" disabled><ArrowUp :size="21" /></button></div>
      </div>
      <p v-if="chats.error" class="form-error" role="alert">{{ chats.error }}</p>
    </section>
    <StudioMediaPreview ref="attachmentDialog" :items="attachmentItems" :label="attachmentKind === 'image' ? '图片附件预览' : '视频附件预览'" :close-label="attachmentKind === 'image' ? '关闭图片' : '关闭视频'" @close="attachmentImage = undefined" />
    <StudioGallery :key="current?.id" ref="mediaGallery" preview-only />
    <StudioContextMenu ref="contextMenu" :items="menuItems" />
  </div>
</template>
<style scoped>
.markdown-loading, .reasoning-loading { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.markdown-loading { min-height: 28px; }
.reasoning-loading { max-height: 320px; overflow: auto; color: var(--muted); }
.history-deferred { content-visibility: auto; contain-intrinsic-block-size: auto 24rem; }
.history-deferred.user { contain-intrinsic-block-size: auto 9rem; }
@media print { .history-deferred { content-visibility: visible; } }
.native-chat { position: relative; flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.attachment-drop-hint { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; gap: 12px; pointer-events: none; border-radius: 8px; background: color-mix(in srgb, var(--surface) 94%, transparent); color: var(--ink); }
.creation-selection, .creation-select-turn { display: flex; align-items: center; gap: 8px; }.creation-selection { flex: none; min-height: 44px; color: var(--muted); font-size: 13px; }.creation-selection label { display: flex; align-items: center; gap: 8px; }.creation-selection > span { margin-inline-end: auto; }.creation-turn { position: relative; }.creation-select-turn { position: absolute; inset-inline-start: 0; top: 0; min-height: 28px; }.creation-turn:has(> .creation-select-turn) { padding-inline-start: 32px; }
.chat-main { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.chat-main :deep(.billing-controls) { flex-wrap: wrap; }
@media (min-width: 1000px) {
  .chat-toolbar > .chat-toolbar-actions { display: none; }
  .chat-main .chat-messages { padding-inline: 0; }
}
.chat-toolbar, .chat-toolbar-actions, .message-heading, .message-meta { display: flex; align-items: center; gap: 8px; }
.chat-toolbar { flex: 1; justify-content: space-between; min-width: 0; min-height: 44px; }.chat-toolbar-actions { flex: none; }
.chat-history { max-height: min(480px, 60dvh); }
.chat-messages-wrap { position: relative; flex: 1; min-height: 0; }.chat-messages { height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 24px 8px; scrollbar-color: var(--border) transparent; }.chat-empty { height: 100%; min-height: 80px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: var(--muted); font-size: 16px; }.chat-empty img { border-radius: 10px; }.chat-empty p { margin: 0; }.jump-latest { position: absolute; right: 12px; bottom: 8px; border: 1px solid var(--border); border-radius: 50%; background: var(--canvas); }
.message-usage { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.message-content, .user-text { overflow-wrap: anywhere; font-size: 16px; line-height: 28px; max-width: min(75ch, 100%); min-width: 0; }.user-text { margin: 0; }.message-content :deep(p) { margin-block: 0 12px; }.message-content :deep(> :last-child) { margin-bottom: 0; }.message-content :deep(pre) { overflow-x: auto; max-width: 100%; padding: 12px; background: var(--canvas); border-radius: 6px; font-size: 14px; line-height: 22px; }.message-content :deep(img) { max-width: 100%; }.message-content :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; }.message-content :deep(td), .message-content :deep(th) { border: 1px solid var(--border); padding: 8px; }.message-content :deep(a), .search-sources a { color: var(--blue); text-decoration: underline; text-underline-offset: 3px; }.message-content :deep(blockquote) { margin-inline: 0; border-left: 1px solid var(--border); padding-left: 16px; color: var(--muted); }
.message-meta { display: flex; flex-wrap: wrap; margin-top: 8px; font-size: 12px; }.message-attachments { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; margin-top: 12px; max-width: 100%; }.message-attachments img { display: block; width: auto; max-width: min(360px, 100%); max-height: 320px; object-fit: contain; border-radius: 6px; }.attachment-image { max-width: 100%; border: 0; padding: 0; background: transparent; cursor: zoom-in; }.message-attachments video, .message-attachments audio { width: min(480px, 100%); max-width: 100%; }
.chat-message > .reasoning, .chat-message > .tool-activity, .chat-message > .message-options, .chat-message > .message-editor { width: min(75ch, 100%); }
.chat-composer > .message-quote { margin: 0 8px 8px; max-height: 120px; overflow: auto; }
.context-compression-notice { margin: 0 0 8px; color: var(--muted); font-size: 12px; }
.composer-files { padding: 0 8px; margin: 8px 0; list-style: none; display: flex; gap: 8px; flex-wrap: wrap; }.composer-files li { display: flex; gap: 8px; align-items: center; font-size: 12px; max-width: 100%; }.composer-files li span { overflow-wrap: anywhere; }.editing-state { display: flex; align-items: center; gap: 8px; color: var(--amber); font-size: 12px; margin: 0 8px 8px; }
.attachment-video { position: relative; max-width: 100%; }.attachment-expand { position: absolute; top: 8px; right: 8px; background: rgb(0 0 0 / 65%); color: white; }
@media (max-width: 999px) { .chat-toolbar { display: none; }.chat-messages { padding: 16px 4px; }.message-usage { flex-basis: 100%; } }
</style>
