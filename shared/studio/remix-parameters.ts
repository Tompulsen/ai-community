import { z } from 'zod'
import { imageOptionsSchema, videoOptionsSchema, chatOptionsSchema } from './options.ts'

// Public recipes never contain account credentials, chat history or private media references.
type OptionalShape<S extends z.ZodRawShape> = { [K in keyof S]: z.ZodOptional<S[K] extends z.ZodDefault<infer T> ? T : S[K]> }
function publicOptions<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const shape = Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => {
    const validator = field as z.ZodType
    return [key, z.optional(validator instanceof z.ZodDefault ? validator.removeDefault() : validator)]
  }))
  return z.object(shape as OptionalShape<S>)
}
const customKeys = new Set(['seed', 'steps', 'cfg_scale', 'guidance_scale', 'fps', 'num_frames', 'motion_strength', 'motion_bucket_id', 'camera_fixed', 'watermark', 'generate_audio', 'duration', 'width', 'height', 'aspect_ratio', 'size', 'resolution', 'negative_prompt', 'negativePrompt', 'personGeneration', 'enhance_prompt', 'safety_tolerance'])
const customParameters = z.string().max(32000).transform((value, ctx) => {
  if (!value.trim()) return ''
  try {
    const raw = JSON.parse(value)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error()
    const clean = (object: Record<string, unknown>) => Object.fromEntries(Object.entries(object).filter(([key, item]) =>
      customKeys.has(key) && (typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)
        || typeof item === 'string' && item.length <= 32000 && !/(?:https?:\/\/|data:|sk-[a-z0-9]{12})/i.test(item))))
    const result = { ...clean(raw), ...(raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? { metadata: clean(raw.metadata) } : {}) }
    return Object.keys(result).length ? JSON.stringify(result) : ''
  } catch {
    ctx.addIssue({ code: 'custom', message: '自定义生成参数须为有效 JSON 对象。' })
    return z.NEVER
  }
})
export const remixParametersSchema = z.object({
  version: z.literal(1),
  kind: z.enum(['image', 'video', 'text']),
  group: z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/).optional(),
  protocol: z.enum(['openai', 'sync', 'async']).optional(),
  size: z.string().regex(/^(?:auto|[1-9]\d{0,4}x[1-9]\d{0,4}|(?:1|2|4)K)$/).optional(),
  aspect_ratio: z.string().regex(/^(?:auto|[1-9]\d{0,2}:[1-9]\d{0,2})$/).optional(),
  n: z.number().int().min(1).max(16).optional(),
  duration: z.number().positive().max(3600).optional(),
  imageOptions: publicOptions(imageOptionsSchema).optional(),
  videoOptions: publicOptions(videoOptionsSchema.omit({ openaiReferenceSource: true, openaiImageUrl: true, openaiLastImageUrl: true, openaiFileId: true, customParameters: true })).extend({ customParameters: customParameters.optional() }).optional(),
  chatOptions: publicOptions(chatOptionsSchema.omit({ messages: true, mcpServers: true })).optional(),
}).superRefine((value, ctx) => {
  if (value.kind !== 'image' && value.imageOptions || value.kind !== 'video' && value.videoOptions || value.kind !== 'text' && value.chatOptions)
    ctx.addIssue({ code: 'custom', message: '生成参数与作品类型不匹配。' })
})
export type RemixParameters = z.infer<typeof remixParametersSchema>
export function readRemixParameters(value: unknown) {
  const result = remixParametersSchema.safeParse(value)
  return result.success ? result.data : undefined
}
