import type { ChatMessageTool } from "../store/chat";
import { getToolResult, isToolRecord, safeToolUrl } from "./tool-result";
import { getWebToolInfo, type WebToolSource } from "./web-tool";

export type MessageSource = WebToolSource & { number: number };

const MAX_MESSAGE_SOURCES = 30;

export function getMessageSources(
  message: { tools?: readonly ChatMessageTool[] },
  knownSources: readonly WebToolSource[] = [],
): MessageSource[] {
  const sources: MessageSource[] = [];
  const seen = new Set<string>();
  const add = (candidate: WebToolSource) => {
    const url = safeToolUrl(candidate.url);
    if (!url || seen.has(url) || sources.length >= MAX_MESSAGE_SOURCES) return;
    seen.add(url);
    sources.push({
      number: sources.length + 1,
      url,
      title:
        typeof candidate.title === "string" && candidate.title.trim()
          ? candidate.title.trim().slice(0, 240)
          : new URL(url).hostname,
      ...(typeof candidate.snippet === "string" && candidate.snippet.trim()
        ? { snippet: candidate.snippet.trim().slice(0, 1200) }
        : {}),
    });
  };

  for (const tool of message.tools ?? []) {
    if (tool.isError === true) continue;
    const original = getWebToolInfo(tool);
    if (!original) continue;
    original.sources.forEach(add);
    let result = getToolResult(tool.content);
    // MCP clients may return a JSON-RPC envelope around the usual content blocks.
    if (isToolRecord(result) && isToolRecord(result.result))
      result = getToolResult(JSON.stringify(result.result));
    if (result !== undefined && typeof result !== "string") {
      getWebToolInfo({
        function: tool.function,
        content: JSON.stringify(result),
      })?.sources.forEach(add);
    }
  }
  knownSources.forEach(add);
  return sources;
}

export function findMessageSource(
  sources: readonly MessageSource[],
  href: string | undefined,
): MessageSource | undefined {
  const url = safeToolUrl(href);
  if (!url) return;
  return sources.find(
    (source) =>
      Number.isInteger(source.number) &&
      source.number > 0 &&
      safeToolUrl(source.url) === url,
  );
}
