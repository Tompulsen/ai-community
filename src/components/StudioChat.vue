<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Eraser, History, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Settings2, Sparkles, Square, Trash2, X } from '@lucide/vue'
import { session, errorMessage, notify } from '../state'
import type { Work, WorkFile } from '../data'
import { creation, downloadCreation, initializeCreation, loadCreationGroups, loadCreationModels, mediaSource, type CreationTask, type CreationDestination } from '../native-studio'
import { chats, newChat, loadChats, saveChats, removeChat, cloneChat, sendChat, stopChat, switchBranch, removeMessage, recoverMessage, submitMessageOptions, rerunMessageTool, editAssistantMessage, type NativeMessage } from '../native-chat'
import { answerBranches } from '../../shared/studio/chat-branches'
import { parseFile, getFileAccept, type ParsedFile } from '../../shared/studio/file-upload'
import { REASONING_EFFORT_OPTIONS } from '../../shared/studio/chat-params'
import { CHAT_API_FORMATS } from '../../shared/studio/chat-api-format'
import StudioSkills from './StudioSkills.vue'
import StudioPopover from './StudioPopover.vue'
import StudioModePicker from './StudioModePicker.vue'
import StudioSearchPicker from './StudioSearchPicker.vue'
import StudioBilling from './StudioBilling.vue'
import StudioModelPicker from './StudioModelPicker.vue'
import StudioConversations from './StudioConversations.vue'
import StudioConversationTitle from './StudioConversationTitle.vue'
import StudioMarkdown from './studio-message/StudioMarkdown.vue'
import StudioReasoningPanel from './studio-message/StudioReasoningPanel.vue'
import StudioAiStatus from './studio-message/StudioAiStatus.vue'
import StudioMessageSources from './studio-message/StudioMessageSources.vue'
import StudioMessageQuote from './studio-message/StudioMessageQuote.vue'
import StudioQuoteSelection from './studio-message/StudioQuoteSelection.vue'
import StudioMessageEditor from './studio-message/StudioMessageEditor.vue'
import StudioMessageOptions from './studio-message/StudioMessageOptions.vue'
import StudioToolActivity from './studio-message/StudioToolActivity.vue'
import StudioMaterialStatus from './studio-message/StudioMaterialStatus.vue'
import { useStudioMaterials } from '../use-studio-materials'
import { getResponseMetrics } from '../../shared/studio/chat-response-metrics'
import type { MessageQuote } from '../../shared/studio/message-quote'
import { conversationKind } from '../studio-conversations'
import { modelFormat, modelsForKind, setModelFormat, takeModelChoice } from '../model-preferences'
import { readRemixParameters } from '../../shared/studio/remix-parameters'
const props = defineProps<{ source?: Work | null; sourceBlocked?: boolean }>()
const emit = defineEmits<{ prices: []; keys: []; publish: [task: CreationTask, destination: CreationDestination]; source: [id?: string]; conversation: [id: string] }>()
const current = computed(() => chats.sessions.find(chat => chat.id === chats.activeId && conversationKind(chat) === 'text'))
const currentFormat = computed(() => current.value?.formatOverride || modelFormat(model.value) || current.value?.settings.format)
const ready = computed(() => Boolean(current.value))
const sourceWorkId = computed(() => current.value?.sourceWorkId)
const prompt = ref(''), model = ref(''), files = ref<(ParsedFile & { sourceUrl?: string; fromWorkId?: string })[]>([]), error = ref(''), referenceLoading = ref(false), edited = ref<NativeMessage>(), messagesElement = ref<HTMLElement>(), composerElement = ref<HTMLTextAreaElement>()
const materials = useStudioMaterials(files, computed(() => `${session.user?.id || ''}:${current.value?.id || ''}`))
const uploading = computed(() => referenceLoading.value || materials.pending.value)
const metrics = computed(() => getResponseMetrics(current.value?.messages || []))
const speedLabel = computed(() => metrics.value.outputTokensPerSecond === undefined ? '— tok/s' : `${metrics.value.speedIsEstimated ? '约 ' : ''}${metrics.value.outputTokensPerSecond.toFixed(1)} tok/s`)
const speedDescription = computed(() => `${metrics.value.speedIsPrevious ? '显示上一轮可用统计。' : ''}从首个到最后一个模型输出计算，不含首字前等待和工具执行时间。${metrics.value.speedIsEstimated ? '当前为客户端估算。' : ''}`)
const draftQuote = computed({ get: () => current.value?.draftQuote, set: value => { if (current.value) { current.value.draftQuote = value; void saveChats() } } })
const referenceUrls = computed(() => files.value.flatMap(file => file.sourceUrl ? [file.sourceUrl] : []))
const historyMenu = ref<InstanceType<typeof StudioPopover>>(), nearBottom = ref(true)
const messagesContent = ref<HTMLElement>()
const transcriptObserver = new ResizeObserver(() => followOutput())
watch(messagesContent, element => { transcriptObserver.disconnect(); if (element) transcriptObserver.observe(element) }, { flush: 'post' })
onBeforeUnmount(() => transcriptObserver.disconnect())
const mobileSkillsLoaded = ref(false), desktopSkillsLoaded = ref(false)
const models = computed(() => modelsForKind('text'))
const busy = computed(() => current.value && chats.busy[current.value.id])
const latestTask = computed(() => creation.tasks.find(task => task.id === current.value?.messages.at(-1)?.taskId))
function messageText(message: NativeMessage) { return typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') }
function messageModel(message: NativeMessage) { return creation.tasks.find(task => task.id === message.taskId)?.model || current.value?.model || '助手' }
function branch(message: NativeMessage) { return current.value ? answerBranches(current.value, message.id) : { index: 0, total: 1, messageIds: [] } }
function pending(message: NativeMessage) { return message.role === 'assistant' && Boolean(message.streaming || busy.value && current.value?.messages.at(-1)?.id === message.id) }
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
const attachmentImage = ref<string>(), attachmentDialog = ref<HTMLDialogElement>()
function openAttachment(url: string | undefined) { if (!url) return; attachmentImage.value = url; attachmentDialog.value?.showModal() }
watch(() => current.value?.id, () => { attachmentDialog.value?.close(); attachmentImage.value = undefined })
watch(() => session.user?.id, () => { attachmentDialog.value?.close(); attachmentImage.value = undefined; error.value = ''; edited.value = undefined })
watch(() => session.user?.id, async () => { if (!session.user) return; await initializeCreation(); await loadCreationGroups(); await loadCreationModels(); await loadChats() }, { immediate: true })
function chooseModel() {
  if (!current.value || !creation.modelsLoaded || creation.modelsLoading || creation.groupsLoading || creation.groupSwitching) return
  const next = takeModelChoice('text', models.value) || (models.value.some(item => item.id === current.value?.model) ? current.value!.model! : models.value[0]?.id || '')
  model.value = next
  if (next && current.value.model !== next) { current.value.model = next; void saveChats() }
}
watch([models, () => creation.modelsLoaded, () => creation.groupsLoading, () => creation.groupSwitching], chooseModel)
function changeFormat(event: Event) {
  if (!current.value) return
  const format = (event.target as HTMLSelectElement).value as typeof current.value.settings.format
  if (current.value.formatOverride) { current.value.formatOverride = format; void saveChats() }
  else if (modelFormat(model.value)) {
    try { setModelFormat(model.value, format) } catch (cause) { error.value = errorMessage(cause) }
  } else { current.value.settings.format = format; void saveChats() }
}
watch(() => current.value?.id, () => { chooseModel(); files.value = current.value?.draftFiles || []; prompt.value = current.value?.draft || ''; edited.value = undefined; nearBottom.value = true; void nextTick(scrollToBottom) }, { immediate: true })
let appliedSource = ''
watch([() => props.source?.id, ready], () => {
  if (!props.source) { appliedSource = ''; return }
  if (!ready.value || appliedSource === props.source.id) return
  appliedSource = props.source.id
  if (current.value?.sourceWorkId === props.source.id) return
  const next = newChat(); next.sourceWorkId = props.source.id; next.draft = props.source.prompt
  if (models.value.some(item => item.id === props.source!.model)) { next.model = props.source.model; model.value = props.source.model }
  const parameters = readRemixParameters(props.source.generation?.parameters)
  if (parameters?.kind === 'text' && parameters.chatOptions) {
    Object.assign(next.settings, parameters.chatOptions)
    next.formatOverride = parameters.chatOptions.format
  }
  prompt.value = props.source.prompt; files.value = []
  void saveChats()
}, { immediate: true })
watch([prompt, files], () => { if (current.value) { current.value.draft = prompt.value; current.value.draftFiles = files.value; void saveChats() } }, { deep: true })
watch(model, () => { if (current.value && model.value) { current.value.model = model.value; void saveChats() } })
watch(() => current.value?.messages.map(message => [message.id, messageText(message), message.reasoning, message.streaming, message.tools?.map(tool => [tool.id, tool.status])]), async () => { if (nearBottom.value) { await nextTick(); scrollToBottom() } }, { deep: true })
function followOutput() { if (nearBottom.value) scrollToBottom() }
function scrollToBottom() { if (messagesElement.value) messagesElement.value.scrollTop = messagesElement.value.scrollHeight; nearBottom.value = true }
function trackScroll() { const el = messagesElement.value; if (el) nearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
function selectChat(id: string) { historyMenu.value?.close(); emit('conversation', id) }
function createChat() { newChat(); historyMenu.value?.close(); emit('source') }
function handleEnter(event: KeyboardEvent) { if (event.isComposing || event.keyCode === 229 || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return; event.preventDefault(); void send() }
async function addFiles(event: Event) {
  const input = event.target as HTMLInputElement, owner = session.user?.id
  const chatId = current.value?.id
  error.value = ''
  try { await materials.add([...(input.files || [])]) }
  catch (cause) { if (owner === session.user?.id && chatId === current.value?.id) error.value = errorMessage(cause) }
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
      const parsed = await parseFile(new File([blob], file.name, { type: blob.type }))
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
  if (!current.value || props.sourceBlocked || busy.value || uploading.value || materials.failed.value || !models.value.some(item => item.id === model.value)) return
  nearBottom.value = true
  const text = prompt.value, attached = [...files.value], quote = draftQuote.value, chat = current.value, owner = session.user?.id
  error.value = ''; prompt.value = ''; files.value = []; draftQuote.value = undefined
  function restoreDraft() {
    if (owner !== session.user?.id || !chats.sessions.includes(chat) || chat.draft || chat.draftFiles?.length || chat.draftQuote) return
    chat.draft = text; chat.draftFiles = attached; chat.draftQuote = quote
    if (current.value?.id === chat.id) { prompt.value = text; files.value = attached }
    void saveChats()
  }
  try {
    const submitted = await sendChat(chat, text, attached, model.value, undefined, undefined, { quote })
    if (!submitted) restoreDraft()
  } catch (cause) { restoreDraft(); if (current.value?.id === chat.id && owner === session.user?.id) error.value = errorMessage(cause) }
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
async function copy(message: NativeMessage) { try { await navigator.clipboard.writeText(messageText(message)); notify('已复制。') } catch { error.value = '复制失败，请选择内容后复制。' } }
async function remove() {
  if (!current.value || !confirm(`删除对话“${current.value.topic}”？`)) return
  const owner = session.user?.id, activeId = chats.activeId
  try { await removeChat(current.value); if (owner === session.user?.id && chats.activeId !== activeId) emit('conversation', chats.activeId) }
  catch (cause) { if (owner === session.user?.id) error.value = errorMessage(cause) }
}
async function recover(message: NativeMessage) { try { await recoverMessage(message) } catch (cause) { error.value = errorMessage(cause) } }
async function download(message: NativeMessage) { const task = creation.tasks.find(item => item.id === message.taskId); if (task) try { await downloadCreation(task) } catch (cause) { error.value = errorMessage(cause) } }
function publish(message: NativeMessage, destination: CreationDestination = 'community') {
  const task = creation.tasks.find(item => item.id === message.taskId)
  if (task) emit('publish', task, destination)
}
function useTask(task: CreationTask) { const next = newChat(); next.model = task.model; next.draft = task.prompt; next.sourceWorkId = task.sourceWorkId; prompt.value = task.prompt; model.value = task.model; files.value = []; void saveChats(); emit('source', task.sourceWorkId) }
defineExpose({ createChat, useTask, ready, applySourceReferences, referenceUrls, uploading, sourceWorkId, model })
</script>
<template>
  <div class="native-chat" aria-label="对话工作台">
    <section v-if="current" class="chat-main">
      <header class="chat-toolbar"><StudioConversationTitle :conversation="current" /><div class="chat-toolbar-actions"><StudioPopover ref="historyMenu" label="历史对话"><template #trigger><History :size="18" /></template><StudioConversations class="chat-history" @select="selectChat" /></StudioPopover><button class="studio-tool" title="新建对话" aria-label="新建对话" @click="createChat"><Plus :size="19" /></button><StudioPopover label="对话菜单" :width="240"><template #trigger><MoreHorizontal :size="19" /></template><button class="studio-command" :disabled="busy" @click="cloneChat(current)"><Copy :size="16" />复制对话</button><button class="studio-command danger" :disabled="busy" @click="remove"><Trash2 :size="16" />删除对话</button></StudioPopover></div></header>
      <p v-if="creation.groupsError || creation.modelsError" class="form-error" role="alert">{{ creation.groupsError || creation.modelsError }}</p>
      <div class="chat-messages-wrap"><div ref="messagesElement" class="chat-messages" tabindex="0" aria-label="对话消息" aria-live="polite" aria-relevant="additions" @scroll.passive="trackScroll">
        <div v-if="!current.messages.length" class="chat-empty"><img src="/assets/brand/octopus-community.jpg" width="40" height="40" alt="" /><p>开始新的对话</p></div>
        <div v-else ref="messagesContent" class="chat-transcript">
        <article v-for="message in current.messages" :key="message.id" class="chat-message" :class="message.role" data-quotable-message :data-message-id="message.id" :data-message-role="message.role">
          <div class="message-heading"><img v-if="message.role === 'assistant'" src="/assets/brand/octopus-community.jpg" width="24" height="24" alt="" /><span v-else-if="message.role === 'user'" class="message-avatar" aria-hidden="true">{{ (session.user?.name || session.user?.username || '你').slice(0, 1) }}</span><strong>{{ message.role === 'user' ? '你' : message.role === 'system' ? '系统' : messageModel(message) }}</strong><time v-if="message.createdAt">{{ new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</time><LoaderCircle v-if="message.streaming" :size="15" /></div>
          <StudioMessageQuote v-if="message.quote" :quote="message.quote" />
          <p v-if="message.contextCompressing || message.contextCompressed" class="context-compression-notice" role="status" :data-compressing="message.contextCompressing">{{ message.contextCompressing ? '上下文正在压缩 · 可能需要几分钟' : '上下文已自动压缩' }}</p>
          <StudioReasoningPanel v-if="message.reasoning" :content="message.reasoning" :streaming="pending(message)" :has-answer="Boolean(messageText(message))" :interrupted="message.interrupted" />
          <StudioAiStatus v-if="message.role === 'assistant' && !message.contextCompressing && (pending(message) || message.interrupted || message.error)" :state="messageStage(message)" :label="statusLabel(message)" :timer="pending(message)" />
          <StudioMessageEditor v-if="edited?.id === message.id" :initial-value="messageText(message)" :disabled="sourceBlocked || busy" :save-label="message.role === 'assistant' ? '保存修改' : '保存并重新生成'" :on-save="text => saveEdit(message, text)" @cancel="edited = undefined" />
          <StudioMarkdown v-else-if="message.role === 'assistant'" class="message-content" :content="messageText(message)" :streaming="pending(message)" :sources="message.sources" @render="followOutput" /><p v-else class="user-text">{{ messageText(message) }}</p>
          <div v-if="Array.isArray(message.content)" class="message-attachments"><template v-for="(part, index) in message.content" :key="index">
            <button v-if="part.type === 'image_url' && mediaUrl(part.image_url?.url, 'image')" class="attachment-image" type="button" title="放大图片" aria-label="放大图片附件" @click="openAttachment(mediaUrl(part.image_url?.url, 'image'))"><img :src="mediaUrl(part.image_url?.url, 'image')" alt="图片附件" loading="lazy" /></button>
            <video v-else-if="part.type === 'video_url' && mediaUrl(part.video_url?.url, 'video')" :src="mediaUrl(part.video_url?.url, 'video')" controls preload="metadata" aria-label="视频附件" />
            <audio v-else-if="part.type === 'input_audio' && part.input_audio && audioUrl(part.input_audio)" :src="audioUrl(part.input_audio)" controls preload="none" aria-label="音频附件" />
            <span v-else-if="part.type !== 'text'">{{ part.file?.filename || (part.type === 'video_url' ? '视频附件' : part.type === 'image_url' ? '图片附件无法显示' : '音频附件') }}</span>
          </template></div>
          <StudioMessageSources v-if="message.role === 'assistant' && message.sources?.length" :sources="message.sources" />
          <StudioToolActivity v-for="tool in message.tools || []" :key="tool.id" :tool="tool" :disabled="sourceBlocked || busy" :on-rerun="args => rerunMessageTool(current!, message, tool, args)" />
          <StudioMessageOptions v-if="message.role === 'assistant' && message.interactions?.options" :definition="message.interactions.options" :receipt="message.optionReceipt" :disabled="sourceBlocked || busy || message.interrupted || current.messages.at(-1)?.id !== message.id || !models.some(item => item.id === model)" :on-submit="ids => submitMessageOptions(current!, message, ids, model)" />
          <p v-if="message.error" class="form-error" role="alert">{{ message.error }}</p><div v-if="message.role === 'assistant' && message.taskId && !message.streaming && !message.interrupted" class="message-actions"><button class="button subtle btn" @click="download(message)">下载文本</button><button class="button subtle btn" @click="publish(message)">发布作品</button><button v-if="creation.tasks.find(task => task.id === message.taskId)?.sourceWorkId" class="button subtle btn" @click="publish(message, 'source-comment')">发送到源作品评论区</button></div>
          <div class="message-actions">
            <button class="icon-button" title="复制消息" :aria-label="`复制${message.role === 'user' ? '提问' : '回答'}`" @click="copy(message)"><Copy :size="15" /></button><button v-if="message.role === 'user' || message.role === 'assistant'" class="icon-button" :title="message.role === 'user' ? '编辑提问' : '编辑回答'" :aria-label="message.role === 'user' ? '编辑提问' : '编辑回答'" :disabled="sourceBlocked || busy || message.role === 'user' && !models.some(item => item.id === model)" @click="edit(message)"><Pencil :size="15" /></button>
            <button v-if="message.role === 'assistant'" class="icon-button" title="重新生成回答" aria-label="重新生成回答" :disabled="sourceBlocked || busy || !models.some(item => item.id === model)" @click="regenerate(message)"><RefreshCw :size="15" /></button>
            <button v-if="message.interrupted && message.taskId" class="button subtle btn" :disabled="busy" @click="recover(message)">查询原请求</button><button class="icon-button" title="删除消息" aria-label="删除消息" :disabled="busy" @click="removeMessage(current, message)"><Trash2 :size="15" /></button><template v-if="branch(message).total > 1"><button class="icon-button" title="上一个分支" aria-label="上一个分支" :disabled="busy || branch(message).index <= 0" @click="switchBranch(current, message.id, branch(message).messageIds[branch(message).index - 1]!)"><ChevronLeft :size="15" /></button><span>{{ branch(message).index + 1 }} / {{ branch(message).total }}</span><button class="icon-button" title="下一个分支" aria-label="下一个分支" :disabled="busy || branch(message).index >= branch(message).total - 1" @click="switchBranch(current, message.id, branch(message).messageIds[branch(message).index + 1]!)"><ChevronRight :size="15" /></button></template><span v-if="message.usage" class="message-usage">输入 {{ message.usage.inputTokens ?? '—' }} · 输出 {{ message.usage.outputTokens ?? '—' }}</span>
          </div>
        </article>
        </div>
      </div><StudioQuoteSelection :container="messagesElement" :disabled="Boolean(busy)" @quote="quoteSelection" /><button v-if="!nearBottom" class="icon-button jump-latest" title="回到最新消息" aria-label="回到最新消息" @click="scrollToBottom"><ArrowDown :size="18" /></button></div>
      <StudioBilling :model="model" :refresh-key="latestTask?.settledAt" @prices="emit('prices')"><StudioModePicker /><button type="button" class="studio-tool" title="清除上下文" :disabled="busy" @click="current.clearContextIndex = current.messages.length; current.memoryPrompt = ''; current.lastSummarizeIndex = 0; saveChats()"><Eraser :size="16" aria-hidden="true" />清除上下文</button></StudioBilling>
      <form class="chat-composer studio-composer" @submit.prevent="send">
        <StudioMessageQuote v-if="draftQuote" :quote="draftQuote" :on-remove="() => draftQuote = undefined" />
        <label class="field"><span class="studio-sr-only">消息</span><textarea ref="composerElement" v-model="prompt" class="composer-input" rows="1" maxlength="100000" placeholder="发消息，描述你的想法…" :disabled="busy" @keydown.enter.exact="handleEnter" /></label>
        <StudioMaterialStatus :items="materials.snapshot.value.items" :disabled="busy" @remove="materials.remove" @retry="materials.retry" @cancel="materials.cancel" />
        <div class="studio-composer-tools">
          <div class="studio-composer-actions"><label class="studio-tool composer-attachment attachment-button" title="添加附件"><LoaderCircle v-if="uploading" :size="18" /><Plus v-else :size="20" /><input type="file" aria-label="添加附件" multiple :accept="`${getFileAccept()},image/*`" :disabled="busy || uploading" @change="addFiles" /></label><StudioSearchPicker v-model="current.search" class="search-mode" :disabled="busy" @update:model-value="saveChats()" /><span class="chat-skills-desktop"><StudioPopover label="技能与工具" :width="480" @toggle="desktopSkillsLoaded ||= $event"><template #trigger><Sparkles :size="17" /><span>技能{{ current.skillIds.length ? ` ${current.skillIds.length}` : '' }}</span></template><StudioSkills v-if="desktopSkillsLoaded" :chat="current" embedded /></StudioPopover></span>
            <StudioPopover label="对话参数" :width="480"><template #trigger><Settings2 :size="18" /></template>
              <div class="mobile-chat-tools"><div class="field"><span>联网搜索</span><StudioSearchPicker v-model="current.search" :disabled="busy" @update:model-value="saveChats()" /></div><details @toggle="mobileSkillsLoaded ||= ($event.target as HTMLDetailsElement).open"><summary>技能与工具</summary><StudioSkills v-if="mobileSkillsLoaded" :chat="current" embedded /></details></div>
              <div class="settings-grid">
                <label class="field"><span>接口格式</span><select :value="currentFormat" class="control" @change="changeFormat"><option v-for="format in CHAT_API_FORMATS" :key="format" :value="format">{{ format }}</option></select></label>
                <label class="field"><span>温度 {{ current.settings.temperature }}</span><input v-model.number="current.settings.temperature" type="range" min="0" max="2" step="0.1" @change="saveChats()" /></label><label class="field"><span>Top P</span><input v-model.number="current.settings.top_p" class="control" type="number" min="0" max="1" step="0.05" @change="saveChats()" /></label><label class="field"><span>最大输出 Tokens</span><input v-model.number="current.settings.max_tokens" class="control" type="number" min="1" max="1000000" @change="saveChats()" /></label><label class="field"><span>话题惩罚</span><input v-model.number="current.settings.presence_penalty" class="control" type="number" min="-2" max="2" step="0.1" @change="saveChats()" /></label><label class="field"><span>重复惩罚</span><input v-model.number="current.settings.frequency_penalty" class="control" type="number" min="-2" max="2" step="0.1" @change="saveChats()" /></label><label class="field"><span>推理强度</span><select v-model="current.settings.reasoningEffort" class="control" @change="saveChats()"><option v-for="option in REASONING_EFFORT_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label class="field"><span>历史压缩阈值</span><input v-model.number="current.compressionThreshold" class="control" type="number" min="500" max="2000000" @change="saveChats()" /></label><label class="field"><span>停止序列（每行一项）</span><textarea v-model="current.settings.stop" class="control" rows="2" @change="saveChats()" /></label><label class="field"><span>系统提示词</span><textarea v-model="current.system" class="control" rows="3" @change="saveChats()" /></label><label class="check-field"><input v-model="current.settings.stream" type="checkbox" @change="saveChats()" />流式输出</label><label class="check-field"><input v-model="current.sendMemory" type="checkbox" @change="saveChats()" />保留历史摘要</label>
              </div>
            </StudioPopover>
          </div>
          <div class="studio-composer-models chat-models"><StudioModelPicker v-model="model" kind="text" @keys="emit('keys')" /></div>
          <button v-if="busy" class="composer-submit" type="button" title="停止等待" aria-label="停止等待" @click="stopChat(current)"><Square :size="17" /><span class="mobile-send-label">停止</span></button>
          <button v-else class="composer-submit send-button" title="发送" aria-label="发送" :disabled="sourceBlocked || uploading || materials.failed.value || !models.some(item => item.id === model) || creation.groupSwitching || creation.modelsLoading || (!prompt.trim() && !files.length)"><ArrowUp :size="21" /><span class="mobile-send-label">发送</span></button>
        </div>
        <div class="composer-feedback"><span v-if="current.messages.some(message => message.role === 'assistant')" class="generation-speed" :title="speedDescription" :aria-label="`输出速度 ${speedLabel}`">{{ speedLabel }}</span><p v-if="current.search !== 'off'" class="search-cost">搜索与回答分别按章鱼账号配置计费。</p></div><p v-if="error || chats.error" class="form-error" role="alert">{{ error || chats.error }}</p>
      </form>
    </section>
    <p v-else class="muted" role="status">{{ chats.error || '正在读取对话…' }}</p>
    <dialog ref="attachmentDialog" class="attachment-dialog" aria-label="图片附件预览" @click="$event.target === attachmentDialog && attachmentDialog?.close()" @close="attachmentImage = undefined"><button class="icon-button attachment-close" type="button" title="关闭图片" aria-label="关闭图片" @click="attachmentDialog?.close()"><X :size="22" /></button><img v-if="attachmentImage" :src="attachmentImage" alt="放大图片附件" /></dialog>
  </div>
</template>
<style scoped>
.native-chat { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.chat-main { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.chat-main :deep(.billing-controls) { flex-wrap: wrap; }
@media (min-width: 1000px) {
  .chat-main .chat-toolbar-actions { display: none; }
  .chat-main .chat-messages { padding-inline: 0; }
  .chat-message.assistant > .message-content { padding-inline: 0; background: transparent; border-radius: 0; }
}
.chat-toolbar, .chat-toolbar-actions, .message-heading, .message-actions { display: flex; align-items: center; gap: 8px; }
.chat-toolbar { flex: none; justify-content: space-between; min-width: 0; min-height: 44px; }.chat-toolbar-actions { flex: none; }
.chat-history { max-height: min(480px, 60dvh); }
.chat-messages-wrap { position: relative; flex: 1; min-height: 0; }.chat-messages { height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 24px 8px; scrollbar-color: var(--border) transparent; }.chat-empty { height: 100%; min-height: 80px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: var(--muted); font-size: 16px; }.chat-empty img { border-radius: 10px; }.chat-empty p { margin: 0; }.jump-latest { position: absolute; right: 12px; bottom: 8px; border: 1px solid var(--border); border-radius: 50%; background: var(--canvas); }
.chat-message { display: flex; flex-direction: column; align-items: flex-start; padding: 0 0 32px; }.chat-message.user { align-items: flex-end; }.message-heading { font-size: 12px; color: var(--muted); margin-bottom: 12px; max-width: 100%; }.message-heading img { border-radius: 6px; }.message-heading strong { font-size: 12px; font-weight: 500; overflow-wrap: anywhere; }.message-avatar { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--surface-soft); font-size: 12px; color: var(--ink); }.user .message-heading { flex-direction: row-reverse; }.message-usage { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.message-content, .user-text { overflow-wrap: anywhere; font-size: 16px; line-height: 28px; max-width: min(75ch, 100%); min-width: 0; }.chat-message > .message-content, .user-text { padding: 12px 16px; border-radius: 16px; background: var(--surface); }.user-text { white-space: pre-wrap; margin: 0; max-width: min(65ch, 85%); }.message-content :deep(p) { margin-block: 0 12px; }.message-content :deep(> :last-child) { margin-bottom: 0; }.message-content :deep(pre) { overflow-x: auto; max-width: 100%; padding: 12px; background: var(--canvas); border-radius: 6px; font-size: 14px; line-height: 22px; }.message-content :deep(img) { max-width: 100%; }.message-content :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; }.message-content :deep(td), .message-content :deep(th) { border: 1px solid var(--border); padding: 8px; }.message-content :deep(a), .search-sources a { color: var(--blue); text-decoration: underline; text-underline-offset: 3px; }.message-content :deep(blockquote) { margin-inline: 0; border-left: 1px solid var(--border); padding-left: 16px; color: var(--muted); }
.message-actions { flex-wrap: wrap; margin-top: 12px; font-size: 12px; }.message-attachments { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; margin-top: 12px; max-width: 100%; }.message-attachments img { display: block; width: auto; max-width: min(360px, 100%); max-height: 320px; object-fit: contain; border-radius: 6px; }.attachment-image { max-width: 100%; border: 0; padding: 0; background: transparent; cursor: zoom-in; }.message-attachments video, .message-attachments audio { width: min(480px, 100%); max-width: 100%; }.attachment-dialog { max-width: 94vw; max-height: 94dvh; padding: 40px 12px 12px; border: 0; border-radius: 8px; background: var(--canvas); color: var(--ink); }.attachment-dialog::backdrop { background: rgb(0 0 0 / 75%); }.attachment-dialog > img { display: block; max-width: 88vw; max-height: 80dvh; object-fit: contain; }.attachment-close { position: absolute; top: 4px; right: 4px; }
.chat-message > .reasoning, .chat-message > .tool-activity, .chat-message > .message-options, .chat-message > .message-editor { width: min(75ch, 100%); }
.chat-composer > .message-quote { margin: 0 8px 8px; max-height: 120px; overflow: auto; }
.context-compression-notice { margin: 0 0 8px; color: var(--muted); font-size: 12px; }.composer-feedback { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding-inline: 8px; }.composer-feedback .search-cost { margin-inline: 0; }.generation-speed { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.composer-files { padding: 0 8px; margin: 8px 0; list-style: none; display: flex; gap: 8px; flex-wrap: wrap; }.composer-files li { display: flex; gap: 8px; align-items: center; font-size: 12px; max-width: 100%; }.composer-files li span { overflow-wrap: anywhere; }.search-cost { margin: 4px 8px 0; font-size: 12px; color: var(--muted); }.editing-state { display: flex; align-items: center; gap: 8px; color: var(--amber); font-size: 12px; margin: 0 8px 8px; }
.message-actions > .button { min-height: 32px; padding: 4px 8px; border: 0; background: transparent; color: var(--muted); font-size: 12px; }.message-actions > .button:hover { color: var(--ink); background: var(--surface); }
@media (hover: hover) and (pointer: fine) { .message-actions { opacity: 0; transition: opacity 200ms var(--ease); }.chat-message:hover .message-actions, .chat-message:focus-within .message-actions { opacity: 1; } }
@media (max-width: 639px) { .chat-toolbar-actions { gap: 0; }.chat-messages { padding: 16px 0; }.chat-message { padding-bottom: 24px; }.message-content, .user-text { font-size: 16px; line-height: 28px; }.message-usage { flex-basis: 100%; }.chat-message > .message-content, .user-text { padding: 12px; } }
</style>
