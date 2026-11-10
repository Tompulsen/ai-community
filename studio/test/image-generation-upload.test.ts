/** @jest-environment node */
import { jest } from "@jest/globals";
import { imageGenerationConfig } from "../app/utils/image-params";
import type { ModelConfig } from "../app/store/config";

const preferences = { imageRequestMode: "sync", imageStream: false };
let asyncImages = [{ url: "https://media.test/image" }];
const access = {
  newApiEnabled: true,
  useCustomConfig: true,
  customApiMode: "auto",
  openaiApiKey: "custom-key",
};
const query = jest
  .fn<(...args: any[]) => Promise<Response>>()
  .mockResolvedValue(new Response("{}"));
jest.unstable_mockModule("@/app/client/api", () => ({
  apiPath: (path: string, provider?: string) =>
    `${
      provider === "octopus-custom" ? "https://custom.test/v1" : "/api/v1"
    }/${path}`,
  ApiFetchError: class extends Error {
    constructor(
      message: string,
      public status: number,
      public body?: any,
    ) {
      super(message);
    }
  },
  detectBase64Mime: () => "image/png",
  apiFetch: query,
  getHeaders: (_ignore?: boolean, provider?: string) =>
    provider === "octopus-custom"
      ? { Authorization: "Bearer custom-key" }
      : { "X-New-Api-Token": "7" },
}));
jest.unstable_mockModule("@/app/store", () => ({
  useAccessStore: { getState: () => access },
  useAppConfig: { getState: () => ({ modelConfig: preferences }) },
  useChatStore: {
    getState: () => ({
      currentSession: () => ({
        mask: { modelConfig: { model: "gpt-image-test" } },
      }),
    }),
  },
}));
jest.unstable_mockModule("@/app/utils", () => ({
  getMessageTextContent: (message: { content: string }) => message.content,
  shouldUseImageGenerationApi: (
    config: { model: string },
    options: { capabilities?: { usesImageApi: boolean; override: string } },
  ) =>
    options.capabilities
      ? options.capabilities.usesImageApi
      : config.model.includes("image"),
}));
jest.unstable_mockModule("@/app/utils/async-task", () => ({
  extractErrorMessage: (value: any) =>
    value?.error?.message || value?.message || "request failed",
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalTokenId: () => 7,
  getLocalScope: () => "account-7",
  isLocalWorkspaceActive: () => true,
  localKey: (name: string) => name,
}));
jest.unstable_mockModule("@/app/utils/async-submission", () => ({
  prepareAsyncSubmission: async () => ({
    requestId: "image-test-request",
    accepted: jest.fn(),
  }),
}));
jest.unstable_mockModule("@/app/utils/local-tasks", () => ({
  rememberTask: jest.fn(),
  pollLocalTask: async (
    _task: unknown,
    request: (path: string) => Promise<Response>,
  ) => {
    await request("images/tasks/test");
    return { data: asyncImages };
  },
  taskResultUrl: () => "https://media.test/image",
}));
const { ImageGenerationService } = await import(
  "../app/client/image-generation"
);

beforeEach(() => {
  preferences.imageRequestMode = "sync";
  asyncImages = [{ url: "https://media.test/image" }];
  access.customApiMode = "auto";
  query.mockClear();
  global.fetch = jest
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: "https://media.test/image" }] }),
      ),
    );
});

test("image configuration snapshots detach only public generation parameters and preserve zero or false values", () => {
  const config = {
    providerName: "octopus-custom",
    size: "16:9",
    resolution: "2k",
    quality: "high",
    style: "natural",
    imageOutputFormat: "webp",
    imageBackground: "opaque",
    imageOutputCompression: 0,
    imageResponseFormat: "b64_json",
    imageStream: false,
    imageRequestMode: "sync",
    imagePartialImages: 0,
    model: "gpt-image-test",
    openaiApiKey: "private-key",
    openaiUrl: "https://private.test",
    videoConfig: { duration: 12 },
  } as Partial<ModelConfig> & {
    openaiApiKey: string;
    openaiUrl: string;
  };
  const snapshot = imageGenerationConfig(config);
  expect(snapshot).toEqual({
    providerName: "octopus-custom",
    size: "16:9",
    resolution: "2k",
    quality: "high",
    style: "natural",
    imageOutputFormat: "webp",
    imageBackground: "opaque",
    imageOutputCompression: 0,
    imageResponseFormat: "b64_json",
    imageStream: false,
    imageRequestMode: "sync",
    imagePartialImages: 0,
  });
  config.size = "1:1";
  expect(snapshot.size).toBe("16:9");
  snapshot.imageOutputCompression = 50;
  expect(config.imageOutputCompression).toBe(0);
  expect(
    imageGenerationConfig({ quality: undefined, imageStream: false }),
  ).toEqual({
    imageStream: false,
  });
});

test.each(["sync", "async"])(
  "%s delivers all four images returned for a one-image request",
  async (mode) => {
    preferences.imageRequestMode = mode;
    asyncImages = Array.from({ length: 4 }, (_, index) => ({
      url: `https://media.test/image-${index}`,
      b64_json: "",
    }));
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(
          mode === "async" ? { id: "multi-image-task" } : { data: asyncImages },
        ),
      );
    const service = new ImageGenerationService({} as any);
    const onComplete = jest.fn();
    const onError = jest.fn();
    service.setCallbacks({ onComplete, onError });
    await service.generateImage({
      config: { model: "gpt-image-test" },
      messages: [{ role: "user", content: "one cat" }],
      onFinish: jest.fn(),
    });
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      asyncImages[0].url,
      asyncImages.map((image) => image.url),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String(jest.mocked(fetch).mock.calls[0][1]?.body)).n,
    ).toBe(1);
  },
);

async function generate(images: string[]) {
  const service = new ImageGenerationService({} as any);
  const onError = jest.fn();
  service.setCallbacks({ onError });
  await service.generateImage(
    {
      messages: [{ role: "user", content: "combine these references" }],
      config: { model: "gpt-image-test" },
      onFinish: jest.fn(),
    },
    { referenceImages: images },
  );
  expect(onError).not.toHaveBeenCalled();
  const [url, request] = jest.mocked(fetch).mock.calls[0];
  return { url, form: request!.body as FormData };
}

test("background generation uses the async relay without changing manual image preferences", async () => {
  preferences.imageRequestMode = "sync";
  jest.mocked(fetch).mockResolvedValueOnce(Response.json({ id: "background-image-task" }));
  const service = new ImageGenerationService({} as any), onComplete = jest.fn(), onError = jest.fn();
  service.setCallbacks({ onComplete, onError });
  await service.generateImage({
    config: { model: "gpt-image-test" }, messages: [{ role: "user", content: "a background cat" }],
    taskContext: { sessionId: "background-session", messageId: "background-answer" }, onFinish: jest.fn(),
  }, { requestMode: "async" });
  expect(onError).not.toHaveBeenCalled();
  expect(String(jest.mocked(fetch).mock.calls[0][0])).toContain("async-images/v1/tasks");
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(preferences.imageRequestMode).toBe("sync");
});

test("keeps a single reference in the compatible image field", async () => {
  const { url, form } = await generate(["data:image/png;base64,YQ=="]);
  expect(url).toBe("/api/v1/images/edits");
  expect(await (form.get("image") as Blob).text()).toBe("a");
  expect(form.has("image[]")).toBe(false);
  expect(form.has("mask")).toBe(false);
});

test.each(["sync", "async"])(
  "%s sends every reference as an image rather than inventing a mask",
  async (mode) => {
    preferences.imageRequestMode = mode;
    if (mode === "async")
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: "img-test" })),
        );
    const { url, form } = await generate([
      "data:image/png;base64,YQ==",
      "data:image/jpeg;base64,Yg==",
      "data:image/webp;base64,Yw==",
    ]);
    expect(url).toBe(
      mode === "async"
        ? "/api/v1/async-images/v1/edits"
        : "/api/v1/images/edits",
    );
    const references = form.getAll("image[]") as File[];
    expect(await Promise.all(references.map((file) => file.text()))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(references.map((file) => file.type)).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    expect(form.has("image")).toBe(false);
    expect(form.has("mask")).toBe(false);
  },
);

test.each(["sync", "async"])(
  "%s image requests and task queries keep their selected source",
  async (mode) => {
    preferences.imageRequestMode = mode;
    for (const providerName of ["gpt", "octopus-custom"]) {
      const custom = providerName === "octopus-custom";
      const service = new ImageGenerationService({} as any);
      const onError = jest.fn();
      service.setCallbacks({ onError });
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          Response.json(
            mode === "async"
              ? { id: "test" }
              : { data: [{ url: "https://media.test/image" }] },
          ),
        );
      await service.generateImage({
        config: { model: "gpt-image-test", providerName },
        messages: [{ role: "user", content: "test" }],
        onFinish: jest.fn(),
      });
      expect(onError).not.toHaveBeenCalled();
      const [url, request] = jest.mocked(fetch).mock.calls.at(-1)!;
      expect(
        String(url).startsWith(custom ? "https://custom.test/" : "/api/"),
      ).toBe(true);
      const headers = new Headers(request?.headers);
      expect(headers.get("Authorization")).toBe(
        custom ? "Bearer custom-key" : null,
      );
      expect(headers.get("X-New-Api-Token")).toBe(custom ? null : "7");
      if (mode === "async")
        expect(query.mock.calls.at(-1)?.[2]).toBe(providerName);
    }
  },
);

test("enabling a custom image endpoint does not force account text requests into images", async () => {
  access.customApiMode = "responses";
  const chat = jest.fn<(...args: any[]) => Promise<void>>().mockResolvedValue();
  const service = new ImageGenerationService({ chat } as any);
  await service.generateImage({
    config: { model: "account-text", providerName: "gpt" },
    messages: [{ role: "user", content: "hello" }],
    onFinish: jest.fn(),
  });
  expect(chat).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

test("a captured chat correction stays on chat even for a custom image endpoint", async () => {
  access.customApiMode = "images";
  const chat = jest.fn<(...args: any[]) => Promise<void>>().mockResolvedValue();
  const service = new ImageGenerationService({ chat } as any);
  const options = {
    modelCapabilities: {
      vendor: "other",
      vendorName: "Other",
      category: "chat",
      usesImageApi: false,
      vision: false,
      override: "chat",
    },
    config: { model: "alias-image", providerName: "octopus-custom" },
    messages: [{ role: "user", content: "hello" }],
    onFinish: jest.fn(),
  };
  await service.generateImage(options as any);
  expect(chat).toHaveBeenCalledWith(options);
  expect(fetch).not.toHaveBeenCalled();
});

test("image generation keeps the request endpoint mode captured before model settings change", async () => {
  access.customApiMode = "responses";
  const service = new ImageGenerationService({} as any);
  await service.generateImage({
    imageApiMode: "images",
    config: { model: "gpt-image-test", providerName: "octopus-custom" },
    messages: [{ role: "user", content: "hello" }],
    onFinish: jest.fn(),
  });
  expect(fetch).toHaveBeenCalledWith(
    "https://custom.test/v1/images/generations",
    expect.anything(),
  );
});

test("retains a mask only when the edit caller supplies one explicitly", async () => {
  const service = new ImageGenerationService({} as any);
  await service.generateImageEdit(
    new Blob(["reference"], { type: "image/png" }),
    "edit the selected area",
    { maskFile: new Blob(["mask"], { type: "image/png" }) },
  );
  const form = jest.mocked(fetch).mock.calls[0][1]!.body as FormData;
  expect(await (form.get("image") as Blob).text()).toBe("reference");
  expect(await (form.get("mask") as Blob).text()).toBe("mask");
});

test.each(["sync", "async", "edit"])(
  "%s preserves the upstream balance error body for the message callback",
  async (mode) => {
    preferences.imageRequestMode = mode === "async" ? "async" : "sync";
    const payload = {
      error: { code: "insufficient_user_quota", message: "余额不足" },
    };
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(Response.json(payload, { status: 403 }));
    const service = new ImageGenerationService({} as any);
    const onError = jest.fn();
    service.setCallbacks({ onError });
    await service.generateImage(
      {
        config: { model: "gpt-image-test", providerName: "gpt" },
        messages: [{ role: "user", content: "test" }],
        onFinish: jest.fn(),
      },
      {
        referenceImages: mode === "edit" ? ["data:image/png;base64,YQ=="] : [],
      },
    );
    expect(onError).toHaveBeenCalledWith(
      "余额不足",
      expect.objectContaining({ status: 403, body: payload }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test.each(["sync", "async", "edit"])(
  "%s pins image submission and polling to the original group",
  async (mode) => {
    preferences.imageRequestMode = mode === "async" ? "async" : "sync";
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(
          mode === "async"
            ? { id: "image-job" }
            : mode === "edit"
            ? { data: [{ url: "https://media.test/image" }] }
            : { task_id: "image-job" },
        ),
      );
    const onError = jest.fn();
    const service = new ImageGenerationService({} as any);
    service.setCallbacks({ onError });
    await service.generateImage(
      {
        accountTokenId: 5,
        config: { model: "gpt-image-test", providerName: "gpt" },
        messages: [{ role: "user", content: "Draw" }],
        taskContext: { sessionId: "chat", messageId: "answer" },
        onFinish: jest.fn(),
      },
      {
        referenceImages: mode === "edit" ? ["data:image/png;base64,YQ=="] : [],
      },
    );
    expect(
      new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers).get(
        "X-New-Api-Token",
      ),
    ).toBe("5");
    if (mode !== "edit")
      expect(query.mock.calls[0][1].headers["X-New-Api-Token"]).toBe("5");
    expect(onError).not.toHaveBeenCalled();
  },
);
