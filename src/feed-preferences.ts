import type { Work } from './data'
import { feedInterestSchema, feedLimits, type FeedInterest } from '../shared/recommendation'

// One bounded browser record; search text and per-click histories are never retained.
export const feedStorageKey = 'octopus:discovery-preferences:v1'
type Interest = FeedInterest & { at: number; searchAt?: number }
type Recent = { id: string; at: number; actions: number }
export interface FeedPreferences { owner: string; interests: Interest[]; recent: Recent[]; previous: string[]; previousAt: number }
const idPattern = /^[a-zA-Z0-9]{1,32}$/
const empty = (owner: string): FeedPreferences => ({ owner, interests: [], recent: [], previous: [], previousAt: 0 })
let memory: FeedPreferences = empty('guest')
let storageFailed = false
const validTime = (at: unknown, now: number, age: number): at is number => typeof at === 'number' && Number.isFinite(at) && at <= now && now - at < age
const decayed = (item: Interest, now: number) => item.score * 2 ** (-(now - item.at) / (3 * 86400000))

export function cleanPreferences(raw: unknown, owner: string, now = Date.now()): FeedPreferences {
  const value = raw as Partial<FeedPreferences> | null
  if (!value || value.owner !== owner) return empty(owner)
  const interests = new Map<string, Interest>(), recent = new Map<string, Recent>()
  for (const item of (Array.isArray(value.interests) ? value.interests : []).slice(-feedLimits.tags)) {
    const parsed = feedInterestSchema.safeParse({ kind: item?.kind, name: item?.name, score: item?.score })
    if (parsed.success && validTime(item.at, now, feedLimits.tagAge)) interests.set(`${item.kind}:${item.name}`, { ...parsed.data, at: item.at,
      ...(validTime(item.searchAt, now, feedLimits.tagAge) ? { searchAt: item.searchAt } : {}) })
  }
  for (const item of (Array.isArray(value.recent) ? value.recent : []).slice(-feedLimits.seen)) {
    if (item && typeof item.id === 'string' && idPattern.test(item.id) && validTime(item.at, now, feedLimits.seenAge)) recent.set(item.id, { id: item.id, at: item.at, actions: Number.isInteger(item.actions) ? item.actions & 31 : 0 })
  }
  return { owner, interests: [...interests.values()], recent: [...recent.values()],
    previous: validTime(value.previousAt, now, feedLimits.seenAge) && Array.isArray(value.previous)
      ? [...new Set(value.previous.filter(id => typeof id === 'string' && idPattern.test(id)))].slice(0, feedLimits.previous) : [],
    previousAt: validTime(value.previousAt, now, feedLimits.seenAge) ? value.previousAt : 0 }
}
function write(value: FeedPreferences) {
  memory = value
  try {
    if (!value.interests.length && !value.recent.length && !value.previous.length) localStorage.removeItem(feedStorageKey)
    else localStorage.setItem(feedStorageKey, JSON.stringify(value))
  } catch { storageFailed = true /* Use bounded memory for the rest of this visit after a quota failure. */ }
}
export function readPreferences(owner: string, now = Date.now()) {
  let raw: unknown = memory
  if (!storageFailed) try { const saved = localStorage.getItem(feedStorageKey); raw = saved && saved.length <= 32768 ? JSON.parse(saved) : null } catch { /* Use bounded memory. */ }
  const value = cleanPreferences(raw, owner, now)
  write(value)
  return value
}
export function feedSnapshot(owner: string, now = Date.now()) {
  const value = readPreferences(owner, now)
  return { interests: value.interests.map(({ at, kind, name, score }) => ({ kind, name, score: score * 2 ** (-(now - at) / (3 * 86400000)) })),
    seen: value.recent.map(item => item.id), previous: value.previous.slice() }
}
export function rememberBatch(owner: string, ids: string[], now = Date.now()) {
  const value = readPreferences(owner, now)
  value.previous = [...new Set(ids.filter(id => idPattern.test(id)))].slice(0, feedLimits.previous); value.previousAt = now
  write(value)
}
export function rememberExposure(owner: string, ids: string[], now = Date.now()) {
  const value = readPreferences(owner, now)
  for (const id of ids) {
    if (!idPattern.test(id) || value.recent.some(item => item.id === id)) continue
    value.recent.push({ id, at: now, actions: 0 })
  }
  value.recent = value.recent.slice(-feedLimits.seen); write(value)
}
const signals = { open: [1, 1], dwell: [2, 2], liked: [4, 3], saved: [8, 5], remix: [16, 6] } as const
export function rememberInterest(owner: string, work: Pick<Work, 'id' | 'kind' | 'tags' | 'status' | 'destination'>, signal: keyof typeof signals, now = Date.now()) {
  if (!['published', 'approved'].includes(work.status) || work.destination === 'source-comment' || !idPattern.test(work.id)) return
  const value = readPreferences(owner, now), [bit, weight] = signals[signal]
  const record = value.recent.find(item => item.id === work.id) ?? { id: work.id, at: now, actions: 0 }
  if (record.actions & bit) return
  record.actions |= bit
  value.recent = [...value.recent.filter(item => item.id !== work.id), record].slice(-feedLimits.seen)
  const names = [...new Set(work.tags)].filter(name => name.trim() && name.length <= 100).slice(0, 3)
  for (const name of names) {
    const old = value.interests.find(item => item.kind === work.kind && item.name === name)
    const score = (old ? old.score * 2 ** (-(now - old.at) / (3 * 86400000)) : 0) + weight / names.length
    value.interests = value.interests.filter(item => item !== old)
    value.interests.push({ kind: work.kind, name, score: Math.min(1000, score), at: now, ...(old?.searchAt ? { searchAt: old.searchAt } : {}) })
  }
  value.interests = value.interests.sort((a, b) => decayed(b, now) - decayed(a, now)).slice(0, feedLimits.tags)
  write(value)
}
export function clearFeedPreferences(owner: string) { write(empty(owner)) }

export function rememberSearchTags(owner: string, query: string, selected: string, tags: { id: string; name: string; category: Work['kind'] }[], kind: string, now = Date.now()) {
  const value = readPreferences(owner, now), needle = query.trim().normalize('NFKC').toLocaleLowerCase()
  const matched = tags.filter(tag => ['image', 'video', 'resource'].includes(tag.category) && (kind === 'all' || kind === tag.category)
    && tag.name.length <= 100 && (selected === tag.name || selected === tag.id || needle.includes(tag.name.normalize('NFKC').toLocaleLowerCase())))
    .filter(tag => tag.name.trim()).sort((a, b) => b.name.length - a.name.length).slice(0, 3)
  for (const tag of matched) {
    const old = value.interests.find(item => item.kind === tag.category && item.name === tag.name)
    if (old?.searchAt && now - old.searchAt < 1800000) continue
    const score = (old ? old.score * 2 ** (-(now - old.at) / (3 * 86400000)) : 0) + 3 / matched.length
    value.interests = value.interests.filter(item => item !== old)
    value.interests.push({ kind: tag.category, name: tag.name, score: Math.min(1000, score), at: now, searchAt: now })
  }
  value.interests = value.interests.sort((a, b) => decayed(b, now) - decayed(a, now)).slice(0, feedLimits.tags)
  write(value)
}
