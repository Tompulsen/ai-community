/** @jest-environment node */

import { jest } from "@jest/globals";
import { createStore } from "zustand/vanilla";
import {
  createMaterialUpload,
  type MaterialPreparation,
} from "../app/utils/material-upload";
import type { ParsedFile } from "../app/utils/file-upload";
import type { ChatMessage, ChatSession } from "../app/store/chat";
import type { GalleryImage } from "../app/store/gallery";
import type { VideoDraft, VideoResult } from "../app/store/video";
import type { ChatGenerationProgress } from "../app/client/api";
import type { ChatResponseMetrics } from "../app/utils/chat-response-metrics";
import { getResponseMetrics } from "../app/utils/chat-response-metrics";
import { estimateChatContextUsage } from "../app/utils/chat-context-usage";
import { messageInteractionPrompt } from "../app/utils/message-interactions";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  },
});

type ModelCapabilities = ReturnType<
  typeof import("../app/utils/model-capabilities").getModelCapabilities
>;
let preferencesReady = true;
const waitForPreferences = jest.fn<() => Promise<void>>();
const chatRequest = jest.fn<(...args: any[]) => Promise<void>>();
const imageRequest = jest.fn<(...args: any[]) => Promise<void>>();
const videoDraft =
  jest.fn<typeof import("../app/utils/chat-video").chatVideoDraft>();
const videoConfig =
  jest.fn<typeof import("../app/utils/chat-video").chatVideoConfig>();
const videoRequest =
  jest.fn<
    typeof import("../app/utils/video-generation").generateVideoRequest
  >();
const videoResume =
  jest.fn<typeof import("../app/utils/video-generation").resumeVideoRequest>();
const videoLoadDraft = jest.fn<() => Promise<void>>();
let videoResults: VideoResult[] = [];
let accountEnabled = false;
let imageCallbacks: {
  onError?: (message: string, cause?: unknown) => void;
  onComplete?: (imageUrl: string, imageUrls?: string[]) => void;
} = {};
const addGalleryImage =
  jest.fn<(image: GalleryImage, owner: string, blob: Blob) => Promise<void>>();
const gallerySettings = jest.fn(async () => ({
  autoSave: true,
  maxCount: 500,
}));
const clientApi = jest.fn(() => ({ llm: { chat: chatRequest } }));
type PreviewResponse = {
  content: string;
  reasoning?: string;
  tools?: ChatMessage["tools"];
  responseMetrics?: ChatResponseMetrics;
};
type PreviewResponseOptions = {
  model?: string;
  signal: AbortSignal;
  onUpdate: (text: string) => void;
  onReasoning?: (text: string) => void;
  onGenerationProgress?: (progress: ChatGenerationProgress) => void;
};
let localPreviewEnabled = false;
const previewResponse =
  jest.fn<
    (options: PreviewResponseOptions) => Promise<PreviewResponse | void>
  >();
const previewSummary = jest.fn<(signal: AbortSignal) => Promise<string>>();
jest.unstable_mockModule("@/app/utils/local-preview-models", () => ({
  LOCAL_PREVIEW_PROVIDER: "本地预览",
  LOCAL_PREVIEW_COMPRESSION_MODEL: "local-preview-compression",
  LOCAL_PREVIEW_MESSAGE: "预览模型仅用于界面验收，请选择真实模型后发送。",
  isLocalPreviewEnabled: () => localPreviewEnabled,
  isLocalPreviewModel: (providerName?: string) => providerName === "本地预览",
  getLocalPreviewModels: () => [],
}));
jest.unstable_mockModule("@/app/utils/local-preview-response", () => ({
  streamLocalPreviewResponse: previewResponse,
  getLocalPreviewSummary: previewSummary,
}));
let mcpEnabled = false;
let localOwner = "user-7";
let localActive = true;
let localTokenId: number | null = null;
const attachmentRead = jest.fn<(key: string) => Promise<unknown>>();
const toast = jest.fn();
jest.unstable_mockModule("idb-keyval", () => ({
  get: attachmentRead,
  set: jest.fn(),
  del: jest.fn(),
}));
const executeMcpAction = jest.fn<(...args: any[]) => Promise<unknown>>();
const chatCapabilities: ModelCapabilities = {
  vendor: "other",
  vendorName: undefined,
  category: "chat",
  usesImageApi: false,
  vision: false,
  override: "chat",
};
const capabilities =
  jest.fn<(model: string, providerName?: string) => ModelCapabilities>();
let chatMethods: {
  getMessagesWithMemory: (
    session?: ChatSession,
    includeMemory?: boolean,
  ) => Promise<ChatMessage[]>;
};
jest.unstable_mockModule("@/app/store/model-preferences", () => ({
  useModelPreferenceStore: {
    getState: () => ({ _hasHydrated: preferencesReady, overrides: {} }),
  },
  waitForModelPreferences: waitForPreferences,
}));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  getModelCapabilities: capabilities,
}));
jest.unstable_mockModule("@/app/utils/store", () => ({
  createPersistStore: (
    initial: object,
    methods: (set: unknown, get: unknown) => object,
  ) =>
    createStore((set, get) => {
      const storeMethods = methods(set, get);
      if ("getMessagesWithMemory" in storeMethods)
        chatMethods = storeMethods as typeof chatMethods;
      return { ...initial, ...storeMethods };
    }),
}));
jest.unstable_mockModule("@/app/utils", () => ({
  getMessageTextContent: (message: {
    content: string | { type: string; text?: string }[];
  }) =>
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join(""),
  isDalle3: () => false,
  isVisionModelCheck: () => false,
  isImageModelCheck: () => false,
  shouldUseImageGenerationApi: (
    _config: unknown,
    options: { hasFiles?: boolean; capabilities?: ModelCapabilities },
  ) => !options.hasFiles && options.capabilities?.usesImageApi === true,
  safeLocalStorage: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
}));
jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({}),
}));
jest.unstable_mockModule("@/app/utils/indexedDB-storage", () => ({
  indexedDBStorage: {},
}));
jest.unstable_mockModule("@/app/store/gallery", () => ({
  addImage: addGalleryImage,
  getGallerySettings: gallerySettings,
  trimToMaxCount: jest.fn(async () => {}),
  clearAllImages: jest.fn(async () => {}),
  getImageBlob: jest.fn(),
  dataURLtoBlob: () => new Blob(["generated image"], { type: "image/png" }),
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => localOwner,
  getLocalTokenId: () => localTokenId,
  isLocalWorkspaceActive: () => localActive,
  localKey: (key: string, scope = localOwner) => `octopus:${scope}:${key}`,
  beginLocalMaintenance: () => {},
  endLocalMaintenance: () => {},
  initializeLocalWorkspace: async () => localOwner,
  trackLocalWrite: (write: unknown) => write,
}));
jest.unstable_mockModule("@/app/client/api", () => ({
  getClientApi: clientApi,
  detectBase64Mime: jest.fn(),
  getHeaders: () => ({}),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: toast,
}));
jest.unstable_mockModule("@/app/client/image-generation", () => ({
  getImageGenerationService: () => ({
    setCallbacks: (callbacks: typeof imageCallbacks) => {
      imageCallbacks = callbacks;
    },
    generateImage: imageRequest,
  }),
}));
jest.unstable_mockModule("@/app/utils/chat-video", () => ({
  chatVideoDraft: videoDraft,
  chatVideoConfig: videoConfig,
}));
jest.unstable_mockModule("@/app/store/video", () => ({
  useVideoStore: {
    getState: () => ({ results: videoResults, loadDraft: videoLoadDraft }),
  },
}));
jest.unstable_mockModule("@/app/utils/video-generation", () => ({
  generateVideoRequest: videoRequest,
  resumeVideoRequest: videoResume,
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: { getState: () => ({ newApiEnabled: accountEnabled }) },
}));
jest.unstable_mockModule("@/app/store/skills", () => ({
  useSkillStore: { getState: () => ({ installed: {} }) },
}));
jest.unstable_mockModule("@/app/mcp/actions", () => ({
  executeMcpAction,
  getAllTools: async () => [],
  isMcpEnabled: async () => mcpEnabled,
}));

const { DEFAULT_CONFIG, useAppConfig } = await import("../app/store/config");
const {
  useChatStore,
  createMessage,
  DEFAULT_TOPIC,
  isContextCompressionActive,
} = await import("../app/store/chat");
const { waitForContextCompression } = await import(
  "../app/utils/context-compression"
);
const { createEmptyMask } = await import("../app/store/mask");
const { LOCAL_PREVIEW_PROVIDER } = await import(
  "../app/utils/local-preview-models"
);
const { ChatControllerPool } = await import("../app/client/controller");

function selectModel(model: string, providerName: string) {
  const store = useChatStore.getState();
  store.updateTargetSession(store.currentSession(), (session) => {
    session.mask.modelConfig.model = model;
    session.mask.modelConfig.providerName = providerName;
    session.mask.syncGlobalConfig = false;
  });
}

function interactionPromptMessage(messageId: string, role = "system") {
  return {
    role,
    content: [{ type: "text", text: messageInteractionPrompt(messageId) }],
  };
}

beforeEach(() => {
  accountEnabled = false;
  imageCallbacks = {};
  addGalleryImage.mockReset().mockResolvedValue();
  gallerySettings.mockClear();
  localOwner = "user-7";
  localActive = true;
  localTokenId = null;
  localPreviewEnabled = false;
  previewResponse.mockReset();
  previewSummary
    .mockReset()
    .mockResolvedValue("保留历史中的关键事实与未完成事项。");
  attachmentRead.mockReset();
  toast.mockClear();
  preferencesReady = true;
  waitForPreferences.mockReset().mockResolvedValue();
  capabilities.mockReset().mockReturnValue(chatCapabilities);
  chatRequest.mockReset().mockResolvedValue();
  imageRequest.mockReset().mockResolvedValue();
  videoDraft.mockReset();
  videoConfig.mockReset();
  videoRequest.mockReset().mockResolvedValue();
  videoResume.mockReset().mockResolvedValue();
  videoLoadDraft.mockReset().mockResolvedValue();
  videoResults = [];
  clientApi.mockClear();
  mcpEnabled = false;
  executeMcpAction.mockReset().mockResolvedValue({});
  ChatControllerPool.stopAll();
  useAppConfig.setState({
    modelConfig: {
      ...DEFAULT_CONFIG.modelConfig,
      model: "global-default",
      providerName: "OpenAI",
    },
  });
  useChatStore.setState({ sessions: [], currentSessionIndex: 0 });
  useChatStore.getState().newSession();
});

test("chat video forwards raw composer input, prepared files and its submitted parameter snapshot", async () => {
  capabilities.mockReturnValue({ ...chatCapabilities, category: "video" });
  selectModel("sora-2", "OpenAI");
  const config = {
    duration: 12,
    protocolOptions: { openai: { generateAudio: true } },
  };
  const file: ParsedFile = {
    name: "reference.mp4",
    type: "video/mp4",
    content: "data:video/mp4;base64,AAAA",
    size: 3,
    isText: false,
  };
  const store = useChatStore.getState();
  store.updateTargetSession(store.currentSession(), (session) => {
    session.mask.modelConfig.videoConfig = config;
    session.remixSourceWorkId = "source-work";
  });
  const submittedDraft = {
    prompt: "Validated video request",
  } as ReturnType<typeof videoDraft>;
  videoDraft.mockReturnValue(submittedDraft);
  const image = "data:" + "image/png;base64," + btoa("reference");
  const pending = store.onUserInput(
    "File metadata must not enter the video prompt",
    [image],
    false,
    {
      text: "Animate the scene",
      files: [file],
      quote: {
        messageId: "quoted",
        role: "assistant",
        text: "Camera pans left",
      },
    },
  );
  config.duration = 30;
  config.protocolOptions.openai.generateAudio = false;
  await pending;
  const bot = store.currentSession().messages.at(-1)!;
  expect(bot.content).toBe("视频生成任务");
  expect(videoDraft).toHaveBeenCalledTimes(1);
  expect(videoDraft).toHaveBeenCalledWith(
    "引用内容：\n> Camera pans left\n\nAnimate the scene",
    "sora-2",
    "OpenAI",
    [image],
    "source-work",
    {
      duration: 12,
      protocolOptions: { openai: { generateAudio: true } },
    },
    [file],
  );
  expect(bot).toMatchObject({
    role: "assistant",
    content: "视频生成任务",
    videoResultId: bot.id,
    streaming: false,
  });
  expect(videoRequest).toHaveBeenCalledWith(submittedDraft, bot.id, null);
  expect(chatRequest).not.toHaveBeenCalled();
  expect(imageRequest).not.toHaveBeenCalled();
});

test("chat video validation errors stay on the submitted message without sending a request", async () => {
  capabilities.mockReturnValue({ ...chatCapabilities, category: "video" });
  selectModel("sora-2", "OpenAI");
  videoDraft.mockImplementation(() => {
    throw new Error("当前接口仅支持图片参考素材，请移除音频或视频素材");
  });
  await useChatStore.getState().onUserInput("Animate this reference");
  const messages = useChatStore.getState().currentSession().messages;
  expect(messages).toHaveLength(2);
  expect(messages[1]).toMatchObject({
    role: "assistant",
    content: "当前接口仅支持图片参考素材，请移除音频或视频素材",
    streaming: false,
    isError: true,
  });
  expect(messages[1].videoResultId).toBeUndefined();
  expect(videoRequest).not.toHaveBeenCalled();
  expect(chatRequest).not.toHaveBeenCalled();
});

test.each([
  ["video-answer", true],
  ["video-answer", false],
  ["video-question", true],
  ["video-question", false],
] as const)(
  "%s video retry uses the saved request after switching to a text model (source materials: %s)",
  async (entryId, hasSourceMaterials) => {
    const image = "data:" + "image/png;base64," + btoa("original-frame");
    const parameters: Partial<VideoDraft> = {
      mode: "image-to-video",
      duration: 12,
      resolution: "720p",
      aspectRatio: "9:16",
      protocolOptions: { openai: { generateAudio: true } },
    };
    const snapshot = {
      ...parameters,
      model: "sora-2@OpenAI",
      prompt: "Original camera movement",
      sourceWorkId: "original-work",
      materials: [
        { id: "original-frame", type: "image", url: image, name: "frame.png" },
      ],
    } as VideoDraft;
    videoResults = [
      {
        id: "saved-video",
        model: "sora-2",
        prompt: snapshot.prompt,
        url: "https://fixture/original.mp4",
        createdAt: 1,
        status: "success",
        request: snapshot,
      },
    ];
    videoConfig.mockReturnValue(parameters);
    videoDraft.mockReturnValue(snapshot);
    capabilities.mockImplementation((model, provider) =>
      model === "sora-2" && provider === "OpenAI"
        ? { ...chatCapabilities, category: "video" }
        : chatCapabilities,
    );
    selectModel("gpt-6-astra", "Custom");
    const store = useChatStore.getState();
    store.updateTargetSession(store.currentSession(), (session) => {
      session.mask.modelConfig.videoConfig = { duration: 30 };
      session.remixSourceWorkId = "new-editor-work";
      session.messages = [
        createMessage({
          id: "video-question",
          role: "user",
          content: [
            { type: "text", text: snapshot.prompt },
            ...(hasSourceMaterials
              ? [{ type: "image_url" as const, image_url: { url: image } }]
              : []),
          ],
          ...(hasSourceMaterials
            ? { composerInput: { text: snapshot.prompt, files: [] } }
            : {}),
        }),
        createMessage({
          id: "video-answer",
          role: "assistant",
          model: "sora-2",
          videoResultId: "saved-video",
        }),
      ];
    });
    const before = structuredClone(store.currentSession().mask.modelConfig);
    expect(await store.retryMessage(store.currentSession().id, entryId)).toBe(
      true,
    );
    expect(videoConfig).toHaveBeenCalledWith(snapshot);
    expect(videoDraft).toHaveBeenCalledWith(
      snapshot.prompt,
      "sora-2",
      "OpenAI",
      [image],
      "original-work",
      parameters,
      [],
    );
    const current = store.currentSession();
    const bot = current.messages.at(-1)!;
    expect(bot).toMatchObject({
      model: "sora-2",
      content: "视频生成任务",
      videoResultId: bot.id,
    });
    expect(videoRequest).toHaveBeenCalledWith(snapshot, bot.id, null);
    expect(videoResume).not.toHaveBeenCalled();
    expect(current.mask.modelConfig).toEqual(before);
    expect(current.remixSourceWorkId).toBe("new-editor-work");
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
  },
);

test("video retry refuses an original model that is now classified as text", async () => {
  const store = useChatStore.getState();
  const snapshot = {
    model: "old-video-alias@OpenAI",
    prompt: "Original prompt",
    materials: [],
  } as unknown as VideoDraft;
  videoConfig.mockReturnValue({ duration: 12 });
  videoResults = [
    {
      id: "saved-video",
      model: "old-video-alias",
      prompt: snapshot.prompt,
      url: "",
      createdAt: 1,
      status: "failed",
      request: snapshot,
    },
  ];
  store.updateTargetSession(store.currentSession(), (session) => {
    session.messages = [
      createMessage({ id: "video-question", role: "user", content: "Animate" }),
      createMessage({
        id: "video-answer",
        role: "assistant",
        videoResultId: "saved-video",
      }),
    ];
  });
  await store.retryMessage(store.currentSession().id, "video-answer");
  expect(store.currentSession().messages.at(-1)).toMatchObject({
    content: "原视频模型当前不支持视频生成，请检查模型分类后重试。",
    streaming: false,
    isError: true,
  });
  expect(videoRequest).not.toHaveBeenCalled();
  expect(chatRequest).not.toHaveBeenCalled();
  expect(imageRequest).not.toHaveBeenCalled();
});

test.each([
  ["video-answer", false],
  ["video-answer", true],
  ["video-question", false],
  ["video-question", true],
] as const)(
  "%s video retry without a saved request refuses the current text route (record exists: %s)",
  async (entryId, hasRecord) => {
    const store = useChatStore.getState();
    selectModel("gpt-6-astra", "Custom");
    videoResults = hasRecord
      ? [
          {
            id: "saved-video",
            model: "sora-2",
            prompt: "Original prompt",
            url: "",
            createdAt: 1,
            status: "failed",
          },
        ]
      : [];
    store.updateTargetSession(store.currentSession(), (session) => {
      session.mask.modelConfig.videoConfig = { duration: 30 };
      session.messages = [
        createMessage({
          id: "video-question",
          role: "user",
          content: "Animate",
        }),
        createMessage({
          id: "video-answer",
          role: "assistant",
          videoResultId: "saved-video",
        }),
      ];
    });
    const before = structuredClone(store.currentSession());
    expect(await store.retryMessage(before.id, entryId)).toBe(false);
    expect(videoLoadDraft).toHaveBeenCalledTimes(1);
    expect(store.currentSession()).toEqual(before);
    expect(toast).toHaveBeenCalledWith(
      "原视频任务记录已不可用，请复用可用配置，或重新选择视频模型后发送。",
    );
    expect(videoConfig).not.toHaveBeenCalled();
    expect(videoDraft).not.toHaveBeenCalled();
    expect(videoRequest).not.toHaveBeenCalled();
    expect(videoResume).not.toHaveBeenCalled();
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
  },
);

test.each([
  ["video-answer", "config"],
  ["video-question", "answer"],
] as const)(
  "%s video retry retains the %s guard while loading saved tasks",
  async (entryId, change) => {
    const store = useChatStore.getState();
    selectModel("gpt-6-astra", "Custom");
    store.updateTargetSession(store.currentSession(), (session) => {
      session.messages = [
        createMessage({
          id: "video-question",
          role: "user",
          content: "Animate",
        }),
        createMessage({
          id: "video-answer",
          role: "assistant",
          videoResultId: "saved-video",
        }),
      ];
    });
    const started = pendingResult<void>();
    const loaded = pendingResult<void>();
    videoLoadDraft.mockImplementationOnce(() => {
      started.resolve();
      return loaded.promise;
    });
    const retry = store.retryMessage(store.currentSession().id, entryId);
    await started.promise;
    store.updateTargetSession(store.currentSession(), (session) => {
      if (change === "config") {
        session.mask.modelConfig.videoConfig = { duration: 31 };
      } else {
        session.messages[1] = createMessage({
          id: "new-video-answer",
          role: "assistant",
          videoResultId: "saved-video",
        });
      }
    });
    videoResults = [
      {
        id: "saved-video",
        model: "sora-2",
        prompt: "Original prompt",
        url: "",
        createdAt: 1,
        status: "failed",
        request: {
          model: "sora-2@OpenAI",
          prompt: "Original prompt",
          materials: [],
        } as unknown as VideoDraft,
      },
    ];
    const before = structuredClone(store.currentSession());
    loaded.resolve();
    expect(await retry).toBe(false);
    expect(store.currentSession()).toEqual(before);
    expect(videoConfig).not.toHaveBeenCalled();
    expect(videoDraft).not.toHaveBeenCalled();
    expect(videoRequest).not.toHaveBeenCalled();
    expect(videoResume).not.toHaveBeenCalled();
    expect(chatRequest).not.toHaveBeenCalled();
  },
);

test.each([
  ["video-answer", "generating", false],
  ["video-answer", "paused", false],
  ["video-question", "generating", false],
  ["video-question", "paused", false],
  ["video-answer", "paused", true],
  ["video-question", "paused", true],
] as const)(
  "%s retry of a %s video resumes without a POST or branch (query failure: %s)",
  async (entryId, phase, fails) => {
    const store = useChatStore.getState();
    selectModel("gpt-6-astra", "Custom");
    videoResults = [
      {
        id: "saved-video",
        model: "sora-2",
        prompt: "Original prompt",
        url: "",
        createdAt: 1,
        status: "pending",
        phase,
      },
    ];
    store.updateTargetSession(store.currentSession(), (session) => {
      session.mask.modelConfig.videoConfig = { duration: 30 };
      session.messages = [
        createMessage({
          id: "video-question",
          role: "user",
          content: "Animate",
        }),
        createMessage({
          id: "video-answer",
          role: "assistant",
          videoResultId: "saved-video",
        }),
      ];
    });
    if (fails)
      videoResume.mockRejectedValueOnce(
        new Error("视频查询失败，请稍后重试。"),
      );
    const before = structuredClone(store.currentSession());
    expect(await store.retryMessage(before.id, entryId)).toBe(!fails);
    expect(videoResume).toHaveBeenCalledTimes(1);
    expect(videoResume).toHaveBeenCalledWith("saved-video");
    expect(store.currentSession()).toEqual(before);
    expect(videoConfig).not.toHaveBeenCalled();
    expect(videoDraft).not.toHaveBeenCalled();
    expect(videoRequest).not.toHaveBeenCalled();
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
    if (fails) expect(toast).toHaveBeenCalledWith("视频查询失败，请稍后重试。");
  },
);

test("changing the editor configuration while a video retry waits cancels the saved request", async () => {
  const store = useChatStore.getState();
  selectModel("gpt-6-astra", "Custom");
  const snapshot = {
    model: "sora-2@OpenAI",
    prompt: "Original prompt",
    materials: [],
  } as unknown as VideoDraft;
  videoConfig.mockReturnValue({ duration: 12 });
  videoResults = [
    {
      id: "saved-video",
      model: "sora-2",
      prompt: snapshot.prompt,
      url: "",
      createdAt: 1,
      status: "failed",
      request: snapshot,
    },
  ];
  store.updateTargetSession(store.currentSession(), (session) => {
    session.messages = [
      createMessage({ id: "video-question", role: "user", content: "Animate" }),
      createMessage({
        id: "video-answer",
        role: "assistant",
        videoResultId: "saved-video",
      }),
    ];
  });
  const started = pendingResult<void>();
  const hydration = pendingResult<void>();
  preferencesReady = false;
  waitForPreferences.mockImplementationOnce(() => {
    started.resolve();
    return hydration.promise;
  });
  const retry = store.retryMessage(store.currentSession().id, "video-answer");
  await started.promise;
  store.updateTargetSession(store.currentSession(), (session) => {
    session.mask.modelConfig.videoConfig = { duration: 31 };
  });
  preferencesReady = true;
  hydration.resolve();
  await retry;
  expect(store.currentSession().messages.at(-1)).toMatchObject({
    content: "账号、模型或会话已变更，本次请求已取消",
    streaming: false,
    isError: true,
  });
  expect(store.currentSession().mask.modelConfig.videoConfig?.duration).toBe(
    31,
  );
  expect(videoDraft).not.toHaveBeenCalled();
  expect(videoRequest).not.toHaveBeenCalled();
  expect(chatRequest).not.toHaveBeenCalled();
});

test.each(["sync", "async"] as const)(
  "%s image generation saves its captured effective settings and reuses them after a failed gallery save",
  async (mode) => {
    capabilities.mockReturnValue({
      ...chatCapabilities,
      category: "image",
      usesImageApi: true,
    });
    selectModel("gpt-image-2.6", "OpenAI");
    const store = useChatStore.getState();
    const session = store.currentSession();
    store.updateTargetSession(session, (target) => {
      Object.assign(target.mask.modelConfig, {
        size: "16:9",
        resolution: "2k",
        quality: "high",
        style: "natural",
        imageOutputFormat: "webp",
        imageBackground: "opaque",
        imageOutputCompression: 42,
        imageResponseFormat: "url",
        imageRequestMode: mode === "async" ? "sync" : "async",
        imageStream: false,
        imagePartialImages: 1,
      });
    });
    useAppConfig.setState({
      modelConfig: {
        ...useAppConfig.getState().modelConfig,
        imageResponseFormat: "b64_json",
        imageRequestMode: mode,
        imageStream: true,
        imagePartialImages: 2,
      },
    });
    const reference = "data:image/png;base64,YQ==";
    await store.onUserInput("Original image prompt", [reference]);
    const bot = store.currentSession().messages.at(-1)!;
    const expected = {
      providerName: "OpenAI",
      size: "16:9",
      resolution: "2k",
      quality: "high",
      style: "natural",
      imageOutputFormat: "webp",
      imageBackground: "opaque",
      imageOutputCompression: 42,
      imageResponseFormat: "b64_json",
      imageRequestMode: mode,
      imageStream: mode === "sync",
      imagePartialImages: 2,
    };
    expect(bot.generation?.config).toEqual(expected);
    store.updateTargetSession(store.currentSession(), (target) => {
      target.mask.modelConfig.quality = "low";
      target.mask.modelConfig.imageOutputCompression = 90;
    });
    useAppConfig.setState({
      modelConfig: {
        ...useAppConfig.getState().modelConfig,
        imageRequestMode: mode === "async" ? "sync" : "async",
        imageStream: false,
      },
    });
    addGalleryImage.mockRejectedValueOnce(
      new Error("Gallery temporarily unavailable"),
    );
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      imageCallbacks.onComplete?.("data:image/png;base64,Yg==");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const current = () => useChatStore.getState().currentSession();
      expect(
        current().messages.find((message) => message.id === bot.id)
          ?.gallerySave,
      ).toBe("failed");
      expect(addGalleryImage.mock.calls[0][0]).toMatchObject({
        id: bot.id,
        model: "gpt-image-2.6",
        references: [reference],
        config: expected,
      });
      await useChatStore
        .getState()
        .saveGeneratedImage(
          current().id,
          bot.id,
          "data:image/png;base64,Yg==",
          "Original image prompt",
          "gpt-image-2.6",
        );
      expect(addGalleryImage).toHaveBeenCalledTimes(2);
      expect(addGalleryImage.mock.calls[1][0].config).toEqual(expected);
      expect(
        current().messages.find((message) => message.id === bot.id)
          ?.gallerySave,
      ).toBe("saved");
      expect(bot.generation?.config).toEqual(expected);
    } finally {
      log.mockRestore();
    }
  },
);

test("ordinary text replies do not receive an image configuration snapshot", async () => {
  await useChatStore.getState().onUserInput("A text-only request");
  const reply = useChatStore.getState().currentSession().messages.at(-1)!;
  expect(reply.generation).not.toHaveProperty("config");
  expect(imageRequest).not.toHaveBeenCalled();
});

test.each(["sync", "async"])(
  "%s image wallet failure keeps its model and offers recharge",
  async (mode) => {
    accountEnabled = true;
    localTokenId = 7;
    capabilities.mockReturnValue({
      ...chatCapabilities,
      category: "image",
      usesImageApi: true,
    });
    selectModel("gpt-image-2.6", "OpenAI");
    useAppConfig.setState({
      modelConfig: {
        ...useAppConfig.getState().modelConfig,
        imageRequestMode: mode as "sync" | "async",
      },
    });
    await useChatStore.getState().onUserInput("小猫");
    imageCallbacks.onError?.("Request rejected", {
      status: 403,
      body: { error: { code: "insufficient_user_quota" } },
    });
    const message = useChatStore.getState().currentSession().messages.at(-1)!;
    expect(message).toMatchObject({
      model: "gpt-image-2.6",
      quotaExceeded: true,
      isError: true,
      streaming: false,
    });
    expect(message.content).toContain("余额不足");
    expect(message.content).toContain("前往充值");
    expect(message.content).not.toContain("生图失败");
  },
);

test.each([
  ["令牌额度不足", "OpenAI"],
  ["subscription quota exhausted", "OpenAI"],
  ["余额不足", "octopus-custom"],
])(
  "%s on %s does not offer the account recharge route",
  async (error, provider) => {
    accountEnabled = true;
    localTokenId = 7;
    capabilities.mockReturnValue({
      ...chatCapabilities,
      category: "image",
      usesImageApi: true,
    });
    selectModel("gpt-image-2.6", provider);
    await useChatStore.getState().onUserInput("小猫");
    imageCallbacks.onError?.(error, new Error(error));
    const message = useChatStore.getState().currentSession().messages.at(-1)!;
    expect(message.quotaExceeded).toBe(false);
    expect(message.content).not.toContain("前往充值");
  },
);

function previewFlow() {
  const response = pendingResult<PreviewResponse | void>();
  let begin!: (options: PreviewResponseOptions) => void;
  const started = new Promise<PreviewResponseOptions>((resolve) => {
    begin = resolve;
  });
  previewResponse.mockImplementationOnce((options) => {
    begin(options);
    const abort = () => {
      const error = new Error("Local preview aborted");
      error.name = "AbortError";
      response.reject(error);
    };
    if (options.signal.aborted) abort();
    else options.signal.addEventListener("abort", abort, { once: true });
    return response.promise.finally(() =>
      options.signal.removeEventListener("abort", abort),
    );
  });
  return {
    started,
    finish: (result?: PreviewResponse) => response.resolve(result),
  };
}

test.each(["gpt-6-astra", "gpt-image-2.5", "sora-2"])(
  "preview %s does not create a turn or start material, skill or model work",
  async (model) => {
    selectModel(model, LOCAL_PREVIEW_PROVIDER);
    const messages = useChatStore.getState().currentSession().messages;
    await useChatStore.getState().onUserInput("preview input");
    expect(useChatStore.getState().currentSession().messages).toBe(messages);
    expect(waitForPreferences).not.toHaveBeenCalled();
    expect(capabilities).not.toHaveBeenCalled();
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
    expect(previewResponse).not.toHaveBeenCalled();
  },
);

test("enabled local simulation publishes a turn and streams without model, history, skill or title requests", async () => {
  localPreviewEnabled = true;
  preferencesReady = false;
  selectModel("gpt-6-astra", LOCAL_PREVIEW_PROVIDER);
  const history = jest.spyOn(chatMethods, "getMessagesWithMemory");
  const flow = previewFlow();
  const pending = useChatStore.getState().onUserInput("Local preview question");
  selectModel("gpt-image-2.5", LOCAL_PREVIEW_PROVIDER);
  try {
    const session = useChatStore.getState().currentSession();
    expect(session.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(session.messages[1]).toMatchObject({
      content: "",
      streaming: true,
      model: "gpt-6-astra",
    });
    expect(ChatControllerPool.hasPending(session.id)).toBe(true);
    const options = await flow.started;
    expect(options.model).toBe("gpt-6-astra");
    options.onUpdate("Partial local reply");
    expect(useChatStore.getState().currentSession().messages[1].content).toBe(
      "Partial local reply",
    );
    const finalText = "这是一段仅用于本地预览的模拟回复。".repeat(8);
    options.onUpdate(finalText);
    flow.finish();
    await pending;
    expect(useChatStore.getState().currentSession().messages[1]).toMatchObject({
      id: session.messages[1].id,
      content: finalText,
      streaming: false,
    });
    expect(ChatControllerPool.hasPending(session.id)).toBe(false);
    expect(waitForPreferences).not.toHaveBeenCalled();
    expect(capabilities).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(clientApi).not.toHaveBeenCalled();
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
    expect(executeMcpAction).not.toHaveBeenCalled();
  } finally {
    flow.finish();
    await pending.catch(() => {});
    history.mockRestore();
  }
});

test("local statistics stream through the real metric display without requesting a model", async () => {
  localPreviewEnabled = true;
  selectModel("local-preview-metrics", LOCAL_PREVIEW_PROVIDER);
  const flow = previewFlow();
  const pending = useChatStore.getState().onUserInput("Preview statistics");
  const options = await flow.started;
  const progress = { outputTokens: 60, durationMs: 2000 };
  options.onGenerationProgress?.(progress);
  progress.outputTokens = 999;
  const current = () => useChatStore.getState().currentSession();
  expect(getResponseMetrics(current().messages)).toMatchObject({
    outputTokensPerSecond: 30,
    speedIsEstimated: true,
    pending: true,
  });
  options.onUpdate("Completed local statistics example");
  flow.finish({
    content: "Completed local statistics example",
    responseMetrics: {
      usage: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0 },
      generationDurationMs: 2000,
    },
  });
  await pending;
  expect(current().messages.at(-1)?.generationProgress).toBeUndefined();
  expect(getResponseMetrics(current().messages)).toMatchObject({
    outputTokensPerSecond: 50,
    cacheHitPercent: 0,
    pending: false,
  });
  options.onGenerationProgress?.({ outputTokens: 200, durationMs: 3000 });
  expect(current().messages.at(-1)?.generationProgress).toBeUndefined();
  expect(chatRequest).not.toHaveBeenCalled();
  expect(clientApi).not.toHaveBeenCalled();
  expect(previewSummary).not.toHaveBeenCalled();
});

function compressionPreview(local = true) {
  localPreviewEnabled = local;
  selectModel(
    local ? "local-preview-compression" : "custom-chat",
    local ? LOCAL_PREVIEW_PROVIDER : "OpenAI",
  );
  const store = useChatStore.getState();
  store.updateTargetSession(store.currentSession(), (target) => {
    target.mask.modelConfig.compressionThreshold = 2000;
    target.mask.modelConfig.enableInjectSystemPrompts = false;
    target.mask.context = [];
    target.messages = Array.from({ length: 8 }, (_, index) =>
      createMessage({
        role: index % 2 ? "assistant" : "user",
        content: `Historical exchange ${index}. `.repeat(100),
      }),
    );
  });
  return useChatStore.getState().currentSession();
}

test("local compression uses the real context algorithm and preserves original history and global settings", async () => {
  const target = compressionPreview();
  const history = JSON.stringify(target.messages);
  const globalConfig = JSON.stringify(useAppConfig.getState().modelConfig);
  const before = estimateChatContextUsage({
    session: target,
    formatTemplate: (text) => text,
  }).thresholdPercent;
  expect(before).toBeGreaterThan(100);
  const flow = previewFlow();
  const pending = useChatStore
    .getState()
    .onUserInput("Continue the local example");
  const options = await flow.started;
  const current = () => useChatStore.getState().currentSession();
  expect(previewSummary).toHaveBeenCalledTimes(1);
  expect(previewSummary).toHaveBeenCalledWith(options.signal);
  expect(current().memoryPrompt).toContain("关键事实");
  expect(current().lastSummarizeIndex).toBe(6);
  const compressedAnswerId = current().messages.at(-1)!.id;
  expect(current().messages.at(-1)?.contextCompressed).toBe(true);
  expect(current().messages.at(-1)?.contextCompressing).toBeUndefined();
  expect(JSON.stringify(current().messages.slice(0, 8))).toBe(history);
  expect(
    estimateChatContextUsage({
      session: current(),
      formatTemplate: (text) => text,
    }).thresholdPercent,
  ).toBeLessThan(100);
  options.onUpdate("Continue with the retained facts.");
  flow.finish();
  await pending;
  expect(JSON.stringify(useAppConfig.getState().modelConfig)).toBe(
    globalConfig,
  );
  expect(chatRequest).not.toHaveBeenCalled();
  expect(clientApi).not.toHaveBeenCalled();
  expect(executeMcpAction).not.toHaveBeenCalled();

  const nextFlow = previewFlow();
  const nextPending = useChatStore
    .getState()
    .onUserInput("Another short question");
  const nextOptions = await nextFlow.started;
  nextOptions.onUpdate("Retained context still fits.");
  nextFlow.finish();
  await nextPending;
  expect(previewSummary).toHaveBeenCalledTimes(1);
  expect(current().lastSummarizeIndex).toBe(6);
  expect(current().messages.at(-1)?.contextCompressed).toBeUndefined();
  expect(
    current().messages.find((message) => message.id === compressedAnswerId)
      ?.contextCompressed,
  ).toBe(true);
});

test("stopping a local compression discards a late summary and retains every history message", async () => {
  const target = compressionPreview();
  const history = JSON.stringify(target.messages);
  const summary = pendingResult<string>();
  let startSummary!: () => void;
  const started = new Promise<void>((resolve) => {
    startSummary = resolve;
  });
  previewSummary.mockImplementationOnce(() => {
    startSummary();
    return summary.promise;
  });
  const pending = useChatStore.getState().onUserInput("Cancel compression");
  await started;
  expect(
    useChatStore.getState().currentSession().messages.at(-1)?.contextCompressed,
  ).toBeUndefined();
  expect(
    useChatStore.getState().currentSession().messages.at(-1)
      ?.contextCompressing,
  ).toBe(true);
  ChatControllerPool.stopAll();
  summary.resolve("Late summary must not replace the original history");
  await pending;
  const current = useChatStore.getState().currentSession();
  expect(current.memoryPrompt).toBe("");
  expect(current.lastSummarizeIndex).toBe(0);
  expect(JSON.stringify(current.messages.slice(0, 8))).toBe(history);
  expect(current.messages.at(-1)).toMatchObject({
    streaming: false,
    interrupted: true,
  });
  expect(current.messages.at(-1)?.contextCompressed).toBeUndefined();
  expect(current.messages.at(-1)?.contextCompressing).toBeUndefined();
  expect(previewResponse).not.toHaveBeenCalled();
  expect(chatRequest).not.toHaveBeenCalled();
  expect(clientApi).not.toHaveBeenCalled();
});

test("a failed local summary never records successful context compression", async () => {
  const original = compressionPreview();
  const history = JSON.stringify(original.messages);
  previewSummary.mockRejectedValueOnce(new Error("Local summary failed"));
  await useChatStore.getState().onUserInput("Try local compression");
  const current = useChatStore.getState().currentSession();
  expect(current.memoryPrompt).toBe("");
  expect(current.lastSummarizeIndex).toBe(0);
  expect(current.messages.at(-1)?.contextCompressed).toBeUndefined();
  expect(current.messages.at(-1)?.contextCompressing).toBeUndefined();
  expect(current.messages.at(-1)?.isError).toBe(true);
  expect(JSON.stringify(current.messages.slice(0, 8))).toBe(history);
  expect(previewResponse).not.toHaveBeenCalled();
});

test.each(["inactive-memory", "media-only"] as const)(
  "local %s context changes do not falsely record compression",
  async (kind) => {
    compressionPreview();
    const store = useChatStore.getState();
    store.updateTargetSession(store.currentSession(), (target) => {
      target.memoryPrompt =
        kind === "inactive-memory" ? "Old inactive memory" : "";
      target.lastSummarizeIndex = 0;
      target.messages = [
        createMessage({
          role: "user",
          content:
            kind === "inactive-memory"
              ? "Short question"
              : [
                  {
                    type: "image_url",
                    image_url: { url: "data:image/png;base64,AA==" },
                  },
                ],
        }),
        createMessage({
          role: "assistant",
          content:
            kind === "inactive-memory"
              ? "Short reply"
              : [
                  {
                    type: "image_url",
                    image_url: { url: "data:image/png;base64,AA==" },
                  },
                ],
        }),
      ];
    });
    const flow = previewFlow();
    const pending = store.onUserInput("Continue");
    await flow.started;
    expect(previewSummary).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().currentSession().messages.at(-1)
        ?.contextCompressed,
    ).toBeUndefined();
    expect(
      useChatStore.getState().currentSession().messages.at(-1)
        ?.contextCompressing,
    ).toBeUndefined();
    flow.finish();
    await pending;
  },
);

test("local summary cleanup clears running state even after the answer is marked stopped", async () => {
  compressionPreview();
  const summary = pendingResult<string>();
  const started = pendingResult<void>();
  previewSummary.mockImplementationOnce(() => {
    started.resolve();
    return summary.promise;
  });
  const store = useChatStore.getState();
  const pending = store.onUserInput("Stop while compressing");
  await started.promise;
  expect(
    useChatStore.getState().currentSession().messages.at(-1)
      ?.contextCompressing,
  ).toBe(true);
  store.updateTargetSession(store.currentSession(), (target) => {
    target.messages.at(-1)!.streaming = false;
  });
  ChatControllerPool.stopAll();
  summary.resolve("A late summary");
  await pending;
  const current = useChatStore.getState().currentSession();
  expect(current.memoryPrompt).toBe("");
  expect(current.messages.at(-1)?.contextCompressing).toBeUndefined();
  expect(current.messages.at(-1)?.contextCompressed).toBeUndefined();
});

function postReplyCompressionSession(local = false, failedMaterial = false) {
  const original = compressionPreview(local);
  const store = useChatStore.getState();
  store.updateTargetSession(original, (target) => {
    target.topic = "Compression lifecycle test";
    target.messages = Array.from({ length: 8 }, (_, index) =>
      createMessage({
        role: index % 2 ? "assistant" : "user",
        content: `seed-${index} ${"x".repeat(849)}`,
      }),
    );
    if (failedMaterial)
      target.messages.unshift(
        createMessage({
          role: "user",
          content: "An older failed material",
          materialStatus: "failed",
        }),
      );
  });
  return useChatStore.getState().currentSession();
}

async function beginPostReplyCompression(failedMaterial = false) {
  const session = postReplyCompressionSession(false, failedMaterial);
  const started = pendingResult<any>();
  chatRequest.mockImplementation(async (options) => {
    if (options.config.stream === false) started.resolve(options);
  });
  const store = useChatStore.getState();
  await store.onUserInput("Continue");
  const answer = chatRequest.mock.calls.at(-1)![0];
  const reply = "Complete observation. ".repeat(8);
  answer.onFinish(reply, { ok: true });
  const summary = await started.promise;
  return {
    store,
    sessionId: session.id,
    reply,
    bot: useChatStore.getState().currentSession().messages.at(-1)!,
    summary,
  };
}

test.each([false, true])(
  "completed output crossing 90 percent compresses in the background (old failed material: %s)",
  async (failedMaterial) => {
    const { sessionId, bot, reply, summary } =
      await beginPostReplyCompression(failedMaterial);
    expect(bot.content).toBe(reply);
    expect(bot.streaming).toBe(false);
    expect(bot.contextCompressing).toBe(true);
    expect(bot.contextCompressed).toBeUndefined();
    expect(isContextCompressionActive(sessionId, bot.id)).toBe(true);
    expect(ChatControllerPool.hasPending(sessionId)).toBe(false);
    summary.onFinish("Retained observations.", { ok: true });
    await waitForContextCompression(
      localOwner,
      sessionId,
      new AbortController().signal,
    );
    expect(bot.content).toBe(reply);
    expect(bot.streaming).toBe(false);
    expect(bot.contextCompressing).toBeUndefined();
    expect(bot.contextCompressed).toBe(true);
    expect(isContextCompressionActive(sessionId, bot.id)).toBe(false);
    expect(useChatStore.getState().currentSession().memoryPrompt).toBe(
      "Retained observations.",
    );
    expect(ChatControllerPool.hasPending(sessionId)).toBe(false);
  },
);

test("the next submitted turn joins background compression without duplicating its user input", async () => {
  const { store, sessionId, bot, summary } = await beginPostReplyCompression();
  const pending = store.onUserInput("FOLLOW_UP_UNIQUE");
  const submitted = useChatStore.getState().currentSession().messages;
  expect(submitted.at(-2)?.content).toEqual(
    expect.arrayContaining([{ type: "text", text: "FOLLOW_UP_UNIQUE" }]),
  );
  expect(submitted.at(-1)?.streaming).toBe(true);
  expect(chatRequest).toHaveBeenCalledTimes(2);
  summary.onFinish("Retained observations.", { ok: true });
  await pending;
  expect(chatRequest).toHaveBeenCalledTimes(3);
  expect(
    chatRequest.mock.calls.filter(
      ([options]) => options.config.stream === false,
    ),
  ).toHaveLength(1);
  const sent = JSON.stringify(chatRequest.mock.calls.at(-1)![0].messages);
  expect(sent.split("FOLLOW_UP_UNIQUE")).toHaveLength(2);
  expect(sent).toContain("Retained observations.");
  expect(sent).not.toContain("seed-0");
  expect(bot.contextCompressed).toBe(true);
  expect(isContextCompressionActive(sessionId, bot.id)).toBe(false);
});

test("an older streaming answer can change and finish while another turn compresses its captured history", async () => {
  postReplyCompressionSession();
  const started = pendingResult<any>();
  chatRequest.mockImplementation(async (options) => {
    if (options.config.stream === false) started.resolve(options);
  });
  const store = useChatStore.getState();
  await store.onUserInput("First request");
  const first = chatRequest.mock.calls[0][0];
  first.onUpdate("First partial output");
  const pending = store.onUserInput(`SECOND_CONCURRENT ${"q".repeat(500)}`);
  const summary = await started.promise;
  first.onUpdate("First output changes while the next turn summarizes");
  first.onFinish("First output completes during the next summary", {
    ok: true,
  });
  summary.onFinish("Retain the captured historical facts.", { ok: true });
  await pending;
  expect(chatRequest).toHaveBeenCalledTimes(3);
  const next = chatRequest.mock.calls.at(-1)![0];
  expect(next.config.stream).toBe(true);
  const sent = JSON.stringify(next.messages);
  expect(sent).toContain("SECOND_CONCURRENT");
  expect(sent).not.toContain("First partial output");
  expect(sent).not.toContain("First output changes");
  expect(sent).not.toContain("First output completes");
  expect(
    useChatStore.getState().currentSession().messages.at(-1)?.isError,
  ).toBeUndefined();
});

test("stopping a newly submitted turn cancels its join without modifying the completed answer", async () => {
  const { store, sessionId, bot, reply, summary } =
    await beginPostReplyCompression();
  const pending = store.onUserInput("Cancel this waiting question");
  const waitingId = useChatStore
    .getState()
    .currentSession()
    .messages.at(-1)!.id;
  ChatControllerPool.stop(sessionId, waitingId);
  await pending;
  expect(bot.content).toBe(reply);
  expect(bot.streaming).toBe(false);
  expect(bot.interrupted).toBeUndefined();
  expect(isContextCompressionActive(sessionId, bot.id)).toBe(true);
  expect(chatRequest).toHaveBeenCalledTimes(2);
  summary.onFinish("Retained observations.", { ok: true });
  await waitForContextCompression(
    localOwner,
    sessionId,
    new AbortController().signal,
  );
});

test("failed background compression preserves completed text, success state and final metrics", async () => {
  const { sessionId, bot, reply, summary } = await beginPostReplyCompression();
  const before = JSON.stringify({
    content: bot.content,
    responseMetrics: bot.responseMetrics,
    isError: bot.isError,
    interrupted: bot.interrupted,
  });
  summary.onError(new Error("Background summary failed"));
  await waitForContextCompression(
    localOwner,
    sessionId,
    new AbortController().signal,
  );
  expect(bot.content).toBe(reply);
  expect(
    JSON.stringify({
      content: bot.content,
      responseMetrics: bot.responseMetrics,
      isError: bot.isError,
      interrupted: bot.interrupted,
    }),
  ).toBe(before);
  expect(bot.contextCompressing).toBeUndefined();
  expect(bot.contextCompressed).toBeUndefined();
  expect(useChatStore.getState().currentSession().memoryPrompt).toBe("");
});

test.each(["clear", "model", "branch", "edit", "owner"] as const)(
  "%s changes invalidate an outstanding background summary",
  async (change) => {
    const { store, sessionId, bot, summary } =
      await beginPostReplyCompression();
    const owner = localOwner;
    if (change === "clear") store.resetSession(store.currentSession());
    else if (change === "model") selectModel("another-model", "OpenAI");
    else if (change === "owner") localOwner = "another-user";
    else
      store.updateTargetSession(store.currentSession(), (target) => {
        if (change === "branch") target.messages = target.messages.slice(0, -1);
        else target.messages[0].content = "The original facts were edited";
      });
    summary.onFinish("Stale facts must not commit", { ok: true });
    await waitForContextCompression(
      owner,
      sessionId,
      new AbortController().signal,
    );
    expect(useChatStore.getState().currentSession().memoryPrompt).toBe("");
    expect(bot.contextCompressed).toBeUndefined();
    expect(isContextCompressionActive(sessionId, bot.id)).toBe(false);
  },
);

test("local simulated output also triggers post-reply compression without model requests", async () => {
  const session = postReplyCompressionSession(true);
  const summary = pendingResult<string>();
  const started = pendingResult<void>();
  previewSummary.mockImplementationOnce(() => {
    started.resolve();
    return summary.promise;
  });
  const flow = previewFlow();
  const pending = useChatStore.getState().onUserInput("Continue");
  const options = await flow.started;
  expect(previewSummary).not.toHaveBeenCalled();
  const reply = "Complete observation. ".repeat(8);
  options.onUpdate(reply);
  flow.finish({ content: reply });
  await pending;
  await started.promise;
  const bot = useChatStore.getState().currentSession().messages.at(-1)!;
  expect(bot.streaming).toBe(false);
  expect(bot.contextCompressing).toBe(true);
  expect(ChatControllerPool.hasPending(session.id)).toBe(false);
  summary.resolve("Local retained observations");
  await waitForContextCompression(
    localOwner,
    session.id,
    new AbortController().signal,
  );
  expect(bot.contextCompressed).toBe(true);
  expect(bot.contextCompressing).toBeUndefined();
  expect(bot.content).toBe(reply);
  expect(chatRequest).not.toHaveBeenCalled();
  expect(clientApi).not.toHaveBeenCalled();
});

test("local component reasoning stays with its own turn and completed tools remain static", async () => {
  localPreviewEnabled = true;
  preferencesReady = false;
  mcpEnabled = true;
  selectModel("gpt-6-astra", LOCAL_PREVIEW_PROVIDER);
  const store = useChatStore.getState();
  const originalMethods = {
    getMessagesWithMemory: store.getMessagesWithMemory,
    summarizeSession: store.summarizeSession,
    checkMcpJson: store.checkMcpJson,
  };
  const history = jest.fn(originalMethods.getMessagesWithMemory);
  const title = jest.fn(originalMethods.summarizeSession);
  const mcp = jest.fn(originalMethods.checkMcpJson);
  useChatStore.setState({
    getMessagesWithMemory: history,
    summarizeSession: title,
    checkMcpJson: mcp,
  });
  const first = previewFlow();
  const firstPending = store.onUserInput("First component preview");
  let second: ReturnType<typeof previewFlow> | undefined;
  let secondPending: Promise<void> | undefined;
  try {
    const firstOptions = await first.started;
    const firstBotId = useChatStore.getState().currentSession().messages[1].id;
    expect(firstOptions.onReasoning).toEqual(expect.any(Function));
    firstOptions.onReasoning?.("First reasoning");
    firstOptions.onReasoning?.("First reasoning grows");
    expect(useChatStore.getState().currentSession().messages[1]).toMatchObject({
      id: firstBotId,
      content: "",
      reasoning: "First reasoning grows",
      streaming: true,
    });

    second = previewFlow();
    secondPending = store.onUserInput("Second component preview");
    const secondOptions = await second.started;
    const secondBotId = useChatStore.getState().currentSession().messages[3].id;
    secondOptions.onReasoning?.("Second reasoning");
    firstOptions.onReasoning?.("First reasoning grows independently");
    const streaming = useChatStore.getState().currentSession().messages;
    expect(streaming[1].reasoning).toBe("First reasoning grows independently");
    expect(streaming[3]).toMatchObject({
      id: secondBotId,
      reasoning: "Second reasoning",
      content: "",
      streaming: true,
    });
    expect(streaming[0].reasoning).toBeUndefined();
    expect(streaming[2].reasoning).toBeUndefined();

    const content =
      '```json:mcp:client-1\n{"method":"tools/call","params":{"name":"lookup","arguments":{"query":"preview"}}}\n```';
    const tools: NonNullable<ChatMessage["tools"]> = [
      {
        id: "static-preview-tool",
        clientId: "client-1",
        type: "mcp",
        function: { name: "lookup", arguments: '{"query":"preview"}' },
        content: '{"results":[{"title":"Local fixture"}]}',
      },
    ];
    firstOptions.onUpdate(content);
    expect(
      useChatStore.getState().currentSession().messages[1].tools,
    ).toBeUndefined();
    first.finish({
      content,
      reasoning: "First reasoning grows independently",
      tools,
    });
    await firstPending;
    const completed = useChatStore.getState().currentSession();
    expect(completed.messages[1]).toMatchObject({
      id: firstBotId,
      content,
      reasoning: "First reasoning grows independently",
      tools,
      streaming: false,
    });
    expect(completed.messages[3].tools).toBeUndefined();
    expect(completed.messages[3].streaming).toBe(true);

    firstOptions.onReasoning?.("Late reasoning for a completed turn");
    secondOptions.onReasoning?.("Second reasoning continues");
    secondOptions.onUpdate("Second local answer");
    second.finish({
      content: "Second local answer",
      reasoning: "Second reasoning continues",
    });
    await secondPending;
    const final = useChatStore.getState().currentSession();
    expect(final.messages[1].reasoning).toBe(
      "First reasoning grows independently",
    );
    expect(final.messages[3]).toMatchObject({
      id: secondBotId,
      content: "Second local answer",
      reasoning: "Second reasoning continues",
      streaming: false,
    });
    expect(ChatControllerPool.hasPending(final.id)).toBe(false);
    expect(waitForPreferences).not.toHaveBeenCalled();
    expect(capabilities).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(title).not.toHaveBeenCalled();
    expect(mcp).not.toHaveBeenCalled();
    expect(clientApi).not.toHaveBeenCalled();
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
    expect(executeMcpAction).not.toHaveBeenCalled();
  } finally {
    first.finish();
    second?.finish();
    await Promise.allSettled(
      secondPending ? [firstPending, secondPending] : [firstPending],
    );
    useChatStore.setState(originalMethods);
  }
});

test.each([
  { mode: "development", enabled: true },
  { mode: "production", enabled: false },
] as const)(
  "preview providers block manual title generation in $mode",
  ({ mode, enabled }) => {
    const environment = jest.replaceProperty(process.env, "NODE_ENV", mode);
    try {
      localPreviewEnabled = enabled;
      selectModel("gpt-6-astra", LOCAL_PREVIEW_PROVIDER);
      const store = useChatStore.getState();
      store.updateTargetSession(store.currentSession(), (session) => {
        session.messages = [
          createMessage({
            role: "user",
            content: "Preview question".repeat(8),
          }),
          createMessage({
            role: "assistant",
            content: "Local answer".repeat(8),
          }),
        ];
      });
      const session = useChatStore.getState().currentSession();
      const topic = session.topic;
      store.summarizeSession(true, session);
      expect(useChatStore.getState().currentSession().topic).toBe(topic);
      expect(clientApi).not.toHaveBeenCalled();
      expect(chatRequest).not.toHaveBeenCalled();
      expect(imageRequest).not.toHaveBeenCalled();
      expect(executeMcpAction).not.toHaveBeenCalled();
    } finally {
      environment.restore();
    }
  },
);

test("local simulation waits for material readiness and retains image and original file content", async () => {
  localPreviewEnabled = true;
  preferencesReady = false;
  selectModel("gpt-6-astra", LOCAL_PREVIEW_PROVIDER);
  const image = pendingResult<string>();
  const file = pendingResult<ParsedFile>();
  const imageUrl = "data:image/png;base64,aW1hZ2U=";
  const parsedFile: ParsedFile = {
    name: "preview.pdf",
    type: "application/pdf",
    size: 3,
    content: "data:application/pdf;base64,cGRm",
    isText: false,
  };
  const preparation = createMaterialUpload({
    loadImage: () => image.promise,
    loadFile: () => file.promise,
    imageLimitError: "Too many images",
  });
  const batch = preparation.add([
    new File(["image"], "preview.png", { type: "image/png" }),
    new File(["pdf"], parsedFile.name, { type: parsedFile.type }),
  ]);
  const history = jest.spyOn(chatMethods, "getMessagesWithMemory");
  const flow = previewFlow();
  const pending = useChatStore
    .getState()
    .onUserInput(
      "Use these materials",
      [],
      false,
      { text: "Use these materials", files: [] },
      undefined,
      preparation,
    );
  try {
    const submitted = useChatStore.getState().currentSession().messages;
    expect(submitted.map((message) => message.materialStatus)).toEqual([
      "processing",
      "processing",
    ]);
    const ids = submitted.map((message) => message.id);
    expect(previewResponse).not.toHaveBeenCalled();
    image.resolve(imageUrl);
    await Promise.resolve();
    expect(previewResponse).not.toHaveBeenCalled();
    file.resolve(parsedFile);
    await batch;
    const options = await flow.started;
    const prepared = useChatStore.getState().currentSession().messages;
    expect(prepared.map((message) => message.id)).toEqual(ids);
    expect(prepared[0].materialStatus).toBeUndefined();
    expect(prepared[0].composerInput).toEqual({
      text: "Use these materials",
      files: [parsedFile],
    });
    expect(prepared[0].content).toEqual(
      expect.arrayContaining([
        { type: "image_url", image_url: { url: imageUrl } },
        {
          type: "file",
          file: { filename: parsedFile.name, file_data: parsedFile.content },
        },
      ]),
    );
    options.onUpdate("Local material preview");
    flow.finish();
    await pending;
    expect(useChatStore.getState().currentSession().messages[1]).toMatchObject({
      id: ids[1],
      content: "Local material preview",
      streaming: false,
    });
    expect(waitForPreferences).not.toHaveBeenCalled();
    expect(capabilities).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
  } finally {
    image.resolve(imageUrl);
    file.resolve(parsedFile);
    flow.finish();
    await batch;
    await pending.catch(() => {});
    history.mockRestore();
  }
});

test("local material preparation can be stopped and retried without starting a model request", async () => {
  localPreviewEnabled = true;
  selectModel("gpt-6-astra", LOCAL_PREVIEW_PROVIDER);
  const firstImage = pendingResult<string>();
  const imageUrl = "data:image/png;base64,aW1hZ2U=";
  const loadImage = jest
    .fn<() => Promise<string>>()
    .mockReturnValueOnce(firstImage.promise)
    .mockResolvedValue(imageUrl);
  const preparation = createMaterialUpload({
    loadImage,
    loadFile: async () => {
      throw new Error("No document is present");
    },
    imageLimitError: "Too many images",
  });
  const batch = preparation.add([
    new File(["image"], "retry-preview.png", { type: "image/png" }),
  ]);
  const flow = previewFlow();
  const pending = useChatStore
    .getState()
    .onUserInput(
      "Cancel material preparation",
      [],
      false,
      { text: "Cancel material preparation", files: [] },
      undefined,
      preparation,
    );
  try {
    const session = useChatStore.getState().currentSession();
    const ids = session.messages.map((message) => message.id);
    expect(session.messages[0].materialStatus).toBe("processing");
    expect(previewResponse).not.toHaveBeenCalled();
    ChatControllerPool.stop(session.id, ids[1]);
    await pending;
    const stopped = useChatStore.getState().currentSession().messages;
    expect(stopped.map((message) => message.id)).toEqual(ids);
    expect(stopped[0].materialStatus).toBe("failed");
    expect(stopped[1]).toMatchObject({
      materialStatus: "failed",
      streaming: false,
    });
    expect(preparation.getSnapshot().pending).toBe(0);
    expect(previewResponse).not.toHaveBeenCalled();
    expect(ChatControllerPool.hasPending(session.id)).toBe(false);
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();

    firstImage.resolve(imageUrl);
    await batch;
    const retry = useChatStore
      .getState()
      .retryPreparedMaterials(session.id, ids[0]);
    try {
      const options = await flow.started;
      options.onUpdate("Retried local material preview");
      flow.finish();
      await retry;
      const completed = useChatStore.getState().currentSession().messages;
      expect(completed.map((message) => message.id)).toEqual(ids);
      expect(completed[0].materialStatus).toBeUndefined();
      expect(completed[1]).toMatchObject({
        content: "Retried local material preview",
        streaming: false,
      });
      expect(chatRequest).not.toHaveBeenCalled();
      expect(imageRequest).not.toHaveBeenCalled();
      expect(ChatControllerPool.hasPending(session.id)).toBe(false);
    } finally {
      flow.finish();
      await retry.catch(() => {});
    }
  } finally {
    firstImage.resolve(imageUrl);
    flow.finish();
    await batch;
    await pending.catch(() => {});
  }
});

test("stopping local simulation preserves partial text and blocks late updates", async () => {
  localPreviewEnabled = true;
  selectModel("gpt-6-astra", LOCAL_PREVIEW_PROVIDER);
  const flow = previewFlow();
  const pending = useChatStore.getState().onUserInput("Stop local preview");
  try {
    const options = await flow.started;
    const session = useChatStore.getState().currentSession();
    const botId = session.messages[1].id;
    options.onUpdate("Already visible");
    options.onReasoning?.("Already visible reasoning");
    ChatControllerPool.stop(session.id, botId);
    await pending;
    options.onUpdate("Late text must not appear");
    options.onReasoning?.("Late reasoning must not appear");
    expect(useChatStore.getState().currentSession().messages[1]).toMatchObject({
      id: botId,
      content: "Already visible",
      reasoning: "Already visible reasoning",
      streaming: false,
      interrupted: true,
    });
    expect(ChatControllerPool.hasPending(session.id)).toBe(false);
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
  } finally {
    flow.finish();
    await pending.catch(() => {});
  }
});

test.each(["scope", "workspace", "delete"])(
  "local simulation cannot publish late text or reasoning after %s",
  async (action) => {
    localPreviewEnabled = true;
    selectModel("gpt-6-astra", LOCAL_PREVIEW_PROVIDER);
    const flow = previewFlow();
    const pending = useChatStore.getState().onUserInput("Scoped local preview");
    try {
      const options = await flow.started;
      const session = useChatStore.getState().currentSession();
      const botId = session.messages[1].id;
      options.onReasoning?.("Reasoning before the transition");
      const before = JSON.stringify(session.messages);
      if (action === "scope") localOwner = "user-8";
      else if (action === "workspace") localActive = false;
      else useChatStore.getState().deleteMessage(session.id, botId);
      options.onUpdate("Late text must not appear");
      options.onReasoning?.("Late reasoning must not appear");
      flow.finish();
      await pending;
      const current = useChatStore.getState().currentSession();
      if (action === "scope" || action === "workspace")
        expect(JSON.stringify(current.messages)).toBe(before);
      else
        expect(current.messages.some((message) => message.id === botId)).toBe(
          false,
        );
      expect(JSON.stringify(current.messages)).not.toContain("Late text");
      expect(ChatControllerPool.hasPending(session.id)).toBe(false);
      expect(chatRequest).not.toHaveBeenCalled();
      expect(imageRequest).not.toHaveBeenCalled();
    } finally {
      flow.finish();
      await pending.catch(() => {});
    }
  },
);

test("local preview retry creates another answer without duplicating its user or requesting a model", async () => {
  localPreviewEnabled = true;
  selectModel("gpt-6-astra", LOCAL_PREVIEW_PROVIDER);
  const first = previewFlow();
  const pending = useChatStore.getState().onUserInput("Retry local preview");
  try {
    const options = await first.started;
    options.onUpdate("First local answer");
    first.finish();
    await pending;
    const session = useChatStore.getState().currentSession();
    const userId = session.messages[0].id;
    const firstBotId = session.messages[1].id;
    const second = previewFlow();
    const retried = useChatStore
      .getState()
      .retryMessage(session.id, firstBotId);
    try {
      const retryOptions = await second.started;
      const retry = useChatStore.getState().currentSession();
      expect(retry.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(retry.messages[0].id).toBe(userId);
      expect(retry.messages[1].id).not.toBe(firstBotId);
      retryOptions.onUpdate("Second local answer");
      second.finish();
      await expect(retried).resolves.toBe(true);
      const completed = useChatStore.getState().currentSession();
      expect(completed.messages[1]).toMatchObject({
        content: "Second local answer",
        streaming: false,
      });
      expect(
        useChatStore
          .getState()
          .getMessageBranches(session.id, completed.messages[1].id),
      ).toMatchObject({ total: 2, index: 1, disabled: false });
      expect(chatRequest).not.toHaveBeenCalled();
      expect(imageRequest).not.toHaveBeenCalled();
      expect(ChatControllerPool.hasPending(session.id)).toBe(false);
    } finally {
      second.finish();
      await retried.catch(() => {});
    }
  } finally {
    first.finish();
    await pending.catch(() => {});
  }
});

test("initial sends wait for saved model corrections before choosing a request route", async () => {
  let finishHydration!: () => void;
  preferencesReady = false;
  waitForPreferences.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishHydration = resolve;
    }),
  );
  selectModel("user-corrected-alias", "Custom");
  const pending = useChatStore.getState().onUserInput("hello");
  expect(waitForPreferences).toHaveBeenCalledTimes(1);
  expect(capabilities).not.toHaveBeenCalled();
  expect(chatRequest).not.toHaveBeenCalled();

  preferencesReady = true;
  finishHydration();
  await pending;
  expect(capabilities).toHaveBeenCalledWith("user-corrected-alias", "Custom");
  expect(chatRequest).toHaveBeenCalledTimes(1);
  expect(chatRequest.mock.calls[0][0]).toMatchObject({
    modelCapabilities: { category: "chat", override: "chat" },
    config: { model: "user-corrected-alias", providerName: "Custom" },
  });
});

test("history preparation publishes the submitted turn immediately and sends its user message once", async () => {
  const originalHistory = chatMethods.getMessagesWithMemory;
  let releaseHistory!: (messages: ChatMessage[]) => void;
  const history = new Promise<ChatMessage[]>((resolve) => {
    releaseHistory = resolve;
  });
  let capturedHistory: ChatMessage[] = [];
  chatMethods.getMessagesWithMemory = (session) => {
    capturedHistory = session!.messages
      .filter((message) => !message.streaming)
      .slice();
    return history;
  };
  const pending = useChatStore
    .getState()
    .onUserInput("Immediate submitted turn");
  try {
    const submitted = useChatStore.getState().currentSession().messages;
    expect(submitted.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(submitted[0].content).toEqual([
      { type: "text", text: "Immediate submitted turn" },
    ]);
    expect(submitted[1].streaming).toBe(true);
    expect(chatRequest).not.toHaveBeenCalled();
    const ids = submitted.map((message) => message.id);

    releaseHistory(capturedHistory);
    await pending;
    expect(chatRequest).toHaveBeenCalledTimes(1);
    const options = chatRequest.mock.calls[0][0];
    expect(options.messages).toEqual([
      interactionPromptMessage(submitted[1].id),
      {
        role: "user",
        content: [{ type: "text", text: "Immediate submitted turn" }],
      },
    ]);
    options.onUpdate("Immediate answer", "Immediate answer");
    options.onFinish("Immediate answer", { ok: true });
    const completed = useChatStore.getState().currentSession().messages;
    expect(completed.map((message) => message.id)).toEqual(ids);
    expect(completed[1]).toMatchObject({
      content: "Immediate answer",
      streaming: false,
    });
  } finally {
    releaseHistory(capturedHistory);
    await pending.catch(() => {});
    chatMethods.getMessagesWithMemory = originalHistory;
  }
});

test("history preparation can be stopped without starting a model request", async () => {
  const originalHistory = chatMethods.getMessagesWithMemory;
  let releaseHistory!: (messages: ChatMessage[]) => void;
  const history = new Promise<ChatMessage[]>((resolve) => {
    releaseHistory = resolve;
  });
  chatMethods.getMessagesWithMemory = () => history;
  const pending = useChatStore.getState().onUserInput("Stop during history");
  try {
    const session = useChatStore.getState().currentSession();
    expect(session.messages).toHaveLength(2);
    const ids = session.messages.map((message) => message.id);
    expect(ChatControllerPool.hasPending(session.id)).toBe(true);
    ChatControllerPool.stop(session.id, session.messages[1].id);
    releaseHistory([]);
    await pending;

    const stopped = useChatStore.getState().currentSession().messages;
    expect(stopped.map((message) => message.id)).toEqual(ids);
    expect(stopped[1].streaming).toBe(false);
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
    expect(ChatControllerPool.hasPending(session.id)).toBe(false);
  } finally {
    releaseHistory([]);
    await pending.catch(() => {});
    chatMethods.getMessagesWithMemory = originalHistory;
  }
});

test("history preparation failures finish the original bot without duplicating the submitted turn", async () => {
  const originalHistory = chatMethods.getMessagesWithMemory;
  let releaseHistory!: (messages: ChatMessage[]) => void;
  let failHistory!: (error: Error) => void;
  const history = new Promise<ChatMessage[]>((resolve, reject) => {
    releaseHistory = resolve;
    failHistory = reject;
  });
  const readHistory = jest
    .fn<() => Promise<ChatMessage[]>>()
    .mockReturnValue(history);
  chatMethods.getMessagesWithMemory = readHistory;
  const pending = useChatStore.getState().onUserInput("Preserve failed turn");
  try {
    const session = useChatStore.getState().currentSession();
    expect(session.messages).toHaveLength(2);
    expect(readHistory).toHaveBeenCalledTimes(1);
    const ids = session.messages.map((message) => message.id);
    failHistory(new Error("History preparation failed"));
    await expect(pending).resolves.toBeUndefined();

    const failed = useChatStore.getState().currentSession().messages;
    expect(failed.map((message) => message.id)).toEqual(ids);
    expect(failed[1]).toMatchObject({ streaming: false, isError: true });
    expect(failed[1].content).not.toBe("");
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
    expect(ChatControllerPool.hasPending(session.id)).toBe(false);
  } finally {
    releaseHistory([]);
    await pending.catch(() => {});
    chatMethods.getMessagesWithMemory = originalHistory;
  }
});

test.each([false, true])(
  "native reasoning fallback changes only the captured interface (changed: %s)",
  async (changed) => {
    selectModel("native-alias", "Custom");
    const store = useChatStore.getState();
    store.updateTargetSession(store.currentSession(), (session) => {
      session.mask.modelConfig.reasoningEffort = "ultra";
    });
    capabilities.mockReturnValue({ ...chatCapabilities, apiFormat: "gemini" });
    await useChatStore.getState().onUserInput("analyze this");
    expect(chatRequest).toHaveBeenCalledTimes(1);
    const fallback = chatRequest.mock.calls[0][0].onReasoningFallback;
    expect(fallback).toEqual(expect.any(Function));
    if (changed)
      capabilities.mockReturnValue({
        ...chatCapabilities,
        apiFormat: "responses",
      });
    expect(fallback()).toBe(!changed);
    expect(
      useChatStore.getState().currentSession().mask.modelConfig.reasoningEffort,
    ).toBe(changed ? "ultra" : "auto");
  },
);

test("model preference read failures preserve the submitted text and report an error without a request", async () => {
  preferencesReady = false;
  waitForPreferences.mockRejectedValueOnce(new Error("模型类型设置读取失败"));
  await useChatStore.getState().onUserInput("preserve this draft");
  expect(capabilities).not.toHaveBeenCalled();
  expect(chatRequest).not.toHaveBeenCalled();
  const messages = useChatStore.getState().currentSession().messages;
  expect(messages[0]).toMatchObject({
    role: "user",
    content: [{ type: "text", text: "preserve this draft" }],
  });
  expect(messages[1]).toMatchObject({
    role: "assistant",
    isError: true,
    streaming: false,
    content: "模型类型设置读取失败",
  });
});

test("changing the original chat model while preferences load cancels rather than sending the new model", async () => {
  let finishHydration!: () => void;
  preferencesReady = false;
  waitForPreferences.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishHydration = resolve;
    }),
  );
  selectModel("original-alias", "Custom");
  const pending = useChatStore.getState().onUserInput("hello");
  selectModel("replacement-alias", "Custom");
  preferencesReady = true;
  finishHydration();
  await pending;
  expect(capabilities).not.toHaveBeenCalled();
  expect(chatRequest).not.toHaveBeenCalled();
  const messages = useChatStore.getState().currentSession().messages;
  expect(messages.at(-1)).toMatchObject({
    model: "original-alias",
    isError: true,
    content: "账号、模型或会话已变更，本次请求已取消",
  });
});

test("accepted material uploads retain their image route when the user later corrects the model to chat", async () => {
  let prepared!: (result: { images: string[]; files: [] }) => void;
  const preparation: MaterialPreparation = {
    getSnapshot: () => ({
      items: [
        {
          id: "photo",
          name: "photo.png",
          type: "image/png",
          size: 1,
          status: "processing",
        },
      ],
      images: [],
      files: [],
      pending: 1,
    }),
    subscribe: () => () => {},
    wait: () =>
      new Promise((resolve) => {
        prepared = resolve;
      }),
    retry() {},
    cancel() {},
  };
  const captured: ModelCapabilities = {
    ...chatCapabilities,
    category: "image",
    usesImageApi: true,
    override: "image",
  };
  capabilities.mockReturnValue(captured);
  selectModel("corrected-image-alias", "Custom");
  const pending = useChatStore
    .getState()
    .onUserInput(
      "restore this photo",
      [],
      false,
      undefined,
      undefined,
      preparation,
    );
  expect(capabilities).toHaveBeenCalledTimes(1);
  expect(imageRequest).not.toHaveBeenCalled();
  expect(chatRequest).not.toHaveBeenCalled();

  capabilities.mockReturnValue(chatCapabilities);
  prepared({ images: ["data:image/png;base64,YQ=="], files: [] });
  await pending;
  expect(chatRequest).not.toHaveBeenCalled();
  expect(imageRequest).toHaveBeenCalledTimes(1);
  expect(imageRequest.mock.calls[0][0]).toMatchObject({
    modelCapabilities: captured,
    config: { model: "corrected-image-alias", providerName: "Custom" },
  });
});

test("accepted materials keep the captured interface when the saved model interface changes during preparation", async () => {
  let complete!: (result: { images: string[]; files: [] }) => void;
  const preparation: MaterialPreparation = {
    getSnapshot: () => ({
      items: [],
      images: [],
      files: [],
      pending: 1,
    }),
    subscribe: () => () => {},
    wait: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    retry() {},
    cancel() {},
  };
  const captured: ModelCapabilities = {
    ...chatCapabilities,
    apiFormat: "gemini",
  };
  capabilities.mockReturnValue(captured);
  selectModel("native-gemini-alias", "Custom");
  const pending = useChatStore
    .getState()
    .onUserInput(
      "read this material",
      [],
      false,
      undefined,
      undefined,
      preparation,
    );
  expect(chatRequest).not.toHaveBeenCalled();
  capabilities.mockReturnValue({ ...chatCapabilities, apiFormat: "responses" });
  complete({ images: [], files: [] });
  await pending;
  expect(chatRequest).toHaveBeenCalledTimes(1);
  expect(chatRequest.mock.calls[0][0]).toMatchObject({
    modelCapabilities: captured,
    config: { model: "native-gemini-alias", providerName: "Custom" },
  });
});

test("new chats inherit only the current model and provider", () => {
  selectModel("chosen-model", "Custom");
  const store = useChatStore.getState();
  const previous = store.currentSession();
  store.updateTargetSession(previous, (session) => {
    session.topic = "Existing chat";
    session.activeSkillId = "old-skill";
    session.memoryPrompt = "Old memory";
    session.messages.push(createMessage({ content: "Old message" }));
    session.mask.name = "Existing mask";
    session.mask.context.push(createMessage({ content: "Old prompt" }));
    session.mask.modelConfig.temperature = 1.8;
    session.mask.modelConfig.max_tokens = 2000;
    session.mask.modelConfig.reasoningEffort = "high";
    session.mask.modelConfig.chatApiFormat = "responses";
  });

  store.newSession();
  const current = useChatStore.getState().currentSession();
  expect(current.mask.modelConfig).toEqual({
    ...useAppConfig.getState().modelConfig,
    model: "chosen-model",
    providerName: "Custom",
  });
  expect(current.mask.syncGlobalConfig).toBe(false);
  expect(current.id).not.toBe(previous.id);
  expect(current.topic).toBe(DEFAULT_TOPIC);
  expect(current.mask.name).toBe(DEFAULT_TOPIC);
  expect(current.mask.id).not.toBe(previous.mask.id);
  expect(current.mask.context).toEqual([]);
  expect(current.messages).toEqual([]);
  expect(current.memoryPrompt).toBe("");
  expect(current.activeSkillId).toBeUndefined();
});

test("an accepted turn retains its group while a new chat sends with the new group", async () => {
  let complete!: (result: { images: []; files: [] }) => void;
  const preparation: MaterialPreparation = {
    getSnapshot: () => ({ items: [], images: [], files: [], pending: 1 }),
    subscribe: () => () => {},
    wait: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    retry() {},
    cancel() {},
  };
  localTokenId = 7;
  selectModel("text-model", "OpenAI");
  const oldSessionId = useChatStore.getState().currentSession().id;
  const first = useChatStore
    .getState()
    .onUserInput("First group", [], false, undefined, undefined, preparation);
  expect(chatRequest).not.toHaveBeenCalled();
  localTokenId = 9;
  useChatStore.getState().newSession();
  await useChatStore.getState().onUserInput("Second group");
  expect(chatRequest.mock.calls[0][0].accountTokenId).toBe(9);
  complete({ images: [], files: [] });
  await first;
  expect(chatRequest.mock.calls[1][0].accountTokenId).toBe(7);
  chatRequest.mock.calls[1][0].onFinish("Original group's answer", {
    status: 200,
  });
  const oldSession = useChatStore
    .getState()
    .sessions.find((session) => session.id === oldSessionId)!;
  expect(oldSession.messages.at(-1)?.content).toBe("Original group's answer");
  expect(
    useChatStore.getState().currentSession().messages.at(-1)?.content,
  ).not.toBe("Original group's answer");
});

test("each chat retains its own selection when switching and creating again", () => {
  selectModel("model-x", "OpenAI");
  const firstId = useChatStore.getState().currentSession().id;
  useChatStore.getState().newSession();
  expect(useChatStore.getState().currentSession().mask.modelConfig.model).toBe(
    "model-x",
  );
  selectModel("model-y", "Custom");
  const secondId = useChatStore.getState().currentSession().id;

  useChatStore.getState().selectSession(1);
  expect(useChatStore.getState().currentSession().id).toBe(firstId);
  expect(useChatStore.getState().currentSession().mask.modelConfig.model).toBe(
    "model-x",
  );
  useChatStore.getState().newSession();
  const sessions = useChatStore.getState().sessions;
  expect(sessions[0].mask.modelConfig.model).toBe("model-x");
  expect(
    sessions.find((session) => session.id === secondId)?.mask.modelConfig,
  ).toMatchObject({ model: "model-y", providerName: "Custom" });
  expect(
    sessions.find((session) => session.id === firstId)?.mask.modelConfig,
  ).toMatchObject({ model: "model-x", providerName: "OpenAI" });
});

test("an explicit mask keeps its own model and parameters", () => {
  selectModel("chosen-model", "Custom");
  const mask = createEmptyMask();
  mask.name = "Specific mask";
  mask.syncGlobalConfig = false;
  mask.modelConfig.model = "mask-model";
  mask.modelConfig.providerName = "Anthropic";
  mask.modelConfig.temperature = 0.9;
  useChatStore.getState().newSession(mask);
  const session = useChatStore.getState().currentSession();
  expect(session.topic).toBe("Specific mask");
  expect(session.mask.modelConfig).toEqual(mask.modelConfig);
  expect(session.mask.modelConfig).not.toBe(mask.modelConfig);
  expect(session.mask.syncGlobalConfig).toBe(false);
});

test.each([
  ["", "OpenAI"],
  ["chosen-model", ""],
  ["   ", "Custom"],
  ["chosen-model", "   "],
])("incomplete selection %j / %j keeps global defaults", (model, provider) => {
  selectModel(model, provider);
  useChatStore.getState().newSession();
  const session = useChatStore.getState().currentSession();
  expect(session.mask.modelConfig).toEqual(useAppConfig.getState().modelConfig);
  expect(session.mask.syncGlobalConfig).toBe(true);
});

test.each([false, true])(
  "missing current session keeps global defaults (sessions exist: %s)",
  (hasSessions) => {
    const sessions = hasSessions
      ? [useChatStore.getState().currentSession()]
      : [];
    useChatStore.setState({ sessions, currentSessionIndex: 99 });
    useChatStore.getState().newSession();
    const session = useChatStore.getState().currentSession();
    expect(session.mask.modelConfig).toEqual(
      useAppConfig.getState().modelConfig,
    );
    expect(session.mask.syncGlobalConfig).toBe(true);
  },
);

test("inherited config is independent from the old chat and global defaults", () => {
  selectModel("chosen-model", "Custom");
  const previous = useChatStore.getState().currentSession();
  const globalConfig = useAppConfig.getState().modelConfig;
  useChatStore.getState().newSession();
  const current = useChatStore.getState().currentSession();
  expect(current.mask.modelConfig).not.toBe(previous.mask.modelConfig);
  expect(current.mask.modelConfig).not.toBe(globalConfig);
  selectModel("different-model", "Other");
  expect(previous.mask.modelConfig.model).toBe("chosen-model");
  expect(globalConfig.model).toBe("global-default");
});

function branchingConversation() {
  const store = useChatStore.getState();
  store.updateTargetSession(store.currentSession(), (session) => {
    session.mask.modelConfig.enableInjectSystemPrompts = false;
    session.mask.modelConfig.sendMemory = false;
    session.messages = [
      createMessage({ id: "question", role: "user", content: "Question" }),
      createMessage({
        id: "original-answer",
        role: "assistant",
        content: "Original answer",
        reasoning: "Original reasoning",
      }),
      createMessage({ id: "follow-up", role: "user", content: "Follow-up" }),
      createMessage({
        id: "follow-up-answer",
        role: "assistant",
        content: "Follow-up answer",
      }),
    ];
  });
  return useChatStore.getState().currentSession();
}

test("retry keeps the original turn and sends only the selected question once", async () => {
  const session = branchingConversation();
  expect(
    await useChatStore.getState().retryMessage(session.id, "original-answer"),
  ).toBe(true);
  expect(chatRequest).toHaveBeenCalledTimes(1);
  const options = chatRequest.mock.calls[0][0];
  expect(options.messages).toEqual([
    interactionPromptMessage(
      useChatStore.getState().currentSession().messages[1].id,
    ),
    { role: "user", content: [{ type: "text", text: "Question" }] },
  ]);
  let current = useChatStore.getState().currentSession();
  const newAnswer = current.messages[1];
  expect(current.messages.map((message) => message.id)).toEqual([
    "question",
    newAnswer.id,
  ]);
  expect(newAnswer.reasoning).toBeUndefined();
  expect(
    useChatStore
      .getState()
      .selectMessageBranch(session.id, newAnswer.id, "original-answer"),
  ).toBe(false);
  options.onReasoningUpdate("New private reasoning", "New private reasoning");
  options.onUpdate("New answer", "New answer");
  options.onFinish("New answer", { ok: true });
  current = useChatStore.getState().currentSession();
  expect(current.messages[1]).toMatchObject({
    id: newAnswer.id,
    content: "New answer",
    reasoning: "New private reasoning",
    streaming: false,
  });
  expect(
    useChatStore
      .getState()
      .selectMessageBranch(session.id, newAnswer.id, "original-answer"),
  ).toBe(true);
  expect(
    useChatStore
      .getState()
      .currentSession()
      .messages.map((message) => message.id),
  ).toEqual(["question", "original-answer", "follow-up", "follow-up-answer"]);
  chatRequest.mockClear();
  await useChatStore.getState().onUserInput("Continue original path");
  expect(chatRequest).toHaveBeenCalledTimes(1);
  const followUp = chatRequest.mock.calls[0][0];
  expect(JSON.stringify(followUp.messages)).not.toContain("New answer");
  expect(JSON.stringify(followUp.messages)).not.toContain("reasoning");
  expect(followUp.messages).toEqual([
    interactionPromptMessage(
      useChatStore.getState().currentSession().messages.at(-1)!.id,
    ),
    { role: "user", content: [{ type: "text", text: "Question" }] },
    {
      role: "assistant",
      content: [{ type: "text", text: "Original answer" }],
    },
    { role: "user", content: [{ type: "text", text: "Follow-up" }] },
    {
      role: "assistant",
      content: [{ type: "text", text: "Follow-up answer" }],
    },
    {
      role: "user",
      content: [{ type: "text", text: "Continue original path" }],
    },
  ]);
});

test("a retry remains locked while model preferences hydrate", async () => {
  const session = branchingConversation();
  let finishHydration!: () => void;
  preferencesReady = false;
  waitForPreferences.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishHydration = resolve;
    }),
  );
  const pending = useChatStore
    .getState()
    .retryMessage(session.id, "original-answer");
  const answer = useChatStore.getState().currentSession().messages[1];
  expect(
    useChatStore.getState().getMessageBranches(session.id, answer.id),
  ).toMatchObject({ total: 2, index: 1, disabled: true });
  expect(
    useChatStore
      .getState()
      .selectMessageBranch(session.id, answer.id, "original-answer"),
  ).toBe(false);
  expect(chatRequest).not.toHaveBeenCalled();
  preferencesReady = true;
  finishHydration();
  await pending;
  expect(chatRequest).toHaveBeenCalledTimes(1);
});

test("external setState invalidates branch metadata even with the same session and arrays", async () => {
  const session = branchingConversation();
  await useChatStore.getState().retryMessage(session.id, "original-answer");
  const options = chatRequest.mock.calls[0][0];
  options.onFinish("New answer", { ok: true });
  const current = useChatStore.getState().currentSession();
  const answer = current.messages[1];
  expect(
    useChatStore.getState().getMessageBranches(current.id, answer.id),
  ).toMatchObject({ total: 2, index: 1, disabled: false });
  const original = current.messageBranches!.find(
    (item) => item.id === "original-answer",
  )!;
  original.parentId = "different-question";
  useChatStore.setState({ sessions: useChatStore.getState().sessions });
  expect(
    useChatStore.getState().getMessageBranches(current.id, answer.id),
  ).toMatchObject({ total: 1, index: 0 });
  original.parentId = answer.parentId;
  original.branchOrder = answer.branchOrder! + 1;
  current.messages[1] = { ...answer, content: "Replacement", streaming: true };
  useChatStore.setState({ sessions: useChatStore.getState().sessions });
  expect(
    useChatStore.getState().getMessageBranches(current.id, answer.id),
  ).toMatchObject({ total: 2, index: 0, disabled: true });
});

test("streamed body and reasoning updates preserve normalized branch metadata", async () => {
  const session = branchingConversation();
  await useChatStore.getState().retryMessage(session.id, "original-answer");
  const options = chatRequest.mock.calls[0][0];
  const current = useChatStore.getState().currentSession();
  const archived = current.messageBranches;
  const selections = current.branchSelections;
  for (let index = 1; index <= 3; index++) {
    options.onUpdate(`Body ${index}`, ` ${index}`);
    options.onReasoningUpdate(`Reasoning ${index}`, ` ${index}`);
    const next = useChatStore.getState().currentSession();
    expect(next.messageBranches).toBe(archived);
    expect(next.branchSelections).toBe(selections);
    expect(next.messages[1]).toMatchObject({
      content: `Body ${index}`,
      reasoning: `Reasoning ${index}`,
    });
    expect(
      useChatStore.getState().getMessageBranches(next.id, next.messages[1].id),
    ).toMatchObject({ total: 2, index: 1, disabled: true });
  }
  options.onFinish("Body 3", { ok: true });
});

test("failed retry preparation preserves the original answer and exposes a finished error branch", async () => {
  const session = branchingConversation();
  preferencesReady = false;
  waitForPreferences.mockRejectedValueOnce(
    new Error("Cannot read model settings"),
  );
  await useChatStore.getState().retryMessage(session.id, "original-answer");
  const current = useChatStore.getState().currentSession();
  expect(current.messages).toHaveLength(2);
  expect(current.messages[1]).toMatchObject({
    role: "assistant",
    streaming: false,
    isError: true,
  });
  expect(chatRequest).not.toHaveBeenCalled();
  expect(
    useChatStore
      .getState()
      .selectMessageBranch(
        session.id,
        current.messages[1].id,
        "original-answer",
      ),
  ).toBe(true);
  expect(useChatStore.getState().currentSession().messages[1].content).toBe(
    "Original answer",
  );
});

test("reasoning-only completion remains outside the visible answer and character statistics", async () => {
  await useChatStore.getState().onUserInput("Think");
  const options = chatRequest.mock.calls[0][0];
  options.onReasoningUpdate("Only reasoning", "Only reasoning");
  options.onFinish("", { ok: true });
  const current = useChatStore.getState().currentSession();
  expect(current.messages.at(-1)).toMatchObject({
    content: "",
    reasoning: "Only reasoning",
    streaming: false,
  });
  expect(current.stat.charCount).toBe(0);
});

test("stopping reasoning-only output preserves its interruption state", async () => {
  await useChatStore.getState().onUserInput("Think");
  const options = chatRequest.mock.calls[0][0];
  options.onReasoningUpdate("Partial reasoning", "Partial reasoning");
  const store = useChatStore.getState();
  store.updateTargetSession(store.currentSession(), (session) => {
    session.messages[1].streaming = false;
  });
  options.onFinish("", { ok: false, status: 499 });
  expect(useChatStore.getState().currentSession().messages[1]).toMatchObject({
    content: "",
    reasoning: "Partial reasoning",
    streaming: false,
    interrupted: true,
  });
});

test("deleting a generating answer restores its sibling and aborts the removed request", async () => {
  const session = branchingConversation();
  await useChatStore.getState().retryMessage(session.id, "original-answer");
  const options = chatRequest.mock.calls[0][0];
  const controller = new AbortController();
  options.onController(controller);
  const answer = useChatStore.getState().currentSession().messages[1];
  expect(useChatStore.getState().deleteMessage(session.id, answer.id)).toBe(
    true,
  );
  expect(controller.signal.aborted).toBe(true);
  expect(ChatControllerPool.hasPending(session.id)).toBe(false);
  options.onUpdate("Late output", "Late output");
  options.onReasoningUpdate("Late reasoning", "Late reasoning");
  options.onFinish("Late final output", { ok: true });
  const current = useChatStore.getState().currentSession();
  expect(current.messages.map((message) => message.id)).toEqual([
    "question",
    "original-answer",
    "follow-up",
    "follow-up-answer",
  ]);
  expect(JSON.stringify(current)).not.toContain("Late");
  expect(
    current.messageBranches?.some((message) => message.id === answer.id),
  ).toBe(false);
});

function pendingResult<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settleMcp() {
  for (let step = 0; step < 10; step++) await Promise.resolve();
}

function mcpMessage() {
  mcpEnabled = true;
  const store = useChatStore.getState();
  const message = createMessage({
    id: "mcp-answer",
    role: "assistant",
    content:
      '```json:mcp:client-1\n{"method":"tools/call","params":{"name":"lookup","arguments":{"query":"source"}}}\n```',
  });
  store.updateTargetSession(store.currentSession(), (session) => {
    session.mask.modelConfig.enableInjectSystemPrompts = false;
    session.messages = [
      createMessage({ id: "question", role: "user", content: "Research" }),
      message,
    ];
  });
  return message;
}

test("repeated MCP checks execute once and transition the original tool from pending to done", async () => {
  const message = mcpMessage();
  const sessionId = useChatStore.getState().currentSession().id;
  const result = pendingResult();
  executeMcpAction.mockReturnValueOnce(result.promise);
  const first = useChatStore.getState().checkMcpJson(message);
  const duplicate = useChatStore.getState().checkMcpJson(message);
  await settleMcp();
  expect(executeMcpAction).toHaveBeenCalledTimes(1);
  expect(executeMcpAction).toHaveBeenCalledWith("client-1", {
    method: "tools/call",
    params: { name: "lookup", arguments: { query: "source" } },
  });
  const pendingTool = useChatStore.getState().currentSession().messages[1]
    .tools?.[0];
  expect(pendingTool).toMatchObject({
    clientId: "client-1",
    function: { name: "lookup", arguments: '{"query":"source"}' },
  });
  expect(pendingTool?.isError).toBeUndefined();
  expect(ChatControllerPool.hasPending(sessionId)).toBe(true);
  result.resolve({ content: [{ type: "text", text: "Found source" }] });
  await Promise.all([first, duplicate]);
  const tool = useChatStore.getState().currentSession().messages[1].tools?.[0];
  expect(tool).toMatchObject({
    isError: false,
    content: '{"content":[{"type":"text","text":"Found source"}]}',
  });
  expect(chatRequest).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(chatRequest.mock.calls[0][0].messages)).toContain(
    "json:mcp-response:client-1",
  );
  expect(ChatControllerPool.hasPending(sessionId)).toBe(false);
});

test("MCP continuation keeps the originating group while the user changes groups", async () => {
  localTokenId = 7;
  const message = mcpMessage();
  const result = pendingResult();
  executeMcpAction.mockReturnValueOnce(result.promise);
  const pending = useChatStore.getState().checkMcpJson(message, 7);
  await settleMcp();
  localTokenId = 9;
  result.resolve({ content: [{ type: "text", text: "Found source" }] });
  await pending;
  expect(chatRequest).toHaveBeenCalledTimes(1);
  expect(chatRequest.mock.calls[0][0].accountTokenId).toBe(7);
});

test.each(["throw", "error-result"])(
  "MCP %s completes the tool as an error and releases its controller",
  async (mode) => {
    const message = mcpMessage();
    const sessionId = useChatStore.getState().currentSession().id;
    if (mode === "throw")
      executeMcpAction.mockRejectedValueOnce(new Error("Lookup failed"));
    else
      executeMcpAction.mockResolvedValueOnce({
        isError: true,
        content: [{ type: "text", text: "Lookup failed" }],
      });
    await useChatStore.getState().checkMcpJson(message);
    const tool = useChatStore.getState().currentSession().messages[1]
      .tools?.[0];
    expect(tool?.isError).toBe(true);
    expect(tool?.errorMsg).toBeTruthy();
    expect(ChatControllerPool.hasPending(sessionId)).toBe(false);
    expect(chatRequest).toHaveBeenCalledTimes(mode === "throw" ? 0 : 1);
  },
);

test.each(["stop", "delete", "switch"])(
  "MCP %s prevents a late result from sending to another conversation",
  async (action) => {
    const message = mcpMessage();
    const sessionId = useChatStore.getState().currentSession().id;
    const result = pendingResult();
    executeMcpAction.mockReturnValueOnce(result.promise);
    const request = useChatStore.getState().checkMcpJson(message);
    await settleMcp();
    const tool = useChatStore.getState().currentSession().messages[1].tools![0];
    if (action === "stop") ChatControllerPool.stop(sessionId, tool.id);
    if (action === "delete")
      useChatStore.getState().deleteMessage(sessionId, message.id);
    if (action === "switch") useChatStore.getState().newSession();
    if (action !== "switch")
      expect(ChatControllerPool.hasPending(sessionId)).toBe(false);
    result.resolve({ content: [{ type: "text", text: "Late tool result" }] });
    await request;
    expect(chatRequest).not.toHaveBeenCalled();
    expect(ChatControllerPool.hasPending(sessionId)).toBe(false);
    if (action === "stop")
      expect(
        useChatStore.getState().currentSession().messages[1].tools?.[0],
      ).toMatchObject({
        isError: true,
        errorMsg: "已停止等待，工具可能仍在运行",
      });
    if (action === "switch")
      expect(useChatStore.getState().currentSession().messages).toEqual([]);
  },
);

const deferredAsset = { __octopusChatAsset: "inactive-video" };
const videoPayload = "data:video/mp4;base64,AAAA";

function deferredConversation() {
  const store = useChatStore.getState();
  store.newSession();
  const active = useChatStore.getState().currentSession();
  store.newSession();
  const inactive = useChatStore.getState().currentSession();
  inactive.mask.modelConfig.enableInjectSystemPrompts = false;
  inactive.mask.modelConfig.sendMemory = false;
  inactive.messages = [
    createMessage({
      id: "deferred-question",
      role: "user",
      content: [
        { type: "text", text: "Review the video" },
        {
          type: "video_url",
          video_url: { url: deferredAsset as unknown as string },
        },
      ],
      composerInput: {
        text: "Review the video",
        files: [],
      },
    }),
    createMessage({
      id: "deferred-answer",
      role: "assistant",
      content: "An earlier answer",
    }),
  ];
  useChatStore.setState({
    sessions: [active, inactive],
    currentSessionIndex: 0,
  });
  return { active, inactive };
}

test("first session selection restores deferred media before publishing the selection", async () => {
  const { inactive } = deferredConversation();
  const loading = pendingResult();
  attachmentRead.mockReturnValue(loading.promise);
  const pending = useChatStore.getState().selectSession(1);
  expect(useChatStore.getState().currentSessionIndex).toBe(0);
  expect(attachmentRead).toHaveBeenCalledWith(
    "octopus:user-7:chat-next-web-store:asset:inactive-video",
    expect.any(Function),
  );
  useChatStore.getState().updateTargetSession(inactive, (session) => {
    session.topic = "Edited while loading";
    session.messages.push(
      createMessage({ role: "user", content: "Added while loading" }),
    );
  });
  loading.resolve(videoPayload);
  await pending;
  const current = useChatStore.getState().currentSession();
  expect(current.id).toBe(inactive.id);
  expect(current.topic).toBe("Edited while loading");
  expect(JSON.stringify(current.messages)).toContain(videoPayload);
  expect(current.messages.at(-1)?.content).toBe("Added while loading");
  attachmentRead.mockClear();
  expect(useChatStore.getState().selectSession(0)).toBeUndefined();
  expect(useChatStore.getState().selectSession(1)).toBeUndefined();
  expect(attachmentRead).not.toHaveBeenCalled();
});

test("a newer synchronous selection wins over a slower historical selection", async () => {
  deferredConversation();
  const loading = pendingResult();
  attachmentRead.mockReturnValue(loading.promise);
  const first = useChatStore.getState().selectSession(1);
  useChatStore.getState().selectSession(0);
  loading.resolve(videoPayload);
  await first;
  expect(useChatStore.getState().currentSessionIndex).toBe(0);
});

test.each([-1, NaN, 1.5])(
  "session index %s is normalized before loading the selected conversation",
  async (index) => {
    const { active, inactive } = deferredConversation();
    useChatStore.setState({
      sessions: [inactive, active],
      currentSessionIndex: 1,
    });
    attachmentRead.mockResolvedValue(videoPayload);
    await useChatStore.getState().selectSession(index);
    expect(useChatStore.getState().currentSessionIndex).toBe(0);
    expect(useChatStore.getState().currentSession().id).toBe(inactive.id);
    expect(JSON.stringify(useChatStore.getState().currentSession())).toContain(
      videoPayload,
    );
  },
);

test.each(["new", "clear", "reset", "reorder", "delete"] as const)(
  "%s while history is loading does not restore a stale session snapshot",
  async (action) => {
    const { active, inactive } = deferredConversation();
    const loading = pendingResult();
    attachmentRead.mockReturnValue(loading.promise);
    const first = useChatStore.getState().selectSession(1);
    let deletion: void | Promise<void> = undefined;
    if (action === "new") useChatStore.getState().newSession();
    if (action === "clear") useChatStore.getState().clearSessions();
    if (action === "reset") useChatStore.getState().resetSession(inactive);
    if (action === "reorder") useChatStore.getState().moveSession(1, 0);
    if (action === "delete")
      deletion = useChatStore.getState().deleteSessions([inactive.id]);
    const chosen = useChatStore.getState().currentSession().id;
    loading.resolve(videoPayload);
    await first;
    await deletion;
    const state = useChatStore.getState();
    if (action === "reorder") {
      expect(state.currentSession().id).toBe(inactive.id);
      expect(state.currentSessionIndex).toBe(0);
    } else if (action === "reset") {
      expect(state.currentSession().id).toBe(inactive.id);
      expect(state.currentSession().messages).toEqual([]);
    } else {
      expect(state.currentSession().id).toBe(chosen);
    }
    if (action === "clear")
      expect(state.sessions.some((session) => session.id === inactive.id)).toBe(
        false,
      );
    if (action === "delete")
      expect(state.sessions.map((session) => session.id)).toEqual([active.id]);
  },
);

test("account changes discard an outstanding historical read", async () => {
  const { active, inactive } = deferredConversation();
  const loading = pendingResult();
  attachmentRead.mockReturnValue(loading.promise);
  const pending = useChatStore.getState().selectSession(1);
  localOwner = "user-8";
  loading.resolve(videoPayload);
  await pending;
  expect(useChatStore.getState().currentSession().id).toBe(active.id);
  expect(useChatStore.getState().sessions[1]).toBe(inactive);
  expect(JSON.stringify(inactive.messages)).not.toContain(videoPayload);
});

test("missing historical bytes preserve the current selection and deferred state", async () => {
  const { active, inactive } = deferredConversation();
  attachmentRead.mockResolvedValue(undefined);
  await useChatStore.getState().selectSession(1);
  expect(useChatStore.getState().currentSession().id).toBe(active.id);
  expect(useChatStore.getState().sessions[1]).toBe(inactive);
  expect(toast).toHaveBeenCalledWith("历史附件读取失败，原数据已保留，请重试");
});

test("deleting the current conversation waits for the next history and preserves undo bytes", async () => {
  const { active, inactive } = deferredConversation();
  const loading = pendingResult();
  attachmentRead.mockReturnValue(loading.promise);
  const pending = useChatStore.getState().deleteSessions([active.id]);
  expect(useChatStore.getState().currentSession().id).toBe(active.id);
  loading.resolve(videoPayload);
  await pending;
  expect(useChatStore.getState().currentSession().id).toBe(inactive.id);
  expect(JSON.stringify(useChatStore.getState().currentSession())).toContain(
    videoPayload,
  );
  const undo = toast.mock.calls.at(-1)?.[1] as { onClick: () => void };
  undo.onClick();
  expect(useChatStore.getState().currentSession().id).toBe(active.id);
  expect(JSON.stringify(useChatStore.getState().sessions[1])).toContain(
    videoPayload,
  );
});

test("deleting unopened history loads its undo payload before removing stored references", async () => {
  const { active, inactive } = deferredConversation();
  attachmentRead.mockResolvedValue(videoPayload);
  await useChatStore.getState().deleteSessions([inactive.id]);
  expect(useChatStore.getState().sessions.map((session) => session.id)).toEqual(
    [active.id],
  );
  const undo = toast.mock.calls.at(-1)?.[1] as { onClick: () => void };
  undo.onClick();
  expect(JSON.stringify(useChatStore.getState().sessions[1])).toContain(
    videoPayload,
  );
});

test.each(["new", "clear", "reorder"] as const)(
  "a pending deletion recomputes live state after %s",
  async (action) => {
    const { active, inactive } = deferredConversation();
    const loading = pendingResult();
    attachmentRead.mockReturnValue(loading.promise);
    const pending = useChatStore.getState().deleteSessions([active.id]);
    if (action === "new") useChatStore.getState().newSession();
    if (action === "clear") useChatStore.getState().clearSessions();
    if (action === "reorder") useChatStore.getState().moveSession(1, 0);
    const currentId = useChatStore.getState().currentSession().id;
    loading.resolve(videoPayload);
    await pending;
    const state = useChatStore.getState();
    expect(state.sessions.some((session) => session.id === active.id)).toBe(
      false,
    );
    expect(state.currentSession().id).toBe(
      action === "reorder" ? inactive.id : currentId,
    );
    if (action === "clear") expect(state.sessions).toHaveLength(1);
  },
);

test("retrying a non-current conversation restores its source media before sending", async () => {
  const { active, inactive } = deferredConversation();
  attachmentRead.mockResolvedValue(videoPayload);
  expect(
    await useChatStore.getState().retryMessage(inactive.id, "deferred-answer"),
  ).toBe(true);
  expect(useChatStore.getState().currentSession().id).toBe(active.id);
  expect(chatRequest).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(chatRequest.mock.calls[0][0].messages)).toContain(
    videoPayload,
  );
  expect(JSON.stringify(chatRequest.mock.calls[0][0].messages)).not.toContain(
    "__octopusChatAsset",
  );
});

test("editing a question creates a selectable user branch and sends only its current model context", async () => {
  selectModel("selected-model", "Custom");
  const session = branchingConversation();
  useChatStore.getState().updateTargetSession(session, (target) => {
    target.mask.modelConfig.template = "Template {{input}}";
    target.messages[0].composerInput = { text: "Question", files: [] };
  });
  const original = JSON.stringify(
    useChatStore.getState().currentSession().messages,
  );
  expect(
    await useChatStore
      .getState()
      .editMessage(session.id, "question", "Edited question"),
  ).toBe(true);
  expect(chatRequest).toHaveBeenCalledTimes(1);
  const options = chatRequest.mock.calls[0][0];
  expect(options.config).toMatchObject({
    model: "selected-model",
    providerName: "Custom",
  });
  expect(options.messages).toEqual([
    interactionPromptMessage(
      useChatStore.getState().currentSession().messages[1].id,
    ),
    {
      role: "user",
      content: [{ type: "text", text: "Template Edited question" }],
    },
  ]);
  const edited = useChatStore.getState().currentSession().messages[0];
  expect(edited.id).not.toBe("question");
  expect(edited.composerInput?.text).toBe("Edited question");
  expect(edited.content).toEqual([
    { type: "text", text: "Template Edited question" },
  ]);
  options.onFinish("Edited answer", { ok: true });
  expect(
    useChatStore.getState().getMessageBranches(session.id, edited.id),
  ).toMatchObject({ index: 1, total: 2, disabled: false });
  expect(
    useChatStore
      .getState()
      .selectMessageBranch(session.id, edited.id, "question"),
  ).toBe(true);
  expect(useChatStore.getState().currentSession().messages).toMatchObject(
    JSON.parse(original),
  );
  expect(
    useChatStore
      .getState()
      .selectMessageBranch(session.id, "question", edited.id),
  ).toBe(true);
  expect(useChatStore.getState().currentSession().messages[1].content).toBe(
    "Edited answer",
  );
});

test("edited input preserves image, video, audio, file and quote snapshots without expanding the editor draft", async () => {
  const session = branchingConversation();
  const quote = {
    messageId: "deleted-source",
    role: "assistant" as const,
    text: "Quoted source\nSecond line",
  };
  const files: ParsedFile[] = [
    {
      name: "notes.txt",
      type: "text/plain",
      size: 10,
      content: "Original file bytes",
      isText: true,
    },
  ];
  const attachments: NonNullable<ChatMessage["content"]> = [
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    { type: "video_url", video_url: { url: "data:video/mp4;base64,BBBB" } },
    { type: "input_audio", input_audio: { data: "CCCC", format: "wav" } },
    {
      type: "file",
      file: {
        filename: "paper.pdf",
        file_data: "data:application/pdf;base64,DDDD",
      },
    },
  ];
  useChatStore.getState().updateTargetSession(session, (target) => {
    target.messages[0].content = [
      { type: "text", text: "Expanded old request with file bytes and quote" },
      ...attachments,
    ];
    target.messages[0].composerInput = { text: "Raw question", files, quote };
  });
  const before = JSON.stringify(
    useChatStore.getState().currentSession().messages[0],
  );
  await useChatStore
    .getState()
    .editMessage(session.id, "question", "Raw edited question");
  expect(chatRequest).toHaveBeenCalledTimes(1);
  const current = useChatStore.getState().currentSession();
  expect(current.messages[0].composerInput).toEqual({
    text: "Raw edited question",
    files,
    quote,
  });
  const sent = chatRequest.mock.calls[0][0].messages.at(-1).content;
  expect(sent.filter((part: { type: string }) => part.type !== "text")).toEqual(
    attachments,
  );
  const sentText = sent.find(
    (part: { type: string }) => part.type === "text",
  ).text;
  expect(sentText).toContain("Original file bytes");
  expect(sentText).toContain(
    "> Quoted source\n> Second line\n\nRaw edited question",
  );
  expect(sentText.match(/Quoted source/g)).toHaveLength(1);
  expect(sentText).not.toContain("Expanded old request");
  expect(
    JSON.stringify(
      current.messageBranches?.find((message) => message.id === "question"),
    ),
  ).toContain(JSON.parse(before).content[0].text);
  expect(current.messages[0].composerInput?.files).not.toBe(files);
  expect(current.messages[0].composerInput?.quote).not.toBe(quote);
});

test("editing rejects duplicate submissions and can stop while its history is still pending", async () => {
  const session = branchingConversation();
  const originalHistory = chatMethods.getMessagesWithMemory;
  const history = pendingResult();
  chatMethods.getMessagesWithMemory = () =>
    history.promise as Promise<ChatMessage[]>;
  const pending = useChatStore
    .getState()
    .editMessage(session.id, "question", "Edited question");
  try {
    const active = useChatStore.getState().currentSession();
    const bot = active.messages[1];
    expect(ChatControllerPool.hasPending(session.id)).toBe(true);
    expect(
      await useChatStore
        .getState()
        .editMessage(session.id, active.messages[0].id, "Duplicate"),
    ).toBe(false);
    expect(
      useChatStore
        .getState()
        .selectMessageBranch(session.id, active.messages[0].id, "question"),
    ).toBe(false);
    ChatControllerPool.stop(session.id, bot.id);
    await expect(pending).resolves.toBe(true);
    expect(chatRequest).not.toHaveBeenCalled();
    expect(ChatControllerPool.hasPending(session.id)).toBe(false);
    expect(useChatStore.getState().currentSession().messages[1]).toMatchObject({
      streaming: false,
      interrupted: true,
      isError: false,
    });
    expect(
      useChatStore
        .getState()
        .selectMessageBranch(session.id, active.messages[0].id, "question"),
    ).toBe(true);
    expect(useChatStore.getState().currentSession().messages.at(-1)?.id).toBe(
      "follow-up-answer",
    );
  } finally {
    history.resolve([]);
    await pending;
    chatMethods.getMessagesWithMemory = originalHistory;
  }
});

test.each(["streaming", "tool", "background", "blank", "mcp"] as const)(
  "%s edits never alter a conversation or start a request",
  async (reason) => {
    const session = branchingConversation();
    if (reason === "streaming") session.messages[1].streaming = true;
    if (reason === "tool")
      ChatControllerPool.addController(
        session.id,
        "tool",
        new AbortController(),
      );
    if (reason === "background") useChatStore.getState().newSession();
    if (reason === "mcp") session.messages[0].isMcpResponse = true;
    const before = JSON.stringify(useChatStore.getState().sessions);
    expect(
      await useChatStore
        .getState()
        .editMessage(
          session.id,
          "question",
          reason === "blank" ? " \n " : "Edited",
        ),
    ).toBe(false);
    expect(JSON.stringify(useChatStore.getState().sessions)).toBe(before);
    expect(chatRequest).not.toHaveBeenCalled();
    expect(imageRequest).not.toHaveBeenCalled();
  },
);

test("material preparation retains the quote exactly once alongside the original raw input", async () => {
  const quote = {
    messageId: "source",
    role: "assistant" as const,
    text: "Quoted text",
  };
  const preparation: MaterialPreparation = {
    getSnapshot: () => ({
      items: [],
      images: [],
      files: [],
      pending: 0,
    }),
    subscribe: () => () => {},
    wait: async () => ({ images: [], files: [] }),
    retry() {},
    cancel() {},
  };
  await useChatStore
    .getState()
    .onUserInput(
      "引用内容：\n> Quoted text\n\nRaw question",
      [],
      false,
      { text: "Raw question", files: [], quote },
      undefined,
      preparation,
    );
  expect(chatRequest).toHaveBeenCalledTimes(1);
  expect(
    useChatStore.getState().currentSession().messages[0].composerInput,
  ).toEqual({
    text: "Raw question",
    files: [],
    quote,
  });
  const sent = JSON.stringify(chatRequest.mock.calls[0][0].messages);
  expect(sent.match(/Quoted text/g)).toHaveLength(1);
  expect(sent).toContain("Raw question");
});

test("model changes while edited input waits for preferences preserve the original branch and cancel the new request", async () => {
  const session = branchingConversation();
  let finishHydration!: () => void;
  preferencesReady = false;
  waitForPreferences.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishHydration = resolve;
    }),
  );
  const pending = useChatStore
    .getState()
    .editMessage(session.id, "question", "Edited question");
  selectModel("replacement-model", "Custom");
  preferencesReady = true;
  finishHydration();
  await pending;
  expect(chatRequest).not.toHaveBeenCalled();
  const current = useChatStore.getState().currentSession();
  expect(current.messages[1]).toMatchObject({
    streaming: false,
    isError: true,
  });
  expect(
    useChatStore
      .getState()
      .selectMessageBranch(session.id, current.messages[0].id, "question"),
  ).toBe(true);
  expect(useChatStore.getState().currentSession().messages.at(-1)?.id).toBe(
    "follow-up-answer",
  );
});

test("a source-owner change while original edit attachments restore never creates a branch or sends a request", async () => {
  const { inactive } = deferredConversation();
  useChatStore.setState({ currentSessionIndex: 1 });
  const loading = pendingResult();
  attachmentRead.mockReturnValueOnce(loading.promise);
  const pending = useChatStore
    .getState()
    .editMessage(inactive.id, "deferred-question", "Edited video question");
  localOwner = "user-8";
  loading.resolve(videoPayload);
  expect(await pending).toBe(false);
  expect(chatRequest).not.toHaveBeenCalled();
  expect(
    useChatStore
      .getState()
      .sessions.find((session) => session.id === inactive.id)?.messageBranches,
  ).toBeUndefined();
});

function interactionReply(messageId: string, content = "Answer") {
  return `${content}\n\n\`\`\`chat-ui\n${JSON.stringify({
    version: 1,
    messageId,
    suggestions: ["Explain the reasoning", "Show an example"],
    options: {
      id: "delivery",
      question: "Choose a delivery channel",
      selection: "multiple",
      options: [
        { id: "email", label: "Email" },
        { id: "sms", label: "Text message" },
        { id: "push", label: "Push notification" },
      ],
      minSelections: 1,
      maxSelections: 2,
    },
  })}\n\`\`\``;
}

function optionConversation() {
  const store = useChatStore.getState();
  store.updateTargetSession(store.currentSession(), (session) => {
    session.mask.modelConfig.enableInjectSystemPrompts = false;
    session.messages = [
      createMessage({ id: "choice-question", role: "user", content: "Help" }),
      createMessage({
        id: "choice-answer",
        role: "assistant",
        content: "Choose a channel",
        interactions: {
          options: {
            id: "delivery",
            question: "Choose a channel",
            selection: "multiple",
            options: [
              { id: "email", label: "Email" },
              { id: "sms", label: "Text message" },
              { id: "push", label: "Push notification" },
            ],
            minSelections: 1,
            maxSelections: 2,
          },
        },
      }),
    ];
  });
  return useChatStore.getState().currentSession();
}

test("final raw interactions are parsed even when their footer never reached onUpdate", async () => {
  await useChatStore.getState().onUserInput("Help");
  const options = chatRequest.mock.calls[0][0];
  const answer = useChatStore.getState().currentSession().messages.at(-1)!;
  options.onReasoningUpdate("Private thought", "Private thought");
  options.onUpdate("Partial answer", "Partial answer");
  options.onFinish(interactionReply(answer.id), { ok: true });
  const completed = useChatStore.getState().currentSession().messages.at(-1)!;
  expect(completed).toMatchObject({
    content: "Answer",
    reasoning: "Private thought",
    streaming: false,
    interactions: {
      suggestions: ["Explain the reasoning", "Show an example"],
      options: { id: "delivery", selection: "multiple" },
    },
  });
  expect(chatRequest).toHaveBeenCalledTimes(1);
});

test("stream filtering hides opening fragments and overwrites an empty visible answer", async () => {
  await useChatStore.getState().onUserInput("Help");
  const options = chatRequest.mock.calls[0][0];
  const answer = useChatStore.getState().currentSession().messages.at(-1)!;
  options.onUpdate("Answer\n```cha", "```cha");
  expect(answer.content).toBe("Answer");
  options.onUpdate('```chat-ui\n{"version":1', "");
  expect(answer.content).toBe("");
  expect(answer.interactions).toBeUndefined();
  options.onUpdate("", "");
  expect(answer.content).toBe("");
});

test.each([499, 500])(
  "completion status %s hides the footer without publishing actions",
  async (status) => {
    await useChatStore.getState().onUserInput("Help");
    const options = chatRequest.mock.calls[0][0];
    const answer = useChatStore.getState().currentSession().messages.at(-1)!;
    options.onFinish(interactionReply(answer.id), { ok: false, status });
    expect(answer.content).toBe("Answer");
    expect(answer.interactions).toBeUndefined();
    expect(answer.interrupted).toBe(status === 499 ? true : undefined);
    expect(chatRequest).toHaveBeenCalledTimes(1);
  },
);

test("request errors retain only the filtered visible answer and never enable actions", async () => {
  await useChatStore.getState().onUserInput("Help");
  const options = chatRequest.mock.calls[0][0];
  const answer = useChatStore.getState().currentSession().messages.at(-1)!;
  options.onUpdate(interactionReply(answer.id), "");
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    options.onError(new Error("network failed"));
    expect(answer.content).toContain("Answer");
    expect(answer.content).not.toContain("chat-ui");
    expect(answer.content).not.toContain("suggestions");
    expect(answer.interactions).toBeUndefined();
    expect(answer.isError).toBe(true);
  } finally {
    log.mockRestore();
  }
});

test.each(["mcp", "pending-tool"] as const)(
  "a completed %s intermediate response cannot publish interactive metadata",
  async (kind) => {
    await useChatStore.getState().onUserInput("Help");
    const options = chatRequest.mock.calls[0][0];
    const answer = useChatStore.getState().currentSession().messages.at(-1)!;
    const content =
      kind === "mcp"
        ? '```json:mcp:client-1\n{"method":"tools/call","params":{"name":"lookup","arguments":{}}}\n```'
        : "Still waiting for a tool";
    if (kind === "pending-tool")
      options.onBeforeTool({
        id: "pending",
        function: { name: "lookup", arguments: "{}" },
      });
    options.onFinish(interactionReply(answer.id, content), { ok: true });
    expect(answer.content).toBe(content);
    expect(answer.interactions).toBeUndefined();
  },
);

test.each([
  ["o3", "chat-completions", "user"],
  ["o4-mini", "chat-completions", "user"],
  ["o3", "responses", "system"],
  ["custom-gemini", "gemini", "system"],
  ["custom-claude", "claude", "system"],
] as const)(
  "%s/%s receives one bound UI protocol using the supported %s role",
  async (model, format, role) => {
    selectModel(model, "Custom");
    capabilities.mockReturnValue({ ...chatCapabilities, apiFormat: format });
    await useChatStore.getState().onUserInput("Help");
    const answer = useChatStore.getState().currentSession().messages.at(-1)!;
    const options = chatRequest.mock.calls[0][0];
    expect(options.messages[0]).toEqual(
      interactionPromptMessage(answer.id, role),
    );
    expect(options.messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "Help" }],
    });
    expect(useChatStore.getState().currentSession().messages).toHaveLength(2);
    expect(chatRequest).toHaveBeenCalledTimes(1);
  },
);

test("context compression requests do not inherit the interaction protocol", async () => {
  const store = useChatStore.getState();
  store.updateTargetSession(store.currentSession(), (session) => {
    session.mask.modelConfig.compressionThreshold = 500;
    session.messages = [
      createMessage({ role: "user", content: "x".repeat(4000) }),
      createMessage({ role: "assistant", content: "Old answer" }),
      createMessage({ role: "user", content: "Recent question" }),
      createMessage({ role: "assistant", content: "Recent answer" }),
    ];
  });
  chatRequest.mockImplementation(async (options) => {
    if (options.config.stream === false)
      options.onFinish("Summary facts", { ok: true });
  });
  await store.onUserInput("Continue");
  expect(chatRequest).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(chatRequest.mock.calls[0][0].messages)).not.toContain(
    "chat-ui",
  );
  expect(JSON.stringify(chatRequest.mock.calls[1][0].messages)).toContain(
    "chat-ui",
  );
  const current = useChatStore.getState().currentSession();
  expect(current.messages.at(-1)?.contextCompressed).toBe(true);
  expect(current.messages.at(-1)?.contextCompressing).toBeUndefined();
  expect(
    current.messages
      .slice(0, -1)
      .some(
        (message) => message.contextCompressed || message.contextCompressing,
      ),
  ).toBe(false);
});

test("real summary transitions the same answer from running to the committed notice", async () => {
  compressionPreview(false);
  const summaryOptions = pendingResult<any>();
  chatRequest.mockImplementation(async (options) => {
    if (options.config.stream === false) summaryOptions.resolve(options);
  });
  const pending = useChatStore.getState().onUserInput("Continue the records");
  const summary = await summaryOptions.promise;
  const current = () => useChatStore.getState().currentSession();
  const bot = current().messages.at(-1)!;
  expect(bot.contextCompressing).toBe(true);
  expect(bot.contextCompressed).toBeUndefined();
  expect(current().memoryPrompt).toBe("");
  summary.onFinish("Retain the key observations.", { ok: true });
  await pending;
  expect(current().messages.at(-1)).toBe(bot);
  expect(bot.contextCompressing).toBeUndefined();
  expect(bot.contextCompressed).toBe(true);
  expect(current().memoryPrompt).toBe("Retain the key observations.");
  expect(current().lastSummarizeIndex).toBe(6);
  expect(chatRequest).toHaveBeenCalledTimes(2);
});

test("multiple summary batches keep the same running indicator until the final memory commit", async () => {
  compressionPreview(false);
  const store = useChatStore.getState();
  store.updateTargetSession(store.currentSession(), (target) => {
    target.messages = [
      createMessage({ role: "user", content: "观".repeat(40000) }),
      createMessage({ role: "assistant", content: "Older observations" }),
      createMessage({ role: "user", content: "Recent question" }),
      createMessage({ role: "assistant", content: "Recent reply" }),
    ];
  });
  const first = pendingResult<any>();
  const second = pendingResult<any>();
  let summaries = 0;
  chatRequest.mockImplementation(async (options) => {
    if (options.config.stream === false) {
      summaries++;
      (summaries === 1 ? first : second).resolve(options);
    }
  });
  const pending = store.onUserInput("Continue observing");
  const firstOptions = await first.promise;
  const current = () => useChatStore.getState().currentSession();
  const bot = current().messages.at(-1)!;
  expect(bot.contextCompressing).toBe(true);
  firstOptions.onFinish("First batch facts", { ok: true });
  const secondOptions = await second.promise;
  expect(current().messages.at(-1)).toBe(bot);
  expect(bot.contextCompressing).toBe(true);
  expect(bot.contextCompressed).toBeUndefined();
  expect(current().memoryPrompt).toBe("");
  secondOptions.onFinish("Combined observations", { ok: true });
  await pending;
  expect(summaries).toBe(2);
  expect(bot.contextCompressing).toBeUndefined();
  expect(bot.contextCompressed).toBe(true);
  expect(current().memoryPrompt).toBe("Combined observations");
});

test.each(["failure", "empty", "cancel", "stopped"] as const)(
  "a real summary %s clears running state without recording completion",
  async (outcome) => {
    const original = compressionPreview(false);
    const history = JSON.stringify(original.messages);
    const summaryOptions = pendingResult<any>();
    chatRequest.mockImplementation(async (options) => {
      if (options.config.stream === false) summaryOptions.resolve(options);
    });
    const store = useChatStore.getState();
    const pending = store.onUserInput("Attempt compression");
    const summary = await summaryOptions.promise;
    const pendingBot = useChatStore
      .getState()
      .currentSession()
      .messages.at(-1)!;
    expect(pendingBot.contextCompressing).toBe(true);
    expect(pendingBot.contextCompressed).toBeUndefined();
    if (outcome === "failure")
      summary.onError(new Error("Summary unavailable"));
    else if (outcome === "empty") summary.onFinish("", { ok: true });
    else {
      if (outcome === "stopped")
        store.updateTargetSession(store.currentSession(), (target) => {
          target.messages.at(-1)!.streaming = false;
        });
      ChatControllerPool.stopAll();
    }
    await pending;
    summary.onFinish("Late summary must be ignored.", { ok: true });
    const current = useChatStore.getState().currentSession();
    expect(current.memoryPrompt).toBe("");
    expect(current.lastSummarizeIndex).toBe(0);
    expect(current.messages.at(-1)?.contextCompressing).toBeUndefined();
    expect(current.messages.at(-1)?.contextCompressed).toBeUndefined();
    expect(JSON.stringify(current.messages.slice(0, 8))).toBe(history);
    expect(chatRequest).toHaveBeenCalledTimes(1);
  },
);

test.each(["failure", "cancel"] as const)(
  "a later answer %s preserves successful compression on its own answer only",
  async (outcome) => {
    compressionPreview(false);
    chatRequest.mockImplementation(async (options) => {
      if (options.config.stream === false)
        options.onFinish("Retain the key observations.", { ok: true });
    });
    const store = useChatStore.getState();
    await store.onUserInput("Continue after compression");
    const originalBot = useChatStore
      .getState()
      .currentSession()
      .messages.at(-1)!;
    const answer = chatRequest.mock.calls.at(-1)![0];
    expect(originalBot.contextCompressed).toBe(true);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      if (outcome === "failure") answer.onError(new Error("Model unavailable"));
      else answer.onFinish("Partial reply", { ok: false, status: 499 });
    } finally {
      log.mockRestore();
    }
    expect(originalBot.contextCompressed).toBe(true);
    expect(originalBot.contextCompressing).toBeUndefined();
    await store.onUserInput("Another short question");
    const current = useChatStore.getState().currentSession();
    expect(current.messages.at(-1)?.id).not.toBe(originalBot.id);
    expect(current.messages.at(-1)?.contextCompressed).toBeUndefined();
    expect(current.messages.at(-1)?.contextCompressing).toBeUndefined();
    expect(
      current.messages.find((message) => message.id === originalBot.id)
        ?.contextCompressed,
    ).toBe(true);
    expect(
      chatRequest.mock.calls.filter(
        ([options]) => options.config.stream === false,
      ),
    ).toHaveLength(1);
  },
);

test("main reply keeps usage snapshots and reported generation time independent of request time", async () => {
  const clock = jest.spyOn(performance, "now").mockReturnValue(1000);
  try {
    await useChatStore.getState().onUserInput("Measure this reply");
    const options = chatRequest.mock.calls[0][0];
    const usage = {
      inputTokens: 1000,
      outputTokens: 84,
      cachedInputTokens: 994,
    };
    options.onUsage({ ...usage, outputTokens: 40 });
    options.onUsage(usage);
    options.onUsage(usage);
    usage.outputTokens = 999;
    expect(
      useChatStore.getState().currentSession().messages.at(-1)?.responseMetrics,
    ).toEqual({
      usage: { inputTokens: 1000, outputTokens: 84, cachedInputTokens: 994 },
    });
    options.onGenerationTiming(3000);
    clock.mockReturnValue(40000);
    options.onFinish("Measured answer", { ok: true });
    expect(
      useChatStore.getState().currentSession().messages.at(-1)?.responseMetrics,
    ).toEqual({
      usage: { inputTokens: 1000, outputTokens: 84, cachedInputTokens: 994 },
      generationDurationMs: 3000,
    });
    options.onUsage({ outputTokens: 777 });
    options.onGenerationTiming(999);
    expect(
      useChatStore.getState().currentSession().messages.at(-1)?.responseMetrics
        ?.usage.outputTokens,
    ).toBe(84);
  } finally {
    clock.mockRestore();
  }
});

test("live progress updates the active reply without replacing usage and clears on finish", async () => {
  await useChatStore.getState().onUserInput("Measure live progress");
  const options = chatRequest.mock.calls[0][0];
  const progress = { outputTokens: 60, durationMs: 2000 };
  options.onGenerationProgress(progress);
  progress.outputTokens = 999;
  options.onUsage({ inputTokens: 1000, cachedInputTokens: 0 });
  const current = () =>
    useChatStore.getState().currentSession().messages.at(-1)!;
  expect(current().generationProgress).toEqual({
    outputTokens: 60,
    durationMs: 2000,
  });
  expect(current().responseMetrics).toEqual({
    usage: { inputTokens: 1000, cachedInputTokens: 0 },
  });
  options.onGenerationProgress({ outputTokens: 100, durationMs: 2500 });
  expect(current().generationProgress?.outputTokens).toBe(100);
  options.onUsage({
    inputTokens: 1000,
    outputTokens: 125,
    cachedInputTokens: 0,
  });
  options.onGenerationTiming(2500);
  options.onFinish("Measured answer", { ok: true });
  expect(current().generationProgress).toBeUndefined();
  expect(current().responseMetrics?.generationDurationMs).toBe(2500);
  options.onGenerationProgress({ outputTokens: 200, durationMs: 3000 });
  expect(current().generationProgress).toBeUndefined();
});

test("successful streams without output usage retain their final token estimate", async () => {
  await useChatStore.getState().onUserInput("No reported output usage");
  const options = chatRequest.mock.calls[0][0];
  options.onGenerationProgress({ outputTokens: 100, durationMs: 2500 });
  options.onGenerationTiming(2500);
  options.onFinish("Estimated answer", { ok: true });
  const current = useChatStore.getState().currentSession().messages.at(-1)!;
  expect(current.generationProgress).toBeUndefined();
  expect(current.responseMetrics).toEqual({
    usage: {},
    generationDurationMs: 2500,
    estimatedOutputTokens: 100,
  });
});

test.each(["error", "interrupted"] as const)(
  "clears live progress after %s and ignores late updates",
  async (outcome) => {
    await useChatStore.getState().onUserInput("Stop live progress");
    const options = chatRequest.mock.calls[0][0];
    options.onGenerationProgress({ outputTokens: 60, durationMs: 2000 });
    if (outcome === "error") options.onError(new Error("failed request"));
    else options.onFinish("Partial answer", { ok: false, status: 499 });
    const current = () =>
      useChatStore.getState().currentSession().messages.at(-1)!;
    expect(current().generationProgress).toBeUndefined();
    options.onGenerationProgress({ outputTokens: 100, durationMs: 3000 });
    expect(current().generationProgress).toBeUndefined();
  },
);

test.each([
  { outputTokens: -1, durationMs: 1000 },
  { outputTokens: 10.5, durationMs: 1000 },
  { outputTokens: 10, durationMs: 0 },
  { outputTokens: 10, durationMs: Number.POSITIVE_INFINITY },
])("ignores invalid live progress %j", async (progress) => {
  await useChatStore.getState().onUserInput("Invalid progress");
  chatRequest.mock.calls[0][0].onGenerationProgress(progress);
  expect(
    useChatStore.getState().currentSession().messages.at(-1)
      ?.generationProgress,
  ).toBeUndefined();
});

test("summary requests never report timing for the main generation", async () => {
  const clock = jest.spyOn(performance, "now").mockReturnValue(1000);
  const store = useChatStore.getState();
  try {
    store.updateTargetSession(store.currentSession(), (session) => {
      session.mask.modelConfig.compressionThreshold = 500;
      session.messages = [
        createMessage({ role: "user", content: "x".repeat(4000) }),
        createMessage({ role: "assistant", content: "Old answer" }),
        createMessage({ role: "user", content: "Recent question" }),
        createMessage({ role: "assistant", content: "Recent answer" }),
      ];
    });
    chatRequest.mockImplementation(async (options) => {
      if (options.config.stream === false) {
        expect(options.onUsage).toBeUndefined();
        expect(options.onGenerationTiming).toBeUndefined();
        expect(options.onGenerationProgress).toBeUndefined();
        clock.mockReturnValue(11000);
        options.onFinish("Summary facts", { ok: true });
      }
    });
    await store.onUserInput("Continue");
    expect(chatRequest).toHaveBeenCalledTimes(2);
    const options = chatRequest.mock.calls[1][0];
    options.onUsage({ outputTokens: 84 });
    options.onGenerationTiming(1500);
    clock.mockReturnValue(14000);
    options.onFinish("Final answer", { ok: true });
    expect(
      useChatStore.getState().currentSession().messages.at(-1)?.responseMetrics,
    ).toEqual({ usage: { outputTokens: 84 }, generationDurationMs: 1500 });
  } finally {
    clock.mockRestore();
  }
});

test.each(["error", "interrupted"] as const)(
  "%s responses never get a completed metric duration",
  async (outcome) => {
    const clock = jest.spyOn(performance, "now").mockReturnValue(1000);
    try {
      await useChatStore.getState().onUserInput("Measure a stopped reply");
      const options = chatRequest.mock.calls[0][0];
      options.onUsage({ outputTokens: 42, inputTokens: 100 });
      options.onGenerationTiming(2000);
      clock.mockReturnValue(4000);
      if (outcome === "error") options.onError(new Error("failed request"));
      else options.onFinish("Partial answer", { ok: false, status: 499 });
      expect(
        useChatStore.getState().currentSession().messages.at(-1)
          ?.responseMetrics?.generationDurationMs,
      ).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  },
);

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  "invalid generation duration %s does not become a measured speed",
  async (durationMs) => {
    await useChatStore.getState().onUserInput("Invalid timing");
    const options = chatRequest.mock.calls[0][0];
    options.onUsage({ outputTokens: 84 });
    options.onGenerationTiming(durationMs);
    options.onFinish("Final answer", { ok: true });
    expect(
      useChatStore.getState().currentSession().messages.at(-1)?.responseMetrics,
    ).toEqual({ usage: { outputTokens: 84 } });
  },
);

test("nonstreaming responses never manufacture generation timing", async () => {
  const store = useChatStore.getState();
  store.updateTargetSession(store.currentSession(), (session) => {
    session.mask.modelConfig.stream = false;
  });
  await store.onUserInput("Return a single JSON response");
  const options = chatRequest.mock.calls[0][0];
  options.onUsage({ outputTokens: 84 });
  options.onGenerationTiming(1);
  options.onGenerationProgress({ outputTokens: 84, durationMs: 1 });
  expect(
    useChatStore.getState().currentSession().messages.at(-1)
      ?.generationProgress,
  ).toBeUndefined();
  options.onFinish("A complete answer", { ok: true });
  expect(
    useChatStore.getState().currentSession().messages.at(-1)?.responseMetrics,
  ).toEqual({ usage: { outputTokens: 84 } });
});

test("unreported usage stays unknown and measured metadata never enters model input", async () => {
  await useChatStore.getState().onUserInput("First question");
  chatRequest.mock.calls[0][0].onFinish("Unmeasured answer", { ok: true });
  expect(
    useChatStore.getState().currentSession().messages.at(-1)?.responseMetrics,
  ).toBeUndefined();
  const store = useChatStore.getState();
  store.updateTargetSession(store.currentSession(), (session) => {
    session.messages.at(-1)!.responseMetrics = {
      usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 },
      durationMs: 2000,
    };
    session.messages.at(-1)!.contextCompressed = true;
    session.messages.at(-1)!.contextCompressing = true;
  });
  await store.onUserInput("Next question");
  const request = chatRequest.mock.calls.at(-1)![0];
  expect(JSON.stringify(request.messages)).not.toContain("responseMetrics");
  expect(JSON.stringify(request.messages)).not.toContain("outputTokens");
  expect(JSON.stringify(request.messages)).not.toContain("contextCompressed");
  expect(JSON.stringify(request.messages)).not.toContain("contextCompressing");
});

test("option submission records the actual accepted user response once without changing the draft cache", async () => {
  const session = optionConversation();
  useChatStore.getState().setLastInput("Keep my other draft");
  const source = JSON.stringify(session.messages[1]);
  const first = useChatStore
    .getState()
    .submitMessageOptions(session.id, "choice-answer", "delivery", [
      "sms",
      "email",
    ]);
  const duplicate = useChatStore
    .getState()
    .submitMessageOptions(session.id, "choice-answer", "delivery", ["email"]);
  expect(await duplicate).toBe(false);
  expect(await first).toBe(true);
  const current = useChatStore.getState().currentSession();
  expect(current.messages).toHaveLength(4);
  expect(current.messages[2]).toMatchObject({
    role: "user",
    optionResponse: {
      sourceMessageId: "choice-answer",
      optionsId: "delivery",
      selectedIds: ["email", "sms"],
    },
    composerInput: {
      text: "针对“Choose a channel”，我的选择：\n- Email\n- Text message",
      files: [],
    },
  });
  expect(JSON.stringify(current.messages[1])).toBe(source);
  expect(useChatStore.getState().lastInput).toBe("Keep my other draft");
  expect(chatRequest).toHaveBeenCalledTimes(1);
});

test.each(
  [[], ["unknown"], ["email", "email"], ["email", "sms", "push"]].map(
    (selected) => [selected],
  ),
)("invalid option selection %j does not create a turn", async (selected) => {
  const session = optionConversation();
  expect(
    await useChatStore
      .getState()
      .submitMessageOptions(session.id, "choice-answer", "delivery", selected),
  ).toBe(false);
  expect(useChatStore.getState().currentSession().messages).toHaveLength(2);
  expect(chatRequest).not.toHaveBeenCalled();
});

test("a stale options definition and a pending controller cannot submit", async () => {
  const session = optionConversation();
  const store = useChatStore.getState();
  expect(
    await store.submitMessageOptions(session.id, "choice-answer", "old-id", [
      "email",
    ]),
  ).toBe(false);
  ChatControllerPool.addController(
    session.id,
    "external",
    new AbortController(),
  );
  expect(
    await store.submitMessageOptions(session.id, "choice-answer", "delivery", [
      "email",
    ]),
  ).toBe(false);
  expect(store.currentSession().messages).toHaveLength(2);
  expect(chatRequest).not.toHaveBeenCalled();
});

test.each([
  "owner",
  "token",
  "session",
  "branch",
  "definition",
  "model",
] as const)(
  "%s changes while option prerequisites load never attach a receipt or start a request",
  async (change) => {
    const session = optionConversation();
    const loading = pendingResult<void>();
    preferencesReady = false;
    waitForPreferences.mockReturnValueOnce(loading.promise);
    const pending = useChatStore
      .getState()
      .submitMessageOptions(session.id, "choice-answer", "delivery", ["email"]);
    expect(session.messages).toHaveLength(2);
    expect(
      await useChatStore
        .getState()
        .submitMessageOptions(session.id, "choice-answer", "delivery", ["sms"]),
    ).toBe(false);
    if (change === "owner") localOwner = "user-8";
    if (change === "token") localTokenId = 9;
    if (change === "session") useChatStore.getState().newSession();
    if (change === "model") selectModel("different-model", "Custom");
    if (change === "branch" || change === "definition")
      useChatStore.getState().updateTargetSession(session, (current) => {
        if (change === "branch")
          current.messages[1] = createMessage({
            role: "assistant",
            content: "A different answer branch",
          });
        else current.messages[1].interactions!.options!.question = "Changed";
      });
    loading.resolve();
    expect(await pending).toBe(false);
    expect(
      useChatStore
        .getState()
        .sessions.flatMap((entry) => entry.messages)
        .some((message) => message.optionResponse),
    ).toBe(false);
    expect(chatRequest).not.toHaveBeenCalled();
  },
);

test("failed option prerequisites leave the current form available for retry", async () => {
  const session = optionConversation();
  preferencesReady = false;
  waitForPreferences.mockRejectedValueOnce(
    new Error("Preferences unavailable"),
  );
  expect(
    await useChatStore
      .getState()
      .submitMessageOptions(session.id, "choice-answer", "delivery", ["email"]),
  ).toBe(false);
  expect(useChatStore.getState().currentSession().messages).toHaveLength(2);
  expect(chatRequest).not.toHaveBeenCalled();
});

test("editing an option response clears only the new branch receipt", async () => {
  const session = optionConversation();
  const store = useChatStore.getState();
  expect(
    await store.submitMessageOptions(session.id, "choice-answer", "delivery", [
      "email",
    ]),
  ).toBe(true);
  const original = store.currentSession().messages[2];
  chatRequest.mock.calls[0][0].onFinish("Done", { ok: true });
  expect(
    await store.editMessage(session.id, original.id, "My manual revision"),
  ).toBe(true);
  const current = useChatStore.getState().currentSession();
  expect(current.messages[2].optionResponse).toBeUndefined();
  expect(
    current.messageBranches?.find((message) => message.id === original.id)
      ?.optionResponse,
  ).toEqual(original.optionResponse);
});
