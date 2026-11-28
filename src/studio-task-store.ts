// Cursor and thumbnail storage adapted from octopus_chat app/store/gallery.ts (MIT).
import type { CreationTask } from './native-studio'
import { waitForToolResult } from '../shared/studio/tool-result'

const databaseName = 'community-studio-media'
const initialized = new Map<string, Map<string, string>>()
const loadedForUpdate = new Map<string, Map<string, string>>()
const mediaIdentities = new Map<string, Map<string, string>>()
const deletedTaskIds = new Map<string, Set<string>>()
const writes = new Map<string, Promise<void>>()
interface CachedReads { revision: string; values: Map<string, Promise<unknown>> }
const cachedReads = new Map<string, CachedReads>()
const cachedStorageReads = new Map<string, CachedReads>()
let opening: Promise<IDBDatabase> | undefined
interface TaskRecord {
  owner: string
  id: string
  createdAt: number
  value: CreationTask
  mediaIdentity: string
}
interface AssetRecord { owner: string; key: string; taskId: string; blob?: Blob; identity: string; mime?: string }
interface PreparedAsset extends AssetRecord { blob: Blob }
interface PreviewRecord { owner: string; id: string; identity: string; blob: Blob; duration?: number }
interface TaskMetadata { owner: string; initialized?: boolean; revision?: string; storageRevision?: string }
export interface TaskSummary { total: number; mediaCount: number; models: string[] }
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
  summary?: boolean
}
function checkOwner(owner: string) {
  if (!owner || owner.length > 200 || /[\u0000-\u001f]/.test(owner)) throw new Error('账号数据空间无效。')
}
function database() {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('tasks')) {
        const tasks = db.createObjectStore('tasks', { keyPath: ['owner', 'id'] })
        tasks.createIndex('ownerCreatedAtId', ['owner', 'createdAt', 'id'])
      }
      if (!db.objectStoreNames.contains('previews')) db.createObjectStore('previews', { keyPath: ['owner', 'id'] })
      if (!db.objectStoreNames.contains('originals')) {
        const originals = db.createObjectStore('originals', { keyPath: ['owner', 'key'] })
        originals.createIndex('ownerTask', ['owner', 'taskId'])
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'owner' })
      db.createObjectStore('contents', { keyPath: ['owner', 'identity'] })
    }
    request.onerror = () => { opening = undefined; reject(request.error) }
    request.onblocked = () => { opening = undefined; reject(new Error('媒体数据库正在更新，请关闭其它旧页面后重试。')) }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); opening = undefined; cachedReads.clear(); cachedStorageReads.clear() }
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
function updateMetadata(transaction: IDBTransaction, owner: string, changed: boolean, options: { initialized?: boolean; storageOnly?: boolean } = {}) {
  const meta = transaction.objectStore('meta'), request = meta.get(owner)
  request.onsuccess = () => {
    const revision = changed ? crypto.randomUUID() : undefined
    meta.put({ ...(request.result as TaskMetadata | undefined), owner, ...(options.initialized ? { initialized: true } : {}),
      ...(revision ? { storageRevision: revision, ...(!options.storageOnly ? { revision } : {}) } : {}) } satisfies TaskMetadata)
  }
}
async function dataRevision(owner: string, storage: boolean) {
  const db = await database(), transaction = db.transaction('meta'), done = completed(transaction)
  const metadata = await read<TaskMetadata>(transaction.objectStore('meta'), owner)
  await done
  return (storage ? metadata?.storageRevision || metadata?.revision : metadata?.revision) || ''
}
async function cachedTaskRead<T>(owner: string, key: string, load: () => Promise<T>, storage = false): Promise<T> {
  checkOwner(owner)
  await writes.get(owner)?.catch(() => {})
  const revision = await dataRevision(owner, storage), caches = storage ? cachedStorageReads : cachedReads
  // Older tabs can still write metadata without a revision.
  if (!revision) return load()
  let cache = caches.get(owner)
  if (!cache || cache.revision !== revision) {
    cache = { revision, values: new Map() }; caches.set(owner, cache)
  }
  let pending = cache.values.get(key) as Promise<T> | undefined
  if (!pending) {
    const accepted = cache
    pending = load().then(async value => {
      if (revision !== await dataRevision(owner, storage)) return cachedTaskRead(owner, key, load, storage)
      return value
    }).catch(cause => { if (accepted.values.get(key) === pending) accepted.values.delete(key); throw cause })
    // Keep search text from accumulating an unbounded set of summaries.
    if (cache.values.size >= 20) cache.values.delete(cache.values.keys().next().value!)
    cache.values.set(key, pending)
  }
  return pending
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
function assetWriter(transaction: IDBTransaction) {
  const originals = transaction.objectStore('originals'), contents = transaction.objectStore('contents'), queued = new Set<string>()
  return ({ blob, ...asset }: PreparedAsset) => {
    originals.put({ ...asset, mime: blob.type } satisfies AssetRecord)
    const key = JSON.stringify([asset.owner, asset.identity])
    if (queued.has(key)) return
    queued.add(key)
    const request = contents.getKey([asset.owner, asset.identity])
    request.onsuccess = () => { if (request.result === undefined) contents.put({ owner: asset.owner, identity: asset.identity, blob }) }
  }
}
async function prepareTask(owner: string, raw: string, db: IDBDatabase, previousRaw?: string, previousIdentity?: string) {
  const task: CreationTask = JSON.parse(raw), assets: PreparedAsset[] = [], sources: string[] = []
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
    const transaction = db.transaction(['tasks', 'meta', 'originals', 'contents', 'previews'], 'readwrite'), done = completed(transaction)
    const records = transaction.objectStore('tasks'), writeAsset = assetWriter(transaction), previews = transaction.objectStore('previews')
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
        for (const asset of assets) writeAsset(asset)
      }
    }
    const changedRecords = removed.length > 0 || prepared.length > 0
    updateMetadata(transaction, owner, changedRecords, { initialized: true })
    await done
    if (changedRecords) { cachedReads.delete(owner); cachedStorageReads.delete(owner) }
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
    const db = await database(), transaction = db.transaction(['tasks', 'previews', 'meta'], 'readwrite'), done = completed(transaction)
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
        records.delete([owner, id]); clearTaskPreviews(previews, owner, id); updateMetadata(transaction, owner, true)
      }
    }
    try { await done } catch (cause) { throw failure || cause }
    cachedReads.delete(owner); cachedStorageReads.delete(owner)
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
  return cachedTaskRead(owner, 'storage', async () => {
    const db = await database(), transaction = db.transaction(['originals', 'contents', 'previews']), done = completed(transaction)
    let bytes = 0
    for (const name of ['originals', 'contents', 'previews']) {
      const request = transaction.objectStore(name).openCursor(IDBKeyRange.bound([owner, ''], [owner, '\uffff']))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        bytes += (cursor.value as AssetRecord | PreviewRecord).blob?.size || 0
        cursor.continue()
      }
    }
    await done
    return bytes
  }, true)
}
function taskFilters(options: TaskPageQuery) {
  const query = options.query?.trim().toLowerCase() || ''
  const base = (task: CreationTask) => task.purpose !== 'document' && (!options.kind || task.kind === options.kind) && (!options.gallery || galleryOutputIndexes(task).length > 0)
  const matches = (task: CreationTask) => base(task) && (!options.phase || task.phase === options.phase) && (!options.model || task.model === options.model)
    && (!options.since || task.createdAt >= options.since) && (!query || `${task.prompt} ${task.model}`.toLowerCase().includes(query))
  return { base, matches }
}
export async function getTaskSummary(owner: string, options: TaskPageQuery = {}): Promise<TaskSummary> {
  const accepted = { ...options, query: options.query?.trim().toLowerCase() || '' }, { base, matches } = taskFilters(accepted)
  const key = JSON.stringify([accepted.kind || '', Boolean(accepted.gallery), accepted.phase || '', accepted.model || '', accepted.since || 0, accepted.query])
  const summary = await cachedTaskRead(owner, key, async () => {
    const db = await database(), transaction = db.transaction('tasks'), done = completed(transaction)
    const models = new Set<string>()
    let total = 0, mediaCount = 0
    const request = transaction.objectStore('tasks').index('ownerCreatedAtId').openCursor(ownerRange(owner), 'prev')
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const task = (cursor.value as TaskRecord).value
      if (base(task)) models.add(task.model)
      if (matches(task)) { total++; mediaCount += galleryOutputIndexes(task).length }
      cursor.continue()
    }
    await done
    return { total, mediaCount, models: [...models].sort() }
  })
  return { ...summary, models: [...summary.models] }
}
export async function getTaskPage(owner: string, options: TaskPageQuery = {}) {
  checkOwner(owner)
  await writes.get(owner)?.catch(() => {})
  const db = await database(), transaction = db.transaction('tasks'), done = completed(transaction)
  const limit = Math.min(200, Math.max(1, Math.floor(options.limit || 60))), { matches } = taskFilters({ ...options })
  const tasks: CreationTask[] = []
  let more = false
  const range = options.after
    ? IDBKeyRange.bound([owner, 0, ''], [owner, options.after.createdAt, options.after.id], false, true)
    : ownerRange(owner)
  const page = transaction.objectStore('tasks').index('ownerCreatedAtId').openCursor(range, 'prev')
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
  const summary = options.summary === false ? { total: 0, mediaCount: 0, models: [] } : await getTaskSummary(owner, options)
  return { tasks, ...(more && last ? { after: { createdAt: last.createdAt, id: last.id } } : {}), ...summary }
}
// A read can queue behind a write transaction held by another tab even after the database opens.
async function readLocalMedia<T>(stores: string | string[], select: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
  const deadline = AbortSignal.timeout(60000)
  let transaction: IDBTransaction | undefined
  const cancel = () => transaction?.abort()
  deadline.addEventListener('abort', cancel, { once: true })
  try {
    const db = await waitForToolResult(database(), deadline)
    deadline.throwIfAborted()
    transaction = db.transaction(stores)
    const [value] = await waitForToolResult(Promise.all([select(transaction), completed(transaction)]), deadline)
    return value
  } catch (error) {
    if (deadline.aborted) throw new Error('浏览器读取本地图片超时，请关闭其它正在使用作品库的页面后重试。')
    throw error
  } finally { deadline.removeEventListener('abort', cancel) }
}
export async function readTaskAsset(owner: string, url: string, preview = false): Promise<Blob | undefined> {
  checkOwner(owner)
  const key = assetKey(url)
  if (!key) return
  if (preview && key[2] === '0') {
    const thumb = await readTaskPreview(owner, key[1]!, JSON.stringify(['image', url]))
    if (thumb) return thumb.blob
  }
  return readLocalMedia(['originals', 'contents'], async transaction => {
    const asset = await read<AssetRecord>(transaction.objectStore('originals'), [owner, `${key[1]}:${key[2]}`])
    const blob = asset?.blob || (asset ? (await read<{ blob: Blob }>(transaction.objectStore('contents'), [owner, asset.identity]))?.blob : undefined)
    return blob && asset?.mime && blob.type !== asset.mime ? blob.slice(0, blob.size, asset.mime) : blob
  })
}
export async function saveTaskOriginal(owner: string, id: string, index: number, source: string, blob: Blob, signal?: AbortSignal): Promise<string | undefined> {
  checkOwner(owner)
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id) || !Number.isInteger(index) || index < 0 || index > 9999
    || !/^image\/(?:png|jpeg|webp|gif|avif)$/.test(blob.type) || !blob.size || blob.size > 32 * 1024 ** 2) throw new Error('本地原图无效或超过 32 MB。')
  let saved: string | undefined
  const pending = (writes.get(owner) || Promise.resolve()).catch(() => {}).then(async () => {
    const hash = await identity(blob), db = await database()
    signal?.throwIfAborted()
    const transaction = db.transaction(['tasks', 'originals', 'contents', 'previews', 'meta'], 'readwrite'), done = completed(transaction)
    const records = transaction.objectStore('tasks'), originals = transaction.objectStore('originals'), writeAsset = assetWriter(transaction), previews = transaction.objectStore('previews')
    const asset = { owner, key: `${id}:${index}`, taskId: id, blob, identity: hash }
    const request = records.get([owner, id]), local = taskAssetUrl(id, index)
    request.onsuccess = () => {
      if (signal?.aborted) { transaction.abort(); return }
      const record = request.result as TaskRecord | undefined, task = record?.value
      if (!record || !task || task.kind !== 'image') return
      if (task.urls[index] === local) {
        const existing = originals.get([owner, `${id}:${index}`])
        existing.onsuccess = () => {
          if ((existing.result as AssetRecord | undefined)?.identity !== hash) return
          writeAsset(asset); updateMetadata(transaction, owner, true, { storageOnly: true }); saved = local
        }
        return
      }
      if (task.urls[index] !== source) return
      writeAsset(asset)
      task.urls[index] = local
      record.mediaIdentity = JSON.stringify([task.kind, task.urls])
      records.put(record); updateMetadata(transaction, owner, true)
      const preview = previews.get([owner, index ? `${id}:${index}` : id])
      preview.onsuccess = () => {
        const cached = preview.result as PreviewRecord | undefined
        if (cached?.identity === JSON.stringify(['image', source])) previews.put({ ...cached, identity: JSON.stringify(['image', local]) })
      }
      saved = local
    }
    await done
    if (saved) { cachedReads.delete(owner); cachedStorageReads.delete(owner) }
  })
  writes.set(owner, pending)
  await pending
  return saved
}
export async function saveTaskPreview(owner: string, id: string, mediaIdentity: string, blob: Blob, duration?: number, index = 0) {
  checkOwner(owner)
  if (!Number.isInteger(index) || index < 0) throw new Error('作品序号无效。')
  if (!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(blob.type) || !blob.size || blob.size > 4 * 1024 ** 2) throw new Error('作品缩略图无效或超过 4 MB。')
  const db = await database(), transaction = db.transaction(['tasks', 'previews', 'meta'], 'readwrite'), done = completed(transaction)
  let changed = false
  const request = transaction.objectStore('tasks').get([owner, id])
  request.onsuccess = () => {
    const task = (request.result as TaskRecord | undefined)?.value
    if (!task) return
    const base = JSON.stringify([task.kind, task.urls[index]])
    if ((task.kind === 'video' && task.poster ? JSON.stringify([base, task.poster]) : base) !== mediaIdentity) return
    transaction.objectStore('previews').put({ owner, id: index ? `${id}:${index}` : id, identity: mediaIdentity, blob,
      ...(Number.isFinite(duration) && duration! > 0 ? { duration } : {}) } satisfies PreviewRecord)
    updateMetadata(transaction, owner, true, { storageOnly: true }); changed = true
  }
  await done
  if (changed) cachedStorageReads.delete(owner)
}
export async function readTaskPreview(owner: string, id: string, mediaIdentity: string, index = 0): Promise<{ blob: Blob; duration?: number } | undefined> {
  checkOwner(owner)
  const value = await readLocalMedia('previews', transaction => read<PreviewRecord>(transaction.objectStore('previews'), [owner, index ? `${id}:${index}` : id]))
  return value?.identity === mediaIdentity ? { blob: value.blob, ...(value.duration === undefined ? {} : { duration: value.duration }) } : undefined
}
