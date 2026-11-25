export const skillKinds = { text: '文本', image: '图片', video: '视频' } as const
export type SkillKind = keyof typeof skillKinds
export interface SkillReference { id: string; sha256: string }
export function resolveLegacySkillIds(ids: string[], catalog: { id: string; legacyId?: string | null }[]) {
  return [...new Set(ids.map(id => catalog.find(skill => skill.legacyId === id)?.id || id))]
}
interface SkillChoice { id: string; authorId?: string; kind?: SkillKind; sha256?: string; legacyId?: string | null }
export function groupSkillChoices<T extends SkillChoice>(catalog: T[], selectedIds: string[] = []) {
  const groups = new Map<string, T[]>()
  for (const skill of catalog) {
    // Only group invocation choices; source records and their access checks remain independent.
    const key = skill.authorId && skillKinds[skill.kind!] && /^[a-f0-9]{64}$/.test(skill.sha256 || '')
      ? JSON.stringify([skill.authorId, skill.kind, skill.sha256]) : JSON.stringify([skill.id])
    const items = groups.get(key)
    if (items) items.push(skill)
    else groups.set(key, [skill])
  }
  return [...groups.values()].map(items => ({ key: items[0]!.id, items, skill: items.find(skill => selectedIds.includes(skill.id)) || items[0]! }))
}
export function countSkillChoices(ids: string[], catalog: SkillChoice[]) {
  return groupSkillChoices(resolveLegacySkillIds(ids, catalog).map(id => catalog.find(skill => skill.id === id) || { id })).length
}
export const maxSelectedSkills = 10
export function skillInstructions(body: string) { return body.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim() }
export const skillLimits = { archiveBytes: 5 * 1024 * 1024, expandedBytes: 20 * 1024 * 1024, bodyBytes: 64 * 1024, files: 200, accountBytes: 100 * 1024 * 1024, accountCount: 100 } as const
export const skillStates = { pending: '待审核', published: '已发布', rejected: '未通过', removed: '已下架' } as const
export type SkillStatus = keyof typeof skillStates
export interface SkillFile { path: string; bytes: number }
export interface CommunitySkill {
  id: string; authorId: string; authorName: string; name: string; description: string; legacyId?: string | null
  kind: SkillKind; status: SkillStatus; official: boolean; version: number; sha256: string
  filename: string; size: number; files: SkillFile[]; body?: string; reviewNote?: string
  createdAt: string; updatedAt: string
}
export interface SkillList { items: CommunitySkill[]; nextCursor: string | null }
