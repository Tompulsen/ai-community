import { get, studioStore } from './studio-keyval.ts'

export const CHAT_ASSET_REFERENCE = '__octopusChatAsset'
let known: { name: string; values: Map<string, string> } | undefined
let activeReads = 0
const waitingReads: (() => void)[] = []

export const chatAssetKey = (name: string, id: string) => `${name}:asset:${id}`
export function chatAssetReference(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 1) return
  const id = (value as Record<string, unknown>)[CHAT_ASSET_REFERENCE]
  return typeof id === 'string' ? id : undefined
}
export function visitChatAssetReferences(value: unknown, visit: (id: string) => void) {
  const id = chatAssetReference(value)
  if (id !== undefined) visit(id)
  else if (value && typeof value === 'object') for (const child of Object.values(value)) visitChatAssetReferences(child, visit)
}
export function hasDeferredChatAssets(value: unknown): boolean {
  return chatAssetReference(value) !== undefined || !!value && typeof value === 'object' && Object.values(value).some(hasDeferredChatAssets)
}
function mapAssets<T>(value: T, replace: (item: unknown) => unknown): T {
  const changed = replace(value)
  if (changed !== value) return changed as T
  if (!value || typeof value !== 'object') return value
  const entries = Object.entries(value), next = entries.map(([key, child]) => [key, mapAssets(child, replace)] as const)
  if (next.every(([, child], index) => child === entries[index]![1])) return value
  return (Array.isArray(value) ? next.map(([, child]) => child) : Object.fromEntries(next)) as T
}
export function restoreChatAssets<T>(value: T, loaded: Map<string, string>): T {
  return mapAssets(value, item => {
    const id = chatAssetReference(item)
    return id === undefined ? item : loaded.get(id) ?? item
  })
}
export function rememberChatAssets(name: string, loaded: Map<string, string>) {
  if (known?.name !== name) known = { name, values: new Map() }
  for (const [id, value] of loaded) known.values.set(value, id)
}
export function knownChatAsset(name: string, value: string) { return known?.name === name ? known.values.get(value) : undefined }
export function forgetChatAssets(name?: string) { if (!name || known?.name === name) known = undefined }
export function deferChatAssets<T>(name: string, value: T): T {
  return mapAssets(value, item => {
    const id = typeof item === 'string' ? knownChatAsset(name, item) : undefined
    return id === undefined ? item : { [CHAT_ASSET_REFERENCE]: id }
  })
}
export function retainChatAssets(name: string, value: unknown) {
  if (known?.name !== name) return
  const retained = new Map<string, string>()
  const visit = (item: unknown) => {
    if (typeof item === 'string') { const id = knownChatAsset(name, item); if (id !== undefined) retained.set(item, id) }
    else if (item && typeof item === 'object') for (const child of Object.values(item)) visit(child)
  }
  visit(value); known.values = retained
}

// Clone structure without serializing large immutable attachment strings a second time.
export function cloneChatValue<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  if ('toJSON' in value && typeof value.toJSON === 'function') return cloneChatValue(value.toJSON())
  if (Array.isArray(value)) return value.map(item => cloneChatValue(item)) as T
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && typeof item !== 'function')
    .map(([key, item]) => [key, cloneChatValue(item)])) as T
}

async function readAsset(name: string, id: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (activeReads >= 2) await new Promise<void>(resolve => waitingReads.push(resolve))
  else activeReads++
  try {
    signal?.throwIfAborted()
    const value = await get<unknown>(chatAssetKey(name, id))
    signal?.throwIfAborted()
    if (typeof value !== 'string') throw new Error('本地对话附件暂时无法读取，原始记录已保留。请重试或进入本地存储管理。')
    return value
  } finally { const next = waitingReads.shift(); if (next) next(); else activeReads-- }
}
export async function loadChatAssets(name: string, ids: Iterable<string>, signal?: AbortSignal) {
  const loaded = new Map<string, string>(), iterator = ids[Symbol.iterator]()
  let failed = false
  const worker = async () => {
    while (!failed) {
      signal?.throwIfAborted()
      const item = iterator.next()
      if (item.done) return
      try { loaded.set(item.value, await readAsset(name, item.value, signal)) }
      catch (error) { failed = true; throw error }
    }
  }
  await Promise.all([worker(), worker()])
  return loaded
}
export async function loadChatSessionAssets(name: string, session: unknown, signal?: AbortSignal) {
  const ids = new Set<string>()
  visitChatAssetReferences(session, id => ids.add(id))
  const loaded = await loadChatAssets(name, ids, signal)
  signal?.throwIfAborted(); rememberChatAssets(name, loaded)
  return loaded
}

// Legacy migration copies one payload at a time; no full attachment set enters JS memory.
export async function copyChatAssets(source: string, destination: string, snapshot: unknown) {
  if (source === destination) return
  const ids = new Set<string>()
  visitChatAssetReferences(snapshot, id => ids.add(id))
  if (!ids.size) return
  await studioStore('readwrite', store => new Promise<void>((resolve, reject) => {
    const transaction = store.transaction, iterator = ids.values()
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('历史对话附件尚未完成迁移，原数据已保留。'))
    const next = () => {
      const item = iterator.next()
      if (item.done) return
      const request = store.get(chatAssetKey(source, item.value))
      request.onsuccess = () => {
        if (typeof request.result !== 'string') { transaction.abort(); return }
        store.put(request.result, chatAssetKey(destination, item.value)); next()
      }
    }
    next()
  }))
}
