/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Path and task-state rules adapted from studio/app/utils/{video-api,local-tasks}.ts.
 */

export type CreationKind = 'image' | 'video' | 'text'
export type CreationProtocol = 'openai' | 'sync' | 'async'
export type CreationTaskProtocol = CreationProtocol | 'legacy' | 'plugin' | 'seedance' | 'gemini' | 'xai'
export interface CreationInput {
  kind: CreationKind
  model: string
  prompt: string
  size?: string
  aspect_ratio?: string
  n?: number
  duration?: number
  referenceUrls?: string[]
  sourceWorkId?: string
  requestId?: string
  protocol?: CreationProtocol
}
export interface CreationOutput { url?: string; b64_json?: string; text?: string }
export interface CreationPayload { path: string; body: string | FormData; contentType?: 'application/json' }
export interface CreationReference { blob: Blob; name?: string }
export interface CreationTask {
  id?: string
  upstreamId?: string
  status: 'pending' | 'succeeded' | 'failed' | 'indeterminate' | 'save_failed' | 'expired'
  progress?: number
  outputs: CreationOutput[]
  error?: string
  mediaPath?: string
}

const taskIdPattern = /^[A-Za-z0-9_-]{1,200}$/
const operationPattern = /^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9_-]+$/
const successStates = new Set(['completed', 'succeeded', 'success', 'done'])
const failedStates = new Set(['failed', 'failure', 'error', 'cancelled', 'canceled'])
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400, code: 'INVALID_CREATION_REQUEST' })
}
function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
}
function referenceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 32 * 1024 * 1024) return false
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value)) return true
  if (/^\/legacy-files\/[A-Za-z0-9_-]{1,200}(?:\?variant=(?:thumbnail|web))?$/.test(value)) return true
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}

export function validateCreationInput(value: unknown): CreationInput {
  if (!record(value) || !['image', 'video', 'text'].includes(String(value.kind))) invalid('请选择有效的创作类型。')
  if (!boundedText(value.model, 200) || !value.model.trim() || /[\r\n]/.test(value.model)) invalid('请选择有效的模型。')
  if (!boundedText(value.prompt, 100000) || !value.prompt.trim()) invalid('请填写提示词。')
  const result: CreationInput = { kind: value.kind as CreationKind, model: value.model.trim(), prompt: value.prompt }
  if (value.size !== undefined) {
    if (typeof value.size !== 'string' || !/^(?:auto|[1-9]\d{0,4}x[1-9]\d{0,4}|(?:1|2|4)K)$/.test(value.size)) invalid('图片或视频尺寸无效。')
    result.size = value.size
  }
  if (value.aspect_ratio !== undefined) {
    if (typeof value.aspect_ratio !== 'string' || !/^(?:auto|[1-9]\d{0,2}:[1-9]\d{0,2})$/.test(value.aspect_ratio)) invalid('画面比例无效。')
    result.aspect_ratio = value.aspect_ratio
  }
  if (value.n !== undefined) {
    if (typeof value.n !== 'number' || !Number.isInteger(value.n) || value.n < 1 || value.n > 16) invalid('生成数量须为 1 至 16。')
    result.n = value.n
  }
  if (value.duration !== undefined) {
    if (typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 3600) invalid('视频时长无效。')
    result.duration = value.duration
  }
  if (value.referenceUrls !== undefined) {
    if (!Array.isArray(value.referenceUrls) || value.referenceUrls.length > (result.kind === 'video' ? 10 : 16)
      || value.referenceUrls.some(item => !referenceUrl(item))) invalid('参考图须为有效图片，且不能超过数量限制。')
    result.referenceUrls = value.referenceUrls
  }
  if (value.sourceWorkId !== undefined) {
    if (typeof value.sourceWorkId !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(value.sourceWorkId)) invalid('同款作品编号无效。')
    result.sourceWorkId = value.sourceWorkId
  }
  if (value.requestId !== undefined) {
    if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.requestId)) invalid('请求编号无效。')
    result.requestId = value.requestId
  }
  if (value.protocol !== undefined) {
    if (!['openai', 'sync', 'async'].includes(String(value.protocol))) invalid('生成协议无效。')
    if (result.kind === 'text' && value.protocol === 'async') invalid('文本生成不支持此异步接口。')
    result.protocol = value.protocol as CreationProtocol
  }
  return result
}

function referenceFiles(input: CreationInput, prepared: CreationReference[]): CreationReference[] {
  const references = input.referenceUrls ?? []
  if (prepared.length) {
    if (prepared.length !== references.length) invalid('参考图尚未完整载入。')
    return prepared
  }
  return references.map((url, index) => {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(url)
    if (!match) invalid('请先通过安全媒体接口载入参考图。')
    return { blob: new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), name: `reference-${index}.${match[1].split('/')[1]}` }
  })
}

/** Reuses the existing image-generation and video-api request shapes without provider fallback. */
export function buildCreationPayload(input: CreationInput, preparedReferences: CreationReference[] = []): CreationPayload {
  const json = (path: string, value: Record<string, unknown>): CreationPayload => ({
    path, body: JSON.stringify(value), contentType: 'application/json',
  })
  const references = input.referenceUrls ?? []
  if (input.kind === 'text') {
    return json('v1/chat/completions', { model: input.model, messages: [{ role: 'user', content: input.prompt }], stream: false })
  }
  if (input.kind === 'image') {
    if (Array.from(input.prompt).length > 32000) invalid('生图提示词不能超过 32,000 个字符。')
    if (/^gemini-(?:.*-)?(?:image|nano-banana)(?:-|$)/.test(input.model.toLowerCase().split('/').pop() ?? '')) {
      if (input.protocol === 'async') invalid('此 Gemini 图片模型使用对话接口，不支持异步图片协议。')
      if ((input.n ?? 1) !== 1) invalid('此 Gemini 图片接口每次只能提交一张，不能隐式重复付费请求。')
      const content = references.length ? [{ type: 'text', text: input.prompt },
        ...references.map(url => ({ type: 'image_url', image_url: { url } }))] : input.prompt
      return json('v1/chat/completions', { model: input.model, messages: [{ role: 'user', content }], stream: false })
    }
    const payload = { model: input.model, prompt: input.prompt, n: input.n ?? 1, size: input.size ?? 'auto', response_format: 'url' }
    if (!references.length) return json(input.protocol === 'async' ? 'async-images/v1/tasks' : 'v1/images/generations', payload)
    const body = new FormData()
    for (const [key, value] of Object.entries(payload)) body.set(key, String(value))
    for (const file of referenceFiles(input, preparedReferences)) body.append('image[]', file.blob, file.name ?? 'reference.png')
    return { path: input.protocol === 'async' ? 'async-images/v1/edits' : 'v1/images/edits', body }
  }
  if ((input.n ?? 1) !== 1) invalid('视频任务需逐个提交，不能隐式重复付费请求。')
  const path = input.protocol === 'async' ? 'async-videos/v1/tasks' : 'v1/videos'
  const seconds = String(input.duration ?? 5)
  const ratio = input.aspect_ratio === 'auto' ? '16:9' : input.aspect_ratio ?? '16:9'
  const size = input.size && input.size !== 'auto' ? input.size : undefined
  const base = { model: input.model, prompt: input.prompt, seconds }
  // Existing videoParameterFormat recognizes vendor parameter families behind /v1/videos.
  if (/seedance/i.test(input.model)) {
    return json(path, { ...base, metadata: { ratio,
      content: references.map(url => ({ type: 'image_url', image_url: { url }, role: 'reference_image' })) } })
  }
  if (/grok|grok-imagine-video/i.test(input.model)) {
    const extensions = { aspect_ratio: ratio,
      ...(references.length > 1 ? { reference_images: references.map(url => ({ url })) } : {}) }
    return json(path, { ...base, ...(references.length === 1 ? { input_reference: references[0] } : {}),
      ...extensions, metadata: extensions })
  }
  if (/veo/i.test(input.model)) {
    const files = referenceFiles(input, preparedReferences)
    const images = files.length ? files.map(file => file.blob) : []
    // The caller may prepare a remote image, but Veo's JSON needs its original Base64 bytes.
    if (images.length && references.some(url => !url.startsWith('data:image/'))) {
      invalid('Veo 参考图须先转换为图片 Base64。')
    }
    return json(path, { ...base, ...(references.length ? { images: references } : {}), metadata: { aspectRatio: ratio } })
  }
  const metadata = { aspect_ratio: ratio }
  if (references.length > 1) {
    return json(path, { ...base, ...(size ? { size } : {}), images: references,
      metadata: { ...metadata, reference_images: references.map(url => ({ url })) } })
  }
  const body = new FormData()
  for (const [key, value] of Object.entries(base)) body.set(key, value)
  if (size) body.set('size', size)
  body.set('metadata', JSON.stringify(metadata))
  const file = referenceFiles(input, preparedReferences)[0]
  if (file) body.set('input_reference', file.blob, file.name ?? 'reference.png')
  return { path, body }
}

/** Accept only the existing relay surface; never allow an arbitrary upstream URL. */
export function creationRelayPath(method: string, path: string): string | null {
  if (!['GET', 'HEAD', 'POST'].includes(method) || typeof path !== 'string' || /[\\%\u0000-\u0020\u007f]/.test(path)) return null
  if (method === 'GET' || method === 'HEAD') {
    if (/^v1\/models$/.test(path) || /^v1\/images\/generations\?task_id=[A-Za-z0-9_-]{1,200}$/.test(path)
      || /^async-(?:images|videos)\/v1\/tasks\/[A-Za-z0-9_-]{1,200}$/.test(path)
      || /^v1\/videos\/[A-Za-z0-9_-]{1,200}(?:\/content)?$/.test(path)
      || /^v1\/tasks\/[A-Za-z0-9_-]{1,200}(?:\/artifacts(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}\/content)?)?$/.test(path)
      || /^api\/v3\/contents\/generations\/tasks\/[A-Za-z0-9_-]{1,200}$/.test(path)
      || /^v1beta\/models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9_-]+$/.test(path)
      || /^v1beta\/files\/[A-Za-z0-9_-]{1,200}:download\?alt=media$/.test(path)) return path
    return null
  }
  return /^(?:v1\/(?:chat\/completions|responses|images\/(?:generations|edits|variations)|videos(?:\/generations)?)|async-(?:images|videos)\/v1\/(?:tasks|edits))$/.test(path)
    && !/^async-videos\/v1\/edits$/.test(path) ? path : null
}

/** Historical task recovery uses the original protocol and only GET requests. */
export function creationTaskPath(kind: 'image' | 'video', id: string, protocol: CreationTaskProtocol = 'async'): string {
  if (kind !== 'image' && kind !== 'video') invalid('任务类型无效。')
  if (protocol === 'gemini' && kind === 'video') {
    if (!operationPattern.test(id)) invalid('视频任务编号无效。')
    return `v1beta/${id}`
  }
  if (!taskIdPattern.test(id)) invalid('任务编号无效。')
  if (protocol === 'async') return `async-${kind === 'image' ? 'images' : 'videos'}/v1/tasks/${id}`
  if (kind === 'image') return `v1/images/generations?task_id=${id}`
  if (protocol === 'seedance') return `api/v3/contents/generations/tasks/${id}`
  return `v1/${protocol === 'plugin' ? 'tasks' : 'videos'}/${id}`
}

function publicUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? value : undefined
  } catch { return undefined }
}
function imageUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(value)) return value
  return publicUrl(value)
}
function output(item: unknown): CreationOutput | undefined {
  if (!record(item)) return undefined
  const url = imageUrl(item.url)
  const b64 = typeof item.b64_json === 'string' && item.b64_json.length > 0 ? item.b64_json : undefined
  const embedded = b64?.startsWith('data:') ? imageUrl(b64) : undefined
  return url ? { url } : embedded ? { url: embedded } : b64 && !b64.startsWith('data:') ? { b64_json: b64 } : undefined
}
/** Keeps image blocks and Markdown results accepted by the existing Studio chat renderer. */
function chatImageOutputs(data: Record<string, unknown>): CreationOutput[] {
  if (!Array.isArray(data.choices)) return []
  const results: CreationOutput[] = []
  for (const choice of data.choices) {
    const content = record(choice) && record(choice.message) ? choice.message.content : undefined
    const parts = Array.isArray(content) ? content : [content]
    for (const part of parts) {
      if (record(part) && part.type === 'image_url') {
        const url = imageUrl(record(part.image_url) ? part.image_url.url : part.image_url)
        if (url) results.push({ url })
      }
      const text = typeof part === 'string' ? part : record(part) && typeof part.text === 'string' ? part.text : ''
      for (const match of text.matchAll(/!\[[^\]\r\n]*\]\(([^()\r\n]+)\)/g)) {
        const url = imageUrl(match[1])
        if (url) results.push({ url })
        if (results.length >= 16) return results
      }
      if (results.length >= 16) return results
    }
  }
  return results
}

/** A URL attached to a running task is a preview, never a completed result. */
export function normalizeCreationTask(kind: CreationKind, value: unknown, taskId?: string, protocol: CreationTaskProtocol = 'legacy'): CreationTask {
  const envelope = record(value) ? value : {}
  const data = record(envelope.data) ? envelope.data : envelope
  const rawId = data.task_id ?? data.id ?? data.request_id ?? data.name ?? taskId
  const id = typeof rawId === 'string' && (taskIdPattern.test(rawId) || operationPattern.test(rawId)) ? rawId : undefined
  const result: CreationTask = { ...(id ? { id, upstreamId: id } : {}), status: 'pending', outputs: [] }
  let state = String(data.status ?? '').toLowerCase()
  const progress = typeof data.progress === 'string' ? Number(data.progress.replace(/%$/, '')) : data.progress
  if (typeof progress === 'number' && Number.isFinite(progress)) result.progress = Math.max(0, Math.min(100, progress))
  const error = typeof data.error === 'string' ? data.error : record(data.error) && typeof data.error.message === 'string'
    ? data.error.message : typeof data.fail_reason === 'string' ? data.fail_reason : typeof data.message === 'string' ? data.message : undefined
  if (['save_failed', 'indeterminate', 'expired'].includes(state)) {
    result.status = state as CreationTask['status']
    result.error = error || (state === 'save_failed' ? '生成已完成，但保存失败；请保留记录并核对，勿重复生成。'
      : state === 'expired' ? '任务或文件已过期。' : '生成结果尚无法确认，请保留记录并核对，勿重复生成。')
    return result
  }
  if (failedStates.has(state) || data.error || data.fail_reason) {
    result.status = 'failed'
    result.error = error || '生成失败。'
    return result
  }
  if (kind === 'video' && protocol === 'gemini') {
    if (data.done !== true) return result
    state = 'completed'
    const response = record(data.response) ? data.response : {}
    const generated = record(response.generateVideoResponse) ? response.generateVideoResponse : {}
    const samples = Array.isArray(generated.generatedSamples) ? generated.generatedSamples : response.generatedVideos
    const sample = Array.isArray(samples) && record(samples[0]) ? samples[0] : {}
    const video = record(sample.video) ? sample.video : {}
    const file = typeof video.uri === 'string' ? /\/files\/([A-Za-z0-9_-]{1,200})(?::download)?(?:\?|$)/.exec(video.uri) : null
    if (file) result.mediaPath = `v1beta/files/${file[1]}:download?alt=media`
  }
  const images = Array.isArray(data.data) ? data.data.flatMap(item => output(item) ?? [])
    : kind === 'image' ? chatImageOutputs(data) : []
  const text = kind === 'text' && Array.isArray(data.choices)
    ? data.choices.flatMap(item => record(item) && record(item.message) && typeof item.message.content === 'string' ? [item.message.content] : []).join('')
    : kind === 'text' && typeof data.output_text === 'string' ? data.output_text : undefined
  const video = publicUrl(data.video_url) || (record(data.video) ? publicUrl(data.video.url) : undefined)
    || (record(data.output) ? publicUrl(data.output.url) : undefined)
    || (record(data.content) ? publicUrl(data.content.video_url) : undefined)
  const direct = publicUrl(data.url) || (record(data.result) ? publicUrl(data.result.url) : undefined)
  const isSynchronous = !state && (kind === 'text' && text !== undefined
    || kind === 'image' && (images.length > 0 || !id && direct !== undefined)
    || kind === 'video' && protocol === 'xai' && video !== undefined)
  if (!successStates.has(state) && !isSynchronous) return result
  result.status = 'succeeded'
  result.outputs = text !== undefined ? [{ text }] : images.length ? images : video ? [{ url: video }] : direct ? [{ url: direct }] : []
  if (kind === 'video' && protocol === 'openai' && id) result.mediaPath = `videos/${id}/content`
  if (kind === 'video' && protocol === 'plugin' && id && taskIdPattern.test(id) && Array.isArray(data.artifacts)) {
    const artifact = data.artifacts.find(item => record(item)
      && (item.type === 'video' || typeof item.mime_type === 'string' && item.mime_type.startsWith('video/'))
      && typeof item.key === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}$/.test(item.key))
    if (record(artifact)) result.mediaPath = `tasks/${id}/artifacts/${artifact.key}/content`
  }
  if (!result.outputs.length && !result.mediaPath) {
    result.status = 'indeterminate'
    result.error = '上游任务已结束，但没有可读取的结果；请保留记录并核对，勿重复生成。'
  }
  return result
}
