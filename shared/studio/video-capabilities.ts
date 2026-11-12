import type { VideoDraft, VideoGenMode } from "./types.ts";
import { VIDEO_MODEL_PROFILES } from "./video-models.ts";
import { selectedVideoSize } from "./video-size.ts";

type VideoCapabilities = { resolutions: string[]; durations: number[] };
// Verified 2026-11-11; sources and onboarding: docs/video-capabilities.md.
export function videoCapabilities(
  model: string,
  mode: VideoGenMode = "text-to-video",
): VideoCapabilities | undefined {
  const name = model.split("@")[0].toLowerCase();
  const profile = VIDEO_MODEL_PROFILES.find((item) =>
    item.models.includes(name),
  );
  if (!profile) return;
  const limits = { ...profile, ...profile.modes?.[mode] };
  return {
    resolutions: limits.resolutions,
    durations: Array.isArray(limits.durations)
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
) {
  const sent =
    typeof body === "string"
      ? JSON.parse(body)
      : Object.fromEntries(body.entries());
  if (!videoCapabilities(String(sent.model ?? ""), mode))
    throw new Error(
      "当前视频模型尚未配置分辨率和时长，请联系管理员补充模型能力后使用",
    );
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
  );
  if (!limits) return;
  for (const source of sources) {
    for (const key of ["resolution", "resolution_name"]) {
      const value = source[key];
      if (
        value != null &&
        value !== "auto" &&
        !limits.resolutions.includes(String(value).toLowerCase())
      )
        throw new Error(
          `当前模型和生成方式仅支持 ${limits.resolutions.join(
            " / ",
          )}，请调整分辨率`,
        );
    }
    for (const key of ["seconds", "duration", "durationSeconds"]) {
      if (
        source[key] != null &&
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
      const short = match ? Math.min(Number(match[1]), Number(match[2])) : 0;
      if (!limits.resolutions.includes(short === 2160 ? "4k" : `${short}p`))
        throw new Error(
          `自定义视频尺寸超出当前模型支持的分辨率，请使用 ${limits.resolutions.join(
            " / ",
          )}`,
        );
    }
  }
}
