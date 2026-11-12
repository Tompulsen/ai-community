// SPDX-License-Identifier: AGPL-3.0-only
import { reactive, watch } from 'vue'
import { api, errorMessage, notify, session, uploadFile } from './state'
import type { Work } from './data'

export type CreationKind = 'image' | 'video' | 'text'
export type CreationPhase = 'submitting' | 'running' | 'paused' | 'complete' | 'error' | 'attention'
export interface CreationModel { id: string; name?: string; kinds?: CreationKind[]; protocol?: 'openai' | 'sync' | 'async' }
export interface CreationTask {
  id: string
  owner: string
  kind: CreationKind
  model: string
  prompt: string
  createdAt: number
  phase: CreationPhase
  protocol: string
  upstreamId?: string
  tokenId?: number | null
  progress?: number
  urls: string[]
  text: string
  error?: string
  sourceWorkId?: string
  references: { name: string; url: string; id?: string }[]
  request: { size: string; aspect_ratio: string; n: number; duration: number }
  customApiBase?: string
  legacy?: boolean
}
export interface CreationInput {
  kind: CreationKind
  model: string
  prompt: string
  size: string
  aspect_ratio: string
  n: number
  duration: number
  protocol?: string
  sourceWorkId?: string
  references?: CreationTask['references']
}
export const creation = reactive({
  models: [] as CreationModel[], modelsLoading: false, modelsError: '',
  tasks: [] as CreationTask[], selectedId: '', loaded: false, storageError: '',
})
const controllers = new Map<string, AbortController>()
const localMedia = reactive<Record<string, string>>({})
const mediaLoads = new Map<string, Promise<string | undefined>>()
let owner = '', epoch = 0, booting: Promise<void> | undefined
let writes: Promise<unknown> = Promise.resolve()
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
const validUpstreamId = (value: unknown): value is string => validId(value) || typeof value === 'string' && /^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9_-]+$/.test(value)
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const storeKey = () => `octopus:user-${session.user?.accountId || session.user?.id}:native-creation-history`
const activeOwner = () => session.user ? `${session.user.accountId || session.user.id}:${session.user.id}` : ''

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
  const acceptedOwner = owner, key = storeKey(), snapshot = JSON.stringify(creation.tasks)
  writes = writes.catch(() => {}).then(async () => {
    if (acceptedOwner !== activeOwner()) return
    try {
      const db = await database()
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('keyval', 'readwrite')
        transaction.objectStore('keyval').put(snapshot, key)
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error) }
      })
      localStorage.removeItem(key + ':fallback')
    } catch {
      try { localStorage.setItem(key + ':fallback', snapshot) }
      catch {
        if (acceptedOwner === activeOwner()) creation.storageError = '本地存储空间不足，刷新前请下载生成结果。'
        if (required) throw new Error('无法保存任务记录，请释放浏览器存储空间后重新操作。')
      }
    }
  })
  await writes
}
function validTask(value: unknown): value is CreationTask {
  return record(value) && validId(value.id) && ['image', 'video', 'text'].includes(String(value.kind))
    && typeof value.owner === 'string' && typeof value.prompt === 'string' && typeof value.model === 'string'
    && Array.isArray(value.urls) && typeof value.text === 'string' && record(value.request)
    && Array.isArray(value.references) && value.references.every(file => record(file) && typeof file.url === 'string' && typeof file.name === 'string')
    && typeof value.protocol === 'string' && ['submitting', 'running', 'paused', 'complete', 'error', 'attention'].includes(String(value.phase))
}
function safeResultUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)) return value
  if (value.startsWith('/legacy-files/') || value.startsWith('/api/creation/')) return value
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href } catch { /* Invalid media is never rendered. */ }
}
function galleryDatabase(): Promise<IDBDatabase | undefined> {
  const id = session.user?.accountId
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
  if (url.startsWith('legacy-gallery:')) {
    const key = `${activeOwner()}:${url}:${preview ? 'preview' : 'original'}`
    if (!localMedia[key]) void gallerySource(url, preview)
    return localMedia[key]
  }
  if (url.startsWith('data:') || url.startsWith('/legacy-files/') || url.startsWith('/api/creation/')) return url
  return `/api/creation/media?${new URLSearchParams({ url, kind })}`
}
async function readableMedia(url: string, kind: CreationKind) {
  const source = url.startsWith('legacy-gallery:') ? await gallerySource(url, false) : mediaSource(url, false, kind)
  if (!source) throw new Error('生成文件暂时无法读取，任务记录已保留。')
  return source
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
  const status = String(data.status || data.state || '').toLowerCase()
  if (typeof data.tokenId === 'number') task.tokenId = data.tokenId
  if (typeof data.protocol === 'string' && ['openai', 'sync', 'async', 'legacy', 'plugin', 'seedance', 'gemini', 'xai'].includes(data.protocol)) task.protocol = data.protocol
  const urls = resultUrls(data, task), text = resultText(data)
  const id = data.upstreamId || data.task_id || data.id || data.taskId
  if (validUpstreamId(id) && (status || !urls.length && !text)) task.upstreamId = id
  const progress = typeof data.progress === 'string' ? Number(data.progress.replace('%', '')) : data.progress
  if (typeof progress === 'number' && Number.isFinite(progress)) task.progress = Math.max(0, Math.min(100, progress <= 1 && progress > 0 ? progress * 100 : progress))
  if (['save_failed', 'indeterminate', 'expired'].includes(status)) {
    task.phase = 'attention'; task.error = '任务结果暂时无法确认，记录已保留，请先核对使用记录，避免重复生成。'
    return true
  }
  if (['failed', 'cancelled', 'canceled', 'error'].includes(status)) {
    task.phase = 'error'
    task.error = typeof data.error === 'string' ? data.error : record(data.error) && typeof data.error.message === 'string' ? data.error.message : '上游任务未成功完成。'
    return true
  }
  if ((urls.length || text) && (!status || ['complete', 'completed', 'success', 'succeeded'].includes(status))) {
    task.urls = urls; task.text = text; task.phase = 'complete'; task.progress = 100; task.error = ''
    return true
  }
  if (['complete', 'completed', 'success', 'succeeded'].includes(status)) {
    task.phase = 'attention'; task.error = '上游任务已结束，但未返回可读取的结果，记录已保留。'
    return true
  }
  task.phase = task.upstreamId ? 'running' : 'attention'
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
  if (epoch === version && !controller.signal.aborted) { task.phase = 'paused'; task.error = '等待时间较长，任务记录已保留，可继续查询。'; await persist() }
}
export async function loadCreationModels() {
  if (creation.modelsLoading || !session.user) return
  const version = epoch
  creation.modelsLoading = true; creation.modelsError = ''
  try {
    const result = await api<{ items?: CreationModel[]; data?: CreationModel[] }>('/api/creation/models')
    if (version !== epoch) return
    creation.models = (result.items || result.data || []).filter(item => item && typeof item.id === 'string')
  } catch (error) { if (version === epoch) creation.modelsError = errorMessage(error) }
  finally { if (version === epoch) creation.modelsLoading = false }
}
export async function resumeCreation(task: CreationTask) {
  if (task.owner !== activeOwner() || !task.upstreamId || controllers.has(task.id)) return
  if (task.customApiBase) { task.phase = 'attention'; task.error = '此历史任务使用自定义接口，已保留原记录，请到原服务核对结果。'; return }
  if (task.legacy && task.tokenId == null) { task.phase = 'attention'; task.error = '此历史任务缺少原始令牌编号，已保留记录，请先核对原任务。'; await persist(); return }
  const controller = new AbortController(), version = epoch
  controllers.set(task.id, controller); task.phase = 'running'; task.error = ''
  try { await poll(task, controller, version) }
  catch (error) {
    if (epoch === version) { task.phase = 'paused'; task.error = controller.signal.aborted ? '已停止本页等待，上游任务可能仍在执行。' : errorMessage(error); await persist() }
  } finally { if (controllers.get(task.id) === controller) controllers.delete(task.id) }
}
export function stopCreation(task: CreationTask) {
  if (task.owner !== activeOwner()) return
  controllers.get(task.id)?.abort()
  task.phase = 'paused'; task.error = '已停止本页等待，上游任务可能仍在执行。'
  void persist()
}
export async function submitCreation(input: CreationInput) {
  await initializeCreation()
  if (!owner || owner !== activeOwner() || !input.model.trim() || !input.prompt.trim()) throw new Error('请选择模型并输入提示词。')
  const version = epoch
  const task: CreationTask = reactive({
    id: crypto.randomUUID(), owner, kind: input.kind, model: input.model, prompt: input.prompt.trim(),
    createdAt: Date.now(), phase: 'submitting', protocol: input.protocol || 'openai', urls: [], text: '',
    sourceWorkId: input.sourceWorkId, references: input.references || [],
    request: { size: input.size, aspect_ratio: input.aspect_ratio, n: input.n, duration: input.duration },
  })
  creation.tasks.unshift(task); creation.selectedId = task.id
  try { await persist(true) }
  catch (error) { task.phase = 'error'; task.error = errorMessage(error); throw error }
  if (epoch !== version || task.owner !== activeOwner()) throw new Error('账号已切换，请重新操作。')
  const controller = new AbortController()
  controllers.set(task.id, controller)
  try {
    const response = await fetch('/api/creation/generate', {
      method: 'POST', credentials: 'same-origin', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(session.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}) },
      body: JSON.stringify({ ...input, references: undefined, referenceUrls: task.references.map(file => file.url), requestId: task.id }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error((typeof data.error === 'string' ? data.error : data.error?.message) || data.message || `生成请求失败 (${response.status})`)
    }
    const tokenId = Number(response.headers.get('X-New-Api-Token'))
    if (Number.isSafeInteger(tokenId) && tokenId > 0) task.tokenId = tokenId
    const data = await response.json()
    if (epoch !== version || controller.signal.aborted) return task
    if (!applyResult(task, data)) await poll(task, controller, version)
  } catch (error) {
    if (epoch === version) {
      task.phase = task.upstreamId ? 'paused' : 'attention'
      task.error = controller.signal.aborted ? task.upstreamId ? '已停止本页等待，上游任务可能仍在执行。' : '已停止本页等待，上游可能已受理，请先核对使用记录。' : `${errorMessage(error)} 任务记录已保留，请勿自动重复提交。`
    }
  } finally {
    if (epoch === version) await persist()
    if (controllers.get(task.id) === controller) controllers.delete(task.id)
  }
  return task
}

async function importLegacy(version: number) {
  const id = session.user?.accountId
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
    const stored = parse(localStorage.getItem(key + ':fallback')) || parse(await storedValue(key))
    if (version !== epoch) return
    creation.tasks = Array.isArray(stored) ? stored.filter(validTask).filter(task => task.owner === owner).map(task => ({
      ...task, phase: task.phase === 'submitting' ? 'attention' : task.phase === 'running' ? 'paused' : task.phase,
    })) : []
    await importLegacy(version)
    if (version !== epoch) return
    creation.loaded = true
    creation.selectedId = creation.tasks[0]?.id || ''
    await persist()
    for (const task of creation.tasks.filter(item => item.upstreamId && item.phase === 'paused' && !item.customApiBase && (!item.legacy || item.tokenId != null)).slice(0, 4)) void resumeCreation(task)
  })().finally(() => { if (version === epoch) booting = undefined })
  return booting
}
export async function downloadCreation(task: CreationTask, index = 0) {
  if (task.owner !== activeOwner()) throw new Error('账号已切换，请重新操作。')
  const version = epoch
  const url = task.urls[index]
  const response = url ? await fetch(await readableMedia(url, task.kind), { credentials: 'same-origin' }) : undefined
  if (response && !response.ok) throw new Error('结果下载失败，请稍后重试。')
  const blob = response ? await response.blob() : new Blob([task.text], { type: 'text/markdown' })
  if (version !== epoch) throw new Error('账号已切换，请重新操作。')
  const link = document.createElement('a'), objectUrl = URL.createObjectURL(blob)
  link.href = objectUrl; link.download = `creation-${task.id}-${index + 1}.${task.kind === 'video' ? 'mp4' : task.kind === 'image' ? 'png' : 'md'}`
  link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
export async function publishCreation(task: CreationTask, title: string) {
  if (task.owner !== activeOwner() || task.phase !== 'complete') throw new Error('请先完成生成。')
  const files: { id: string; role?: string }[] = []
  const version = epoch
  for (let index = 0; index < task.urls.length; index++) {
    const response = await fetch(await readableMedia(task.urls[index]!, task.kind), { credentials: 'same-origin' })
    if (!response.ok) throw new Error('生成文件读取失败，请稍后重试。')
    const blob = await response.blob()
    if (version !== epoch) throw new Error('账号已切换，请重新操作。')
    const uploaded = await uploadFile(new File([blob], `creation-${index + 1}.${task.kind === 'video' ? 'mp4' : 'png'}`, { type: blob.type || (task.kind === 'video' ? 'video/mp4' : 'image/png') }))
    if (version !== epoch) throw new Error('账号已切换，请重新操作。')
    files.push({ id: uploaded.id })
  }
  if (task.kind === 'text') {
    const uploaded = await uploadFile(new File([task.text], 'creation.md', { type: 'text/markdown' }))
    files.push({ id: uploaded.id })
  }
  if (version !== epoch) throw new Error('账号已切换，请重新操作。')
  return api<{ work: Work }>('/api/works', { method: 'POST', body: {
    title: title.trim().slice(0, 100), kind: task.kind === 'text' ? 'resource' : task.kind,
    text: task.prompt.slice(0, 2500), body: task.kind === 'text' ? task.text : '', prompt: task.prompt,
    model: task.model, generation: { prompt: task.prompt, model: task.model, sourceWorkId: task.sourceWorkId, referenceFileIds: task.references.flatMap(file => file.id ? [file.id] : []) },
    fileIds: files.map(file => file.id), tags: [], status: 'pending', destination: 'community',
    requestId: task.id, idempotencyKey: task.id,
  } })
}
watch(() => activeOwner(), next => {
  epoch++
  for (const controller of controllers.values()) controller.abort()
  controllers.clear(); owner = next; booting = undefined
  for (const key of Object.keys(localMedia)) { if (localMedia[key]?.startsWith('blob:')) URL.revokeObjectURL(localMedia[key]); delete localMedia[key] }
  mediaLoads.clear()
  creation.tasks = []; creation.selectedId = ''; creation.loaded = false
  creation.models = []; creation.modelsError = ''; creation.modelsLoading = false; creation.storageError = ''
  if (next) void initializeCreation()
}, { immediate: true })
