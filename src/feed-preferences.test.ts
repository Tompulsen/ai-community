import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanPreferences, clearFeedPreferences, feedSnapshot, feedStorageKey, readPreferences, rememberBatch, rememberExposure, rememberInterest, rememberSearchTags } from './feed-preferences'
import { feedLimits, feedRequestSchema, feedWeightsSchema } from '../shared/recommendation'

const now = 1795250000000
const work = { id: 'work1', kind: 'image' as const, tags: ['海报', '摄影'], status: 'published' as const }
let storage: Map<string, string>
beforeEach(() => {
  storage = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
})
afterEach(() => vi.unstubAllGlobals())

describe('bounded browser-only discovery preferences', () => {
  it('retains aggregate tag scores and deduplicates each work signal without raw search or event logs', () => {
    rememberInterest('25', work, 'open', now)
    rememberInterest('25', work, 'open', now + 1)
    rememberInterest('25', work, 'saved', now + 2)
    const value = readPreferences('25', now + 2)
    expect(value.interests.map(item => item.score)).toEqual([expect.closeTo(3), expect.closeTo(3)])
    expect(value.recent).toEqual([{ id: 'work1', at: now, actions: 9 }])
    expect(Object.keys(value)).toEqual(['owner', 'interests', 'recent', 'previous', 'previousAt'])
  })
  it('expires each old tag and seen entry even when other interests stay active; reads never renew time', () => {
    rememberInterest('25', work, 'open', now)
    rememberBatch('25', ['work1'], now)
    rememberInterest('25', { ...work, id: 'work2', tags: ['风景'] }, 'saved', now + 6 * 86400000)
    const value = readPreferences('25', now + 7 * 86400000)
    expect(value.interests.map(item => item.name)).toEqual(['风景'])
    expect(value.interests[0]!.at).toBe(now + 6 * 86400000)
    expect(value.previous).toEqual([]); expect(value.recent).toEqual([])
    expect(readPreferences('25', now + 14 * 86400000).interests).toEqual([])
    expect(storage.size).toBe(0)
  })
  it('caps tag, recent and batch records under long usage, with a single key across accounts', () => {
    for (let index = 0; index < 500; index++) rememberInterest('25', { ...work, id: `work${index}`, tags: [`标签${index}`] }, 'open', now + index)
    rememberBatch('25', Array.from({ length: 100 }, (_, i) => `work${i}`), now + 500)
    const value = readPreferences('25', now + 500)
    expect(value.interests).toHaveLength(20); expect(value.recent).toHaveLength(120); expect(value.previous).toHaveLength(12)
    expect(new TextEncoder().encode(storage.get(feedStorageKey)).length).toBeLessThan(32768)
    rememberInterest('26', work, 'open', now + 501)
    expect(storage.size).toBe(1)
    expect(readPreferences('26', now + 501).recent).toHaveLength(1)
    expect(readPreferences('guest', now + 501).interests).toEqual([])
  })
  it('decays scores without renewing the stored interaction time and does not learn from drafts', () => {
    rememberInterest('25', work, 'saved', now)
    expect(feedSnapshot('25', now + 3 * 86400000).interests[0]!.score).toBeCloseTo(1.25)
    rememberInterest('25', { ...work, status: 'draft', tags: ['私密'] }, 'open', now + 1)
    expect(readPreferences('25', now + 1).interests.some(item => item.name === '私密')).toBe(false)
  })
  it('records exposure once, expires it after 24h and learns from a later visit again', () => {
    rememberExposure('25', ['work1'], now)
    rememberExposure('25', ['work1'], now + 1000)
    expect(readPreferences('25', now + 1000).recent[0]!.at).toBe(now)
    expect(feedSnapshot('25', now + feedLimits.seenAge).seen).toEqual([])
  })
  it('clears damaged or oversized data and validates unknown fields and future timestamps', () => {
    storage.set(feedStorageKey, '{bad json')
    expect(readPreferences('25', now).recent).toEqual([])
    storage.set(feedStorageKey, 'x'.repeat(32769))
    expect(readPreferences('25', now).interests).toEqual([])
    const value = cleanPreferences({ owner: '25', query: 'private search', interests: [{ kind: 'image', name: '海报', score: 10, at: now + 1 }], recent: [{ at: now }, { id: '../unsafe', at: now }] }, '25', now)
    expect(value).toEqual({ owner: '25', interests: [], recent: [], previous: [], previousAt: 0 })
  })
  it('learns only existing search tags, deduplicates short repeats and does not retain the original query', () => {
    const tags = [{ id: 'tag1', name: '海报', category: 'image' as const }]
    rememberSearchTags('25', '海报私人搜索原词', '', tags, 'all', now)
    rememberSearchTags('25', '海报私人搜索原词', '', tags, 'all', now + 1)
    const value = readPreferences('25', now + 1)
    expect(value.interests[0]!.score).toBe(3)
    expect(storage.get(feedStorageKey)).not.toContain('私人搜索原词')
    expect(value.recent).toEqual([])
    rememberSearchTags('25', '海报', '', tags, 'all', now + 1800001)
    expect(readPreferences('25', now + 1800001).interests[0]!.score).toBeGreaterThan(5)
  })
  it('evicts stale high raw scores by decayed value so new interests can enter a full profile', () => {
    for (let index = 0; index < 20; index++) rememberInterest('25', { ...work, id: `old${index}`, tags: [`旧${index}`] }, 'saved', now)
    rememberInterest('25', { ...work, id: 'fresh', tags: ['新兴趣'] }, 'liked', now + 6 * 86400000)
    expect(readPreferences('25', now + 6 * 86400000).interests.map(item => item.name)).toContain('新兴趣')
  })
  it('supports disabled browser storage in bounded memory and clears that fallback', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('disabled') }, setItem() { throw new Error('disabled') }, removeItem() { throw new Error('disabled') } })
    clearFeedPreferences('25'); rememberInterest('25', work, 'open', now)
    expect(feedSnapshot('25', now).interests).toHaveLength(2)
    clearFeedPreferences('25'); expect(feedSnapshot('25', now).interests).toEqual([])
  })
  it('retains memory after writes fail while reads still succeed with an empty value', async () => {
    vi.resetModules()
    const fresh = await import('./feed-preferences')
    vi.stubGlobal('localStorage', { getItem() { return null }, setItem() { throw new Error('quota') }, removeItem() {} })
    fresh.rememberInterest('25', work, 'open', now)
    expect(fresh.feedSnapshot('25', now).interests).toHaveLength(2)
  })
  it('rejects oversized or injected feed input and invalid administrator weights', () => {
    const request = { seed: 'batch-1', previous: ['work1'] }
    expect(feedRequestSchema.safeParse(request).success).toBe(true)
    for (const patch of [{ seen: Array(121).fill('work1') }, { previous: Array(13).fill('work1') }, { query: 'x'.repeat(201) }, { authorId: 'someone' }, { seed: "'" }, { interests: [{ kind: 'image', name: '海报', score: Infinity }] }]) expect(feedRequestSchema.safeParse({ ...request, ...patch }).success).toBe(false)
    expect(feedWeightsSchema.safeParse({ interest: 60, fresh: 25, explore: 15 }).success).toBe(true)
    expect(feedWeightsSchema.safeParse({ interest: 60, fresh: 25, explore: 30 }).success).toBe(false)
  })
})
