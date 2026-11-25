import { watch } from 'vue'
import { api, session } from './state'
import { creation, resumeCreation, submitCreation, type CreationTask } from './native-studio'
import { documentPlanningPrompt, parseDocumentClarification, parseDocumentPlan, type DocumentAsset, type DocumentJob } from '../shared/studio/document-workspace'
import { documentChatInstruction, type ChatDocumentTask, type ChatDocumentAttachment, type DocumentSource } from '../shared/studio/document-chat'
import type { ParsedFile } from '../shared/studio/file-upload'
import type { NativeChat, NativeMessage } from './native-chat'
import type { RequestMessage } from '../shared/studio/types'

let accountEpoch = 0
watch(() => session.user?.id, () => { accountEpoch++ }, { flush: 'sync' })
export function documentScope() {
  const userId = session.user?.id, accountId = session.user?.accountId || userId, epoch = accountEpoch
  const assert = () => { if (!userId || epoch !== accountEpoch || session.user?.id !== userId) throw new Error('账号已变化，请重新打开文档工作区。') }
  assert()
  return { accountId, assert }
}
export async function documentApi<T>(scope: ReturnType<typeof documentScope>, resource: string, options: Parameters<typeof api>[1] = {}) {
  scope.assert()
  const result = await api<T>(`/api/documents/${resource}`, { ...options, expectedAccount: scope.accountId })
  scope.assert()
  return result
}
export type DocumentCapabilities = { enabled: boolean; docx: boolean; xlsx: boolean; reason?: string }
export type CellValue = { type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'blank' | 'formula'; value?: string | number | boolean }
export type DocumentStructure = { format: 'docx' | 'xlsx'; paragraphs?: { id: string; text: string; editable: boolean; inTable?: boolean; style?: string }[]; sheets?: { id: string; name: string; hidden?: boolean; cells: { address: string; value: CellValue; display?: string; cachedValue?: CellValue }[] }[] }
export const documentPhases: Record<string, string> = { planning: '正在准备文档内容', needs_input: '需要补充信息', queued: '等待文档处理', editing: '正在制作文件', calculating: '正在计算公式', verifying: '正在检查文件', ready: '文件已就绪', failed: '文件制作失败', cancelled: '已取消处理' }
export const documentPending = (job?: DocumentJob) => !!job && !['ready', 'failed', 'cancelled', 'needs_input'].includes(job.status)
export function sourceFromJob(job: DocumentJob, format: 'docx' | 'xlsx'): DocumentSource | undefined {
  return job.status === 'ready' && job.assetId && job.version ? { assetId: job.assetId, version: job.version, fileName: job.fileName || `文档.${format}`, format, sessionId: job.sessionId } : undefined
}
export const sourceFromAsset = (asset: DocumentAsset): DocumentSource => ({ assetId: asset.id, version: asset.version, fileName: asset.fileName, format: asset.format })
export async function downloadDocument(source: DocumentSource) {
  const scope = documentScope()
  const response = await fetch(`/api/documents/assets/${source.assetId}/${source.version}/download`, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-New-Api-User': scope.accountId! }, signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error('下载失败，请确认文件仍存在后重试。')
  const blob = await response.blob(); scope.assert()
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = source.fileName; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
export async function waitDocumentJob(scope: ReturnType<typeof documentScope>, initial: DocumentJob, signal: AbortSignal, update: (job: DocumentJob) => void | Promise<void>) {
  let job = initial
  const deadline = Date.now() + 180000
  await update(job)
  while (documentPending(job)) {
    signal.throwIfAborted(); scope.assert()
    if (Date.now() > deadline) throw new Error('文件仍在处理中，可稍后刷新任务查看，不必重新生成。')
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new DOMException('已停止等待', 'AbortError')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, 1200)
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    })
    job = await documentApi<DocumentJob>(scope, `jobs/${job.id}`, { signal })
    await update(job)
  }
  return job
}
export async function uploadDocument(file: ParsedFile, sessionId: string, key: string, signal: AbortSignal) {
  if (!/\.(docx|xlsx)$/i.test(file.name) || !file.size || file.size > 20 * 1024 ** 2) throw new Error('请选择 20 MiB 以内的 DOCX / XLSX 文件。')
  const data = /^data:[^,]*;base64,([A-Za-z0-9+/=]+)$/.exec(file.content)?.[1]
  if (!data) throw new Error('原文件数据不可用，请重新上传。')
  return documentApi<DocumentJob>(documentScope(), 'upload', { method: 'POST', signal, body: { key, sessionId, fileName: file.name.replace(/\.(docx|xlsx)$/i, extension => extension.toLowerCase()), data } })
}
export async function submitDocumentPlan(task: ChatDocumentTask, signal?: AbortSignal) {
  if (!task.plan) throw new Error('没有已保存的文档内容，请先恢复原请求。')
  const scope = documentScope()
  let job: DocumentJob | undefined
  try { job = await documentApi<DocumentJob>(scope, `jobs/${task.key}`, { signal }) }
  catch (error) { if ((error as { status?: number }).status !== 404) throw error }
  if (job && (job.status === 'ready' || documentPending(job))) return job
  if (job?.canRecover) return documentApi<DocumentJob>(scope, `jobs/${task.key}/retry`, { method: 'POST', signal })
  if (job?.status === 'cancelled') throw new Error('此任务已取消，请在工作区重新创建文件。')
  return documentApi<DocumentJob>(scope, 'jobs', { method: 'POST', signal, body: { key: task.key, request: task.request, plan: task.plan } })
}
export async function recoverDocumentContent(task: ChatDocumentTask, publish: () => Promise<void>, signal?: AbortSignal) {
  const scope = documentScope()
  const check = () => { scope.assert(); signal?.throwIfAborted() }
  check()
  if (!task.plan && task.modelTaskId) {
    const modelTask = creation.tasks.find(item => item.id === task.modelTaskId && item.owner === session.user?.id)
    if (!modelTask) throw new Error('未找到原模型请求，请在历史记录中查看。')
    await resumeCreation(modelTask); check()
    if (modelTask.phase !== 'complete') throw new Error(modelTask.error || '模型内容尚未生成完整，请稍后恢复。')
    const clarification = parseDocumentClarification(modelTask.text)
    if (clarification) { task.clarification = clarification; task.preparing = false; await publish(); return }
    task.plan = parseDocumentPlan(modelTask.text); await publish(); check()
  }
  task.job = await submitDocumentPlan(task, signal)
  check()
  task.error = undefined; task.preparing = false; await publish()
}
export async function runDocumentGeneration(options: {
  chat: NativeChat; result: NativeMessage; task: ChatDocumentTask; files: ParsedFile[]; history: NativeMessage[];
  source?: DocumentSource; attachment?: ChatDocumentAttachment; modelRequest: Parameters<typeof submitCreation>[0]; prefix: RequestMessage[];
  signal: AbortSignal; assertCurrent: () => void; publish: () => Promise<void>;
}) {
  const { chat, result, task, files, history, signal, assertCurrent, publish } = options
  const scope = documentScope()
  const check = () => { scope.assert(); signal.throwIfAborted(); assertCurrent() }
  const save = async () => { check(); await publish(); check() }
  let source = options.source
  let uploadKey: string | undefined
  try {
    const available = await documentApi<DocumentCapabilities>(scope, 'capabilities', { signal }); check()
    if (!available.enabled || !available[task.request.format]) throw new Error(available.reason || '当前文档格式暂不可用，请稍后重试。')
    let structure: unknown
    if (options.attachment && !source) {
      const file = files.find(item => item.name === options.attachment!.name)
      if (!file) throw new Error('请重新上传原文件。')
      uploadKey = crypto.randomUUID()
      task.uploadJob = { id: uploadKey, status: 'queued', sessionId: chat.id, createdAt: new Date().toISOString(), error: null, assetId: null, version: null }
      await save()
      const uploaded = await uploadDocument(file, chat.id, uploadKey, signal)
      const job = await waitDocumentJob(scope, uploaded, signal, async job => { check(); task.uploadJob = job; await save() })
      source = sourceFromJob(job, /\.xlsx$/i.test(file.name) ? 'xlsx' : 'docx')
      if (!source) throw new Error(job.error || '原文件读取失败，请重新上传。')
    }
    if (source) structure = await documentApi<DocumentStructure>(scope, `assets/${source.assetId}/${source.version}/structure`, { signal })
    check()
    const dataFiles = files.map(file => {
      if (/\.(docx|xlsx)$/i.test(file.name) || file.isText) return file
      if (!/\.(txt|md|markdown|csv|json)$/i.test(file.name)) throw new Error('文档资料请使用 DOCX、XLSX、TXT、Markdown、CSV 或 JSON。')
      const encoded = /^data:[^,]*;base64,([A-Za-z0-9+/=]+)$/.exec(file.content)?.[1]
      if (!encoded || encoded.length > 160000) throw new Error('文本资料过长，请缩小范围。')
      return { ...file, content: new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), character => character.charCodeAt(0))), isText: true }
    })
    task.request.instruction = documentChatInstruction(task.instruction || task.request.instruction, history, dataFiles)
    if (source && task.mode === 'edit') Object.assign(task.request, { sourceArtifactId: source.assetId, baseVersion: source.version, format: source.format })
    const prompt = documentPlanningPrompt(task.request, structure)
    if (new TextEncoder().encode(prompt).length > 512 * 1024) throw new Error('附件内容过长，请缩小文件范围后重试。')
    await save()
    let savedAt = 0
    const modelTask = await submitCreation({ ...options.modelRequest, purpose: 'document', chatOptions: { ...options.modelRequest.chatOptions!, mcpServers: [], messages: [...options.prefix, { role: 'system', content: prompt }, { role: 'user', content: task.instruction || task.request.instruction }] } }, (modelTask: CreationTask) => {
      check()
      const first = task.modelTaskId !== modelTask.id
      task.modelTaskId = modelTask.id; result.usage = modelTask.usage; result.reasoning = modelTask.reasoning
      if (first || Date.now() - savedAt > 2000) {
        savedAt = Date.now()
        return save().catch(cause => {
          if (first) { task.modelTaskId = undefined; throw new Error('文档任务未能保存，未提交生成。请检查浏览器存储后重新发送。') }
          throw cause
        })
      }
    }, () => { try { check(); return true } catch { return false } })
    check(); task.modelTaskId = modelTask.id; result.usage = modelTask.usage
    if (modelTask.phase !== 'complete') throw new Error(modelTask.error || '文档内容未完整生成，可恢复原模型请求。')
    const clarification = parseDocumentClarification(modelTask.text)
    if (clarification) { task.clarification = clarification; task.preparing = false; result.content = clarification; await save(); return }
    task.plan = parseDocumentPlan(modelTask.text); task.preparing = false
    result.content = '文档内容已生成，正在制作文件。'
    await save()
    const job = await submitDocumentPlan(task, signal)
    await waitDocumentJob(scope, job, signal, async job => { check(); task.job = job; result.content = job.status === 'ready' ? `已生成 ${job.fileName || '文档'}。` : documentPhases[job.status] || '文档处理中'; await save() })
    if (task.job?.status !== 'ready') throw new Error(task.job?.error || '文件未制作完成，可重试制作。')
  } catch (error) {
    if (signal.aborted) {
      for (const key of [uploadKey, task.plan ? task.key : undefined].filter(Boolean)) await documentApi(scope, `jobs/${key}`, { method: 'DELETE' }).catch(() => {})
    }
    throw error
  } finally { task.preparing = false }
}
