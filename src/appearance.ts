import { shallowRef } from 'vue'

export type AppearanceMode = 'light' | 'dark' | 'system' | 'schedule'
export interface AppearanceSettings { mode: AppearanceMode; light: string; dark: string; lightStart: string; darkStart: string }
export interface Theme { id: string; name: string; mode: 'light' | 'dark'; colors: string[] }
interface AppearanceController {
  themes: Theme[]; settings: AppearanceSettings; mode: 'light' | 'dark'; error: string
  validTimes(light: string, dark: string): boolean
  set(patch: Partial<AppearanceSettings>): boolean
  reset(): void
}
declare global { interface Window { communityAppearance: AppearanceController } }
export const appearance = window.communityAppearance
export const themeState = shallowRef({ ...appearance.settings, current: appearance.mode, error: appearance.error })
function refresh() { themeState.value = { ...appearance.settings, current: appearance.mode, error: appearance.error } }
window.addEventListener('community-appearance-change', refresh)
if (import.meta.hot) import.meta.hot.dispose(() => window.removeEventListener('community-appearance-change', refresh))
