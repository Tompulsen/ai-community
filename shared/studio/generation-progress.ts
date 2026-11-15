// Adapted from octopus_chat/app/utils/chat.ts generation timing (MIT).
import { estimateTokenLength } from './token-estimate'
import type { ChatGenerationProgress } from './types'

export function createGenerationProgress() {
  let first: number | undefined, last: number | undefined, previous = ''
  return (text: string, reasoning: string, now: number): ChatGenerationProgress | undefined => {
    const content = text + reasoning
    if (!content || content === previous) return
    previous = content
    first ??= now
    last = now
    const durationMs = last - first
    return durationMs > 0 ? { outputTokens: estimateTokenLength(content), durationMs } : undefined
  }
}
