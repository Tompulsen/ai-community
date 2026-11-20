import { z } from 'zod'
import { imageOptionsSchema, videoOptionsSchema } from '../shared/studio/options'

const entrySchema = z.object({
  owner: z.string().nullable(), kind: z.enum(['image', 'video']),
  prompt: z.string().trim().min(1).max(100000),
  parameters: z.object({
    model: z.string().max(200), group: z.string().min(1).max(200).nullable(), tokenId: z.number().int().positive().nullable(),
    ratio: z.string().regex(/^(?:auto|[1-9]\d{0,2}:[1-9]\d{0,2})$/),
    manualSize: z.union([z.literal(''), z.string().regex(/^(?:auto|[1-9]\d{0,4}x[1-9]\d{0,4}|[124]K)$/)]),
    count: z.number().int().min(1).max(16), duration: z.number().int().min(1).max(3600),
    protocol: z.enum(['openai', 'async']), imageOptions: imageOptionsSchema, videoOptions: videoOptionsSchema,
  }).optional(),
  references: z.array(z.object({ name: z.string(), url: z.string().startsWith('data:image/') })).max(16),
})
export type StudioEntry = z.infer<typeof entrySchema>
const entryKey = (id: string) => 'ai-community-next:studio-entry:' + id
export function saveStudioEntry(value: StudioEntry) {
  const entry = entrySchema.parse(value), id = crypto.randomUUID()
  try { sessionStorage.setItem(entryKey(id), JSON.stringify(entry)) }
  catch { throw new Error('当前内容无法暂存，请减少参考图后重试。') }
  return id
}
export function readStudioEntry(id: string) {
  const value = sessionStorage.getItem(entryKey(id))
  if (!value) throw new Error('这份创作输入已处理或已失效，请返回首页重新输入。')
  return entrySchema.parse(JSON.parse(value))
}
export function clearStudioEntry(id: string) { sessionStorage.removeItem(entryKey(id)) }
export function armStudioEntryStart(id: string, owner: string) { sessionStorage.setItem(entryKey('start:' + id), owner) }
export function claimStudioEntryStart(id: string, owner: string) {
  const key = entryKey('start:' + id), accepted = sessionStorage.getItem(key) === owner
  sessionStorage.removeItem(key)
  return accepted
}
