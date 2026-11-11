import { apiFetch, apiPath } from "../client/api";
import { useAccessStore } from "../store/access";
import type { VideoResult } from "../store/video";
import { CUSTOM_MODEL_PROVIDER } from "./custom-provider";
import { getLocalScope, isLocalWorkspaceActive } from "./local-workspace";
import { isVideoMediaPath } from "./video-api";
import { taskResultUrl, type LocalTask } from "./local-tasks";

export function videoResultFields(
  data: any,
  task: LocalTask,
  providerName?: string,
) {
  const output = taskResultUrl(data, "video");
  if (!output) throw new Error("上游未返回可读取的视频");
  if (!isVideoMediaPath(output)) return { url: output };
  return {
    url: new URL(apiPath(output, providerName), window.location.origin).href,
    mediaPath: output,
    tokenId: task.tokenId,
    ...(task.customApiBase ? { customApiBase: task.customApiBase } : {}),
  };
}

const VIDEO_CACHE_BYTES = 256 * 1024 * 1024;
const VIDEO_CACHE_TTL = 30 * 60_000;
const mediaCache = new Map<string, { blob: Blob; at: number }>();
const mediaRequests = new Map<
  string,
  {
    controller: AbortController;
    promise: Promise<Blob>;
    consumers: number;
  }
>();
let cacheBytes = 0;

function clearVideoMedia() {
  mediaCache.clear();
  cacheBytes = 0;
  for (const request of mediaRequests.values()) request.controller.abort();
  mediaRequests.clear();
}

if (typeof window !== "undefined") {
  for (const event of [
    "local-workspace-switch",
    "local-data-maintenance",
    "model-source-changing",
    "new-api-session-changed",
  ])
    window.addEventListener(event, (e) => {
      const selection = (e as CustomEvent<{ userId: number } | undefined>)
        .detail;
      if (
        event === "new-api-session-changed" &&
        selection &&
        isLocalWorkspaceActive() &&
        getLocalScope() === `user-${selection.userId}`
      )
        return;
      clearVideoMedia();
    });
}

export async function fetchVideoMedia(
  result: VideoResult,
  signal: AbortSignal,
) {
  if (signal.aborted || !isLocalWorkspaceActive())
    throw new DOMException("Cancelled", "AbortError");
  if (!isVideoMediaPath(result.mediaPath)) throw new Error("视频资源路径无效");
  const owner = getLocalScope();
  const access = useAccessStore.getState();
  const provider = result.customApiBase ? CUSTOM_MODEL_PROVIDER : undefined;
  const source = apiPath("", provider);
  if (result.customApiBase && source !== result.customApiBase)
    throw new Error("请切回生成视频时使用的自定义接口");
  const key = JSON.stringify([
    owner,
    source,
    result.mediaPath,
    result.tokenId,
    access.openaiApiKey,
  ]);
  const now = Date.now();
  for (const [id, entry] of mediaCache) {
    if (now - entry.at >= VIDEO_CACHE_TTL) {
      cacheBytes -= entry.blob.size;
      mediaCache.delete(id);
    }
  }
  const cached = mediaCache.get(key);
  if (cached) {
    mediaCache.delete(key);
    mediaCache.set(key, cached);
    return cached.blob;
  }
  let pending = mediaRequests.get(key);
  if (!pending) {
    const controller = new AbortController();
    const entry = {
      controller,
      consumers: 0,
      promise: undefined as unknown as Promise<Blob>,
    };
    entry.promise = downloadVideoMedia(result, controller.signal)
      .then((blob) => {
        if (
          !controller.signal.aborted &&
          mediaRequests.get(key) === entry &&
          blob.size <= VIDEO_CACHE_BYTES
        ) {
          while (
            mediaCache.size &&
            (mediaCache.size >= 10 ||
              cacheBytes + blob.size > VIDEO_CACHE_BYTES)
          ) {
            const oldest = mediaCache.keys().next().value!;
            cacheBytes -= mediaCache.get(oldest)!.blob.size;
            mediaCache.delete(oldest);
          }
          mediaCache.set(key, { blob, at: Date.now() });
          cacheBytes += blob.size;
        }
        return blob;
      })
      .finally(() => {
        if (mediaRequests.get(key) === entry) mediaRequests.delete(key);
      });
    mediaRequests.set(key, entry);
    pending = entry;
  }
  const shared = pending;
  shared.consumers++;
  return new Promise<Blob>((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown, blob?: Blob) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", cancel);
      shared.consumers--;
      if (!shared.consumers && mediaRequests.get(key) === shared) {
        mediaRequests.delete(key);
        shared.controller.abort();
      }
      if (error) reject(error);
      else resolve(blob!);
    };
    const cancel = () => finish(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", cancel, { once: true });
    shared.promise.then(
      (blob) => {
        if (
          signal.aborted ||
          shared.controller.signal.aborted ||
          !isLocalWorkspaceActive() ||
          getLocalScope() !== owner
        )
          cancel();
        else finish(undefined, blob);
      },
      (error) => finish(error),
    );
    if (signal.aborted) cancel();
  });
}

async function downloadVideoMedia(result: VideoResult, signal: AbortSignal) {
  if (!isVideoMediaPath(result.mediaPath)) throw new Error("视频资源路径无效");
  const owner = getLocalScope();
  const access = useAccessStore.getState();
  const provider = result.customApiBase ? CUSTOM_MODEL_PROVIDER : undefined;
  const source = apiPath("", provider);
  const check = () => {
    if (
      signal.aborted ||
      !isLocalWorkspaceActive() ||
      getLocalScope() !== owner
    )
      throw new DOMException("Cancelled", "AbortError");
    if (result.customApiBase) {
      if (
        source !== result.customApiBase ||
        apiPath("", provider) !== source ||
        useAccessStore.getState().openaiApiKey !== access.openaiApiKey
      )
        throw new Error("请切回生成视频时使用的自定义接口");
    }
  };
  check();
  const headers = {
    Accept: "video/*",
    ...(result.tokenId === null || result.customApiBase
      ? {}
      : { "X-New-Api-Token": String(result.tokenId) }),
  };
  const firstBytes = 4 * 1024 * 1024;
  const read = (
    range?: string,
    validator?: string,
    transferSignal = signal,
  ) => {
    check();
    return apiFetch(
      result.mediaPath!,
      {
        signal: transferSignal,
        headers: {
          ...headers,
          ...(range ? { Range: range } : {}),
          ...(validator ? { "If-Range": validator } : {}),
        },
      },
      provider,
    );
  };
  let response: Response;
  try {
    response = await read(
      result.customApiBase ? undefined : `bytes=0-${firstBytes - 1}`,
    );
  } catch (error) {
    // Some media providers reject Range entirely; only retry that explicit rejection.
    if ((error as { status?: number })?.status !== 416) throw error;
    response = await read();
  }
  let blob: Blob;
  if (response.status === 206) {
    const range = /^bytes 0-(\d+)\/(\d+)$/.exec(
      response.headers.get("content-range") || "",
    );
    const end = Number(range?.[1]),
      total = Number(range?.[2]);
    if (
      !range ||
      !Number.isSafeInteger(total) ||
      total <= 0 ||
      !Number.isSafeInteger(end) ||
      end >= total ||
      end >= firstBytes
    ) {
      await response.body?.cancel();
      throw new Error("视频分段响应无效，请重新加载");
    }
    const first = await response.blob();
    check();
    if (first.size !== end + 1)
      throw new Error("视频分段长度不匹配，请重新加载");
    if (first.size === total) {
      blob = first;
    } else {
      const etag = response.headers.get("etag");
      const modified = response.headers.get("last-modified");
      const validator =
        etag && /^"[^"]+"$/.test(etag)
          ? etag
          : modified && Number.isFinite(Date.parse(modified))
          ? modified
          : undefined;
      // Without a version validator, use a single complete response rather than mix versions.
      if (!validator || total > VIDEO_CACHE_BYTES) {
        const full = await read();
        if (full.status === 206) {
          await full.body?.cancel();
          throw new Error("接口未返回完整的视频文件");
        }
        blob = await full.blob();
      } else {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        try {
          const start = end + 1;
          const middle = start + Math.ceil((total - start) / 2);
          const ranges = [
            [start, middle - 1],
            [middle, total - 1],
          ].filter(([from, to]) => from <= to);
          const parts = await Promise.all(
            ranges.map(async ([from, to]) => {
              const part = await read(
                `bytes=${from}-${to}`,
                validator,
                controller.signal,
              );
              if (
                part.status !== 206 ||
                part.headers.get("content-range") !==
                  `bytes ${from}-${to}/${total}` ||
                part.headers.get(
                  validator === etag ? "etag" : "last-modified",
                ) !== validator
              ) {
                await part.body?.cancel();
                throw new Error("视频资源已变化，请重新加载");
              }
              const bytes = await part.blob();
              check();
              if (bytes.size !== to - from + 1)
                throw new Error("视频分段长度不匹配，请重新加载");
              return bytes;
            }),
          );
          blob = new Blob([first, ...parts], { type: first.type });
        } finally {
          controller.abort();
          signal.removeEventListener("abort", abort);
        }
      }
    }
  } else {
    blob = await response.blob();
  }
  check();
  if (!blob.size || blob.type.includes("json") || blob.type.startsWith("text/"))
    throw new Error("接口未返回可播放的视频文件");
  return blob;
}
