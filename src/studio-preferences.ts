import { computed, reactive, ref, watch } from 'vue'
import { z } from 'zod'
import { session } from './state'
import { SUBMIT_KEYS } from '../shared/studio/submit-key'

const schema = z.object({
  submitKey: z.enum(SUBMIT_KEYS).default('Enter'),
  sidebarWidth: z.number().int().min(220).max(420).optional(),
  sidebarCollapsed: z.boolean().default(false),
})
type Preferences = z.infer<typeof schema>
export const studioPreferences = reactive<Preferences>(schema.parse({}))
export const sidebarPreviewWidth = ref<number>()
export const studioSidebarWidth = computed(() => sidebarPreviewWidth.value ??
  (studioPreferences.sidebarCollapsed ? 72 : studioPreferences.sidebarWidth))
const owner = () => session.user ? JSON.stringify([session.user.id, session.user.accountId || session.user.id]) : ''
const key = () => `octopus:account-${encodeURIComponent(owner())}:studio-preferences`
watch(owner, () => {
  sidebarPreviewWidth.value = undefined
  Object.assign(studioPreferences, { ...schema.parse({}), sidebarWidth: undefined })
  try {
    const raw = session.user && localStorage.getItem(key())
    if (raw) Object.assign(studioPreferences, schema.parse(JSON.parse(raw)))
  } catch { /* Invalid preferences fall back to defaults without changing saved data. */ }
}, { immediate: true, flush: 'sync' })
export function updateStudioPreferences(patch: Partial<Preferences>) {
  if (!session.user) return
  const next = schema.parse({ ...studioPreferences, ...patch })
  try { localStorage.setItem(key(), JSON.stringify(next)) }
  catch { throw new Error('设置保存失败，请检查浏览器存储后重试。') }
  Object.assign(studioPreferences, next)
}
