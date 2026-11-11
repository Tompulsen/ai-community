import { videoOptions, buildVideoRequest } from "../app/utils/video-api";
import {
  normalizeVideoParameters,
  validateVideoRequestParameters,
  videoCapabilities,
} from "../app/utils/video-capabilities";
import type { VideoDraft } from "../app/store/video";
import { VIDEO_MODEL_PROFILES } from "../app/config/video-models";
import { calculateVideoSize } from "../app/utils/video-size";

const draft = (patch: Partial<VideoDraft> = {}) =>
  ({
    apiFormat: "openai",
    model: "grok-imagine-video",
    prompt: "Ocean waves",
    mode: "text-to-video",
    resolution: "1080p",
    aspectRatio: "16:9",
    size: "1920x1080",
    duration: 30,
    materials: [],
    ...patch,
  }) as VideoDraft;

test("video group aliases follow the configured upstream rather than shared billing tiers", () => {
  expect(videoCapabilities("sd2.0-mini-720p")).toEqual({ resolutions: ["720p"], durations: Array.from({length: 12}, (_, i) => i + 4) });
  expect(normalizeVideoParameters(draft({ model: "sd2.0-mini-720p" }))).toMatchObject({ resolution: "720p", duration: 15 });
  expect(videoCapabilities("wan3.0", "image-to-video")).toEqual({ resolutions: ["720p", "1080p"], durations: Array.from({length: 26}, (_, i) => i + 5) });
  for (const body of [{ model: "sd2.0-mini-720p", resolution: "1080p" }, { model: "wan3.0", resolution: "480p" }, { model: "wan3.0", seconds: "31" }])
    expect(() => validateVideoRequestParameters(JSON.stringify(body), "text-to-video")).toThrow();
});

test("Grok options enforce version-specific resolution and duration limits", () => {
  expect(videoOptions("openai", "grok-imagine-video").resolutions).toEqual([
    "480p",
    "720p",
    "auto",
  ]);
  expect(
    videoOptions("openai", "grok-imagine-video-1.5").durations.at(-1),
  ).toBe(15);
  expect(
    videoOptions("openai", "grok-imagine-video-1.5", "reference-to-video")
      .resolutions,
  ).not.toContain("1080p");
});

test("model switches and restored drafts correct stale values and dimensions", () => {
  const original = draft();
  expect(normalizeVideoParameters(original)).toMatchObject({
    resolution: "720p",
    duration: 15,
    size: "1280x720",
  });
  expect(original.resolution).toBe("1080p");
  expect(
    normalizeVideoParameters(
      draft({ model: "grok-imagine-video-1.5@channel", duration: 6 }),
    ),
  ).toMatchObject({ resolution: "1080p", duration: 6 });
  expect(
    normalizeVideoParameters(
      draft({ model: "grok-imagine-video-1.5", mode: "reference-to-video" }),
    ),
  ).toMatchObject({ resolution: "720p", duration: 15 });
});

test("discrete durations and fixed-duration aliases never select an unsupported second", () => {
  expect(
    normalizeVideoParameters(draft({ model: "sora-2", duration: 7 })).duration,
  ).toBe(8);
  expect(videoCapabilities("veo-3.1", "reference-to-video")?.durations).toEqual(
    [8],
  );
  expect(
    normalizeVideoParameters(draft({ duration: Number.NaN })).duration,
  ).toBe(8);
  expect(normalizeVideoParameters(draft({ duration: 8.7 })).duration).toBe(9);
});

test.each([
  { model: "grok-imagine-video", seconds: "16" },
  { model: "grok-imagine-video", seconds: "8.5" },
  { model: "grok-imagine-video", metadata: { duration: 45 } },
  { model: "grok-imagine-video", metadata: { resolution: "1080p" } },
  { model: "grok-imagine-video", resolution_name: "1080p" },
  { model: "grok-imagine-video", size: "1920x1080" },
  {
    model: "grok-imagine-video-1.5",
    resolution: "1080p",
    metadata: { reference_images: [{ url: "test" }] },
  },
  { model: "sora-2", seconds: "7" },
])("rejects unsupported final custom overrides: %j", (body) => {
  expect(() =>
    validateVideoRequestParameters(JSON.stringify(body), "text-to-video"),
  ).toThrow();
});

test("valid JSON and multipart payloads use the actual overridden model", () => {
  expect(() =>
    validateVideoRequestParameters(
      JSON.stringify({
        model: "grok-imagine-video-1.5",
        seconds: "15",
        resolution: "1080p",
      }),
      "text-to-video",
    ),
  ).not.toThrow();
  const form = new FormData();
  form.set("model", "sora-2");
  form.set("seconds", "8");
  form.set("metadata", JSON.stringify({ resolution: "1080p" }));
  expect(() => validateVideoRequestParameters(form, "text-to-video")).toThrow(
    "分辨率",
  );
});

test("unknown model parameters and historical serializers remain intact", () => {
  const unknown = draft({ model: "provider-custom" });
  expect(videoCapabilities(unknown.model)).toBeUndefined();
  expect(normalizeVideoParameters(unknown)).toBe(unknown);
  expect(() =>
    validateVideoRequestParameters(
      JSON.stringify({
        model: "provider-special",
        metadata: "arbitrary-provider-value",
      }),
      "text-to-video",
    ),
  ).toThrow("尚未配置");
  const historical = draft({
    customParams: { openai: '{"duration":45,"resolution":"4k"}' },
  });
  const request = buildVideoRequest(historical, historical.model);
  expect(JSON.parse(request.body as string)).toMatchObject({
    duration: 45,
    resolution: "4k",
  });
  expect(() =>
    validateVideoRequestParameters(request.body, historical.mode),
  ).toThrow();
});

test("new model profiles automatically drive selectors, correction and request validation", () => {
  VIDEO_MODEL_PROFILES.push({
    models: ["future-video-model"],
    resolutions: ["720p"],
    durations: [5, 10],
  });
  try {
    expect(videoOptions("openai", "future-video-model").resolutions).toEqual([
      "720p",
      "auto",
    ]);
    expect(
      normalizeVideoParameters(
        draft({ model: "future-video-model", duration: 9 }),
      ),
    ).toMatchObject({ resolution: "720p", duration: 10 });
    expect(() =>
      validateVideoRequestParameters(
        JSON.stringify({ model: "future-video-model", seconds: "12" }),
        "text-to-video",
      ),
    ).toThrow("5 / 10 秒");
  } finally {
    VIDEO_MODEL_PROFILES.pop();
  }
});

test("registry entries have unique model IDs, ordered resolutions and valid durations", () => {
  const names = VIDEO_MODEL_PROFILES.flatMap((profile) => profile.models);
  expect(new Set(names).size).toBe(names.length);
  for (const model of names) {
    for (const mode of [
      "text-to-video",
      "image-to-video",
      "first-last-frame",
      "reference-to-video",
    ] as const) {
      const limits = videoCapabilities(model, mode)!;
      expect(limits.resolutions.length).toBeGreaterThan(0);
      expect(limits.durations.length).toBeGreaterThan(0);
      expect(
        limits.durations.every(
          (n, i) =>
            Number.isSafeInteger(n) &&
            n > 0 &&
            (!i || n > limits.durations[i - 1]),
        ),
      ).toBe(true);
    }
  }
  expect(calculateVideoSize("4k", "16:9")).toBe("3840x2160");
});
