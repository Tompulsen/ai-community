import { z } from 'zod'

export const modelTypesSchema = z.array(z.object({
  id: z.string().min(1).max(200).refine(id => id === id.trim() && !/[\u0000-\u001f\u007f]/u.test(id)),
  kind: z.enum(['text', 'image', 'video']),
}).strict()).max(500).refine(items => new Set(items.map(item => item.id)).size === items.length)
export type ModelTypeSetting = z.infer<typeof modelTypesSchema>[number]
export function readModelTypes(value: unknown): ModelTypeSetting[] {
  return modelTypesSchema.safeParse(value).data ?? []
}
