/** @jest-environment node */

import { jest } from "@jest/globals";
import type { ChatMessage } from "../app/store/chat";
import type { GalleryImage } from "../app/store/gallery";
import type { VideoDraft, VideoResult } from "../app/store/video";
import type { ImageGenerationConfig } from "../app/utils/image-params";
import type { LocalScope } from "../app/utils/local-workspace";

const defaultImageConfig: ImageGenerationConfig = {
  providerName: "OpenAI",
  size: "auto",
  resolution: "auto",
  quality: "auto",
  style: "auto",
  imageOutputFormat: "png",
  imageBackground: "auto",
  imageOutputCompression: 100,
  imageResponseFormat: "url",
  imageStream: false,
  imageRequestMode: "sync",
  imagePartialImages: 1,
};
const defaultVideo: VideoDraft = {
  apiFormat: "openai",
  customParams: {},
  openaiReferenceSource: "upload",
  model: "",
  mode: "text-to-video",
  prompt: "",
  negativePrompt: "",
  size: "1920x1080",
  aspectRatio: "16:9",
  resolution: "1080p",
  duration: 8,
  count: 1,
  seed: "",
  promptAdherence: 1,
  cameraMotion: 50,
  materials: [],
  referenceMode: "all-reference",
  autoPlay: true,
  autoSaveGallery: true,
  confirmBeforeGenerate: false,
  draftAutoSave: true,
};
let scope: LocalScope = "user-7";
let active = true;
let results: VideoResult[] = [];
let sessions: { id?: string; messages: ChatMessage[] }[] = [];
let otherDraft: VideoDraft;
const loadDraft = jest.fn<() => Promise<void>>();
const getImageMetadata =
  jest.fn<
    (
      id: string,
      owner?: LocalScope,
    ) => Promise<Omit<GalleryImage, "imageData"> | undefined>
  >();
const getImageBlob = jest.fn();
const getImagePage = jest.fn();
const attachmentRead = jest.fn<(key: string) => Promise<unknown>>();
const selectSession = jest.fn();
jest.unstable_mockModule("idb-keyval", () => ({ get: attachmentRead }));
jest.unstable_mockModule("@/app/utils/indexedDB-storage", () => ({
  indexedDBStorage: {},
}));
jest.unstable_mockModule("@/app/store/config", () => ({
  DEFAULT_CONFIG: { modelConfig: defaultImageConfig },
}));
jest.unstable_mockModule("@/app/store/video", () => ({
  DEFAULT_DRAFT: defaultVideo,
  snapshotVideoDraft: jest.fn(),
  useVideoStore: {
    getState: () => ({ results, draft: otherDraft, loadDraft }),
  },
}));
jest.unstable_mockModule("@/app/store/gallery", () => ({
  getImageMetadata,
  getImageBlob,
  getImagePage,
}));
jest.unstable_mockModule("@/app/store/chat", () => ({
  useChatStore: { getState: () => ({ sessions, selectSession }) },
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => scope,
  isLocalWorkspaceActive: () => active,
  localKey: (key: string, owner = scope) => `octopus:${owner}:${key}`,
}));
const { readGalleryReuse, videoGenerationReuse } = await import(
  "../app/utils/gallery-reuse"
);

function videoDraft(patch: Partial<VideoDraft> = {}): VideoDraft {
  return { ...JSON.parse(JSON.stringify(defaultVideo)), ...patch };
}

function video(patch: Partial<VideoResult> = {}): VideoResult {
  return {
    id: "video-work",
    model: "grok-imagine-video",
    prompt: "Original waves",
    url: "https://output.test/video.mp4",
    createdAt: 1,
    status: "success",
    ...patch,
  };
}

function image(
  patch: Partial<Omit<GalleryImage, "imageData">> = {},
): Omit<GalleryImage, "imageData"> {
  return {
    id: "image-work",
    model: "gpt-image-2@Custom",
    prompt: "Original image prompt",
    width: 1600,
    height: 900,
    createdAt: 1,
    status: "success",
    ...patch,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  scope = "user-7";
  active = true;
  results = [];
  sessions = [];
  otherDraft = videoDraft({
    model: "another-model@Private",
    prompt: "Another composer",
    duration: 30,
    materials: [
      {
        id: "private",
        type: "image",
        name: "private.png",
        url: "https://private.test/frame.png",
      },
    ],
  });
  loadDraft.mockReset().mockResolvedValue();
  getImageMetadata.mockReset().mockResolvedValue(undefined);
  getImageBlob.mockClear();
  getImagePage.mockClear();
  attachmentRead.mockReset();
  selectSession.mockClear();
  jest.mocked(fetch).mockClear();
});

afterEach(() => {
  expect(getImageBlob).not.toHaveBeenCalled();
  expect(getImagePage).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(selectSession).not.toHaveBeenCalled();
});

test("video reuse detaches the complete submitted parameters and mixed input materials", () => {
  const request = videoDraft({
    model: "grok-imagine-video@Custom",
    prompt: "Follow the waves",
    sourceWorkId: "original-source",
    mode: "reference-to-video",
    size: "720x1280",
    aspectRatio: "9:16",
    resolution: "720p",
    duration: 12,
    negativePrompt: "No cuts",
    seed: "0",
    protocolOptions: { openai: { generateAudio: true } },
    customParams: { openai: '{"prompt":"private override"}' },
    materials: [
      {
        id: "frame",
        type: "image",
        name: "frame.png",
        url: "data:image/png;base64,AAAA",
      },
      {
        id: "clip",
        type: "video",
        name: "clip.webm",
        url: "data:video/webm;base64,BBBB",
      },
      {
        id: "sound",
        type: "audio",
        name: "sound.wav",
        url: "data:audio/wav;base64,CCCC",
      },
    ],
  });
  const before = JSON.parse(JSON.stringify(request));
  const reuse = videoGenerationReuse(request);
  expect(reuse).toMatchObject({
    model: request.model,
    prompt: request.prompt,
    sourceWorkId: "original-source",
    images: ["data:image/png;base64,AAAA"],
    files: [
      {
        name: "clip.webm",
        type: "video/webm",
        content: "data:video/webm;base64,BBBB",
        isText: false,
      },
      {
        name: "sound.wav",
        type: "audio/wav",
        content: "data:audio/wav;base64,CCCC",
        isText: false,
      },
    ],
    config: {
      videoConfig: {
        mode: "reference-to-video",
        size: "720x1280",
        aspectRatio: "9:16",
        resolution: "720p",
        duration: 12,
        negativePrompt: "No cuts",
        seed: "0",
        protocolOptions: { openai: { generateAudio: true } },
      },
    },
  });
  for (const key of [
    "model",
    "prompt",
    "materials",
    "sourceWorkId",
    "customParams",
  ]) {
    expect(reuse.config.videoConfig).not.toHaveProperty(key);
  }
  reuse.config.videoConfig!.protocolOptions!.openai!.generateAudio = false;
  reuse.images[0] = "Changed image";
  reuse.files[0].content = "Changed video";
  expect(request).toEqual(before);
});

test("saved video requests never inherit the current independent video draft", async () => {
  const request = videoDraft({
    model: "sora-2@OpenAI",
    prompt: "Saved request",
    duration: 6,
    materials: [
      {
        id: "saved",
        type: "image",
        name: "saved.png",
        url: "https://input.test/frame.png",
      },
    ],
  });
  results = [video({ request })];
  const before = JSON.parse(JSON.stringify(otherDraft));
  const reuse = await readGalleryReuse({
    kind: "video",
    id: "video-work",
    scope,
  });
  expect(reuse).toMatchObject({
    prompt: "Saved request",
    model: "sora-2@OpenAI",
    config: { videoConfig: { duration: 6 } },
    images: ["https://input.test/frame.png"],
    files: [],
    incomplete: false,
  });
  expect(otherDraft).toEqual(before);
  expect(loadDraft).toHaveBeenCalledTimes(1);
});

test("legacy video metadata restores only recorded values and reports incomplete input", async () => {
  results = [
    video({
      model: "legacy-video@Custom",
      mode: "image-to-video",
      duration: 5,
      size: "480x854",
      aspectRatio: "9:16",
      resolution: "480p",
    }),
  ];
  const reuse = await readGalleryReuse({
    kind: "video",
    id: "video-work",
    scope,
  });
  expect(reuse).toMatchObject({
    prompt: "Original waves",
    model: "legacy-video@Custom",
    incomplete: true,
    images: [],
    files: [],
    config: {
      videoConfig: {
        mode: "image-to-video",
        duration: 5,
        size: "480x854",
        aspectRatio: "9:16",
        resolution: "480p",
      },
    },
  });
  expect(reuse.config.videoConfig?.customParams).toBeUndefined();
  expect(reuse.images).not.toContain(otherDraft.materials[0].url);
});

test("image reuse restores saved configuration, references and source without output media", async () => {
  const config: ImageGenerationConfig = {
    providerName: "Custom",
    size: "9:16",
    resolution: "2k",
    quality: "high",
    style: "natural",
    imageOutputFormat: "webp",
    imageBackground: "opaque",
    imageOutputCompression: 70,
    imageResponseFormat: "b64_json",
    imageRequestMode: "async",
    imageStream: true,
    imagePartialImages: 3,
  };
  const stored = image({
    config,
    references: ["https://input.test/original.png"],
    sourceWorkId: "image-source",
  });
  getImageMetadata.mockResolvedValue(stored);
  const reuse = await readGalleryReuse({
    kind: "image",
    id: "image-work",
    scope,
  });
  expect(getImageMetadata).toHaveBeenCalledWith("image-work", "user-7");
  expect(reuse).toEqual({
    prompt: stored.prompt,
    model: stored.model,
    config,
    images: ["https://input.test/original.png"],
    files: [],
    sourceWorkId: "image-source",
    incomplete: false,
  });
  reuse.config.quality = "low";
  reuse.images[0] = "Changed input";
  expect(stored.config?.quality).toBe("high");
  expect(stored.references).toEqual(["https://input.test/original.png"]);
  expect(loadDraft).not.toHaveBeenCalled();
  expect(attachmentRead).not.toHaveBeenCalled();
});

test("legacy numbered image IDs recover the original assistant's saved generation", async () => {
  const config: ImageGenerationConfig = {
    providerName: "OriginalProvider",
    size: "3:2",
    quality: "high",
  };
  sessions = [
    {
      messages: [
        {
          id: "original-answer",
          role: "assistant",
          content: "Generated",
          date: "2026-11-09",
          generation: {
            prompt: "Original input",
            model: "original-image@OriginalProvider",
            references: ["https://input.test/original.png"],
            sourceWorkId: "old-source",
            config,
          },
        },
      ],
    },
  ];
  getImageMetadata.mockResolvedValue(
    image({
      id: "original-answer-2",
      model: "",
      references: undefined,
      config: undefined,
    }),
  );
  const reuse = await readGalleryReuse({
    kind: "image",
    id: "original-answer-2",
    scope,
  });
  expect(reuse).toMatchObject({
    model: "original-image@OriginalProvider",
    config: { providerName: "OriginalProvider", size: "3:2", quality: "high" },
    images: ["https://input.test/original.png"],
    sourceWorkId: "old-source",
    incomplete: false,
  });
});

function deferredImageSource() {
  return {
    id: "historical-chat",
    messages: [
      {
        id: "historical-answer",
        role: "assistant",
        content: "Generated",
        date: "2026-11-09",
        generation: {
          prompt: "Historical input",
          model: "gpt-image-2@OriginalProvider",
          config: { providerName: "OriginalProvider", quality: "high" },
          references: [
            { __octopusChatAsset: "historical-reference" },
          ] as unknown as string[],
          sourceWorkId: "historical-work",
        },
      } as ChatMessage,
    ],
  };
}

test("legacy image reuse restores an inactive session's reference assets without selecting or changing it", async () => {
  const source = deferredImageSource();
  sessions = [{ id: "current-chat", messages: [] }, source];
  const before = JSON.parse(JSON.stringify(source));
  const reference = "data:" + "image/png;base64,AAAA";
  attachmentRead.mockResolvedValue(reference);
  getImageMetadata.mockResolvedValue(
    image({
      id: "historical-answer-0",
      config: undefined,
      references: undefined,
      model: "",
    }),
  );
  const reuse = await readGalleryReuse({
    kind: "image",
    id: "historical-answer-0",
    scope,
  });
  expect(reuse).toMatchObject({
    model: "gpt-image-2@OriginalProvider",
    config: { providerName: "OriginalProvider", quality: "high" },
    images: [reference],
    sourceWorkId: "historical-work",
    incomplete: false,
  });
  expect(attachmentRead).toHaveBeenCalledWith(
    "octopus:user-7:chat-next-web-store:asset:historical-reference",
    expect.any(Function),
  );
  expect(source).toEqual(before);
  expect(sessions[0].id).toBe("current-chat");
});

test("image reuse rejects a workspace change while restoring historical reference assets", async () => {
  const source = deferredImageSource();
  sessions = [{ id: "current-chat", messages: [] }, source];
  const before = JSON.parse(JSON.stringify(source));
  const started = deferred<void>();
  const loaded = deferred<unknown>();
  attachmentRead.mockImplementationOnce(() => {
    started.resolve();
    return loaded.promise;
  });
  getImageMetadata.mockResolvedValue(
    image({
      id: "historical-answer-0",
      config: undefined,
      references: undefined,
    }),
  );
  const request = readGalleryReuse({
    kind: "image",
    id: "historical-answer-0",
    scope,
  });
  const rejected = expect(request).rejects.toThrow("账号已变化");
  await started.promise;
  scope = "user-8";
  loaded.resolve("data:" + "image/png;base64,AAAA");
  await rejected;
  expect(source).toEqual(before);
});

test("explicit empty references and a new source override historical generation metadata", async () => {
  sessions = [
    {
      messages: [
        {
          id: "image-work",
          role: "assistant",
          content: "Generated",
          date: "2026-11-09",
          generation: {
            prompt: "Old input",
            model: "old-model",
            references: ["https://input.test/old.png"],
            sourceWorkId: "old-source",
            config: { quality: "low" },
          },
        },
      ],
    },
  ];
  getImageMetadata.mockResolvedValue(
    image({
      references: [],
      sourceWorkId: "new-source",
      config: { quality: "high" },
    }),
  );
  const reuse = await readGalleryReuse({
    kind: "image",
    id: "image-work",
    scope,
  });
  expect(reuse).toMatchObject({
    config: { quality: "high" },
    images: [],
    sourceWorkId: "new-source",
    incomplete: false,
  });
});

test("legacy images keep their model provider, infer the recorded ratio and report missing settings", async () => {
  getImageMetadata.mockResolvedValue(
    image({
      model: "legacy-image@OriginalProvider",
      width: 900,
      height: 1600,
    }),
  );
  const reuse = await readGalleryReuse({
    kind: "image",
    id: "image-work",
    scope,
  });
  expect(reuse).toMatchObject({
    model: "legacy-image@OriginalProvider",
    config: { size: "9:16", quality: "auto" },
    images: [],
    files: [],
    incomplete: true,
  });
  expect(reuse.config).not.toHaveProperty("providerName");
  expect(reuse.config).not.toHaveProperty("videoConfig");
});

test.each(["image", "video"] as const)(
  "%s missing records report the unavailable work",
  async (kind) => {
    await expect(
      readGalleryReuse({ kind, id: "missing", scope }),
    ).rejects.toThrow(
      kind === "image" ? "图片记录已不可用" : "视频记录已不可用",
    );
  },
);

test.each(["image", "video"] as const)(
  "%s rejects another account before reading storage",
  async (kind) => {
    await expect(
      readGalleryReuse({ kind, id: "work", scope: "user-8" }),
    ).rejects.toThrow("账号已变化");
    expect(getImageMetadata).not.toHaveBeenCalled();
    expect(loadDraft).not.toHaveBeenCalled();
  },
);

test.each([
  ["image", "scope"],
  ["image", "inactive"],
  ["video", "scope"],
  ["video", "inactive"],
] as const)(
  "%s discards a late work after the workspace becomes %s",
  async (kind, change) => {
    const pending = deferred<void>();
    const started = deferred<void>();
    if (kind === "video") {
      results = [
        video({
          request: videoDraft({ model: "sora-2", prompt: "Late request" }),
        }),
      ];
      loadDraft.mockImplementationOnce(() => {
        started.resolve();
        return pending.promise;
      });
    } else {
      getImageMetadata.mockImplementationOnce(async () => {
        started.resolve();
        await pending.promise;
        return image({ config: { quality: "high" } });
      });
    }
    const request = readGalleryReuse({
      kind,
      id: kind === "image" ? "image-work" : "video-work",
      scope,
    });
    const rejected = expect(request).rejects.toThrow("账号已变化");
    await started.promise;
    if (change === "scope") scope = "user-8";
    else active = false;
    pending.resolve();
    await rejected;
  },
);
