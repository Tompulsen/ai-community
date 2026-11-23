import { z } from 'zod'
import { chatOptionsSchema, imageOptionsSchema } from './options.ts'
import { usesGeminiImageChat } from './image-params.ts'

export const modelApiFormatSchema = z.enum(['auto', 'chat-completions', 'responses', 'gemini', 'claude', 'images', 'openai'])
export type ModelApiFormat = z.infer<typeof modelApiFormatSchema>
export const modelApiFormats = {
  text: ['chat-completions', 'responses', 'gemini', 'claude'],
  image: ['images', 'chat-completions', 'gemini'],
  video: ['openai'],
} as const
const automaticAspectRatio = z.string().regex(/^(?:auto|[1-9]\d{0,2}:[1-9]\d{0,2})$/)
export const imageModelSettingSchema = z.object({
  autoResolution: imageOptionsSchema.shape.resolution.removeDefault().optional(),
  autoQuality: imageOptionsSchema.shape.quality.removeDefault().optional(),
  autoAspectRatio: automaticAspectRatio.optional(),
  autoBackground: imageOptionsSchema.shape.imageBackground.removeDefault().optional(),
}).strict()
export const textModelSettingSchema = z.object({
  autoReasoningEffort: chatOptionsSchema.shape.reasoningEffort.removeDefault().optional(),
}).strict()

const videoResolutionSchema = z.string().regex(/^(?:4k|[1-9]\d{0,4}p)$/)
  .refine(value => value === '4k' || Number(value.slice(0, -1)) <= 65535)
export const videoModelSettingSchema = z.object({
  autoResolution: z.union([z.literal('auto'), videoResolutionSchema]).optional(),
  resolutions: z.array(videoResolutionSchema).min(1).max(16)
    .refine(values => new Set(values).size === values.length).optional(),
  autoAspectRatio: automaticAspectRatio.optional(),
  parameterFormat: z.enum(['auto', 'openai', 'xai', 'seedance', 'gemini']).optional(),
}).strict().refine(value => !value.resolutions || !value.autoResolution || value.autoResolution === 'auto'
  || value.resolutions.includes(value.autoResolution), { message: '自动分辨率须包含在手动分辨率列表中。' })
export type VideoModelSetting = z.infer<typeof videoModelSettingSchema>

export const modelTypesSchema = z.array(z.object({
  id: z.string().min(1).max(200).refine(id => id === id.trim() && !/[\u0000-\u001f\u007f]/u.test(id)),
  name: z.string().trim().min(1).max(120).refine(value => !/[\u0000-\u001f\u007f]/u.test(value)).optional(),
  tags: z.array(z.string().trim().min(1).max(32).refine(value => !/[\u0000-\u001f\u007f]/u.test(value)))
    .max(12).refine(tags => new Set(tags.map(tag => tag.toLowerCase())).size === tags.length).optional(),
  kind: z.enum(['text', 'image', 'video']),
  apiFormat: modelApiFormatSchema.optional(),
  protocol: z.enum(['auto', 'sync', 'async']).optional(),
  remark: z.string().max(2000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)).optional(),
  image: imageModelSettingSchema.optional(),
  text: textModelSettingSchema.optional(),
  video: videoModelSettingSchema.optional(),
}).strict()
  .refine(value => !value.apiFormat || value.apiFormat === 'auto'
    || (modelApiFormats[value.kind] as readonly string[]).includes(value.apiFormat), { message: '接口格式与模型类型不匹配。' })
  .refine(value => value.kind !== 'text' || value.protocol === undefined, { message: '对话模型不支持图片或视频任务协议。' })
  .refine(value => !(value.kind === 'image' && usesGeminiImageChat(value.id, value.apiFormat) && value.protocol === 'async'), { message: '图片对话接口不支持异步任务协议。' })
  .refine(value => value.kind === 'image' || value.image === undefined, { message: '仅生图模型可配置图片自动参数。' })
  .refine(value => value.kind === 'text' || value.text === undefined, { message: '仅对话模型可配置对话自动参数。' })
  .refine(value => value.kind === 'video' || value.video === undefined, { message: '仅视频模型可配置视频参数。' }))
  .max(500).refine(items => new Set(items.map(item => item.id)).size === items.length)
export type ModelTypeSetting = z.infer<typeof modelTypesSchema>[number]
export function readModelTypes(value: unknown): ModelTypeSetting[] {
  return modelTypesSchema.safeParse(value).data ?? []
}
