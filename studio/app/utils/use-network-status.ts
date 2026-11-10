"use client";

import { useState, useEffect, useCallback } from "react";
import { getOnlineDetector } from "./network-stability";
import { showToast } from "../components/toast";

/**
 * React Hook: 监听网络在线状态
 * - 网络断开时显示 Toast 提示
 * - 网络恢复时显示 Toast 提示
 * - 返回当前在线状态
 */
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const detector = getOnlineDetector();
    let wasOffline = !detector.online;

    // 初始检查
    if (!detector.online) {
      showToast("网络已断开，请检查网络连接", "warning", 5000);
    }

    const unsubscribe = detector.subscribe((online) => {
      setIsOnline(online);

      if (online && wasOffline) {
        showToast("网络已恢复", "success", 2000);
        wasOffline = false;
      } else if (!online) {
        showToast("网络已断开，请检查网络连接", "error", 5000);
        wasOffline = true;
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return isOnline;
}

/**
 * React Hook: 带重试的异步操作
 * - 自动重试失败的请求
 * - 指数退避
 * - 可手动触发重试
 */
export function useRetryableAsync<T>(
  asyncFn: () => Promise<T>,
  deps: any[] = [],
  options?: {
    maxRetries?: number;
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;
  },
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const maxRetries = options?.maxRetries ?? 3;

  const execute = useCallback(
    async (isRetry = false) => {
      setLoading(true);
      setError(null);

      try {
        const result = await asyncFn();
        setData(result);
        setRetryCount(0);
        options?.onSuccess?.(result);
      } catch (e) {
        const err = e as Error;
        if (isRetry && retryCount < maxRetries) {
          // 指数退避重试
          const delay = Math.min(500 * Math.pow(2, retryCount), 5000);
          setTimeout(() => {
            setRetryCount((c) => c + 1);
            execute(true);
          }, delay);
        } else {
          setError(err);
          options?.onError?.(err);
        }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    execute(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const retry = useCallback(() => {
    setRetryCount(0);
    execute(true);
  }, [execute]);

  return { data, error, loading, retry, retryCount };
}
