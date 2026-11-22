import type { VideoDraft, VideoGenMode } from "./types.ts";
import { VIDEO_MODEL_PROFILES } from "./video-models.ts";
import { selectedVideoSize } from "./video-size.ts";
import { videoModelSettingSchema, type VideoModelSetting } from "./model-types.ts";

type VideoCapabilities = { resolutions: string[]; durations: number[] };
// Verified 2026-11-11; sources and onboarding: docs/video-capabilities.md.
export function videoCapabilities(
  model: string,
  mode: VideoGenMode = "text-to-video",
  setting?: VideoModelSetting,
): VideoCapabilities | undefined {
  const name = model.split("@")[0].toLowerCase();
  const profile = VIDEO_MODEL_PROFILES.find((item) =>
    item.models.includes(name),
  );
  if (!profile && !setting?.resolutions) return;
  const limits = profile ? { ...profile, ...profile.modes?.[mode] } : undefined;
  const automatic = setting?.autoResolution && setting.autoResolution !== "auto" ? [setting.autoResolution] : [];
  return {
    resolutions: setting?.resolutions ?? [...new Set([...(limits?.resolutions ?? []), ...automatic])],
    durations: !limits ? [] : Array.isArray(limits.durations)
      ? limits.durations
      : Array.from(
          { length: limits.durations.max - limits.durations.min + 1 },
          (_, i) => (limits.durations as { min: number }).min + i,
        ),
  };
}

export function videoDurationLabel(durations: number[]) {
  return durations.length > 3 &&
    durations.every((n, i) => !i || n === durations[i - 1] + 1)
    ? `${durations[0]}–${durations[durations.length - 1]} 秒`
    : `${durations.join(" / ")} 秒`;
}

/** Correct editable drafts, never historical result/request snapshots. */
export function normalizeVideoParameters(draft: VideoDraft): VideoDraft {
  const limits = videoCapabilities(draft.model, draft.mode);
  if (!limits) return draft;
  const resolution =
    draft.resolution === "auto" || limits.resolutions.includes(draft.resolution)
      ? draft.resolution
      : limits.resolutions.includes("720p")
      ? "720p"
      : limits.resolutions[0];
  const requested = Number.isFinite(draft.duration) ? draft.duration : 8;
  const duration = limits.durations.reduce((best, value) =>
    Math.abs(value - requested) < Math.abs(best - requested) ? value : best,
  );
  return {
    ...draft,
    resolution,
    duration,
    ...(resolution !== draft.resolution
      ? { size: selectedVideoSize({ ...draft, resolution }) }
      : {}),
  };
}

/** Validate the final outgoing payload, including custom overrides, before billing. */
export function validateVideoRequestParameters(
  body: string | FormData,
  mode: VideoGenMode,
  setting?: VideoModelSetting,
) {
  const sent =
    typeof body === "string"
      ? JSON.parse(body)
      : Object.fromEntries(body.entries());
  const metadata =
    typeof sent.metadata === "string"
      ? JSON.parse(sent.metadata)
      : sent.metadata;
  const sources = [sent, metadata].filter(
    (value) => value && typeof value === "object",
  );
  const reference = sources.some(
    (value) =>
      value.reference_images?.length ||
      value.referenceImages?.length ||
      value.reference_audios?.length ||
      value.last_frame ||
      value.keyframes?.length ||
      (Array.isArray(value.content) &&
        value.content.some(
          (part: { role?: string }) => part.role === "reference_image",
        )),
  );
  const limits = videoCapabilities(
    String(sent.model ?? ""),
    reference ? "reference-to-video" : mode,
    setting,
  );
  for (const source of sources) {
    for (const key of ["resolution", "resolution_name"]) {
      const value = source[key];
      if (
        value != null &&
        value !== "auto" &&
        !videoModelSettingSchema.shape.autoResolution.safeParse(value).success
      )
        throw new Error("视频分辨率格式无效，请使用 720p、1080p 或 4k 等有效档位");
      if (
        value != null &&
        value !== "auto" &&
        limits?.resolutions.length &&
        !limits.resolutions.includes(String(value).toLowerCase())
      )
        throw new Error(
          `当前模型和生成方式仅支持 ${limits.resolutions.join(
            " / ",
          )}，请调整分辨率`,
        );
    }
    for (const key of ["seconds", "duration", "durationSeconds"]) {
      const value = source[key], duration = Number(value);
      if (value != null && (typeof value !== "string" && typeof value !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 3600))
        throw new Error("视频时长须为 1 至 3600 秒的整数");
      if (
        source[key] != null &&
        limits?.durations.length &&
        !limits.durations.includes(Number(source[key]))
      )
        throw new Error(
          `当前模型和生成方式仅支持 ${videoDurationLabel(
            limits.durations,
          )}，请调整视频时长`,
        );
    }
    if (source.size != null && source.size !== "auto") {
      const match = /^(\d+)x(\d+)$/.exec(String(source.size));
      const dimensions = match ? [Number(match[1]), Number(match[2])] : [];
      if (!dimensions.length || dimensions.some(value => !Number.isSafeInteger(value) || value < 1 || value > 65535))
        throw new Error("视频宽高须为 1 至 65535 的整数");
      const short = Math.min(...dimensions);
      const tiers = [`${short}p`, ...(short === 2160 ? ["4k"] : [])];
      if (limits?.resolutions.length && !tiers.some(tier => limits.resolutions.includes(tier)))
        throw new Error(
          `自定义视频尺寸超出当前模型支持的分辨率，请使用 ${limits.resolutions.join(
            " / ",
          )}`,
        );
    }
  }
}
