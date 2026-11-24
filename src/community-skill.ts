import { api } from './state'
import { verifySkillDocument } from '../shared/studio/catalog'
import { maxSelectedSkills, type SkillKind, type SkillReference } from '../shared/community-skills'
import type { NativeChat, Skill } from './native-chat'
import type { CommunitySkill } from '../shared/community-skills'
export async function resolveCommunitySkill(skill: Skill, expectedAccount?: string, kind: SkillKind = 'text'): Promise<Skill> {
  if ((skill.kind || 'text') !== kind) throw new Error('技能类型已变化，请重新选择适合当前创作类型的技能。')
  if (skill.id.startsWith('work-')) {
    if (!/^work-[a-zA-Z0-9]{1,32}$/.test(skill.id)) throw new Error('技能作品编号或创作类型无效。')
    const { work } = await api<{ work: import('./data').Work }>(`/api/works/${skill.id.slice(5)}`, { expectedAccount })
    if (work.skillReference?.sha256 !== skill.sha256 || (work.generation?.skill?.kind || 'text') !== kind) throw new Error('技能已更新、下架或尚未通过审核，请重新选择。')
    return { ...skill, body: '' }
  }
  if (!skill.id.startsWith('community-')) return skill
  const id = skill.id.slice('community-'.length)
  if (!/^[a-zA-Z0-9]{1,32}$/.test(id)) throw new Error('技能编号无效。')
  const { skill: current } = await api<{ skill: CommunitySkill }>(`/api/skills/${id}`, { expectedAccount })
  if (current.status !== 'published' || (current.kind || 'text') !== kind || !current.body || current.sha256 !== skill.sha256) throw new Error('技能已更新或下架，请刷新技能列表后重新选择。')
  return { ...skill, body: current.body }
}
export function selectedSkillIds(chat: NativeChat, kind: SkillKind) {
  return kind === 'text' ? chat.skillIds : (chat.mediaSkills?.[kind] || []).map(skill => skill.id)
}
export function setSelectedSkillIds(chat: NativeChat, kind: SkillKind, ids: string[], references: SkillReference[] = []) {
  if (kind === 'text') {
    chat.skillIds = ids
    if (chat.remixSkills) chat.remixSkills = chat.remixSkills.filter(skill => ids.includes(skill.id) && !references.some(reference => reference.id === skill.id))
  }
  else {
    const available = [...references, ...(chat.mediaSkills?.[kind] || [])]
    const selected = ids.map(id => {
      const skill = available.find(item => item.id === id)
      if (!skill) throw new Error('技能版本信息缺失，请重新选择。')
      return { ...skill }
    })
    chat.mediaSkills ||= {}
    chat.mediaSkills[kind] = selected
  }
}
export async function resolveRemixSkills(selected: SkillReference[], kind: SkillKind, expectedAccount?: string): Promise<SkillReference[]> {
  if (!selected.length) return []
  const { items } = await api<{ items: Skill[] }>('/api/creation/skills/catalog', { expectedAccount, signal: AbortSignal.timeout(20000) })
  return selected.filter(reference => items.some(skill => skill.id === reference.id && skill.sha256 === reference.sha256 && (skill.kind || 'text') === kind))
    .map(({ id, sha256 }) => ({ id, sha256 }))
}
export async function resolveMediaSkills(selected: SkillReference[], kind: 'image' | 'video', expectedAccount?: string): Promise<SkillReference[]> {
  if (!selected.length) return []
  if (selected.length > maxSelectedSkills) throw new Error(`每次最多选择 ${maxSelectedSkills} 个技能。`)
  const { items } = await api<{ items: Skill[] }>('/api/creation/skills/catalog', { expectedAccount })
  return Promise.all(selected.map(async ({ id, sha256 }) => {
    const skill = items.find(item => item.id === id)
    if (!skill) throw new Error('技能已下架或不可用，请刷新技能列表后重新选择。')
    if (skill.sha256 !== sha256) throw new Error('所选技能已更新，请刷新技能列表并重新勾选后生成。')
    const document = await resolveCommunitySkill(skill, expectedAccount, kind)
    if (!id.startsWith('work-')) await verifySkillDocument(document.body, document.sha256)
    return { id, sha256: document.sha256 }
  }))
}
