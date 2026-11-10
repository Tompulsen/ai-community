import type { LLMModel } from "../client/api";

export const LOCAL_PREVIEW_PROVIDER = "本地预览";
export const LOCAL_PREVIEW_LONG_MODEL = "local-preview-long-output";
export const LOCAL_PREVIEW_COMPONENTS_MODEL = "local-preview-components";
export const LOCAL_PREVIEW_MEDIA_MODEL = "local-preview-media";
export const LOCAL_PREVIEW_METRICS_MODEL = "local-preview-metrics";
export const LOCAL_PREVIEW_NO_USAGE_MODEL = "local-preview-estimated-metrics";
export const LOCAL_PREVIEW_COMPRESSION_MODEL = "local-preview-compression";
export const LOCAL_PREVIEW_MESSAGE =
  "预览模型仅用于界面验收，请选择真实模型后发送。";
export const LOCAL_PREVIEW_RESPONSE =
  "这是一段本地模拟回复。\n\n海边的清晨，天空刚刚泛亮。潮声沿着沙滩缓缓铺开，空气里带着清新的海盐气息。\n\n阳光落在水面上，远处的船只慢慢驶过，一切都显得宁静而明亮。";

type PreviewModel = LLMModel & { displayName: string; isDefault: boolean };

const PREVIEW_MODELS: PreviewModel[] = [
  "gpt-6-astra",
  "claude-sonnet-4-6",
  "gemini-3.1-pro-preview",
  "deepseek-v4.1-flash",
  "qwen3.5-plus",
  "gpt-6-astra-extended-context-long-model-name-preview",
  "gpt-image-2.5",
  "gemini-3.1-flash-image-preview",
  "sora-2",
  "kling-v2.1",
  LOCAL_PREVIEW_LONG_MODEL,
  LOCAL_PREVIEW_COMPONENTS_MODEL,
  LOCAL_PREVIEW_MEDIA_MODEL,
  LOCAL_PREVIEW_METRICS_MODEL,
  LOCAL_PREVIEW_NO_USAGE_MODEL,
  LOCAL_PREVIEW_COMPRESSION_MODEL,
].map((name, sorted) => ({
  name,
  displayName:
    name === LOCAL_PREVIEW_LONG_MODEL
      ? "长文本 · 本地预览"
      : name === LOCAL_PREVIEW_COMPONENTS_MODEL
      ? "组件展示 · 本地预览"
      : name === LOCAL_PREVIEW_MEDIA_MODEL
      ? "图片与视频 · 本地预览"
      : name === LOCAL_PREVIEW_METRICS_MODEL
      ? "统计变化 · 本地预览"
      : name === LOCAL_PREVIEW_NO_USAGE_MODEL
      ? "估算统计 · 本地预览"
      : name === LOCAL_PREVIEW_COMPRESSION_MODEL
      ? "自动压缩 · 本地预览"
      : `${name} · 预览`,
  available: true,
  isDefault: false,
  sorted,
  provider: {
    id: "octopus-preview",
    providerName: LOCAL_PREVIEW_PROVIDER,
    providerType: "preview",
    sorted: 999,
  },
}));

export function isLocalPreviewModel(providerName?: string) {
  return providerName === LOCAL_PREVIEW_PROVIDER;
}

export function isLocalPreviewEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
      window.location.hostname,
    )
  );
}

export function getLocalPreviewModels(): PreviewModel[] {
  return isLocalPreviewEnabled() ? PREVIEW_MODELS : [];
}
