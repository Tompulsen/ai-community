import { z } from 'zod'
import { chatOptionsSchema, imageOptionsSchema, videoOptionsSchema } from '../shared/studio/options'
import { modelApiFormatSchema } from '../shared/studio/model-types'

const mediaEntrySchema = z.object({
  owner: z.string().nullable(), kind: z.enum(['image', 'video']),
  prompt: z.string().trim().max(100000),
  parameters: z.object({
    model: z.string().max(200), group: z.string().min(1).max(200).nullable(), tokenId: z.number().int().positive().nullable(),
    ratio: z.string().regex(/^(?:auto|[1-9]\d{0,2}:[1-9]\d{0,2})$/),
    manualSize: z.union([z.literal(''), z.string().regex(/^(?:auto|[1-9]\d{0,4}x[1-9]\d{0,4}|[124]K)$/)]),
    count: z.number().int().min(1).max(16), duration: z.number().int().min(1).max(3600),
    skills: z.array(z.object({ id: z.string().regex(/^(?:community|work)-[a-zA-Z0-9]{1,32}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(10).optional(),
    apiFormat: modelApiFormatSchema.optional(),
    protocol: z.enum(['auto', 'openai', 'sync', 'async']), imageOptions: imageOptionsSchema, videoOptions: videoOptionsSchema,
  }).optional(),
  references: z.array(z.object({ name: z.string(), type: z.string().optional(), size: z.number().nonnegative().optional(), duration: z.number().positive().optional(), durationSeconds: z.number().positive().optional(),
    url: z.string().refine(value => value.startsWith('data:image/') || /^\/legacy-files\/[A-Za-z0-9]{1,32}$/.test(value)) })).max(16),
}).refine(value => Boolean(value.prompt || value.kind === 'video' && value.references.length === 1 && value.references[0]?.type?.startsWith('video/')), '请输入提示词或添加源视频。')
const textEntrySchema = z.object({
  owner: z.string().nullable(), kind: z.literal('text'), prompt: z.string().trim().max(100000),
  parameters: z.object({
    model: z.string().max(200), group: z.string().min(1).max(200).nullable(), tokenId: z.number().int().positive().nullable(),
    apiFormat: z.enum(['auto', 'chat-completions', 'responses', 'gemini', 'claude']).optional(),
    settings: chatOptionsSchema.omit({ messages: true }), system: z.string().max(100000),
    skillIds: z.array(z.string().min(1).max(200)).max(100), search: z.enum(['off', 'quick', 'deep']),
    compressionThreshold: z.number().int().min(500).max(2000000), sendMemory: z.boolean(), toolContext: z.string().max(1000000),
    files: z.array(z.object({ name: z.string().max(300), type: z.string().max(200), size: z.number().nonnegative(), content: z.string().max(28 * 1024 ** 2), isText: z.boolean() })).max(10),
  }),
}).refine(value => Boolean(value.prompt || value.parameters.files.length), '请输入消息或添加附件。')
const entrySchema = z.discriminatedUnion('kind', [mediaEntrySchema, textEntrySchema])
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
