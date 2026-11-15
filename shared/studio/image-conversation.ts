// Conversation context adapted from octopus_chat's multimodal message history (MIT).
export interface ImageConversationTurn {
  prompt: string
  images: string[]
  references?: string[]
}
export interface ImageConversationContext {
  turns: ImageConversationTurn[]
}
export const MAX_IMAGE_CONTEXT_TURNS = 20
export const MAX_IMAGE_CONTEXT_IMAGES = 16
export const MAX_IMAGE_CONTEXT_TEXT = 32000

export function imageConversationPrompt(prompt: string, context?: ImageConversationContext) {
  if (!context?.turns.length) return prompt
  const history = context.turns.map((turn, index) => `${index + 1}. ${turn.prompt}`).join('\n')
  return `历史创作要求（按顺序，当前要求优先）：\n${history}\n\n当前要求：\n${prompt}`
}
