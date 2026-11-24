import type { VideoDraft, VideoGenMode } from "./types.ts";
import { selectedVideoSize } from "./video-size.ts";
import { videoModelSettingSchema, type VideoModelSetting } from "./model-types.ts";

type VideoCapabilities = VideoModelSetting & { resolutions: string[]; durations: number[] };
// Model defaults are resolved by the server and returned with the catalogue.
export function videoCapabilities(
  _model: string,
  mode: VideoGenMode = "text-to-video",
  setting?: VideoModelSetting,
): VideoCapabilities | undefined {
  if (!setting) return;
  const limits = { ...setting, ...setting.modes?.[mode] };
  return {
    ...limits,
    resolutions: limits.resolutions ?? [],
    durations: limits.durations ? [...limits.durations].sort((a, b) => a - b) : [],
    ...(limits.autoResolution && limits.autoResolution !== "auto" && limits.resolutions?.length
      && !limits.resolutions.includes(limits.autoResolution) ? { autoResolution: limits.resolutions[0] } : {}),
    ...(limits.autoDuration !== undefined && limits.durations?.length
      && !limits.durations.includes(limits.autoDuration) ? { autoDuration: limits.durations[0] } : {}),
  };
}

export function videoDurationLabel(durations: number[]) {
  return durations.length > 3 &&
    durations.every((n, i) => !i || n === durations[i - 1] + 1)
    ? `${durations[0]}–${durations[durations.length - 1]} 秒`
    : `${durations.join(" / ")} 秒`;
}

/** Correct editable drafts, never historical result/request snapshots. */
export function normalizeVideoParameters<T extends Pick<VideoDraft, "model" | "mode" | "resolution" | "duration" | "size" | "aspectRatio">>(draft: T, setting?: VideoModelSetting): T {
  const limits = videoCapabilities(draft.model, draft.mode, setting);
  if (!limits) return draft;
  const resolution =
    draft.resolution === "auto" || !limits.resolutions.length || limits.resolutions.includes(draft.resolution)
      ? draft.resolution
      : setting?.autoResolution && limits.resolutions.includes(setting.autoResolution)
      ? setting.autoResolution
      : limits.resolutions.includes("720p")
      ? "720p"
      : limits.resolutions[0]!;
  const aspectRatio = ["auto", "adaptive"].includes(draft.aspectRatio)
    || !limits.aspectRatios?.length || limits.aspectRatios.includes(draft.aspectRatio)
    ? draft.aspectRatio
    : limits.autoAspectRatio && limits.autoAspectRatio !== "auto" && limits.aspectRatios.includes(limits.autoAspectRatio)
    ? limits.autoAspectRatio : limits.aspectRatios[0]!;
  const requested = Number.isFinite(draft.duration) ? draft.duration : limits.autoDuration ?? 8;
  const duration = limits.durations.includes(requested) ? requested
    : limits.autoDuration !== undefined && limits.durations.includes(limits.autoDuration) ? limits.autoDuration
    : limits.durations.reduce((best, value) =>
    Math.abs(value - requested) < Math.abs(best - requested) ? value : best,
    limits.durations[0] ?? requested,
  );
  return {
    ...draft,
    resolution,
    duration,
    aspectRatio,
    ...(resolution !== draft.resolution || aspectRatio !== draft.aspectRatio || (limits.sizes || limits.sendSize === false) && draft.size !== "auto"
      ? { size: selectedVideoSize({ resolution, aspectRatio }, limits) }
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
  if (metadata != null && (typeof metadata !== "object" || Array.isArray(metadata)))
    throw new Error("视频 metadata 必须是 JSON 对象");
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
    reference && mode !== "first-last-frame" ? "reference-to-video" : mode,
    setting,
  );
  const sizes = limits?.sizes ? Object.values(limits.sizes).flatMap(ratios => Object.values(ratios)) : undefined;
  const effectiveResolution = sources.flatMap(source => [source.resolution, source.resolution_name])
    .find(value => value != null && value !== "auto");
  const effectiveRatio = sources.flatMap(source => [source.aspect_ratio, source.aspectRatio, source.ratio])
    .find(value => value != null && value !== "auto");
  for (const source of sources) {
    if (limits?.sendSize === false && source.size != null) throw new Error("当前模型不支持参数 size，请移除后重试");
    for (const key of limits?.unsupportedParameters ?? []) {
      // Source duration is retained only for the gateway's independently verified reservation.
      if (limits?.operation === "upscale" && source === sent && key === "seconds") continue;
      if (Object.hasOwn(source, key)) throw new Error(`当前模型不支持参数 ${key}，请移除后重试`);
    }
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
    for (const key of ["seconds", "duration_seconds", "duration", "durationSeconds"]) {
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
    for (const key of ["aspect_ratio", "aspectRatio", "ratio"]) {
      const value = source[key];
      if (value == null || value === "auto") continue;
      if (typeof value !== "string" || !/^[1-9]\d{0,2}:[1-9]\d{0,2}$/.test(value))
        throw new Error("视频画面比例格式无效，请使用 16:9 等有效比例");
      if (limits?.aspectRatios?.length && !limits.aspectRatios.includes(value))
        throw new Error(`当前模型仅支持 ${limits.aspectRatios.join(" / ")}，请调整画面比例`);
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
      if (sizes && !sizes.includes(String(source.size)))
        throw new Error("视频尺寸不在后台配置的可选尺寸中，请重新选择分辨率和画面比例");
      if (limits?.sizes && effectiveResolution != null) {
        const ratios = limits.sizes[String(effectiveResolution)];
        if (!ratios || (effectiveRatio != null
          ? ratios[String(effectiveRatio)] !== source.size
          : !Object.values(ratios).includes(String(source.size))))
          throw new Error("视频尺寸与所选分辨率或画面比例不一致，请重新选择");
      } else if (limits?.sizes && effectiveRatio != null
        && !Object.values(limits.sizes).some(ratios => ratios[String(effectiveRatio)] === source.size)) {
        throw new Error("视频尺寸与所选画面比例不一致，请重新选择");
      }
    }
  }
}
