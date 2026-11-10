import type { ChatMessage } from "../store/chat";

export type MessageQuote = {
  messageId: string;
  role: ChatMessage["role"];
  text: string;
};

export function createMessageQuote(
  message: Pick<ChatMessage, "id" | "role">,
  text: string,
): MessageQuote | undefined {
  if (!text.trim()) return undefined;
  return { messageId: message.id, role: message.role, text };
}

export function formatQuoteInput(text: string, quote?: MessageQuote) {
  if (typeof quote?.text !== "string" || !quote.text.trim()) return text;
  const blockquote = quote.text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return `引用内容：\n${blockquote}\n\n${text}`;
}

export function readMessageQuote(value: unknown): MessageQuote | undefined {
  if (!value || typeof value !== "object") return undefined;
  const quote = value as Partial<MessageQuote>;
  if (
    typeof quote.messageId !== "string" ||
    !quote.messageId ||
    typeof quote.text !== "string" ||
    !quote.text.trim() ||
    !["user", "assistant", "system"].includes(quote.role ?? "")
  )
    return undefined;
  return {
    messageId: quote.messageId,
    role: quote.role!,
    text: quote.text,
  };
}
