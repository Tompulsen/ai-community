import { reactive } from 'vue'
import { api } from './state'

export interface SiteBranding { brand: string; logoUrl: string }
export const site = reactive<SiteBranding>({ brand: '章鱼社区', logoUrl: '/assets/brand/octopus-community.jpg' })
let revision = 0

export function updateSite(value: SiteBranding) {
  revision++
  if (typeof value.brand === 'string' && value.brand.trim()) site.brand = value.brand
  if (typeof value.logoUrl === 'string') site.logoUrl = value.logoUrl
}

export async function loadSite() {
  const expected = revision
  try {
    const value = await api<SiteBranding>('/api/site')
    if (expected === revision) updateSite(value)
  } catch { /* Keep the default brand when public settings are unavailable. */ }
}
