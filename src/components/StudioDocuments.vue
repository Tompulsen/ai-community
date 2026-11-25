<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Download, FileSpreadsheet, FileText, History, LoaderCircle, Plus, RefreshCw, Trash2, Upload, X } from '@lucide/vue'
import { saveChats as persistChats, sendChat, type NativeChat } from '../native-chat'
import { session, errorMessage } from '../state'
import { creation } from '../native-studio'
import { confirmStudioDelete } from '../studio-confirm'
import { documentApi, documentScope, documentPending, documentPhases, downloadDocument, sourceFromAsset, sourceFromJob, submitDocumentPlan, uploadDocument, waitDocumentJob, type CellValue, type DocumentCapabilities, type DocumentStructure } from '../studio-documents'
import { documentPlan, type DocumentAsset, type DocumentJob } from '../../shared/studio/document-workspace'
import type { ChatDocumentTask, DocumentSource } from '../../shared/studio/document-chat'
import StudioDocumentPreview from './StudioDocumentPreview.vue'
import { initializeBranches } from '../../shared/studio/chat-branches'

const props = defineProps<{ chat: NativeChat; model: string; initialSource?: DocumentSource; disabled?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>(), upload = ref<HTMLInputElement>()
const available = ref<DocumentCapabilities>(), assets = ref<DocumentAsset[]>([]), jobs = ref<DocumentJob[]>([])
const source = ref<DocumentSource>(), format = ref<'docx' | 'xlsx'>('docx'), instruction = ref(''), issue = ref(''), loading = ref(false), busy = ref(false)
const structure = ref<DocumentStructure>(), versions = ref<DocumentAsset[]>([]), changes = ref<Record<string, unknown>[]>([]), showHistory = ref(false)
const target = ref(''), editText = ref(''), valueType = ref<CellValue['type']>('text'), manualTask = ref<ChatDocumentTask>()
const scope = documentScope(), sessionId = props.chat.id, lifetime = new AbortController()
const current = () => !lifetime.signal.aborted && props.chat.id === sessionId
const assertCurrent = () => { scope.assert(); if (!current()) throw new Error('文档工作区已关闭。') }
const blocked = computed(() => Boolean(busy.value || loading.value || props.disabled || creation.modelsLoading || creation.groupSwitching || creation.modelLaunchPending))
const targets = computed(() => structure.value?.format === 'docx'
  ? (structure.value.paragraphs || []).filter(item => item.editable && item.text).map(item => ({ key: item.id, label: item.text.slice(0, 80), value: { type: 'text', value: item.text } as CellValue, paragraphId: item.id, sheetId: '', address: '' }))
  : (structure.value?.sheets || []).flatMap(sheet => sheet.cells.map(cell => ({ key: `${sheet.id}:${cell.address}`, label: `${sheet.name} · ${cell.address}`, value: cell.value, paragraphId: '', sheetId: sheet.id, address: cell.address }))))
function chooseTarget() { const item = targets.value.find(item => item.key === target.value); editText.value = String(item?.value.value ?? ''); valueType.value = item?.value.type || 'text' }
function newFile() { source.value = undefined; structure.value = undefined; versions.value = []; changes.value = []; target.value = ''; showHistory.value = false; manualTask.value = undefined; issue.value = '' }
async function refresh() {
  const results = await Promise.all([
    documentApi<DocumentCapabilities>(scope, 'capabilities', { signal: lifetime.signal }),
    documentApi<{ assets: DocumentAsset[] }>(scope, 'assets', { signal: lifetime.signal }),
    documentApi<{ jobs: DocumentJob[] }>(scope, `jobs?sessionId=${encodeURIComponent(sessionId)}`, { signal: lifetime.signal }),
  ])
  assertCurrent(); available.value = results[0]; assets.value = results[1].assets; jobs.value = results[2].jobs
}
async function perform(action: () => Promise<void>) {
  if (busy.value || !current()) return
  busy.value = true; issue.value = ''
  try { await action() } catch (cause) { if (current()) issue.value = errorMessage(cause) }
  finally { if (current()) busy.value = false }
}
async function inspect(value: DocumentSource) {
  const results = await Promise.all([
    documentApi<DocumentStructure>(scope, `assets/${value.assetId}/${value.version}/structure`, { signal: lifetime.signal }),
    documentApi<{ versions: DocumentAsset[] }>(scope, `assets/${value.assetId}/versions`, { signal: lifetime.signal }),
    documentApi<Record<string, unknown>[]>(scope, `assets/${value.assetId}/${value.version}/changes`, { signal: lifetime.signal }),
  ])
  assertCurrent(); source.value = value; format.value = value.format; structure.value = results[0]; versions.value = results[1].versions; changes.value = results[2]; target.value = ''; manualTask.value = undefined
}
function selectFile(event: Event) {
  const asset = assets.value.find(item => item.id === (event.target as HTMLSelectElement).value)
  if (!asset) newFile(); else void perform(() => inspect(sourceFromAsset(asset)))
}
async function uploadFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file) return
  await perform(async () => {
    if (!/\.(docx|xlsx)$/i.test(file.name) || file.size > 20 * 1024 ** 2 || !file.size) throw new Error('请选择 20 MiB 以内的 DOCX / XLSX 文件。')
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('无法读取文件。')); reader.readAsDataURL(file)
    })
    assertCurrent()
    const key = crypto.randomUUID()
    let job: DocumentJob
    try { job = await uploadDocument({ name: file.name, type: file.type, size: file.size, content, isText: false }, sessionId, key, lifetime.signal) }
    catch (cause) {
      // A response lost after admission must be queried, never uploaded again automatically.
      job = await documentApi<DocumentJob>(scope, `jobs/${key}`, { signal: lifetime.signal }).catch(() => { throw cause })
    }
    job = await waitDocumentJob(scope, job, lifetime.signal, job => { assertCurrent(); jobs.value = [job, ...jobs.value.filter(item => item.id !== job.id)] })
    const value = sourceFromJob(job, /\.xlsx$/i.test(file.name) ? 'xlsx' : 'docx')
    if (!value) throw new Error(job.error || '上传未完成，请刷新任务查看。')
    await refresh(); await inspect(value)
  })
}
function requireLatest() { if (source.value && versions.value[0]?.version !== source.value.version) throw new Error('请在历史版本中选择最新版本后继续修改。') }
async function generate() {
  if (blocked.value || !instruction.value.trim() || !props.model) return
  await perform(async () => {
    requireLatest()
    props.chat.documentEnabled = true; await persistChats(true); assertCurrent()
    await sendChat(props.chat, instruction.value, [], props.model, undefined, undefined, { document: { format: format.value, source: source.value } })
    assertCurrent(); await refresh()
    const task = props.chat.messages.at(-1)?.documentTask, value = task?.job && sourceFromJob(task.job, task.request.format)
    if (value) { instruction.value = ''; await inspect(value) }
    else if (task?.clarification) issue.value = task.clarification
    else if (task?.error) issue.value = task.error
  })
}
async function saveManual() {
  if (!source.value || blocked.value) return
  await perform(async () => {
    requireLatest()
    const selected = targets.value.find(item => item.key === target.value), file = source.value!
    if (!selected) throw new Error('请选择要修改的段落或单元格。')
    let value: CellValue = { type: valueType.value, value: editText.value }
    if (value.type === 'blank') value = { type: 'blank' }
    else if (value.type === 'number') { if (!editText.value.trim() || !Number.isFinite(Number(editText.value))) throw new Error('请输入有效数字。'); value.value = Number(editText.value) }
    else if (value.type === 'boolean') { if (!['true', 'false'].includes(editText.value)) throw new Error('布尔值只能填写 true 或 false。'); value.value = editText.value === 'true' }
    const plan = documentPlan.parse({ schemaVersion: 1, kind: 'edit', sourceArtifactId: file.assetId, baseVersion: file.version, operations: file.format === 'docx'
      ? [{ op: 'replace_text', paragraphId: selected.paragraphId, start: 0, expectedText: selected.value.value, text: editText.value }]
      : [{ op: 'set_cell', sheetId: selected.sheetId, address: selected.address, expectedOldValue: selected.value, value }] })
    const task: ChatDocumentTask = { key: crypto.randomUUID(), plan, request: { sessionId, instruction: '手工修改指定位置', model: props.model || 'manual', provider: 'community', format: file.format, sourceArtifactId: file.assetId, baseVersion: file.version } }
    props.chat.messages.push({ id: crypto.randomUUID(), role: 'user', content: `手工修改 ${file.fileName}`, createdAt: Date.now() },
      { id: crypto.randomUUID(), role: 'assistant', content: '已保存修改内容，正在制作新版本。', createdAt: Date.now(), documentTask: task })
    initializeBranches(props.chat)
    const savedTask = props.chat.messages.at(-1)!.documentTask!
    manualTask.value = savedTask
    await persistChats(true); assertCurrent()
    await finishManual(savedTask)
  })
}
async function finishManual(task: ChatDocumentTask) {
  const job = await waitDocumentJob(scope, await submitDocumentPlan(task, lifetime.signal), lifetime.signal, async job => { assertCurrent(); task.job = job; jobs.value = [job, ...jobs.value.filter(item => item.id !== job.id)]; await persistChats(true) })
  const value = sourceFromJob(job, task.request.format)
  if (!value) throw new Error(job.error || '未完成文件制作，可重试。')
  await refresh(); await inspect(value)
}
async function removeFile() {
  if (!source.value || blocked.value) return
  const file = source.value
  await perform(async () => {
    if (!await confirmStudioDelete(`删除“${file.fileName}”及全部在线版本？删除后无法恢复，请先下载需要保留的文件。`, current)) return
    assertCurrent(); await documentApi(scope, `assets/${file.assetId}`, { method: 'DELETE', signal: lifetime.signal })
    assertCurrent(); newFile(); await refresh()
  })
}
async function jobAction(job: DocumentJob, action: 'retry' | 'cancel') {
  await perform(async () => {
    await documentApi(scope, `jobs/${job.id}${action === 'retry' ? '/retry' : ''}`, { method: action === 'retry' ? 'POST' : 'DELETE', signal: lifetime.signal }); await refresh()
  })
}
function close() { dialog.value?.close(); emit('close') }
watch(() => session.user?.id, close)
onMounted(async () => {
  await nextTick(); dialog.value?.showModal(); loading.value = true
  try { await refresh(); if (props.initialSource) await inspect(props.initialSource) } catch (cause) { if (current()) issue.value = errorMessage(cause) } finally { loading.value = false }
})
onBeforeUnmount(() => { lifetime.abort(); dialog.value?.close() })
</script>
<template>
  <Teleport to="body"><dialog ref="dialog" class="document-workspace" aria-labelledby="document-workspace-title" @cancel.prevent="close" @close="emit('close')">
    <header class="document-workspace-header"><span class="document-workspace-icon"><FileText :size="23" aria-hidden="true" /></span><div><h2 id="document-workspace-title">文档工作区</h2><p>把想法变成 Word 与 Excel，随时预览和继续修改。</p></div><button type="button" class="icon-button" aria-label="关闭文档工作区" title="关闭文档工作区" @click="close"><X :size="20" /></button></header>
    <div class="document-workspace-body">
      <p v-if="issue" class="form-error document-full" role="alert">{{ issue }}</p>
      <p v-if="loading" class="muted document-full" role="status">正在读取文档…</p>
      <p v-else-if="available && !available.enabled" class="muted document-full" role="status">{{ available.reason || '文档服务暂时不可用。' }}</p>
      <section class="document-create"><div class="document-section-heading"><h3>{{ source ? '修改已有文件' : '创建新文件' }}</h3><span class="document-badge">仅当前聊天</span></div>
        <div class="document-actions"><button type="button" :disabled="blocked" @click="newFile"><Plus :size="16" aria-hidden="true" />新建文件</button><button type="button" :disabled="blocked || !available?.enabled" @click="upload?.click()"><Upload :size="16" aria-hidden="true" />上传已有文件</button><input ref="upload" type="file" accept=".docx,.xlsx" aria-label="上传 Word 或 Excel" hidden @change="uploadFile" /></div>
        <p class="document-note">DOCX / XLSX · 最大 20 MiB · 修改保留原件和历史版本</p>
        <label class="field"><span>选择文件</span><select :value="source?.assetId || ''" :disabled="blocked" @change="selectFile"><option value="">新建文件</option><option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.fileName }} · v{{ asset.version }}</option></select></label>
        <div class="document-format" role="group" aria-label="输出格式"><button type="button" :aria-pressed="format === 'docx'" :disabled="blocked || !!source || !available?.docx" @click="format = 'docx'"><FileText :size="20" aria-hidden="true" /><span>Word<small>DOCX 文档</small></span></button><button type="button" :aria-pressed="format === 'xlsx'" :disabled="blocked || !!source || !available?.xlsx" @click="format = 'xlsx'"><FileSpreadsheet :size="20" aria-hidden="true" /><span>Excel<small>XLSX 表格</small></span></button></div>
        <label class="field"><span>文件要求</span><textarea v-model="instruction" rows="4" maxlength="12000" :disabled="blocked" placeholder="例如：制作一份包含明细、汇总和公式的销售表；或将选中文档的付款期限改为 45 天。" /></label>
        <p class="document-note">当前模型：{{ model || '请先选择文本模型' }}。AI 生成按现有积分规则计费；上传、手工修改和下载不调用模型。</p>
        <button type="button" class="document-primary" :disabled="blocked || !instruction.trim() || !model || !available?.[format]" @click="generate"><LoaderCircle v-if="busy" :size="17" aria-hidden="true" />{{ busy ? '正在处理…' : source ? '生成修改版' : '创建文件' }}</button>
        <p class="document-note">开启后也可在聊天中说“做一份销售表”。普通提问仍按聊天回答。</p>
      </section>
      <aside class="document-library"><div class="document-section-heading"><h3>我的文件 <span class="muted">{{ assets.length }}</span></h3><button type="button" class="icon-button" title="刷新文档列表" aria-label="刷新文档列表" :disabled="blocked" @click="perform(refresh)"><RefreshCw :size="17" /></button></div>
        <p v-if="!assets.length" class="document-empty">还没有文件，从新建或上传开始。</p>
        <div class="document-file-list"><article v-for="asset in assets" :key="asset.id" :class="{ selected: source?.assetId === asset.id }"><div class="document-file-heading"><component :is="asset.format === 'xlsx' ? FileSpreadsheet : FileText" :size="22" aria-hidden="true" /><div><strong>{{ asset.fileName }}</strong><p>{{ asset.format.toUpperCase() }} · v{{ asset.version }} · {{ (asset.size / 1024).toFixed(1) }} KB</p></div></div><div class="document-actions"><button type="button" :disabled="blocked" @click="perform(() => inspect(sourceFromAsset(asset)))">预览 / 修改</button><button type="button" :disabled="blocked" @click="perform(() => downloadDocument(sourceFromAsset(asset)))"><Download :size="15" aria-hidden="true" />下载</button></div></article></div>
        <details class="document-jobs"><summary>此聊天的文档任务 <span class="muted">{{ jobs.length }}</span></summary><p v-if="!jobs.length" class="document-note">还没有文件处理任务。</p><article v-for="job in jobs" :key="job.id"><strong>{{ job.fileName || '文档任务' }}</strong><p>{{ documentPhases[job.status] }}</p><p v-if="job.error" class="form-error">{{ job.error }}</p><div class="document-actions"><button v-if="documentPending(job)" type="button" :disabled="blocked" @click="jobAction(job, 'cancel')">取消处理</button><button v-else-if="job.canRecover && job.status !== 'ready'" type="button" :disabled="blocked" @click="jobAction(job, 'retry')">重试制作文件</button><button v-if="sourceFromJob(job, job.fileName?.endsWith('.xlsx') ? 'xlsx' : 'docx')" type="button" :disabled="blocked" @click="perform(() => inspect(sourceFromJob(job, job.fileName?.endsWith('.xlsx') ? 'xlsx' : 'docx')!))">查看文件</button></div></article></details>
      </aside>
      <section v-if="source && structure" class="document-full document-inspector"><div class="document-section-heading"><div><h3>{{ source.fileName }} <span class="muted">v{{ source.version }}</span></h3><p class="document-note">内容预览展示文字和计算结果，完整排版请下载查看。</p></div><div class="document-actions"><button type="button" :disabled="blocked" @click="perform(() => downloadDocument(source!))"><Download :size="16" aria-hidden="true" />下载文件</button><button type="button" :aria-expanded="showHistory" @click="showHistory = !showHistory"><History :size="16" aria-hidden="true" />历史版本</button><button type="button" :disabled="blocked" @click="removeFile"><Trash2 :size="16" aria-hidden="true" />删除文件</button></div></div>
        <div v-if="showHistory" class="document-versions"><button v-for="version in versions" :key="version.version" type="button" :disabled="blocked" :aria-pressed="source.version === version.version" @click="perform(() => inspect(sourceFromAsset(version)))">v{{ version.version }}{{ version.version === versions[0]?.version ? ' · 最新' : '' }}</button></div>
        <StudioDocumentPreview :structure="structure" />
        <details class="document-manual"><summary>手工修改段落或单元格</summary><p class="document-note">只修改选定位置，保存为新版本，不调用模型。</p><label class="field"><span>选择位置</span><select v-model="target" :disabled="blocked" @change="chooseTarget"><option value="">请选择</option><option v-for="item in targets" :key="item.key" :value="item.key">{{ item.label }}</option></select></label><label v-if="source.format === 'xlsx'" class="field"><span>内容类型</span><select v-model="valueType" :disabled="blocked"><option value="text">文本</option><option value="number">数字</option><option value="date">日期 YYYY-MM-DD</option><option value="datetime">日期时间 YYYY-MM-DDTHH:mm:ss.0000000</option><option value="boolean">布尔 true / false</option><option value="formula">公式</option><option value="blank">清空</option></select></label><label class="field"><span>修改后的内容</span><textarea v-model="editText" rows="3" maxlength="16000" :disabled="blocked || valueType === 'blank'" /></label><div class="document-actions"><button type="button" :disabled="blocked || !target" @click="saveManual">保存为新版本</button><button v-if="manualTask" type="button" :disabled="blocked" @click="perform(() => finishManual(manualTask!))">重试已保存的修改</button></div></details>
        <details v-if="changes.length" class="document-changes"><summary>本版本实际改动 · {{ changes.length }}</summary><article v-for="(change, index) in changes" :key="index"><strong>{{ change.target || change.paragraphId || change.address || `改动 ${index + 1}` }}</strong><p>修改前：{{ typeof change.before === 'object' ? JSON.stringify(change.before) : change.before }}</p><p>修改后：{{ typeof change.after === 'object' ? JSON.stringify(change.after) : change.after }}</p></article></details>
      </section>
    </div>
  </dialog></Teleport>
</template>
<style scoped>
.document-workspace { width: min(1080px, calc(100vw - 48px)); max-width: none; max-height: calc(100dvh - 48px); margin: auto; padding: 0; border: 1px solid var(--border); border-radius: 22px; background: var(--canvas); color: var(--ink); overflow: auto; box-shadow: 0 24px 100px #0005; }.document-workspace::backdrop { background: #0007; backdrop-filter: blur(5px); }.document-workspace-header { display: flex; align-items: center; gap: 12px; padding: 20px 24px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--canvas); z-index: 2; }.document-workspace-header>div { flex: 1; min-width: 0; }.document-workspace-header h2 { margin: 0; font-size: 20px; letter-spacing: -.03em; }.document-workspace-header p { margin: 3px 0 0; font-size: 13px; color: var(--muted); }.document-workspace-icon { display: grid; place-items: center; width: 44px; height: 48px; border-radius: 12px; background: var(--blue-soft); color: var(--blue); flex-shrink: 0; }.document-workspace-body { display: grid; grid-template-columns: minmax(0,1.2fr) minmax(260px,1fr); gap: 24px; padding: 24px; }.document-full { grid-column: 1/-1; }.document-create,.document-library,.document-inspector { min-width: 0; }.document-library { border-left: 1px solid var(--border); padding-left: 24px; }.document-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }.document-section-heading h3 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }.document-badge { font-size: 11px; border: 1px solid var(--border); border-radius: 20px; padding: 4px 9px; color: var(--muted); }.document-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }.document-workspace button:not(.icon-button) { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 9px 13px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; font-size: 13px; }.document-workspace .icon-button { min-width: 44px; min-height: 44px; }.document-note { color: var(--muted); font-size: 12px; line-height: 1.6; margin: 10px 0 16px; }.document-workspace .field { display: grid; gap: 8px; margin: 14px 0; }.field>span { font-size: 13px; font-weight: 600; }.document-workspace select,.document-workspace textarea { width: 100%; max-width: 100%; background: var(--surface); border: 1px solid var(--control-border); border-radius: 10px; padding: 11px 12px; }.document-workspace textarea { resize: vertical; min-height: 100px; }.document-format { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 18px 0; }.document-format button { justify-content: flex-start !important; text-align: left; }.document-format small { display: block; color: var(--muted); font-size: 11px; }.document-format button[aria-pressed=true],.document-versions button[aria-pressed=true] { border-color: var(--blue); background: var(--blue-soft); color: var(--blue); }.document-workspace button.document-primary { width: 100%; background: var(--blue); color: var(--action-ink); border-color: var(--blue); font-weight: 600; }.document-file-list { max-height: 400px; overflow: auto; padding: 2px; }.document-workspace article { padding: 14px; margin-bottom: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }.document-workspace article.selected { border-color: var(--blue); }.document-file-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }.document-file-heading>div { min-width: 0; }.document-file-heading>svg { flex-shrink: 0; color: var(--blue); }.document-workspace article strong { display: block; font-size: 13px; overflow-wrap: anywhere; }.document-workspace article p { margin: 4px 0; font-size: 12px; overflow-wrap: anywhere; white-space: pre-wrap; }.document-empty { padding: 30px 14px; border: 1px dashed var(--border); border-radius: 12px; text-align: center; color: var(--muted); font-size: 13px; }.document-workspace summary { padding: 14px 0; font-weight: 600; cursor: pointer; }.document-inspector { border-top: 1px solid var(--border); padding-top: 22px; }.document-versions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }.document-manual { margin-top: 16px; }.document-changes { margin-top: 12px; }.document-jobs { margin-top: 18px; }
@media(max-width:700px) { .document-workspace { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); border-radius: 18px; }.document-workspace-header { padding: 14px; gap: 10px; }.document-workspace-header h2 { font-size: 18px; }.document-workspace-header p { font-size: 11px; }.document-workspace-icon { display: none; }.document-workspace-body { display: flex; flex-direction: column; gap: 20px; padding: 16px; padding-bottom: max(16px, env(safe-area-inset-bottom)); }.document-library { border-left: 0; border-top: 1px solid var(--border); padding: 20px 0 0; }.document-file-list { max-height: 280px; }.document-workspace input,.document-workspace select,.document-workspace textarea { font-size: 16px; }.document-section-heading { gap: 10px; } }
</style>
