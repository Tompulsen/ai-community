import {
  getLocalScope,
  isLocalWorkspaceActive,
  localKey,
} from "./local-workspace";
import {
  isVideoMediaPath,
  readVideoTask,
  videoTaskPath,
  type VideoTaskFormat,
} from "./video-api";

export interface LocalTask {
  needsAttention?: boolean;
  paused?: boolean;
  protocol?: "async";
  requestId?: string;
  video?: {
    apiFormat?: VideoTaskFormat;
    size?: string;
    mode: string;
    aspectRatio?: string;
    resolution?: string;
    duration?: number;
  };
  id: string;
  kind: "image" | "video";
  upstreamId: string;
  sessionId?: string;
  messageId?: string;
  tokenId: number | null;
  customApiBase?: string;
  model: string;
  prompt: string;
  createdAt: number;
  requestStartedAt?: number;
}

/** Limit active GETs, without occupying a slot while a task waits to poll again. */
export function createTaskQueryQueue(limit = 6) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function query<T>(
    fetchTask: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (active >= limit)
      await new Promise<void>((resolve, reject) => {
        const start = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const index = waiting.indexOf(start);
          if (index !== -1) waiting.splice(index, 1);
          reject(new DOMException("Cancelled", "AbortError"));
        };
        waiting.push(start);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    else active++;
    try {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      return await fetchTask();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

// Shared by newly submitted jobs and recovered jobs in this browser tab.
const queryTask = createTaskQueryQueue();

function retryDelay(value: string | null | undefined, minimum: number) {
  if (!value?.trim()) return minimum;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(minimum, delay) : minimum;
}

export function rememberTask(task: LocalTask) {
  if (!isLocalWorkspaceActive()) return;
  localStorage.setItem(localKey(`task:${task.id}`), JSON.stringify(task));
}

export function forgetTask(id: string) {
  localStorage.removeItem(localKey(`task:${id}`));
}

export function pendingTasks(): LocalTask[] {
  const prefix = localKey("task:");
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix))
    .flatMap((key) => {
      try {
        const task = JSON.parse(localStorage.getItem(key)!);
        return task &&
          ["image", "video"].includes(task.kind) &&
          typeof task.upstreamId === "string" &&
          typeof task.id === "string"
          ? [task]
          : [];
      } catch {
        return [];
      }
    });
}

export function taskResultUrl(
  data: any,
  kind: LocalTask["kind"],
): string | undefined {
  if (kind === "video" && isVideoMediaPath(data.mediaPath))
    return data.mediaPath;
  const result =
    kind === "image"
      ? data.data?.[0]?.url || data.url || data.result?.url
      : data.video_url ||
        data.data?.[0]?.url ||
        data.url ||
        data.data?.video_url ||
        data.data?.url ||
        data.output?.url ||
        data.video?.url;
  return typeof result === "string" && /^https?:\/\//.test(result)
    ? result
    : undefined;
}

/** Resume GETs only. The original paid POST is never repeated. */
export async function pollLocalTask(
  ...args: Parameters<typeof queryLocalTask>
) {
  const [task] = args;
  const owner = getLocalScope();
  const update = (needsAttention: boolean) => {
    if (owner !== getLocalScope() || !isLocalWorkspaceActive()) return;
    const stored = pendingTasks().find((item) => item.id === task.id);
    if (stored) rememberTask({ ...stored, needsAttention });
  };
  update(false);
  try {
    return await queryLocalTask(...args);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      update(true);
    throw error;
  }
}

async function queryLocalTask(
  task: LocalTask,
  fetchTask: (path: string) => Promise<Response>,
  signal?: AbortSignal,
  onProgress?: (data: any) => void,
) {
  const owner = getLocalScope();
  let failures = 0;
  let rateLimited = 0;
  const deadline =
    Date.now() + (task.kind === "video" ? 2 * 60 * 60_000 : 30 * 60_000);
  for (
    let attempt = 0;
    task.protocol === "async" ? Date.now() < deadline : attempt < 240;
    attempt++
  ) {
    if (
      signal?.aborted ||
      !isLocalWorkspaceActive() ||
      owner !== getLocalScope()
    )
      throw new DOMException("Cancelled", "AbortError");
    const path =
      task.protocol === "async"
        ? `async-${
            task.kind === "image" ? "images" : "videos"
          }/v1/tasks/${encodeURIComponent(task.upstreamId)}`
        : task.kind === "video"
        ? videoTaskPath(task)
        : `images/generations?task_id=${encodeURIComponent(task.upstreamId)}`;
    let waitMs = task.protocol === "async" ? 5000 : attempt < 5 ? 2000 : 5000;
    try {
      const { response, data } = await queryTask(async () => {
        if (!isLocalWorkspaceActive() || owner !== getLocalScope())
          throw new DOMException("Cancelled", "AbortError");
        const response = await fetchTask(path);
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw Object.assign(new Error(`任务查询失败 (${response.status})`), {
            status: response.status,
            retryAfter: response.headers?.get("retry-after"),
          });
        }
        const raw = await response.json();
        const data =
          task.kind === "video" && task.protocol !== "async"
            ? await readVideoTask(raw, task, fetchTask)
            : raw;
        return { response, data };
      }, signal);
      waitMs = retryDelay(response.headers?.get("retry-after"), waitMs);
      if (
        signal?.aborted ||
        !isLocalWorkspaceActive() ||
        owner !== getLocalScope()
      )
        throw new DOMException("Cancelled", "AbortError");
      const status = String(data.status).toLowerCase();
      if (
        taskResultUrl(data, task.kind) &&
        (task.protocol === "async"
          ? status === "succeeded"
          : task.kind === "video" &&
            task.video?.apiFormat &&
            task.video.apiFormat !== "legacy"
          ? status === "completed"
          : true)
      )
        return data;
      if (["save_failed", "indeterminate", "expired"].includes(status)) {
        if (status === "expired") forgetTask(task.id);
        throw new TaskStoppedError(
          status === "save_failed"
            ? "生成已完成，但保存失败；任务记录已保留，请在服务商处重试保存，勿重新生成"
            : status === "indeterminate"
            ? "生成结果尚无法确认，任务记录已保留，请先核对使用日志，勿重复提交"
            : "任务或文件已过期",
        );
      }
      if (
        ["completed", "succeeded", "success"].includes(
          String(data.status).toLowerCase(),
        )
      ) {
        throw new TaskStoppedError(
          "上游任务已结束，但未返回可读取的结果链接，记录已保留",
        );
      }
      if (
        ["failed", "cancelled", "canceled", "error"].includes(
          String(data.status).toLowerCase(),
        )
      ) {
        forgetTask(task.id);
        const imageErrors: Record<string, string> = {
          upstream_image_count_exceeded: "上游返回图片数量超过安全上限",
          invalid_upstream_image_item: "上游返回的图片条目格式不正确",
          missing_upstream_image: "上游未返回有效图片链接或图片数据",
          invalid_upstream_image_json: "上游返回的图片响应格式不正确",
          invalid_image_url: "上游返回的图片链接不合法",
          blocked_image_port: "上游图片链接使用了不允许的端口",
          blocked_image_destination: "上游图片链接指向不允许的地址",
          invalid_image_base64: "上游返回的图片 Base64 数据无效",
          unsupported_image_type: "上游返回的图片格式不受支持",
          image_too_large: "上游返回的单张图片超过大小限制",
          image_storage_capacity_reached:
            "图片保存空间不足，勿重复生成，请联系管理员",
          insufficient_disk_space:
            "服务器磁盘空间不足，勿重复生成，请联系管理员",
        };
        throw new TaskStoppedError(
          typeof data.error === "string"
            ? data.error
            : typeof data.error?.message === "string"
            ? data.error.message
            : typeof data.error?.code === "string"
            ? imageErrors[data.error.code] ??
              `上游任务已结束：${data.error.code}`
            : "上游任务已结束，未生成结果",
        );
      }
      if (
        task.protocol === "async" &&
        !["queued", "submitting", "generating", "preparing", "saving"].includes(
          status,
        )
      ) {
        throw new TaskStoppedError(
          "任务返回未知状态，记录已保留，请核对服务商日志",
        );
      }
      failures = 0;
      rateLimited = 0;
      onProgress?.(data);
    } catch (error) {
      if (
        signal?.aborted ||
        !isLocalWorkspaceActive() ||
        owner !== getLocalScope() ||
        (error instanceof DOMException && error.name === "AbortError") ||
        error instanceof TaskStoppedError
      )
        throw error;
      const http = error as { status?: number; retryAfter?: string };
      if (http.status && [401, 403, 409].includes(http.status))
        throw new Error("请登录原账号并选择原密钥后恢复任务");
      if (
        http.status &&
        http.status >= 400 &&
        http.status < 500 &&
        ![408, 429].includes(http.status)
      ) {
        if (http.status === 410) forgetTask(task.id);
        throw error;
      }
      if (http.status === 429) {
        failures = 0;
        waitMs = retryDelay(
          http.retryAfter,
          Math.min(60_000, 5000 * 2 ** Math.min(rateLimited++, 4)),
        );
      } else if (
        ++failures >= 3 ||
        (error instanceof Error && /原账号|已结束/.test(error.message))
      )
        throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const timer = setTimeout(
        () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        Math.min(waitMs, Math.max(0, deadline - Date.now())),
      );
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  throw new Error("任务仍未完成，记录已保留，可稍后恢复查询");
}

class TaskStoppedError extends Error {}
