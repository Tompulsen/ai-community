// SPDX-License-Identifier: AGPL-3.0-only
import { reactive, watch } from 'vue'
import { accountApi, api, errorMessage, notify, session, uploadFile } from './state'
import type { Work } from './data'
import { getLines, getMessages } from '@fortaine/fetch-event-source/parse'
import type { ImageOptions, VideoOptions, ChatOptions } from '../shared/studio/options'
import type { ChatResponseUsage, StudioToolCall, ChatGenerationProgress, ChatResponseMetrics } from '../shared/studio/types'
import { createGenerationProgress } from '../shared/studio/generation-progress'
import { readRemixParameters } from '../shared/studio/remix-parameters'
import { normalizeImageRequest, usesGeminiImageChat } from '../shared/studio/image-params'
import type { ImageConversationContext } from '../shared/studio/image-conversation'
import { captureTaskSnapshot, deleteTaskRecords, readTaskAsset, readTaskSnapshot, saveCapturedTaskSnapshot, saveTaskOriginal } from './studio-task-store'

export type CreationKind = 'image' | 'video' | 'text'
export type CreationPhase = 'submitting' | 'running' | 'paused' | 'complete' | 'error' | 'attention'
export type CreationDestination = 'community' | 'source-comment'
export interface PublicationDetails { tagIds: string[]; prompt: string; sourceUrl: string; license: string; referenceIndices: number[] }
export interface CreationModel { id: string; name?: string; description?: string; provider?: string; kinds?: CreationKind[]; configuredKind?: CreationKind; protocol?: 'openai' | 'sync' | 'async' }
export interface CreationGroup { id: string; name: string; ratio?: number; description?: string }
interface CreationGroups { groups: CreationGroup[]; selectedGroup: string | null }
export interface CreationTask {
  id: string
  conversationId?: string
  mediaBranch?: { taskId: string; edited?: boolean }
  conversationPending?: boolean
  owner: string
  kind: CreationKind
  model: string
  prompt: string
  createdAt: number
  settledAt?: number
  phase: CreationPhase
  protocol: string
  upstreamId?: string
  tokenId?: number | null
  group?: string
  progress?: number
  urls: string[]
  text: string
  reasoning?: string
  usage?: ChatResponseUsage
  generationProgress?: ChatGenerationProgress
  responseMetrics?: ChatResponseMetrics
  preview?: string
  localSave?: { state: 'saving' | 'downloadRequested' | 'failed'; error?: string; requestedAt?: number; completed?: number }
  galleryHidden?: boolean
  galleryHiddenIndices?: number[]
  toolCalls?: StudioToolCall[]
  error?: string
  sourceWorkId?: string
  references: { name: string; url: string; id?: string; fromWorkId?: string }[]
  publicationFiles?: string[]
  publicationReferences?: string[]
  publications?: Partial<Record<CreationDestination, { title: string; text: string; content?: string; details?: PublicationDetails; files?: string[]; work?: Work }>>
  request: { size: string; exactSize?: boolean; aspect_ratio: string; n: number; duration: number; protocol?: 'openai' | 'sync' | 'async'; imageOptions?: ImageOptions; videoOptions?: VideoOptions; chatOptions?: ChatOptions }
  customApiBase?: string
  legacy?: boolean
}
export interface CreationInput {
  conversationId?: string
  mediaBranch?: { taskId: string; edited?: boolean }
  imageContext?: ImageConversationContext
  accountTokenId?: number | null
  accountGroup?: string | null
  kind: CreationKind
  model: string
  prompt: string
  size: string
  exactSize?: boolean
  aspect_ratio: string
  n: number
  duration: number
  protocol?: string
  sourceWorkId?: string
  references?: CreationTask['references']
  imageOptions?: ImageOptions
  videoOptions?: VideoOptions
  chatOptions?: ChatOptions
}
export const creation = reactive({
  models: [] as CreationModel[], modelsLoading: false, modelsLoaded: false, modelsError: '',
  groups: [] as CreationGroup[], selectedGroup: null as string | null, modelTokenId: null as number | null,
  groupsLoading: false, groupSwitching: false, groupsError: '',
  tasks: [] as CreationTask[], selectedId: '', loaded: false, storageError: '', historyRevision: 0,
})
export const mediaSettings = reactive({ autoDownload: false, autoSaveGallery: true, loaded: false })
const controllers = new Map<string, AbortController>()
const downloads = new Map<string, { controller: AbortController; promise: Promise<void> }>()
const localMedia = reactive<Record<string, string>>({})
const mediaLoads = new Map<string, Promise<string | undefined>>()
let owner = '', epoch = 0, booting: Promise<void> | undefined
let modelRevision = 0
let modelRead: Promise<void> | undefined, modelReadGroup: string | null = null
let groupRead: Promise<void> | undefined, groupSelection: Promise<void> | undefined
let writes: Promise<unknown> = Promise.resolve()
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
const validUpstreamId = (value: unknown): value is string => validId(value) || typeof value === 'string' && /^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9_-]+$/.test(value)
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const activeOwner = () => session.user?.id || ''
const storeKey = () => `octopus:user-${activeOwner()}:native-creation-history`

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('community-studio', 1)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('keyval')) request.result.createObjectStore('keyval') }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function storedValue(key: string): Promise<unknown> {
  try {
    const db = await database()
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('keyval', 'readonly')
      const request = transaction.objectStore('keyval').get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => db.close()
    })
  } catch { return undefined }
}
function parse(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return undefined }
}
async function persist(required = false) {
  if (!owner || owner !== activeOwner()) return
  const acceptedOwner = owner, key = storeKey(), snapshot = captureTaskSnapshot(owner, creation.tasks)
  writes = writes.catch(() => {}).then(async () => {
    if (acceptedOwner !== activeOwner()) return
    try {
      await saveCapturedTaskSnapshot(acceptedOwner, snapshot)
      if (acceptedOwner === activeOwner()) {
        localStorage.removeItem(key + ':v2-fallback')
        creation.historyRevision++
      }
    } catch {
      try { localStorage.setItem(key + ':v2-fallback', `[${[...snapshot.values()].join(',')}]`) }
      catch {
        if (acceptedOwner === activeOwner()) creation.storageError = '本地存储空间不足，刷新前请下载生成结果。'
        if (required) throw new Error('无法保存任务记录，请释放浏览器存储空间后重新操作。')
      }
    }
  })
  await writes
}
export async function prepareCreationHistory() {
  await initializeCreation()
  if (!creation.loaded || owner !== activeOwner()) throw new Error(creation.storageError || '创作记录尚未加载。')
  await persist(true)
}
export function canonicalCreationTask(task: CreationTask) {
  if (!validTask(task) || task.owner !== activeOwner()) throw new Error('生成记录不属于当前账号。')
  let current = creation.tasks.find(item => item.id === task.id && item.owner === task.owner)
  if (!current) { creation.tasks.push(task); current = creation.tasks.at(-1)! }
  return current
}
export async function updateMediaSettings(patch: boolean | { autoDownload?: boolean; autoSaveGallery?: boolean }) {
  if (!activeOwner()) throw new Error('当前账号不可用。')
  const values = typeof patch === 'boolean' ? { autoDownload: patch } : patch
  if (!values || Object.values(values).some(value => typeof value !== 'boolean')) throw new Error('保存设置无效。')
  const next = { autoDownload: mediaSettings.autoDownload, autoSaveGallery: mediaSettings.autoSaveGallery, ...values }
  localStorage.setItem(`octopus:user-${activeOwner()}:native-media-settings`, JSON.stringify(next))
  Object.assign(mediaSettings, next, { loaded: true })
}
export async function hideGalleryOutputs(items: { task: CreationTask; index: number }[]) {
  const pending = items.map(({ task, index }) => {
    if (!Number.isInteger(index) || !task.urls[index]) throw new Error('作品不存在，请重新打开作品库。')
    return { task: canonicalCreationTask(task), index }
  })
  for (const { task, index } of pending) task.galleryHiddenIndices = [...new Set([...(task.galleryHiddenIndices || []), index])].sort((a, b) => a - b)
  await persist(true)
}
function validTask(value: unknown): value is CreationTask {
  return record(value) && validId(value.id) && ['image', 'video', 'text'].includes(String(value.kind))
    && typeof value.owner === 'string' && typeof value.prompt === 'string' && typeof value.model === 'string'
    && Array.isArray(value.urls) && typeof value.text === 'string' && record(value.request)
    && Array.isArray(value.references) && value.references.every(file => record(file) && typeof file.url === 'string' && typeof file.name === 'string')
    && typeof value.protocol === 'string' && ['submitting', 'running', 'paused', 'complete', 'error', 'attention'].includes(String(value.phase))
}
export function creationRequestTimedOut(task: CreationTask): boolean {
  return task.protocol === 'sync' && !task.upstreamId && /\b504\b|gateway\s+timeout/i.test(task.error || '')
}
function safeResultUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)) return value
  if (value.startsWith('/legacy-files/') || value.startsWith('/api/creation/')) return value
  if (/^studio-asset:[A-Za-z0-9_-]{1,200}:(?:\d{1,4}|preview)$/.test(value)) return value
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href } catch { /* Invalid media is never rendered. */ }
}
function galleryDatabase(): Promise<IDBDatabase | undefined> {
  const id = activeOwner()
  if (!id || !/^[1-9]\d*$/.test(id)) return Promise.resolve(undefined)
  return new Promise(resolve => {
    const request = indexedDB.open(`octopus-gallery-user-${id}`)
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = request.onblocked = () => resolve(undefined)
    request.onsuccess = () => {
      if (request.result.objectStoreNames.contains('images')) resolve(request.result)
      else { request.result.close(); resolve(undefined) }
    }
  })
}
async function gallerySource(url: string, preview: boolean): Promise<string | undefined> {
  const id = url.slice('legacy-gallery:'.length)
  if (!validId(id)) return
  const key = `${activeOwner()}:${url}:${preview ? 'preview' : 'original'}`
  if (localMedia[key]) return localMedia[key]
  if (mediaLoads.has(key)) return mediaLoads.get(key)
  const version = epoch
  const loading = (async () => {
    const db = await galleryDatabase()
    if (!db) throw new Error('旧图库暂时无法读取，原记录已保留。')
    const value = await new Promise<unknown>((resolve, reject) => {
      const stores = db.objectStoreNames.contains('originals') ? ['images', 'originals'] : ['images']
      const transaction = db.transaction(stores, 'readonly')
      const image = transaction.objectStore('images').get(id)
      image.onsuccess = () => {
        const metadata = image.result
        if (preview && metadata?.thumbnail instanceof Blob) return resolve(metadata.thumbnail)
        if (stores.includes('originals')) {
          const original = transaction.objectStore('originals').get(id)
          original.onsuccess = () => resolve(original.result instanceof Blob ? original.result : metadata?.imageData)
          original.onerror = () => reject(original.error)
        } else resolve(metadata?.imageData)
      }
      image.onerror = () => reject(image.error)
      transaction.oncomplete = () => db.close()
      transaction.onabort = () => { db.close(); reject(transaction.error) }
    })
    if (version !== epoch) return
    const source = value instanceof Blob ? URL.createObjectURL(value) : safeResultUrl(value)
    if (!source) throw new Error('旧图库原文件暂时无法读取，原记录已保留。')
    localMedia[key] = source
    return source
  })().catch(error => {
    if (version === epoch) {
      for (const task of creation.tasks.filter(task => task.urls.includes(url))) {
        task.error = errorMessage(error)
        if (!preview) task.phase = 'attention'
      }
    }
    return undefined
  })
  mediaLoads.set(key, loading)
  return loading
}
export function mediaSource(url: string, preview = false, kind: CreationKind = 'image'): string | undefined {
  if (url.startsWith('studio-asset:')) {
    const key = `${activeOwner()}:${url}:original`
    if (!localMedia[key] && !mediaLoads.has(key)) {
      const accepted = activeOwner(), version = epoch
      const loading = readTaskAsset(accepted, url).then(blob => {
        if (blob && version === epoch) return localMedia[key] = URL.createObjectURL(blob)
      }).catch(() => undefined).finally(() => mediaLoads.delete(key))
      mediaLoads.set(key, loading)
    }
    return localMedia[key]
  }
  if (url.startsWith('legacy-gallery:')) {
    const key = `${activeOwner()}:${url}:${preview ? 'preview' : 'original'}`
    if (!localMedia[key]) void gallerySource(url, preview)
    return localMedia[key]
  }
  if (url.startsWith('data:') || url.startsWith('/legacy-files/') || url.startsWith('/api/creation/')) return url
  return `/api/creation/media?${new URLSearchParams({ url, kind })}`
}
export async function readableMedia(url: string, kind: CreationKind, preview = false) {
  if (url.startsWith('blob:')) return url
  if (typeof location !== 'undefined') {
    try {
      const direct = new URL(url, location.href)
      if (direct.origin === location.origin && ['/api/creation/', '/legacy-files/', '/assets/'].some(path => direct.pathname.startsWith(path))) return direct.href
    } catch { /* Other media keeps using the existing safe proxy. */ }
  }
  let source = url.startsWith('legacy-gallery:') ? await gallerySource(url, preview) : mediaSource(url, false, kind)
  if (url.startsWith('studio-asset:') && !source) {
    const key = `${activeOwner()}:${url}:original`
    source = await mediaLoads.get(key)
  }
  if (!source) throw new Error('生成文件暂时无法读取，任务记录已保留。')
  return source
}
async function portableImage(url: string) {
  if (!url.startsWith('legacy-gallery:') && !url.startsWith('studio-asset:') && !url.startsWith('blob:')) return url
  const response = await fetch(url.startsWith('blob:') ? url : await readableMedia(url, 'image'))
  if (!response.ok) throw new Error('历史图片无法读取，请重新选择参考图。')
  const blob = await response.blob()
  if (!/^image\/(?:png|jpeg|webp)$/.test(blob.type) || !blob.size || blob.size > 20 * 1024 * 1024) throw new Error('历史图片须为 PNG、JPEG 或 WebP，且不超过 20 MB。')
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('历史图片读取失败。'))
    reader.readAsDataURL(blob)
  })
}
export async function copyCreationImage(task: CreationTask, index = 0) {
  if (task.owner !== activeOwner() || !task.urls[index]) throw new Error('图片不属于当前账号。')
  return copyMediaImage(task.urls[index]!)
}
export async function copyMediaImage(url: string) {
  const accepted = activeOwner(), version = epoch
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('浏览器不支持复制图片，请下载图片。')
  // Supply the promise during the click gesture; loading original bytes can take time.
  const image = (async () => {
    const response = await fetch(await readableMedia(url, 'image'), { credentials: 'same-origin' })
    if (!response.ok) throw new Error('图片无法读取。')
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) throw new Error('图片格式无效。')
    const bitmap = await createImageBitmap(blob)
    try {
      if (version !== epoch || accepted !== activeOwner()) throw new Error('账号已切换，请重新操作。')
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('图片转换失败，请下载图片。')
      context.drawImage(bitmap, 0, 0)
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片转换失败。')), 'image/png'))
    } finally { bitmap.close() }
  })()
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })])
}
function mediaPathUrl(value: unknown, task: Pick<CreationTask, 'tokenId' | 'kind' | 'protocol'>): string | undefined {
  const direct = safeResultUrl(value)
  if (direct) return direct
  if (typeof value !== 'string' || !/^(?:videos\/[A-Za-z0-9_-]{1,200}\/content|tasks\/[A-Za-z0-9_-]{1,200}\/artifacts\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}\/content|v1beta\/files\/[A-Za-z0-9_-]{1,200}:download\?alt=media)$/.test(value)) return
  const query = new URLSearchParams({ path: value, kind: task.kind, protocol: task.protocol })
  if (task.tokenId != null) query.set('tokenId', String(task.tokenId))
  return `/api/creation/media?${query}`
}
function resultData(value: unknown): Record<string, unknown> {
  if (!record(value)) return {}
  if (record(value.data) && !Array.isArray(value.data)) return { ...value, ...value.data }
  return value
}
function resultUrls(data: Record<string, unknown>, task: CreationTask): string[] {
  const rows = Array.isArray(data.outputs) ? data.outputs : Array.isArray(data.data) ? data.data : Array.isArray(data.output) ? data.output : []
  const nested = [data.output, data.result, data.video].filter(record)
  const values: unknown[] = [data.url, data.video_url, mediaPathUrl(data.mediaPath, task), ...nested.map(item => item.url)]
  for (const row of rows) {
    if (record(row)) values.push(row.url, row.video_url, typeof row.b64_json === 'string' ? `data:image/png;base64,${row.b64_json}` : undefined)
    else values.push(row)
  }
  return [...new Set(values.map(safeResultUrl).filter((url): url is string => Boolean(url)))]
}
function resultText(data: Record<string, unknown>): string {
  if (typeof data.text === 'string') return data.text
  if (Array.isArray(data.outputs)) return data.outputs.filter(record).flatMap(item => typeof item.text === 'string' ? [item.text] : []).join('\n')
  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined
  return record(choice) && record(choice.message) && typeof choice.message.content === 'string' ? choice.message.content : ''
}
function applyResult(task: CreationTask, value: unknown): boolean {
  const data = resultData(value)
  task.settledAt = Date.now()
  if (typeof data.reasoning === 'string') task.reasoning = data.reasoning
  if (record(data.usage)) task.usage = data.usage as ChatResponseUsage
  if (Array.isArray(data.toolCalls)) task.toolCalls = data.toolCalls as StudioToolCall[]
  const status = String(data.status || data.state || '').toLowerCase()
  if (typeof data.tokenId === 'number') task.tokenId = data.tokenId
  if (typeof data.protocol === 'string' && ['openai', 'sync', 'async', 'legacy', 'plugin', 'seedance', 'gemini', 'xai'].includes(data.protocol)) task.protocol = data.protocol
  const urls = resultUrls(data, task), text = resultText(data)
  const id = data.upstreamId || data.task_id || data.id || data.taskId
  if (validUpstreamId(id) && (status || !urls.length && !text)) task.upstreamId = id
  const progress = typeof data.progress === 'string' ? Number(data.progress.replace('%', '')) : data.progress
  if (typeof progress === 'number' && Number.isFinite(progress)) task.progress = Math.max(0, Math.min(100, progress <= 1 && progress > 0 ? progress * 100 : progress))
  const detail = typeof data.error === 'string' ? data.error : record(data.error) && typeof data.error.message === 'string' ? data.error.message : ''
  if (['save_failed', 'indeterminate', 'expired'].includes(status)) {
    task.phase = 'attention'; task.error = `${detail ? detail + ' ' : ''}任务结果暂时无法确认，记录已保留，请先核对使用记录，避免重复生成。`
    if (status === 'indeterminate' && creationRequestTimedOut(task)) {
      task.phase = 'error'; task.error = `${detail} 本次请求已超时，未收到生成结果。扣费请核对账号使用记录，重试需手动发起。`
    }
    return true
  }
  if (['failed', 'cancelled', 'canceled', 'error'].includes(status)) {
    task.phase = 'error'
    task.error = detail || '上游任务未成功完成。'
    return true
  }
  if ((urls.length || text || task.toolCalls?.length) && (!status || ['complete', 'completed', 'success', 'succeeded'].includes(status))) {
    task.urls = urls; task.text = text; task.phase = 'complete'; task.progress = 100; task.error = ''
    if (task.kind !== 'text') void autoDownloadCreation(task)
    return true
  }
  if (['complete', 'completed', 'success', 'succeeded'].includes(status)) {
    task.phase = 'attention'; task.error = '上游任务已结束，但未返回可读取的结果，记录已保留。'
    return true
  }
  task.phase = task.upstreamId ? 'running' : 'attention'
  if (task.phase === 'running') task.settledAt = undefined
  if (!task.upstreamId) task.error = '未收到可恢复的任务编号，请核对账号使用记录，勿重复提交。'
  return !task.upstreamId
}
function delay(signal: AbortSignal, duration: number) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, duration)
    const abort = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
async function poll(task: CreationTask, controller: AbortController, version: number) {
  const deadline = Date.now() + (task.kind === 'video' ? 2 * 60 * 60_000 : 30 * 60_000)
  while (!controller.signal.aborted && epoch === version && Date.now() < deadline) {
    const query = new URLSearchParams({ protocol: task.protocol })
    if (task.tokenId != null) query.set('tokenId', String(task.tokenId))
    const data = await api<unknown>(`/api/creation/tasks/${task.kind}/${encodeURIComponent(task.upstreamId!)}?${query}`, { signal: controller.signal })
    if (epoch !== version || controller.signal.aborted) return
    const finished = applyResult(task, data)
    await persist()
    if (finished) { if (task.phase === 'complete') notify('生成完成，可在创作台查看结果。'); return }
    await delay(controller.signal, 5000)
  }
  if (epoch === version && !controller.signal.aborted) { task.phase = 'paused'; task.settledAt = Date.now(); task.error = '等待时间较长，任务记录已保留，可继续查询。'; await persist() }
}
export function loadCreationModels(): Promise<void> {
  if (!session.user) return Promise.resolve()
  if (modelRead && modelReadGroup === creation.selectedGroup) return modelRead
  const version = epoch, revision = ++modelRevision, group = creation.selectedGroup
  modelReadGroup = group
  creation.modelsLoading = true; creation.modelsLoaded = false; creation.modelsError = ''
  modelRead = (async () => { try {
    const result = await api<{ items?: CreationModel[]; data?: CreationModel[]; tokenId?: number }>('/api/creation/models', { signal: AbortSignal.timeout(20000) })
    if (version !== epoch || revision !== modelRevision || group !== creation.selectedGroup) return
    creation.models = (result.items || result.data || []).filter(item => item && typeof item.id === 'string')
    creation.modelTokenId = Number.isSafeInteger(result.tokenId) && result.tokenId! > 0 ? result.tokenId! : null
  } catch (error) {
    if (version === epoch && revision === modelRevision && group === creation.selectedGroup) {
      creation.models = []; creation.modelTokenId = null; creation.modelsError = errorMessage(error)
    }
  } finally { if (version === epoch && revision === modelRevision) { modelRead = undefined; creation.modelsLoading = false; creation.modelsLoaded = group === creation.selectedGroup } }
  })()
  return modelRead
}
export function loadCreationGroups(): Promise<void> {
  if (!session.user) return Promise.resolve()
  if (groupRead) return groupRead
  const version = epoch, accountId = session.user.accountId || session.user.id
  creation.groupsLoading = true; creation.groupsError = ''
  groupRead = (async () => { try {
    const result = await accountApi<CreationGroups>('model-groups', undefined, accountId)
    if (version !== epoch) return
    if (!Array.isArray(result?.groups)) throw new Error('模型分组返回无效，请重试。')
    creation.groups = result.groups
    creation.selectedGroup = result.selectedGroup
  } catch (error) { if (version === epoch) creation.groupsError = errorMessage(error) }
  finally { if (version === epoch) { creation.groupsLoading = false; groupRead = undefined } }
  })()
  return groupRead
}
export async function waitCreationGroup() { await groupSelection }
export function selectCreationGroup(group: string): Promise<void> {
  if (groupSelection) return groupSelection
  if (!session.user || creation.groupsLoading || group === creation.selectedGroup) return Promise.resolve()
  if (!creation.groups.some(item => item.id === group)) return Promise.resolve()
  const version = epoch, accountId = session.user.accountId || session.user.id
  creation.groupSwitching = true; creation.groupsError = ''; creation.modelsError = ''
  ++modelRevision; modelRead = undefined
  creation.models = []; creation.modelTokenId = null; creation.modelsLoaded = false
  groupSelection = (async () => { try {
    const result = await accountApi<{ group: string; selectedTokenId: number }>('model-groups/select', { group }, accountId)
    if (version !== epoch) return
    ++modelRevision; modelRead = undefined
    creation.selectedGroup = result.group
    await loadCreationModels()
  } catch (error) {
    if (version !== epoch) return
    // A timed-out selection may have succeeded; read it back without repeating the mutation.
    await loadCreationGroups()
    if (version !== epoch) return
    ++modelRevision; modelRead = undefined
    await loadCreationModels()
    if (version === epoch) creation.groupsError = errorMessage(error)
  } finally { if (version === epoch) { creation.groupSwitching = false; groupSelection = undefined } }
  })()
  return groupSelection
}
export async function resumeCreation(task: CreationTask) {
  if (task.owner !== activeOwner() || controllers.has(task.id) || task.phase === 'complete' || task.phase === 'error') return
  if (creationRequestTimedOut(task)) { task.phase = 'error'; await persist(); return }
  if (!task.upstreamId && task.legacy) return
  if (task.customApiBase) { task.phase = 'attention'; task.error = '此历史任务使用自定义接口，已保留原记录，请到原服务核对结果。'; return }
  if (task.legacy && task.tokenId == null) { task.phase = 'attention'; task.error = '此历史任务缺少原始令牌编号，已保留记录，请先核对原任务。'; await persist(); return }
  const controller = new AbortController(), version = epoch
  controllers.set(task.id, controller); task.phase = 'running'; task.error = ''; task.settledAt = undefined
  try {
    if (!task.upstreamId) {
      const data = await api<unknown>(`/api/creation/requests/${encodeURIComponent(task.id)}`, { signal: controller.signal })
      if (epoch !== version || controller.signal.aborted) return
      const finished = applyResult(task, data)
      await persist()
      if (finished) return
    }
    await poll(task, controller, version)
  }
  catch (error) {
    if (epoch === version) { task.phase = task.upstreamId ? 'paused' : 'attention'; task.settledAt ??= Date.now(); task.error = controller.signal.aborted ? '已停止本页等待，上游任务可能仍在执行。' : errorMessage(error); await persist() }
  } finally { if (controllers.get(task.id) === controller) controllers.delete(task.id) }
}
export function stopCreation(task: CreationTask) {
  if (task.owner !== activeOwner() || !['submitting', 'running'].includes(task.phase)) return
  controllers.get(task.id)?.abort()
  task.phase = 'paused'; task.settledAt = Date.now(); task.error = '已停止本页等待，上游任务可能仍在执行。'
  void persist()
}
export function creationConversationId(task: CreationTask) { return task.conversationId || task.id }
export async function submitCreation(input: CreationInput, onUpdate?: (task: CreationTask) => void | Promise<void>, isCurrent: () => boolean = () => true) {
  if (creation.groupSwitching || creation.groupsLoading || creation.modelsLoading) throw new Error('模型分组正在更新，请稍后再生成。')
  const selectedTokenId = input.accountTokenId ?? creation.modelTokenId
  const selectedGroup = input.accountGroup === undefined ? creation.selectedGroup : input.accountGroup
  const version = epoch, acceptedOwner = activeOwner(), acceptedAccount = /^[1-9]\d*$/.test(acceptedOwner) ? acceptedOwner : session.user?.accountId
  await initializeCreation()
  if (version !== epoch || acceptedOwner !== activeOwner() || !isCurrent()) throw new Error('操作已停止或账号已切换，未提交生成。')
  if (!owner || owner !== activeOwner() || !input.model.trim() || !input.prompt.trim()) throw new Error('请选择模型并输入提示词。')
  input = JSON.parse(JSON.stringify(input)) as CreationInput
  normalizeImageRequest(input)
  if (input.mediaBranch) {
    const { mediaBranchTask } = await import('./studio-conversations')
    if (input.kind === 'text' || !mediaBranchTask(input.kind, input.conversationId, input.mediaBranch.taskId))
      throw new Error('原生成记录不属于当前会话。')
  }
  const portable = new Map<string, Promise<string>>()
  const prepareImage = (url: string) => {
    if (!portable.has(url)) portable.set(url, portableImage(url))
    return portable.get(url)!
  }
  for (const file of input.references || []) file.url = await prepareImage(file.url)
  for (const turn of input.imageContext?.turns || []) {
    turn.images = await Promise.all(turn.images.map(prepareImage))
    if (turn.references) turn.references = await Promise.all(turn.references.map(prepareImage))
  }
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 27 * 1024 ** 2) throw new Error('图片和对话上下文超过请求大小上限，请清除上下文或减少参考图。')
  if (version !== epoch || acceptedOwner !== activeOwner() || !isCurrent()) throw new Error('操作已停止或账号已切换，未提交生成。')
  const id = crypto.randomUUID()
  const previous = input.conversationId && creation.tasks.find(task => task.owner === owner && task.kind === input.kind && creationConversationId(task) === input.conversationId)
  const task: CreationTask = reactive({
    id, conversationId: previous ? creationConversationId(previous) : validId(input.conversationId) ? input.conversationId : id, owner, kind: input.kind, model: input.model, prompt: input.prompt.trim(),
    createdAt: Date.now(), phase: 'submitting', protocol: input.protocol || 'openai', urls: [], text: '',
    sourceWorkId: input.sourceWorkId, references: input.references || [], ...(selectedGroup ? { group: selectedGroup } : {}),
    ...(input.mediaBranch ? { mediaBranch: input.mediaBranch } : {}),
    ...(input.kind !== 'text' && !mediaSettings.autoSaveGallery ? { galleryHidden: true } : {}),
    ...(input.kind !== 'text' && onUpdate ? { conversationPending: true } : {}),
    request: { size: input.size, ...(input.exactSize ? { exactSize: true } : {}), aspect_ratio: input.aspect_ratio, n: input.n, duration: input.duration,
      protocol: input.protocol === 'async' ? 'async' : 'openai',
      ...(input.imageOptions ? { imageOptions: JSON.parse(JSON.stringify(input.imageOptions)) } : {}),
      ...(input.videoOptions ? { videoOptions: JSON.parse(JSON.stringify(input.videoOptions)) } : {}),
      ...(input.chatOptions ? { chatOptions: JSON.parse(JSON.stringify(input.chatOptions)) } : {}) },
  })
  creation.tasks.unshift(task); creation.selectedId = task.id
  try { await persist(true) }
  catch (error) { task.phase = 'error'; task.settledAt = Date.now(); task.error = errorMessage(error); throw error }
  if (epoch !== version || task.owner !== activeOwner()) throw new Error('账号已切换，请重新操作。')
  if (!isCurrent() || task.phase !== 'submitting') {
    task.phase = 'error'; task.settledAt = Date.now(); task.error = '操作已停止，未向上游提交生成。'; await persist(); return task
  }
  const controller = new AbortController()
  controllers.set(task.id, controller)
  try { await onUpdate?.(task) }
  catch (error) {
    controllers.delete(task.id); task.phase = 'error'; task.settledAt = Date.now()
    task.error = `会话未能保存，未提交生成：${errorMessage(error)}`
    await persist(); throw error
  }
  task.conversationPending = false
  if (epoch !== version || acceptedOwner !== activeOwner() || !isCurrent() || task.phase !== 'submitting') {
    controllers.delete(task.id)
    if (epoch === version) { task.phase = 'error'; task.settledAt = Date.now(); task.error = '操作已停止，未提交生成。'; await persist() }
    return task
  }
  try {
    const response = await fetch('/api/creation/generate', {
      method: 'POST', credentials: 'same-origin', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(session.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
        ...(acceptedAccount ? { 'X-New-Api-User': acceptedAccount } : {}),
        ...(selectedTokenId ? { 'X-New-Api-Token': String(selectedTokenId) } : {}) },
      body: JSON.stringify({ ...input, mediaBranch: undefined, conversationId: undefined, accountTokenId: undefined, accountGroup: undefined, references: undefined, referenceUrls: task.references.map(file => file.url), requestId: task.id }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw Object.assign(new Error((typeof data.error === 'string' ? data.error : data.error?.message) || data.message || `生成请求失败 (${response.status})`), {
        notAccepted: [400, 401, 403, 413, 422, 429].includes(response.status),
      })
    }
    const tokenId = Number(response.headers.get('X-New-Api-Token'))
    if (Number.isSafeInteger(tokenId) && tokenId > 0) task.tokenId = tokenId
    let data: unknown
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      if (!response.body) throw new Error('生成流为空。')
      let lastSave = 0
      const progress = createGenerationProgress()
      const parser = getLines(getMessages(message => {
        if (!message.data || epoch !== version || controller.signal.aborted) return
        const event = JSON.parse(message.data)
        if (event.type === 'error') throw Object.assign(new Error(event.error || '生成失败。'), { notAccepted: event.notAccepted === true })
        if (event.type === 'preview' && safeResultUrl(event.url)) { task.preview = event.url; task.phase = 'running' }
        if (event.type === 'delta') {
          task.text = typeof event.text === 'string' ? event.text : task.text
          task.reasoning = typeof event.reasoning === 'string' ? event.reasoning : ''
          task.usage = event.usage; task.phase = 'running'
          const measured = progress(task.text, task.reasoning || '', performance.now())
          if (measured) task.generationProgress = measured
        }
        if (event.type === 'result') data = event
        onUpdate?.(task)
        if (Date.now() - lastSave > 2000) { lastSave = Date.now(); void persist() }
      }))
      const reader = response.body.getReader()
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; parser(part.value) }
        parser(new TextEncoder().encode('\n\n'))
        if (!data) throw new Error('生成流已中断，请查询原请求结果。')
      } catch (error) { await reader.cancel().catch(() => {}); throw error }
      finally { reader.releaseLock() }
    } else data = await response.json()
    if (epoch !== version || controller.signal.aborted) return task
    if (record(data)) { task.reasoning = typeof data.reasoning === 'string' ? data.reasoning : task.reasoning; task.usage = data.usage as ChatResponseUsage | undefined }
    const finished = applyResult(task, data)
    if (task.generationProgress) task.responseMetrics = {
      usage: task.usage || {}, generationDurationMs: task.generationProgress.durationMs, estimatedOutputTokens: task.generationProgress.outputTokens,
    }
    await persist()
    if (!finished) await poll(task, controller, version)
  } catch (error) {
    if (epoch === version) {
      const notAccepted = record(error) && error.notAccepted === true
      task.phase = notAccepted ? 'error' : task.upstreamId ? 'paused' : 'attention'
      task.settledAt ??= Date.now()
      task.error = controller.signal.aborted ? task.upstreamId ? '已停止本页等待，上游任务可能仍在执行。' : '已停止本页等待，上游可能已受理，请先核对使用记录。' : notAccepted ? errorMessage(error) : `${errorMessage(error)} 任务记录已保留，请勿自动重复提交。`
    }
  } finally {
    if (epoch === version) await persist()
    if (controllers.get(task.id) === controller) controllers.delete(task.id)
  }
  return task
}
export async function removeCreationTasks(ids: string[]) {
  const selected = new Set(ids), acceptedOwner = activeOwner(), version = epoch
  if (creation.tasks.some(task => selected.has(task.id) && (controllers.has(task.id) || ['submitting', 'running', 'paused', 'attention'].includes(task.phase)))) throw new Error('进行中或需要核对的任务请保留，查询完成后再删除。')
  await writes.catch(() => {})
  await deleteTaskRecords(acceptedOwner, ids)
  if (version !== epoch || acceptedOwner !== activeOwner()) return
  for (const task of creation.tasks.filter(task => selected.has(task.id) && task.owner === acceptedOwner)) downloads.get(`${task.owner}:${task.id}`)?.controller.abort()
  creation.tasks = creation.tasks.filter(task => task.owner !== acceptedOwner || !selected.has(task.id))
  if (selected.has(creation.selectedId)) creation.selectedId = creation.tasks[0]?.id || ''
  await persist(true)
}

async function importLegacy(version: number) {
  const id = activeOwner()
  if (!id || !/^[1-9]\d*$/.test(id)) return
  const prefix = `octopus:user-${id}:`
  const imported: CreationTask[] = []
  for (const key of Object.keys(localStorage).filter(value => value.startsWith(prefix + 'task:'))) {
    const task = parse(localStorage.getItem(key))
    if (!record(task) || !validId(task.id) || !['image', 'video'].includes(String(task.kind))) continue
    imported.push({
      id: task.id, owner, legacy: true, kind: task.kind as CreationKind, model: String(task.model || ''), prompt: String(task.prompt || ''),
      phase: task.upstreamId ? 'paused' : 'attention', upstreamId: typeof task.upstreamId === 'string' ? task.upstreamId : undefined,
      protocol: task.protocol === 'async' ? 'async' : record(task.video) && typeof task.video.apiFormat === 'string' ? task.video.apiFormat : 'openai',
      tokenId: typeof task.tokenId === 'number' ? task.tokenId : null, createdAt: Number(task.createdAt) || Date.now(),
      urls: [], text: '', references: [], request: { size: '1024x1024', aspect_ratio: '1:1', n: 1, duration: 8 },
      customApiBase: typeof task.customApiBase === 'string' ? task.customApiBase : undefined,
      error: '历史任务已保留，可继续查询；不会重新提交生成。',
    })
  }
  const snapshotKey = prefix + 'video-workspace-results'
  const results = parse(await storedValue(snapshotKey)) || parse(localStorage.getItem(snapshotKey))
  const items = Array.isArray(results) ? results : record(results) && record(results.state) && Array.isArray(results.state.results) ? results.state.results : record(results) && Array.isArray(results.results) ? results.results : []
  for (const value of items) {
    if (!record(value) || !validId(value.id)) continue
    const previous = imported.find(task => task.id === value.id)
    const task: CreationTask = previous || {
      id: value.id, owner, legacy: true, kind: 'video', model: String(value.model || ''), prompt: String(value.prompt || ''), phase: 'paused',
      createdAt: Number(value.createdAt) || Date.now(), protocol: record(value.request) ? String(value.request.apiFormat || 'openai') : 'openai',
      urls: [], text: '', references: [], request: { size: String(value.size || '1920x1080'), aspect_ratio: String(value.aspectRatio || '16:9'), n: 1, duration: Number(value.duration) || 8 },
    }
    if (validUpstreamId(value.upstreamId)) task.upstreamId = value.upstreamId
    if (typeof value.tokenId === 'number') task.tokenId = value.tokenId
    if (typeof value.customApiBase === 'string') task.customApiBase = value.customApiBase
    const request = record(value.request) ? value.request : undefined
    if (request && typeof request.sourceWorkId === 'string') task.sourceWorkId = request.sourceWorkId
    let storedUrl = value.url
    if (record(storedUrl) && validId(storedUrl.__octopusChatAsset)) storedUrl = await storedValue(`${snapshotKey}:asset:${storedUrl.__octopusChatAsset}`)
    const url = task.customApiBase ? undefined : mediaPathUrl(value.mediaPath, task) || safeResultUrl(storedUrl)
    if (url && value.status !== 'pending' && value.status !== 'failed') {
      if (typeof value.mediaPath === 'string' && !safeResultUrl(value.mediaPath)) {
        const mediaId = /^(?:videos|tasks)\/([A-Za-z0-9_-]+)\//.exec(value.mediaPath)?.[1]
        if (!task.upstreamId && mediaId) task.upstreamId = mediaId
        task.phase = task.upstreamId ? 'paused' : 'attention'
        task.error = task.upstreamId ? '正在恢复历史视频，可继续查询原任务。' : '历史视频记录已保留，请先核对原任务。'
      } else { task.urls = [url]; task.phase = 'complete'; task.error = '' }
    }
    else if (value.status === 'failed') { task.phase = 'error'; task.error = typeof value.error === 'string' ? value.error : '历史生成未成功完成。' }
    else if (task.customApiBase) { task.phase = 'attention'; task.error = '此历史任务使用自定义接口，已保留原记录，请到原服务核对结果。' }
    else if (!url && record(value.url)) { task.phase = 'attention'; task.error = '历史视频附件暂时无法读取，原记录已保留。' }
    if (!previous) imported.push(task)
  }
  const gallery = await galleryDatabase()
  if (gallery) {
    await new Promise<void>((resolve, reject) => {
      const transaction = gallery.transaction('images', 'readonly')
      const cursor = transaction.objectStore('images').openCursor()
      cursor.onsuccess = () => {
        const entry = cursor.result
        if (!entry) return
        const value: unknown = entry.value
        if (record(value) && validId(value.id) && !imported.some(task => task.id === value.id)) {
          const width = Number(value.width) || 1024, height = Number(value.height) || 1024
          const config = record(value.config) ? value.config : {}
          imported.push({
            id: value.id, owner, legacy: true, kind: 'image', model: String(value.model || ''), prompt: String(value.prompt || ''),
            createdAt: Number(value.createdAt) || Date.now(), phase: value.status === 'failed' ? 'error' : 'complete',
            protocol: 'openai', urls: value.status === 'failed' ? [] : [`legacy-gallery:${value.id}`], text: '',
            sourceWorkId: typeof value.sourceWorkId === 'string' ? value.sourceWorkId : undefined, references: [],
            request: { size: typeof config.size === 'string' ? config.size : `${width}x${height}`, aspect_ratio: width === height ? '1:1' : width > height ? '16:9' : '9:16', n: 1, duration: 8 },
            error: value.status === 'failed' ? '历史图片未成功生成。' : undefined,
          })
        }
        entry.continue()
      }
      cursor.onerror = () => reject(cursor.error)
      transaction.oncomplete = () => { gallery.close(); resolve() }
      transaction.onabort = () => { gallery.close(); reject(transaction.error) }
    }).catch(() => { if (version === epoch) creation.storageError = '部分历史图片暂时无法读取，原图库已保留。' })
  }
  if (version !== epoch) return
  for (const task of imported) {
    if (task.phase === 'paused' && task.tokenId == null) { task.phase = 'attention'; task.error = '此历史任务缺少原始令牌编号，已保留记录，请先核对原任务。' }
    if (!creation.tasks.some(item => item.id === task.id)) creation.tasks.push(task)
  }
  creation.tasks.sort((a, b) => b.createdAt - a.createdAt)
}
export function initializeCreation() {
  if (creation.loaded && owner === activeOwner()) return Promise.resolve()
  if (booting) return booting
  const version = epoch, key = storeKey(), acceptedOwner = activeOwner()
  if (!acceptedOwner) return Promise.resolve()
  owner = acceptedOwner
  booting = (async () => {
    let saved: CreationTask[] | undefined
    if (typeof indexedDB !== 'undefined') {
      try { saved = await readTaskSnapshot(acceptedOwner) }
      catch {
        if (version === epoch) creation.storageError = '本地图库无法读取，原数据已保留。请关闭其他标签页后重试。'
        return
      }
    }
    const fallback = parse(localStorage.getItem(key + ':v2-fallback'))
    const stored = Array.isArray(fallback)
      ? [...new Map([...(saved || []), ...fallback.filter(validTask)].map(task => [task.id, task])).values()]
      : saved || parse(localStorage.getItem(key + ':fallback')) || parse(await storedValue(key))
    if (version !== epoch) return
    creation.tasks = Array.isArray(stored) ? stored.filter(validTask).filter(task => task.owner === owner).map(task => ({
      ...task, conversationId: validId(task.conversationId) ? task.conversationId : undefined,
      phase: ['attention', 'paused'].includes(task.phase) && creationRequestTimedOut(task) ? 'error' : task.phase === 'submitting' ? 'attention' : task.phase === 'running' ? 'paused' : task.phase,
      localSave: task.localSave?.state === 'saving' ? { ...task.localSave, state: 'failed', error: '上次下载准备已中断，可重试保存剩余文件。' } : task.localSave,
    })) : []
    if (saved === undefined) await importLegacy(version)
    if (version !== epoch) return
    creation.loaded = true
    creation.selectedId = creation.tasks[0]?.id || ''
    await persist()
    for (const task of creation.tasks.filter(item => item.upstreamId && item.phase === 'paused' && !item.customApiBase && (!item.legacy || item.tokenId != null)).slice(0, 4)) void resumeCreation(task)
  })().finally(() => { if (version === epoch) booting = undefined })
  return booting
}
function requestDownload(blob: Blob, task: CreationTask, index: number) {
  const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'text/markdown': 'md' }
  const link = document.createElement('a'), objectUrl = URL.createObjectURL(blob)
  link.href = objectUrl; link.download = `creation-${task.id}-${index + 1}.${extensions[blob.type.split(';')[0]!] || 'bin'}`
  document.body.appendChild(link)
  try { link.click() }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000) }
}
async function cacheDownloadedImage(task: CreationTask, index: number, source: string, blob: Blob) {
  if (task.kind !== 'image' || source.startsWith('studio-asset:')) return source
  const version = epoch
  try {
    const local = await saveTaskOriginal(task.owner, task.id, index, source, blob)
    const current = creation.tasks.find(item => item.id === task.id && item.owner === task.owner)
    if (local && version === epoch && task.owner === activeOwner() && current?.urls[index] === source) {
      current.urls[index] = local
      task.urls[index] = local
      return local
    }
  } catch {
    if (version === epoch && task.owner === activeOwner()) creation.storageError = '浏览器未能缓存原图，文件仍会下载；后续预览可能需要网络。'
  }
  return source
}
export function saveCreationLocally(value: CreationTask): Promise<void> {
  const task = canonicalCreationTask(value), key = `${task.owner}:${task.id}`
  const pending = downloads.get(key)
  if (pending) return pending.promise
  if (task.phase !== 'complete' || task.kind === 'text' || !task.urls.length) return Promise.reject(new Error('请先完成图片或视频生成。'))
  const version = epoch, controller = new AbortController(), urls = [...task.urls]
  const check = () => {
    controller.signal.throwIfAborted()
    if (version !== epoch || task.owner !== activeOwner()) throw new Error('账号已切换。')
    if (!creation.tasks.some(item => item.id === task.id && item.owner === task.owner) || urls.some((url, index) => task.urls[index] !== url)) throw new Error('生成记录已删除或原文件已变化。')
  }
  const promise = (async () => {
    let completed = Math.min(task.urls.length, Math.max(0, task.localSave?.completed || 0))
    try {
      task.localSave = { state: 'saving', completed }
      await persist(true); check()
      for (let index = completed; index < task.urls.length; index++) {
        const source = await readableMedia(task.urls[index]!, task.kind); check()
        const response = await fetch(source, { credentials: 'same-origin', signal: controller.signal })
        if (!response.ok) throw new Error('原文件下载失败，请重试保存。')
        const blob = await response.blob(); check()
        if (!blob.size || !blob.type.startsWith(`${task.kind}/`)) throw new Error('原文件格式无效，请重试保存。')
        urls[index] = await cacheDownloadedImage(task, index, urls[index]!, blob); check()
        // Claim the file durably before handing it to the browser, which cannot confirm completion.
        task.localSave = { state: 'saving', completed: index + 1, requestedAt: Date.now() }
        try { await persist(true); check() }
        catch (cause) { task.localSave.completed = completed; throw cause }
        try { requestDownload(blob, task, index) }
        catch (cause) { task.localSave.completed = completed; throw cause }
        completed = index + 1
      }
      task.localSave = { state: 'downloadRequested', completed, requestedAt: Date.now() }
      await persist(true)
    } catch (cause) {
      if (version === epoch && task.owner === activeOwner()) {
        task.localSave = { state: 'failed', completed, error: errorMessage(cause) }
        await persist()
      }
      throw cause
    }
  })().finally(() => { if (downloads.get(key)?.controller === controller) downloads.delete(key) })
  downloads.set(key, { controller, promise })
  return promise
}
async function autoDownloadCreation(task: CreationTask) {
  if (typeof document === 'undefined' || !mediaSettings.autoDownload || task.localSave) return
  try { await saveCreationLocally(task) }
  catch { /* Save errors stay on the result; generation has already completed. */ }
}
export async function downloadCreation(task: CreationTask, index = 0, signal?: AbortSignal, content?: string) {
  signal?.throwIfAborted()
  if (task.owner !== activeOwner()) throw new Error('账号已切换，请重新操作。')
  task = creation.tasks.find(current => current.id === task.id && current.owner === task.owner) || task
  const version = epoch
  const url = task.urls[index]
  const response = url ? await fetch(await readableMedia(url, task.kind), { credentials: 'same-origin', signal }) : undefined
  if (response && !response.ok) throw new Error('结果下载失败，请稍后重试。')
  const blob = response ? await response.blob() : new Blob([content ?? task.text], { type: 'text/markdown' })
  signal?.throwIfAborted()
  if (version !== epoch) throw new Error('账号已切换，请重新操作。')
  if (url && await cacheDownloadedImage(task, index, url, blob) !== url) await persist()
  signal?.throwIfAborted()
  if (version !== epoch) throw new Error('账号已切换，请重新操作。')
  requestDownload(blob, task, index)
}
const sharing = new Set<string>()
export async function publishCreation(task: CreationTask, title: string, destination: CreationDestination = 'community', text?: string, content?: string, details?: PublicationDetails) {
  const key = `${task.owner}:${task.id}`
  if (sharing.has(key)) throw new Error('这条作品正在提交，请稍后查看结果。')
  sharing.add(key)
  try { return await preparePublication(task, title, destination, text, content, details) }
  finally { sharing.delete(key) }
}
async function preparePublication(task: CreationTask, title: string, destination: CreationDestination, text?: string, content?: string, details?: PublicationDetails) {
  if (task.owner !== activeOwner() || task.phase !== 'complete') throw new Error('请先完成生成。')
  if (destination === 'source-comment' && (task.kind === 'video' || !task.sourceWorkId || !task.model)) throw new Error('图片或文本同款作品才能发送到源作品评论区。')
  const previous = task.publications?.[destination]
  if (previous?.work) return { work: previous.work }
  if (!previous && details && destination === 'community') {
    if (details.tagIds.length > 3 || new Set(details.tagIds).size !== details.tagIds.length) throw new Error('最多选择 3 个作品标签。')
    if (details.prompt.length > 100000 || details.license.length > 200 || details.sourceUrl.length > 2000) throw new Error('作品信息超过字数上限。')
    if (details.sourceUrl) {
      let url: URL
      try { url = new URL(details.sourceUrl) } catch { throw new Error('来源链接必须使用 http:// 或 https://。') }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('来源链接必须使用 http:// 或 https://，且不能包含登录信息。')
    }
    if (new Set(details.referenceIndices).size !== details.referenceIndices.length || details.referenceIndices.some(index => !Number.isInteger(index) || index < 0 || index >= task.references.length)) throw new Error('参考图选择无效，请重新选择。')
  }
  const version = epoch
  const checkOwner = () => { if (version !== epoch || task.owner !== activeOwner()) throw new Error('账号已切换，请重新操作。') }
  task.publications ??= {}
  const publication = task.publications[destination] ??= {
    ...(details && destination === 'community' ? { details: { ...details, tagIds: [...details.tagIds], referenceIndices: [...details.referenceIndices] } } : {}),
    title: title.trim().slice(0, 100),
    text: (text ?? (task.kind === 'text' ? content ?? task.text : task.prompt)).slice(0, 2500),
    ...(task.kind === 'text' ? { content: content ?? task.text, files: [] } : {}),
  }
  const files = task.kind === 'text' ? publication.files ??= [...(task.publicationFiles || [])] : task.publicationFiles ??= []
  await persist(true); checkOwner()
  async function uploadMedia(url: string, kind: CreationKind, name: string) {
    const response = await fetch(await readableMedia(url, kind), { credentials: 'same-origin' })
    if (!response.ok) throw new Error('生成文件读取失败，请稍后重试。')
    const blob = await response.blob()
    checkOwner()
    if (!blob.size || !blob.type.startsWith(`${kind}/`)) throw new Error('作品文件格式无效，请重新获取生成结果。')
    const extension = blob.type.split('/')[1]!.split(';')[0]!.replace(/[^a-z0-9]/g, '')
    const uploaded = await uploadFile(new File([blob], `${name}.${extension}`, { type: blob.type }))
    checkOwner()
    return uploaded.id
  }
  for (let index = files.length; index < task.urls.length; index++) {
    files.push(await uploadMedia(task.urls[index]!, task.kind, `creation-${index + 1}`))
    await persist(true); checkOwner()
  }
  if (task.kind === 'text' && !files.length) {
    const uploaded = await uploadFile(new File([publication.content ?? task.text], 'creation.md', { type: 'text/markdown' }))
    checkOwner(); files.push(uploaded.id); await persist(true); checkOwner()
  }
  if (destination === 'community') {
    task.publicationReferences ??= []
    const references = publication.details?.referenceIndices.map(index => task.references[index]!) ?? task.references
    for (let index = task.publicationReferences.length; index < references.length; index++) {
      task.publicationReferences.push(await uploadMedia(references[index]!.url, 'image', `reference-${index + 1}`))
      await persist(true); checkOwner()
    }
  }
  let result: { work: Work }
  try { result = await api<{ work: Work }>('/api/works', { method: 'POST', body: {
    title: publication.title, kind: task.kind === 'text' ? 'resource' : task.kind,
    body: publication.text, prompt: publication.details?.prompt ?? task.prompt,
    ...(publication.details ? { sourceUrl: publication.details.sourceUrl, license: publication.details.license } : {}),
    model: task.model, generation: { prompt: publication.details?.prompt ?? task.prompt, model: task.model, sourceWorkId: task.sourceWorkId, referenceFileIds: destination === 'community' ? task.publicationReferences || [] : [],
      parameters: task.legacy ? undefined : readRemixParameters({ version: 1, kind: task.kind, group: task.group,
        ...(task.kind === 'image' && usesGeminiImageChat(task.model) ? { protocol: task.request.protocol, n: task.request.n } : task.request) }) },
    fileIds: files, ...(publication.details ? { tagIds: publication.details.tagIds } : { tags: [] }), status: 'pending', destination,
    requestId: task.id, idempotencyKey: task.id, resultId: task.id,
  } })
  } catch (cause) {
    checkOwner()
    // A first-attempt validation rejection has no saved work; uncertain retries keep their original payload.
    if (!previous && publication.details && (cause as { status?: number }).status === 400) {
      delete task.publications[destination]
      task.publicationReferences = []
      await persist()
    }
    throw cause
  }
  checkOwner(); publication.work = result.work; await persist()
  return result
}
watch(() => activeOwner(), next => {
  epoch++
  for (const controller of controllers.values()) controller.abort()
  for (const download of downloads.values()) download.controller.abort()
  downloads.clear()
  controllers.clear(); owner = next; booting = undefined
  for (const key of Object.keys(localMedia)) { if (localMedia[key]?.startsWith('blob:')) URL.revokeObjectURL(localMedia[key]); delete localMedia[key] }
  mediaLoads.clear()
  creation.tasks = []; creation.selectedId = ''; creation.loaded = false
  creation.historyRevision++
  mediaSettings.loaded = false; mediaSettings.autoDownload = false; mediaSettings.autoSaveGallery = true
  if (next) {
    try {
      const saved = JSON.parse(localStorage.getItem(`octopus:user-${next}:native-media-settings`) || 'null')
      mediaSettings.autoDownload = saved?.autoDownload === true
      mediaSettings.autoSaveGallery = saved?.autoSaveGallery !== false
    }
    catch { /* Invalid preferences keep downloads opt-in. */ }
    mediaSettings.loaded = true
  }
  creation.models = []; creation.modelsError = ''; creation.modelsLoading = false; creation.modelsLoaded = false; creation.storageError = ''
  ++modelRevision; modelRead = undefined
  groupRead = undefined; groupSelection = undefined
  creation.groups = []; creation.selectedGroup = null; creation.modelTokenId = null
  creation.groupsLoading = false; creation.groupSwitching = false; creation.groupsError = ''
  if (next) void initializeCreation()
}, { immediate: true })
