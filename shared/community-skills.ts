export const skillLimits = { archiveBytes: 5 * 1024 * 1024, expandedBytes: 20 * 1024 * 1024, bodyBytes: 64 * 1024, files: 200, accountBytes: 100 * 1024 * 1024, accountCount: 100 } as const
export const skillStates = { pending: '待审核', published: '已发布', rejected: '未通过', removed: '已下架' } as const
export type SkillStatus = keyof typeof skillStates
export interface SkillFile { path: string; bytes: number }
export interface CommunitySkill {
  id: string; authorId: string; authorName: string; name: string; description: string
  status: SkillStatus; official: boolean; version: number; sha256: string
  filename: string; size: number; files: SkillFile[]; body?: string; reviewNote?: string
  createdAt: string; updatedAt: string
}
export interface SkillList { items: CommunitySkill[]; nextCursor: string | null }
