import { markdownToTxt } from "markdown-to-txt";
import {
  getConversationSearchText,
  type ConversationSearchMatch,
  type ConversationSearchMessage,
} from "./conversation-search";

export function getConversationSearchPlainText(
  message: ConversationSearchMessage,
): string {
  return markdownToTxt(getConversationSearchText(message), {
    walkTokens(token: { type: string; raw: string; text?: string }) {
      if (token.type === "image") token.text = "";
      if (token.type === "html") {
        Object.assign(token, { type: "text", text: token.raw });
      }
    },
  });
}

export function searchConversation(
  messages: readonly ConversationSearchMessage[],
  query: string,
): ConversationSearchMatch[] {
  if (!query.trim()) return [];
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  const matches: ConversationSearchMatch[] = [];
  messages.forEach((message, messageIndex) => {
    if (
      message.isMcpResponse ||
      message.preview ||
      message.isContext ||
      (message.role !== "user" && message.role !== "assistant")
    )
      return;
    const text = getConversationSearchPlainText(message);
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      matches.push({
        messageId: message.id,
        messageIndex,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  });
  return matches;
}
