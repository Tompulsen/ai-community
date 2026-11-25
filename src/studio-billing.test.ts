import { describe, expect, it } from 'vitest'
import { formatInvocationPoints, invocationPoints, selectedModelPrices } from './studio-billing'
import type { ModelPriceRow, ModelPricing } from '../server/native-account/pricing'

const row: ModelPriceRow = { model: 'gpt-image-2', group: 'image', price: '积分 150', billing: '每次请求', requestPrice: 150, imageCountMultiplier: true }
const input = { kind: 'image' as const, model: row.model, quantity: 3 }
const prices: ModelPricing = { rows: [row], currency: '积分', autoGroups: ['image'], userId: 17, account: 'fixture', walletUrl: '', pricingUrl: '', fetchedAt: '' }

describe('invocation points', () => {
  const video = { kind: 'video' as const, model: 'grok-imagine-video-1.5', duration: 5, resolution: '480p' }
  const videoRow: ModelPriceRow = { ...row, requestPrice: undefined, videoRates: [{ providerKey: '0', provider: 'xAI', perSecond: 750, perRequest: 0 }, { providerKey: '1', provider: 'Sora', perSecond: 750, perRequest: 0 }] }
  it('quotes the complete video duration from every provider, including async video', () => {
    expect(invocationPoints([videoRow], '积分', video)).toEqual({ min: 3750, max: 3750 })
    expect(invocationPoints([videoRow], '积分', { ...video, duration: 8, protocol: 'async' })).toEqual({ min: 6000, max: 6000 })
    expect(invocationPoints([videoRow, { ...videoRow, videoRates: [{ providerKey: '0', provider: 'other', perSecond: 1600, perRequest: 500 }] }], '积分', video)).toEqual({ min: 3750, max: 8500 })
    expect(invocationPoints([videoRow, row], '积分', video)).toBeUndefined()
  })
  it('selects resolution rates and keeps a range when automatic resolution or manual size is uncertain', () => {
    const priced = { ...videoRow, videoRates: [
      { providerKey: '0', provider: 'Sora', resolution: '480p', perSecond: 750, perRequest: 0 },
      { providerKey: '0', provider: 'Sora', resolution: '720p', perSecond: 1600, perRequest: 500 },
    ] }
    expect(invocationPoints([priced], '积分', video)).toEqual({ min: 3750, max: 3750 })
    expect(invocationPoints([priced], '积分', { ...video, resolution: '720p', size: '1280x720' })).toEqual({ min: 8500, max: 8500 })
    for (const options of [{ resolution: 'auto' }, { size: '1280x720' }]) expect(invocationPoints([priced], '积分', { ...video, ...options })).toEqual({ min: 3750, max: 8500 })
    expect(invocationPoints([priced], '积分', { ...video, resolution: '4k' })).toBeUndefined()
    const sameName = { ...priced, videoRates: priced.videoRates.map((rate, index) => ({ ...rate, providerKey: String(index) })) }
    expect(invocationPoints([sameName], '积分', video)).toBeUndefined()
  })
  it('does not quote overridden video parameters or invalid durations and charges', () => {
    for (const duration of [undefined, 0, -1, 3601, 1.5, NaN, Infinity]) expect(invocationPoints([videoRow], '积分', { ...video, duration })).toBeUndefined()
    expect(invocationPoints([videoRow], '积分', { ...video, customParameters: '{"seconds":20}' })).toBeUndefined()
    for (const perSecond of [-1, Infinity, Number.MAX_VALUE]) expect(invocationPoints([{ ...videoRow, videoRates: [{ providerKey: '0', provider: 'broken', perSecond, perRequest: 0 }] }], '积分', video)).toBeUndefined()
    expect(invocationPoints([{ ...videoRow, videoRates: [{ providerKey: '0', provider: 'free', perSecond: 0, perRequest: 0 }] }], '积分', video)).toEqual({ min: 0, max: 0 })
  })
  it('adds measured reference seconds only to C rates and preserves the output duration and price', () => {
    const cRow = { ...videoRow, videoRates: [{ providerKey: '0', provider: 'C', perSecond: 750, perRequest: 100, billReferenceVideo: true }] }
    const request = { ...video, duration: 6, hasReferenceVideo: true, referenceVideoDuration: 2.5 }
    expect(invocationPoints([cRow], '积分', request)).toEqual({ min: 6475, max: 6475 })
    expect(invocationPoints([videoRow], '积分', request)).toEqual({ min: 4500, max: 4500 })
    expect(invocationPoints([videoRow, cRow], '积分', request)).toEqual({ min: 4500, max: 6475 })
    expect(request.duration).toBe(6)
    expect(cRow.videoRates[0]!.perSecond).toBe(750)
    for (const referenceVideoDuration of [undefined, 0, -1, NaN, Infinity, 3600]) {
      expect(invocationPoints([cRow], '积分', { ...request, referenceVideoDuration })).toBeUndefined()
      expect(invocationPoints([videoRow], '积分', { ...request, referenceVideoDuration })).toEqual({ min: 4500, max: 4500 })
    }
    expect(invocationPoints([cRow], '积分', { ...video, duration: 6, hasReferenceVideo: false })).toEqual({ min: 4600, max: 4600 })
  })
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
  it('uses the configured image interface when an alias disagrees with name recognition', () => {
    expect(invocationPoints([row], '积分', { ...input, apiFormat: 'chat-completions' })).toBeUndefined()
    expect(invocationPoints([row], '积分', { ...input, model: 'gemini-2.5-flash-image', apiFormat: 'images' })).toEqual({ min: 450, max: 450 })
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
