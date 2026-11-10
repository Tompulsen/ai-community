import { getLocalScope } from "./local-workspace";
import { getImageBlob } from "../store/gallery";

export interface ImageDownloadProgress {
  loaded: number;
  total?: number;
}

type ProgressListener = (progress: ImageDownloadProgress) => void;
interface ImageAssetRequest {
  promise: Promise<Blob>;
  listeners: Set<ProgressListener>;
  progress?: ImageDownloadProgress;
}

const pending = new Map<string, ImageAssetRequest>();

export function invalidateImageAsset(src: string) {
  pending.delete(`${getLocalScope()}:${src}`);
}

export async function fetchImageBlob(
  src: string,
  onProgress?: ProgressListener,
): Promise<Blob> {
  const key = `${getLocalScope()}:${src}`;
  let request = pending.get(key);
  if (!request) {
    request = createImageRequest(src);
    pending.set(key, request);
    while (pending.size > 4) pending.delete(pending.keys().next().value!);
  }
  if (onProgress) {
    request.listeners.add(onProgress);
    if (request.progress) onProgress(request.progress);
  }
  try {
    const blob = await request.promise;
    // Large originals remain in IndexedDB rather than the in-memory cache.
    if (blob.size > 8 * 1024 * 1024 && pending.get(key) === request)
      pending.delete(key);
    return blob;
  } catch (error) {
    if (pending.get(key) === request) pending.delete(key);
    throw error;
  } finally {
    if (onProgress) request.listeners.delete(onProgress);
  }
}

function createImageRequest(src: string): ImageAssetRequest {
  let lastNotification = 0;
  const update = (progress: ImageDownloadProgress, force = false) => {
    request.progress = progress;
    const timestamp = performance.now();
    if (force || timestamp - lastNotification >= 100) {
      lastNotification = timestamp;
      request.listeners.forEach((listener) => listener(progress));
    }
  };
  const request: ImageAssetRequest = {
    listeners: new Set(),
    promise: Promise.resolve().then(async () => {
      const data = /^data:(image\/[^;,]+);base64,(.*)$/s.exec(src);
      if (data) {
        return new Blob(
          [Uint8Array.from(atob(data[2]), (c) => c.charCodeAt(0))],
          {
            type: data[1],
          },
        );
      }
      const url = new URL(src, window.location.href);
      const target =
        ["http:", "https:"].includes(url.protocol) &&
        url.origin !== window.location.origin
          ? `/studio/api/proxy-image?url=${encodeURIComponent(url.href)}`
          : url.href;
      update({ loaded: 0 }, true);
      const response = await fetch(target);
      if (!response.ok)
        throw new Error(`Image request failed (${response.status})`);
      const encoding = response.headers.get("content-encoding");
      const imageLength = response.headers.get("x-image-content-length");
      const length = Number(
        imageLength || response.headers.get("content-length"),
      );
      let total =
        (imageLength || !encoding || encoding === "identity") &&
        Number.isSafeInteger(length) &&
        length > 0
          ? length
          : undefined;
      update({ loaded: 0, total }, true);
      if (!response.body) {
        const blob = await response.blob();
        if (!blob.size) throw new Error("Invalid image response");
        update({ loaded: blob.size, total: blob.size }, true);
        return blob;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          if (total && loaded > total) total = undefined;
          update({ loaded, total });
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      const blob = new Blob(chunks, {
        type: response.headers.get("content-type") || "",
      });
      if (!blob.size) throw new Error("Invalid image response");
      update({ loaded: blob.size, total: blob.size }, true);
      return blob;
    }),
  };
  return request;
}

export async function loadImageAsset(
  src: string,
  imageId?: string,
  retry = false,
  onProgress?: ProgressListener,
) {
  if (retry) invalidateImageAsset(src);
  if (imageId && !retry) {
    try {
      return await getImageBlob(imageId);
    } catch {
      // Older histories and images excluded from auto-save use the source URL.
    }
  }
  return fetchImageBlob(src, onProgress);
}
