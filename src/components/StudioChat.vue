<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Check, ChevronLeft, ChevronRight, Copy, LoaderCircle, Paperclip, Pencil, Plus, RefreshCw, Send, Square, Trash2, X } from '@lucide/vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { session, errorMessage, notify } from '../state'
import { creation, downloadCreation, initializeCreation, loadCreationGroups, loadCreationModels, publishCreation, selectCreationGroup } from '../native-studio'
import { chats, newChat, loadChats, saveChats, removeChat, cloneChat, sendChat, stopChat, switchBranch, removeMessage, recoverMessage, type NativeMessage } from '../native-chat'
import { answerBranches } from '../../shared/studio/chat-branches'
import { parseFile, getFileAccept, type ParsedFile } from '../../shared/studio/file-upload'
import { REASONING_EFFORT_OPTIONS } from '../../shared/studio/chat-params'
import { CHAT_API_FORMATS } from '../../shared/studio/chat-api-format'
import StudioSkills from './StudioSkills.vue'
const current = computed(() => chats.sessions.find(chat => chat.id === chats.activeId))
const prompt = ref(''), model = ref(''), files = ref<ParsedFile[]>([]), query = ref(''), error = ref(''), uploading = ref(false), edited = ref<NativeMessage>(), messagesElement = ref<HTMLElement>()
const models = computed(() => creation.models.filter(item => !item.kinds?.length || item.kinds.includes('text')))
const busy = computed(() => current.value && chats.busy[current.value.id])
const visible = computed(() => chats.sessions.filter(chat => `${chat.topic} ${chat.messages.map(message => messageText(message)).join(' ')}`.toLowerCase().includes(query.value.toLowerCase())))
const render = (text: string) => DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { FORBID_TAGS: ['iframe', 'style', 'form'], FORBID_ATTR: ['style'] })
function messageText(message: NativeMessage) { return typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') }
function branch(message: NativeMessage) { return current.value ? answerBranches(current.value, message.id) : { index: 0, total: 1, messageIds: [] } }
watch(() => session.user?.id, async () => { if (!session.user) return; await initializeCreation(); await loadCreationGroups(); await loadCreationModels(); await loadChats() }, { immediate: true })
function chooseModel() { model.value = models.value.some(item => item.id === current.value?.model) ? current.value!.model! : models.value[0]?.id || '' }
watch(models, chooseModel)
watch(() => current.value?.id, () => { chooseModel(); files.value = current.value?.draftFiles || []; prompt.value = current.value?.draft || ''; edited.value = undefined })
watch([prompt, files], () => { if (current.value) { current.value.draft = prompt.value; current.value.draftFiles = files.value; void saveChats() } }, { deep: true })
watch(model, () => { if (current.value && model.value) { current.value.model = model.value; void saveChats() } })
watch(() => current.value?.messages.map(message => [message.id, messageText(message), message.streaming]), async () => { await nextTick(); if (messagesElement.value) messagesElement.value.scrollTop = messagesElement.value.scrollHeight }, { deep: true })
async function addFiles(event: Event) {
  const input = event.target as HTMLInputElement, owner = session.user?.id
  uploading.value = true; error.value = ''
  try { for (const file of [...(input.files || [])]) { if (files.value.length >= 10) throw new Error('每轮最多添加 10 个附件。'); const parsed = await parseFile(file); if (owner !== session.user?.id) return; files.value.push(parsed) } }
  catch (cause) { error.value = errorMessage(cause) }
  finally { uploading.value = false; input.value = '' }
}
async function send() {
  if (!current.value || busy.value || uploading.value) return
  const text = prompt.value, attached = [...files.value], original = edited.value
  error.value = ''; prompt.value = ''; files.value = []; edited.value = undefined
  try { await sendChat(current.value, text, attached, model.value, undefined, original) }
  catch (cause) { error.value = errorMessage(cause); prompt.value = text; files.value = attached }
}
async function regenerate(message: NativeMessage) {
  if (!current.value || busy.value) return
  const index = current.value.messages.indexOf(message)
  const user = current.value.messages.slice(0, index + 1).reverse().find(item => item.role === 'user')
  if (user) await sendChat(current.value, messageText(user), [], model.value, user)
}
function edit(message: NativeMessage) { edited.value = message; prompt.value = messageText(message) }
async function copy(message: NativeMessage) { try { await navigator.clipboard.writeText(messageText(message)); notify('已复制。') } catch { error.value = '复制失败，请选择内容后复制。' } }
async function remove() { if (!current.value || !confirm(`删除对话“${current.value.topic}”？`)) return; try { await removeChat(current.value) } catch (cause) { error.value = errorMessage(cause) } }
async function recover(message: NativeMessage) { try { await recoverMessage(message) } catch (cause) { error.value = errorMessage(cause) } }
async function download(message: NativeMessage) { const task = creation.tasks.find(item => item.id === message.taskId); if (task) try { await downloadCreation(task) } catch (cause) { error.value = errorMessage(cause) } }
async function publish(message: NativeMessage) {
  const task = creation.tasks.find(item => item.id === message.taskId)
  if (!task || !confirm('将这条回答作为作品提交社区审核？')) return
  try { await publishCreation(task, current.value?.topic || '对话作品'); notify('作品已提交审核。') } catch (cause) { error.value = errorMessage(cause) }
}
</script>
<template>
  <div class="native-chat" aria-label="对话工作台">
    <aside class="chat-sidebar"><button class="button primary btn" @click="newChat"><Plus :size="16" />新建对话</button><input v-model="query" class="control" type="search" aria-label="搜索对话" placeholder="搜索对话" /><nav aria-label="历史对话"><button v-for="chat in visible" :key="chat.id" class="session-row" :class="{ active: chat.id === chats.activeId }" :aria-current="chat.id === chats.activeId ? 'true' : undefined" @click="chats.activeId = chat.id; saveChats()"><span>{{ chat.topic }}</span><LoaderCircle v-if="chats.busy[chat.id]" :size="14" /></button></nav></aside>
    <section v-if="current" class="chat-main">
      <header class="chat-toolbar"><input v-model="current.topic" class="conversation-title" aria-label="对话名称" maxlength="100" @change="saveChats()" /><div><button class="icon-button" title="清除上下文" aria-label="清除上下文" :disabled="busy" @click="current.clearContextIndex = current.messages.length; current.memoryPrompt = ''; current.lastSummarizeIndex = 0; saveChats()"><RefreshCw :size="17" /></button><button class="icon-button" title="复制对话" aria-label="复制对话" :disabled="busy" @click="cloneChat(current)"><Copy :size="17" /></button><button class="icon-button" title="删除对话" aria-label="删除对话" :disabled="busy" @click="remove"><Trash2 :size="17" /></button></div></header>
      <div class="chat-models"><label class="field"><span>模型分组</span><select class="control" aria-label="模型分组" :value="creation.selectedGroup ?? ''" :disabled="creation.groupsLoading || creation.groupSwitching" @change="selectCreationGroup(($event.target as HTMLSelectElement).value)"><option v-for="group in creation.groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label><label class="field"><span>模型</span><select v-model="model" class="control" :disabled="creation.modelsLoading || creation.groupSwitching"><option v-if="!models.length" value="">暂无可用模型</option><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name || item.id }}</option></select></label></div>
      <p v-if="creation.groupsError || creation.modelsError" class="form-error" role="alert">{{ creation.groupsError || creation.modelsError }}</p>
      <div ref="messagesElement" class="chat-messages" tabindex="0" aria-label="对话消息" aria-live="polite" aria-relevant="additions">
        <p v-if="!current.messages.length" class="chat-empty">开始新的对话</p>
        <article v-for="message in current.messages" :key="message.id" class="chat-message" :class="message.role">
          <div class="message-heading"><strong>{{ message.role === 'user' ? '你' : message.role === 'system' ? '系统' : '助手' }}</strong><LoaderCircle v-if="message.streaming" :size="15" /><span v-if="message.usage" class="message-usage">输入 {{ message.usage.inputTokens ?? '—' }} · 输出 {{ message.usage.outputTokens ?? '—' }}</span></div>
          <details v-if="message.reasoning" class="reasoning"><summary>思考过程</summary><div class="message-content" v-html="render(message.reasoning)" /></details>
          <div v-if="message.role === 'assistant'" class="message-content" v-html="render(messageText(message))" /><p v-else class="user-text">{{ messageText(message) }}</p>
          <div v-if="Array.isArray(message.content)" class="message-attachments"><template v-for="(part, index) in message.content" :key="index"><img v-if="part.type === 'image_url'" :src="part.image_url?.url" alt="图片附件" /><span v-else-if="part.type !== 'text'">{{ part.file?.filename || (part.type === 'video_url' ? '视频附件' : '音频附件') }}</span></template></div>
          <ol v-if="message.sources?.length" class="search-sources"><li v-for="source in message.sources" :key="source.url"><a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a></li></ol>
          <p v-if="message.toolStatus" class="message-tool-status" role="status">{{ message.toolStatus }}</p><p v-if="message.error" class="form-error" role="alert">{{ message.error }}</p><div v-if="message.role === 'assistant' && message.taskId && !message.streaming && !message.interrupted" class="message-actions"><button class="button subtle btn" @click="download(message)">下载文本</button><button class="button subtle btn" @click="publish(message)">发布作品</button></div>
          <div class="message-actions"><button class="icon-button" title="复制消息" :aria-label="`复制${message.role === 'user' ? '提问' : '回答'}`" @click="copy(message)"><Copy :size="15" /></button><button v-if="message.role === 'user'" class="icon-button" title="编辑提问" aria-label="编辑提问" :disabled="busy" @click="edit(message)"><Pencil :size="15" /></button><button v-if="message.role === 'assistant'" class="icon-button" title="重新生成回答" aria-label="重新生成回答" :disabled="busy" @click="regenerate(message)"><RefreshCw :size="15" /></button><button v-if="message.interrupted && message.taskId" class="button subtle btn" :disabled="busy" @click="recover(message)">查询原请求</button><button class="icon-button" title="删除消息" aria-label="删除消息" :disabled="busy" @click="removeMessage(current, message)"><Trash2 :size="15" /></button><template v-if="branch(message).total > 1"><button class="icon-button" title="上一个分支" aria-label="上一个分支" :disabled="busy || branch(message).index <= 0" @click="switchBranch(current, message.id, branch(message).messageIds[branch(message).index - 1]!)"><ChevronLeft :size="15" /></button><span>{{ branch(message).index + 1 }} / {{ branch(message).total }}</span><button class="icon-button" title="下一个分支" aria-label="下一个分支" :disabled="busy || branch(message).index >= branch(message).total - 1" @click="switchBranch(current, message.id, branch(message).messageIds[branch(message).index + 1]!)"><ChevronRight :size="15" /></button></template></div>
        </article>
      </div>
      <form class="chat-composer" @submit.prevent="send">
        <p v-if="edited" class="editing-state">正在编辑提问<button class="icon-button" type="button" title="取消编辑" aria-label="取消编辑" @click="edited = undefined; prompt = ''"><X :size="14" /></button></p>
        <label class="field"><span>{{ edited ? '编辑内容' : '消息' }}</span><textarea v-model="prompt" class="control" rows="3" maxlength="100000" placeholder="输入消息" :disabled="busy" @keydown.enter.exact.prevent="send" /></label>
        <ul v-if="files.length" class="composer-files"><li v-for="(file, index) in files" :key="index"><span>{{ file.name }}</span><button class="icon-button" type="button" :aria-label="`移除附件 ${file.name}`" title="移除附件" @click="files.splice(index, 1)"><X :size="14" /></button></li></ul>
        <div class="composer-actions">
          <label class="button subtle btn attachment-button"><Paperclip :size="16" />{{ uploading ? '读取中…' : '附件' }}<input type="file" multiple :accept="`${getFileAccept()},image/*`" :disabled="busy || uploading" @change="addFiles" /></label>
          <label class="search-mode"><span>联网搜索</span><select v-model="current.search" class="control" aria-label="联网搜索" :disabled="busy" @change="saveChats()"><option value="off">关闭</option><option value="quick">快速</option><option value="deep">深度</option></select></label>
          <button v-if="busy" class="button subtle btn" type="button" @click="stopChat(current)"><Square :size="15" />停止等待</button>
          <button v-else class="button primary btn send-button" :disabled="uploading || !model || creation.groupSwitching || creation.modelsLoading || (!prompt.trim() && !files.length)"><Check v-if="edited" :size="16" /><Send v-else :size="16" />{{ edited ? '提交修改' : '发送' }}</button>
        </div>
        <p v-if="current.search !== 'off'" class="search-cost">搜索与回答分别按章鱼账号配置计费。</p><p v-if="error || chats.error" class="form-error" role="alert">{{ error || chats.error }}</p>
      </form>
      <details class="chat-settings"><summary>对话参数</summary><div class="settings-grid"><label class="field"><span>接口格式</span><select v-model="current.settings.format" class="control" @change="saveChats()"><option v-for="format in CHAT_API_FORMATS" :key="format" :value="format">{{ format }}</option></select></label><label class="field"><span>温度 {{ current.settings.temperature }}</span><input v-model.number="current.settings.temperature" type="range" min="0" max="2" step="0.1" @change="saveChats()" /></label><label class="field"><span>Top P</span><input v-model.number="current.settings.top_p" class="control" type="number" min="0" max="1" step="0.05" @change="saveChats()" /></label><label class="field"><span>最大输出 Tokens</span><input v-model.number="current.settings.max_tokens" class="control" type="number" min="1" max="1000000" @change="saveChats()" /></label><label class="field"><span>话题惩罚</span><input v-model.number="current.settings.presence_penalty" class="control" type="number" min="-2" max="2" step="0.1" @change="saveChats()" /></label><label class="field"><span>重复惩罚</span><input v-model.number="current.settings.frequency_penalty" class="control" type="number" min="-2" max="2" step="0.1" @change="saveChats()" /></label><label class="field"><span>推理强度</span><select v-model="current.settings.reasoningEffort" class="control" @change="saveChats()"><option v-for="option in REASONING_EFFORT_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label class="field"><span>历史压缩阈值</span><input v-model.number="current.compressionThreshold" class="control" type="number" min="500" max="2000000" @change="saveChats()" /></label><label class="field"><span>停止序列（每行一项）</span><textarea v-model="current.settings.stop" class="control" rows="2" @change="saveChats()" /></label><label class="field"><span>系统提示词</span><textarea v-model="current.system" class="control" rows="3" @change="saveChats()" /></label><label class="check-field"><input v-model="current.settings.stream" type="checkbox" @change="saveChats()" />流式输出</label><label class="check-field"><input v-model="current.sendMemory" type="checkbox" @change="saveChats()" />保留历史摘要</label></div></details>
      <StudioSkills :chat="current" />
    </section>
    <p v-else class="muted" role="status">{{ chats.error || '正在读取对话…' }}</p>
  </div>
</template>
<style scoped>
.native-chat { display: grid; grid-template-columns: 220px minmax(0, 1fr); border-block: 1px solid var(--border); min-height: 680px; }
.chat-sidebar { display: flex; flex-direction: column; gap: 16px; padding: 24px 16px 24px 0; border-right: 1px solid var(--border); min-width: 0; }.chat-sidebar nav { display: grid; gap: 4px; max-height: 620px; overflow-y: auto; }.session-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; border: 0; background: transparent; color: var(--muted); padding: 12px; text-align: left; cursor: pointer; min-width: 0; border-radius: 4px; }.session-row span { text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }.session-row:hover, .session-row.active { background: var(--surface); color: var(--ink); }
.chat-main { min-width: 0; padding: 16px 0 24px 24px; }.chat-toolbar, .chat-toolbar > div, .message-heading, .message-actions, .composer-actions { display: flex; align-items: center; gap: 8px; }.chat-toolbar { justify-content: space-between; margin-bottom: 16px; }.conversation-title { border: 0; background: transparent; color: var(--ink); font-size: 16px; font-weight: 600; min-width: 0; width: 100%; padding: 8px 0; }.chat-models { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr); gap: 16px; }.control { width: 100%; min-width: 0; }
.chat-messages { min-height: 300px; max-height: 620px; overflow-y: auto; padding-block: 24px; scroll-margin-top: 100px; }.chat-empty { min-height: 260px; display: grid; place-items: center; color: var(--muted); font-size: 16px; }.chat-message { border-bottom: 1px solid var(--border); padding-block: 20px; }.chat-message:first-child { padding-top: 0; }.message-heading { font-size: 12px; color: var(--muted); margin-bottom: 12px; }.message-heading strong { font-size: 14px; color: var(--ink); font-weight: 600; }.message-usage { margin-left: auto; font-variant-numeric: tabular-nums; }.message-content, .user-text { overflow-wrap: anywhere; font-size: 16px; line-height: 28px; max-width: 75ch; }.user-text { white-space: pre-wrap; margin: 0; }.message-content :deep(p) { margin-block: 0 12px; }.message-content :deep(pre) { overflow-x: auto; max-width: 100%; padding: 16px; background: var(--surface); border-radius: 6px; font-size: 14px; line-height: 22px; }.message-content :deep(img) { max-width: 100%; }.message-content :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; }.message-content :deep(td), .message-content :deep(th) { border: 1px solid var(--border); padding: 8px; }.message-content :deep(a), .search-sources a { color: var(--blue); text-decoration: underline; text-underline-offset: 3px; }.message-content :deep(blockquote) { margin-inline: 0; border-left: 1px solid var(--border); padding-left: 16px; color: var(--muted); }
.reasoning { margin-bottom: 12px; color: var(--muted); font-size: 12px; }.reasoning summary { cursor: pointer; margin-bottom: 8px; }.message-actions { flex-wrap: wrap; margin-top: 12px; font-size: 12px; }.message-attachments { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; margin-top: 12px; }.message-attachments img { width: 80px; height: 80px; object-fit: cover; border-radius: 4px; }.search-sources { font-size: 12px; line-height: 24px; padding-left: 24px; overflow-wrap: anywhere; }
.chat-composer { margin-top: 16px; }.composer-actions { flex-wrap: wrap; margin-top: 12px; }.attachment-button { position: relative; overflow: hidden; }.attachment-button input { position: absolute; inset: 0; opacity: 0; width: 100%; cursor: pointer; }.attachment-button:focus-within { outline: 2px solid var(--blue); outline-offset: 2px; }.search-mode { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }.search-mode select { width: 80px; }.send-button { margin-left: auto; }.composer-files { padding: 0; list-style: none; display: flex; gap: 8px; flex-wrap: wrap; }.composer-files li { display: flex; gap: 8px; align-items: center; font-size: 12px; max-width: 100%; }.composer-files li span { overflow-wrap: anywhere; }.search-cost { font-size: 12px; color: var(--muted); }.chat-settings { margin-top: 24px; border-top: 1px solid var(--border); padding-top: 16px; }.chat-settings > summary { cursor: pointer; font-size: 14px; }.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding-top: 16px; }.check-field { display: flex; align-items: center; gap: 8px; font-size: 14px; }.editing-state { display: flex; align-items: center; gap: 8px; color: var(--amber); font-size: 12px; }
@media (max-width: 899px) { .native-chat { grid-template-columns: 170px minmax(0, 1fr); }.chat-main { padding-left: 16px; } }
@media (max-width: 639px) { .native-chat { grid-template-columns: minmax(0, 1fr); }.chat-sidebar { padding: 16px 0; border-right: 0; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: auto minmax(0, 1fr); }.chat-sidebar nav { grid-column: 1 / -1; display: flex; overflow-x: auto; }.session-row { flex: 0 0 auto; max-width: 180px; }.chat-main { padding: 16px 0 24px; }.chat-models { grid-template-columns: minmax(90px, 1fr) minmax(0, 1.5fr); gap: 12px; }.settings-grid { grid-template-columns: minmax(0, 1fr); }.message-usage { max-width: 60%; font-size: 12px; }.chat-messages { max-height: 60dvh; }.composer-actions { gap: 12px; }.search-mode span { display: inline; } }
</style>
