import type { VideoDraft } from "../store/video";

export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p", "auto"];
export const VIDEO_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "16:9",
  "9:16",
  "21:9",
  "auto",
];
type SizeConfig = Pick<VideoDraft, "size" | "resolution" | "aspectRatio">;

export function evenVideoDimension(value: number) {
  if (
    !Number.isFinite(value) ||
    value < 1 ||
    !Number.isSafeInteger(Math.round(value))
  )
    throw new Error("视频宽高必须是有效的正整数");
  const rounded = Math.max(2, Math.round(value / 2) * 2);
  if (!Number.isSafeInteger(rounded)) throw new Error("视频宽高超出有效范围");
  return rounded;
}

export function calculateVideoSize(resolution: string, ratio: string) {
  const short = Number(/^(\d+)p$/.exec(resolution)?.[1] ?? 720);
  const [w, h] = ratio.split(":").map(Number);
  if (!(w > 0 && h > 0)) throw new Error("画面比例无效");
  const width = w >= h ? (short * w) / h : short;
  const height = w >= h ? short : (short * h) / w;
  return `${evenVideoDimension(width)}x${evenVideoDimension(height)}`;
}

export function isVideoSizeAuto(config: SizeConfig) {
  return (
    config.size === "auto" ||
    config.resolution === "auto" ||
    config.aspectRatio === "auto" ||
    config.aspectRatio === "adaptive"
  );
}

export function selectedVideoSize(
  config: Pick<SizeConfig, "resolution" | "aspectRatio">,
) {
  return config.resolution === "auto" ||
    ["auto", "adaptive"].includes(config.aspectRatio)
    ? "auto"
    : calculateVideoSize(config.resolution, config.aspectRatio);
}

export function videoSizePreview(config: SizeConfig) {
  return isVideoSizeAuto(config)
    ? calculateVideoSize(config.resolution, "16:9")
    : config.size;
}

export function videoSizeParameters(
  config: SizeConfig,
  format: "openai",
): { size: string; resolution_name: string };
export function videoSizeParameters(
  config: SizeConfig,
  format: "gemini",
): { aspectRatio: string; resolution?: string };
export function videoSizeParameters(
  config: SizeConfig,
  format: "script",
): { size: string; ratio: string; resolution: string };
export function videoSizeParameters(
  config: SizeConfig,
  format: "openai" | "gemini" | "script",
) {
  if (format === "gemini")
    return {
      aspectRatio:
        config.resolution === "auto" ||
        ["auto", "adaptive"].includes(config.aspectRatio)
          ? "16:9"
          : config.aspectRatio,
      ...(config.resolution === "auto"
        ? {}
        : { resolution: config.resolution }),
    };
  const automatic = isVideoSizeAuto(config);
  let size = "auto";
  if (!automatic) {
    const match = /^(\d+)x(\d+)$/.exec(config.size);
    if (!match) throw new Error("请填写有效的视频宽度和高度");
    size = `${evenVideoDimension(Number(match[1]))}x${evenVideoDimension(
      Number(match[2]),
    )}`;
  }
  if (format === "script")
    return {
      size,
      ratio: config.aspectRatio === "adaptive" ? "auto" : config.aspectRatio,
      resolution: config.resolution,
    };
  // The automatic request keeps the legacy fallback, independently of the preview.
  return {
    size: automatic ? "1280x720" : size,
    resolution_name: config.resolution,
  };
}
