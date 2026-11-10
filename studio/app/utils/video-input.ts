import type { MultimodalContent, RequestMessage } from "../client/api";
import type { ChatApiFormat } from "./chat-api-format";

const MAX_VIDEO_FRAMES = 12;
const MAX_REQUEST_FRAMES = 36;
const MAX_JPEG_DATA_BYTES = 12 * 1024 * 1024;
const MAX_FRAME_DIMENSION = 1024;
const MEDIA_WAIT_TIMEOUT = 15_000;
const VIDEO_TIMEOUT = 60_000;

export interface VideoInputOptions {
  model: string;
  format: ChatApiFormat;
  signal: AbortSignal;
  maxFrames?: number;
}

type FrameBudget = { bytes: number };

class VideoInputError extends Error {}

function reserveImageData(image: string, budget: FrameBudget) {
  budget.bytes += image.length;
  if (budget.bytes > MAX_JPEG_DATA_BYTES)
    throw new VideoInputError(
      "图片与视频采样画面总量超过 12MB，请缩小图片、缩短视频或减少素材后重试",
    );
}

function abortError() {
  return new DOMException("视频画面提取已取消", "AbortError");
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

function needsVideoFrames({ model, format }: VideoInputOptions) {
  if (format === "gemini") return false;
  if (format === "responses" || format === "claude") return true;
  return /(?:^|[/:])(?:gpt(?:[-._0-9]|$)|chatgpt(?:[-._0-9]|$)|o[134](?:[-._]|$)|claude(?:[-._]|$))/i.test(
    model.trim(),
  );
}

function frameLimit(value = MAX_VIDEO_FRAMES) {
  if (!Number.isFinite(value) || value < 1)
    throw new VideoInputError("视频采样帧数无效");
  return Math.min(MAX_VIDEO_FRAMES, Math.floor(value));
}

export function videoSampleTimes(
  duration: number,
  maxFrames = MAX_VIDEO_FRAMES,
): number[] {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new VideoInputError("无法读取视频时长，请重新上传有效的视频文件");
  const count = Math.min(
    frameLimit(maxFrames),
    Math.max(2, Math.ceil(duration) + 1),
  );
  if (count === 1) return [duration / 2];
  // Seeking exactly to duration can select the ended state instead of a frame.
  const last = duration - Math.min(0.05, duration / 100);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? last : (last * index) / (count - 1),
  );
}

function mediaError() {
  return new VideoInputError(
    "视频无法读取或解码。请确认视频编码受浏览器支持；远程视频须允许 CORS 跨域访问，可下载后重新上传。",
  );
}

function waitForVideo(
  video: HTMLVideoElement,
  events: string[],
  ready: () => boolean,
  signal: AbortSignal,
  deadline: number,
  start?: () => void,
) {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      events.forEach((event) => video.removeEventListener(event, check));
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      if (timer !== undefined) clearTimeout(timer);
    };
    const finish = (error?: Error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onError = () => finish(mediaError());
    const onAbort = () => finish(abortError());
    const check = () => {
      if (signal.aborted) onAbort();
      else if (video.error) onError();
      else if (ready()) finish();
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    const timeout = Math.min(MEDIA_WAIT_TIMEOUT, deadline - Date.now());
    if (timeout <= 0) {
      finish(new VideoInputError("视频画面提取超时，请使用更短的视频重试"));
      return;
    }
    events.forEach((event) => video.addEventListener(event, check));
    video.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(
      () =>
        finish(new VideoInputError("视频画面提取超时，请使用更短的视频重试")),
      timeout,
    );
    try {
      start?.();
      check();
    } catch {
      finish(mediaError());
    }
  });
}

function videoBlob(source: string): Blob {
  const match = /^data:(video\/[^;,]+);base64,([\s\S]*)$/i.exec(source);
  if (!match) throw new VideoInputError("视频数据格式无效，请重新上传视频");
  try {
    const decoded = atob(match[2].replace(/\s/g, ""));
    const bytes = Uint8Array.from(decoded, (character) =>
      character.charCodeAt(0),
    );
    return new Blob([bytes], { type: match[1] });
  } catch {
    throw new VideoInputError("视频数据格式无效，请重新上传视频");
  }
}

function frameTimestamp(time: number) {
  const total = Math.round(time * 1000);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(
    minutes,
  ).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
    total % 1000,
  ).padStart(3, "0")}`;
}

async function videoFrames(
  source: string,
  options: VideoInputOptions,
  budget: FrameBudget,
): Promise<MultimodalContent[]> {
  throwIfAborted(options.signal);
  if (typeof document === "undefined")
    throw new VideoInputError("当前环境无法提取视频画面，请在浏览器中发送");
  if (!source || !/^(?:data:|blob:|https?:\/\/)/i.test(source))
    throw new VideoInputError("视频地址无效，请重新上传视频");
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  let objectUrl: string | undefined;
  try {
    const deadline = Date.now() + VIDEO_TIMEOUT;
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    const url = source.startsWith("data:")
      ? (objectUrl = URL.createObjectURL(videoBlob(source)))
      : source;
    await waitForVideo(
      video,
      ["loadedmetadata", "durationchange"],
      () => video.readyState >= 1,
      options.signal,
      deadline,
      () => {
        video.src = url;
        video.load();
      },
    );
    const times = videoSampleTimes(video.duration, options.maxFrames);
    if (!video.videoWidth || !video.videoHeight)
      throw new VideoInputError("视频没有可读取的画面，请重新上传有效的视频");
    const scale = Math.min(
      1,
      MAX_FRAME_DIMENSION / video.videoWidth,
      MAX_FRAME_DIMENSION / video.videoHeight,
    );
    canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new VideoInputError("浏览器无法提取视频画面，请更换浏览器重试");
    const parts: MultimodalContent[] = [
      {
        type: "text",
        text: `以下为视频的 ${
          times.length
        } 张离散采样画面，视频时长 ${video.duration.toFixed(
          2,
        )} 秒。采样未覆盖全部细节，也未读取该视频的音轨；不得仅依据这些画面评价该视频的音乐、对白或音画同步。单独提供的音频附件可独立分析。`,
      },
    ];
    for (const time of times) {
      throwIfAborted(options.signal);
      await waitForVideo(
        video,
        ["seeked", "loadeddata", "canplay"],
        () =>
          !video.seeking &&
          video.readyState >= 2 &&
          Math.abs(video.currentTime - time) < 0.01,
        options.signal,
        deadline,
        () => {
          if (Math.abs(video.currentTime - time) >= 0.001)
            video.currentTime = time;
        },
      );
      throwIfAborted(options.signal);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.82);
      throwIfAborted(options.signal);
      reserveImageData(image, budget);
      const prefix = "data:image/jpeg;base64,";
      const payload = image.slice(prefix.length);
      const padding = payload.endsWith("==")
        ? 2
        : payload.endsWith("=")
        ? 1
        : 0;
      if (
        image.slice(0, prefix.length).toLowerCase() !== prefix ||
        !payload.length ||
        payload.length % 4 !== 0 ||
        /[^A-Za-z0-9+/]/.test(payload.slice(0, payload.length - padding))
      )
        throw new VideoInputError("视频画面编码失败，请重新上传视频");
      parts.push(
        { type: "text", text: `视频画面时间戳 ${frameTimestamp(time)}` },
        { type: "image_url", image_url: { url: image } },
      );
    }
    return parts;
  } catch (error) {
    if (options.signal.aborted) throw abortError();
    if (error instanceof VideoInputError) throw error;
    throw mediaError();
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    canvas.width = 0;
    canvas.height = 0;
    canvas.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function prepareContent(
  content: RequestMessage["content"],
  options: VideoInputOptions,
  budget: FrameBudget,
): Promise<RequestMessage["content"]> {
  throwIfAborted(options.signal);
  if (
    !needsVideoFrames(options) ||
    !Array.isArray(content) ||
    !content.some((part) => part.type === "video_url")
  )
    return content;
  const parts: MultimodalContent[] = [];
  for (const part of content) {
    throwIfAborted(options.signal);
    if (part.type === "video_url") {
      parts.push(
        ...(await videoFrames(part.video_url?.url ?? "", options, budget)),
      );
    } else {
      parts.push(part);
    }
  }
  return parts;
}

export function prepareVideoContent(
  content: RequestMessage["content"],
  options: VideoInputOptions,
): Promise<RequestMessage["content"]> {
  return prepareVideoMessages([{ role: "user", content }], options).then(
    (messages) => messages[0].content,
  );
}

export async function prepareVideoMessages(
  messages: RequestMessage[],
  options: VideoInputOptions,
): Promise<RequestMessage[]> {
  throwIfAborted(options.signal);
  if (!needsVideoFrames(options)) return messages;
  const videoCount = messages.reduce(
    (count, message) =>
      count +
      (Array.isArray(message.content)
        ? message.content.filter((part) => part.type === "video_url").length
        : 0),
    0,
  );
  if (!videoCount) return messages;
  if (videoCount > MAX_REQUEST_FRAMES)
    throw new VideoInputError("视频附件超过 36 个，请减少视频附件后重试");
  const maxFrames = Math.min(
    frameLimit(options.maxFrames),
    Math.floor(MAX_REQUEST_FRAMES / videoCount),
  );
  const budget = { bytes: 0 };
  // Count every inline image before a video decoder allocates more image data.
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const url = part.type === "image_url" ? part.image_url?.url : undefined;
      if (url && /^data:image\//i.test(url.slice(0, 11)))
        reserveImageData(url, budget);
    }
  }
  const prepared: RequestMessage[] = [];
  for (const message of messages) {
    const content = await prepareContent(
      message.content,
      { ...options, maxFrames },
      budget,
    );
    prepared.push(
      content === message.content ? message : { ...message, content },
    );
  }
  return prepared;
}
