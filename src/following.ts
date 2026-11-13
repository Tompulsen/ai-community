import { reactive, ref, watch } from 'vue'
import { api, session } from './state'
import type { Creator } from './data'

export interface Relationship {
  id: string; followed: boolean; requested?: boolean; followsYou?: boolean; isLocked?: boolean
  followersCount?: number; followingCount?: number; viewerFollowingCount?: number; viewerFollowersCount?: number
}
export const relationships = reactive(new Map<string, Relationship>())
export const followBusy = reactive(new Set<string>())
export const followRevision = ref(0)
const versions = new Map<string, number>()
const operations = new Map<string, AbortController>()
let epoch = 0
watch(() => session.user?.id, () => {
  epoch++; followRevision.value++
  for (const controller of operations.values()) controller.abort()
  operations.clear(); relationships.clear(); followBusy.clear(); versions.clear()
}, { flush: 'sync' })

export function seedRelationships(items: (Creator | Relationship)[], captured = followRevision.value) {
  for (const item of items) if (!followBusy.has(item.id) && (versions.get(item.id) ?? 0) <= captured) {
    relationships.set(item.id, { id: item.id, followed: item.followed, requested: Boolean(item.requested), followsYou: Boolean(item.followsYou),
      isLocked: Boolean(item.isLocked), followersCount: item.followersCount, followingCount: item.followingCount })
  }
}
export async function loadRelationship(id: string, signal?: AbortSignal) {
  const owner = epoch, captured = followRevision.value
  const result = await api<Relationship>(`/api/users/${encodeURIComponent(id)}/relationship`, { signal })
  if (!signal?.aborted && owner === epoch) seedRelationships([result], captured)
  return result
}
export function rememberRelationship(result: Relationship) {
  versions.set(result.id, ++followRevision.value)
  relationships.set(result.id, result)
}
export async function changeRelationship(id: string, active: boolean, removeFollower = false) {
  if (!session.user || followBusy.size) return
  const owner = epoch, account = session.user.accountId || session.user.id
  const controller = new AbortController(); operations.set(id, controller); followBusy.add(id)
  versions.set(id, ++followRevision.value)
  try {
    const result = await api<Relationship>(`/api/users/${encodeURIComponent(id)}/${removeFollower ? 'remove-follower' : 'follow'}`, {
      method: 'POST', body: removeFollower ? {} : { active }, signal: controller.signal, expectedAccount: account,
    })
    if (owner !== epoch || controller.signal.aborted) return
    rememberRelationship(result)
    return result
  } finally {
    if (operations.get(id) === controller) {
      operations.delete(id); followBusy.delete(id); versions.set(id, ++followRevision.value)
    }
  }
}
