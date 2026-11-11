import type {
  VideoDraft,
  VideoGenMode,
  VideoAspectRatio,
  VideoResolution,
} from "../store/video";
import { videoCapabilities } from "./video-capabilities";
import type { LocalTask } from "./local-tasks";
import {
  VIDEO_RATIOS,
  isVideoSizeAuto,
  videoSizeParameters,
} from "./video-size";

// Retain historical protocol names for saved tasks and model parameter families.
export type VideoApiFormat = "openai" | "xai" | "seedance" | "gemini";
export type VideoTaskFormat = VideoApiFormat | "legacy" | "plugin";
export const MAX_VIDEO_REFERENCES = 10;

export function videoApiFormat(_value?: string): "openai" {
  return "openai";
}

export function videoParameterFormat(
  format: VideoApiFormat,
  model = "",
): VideoApiFormat {
  if (format !== "openai") return format;
  if (/seedance/i.test(model)) return "seedance";
  if (/grok|grok-imagine-video/i.test(model)) return "xai";
  if (/veo/i.test(model)) return "gemini";
  return format;
}

export function videoBuiltinParameters(draft: VideoDraft) {
  const format = videoParameterFormat(draft.apiFormat, draft.model);
  const options = draft.protocolOptions?.[draft.apiFormat] ?? {};
  const result: Record<string, unknown> = {};
  if (
    (format === "xai" || format === "seedance") &&
    typeof options.generateAudio === "boolean"
  )
    result.generate_audio = options.generateAudio;
  if (format === "gemini") {
    if (options.seed?.trim()) {
      const seed = Number(options.seed);
      if (!Number.isSafeInteger(seed) || seed < 0)
        throw new Error("随机种子必须是非负整数");
      result.seed = seed;
    }
    if (options.personGeneration)
      result.personGeneration = options.personGeneration;
  }
  return result;
}

export function videoOptions(
  format: VideoApiFormat,
  model = "",
  mode?: VideoGenMode,
  _resolution?: VideoResolution,
) {
  format = videoParameterFormat(format, model);
  const modes: VideoGenMode[] = [
    "text-to-video",
    "image-to-video",
    "first-last-frame",
    "reference-to-video",
  ];
  const ratios: VideoAspectRatio[] = VIDEO_RATIOS;
  const capabilities = videoCapabilities(model, mode);
  const resolutions: VideoResolution[] = capabilities
    ? [...capabilities.resolutions, "auto"]
    : ["auto"];
  const durations = capabilities?.durations ?? [];
  return {
    modes,
    ratios,
    resolutions,
    durations,
    limitsKnown: !!capabilities,
    maxReferences: MAX_VIDEO_REFERENCES,
    parameterFormat: format,
    usesSize: format === "openai",
  };
}

export function videoUploadMode(
  mode: VideoGenMode,
  count: number,
): VideoGenMode {
  if (count > 2 || (count > 1 && mode !== "first-last-frame"))
    return "reference-to-video";
  return mode === "text-to-video" ? "image-to-video" : mode;
}

export function videoDraftForFormat(draft: VideoDraft): Partial<VideoDraft> {
  const format = videoApiFormat(draft.apiFormat);
  const options = videoOptions(
    format,
    draft.model,
    draft.mode,
    draft.resolution,
  );
  const mode = options.modes.includes(draft.mode)
    ? draft.mode
    : options.modes[0];
  return {
    apiFormat: format,
    mode,
    ...(isVideoSizeAuto(draft) ? { size: "auto" } : {}),
    ...(draft.aspectRatio === "adaptive" ? { aspectRatio: "auto" } : {}),
    ...(draft.apiFormat !== "openai" &&
    ["xai", "seedance", "gemini"].includes(draft.apiFormat) &&
    draft.customParams?.[draft.apiFormat]?.trim() &&
    draft.customParams.openai === undefined
      ? {
          legacyCustomFormat: draft.apiFormat as Exclude<
            VideoApiFormat,
            "openai"
          >,
        }
      : {}),
    ...(draft.apiFormat !== "openai" && draft.protocolOptions?.[draft.apiFormat]
      ? {
          protocolOptions: {
            ...draft.protocolOptions,
            openai: {
              ...draft.protocolOptions.openai,
              ...draft.protocolOptions[draft.apiFormat],
            },
          },
        }
      : {}),
    ...(format === "openai" &&
    options.parameterFormat !== "openai" &&
    (draft.openaiReferenceSource === "file_id" ||
      (options.parameterFormat === "gemini" &&
        draft.openaiReferenceSource === "image_url"))
      ? { openaiReferenceSource: "upload" as const }
      : {}),
  };
}

export function parseVideoCustomParams(value = ""): Record<string, unknown> {
  if (!value.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("自定义参数必须是有效的 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("自定义参数必须是 JSON 对象");
  return parsed as Record<string, unknown>;
}

export function videoCustomParams(draft: VideoDraft): Record<string, unknown> {
  if (draft.legacyCustomFormat)
    throw new Error(
      "旧接口的自定义参数需按 OpenAI Video 重新填写；原内容已保留，清空可停用旧参数",
    );
  return parseVideoCustomParams(draft.customParams?.openai);
}

function imageData(url: string) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!match) throw new Error("参考图必须是 PNG、JPEG 或 WebP 图片");
  return { mimeType: match[1], bytesBase64Encoded: match[2] };
}

export function openaiVideoReference(draft: VideoDraft) {
  if (
    draft.apiFormat !== "openai" ||
    !["image-to-video", "first-last-frame"].includes(draft.mode)
  )
    return undefined;
  if (draft.openaiReferenceSource === "file_id") {
    if (videoParameterFormat("openai", draft.model) !== "openai")
      throw new Error("当前兼容格式请使用本地图片或图片 URL");
    const fileId = draft.openaiFileId?.trim();
    if (!fileId || /\s/.test(fileId))
      throw new Error("请填写有效的参考文件 ID，不能包含空白字符");
    return { file_id: fileId };
  }
  if (draft.openaiReferenceSource === "image_url") {
    const url = draft.openaiImageUrl?.trim() ?? "";
    validateVideoImageUrl(url);
    if (draft.mode === "first-last-frame")
      validateVideoImageUrl(draft.openaiLastImageUrl?.trim() ?? "");
    return { image_url: url };
  }
  return undefined;
}

function validateVideoImageUrl(url: string) {
  if (url.startsWith("data:")) {
    imageData(url);
    return;
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error("参考图片 URL 必须是 HTTP、HTTPS 链接或图片 Base64");
  }
}

export function buildVideoRequest(
  draft: VideoDraft,
  model: string,
): { path: string; body: string | FormData } {
  draft = {
    ...draft,
    ...videoDraftForFormat({ ...draft, model }),
    mode: draft.mode,
  };
  const format = videoApiFormat(draft.apiFormat);
  const custom = videoCustomParams(draft);
  const nativeSize = videoSizeParameters(draft, "gemini");
  const builtin = videoBuiltinParameters({ ...draft, model });
  if (!model || !draft.prompt.trim())
    throw new Error("请选择模型并填写视频提示词");
  const options = videoOptions(format, model, draft.mode, draft.resolution);
  if (!options.modes.includes(draft.mode))
    throw new Error("当前接口或模型不支持此生成模式");
  if (!Number.isFinite(draft.duration))
    throw new Error("视频时长必须是有效数字");
  const compat = videoParameterFormat(format, model);
  const customMetadata = custom.metadata;
  if (compat === "seedance" && Object.hasOwn(custom, "input_reference"))
    throw new Error(
      "Seedance 兼容格式请使用参考素材或 metadata.content 传入参考图",
    );
  if (
    compat !== "openai" &&
    customMetadata !== undefined &&
    (!customMetadata ||
      typeof customMetadata !== "object" ||
      Array.isArray(customMetadata))
  )
    throw new Error("当前兼容格式的 metadata 必须是 JSON 对象");
  const metadata = customMetadata as Record<string, unknown> | undefined;
  const hasCustomReference =
    Object.hasOwn(custom, "input_reference") ||
    (compat === "seedance" &&
      !!metadata &&
      Object.hasOwn(metadata, "content")) ||
    Object.hasOwn(custom, "images");
  const reference = hasCustomReference
    ? undefined
    : openaiVideoReference({ ...draft, model });
  const customMaterials = !!reference || hasCustomReference;
  if (!customMaterials && draft.materials.some((item) => item.type !== "image"))
    throw new Error("当前接口仅支持图片参考素材，请移除音频或视频素材");
  const images = customMaterials ? [] : draft.materials.map((item) => item.url);
  if (
    !customMaterials &&
    (images.length > options.maxReferences ||
      (draft.mode === "reference-to-video" && images.length < 1))
  )
    throw new Error(`参考图模式需要 1 至 ${options.maxReferences} 张图片`);
  if (compat === "gemini") {
    if (Object.hasOwn(custom, "input_reference"))
      throw new Error("Veo 兼容格式请上传参考图或使用 images 传入图片 Base64");
    const veoImages = custom.images ?? images;
    if (
      !Array.isArray(veoImages) ||
      veoImages.some((url) => typeof url !== "string")
    )
      throw new Error("参考图片必须是图片 URL 或 Base64 数组");
    for (const url of veoImages) imageData(url);
    return {
      path: "videos",
      body: JSON.stringify({
        model,
        prompt: draft.prompt,
        seconds: String(draft.duration),
        ...(veoImages.length ? { images: veoImages } : {}),
        ...custom,
        metadata: {
          ...nativeSize,
          ...(draft.negativePrompt
            ? { negativePrompt: draft.negativePrompt }
            : {}),
          ...builtin,
          ...metadata,
        },
      }),
    };
  }
  if (compat === "xai" || compat === "seedance") {
    const references =
      reference && "image_url" in reference
        ? [
            reference.image_url,
            ...(draft.mode === "first-last-frame"
              ? [draft.openaiLastImageUrl!.trim()]
              : []),
          ]
        : images;
    if (compat === "seedance") {
      return {
        path: "videos",
        body: JSON.stringify({
          model,
          prompt: draft.prompt,
          seconds: String(draft.duration),
          ...custom,
          metadata: {
            ratio: nativeSize.aspectRatio,
            ...(nativeSize.resolution
              ? { resolution: nativeSize.resolution }
              : {}),
            ...builtin,
            content: references.map((url, index) => ({
              type: "image_url",
              image_url: { url },
              role:
                draft.mode === "reference-to-video"
                  ? "reference_image"
                  : index === 0
                  ? "first_frame"
                  : "last_frame",
            })),
            ...metadata,
          },
        }),
      };
    }
    const extensions: Record<string, unknown> = {
      aspect_ratio: nativeSize.aspectRatio,
      ...(nativeSize.resolution ? { resolution: nativeSize.resolution } : {}),
      ...builtin,
      ...(draft.mode === "first-last-frame" && references[1]
        ? { last_frame: { url: references[1] } }
        : {}),
      ...(draft.mode === "reference-to-video"
        ? { reference_images: references.map((url) => ({ url })) }
        : {}),
    };
    for (const key of [
      "aspect_ratio",
      "resolution",
      "generate_audio",
      "last_frame",
      "reference_images",
      "keyframes",
      "reference_audios",
    ]) {
      if (Object.hasOwn(custom, key)) extensions[key] = custom[key];
      else if (metadata && Object.hasOwn(metadata, key))
        extensions[key] = metadata[key];
    }
    return {
      path: "videos",
      body: JSON.stringify({
        model,
        prompt: draft.prompt,
        seconds: String(draft.duration),
        ...(references[0] && draft.mode !== "reference-to-video"
          ? { input_reference: references[0] }
          : {}),
        ...(draft.mode !== "reference-to-video" &&
        references.length > (draft.mode === "first-last-frame" ? 2 : 1)
          ? { images: references }
          : {}),
        ...extensions,
        ...custom,
        // Legacy New API task decoding retains vendor options only in metadata.
        metadata: { ...metadata, ...extensions },
      }),
    };
  }
  let compatibleMetadata: unknown = customMetadata;
  if (
    customMetadata === undefined ||
    (customMetadata &&
      typeof customMetadata === "object" &&
      !Array.isArray(customMetadata))
  ) {
    const values: Record<string, unknown> = {
      ...(draft.resolution !== "auto" ? { resolution: draft.resolution } : {}),
      ...(!["auto", "adaptive"].includes(draft.aspectRatio)
        ? { aspect_ratio: draft.aspectRatio }
        : {}),
      ...metadata,
    };
    for (const source of [metadata, custom]) {
      for (const key of ["aspect_ratio", "aspectRatio", "ratio"]) {
        if (source && Object.hasOwn(source, key)) {
          values.aspect_ratio = source[key];
          break;
        }
      }
    }
    for (const key of ["resolution", "resolution_name"]) {
      if (Object.hasOwn(custom, key)) {
        values.resolution = custom[key];
        break;
      }
    }
    compatibleMetadata = Object.keys(values).length ? values : undefined;
  }
  if (
    draft.mode === "reference-to-video" ||
    draft.mode === "first-last-frame" ||
    images.length > 1
  ) {
    const references =
      custom.images ??
      (reference && "image_url" in reference
        ? [
            reference.image_url,
            ...(draft.openaiLastImageUrl?.trim()
              ? [draft.openaiLastImageUrl.trim()]
              : []),
          ]
        : images);
    if (
      !Array.isArray(references) ||
      references.some((url) => typeof url !== "string")
    )
      throw new Error("参考图片必须是图片 URL 或 Base64 数组");
    return {
      path: "videos",
      body: JSON.stringify({
        model,
        prompt: draft.prompt,
        seconds: String(draft.duration),
        images: references,
        ...(reference ? { input_reference: reference } : {}),
        ...custom,
        metadata: {
          ...(draft.mode === "first-last-frame"
            ? {
                first_frame: references[0] ? { url: references[0] } : undefined,
                last_frame: references[1] ? { url: references[1] } : undefined,
              }
            : { reference_images: references.map((url) => ({ url })) }),
          ...(compatibleMetadata &&
          typeof compatibleMetadata === "object" &&
          !Array.isArray(compatibleMetadata)
            ? compatibleMetadata
            : {}),
        },
      }),
    };
  }
  const referenceObject = hasCustomReference
    ? custom.input_reference
    : reference;
  if (
    referenceObject &&
    typeof referenceObject === "object" &&
    !Array.isArray(referenceObject)
  ) {
    return {
      path: "videos",
      body: JSON.stringify(
        Object.fromEntries(
          Object.entries({
            model,
            prompt: draft.prompt,
            seconds: String(draft.duration),
            input_reference: referenceObject,
            ...custom,
            metadata: compatibleMetadata,
          }).filter(([, value]) => value !== null),
        ),
      ),
    };
  }
  const body = new FormData();
  body.set("model", model);
  body.set("prompt", draft.prompt);
  body.set("seconds", String(draft.duration));
  if (images[0]) {
    const image = imageData(images[0]);
    const bytes = Uint8Array.from(atob(image.bytesBase64Encoded), (c) =>
      c.charCodeAt(0),
    );
    body.set(
      "input_reference",
      new Blob([bytes], { type: image.mimeType }),
      `reference.${image.mimeType.split("/")[1]}`,
    );
  }
  for (const [key, value] of Object.entries(custom)) {
    if (value === null) body.delete(key);
    else
      body.set(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      );
  }
  if (compatibleMetadata !== undefined && compatibleMetadata !== null) {
    body.set(
      "metadata",
      typeof compatibleMetadata === "object"
        ? JSON.stringify(compatibleMetadata)
        : String(compatibleMetadata),
    );
  }
  return { path: "videos", body };
}

export function videoTaskId(data: any, format: VideoApiFormat): string {
  const id =
    format === "gemini"
      ? data.name
      : format === "xai"
      ? data.request_id || data.id || data.task_id
      : data.task_id || data.id;
  if (typeof id !== "string") return "";
  if (format === "gemini")
    return /^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9_-]+$/.test(id)
      ? id
      : "";
  return /^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : "";
}

export function videoTaskPath(task: LocalTask): string {
  const format = task.video?.apiFormat ?? "legacy";
  if (format === "seedance")
    return `api/v3/contents/generations/tasks/${encodeURIComponent(
      task.upstreamId,
    )}`;
  if (format === "gemini") {
    if (
      !/^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9_-]+$/.test(
        task.upstreamId,
      )
    )
      throw new Error("Gemini 任务标识无效");
    return `v1beta/${task.upstreamId}`;
  }
  return `${format === "plugin" ? "tasks" : "videos"}/${encodeURIComponent(
    task.upstreamId,
  )}`;
}

export function isVideoMediaPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    /^(?:videos\/[A-Za-z0-9_-]{1,200}\/content|tasks\/[A-Za-z0-9_-]{1,200}\/artifacts\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}\/content|v1beta\/files\/[A-Za-z0-9_-]{1,200}:download\?alt=media)$/.test(
      path,
    )
  );
}

/** Normalize only the selected protocol; a URL on a running job is not a result. */
export async function readVideoTask(
  data: any,
  task: LocalTask,
  fetchTask: (path: string) => Promise<Response>,
) {
  const format = task.video?.apiFormat ?? "legacy";
  if (format === "legacy") return data;
  const status = String(data.status || "").toLowerCase();
  const error = data.error || data.fail_reason;
  if (
    error ||
    ["failed", "failure", "error", "cancelled", "canceled"].includes(status)
  )
    return {
      ...data,
      status: "failed",
      error:
        typeof error === "string" ? error : error?.message || "视频生成失败",
    };
  if (format === "gemini") {
    if (!data.done) return { ...data, status: "in_progress" };
    const video =
      data.response?.generateVideoResponse?.generatedSamples?.[0]?.video ||
      data.response?.generatedVideos?.[0]?.video;
    const uri = video?.uri;
    let mediaPath;
    if (typeof uri === "string") {
      const file = /\/files\/([A-Za-z0-9_-]+)(?::download)?(?:\?|$)/.exec(uri);
      if (file) mediaPath = `v1beta/files/${file[1]}:download?alt=media`;
    }
    return { ...data, status: "completed", mediaPath };
  }
  if (format === "seedance") {
    return {
      ...data,
      status: status === "succeeded" ? "completed" : status,
      ...(status === "succeeded" ? { video_url: data.content?.video_url } : {}),
    };
  }
  if (
    !["completed", "succeeded", "success", "done"].includes(status) &&
    !(format === "xai" && data.video?.url && !status)
  )
    return { ...data, status: "in_progress" };
  if (format === "plugin") {
    const response = await fetchTask(
      `tasks/${encodeURIComponent(task.upstreamId)}/artifacts`,
    );
    if (!response.ok)
      throw Object.assign(new Error(`视频产物查询失败 (${response.status})`), {
        status: response.status,
      });
    const result = await response.json();
    const artifact = result.artifacts?.find(
      (item: any) =>
        item.type === "video" || item.mime_type?.startsWith("video/"),
    );
    const key = artifact?.key;
    return {
      ...data,
      status: "completed",
      ...(typeof key === "string" &&
      /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}$/.test(key)
        ? {
            mediaPath: `tasks/${encodeURIComponent(
              task.upstreamId,
            )}/artifacts/${key}/content`,
          }
        : {}),
    };
  }
  return {
    ...data,
    status: "completed",
    ...(format === "openai"
      ? { mediaPath: `videos/${encodeURIComponent(task.upstreamId)}/content` }
      : {}),
    ...(format === "xai" && data.video?.url
      ? { video_url: data.video.url }
      : {}),
  };
}
