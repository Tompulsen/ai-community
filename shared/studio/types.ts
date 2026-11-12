// Structural contracts for the reused Octopus Studio modules (MIT).
export interface MultimodalContent {
  type: 'text' | 'image_url' | 'video_url' | 'input_audio' | 'file'
  text?: string
  image_url?: { url: string }
  video_url?: { url: string }
  input_audio?: { data: string; format: string }
  file?: { filename: string; file_data: string }
}
export interface StudioToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface RequestMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | MultimodalContent[]; tool_call_id?: string; tool_calls?: StudioToolCall[] }
export interface ChatResponseUsage { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }
export interface ModelConfig {
  model: string
  temperature?: number
  top_p?: number
  stream?: boolean
  max_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
  reasoningEffort?: import('./chat-params.ts').ReasoningEffort
  stop?: string
  providerName?: string
  size?: string
  resolution?: string
  quality?: string
  style?: string
  imageOutputFormat?: 'png' | 'jpeg' | 'webp'
  imageBackground?: 'auto' | 'opaque' | 'transparent'
  imageOutputCompression?: number
  imageResponseFormat?: 'url' | 'b64_json'
  imageStream?: boolean
  imageRequestMode?: 'sync' | 'async'
  imagePartialImages?: number
}
export type DalleQuality = string
export interface ChatOptions { config: ModelConfig }
export type ChatFetch = (url: string, init?: RequestInit) => Promise<Response>
export interface ChatMessage extends RequestMessage {
  id: string
  parentId?: string
  branchOrder?: number
  streaming?: boolean
  materialStatus?: string
  interrupted?: boolean
  reasoning?: string
  error?: string
  createdAt?: number
  usage?: ChatResponseUsage
}
export interface ChatSession {
  id: string
  topic: string
  messages: ChatMessage[]
  messageBranches?: ChatMessage[]
  branchSelections?: Record<string, string>
  memoryPrompt: string
  lastSummarizeIndex: number
  clearContextIndex?: number
  lastUpdate: number
}
export type VideoGenMode = 'text-to-video' | 'image-to-video' | 'first-last-frame' | 'reference-to-video'
export type VideoAspectRatio = string
export type VideoResolution = string
export type VideoApiFormat = 'openai' | 'xai' | 'seedance' | 'gemini'
export interface VideoDraft {
  apiFormat: VideoApiFormat
  model: string
  mode: VideoGenMode
  prompt: string
  negativePrompt: string
  size: string
  aspectRatio: string
  resolution: string
  duration: number
  materials: { id: string; name: string; type: 'image' | 'video' | 'audio'; url: string }[]
  openaiReferenceSource?: 'upload' | 'image_url' | 'file_id'
  openaiImageUrl?: string
  openaiLastImageUrl?: string
  openaiFileId?: string
  legacyCustomFormat?: Exclude<VideoApiFormat, 'openai'>
  customParams?: Partial<Record<VideoApiFormat, string>>
  protocolOptions?: Partial<Record<VideoApiFormat, { seed?: string; generateAudio?: boolean; personGeneration?: string }>>
}
export interface LocalTask {
  kind: 'image' | 'video'
  upstreamId: string
  protocol?: string
  video?: { apiFormat?: string }
}
