// Uses the existing Studio parsers; no retry or provider fallback.
import { getLines, getMessages } from '@fortaine/fetch-event-source/parse'
import { readImageStream } from '../../shared/studio/image-response.ts'
import { createChatStreamParser, extractChatReasoning } from '../../shared/studio/chat-formats.ts'
import { createReasoningStream } from '../../shared/studio/reasoning-stream.ts'
import { extractResponseUsage } from '../../shared/studio/response-usage.ts'
import type { CreationInput, CreationTask } from '../creation-contract.ts'
import { toolCallSchema } from '../../shared/studio/options.ts'

export type CreationEvent = { type: string; [key: string]: unknown }
export async function readGenerationStream(response: Response, input: CreationInput, emit: (event: CreationEvent) => void): Promise<CreationTask> {
  if (input.kind === 'image') {
    let images: string[] = []
    await readImageStream(response, url => emit({ type: 'preview', url }), values => { images = values })
    return { status: 'succeeded', outputs: images.map(url => ({ url })) }
  }
  if (!response.body) throw new Error('流式响应为空。')
  const format = input.chatOptions?.format ?? 'chat-completions'
  let text = '', reasoning = '', complete = false, usage: CreationTask['usage'], bytes = 0
  const native = format !== 'chat-completions' ? createChatStreamParser(format, value => { usage = value }) : undefined
  const thinking = createReasoningStream()
  const toolCalls = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>()
  const parser = getLines(getMessages(message => {
    if (!message.data) return
    if (message.data === '[DONE]') { complete = true; return }
    const data = JSON.parse(message.data)
    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message || '生成失败。')
    if (native) {
      const delta = native(message.data)
      if (delta.error) throw new Error(delta.error)
      if (delta.isThinking) reasoning += delta.content
      else text += delta.content
      reasoning += delta.reasoning ?? ''
      if (delta.done) complete = true
    } else {
      const choice = data.choices?.[0], delta = choice?.delta
      for (const call of delta?.tool_calls || []) {
        if (!Number.isSafeInteger(call.index) || call.index < 0 || call.index >= 32) throw new Error('工具调用序号无效。')
        const previous = toolCalls.get(call.index) || { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
        previous.id += typeof call.id === 'string' ? call.id : ''
        previous.function.name += typeof call.function?.name === 'string' ? call.function.name : ''
        previous.function.arguments += typeof call.function?.arguments === 'string' ? call.function.arguments : ''
        toolCalls.set(call.index, previous)
      }
      if (choice?.finish_reason) complete = true
      const separated = thinking.push(typeof delta?.content === 'string' ? delta.content : '')
      text += separated.content
      reasoning += (delta?.reasoning_content || delta?.reasoning || '') + separated.reasoning
      usage = extractResponseUsage(format, data) ?? usage
    }
    emit({ type: 'delta', text, reasoning, usage })
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
    if (!complete) throw new Error('流式响应中断，已保留当前内容，请先核对消费记录。')
    const tail = thinking.finish()
    text += tail.content; reasoning += tail.reasoning
    emit({ type: 'delta', text, reasoning, usage })
    return { status: 'succeeded', outputs: [{ text }], reasoning, usage,
      ...(toolCalls.size ? { toolCalls: [...toolCalls.values()].map(call => toolCallSchema.parse(call)) } : {}) }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
}
export { extractChatReasoning, extractResponseUsage }
