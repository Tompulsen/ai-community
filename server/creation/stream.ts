// Uses the existing Studio parsers; no retry or provider fallback.
import { getLines, getMessages } from '@fortaine/fetch-event-source/parse'
import { readImageStream } from '../../shared/studio/image-response.ts'
import { createChatStreamParser, extractChatReasoning } from '../../shared/studio/chat-formats.ts'
import { createReasoningStream } from '../../shared/studio/reasoning-stream.ts'
import { extractResponseUsage } from '../../shared/studio/response-usage.ts'
import type { CreationInput, CreationTask } from '../creation-contract.ts'
import { toolCallSchema } from '../../shared/studio/options.ts'
import { usesGeminiImageChat } from '../../shared/studio/image-params.ts'
import { normalizeCreationTask } from '../creation-contract.ts'
import { generationErrorCode, insufficientCreditsCode, insufficientCreditsMessage, isInsufficientCredits } from '../../shared/studio/insufficient-credits.ts'
import { isModelBusy, modelBusyCode, modelBusyMessage } from '../../shared/studio/model-busy.ts'

export type CreationEvent = { type: string; [key: string]: unknown }
export class GenerationStreamError extends Error {
  partial: CreationTask
  constructor(cause: unknown, partial: CreationTask, toolProgress = false) {
    const busy = isModelBusy(cause)
    const hasContent = partial.outputs.some(output => output.text) || partial.reasoning
    super(isInsufficientCredits(cause) ? insufficientCreditsMessage : busy ? modelBusyMessage
      : hasContent ? '流式回答中断，已保留已生成内容，请先核对消费记录。' : '流式回答中断，未收到完整回答，请先核对消费记录。', { cause })
    this.partial = partial
    this.partial.errorCode = isInsufficientCredits(cause) ? insufficientCreditsCode : busy ? modelBusyCode : generationErrorCode
    if (busy) {
      this.partial.errorStatus = 429
      if (!hasContent && !partial.usage?.outputTokens && !toolProgress) this.partial.status = 'failed'
    }
  }
}
async function readChatImageStream(response: Response, emit: (event: CreationEvent) => void, native = false): Promise<CreationTask> {
  if (!response.body) throw new Error('生图流式响应为空。')
  let text = '', complete = false, bytes = 0
  const parts: unknown[] = [], previews = new Set<string>()
  let failure: CreationTask | undefined
  const result = () => normalizeCreationTask('image', native ? { candidates: [{ content: { parts: [{ text }, ...parts] } }] }
    : { choices: [{ message: { content: [{ type: 'text', text }, ...parts] } }] })
  const parser = getLines(getMessages(message => {
    if (!message.data) return
    if (message.data === '[DONE]') { if (!native) complete = true; return }
    const data = JSON.parse(message.data)
    const streamFailure = data.error || data.response?.error
    if (streamFailure) throw Object.assign(new Error(isInsufficientCredits(streamFailure) ? insufficientCreditsMessage : typeof streamFailure === 'string' ? streamFailure : streamFailure.message || '生成失败。'), { errorCode: isInsufficientCredits(streamFailure) ? insufficientCreditsCode : generationErrorCode })
    let nativePreview = false
    if (native) {
      const candidate = data.candidates?.[0]
      const parsed = normalizeCreationTask('image', data)
      if (parsed.status === 'failed') failure = parsed
      if (candidate?.finishReason || data.promptFeedback?.blockReason) complete = true
      if (Array.isArray(candidate?.content?.parts)) for (const part of candidate.content.parts) {
        if (part?.thought) continue
        if (typeof part?.text === 'string') { text += part.text; nativePreview ||= part.text.includes(')') }
        else { parts.push(part); nativePreview = true }
      }
    } else {
      const choice = data.choices?.[0], delta = choice?.delta ?? choice?.message
      if (choice?.finish_reason) complete = true
      if (typeof delta?.content === 'string') text += delta.content
      else if (Array.isArray(delta?.content)) parts.push(...delta.content)
      if (Array.isArray(delta?.images)) parts.push(...delta.images)
    }
    if (parts.length > 64) throw new Error('图片流式内容超过限制。')
    if (!failure && (native ? nativePreview : parts.length || text.includes(')'))) {
      for (const output of result().outputs) if (output.url && !previews.has(output.url)) {
        previews.add(output.url)
        emit({ type: 'preview', url: output.url })
      }
    }
  }))
  const reader = response.body.getReader()
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 40 * 1024 ** 2) throw new Error('流式内容超过限制。')
      parser(chunk.value)
    }
    parser(new TextEncoder().encode('\n\n'))
    if (failure) return failure
    const final = result()
    if (!complete || !final.outputs.length) throw new Error('生图流式响应已中断或未返回最终图片，请先核对原任务。')
    return final
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
}
export async function readGenerationStream(response: Response, input: CreationInput, emit: (event: CreationEvent) => void,
  options: { signal?: AbortSignal; progress?: () => void; intervalMs?: number } = {}): Promise<CreationTask> {
  if (input.kind === 'image') {
    if (usesGeminiImageChat(input.model, input.apiFormat)) return readChatImageStream(response, emit, input.apiFormat === 'gemini')
    let images: string[] = []
    await readImageStream(response, url => emit({ type: 'preview', url }), values => { images = values })
    return { status: 'succeeded', outputs: images.map(url => ({ url })) }
  }
  if (!response.body) throw new Error('流式响应为空。')
  const format = input.chatOptions?.format ?? 'chat-completions'
  let text = '', reasoning = '', complete = false, terminal = false, usage: CreationTask['usage'], bytes = 0, toolProgressSeen = false
  const native = format !== 'chat-completions' ? createChatStreamParser(format, value => { usage = value }) : undefined
  const thinking = createReasoningStream()
  const toolCalls = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>()
  let timer: ReturnType<typeof setTimeout> | undefined, dirty = false, emitted = false
  const flush = () => {
    clearTimeout(timer); timer = undefined
    if (!dirty) return
    dirty = false; emitted = true
    emit({ type: 'delta', text, reasoning, usage })
  }
  const changed = () => {
    dirty = true
    if (!emitted) flush()
    else timer ??= setTimeout(flush, options.intervalMs ?? 75)
  }
  const parser = getLines(getMessages(message => {
    if (!message.data || terminal) return
    if (message.data === '[DONE]') { if (!complete) options.progress?.(); complete = true; terminal = true; return }
    const data = JSON.parse(message.data)
    const streamFailure = data.error || data.response?.error
    if (streamFailure) throw Object.assign(new Error(isInsufficientCredits(streamFailure) ? insufficientCreditsMessage : typeof streamFailure === 'string' ? streamFailure : streamFailure.message || '生成失败。'), { errorCode: isInsufficientCredits(streamFailure) ? insufficientCreditsCode : isModelBusy(streamFailure) ? modelBusyCode : generationErrorCode })
    const previousText = text.length, previousReasoning = reasoning.length, previousUsage = usage, wasComplete = complete
    let toolProgress = false
    if (native) {
      const delta = native(message.data)
      if (delta.error) throw new Error(delta.error)
      if (delta.isThinking) reasoning += delta.content
      else text += delta.content
      reasoning += delta.reasoning ?? ''
      if (delta.done) complete = true
      terminal = delta.done === true
      if (data.type === 'response.incomplete') throw new Error('模型未能完整生成回答。')
      toolProgress = data.type === 'response.function_call_arguments.delta' && typeof data.delta === 'string' && !!data.delta
        || data.delta?.type === 'input_json_delta' && typeof data.delta.partial_json === 'string' && !!data.delta.partial_json
    } else {
      const choice = data.choices?.[0], delta = choice?.delta
      toolProgress = typeof delta?.content === 'string' && !!delta.content
      for (const call of delta?.tool_calls || []) {
        if (!Number.isSafeInteger(call.index) || call.index < 0 || call.index >= 32) throw new Error('工具调用序号无效。')
        const previous = toolCalls.get(call.index) || { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
        previous.id += typeof call.id === 'string' ? call.id : ''
        previous.function.name += typeof call.function?.name === 'string' ? call.function.name : ''
        previous.function.arguments += typeof call.function?.arguments === 'string' ? call.function.arguments : ''
        toolCalls.set(call.index, previous)
        toolProgress ||= !!(call.id || call.function?.name || call.function?.arguments)
      }
      if (choice?.finish_reason) complete = true
      const separated = thinking.push(typeof delta?.content === 'string' ? delta.content : '')
      text += separated.content
      reasoning += (delta?.reasoning_content || delta?.reasoning || '') + separated.reasoning
      usage = extractResponseUsage(format, data) ?? usage
    }
    toolProgressSeen ||= toolProgress
    if (text.length !== previousText || reasoning.length !== previousReasoning || toolProgress || complete !== wasComplete) options.progress?.()
    if (text.length !== previousText || reasoning.length !== previousReasoning || usage !== previousUsage) changed()
  }))
  const reader = response.body.getReader()
  const abort = () => { void reader.cancel(options.signal?.reason).catch(() => {}) }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    options.signal?.throwIfAborted()
    for (;;) {
      const chunk = await reader.read()
      options.signal?.throwIfAborted()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 40 * 1024 ** 2) throw new Error('流式内容超过限制。')
      parser(chunk.value)
      if (terminal) { await reader.cancel().catch(() => {}); break }
    }
    parser(new TextEncoder().encode('\n\n'))
    if (!complete) throw new Error('流式响应中断，已保留当前内容，请先核对消费记录。')
    const tail = thinking.finish()
    text += tail.content; reasoning += tail.reasoning
    dirty = true; flush()
    return { status: 'succeeded', outputs: [{ text }], reasoning, usage,
      ...(toolCalls.size ? { toolCalls: [...toolCalls.values()].map(call => toolCallSchema.parse(call)) } : {}) }
  } catch (error) {
    await reader.cancel().catch(() => {})
    const tail = thinking.finish()
    text += tail.content; reasoning += tail.reasoning
    dirty = true; flush()
    throw new GenerationStreamError(error, { status: 'indeterminate', outputs: text ? [{ text }] : [], reasoning, usage }, toolProgressSeen || toolCalls.size > 0)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}
export { extractChatReasoning, extractResponseUsage }
