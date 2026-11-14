// Model preference keys and type/format overrides adapted from octopus_chat (MIT).
import { reactive, watch } from 'vue'
import { z } from 'zod'
import { creation, type CreationKind, type CreationModel } from './native-studio'
import { session } from './state'
import { CHAT_API_FORMATS, type ChatApiFormat } from '../shared/studio/chat-api-format'
export type ModelType = 'auto' | 'chat' | 'image' | 'video'
const keySchema = z.string().max(4096).refine(key => {
  try {
    const parts: unknown = JSON.parse(key)
    return Array.isArray(parts) && parts.length === 3 && parts[0] === 'account'
      && Number.isSafeInteger(parts[1]) && parts[1] > 0 && typeof parts[2] === 'string' && parts[2].length > 0 && parts[2].length <= 200
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
export function modelPreferenceKey(id: string) { return JSON.stringify(['account', creation.modelTokenId, id]) }
export function modelType(id: string): ModelType { return modelPreferences.overrides[modelPreferenceKey(id)] || 'auto' }
export function modelFormat(id: string): ChatApiFormat | undefined { return modelPreferences.apiFormats[modelPreferenceKey(id)] }
export function favoriteModel(id: string) { return modelPreferences.favorites.includes(modelPreferenceKey(id)) }
function save(next: Saved) {
  if (!session.user || creation.groupSwitching || creation.modelsLoading || !creation.modelTokenId) throw new Error('当前模型分组尚未就绪，请稍后重试。')
  const data = savedSchema.parse(next)
  try { localStorage.setItem(storageKey(), JSON.stringify(data)) }
  catch { throw new Error('模型设置保存失败，请检查浏览器存储后重试。') }
  Object.assign(modelPreferences, data, { error: '' })
}
export function setModelType(id: string, type: ModelType) {
  const overrides = { ...modelPreferences.overrides }, key = modelPreferenceKey(id)
  if (type === 'auto') delete overrides[key]
  else overrides[key] = type
  save({ ...modelPreferences, overrides })
}
export function setModelFormat(id: string, format: ChatApiFormat | 'auto') {
  const apiFormats = { ...modelPreferences.apiFormats }, key = modelPreferenceKey(id)
  if (format === 'auto') delete apiFormats[key]
  else apiFormats[key] = format
  save({ ...modelPreferences, apiFormats })
}
export function toggleModelFavorite(id: string) {
  const key = modelPreferenceKey(id), favorites = modelPreferences.favorites
  save({ ...modelPreferences, favorites: favorites.includes(key) ? favorites.filter(item => item !== key) : [...favorites, key] })
}
export function modelKind(item: CreationModel): CreationKind {
  const override = modelType(item.id)
  if (override !== 'auto') return override === 'chat' ? 'text' : override
  const group = creation.selectedGroup?.trim().toLowerCase() || ''
  if (['生图', '生圖', '绘图', '繪圖', 'image', 'images'].includes(group)) return 'image'
  if (['视频', '視頻', 'video', 'videos'].includes(group)) return 'video'
  return item.kinds?.[0] || 'text'
}
export function modelsForKind(kind: CreationKind) { return creation.models.filter(item => modelKind(item) === kind) }
