<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, Eraser, History, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Settings2, Sparkles, Square, Trash2, X } from '@lucide/vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { session, errorMessage, notify } from '../state'
import type { Work, WorkFile } from '../data'
import { creation, downloadCreation, initializeCreation, loadCreationGroups, loadCreationModels, mediaSource, type CreationTask, type CreationDestination } from '../native-studio'
import { chats, newChat, loadChats, saveChats, removeChat, cloneChat, sendChat, stopChat, switchBranch, removeMessage, recoverMessage, type NativeMessage } from '../native-chat'
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
import { modelFormat, modelsForKind, setModelFormat, takeModelChoice } from '../model-preferences'
import { readRemixParameters } from '../../shared/studio/remix-parameters'
const props = defineProps<{ source?: Work | null; sourceBlocked?: boolean }>()
const emit = defineEmits<{ prices: []; keys: []; publish: [task: CreationTask, destination: CreationDestination]; source: [id?: string] }>()
const current = computed(() => chats.sessions.find(chat => chat.id === chats.activeId))
const currentFormat = computed(() => current.value?.formatOverride || modelFormat(model.value) || current.value?.settings.format)
const ready = computed(() => Boolean(current.value))
const sourceWorkId = computed(() => current.value?.sourceWorkId)
const prompt = ref(''), model = ref(''), files = ref<(ParsedFile & { sourceUrl?: string; fromWorkId?: string })[]>([]), query = ref(''), error = ref(''), uploading = ref(false), edited = ref<NativeMessage>(), messagesElement = ref<HTMLElement>()
const referenceUrls = computed(() => files.value.flatMap(file => file.sourceUrl ? [file.sourceUrl] : []))
const historyMenu = ref<InstanceType<typeof StudioPopover>>(), nearBottom = ref(true)
const mobileSkillsLoaded = ref(false), desktopSkillsLoaded = ref(false)
const models = computed(() => modelsForKind('text'))
const busy = computed(() => current.value && chats.busy[current.value.id])
const latestTask = computed(() => creation.tasks.find(task => task.id === current.value?.messages.at(-1)?.taskId))
const visible = computed(() => chats.sessions.filter(chat => `${chat.topic} ${chat.messages.map(message => messageText(message)).join(' ')}`.toLowerCase().includes(query.value.toLowerCase())))
const render = (text: string) => DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { FORBID_TAGS: ['iframe', 'style', 'form'], FORBID_ATTR: ['style'] })
function messageText(message: NativeMessage) { return typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') }
function messageModel(message: NativeMessage) { return creation.tasks.find(task => task.id === message.taskId)?.model || current.value?.model || '助手' }
function branch(message: NativeMessage) { return current.value ? answerBranches(current.value, message.id) : { index: 0, total: 1, messageIds: [] } }
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
watch(() => current.value?.messages.map(message => [message.id, messageText(message), message.streaming]), async () => { if (nearBottom.value) { await nextTick(); scrollToBottom() } }, { deep: true })
function scrollToBottom() { if (messagesElement.value) messagesElement.value.scrollTop = messagesElement.value.scrollHeight; nearBottom.value = true }
function trackScroll() { const el = messagesElement.value; if (el) nearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
function selectChat(id: string) { chats.activeId = id; void saveChats(); historyMenu.value?.close(); emit('source', current.value?.sourceWorkId) }
function createChat() { newChat(); historyMenu.value?.close(); emit('source') }
function handleEnter(event: KeyboardEvent) { if (event.isComposing || event.keyCode === 229 || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return; event.preventDefault(); void send() }
async function addFiles(event: Event) {
  const input = event.target as HTMLInputElement, owner = session.user?.id
  uploading.value = true; error.value = ''
  try { for (const file of [...(input.files || [])]) { if (files.value.length >= 10) throw new Error('每轮最多添加 10 个附件。'); const parsed = await parseFile(file); if (owner !== session.user?.id) return; files.value.push(parsed) } }
  catch (cause) { error.value = errorMessage(cause) }
  finally { uploading.value = false; input.value = '' }
}
async function applySourceReferences(selected: WorkFile[]) {
  if (!props.source || !current.value || uploading.value) return
  const owner = session.user?.id, chatId = current.value.id, sourceId = props.source.id
  const own = () => files.value.filter(file => file.fromWorkId !== sourceId)
  if (own().length + selected.length > 10) { error.value = '每轮最多添加 10 个附件。'; return }
  uploading.value = true; error.value = ''
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
  finally { uploading.value = false }
}
async function send() {
  if (!current.value || props.sourceBlocked || busy.value || uploading.value || !models.value.some(item => item.id === model.value)) return
  nearBottom.value = true
  const text = prompt.value, attached = [...files.value], original = edited.value
  error.value = ''; prompt.value = ''; files.value = []; edited.value = undefined
  try { await sendChat(current.value, text, attached, model.value, undefined, original) }
  catch (cause) { error.value = errorMessage(cause); prompt.value = text; files.value = attached }
}
async function regenerate(message: NativeMessage) {
  if (!current.value || props.sourceBlocked || busy.value || !models.value.some(item => item.id === model.value)) return
  const index = current.value.messages.indexOf(message)
  const user = current.value.messages.slice(0, index + 1).reverse().find(item => item.role === 'user')
  if (user) await sendChat(current.value, messageText(user), [], model.value, user)
}
function edit(message: NativeMessage) { edited.value = message; prompt.value = messageText(message) }
async function copy(message: NativeMessage) { try { await navigator.clipboard.writeText(messageText(message)); notify('已复制。') } catch { error.value = '复制失败，请选择内容后复制。' } }
async function remove() { if (!current.value || !confirm(`删除对话“${current.value.topic}”？`)) return; try { await removeChat(current.value); emit('source', current.value?.sourceWorkId) } catch (cause) { error.value = errorMessage(cause) } }
async function recover(message: NativeMessage) { try { await recoverMessage(message) } catch (cause) { error.value = errorMessage(cause) } }
async function download(message: NativeMessage) { const task = creation.tasks.find(item => item.id === message.taskId); if (task) try { await downloadCreation(task) } catch (cause) { error.value = errorMessage(cause) } }
function publish(message: NativeMessage, destination: CreationDestination = 'community') {
  const task = creation.tasks.find(item => item.id === message.taskId)
  if (task) emit('publish', task, destination)
}
function useTask(task: CreationTask) { const next = newChat(); next.model = task.model; next.draft = task.prompt; next.sourceWorkId = task.sourceWorkId; prompt.value = task.prompt; model.value = task.model; files.value = []; void saveChats(); emit('source', task.sourceWorkId) }
defineExpose({ createChat, useTask, ready, applySourceReferences, referenceUrls, uploading, sourceWorkId })
</script>
<template>
  <div class="native-chat" aria-label="对话工作台">
    <section v-if="current" class="chat-main">
      <header class="chat-toolbar"><div class="chat-title"><input v-model="current.topic" class="conversation-title" aria-label="对话名称" maxlength="100" @change="saveChats()" /><span>{{ current.messages.filter(message => message.role !== 'system').length }} 条消息</span></div><div class="chat-toolbar-actions"><StudioPopover ref="historyMenu" label="历史对话"><template #trigger><History :size="18" /></template><div class="chat-history"><input v-model="query" class="control" type="search" aria-label="搜索对话" placeholder="搜索对话" /><nav aria-label="历史对话"><button v-for="chat in visible" :key="chat.id" class="session-row" :class="{ active: chat.id === chats.activeId }" :aria-current="chat.id === chats.activeId ? 'true' : undefined" @click="selectChat(chat.id)"><span>{{ chat.topic }}</span><LoaderCircle v-if="chats.busy[chat.id]" :size="14" /></button></nav><p v-if="!visible.length" class="muted">没有匹配的对话</p></div></StudioPopover><button class="studio-tool" title="新建对话" aria-label="新建对话" @click="createChat"><Plus :size="19" /></button><StudioPopover label="对话菜单" :width="240"><template #trigger><MoreHorizontal :size="19" /></template><button class="studio-command" :disabled="busy" @click="cloneChat(current)"><Copy :size="16" />复制对话</button><button class="studio-command" :disabled="busy" @click="current.clearContextIndex = current.messages.length; current.memoryPrompt = ''; current.lastSummarizeIndex = 0; saveChats()"><Eraser :size="16" />清除上下文</button><button class="studio-command danger" :disabled="busy" @click="remove"><Trash2 :size="16" />删除对话</button></StudioPopover></div></header>
      <p v-if="creation.groupsError || creation.modelsError" class="form-error" role="alert">{{ creation.groupsError || creation.modelsError }}</p>
      <div class="chat-messages-wrap"><div ref="messagesElement" class="chat-messages" tabindex="0" aria-label="对话消息" aria-live="polite" aria-relevant="additions" @scroll.passive="trackScroll">
        <div v-if="!current.messages.length" class="chat-empty"><img src="/assets/brand/octopus-community.jpg" width="40" height="40" alt="" /><p>开始新的对话</p></div>
        <article v-for="message in current.messages" :key="message.id" class="chat-message" :class="message.role">
          <div class="message-heading"><img v-if="message.role === 'assistant'" src="/assets/brand/octopus-community.jpg" width="24" height="24" alt="" /><span v-else-if="message.role === 'user'" class="message-avatar" aria-hidden="true">{{ (session.user?.name || session.user?.username || '你').slice(0, 1) }}</span><strong>{{ message.role === 'user' ? '你' : message.role === 'system' ? '系统' : messageModel(message) }}</strong><time v-if="message.createdAt">{{ new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</time><LoaderCircle v-if="message.streaming" :size="15" /></div>
          <details v-if="message.reasoning" class="reasoning"><summary>思考过程</summary><div class="message-content" v-html="render(message.reasoning)" /></details>
          <div v-if="message.role === 'assistant'" class="message-content" v-html="render(messageText(message))" /><p v-else class="user-text">{{ messageText(message) }}</p>
          <div v-if="Array.isArray(message.content)" class="message-attachments"><template v-for="(part, index) in message.content" :key="index"><img v-if="part.type === 'image_url'" :src="part.image_url?.url" alt="图片附件" /><span v-else-if="part.type !== 'text'">{{ part.file?.filename || (part.type === 'video_url' ? '视频附件' : '音频附件') }}</span></template></div>
          <ol v-if="message.sources?.length" class="search-sources"><li v-for="source in message.sources" :key="source.url"><a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a></li></ol>
          <p v-if="message.toolStatus" class="message-tool-status" role="status">{{ message.toolStatus }}</p><p v-if="message.error" class="form-error" role="alert">{{ message.error }}</p><div v-if="message.role === 'assistant' && message.taskId && !message.streaming && !message.interrupted" class="message-actions"><button class="button subtle btn" @click="download(message)">下载文本</button><button class="button subtle btn" @click="publish(message)">发布作品</button><button v-if="creation.tasks.find(task => task.id === message.taskId)?.sourceWorkId" class="button subtle btn" @click="publish(message, 'source-comment')">发送到源作品评论区</button></div>
          <div class="message-actions">
            <button class="icon-button" title="复制消息" :aria-label="`复制${message.role === 'user' ? '提问' : '回答'}`" @click="copy(message)"><Copy :size="15" /></button><button v-if="message.role === 'user'" class="icon-button" title="编辑提问" aria-label="编辑提问" :disabled="busy" @click="edit(message)"><Pencil :size="15" /></button>
            <button v-if="message.role === 'assistant'" class="icon-button" title="重新生成回答" aria-label="重新生成回答" :disabled="sourceBlocked || busy || !models.some(item => item.id === model)" @click="regenerate(message)"><RefreshCw :size="15" /></button>
            <button v-if="message.interrupted && message.taskId" class="button subtle btn" :disabled="busy" @click="recover(message)">查询原请求</button><button class="icon-button" title="删除消息" aria-label="删除消息" :disabled="busy" @click="removeMessage(current, message)"><Trash2 :size="15" /></button><template v-if="branch(message).total > 1"><button class="icon-button" title="上一个分支" aria-label="上一个分支" :disabled="busy || branch(message).index <= 0" @click="switchBranch(current, message.id, branch(message).messageIds[branch(message).index - 1]!)"><ChevronLeft :size="15" /></button><span>{{ branch(message).index + 1 }} / {{ branch(message).total }}</span><button class="icon-button" title="下一个分支" aria-label="下一个分支" :disabled="busy || branch(message).index >= branch(message).total - 1" @click="switchBranch(current, message.id, branch(message).messageIds[branch(message).index + 1]!)"><ChevronRight :size="15" /></button></template><span v-if="message.usage" class="message-usage">输入 {{ message.usage.inputTokens ?? '—' }} · 输出 {{ message.usage.outputTokens ?? '—' }}</span>
          </div>
        </article>
      </div><button v-if="!nearBottom" class="icon-button jump-latest" title="回到最新消息" aria-label="回到最新消息" @click="scrollToBottom"><ArrowDown :size="18" /></button></div>
      <StudioBilling :model="model" :refresh-key="latestTask?.settledAt" @prices="emit('prices')"><StudioModePicker /></StudioBilling>
      <form class="chat-composer studio-composer" @submit.prevent="send">
        <p v-if="edited" class="editing-state">正在编辑提问<button class="icon-button" type="button" title="取消编辑" aria-label="取消编辑" @click="edited = undefined; prompt = ''"><X :size="14" /></button></p>
        <label class="field"><span class="studio-sr-only">{{ edited ? '编辑内容' : '消息' }}</span><textarea v-model="prompt" class="composer-input" rows="1" maxlength="100000" placeholder="发消息，描述你的想法…" :disabled="busy" @keydown.enter.exact="handleEnter" /></label>
        <ul v-if="files.length" class="composer-files"><li v-for="(file, index) in files" :key="index"><span>{{ file.name }}</span><button class="icon-button" type="button" :aria-label="`移除附件 ${file.name}`" title="移除附件" @click="files.splice(index, 1)"><X :size="14" /></button></li></ul>
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
          <button v-else class="composer-submit send-button" :title="edited ? '提交修改' : '发送'" :aria-label="edited ? '提交修改' : '发送'" :disabled="sourceBlocked || uploading || !models.some(item => item.id === model) || creation.groupSwitching || creation.modelsLoading || (!prompt.trim() && !files.length)"><Check v-if="edited" :size="19" /><ArrowUp v-else :size="21" /><span class="mobile-send-label">{{ edited ? '提交修改' : '发送' }}</span></button>
        </div>
        <p v-if="current.search !== 'off'" class="search-cost">搜索与回答分别按章鱼账号配置计费。</p><p v-if="error || chats.error" class="form-error" role="alert">{{ error || chats.error }}</p>
      </form>
    </section>
    <p v-else class="muted" role="status">{{ chats.error || '正在读取对话…' }}</p>
  </div>
</template>
<style scoped>
.native-chat { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.chat-main { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
@media (min-width: 1000px) {
  .chat-main .chat-messages { padding-inline: 0; }
  .chat-message.assistant > .message-content { padding-inline: 0; background: transparent; border-radius: 0; }
}
.chat-toolbar, .chat-toolbar-actions, .chat-title, .message-heading, .message-actions { display: flex; align-items: center; gap: 8px; }
.chat-toolbar { flex: none; justify-content: space-between; min-height: 44px; }.chat-title { min-width: 0; gap: 12px; }.chat-title > span { color: var(--muted); font-size: 12px; white-space: nowrap; }.conversation-title { width: 176px; max-width: 35vw; border: 0; background: transparent; color: var(--ink); font-size: 14px; font-weight: 500; min-width: 0; padding: 8px 0; }
.chat-history nav { display: grid; margin-top: 12px; gap: 4px; }.chat-history .control { width: 100%; }.session-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; border: 0; background: transparent; color: var(--muted); padding: 12px; text-align: left; cursor: pointer; min-width: 0; border-radius: 4px; }.session-row span { text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }.session-row:hover, .session-row.active { background: var(--surface); color: var(--ink); }
.chat-messages-wrap { position: relative; flex: 1; min-height: 0; }.chat-messages { height: 100%; overflow-y: auto; overscroll-behavior: contain; padding: 24px 8px; scrollbar-color: var(--border) transparent; }.chat-empty { height: 100%; min-height: 80px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; color: var(--muted); font-size: 16px; }.chat-empty img { border-radius: 10px; }.chat-empty p { margin: 0; }.jump-latest { position: absolute; right: 12px; bottom: 8px; border: 1px solid var(--border); border-radius: 50%; background: var(--canvas); }
.chat-message { display: flex; flex-direction: column; align-items: flex-start; padding: 0 0 32px; }.chat-message.user { align-items: flex-end; }.message-heading { font-size: 12px; color: var(--muted); margin-bottom: 12px; max-width: 100%; }.message-heading img { border-radius: 6px; }.message-heading strong { font-size: 12px; font-weight: 500; overflow-wrap: anywhere; }.message-avatar { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--surface-soft); font-size: 12px; color: var(--ink); }.user .message-heading { flex-direction: row-reverse; }.message-usage { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.message-content, .user-text { overflow-wrap: anywhere; font-size: 16px; line-height: 28px; max-width: min(75ch, 100%); min-width: 0; }.chat-message > .message-content, .user-text { padding: 12px 16px; border-radius: 16px; background: var(--surface); }.user-text { white-space: pre-wrap; margin: 0; max-width: min(65ch, 85%); }.message-content :deep(p) { margin-block: 0 12px; }.message-content :deep(> :last-child) { margin-bottom: 0; }.message-content :deep(pre) { overflow-x: auto; max-width: 100%; padding: 12px; background: var(--canvas); border-radius: 6px; font-size: 14px; line-height: 22px; }.message-content :deep(img) { max-width: 100%; }.message-content :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; }.message-content :deep(td), .message-content :deep(th) { border: 1px solid var(--border); padding: 8px; }.message-content :deep(a), .search-sources a { color: var(--blue); text-decoration: underline; text-underline-offset: 3px; }.message-content :deep(blockquote) { margin-inline: 0; border-left: 1px solid var(--border); padding-left: 16px; color: var(--muted); }
.reasoning { margin-bottom: 12px; color: var(--muted); font-size: 12px; }.reasoning summary { cursor: pointer; margin-bottom: 8px; }.message-actions { flex-wrap: wrap; margin-top: 12px; font-size: 12px; }.message-attachments { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; margin-top: 12px; }.message-attachments img { width: 80px; height: 80px; object-fit: cover; border-radius: 4px; }.search-sources { font-size: 12px; line-height: 24px; padding-left: 24px; overflow-wrap: anywhere; }
.composer-files { padding: 0 8px; margin: 8px 0; list-style: none; display: flex; gap: 8px; flex-wrap: wrap; }.composer-files li { display: flex; gap: 8px; align-items: center; font-size: 12px; max-width: 100%; }.composer-files li span { overflow-wrap: anywhere; }.search-cost { margin: 4px 8px 0; font-size: 12px; color: var(--muted); }.editing-state { display: flex; align-items: center; gap: 8px; color: var(--amber); font-size: 12px; margin: 0 8px 8px; }
.message-actions > .button { min-height: 32px; padding: 4px 8px; border: 0; background: transparent; color: var(--muted); font-size: 12px; }.message-actions > .button:hover { color: var(--ink); background: var(--surface); }
@media (hover: hover) and (pointer: fine) { .message-actions { opacity: 0; transition: opacity 200ms var(--ease); }.chat-message:hover .message-actions, .chat-message:focus-within .message-actions { opacity: 1; } }
@media (max-width: 639px) { .conversation-title { width: 112px; font-size: 14px; }.chat-title { gap: 4px; }.chat-title > span { font-size: 12px; }.chat-toolbar-actions { gap: 0; }.chat-messages { padding: 16px 0; }.chat-message { padding-bottom: 24px; }.message-content, .user-text { font-size: 16px; line-height: 28px; }.message-usage { flex-basis: 100%; }.chat-message > .message-content, .user-text { padding: 12px; } }
</style>
