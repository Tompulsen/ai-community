/** @jest-environment node */
import {
  VIDEO_RATIOS,
  VIDEO_RESOLUTIONS,
  calculateVideoSize,
  evenVideoDimension,
  selectedVideoSize,
  videoSizePreview,
  videoSizeParameters,
} from "../app/utils/video-size";

test("size selectors have exactly the requested choices", () => {
  expect(VIDEO_RESOLUTIONS).toEqual(["480p", "720p", "1080p", "auto"]);
  expect(VIDEO_RATIOS).toEqual([
    "1:1",
    "3:4",
    "4:3",
    "16:9",
    "9:16",
    "21:9",
    "auto",
  ]);
});

test.each([
  ["480p", "16:9", "854x480"],
  ["480p", "9:16", "480x854"],
  ["720p", "1:1", "720x720"],
  ["1080p", "3:4", "1080x1440"],
  ["480p", "4:3", "640x480"],
  ["720p", "21:9", "1680x720"],
])("%s at %s calculates %s", (resolution, ratio, expected) => {
  expect(calculateVideoSize(resolution, ratio)).toBe(expected);
});

test("every preset keeps the short edge and produces even dimensions", () => {
  for (const resolution of VIDEO_RESOLUTIONS.slice(0, 3))
    for (const ratio of VIDEO_RATIOS.slice(0, 6)) {
      const dimensions = calculateVideoSize(resolution, ratio)
        .split("x")
        .map(Number);
      expect(Math.min(...dimensions)).toBe(parseInt(resolution));
      expect(dimensions.every((value) => value % 2 === 0)).toBe(true);
    }
});

test.each([
  { resolution: "480p", aspectRatio: "auto" },
  { resolution: "auto", aspectRatio: "9:16" },
  { resolution: "auto", aspectRatio: "auto" },
])(
  "automatic config stays distinct from previews and request fallbacks: %j",
  (selection) => {
    const config = { ...selection, size: selectedVideoSize(selection) };
    expect(config.size).toBe("auto");
    expect(videoSizePreview(config)).toBe(
      selection.resolution === "480p" ? "854x480" : "1280x720",
    );
    expect(videoSizeParameters(config, "openai")).toEqual({
      size: "1280x720",
      resolution_name: selection.resolution,
    });
    expect(videoSizeParameters(config, "gemini")).toEqual({
      aspectRatio: "16:9",
      ...(selection.resolution === "auto"
        ? {}
        : { resolution: selection.resolution }),
    });
    expect(videoSizeParameters(config, "script")).toEqual({
      size: "auto",
      ratio: selection.aspectRatio,
      resolution: selection.resolution,
    });
  },
);

test("manual size overrides the calculation and preserves protocol-specific parameters", () => {
  const config = { size: "1001x601", aspectRatio: "16:9", resolution: "480p" };
  expect(videoSizeParameters(config, "openai")).toEqual({
    size: "1002x602",
    resolution_name: "480p",
  });
  expect(videoSizeParameters(config, "gemini")).toEqual({
    aspectRatio: "16:9",
    resolution: "480p",
  });
  expect(videoSizeParameters(config, "script")).toEqual({
    size: "1002x602",
    ratio: "16:9",
    resolution: "480p",
  });
});

test.each(["auto", "invalid old dimensions"])(
  "native resolution and ratio do not depend on unused stored dimensions: %s",
  (size) => {
    expect(
      videoSizeParameters(
        { size, resolution: "720p", aspectRatio: "9:16" },
        "gemini",
      ),
    ).toEqual({ aspectRatio: "9:16", resolution: "720p" });
  },
);

test.each([
  "",
  "x480",
  "0x480",
  "-2x480",
  "Infinityx480",
  "9007199254740992x480",
])("invalid manual dimensions are rejected: %s", (size) => {
  expect(() =>
    videoSizeParameters(
      { size, resolution: "480p", aspectRatio: "16:9" },
      "openai",
    ),
  ).toThrow();
});

test("even rounding does not round the width before calculating the height", () => {
  expect(evenVideoDimension(853.333)).toBe(854);
  expect(evenVideoDimension(1001)).toBe(1002);
});
