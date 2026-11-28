// This module deliberately has no app, session, chat or media-loader dependencies.
export type StoragePressure = 'unknown' | 'normal' | 'mild' | 'strong'
export interface BrowserStorageEstimate {
  usage: number | null
  quota: number | null
  measuredAt: number
  pressure: StoragePressure
}
export const browserStorageChangedEvent = 'community:storage-changed'
const databaseName = 'community-studio-media'
const timeoutMs = 5000
let cachedEstimate: BrowserStorageEstimate | undefined
let pendingEstimate: Promise<BrowserStorageEstimate> | undefined
let writeFailure: 'quota' | 'write' | null = null

function bytes(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
export function storagePressure(usage: number | null, quota: number | null): StoragePressure {
  if (bytes(usage) === null) return 'unknown'
  if (usage! >= 1024 ** 3 || (quota !== null && quota > 0 && usage! / quota >= 0.9)) return 'strong'
  return usage! >= 500 * 1024 ** 2 ? 'mild' : 'normal'
}
export function formatStorageBytes(value: number | null) {
  if (bytes(value) === null) return '暂无法读取'
  if (value! >= 1024 ** 3) return `${(value! / 1024 ** 3).toFixed(2)} GiB`
  if (value! >= 1024 ** 2) return `${(value! / 1024 ** 2).toFixed(1)} MiB`
  return `${Math.round(value! / 1024)} KiB`
}
export function refreshBrowserStorage(force = false): Promise<BrowserStorageEstimate> {
  if (pendingEstimate) return pendingEstimate
  if (!force && cachedEstimate && Date.now() - cachedEstimate.measuredAt < 30_000) return Promise.resolve(cachedEstimate)
  pendingEstimate = new Promise<BrowserStorageEstimate>(resolve => {
    let finished = false
    const finish = (estimate?: StorageEstimate) => {
      if (finished) return
      finished = true; clearTimeout(timer)
      const usage = bytes(estimate?.usage), rawQuota = bytes(estimate?.quota)
      const quota = rawQuota && rawQuota > 0 ? rawQuota : null
      cachedEstimate = { usage, quota, pressure: storagePressure(usage, quota), measuredAt: Date.now() }
      resolve(cachedEstimate)
    }
    const timer = setTimeout(() => finish(), timeoutMs)
    try {
      const storage = globalThis.navigator?.storage
      if (!storage?.estimate) finish()
      else void storage.estimate().then(finish, () => finish())
    } catch { finish() }
  }).finally(() => { pendingEstimate = undefined })
  return pendingEstimate
}
export function notifyBrowserStorageChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(browserStorageChangedEvent))
}
export function browserStorageWriteFailure() { return writeFailure }
export function clearBrowserStorageFailure() {
  writeFailure = null
  notifyBrowserStorageChanged()
}
export function notifyBrowserStorageFailure(error: unknown) {
  writeFailure = error instanceof Error && error.name === 'QuotaExceededError' ? 'quota' : 'write'
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(browserStorageChangedEvent))
}

function validOwner(owner: unknown): owner is string {
  return typeof owner === 'string' && owner.length > 0 && owner.length <= 200 && !/[\u0000-\u001f]/.test(owner)
}
function ownerRange(owner: string) {
  // All suffix keys in this schema are strings, which sort before array keys.
  return IDBKeyRange.bound([owner, ''], [owner, []], false, true)
}
function openExistingDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('此浏览器暂不支持读取本地媒体存储。')); return }
    let finished = false, absent = false
    const timer = setTimeout(() => finish(undefined, new Error('本地存储读取超时，请关闭其他社区标签页后重试。')), timeoutMs)
    const finish = (db?: IDBDatabase | null, error?: Error) => {
      if (finished) { db?.close(); return }
      finished = true; clearTimeout(timer)
      if (error) reject(error)
      else resolve(db || null)
    }
    try {
      const request = indexedDB.open(databaseName)
      // Opening an absent database would create one; abort instead of changing its schema.
      request.onupgradeneeded = () => { absent = true; request.transaction?.abort() }
      request.onerror = () => absent ? finish(null) : finish(undefined, new Error('暂时无法读取本地媒体存储。'))
      request.onblocked = () => finish(undefined, new Error('本地存储正在更新，请关闭其他社区标签页后重试。'))
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => db.close()
        finish(db)
      }
    } catch { finish(undefined, new Error('浏览器已限制访问本地媒体存储。')) }
  })
}
function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { transaction.abort() } catch { /* The transaction may already have finished. */ }
      reject(new Error('本地存储操作超时，请稍后重试。'))
    }, timeoutMs)
    transaction.oncomplete = () => { clearTimeout(timer); resolve() }
    transaction.onabort = () => { clearTimeout(timer); reject(new Error('本地存储操作未完成，原图和聊天未被清理。')) }
    transaction.onerror = () => { /* onabort supplies the final failure. */ }
  })
}
const countStores = ['tasks', 'originals', 'previews', 'contents'] as const
export type MediaStorageCounts = Record<typeof countStores[number], number | null>
export interface MediaStorageInventory {
  owners: string[]
  counts: MediaStorageCounts
  databaseExists: boolean
  canClean: boolean
}
export async function readMediaStorageInventory(owner?: string): Promise<MediaStorageInventory> {
  if (owner !== undefined && !validOwner(owner)) throw new Error('请选择有效的本地账号。')
  const db = await openExistingDatabase()
  if (!db) return { owners: [], counts: { tasks: 0, originals: 0, previews: 0, contents: 0 }, databaseExists: false, canClean: false }
  try {
    const names = [...countStores, 'meta'].filter(name => db.objectStoreNames.contains(name))
    if (!names.length) throw new Error('本地媒体存储结构暂不可读，请保留数据并联系支持。')
    const transaction = db.transaction(names, 'readonly'), done = transactionDone(transaction)
    const owners = new Set<string>(), counts: MediaStorageCounts = { tasks: null, originals: null, previews: null, contents: null }
    for (const name of names) {
      const store = transaction.objectStore(name)
      if (name !== 'meta') {
        const count = store.count(owner ? ownerRange(owner) : undefined)
        count.onsuccess = () => { counts[name as keyof MediaStorageCounts] = count.result }
      }
      const request = store.openKeyCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const key = cursor.key, candidate = Array.isArray(key) ? key[0] : key
        if (validOwner(candidate)) owners.add(candidate)
        // Jump to the next account without deserializing task bodies or Blob values.
        if (Array.isArray(key) && typeof key[0] === 'string' && typeof key[1] === 'string') cursor.continue([key[0], []])
        else cursor.continue()
      }
    }
    await done
    return { owners: [...owners].sort(), counts, databaseExists: true, canClean: names.includes('previews') && names.includes('meta') }
  } finally { db.close() }
}
export async function clearOwnerThumbnailCache(owner: string): Promise<number> {
  if (!validOwner(owner)) throw new Error('请选择有效的本地账号。')
  const db = await openExistingDatabase()
  if (!db) return 0
  try {
    if (!db.objectStoreNames.contains('previews') || !db.objectStoreNames.contains('meta')) throw new Error('当前存储结构不支持安全清理，请保留数据并联系支持。')
    const transaction = db.transaction(['previews', 'meta'], 'readwrite'), done = transactionDone(transaction)
    const previews = transaction.objectStore('previews'), meta = transaction.objectStore('meta')
    const range = ownerRange(owner), count = previews.count(range), previous = meta.get(owner)
    let removed = 0
    count.onsuccess = () => { removed = count.result }
    previous.onsuccess = () => {
      previews.delete(range)
      meta.put({ ...previous.result, owner, storageRevision: crypto.randomUUID() })
    }
    await done
    clearBrowserStorageFailure()
    return removed
  } finally { db.close() }
}
