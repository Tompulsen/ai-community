export const CHAT_API_FORMATS = [
  "chat-completions",
  "responses",
  "gemini",
  "claude",
] as const;

export type ChatApiFormat = (typeof CHAT_API_FORMATS)[number];

export function chatApiFormat(value?: string): ChatApiFormat {
  return CHAT_API_FORMATS.includes(value as ChatApiFormat)
    ? (value as ChatApiFormat)
    : "chat-completions";
}
