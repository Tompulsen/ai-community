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

const videoResolutionSchema = z.string().regex(/^(?:2k|4k|[1-9]\d{0,4}p)$/)
  .refine(value => value === '2k' || value === '4k' || Number(value.slice(0, -1)) <= 65535)
const videoResolutionsSchema = z.array(videoResolutionSchema).min(1).max(16)
  .refine(values => new Set(values).size === values.length)
const videoDurationSchema = z.number().int().min(1).max(3600)
const videoDurationsSchema = z.array(videoDurationSchema).min(1).max(3600)
  .refine(values => new Set(values).size === values.length)
const videoAspectRatioSchema = z.string().regex(/^[1-9]\d{0,2}:[1-9]\d{0,2}$/)
const videoModeLimitsSchema = z.object({
  resolutions: videoResolutionsSchema.optional(),
  durations: videoDurationsSchema.optional(),
}).strict()
const videoSizeSchema = z.string().regex(/^[1-9]\d{0,4}x[1-9]\d{0,4}$/)
  .refine(value => value.split('x').every(dimension => Number(dimension) <= 65534 && Number(dimension) % 2 === 0),
    { message: '视频精确宽高须为 2 至 65534 的偶数。' })
export const videoModelSettingSchema = z.object({
  operation: z.enum(['generate', 'upscale']).optional(),
  sendSize: z.boolean().optional(),
  resolutionValues: z.record(videoResolutionSchema, z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/))
    .refine(values => Object.keys(values).length > 0 && Object.keys(values).length <= 16
      && new Set(Object.values(values)).size === Object.keys(values).length).optional(),
  autoResolution: z.union([z.literal('auto'), videoResolutionSchema]).optional(),
  resolutions: videoResolutionsSchema.optional(),
  durations: videoDurationsSchema.optional(),
  autoDuration: videoDurationSchema.optional(),
  aspectRatios: z.array(videoAspectRatioSchema).min(1).max(32)
    .refine(values => new Set(values).size === values.length).optional(),
  sizes: z.record(videoResolutionSchema, z.record(videoAspectRatioSchema, videoSizeSchema))
    .refine(values => Object.keys(values).length > 0 && Object.keys(values).length <= 16
      && Object.values(values).every(ratios => Object.keys(ratios).length > 0 && Object.keys(ratios).length <= 32))
    .optional(),
  unsupportedParameters: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/)).max(32)
    .refine(values => new Set(values).size === values.length).optional(),
  modes: z.object({
    'text-to-video': videoModeLimitsSchema.optional(),
    'image-to-video': videoModeLimitsSchema.optional(),
    'first-last-frame': videoModeLimitsSchema.optional(),
    'reference-to-video': videoModeLimitsSchema.optional(),
  }).strict().optional(),
  autoAspectRatio: automaticAspectRatio.optional(),
  parameterFormat: z.enum(['auto', 'openai', 'xai', 'seedance', 'gemini']).optional(),
}).strict().refine(value => !value.resolutions || !value.autoResolution || value.autoResolution === 'auto'
  || value.resolutions.includes(value.autoResolution), { message: '自动分辨率须包含在手动分辨率列表中。' })
  .refine(value => !value.durations || value.autoDuration === undefined || value.durations.includes(value.autoDuration),
    { message: '默认时长须包含在可选时长列表中。', path: ['autoDuration'] })
  .refine(value => !value.aspectRatios || !value.autoAspectRatio || value.autoAspectRatio === 'auto'
    || value.aspectRatios.includes(value.autoAspectRatio),
    { message: '自动画面比例须包含在可选画面比例列表中。', path: ['autoAspectRatio'] })
  .refine(value => !value.sizes || Object.entries(value.sizes).every(([resolution, ratios]) =>
    resolution !== '2k' && (!value.resolutions || value.resolutions.includes(resolution))
    && Object.entries(ratios).every(([ratio, size]) => (!value.aspectRatios || value.aspectRatios.includes(ratio))
      && Math.min(...size.split('x').map(Number)) === (resolution === '4k' ? 2160 : Number(resolution.slice(0, -1)))))
    && (!value.resolutions || value.resolutions.every(resolution => value.sizes![resolution]
      && (!value.aspectRatios || value.aspectRatios.every(ratio => value.sizes![resolution]![ratio])))),
    { message: '精确尺寸须与可选分辨率和画面比例对应，宽高短边须匹配分辨率。', path: ['sizes'] })
  .refine(value => !value.sizes || (!value.autoResolution || value.autoResolution === 'auto' || !!value.sizes[value.autoResolution])
    && (!value.autoAspectRatio || value.autoAspectRatio === 'auto'
      || Object.values(value.sizes).every(ratios => !!ratios[value.autoAspectRatio!]))
    && (value.aspectRatios || Object.values(value.sizes).every(ratios => {
      const expected = Object.keys(Object.values(value.sizes!)[0]!)
      return Object.keys(ratios).length === expected.length && expected.every(ratio => Object.hasOwn(ratios, ratio))
    })),
    { message: '精确尺寸须包含自动分辨率和画面比例，各分辨率须有完整的画面比例。', path: ['sizes'] })
  .refine(value => !value.resolutionValues || !value.resolutions
    || Object.keys(value.resolutionValues).every(resolution => value.resolutions!.includes(resolution)),
    { message: '分辨率字段映射须对应可选分辨率。', path: ['resolutionValues'] })
  .refine(value => value.sendSize !== false || !value.sizes,
    { message: '不发送像素尺寸时，请清空精确尺寸配置。', path: ['sizes'] })
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
