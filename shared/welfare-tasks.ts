import { z } from 'zod'

const text = (maximum: number) => z.string().trim().max(maximum).refine(value => !value.includes('\0'))
export const publicationRewardSchema = z.object({
  enabled: z.boolean(), threshold: z.number().int().min(1).max(1000000), tickets: z.number().int().min(1).max(1000),
}).strict()
export const defaultPublicationReward = () => ({ enabled: true, threshold: 1, tickets: 1 })
export type PublicationProgress = { date?: string; count: number; rewardedAt: string | null; rewardTickets: number }
export type PublicationStatus = PublicationProgress & { resetsAt: string | null; serverTime: string }
export const welfareTaskSchema = z.object({
  id: z.enum(['invite', 'publish', 'upcoming']), enabled: z.boolean(),
  title: text(40).refine(Boolean), description: text(240), buttonText: text(24).refine(Boolean),
  publicationReward: publicationRewardSchema.optional(),
}).strict().refine(item => item.id === 'publish' || item.publicationReward === undefined)
export const welfareTasksSchema = z.array(welfareTaskSchema).length(3)
  .refine(items => new Set(items.map(item => item.id)).size === 3)
export type WelfareTask = z.infer<typeof welfareTaskSchema>
export const defaultWelfareTasks = (): WelfareTask[] => [
  { id: 'invite', enabled: true, title: '邀请', description: '', buttonText: '查看邀请福利' },
  { id: 'publish', enabled: true, title: '用户发作品', description: '', buttonText: '发布作品', publicationReward: defaultPublicationReward() },
  { id: 'upcoming', enabled: true, title: '敬请期待', description: '更多社区福利正在筹备中。', buttonText: '敬请期待' },
]
export const readWelfareTasks = (value: unknown) => (welfareTasksSchema.safeParse(value).data ?? defaultWelfareTasks())
  .map(item => item.id === 'publish' ? { ...item, publicationReward: item.publicationReward ?? defaultPublicationReward() } : item)
