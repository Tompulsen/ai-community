/** @jest-environment node */
import { jest } from "@jest/globals";

const streamWithThink = jest.fn<(...args: any[]) => void>();
const access = {
  useCustomConfig: true,
  newApiEnabled: false,
  openaiApiKey: "first-key",
  openaiUrl: "https://custom.test/v1",
  customApiMode: "auto",
};
let custom = true;
let owner = "user-7";
let active = true;
let token = 7;
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => owner,
  getLocalTokenId: () => token,
  isLocalWorkspaceActive: () => active,
}));
let baseUrl = "https://custom.test/v1";
const preprocess = jest
  .fn<(content: any) => Promise<any>>()
  .mockImplementation(async (content) => content);
const prepareVideos = jest
  .fn<(messages: any[], options: any) => Promise<any[]>>()
  .mockImplementation(async (messages) => messages);
const request = jest.fn<typeof fetch>();
jest.unstable_mockModule("@/app/store", () => ({
  useAccessStore: { getState: () => access },
  useAppConfig: {
    getState: () => ({ modelConfig: {}, models: [] }),
  },
  useChatStore: {
    getState: () => ({
      currentSession: () => ({ mask: { modelConfig: {} } }),
    }),
  },
}));
jest.unstable_mockModule("@/app/utils/chat", () => ({
  preProcessImageContent: preprocess,
  uploadImage: jest.fn(),
  base64Image2Blob: jest.fn(),
  streamWithThink,
}));
jest.unstable_mockModule("@/app/client/api", () => ({
  getHeaders: () => ({ Authorization: `Bearer ${access.openaiApiKey}` }),
  apiPath: (path: string) => `${baseUrl}/${path}`,
  validateModelEndpoint: () => true,
  detectBase64Mime: () => "image/png",
}));
jest.unstable_mockModule("@/app/utils", () => ({
  getMessageTextContent: () => "hello",
  isVisionModel: () => false,
  isDalle3: () => false,
  shouldUseImageGenerationApi: (
    _config: unknown,
    options: { capabilities?: { usesImageApi: boolean } },
  ) => options.capabilities?.usesImageApi === true,
  getTimeoutMSByModel: () => 60000,
}));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  getModelCapabilities: () => ({
    category: "chat",
    usesImageApi: false,
    vision: false,
    override: "auto",
  }),
}));
jest.unstable_mockModule("@/app/utils/model", () => ({
  collectModelsWithDefaultModel: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/cloudflare", () => ({
  cloudflareAIGatewayUrl: (url: string) => url,
}));
jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({}),
}));
jest.unstable_mockModule("@/app/locales", () => ({ default: {} }));
jest.unstable_mockModule("@/app/utils/stream", () => ({ fetch: request }));
jest.unstable_mockModule("@/app/utils/video-input", () => ({
  prepareVideoMessages: prepareVideos,
}));
jest.unstable_mockModule("@/app/utils/custom-provider", () => ({
  customApiPath: (base: string, path: string) => `${base}/${path}`,
  isAccountModelMode: () => access.newApiEnabled,
  usesCustomProvider: () => custom,
}));
const { ChatGPTApi } = await import("../app/client/platforms/openai");
const { skillContextRole } = await import("../app/skills/request");
const { LOCAL_PREVIEW_PROVIDER, LOCAL_PREVIEW_MESSAGE } = await import(
  "../app/utils/local-preview-models"
);

beforeEach(() => {
  streamWithThink.mockReset();
  preprocess.mockReset().mockImplementation(async (content) => content);
  prepareVideos.mockReset().mockImplementation(async (messages) => messages);
  request.mockReset();
  access.openaiApiKey = "first-key";
  access.openaiUrl = "https://custom.test/v1";
  access.newApiEnabled = false;
  custom = true;
  owner = "user-7";
  active = true;
  token = 7;
  baseUrl = "https://custom.test/v1";
});

test.each(["chat-completions", "responses", "claude", "gemini"] as const)(
  "%s preview requests never read attachments or start transport",
  async (chatApiFormat) => {
    const onError = jest.fn<(error: Error) => void>();
    const onFinish = jest.fn();
    await new ChatGPTApi().chat({
      messages: [{ role: "user", content: "private attachment" }],
      config: {
        model: "gpt-6-astra",
        providerName: LOCAL_PREVIEW_PROVIDER,
        chatApiFormat,
        stream: true,
      },
      onError,
      onFinish,
    });
    expect(onError).toHaveBeenCalledWith(new Error(LOCAL_PREVIEW_MESSAGE));
    expect(onFinish).not.toHaveBeenCalled();
    expect(preprocess).not.toHaveBeenCalled();
    expect(streamWithThink).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  },
);

test("OpenAI compatible streams expose upstream errors after partial text", async () => {
  await new ChatGPTApi().chat({
    messages: [{ role: "user", content: "hello" }],
    config: { model: "custom-text-model", stream: true },
    onFinish: jest.fn(),
  });
  expect(streamWithThink).toHaveBeenCalledTimes(1);
  expect(streamWithThink.mock.calls[0][8]).toMatchObject({
    strictApiErrors: true,
    disableRetry: true,
  });
  const parse = streamWithThink.mock.calls[0][6];
  expect(
    parse(JSON.stringify({ choices: [{ delta: { content: "partial" } }] }), [])
      .content,
  ).toBe("partial");
  expect(
    parse(JSON.stringify({ error: { message: "quota exhausted" } }), []).error,
  ).toBe("quota exhausted");
});

test("OpenAI usage-only terminal chunks report totals and every chat starts fresh", async () => {
  const onUsage = jest.fn();
  const api = new ChatGPTApi();
  const options = {
    messages: [{ role: "user" as const, content: "hello" }],
    config: { model: "custom-text-model", stream: true },
    onUsage,
    onFinish: jest.fn(),
  };
  await api.chat(options);
  expect(streamWithThink.mock.calls[0][1].stream_options).toEqual({
    include_usage: true,
  });
  const parse = streamWithThink.mock.calls[0][6];
  expect(
    parse(
      JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      }),
      [],
    ),
  ).toEqual({ isThinking: false, content: "" });
  expect(onUsage).toHaveBeenLastCalledWith({
    inputTokens: 10,
    outputTokens: 4,
    cachedInputTokens: 0,
  });
  streamWithThink.mock.calls[0][7]({ messages: [] }, {}, []);
  parse(
    JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    }),
    [],
  );
  expect(onUsage).toHaveBeenLastCalledWith({
    inputTokens: 30,
    outputTokens: 12,
  });
  await api.chat(options);
  streamWithThink.mock.calls[1][6](
    JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    }),
    [],
  );
  expect(onUsage).toHaveBeenLastCalledWith({ inputTokens: 1, outputTokens: 0 });
});

test.each([
  [
    "chat-completions",
    {
      choices: [{ message: { content: "Answer" } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    },
    { inputTokens: 10, outputTokens: 4, cachedInputTokens: 0 },
  ],
  [
    "responses",
    {
      output_text: "Answer",
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        input_tokens_details: { cached_tokens: 0 },
      },
    },
    { inputTokens: 10, outputTokens: 4, cachedInputTokens: 0 },
  ],
  [
    "gemini",
    {
      candidates: [{ content: { parts: [{ text: "Answer" }] } }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 4,
        thoughtsTokenCount: 2,
        cachedContentTokenCount: 0,
      },
    },
    { inputTokens: 10, outputTokens: 6, cachedInputTokens: 0 },
  ],
  [
    "claude",
    {
      content: [{ type: "text", text: "Answer" }],
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 5,
      },
    },
    { inputTokens: 35, outputTokens: 4, cachedInputTokens: 20 },
  ],
] as const)(
  "%s nonstream usage arrives before completion",
  async (format, response, expected) => {
    request.mockResolvedValueOnce(Response.json(response));
    const order: string[] = [];
    const onUsage = jest.fn(() => order.push("usage"));
    const onFinish = jest.fn(() => order.push("finish"));
    const onError = jest.fn();
    await new ChatGPTApi().chat({
      messages: [{ role: "user", content: "hello" }],
      config: {
        model: "custom-text-model",
        stream: false,
        chatApiFormat: format,
      },
      onUsage,
      onFinish,
      onError,
    });
    expect(onError).not.toHaveBeenCalled();
    expect(onUsage).toHaveBeenCalledWith(expected);
    expect(onFinish).toHaveBeenCalledWith("Answer", expect.any(Response));
    expect(order).toEqual(["usage", "finish"]);
  },
);

test("an upstream returning JSON for a streamed request still reports usage", async () => {
  const onUsage = jest.fn();
  await new ChatGPTApi().chat({
    messages: [{ role: "user", content: "hello" }],
    config: { model: "custom-text-model", stream: true },
    onUsage,
    onFinish: jest.fn(),
  });
  const response = Response.json({
    choices: [{ message: { content: "Answer" } }],
    usage: { prompt_tokens: 10, completion_tokens: 4 },
  });
  request.mockResolvedValueOnce(response);
  const fetcher = streamWithThink.mock.calls[0][8].fetch;
  expect(
    await fetcher("/api/chat", {
      method: "POST",
      body: JSON.stringify({ stream: true }),
    }),
  ).toBe(response);
  expect(onUsage).toHaveBeenCalledWith({
    inputTokens: 10,
    outputTokens: 4,
  });
  expect(response.bodyUsed).toBe(false);
});

test("stopping while images load settles once without starting a paid request", async () => {
  let complete!: (content: string) => void;
  preprocess.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const onFinish = jest.fn<(text: string, response: Response) => void>();
  const onError = jest.fn<(error: Error) => void>();
  let controller: AbortController | undefined;
  const pending = new ChatGPTApi().chat({
    messages: [{ role: "user", content: "private attachment" }],
    config: { model: "text", stream: true },
    onController(value) {
      controller = value;
    },
    onFinish,
    onError,
  });

  expect(controller).toBeDefined();
  controller!.abort();
  access.openaiApiKey = "another-account";
  complete("private attachment");
  await pending;

  expect(streamWithThink).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(onFinish).toHaveBeenCalledTimes(1);
  expect(onFinish.mock.calls[0][1].status).toBe(499);
  expect(onError).not.toHaveBeenCalled();
});

test.each(["credential", "endpoint"])(
  "changing the %s during preparation cancels without sending old credentials",
  async (changed) => {
    let complete!: (content: string) => void;
    preprocess.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const onFinish = jest.fn<(text: string, response: Response) => void>();
    const pending = new ChatGPTApi().chat({
      messages: [{ role: "user", content: "attachment" }],
      config: { model: "text", stream: true },
      onFinish,
    });
    if (changed === "credential") access.openaiApiKey = "replacement-key";
    else baseUrl = "https://replacement.test/v1";
    complete("attachment");
    await pending;

    expect(streamWithThink).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0][1].status).toBe(499);
  },
);

test("an immediately cancelled request never reads attachments or starts transport", async () => {
  const onFinish = jest.fn<(text: string, response: Response) => void>();
  await new ChatGPTApi().chat({
    messages: [{ role: "user", content: "attachment" }],
    config: { model: "text", stream: true },
    onController: (controller) => controller.abort(),
    onFinish,
  });
  expect(preprocess).not.toHaveBeenCalled();
  expect(streamWithThink).not.toHaveBeenCalled();
  expect(onFinish).toHaveBeenCalledTimes(1);
});

const nativeFormats = ["responses", "claude", "gemini"] as const;

test.each(
  (["chat-completions", ...nativeFormats] as const).flatMap((format) =>
    (["group", "account", "maintenance"] as const).map(
      (change) => [format, change] as const,
    ),
  ),
)(
  "%s keeps the submitted token across %s but stops for account changes",
  async (format, change) => {
    custom = false;
    access.newApiEnabled = true;
    let complete!: (messages: any[]) => void;
    let started!: () => void;
    const preparing = new Promise<void>((resolve) => {
      started = resolve;
    });
    prepareVideos.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const onFinish = jest.fn<(text: string, response: Response) => void>();
    const pending = new ChatGPTApi().chat({
      accountTokenId: 7,
      messages: [{ role: "user", content: "Review this video" }],
      config: { model: "text", stream: true, chatApiFormat: format },
      onFinish,
    });
    await preparing;
    token = 9;
    if (change === "account") owner = "user-8";
    if (change === "maintenance") active = false;
    complete([{ role: "user", content: "Prepared video" }]);
    await pending;
    if (change === "group") {
      expect(streamWithThink).toHaveBeenCalledTimes(1);
      expect(streamWithThink.mock.calls[0][2]["X-New-Api-Token"]).toBe("7");
    } else {
      expect(streamWithThink).not.toHaveBeenCalled();
      expect(onFinish.mock.calls[0][1].status).toBe(499);
    }
    expect(request).not.toHaveBeenCalled();
  },
);

test.each(["chat-completions", "responses", "claude"] as const)(
  "%s transports prepared video frames without changing the stored video",
  async (format) => {
    const original = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Review this video" },
          {
            type: "video_url" as const,
            video_url: { url: "data:video/mp4;base64,b3JpZ2luYWw=" },
          },
        ],
      },
    ];
    const before = JSON.stringify(original);
    prepareVideos.mockResolvedValueOnce([
      {
        role: "user",
        content: [
          { type: "text", text: "Video frame at 00:00. Audio not included." },
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64,ZnJhbWU=" },
          },
        ],
      },
    ]);
    await new ChatGPTApi().chat({
      messages: original,
      config: { model: "gpt-6.1-sol", stream: true, chatApiFormat: format },
      onFinish: jest.fn(),
    });
    expect(prepareVideos).toHaveBeenCalledWith(
      original,
      expect.objectContaining({
        model: "gpt-6.1-sol",
        format,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(streamWithThink).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(streamWithThink.mock.calls[0][1]);
    expect(payload).toContain("ZnJhbWU=");
    expect(payload).toContain("00:00");
    expect(payload).not.toContain("video_url");
    expect(payload).not.toContain("data:video/");
    expect(JSON.stringify(original)).toBe(before);
  },
);

test.each(["chat-completions", ...nativeFormats] as const)(
  "%s video preparation failures stop transport and reach the error callback",
  async (format) => {
    const error = new Error("Video could not be decoded");
    prepareVideos.mockRejectedValueOnce(error);
    const onError = jest.fn();
    const onFinish = jest.fn();
    await new ChatGPTApi().chat({
      messages: [{ role: "user", content: "Review the attached video" }],
      config: { model: "gpt-6.1-sol", stream: true, chatApiFormat: format },
      onError,
      onFinish,
    });
    expect(onError).toHaveBeenCalledWith(error);
    expect(onFinish).not.toHaveBeenCalled();
    expect(streamWithThink).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  },
);

test.each(
  (["chat-completions", ...nativeFormats] as const).flatMap((format) =>
    (["stop", "credential", "endpoint"] as const).map(
      (change) => [format, change] as const,
    ),
  ),
)(
  "%s cancels without transport after %s during video preparation",
  async (format, change) => {
    let complete!: (messages: any[]) => void;
    let started!: () => void;
    const preparing = new Promise<void>((resolve) => {
      started = resolve;
    });
    prepareVideos.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const onFinish = jest.fn<(text: string, response: Response) => void>();
    const onError = jest.fn();
    let controller!: AbortController;
    const pending = new ChatGPTApi().chat({
      messages: [{ role: "user", content: "Review the video" }],
      config: { model: "gpt-6.1-sol", stream: true, chatApiFormat: format },
      onController(value) {
        controller = value;
      },
      onFinish,
      onError,
    });
    await preparing;
    if (change === "stop") controller.abort();
    else if (change === "credential") access.openaiApiKey = "replacement-key";
    else {
      baseUrl = "https://replacement.test/v1";
      access.openaiUrl = baseUrl;
    }
    complete([{ role: "user", content: "Prepared video frames" }]);
    await pending;
    expect(streamWithThink).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0][1].status).toBe(499);
  },
);

test.each(nativeFormats)(
  "%s keeps derived request headers separate from the selection snapshot",
  async (format) => {
    await new ChatGPTApi().chat({
      messages: [{ role: "user", content: "hello" }],
      config: { model: "native-text", stream: true, chatApiFormat: format },
      onFinish: jest.fn(),
    });
    expect(streamWithThink).toHaveBeenCalledTimes(1);
    const headers = streamWithThink.mock.calls[0][2];
    if (format === "claude") {
      expect(headers["x-api-key"]).toBe("first-key");
      expect(headers.Authorization).toBeUndefined();
    } else if (format === "gemini") {
      expect(headers["x-goog-api-key"]).toBe("first-key");
      expect(headers.Authorization).toBeUndefined();
    } else expect(headers.Authorization).toBe("Bearer first-key");
  },
);

test.each(
  nativeFormats.flatMap((format) =>
    (["credential", "endpoint"] as const).map(
      (changed) => [format, changed] as const,
    ),
  ),
)(
  "%s cancels when the %s changes while materials are loading",
  async (format, changed) => {
    let complete!: (content: string) => void;
    preprocess.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const onFinish = jest.fn<(text: string, response: Response) => void>();
    const onError = jest.fn();
    let controller: AbortController | undefined;
    const pending = new ChatGPTApi().chat({
      messages: [{ role: "user", content: "attachment" }],
      config: { model: "native-text", stream: true, chatApiFormat: format },
      onController(value) {
        controller = value;
      },
      onFinish,
      onError,
    });
    if (changed === "credential") access.openaiApiKey = "replacement-key";
    else {
      baseUrl = "https://replacement.test/v1";
      access.openaiUrl = baseUrl;
    }
    complete("attachment");
    await pending;

    expect(streamWithThink).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(controller?.signal.aborted).toBe(true);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0][1].status).toBe(499);
    expect(onError).not.toHaveBeenCalled();
  },
);

test.each(nativeFormats)(
  "immediately cancelling %s skips material preprocessing",
  async (format) => {
    const onFinish = jest.fn<(text: string, response: Response) => void>();
    await new ChatGPTApi().chat({
      messages: [{ role: "user", content: "attachment" }],
      config: { model: "native-text", stream: true, chatApiFormat: format },
      onController: (controller) => controller.abort(),
      onFinish,
    });
    expect(preprocess).not.toHaveBeenCalled();
    expect(streamWithThink).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0][1].status).toBe(499);
  },
);

test("legacy nonstream HTTP failures use the error callback and release the timeout", async () => {
  custom = false;
  const onError = jest.fn<(error: Error) => void>();
  const onFinish = jest.fn<(text: string, response: Response) => void>();
  request.mockResolvedValueOnce(
    Response.json({ error: { message: "quota exhausted" } }, { status: 429 }),
  );
  jest.useFakeTimers();
  try {
    await new ChatGPTApi().chat({
      messages: [{ role: "user", content: "hello" }],
      config: { model: "text", stream: false },
      onError,
      onFinish,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe("quota exhausted");
    expect(onFinish).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test.each(["o1-preview", "o3", "o4-mini"])(
  "actual %s Chat Completions payload retains skill and retrieval context",
  async (model) => {
    streamWithThink.mockClear();
    await new ChatGPTApi().chat({
      messages: [
        { role: "system", content: "Legacy system instructions" },
        {
          role: skillContextRole(model, "chat-completions"),
          content:
            "Active skill: papers\nRetrieved sources: https://doi.org/10.123/example",
        },
        { role: "user", content: "Find papers" },
      ],
      config: { model, stream: true },
      onFinish: jest.fn(),
    });
    const payload = streamWithThink.mock.calls[0][1];
    expect(payload.messages).toContainEqual({
      role: "user",
      content:
        "Active skill: papers\nRetrieved sources: https://doi.org/10.123/example",
    });
  },
);
