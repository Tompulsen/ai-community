import { classifyApiError, detectBase64Mime } from "@/app/client/api";

export interface AsyncTaskState {
  taskId: string | null;
  status: "idle" | "pending" | "success" | "failed" | "cancelled";
  /** 细分任务状态文案：生图中 / 渲染中 / 完成 / 失败 */
  statusLabel: string;
  progress: number;
  error: string | null;
  controller: AbortController | null;
  pollingTimer: ReturnType<typeof setTimeout> | null;
}

export interface AsyncTaskCallbacks {
  onProgress?: (progress: number, statusLabel?: string) => void;
  onStatusChange?: (status: AsyncTaskState["status"]) => void;
  onComplete?: (imageUrl: string) => void;
  onError?: (error: string) => void;
}

// 自适应轮询间隔（毫秒）
// 阶段 1 (0-10秒): 2秒间隔 - 快速启动
// 阶段 2 (10-30秒): 5秒间隔 - 中等速度
// 阶段 3 (30秒+): 10秒间隔 - 慢速，减少请求
const POLL_INTERVAL_STAGES = [
  { threshold: 10, interval: 2000 },
  { threshold: 30, interval: 5000 },
  { threshold: Infinity, interval: 10000 },
];

const MAX_POLLING_TIME = 360000; // 6分钟
const SUBMIT_TIMEOUT_MS = 60000; // 提交阶段超时 60s
const MAX_CONSECUTIVE_ERRORS = 5;

/** 上游 API 状态 → 前端文案映射 */
const STATUS_LABEL_MAP: Record<string, string> = {
  queued: "生图中",
  pending: "处理中",
  processing: "渲染中",
  running: "渲染中",
  completed: "完成",
  succeeded: "完成",
  success: "完成",
  done: "完成",
  failed: "生成失败",
  error: "生成失败",
  cancelled: "已取消",
  canceled: "已取消",
};

function getStatusLabel(apiStatus: string): string {
  return STATUS_LABEL_MAP[apiStatus] || "处理中";
}

// HTTP 状态码判断
function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

// 指数退避重试（带抖动）
function getBackoffDelay(attempt: number): number {
  const base = Math.min(Math.pow(2, attempt - 1) * 1000, 30000);
  const jitter = Math.random() * base * 0.5;
  return base + jitter;
}

// API 错误消息提取
function extractErrorMessage(data: any): string {
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.error?.message === "string") return data.error.message;
  if (typeof data?.message === "string") return data.message;
  return "未知错误";
}

// 自适应轮询间隔
function getAdaptivePollInterval(elapsedMs: number): number {
  const elapsedSec = elapsedMs / 1000;
  for (const stage of POLL_INTERVAL_STAGES) {
    if (elapsedSec < stage.threshold) {
      return stage.interval;
    }
  }
  return POLL_INTERVAL_STAGES[POLL_INTERVAL_STAGES.length - 1].interval;
}

export class AsyncTaskManager {
  private state: AsyncTaskState = {
    taskId: null,
    status: "idle",
    statusLabel: "",
    progress: 0,
    error: null,
    controller: null,
    pollingTimer: null,
  };

  private callbacks: AsyncTaskCallbacks = {};
  private startTime: number = 0;
  private pollStartTime: number = 0;
  private consecutiveErrors: number = 0;
  private pollUrlBuilder: ((taskId: string, apiUrl: string) => string) | null =
    null;

  getState(): Readonly<AsyncTaskState> {
    return { ...this.state };
  }

  setCallbacks(callbacks: AsyncTaskCallbacks) {
    this.callbacks = callbacks;
  }

  private updateState(updates: Partial<AsyncTaskState>) {
    Object.assign(this.state, updates);
    this.callbacks.onStatusChange?.(this.state.status);
    // 只要状态标签变化就通知进度回调（保持消息刷新）
    if (updates.statusLabel !== undefined || updates.progress !== undefined) {
      this.callbacks.onProgress?.(this.state.progress, this.state.statusLabel);
    }
  }

  private updateProgress(progress: number, statusLabel?: string) {
    this.state.progress = progress;
    if (statusLabel !== undefined) {
      this.state.statusLabel = statusLabel;
    }
    this.callbacks.onProgress?.(this.state.progress, this.state.statusLabel);
  }

  async submitTask(
    apiUrl: string,
    apiKey: string,
    body: Record<string, any>,
    pollUrlBuilder?: (taskId: string, apiUrl: string) => string,
  ): Promise<boolean> {
    this.cancel();
    this.startTime = Date.now();
    this.consecutiveErrors = 0;
    this.pollUrlBuilder = pollUrlBuilder ?? null;

    this.state.controller = new AbortController();

    try {
      // 优先使用传入的 apiKey，否则使用访问令牌
      let authHeader = apiKey ? `Bearer ${apiKey}` : "";
      if (!authHeader) {
        try {
          const token = localStorage.getItem("site_access_token");
          if (token) {
            authHeader = `Bearer ${token}`;
          }
        } catch {
          // localStorage 不可用时忽略
        }
      }

      // 提交阶段超时 60s，避免请求永远挂起
      const submitTimeoutId = setTimeout(
        () => this.state.controller?.abort(),
        SUBMIT_TIMEOUT_MS,
      );

      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          body: JSON.stringify({ ...body, async: true }),
          signal: this.state.controller.signal,
        });

        clearTimeout(submitTimeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            extractErrorMessage(errorData) || `HTTP ${response.status}`,
          );
        }

        const result = await response.json();

        if (!result.task_id) {
          return false;
        }

        this.updateState({
          taskId: result.task_id,
          status: "pending",
          statusLabel: "生图中",
          progress: 0,
          error: null,
        });

        this.pollStartTime = Date.now();
        this.startPolling(apiUrl, apiKey);
        return true;
      } finally {
        clearTimeout(submitTimeoutId);
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        this.updateState({ status: "cancelled" });
        return false;
      }
      console.error("[AsyncTask] Submit failed:", error);
      return false;
    }
  }

  private startPolling(apiUrl: string, apiKey: string) {
    this.stopPolling();
    this.pollWithAdaptiveInterval(apiUrl, apiKey);
  }

  private pollWithAdaptiveInterval(apiUrl: string, apiKey: string) {
    if (this.state.status !== "pending") {
      this.stopPolling();
      return;
    }

    const elapsed = Date.now() - this.startTime;
    if (elapsed > MAX_POLLING_TIME) {
      this.stopPolling();
      this.state.controller?.abort();
      const classified = classifyApiError({
        isTimeout: true,
        message: "任务超时",
      });
      this.updateState({
        status: "failed",
        statusLabel: "超时",
        error: classified.tip,
      });
      this.callbacks.onError?.(classified.tip);
      return;
    }

    const pollElapsed = Date.now() - this.pollStartTime;
    const interval = getAdaptivePollInterval(pollElapsed);

    this.state.pollingTimer = setTimeout(async () => {
      if (this.state.status !== "pending") {
        this.stopPolling();
        return;
      }

      try {
        // 优先使用传入的 apiKey，否则使用访问令牌
        let authHeader = apiKey ? `Bearer ${apiKey}` : "";
        if (!authHeader) {
          try {
            const token = localStorage.getItem("site_access_token");
            if (token) {
              authHeader = `Bearer ${token}`;
            }
          } catch {
            // localStorage 不可用时忽略
          }
        }

        const taskId = this.state.taskId;
        if (!taskId) {
          this.stopPolling();
          return;
        }

        const pollUrl = this.pollUrlBuilder
          ? this.pollUrlBuilder(taskId, apiUrl)
          : `${apiUrl}?task_id=${taskId}`;

        const response = await fetch(pollUrl, {
          method: "GET",
          headers: authHeader ? { Authorization: authHeader } : {},
        });

        if (!response.ok) {
          this.consecutiveErrors++;
          if (this.consecutiveErrors > MAX_CONSECUTIVE_ERRORS) {
            const classified = classifyApiError({
              message: `HTTP ${response.status}`,
              status: response.status,
            });
            this.updateState({
              status: "failed",
              statusLabel: "请求失败",
              error: classified.tip,
            });
            this.stopPolling();
            this.callbacks.onError?.(classified.tip);
            return;
          }
          // 指数退避重试
          const backoff = getBackoffDelay(this.consecutiveErrors);
          setTimeout(
            () => this.pollWithAdaptiveInterval(apiUrl, apiKey),
            backoff,
          );
          return;
        }

        this.consecutiveErrors = 0;
        const result = await response.json();
        const status = result.status?.toLowerCase();

        switch (status) {
          case "pending":
          case "processing":
          case "running":
          case "queued": {
            const label = getStatusLabel(status);
            this.updateProgress(result.progress ?? 0, label);
            this.pollWithAdaptiveInterval(apiUrl, apiKey);
            break;
          }

          case "completed":
          case "succeeded":
          case "success":
          case "done":
            this.stopPolling();
            this.updateState({
              status: "success",
              statusLabel: "完成",
              progress: 100,
            });
            const imageUrl =
              result.data?.[0]?.url || result.data?.[0]?.b64_json;
            if (imageUrl) {
              // b64_json 可能是裸 base64 或完整 data URI（某些上游会带前缀）
              if (result.data?.[0]?.b64_json && !result.data?.[0]?.url) {
                const b64 = imageUrl as string;
                if (b64.startsWith("data:image/")) {
                  this.callbacks.onComplete?.(b64);
                } else {
                  this.callbacks.onComplete?.(
                    `data:${detectBase64Mime(b64)};base64,${b64}`,
                  );
                }
              } else {
                this.callbacks.onComplete?.(imageUrl);
              }
            } else {
              if (process.env.NODE_ENV !== "production") {
                console.warn("[AsyncTask] Poll success but no image data");
              }
            }
            break;

          case "failed":
          case "error":
          case "cancelled":
          case "canceled":
            this.stopPolling();
            const label = getStatusLabel(status);
            const errorMsg = extractErrorMessage(result) || "生成失败";
            const classified = classifyApiError({
              message: errorMsg,
              body: result,
            });
            this.updateState({
              status: "failed",
              statusLabel: label,
              error: classified.tip,
            });
            this.callbacks.onError?.(classified.tip);
            break;

          default:
            // 未知状态，继续轮询
            this.updateProgress(result.progress ?? 0, "处理中");
            this.pollWithAdaptiveInterval(apiUrl, apiKey);
            break;
        }
      } catch (error: any) {
        this.consecutiveErrors++;
        console.error("[AsyncTask] Polling error:", error);

        if (this.consecutiveErrors > MAX_CONSECUTIVE_ERRORS) {
          const classified = classifyApiError({
            message: error?.message || String(error),
            isNetworkError:
              error instanceof TypeError &&
              (error.message === "Failed to fetch" ||
                error.message?.includes("network")),
          });
          this.updateState({
            status: "failed",
            statusLabel: "网络错误",
            error: classified.tip,
          });
          this.stopPolling();
          this.callbacks.onError?.(classified.tip);
          return;
        }

        // 指数退避重试
        const backoff = getBackoffDelay(this.consecutiveErrors);
        setTimeout(
          () => this.pollWithAdaptiveInterval(apiUrl, apiKey),
          backoff,
        );
      }
    }, interval);
  }

  private stopPolling() {
    if (this.state.pollingTimer) {
      clearTimeout(this.state.pollingTimer);
      this.state.pollingTimer = null;
    }
  }

  cancel() {
    this.stopPolling();
    this.state.controller?.abort();
    this.pollUrlBuilder = null;
    this.updateState({
      taskId: null,
      status: "idle",
      progress: 0,
      error: null,
      controller: null,
    });
  }

  reset() {
    this.cancel();
    this.updateState({
      status: "idle",
      progress: 0,
      error: null,
    });
  }
}

export const asyncTaskManager = new AsyncTaskManager();

// 导出工具函数供其他模块使用
export { isRetryableHttpStatus, getBackoffDelay, extractErrorMessage };
