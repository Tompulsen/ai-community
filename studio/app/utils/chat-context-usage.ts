import type { RequestMessage, MultimodalContent } from "../client/api";
import { DEFAULT_SYSTEM_TEMPLATE } from "../constant";
import type { ChatSession, fillTemplateWith } from "../store/chat";
import {
  compressionTriggerTokens,
  contextTokens,
  historyMedia,
  inlineImages,
  messageTokens,
  validCompressThreshold,
} from "./context-budget";
import {
  fileContentParts,
  formatFileContent,
  type ParsedFile,
} from "./file-upload";
import { formatQuoteInput, type MessageQuote } from "./message-quote";

type TemplateFormatter = typeof fillTemplateWith;

export type ContextDraft = {
  draftText?: string;
  imageCount?: number;
  files?: ParsedFile[];
  quote?: MessageQuote;
};

export type ContextUsageBase = {
  prefixTokens: number;
  memoryTokens: number;
  historyTokens: number;
  historyMessageCount: number;
  mediaCount: number;
  compressionThreshold: number;
};

function countMedia(messages: RequestMessage[]) {
  return messages.reduce(
    (total, message) =>
      total +
      (Array.isArray(message.content)
        ? message.content.filter((part) => part.type !== "text").length
        : 0),
    0,
  );
}

/** Mirrors getMessagesWithMemory locally without resolving MCP or skills. */
export function getContextUsageBase(
  session: ChatSession,
  formatTemplate: TemplateFormatter,
): ContextUsageBase {
  const config = session.mask.modelConfig;
  const clearIndex = session.clearContextIndex ?? 0;
  const includeMemory =
    !!session.memoryPrompt && session.lastSummarizeIndex > clearIndex;
  const prefix: RequestMessage[] = [];
  if (
    config.enableInjectSystemPrompts &&
    (config.model.startsWith("gpt-") || config.model.startsWith("chatgpt-"))
  ) {
    prefix.push({
      role: "system",
      content: formatTemplate("", {
        ...config,
        template: DEFAULT_SYSTEM_TEMPLATE,
      }),
    });
  }
  prefix.push(...session.mask.context.map(inlineImages));
  const history: RequestMessage[] = [];
  for (let index = clearIndex; index < session.messages.length; index++) {
    const message = session.messages[index];
    if (
      !message ||
      message.isError ||
      message.streaming ||
      message.materialStatus
    )
      continue;
    if (includeMemory && index < session.lastSummarizeIndex) {
      const media = historyMedia(message);
      if (media) history.push(media);
    } else {
      history.push(inlineImages(message));
    }
  }
  return {
    prefixTokens: contextTokens(prefix),
    memoryTokens: includeMemory
      ? messageTokens({
          role: "system",
          content: `历史对话摘要：\n${session.memoryPrompt}`,
        })
      : 0,
    historyTokens: contextTokens(history),
    historyMessageCount: history.length,
    mediaCount: countMedia(prefix) + countMedia(history),
    compressionThreshold: validCompressThreshold(config.compressionThreshold),
  };
}

export function getContextDraftUsage(
  config: ChatSession["mask"]["modelConfig"],
  { draftText = "", imageCount = 0, files = [], quote }: ContextDraft,
  formatTemplate: TemplateFormatter,
) {
  const images = Number.isFinite(imageCount)
    ? Math.max(0, Math.floor(imageCount))
    : 0;
  if (!draftText.trim() && !images && files.length === 0) {
    return { draftTokens: 0, mediaCount: 0 };
  }
  let text = formatQuoteInput(draftText, quote);
  if (files.length) text = `${formatFileContent(files)}\n\n${text}`;
  const parts: MultimodalContent[] = [];
  // The current image send path uses the caption directly, without a template.
  if (images) {
    if (text.trim()) parts.push({ type: "text", text });
  } else {
    parts.push({ type: "text", text: formatTemplate(text, config) });
  }
  for (let index = 0; index < images; index++) {
    parts.push({ type: "image_url", image_url: { url: "" } });
  }
  parts.push(...fileContentParts(files));
  const message = inlineImages({ role: "user", content: parts });
  return {
    draftTokens: messageTokens(message),
    mediaCount: countMedia([message]),
  };
}

export function combineContextUsage(
  base: ContextUsageBase,
  draft: ReturnType<typeof getContextDraftUsage>,
) {
  const totalTokens =
    base.prefixTokens +
    base.memoryTokens +
    base.historyTokens +
    draft.draftTokens;
  return {
    ...base,
    draftTokens: draft.draftTokens,
    mediaCount: base.mediaCount + draft.mediaCount,
    totalTokens,
    thresholdPercent: Math.round(
      (totalTokens / base.compressionThreshold) * 100,
    ),
    reachesCompressionThreshold:
      totalTokens > compressionTriggerTokens(base.compressionThreshold),
  };
}

export function estimateChatContextUsage({
  session,
  formatTemplate,
  ...draft
}: ContextDraft & {
  session: ChatSession;
  formatTemplate: TemplateFormatter;
}) {
  return combineContextUsage(
    getContextUsageBase(session, formatTemplate),
    getContextDraftUsage(session.mask.modelConfig, draft, formatTemplate),
  );
}
