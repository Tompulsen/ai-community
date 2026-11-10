import { jest } from "@jest/globals";
import { getResponseMetrics } from "../app/utils/chat-response-metrics";
import { readMessageQuote } from "../app/utils/message-quote";
import { createMemoryKeyvalStore } from "./mocks/memory-keyval-store";
import type { VideoDraft, VideoResult } from "../app/store/video";

const storage = new Map<string, unknown>();
const transactions = createMemoryKeyvalStore(storage);
const storageReads = jest.fn<(key: string) => Promise<unknown>>();
let paused = false;
let storedImages: { id: string }[] = [];
const imageWrites = jest.fn<(...args: any[]) => Promise<void>>(async () => {});
jest.unstable_mockModule("idb-keyval", () => ({
  get: storageReads,
  set: async (key: string, value: unknown) => {
    storage.set(key, value);
  },
  setMany: async (entries: [string, unknown][]) => {
    for (const [key, value] of entries) storage.set(key, value);
  },
  createStore: () => transactions,
  del: async (key: string) => storage.delete(key),
  delMany: async (keys: string[]) => {
    for (const key of keys) storage.delete(key);
  },
  clear: async () => storage.clear(),
}));
jest.unstable_mockModule("@/app/utils", () => ({
  safeLocalStorage: () => localStorage,
}));
jest.unstable_mockModule("@/app/store/gallery", () => ({
  addImage: imageWrites,
  getAllImages: async () => storedImages,
  getImageBlob: jest.fn(),
  releaseGalleryImages: () => {},
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  initializeLocalWorkspace: async () => "user-7",
  getLocalScope: () => "user-7",
  getLocalTokenId: () => 10,
  isLocalWorkspaceActive: () => !paused,
  persistLocalWrite: async <T>(write: () => Promise<T>) => write(),
  flushLocalWrites: async () => {},
  localKey: (key: string, owner = "user-7") =>
    owner === "legacy" ? key : `octopus:${owner}:${key}`,
  beginLocalMaintenance: async () => {
    paused = true;
  },
  endLocalMaintenance: (untilReload = false) => {
    paused = untilReload;
  },
}));
jest.unstable_mockModule("@/app/client/controller", () => ({
  ChatControllerPool: { stopAll: jest.fn() },
}));
jest.unstable_mockModule("@/app/store/mask", () => ({
  createEmptyMask: () => ({
    id: "default",
    name: "Default",
    context: [],
    modelConfig: { model: "gpt-4o", temperature: 0.7 },
  }),
}));
const {
  backupSchema,
  createLocalBackup,
  importLocalBackup,
  parseLocalBackup,
  readLocalState,
} = await import("../app/utils/local-backup");
const { readVideoResults, writeVideoResults } = await import(
  "../app/store/video"
);
const { StoreKey } = await import("../app/constant");
const key = `octopus:user-7:${StoreKey.Chat}`;
const chat = {
  id: "chat-1",
  topic: "Private chat",
  memoryPrompt: "",
  messages: [{ id: "m-1", role: "user", content: "Hello", streaming: true }],
  mask: {
    id: "mask",
    name: "My mask",
    context: [],
    modelConfig: { model: "gpt-4o", apiKey: "secret-mask-key" },
  },
};
const backup = {
  format: "octopus-local-backup",
  version: 1,
  exportedAt: "2026-10-21",
  chats: [chat],
};

test("video backups preserve authenticated outputs and reject injected media paths", () => {
  const video = {
    id: "video",
    url: "https://chat.test/api/v1/videos/job/content",
    mediaPath: "videos/job/content",
    tokenId: 10,
    size: "2048x1080",
    aspectRatio: "7:4",
    resolution: "2160p",
    prompt: "Ocean",
    model: "sora-2",
    status: "success",
    galleryHidden: true,
    createdAt: 1,
  };
  const value = backupSchema.parse({ ...backup, videos: [video] });
  expect(value.videos?.[0]).toMatchObject(video);
  expect(
    backupSchema.safeParse({
      ...backup,
      videos: [{ ...video, mediaPath: "https://evil.test/steal" }],
    }).success,
  ).toBe(false);
});

test.each(["pending", "failed", "success"] as const)(
  "%s video requests round-trip through portable backups without large localStorage mirrors",
  async (status) => {
    const payload = `data:image/png;base64,${"A".repeat(1024 * 1024)}`;
    const request: VideoDraft = {
      apiFormat: "seedance",
      legacyCustomFormat: "seedance",
      model: "seedance-pro@OpenAI",
      mode: "reference-to-video",
      prompt: "Animate the reference with the original sound",
      negativePrompt: "Camera shake",
      aspectRatio: "9:16",
      resolution: "720p",
      size: "720x1280",
      duration: 6,
      count: 1,
      seed: "42",
      promptAdherence: 0.6,
      cameraMotion: 35,
      materials: [
        { id: "reference", name: "reference.png", type: "image", url: payload },
        {
          id: "motion",
          name: "motion.mp4",
          type: "video",
          url: "data:video/mp4;base64,AAAA",
        },
        {
          id: "sound",
          name: "sound.wav",
          type: "audio",
          url: "data:audio/wav;base64,AAAA",
        },
      ],
      referenceMode: "fusion",
      autoPlay: false,
      autoSaveGallery: false,
      confirmBeforeGenerate: true,
      draftAutoSave: true,
      protocolOptions: {
        openai: { seed: "11", generateAudio: true },
        xai: { seed: "22", generateAudio: false },
        seedance: { seed: "42", generateAudio: true },
        gemini: {
          seed: "33",
          generateAudio: true,
          personGeneration: "allow_adult",
        },
      },
      customParams: {
        openai: '{"duration":6}',
        xai: '{"resolution":"720p"}',
        seedance: '{"camera_fixed":true}',
        gemini: '{"parameters":{"sampleCount":1}}',
      },
      openaiReferenceSource: "upload",
      openaiImageUrl: "https://example.test/start.png",
      openaiFileId: "file-reference",
      openaiLastImageUrl: "https://example.test/end.png",
    };
    const result: VideoResult = {
      id: `video-${status}`,
      url:
        status === "success"
          ? "https://example.test/videos/provider-job/content"
          : "",
      prompt: request.prompt,
      model: "seedance-pro",
      mode: request.mode,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      duration: request.duration,
      size: request.size,
      status,
      createdAt: 10,
      tokenId: 10,
      customApiBase: "https://example.test/v1/",
      upstreamId: "provider-job",
      request,
      ...(status === "pending"
        ? { phase: "queued" as const, progress: 17 }
        : { completedAt: 50 }),
      ...(status === "failed"
        ? { error: "Provider rejected the request" }
        : {}),
    };
    const videoKey = "octopus:user-7:video-workspace-results";
    const { request: _request, ...metadata } = result;
    await writeVideoResults([result], "user-7");
    expect(JSON.parse(String(storage.get(videoKey)))).toMatchObject({
      version: 1,
      state: { _hasHydrated: true },
    });
    expect(String(storage.get(videoKey))).toContain("__octopusChatAsset");
    expect(String(storage.get(videoKey)).length).toBeLessThan(8000);
    expect(JSON.parse(localStorage.getItem(videoKey)!)).toEqual([metadata]);
    expect(localStorage.getItem(videoKey)!.length).toBeLessThan(2000);
    const exported = await createLocalBackup({
      chats: false,
      images: false,
      settings: false,
      videos: true,
    });
    const portable = parseLocalBackup(JSON.parse(JSON.stringify(exported)));
    expect(portable.videos).toEqual([result]);
    expect(JSON.stringify(portable)).not.toContain("__octopusChatAsset");
    storage.clear();
    localStorage.clear();
    await importLocalBackup(portable);
    expect(await readVideoResults("user-7")).toEqual([result]);
    expect(JSON.parse(localStorage.getItem(videoKey)!)).toEqual([metadata]);
    expect(String(storage.get(videoKey))).not.toContain(payload);
    expect(
      [...storage.keys()].filter((name) =>
        name.startsWith(`${videoKey}:asset:`),
      ),
    ).toHaveLength(1);
    const restored = await createLocalBackup({
      chats: false,
      images: false,
      settings: false,
      videos: true,
    });
    expect(restored.videos).toEqual(portable.videos);
  },
);

test("video thumbnails survive scoped snapshot reloads without filling the compatibility mirror", async () => {
  const coverUrl = "data:image/jpeg;base64," + "A".repeat(96 * 1024);
  const result: VideoResult = {
    id: "video-with-thumbnail",
    url: "https://example.test/video.mp4",
    coverUrl,
    prompt: "A saved video",
    model: "video-model",
    status: "success",
    createdAt: 1,
  };
  await writeVideoResults([result], "user-7");
  expect(await readVideoResults("user-7")).toEqual([result]);
  expect(await readVideoResults("user-8")).toEqual([]);
  const mirrored = localStorage.getItem(
    "octopus:user-7:video-workspace-results",
  )!;
  expect(JSON.parse(mirrored)).toEqual([
    {
      id: result.id,
      url: result.url,
      prompt: result.prompt,
      model: result.model,
      status: result.status,
      createdAt: result.createdAt,
    },
  ]);
  expect(mirrored.length).toBeLessThan(1000);
});

test("legacy successful video arrays remain readable and restore to the new snapshot wrapper", async () => {
  const videoKey = "octopus:user-7:video-workspace-results";
  const legacy: VideoResult = {
    id: "legacy-video",
    url: "https://example.test/legacy.mp4",
    prompt: "Ocean",
    model: "sora-2",
    aspectRatio: "16:9",
    resolution: "1080p",
    duration: 8,
    status: "success",
    createdAt: 1,
  };
  localStorage.setItem(videoKey, JSON.stringify([legacy]));
  expect(await readVideoResults("user-7")).toEqual([legacy]);
  const exported = await createLocalBackup({
    chats: false,
    images: false,
    settings: false,
    videos: true,
  });
  expect(exported.videos).toEqual([legacy]);
  storage.clear();
  localStorage.clear();
  await importLocalBackup(JSON.parse(JSON.stringify(exported)));
  expect(JSON.parse(String(storage.get(videoKey)))).toMatchObject({
    version: 1,
    state: { results: [legacy], _hasHydrated: true },
  });
  expect(await readVideoResults("user-7")).toEqual([legacy]);
});

test("reasoning and answer branches survive backup export and copy import", async () => {
  const source = {
    ...chat,
    messages: [
      { id: "question", role: "user", content: "Question", branchOrder: 0 },
      {
        id: "answer-2",
        role: "assistant",
        content: "Second answer",
        reasoning: "Second reasoning",
        parentId: "question",
        branchOrder: 2,
      },
    ],
    messageBranches: [
      {
        id: "answer-1",
        role: "assistant",
        content: "First answer",
        reasoning: "First reasoning",
        parentId: "question",
        branchOrder: 1,
        tools: [
          {
            id: "lookup",
            clientId: "mcp-client",
            function: { name: "lookup", arguments: '{"query":"source"}' },
            content: '{"result":"source"}',
            isError: false,
          },
        ],
      },
      {
        id: "follow-up",
        role: "user",
        content: "Continue first",
        parentId: "answer-1",
        branchOrder: 3,
      },
    ],
    branchSelections: {
      __root__: "question",
      question: "answer-2",
      "answer-1": "follow-up",
    },
  };
  storage.set(key, JSON.stringify({ state: { sessions: [source] } }));
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  expect(exported.chats?.[0].messageBranches?.[0]).toMatchObject({
    reasoning: "First reasoning",
    parentId: "question",
    tools: [{ clientId: "mcp-client", isError: false }],
  });
  await importLocalBackup(exported, true);
  const saved = await readLocalState(StoreKey.Chat, "user-7");
  const copy = saved.state.sessions.find((item: any) => item.id !== source.id);
  const nodes = [...copy.messages, ...copy.messageBranches];
  const ids = new Set(nodes.map((item: any) => item.id));
  expect(copy.messages[0].id).not.toBe("question");
  expect(copy.messages[1].parentId).toBe(copy.messages[0].id);
  expect(
    nodes.every((item: any) => !item.parentId || ids.has(item.parentId)),
  ).toBe(true);
  expect(Object.values(copy.branchSelections).every((id) => ids.has(id))).toBe(
    true,
  );
  expect(copy.messageBranches[0].reasoning).toBe("First reasoning");
  expect(copy.branchSelections[copy.messageBranches[0].id]).toBe(
    copy.messageBranches[1].id,
  );
});

test("chat export and restoration retain reusable quotes and response statistics", async () => {
  const quote = {
    messageId: "quoted-answer",
    role: "assistant",
    text: "  First quoted line\nSecond quoted line  ",
  };
  const metrics = {
    usage: { inputTokens: 1000, outputTokens: 84, cachedInputTokens: 994 },
    generationDurationMs: 2000,
  };
  const source = {
    ...chat,
    messages: [
      { id: "question", role: "user", content: "Explain the result" },
      {
        id: quote.messageId,
        role: "assistant",
        content: quote.text,
        responseMetrics: metrics,
      },
      {
        id: "quoted-follow-up",
        role: "user",
        content: `引用内容：\n> ${quote.text}\n\nExplain this part`,
        composerInput: {
          text: "Explain this part",
          files: [],
          quote,
        },
      },
    ],
  };
  storage.set(key, JSON.stringify({ state: { sessions: [source] } }));
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  const portable = JSON.parse(JSON.stringify(exported));
  expect(
    parseLocalBackup(portable).chats?.[0].messages[1].responseMetrics,
  ).toEqual(metrics);
  expect(
    parseLocalBackup(portable).chats?.[0].messages[2].composerInput?.quote,
  ).toEqual(quote);
  storage.clear();
  await importLocalBackup(portable);
  let saved = (await readLocalState(StoreKey.Chat, "user-7")).state.sessions;
  expect(readMessageQuote(saved[0].messages[2].composerInput.quote)).toEqual(
    quote,
  );
  expect(saved[0].messages[1].responseMetrics).toEqual(metrics);
  expect(getResponseMetrics(saved[0].messages)).toMatchObject({
    outputTokensPerSecond: 42,
    cacheHitPercent: 99.4,
    pending: false,
  });

  await importLocalBackup(portable, true);
  saved = (await readLocalState(StoreKey.Chat, "user-7")).state.sessions;
  const copy = saved.find((session: any) => session.id !== source.id);
  expect(copy.messages[1].id).not.toBe(quote.messageId);
  expect(readMessageQuote(copy.messages[2].composerInput.quote)).toEqual({
    ...quote,
    messageId: copy.messages[1].id,
  });
  expect(copy.messages[1].responseMetrics).toEqual(metrics);
  expect(getResponseMetrics(copy.messages)).toMatchObject({
    outputTokensPerSecond: 42,
    cacheHitPercent: 99.4,
    pending: false,
  });
});

test("legacy request duration survives restoration without becoming generation speed", async () => {
  const metrics = {
    usage: { inputTokens: 1000, outputTokens: 84, cachedInputTokens: 994 },
    durationMs: 2000,
  };
  storage.set(
    key,
    JSON.stringify({
      state: {
        sessions: [
          {
            ...chat,
            messages: [
              {
                id: "legacy-answer",
                role: "assistant",
                content: "Previously measured answer",
                responseMetrics: metrics,
              },
            ],
          },
        ],
      },
    }),
  );
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  const portable = JSON.parse(JSON.stringify(exported));
  expect(
    parseLocalBackup(portable).chats?.[0].messages[0].responseMetrics,
  ).toEqual(metrics);
  storage.clear();
  await importLocalBackup(portable);
  const messages = (await readLocalState(StoreKey.Chat, "user-7")).state
    .sessions[0].messages;
  expect(messages[0].responseMetrics).toEqual(metrics);
  expect(getResponseMetrics(messages)).toEqual({
    outputTokensPerSecond: undefined,
    cacheHitPercent: 99.4,
    pending: false,
  });
});

test("completed estimates survive backup while transient stream progress is omitted", async () => {
  const metrics = {
    usage: {},
    generationDurationMs: 2000,
    estimatedOutputTokens: 60,
  };
  const source = {
    ...chat,
    messages: [
      {
        id: "estimated-answer",
        role: "assistant",
        content: "Locally estimated output",
        responseMetrics: metrics,
        generationProgress: { outputTokens: 999, durationMs: 100 },
      },
    ],
  };
  storage.set(key, JSON.stringify({ state: { sessions: [source] } }));
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  const portable = parseLocalBackup(JSON.parse(JSON.stringify(exported)));
  expect(portable.chats?.[0].messages[0].responseMetrics).toEqual(metrics);
  expect(portable.chats?.[0].messages[0]).not.toHaveProperty(
    "generationProgress",
  );
  storage.clear();
  await importLocalBackup(portable);
  const messages = (await readLocalState(StoreKey.Chat, "user-7")).state
    .sessions[0].messages;
  expect(getResponseMetrics(messages)).toMatchObject({
    outputTokensPerSecond: 30,
    speedIsEstimated: true,
  });
});

test("completed compression records survive backup and copied conversation import", async () => {
  const source = {
    ...chat,
    messages: [
      {
        id: "compressed-answer",
        role: "assistant",
        content: "Answer with the retained context",
        contextCompressed: true,
        contextCompressing: true,
      },
    ],
  };
  storage.set(key, JSON.stringify({ state: { sessions: [source] } }));
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  const portable = parseLocalBackup(JSON.parse(JSON.stringify(exported)));
  expect(portable.chats?.[0].messages[0]).toMatchObject({
    content: source.messages[0].content,
    contextCompressed: true,
  });
  expect(portable.chats?.[0].messages[0]).not.toHaveProperty(
    "contextCompressing",
  );
  await importLocalBackup(portable, true);
  const sessions = (await readLocalState(StoreKey.Chat, "user-7")).state
    .sessions;
  const copied = sessions.find((item: { id: string }) => item.id !== source.id);
  expect(copied.messages[0].contextCompressed).toBe(true);
  expect(copied.messages[0].id).not.toBe(source.messages[0].id);
});

test.each<[string, Record<string, unknown>]>([
  ["invalid compression record", { contextCompressed: "true" }],
  ["negative tokens", { responseMetrics: { usage: { outputTokens: -1 } } }],
  [
    "unsafe tokens",
    {
      responseMetrics: { usage: { inputTokens: Number.MAX_SAFE_INTEGER + 1 } },
    },
  ],
  [
    "excess cache usage",
    { responseMetrics: { usage: { inputTokens: 10, cachedInputTokens: 11 } } },
  ],
  ["negative duration", { responseMetrics: { usage: {}, durationMs: -1 } }],
  [
    "nonfinite duration",
    { responseMetrics: { usage: {}, durationMs: Infinity } },
  ],
  [
    "negative generation duration",
    { responseMetrics: { usage: {}, generationDurationMs: -1 } },
  ],
  [
    "nonfinite generation duration",
    { responseMetrics: { usage: {}, generationDurationMs: Infinity } },
  ],
  [
    "negative estimated tokens",
    { responseMetrics: { usage: {}, estimatedOutputTokens: -1 } },
  ],
  ...[
    { messageId: "", role: "assistant", text: "Quote" },
    { messageId: "answer", role: "tool", text: "Quote" },
    { messageId: "answer", role: "assistant", text: " \n " },
  ].map((quote): [string, Record<string, unknown>] => [
    `invalid quote ${JSON.stringify(quote)}`,
    { composerInput: { text: "Follow up", files: [], quote } },
  ]),
])("backup rejects %s before writing restored state", async (_, metadata) => {
  await expect(
    importLocalBackup({
      ...backup,
      chats: [
        {
          ...chat,
          messages: [
            { id: "answer", role: "assistant", content: "Answer", ...metadata },
          ],
        },
      ],
    }),
  ).rejects.toThrow(/备份/);
  expect(storage.has(key)).toBe(false);
  expect(paused).toBe(false);
});

test("Ultra reasoning survives local backup parsing and import", async () => {
  const input = {
    ...backup,
    settings: { modelConfig: { reasoningEffort: "ultra" } },
  };
  expect(parseLocalBackup(input).settings?.modelConfig?.reasoningEffort).toBe(
    "ultra",
  );
  await importLocalBackup(input);
  const saved = JSON.parse(storage.get(StoreKey.Config) as string);
  expect(saved.state.modelConfig.reasoningEffort).toBe("ultra");
});

const legacyBackup = {
  version: 1,
  timestamp: "2026-10-31T12:00:00.000Z",
  config: {
    avatar: "1f603",
    fontSize: 18,
    fontFamily: "Arial",
    theme: "dark",
    submitKey: "Ctrl + Enter",
    customModels: "custom-chat,custom-image",
    modelConfig: {
      model: "custom-chat",
      providerName: "OpenAI",
      max_tokens: 102400,
      stream: false,
      reasoningEffort: "high",
      stop: "END",
      contextBudget: 32768,
      compressModel: "summary-model",
      compressProviderName: "OpenAI",
      compressMessageLengthThreshold: 12000,
      apiKey: "incoming-model-key",
      ["__proto__"]: { polluted: true },
    },
    openaiApiKey: "incoming-config-key",
    ["__proto__"]: { polluted: true },
    constructor: { prototype: { polluted: true } },
  },
  access: {
    openaiUrl: "https://custom.example.com/v1",
    openaiApiKey: "incoming-access-key",
    accessToken: "incoming-account-token",
  },
};

const skill = {
  id: "translation",
  name: "Translation",
  description: "Translate",
  category: "translation",
  kind: "prompt",
  version: "1.0.0",
  sha256: "0".repeat(64),
  documentUrl:
    "https://raw.githubusercontent.com/example/repo/main/translation/SKILL.md",
  sourceUrl: "https://github.com/example/repo",
  license: "MIT",
  body: "Translate faithfully",
  installedAt: 10,
};

test("settings backup preserves account scoped installed skills and conversation selection", async () => {
  storage.set(
    key,
    JSON.stringify({
      state: { sessions: [{ ...chat, activeSkillId: "translation" }] },
    }),
  );
  storage.set(
    `octopus:user-7:${StoreKey.Skills}`,
    JSON.stringify({ state: { installed: { translation: skill } } }),
  );
  storage.set(
    StoreKey.Skills,
    JSON.stringify({
      state: { installed: { other: { ...skill, id: "other" } } },
    }),
  );
  const result = await createLocalBackup({
    chats: true,
    images: false,
    settings: true,
  });
  expect(result.chats?.[0].activeSkillId).toBe("translation");
  expect(result.skills).toEqual({ translation: { ...skill, enabled: true } });
  const chatsOnly = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  expect(chatsOnly.skills).toBeUndefined();
});

test("skill import preserves installed versions and rejects mismatched IDs", async () => {
  const installed = {
    ...skill,
    body: "Existing local version",
    installedAt: 20,
  };
  const skillsKey = `octopus:user-7:${StoreKey.Skills}`;
  storage.set(
    skillsKey,
    JSON.stringify({ state: { installed: { translation: installed } } }),
  );
  await importLocalBackup({
    ...backup,
    skills: { translation: skill, another: { ...skill, id: "another" } },
  });
  const result = JSON.parse(storage.get(skillsKey) as string);
  expect(result.state.installed.translation).toEqual({
    ...installed,
    enabled: true,
  });
  expect(result.state.installed.another.id).toBe("another");
  expect(() =>
    backupSchema.parse({ ...backup, skills: { wrong: skill } }),
  ).toThrow();
  expect(() =>
    backupSchema.parse({
      ...backup,
      skills: { translation: { ...skill, body: "x".repeat(32001) } },
    }),
  ).toThrow();
});

test("settings export includes only current-account model type corrections", async () => {
  const accountModel = JSON.stringify(["account", 100, "my-model"]);
  storage.set(
    `octopus:user-7:${StoreKey.ModelPreferences}`,
    JSON.stringify({
      state: {
        overrides: { [accountModel]: "image" },
        apiFormats: { [accountModel]: "gemini" },
      },
    }),
  );
  storage.set(
    `octopus:user-8:${StoreKey.ModelPreferences}`,
    JSON.stringify({
      state: {
        overrides: { [accountModel]: "video" },
        apiFormats: { [accountModel]: "responses" },
      },
    }),
  );
  const exported = await createLocalBackup({
    chats: false,
    images: false,
    settings: true,
  });
  expect(exported.modelTypes).toEqual({ [accountModel]: "image" });
  expect(exported.modelApiFormats).toEqual({ [accountModel]: "gemini" });
  storage.set(key, JSON.stringify({ state: { sessions: [chat] } }));
  const chatsOnly = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  expect(chatsOnly.modelTypes).toBeUndefined();
  expect(chatsOnly.modelApiFormats).toBeUndefined();
});

test("model-only backup imports corrections without overriding current choices", async () => {
  const existing = JSON.stringify(["account", 100, "same-model"]);
  const incoming = JSON.stringify([
    "custom",
    "https://custom.example.test/v1/",
    "same-model",
  ]);
  const target = `octopus:user-7:${StoreKey.ModelPreferences}`;
  storage.set(
    target,
    JSON.stringify({
      state: {
        overrides: { [existing]: "chat" },
        apiFormats: { [existing]: "gemini" },
      },
    }),
  );
  const modelBackup = {
    format: "octopus-local-backup",
    version: 1,
    exportedAt: "2026-11-01",
    modelTypes: { [existing]: "image", [incoming]: "video" },
  };
  await importLocalBackup(modelBackup);
  const stored = JSON.parse(storage.get(target) as string);
  expect(stored.state.overrides).toEqual({
    [existing]: "chat",
    [incoming]: "video",
  });
  expect(stored.state.apiFormats).toEqual({ [existing]: "gemini" });
  expect(stored.version).toBe(1);
  expect(storage.has(`octopus:user-8:${StoreKey.ModelPreferences}`)).toBe(
    false,
  );
  expect(parseLocalBackup(backup).modelTypes).toBeUndefined();
  expect(parseLocalBackup(backup).modelApiFormats).toBeUndefined();
});

test("protocol-only backups preserve model types and existing protocol choices", async () => {
  const existing = JSON.stringify(["account", 100, "same-model"]);
  const incoming = JSON.stringify([
    "custom",
    "https://custom.example.test/v1",
    "same-model",
  ]);
  const target = `octopus:user-7:${StoreKey.ModelPreferences}`;
  storage.set(
    target,
    JSON.stringify({
      state: {
        overrides: { [existing]: "chat" },
        apiFormats: { [existing]: "gemini" },
      },
    }),
  );
  await importLocalBackup({
    format: "octopus-local-backup",
    version: 1,
    exportedAt: "2026-11-02",
    modelApiFormats: { [existing]: "claude", [incoming]: "responses" },
  });
  const stored = JSON.parse(storage.get(target) as string);
  expect(stored.state.overrides).toEqual({ [existing]: "chat" });
  expect(stored.state.apiFormats).toEqual({
    [existing]: "gemini",
    [incoming]: "responses",
  });
  expect(storage.has(`octopus:user-8:${StoreKey.ModelPreferences}`)).toBe(
    false,
  );
});

test("a shared model settings backup restores types and protocols together", async () => {
  const model = JSON.stringify(["account", 100, "gemini-alias"]);
  await importLocalBackup({
    format: "octopus-local-backup",
    version: 1,
    exportedAt: "2026-11-02",
    modelTypes: { [model]: "chat" },
    modelApiFormats: { [model]: "gemini" },
  });
  const stored = JSON.parse(
    storage.get(`octopus:user-7:${StoreKey.ModelPreferences}`) as string,
  );
  expect(stored.state).toMatchObject({
    overrides: { [model]: "chat" },
    apiFormats: { [model]: "gemini" },
  });
});

test("backup rejects unsupported protocols and secret-bearing protocol identities before writes", async () => {
  const model = JSON.stringify(["account", 100, "model"]);
  for (const modelApiFormats of [
    { [model]: "auto" },
    { [model]: "unknown-format" },
    { '["custom","https://example.test/v1?key=private","model"]': "gemini" },
  ]) {
    await expect(
      importLocalBackup({ ...backup, modelApiFormats }),
    ).rejects.toThrow();
    expect(storage.size).toBe(0);
    expect(imageWrites).not.toHaveBeenCalled();
  }
});

test("backup rejects model type keys containing API secrets", () => {
  expect(() =>
    parseLocalBackup({
      ...backup,
      modelTypes: {
        '["custom","https://example.test/v1?key=private","model"]': "image",
      },
    }),
  ).toThrow();
});

test("excessive combined model settings reject an import before writing other sections", async () => {
  const overrides = (offset: number) =>
    Object.fromEntries(
      Array.from({ length: 1500 }, (_, index) => [
        JSON.stringify(["account", 100, `model-${offset + index}`]),
        "image",
      ]),
    );
  const target = `octopus:user-7:${StoreKey.ModelPreferences}`;
  const original = JSON.stringify({
    state: { overrides: overrides(0) },
  });
  storage.set(target, original);
  await expect(
    importLocalBackup({
      ...backup,
      settings: { theme: "dark" },
      modelTypes: overrides(1500),
    }),
  ).rejects.toThrow("2000");
  expect(storage.get(target)).toBe(original);
  expect(storage.has(StoreKey.Config)).toBe(false);
  expect(storage.has(key)).toBe(false);
  expect(imageWrites).not.toHaveBeenCalled();
  expect(paused).toBe(false);
});

test("excessive combined protocol settings reject before changing types or other sections", async () => {
  const formats = (offset: number) =>
    Object.fromEntries(
      Array.from({ length: 1500 }, (_, index) => [
        JSON.stringify(["account", 100, `model-${offset + index}`]),
        "gemini",
      ]),
    );
  const target = `octopus:user-7:${StoreKey.ModelPreferences}`;
  const original = JSON.stringify({
    state: {
      overrides: { [JSON.stringify(["account", 100, "old-model"])]: "chat" },
      apiFormats: formats(0),
    },
  });
  storage.set(target, original);
  await expect(
    importLocalBackup({
      ...backup,
      settings: { theme: "dark" },
      modelTypes: { [JSON.stringify(["account", 100, "new-model"])]: "image" },
      modelApiFormats: formats(1500),
    }),
  ).rejects.toThrow("2000");
  expect(storage.get(target)).toBe(original);
  expect(storage.has(StoreKey.Config)).toBe(false);
  expect(storage.has(key)).toBe(false);
  expect(paused).toBe(false);
});

beforeEach(() => {
  storage.clear();
  localStorage.clear();
  storageReads
    .mockReset()
    .mockImplementation(async (key: string) => storage.get(key));
  paused = false;
  storedImages = [];
  imageWrites.mockClear();
});

test("the parser round-trips current backups and strips unknown credentials", () => {
  const current = backupSchema.parse({
    ...backup,
    settings: {
      theme: "dark",
      customModels: "custom-chat",
      openaiUrl: "https://custom.example.com/v1",
      modelConfig: { model: "custom-chat", stream: false },
    },
  });
  expect(parseLocalBackup(JSON.parse(JSON.stringify(current)))).toEqual(
    current,
  );
  expect(JSON.stringify(parseLocalBackup(backup))).not.toContain(
    "secret-mask-key",
  );
});

test("empty collections remain importable when settings contain usable values", async () => {
  const current = {
    format: "octopus-local-backup",
    version: 1,
    exportedAt: "2026-10-31",
    chats: [],
    images: [],
    videos: [],
    skills: {},
    settings: { reduceMotion: false, modelConfig: {} },
  };
  expect(parseLocalBackup(current).settings?.reduceMotion).toBe(false);
  await importLocalBackup(current);
  expect(
    JSON.parse(storage.get(StoreKey.Config) as string).state.reduceMotion,
  ).toBe(false);
});

test.each([
  [true, "reduced"],
  [false, "system"],
] as const)(
  "legacy reduceMotion=%s replaces a local full-motion override with %s",
  async (reduceMotion, motionPreference) => {
    storage.set(
      StoreKey.Config,
      JSON.stringify({
        state: { motionPreference: "full", reduceMotion: false },
      }),
    );
    await importLocalBackup({
      ...legacyBackup,
      config: { reduceMotion },
      access: undefined,
    });
    expect(
      JSON.parse(storage.get(StoreKey.Config) as string).state,
    ).toMatchObject({ motionPreference, reduceMotion });
  },
);

test.each([
  ["system", true, false],
  ["full", true, false],
  ["reduced", false, true],
] as const)(
  "an imported %s preference takes priority over legacy reduceMotion=%s",
  async (motionPreference, legacy, reduceMotion) => {
    await importLocalBackup({
      ...backup,
      settings: { motionPreference, reduceMotion: legacy },
    });
    expect(
      JSON.parse(storage.get(StoreKey.Config) as string).state,
    ).toMatchObject({ motionPreference, reduceMotion });
  },
);

test.each(["system", "full", "reduced"] as const)(
  "settings export and enum-only import preserve the %s motion preference",
  async (motionPreference) => {
    storage.set(
      StoreKey.Config,
      JSON.stringify({ state: { motionPreference } }),
    );
    const exported = await createLocalBackup({
      chats: false,
      images: false,
      settings: true,
    });
    expect(exported.settings?.motionPreference).toBe(motionPreference);
    storage.clear();
    await importLocalBackup(JSON.parse(JSON.stringify(exported)));
    expect(
      JSON.parse(storage.get(StoreKey.Config) as string).state,
    ).toMatchObject({
      motionPreference,
      reduceMotion: motionPreference === "reduced",
    });
  },
);

test("settings without motion fields retain the local motion preference", async () => {
  storage.set(
    StoreKey.Config,
    JSON.stringify({
      state: { theme: "light", motionPreference: "full", reduceMotion: false },
    }),
  );
  await importLocalBackup({ ...backup, settings: { theme: "dark" } });
  expect(
    JSON.parse(storage.get(StoreKey.Config) as string).state,
  ).toMatchObject({
    theme: "dark",
    motionPreference: "full",
    reduceMotion: false,
  });
});

test.each([
  { chats: false, images: false, settings: false },
  { chats: true, images: true, settings: false, videos: true },
  { chats: false, images: false, settings: true },
])("empty export scope %# produces a recoverable error", async (sections) => {
  await expect(createLocalBackup(sections)).rejects.toThrow(
    "所选范围暂无可导出的数据，请调整备份内容后重试。",
  );
});

test("the parser normalizes old configuration backups without credentials or prototypes", () => {
  const input = JSON.parse(JSON.stringify(legacyBackup));
  const result = parseLocalBackup(input);
  expect(result).toEqual({
    format: "octopus-local-backup",
    version: 1,
    exportedAt: legacyBackup.timestamp,
    settings: {
      avatar: "1f603",
      fontSize: 18,
      fontFamily: "Arial",
      theme: "dark",
      submitKey: "Ctrl + Enter",
      customModels: "custom-chat,custom-image",
      openaiUrl: "https://custom.example.com/v1",
      modelConfig: {
        model: "custom-chat",
        providerName: "OpenAI",
        max_tokens: 128000,
        stream: false,
        reasoningEffort: "high",
        stop: "END",
        compressionThreshold: 272000,
        contextBudget: 32768,
        compressModel: "summary-model",
        compressProviderName: "OpenAI",
        compressMessageLengthThreshold: 12000,
      },
    },
  });
  expect(input.config.modelConfig.max_tokens).toBe(102400);
  expect(JSON.stringify(result)).not.toMatch(
    /incoming-|__proto__|constructor|polluted/,
  );
  expect(Object.getPrototypeOf(result.settings)).toBe(Object.prototype);
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
});

test("old configuration import clears credentials when restoring a different endpoint for its owner", async () => {
  storage.set(
    StoreKey.Config,
    JSON.stringify({
      version: 4.4,
      state: {
        theme: "light",
        models: [],
        modelConfig: { temperature: 0.8, imageStream: true },
      },
    }),
  );
  const profileKey = "octopus:user-7:custom-provider";
  localStorage.setItem(
    profileKey,
    JSON.stringify({
      openaiUrl: "https://previous.example.com/v1",
      openaiApiKey: "existing-local-key",
      useCustomConfig: true,
    }),
  );
  const otherProfile = JSON.stringify({
    openaiUrl: "https://other.example.com/v1",
    openaiApiKey: "other-owner-key",
  });
  localStorage.setItem("octopus:other-user:custom-provider", otherProfile);
  await importLocalBackup(legacyBackup);
  const state = JSON.parse(storage.get(StoreKey.Config) as string).state;
  expect(state.theme).toBe("dark");
  expect(state.customModels).toBe("custom-chat,custom-image");
  expect(state.modelConfig).toMatchObject({
    model: "custom-chat",
    temperature: 0.8,
    imageStream: true,
    stream: false,
    reasoningEffort: "high",
    compressionThreshold: 272000,
  });
  expect(state.openaiUrl).toBeUndefined();
  expect(JSON.stringify(state)).not.toMatch(/incoming-|polluted/);
  expect(JSON.parse(localStorage.getItem(profileKey)!)).toEqual({
    openaiUrl: "https://custom.example.com/v1",
    openaiApiKey: "",
    useCustomConfig: false,
  });
  expect(localStorage.getItem("octopus:other-user:custom-provider")).toBe(
    otherProfile,
  );
  expect(storage.has(key)).toBe(false);
});

test.each(["https://previous.example.com/v1", "https://custom.example.com/v2"])(
  "current backup never forwards existing credentials to %s",
  async (openaiUrl) => {
    const profileKey = "octopus:user-7:custom-provider";
    localStorage.setItem(
      profileKey,
      JSON.stringify({
        openaiUrl: "https://custom.example.com/v1",
        openaiApiKey: "existing-local-key",
        useCustomConfig: true,
        customModelNames: "custom-chat",
      }),
    );

    await importLocalBackup({
      ...backup,
      settings: {
        openaiUrl,
        openaiApiKey: "incoming-settings-key",
        useCustomConfig: true,
      },
    });

    expect(JSON.parse(localStorage.getItem(profileKey)!)).toEqual({
      openaiUrl,
      openaiApiKey: "",
      useCustomConfig: false,
      customModelNames: "custom-chat",
    });
  },
);

test.each([true, false])(
  "same-endpoint import preserves its local key and enabled=%s",
  async (useCustomConfig) => {
    const profileKey = "octopus:user-7:custom-provider";
    localStorage.setItem(
      profileKey,
      JSON.stringify({
        openaiUrl: " https://custom.example.com/v1 ",
        openaiApiKey: "existing-local-key",
        useCustomConfig,
      }),
    );

    await importLocalBackup(legacyBackup);

    expect(JSON.parse(localStorage.getItem(profileKey)!)).toEqual({
      openaiUrl: "https://custom.example.com/v1",
      openaiApiKey: "existing-local-key",
      useCustomConfig,
    });
  },
);

test("import without an endpoint leaves the existing provider profile untouched", async () => {
  const profileKey = "octopus:user-7:custom-provider";
  const profile = JSON.stringify({
    openaiUrl: "https://custom.example.com/v1",
    openaiApiKey: "existing-local-key",
    useCustomConfig: true,
    customModelNames: "custom-chat",
  });
  localStorage.setItem(profileKey, profile);

  await importLocalBackup({
    ...backup,
    settings: {
      theme: "dark",
      openaiApiKey: "incoming-settings-key",
      useCustomConfig: false,
    },
  });

  expect(localStorage.getItem(profileKey)).toBe(profile);
});

test("configuration import creates a missing snapshot and preserves model defaults", async () => {
  await importLocalBackup({
    ...legacyBackup,
    config: { theme: "dark", modelConfig: { stream: false } },
    access: undefined,
  });
  const config = JSON.parse(storage.get(StoreKey.Config) as string);
  expect(config.version).toBe(4.4);
  expect(config.state.models).toEqual([]);
  expect(config.state.theme).toBe("dark");
  expect(config.state.modelConfig).toMatchObject({
    model: "gpt-4o",
    temperature: 0.7,
    stream: false,
  });
});

test.each([
  null,
  [],
  {},
  { ...legacyBackup, version: 2 },
  { ...legacyBackup, version: "1" },
  { ...legacyBackup, timestamp: "invalid-date" },
  { ...legacyBackup, config: {} },
  { ...legacyBackup, config: { modelConfig: { model: undefined } } },
  { ...legacyBackup, config: { arbitrary: true } },
  { ...legacyBackup, config: { modelConfig: { apiKey: "secret" } } },
  { ...legacyBackup, config: { fontSize: 80 } },
  { ...legacyBackup, config: { submitKey: "invalid" } },
  { ...legacyBackup, config: { motionPreference: "invalid" } },
  { ...backup, settings: { motionPreference: "invalid" } },
  { ...legacyBackup, format: "unrelated-backup" },
  {
    ...legacyBackup,
    access: { openaiUrl: "https://user:secret@example.com/v1" },
  },
  {
    ...legacyBackup,
    access: { openaiUrl: "https://example.com/v1?api_key=secret" },
  },
  { ...legacyBackup, access: { openaiUrl: "javascript:alert(1)" } },
  { ...backup, settings: { fontSize: 80 } },
  {
    format: "octopus-local-backup",
    version: 1,
    exportedAt: "2026-10-31",
  },
  {
    format: "octopus-local-backup",
    version: 1,
    exportedAt: "2026-10-31",
    chats: [],
    images: [],
    videos: [],
    skills: {},
    settings: {},
  },
  {
    format: "octopus-local-backup",
    version: 1,
    exportedAt: "2026-10-31",
    settings: { apiKey: "secret" },
  },
  {
    format: "octopus-local-backup",
    version: 1,
    exportedAt: "2026-10-31",
    settings: { modelConfig: { apiKey: "secret" } },
  },
  {
    format: "octopus-local-backup",
    version: 1,
    exportedAt: "2026-10-31",
    settings: { modelConfig: { model: undefined } },
  },
])("invalid backup %# is rejected before any local writes", async (input) => {
  expect(() => parseLocalBackup(input)).toThrow(/备份/);
  await expect(importLocalBackup(input)).rejects.toThrow(/备份/);
  expect(storage.size).toBe(0);
  expect(localStorage.length).toBe(0);
  expect(imageWrites).not.toHaveBeenCalled();
  expect(paused).toBe(false);
});

test("settings export keeps safe scoped endpoints and supported model fields without credentials", async () => {
  storage.set(
    StoreKey.Config,
    JSON.stringify({
      state: {
        customModels: "custom-chat",
        modelConfig: {
          stream: false,
          reasoningEffort: "high",
          stop: "END",
          compressionThreshold: 100000,
          contextBudget: 32768,
          compressModel: "summary-model",
          compressProviderName: "OpenAI",
          compressMessageLengthThreshold: 12000,
          apiKey: "config-secret",
        },
      },
    }),
  );
  localStorage.setItem(
    "octopus:user-7:custom-provider",
    JSON.stringify({
      openaiUrl: "https://custom.example.com/v1",
      openaiApiKey: "profile-secret",
    }),
  );
  localStorage.setItem(
    "octopus:other-user:custom-provider",
    JSON.stringify({ openaiUrl: "https://other.example.com/v1" }),
  );
  const options = { chats: false, settings: true, images: false };
  const exported = await createLocalBackup(options);
  expect(exported.settings).toMatchObject({
    customModels: "custom-chat",
    openaiUrl: "https://custom.example.com/v1",
    modelConfig: {
      stream: false,
      reasoningEffort: "high",
      stop: "END",
      compressionThreshold: 100000,
      contextBudget: 32768,
      compressModel: "summary-model",
      compressProviderName: "OpenAI",
      compressMessageLengthThreshold: 12000,
    },
  });
  expect(JSON.stringify(exported)).not.toMatch(/secret|other\.example/);
  localStorage.setItem(
    "octopus:user-7:custom-provider",
    JSON.stringify({ openaiUrl: "https://example.com/v1?api_key=secret" }),
  );
  expect(
    (await createLocalBackup(options)).settings?.openaiUrl,
  ).toBeUndefined();
});

test("exports the latest marked fallback instead of stale IndexedDB data", async () => {
  storage.set(
    key,
    JSON.stringify({ state: { sessions: [{ ...chat, topic: "Old" }] } }),
  );
  localStorage.setItem(
    key,
    JSON.stringify({ state: { sessions: [{ ...chat, topic: "Latest" }] } }),
  );
  localStorage.setItem(`${key}:local-storage-fallback`, "failed-write");
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  expect(exported.chats?.[0].topic).toBe("Latest");
});

test("exports an unmarked fallback when IndexedDB is unavailable", async () => {
  localStorage.setItem(key, JSON.stringify({ state: { sessions: [chat] } }));
  storageReads.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  expect(exported.chats?.[0].id).toBe(chat.id);
});

test("imported chat, settings and skills replace their fallback snapshots", async () => {
  const configKey = StoreKey.Config;
  const skillsKey = `octopus:user-7:${StoreKey.Skills}`;
  const fallback = (name: string, state: unknown) => {
    const value = JSON.stringify({ state });
    storage.set(name, value);
    localStorage.setItem(name, value);
    localStorage.setItem(`${name}:local-storage-fallback`, "failed-write");
  };
  fallback(key, { sessions: [{ ...chat, id: "local-chat" }] });
  fallback(configKey, { theme: "light" });
  fallback(skillsKey, { installed: { translation: skill } });
  await importLocalBackup({
    ...backup,
    settings: { theme: "dark" },
    skills: { another: { ...skill, id: "another" } },
  });
  expect(
    (await readLocalState(StoreKey.Chat, "user-7")).state.sessions.map(
      (session: { id: string }) => session.id,
    ),
  ).toEqual(["local-chat", chat.id]);
  expect((await readLocalState(configKey, "legacy")).state.theme).toBe("dark");
  expect(
    Object.keys(
      (await readLocalState(StoreKey.Skills, "user-7")).state.installed,
    ).sort(),
  ).toEqual(["another", "translation"]);
  for (const name of [key, configKey, skillsKey]) {
    expect(localStorage.getItem(name)).toBeNull();
    expect(localStorage.getItem(`${name}:local-storage-fallback`)).toBeNull();
  }
});

test("export excludes credentials and unknown nested account fields", async () => {
  storage.set(
    key,
    JSON.stringify({
      state: { sessions: [chat], accessToken: "private-session" },
    }),
  );
  storage.set(
    StoreKey.Config,
    JSON.stringify({
      state: {
        theme: "light",
        videoRequestMode: "async",
        openaiApiKey: "private-api-key",
        modelConfig: {
          ...chat.mask.modelConfig,
          imageRequestMode: "async",
          chatApiFormat: "gemini",
        },
      },
    }),
  );
  const result = await createLocalBackup({
    chats: true,
    settings: true,
    images: false,
  });
  const text = JSON.stringify(result);
  expect(result.settings?.videoRequestMode).toBe("async");
  expect(result.settings?.modelConfig?.imageRequestMode).toBe("async");
  expect(result.settings?.modelConfig?.chatApiFormat).toBe("gemini");
  expect(text).toContain("Private chat");
  expect(text).not.toMatch(
    /private-api-key|private-session|secret-mask-key|streaming/,
  );
});

test("invalid versions and active image formats are rejected before writing", async () => {
  await expect(importLocalBackup({ ...backup, version: 2 })).rejects.toThrow();
  expect(paused).toBe(false);
  expect(
    backupSchema.safeParse({
      ...backup,
      images: [
        {
          id: "x",
          prompt: "",
          model: "",
          width: 1,
          height: 1,
          createdAt: 1,
          status: "success",
          imageData: "data:image/svg+xml;base64,AAAA",
        },
      ],
    }).success,
  ).toBe(false);
  expect(storage.size).toBe(0);
});

test("native format survives session and settings import", async () => {
  storage.set(StoreKey.Config, JSON.stringify({ state: { modelConfig: {} } }));
  await importLocalBackup({
    ...backup,
    chats: [
      {
        ...chat,
        mask: {
          ...chat.mask,
          modelConfig: { model: "gemini-test", chatApiFormat: "gemini" },
        },
      },
    ],
    settings: {
      modelConfig: { model: "claude-test", chatApiFormat: "claude" },
    },
  });
  const result = await createLocalBackup({
    chats: true,
    settings: true,
    images: false,
  });
  expect(result.chats?.[0].mask.modelConfig.chatApiFormat).toBe("gemini");
  expect(result.settings?.modelConfig?.chatApiFormat).toBe("claude");
});

test("image request timing survives export and import without inventing old timings", async () => {
  const timedChat = {
    ...chat,
    messages: [
      ...chat.messages,
      {
        id: "image-1",
        role: "assistant",
        content: "![Generated Image](https://example.com/image.png)",
        imageRequestDurationMs: 65432,
      },
    ],
  };
  storage.set(key, JSON.stringify({ state: { sessions: [timedChat] } }));
  const exported = await createLocalBackup({
    chats: true,
    settings: false,
    images: false,
  });
  storage.clear();
  await importLocalBackup(exported);
  const messages = JSON.parse(storage.get(key) as string).state.sessions[0]
    .messages;
  expect(messages[1].imageRequestDurationMs).toBe(65432);
  expect(messages[0].imageRequestDurationMs).toBeUndefined();
  for (const duration of [-1, Infinity, NaN]) {
    expect(
      backupSchema.safeParse({
        ...backup,
        chats: [
          {
            ...timedChat,
            messages: [
              { ...timedChat.messages[1], imageRequestDurationMs: duration },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  }
});

test("import preserves existing sessions, deduplicates retries, and restores model defaults", async () => {
  storage.set(
    key,
    JSON.stringify({ state: { sessions: [{ ...chat, id: "existing" }] } }),
  );
  await importLocalBackup(backup);
  expect(paused).toBe(true);
  await importLocalBackup(backup);
  const result = JSON.parse(storage.get(key) as string);
  expect(result.state.sessions.map((item: any) => item.id)).toEqual([
    "existing",
    "chat-1",
  ]);
  expect(result.state.sessions[1].mask.modelConfig.temperature).toBe(0.7);
  expect(result.state.sessions[1].messages[0].streaming).toBe(false);
  expect(storage.has(`octopus:user-7:before-last-import`)).toBe(true);
  expect(storage.has(StoreKey.Chat)).toBe(false);
});

test("copy mode assigns fresh session and message identifiers", async () => {
  storage.set(key, JSON.stringify({ state: { sessions: [chat] } }));
  await importLocalBackup(backup, true);
  const sessions = JSON.parse(storage.get(key) as string).state.sessions;
  expect(sessions).toHaveLength(2);
  expect(sessions[1].id).not.toBe(chat.id);
  expect(sessions[1].messages[0].id).not.toBe(chat.messages[0].id);
});

test("chat backup exports project folders and reconciles their conversation assignments", async () => {
  const project = { id: "project-1", name: "Research", createdAt: 1 };
  const emptyProject = { id: "empty-project", name: "Empty", createdAt: 2 };
  storage.set(
    key,
    JSON.stringify({
      state: {
        projects: [project, emptyProject],
        sessions: [
          {
            ...chat,
            projectId: project.id,
            messages: [
              {
                id: "reply",
                role: "assistant",
                content: "Working",
                streaming: true,
              },
            ],
          },
          { ...chat, id: "unfiled", projectId: "missing" },
        ],
      },
    }),
  );
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  expect(exported.projects).toEqual([project, emptyProject]);
  expect(exported.chats?.[0].projectId).toBe(project.id);
  expect(exported.chats?.[0].messages[0].interrupted).toBe(true);
  expect(exported.chats?.[1].projectId).toBeUndefined();
  storage.clear();
  await importLocalBackup(exported);
  const restored = await readLocalState(StoreKey.Chat, "user-7");
  expect(restored.state.projects).toEqual([project, emptyProject]);
  expect(restored.state.sessions[0].projectId).toBe(project.id);
  expect(restored.state.sessions[1].projectId).toBeUndefined();
});

test("project imports keep local names, chat assignments and the current selection on duplicate ids", async () => {
  const local = { id: "project-1", name: "Local project", createdAt: 1 };
  const localChat = { ...chat, projectId: local.id };
  storage.set(
    key,
    JSON.stringify({
      state: {
        projects: [local],
        sessions: [localChat],
        currentSessionIndex: 0,
      },
    }),
  );
  await importLocalBackup({
    ...backup,
    projects: [
      { ...local, name: "Imported rename" },
      { id: "project-2", name: "Empty imported project", createdAt: 2 },
    ],
    chats: [{ ...chat, projectId: "project-2" }],
  });
  const restored = await readLocalState(StoreKey.Chat, "user-7");
  expect(restored.state.projects).toEqual([
    local,
    { id: "project-2", name: "Empty imported project", createdAt: 2 },
  ]);
  expect(restored.state.sessions).toHaveLength(1);
  expect(restored.state.sessions[0].projectId).toBe(local.id);
  expect(restored.state.currentSessionIndex).toBe(0);
});

test("copy imports remap projects and all imported conversation assignments together", async () => {
  const project = { id: "project-1", name: "Research", createdAt: 1 };
  storage.set(
    key,
    JSON.stringify({
      state: {
        projects: [project],
        sessions: [{ ...chat, projectId: project.id }],
      },
    }),
  );
  await importLocalBackup(
    {
      ...backup,
      projects: [project],
      chats: [{ ...chat, projectId: project.id }],
    },
    true,
  );
  const restored = await readLocalState(StoreKey.Chat, "user-7");
  expect(restored.state.projects).toHaveLength(2);
  expect(restored.state.projects[0]).toEqual(project);
  expect(restored.state.projects[1]).toMatchObject({
    name: "Research",
    createdAt: 1,
  });
  expect(restored.state.projects[1].id).not.toBe(project.id);
  expect(restored.state.sessions[0].projectId).toBe(project.id);
  expect(restored.state.sessions[1].projectId).toBe(
    restored.state.projects[1].id,
  );
});

test("projects-only backups restore empty folders and retain the selected conversation", async () => {
  const projects = [{ id: "empty-project", name: "Empty", createdAt: 1 }];
  storage.set(
    key,
    JSON.stringify({
      state: {
        sessions: [
          { ...chat, id: "first" },
          { ...chat, id: "second" },
        ],
        currentSessionIndex: 1,
      },
    }),
  );
  await importLocalBackup({ ...backup, chats: undefined, projects });
  const restored = await readLocalState(StoreKey.Chat, "user-7");
  expect(restored.state.projects).toEqual(projects);
  expect(restored.state.sessions.map((session: any) => session.id)).toEqual([
    "first",
    "second",
  ]);
  expect(restored.state.currentSessionIndex).toBe(1);
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  expect(exported.projects).toEqual(projects);
});

test("legacy backups cannot attach incoming conversations to an unrelated local project", async () => {
  const project = { id: "local", name: "Private", createdAt: 1 };
  storage.set(
    key,
    JSON.stringify({ state: { projects: [project], sessions: [] } }),
  );
  await importLocalBackup({
    ...backup,
    chats: [{ ...chat, projectId: project.id }],
  });
  const restored = await readLocalState(StoreKey.Chat, "user-7");
  expect(restored.state.projects).toEqual([project]);
  expect(restored.state.sessions[0].projectId).toBeUndefined();
});

test("an empty project's folder is exportable without any conversations", async () => {
  const projects = [{ id: "empty", name: "Empty", createdAt: 1 }];
  storage.set(key, JSON.stringify({ state: { projects, sessions: [] } }));
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  expect(parseLocalBackup(exported).projects).toEqual(projects);
  expect(exported.chats).toEqual([]);
});

const image = {
  id: "image-message",
  prompt: "A bicycle",
  model: "gpt-image",
  width: 1,
  height: 1,
  createdAt: 1,
  status: "success",
  imageData: "data:image/png;base64,AAAA",
};
const imageChat = {
  ...chat,
  messages: [
    {
      id: image.id,
      role: "assistant",
      content: "![Generated Image](https://example.com/expired.png)",
    },
  ],
};

test("merged chats retain message IDs matching imported gallery originals", async () => {
  await importLocalBackup({ ...backup, chats: [imageChat], images: [image] });
  const message = JSON.parse(storage.get(key) as string).state.sessions[0]
    .messages[0];
  expect(message.id).toBe(image.id);
  expect(imageWrites.mock.calls[0][0].id).toBe(message.id);
});

test("copied chats and gallery originals share fresh asset IDs without replacing existing assets", async () => {
  storedImages = [{ id: image.id }];
  storage.set(key, JSON.stringify({ state: { sessions: [imageChat] } }));
  await importLocalBackup(
    { ...backup, chats: [imageChat], images: [image] },
    true,
  );
  const sessions = JSON.parse(storage.get(key) as string).state.sessions;
  const message = sessions[1].messages[0];
  expect(sessions[0].messages[0].id).toBe(image.id);
  expect(message.id).not.toBe(image.id);
  expect(message.imageId).not.toBe(image.id);
  expect(imageWrites.mock.calls[0][0].id).toBe(message.imageId);
});

test("copying chats without images retains the existing asset reference", async () => {
  await importLocalBackup({ ...backup, chats: [imageChat] }, true);
  const message = JSON.parse(storage.get(key) as string).state.sessions[0]
    .messages[0];
  expect(message.id).not.toBe(image.id);
  expect(message.imageId).toBe(image.id);
  expect(imageWrites).not.toHaveBeenCalled();
});

test("export and import preserve explicit asset references from earlier chat copies", async () => {
  const copiedChat = {
    ...imageChat,
    messages: [
      { ...imageChat.messages[0], id: "copied-message", imageId: image.id },
    ],
  };
  storage.set(key, JSON.stringify({ state: { sessions: [copiedChat] } }));
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  storage.clear();
  await importLocalBackup({ ...exported, images: [image] }, true);
  const message = JSON.parse(storage.get(key) as string).state.sessions[0]
    .messages[0];
  expect(message.imageId).toBe(imageWrites.mock.calls[0][0].id);
  expect(message.imageId).not.toBe(image.id);
});

test("merged chats preserve explicit references and copying remaps mask context images too", async () => {
  const source = {
    ...imageChat,
    messages: [
      { ...imageChat.messages[0], id: "separate-message", imageId: image.id },
    ],
    mask: { ...chat.mask, context: imageChat.messages },
  };
  await importLocalBackup({ ...backup, chats: [source] });
  let session = JSON.parse(storage.get(key) as string).state.sessions[0];
  expect(session.messages[0].id).toBe("separate-message");
  expect(session.messages[0].imageId).toBe(image.id);
  storage.clear();
  await importLocalBackup(
    { ...backup, chats: [source], images: [image] },
    true,
  );
  session = JSON.parse(storage.get(key) as string).state.sessions[0];
  expect(session.mask.context[0].imageId).toBe(session.messages[0].imageId);
  expect(session.mask.context[0].id).not.toBe(image.id);
});

test("image-only imports do not rewrite chat IDs and deduplicate existing originals", async () => {
  const existing = JSON.stringify({ state: { sessions: [imageChat] } });
  storage.set(key, existing);
  storedImages = [{ id: image.id }];
  const { chats: _chats, ...imageOnly } = { ...backup, images: [image] };
  await importLocalBackup(imageOnly);
  expect(storage.get(key)).toBe(existing);
  expect(imageWrites).not.toHaveBeenCalled();
  await importLocalBackup(imageOnly, true);
  expect(storage.get(key)).toBe(existing);
  expect(imageWrites.mock.calls[0][0].id).not.toBe(image.id);
});

test("original files, video and audio survive backup export and import", async () => {
  const content = [
    { type: "text", text: "Review these materials" },
    {
      type: "file",
      file: {
        filename: "code.ts",
        file_data: "data:text/typescript;base64,QQ0K",
      },
    },
    { type: "video_url", video_url: { url: "data:video/mp4;base64,AAAA" } },
    { type: "input_audio", input_audio: { data: "AAAA", format: "wav" } },
  ];
  const files = [
    {
      name: "code.ts",
      type: "text/typescript",
      size: 3,
      content: content[1].file!.file_data,
      isText: false,
    },
  ];
  storage.set(
    key,
    JSON.stringify({
      state: {
        sessions: [
          {
            ...chat,
            messages: [
              {
                id: "materials",
                role: "user",
                content,
                composerInput: { text: "Review", files },
              },
            ],
          },
        ],
      },
    }),
  );
  const exported = await createLocalBackup({
    chats: true,
    settings: false,
    images: false,
  });
  storage.clear();
  await importLocalBackup(exported);
  const restored = JSON.parse(storage.get(key) as string).state.sessions[0]
    .messages[0];
  expect(restored.content).toEqual(content);
  expect(restored.composerInput.files).toEqual(files);
});

test("large material backups stay portable while imported chat snapshots use local references", async () => {
  const payload = `data:video/mp4;base64,${"A".repeat(1024 * 1024)}`;
  const materials = {
    id: "large-material",
    role: "user",
    content: [
      { type: "text", text: "Review the original video" },
      { type: "video_url", video_url: { url: payload } },
    ],
    composerInput: {
      text: "Review the original video",
      files: [
        {
          name: "original.mp4",
          type: "video/mp4",
          size: (1024 * 1024 * 3) / 4,
          content: payload,
          isText: false,
        },
      ],
    },
  };
  const portable = {
    ...backup,
    chats: [{ ...chat, messages: [materials] }],
  };
  await importLocalBackup(portable);
  expect(String(storage.get(key)).length).toBeLessThan(5000);
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  expect(exported.chats?.[0].messages[0]).toMatchObject(materials);
  expect(JSON.stringify(exported)).not.toContain("__octopusChatAsset");
  storage.clear();
  await importLocalBackup(JSON.parse(JSON.stringify(exported)));
  const restored = (await readLocalState(StoreKey.Chat, "user-7")).state
    .sessions[0].messages[0];
  expect(restored).toMatchObject(materials);
  await importLocalBackup(exported, true);
  const copied = (await readLocalState(StoreKey.Chat, "user-7")).state.sessions;
  expect(copied).toHaveLength(2);
  expect(copied[1].messages[0].id).not.toBe(materials.id);
  expect(copied[1].messages[0].content).toEqual(materials.content);
  expect(
    [...storage.keys()].filter((name) => name.startsWith(`${key}:asset:`)),
  ).toHaveLength(1);
});

test("export refuses an incomplete material snapshot instead of exporting broken references", async () => {
  const payload = `data:application/pdf;base64,${"A".repeat(100000)}`;
  await importLocalBackup({
    ...backup,
    chats: [
      {
        ...chat,
        messages: [
          {
            id: "pdf",
            role: "user",
            content: [
              {
                type: "file",
                file: { filename: "original.pdf", file_data: payload },
              },
            ],
          },
        ],
      },
    ],
  });
  const raw = storage.get(key);
  storage.delete(
    [...storage.keys()].find((name) => name.startsWith(`${key}:asset:`))!,
  );
  await expect(
    createLocalBackup({ chats: true, images: false, settings: false }),
  ).rejects.toThrow("attachment is missing");
  expect(storage.get(key)).toBe(raw);
});

test("an image storage failure releases the freeze without replacing chats", async () => {
  const previous = JSON.stringify({ state: { sessions: [chat] } });
  storage.set(key, previous);
  imageWrites.mockRejectedValueOnce(new Error("QuotaExceededError"));
  await expect(
    importLocalBackup({
      ...backup,
      images: [
        {
          id: "image-1",
          prompt: "",
          model: "",
          width: 1,
          height: 1,
          createdAt: 1,
          status: "success",
          imageData: "data:image/png;base64,AAAA",
        },
      ],
    }),
  ).rejects.toThrow("QuotaExceededError");
  expect(storage.get(key)).toBe(previous);
  expect(paused).toBe(false);
});

test("interaction metadata and branch-local option responses survive copy import with remapped source ids", async () => {
  const interactions = {
    suggestions: ["Explain this choice"],
    options: {
      id: "channels",
      question: "Choose channels",
      selection: "multiple",
      options: [
        { id: "email", label: "Email" },
        { id: "sms", label: "Text message" },
      ],
      minSelections: 1,
      maxSelections: 2,
    },
  };
  const source = {
    ...chat,
    messages: [
      { id: "question", role: "user", content: "Help" },
      {
        id: "choices",
        role: "assistant",
        parentId: "question",
        content: "Choose channels",
        interactions,
      },
      {
        id: "reply",
        role: "user",
        parentId: "choices",
        content: "Email",
        optionResponse: {
          sourceMessageId: "choices",
          optionsId: "channels",
          selectedIds: ["email"],
        },
      },
    ],
    messageBranches: [
      {
        id: "alternate-reply",
        role: "user",
        parentId: "choices",
        content: "Text message",
        optionResponse: {
          sourceMessageId: "choices",
          optionsId: "channels",
          selectedIds: ["sms"],
        },
      },
    ],
  };
  storage.set(key, JSON.stringify({ state: { sessions: [source] } }));
  const exported = await createLocalBackup({
    chats: true,
    images: false,
    settings: false,
  });
  expect(exported.chats?.[0].messages[1].interactions).toEqual(interactions);
  expect(exported.chats?.[0].messages[2].optionResponse).toEqual(
    source.messages[2].optionResponse,
  );
  await importLocalBackup(exported, true);
  const saved = await readLocalState(StoreKey.Chat, "user-7");
  const copy = saved.state.sessions.find(
    (entry: any) => entry.id !== source.id,
  );
  expect(copy.messages[1].id).not.toBe("choices");
  expect(copy.messages[1].interactions).toEqual(interactions);
  expect(copy.messages[2].optionResponse).toEqual({
    sourceMessageId: copy.messages[1].id,
    optionsId: "channels",
    selectedIds: ["email"],
  });
  expect(copy.messageBranches[0].optionResponse).toEqual({
    sourceMessageId: copy.messages[1].id,
    optionsId: "channels",
    selectedIds: ["sms"],
  });
});

test("malformed interaction metadata is rejected before restoring any local state", async () => {
  await expect(
    importLocalBackup({
      ...backup,
      chats: [
        {
          ...chat,
          messages: [
            {
              role: "assistant",
              content: "Choose",
              interactions: {
                options: {
                  id: "invalid",
                  question: "Choose",
                  selection: "single",
                  options: [
                    { id: "a", label: "A" },
                    { id: "a", label: "Duplicate id" },
                  ],
                },
              },
            },
          ],
        },
      ],
    }),
  ).rejects.toThrow(/备份/);
  expect(storage.has(key)).toBe(false);
});
