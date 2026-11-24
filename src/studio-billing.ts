import type { ModelPriceRow, ModelPricing } from '../server/native-account/pricing'
import { usesGeminiImageChat } from '../shared/studio/image-params'

export function selectedModelPrices(pricing: ModelPricing | undefined, model: string, group: string | null): ModelPriceRow[] {
  if (!pricing || !model || !group) return []
  const groups = group === 'auto' ? pricing.autoGroups ?? ['auto'] : [group]
  return groups.flatMap(candidate => pricing.rows.filter(row => row.model === model && row.group === candidate))
}

/** Preview complete known charges; New API owns routing and settlement. */
export function invocationPoints(rows: ModelPriceRow[], currency: string | undefined, input: {
  kind: 'text' | 'image' | 'video'; model: string; quantity?: number; protocol?: string; apiFormat?: string;
  duration?: number; resolution?: string; customParameters?: string; size?: string;
}): { min: number; max: number } | undefined {
  if (currency !== '积分' || !rows.length) return
  if (input.kind === 'video') {
    const seconds = input.duration
    if (!Number.isInteger(seconds) || seconds! < 1 || seconds! > 3600 || input.customParameters?.trim()) return
    if (rows.some(row => !row.videoRates?.length)) return
    let resolution = input.resolution
    // A manual size can take precedence over resolution on some providers.
    const dimensions = /^(\d+)x(\d+)$/.exec(input.size ?? '')
    if (input.size && input.size !== 'auto' && (!dimensions || String(Math.min(Number(dimensions[1]), Number(dimensions[2]))) !== resolution?.replace(/p$/, '').replace(/^4k$/, '2160'))) resolution = 'auto'
    const totals: number[] = []
    for (const row of rows) {
      const rates = row.videoRates!.filter(rate => !rate.resolution || !resolution || resolution === 'auto' || rate.resolution === resolution)
      if (!rates.length || row.videoRates!.some(rate => !rates.some(candidate => candidate.providerKey === rate.providerKey))) return
      for (const rate of rates) {
        if (![rate.perSecond, rate.perRequest].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) return
        const total = rate.perSecond * seconds! + rate.perRequest
        if (!Number.isFinite(total)) return
        totals.push(total)
      }
    }
    return { min: Math.min(...totals), max: Math.max(...totals) }
  }
  if (input.protocol === 'async') return
  const count = input.kind === 'image' ? input.quantity ?? 1 : 1
  if (!Number.isInteger(count) || count < 1 || count > 16) return
  if (input.kind === 'image' && usesGeminiImageChat(input.model, input.apiFormat) && count !== 1) return
  // Legacy DALL·E adds size/quality multipliers that the catalog does not quote.
  if (input.kind === 'image' && /^dall-e/i.test(input.model)) return
  const totals = rows.map(row => {
    if (typeof row.requestPrice !== 'number' || !Number.isFinite(row.requestPrice) || row.requestPrice < 0) return NaN
    if (input.kind === 'image' && typeof row.imageCountMultiplier !== 'boolean') return NaN
    const multiplier = input.kind === 'image' && row.imageCountMultiplier ? count : 1
    return row.requestPrice * multiplier
  })
  if (totals.some(value => !Number.isFinite(value))) return
  return { min: Math.min(...totals), max: Math.max(...totals) }
}

export function formatInvocationPoints(value: number): string {
  if (value > 0 && value < 0.000001) return '<0.000001'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value)
}
