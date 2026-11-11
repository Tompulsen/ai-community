import type { ChatMessage } from "../store/chat";

export type ConversationSearchMessage = Pick<
  ChatMessage,
  "id" | "role" | "content"
> & {
  isMcpResponse?: boolean;
  preview?: boolean;
  isContext?: boolean;
};

export type ConversationSearchMatch = {
  messageId: string;
  messageIndex: number;
  start: number;
  end: number;
};

export type ConversationSearchParser =
  typeof import("./conversation-search-parser");

let parser: Promise<ConversationSearchParser> | undefined;

export function loadConversationSearch(): Promise<ConversationSearchParser> {
  parser ??= import("./conversation-search-parser").catch((error) => {
    parser = undefined;
    throw error;
  });
  return parser;
}

export function getConversationSearchText(
  message: ConversationSearchMessage,
): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

export function getConversationMessageMatches(
  matches: readonly ConversationSearchMatch[],
  messageId: string,
) {
  return matches.filter((match) => match.messageId === messageId);
}

export function navigateConversationMatch(
  currentIndex: number,
  total: number,
  direction: 1 | -1,
): number {
  if (total <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= total)
    return direction === 1 ? 0 : total - 1;
  return (currentIndex + direction + total) % total;
}
