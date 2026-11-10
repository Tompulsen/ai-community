import type { DalleQuality } from "../typing";
import type { ModelConfig } from "../store/config";

const IMAGE_GENERATION_CONFIG_KEYS = [
  "providerName",
  "size",
  "resolution",
  "quality",
  "style",
  "imageOutputFormat",
  "imageBackground",
  "imageOutputCompression",
  "imageResponseFormat",
  "imageStream",
  "imageRequestMode",
  "imagePartialImages",
] as const;

export type ImageGenerationConfig = Partial<
  Pick<ModelConfig, (typeof IMAGE_GENERATION_CONFIG_KEYS)[number]>
>;

export function imageGenerationConfig(
  config: Partial<ModelConfig>,
): ImageGenerationConfig {
  return Object.fromEntries(
    IMAGE_GENERATION_CONFIG_KEYS.filter((key) => config[key] !== undefined).map(
      (key) => [key, config[key]],
    ),
  );
}

export const IMAGE_RATIOS = [
  "auto",
  "1:1",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
] as const;
export const IMAGE_RESOLUTIONS = ["auto", "1k", "2k", "4k"] as const;
type ImageRatio = (typeof IMAGE_RATIOS)[number];
const IMAGE_SIZE_PRESETS: Record<
  Exclude<(typeof IMAGE_RESOLUTIONS)[number], "auto">,
  Record<Exclude<ImageRatio, "auto">, string>
> = {
  "1k": {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "16:9": "1280x720",
    "9:16": "720x1280",
    "4:3": "1024x768",
    "3:4": "768x1024",
    "21:9": "1280x544",
  },
  "2k": {
    "1:1": "2048x2048",
    "3:2": "2160x1440",
    "2:3": "1440x2160",
    "16:9": "2560x1440",
    "9:16": "1440x2560",
    "4:3": "2048x1536",
    "3:4": "1536x2048",
    "21:9": "2560x1088",
  },
  "4k": {
    "1:1": "2880x2880",
    "3:2": "3456x2304",
    "2:3": "2304x3456",
    "16:9": "3840x2160",
    "9:16": "2160x3840",
    "4:3": "3200x2400",
    "3:4": "2400x3200",
    "21:9": "3840x1600",
  },
};
export const IMAGE_QUALITIES = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageResponseFormat = "url" | "b64_json";
export type ImageBackground = "auto" | "opaque" | "transparent";
export const IMAGE_PROMPT_LIMIT = 32000;

export function supportsImageOutputOptions(model: string) {
  return /(?:gpt|chatgpt)-image(?:-|$)/i.test(model);
}

export interface ImageOutputConfig {
  imageOutputFormat?: ImageOutputFormat;
  imageBackground?: ImageBackground;
  imageOutputCompression?: number;
  imageStream?: boolean;
  imagePartialImages?: number;
}

export function imageOutputParams(config: ImageOutputConfig) {
  const background = config.imageBackground ?? "auto";
  const output_format =
    background === "transparent" && config.imageOutputFormat === "jpeg"
      ? "png"
      : config.imageOutputFormat ?? "png";
  return {
    output_format,
    background,
    stream: config.imageStream ?? false,
    ...(output_format !== "png" && {
      output_compression: Math.max(
        0,
        Math.min(100, Math.round(config.imageOutputCompression ?? 100)),
      ),
    }),
    ...(config.imageStream && {
      partial_images: Math.max(
        0,
        Math.min(3, Math.round(config.imagePartialImages ?? 1)),
      ),
    }),
  };
}

export function imagePromptLength(prompt: string) {
  return Array.from(prompt).length;
}

export function validateImagePrompt(prompt: string) {
  if (imagePromptLength(prompt) > IMAGE_PROMPT_LIMIT) {
    throw new Error(
      "生图提示词不能超过 32,000 个字符（包含文件内容和提示词模板）",
    );
  }
}

export function imageRatio(size?: string): ImageRatio {
  if (IMAGE_RATIOS.includes(size as (typeof IMAGE_RATIOS)[number])) {
    return size as ImageRatio;
  }
  const dimensions = size?.match(/^(\d+)x(\d+)$/);
  if (!dimensions) return "auto";
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  if (!width || !height) return "auto";
  // Migrate legacy pixel presets to their intended aspect ratio.
  if (size === "1792x1024") return "16:9";
  if (size === "1024x1792") return "9:16";
  return IMAGE_RATIOS.slice(1).reduce((closest, ratio) => {
    const distance = (value: string) => {
      const [w, h] = value.split(":").map(Number);
      return Math.abs(Math.log(width / height / (w / h)));
    };
    return distance(ratio) < distance(closest) ? ratio : closest;
  });
}

export function imageQuality(quality?: DalleQuality) {
  if (quality === "hd") return "high";
  if (quality === "standard") return "medium";
  return IMAGE_QUALITIES.includes(quality as (typeof IMAGE_QUALITIES)[number])
    ? (quality as (typeof IMAGE_QUALITIES)[number])
    : "auto";
}

export function imageResolution(value?: string): ImageResolution {
  const normalized = value?.toLowerCase();
  return IMAGE_RESOLUTIONS.includes(normalized as ImageResolution)
    ? (normalized as ImageResolution)
    : "auto";
}

export function usesFixedImageSizes(model: string) {
  return /^(?:dall-e-[23](?:-|$)|gpt-image-1(?:[.-]|$)|chatgpt-image(?:-|$))/i.test(
    model,
  );
}

export function imageRequestSize(
  size?: string,
  resolution?: string,
  model = "",
) {
  const ratio = imageRatio(size);
  const tier = imageResolution(resolution);
  const [width, height] = (ratio === "auto" ? "1:1" : ratio)
    .split(":")
    .map(Number);

  // Older models only accept their own fixed pixel presets.
  if (/^dall-e-2(?:-|$)/i.test(model)) {
    return size === "256x256" || size === "512x512" ? size : "1024x1024";
  }
  if (usesFixedImageSizes(model)) {
    if (ratio === "auto") {
      return /^dall-e-3(?:-|$)/i.test(model) ? "1024x1024" : "auto";
    }
    if (width === height) return "1024x1024";
    const longEdge = /^dall-e-3(?:-|$)/i.test(model) ? 1792 : 1536;
    return width > height ? `${longEdge}x1024` : `1024x${longEdge}`;
  }
  if (ratio === "auto" && tier === "auto") return "auto";
  return IMAGE_SIZE_PRESETS[tier === "auto" ? "1k" : tier][
    ratio === "auto" ? "1:1" : ratio
  ];
}
