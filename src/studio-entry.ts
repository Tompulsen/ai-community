import { z } from 'zod'
import { chatOptionsSchema, imageOptionsSchema, videoOptionsSchema } from '../shared/studio/options'
import { modelApiFormatSchema } from '../shared/studio/model-types'
import { get, set, studioStore } from '../shared/studio/studio-keyval'

const mediaEntrySchema = z.object({
  owner: z.string().nullable(), kind: z.enum(['image', 'video']),
  prompt: z.string().trim().max(100000),
  parameters: z.object({
    model: z.string().max(200), group: z.string().min(1).max(200).nullable(), tokenId: z.number().int().positive().nullable(),
    ratio: z.string().regex(/^(?:auto|[1-9]\d{0,2}:[1-9]\d{0,2})$/),
    manualSize: z.union([z.literal(''), z.string().regex(/^(?:auto|[1-9]\d{0,4}x[1-9]\d{0,4}|[124]K)$/)]),
    count: z.number().int().min(1).max(16), duration: z.number().int().min(1).max(3600),
    skills: z.array(z.object({ id: z.string().regex(/^(?:community|work)-[a-zA-Z0-9]{1,32}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(10).optional(),
    apiFormat: modelApiFormatSchema.optional(),
    protocol: z.enum(['auto', 'openai', 'sync', 'async']), imageOptions: imageOptionsSchema, videoOptions: videoOptionsSchema,
  }).optional(),
  references: z.array(z.object({ name: z.string(), type: z.string().optional(), size: z.number().nonnegative().optional(), duration: z.number().positive().optional(), durationSeconds: z.number().positive().optional(),
    url: z.string().refine(value => value.startsWith('data:image/') || /^\/legacy-files\/[A-Za-z0-9]{1,32}$/.test(value)) })).max(16),
}).refine(value => Boolean(value.prompt || value.kind === 'video' && value.references.length === 1 && value.references[0]?.type?.startsWith('video/')), '请输入提示词或添加源视频。')
const textEntrySchema = z.object({
  owner: z.string().nullable(), kind: z.literal('text'), prompt: z.string().trim().max(100000),
  parameters: z.object({
    model: z.string().max(200), group: z.string().min(1).max(200).nullable(), tokenId: z.number().int().positive().nullable(),
    apiFormat: z.enum(['auto', 'chat-completions', 'responses', 'gemini', 'claude']).optional(),
    settings: chatOptionsSchema.omit({ messages: true }), system: z.string().max(100000),
    skillIds: z.array(z.string().min(1).max(200)).max(100), search: z.enum(['off', 'quick', 'deep']),
    compressionThreshold: z.number().int().min(500).max(2000000), sendMemory: z.boolean(), toolContext: z.string().max(1000000),
    files: z.array(z.object({ name: z.string().max(300), type: z.string().max(200), size: z.number().nonnegative(), content: z.string().max(28 * 1024 ** 2), isText: z.boolean() })).max(10),
  }),
}).refine(value => Boolean(value.prompt || value.parameters.files.length), '请输入消息或添加附件。')
const entrySchema = z.discriminatedUnion('kind', [mediaEntrySchema, textEntrySchema])
export type StudioEntry = z.infer<typeof entrySchema>
const prefix = 'ai-community-next:studio-entry:'
const entryKey = (id: string) => prefix + id
const lifetime = 24 * 60 * 60 * 1000
type StoredEntry = { version: 1; owner: string | null; expiresAt: number; entry?: StudioEntry; consumed?: true }
const expiredMessage = '这份创作输入已处理或已失效，请返回首页重新输入。'
function storageError(cause: unknown) {
  const name = cause instanceof Error ? cause.name : ''
  const message = name === 'QuotaExceededError'
    ? '浏览器存储空间不足，暂存未完成。请进入工作台后重新添加参考图，或释放浏览器可用空间后重试。'
    : name === 'SecurityError' || name === 'NotAllowedError'
      ? '浏览器禁止访问本地存储，请允许此网站保存数据后重试。当前输入不会主动清除。'
      : '创作输入暂存失败，请重试或进入工作台后重新添加参考图。当前输入不会主动清除。'
  return new Error(message, { cause })
}
function assertOwner(owner: string | null, expected: string | null) {
  if (owner !== null && owner !== expected) throw new Error('账号已切换，请返回首页重新提交创作。')
}
function removeLegacy(key: string) { try { sessionStorage.removeItem(key) } catch { /* IndexedDB owns the durable copy. */ } }
async function cleanExpired(owner: string | null) {
  return studioStore('readwrite', store => new Promise<void>((resolve, reject) => {
    const transaction = store.transaction
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Entry cleanup failed'))
    const request = store.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const value = cursor.value as StoredEntry
      if (value?.version === 1 && value.owner === owner && value.expiresAt <= Date.now()) cursor.delete()
      cursor.continue()
    }
  }))
}
export async function saveStudioEntry(value: StudioEntry) {
  const entry = entrySchema.parse(value), id = crypto.randomUUID()
  try {
    await cleanExpired(entry.owner)
    await set(entryKey(id), { version: 1, owner: entry.owner, expiresAt: Date.now() + lifetime, entry } satisfies StoredEntry)
  } catch (cause) { throw storageError(cause) }
  return id
}
export async function readStudioEntry(id: string, owner: string | null) {
  const key = entryKey(id)
  let value: StoredEntry | undefined
  try { value = await get<StoredEntry>(key) } catch (cause) { throw storageError(cause) }
  if (!value) {
    let legacy: string | null
    try { legacy = sessionStorage.getItem(key) } catch (cause) { throw storageError(cause) }
    if (!legacy) throw new Error(expiredMessage)
    const entry = entrySchema.parse(JSON.parse(legacy))
    assertOwner(entry.owner, owner)
    try {
      value = await studioStore('readwrite', store => new Promise<StoredEntry>((resolve, reject) => {
        let saved: StoredEntry
        const transaction = store.transaction, request = store.get(key)
        transaction.oncomplete = () => resolve(saved)
        transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Entry migration failed'))
        request.onsuccess = () => {
          saved = request.result
          if (saved !== undefined) return
          saved = { version: 1, owner: entry.owner, expiresAt: Date.now() + lifetime, entry }
          try { store.put(saved, key) } catch (cause) { reject(cause); transaction.abort() }
        }
      }))
    } catch (cause) { throw storageError(cause) }
    removeLegacy(key)
  }
  assertOwner(value.owner, owner)
  if (value.consumed) throw new Error(expiredMessage)
  if (value.version !== 1 || !value.entry || !Number.isFinite(value.expiresAt)) throw new Error('暂存内容无效，请返回首页重新输入。')
  if (value.expiresAt <= Date.now()) {
    await clearStudioEntry(id, owner)
    throw new Error(expiredMessage)
  }
  const entry = entrySchema.parse(value.entry)
  assertOwner(entry.owner, owner)
  return entry
}
export async function clearStudioEntry(id: string, owner: string | null) {
  const key = entryKey(id)
  let actualOwner = owner, removed = false
  try {
    await studioStore('readwrite', store => new Promise<void>((resolve, reject) => {
      const transaction = store.transaction, request = store.get(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Entry removal failed'))
      request.onsuccess = () => {
        try {
          const value = request.result as StoredEntry | undefined
          if (value) actualOwner = value.owner
          else {
            let legacy: string | null
            try { legacy = sessionStorage.getItem(key) } catch { return }
            if (legacy) actualOwner = entrySchema.parse(JSON.parse(legacy)).owner
          }
          if (actualOwner !== null && actualOwner !== owner || value?.consumed) return
          store.delete(key); removed = true
        } catch (cause) { reject(cause); transaction.abort() }
      }
    }))
  } catch (cause) { throw storageError(cause) }
  assertOwner(actualOwner, owner)
  if (removed) removeLegacy(key)
}
export async function armStudioEntryStart(id: string, owner: string, sourceId: string) {
  try {
    const accepted = await studioStore('readwrite', store => new Promise<boolean>((resolve, reject) => {
      let accepted = false
      const transaction = store.transaction, request = store.get(entryKey(sourceId))
      transaction.oncomplete = () => resolve(accepted)
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Entry handoff failed'))
      request.onsuccess = () => {
        const value = request.result as StoredEntry | undefined
        if (value?.version !== 1 || !value.entry || value.consumed || value.owner !== null && value.owner !== owner || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return
        try {
          // Only one tab can consume this input and arm a paid submission.
          store.put({ version: 1, owner, expiresAt: Date.now() + lifetime } satisfies StoredEntry, entryKey('start:' + id))
          store.put({ version: 1, owner, expiresAt: Date.now() + lifetime, consumed: true } satisfies StoredEntry, entryKey(sourceId))
          accepted = true
        } catch (cause) { reject(cause); transaction.abort() }
      }
    }))
    if (accepted) removeLegacy(entryKey(sourceId))
    return accepted
  } catch (cause) { throw storageError(cause) }
}
export async function claimStudioEntryStart(id: string, owner: string) {
  const key = entryKey('start:' + id)
  try {
    const accepted = await studioStore('readwrite', store => new Promise<boolean>((resolve, reject) => {
      let accepted = false
      const transaction = store.transaction, request = store.get(key)
      transaction.oncomplete = () => resolve(accepted)
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Entry claim failed'))
      request.onsuccess = () => {
        try {
          const value = request.result as StoredEntry | undefined
          if (value !== undefined && (value?.version !== 1 || value.owner !== owner || value.consumed)) return
          // The transaction also prevents copied legacy tabs from starting twice.
          if (value === undefined && sessionStorage.getItem(key) !== owner) return
          accepted = value === undefined || value.expiresAt > Date.now()
          store.put({ version: 1, owner, expiresAt: Date.now() + lifetime, consumed: true } satisfies StoredEntry, key)
        } catch (cause) { reject(cause); transaction.abort() }
      }
    }))
    if (accepted) removeLegacy(key)
    return accepted
  } catch (cause) { throw storageError(cause) }
}
