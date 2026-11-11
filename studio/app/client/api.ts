import { getClientConfig } from "../config/client";
import { ApiPath } from "../constant";
import { ChatMessageTool, ChatMessage } from "../store";
import { ChatGPTApi, DalleRequestPayload } from "./platforms/openai";
import { useAccessStore } from "../store/access";
import { getExpectedNewApiUserId } from "./new-api";
import { getLocalTokenId } from "../utils/local-workspace";
import {
  customApiPath,
  isAccountModelMode,
  usesCustomProvider,
} from "../utils/custom-provider";
import Locale from "../locales";
import type { ReasoningEffort } from "../utils/chat-params";
import { nativeChatUrl } from "./chat-formats";
import { isInsufficientBalance } from "../utils/quota-error";

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export interface MultimodalContent {
  type: "text" | "image_url" | "video_url" | "input_audio" | "file";
  text?: string;
  image_url?: {
    url: string;
  };
  video_url?: { url: string };
  input_audio?: { data: string; format: string };
  file?: { filename: string; file_data: string };
}

export interface RequestMessage {
  role: MessageRole;
  content: string | MultimodalContent[];
}

export interface LLMConfig {
  model: string;
  chatApiFormat?: import("../utils/chat-api-format").ChatApiFormat;
  providerName?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  reasoningEffort?: ReasoningEffort;
  stop?: string;
  size?: DalleRequestPayload["size"];
  resolution?: import("../utils/image-params").ImageResolution;
  quality?: DalleRequestPayload["quality"];
  style?: DalleRequestPayload["style"];
  imageOutputFormat?: import("../utils/image-params").ImageOutputFormat;
  imageBackground?: import("../utils/image-params").ImageBackground;
  imageOutputCompression?: number;
  imageResponseFormat?: import("../utils/image-params").ImageResponseFormat;
  imageStream?: boolean;
  imageRequestMode?: "sync" | "async";
  imagePartialImages?: number;
}

export type ChatResponseUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
};

export type ChatGenerationProgress = {
  outputTokens: number;
  durationMs: number;
};

export interface ChatOptions {
  accountTokenId?: number | null;
  taskContext?: { sessionId: string; messageId: string };
  modelCapabilities?: ReturnType<
    typeof import("../utils/model-capabilities").getModelCapabilities
  >;
  imageApiMode?: import("../utils/custom-provider").CustomApiMode;
  messages: RequestMessage[];
  config: LLMConfig;

  onUpdate?: (message: string, chunk: string) => void;
  onReasoningUpdate?: (reasoning: string, chunk: string) => void;
  onUsage?: (usage: ChatResponseUsage) => void;
  onGenerationTiming?: (durationMs: number) => void;
  onGenerationProgress?: (progress: ChatGenerationProgress) => void;
  onFinish: (message: string, responseRes: Response) => void;
  onError?: (err: Error) => void;
  onController?: (controller: AbortController) => void;
  onReasoningFallback?: () => void | boolean;
  onBeforeTool?: (tool: ChatMessageTool) => void;
  onAfterTool?: (tool: ChatMessageTool) => void;
}

export interface LLMUsage {
  used: number;
  total: number;
}

export interface LLMModel {
  name: string;
  displayName?: string;
  available: boolean;
  provider: LLMModelProvider;
  sorted: number;
  type?: string;
}

export interface LLMModelProvider {
  id: string;
  providerName: string;
  providerType: string;
  sorted: number;
}

export abstract class LLMApi {
  abstract chat(options: ChatOptions): Promise<void>;
  abstract usage(): Promise<LLMUsage>;
  abstract models(): Promise<LLMModel[]>;
}

export class ClientApi {
  public llm: LLMApi;

  constructor() {
    this.llm = new ChatGPTApi();
  }

  async share(messages: ChatMessage[], avatarUrl: string | null = null) {
    try {
      const msgs = messages
        .map((m) => ({
          from: m.role === "user" ? "human" : "gpt",
          value: m.content,
        }))
        .concat([
          {
            from: "human",
            value: "Share from [章鱼公益平台]: https://zhangyuapi.com",
          },
        ]);
      // 敬告二开开发者们，为了开源大模型的发展，请不要修改上述消息，此消息用于后续数据清洗使用
      // Please do not modify this message

      const clientConfig = getClientConfig();
      const proxyUrl = "/studio/sharegpt";
      const rawUrl = "https://sharegpt.com/api/conversations";
      const shareUrl = clientConfig?.isApp ? rawUrl : proxyUrl;
      const res = await fetch(shareUrl, {
        body: JSON.stringify({
          avatarUrl,
          items: msgs,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const resJson = await res.json();
      if (resJson.id) {
        return `https://shareg.pt/${resJson.id}`;
      }
    } catch (e) {
      console.error("[Share] failed:", e);
    }
  }
}

export function getBearerToken(
  apiKey: string,
  noBearer: boolean = false,
): string {
  return validString(apiKey)
    ? `${noBearer ? "" : "Bearer "}${apiKey.trim()}`
    : "";
}

export function validString(x: string): boolean {
  return x?.length > 0;
}

export function getHeaders(
  ignoreHeaders: boolean = false,
  providerName?: string,
) {
  let headers: Record<string, string> = {};
  if (!ignoreHeaders) {
    headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  const access = useAccessStore.getState();
  if (usesCustomProvider(access, providerName)) {
    if (!access.useCustomConfig)
      throw new Error("自定义接口已停用，请重新启用或选择账号模型");
    if (access.openaiApiKey)
      headers.Authorization = `Bearer ${access.openaiApiKey}`;
    return headers;
  }
  const accountMode = isAccountModelMode(access);
  if (accountMode) {
    headers["X-New-Api-User"] = String(getExpectedNewApiUserId() ?? 0);
    const tokenId = getLocalTokenId();
    if (tokenId !== null) headers["X-New-Api-Token"] = String(tokenId);
  }

  try {
    // 访问密码（服务端 auth.ts 用于验证）
    const token = localStorage.getItem("site_access_token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    // 用户自定义 API Key（服务端代理路由使用，不会发到上游时混用）
    const customKey = localStorage.getItem("custom_api_key");
    if (!accountMode && customKey) {
      headers["x-api-key"] = `Bearer ${customKey}`;
    }
  } catch {
    // localStorage 不可用时忽略
  }

  return headers;
}

export function getClientApi(_provider?: string): ClientApi {
  return new ClientApi();
}

export function apiPath(endpoint: string, providerName?: string): string {
  const access = useAccessStore.getState();
  const custom = usesCustomProvider(access, providerName);
  if (custom && !access.useCustomConfig)
    throw new Error("自定义接口已停用，请重新启用或选择账号模型");
  if (endpoint.startsWith("api/v3/")) {
    if (!custom) return `/studio/api/ark/${endpoint.slice("api/v3/".length)}`;
    const url = new URL(customApiPath(access.openaiUrl, ""));
    url.pathname = `${url.pathname
      .replace(/\/(?:api\/v3|v1|v1beta)\/?$/, "")
      .replace(/\/+$/, "")}/${endpoint}`;
    return url.href;
  }
  if (endpoint.startsWith("v1beta/")) {
    if (!custom) return `/studio/api/${endpoint}`;
    const url = new URL(
      nativeChatUrl(
        customApiPath(access.openaiUrl, ""),
        endpoint.split("?")[0],
      ),
    );
    url.search = endpoint.includes("?")
      ? endpoint.slice(endpoint.indexOf("?"))
      : "";
    return url.href;
  }
  if (/^async-(images|videos)\/v1\//.test(endpoint)) {
    return custom
      ? `${new URL(customApiPath(access.openaiUrl, "")).origin}/${endpoint}`
      : `/studio/api/${endpoint}`;
  }
  if (custom) return customApiPath(access.openaiUrl, endpoint);
  const clean = endpoint.replace(/^\/+/, "").replace(/\/+$/, "");
  return `${ApiPath.V1}/${clean}`;
}

export function getModelType(model: LLMModel): string {
  return model.type || "text";
}

const MODEL_ENDPOINTS: Record<string, string[]> = {
  text: ["chat/completions"],
  image: ["images/generations", "images/edits", "images/variations"],
  video: ["videos/generations", "videos/"],
};

export function validateModelEndpoint(
  modelType: string,
  endpoint: string,
): boolean {
  const allowed = MODEL_ENDPOINTS[modelType];
  if (!allowed) return true;
  return allowed.some((e) => endpoint.includes(e));
}

/** 仅携带认证头的 GET 请求头（不含 Content-Type） */
function getAuthOnlyHeaders(providerName?: string): Record<string, string> {
  return { ...getHeaders(true, providerName), Accept: "application/json" };
}

/**
 * 从 base64 数据前缀推断图片 MIME 类型
 * PNG:  iVBORw0KGgo
 * JPEG: /9j/
 * GIF:  R0lGOD
 * WebP: UklGR
 */
export function detectBase64Mime(b64: string): string {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/png"; // 默认
}

/**
 * 带认证的 fetch 封装
 * - 自动注入 Authorization 头
 * - 非 2xx 响应抛出 ApiFetchError（携带 errorType / tip）
 */
export class ApiFetchError extends Error {
  status: number;
  body: any;
  code?: string;
  errorType: string;
  tip: string;
  constructor(
    message: string,
    status: number,
    body?: any,
    public retryAfter?: string,
  ) {
    super(message);
    this.name = "ApiFetchError";
    this.status = status;
    this.body = body;
    const code = body?.error?.code ?? body?.code;
    this.code = typeof code === "string" ? code : undefined;
    const classified = classifyApiError({ message, status, body });
    this.errorType = classified.errorType;
    this.tip = classified.tip;
  }
}

// ---- 结构化错误分类 ----

export interface ClassifiedError {
  /** 错误大类：网络错误 | 任务超时 | 上游生成错误 */
  errorType: string;
  /** 用户可读的中文提示 */
  tip: string;
  /** 原始错误/响应 */
  raw: any;
}

/**
 * 统一错误分类 —— 三段式判定：
 * 1. 浏览器网络层异常（Failed to fetch）
 * 2. 前端超时（AbortError / timeout 标记）
 * 3. 上游业务报错（status / message 关键词匹配）
 */
export function classifyApiError(input: {
  message?: string;
  status?: number;
  body?: any;
  isTimeout?: boolean;
  isNetworkError?: boolean;
}): ClassifiedError {
  const { message, status, body, isTimeout, isNetworkError } = input;
  const msg = (message || "")?.toLowerCase();
  const responseMessage =
    body?.error?.message ||
    (typeof body?.error === "string" ? body.error : undefined) ||
    body?.message ||
    (typeof body?.detail === "string" ? body.detail : undefined);
  const bodyMsg =
    typeof responseMessage === "string" ? responseMessage.toLowerCase() : msg;

  // 1. 网络层异常
  if (
    isNetworkError ||
    msg === "failed to fetch" ||
    msg?.includes("networkerror") ||
    msg?.includes("网络错误")
  ) {
    return {
      errorType: "网络错误",
      tip: "无法连接服务，可能跨域/服务器宕机/断网",
      raw: input,
    };
  }

  // 2. 前端超时
  if (isTimeout || message === "AbortError" || message?.includes("超时")) {
    return {
      errorType: "任务超时",
      tip: "生成任务超时，上游响应过慢",
      raw: input,
    };
  }

  // 3. 上游业务报错 —— 关键词匹配
  if (status || body?.error === true || bodyMsg) {
    let tip = "上游服务错误";
    const fullMsg = bodyMsg || msg;

    if (isInsufficientBalance({ message, body })) {
      tip = "余额不足，请充值后重试";
    } else if (
      /rate.?limit|too many requests/.test(fullMsg) ||
      status === 429
    ) {
      tip = "请求限流，调用过于频繁";
    } else if (
      /subscription|订阅|套餐/.test(fullMsg) &&
      /quota|额度|不足|exhaust/.test(fullMsg)
    ) {
      tip = "订阅额度不足，请检查套餐或切换计费方式";
    } else if (
      /token|令牌|密钥/.test(fullMsg) &&
      /quota|额度|不足|exhaust/.test(fullMsg)
    ) {
      tip = "密钥额度不足或不可用，请检查密钥额度及状态";
    } else if (fullMsg.includes("not supported model")) {
      tip = "当前渠道不支持该模型";
    } else if (status === 400 || fullMsg.includes("400")) {
      tip = "参数非法，模型不支持该参数";
    } else if (status === 429 || fullMsg.includes("429")) {
      tip = "请求限流，调用过于频繁";
    } else if (status === 401 || status === 403) {
      tip = "认证失败，API Key 无效或已过期";
    } else if (status === 404) {
      tip = "请求的接口路径不存在";
    } else if (status && status >= 500) {
      tip = "上游服务暂时不可用，请稍后重试";
    }

    return {
      errorType: "上游生成错误",
      tip,
      raw: input,
    };
  }

  // Fallback
  return {
    errorType: "上游生成错误",
    tip: message || "未知错误",
    raw: input,
  };
}

export async function apiFetch(
  endpoint: string,
  options?: RequestInit & { method?: string },
  providerName?: string,
): Promise<Response> {
  const account =
    isAccountModelMode(useAccessStore.getState()) &&
    !usesCustomProvider(useAccessStore.getState(), providerName);
  const pinnedToken = new Headers(options?.headers).get("X-New-Api-Token");
  if (
    account &&
    useAccessStore.getState().switchingToken &&
    !(
      pinnedToken &&
      /^[1-9]\d*$/.test(pinnedToken) &&
      Number.isSafeInteger(Number(pinnedToken))
    ) &&
    !["GET", "HEAD"].includes((options?.method || "GET").toUpperCase())
  ) {
    throw new Error(Locale.Settings.ModelSource.Switching);
  }
  const url = apiPath(endpoint, providerName);
  const headers: Record<string, string> = {
    ...getAuthOnlyHeaders(providerName),
    Accept: "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (
    endpoint.startsWith("v1beta/") &&
    usesCustomProvider(useAccessStore.getState(), providerName)
  ) {
    headers["x-goog-api-key"] = useAccessStore.getState().openaiApiKey;
    if (new URL(url).hostname.endsWith(".googleapis.com"))
      delete headers.Authorization;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  // 401 拦截：token 失效时自动触发密码重新输入
  if (
    account &&
    (res.status === 401 ||
      (res.status === 409 &&
        (!/^async-/.test(endpoint) ||
          (
            await res
              .clone()
              .json()
              .catch(() => null)
          )?.code === "NEW_API_TOKEN_CHANGED")))
  ) {
    window.dispatchEvent(new Event("new-api-session-changed"));
  } else if (
    res.status === 401 &&
    !usesCustomProvider(useAccessStore.getState(), providerName)
  ) {
    try {
      window.dispatchEvent(new CustomEvent("token-invalid"));
    } catch {}
  }

  if (!res.ok) {
    let body: any;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw new ApiFetchError(
      body?.error?.message ||
        (typeof body?.error === "string" ? body.error : undefined) ||
        body?.message ||
        (typeof body?.detail === "string" ? body.detail : undefined) ||
        `HTTP ${res.status}`,
      res.status,
      body,
      res.headers.get("retry-after") ?? undefined,
    );
  }

  return res;
}

export interface PollVideoTaskOptions {
  taskId: string;
  onProgress?: (elapsedSec: number, data: any) => void;
  onComplete: (result: any) => void;
  onError: (err: Error) => void;
  maxAttempts?: number;
}

/** 视频轮询阶梯间隔（毫秒） */
const VIDEO_POLL_STAGES = [
  { until: 10, interval: 2000 }, // 0~10s:  每 2s
  { until: 30, interval: 4000 }, // 10~30s: 每 4s
  { until: Infinity, interval: 6000 }, // 30s+:  每 6s
];

function getVideoPollInterval(elapsedSec: number): number {
  for (const stage of VIDEO_POLL_STAGES) {
    if (elapsedSec < stage.until) return stage.interval;
  }
  return 6000;
}

/**
 * 视频任务轮询（自适应阶梯间隔 + try-catch 网络异常保护）
 * 返回 cancel 函数供外部销毁计时器
 */
export function pollVideoTask(options: PollVideoTaskOptions): () => void {
  const {
    taskId,
    onProgress,
    onComplete,
    onError,
    maxAttempts = 200,
  } = options;

  let attempts = 0;
  let destroyed = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const pollStartTime = Date.now();

  const scheduleNext = () => {
    if (destroyed) return;

    const elapsedSec = Math.floor((Date.now() - pollStartTime) / 1000);
    const interval = getVideoPollInterval(elapsedSec);

    pollTimer = setTimeout(tick, interval);
  };

  const tick = async () => {
    if (destroyed) return;

    try {
      const res = await apiFetch(`videos/${taskId}`, { method: "GET" });
      const data = await res.json();

      const elapsedSec = Math.floor((Date.now() - pollStartTime) / 1000);

      if (data.status === "completed" || data.status === "succeeded") {
        if (pollTimer) clearTimeout(pollTimer);
        destroyed = true;
        onComplete(data);
        return;
      }

      if (data.status === "failed" || data.status === "cancelled") {
        if (pollTimer) clearTimeout(pollTimer);
        destroyed = true;
        onError(new Error(data.error || `任务${data.status}`));
        return;
      }

      onProgress?.(elapsedSec, data);

      if (++attempts >= maxAttempts) {
        if (pollTimer) clearTimeout(pollTimer);
        destroyed = true;
        onError(new Error("轮询超时"));
        return;
      }

      scheduleNext();
    } catch (err: any) {
      if (pollTimer) clearTimeout(pollTimer);
      destroyed = true;

      const classified = classifyApiError({
        message: err.message || String(err),
        status: err instanceof ApiFetchError ? err.status : undefined,
        body: err instanceof ApiFetchError ? err.body : undefined,
        isTimeout: err.message?.includes("超时") || attempts >= maxAttempts,
        isNetworkError:
          err instanceof TypeError &&
          (err.message === "Failed to fetch" ||
            err.message?.includes("network")),
      });

      onError(new Error(classified.tip));
    }
  };

  // 首次轮询立即触发，不等待第一个间隔
  scheduleNext();

  // 返回销毁函数，外部可提前终止轮询
  return () => {
    destroyed = true;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };
}
