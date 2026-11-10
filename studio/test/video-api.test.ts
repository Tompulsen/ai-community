/** @jest-environment node */
import { jest } from "@jest/globals";
import {
  buildVideoRequest,
  videoApiFormat,
  isVideoMediaPath,
  readVideoTask,
  videoDraftForFormat,
  videoOptions,
  parseVideoCustomParams,
  videoTaskId,
  videoTaskPath,
  videoParameterFormat,
  videoBuiltinParameters,
  videoUploadMode,
  type VideoApiFormat,
  type VideoTaskFormat,
} from "../app/utils/video-api";
import type { VideoDraft } from "../app/store/video";
import type { LocalTask } from "../app/utils/local-tasks";

const image = "data:image/png;base64,aGVsbG8=";
function draft(
  apiFormat: VideoApiFormat,
  patch: Partial<VideoDraft> = {},
): VideoDraft {
  return {
    apiFormat,
    model: "model",
    prompt: "Ocean waves",
    mode: "text-to-video",
    duration: 8,
    aspectRatio: "16:9",
    resolution: "720p",
    size: "1280x720",
    count: 1,
    materials: [],
    negativePrompt: "",
    seed: "",
    promptAdherence: 1,
    cameraMotion: 50,
    referenceMode: "all-reference",
    autoPlay: true,
    autoSaveGallery: true,
    confirmBeforeGenerate: false,
    draftAutoSave: true,
    ...patch,
  };
}
function task(apiFormat: VideoTaskFormat): LocalTask {
  return {
    id: "local",
    kind: "video",
    tokenId: 7,
    model: "model",
    prompt: "waves",
    createdAt: 0,
    upstreamId:
      apiFormat === "gemini" ? "models/veo-3.1/operations/job_1" : "job_1",
    video: {
      apiFormat,
      mode: "text-to-video",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: 8,
    },
  };
}

test("OpenAI uses multipart with default dimensions and preserves the reference bytes", async () => {
  const request = buildVideoRequest(
    draft("openai", {
      mode: "image-to-video",
      materials: [{ id: "ref", type: "image", name: "ref.png", url: image }],
      negativePrompt: "old hidden value",
      seed: "old seed",
    }),
    "sora-2",
  );
  expect(request.path).toBe("videos");
  const body = request.body as FormData;
  expect([...body.keys()]).toEqual([
    "model",
    "prompt",
    "seconds",
    "input_reference",
    "metadata",
  ]);
  expect(body.get("seconds")).toBe("8");
  expect(body.has("size")).toBe(false);
  expect(body.has("resolution_name")).toBe(false);
  expect(JSON.parse(body.get("metadata") as string)).toEqual({
    resolution: "720p",
    aspect_ratio: "16:9",
  });
  expect(await (body.get("input_reference") as Blob).text()).toBe("hello");
});

test.each([
  ["image_url", "https://cdn.test/reference.png?version=1", "file-unused"],
  ["image_url", image, "file-unused"],
  ["file_id", "https://cdn.test/unused.png", "  file-reference_123  "],
] as const)(
  "OpenAI %s references use JSON and preserve typed extensions",
  (source, url, fileId) => {
    const request = buildVideoRequest(
      draft("openai", {
        mode: "image-to-video",
        openaiReferenceSource: source,
        openaiImageUrl: url,
        openaiFileId: fileId,
        materials: [{ id: "old", name: "old.png", type: "image", url: image }],
        customParams: { openai: '{"seed":0,"generate_audio":false}' },
      }),
      "sora-channel",
    );
    expect(request.path).toBe("videos");
    expect(typeof request.body).toBe("string");
    expect(JSON.parse(request.body as string)).toEqual({
      model: "sora-channel",
      prompt: "Ocean waves",
      seconds: "8",
      input_reference:
        source === "file_id" ? { file_id: fileId.trim() } : { image_url: url },
      seed: 0,
      generate_audio: false,
      metadata: { resolution: "720p", aspect_ratio: "16:9" },
    });
  },
);

test.each([
  "text-to-video",
  "image-to-video",
  "first-last-frame",
  "reference-to-video",
] as const)(
  "generic compatible video carries billing resolution in %s without computed dimensions",
  (mode) => {
    const request = buildVideoRequest(
      draft("openai", {
        mode,
        resolution: "480p",
        materials:
          mode === "text-to-video"
            ? []
            : [{ id: "ref", type: "image", name: "ref.png", url: image }],
      }),
      "minimax_h3",
    );
    const body =
      request.body instanceof FormData
        ? Object.fromEntries(request.body)
        : JSON.parse(request.body);
    const metadata =
      typeof body.metadata === "string"
        ? JSON.parse(body.metadata)
        : body.metadata;
    expect(metadata.resolution).toBe("480p");
    expect(body).not.toHaveProperty("size");
    expect(body).not.toHaveProperty("resolution_name");
  },
);

test.each([
  "text-to-video",
  "image-to-video",
  "first-last-frame",
  "reference-to-video",
] as const)(
  "generic compatible video preserves an explicit portrait ratio in %s",
  (mode) => {
    for (const resolution of ["720p", "auto"]) {
      const request = buildVideoRequest(
        draft("openai", {
          mode,
          aspectRatio: "9:16",
          resolution,
          size: resolution === "auto" ? "auto" : "720x1280",
          materials:
            mode === "text-to-video"
              ? []
              : [{ id: "ref", type: "image", name: "ref.png", url: image }],
        }),
        "满血2.0不卡脸",
      );
      const body =
        request.body instanceof FormData
          ? Object.fromEntries(request.body)
          : JSON.parse(request.body);
      const metadata =
        typeof body.metadata === "string"
          ? JSON.parse(body.metadata)
          : body.metadata;
      expect(metadata?.aspect_ratio).toBe("9:16");
      expect(body).not.toHaveProperty("size");
    }
  },
);

test.each(["aspect_ratio", "aspectRatio", "ratio"])(
  "generic compatible ratio overrides preserve root then metadata precedence for %s",
  (key) => {
    for (const rootOverride of [false, true]) {
      const body = buildVideoRequest(
        draft("openai", {
          aspectRatio: "9:16",
          customParams: {
            openai: JSON.stringify({
              ...(rootOverride ? { [key]: "3:4" } : {}),
              metadata: { [key]: "1:1", generate_audio: false },
            }),
          },
        }),
        "unknown-video-alias",
      ).body as FormData;
      const metadata = JSON.parse(body.get("metadata") as string);
      expect(metadata.aspect_ratio).toBe(rootOverride ? "3:4" : "1:1");
      expect(metadata.generate_audio).toBe(false);
    }
  },
);

test("generic compatible metadata respects custom resolution and preserves automatic mode", () => {
  const overridden = buildVideoRequest(
    draft("openai", {
      customParams: {
        openai: '{"resolution_name":"1080p","metadata":{"custom":0}}',
      },
    }),
    "minimax_h3",
  ).body as FormData;
  expect(JSON.parse(overridden.get("metadata") as string)).toEqual({
    resolution: "1080p",
    aspect_ratio: "16:9",
    custom: 0,
  });
  const automatic = buildVideoRequest(
    draft("openai", {
      resolution: "auto",
      aspectRatio: "auto",
      size: "auto",
    }),
    "minimax_h3",
  ).body as FormData;
  expect(automatic.has("metadata")).toBe(false);
  expect(automatic.has("size")).toBe(false);
});

test.each([
  ["image_url", ""],
  ["image_url", "javascript:alert(1)"],
  ["image_url", "file:///C:/private.png"],
  ["image_url", "not-a-url"],
  ["image_url", "data:text/html;base64,aGVsbG8="],
  ["file_id", ""],
  ["file_id", "file with spaces"],
] as const)(
  "OpenAI rejects invalid %s references before submission: %s",
  (source, value) => {
    expect(() =>
      buildVideoRequest(
        draft("openai", {
          mode: "image-to-video",
          openaiReferenceSource: source,
          openaiImageUrl: value,
          openaiFileId: value,
        }),
        "sora-channel",
      ),
    ).toThrow();
  },
);

test("inactive OpenAI reference fields do not affect uploads or text generation", () => {
  const saved = {
    openaiReferenceSource: "image_url" as const,
    openaiImageUrl: "invalid saved URL",
  };
  expect(
    buildVideoRequest(
      draft("openai", {
        ...saved,
        mode: "text-to-video",
      }),
      "sora-2",
    ).body,
  ).toBeInstanceOf(FormData);
  expect(buildVideoRequest(draft("xai", saved), "grok").path).toBe("videos");
  expect(
    buildVideoRequest(
      draft("openai", {
        ...saved,
        mode: "image-to-video",
        openaiReferenceSource: "upload",
        materials: [
          { id: "local", name: "local.png", type: "image", url: image },
        ],
      }),
      "sora-2",
    ).body,
  ).toBeInstanceOf(FormData);
});

test("custom OpenAI reference objects are sent natively and override saved reference controls", () => {
  const request = buildVideoRequest(
    draft("openai", {
      mode: "image-to-video",
      openaiReferenceSource: "image_url",
      openaiImageUrl: "invalid saved value",
      customParams: {
        openai: '{"input_reference":{"file_id":"file-custom"},"size":null}',
      },
    }),
    "sora-channel",
  );
  const body = JSON.parse(request.body as string);
  expect(body.input_reference).toEqual({ file_id: "file-custom" });
  expect(body).not.toHaveProperty("size");
});

test("old xAI drafts submit through OpenAI Video with compatible reference fields", () => {
  const materials = [1, 2].map((id) => ({
    id: String(id),
    type: "image" as const,
    name: "ref",
    url: image,
  }));
  const firstLast = buildVideoRequest(
    draft("xai", { mode: "first-last-frame", materials }),
    "grok-imagine-video-1.5",
  );
  expect(firstLast.path).toBe("videos");
  expect(JSON.parse(firstLast.body as string)).toMatchObject({
    model: "grok-imagine-video-1.5",
    prompt: "Ocean waves",
    seconds: "8",
    aspect_ratio: "16:9",
    resolution: "720p",
    input_reference: image,
    last_frame: { url: image },
  });
  const refs = JSON.parse(
    buildVideoRequest(
      draft("xai", { mode: "reference-to-video", materials }),
      "grok-imagine-video",
    ).body as string,
  );
  expect(refs.reference_images).toEqual([{ url: image }, { url: image }]);
  expect(refs).not.toHaveProperty("images");
  expect(refs).not.toHaveProperty("image");
});

test("Veo sends uploaded images and parameters through the OpenAI Video gateway", () => {
  const request = buildVideoRequest(
    draft("gemini", {
      mode: "image-to-video",
      negativePrompt: "blur",
      protocolOptions: {
        gemini: { seed: "0", personGeneration: "allow_adult" },
      },
      materials: [1].map((id) => ({
        id: String(id),
        type: "image",
        name: "ref",
        url: image,
      })),
    }),
    "veo-3.1-generate-preview",
  );
  expect(request.path).toBe("videos");
  const body = JSON.parse(request.body as string);
  expect(body.images).toEqual([image]);
  expect(body.seconds).toBe("8");
  expect(body.metadata).toEqual({
    aspectRatio: "16:9",
    resolution: "720p",
    negativePrompt: "blur",
    seed: 0,
    personGeneration: "allow_adult",
  });
  expect(body).not.toHaveProperty("instances");
  expect(body).not.toHaveProperty("input_reference");
});

test("all old draft choices migrate to OpenAI without changing base parameters", () => {
  for (const removed of [
    "xai",
    "seedance",
    "gemini",
    "legacy",
    "plugin",
    undefined,
  ]) {
    expect(videoApiFormat(removed)).toBe("openai");
    const old = {
      ...draft("openai"),
      apiFormat: removed,
      duration: 5,
    } as unknown as VideoDraft;
    const migrated = { ...old, ...videoDraftForFormat(old) };
    expect(migrated.apiFormat).toBe("openai");
    expect(migrated.prompt).toBe(old.prompt);
    expect(migrated.duration).toBe(5);
  }
});

test("draft migration preserves materials, saved custom JSON and active built-in options", () => {
  const old = draft("xai", {
    model: "grok-imagine-video-1.5",
    mode: "first-last-frame",
    materials: [1, 2].map((id) => ({
      id: String(id),
      type: "image",
      name: "ref.png",
      url: image,
    })),
    protocolOptions: { xai: { generateAudio: false } },
    customParams: { xai: '{"seed":42}', openai: '{"seconds":6}' },
  });
  const migrated = { ...old, ...videoDraftForFormat(old) };
  expect(migrated.apiFormat).toBe("openai");
  expect(migrated.mode).toBe(old.mode);
  expect(migrated.materials).toEqual(old.materials);
  expect(migrated.customParams).toEqual(old.customParams);
  expect(migrated.protocolOptions?.openai?.generateAudio).toBe(false);
  expect({ ...migrated, ...videoDraftForFormat(migrated) }).toEqual(migrated);
  const body = JSON.parse(
    buildVideoRequest(migrated, migrated.model).body as string,
  );
  expect(body.seconds).toBe(6);
  expect(body.generate_audio).toBe(false);
});

test("old native custom JSON stays visible for review and cannot silently change a paid request", () => {
  const old = draft("xai", {
    model: "grok-imagine-video",
    duration: 8,
    customParams: { xai: '{"duration":12}' },
  });
  const migrated = { ...old, ...videoDraftForFormat(old) };
  expect(migrated.legacyCustomFormat).toBe("xai");
  expect(migrated.customParams?.xai).toBe('{"duration":12}');
  expect(() => buildVideoRequest(migrated, old.model)).toThrow("重新填写");
  const reviewed = {
    ...migrated,
    legacyCustomFormat: undefined,
    customParams: { ...migrated.customParams, openai: '{"seconds":12}' },
  };
  expect(
    JSON.parse(buildVideoRequest(reviewed, old.model).body as string).seconds,
  ).toBe(12);
  expect(
    { ...reviewed, ...videoDraftForFormat(reviewed) }.legacyCustomFormat,
  ).toBeUndefined();
});

test("Veo reference frames are forwarded without frontend model limits", () => {
  const old = draft("gemini", {
    model: "veo-3.1",
    mode: "first-last-frame",
    materials: [1, 2].map((id) => ({
      id: String(id),
      type: "image",
      name: "ref.png",
      url: image,
    })),
  });
  const sent = JSON.parse(buildVideoRequest(old, old.model).body as string);
  expect(sent.images).toEqual(old.materials.map((item) => item.url));
  const migrated = { ...old, ...videoDraftForFormat(old) };
  expect(migrated.materials).toEqual(old.materials);
  expect(migrated.mode).toBe("first-last-frame");
});

test.each([
  { images: ["https://cdn.test/ref.png"] },
  { images: {} },
  { input_reference: { file_id: "file-1" } },
])("Veo rejects unsupported reference values: %j", (custom) => {
  expect(() =>
    buildVideoRequest(
      draft("openai", {
        mode: "image-to-video",
        customParams: { openai: JSON.stringify(custom) },
      }),
      "veo-3.1",
    ),
  ).toThrow(/参考|Base64/);
});

test("old Seedance drafts use OpenAI Video with compatible content roles", () => {
  const request = buildVideoRequest(
    draft("seedance", {
      mode: "first-last-frame",
      materials: [1, 2].map((id) => ({
        id: String(id),
        type: "image",
        name: "ref",
        url: image,
      })),
      negativePrompt: "stale hidden value",
      seed: "123",
    }),
    "doubao-seedance-2-0-260128",
  );
  expect(request.path).toBe("videos");
  expect(JSON.parse(request.body as string)).toEqual({
    model: "doubao-seedance-2-0-260128",
    prompt: "Ocean waves",
    seconds: "8",
    metadata: {
      content: [
        { type: "image_url", image_url: { url: image }, role: "first_frame" },
        { type: "image_url", image_url: { url: image }, role: "last_frame" },
      ],
      ratio: "16:9",
      resolution: "720p",
    },
  });
});

test("Seedance reference roles are independent of channel model aliases", () => {
  const refs = [1, 2].map((id) => ({
    id: String(id),
    type: "image" as const,
    name: "ref",
    url: image,
  }));
  const body = JSON.parse(
    buildVideoRequest(
      draft("seedance", {
        mode: "reference-to-video",
        materials: refs,
      }),
      "doubao-seedance-2-0",
    ).body as string,
  );
  expect(body.metadata.content.map((part: any) => part.role)).toEqual([
    "reference_image",
    "reference_image",
  ]);
});

test("Seedance custom image parameters survive normalization and reach the request", () => {
  const original = draft("seedance", {
    model: "doubao-seedance-2-5",
    mode: "image-to-video",
    aspectRatio: "7:4",
    resolution: "2160p",
    duration: 45,
    materials: [{ id: "ref", type: "image", name: "ref", url: image }],
  });
  const normalized = { ...original, ...videoDraftForFormat(original) };
  expect(normalized.aspectRatio).toBe("7:4");
  expect(
    JSON.parse(
      buildVideoRequest(normalized, "doubao-seedance-2-5").body as string,
    ),
  ).toMatchObject({
    metadata: { ratio: "7:4", resolution: "2160p" },
    seconds: "45",
  });
});

test.each(["sora-2", "grok-imagine-video", "doubao-seedance-2-0", "veo-3.1"])(
  "%s preserves custom parameter values outside suggestions",
  (model) => {
    const original = draft("openai", {
      model,
      size: "2048x1080",
      aspectRatio: "7:4",
      resolution: "2160p",
      duration: 24,
    });
    expect({ ...original, ...videoDraftForFormat(original) }).toEqual(original);
    const request = buildVideoRequest(original, original.model);
    if (request.body instanceof FormData) {
      expect(request.body.get("seconds")).toBe("24");
      expect(request.body.has("size")).toBe(false);
    } else {
      const body = JSON.parse(request.body);
      const parameters = body.metadata;
      expect(parameters.resolution).toBe("2160p");
      expect(body.seconds).toBe("24");
    }
  },
);

test("Veo 2 aliases no longer silently discard a custom resolution", () => {
  const body = JSON.parse(
    buildVideoRequest(
      draft("gemini", { resolution: "custom-hd" }),
      "veo-2-channel",
    ).body as string,
  );
  expect(body.metadata.resolution).toBe("custom-hd");
});

test("model families determine reference modes without a protocol selector", () => {
  for (const model of [
    "sora-2",
    "veo-3.1",
    "kling-v2.1",
    "grok-imagine-video",
    "doubao-seedance-2-0",
  ])
    expect(videoOptions("openai", model).modes).toEqual([
      "text-to-video",
      "image-to-video",
      "first-last-frame",
      "reference-to-video",
    ]);
});

test("Kling compatible models expose multi-image references", () => {
  expect(videoOptions("openai", "kling-v2.1").modes).toContain(
    "reference-to-video",
  );
});

test.each([
  "sora-2",
  "sora-2-pro",
  "grok-imagine-video",
  "grok-imagine-video-1.5",
  "grok-imagine-video-1.5-lite",
  "doubao-seedance-1-0",
  "doubao-seedance-2-0",
  "doubao-seedance-2-0-fast",
  "doubao-seedance-2-5",
  "veo-2-channel",
  "veo-3.1",
])(
  "%s shares resolution presets, 3–30 second suggestions and ten reference limit",
  (model) => {
    for (const mode of [
      "text-to-video",
      "image-to-video",
      "first-last-frame",
      "reference-to-video",
    ] as const) {
      const options = videoOptions("openai", model, mode, "1080p");
      expect(options.resolutions).toEqual(["480p", "720p", "1080p", "auto"]);
      expect(options.durations).toEqual(
        Array.from({ length: 28 }, (_, i) => i + 3),
      );
      expect(options.maxReferences).toBe(10);
    }
  },
);

test.each(["grok-imagine-video-1.5", "doubao-seedance-2-0"])(
  "%s accepts one through ten reference images and rejects other counts",
  (model) => {
    for (const count of [0, 1, 10, 11]) {
      const input = draft("openai", {
        model,
        mode: "reference-to-video",
        duration: 30,
        resolution: "480p",
        materials: Array.from({ length: count }, (_, i) => ({
          id: String(i),
          type: "image",
          name: `${i}.png`,
          url: image,
        })),
      });
      if (count === 0 || count === 11) {
        expect(() => buildVideoRequest(input, model)).toThrow("1 至 10");
      } else {
        const sent = JSON.parse(buildVideoRequest(input, model).body as string);
        expect(sent.seconds).toBe("30");
        expect(sent.metadata.resolution).toBe("480p");
        expect(
          sent.metadata.reference_images ?? sent.metadata.content,
        ).toHaveLength(count);
      }
    }
  },
);

test("saved resolutions outside presets remain custom values without being reset", () => {
  const saved = draft("openai", {
    model: "doubao-seedance-2-0",
    resolution: "4k",
  });
  const restored = { ...saved, ...videoDraftForFormat(saved) };
  expect(restored.resolution).toBe("4k");
  expect(videoOptions("openai", saved.model).resolutions).not.toContain("4k");
  expect(
    JSON.parse(buildVideoRequest(restored, saved.model).body as string).metadata
      .resolution,
  ).toBe("4k");
});

test("OpenAI-compatible model families expose their built-in video controls", () => {
  expect(videoParameterFormat("openai", "doubao-seedance-2-0@channel")).toBe(
    "seedance",
  );
  expect(videoParameterFormat("openai", "grok-imagine-video-1.5")).toBe("xai");
  expect(videoParameterFormat("openai", "sora-2")).toBe("openai");
  expect(videoOptions("openai", "doubao-seedance-2-0").modes).toContain(
    "first-last-frame",
  );
  expect(videoOptions("openai", "grok-imagine-video-1.5").usesSize).toBe(false);
  expect(videoOptions("openai", "sora-2").modes).toContain("first-last-frame");
});

test("uploading more references changes mode without requiring manual mode selection", () => {
  expect(videoUploadMode("text-to-video", 1)).toBe("image-to-video");
  expect(videoUploadMode("text-to-video", 2)).toBe("reference-to-video");
  expect(videoUploadMode("image-to-video", 2)).toBe("reference-to-video");
  expect(videoUploadMode("first-last-frame", 2)).toBe("first-last-frame");
  expect(videoUploadMode("first-last-frame", 3)).toBe("reference-to-video");
  expect(videoUploadMode("reference-to-video", 10)).toBe("reference-to-video");
});

test.each([
  "sora-2",
  "kling-v2.1",
  "veo-3.1",
  "grok-imagine-video",
  "doubao-seedance-2-0",
])(
  "%s forwards all ten uploaded references instead of dropping extra images",
  (model) => {
    const materials = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      type: "image" as const,
      name: `${i}.png`,
      url: `https://cdn.test/${i}.png`,
    }));
    if (model.startsWith("veo"))
      materials.forEach((item) => {
        item.url = image;
      });
    const input = draft("openai", {
      model,
      mode: "reference-to-video",
      materials,
    });
    const sent = JSON.parse(buildVideoRequest(input, model).body as string);
    const references = model.startsWith("doubao")
      ? sent.metadata.content.map((item: any) => item.image_url.url)
      : model.startsWith("grok")
      ? sent.reference_images.map((item: any) => item.url)
      : sent.images;
    expect(references).toEqual(materials.map((item) => item.url));
  },
);
test.each(["sora-2", "grok-imagine-video", "doubao-seedance-2-0", "veo-3.1"])(
  "%s uses default dimensions without sending the automatic preview size",
  (model) => {
    const request = buildVideoRequest(
      draft("openai", {
        model,
        size: "auto",
        resolution: "480p",
        aspectRatio: "auto",
      }),
      model,
    );
    if (request.body instanceof FormData) {
      expect(request.body.has("size")).toBe(false);
      expect(request.body.has("resolution_name")).toBe(false);
    } else {
      const sent = JSON.parse(request.body);
      expect(sent).not.toHaveProperty("size");
      expect(sent).not.toHaveProperty("resolution_name");
      if (model.startsWith("veo")) {
        expect(sent.metadata.aspectRatio).toBe("16:9");
        expect(sent.metadata.resolution).toBe("480p");
      } else if (model.startsWith("grok")) {
        expect(sent.metadata.aspect_ratio).toBe("16:9");
        expect(sent.metadata.resolution).toBe("480p");
      } else {
        expect(sent.metadata.ratio).toBe("16:9");
        expect(sent.metadata.resolution).toBe("480p");
      }
    }
  },
);
test.each(["grok-imagine-video", "grok-imagine-video-1.5-6s"])(
  "OpenAI-compatible %s sends the reference as a string accepted by New API",
  (model) => {
    for (const source of ["upload", "image_url"] as const) {
      const url = source === "upload" ? image : "https://cdn.test/first.png";
      const request = buildVideoRequest(
        draft("openai", {
          model,
          mode: "image-to-video",
          openaiReferenceSource: source,
          openaiImageUrl: url,
          materials: [{ id: "ref", name: "ref.png", type: "image", url }],
        }),
        model,
      );
      expect(request.path).toBe("videos");
      expect(JSON.parse(request.body as string).input_reference).toBe(url);
    }
  },
);

test.each(["sora-2", "grok-imagine-video", "doubao-seedance-2-0", "veo-3.1"])(
  "%s omits computed dimensions in every generation mode and preserves explicit custom dimensions",
  (model) => {
    for (const mode of [
      "text-to-video",
      "image-to-video",
      "first-last-frame",
      "reference-to-video",
    ] as const) {
      const input = draft("openai", {
        model,
        mode,
        size: "854x480",
        resolution: "480p",
        materials: Array.from({ length: 2 }, (_, index) => ({
          id: String(index),
          name: "ref.png",
          type: "image" as const,
          url: image,
        })),
      });
      for (const explicit of [false, true]) {
        const body = buildVideoRequest(
          {
            ...input,
            ...(explicit
              ? {
                  customParams: {
                    openai: '{"size":"1280x720","resolution_name":"720p"}',
                  },
                }
              : {}),
          },
          model,
        ).body;
        const fields =
          body instanceof FormData
            ? Object.fromEntries(body.entries())
            : JSON.parse(body);
        if (explicit) {
          expect(fields.size).toBe("1280x720");
          expect(fields.resolution_name).toBe("720p");
        } else {
          expect(fields).not.toHaveProperty("size");
          expect(fields).not.toHaveProperty("resolution_name");
        }
      }
    }
    expect(() =>
      buildVideoRequest(
        draft("openai", { size: "invalid stale dimensions" }),
        model,
      ),
    ).not.toThrow();
  },
);

test.each(["xai", "seedance"] as const)(
  "OpenAI-compatible %s submits both frames without custom JSON",
  (family) => {
    const model =
      family === "xai" ? "grok-imagine-video-1.5" : "doubao-seedance-2-0";
    const request = buildVideoRequest(
      draft("openai", {
        model,
        mode: "first-last-frame",
        materials: [
          { id: "first", name: "first.png", type: "image", url: image },
          {
            id: "last",
            name: "last.png",
            type: "image",
            url: "data:image/png;base64,dGFpbA==",
          },
        ],
        protocolOptions: { openai: { generateAudio: false } },
      }),
      model,
    );
    expect(request.path).toBe("videos");
    const body = JSON.parse(request.body as string);
    expect(body.seconds).toBe("8");
    expect(body).not.toHaveProperty("size");
    expect(body).not.toHaveProperty("resolution_name");
    if (family === "xai") {
      expect(body.input_reference).toBe(image);
      expect(body.last_frame).toEqual({
        url: "data:image/png;base64,dGFpbA==",
      });
      expect(body.generate_audio).toBe(false);
      expect(body).not.toHaveProperty("watermark");
    } else {
      expect(body.metadata).toMatchObject({
        ratio: "16:9",
        resolution: "720p",
        generate_audio: false,
      });
      expect(body.metadata.content).toEqual([
        { type: "image_url", image_url: { url: image }, role: "first_frame" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,dGFpbA==" },
          role: "last_frame",
        },
      ]);
    }
  },
);

test.each([
  "text-to-video",
  "image-to-video",
  "first-last-frame",
  "reference-to-video",
] as const)(
  "Grok %s parameters survive the New API task request schema without computed dimensions",
  (mode) => {
    const count =
      mode === "text-to-video" ? 0 : mode === "image-to-video" ? 1 : 2;
    const body = JSON.parse(
      buildVideoRequest(
        draft("openai", {
          mode,
          size: "854x480",
          resolution: "480p",
          duration: 6,
          materials: Array.from({ length: count }, (_, i) => ({
            id: String(i),
            name: "ref.png",
            type: "image" as const,
            url: image,
          })),
          protocolOptions: { openai: { generateAudio: false } },
        }),
        "grok-imagine-video-1.5-6s",
      ).body as string,
    );
    expect(body).not.toHaveProperty("size");
    expect(body).not.toHaveProperty("resolution_name");
    expect(body.seconds).toBe("6");
    const acceptedFields = [
      "prompt",
      "model",
      "mode",
      "image",
      "images",
      "size",
      "duration",
      "seconds",
      "input_reference",
      "metadata",
    ];
    const forwarded = Object.fromEntries(
      Object.entries(body).filter(([key]) => acceptedFields.includes(key)),
    ) as typeof body;
    expect(forwarded.metadata).toMatchObject({
      resolution: "480p",
      aspect_ratio: "16:9",
      generate_audio: false,
    });
    if (mode === "first-last-frame")
      expect(forwarded.metadata.last_frame).toEqual(body.last_frame);
    if (mode === "reference-to-video")
      expect(forwarded.metadata.reference_images).toEqual(
        body.reference_images,
      );
  },
);

test("Grok compatible extensions agree across root fields and metadata overrides", () => {
  const body = JSON.parse(
    buildVideoRequest(
      draft("openai", {
        customParams: {
          openai: JSON.stringify({
            resolution: "1080p",
            generate_audio: false,
            metadata: {
              resolution: "480p",
              aspect_ratio: "9:16",
              generate_audio: true,
              custom: 0,
            },
          }),
        },
      }),
      "grok-imagine-video-1.5",
    ).body as string,
  );
  expect(body).toMatchObject({
    resolution: "1080p",
    aspect_ratio: "9:16",
    generate_audio: false,
    metadata: {
      resolution: "1080p",
      aspect_ratio: "9:16",
      generate_audio: false,
      custom: 0,
    },
  });
});

test.each([null, [], "", 1])(
  "Grok compatible rejects non-object metadata: %j",
  (metadata) => {
    expect(() =>
      buildVideoRequest(
        draft("openai", {
          customParams: { openai: JSON.stringify({ metadata }) },
        }),
        "grok-imagine-video",
      ),
    ).toThrow("metadata");
  },
);

test("OpenAI-compatible Seedance merges advanced metadata without losing built-in frame roles", () => {
  const body = JSON.parse(
    buildVideoRequest(
      draft("openai", {
        model: "doubao-seedance-2-0",
        customParams: {
          openai: '{"metadata":{"resolution":"1080p","generate_audio":true}}',
        },
        protocolOptions: { openai: { generateAudio: false } },
      }),
      "doubao-seedance-2-0",
    ).body as string,
  );
  expect(body.metadata).toMatchObject({
    ratio: "16:9",
    resolution: "1080p",
    generate_audio: true,
    content: [],
  });
  expect(() =>
    buildVideoRequest(
      draft("openai", {
        model: "doubao-seedance-2-0",
        customParams: {
          openai:
            '{"input_reference":{"image_url":"https://cdn.test/first.png"}}',
        },
      }),
      "doubao-seedance-2-0",
    ),
  ).toThrow("metadata.content");
});

test.each(["xai", "seedance"] as const)(
  "OpenAI-compatible %s supports first and last frame URLs",
  (family) => {
    const model =
      family === "xai" ? "grok-imagine-video-1.5" : "doubao-seedance-2-0";
    const body = JSON.parse(
      buildVideoRequest(
        draft("openai", {
          model,
          mode: "first-last-frame",
          openaiReferenceSource: "image_url",
          openaiImageUrl: "https://cdn.test/first.png",
          openaiLastImageUrl: "https://cdn.test/last.png",
        }),
        model,
      ).body as string,
    );
    if (family === "xai")
      expect(body.last_frame).toEqual({ url: "https://cdn.test/last.png" });
    else
      expect(body.metadata.content[1].image_url.url).toBe(
        "https://cdn.test/last.png",
      );
  },
);

test("model controls retain explicit false and zero after old protocol options migrate", () => {
  for (const [format, model] of [
    ["xai", "grok-imagine-video"],
    ["seedance", "doubao-seedance-2-0"],
    ["gemini", "veo-3.1"],
  ] as const) {
    const input = draft(format, {
      model,
      protocolOptions: {
        [format]: {
          generateAudio: false,
          seed: "0",
          personGeneration: "allow_adult",
        },
      },
    });
    const body = JSON.parse(buildVideoRequest(input, model).body as string);
    if (format === "gemini") {
      expect(body.metadata).toMatchObject({
        seed: 0,
        personGeneration: "allow_adult",
      });
      expect(body.metadata).not.toHaveProperty("generate_audio");
    } else {
      expect(body.metadata.generate_audio).toBe(false);
      expect(body.metadata).not.toHaveProperty("seed");
      expect(body.metadata).not.toHaveProperty("watermark");
    }
  }
  expect(() =>
    videoBuiltinParameters(
      draft("gemini", {
        model: "veo-3.1",
        protocolOptions: { gemini: { seed: "1.5" } },
      }),
    ),
  ).toThrow("随机种子");
});

test("old saved watermark controls no longer add watermark to requests", () => {
  for (const format of ["openai", "seedance"] as const) {
    const body = JSON.parse(
      buildVideoRequest(
        draft(format, {
          model: "doubao-seedance-2-0",
          protocolOptions: JSON.parse(`{"${format}":{"watermark":true}}`),
        }),
        "doubao-seedance-2-0",
      ).body as string,
    );
    expect(body).not.toHaveProperty("watermark");
    expect(body.metadata ?? {}).not.toHaveProperty("watermark");
  }
});

test.each(["", " ", "{}", '{"seed":42}'])("valid custom JSON: %s", (value) => {
  expect(parseVideoCustomParams(value)).toEqual(
    value.trim() ? JSON.parse(value) : {},
  );
});

test.each(["{", "[]", "null", '"text"', "42"])(
  "invalid custom JSON is rejected: %s",
  (value) => {
    expect(() =>
      buildVideoRequest(
        draft("openai", { customParams: { openai: value } }),
        "model",
      ),
    ).toThrow(/JSON/);
  },
);

test("OpenAI custom multipart fields preserve values, replace defaults and can omit optional fields", () => {
  const body = buildVideoRequest(
    draft("openai", {
      customParams: {
        openai:
          '{"seconds":20,"size":"3840x2160","seed":0,"generate_audio":false,"characters":[{"id":"char"}],"extra":null}',
      },
    }),
    "sora-2",
  ).body as FormData;
  expect(body.get("seconds")).toBe("20");
  expect(body.get("size")).toBe("3840x2160");
  expect(body.get("seed")).toBe("0");
  expect(body.get("generate_audio")).toBe("false");
  expect(body.get("characters")).toBe('[{"id":"char"}]');
  expect(body.has("extra")).toBe(false);
});

test.each(["grok-imagine-video", "doubao-seedance-2-0"])(
  "%s uses OpenAI custom JSON without leaking inactive protocol settings",
  (model) => {
    const body = JSON.parse(
      buildVideoRequest(
        draft("openai", {
          customParams: {
            openai:
              '{"duration":45,"seed":0,"generate_audio":false,"nested":{"enabled":true}}',
            xai: '{"leak":"no"}',
          },
        }),
        model,
      ).body as string,
    );
    expect(body).toMatchObject({
      duration: 45,
      seed: 0,
      generate_audio: false,
      nested: { enabled: true },
    });
    expect(body).not.toHaveProperty("leak");
  },
);

test("Veo custom metadata merges with defaults and top-level fields remain top-level", () => {
  const body = JSON.parse(
    buildVideoRequest(
      draft("openai", {
        customParams: {
          openai:
            '{"seconds":16,"metadata":{"seed":0,"sampleCount":2},"customField":false}',
        },
      }),
      "veo-channel",
    ).body as string,
  );
  expect(body.metadata).toMatchObject({
    seed: 0,
    sampleCount: 2,
    aspectRatio: "16:9",
    resolution: "720p",
  });
  expect(body.customField).toBe(false);
  expect(body.prompt).toBe("Ocean waves");
  expect(body.seconds).toBe(16);
  expect(() =>
    buildVideoRequest(
      draft("openai", {
        customParams: { openai: '{"metadata":[]}' },
      }),
      "veo-channel",
    ),
  ).toThrow(/metadata/);
});

test.each([
  [
    "grok-imagine-video",
    { input_reference: "https://cdn.test/reference.png" },
    "image-to-video",
  ],
  [
    "doubao-seedance-2-0",
    {
      metadata: {
        content: [
          {
            type: "image_url",
            image_url: { url: "https://cdn.test/reference.png" },
            role: "first_frame",
          },
        ],
      },
    },
    "image-to-video",
  ],
  ["veo-3.1", { images: [image] }, "image-to-video"],
] as const)(
  "%s can supply reference materials directly through JSON",
  (model, custom, mode) => {
    const body = JSON.parse(
      buildVideoRequest(
        draft("openai", {
          mode,
          customParams: { openai: JSON.stringify(custom) },
        }),
        model,
      ).body as string,
    );
    expect(body).toMatchObject(custom);
  },
);

test("OpenAI JSON can delete optional size and seconds without adding placeholder values", () => {
  const body = buildVideoRequest(
    draft("openai", {
      customParams: { openai: '{"seconds":null,"size":null}' },
    }),
    "sora-channel",
  ).body as FormData;
  expect(body.has("seconds")).toBe(false);
  expect(body.has("size")).toBe(false);
  expect(body.get("prompt")).toBe("Ocean waves");
});

test("protocol-specific task identifiers and query paths survive restoration", () => {
  expect(videoTaskId({ request_id: "req_1" }, "xai")).toBe("req_1");
  expect(videoTaskId({ name: "models/veo/operations/op-1" }, "gemini")).toBe(
    "models/veo/operations/op-1",
  );
  expect(videoTaskPath(task("plugin"))).toBe("tasks/job_1");
  expect(videoTaskPath({ ...task("legacy"), video: undefined })).toBe(
    "videos/job_1",
  );
  expect(videoTaskId({ id: "cgt_1" }, "seedance")).toBe("cgt_1");
  expect(videoTaskPath(task("seedance"))).toBe(
    "api/v3/contents/generations/tasks/job_1",
  );
  expect(videoTaskPath(task("gemini"))).toBe(
    "v1beta/models/veo-3.1/operations/job_1",
  );
  expect(videoTaskId({ name: "https://evil.test/model" }, "gemini")).toBe("");
});

test("Seedance completion reads content.video_url and never treats running output as finished", async () => {
  const unused = jest.fn<(...args: any[]) => Promise<Response>>();
  expect(
    await readVideoTask(
      {
        status: "succeeded",
        content: { video_url: "https://cdn.test/seedance.mp4" },
      },
      task("seedance"),
      unused,
    ),
  ).toMatchObject({
    status: "completed",
    video_url: "https://cdn.test/seedance.mp4",
  });
  expect(
    await readVideoTask({ status: "running" }, task("seedance"), unused),
  ).toMatchObject({ status: "running" });
  expect(
    await readVideoTask(
      {
        status: "failed",
        error: { message: "content rejected" },
      },
      task("seedance"),
      unused,
    ),
  ).toMatchObject({ status: "failed", error: "content rejected" });
});

test("OpenAI completion yields an authenticated media path, xAI yields its actual video URL", async () => {
  const unused = jest.fn<(...args: any[]) => Promise<Response>>();
  expect(
    await readVideoTask({ status: "completed" }, task("openai"), unused),
  ).toMatchObject({
    status: "completed",
    mediaPath: "videos/job_1/content",
  });
  expect(
    await readVideoTask(
      { status: "done", video: { url: "https://cdn.test/result.mp4" } },
      task("xai"),
      unused,
    ),
  ).toMatchObject({
    status: "completed",
    video_url: "https://cdn.test/result.mp4",
  });
  expect(
    await readVideoTask(
      { status: "pending", video: { url: "https://cdn.test/unfinished.mp4" } },
      task("xai"),
      unused,
    ),
  ).toMatchObject({ status: "in_progress" });
  expect(unused).not.toHaveBeenCalled();
});

test("plugins resolve the real artifact key and never persist signed content URLs", async () => {
  const fetchTask = jest.fn<(...args: any[]) => Promise<Response>>(async () =>
    Response.json({
      artifacts: [
        { key: "thumb", type: "image" },
        {
          key: "output_3.mp4",
          type: "video",
          content_url: "https://cdn.test/private?token=secret",
        },
      ],
    }),
  );
  const result = await readVideoTask(
    { status: "SUCCESS" },
    task("plugin"),
    fetchTask,
  );
  expect(fetchTask).toHaveBeenCalledWith("tasks/job_1/artifacts");
  expect(result.mediaPath).toBe("tasks/job_1/artifacts/output_3.mp4/content");
  expect(JSON.stringify(result)).not.toContain("secret");
  await readVideoTask({ status: "IN_PROGRESS" }, task("plugin"), fetchTask);
  expect(fetchTask).toHaveBeenCalledTimes(1);
});

test("Gemini REST completion maps the file ID locally and rejects failure/filter results", async () => {
  const unused = jest.fn<(...args: any[]) => Promise<Response>>();
  const result = await readVideoTask(
    {
      done: true,
      response: {
        generateVideoResponse: {
          generatedSamples: [
            {
              video: {
                uri: "https://generativelanguage.googleapis.com/v1beta/files/file-1:download?alt=media&key=private",
              },
            },
          ],
        },
      },
    },
    task("gemini"),
    unused,
  );
  expect(result.mediaPath).toBe("v1beta/files/file-1:download?alt=media");
  expect(
    await readVideoTask(
      { done: true, error: { message: "blocked" } },
      task("gemini"),
      unused,
    ),
  ).toMatchObject({
    status: "failed",
    error: "blocked",
  });
  expect(
    await readVideoTask({ done: true, response: {} }, task("gemini"), unused),
  ).toMatchObject({
    status: "completed",
    mediaPath: undefined,
  });
  for (const path of [
    "https://evil.test/video",
    "videos/../content",
    "tasks/id/artifacts/../content",
    "v1beta/files/id:download?key=secret",
  ])
    expect(isVideoMediaPath(path)).toBe(false);
});
