import type { Work } from './data'
import type { FeedRequest } from '../shared/recommendation'

// Only the current list survives a trip to a work; never persisted or sent to a server.
export let discoveryCache: { owner: string; path: string; position: number; works: Work[]; cursor: string | null; batch: FeedRequest; scroll: number; at: number } | undefined
export function saveDiscoveryCache(value: typeof discoveryCache) { discoveryCache = value }
