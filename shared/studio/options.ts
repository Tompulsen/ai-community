import { z } from 'zod'
export const imageOptionsSchema = z.object({
  resolution: z.enum(['auto', '1k', '2k', '4k']).default('auto'),
  quality: z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']).default('auto'),
  style: z.enum(['natural', 'vivid']).optional(),
  imageOutputFormat: z.enum(['png', 'jpeg', 'webp']).default('png'),
  imageBackground: z.enum(['auto', 'opaque', 'transparent']).default('auto'),
  imageOutputCompression: z.number().int().min(0).max(100).default(100),
  imageResponseFormat: z.enum(['url', 'b64_json']).default('url'),
  imageStream: z.boolean().default(false),
  imagePartialImages: z.number().int().min(0).max(3).default(1),
})
export const videoOptionsSchema = z.object({
  mode: z.enum(['text-to-video', 'image-to-video', 'first-last-frame', 'reference-to-video']),
  resolution: z.string().max(20).default('720p'),
  negativePrompt: z.string().max(32000).default(''),
  openaiReferenceSource: z.enum(['upload', 'image_url', 'file_id']).default('upload'),
  openaiImageUrl: z.string().max(8192).optional(),
  openaiLastImageUrl: z.string().max(8192).optional(),
  openaiFileId: z.string().max(200).optional(),
  customParameters: z.string().max(32000).default(''),
  seed: z.string().max(30).default(''),
  generateAudio: z.boolean().optional(),
  personGeneration: z.enum(['', 'allow_all', 'allow_adult', 'dont_allow']).default(''),
})
const part = z.object({
  type: z.enum(['text', 'image_url', 'video_url', 'input_audio', 'file']),
  text: z.string().max(300000).optional(),
  image_url: z.object({ url: z.string().max(28 * 1024 ** 2) }).optional(),
  video_url: z.object({ url: z.string().max(28 * 1024 ** 2) }).optional(),
  input_audio: z.object({ data: z.string().max(16 * 1024 ** 2), format: z.string().max(40) }).optional(),
  file: z.object({ filename: z.string().max(300), file_data: z.string().max(16 * 1024 ** 2) }).optional(),
})
export const toolCallSchema = z.object({ id: z.string().min(1).max(200), type: z.literal('function'), function: z.object({ name: z.string().regex(/^[\w-]{1,200}$/), arguments: z.string().max(100000) }) })
export const chatOptionsSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.union([z.string().max(1000000), z.array(part).max(50)]), tool_call_id: z.string().max(200).optional(), tool_calls: z.array(toolCallSchema).max(32).optional() })).min(1).max(2000),
  mcpServers: z.array(z.string().regex(/^[\w-]{1,80}$/)).max(8).default([]),
  format: z.enum(['chat-completions', 'responses', 'gemini', 'claude']).default('chat-completions'),
  stream: z.boolean().default(true),
  temperature: z.number().min(0).max(2).default(0.7),
  top_p: z.number().min(0).max(1).default(1),
  max_tokens: z.number().int().min(1).max(1000000).default(4096),
  presence_penalty: z.number().min(-2).max(2).default(0),
  frequency_penalty: z.number().min(-2).max(2).default(0),
  reasoningEffort: z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).default('auto'),
  stop: z.string().max(1000).default(''),
})
export type ImageOptions = z.infer<typeof imageOptionsSchema>
export type VideoOptions = z.infer<typeof videoOptionsSchema>
export type ChatOptions = z.infer<typeof chatOptionsSchema>
