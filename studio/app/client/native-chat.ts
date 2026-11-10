import type { ChatOptions } from "./api";
import type { ChatApiFormat } from "../utils/chat-api-format";
import { preProcessImageContent, streamWithThink } from "../utils/chat";
import { fetch } from "../utils/stream";
import { createReasoningFallbackFetch } from "../utils/reasoning-fallback";
import { REQUEST_TIMEOUT_MS } from "../constant";
import {
  buildChatRequest,
  createChatStreamParser,
  extractChatReasoning,
  extractChatResponse,
} from "./chat-formats";
import { splitReasoningContent } from "../utils/reasoning-stream";
import { prepareVideoMessages } from "../utils/video-input";
import { extractResponseUsage, readJsonResponseUsage } from "./response-usage";

export async function chatInFormat(
  format: Exclude<ChatApiFormat, "chat-completions">,
  options: ChatOptions,
  config: ChatOptions["config"] & { max_tokens?: number },
  resolveUrl: (endpoint: string) => string,
  headers: Record<string, string>,
  isCurrent?: () => boolean,
) {
  const controller = new AbortController();
  let timedOut = false;
  options.onController?.(controller);
  const requestFetch = createReasoningFallbackFetch(fetch, {
    isCurrent,
    onFallback: options.onReasoningFallback,
  });
  const finishCancelled = () =>
    options.onFinish("", new Response(null, { status: 499 }));
  try {
    if (controller.signal.aborted || isCurrent?.() === false) {
      controller.abort();
      finishCancelled();
      return;
    }
    const messages = await prepareVideoMessages(
      await Promise.all(
        options.messages.map(async (message) => ({
          role: message.role,
          content: await preProcessImageContent(message.content),
        })),
      ),
      { model: config.model, format, signal: controller.signal },
    );
    if (controller.signal.aborted || isCurrent?.() === false) {
      controller.abort();
      finishCancelled();
      return;
    }
    const { endpoint, body } = buildChatRequest(format, messages, config);
    const url = resolveUrl(endpoint);
    if (config.stream) {
      streamWithThink(
        url,
        body,
        { ...headers, Accept: "text/event-stream" },
        [],
        {},
        controller,
        createChatStreamParser(format, options.onUsage),
        () => {},
        {
          ...options,
          fetch: async (url: string, init?: RequestInit) => {
            const response = await requestFetch(url, init);
            if (options.onUsage)
              await readJsonResponseUsage(response, (value) => {
                const usage = extractResponseUsage(format, value);
                if (usage) options.onUsage?.(usage);
              });
            return response;
          },
          strictApiErrors: true,
          disableRetry: true,
        },
      );
      return;
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    try {
      const response = await requestFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const value = await response.json();
      if (!response.ok) {
        if ([401, 409].includes(response.status) && headers["X-New-Api-User"])
          window.dispatchEvent(new Event("new-api-session-changed"));
        throw new Error(
          value.error?.message ||
            value.message ||
            `请求失败 (${response.status})`,
        );
      }
      const output = splitReasoningContent(
        extractChatResponse(format, value),
        extractChatReasoning(format, value),
      );
      if (output.reasoning)
        options.onReasoningUpdate?.(output.reasoning, output.reasoning);
      const usage = extractResponseUsage(format, value);
      if (usage) options.onUsage?.(usage);
      options.onFinish(output.content, response);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (timedOut) options.onError?.(new Error("请求超时，请稍后重试"));
    else if (controller.signal.aborted) finishCancelled();
    else
      options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
  }
}
