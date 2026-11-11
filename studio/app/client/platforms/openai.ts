"use client";
import { ApiPath, OPENAI_BASE_URL, OpenaiPath } from "@/app/constant";
import {
  ChatMessageTool,
  useAccessStore,
  useAppConfig,
  useChatStore,
} from "@/app/store";
import {
  preProcessImageContent,
  uploadImage,
  base64Image2Blob,
  streamWithThink,
} from "@/app/utils/chat";
import { cloudflareAIGatewayUrl } from "@/app/utils/cloudflare";
import { splitReasoningContent } from "@/app/utils/reasoning-stream";
import { ModelSize, DalleQuality, DalleStyle } from "@/app/typing";

import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  LLMUsage,
  MultimodalContent,
  apiPath,
  validateModelEndpoint,
  detectBase64Mime,
} from "../api";
import Locale from "../../locales";
import { getClientConfig } from "@/app/config/client";
import {
  getMessageTextContent,
  isVisionModel,
  isDalle3 as _isDalle3,
  shouldUseImageGenerationApi,
  getTimeoutMSByModel,
} from "@/app/utils";
import { fetch } from "@/app/utils/stream";
import { createReasoningFallbackFetch } from "@/app/utils/reasoning-fallback";
import { getModelCapabilities } from "@/app/utils/model-capabilities";
import {
  isLocalPreviewModel,
  LOCAL_PREVIEW_MESSAGE,
} from "@/app/utils/local-preview-models";
import {
  customApiPath,
  isAccountModelMode,
  usesCustomProvider,
} from "@/app/utils/custom-provider";
import { hasFileContent } from "@/app/utils/file-upload";
import { prepareVideoMessages } from "@/app/utils/video-input";
import { chatApiFormat } from "@/app/utils/chat-api-format";
import { chatInFormat } from "../native-chat";
import { nativeChatUrl } from "../chat-formats";
import { effectiveOutputTokens } from "@/app/utils/context-budget";
import {
  getLocalScope,
  getLocalTokenId,
  isLocalWorkspaceActive,
} from "@/app/utils/local-workspace";
import {
  createResponseUsageReporter,
  createUsageFallbackFetch,
  readJsonResponseUsage,
} from "../response-usage";
import {
  reasoningEffort,
  stopSequences,
  type ReasoningEffort,
} from "@/app/utils/chat-params";

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

export interface RequestPayload {
  messages: {
    role: "developer" | "system" | "user" | "assistant";
    content: string | MultimodalContent[];
  }[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  model: string;
  temperature: number;
  presence_penalty: number;
  frequency_penalty: number;
  top_p: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: Exclude<ReasoningEffort, "auto">;
  stop?: string[];
}

export interface DalleRequestPayload {
  model: string;
  prompt: string;
  response_format: "url" | "b64_json";
  n: number;
  size: ModelSize;
  quality: DalleQuality;
  style: DalleStyle;
}

export class ChatGPTApi implements LLMApi {
  private disableListModels = false;

  path(path: string, providerName?: string): string {
    const accessStore = useAccessStore.getState();
    if (usesCustomProvider(accessStore, providerName))
      return apiPath(path, providerName);

    let baseUrl = "";

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      baseUrl = isApp ? OPENAI_BASE_URL : ApiPath.V1;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.V1)) {
      baseUrl = "https://" + baseUrl;
    }

    const cleanPath = path.replace(/^\/+/, "");
    const fullUrl = [baseUrl, cleanPath].join("/");

    return cloudflareAIGatewayUrl(fullUrl);
  }

  async extractMessage(res: any) {
    if (res.error) {
      const { type: _type, ...errorInfo } = res.error;
      return "```\n" + JSON.stringify({ error: errorInfo }, null, 4) + "\n```";
    }
    // dalle3 model return url, using url create image message
    if (res.data) {
      let url = res.data?.at(0)?.url ?? "";
      const b64_json = res.data?.at(0)?.b64_json ?? "";
      if (!url && b64_json) {
        // b64_json 可能是裸 base64 或完整 data URI
        const raw = b64_json.startsWith("data:image/")
          ? b64_json.split(",")[1] || b64_json
          : b64_json;
        const mime = detectBase64Mime(raw);
        url = await uploadImage(base64Image2Blob(raw, mime));
      }
      return [
        {
          type: "image_url",
          image_url: {
            url,
          },
        },
      ];
    }
    // 无 data 也无 choices 时抛出明确错误，避免返回原始对象被渲染为 [object Object]
    if (!res.choices?.length) {
      throw new Error("API 返回格式异常：缺少 data 和 choices");
    }
    return res.choices.at(0).message?.content ?? "";
  }

  async chat(options: ChatOptions) {
    if (isLocalPreviewModel(options.config.providerName)) {
      options.onError?.(new Error(LOCAL_PREVIEW_MESSAGE));
      return;
    }
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
        providerName: options.config.providerName,
      },
      ...options.config,
    };
    let stop: string[] | undefined;
    try {
      stop = stopSequences(modelConfig.stop);
    } catch (error) {
      options.onError?.(error as Error);
      return;
    }
    const providerName = modelConfig.providerName;
    const access = useAccessStore.getState();
    const custom = usesCustomProvider(access, providerName);
    const owner = !custom && access.newApiEnabled ? getLocalScope() : undefined;
    const tokenId =
      options.accountTokenId === undefined
        ? getLocalTokenId()
        : options.accountTokenId;
    const requestHeadersFor = (): Record<string, string> => ({
      ...getHeaders(false, providerName),
      ...(!custom && tokenId != null
        ? { "X-New-Api-Token": String(tokenId) }
        : {}),
    });
    const matchesHeaders = (saved: Record<string, string>) => {
      if (
        owner !== undefined &&
        (!isLocalWorkspaceActive() || getLocalScope() !== owner)
      )
        return false;
      const current = requestHeadersFor();
      return Object.keys({ ...saved, ...current }).every(
        (name) =>
          (!custom && name === "X-New-Api-Token") ||
          saved[name] === current[name],
      );
    };
    const capabilities =
      options.modelCapabilities ??
      getModelCapabilities(modelConfig.model, providerName);
    const hasFiles = hasFileContent(options.messages);
    const isImageGen = shouldUseImageGenerationApi(modelConfig, {
      hasFiles,
      capabilities,
      customImageMode:
        custom && (options.imageApiMode ?? access.customApiMode) !== "auto",
    });
    const format = isImageGen
      ? "chat-completions"
      : capabilities.apiFormat ?? chatApiFormat(modelConfig.chatApiFormat);
    if (capabilities.category === "image" || capabilities.category === "video")
      modelConfig.reasoningEffort = "auto";
    if (format !== "chat-completions") {
      const access = useAccessStore.getState();
      const selectedPath = this.path("", providerName);
      const selectedHeaders = requestHeadersFor();
      const headers = { ...selectedHeaders };
      if (custom) {
        if (format === "claude") {
          delete headers.Authorization;
          if (access.openaiApiKey) headers["x-api-key"] = access.openaiApiKey;
          headers["anthropic-version"] = "2023-06-01";
          headers["anthropic-dangerous-direct-browser-access"] = "true";
        } else if (format === "gemini") {
          delete headers.Authorization;
          if (access.openaiApiKey)
            headers["x-goog-api-key"] = access.openaiApiKey;
        }
      }
      await chatInFormat(
        format,
        options,
        modelConfig,
        (endpoint) => {
          if (endpoint.startsWith("v1beta/")) {
            return custom
              ? nativeChatUrl(customApiPath(access.openaiUrl, ""), endpoint)
              : `/studio/api/${endpoint}`;
          }
          return this.path(endpoint, providerName);
        },
        headers,
        () => {
          try {
            return (
              this.path("", providerName) === selectedPath &&
              matchesHeaders(selectedHeaders)
            );
          } catch {
            return false;
          }
        },
      );
      return;
    }

    const isDalle3 = _isDalle3(options.config.model);
    const targetEndpoint = isImageGen
      ? OpenaiPath.ImagePath
      : OpenaiPath.ChatPath;

    const modelType = isImageGen
      ? "image"
      : capabilities.category === "video"
      ? "video"
      : "text";

    if (!hasFiles && !validateModelEndpoint(modelType, targetEndpoint)) {
      options.onError?.(new Error(`模型 ${options.config.model} 不支持此接口`));
      return;
    }

    const controller = new AbortController();
    options.onController?.(controller);
    const finishCancelled = () =>
      options.onFinish("", new Response(null, { status: 499 }));
    if (controller.signal.aborted) {
      finishCancelled();
      return;
    }
    let chatPath: string;
    let requestHeaders: Record<string, string>;
    try {
      chatPath = this.path(targetEndpoint, providerName);
      requestHeaders = requestHeadersFor();
    } catch (error) {
      options.onError?.(error as Error);
      return;
    }
    const selectionMatches = () => {
      try {
        return (
          this.path(targetEndpoint, providerName) === chatPath &&
          matchesHeaders(requestHeaders)
        );
      } catch {
        return false;
      }
    };
    const requestFetch = createReasoningFallbackFetch(
      createUsageFallbackFetch(fetch, selectionMatches),
      {
        isCurrent: selectionMatches,
        onFallback: options.onReasoningFallback,
      },
    );
    const usage = createResponseUsageReporter(
      "chat-completions",
      options.onUsage,
    );

    let requestPayload: RequestPayload | DalleRequestPayload;
    const effort = reasoningEffort(modelConfig.reasoningEffort);

    const isO1OrO3 =
      options.config.model.startsWith("o1") ||
      options.config.model.startsWith("o3") ||
      options.config.model.startsWith("o4-mini");
    const isGpt5 = options.config.model.startsWith("gpt-5");
    if (isImageGen) {
      const prompt = getMessageTextContent(
        options.messages.slice(-1)?.pop() as any,
      );
      requestPayload = {
        model: options.config.model,
        prompt,
        // URLs are only valid for 60 minutes after the image has been generated.
        response_format: isDalle3 ? "b64_json" : "url",
        n: 1,
        size: options.config?.size ?? "1024x1024",
        quality: options.config?.quality ?? "standard",
        style: options.config?.style ?? "vivid",
      };
    } else {
      const visionModel =
        capabilities.vision ||
        isVisionModel(options.config.model, providerName);
      let messages: ChatOptions["messages"] = [];
      try {
        for (const v of options.messages) {
          // Model aliases cannot reliably describe an upstream's image support.
          const content = await preProcessImageContent(v.content);
          if (controller.signal.aborted) {
            finishCancelled();
            return;
          }
          if (!(isO1OrO3 && v.role === "system"))
            messages.push({ role: v.role, content });
        }
        messages = await prepareVideoMessages(messages, {
          model: modelConfig.model,
          format: "chat-completions",
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          finishCancelled();
          return;
        }
      } catch (error) {
        if (controller.signal.aborted) finishCancelled();
        else options.onError?.(error as Error);
        return;
      }

      // O1 not support image, tools (plugin in ChatGPTNextWeb) and system, stream, logprobs, temperature, top_p, n, presence_penalty, frequency_penalty yet.
      requestPayload = {
        messages,
        stream: options.config.stream,
        ...(options.config.stream
          ? { stream_options: { include_usage: true } }
          : {}),
        model: modelConfig.model,
        temperature: !isO1OrO3 && !isGpt5 ? modelConfig.temperature : 1,
        presence_penalty: !isO1OrO3 ? modelConfig.presence_penalty : 0,
        frequency_penalty: !isO1OrO3 ? modelConfig.frequency_penalty : 0,
        top_p: !isO1OrO3 ? modelConfig.top_p : 1,
        max_tokens: effectiveOutputTokens(modelConfig.max_tokens),
        ...(effort ? { reasoning_effort: effort } : {}),
        ...(stop ? { stop } : {}),
      };

      if (isGpt5) {
        // Remove max_tokens if present
        delete requestPayload.max_tokens;
        // Add max_completion_tokens (or max_completion_tokens if that's what you meant)
        requestPayload["max_completion_tokens"] = effectiveOutputTokens(
          modelConfig.max_tokens,
        );
      } else if (isO1OrO3) {
        // by default the o1/o3 models will not attempt to produce output that includes markdown formatting
        // manually add "Formatting re-enabled" developer message to encourage markdown inclusion in model responses
        // (https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reasoning?tabs=python-secure#markdown-output)
        requestPayload["messages"].unshift({
          role: "developer",
          content: "Formatting re-enabled",
        });

        // o1/o3 uses max_completion_tokens to control the number of tokens (https://docs.zhangyuapi.com)
        delete requestPayload.max_tokens;
        requestPayload["max_completion_tokens"] = effectiveOutputTokens(
          modelConfig.max_tokens,
        );
      }

      // add max_tokens to vision model
      if (visionModel && !isO1OrO3 && !isGpt5) {
        requestPayload["max_tokens"] = effectiveOutputTokens(
          modelConfig.max_tokens,
        );
      }
    }

    if (controller.signal.aborted || !selectionMatches()) {
      controller.abort();
      finishCancelled();
      return;
    }
    const shouldStream = !isImageGen && !!options.config.stream;
    let requestTimeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      if (shouldStream) {
        let index = -1;
        streamWithThink(
          chatPath,
          requestPayload,
          requestHeaders,
          [],
          {},
          controller,
          // parseSSE
          (text: string, runTools: ChatMessageTool[]) => {
            const json = JSON.parse(text);
            if (json.error) {
              return {
                isThinking: false,
                content: "",
                error:
                  (typeof json.error === "string"
                    ? json.error
                    : json.error.message) || "上游返回流式错误",
              };
            }
            usage.update(json);
            const choices = json.choices as Array<{
              delta: {
                content: string;
                tool_calls: ChatMessageTool[];
                reasoning_content: string | null;
                reasoning?: string | null;
              };
            }>;

            if (!choices?.length) return { isThinking: false, content: "" };

            const tool_calls = choices[0]?.delta?.tool_calls;
            if (tool_calls?.length > 0) {
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
                index += 1;
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else {
                // @ts-ignore
                runTools[index]["function"]["arguments"] += args;
              }
            }

            const reasoning =
              choices[0]?.delta?.reasoning_content ??
              choices[0]?.delta?.reasoning;
            const content = choices[0]?.delta?.content;

            // Skip if both content and reasoning_content are empty or null
            if (
              (!reasoning || reasoning.length === 0) &&
              (!content || content.length === 0)
            ) {
              return {
                isThinking: false,
                content: "",
              };
            }

            if (reasoning && reasoning.length > 0) {
              return {
                isThinking: false,
                content: content || "",
                reasoning,
              };
            } else if (content && content.length > 0) {
              return {
                isThinking: false,
                content: content,
              };
            }

            return {
              isThinking: false,
              content: "",
            };
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            // reset index value
            index = -1;
            usage.nextRound();
            // @ts-ignore
            requestPayload?.messages?.splice(
              // @ts-ignore
              requestPayload?.messages?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          {
            ...options,
            fetch: async (url: string, init?: RequestInit) => {
              const response = await requestFetch(url, init);
              if (options.onUsage)
                await readJsonResponseUsage(response, usage.update);
              return response;
            },
            strictApiErrors: true,
            disableRetry: true,
          },
        );
      } else {
        const chatPayload = {
          method: "POST",
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
          headers: requestHeaders,
        };

        // make a fetch request
        requestTimeoutId = setTimeout(
          () => controller.abort(),
          getTimeoutMSByModel(options.config.model),
        );

        const res = await requestFetch(chatPath, chatPayload);

        // 401 拦截：token 失效时触发密码重新输入
        if (
          res.status === 401 &&
          !useAccessStore.getState().newApiEnabled &&
          !custom
        ) {
          try {
            localStorage.removeItem("site_access_token");
            window.dispatchEvent(new CustomEvent("token-invalid"));
          } catch {}
          options.onError?.(new Error("访问已过期，请重新输入密码"));
          return;
        }

        const resJson = await res.json();
        if (!res.ok) {
          if (
            isAccountModelMode(useAccessStore.getState()) &&
            !custom &&
            (res.status === 401 || res.status === 409)
          ) {
            window.dispatchEvent(new Event("new-api-session-changed"));
          }
          options.onError?.(
            new Error(
              resJson.message ||
                resJson.error?.message ||
                `请求失败 (${res.status})`,
            ),
          );
          return;
        }
        const message = await this.extractMessage(resJson);
        usage.update(resJson);
        if (typeof message === "string") {
          const reasoning =
            resJson.choices?.[0]?.message?.reasoning_content ??
            resJson.choices?.[0]?.message?.reasoning;
          const output = splitReasoningContent(
            message,
            typeof reasoning === "string" ? reasoning : "",
          );
          if (output.reasoning)
            options.onReasoningUpdate?.(output.reasoning, output.reasoning);
          options.onFinish(output.content, res);
        } else {
          options.onFinish(message, res);
        }
      }
    } catch (e) {
      console.error("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    } finally {
      clearTimeout(requestTimeoutId);
    }
  }
  async usage() {
    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
        .getDate()
        .toString()
        .padStart(2, "0")}`;
    const ONE_DAY = 1 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = formatDate(startOfMonth);
    const endDate = formatDate(new Date(Date.now() + ONE_DAY));

    const [usedResult, subsResult] = await Promise.allSettled([
      fetch(
        apiPath(
          `${OpenaiPath.UsagePath}?start_date=${startDate}&end_date=${endDate}`,
        ),
        {
          method: "GET",
          headers: getHeaders(),
        },
      ),
      fetch(apiPath(OpenaiPath.SubsPath), {
        method: "GET",
        headers: getHeaders(),
      }),
    ]);

    const used = usedResult.status === "fulfilled" ? usedResult.value : null;
    const subs = subsResult.status === "fulfilled" ? subsResult.value : null;

    if (used?.status === 401 || subs?.status === 401) {
      throw new Error(Locale.Error.Unauthorized);
    }

    if (!used?.ok && !subs?.ok) {
      throw new Error("Failed to query usage from openai");
    }

    const response = used
      ? ((await used.json()) as {
          total_usage?: number;
          error?: { type: string; message: string };
        })
      : {};

    const total = subs
      ? ((await subs.json()) as { hard_limit_usd?: number })
      : {};

    if (response.error && response.error.type) {
      throw Error(response.error.message);
    }

    if (response.total_usage) {
      response.total_usage = Math.round(response.total_usage) / 100;
    }

    if (total.hard_limit_usd) {
      total.hard_limit_usd = Math.round(total.hard_limit_usd * 100) / 100;
    }

    return {
      used: response.total_usage,
      total: total.hard_limit_usd,
    } as LLMUsage;
  }

  async models(): Promise<LLMModel[]> {
    if (this.disableListModels) {
      return [];
    }

    try {
      const res = await fetch(apiPath(OpenaiPath.ListModelPath), {
        method: "GET",
        headers: {
          ...getHeaders(),
        },
      });

      if (!res.ok) {
        console.warn("[Models] fetch failed, status:", res.status);
        return [];
      }

      const resJson = (await res.json()) as OpenAIListModelResponse;
      // 不过滤模型名称，返回所有可用模型（包括 gpt、claude、deepseek、qwen 等）
      const chatModels = resJson.data;

      if (!chatModels || chatModels.length === 0) {
        return [];
      }

      let seq = 1000;
      return chatModels.map((m) => ({
        name: m.id,
        available: true,
        sorted: seq++,
        provider: {
          id: "openai",
          providerName: "OpenAI",
          providerType: "openai",
          sorted: 1,
        },
      }));
    } catch (e) {
      console.warn("[Models] fetch error:", e);
      return [];
    }
  }
}
export { OpenaiPath };
