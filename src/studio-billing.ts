import type { ModelPriceRow, ModelPricing } from '../server/native-account/pricing'
import { usesGeminiImageChat } from '../shared/studio/image-params'

export function selectedModelPrices(pricing: ModelPricing | undefined, model: string, group: string | null): ModelPriceRow[] {
  if (!pricing || !model || !group) return []
  const groups = group === 'auto' ? pricing.autoGroups ?? ['auto'] : [group]
  return groups.flatMap(candidate => pricing.rows.filter(row => row.model === model && row.group === candidate))
}

/** Preview only complete fixed charges; New API owns routing and settlement. */
export function invocationPoints(rows: ModelPriceRow[], currency: string | undefined, input: {
  kind: 'text' | 'image' | 'video'; model: string; quantity?: number; protocol?: string;
}): { min: number; max: number } | undefined {
  if (currency !== '积分' || !rows.length || input.kind === 'video' || input.protocol === 'async') return
  const count = input.kind === 'image' ? input.quantity ?? 1 : 1
  if (!Number.isInteger(count) || count < 1 || count > 16) return
  if (input.kind === 'image' && usesGeminiImageChat(input.model) && count !== 1) return
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
