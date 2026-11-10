import type { VideoResult } from "../store/video";
import { getLocalScope, isLocalWorkspaceActive } from "./local-workspace";

const posters = new Map<string, string>();
let posterEpoch = 0;
function posterKey(result: VideoResult) {
  return JSON.stringify([
    getLocalScope(),
    result.id,
    result.mediaPath || result.url,
    result.customApiBase,
    result.tokenId,
  ]);
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
      posterEpoch++;
      posters.clear();
    });
}

export function cachedVideoPoster(result: VideoResult) {
  return isLocalWorkspaceActive()
    ? result.coverUrl || posters.get(posterKey(result))
    : undefined;
}

export function videoPosterCapture(result: VideoResult) {
  const epoch = posterEpoch;
  const owner = isLocalWorkspaceActive() ? getLocalScope() : undefined;
  return (video: HTMLVideoElement) => {
    if (
      epoch !== posterEpoch ||
      !isLocalWorkspaceActive() ||
      owner !== getLocalScope()
    )
      return;
    rememberVideoPoster(result, video);
  };
}

function posterFrame(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 480 / video.videoWidth, 480 / video.videoHeight);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Video cover canvas is unavailable");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let squares = 0;
    let peak = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += 64) {
      const brightness =
        data[index] * 0.2126 +
        data[index + 1] * 0.7152 +
        data[index + 2] * 0.0722;
      sum += brightness;
      squares += brightness * brightness;
      peak = Math.max(peak, data[index], data[index + 1], data[index + 2]);
      count++;
    }
    const mean = sum / count;
    // Skip blank black frames, while retaining dark scenes with visible detail.
    if (mean < 10 && squares / count - mean * mean < 4 && peak < 24) return;
    const poster = canvas.toDataURL("image/jpeg", 0.7);
    if (!poster.startsWith("data:image/"))
      throw new Error("Video cover encoding failed");
    return poster;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function waitForPosterFrame(
  video: HTMLVideoElement,
  ready: () => boolean,
  signal: AbortSignal,
  deadline: number,
  start: () => void,
) {
  return new Promise<void>((resolve, reject) => {
    const events = ["loadedmetadata", "loadeddata", "canplay", "seeked"];
    const finish = (error?: Error) => {
      clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, check);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const failed = () => finish(new Error("Video cover could not be decoded"));
    const aborted = () => finish(new DOMException("Cancelled", "AbortError"));
    const check = () => {
      if (signal.aborted) aborted();
      else if (video.error) failed();
      else if (ready()) finish();
    };
    const timer = setTimeout(
      () => finish(new Error("Video cover extraction timed out")),
      Math.max(0, deadline - Date.now()),
    );
    if (signal.aborted) {
      aborted();
      return;
    }
    if (Date.now() >= deadline) {
      finish(new Error("Video cover extraction timed out"));
      return;
    }
    for (const event of events) video.addEventListener(event, check);
    video.addEventListener("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    try {
      start();
      check();
    } catch {
      failed();
    }
  });
}

export async function extractVideoPoster(
  source: string,
  signal: AbortSignal,
): Promise<{ poster: string; duration: number } | undefined> {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  if (!/^(?:https?:|blob:|data:video\/)/i.test(source))
    throw new Error("Invalid video cover source");
  const video = document.createElement("video");
  const deadline = Date.now() + 12_000;
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  try {
    await waitForPosterFrame(
      video,
      () => video.readyState >= 1,
      signal,
      deadline,
      () => {
        video.src = source;
        video.load();
      },
    );
    const duration = video.duration;
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !video.videoWidth ||
      !video.videoHeight
    )
      throw new Error("Invalid video cover metadata");
    const last = Math.max(0, duration - Math.min(0.05, duration / 100));
    const times = new Set(
      [Math.min(0.5, duration * 0.1), duration * 0.25, duration * 0.5].map(
        (time) => Math.min(time, last),
      ),
    );
    for (const time of times) {
      await waitForPosterFrame(
        video,
        () =>
          !video.seeking &&
          video.readyState >= 2 &&
          Math.abs(video.currentTime - time) < 0.01,
        signal,
        deadline,
        () => {
          video.currentTime = time;
        },
      );
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const poster = posterFrame(video);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (poster) return { poster, duration };
    }
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

function rememberVideoPoster(result: VideoResult, video: HTMLVideoElement) {
  if (!isLocalWorkspaceActive() || !video.videoWidth || !video.videoHeight)
    return;
  const key = posterKey(result);
  if (result.coverUrl || posters.has(key)) return;
  try {
    const poster = posterFrame(video);
    if (!poster) return;
    posters.set(key, poster);
    if (posters.size > 24) posters.delete(posters.keys().next().value!);
  } catch {
    // Cross-origin videos can still play when the browser forbids frame capture.
  }
}
