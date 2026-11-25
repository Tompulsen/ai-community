<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Download, FileText, FolderOpen, RefreshCw } from '@lucide/vue'
import { saveChats as persistChats, type NativeChat, type NativeMessage } from '../native-chat'
import { documentApi, documentScope, documentPending, documentPhases, documentContentIssue, downloadDocument, recoverDocumentContent, sourceFromJob, waitDocumentJob } from '../studio-documents'
import { errorMessage, session } from '../state'
import { creation } from '../native-studio'
import StudioInsufficientCredits from './StudioInsufficientCredits.vue'
import { isInsufficientCredits } from '../../shared/studio/insufficient-credits'
import type { DocumentJob } from '../../shared/studio/document-workspace'
import type { ChatDocumentTask, DocumentSource } from '../../shared/studio/document-chat'
const props = defineProps<{ chat: NativeChat; message: NativeMessage; disabled?: boolean }>()
const emit = defineEmits<{ open: [source?: DocumentSource]; retry: [task: ChatDocumentTask] }>()
const task = computed(() => props.message.documentTask!)
const source = computed(() => task.value.job && sourceFromJob(task.value.job, task.value.request.format))
const contentIssue = computed(() => documentContentIssue(task.value))
const modelTask = computed(() => creation.tasks.find(item => item.id === task.value.modelTaskId && item.owner === session.user?.id))
const savedContentRecovered = computed(() => !!task.value.modelContentError && modelTask.value?.phase === 'complete' && !contentIssue.value && !task.value.plan && !task.value.job && !task.value.clarification)
const working = ref(false), issue = ref('')
const issueCode = ref<string>()
const insufficient = computed(() => !task.value.plan && !!(issue.value || contentIssue.value || task.value.error) && isInsufficientCredits(issue.value
  ? { error: issue.value, errorCode: issueCode.value }
  : { error: contentIssue.value || task.value.error, errorCode: modelTask.value?.errorCode || props.message.errorCode }))
const lifetime = new AbortController()
onBeforeUnmount(() => lifetime.abort())
async function perform(action: 'download' | 'recover' | 'refresh') {
  if (working.value) return
  const scope = documentScope(), original = task.value
  working.value = true; issue.value = ''; issueCode.value = undefined
  const save = async () => { scope.assert(); lifetime.signal.throwIfAborted(); if (original !== task.value || props.chat.id !== original.request.sessionId) throw new Error('任务已切换。'); await persistChats(true) }
  try {
    if (action !== 'download' && props.chat.id !== original.request.sessionId) throw new Error('这是原聊天的文档任务，请回到原聊天恢复；也可在文档工作区新建文件。')
    if (action === 'download' && source.value) await downloadDocument(source.value)
    else {
      if (action === 'recover') await recoverDocumentContent(original, save, lifetime.signal)
      else original.job = await documentApi<DocumentJob>(scope, `jobs/${original.key}`, { signal: lifetime.signal })
      if (original.job) await waitDocumentJob(scope, original.job, lifetime.signal, async job => {
        original.job = job; original.error = job.error || undefined; props.message.interrupted = false; props.message.error = undefined
        props.message.content = job.status === 'ready' ? `已生成 ${job.fileName || '文档'}。` : documentPhases[job.status] || '文档处理中'
        await save()
      })
      else if (original.clarification) { props.message.content = original.clarification; await save() }
    }
  } catch (cause) { if (!lifetime.signal.aborted) { issue.value = errorMessage(cause); issueCode.value = (cause as { errorCode?: string })?.errorCode } }
  finally { working.value = false }
}
</script>
<template>
  <section class="document-result" aria-label="文档任务">
    <div class="document-result-heading"><span class="document-file-icon"><FileText :size="23" aria-hidden="true" /></span><div><strong>{{ source?.fileName || task.job?.fileName || (task.request.format === 'xlsx' ? 'Excel 表格' : 'Word 文档') }}</strong><p>{{ task.preparing ? '正在生成内容…' : task.job ? documentPhases[task.job.status] : task.clarification ? '请补充文件要求' : task.plan ? '内容已保存，可继续制作文件' : '文档任务' }}<template v-if="source"> · v{{ source.version }}</template></p></div></div>
    <StudioInsufficientCredits v-if="insufficient" />
    <p v-else-if="issue || contentIssue || task.error && !savedContentRecovered" class="form-error" role="alert">{{ issue || contentIssue || task.error }}</p>
    <p v-else-if="savedContentRecovered">已修复原内容的格式兼容问题，可继续制作文件。</p>
    <div class="document-result-actions">
      <button v-if="source" type="button" :disabled="working" @click="perform('download')"><Download :size="16" aria-hidden="true" />下载 {{ task.request.format.toUpperCase() }}</button>
      <button v-if="source" type="button" :disabled="disabled" @click="emit('open', source)"><FolderOpen :size="16" aria-hidden="true" />预览 / 继续修改</button>
      <button v-else-if="documentPending(task.job) && !message.streaming" type="button" :disabled="working" @click="perform('refresh')"><RefreshCw :size="16" aria-hidden="true" />刷新任务</button>
      <button v-else-if="contentIssue && !message.streaming && !task.preparing" type="button" :disabled="working || disabled" @click="emit('retry', task)"><RefreshCw :size="16" aria-hidden="true" />调整要求后重新生成</button>
      <button v-else-if="!task.preparing && !task.clarification && !message.streaming && (task.plan || task.modelTaskId)" type="button" :disabled="working" @click="perform('recover')"><RefreshCw :size="16" aria-hidden="true" />{{ working ? '正在恢复…' : savedContentRecovered ? '继续制作文件' : task.plan ? '重试制作文件' : '恢复原模型请求' }}</button>
      <button v-for="candidate in task.candidates || []" :key="candidate.assetId" type="button" :disabled="disabled" @click="emit('open', candidate)">{{ candidate.fileName }}</button>
    </div>
    <small v-if="contentIssue">原请求已结束，无法继续恢复。确认创建后会发起新请求，按当前模型计费。</small>
    <small v-else-if="!source && (task.plan || task.modelTaskId)">恢复沿用原请求与已保存内容，不会重新调用模型。</small>
  </section>
</template>
<style scoped>
.document-result { margin: 12px 0; padding: 16px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface-soft); max-width: 600px; min-width: 0; }.document-result-heading { display: flex; gap: 12px; align-items: center; }.document-result-heading>div { min-width: 0; }.document-result strong { overflow-wrap: anywhere; }.document-file-icon { width: 44px; height: 48px; display: grid; place-items: center; flex-shrink: 0; border-radius: 10px; color: var(--blue); background: var(--surface); border: 1px solid var(--border); }.document-result p { margin: 5px 0; font-size: 13px; }.document-result-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }.document-result button { display: inline-flex; gap: 6px; align-items: center; min-height: 44px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); font-size: 13px; }.document-result small { display: block; margin-top: 10px; color: var(--muted); }
</style>
