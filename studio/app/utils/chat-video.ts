import {
  DEFAULT_DRAFT,
  snapshotVideoDraft,
  type MaterialItem,
  type VideoDraft,
} from "../store/video";
import type { ParsedFile } from "./file-upload";
import { buildVideoRequest, videoUploadMode } from "./video-api";
import {
  normalizeVideoParameters,
  validateVideoRequestParameters,
} from "./video-capabilities";
import { selectedVideoSize } from "./video-size";

export function chatVideoConfig(
  request: Partial<VideoDraft>,
): Partial<VideoDraft> {
  const keys = [
    "mode",
    "size",
    "aspectRatio",
    "resolution",
    "duration",
    "negativePrompt",
    "count",
    "seed",
    "promptAdherence",
    "cameraMotion",
    "referenceMode",
    "protocolOptions",
  ] as const;
  return JSON.parse(
    JSON.stringify(
      Object.fromEntries(
        keys
          .filter((key) => request[key] !== undefined)
          .map((key) => [key, request[key]]),
      ),
    ),
  );
}

/** Never inherit another composer's materials, identity or private overrides. */
export function chatVideoDraft(
  prompt: string,
  model: string,
  provider: string,
  references: string[],
  sourceWorkId?: string,
  config?: Partial<VideoDraft>,
  files: ParsedFile[] = [],
): VideoDraft {
  const parameters = chatVideoConfig(config ?? {});
  const materials: MaterialItem[] = references.map((url, i) => ({
    id: `reference-${i}`,
    type: "image",
    url,
    name: `参考图 ${i + 1}`,
  }));
  files.forEach((file, index) => {
    const type = /^(image|video|audio)\//.exec(file.type)?.[1] as
      | MaterialItem["type"]
      | undefined;
    if (!type)
      throw new Error(
        `视频生成暂不支持文件“${file.name}”，请移除此附件后重试。`,
      );
    materials.push({
      id: `file-reference-${index}`,
      type,
      url: file.content,
      name: file.name,
    });
  });
  if (parameters.mode === "text-to-video" && materials.length) {
    throw new Error("文生视频模式不使用参考素材，请移除素材或选择自动模式。");
  }
  if (parameters.mode === "image-to-video" && materials.length !== 1) {
    throw new Error("图生视频模式需要一张图片，请调整参考素材或选择自动模式。");
  }
  if (
    parameters.mode === "first-last-frame" &&
    (materials.length !== 2 ||
      materials.some((material) => material.type !== "image"))
  ) {
    throw new Error("首尾帧模式需要恰好两张图片，请调整参考素材后重试。");
  }
  const draft = normalizeVideoParameters({
    ...JSON.parse(JSON.stringify(DEFAULT_DRAFT)),
    size: "auto",
    aspectRatio: "auto",
    resolution: "auto",
    ...parameters,
    model: provider ? `${model}@${provider}` : model,
    prompt,
    sourceWorkId,
    mode:
      parameters.mode ??
      (materials.length
        ? videoUploadMode("text-to-video", materials.length)
        : "text-to-video"),
    materials,
  });
  if (parameters.size === undefined) draft.size = selectedVideoSize(draft);
  validateVideoRequestParameters(
    buildVideoRequest(draft, model).body,
    draft.mode,
  );
  return snapshotVideoDraft(draft);
}
