/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { normalizeCommunityAd, communityAdKeys, type CommunityAd } from './business/ads.ts'
import { httpError } from './auth.ts'
import type { Queryable } from './types.ts'

export interface SiteSettings {
  brand: string
  logoUrl: string
  registrationOpen: boolean
  publicationMode: 'before' | 'after'
  autoBan: boolean
  violationThreshold: number
  uploadLimits: Record<'image' | 'video' | 'resource' | 'other', number>
  defaultModels: Record<'text' | 'image' | 'video', string>
  ads: CommunityAd[]
}

export async function readSiteSettings(db: Queryable): Promise<SiteSettings> {
  const row = (await db.query<{ clientOptions: Record<string, unknown>; disableRegistration: boolean }>('SELECT "clientOptions","disableRegistration" FROM meta LIMIT 1')).rows[0]
  const options = row?.clientOptions || {}
  const priorLimits = options.communityUploadLimits as SiteSettings['uploadLimits'] | undefined
  const limits = options.uploadLimits as Partial<Record<'image' | 'video' | 'audio' | 'document' | 'other', number>> | undefined
  const models = options.communityDefaultModels as SiteSettings['defaultModels'] | undefined
  return {
    brand: String(options.communityBrandName || '章鱼社区'), logoUrl: String(options.communityLogoUrl || ''),
    registrationOpen: row?.disableRegistration === false,
    publicationMode: options.communityPublicationMode === 'after' ? 'after' : 'before',
    autoBan: options.communityAutoBanEnabled !== false,
    violationThreshold: Number(options.communityViolationThreshold) || 3,
    uploadLimits: { image: limits?.image || priorLimits?.image || 20, video: limits?.video || priorLimits?.video || 20,
      resource: limits?.document || priorLimits?.resource || 20, other: limits?.other || priorLimits?.other || 20 },
    defaultModels: { text: models?.text || '', image: models?.image || '', video: models?.video || '' },
    ads: communityAdKeys.map(key => options[key] as CommunityAd).filter(Boolean),
  }
}

export function validateSiteSettings(input: unknown, url: string): SiteSettings {
  const value = input as SiteSettings | null
  const fail = () => { throw httpError(400, '请检查站点设置。') }
  if (!value || typeof value !== 'object' || typeof value.brand !== 'string' || !value.brand.trim() || value.brand.length > 80 ||
    typeof value.logoUrl !== 'string' || typeof value.registrationOpen !== 'boolean' ||
    !['before', 'after'].includes(value.publicationMode) || typeof value.autoBan !== 'boolean' ||
    !Number.isInteger(value.violationThreshold) || value.violationThreshold < 1 || value.violationThreshold > 1000) return fail()
  if (value.logoUrl) {
    let image: URL
    try { image = new URL(value.logoUrl) } catch { return fail() }
    if (image.protocol !== 'https:' || image.username || image.password || value.logoUrl.length > 2048) return fail()
  }
  for (const kind of ['image', 'video', 'resource', 'other'] as const) {
    const limit = value.uploadLimits?.[kind]
    if (!Number.isInteger(limit) || limit < 1 || limit > 10240) return fail()
  }
  for (const kind of ['text', 'image', 'video'] as const) {
    const model = value.defaultModels?.[kind]
    if (typeof model !== 'string' || model.length > 100 || /\s/.test(model)) return fail()
  }
  if (!Array.isArray(value.ads) || value.ads.length > 4) return fail()
  const ads = value.ads.map(ad => normalizeCommunityAd(ad, url))
  if (ads.some(ad => !ad)) return fail()
  return { ...value, brand: value.brand.trim(), ads: ads as CommunityAd[] }
}
