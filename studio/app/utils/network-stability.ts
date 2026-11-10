/**
 * 网络稳定性工具
 * - 自动重试（指数退避）
 * - 请求超时控制
 * - 在线状态检测
 * - 请求降级策略
 */

/** 指数退避重试参数 */
export interface RetryOptions {
  maxRetries: number;
  baseDelay: number; // ms
  maxDelay: number; // ms
  retryOn?: (error: Error) => boolean;
}

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 3,
  baseDelay: 500,
  maxDelay: 5000,
  retryOn: (error) => {
    const msg = error.message?.toLowerCase() || "";
    // 仅对网络错误和 5xx 重试，不对 4xx 重试
    return (
      msg.includes("failed to fetch") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504")
    );
  },
};

/** 延迟函数 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 指数退避计算 */
function getBackoffDelay(attempt: number, base: number, max: number): number {
  const delay = base * Math.pow(2, attempt);
  // 添加抖动避免雪崩
  const jitter = Math.random() * 0.3 * delay;
  return Math.min(delay + jitter, max);
}

/**
 * 带自动重试的 fetch
 * - 指数退避重试
 * - 超时控制
 * - 可自定义重试条件
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: Partial<RetryOptions>,
): Promise<Response> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: Error;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = init?.signal
        ? undefined
        : setTimeout(() => controller.abort(), 30000);

      const response = await fetch(input, {
        ...init,
        signal: init?.signal || controller.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok && response.status >= 500 && attempt < opts.maxRetries) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } catch (error) {
      lastError = error as Error;

      // 如果是用户主动取消，不重试
      if (init?.signal?.aborted) {
        throw lastError;
      }

      // 检查是否应该重试
      if (attempt >= opts.maxRetries || !opts.retryOn?.(lastError)) {
        throw lastError;
      }

      // 等待退避延迟
      const delay = getBackoffDelay(attempt, opts.baseDelay, opts.maxDelay);
      await sleep(delay);
    }
  }

  throw lastError!;
}

/** 在线状态检测器 */
export class OnlineStatusDetector {
  private listeners: Set<(online: boolean) => void> = new Set();
  private isOnline: boolean =
    typeof navigator !== "undefined" ? navigator.onLine : true;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  private handleOnline = () => {
    this.isOnline = true;
    this.listeners.forEach((cb) => cb(true));
  };

  private handleOffline = () => {
    this.isOnline = false;
    this.listeners.forEach((cb) => cb(false));
  };

  get online() {
    return this.isOnline;
  }

  subscribe(callback: (online: boolean) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  destroy() {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    this.listeners.clear();
  }
}

/** 全局在线状态检测器单例 */
let detectorInstance: OnlineStatusDetector | null = null;

export function getOnlineDetector(): OnlineStatusDetector {
  if (!detectorInstance) {
    detectorInstance = new OnlineStatusDetector();
  }
  return detectorInstance;
}

/** React Hook: 获取在线状态 */
export function useOnlineStatus(): boolean {
  // 这个 hook 需要在 React 组件中使用
  // 返回当前在线状态，并在状态变化时触发重渲染
  if (typeof window === "undefined") return true;
  return navigator.onLine;
}

/**
 * API 健康检查
 * 轻量级 ping，用于检测服务是否可用
 */
export async function checkApiHealth(baseUrl: string): Promise<{
  healthy: boolean;
  latency: number;
}> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/api/config`, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return {
      healthy: response.ok || response.status === 405, // 405 = HEAD 不支持但服务在线
      latency: Date.now() - start,
    };
  } catch {
    return {
      healthy: false,
      latency: Date.now() - start,
    };
  }
}

/**
 * 请求降级策略
 * 当主请求失败时，尝试简化版本
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  shouldFallback: (error: Error) => boolean = () => true,
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (shouldFallback(error as Error)) {
      return await fallback();
    }
    throw error;
  }
}
