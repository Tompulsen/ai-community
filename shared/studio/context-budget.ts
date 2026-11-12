import type { RequestMessage } from "./types.ts";
import { estimateTokenLength } from "./token-estimate.ts";

export const DEFAULT_COMPRESS_THRESHOLD = 272000;

export function validContextBudget(value?: number) {
  return Number.isFinite(value) && value! >= 8192
    ? Math.min(2000000, Math.floor(value!))
    : DEFAULT_COMPRESS_THRESHOLD;
}

export function validCompressThreshold(value?: number) {
  return Number.isFinite(value) && value! >= 500
    ? Math.min(2000000, Math.floor(value!))
    : DEFAULT_COMPRESS_THRESHOLD;
}

export function compressionTriggerTokens(capacity?: number) {
  return Math.floor((validCompressThreshold(capacity) * 90) / 100);
}

// Media token costs depend on the provider. Never count base64 bytes as text.
export function messageTokens(message: RequestMessage): number {
  if (typeof message.content === "string") {
    return 8 + estimateTokenLength(message.content);
  }
  return (
    8 +
    message.content.reduce(
      (sum, part) =>
        sum +
        (part.type === "text" ? estimateTokenLength(part.text || "") : 4096),
      0,
    )
  );
}

export function contextTokens(messages: RequestMessage[]) {
  return messages.reduce((sum, message) => sum + messageTokens(message), 0);
}

export function inputBudget(config: {
  compressionThreshold?: number;
  contextBudget?: number;
  max_tokens?: number;
}) {
  return validCompressThreshold(config.compressionThreshold);
}

export function effectiveOutputTokens(value?: number) {
  return !Number.isFinite(value) || !value || value! < 1
    ? 52000
    : Math.min(512000, Math.floor(value!));
}

export type ContextEntry = RequestMessage & { id?: string };

export function inlineImages(message: ContextEntry): ContextEntry {
  if (
    typeof message.content === "string"
      ? !message.content.includes("![")
      : !message.content.some(
          (part) => part.type === "text" && part.text?.includes("!["),
        )
  )
    return message;
  const convert = (text: string) => {
    const parts: Exclude<RequestMessage["content"], string> = [];
    const pattern =
      /!\[[^\]\r\n]*\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\r\n]+|https?:\/\/[^\s)]+|\/api\/cache\/[^\s)]+|blob:[^\s)]+)\)/g;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index! > offset)
        parts.push({ type: "text", text: text.slice(offset, match.index) });
      parts.push({ type: "image_url", image_url: { url: match[1] } });
      offset = match.index! + match[0].length;
    }
    if (!offset) return [{ type: "text" as const, text }];
    if (offset < text.length)
      parts.push({ type: "text", text: text.slice(offset) });
    return parts;
  };
  const content =
    typeof message.content === "string"
      ? convert(message.content)
      : message.content.flatMap((part) =>
          part.type === "text" ? convert(part.text || "") : [part],
        );
  return { ...message, content };
}

export function historyMedia(message: ContextEntry): ContextEntry | undefined {
  const content = inlineImages(message).content;
  if (typeof content === "string") return;
  const media = content.filter((part) => part.type !== "text");
  return media.length ? { ...message, content: media } : undefined;
}

/** Only the outbound context changes; the source history is never modified. */
export async function prepareContext(options: {
  prefix: ContextEntry[];
  history: ContextEntry[];
  input?: ContextEntry;
  memory: string;
  config: {
    contextBudget?: number;
    compressionThreshold?: number;
    max_tokens?: number;
    compressMessageLengthThreshold?: number;
    sendMemory?: boolean;
  };
  summarize: (messages: RequestMessage[]) => Promise<string>;
}) {
  const { memory, config, summarize } = options;
  // Gemini can return generated images as Markdown data URLs, not media parts.
  const prefix = options.prefix.map(inlineImages);
  const history = options.history.map(inlineImages);
  const input = options.input ? inlineImages(options.input) : undefined;
  const threshold = inputBudget(config);
  const memoryMessage = (content: string): ContextEntry => ({
    role: "system",
    content: `历史对话摘要：\n${content}`,
  });
  const original = [
    ...prefix,
    ...(memory ? [memoryMessage(memory)] : []),
    ...history,
    ...(input ? [input] : []),
  ];
  if (contextTokens(original) <= compressionTriggerTokens(threshold)) {
    return { messages: original, memory, summarizedIds: [] as string[] };
  }
  const oversizedMemory = estimateTokenLength(memory) > 2048;
  // Preserve the newest exchange when possible, compress older messages first.
  const keep = history.length > 2 ? 2 : 0;
  const older = history.slice(0, history.length - keep);
  const media = older.flatMap((message) => {
    const item = historyMedia(message);
    return item ? [item] : [];
  });
  const textHistory = older.flatMap((message) => {
    const content =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text || "")
            .join("\n");
    return content.trim() ? [{ ...message, content }] : [];
  });
  // A compression threshold is not a model capacity or permission to drop media.
  if (!textHistory.length && !oversizedMemory)
    return { messages: original, memory, summarizedIds: [] as string[] };
  // Media cannot shrink through text summarization; avoid repeatedly summarizing
  // a few captions when retained media alone already exceeds the threshold.
  if (
    media.length &&
    !oversizedMemory &&
    contextTokens(textHistory) < Math.min(2048, threshold / 2)
  )
    return { messages: original, memory, summarizedIds: [] as string[] };
  const chunkBudget = 24000;
  const chunks: RequestMessage[][] = [];
  let chunk: RequestMessage[] = [];
  const source = [
    ...(oversizedMemory ? [memoryMessage(memory)] : []),
    ...textHistory,
  ];
  for (const message of source) {
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => part.text || "").join("\n");
    // Split large individual messages too, so the summary call cannot overflow.
    const chars = Array.from(text);
    const length = Math.max(256, Math.floor(chunkBudget / 2));
    for (let offset = 0; offset < chars.length; offset += length) {
      const part = {
        role: message.role,
        content: chars.slice(offset, offset + length).join(""),
      };
      if (contextTokens([...chunk, part]) > chunkBudget && chunk.length) {
        chunks.push(chunk);
        chunk = [];
      }
      chunk.push(part);
    }
  }
  if (chunk.length) chunks.push(chunk);
  if (chunks.length > 128) {
    throw new Error(
      "历史内容过长，需要过多摘要请求，已保留原始记录，请清除上下文或新建对话。",
    );
  }
  let summary = oversizedMemory ? "" : memory;
  for (const batch of chunks) {
    summary = (
      await summarize([...(summary ? [memoryMessage(summary)] : []), ...batch])
    ).trim();
    if (!summary || estimateTokenLength(summary) > 2048) {
      throw new Error(
        "历史摘要未生成有效结果，已保留原始记录，请重试或新建对话。",
      );
    }
  }
  const messages = [
    ...prefix,
    memoryMessage(summary),
    ...media,
    ...history.slice(history.length - keep),
    ...(input ? [input] : []),
  ];
  return {
    messages,
    memory: summary,
    summarizedIds: textHistory.flatMap((message) =>
      message.id ? [message.id] : [],
    ),
  };
}
