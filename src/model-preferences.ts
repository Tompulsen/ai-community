// Model preference keys and type/format overrides adapted from octopus_chat (MIT).
import { reactive, watch } from 'vue'
import { z } from 'zod'
import { creation, type CreationKind, type CreationModel } from './native-studio'
import { api, session } from './state'
import { CHAT_API_FORMATS, type ChatApiFormat } from '../shared/studio/chat-api-format'
export type ModelType = 'auto' | 'chat' | 'image' | 'video'
const keySchema = z.string().max(4096).refine(key => {
  try {
    const parts: unknown = JSON.parse(key)
    return Array.isArray(parts) && parts[0] === 'account' && (parts.length === 3
      && Number.isSafeInteger(parts[1]) && parts[1] > 0 && typeof parts[2] === 'string' && parts[2].length > 0 && parts[2].length <= 200
      || parts.length === 5 && parts.slice(1).every(part => typeof part === 'string' && part.length > 0 && part.length <= 2000))
  } catch { return false }
})
const bounded = <T extends z.ZodType>(schema: T) => z.record(keySchema, schema).refine(value => Object.keys(value).length <= 2000)
const savedSchema = z.object({
  overrides: bounded(z.enum(['chat', 'image', 'video'])).default({}),
  apiFormats: bounded(z.enum(CHAT_API_FORMATS)).default({}),
  favorites: z.array(keySchema).max(2000).default([]),
})
type Saved = z.infer<typeof savedSchema>
export const modelPreferences = reactive<Saved & { error: string }>({ overrides: {}, apiFormats: {}, favorites: [], error: '' })
export const modelChoices = reactive<Record<CreationKind, string>>({ text: '', image: '', video: '' })
export function takeModelChoice(kind: CreationKind, models: CreationModel[]) {
  const choice = modelChoices[kind]
  if (!models.some(item => item.id === choice)) return ''
  modelChoices[kind] = ''
  return choice
}
const owner = () => session.user ? JSON.stringify([session.user.id, session.user.accountId || session.user.id]) : ''
const storageKey = () => `octopus:account-${encodeURIComponent(owner())}:model-preferences`
watch(owner, () => {
  Object.assign(modelPreferences, { overrides: {}, apiFormats: {}, favorites: [], error: '' })
  Object.assign(modelChoices, { text: '', image: '', video: '' })
  if (!session.user) return
  try {
    const saved = localStorage.getItem(storageKey())
    if (saved) Object.assign(modelPreferences, savedSchema.parse(JSON.parse(saved)))
  } catch { modelPreferences.error = '模型设置无法读取，可重新设置；当前账号模型仍可使用。' }
}, { immediate: true, flush: 'sync' })
export function modelPreferenceKey(id: string) {
  return JSON.stringify(['account', session.accountUrl || 'local', session.user?.accountId || session.user?.id || '', creation.selectedGroup || '', id])
}
let migrating: Promise<void> | undefined, migratingOwner = '', migratedOwner = ''
export function migrateModelPreferences(): Promise<void> {
  const identity = JSON.stringify([owner(), session.accountUrl])
  if (!session.user || migratedOwner === identity) return Promise.resolve()
  if (migrating) return migratingOwner === identity ? migrating : migrating.then(() => migrateModelPreferences())
  const legacy = [...new Set([...Object.keys(modelPreferences.overrides), ...Object.keys(modelPreferences.apiFormats), ...modelPreferences.favorites])]
    .filter(key => JSON.parse(key).length === 3)
  if (!legacy.length) { migratedOwner = identity; return Promise.resolve() }
  const tokenIds = [...new Set(legacy.map(key => JSON.parse(key)[1] as number))]
  if (tokenIds.length > 128) { modelPreferences.error = '旧模型设置过多，已保留原数据，请重新确认当前分组设置。'; return Promise.resolve() }
  migratingOwner = identity
  migrating = (async () => {
    try {
      const result = await api<{ issuer: string; mappings: Record<string, string> }>('/api/creation/preference-groups', { method: 'POST', body: { tokenIds }, expectedAccount: session.user!.accountId || session.user!.id })
      if (identity !== JSON.stringify([owner(), session.accountUrl])) return
      const next: Saved = { overrides: { ...modelPreferences.overrides }, apiFormats: { ...modelPreferences.apiFormats }, favorites: [...modelPreferences.favorites] }
      let unresolved = false
      for (const field of ['overrides', 'apiFormats', 'favorites'] as const) {
        const candidates = new Map<string, { old: string[]; values: Set<string> }>()
        for (const old of legacy) {
          const [, token, model] = JSON.parse(old), group = result.mappings[token]
          const value = field === 'favorites' ? next.favorites.includes(old) ? 'favorite' : undefined : next[field][old]
          if (value === undefined) continue
          if (!group) { unresolved = true; continue }
          const key = JSON.stringify(['account', result.issuer, session.user!.accountId || session.user!.id, group, model])
          const candidate = candidates.get(key) || { old: [], values: new Set<string>() }
          candidate.old.push(old); candidate.values.add(value); candidates.set(key, candidate)
        }
        for (const [key, candidate] of candidates) {
          if (candidate.values.size !== 1) { unresolved = true; continue }
          if (field === 'favorites') next.favorites = [...new Set([...next.favorites.filter(item => !candidate.old.includes(item)), key])]
          else {
            const target = next[field] as Record<string, string>
            target[key] ??= [...candidate.values][0]!
            for (const old of candidate.old) delete target[old]
          }
        }
      }
      const data = savedSchema.parse(next)
      localStorage.setItem(storageKey(), JSON.stringify(data))
      Object.assign(modelPreferences, data, { error: unresolved ? '部分旧模型设置无法确认所属分组，原数据已保留，请重新确认。' : '' })
      migratedOwner = identity
    } catch { if (identity === JSON.stringify([owner(), session.accountUrl])) modelPreferences.error = '旧模型设置暂未完成核对，原数据已保留，请确认模型类型与接口。' }
  })().finally(() => { migrating = undefined })
  return migrating
}
const legacyKey = (id: string) => creation.modelTokenId ? JSON.stringify(['account', creation.modelTokenId, id]) : ''
export function modelType(id: string): ModelType { return modelPreferences.overrides[modelPreferenceKey(id)] || modelPreferences.overrides[legacyKey(id)] || 'auto' }
export function modelFormat(id: string): ChatApiFormat | undefined { return modelPreferences.apiFormats[modelPreferenceKey(id)] || modelPreferences.apiFormats[legacyKey(id)] }
export function configuredModelFormat(id: string): ChatApiFormat | undefined {
  const format = creation.models.find(item => item.id === id)?.apiFormat
  return CHAT_API_FORMATS.includes(format as ChatApiFormat) ? format as ChatApiFormat : undefined
}
export function favoriteModel(id: string) { return modelPreferences.favorites.includes(modelPreferenceKey(id)) || modelPreferences.favorites.includes(legacyKey(id)) }
function save(next: Saved) {
  if (!session.user || creation.groupSwitching || creation.modelsLoading || !creation.selectedGroup) throw new Error('当前模型分组尚未就绪，请稍后重试。')
  const data = savedSchema.parse(next)
  try { localStorage.setItem(storageKey(), JSON.stringify(data)) }
  catch { throw new Error('模型设置保存失败，请检查浏览器存储后重试。') }
  Object.assign(modelPreferences, data, { error: '' })
}
export function setModelType(id: string, type: ModelType) {
  const overrides = { ...modelPreferences.overrides }, key = modelPreferenceKey(id)
  delete overrides[legacyKey(id)]
  if (type === 'auto') delete overrides[key]
  else overrides[key] = type
  save({ ...modelPreferences, overrides })
}
export function setModelFormat(id: string, format: ChatApiFormat | 'auto') {
  const apiFormats = { ...modelPreferences.apiFormats }, key = modelPreferenceKey(id)
  delete apiFormats[legacyKey(id)]
  if (format === 'auto') delete apiFormats[key]
  else apiFormats[key] = format
  save({ ...modelPreferences, apiFormats })
}
export function toggleModelFavorite(id: string) {
  const key = modelPreferenceKey(id), favorites = modelPreferences.favorites
  save({ ...modelPreferences, favorites: favoriteModel(id) ? favorites.filter(item => item !== key && item !== legacyKey(id)) : [...favorites, key] })
}
export function groupKind(id: string) {
  const group = id.trim().toLowerCase()
  if (['生图', '生圖', '绘图', '繪圖', 'image', 'images'].includes(group)) return 'image'
  if (['视频', '視頻', 'video', 'videos'].includes(group)) return 'video'
}
export function modelKind(item: CreationModel): CreationKind {
  if (item.configuredKind) return item.configuredKind
  const override = modelType(item.id)
  if (override !== 'auto') return override === 'chat' ? 'text' : override
  const detected = item.kinds?.[0]
  if (detected === 'image' || detected === 'video') return detected
  const group = groupKind(creation.selectedGroup || '')
  if (group) return group
  return item.kinds?.[0] || 'text'
}
export function modelsForKind(kind: CreationKind) { return creation.models.filter(item => modelKind(item) === kind) }
