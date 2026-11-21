import { z } from 'zod'

export const feedLimits = { tags: 20, seen: 120, previous: 12, page: 12, tagAge: 7 * 86400000, seenAge: 86400000 } as const
export const feedWeightsSchema = z.object({
  interest: z.number().int().min(0).max(100), fresh: z.number().int().min(0).max(100), explore: z.number().int().min(0).max(100),
}).strict().refine(value => value.interest + value.fresh + value.explore === 100)
export const defaultFeedWeights = { interest: 60, fresh: 25, explore: 15 }
export const readFeedWeights = (value: unknown) => feedWeightsSchema.safeParse(value).data ?? { ...defaultFeedWeights }
const id = z.string().regex(/^[a-zA-Z0-9]{1,32}$/)
export const feedInterestSchema = z.object({
  kind: z.enum(['image', 'video', 'resource']), name: z.string().trim().min(1).max(100).refine(value => !value.includes('\0')),
  score: z.number().finite().min(0).max(1000),
}).strict()
export const feedRequestSchema = z.object({
  sort: z.enum(['recommended', 'latest', 'featured', 'following']).default('recommended'),
  kind: z.enum(['all', 'image', 'video', 'resource']).default('all'),
  query: z.string().max(200).default(''), tag: z.string().max(100).default(''),
  seed: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), cursor: z.string().max(8192).optional(),
  interests: z.array(feedInterestSchema).max(feedLimits.tags).default([]),
  seen: z.array(id).max(feedLimits.seen).default([]), previous: z.array(id).max(feedLimits.previous).default([]),
}).strict()
export type FeedInterest = z.infer<typeof feedInterestSchema>
export type FeedRequest = z.infer<typeof feedRequestSchema>
