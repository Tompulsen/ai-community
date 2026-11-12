// Compatibility branch reused from Studio client/platforms/openai.ts (MIT).
import { reasoningEffort, stopSequences } from './chat-params.ts'
import type { ModelConfig, RequestMessage } from './types.ts'
export function buildChatCompletions(messages: RequestMessage[], config: ModelConfig) {
  const isO1OrO3 = /^(?:o1|o3|o4-mini)(?:[-.]|$)/i.test(config.model.split('/').pop() || '')
  const isGpt5 = /^gpt-5(?:[-.]|$)/i.test(config.model.split('/').pop() || '')
  const effort = reasoningEffort(config.reasoningEffort), stop = stopSequences(config.stop)
  const result: Record<string, unknown> = {
    model: config.model,
    messages: messages.filter(message => !(isO1OrO3 && message.role === 'system')),
    stream: !!config.stream,
    ...(config.stream ? { stream_options: { include_usage: true } } : {}),
    temperature: !isO1OrO3 && !isGpt5 ? config.temperature : 1,
    presence_penalty: !isO1OrO3 ? config.presence_penalty : 0,
    frequency_penalty: !isO1OrO3 ? config.frequency_penalty : 0,
    top_p: !isO1OrO3 ? config.top_p : 1,
    [isO1OrO3 || isGpt5 ? 'max_completion_tokens' : 'max_tokens']: config.max_tokens,
    ...(effort ? { reasoning_effort: effort } : {}), ...(stop ? { stop } : {}),
  }
  if (isO1OrO3) (result.messages as unknown[]).unshift({ role: 'developer', content: 'Formatting re-enabled' })
  return result
}
