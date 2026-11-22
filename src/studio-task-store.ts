// Cursor and thumbnail storage adapted from octopus_chat app/store/gallery.ts (MIT).
import type { CreationTask } from './native-studio'

const databaseName = 'community-studio-media'
const initialized = new Map<string, Map<string, string>>()
const loadedForUpdate = new Map<string, Map<string, string>>()
const mediaIdentities = new Map<string, Map<string, string>>()
const deletedTaskIds = new Map<string, Set<string>>()
const writes = new Map<string, Promise<void>>()
let opening: Promise<IDBDatabase> | undefined
interface TaskRecord {
  owner: string
  id: string
  createdAt: number
  value: CreationTask
  mediaIdentity: string
}
interface AssetRecord { owner: string; key: string; taskId: string; blob: Blob; identity: string }
interface PreviewRecord { owner: string; id: string; identity: string; blob: Blob; duration?: number }
export interface TaskPageCursor { createdAt: number; id: string }
export interface TaskPageQuery {
  kind?: string
  phase?: string
  gallery?: boolean
  query?: string
  model?: string
  since?: number
  after?: TaskPageCursor
  limit?: number
}
function checkOwner(owner: string) {
  if (!owner || owner.length > 200 || /[\u0000-\u001f]/.test(owner)) throw new Error('账号数据空间无效。')
}
function database() {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      const tasks = db.createObjectStore('tasks', { keyPath: ['owner', 'id'] })
      tasks.createIndex('ownerCreatedAtId', ['owner', 'createdAt', 'id'])
      db.createObjectStore('previews', { keyPath: ['owner', 'id'] })
      const originals = db.createObjectStore('originals', { keyPath: ['owner', 'key'] })
      originals.createIndex('ownerTask', ['owner', 'taskId'])
      db.createObjectStore('meta', { keyPath: 'owner' })
    }
    request.onerror = () => { opening = undefined; reject(request.error) }
    request.onblocked = () => { opening = undefined; reject(new Error('媒体数据库正在更新，请关闭其它旧页面后重试。')) }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); opening = undefined }
      resolve(db)
    }
  })
  return opening
}
function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('媒体数据未能保存。'))
  })
}
function read<T>(store: IDBObjectStore, key: IDBValidKey) {
  return new Promise<T | undefined>((resolve, reject) => {
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  })
}
function ownerRange(owner: string) {
  return IDBKeyRange.bound([owner, 0, ''], [owner, Number.MAX_SAFE_INTEGER, '\uffff'])
}
function checkTask(task: CreationTask, owner: string) {
  if (task.owner !== owner || !/^[A-Za-z0-9_-]{1,200}$/.test(task.id) || !Number.isFinite(task.createdAt)
    || task.createdAt < 0 || task.createdAt > Number.MAX_SAFE_INTEGER) throw new Error('生成记录的账号、编号或时间无效，原记录已保留。')
}
export function captureTaskSnapshot(owner: string, tasks: CreationTask[]): ReadonlyMap<string, string> {
  checkOwner(owner)
  return new Map(tasks.map(task => { checkTask(task, owner); return [task.id, JSON.stringify(task)] }))
}
export function taskAssetUrl(taskId: string, index: number | 'preview') {
  return `studio-asset:${taskId}:${index}`
}
function assetKey(url: string) {
  return /^studio-asset:([A-Za-z0-9_-]{1,200}):(\d{1,4}|preview)$/.exec(url)
}
export async function imageBlob(url: string) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url)
  if (!match) return
  const raw = atob(match[2]!.replace(/[\r\n]/g, '')), bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
  return new Blob([bytes], { type: match[1] })
}
async function identity(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function prepareTask(owner: string, raw: string, db: IDBDatabase, previousRaw?: string, previousIdentity?: string) {
  const task: CreationTask = JSON.parse(raw), assets: AssetRecord[] = [], sources: string[] = []
  checkTask(task, owner)
  const previous: CreationTask | undefined = previousRaw ? JSON.parse(previousRaw) : undefined
  const unchangedUrls = task.urls.map((url, index) => task.kind === previous?.kind && url === previous.urls[index])
  const preserveMedia = !!previous && task.kind === previous.kind && task.preview === previous.preview && task.urls.length === previous.urls.length
    && task.urls.every((url, index) => url === previous.urls[index])
  if (preserveMedia) {
    return { record: { owner, id: task.id, createdAt: task.createdAt, value: task, mediaIdentity: previousIdentity || '' } satisfies TaskRecord,
      assets, previous, preserveMedia, unchangedUrls }
  }
  for (const [index, url] of task.urls.entries()) {
    const blob = await imageBlob(url)
    if (blob) {
      const hash = await identity(blob), key = `${task.id}:${index}`
      assets.push({ owner, key, taskId: task.id, blob, identity: hash })
      task.urls[index] = taskAssetUrl(task.id, index); sources.push(hash)
    } else {
      const key = assetKey(url)
      const original = key ? await read<AssetRecord>(db.transaction('originals').objectStore('originals'), [owner, `${key[1]}:${key[2]}`]) : undefined
      sources.push(original?.identity || url)
    }
  }
  if (task.preview) {
    const blob = await imageBlob(task.preview)
    if (blob) {
      assets.push({ owner, key: `${task.id}:preview`, taskId: task.id, blob, identity: await identity(blob) })
      task.preview = taskAssetUrl(task.id, 'preview')
    }
  }
  return { record: { owner, id: task.id, createdAt: task.createdAt, value: task, mediaIdentity: JSON.stringify([task.kind, sources]) } satisfies TaskRecord,
    assets, previous, preserveMedia, unchangedUrls }
}
export async function readTaskSnapshot(owner: string): Promise<CreationTask[] | undefined> {
  checkOwner(owner)
  await writes.get(owner)?.catch(() => {})
  const db = await database(), transaction = db.transaction(['tasks', 'meta']), done = completed(transaction)
  const marker = read<{ owner: string; initialized: boolean }>(transaction.objectStore('meta'), owner)
  const tasks: CreationTask[] = [], identities = new Map<string, string>()
  const request = transaction.objectStore('tasks').index('ownerCreatedAtId').openCursor(ownerRange(owner), 'prev')
  request.onsuccess = () => {
    const cursor = request.result
    if (cursor) {
      const record = cursor.value as TaskRecord
      tasks.push(record.value); identities.set(record.id, record.mediaIdentity); cursor.continue()
    }
  }
  const metadata = await marker
  await done
  initialized.set(owner, new Map(tasks.map(task => [task.id, JSON.stringify(task)])))
  loadedForUpdate.delete(owner)
  mediaIdentities.set(owner, identities)
  return metadata?.initialized ? tasks : undefined
}
export function saveTaskSnapshot(owner: string, tasks: CreationTask[]): Promise<void> {
  return saveCapturedTaskSnapshot(owner, captureTaskSnapshot(owner, tasks))
}
export async function readTaskForUpdate(owner: string, id: string): Promise<CreationTask | undefined> {
  checkOwner(owner)
  await writes.get(owner)?.catch(() => {})
  if (deletedTaskIds.get(owner)?.has(id)) return
  const db = await database(), transaction = db.transaction('tasks'), done = completed(transaction)
  const record = await read<TaskRecord>(transaction.objectStore('tasks'), [owner, id])
  await done
  if (!record) return
  // A single-record read must not expand an older full snapshot's deletion scope.
  const previous = loadedForUpdate.get(owner) || new Map<string, string>()
  previous.set(id, JSON.stringify(record.value)); loadedForUpdate.set(owner, previous)
  return record.value
}
function clearTaskPreviews(store: IDBObjectStore, owner: string, id: string) {
  store.delete([owner, id])
  store.delete(IDBKeyRange.bound([owner, `${id}:`], [owner, `${id}:\uffff`]))
}
export function saveCapturedTaskSnapshot(owner: string, captured: ReadonlyMap<string, string>): Promise<void> {
  checkOwner(owner)
  const values = new Map(captured)
  const pending = (writes.get(owner) || Promise.resolve()).catch(() => {}).then(async () => {
    for (const id of deletedTaskIds.get(owner) || []) values.delete(id)
    const previous = initialized.get(owner) || new Map<string, string>()
    const removed = [...previous.keys()].filter(id => !values.has(id))
    const changed = [...values].filter(([id, value]) => previous.get(id) !== value)
    const db = await database()
    const prepared: Awaited<ReturnType<typeof prepareTask>>[] = []
    for (const [id, raw] of changed) {
      const item = await prepareTask(owner, raw, db, previous.get(id) ?? loadedForUpdate.get(owner)?.get(id), mediaIdentities.get(owner)?.get(id))
      if (item.record.id !== id) throw new Error('生成记录编号与快照不一致，原记录已保留。')
      prepared.push(item)
    }
    const transaction = db.transaction(['tasks', 'meta', 'originals', 'previews'], 'readwrite'), done = completed(transaction)
    const records = transaction.objectStore('tasks'), originals = transaction.objectStore('originals'), previews = transaction.objectStore('previews')
    for (const id of removed) {
      records.delete([owner, id]); clearTaskPreviews(previews, owner, id)
      // Other turns can still reference this task's original image.
    }
    for (const { record, assets, previous, preserveMedia, unchangedUrls } of prepared) {
      const request = records.get([owner, record.id])
      request.onsuccess = () => {
        const stored = request.result as TaskRecord | undefined
        if (previous && !stored) return
        if (previous && stored) {
          // Apply only the caller's edits to the transaction's latest record.
          const merged = { ...stored.value }
          for (const key of Object.keys({ ...previous, ...record.value }) as (keyof CreationTask)[]) {
            if (!['kind', 'urls', 'preview'].includes(key) && JSON.stringify(previous[key]) !== JSON.stringify(record.value[key]))
              Object.assign(merged, { [key]: record.value[key] })
          }
          if (preserveMedia) record.mediaIdentity = stored.mediaIdentity
          else {
            const urls = record.value.urls.map((url, index) => unchangedUrls[index] ? stored.value.urls[index] ?? url : url)
            Object.assign(merged, { kind: record.value.kind, urls,
              preview: previous.preview === record.value.preview ? stored.value.preview : record.value.preview })
            if (urls.some((url, index) => url !== record.value.urls[index])) record.mediaIdentity = JSON.stringify([merged.kind, urls])
          }
          record.value = merged; record.createdAt = merged.createdAt
        }
        if (stored && stored.mediaIdentity !== record.mediaIdentity) clearTaskPreviews(previews, owner, record.id)
        records.put(record)
        for (const asset of assets) originals.put(asset)
      }
    }
    transaction.objectStore('meta').put({ owner, initialized: true })
    await done
    initialized.set(owner, values)
    for (const id of values.keys()) loadedForUpdate.get(owner)?.delete(id)
    const identities = new Map(mediaIdentities.get(owner))
    for (const id of removed) identities.delete(id)
    for (const { record } of prepared) identities.set(record.id, record.mediaIdentity)
    mediaIdentities.set(owner, identities)
  })
  writes.set(owner, pending)
  return pending
}
export function deleteTaskRecords(owner: string, ids: readonly string[]): Promise<void> {
  checkOwner(owner)
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id))) return Promise.reject(new Error('生成记录编号无效。'))
  const selected = [...new Set(ids)]
  if (!selected.length) return Promise.resolve()
  const pending = (writes.get(owner) || Promise.resolve()).catch(() => {}).then(async () => {
    const db = await database(), transaction = db.transaction(['tasks', 'previews'], 'readwrite'), done = completed(transaction)
    const records = transaction.objectStore('tasks'), previews = transaction.objectStore('previews')
    let failure: Error | undefined
    for (const id of selected) {
      const request = records.get([owner, id])
      request.onsuccess = () => {
        const stored = request.result as TaskRecord | undefined
        if (!stored) return
        if (!['complete', 'error'].includes(stored.value.phase)) {
          failure = new Error('进行中或需要核对的任务请保留，查询完成后再删除。')
          transaction.abort()
          return
        }
        records.delete([owner, id]); clearTaskPreviews(previews, owner, id)
      }
    }
    try { await done } catch (cause) { throw failure || cause }
    const deleted = deletedTaskIds.get(owner) || new Set<string>()
    for (const id of selected) { deleted.add(id); initialized.get(owner)?.delete(id); loadedForUpdate.get(owner)?.delete(id); mediaIdentities.get(owner)?.delete(id) }
    deletedTaskIds.set(owner, deleted)
  })
  writes.set(owner, pending)
  return pending
}
export function galleryOutputIndexes(task: CreationTask) {
  if (task.galleryHidden || task.kind === 'text' || task.phase !== 'complete') return []
  const hidden = new Set(Array.isArray(task.galleryHiddenIndices) ? task.galleryHiddenIndices : [])
  return task.urls.map((_, index) => index).filter(index => !hidden.has(index))
}
export async function getTaskStorageSize(owner: string) {
  checkOwner(owner)
  const db = await database(), transaction = db.transaction(['originals', 'previews']), done = completed(transaction)
  let bytes = 0
  for (const name of ['originals', 'previews']) {
    const request = transaction.objectStore(name).openCursor(IDBKeyRange.bound([owner, ''], [owner, '\uffff']))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      bytes += (cursor.value as AssetRecord | PreviewRecord).blob.size
      cursor.continue()
    }
  }
  await done
  return bytes
}
export async function getTaskPage(owner: string, options: TaskPageQuery = {}) {
  checkOwner(owner)
  await writes.get(owner)?.catch(() => {})
  const db = await database(), transaction = db.transaction('tasks'), done = completed(transaction)
  const limit = Math.min(200, Math.max(1, Math.floor(options.limit || 60))), query = options.query?.trim().toLowerCase() || ''
  const tasks: CreationTask[] = [], models = new Set<string>()
  let total = 0, mediaCount = 0, more = false
  const base = (task: CreationTask) => (!options.kind || task.kind === options.kind) && (!options.gallery || galleryOutputIndexes(task).length > 0)
  const matches = (task: CreationTask) => base(task) && (!options.phase || task.phase === options.phase) && (!options.model || task.model === options.model)
    && (!options.since || task.createdAt >= options.since) && (!query || `${task.prompt} ${task.model}`.toLowerCase().includes(query))
  const index = transaction.objectStore('tasks').index('ownerCreatedAtId')
  const summary = index.openCursor(ownerRange(owner), 'prev')
  summary.onsuccess = () => {
    const cursor = summary.result
    if (!cursor) return
    const task = (cursor.value as TaskRecord).value
    if (base(task)) models.add(task.model)
    if (matches(task)) { total++; mediaCount += galleryOutputIndexes(task).length }
    cursor.continue()
  }
  const range = options.after
    ? IDBKeyRange.bound([owner, 0, ''], [owner, options.after.createdAt, options.after.id], false, true)
    : ownerRange(owner)
  const page = index.openCursor(range, 'prev')
  page.onsuccess = () => {
    const cursor = page.result
    if (!cursor) return
    const task = (cursor.value as TaskRecord).value
    if (matches(task)) {
      if (tasks.length >= limit) { more = true; return }
      tasks.push(task)
    }
    cursor.continue()
  }
  await done
  const last = tasks.at(-1)
  return { tasks, ...(more && last ? { after: { createdAt: last.createdAt, id: last.id } } : {}), total, mediaCount, models: [...models].sort() }
}
export async function readTaskAsset(owner: string, url: string, preview = false): Promise<Blob | undefined> {
  checkOwner(owner)
  const key = assetKey(url)
  if (!key) return
  const db = await database()
  if (preview && key[2] === '0') {
    const thumb = await readTaskPreview(owner, key[1]!, JSON.stringify(['image', url]))
    if (thumb) return thumb.blob
  }
  return (await read<AssetRecord>(db.transaction('originals').objectStore('originals'), [owner, `${key[1]}:${key[2]}`]))?.blob
}
export async function saveTaskOriginal(owner: string, id: string, index: number, source: string, blob: Blob, signal?: AbortSignal): Promise<string | undefined> {
  checkOwner(owner)
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !Number.isInteger(index) || index < 0 || index > 9999
    || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(blob.type) || !blob.size || blob.size > 32 * 1024 ** 2) throw new Error('本地原图无效或超过 32 MB。')
  let saved: string | undefined
  const pending = (writes.get(owner) || Promise.resolve()).catch(() => {}).then(async () => {
    const hash = await identity(blob), db = await database()
    signal?.throwIfAborted()
    const transaction = db.transaction(['tasks', 'originals', 'previews'], 'readwrite'), done = completed(transaction)
    const records = transaction.objectStore('tasks'), originals = transaction.objectStore('originals'), previews = transaction.objectStore('previews')
    const request = records.get([owner, id]), local = taskAssetUrl(id, index)
    request.onsuccess = () => {
      if (signal?.aborted) { transaction.abort(); return }
      const record = request.result as TaskRecord | undefined, task = record?.value
      if (!record || !task || task.kind !== 'image') return
      if (task.urls[index] === local) {
        const existing = originals.get([owner, `${id}:${index}`])
        existing.onsuccess = () => { if ((existing.result as AssetRecord | undefined)?.identity === hash) saved = local }
        return
      }
      if (task.urls[index] !== source) return
      originals.put({ owner, key: `${id}:${index}`, taskId: id, blob, identity: hash } satisfies AssetRecord)
      task.urls[index] = local
      record.mediaIdentity = JSON.stringify([task.kind, task.urls])
      records.put(record)
      const preview = previews.get([owner, index ? `${id}:${index}` : id])
      preview.onsuccess = () => {
        const cached = preview.result as PreviewRecord | undefined
        if (cached?.identity === JSON.stringify(['image', source])) previews.put({ ...cached, identity: JSON.stringify(['image', local]) })
      }
      saved = local
    }
    await done
  })
  writes.set(owner, pending)
  await pending
  return saved
}
export async function saveTaskPreview(owner: string, id: string, mediaIdentity: string, blob: Blob, duration?: number, index = 0) {
  checkOwner(owner)
  if (!Number.isInteger(index) || index < 0) throw new Error('作品序号无效。')
  if (!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(blob.type) || !blob.size || blob.size > 4 * 1024 ** 2) throw new Error('作品缩略图无效或超过 4 MB。')
  const db = await database(), transaction = db.transaction(['tasks', 'previews'], 'readwrite'), done = completed(transaction)
  const request = transaction.objectStore('tasks').get([owner, id])
  request.onsuccess = () => {
    const task = (request.result as TaskRecord | undefined)?.value
    if (!task || JSON.stringify([task.kind, task.urls[index]]) !== mediaIdentity) return
    transaction.objectStore('previews').put({ owner, id: index ? `${id}:${index}` : id, identity: mediaIdentity, blob,
      ...(Number.isFinite(duration) && duration! > 0 ? { duration } : {}) } satisfies PreviewRecord)
  }
  await done
}
export async function readTaskPreview(owner: string, id: string, mediaIdentity: string, index = 0): Promise<{ blob: Blob; duration?: number } | undefined> {
  checkOwner(owner)
  const db = await database()
  const value = await read<PreviewRecord>(db.transaction('previews').objectStore('previews'), [owner, index ? `${id}:${index}` : id])
  return value?.identity === mediaIdentity ? { blob: value.blob, ...(value.duration === undefined ? {} : { duration: value.duration }) } : undefined
}
