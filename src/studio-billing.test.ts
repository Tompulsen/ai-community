import { describe, expect, it } from 'vitest'
import { formatInvocationPoints, invocationPoints, selectedModelPrices } from './studio-billing'
import type { ModelPriceRow, ModelPricing } from '../server/native-account/pricing'

const row: ModelPriceRow = { model: 'gpt-image-2', group: 'image', price: '积分 150', billing: '每次请求', requestPrice: 150, imageCountMultiplier: true }
const input = { kind: 'image' as const, model: row.model, quantity: 3 }
const prices: ModelPricing = { rows: [row], currency: '积分', autoGroups: ['image'], userId: 17, account: 'fixture', walletUrl: '', pricingUrl: '', fetchedAt: '' }

describe('invocation points', () => {
  it('multiplies ordinary fixed image pricing by n and preserves zero and fractional charges', () => {
    expect(invocationPoints([row], '积分', input)).toEqual({ min: 450, max: 450 })
    expect(invocationPoints([{ ...row, requestPrice: 0 }], '积分', input)).toEqual({ min: 0, max: 0 })
    expect(invocationPoints([{ ...row, requestPrice: 0.125 }], '积分', input)).toEqual({ min: 0.375, max: 0.375 })
  })
  it('keeps fixed expression pricing per request and rejects unsupported Gemini batches', () => {
    const expression = { ...row, imageCountMultiplier: false }
    expect(invocationPoints([expression], '积分', input)).toEqual({ min: 150, max: 150 })
    expect(invocationPoints([expression], '积分', { ...input, model: 'gemini-2.5-flash-image' })).toBeUndefined()
    expect(invocationPoints([expression], '积分', { ...input, model: 'gemini-2.5-flash-image', quantity: 1 })).toEqual({ min: 150, max: 150 })
    expect(invocationPoints([row], '积分', { ...input, kind: 'text' })).toEqual({ min: 150, max: 150 })
  })
  it('shows the complete auto range and refuses partial ranges with an unknown candidate', () => {
    expect(invocationPoints([row, { ...row, group: 'default', requestPrice: 50 }], '积分', input)).toEqual({ min: 150, max: 450 })
    expect(invocationPoints([row, { ...row, requestPrice: undefined }], '积分', input)).toBeUndefined()
  })
  it('does not guess token, async, video, DALL·E, currency or malformed prices', () => {
    for (const value of [undefined, NaN, Infinity, -1]) expect(invocationPoints([{ ...row, requestPrice: value }], '积分', input)).toBeUndefined()
    for (const quantity of [0, 17, 1.5, NaN]) expect(invocationPoints([row], '积分', { ...input, quantity })).toBeUndefined()
    for (const change of [{ kind: 'video' as const }, { protocol: 'async' }, { model: 'dall-e-3' }, { model: 'dall-e' }]) expect(invocationPoints([row], '积分', { ...input, ...change })).toBeUndefined()
    expect(invocationPoints([{ ...row, imageCountMultiplier: undefined }], '积分', input)).toBeUndefined()
    expect(invocationPoints([row], '$', input)).toBeUndefined()
    expect(invocationPoints([], '积分', input)).toBeUndefined()
  })
  it('resolves only the selected model and authorized auto candidates in routing order', () => {
    const catalog = { ...prices, rows: [row, { ...row, group: 'default' }, { ...row, model: 'other' }], autoGroups: ['default', 'image'] }
    expect(selectedModelPrices(catalog, row.model, 'auto').map(row => row.group)).toEqual(['default', 'image'])
    expect(selectedModelPrices(catalog, row.model, 'image')).toEqual([row])
    expect(selectedModelPrices({ ...catalog, autoGroups: [] }, row.model, 'auto')).toEqual([])
    expect(selectedModelPrices(catalog, row.model, 'missing')).toEqual([])
    expect(selectedModelPrices(catalog, '', 'image')).toEqual([])
  })
  it('formats real points without rounding large balances or tiny charges to zero', () => {
    expect(formatInvocationPoints(123456789.125)).toBe('123,456,789.125')
    expect(formatInvocationPoints(0.0000001)).toBe('<0.000001')
    expect(formatInvocationPoints(0.1 * 3)).toBe('0.3')
    expect(formatInvocationPoints(0)).toBe('0')
  })
})
