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

export async function readSiteSettings(db: Queryable, url: string): Promise<SiteSettings> {
  const row = (await db.query<{ clientOptions: Record<string, unknown>; disableRegistration: boolean; name: string | null; iconUrl: string | null }>('SELECT "clientOptions","disableRegistration",name,"iconUrl" FROM meta ORDER BY id LIMIT 1')).rows[0]
  const options = row?.clientOptions || {}
  const priorLimits = options.communityUploadLimits as SiteSettings['uploadLimits'] | undefined
  const limits = options.uploadLimits as Partial<Record<'image' | 'video' | 'audio' | 'document' | 'other', number>> | undefined
  const models = options.communityDefaultModels as SiteSettings['defaultModels'] | undefined
  return {
    brand: String(options.communityBrandName || row?.name || '章鱼社区'),
    logoUrl: String(options.communityLogoUrl ?? row?.iconUrl ?? ''),
    registrationOpen: row?.disableRegistration === false,
    publicationMode: options.communityPublicationMode === 'after' ? 'after' : 'before',
    autoBan: options.communityAutoBanEnabled !== false,
    violationThreshold: Number(options.communityViolationThreshold) || 3,
    uploadLimits: { image: limits?.image || priorLimits?.image || 20, video: limits?.video || priorLimits?.video || 20,
      resource: limits?.document || priorLimits?.resource || 20, other: limits?.other || priorLimits?.other || 20 },
    defaultModels: { text: models?.text || '', image: models?.image || '', video: models?.video || '' },
    ads: communityAdKeys.map(key => normalizeCommunityAd(options[key] as CommunityAd, url) ?? { enabled: false, title: '', imageUrl: '', linkUrl: '' }),
  }
}

export function validateSiteBranding(input: unknown, siteUrl: string, previousLogoUrl?: string): Pick<SiteSettings, 'brand' | 'logoUrl'> {
  const value = input as Pick<SiteSettings, 'brand' | 'logoUrl'> | null
  const fail = (): never => { throw httpError(400, '请填写 1–80 字的站点名称，以及 HTTPS 图片或本站上传的 Logo。') }
  if (!value || typeof value.brand !== 'string' || !value.brand.trim() || value.brand.length > 80 || /[\u0000-\u001f\u007f]/u.test(value.brand) || typeof value.logoUrl !== 'string') return fail()
  let logoUrl = value.logoUrl
  if (logoUrl && logoUrl !== previousLogoUrl) {
    if (logoUrl.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(logoUrl)) return fail()
    if (/^https:\/\//i.test(logoUrl)) {
      let image: URL
      try { image = new URL(logoUrl) } catch { return fail() }
      if (!image.hostname || image.username || image.password) return fail()
      logoUrl = image.origin === new URL(siteUrl).origin ? `${image.pathname}${image.search}${image.hash}` : image.href
    }
    if (!/^https:\/\//i.test(logoUrl)) {
      if (!logoUrl.startsWith('/') || /[%#]/u.test(logoUrl) || /(?:^|\/)\.{1,2}(?:\/|\?|$)/u.test(logoUrl)) return fail()
      const local = /^\/(?:legacy-files\/[a-zA-Z0-9]{1,32}|files\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,255})(?:\?variant=(?:original|web|webpublic|thumbnail))?$/.test(logoUrl)
      const asset = /^\/assets\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(logoUrl)
      if (!local && !asset) return fail()
    }
  }
  return { brand: value.brand.trim(), logoUrl }
}

export function validateSiteSettings(input: unknown, url: string, previousLogoUrl?: string): SiteSettings {
  const value = input as SiteSettings | null
  const fail = () => { throw httpError(400, '请检查站点设置。') }
  if (!value || typeof value !== 'object' || typeof value.registrationOpen !== 'boolean' ||
    !['before', 'after'].includes(value.publicationMode) || typeof value.autoBan !== 'boolean' ||
    !Number.isInteger(value.violationThreshold) || value.violationThreshold < 1 || value.violationThreshold > 1000) return fail()
  const branding = validateSiteBranding(value, url, previousLogoUrl)
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
  return { ...value, ...branding, ads: ads as CommunityAd[] }
}
