import { api } from './state'
import type { Skill } from './native-chat'
import type { CommunitySkill } from '../shared/community-skills'
export async function resolveCommunitySkill(skill: Skill, expectedAccount?: string): Promise<Skill> {
  if (!skill.id.startsWith('community-')) return skill
  const id = skill.id.slice('community-'.length)
  if (!/^[a-zA-Z0-9]{1,32}$/.test(id)) throw new Error('技能编号无效。')
  const { skill: current } = await api<{ skill: CommunitySkill }>(`/api/skills/${id}`, { expectedAccount })
  if (current.status !== 'published' || !current.body || current.sha256 !== skill.sha256) throw new Error('技能已更新或下架，请刷新技能列表后重新选择。')
  return { ...skill, body: current.body }
}
