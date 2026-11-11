/** @jest-environment node */
import { jest } from "@jest/globals";
import {
  createReasoningFallbackFetch,
  isUnsupportedReasoningError,
} from "../app/utils/reasoning-fallback";

function rejected(
  status = 400,
  error: unknown = {
    message: "Unsupported value for reasoning_effort: high",
    param: "reasoning_effort",
    code: "unsupported_value",
  },
) {
  return Response.json({ error }, { status });
}

function request(body: Record<string, unknown> = {}) {
  return {
    method: "POST",
    headers: { Authorization: "Bearer fixture", "X-New-Api-User": "17" },
    signal: new AbortController().signal,
    credentials: "same-origin" as const,
    body: JSON.stringify({
      model: "fixture-model",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aA==" },
            },
          ],
        },
      ],
      ...body,
    }),
  };
}

test.each([{ reasoning_effort: "high" }, { reasoning: { effort: "high" } }])(
  "retries one explicit reasoning rejection with automatic settings: %j",
  async (fields) => {
    const original = rejected();
    const success = Response.json({ choices: [] });
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(original)
      .mockImplementationOnce(async () => {
        expect(original.bodyUsed).toBe(true);
        return success;
      });
    const onFallback = jest.fn<() => void>();
    const wrapped = createReasoningFallbackFetch(fetcher, { onFallback });
    const init = request(fields);

    expect(await wrapped("/api/chat", init)).toBe(success);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, retried] = fetcher.mock.calls[1];
    const originalBody = JSON.parse(init.body);
    delete originalBody.reasoning_effort;
    delete originalBody.reasoning;
    expect(url).toBe("/api/chat");
    expect(retried).toEqual({ ...init, body: JSON.stringify(originalBody) });
    expect(retried?.headers).toBe(init.headers);
    expect(retried?.signal).toBe(init.signal);
    expect(onFallback).toHaveBeenCalledTimes(1);
  },
);

test("removing effort preserves unrelated Responses reasoning settings", async () => {
  const fetcher = jest
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      rejected(422, {
        message: "Invalid reasoning.effort setting",
        param: "reasoning.effort",
      }),
    )
    .mockResolvedValueOnce(Response.json({ output: [] }));
  await createReasoningFallbackFetch(fetcher)(
    "/api/responses",
    request({ reasoning: { effort: "max", summary: "auto" } }),
  );
  expect(
    JSON.parse(fetcher.mock.calls[1][1]?.body as string).reasoning,
  ).toEqual({
    summary: "auto",
  });
});

test.each([
  {
    thinkingLevel: "xhigh",
    error: {
      code: 400,
      status: "INVALID_ARGUMENT",
      message:
        'Invalid JSON payload received. Unknown name "thinkingLevel" at generationConfig.thinkingConfig',
    },
  },
  {
    thinkingBudget: 8192,
    error: {
      code: 400,
      status: "INVALID_ARGUMENT",
      message: "Request contains an invalid argument",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.BadRequest",
          fieldViolations: [
            {
              field: "generation_config.thinking_config.thinking_budget",
              description: "Value is not supported by this model",
            },
          ],
        },
      ],
    },
  },
])(
  "Gemini retries a rejected explicit thinking setting while preserving generation options and all media: %j",
  async ({ error, ...thinking }) => {
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rejected(400, error))
      .mockResolvedValueOnce(Response.json({ candidates: [] }));
    const onFallback = jest.fn<() => void>();
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: "Describe this recording" },
            {
              inlineData: { mimeType: "audio/mpeg", data: "YXVkaW8=" },
            },
            {
              inlineData: { mimeType: "video/mp4", data: "dmlkZW8=" },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 128000,
        thinkingConfig: { ...thinking, includeThoughts: true },
      },
    };
    const init = request(body);
    await createReasoningFallbackFetch(fetcher, { onFallback })(
      "/api/v1beta/models/gemini-alias:generateContent",
      init,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]).toEqual([
      "/api/v1beta/models/gemini-alias:generateContent",
      {
        ...init,
        body: JSON.stringify({
          ...JSON.parse(init.body),
          generationConfig: {
            ...body.generationConfig,
            thinkingConfig: { includeThoughts: true },
          },
        }),
      },
    ]);
    expect(fetcher.mock.calls[1][1]?.headers).toBe(init.headers);
    expect(fetcher.mock.calls[1][1]?.signal).toBe(init.signal);
    expect(onFallback).toHaveBeenCalledTimes(1);
  },
);

test("Gemini removes an empty thinkingConfig without dropping generationConfig siblings", async () => {
  const fetcher = jest
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      rejected(422, {
        message: "Invalid value for thinkingLevel",
        field: "generationConfig.thinkingConfig.thinkingLevel",
      }),
    )
    .mockResolvedValueOnce(Response.json({}));
  await createReasoningFallbackFetch(fetcher)(
    "/api/gemini",
    request({
      generationConfig: {
        topP: 0.9,
        thinkingConfig: { thinkingLevel: "max" },
      },
    }),
  );
  expect(
    JSON.parse(fetcher.mock.calls[1][1]?.body as string).generationConfig,
  ).toEqual({ topP: 0.9 });
});

test.each([
  {
    message: "output_config.effort: Input should be 'low', 'medium' or 'high'",
    type: "invalid_request_error",
  },
  {
    message: "thinking: Extra inputs are not permitted",
    type: "invalid_request_error",
  },
  {
    message: "This model does not support thinking",
    type: "invalid_request_error",
  },
])(
  "Claude retries native thinking and effort rejections preserving unrelated output settings: %j",
  async (error) => {
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rejected(400, error))
      .mockResolvedValueOnce(Response.json({ content: [] }));
    const init = request({
      thinking: { type: "adaptive" },
      output_config: {
        effort: "max",
        format: { type: "json_schema", schema: { type: "object" } },
      },
      max_tokens: 128000,
    });
    await createReasoningFallbackFetch(fetcher)("/api/v1/messages", init);
    const automatic = JSON.parse(init.body);
    delete automatic.thinking;
    delete automatic.output_config.effort;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]).toEqual([
      "/api/v1/messages",
      { ...init, body: JSON.stringify(automatic) },
    ]);
  },
);

test("Claude explicit enabled thinking can fall back without output_config.effort", async () => {
  const fetcher = jest
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      rejected(400, {
        message: "Invalid thinking.type",
        param: "thinking.type",
      }),
    )
    .mockResolvedValueOnce(Response.json({}));
  await createReasoningFallbackFetch(fetcher)(
    "/api/messages",
    request({ thinking: { type: "enabled", budget_tokens: 4096 } }),
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    JSON.parse(fetcher.mock.calls[1][1]?.body as string).thinking,
  ).toBeUndefined();
});

test("native automatic fallback persists for later rounds and retries at most once", async () => {
  const failure = rejected(400, {
    message: "Invalid thinkingLevel",
    field: "generationConfig.thinkingConfig.thinkingLevel",
  });
  const fetcher = jest
    .fn<typeof fetch>()
    .mockResolvedValueOnce(failure)
    .mockResolvedValueOnce(rejected(400))
    .mockResolvedValueOnce(Response.json({}));
  const onFallback = jest.fn<() => void>();
  const wrapped = createReasoningFallbackFetch(fetcher, { onFallback });
  const init = request({
    generationConfig: { thinkingConfig: { thinkingLevel: "high" } },
  });
  await wrapped("/api/gemini", init);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await wrapped("/api/gemini", init);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(
    JSON.parse(fetcher.mock.calls[2][1]?.body as string).generationConfig,
  ).toEqual({});
  expect(onFallback).toHaveBeenCalledTimes(1);
});

test("a wrapper retries at most once and sends later tool rounds in automatic mode", async () => {
  const second = rejected();
  const onFallback = jest.fn<() => void>();
  const fetcher = jest
    .fn<typeof fetch>()
    .mockResolvedValueOnce(rejected())
    .mockResolvedValueOnce(second)
    .mockResolvedValueOnce(Response.json({ choices: [] }));
  const wrapped = createReasoningFallbackFetch(fetcher, { onFallback });
  expect(
    await wrapped("/api/chat", request({ reasoning_effort: "high" })),
  ).toBe(second);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const tool = request({
    reasoning_effort: "high",
    messages: [
      { role: "tool", content: "Tool result", tool_call_id: "call-1" },
    ],
  });
  await wrapped("/api/chat", tool);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetcher.mock.calls[2][1]?.body as string)).toEqual({
    model: "fixture-model",
    messages: [
      { role: "tool", content: "Tool result", tool_call_id: "call-1" },
    ],
  });
  expect(onFallback).toHaveBeenCalledTimes(1);
});

test.each([
  { message: "Unrecognized request argument supplied: reasoning_effort" },
  { message: "Unknown parameter: reasoning.effort" },
  { message: "Unknown parameter: reasoning" },
  { message: "Unsupported parameter 'reasoning'" },
  { message: "该模型不支持推理强度" },
  { message: "该模型不支持参数：reasoning" },
  { param: "reasoning_effort", code: "invalid_value" },
  "reasoning_effort is not supported by this model",
])(
  "accepts an explicit structured reasoning parameter rejection: %j",
  async (error) => {
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rejected(400, error))
      .mockResolvedValueOnce(Response.json({}));
    await createReasoningFallbackFetch(fetcher)(
      "/api/chat",
      request({ reasoning_effort: "high" }),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);

test.each([401, 403, 404, 409, 429, 500, 502, 503])(
  "never retries HTTP %s even when its body mentions reasoning",
  async (status) => {
    const original = rejected(status);
    const clone = jest.spyOn(original, "clone");
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
    const onFallback = jest.fn<() => void>();
    expect(
      await createReasoningFallbackFetch(fetcher, { onFallback })(
        "/api/chat",
        request({ reasoning_effort: "high" }),
      ),
    ).toBe(original);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(clone).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  },
);

test.each([
  {
    message: "Quota exceeded for reasoning_effort high",
    code: "invalid_request_error",
  },
  { message: "Invalid context length for reasoning_effort high" },
  {
    message: "Invalid temperature with reasoning_effort high",
    param: "temperature",
  },
  { message: "Invalid top_p value", param: "top_p" },
  { message: "Unknown model requested with reasoning_effort high" },
  { message: "Unsupported response_format for a reasoning model" },
  { message: "Invalid response_format while reasoning_effort is high" },
  { message: "Invalid request", code: "invalid_request_error" },
  { message: "Unsupported value", param: "output_format" },
  { message: "该请求上下文长度超出限制，推理强度high无效" },
  {
    message: "Invalid request",
    param: "reasoning_effort",
    code: "quota_exceeded",
  },
  {
    message: "Invalid request",
    param: "reasoning_effort",
    code: "model_not_found",
  },
])(
  "does not reinterpret an unrelated structured error as reasoning incompatibility: %j",
  async (error) => {
    const original = rejected(400, error);
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
    expect(
      await createReasoningFallbackFetch(fetcher)(
        "/api/chat",
        request({ reasoning_effort: "high" }),
      ),
    ).toBe(original);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await original.json()).toEqual({ error });
  },
);

test.each([
  {},
  { reasoning_effort: "auto" },
  { reasoning_effort: "none" },
  { reasoning: { effort: "auto" } },
  { generationConfig: { thinkingConfig: { thinkingBudget: -1 } } },
  { generationConfig: { thinkingConfig: { thinkingLevel: "auto" } } },
  { generationConfig: { thinkingConfig: { includeThoughts: true } } },
  { thinking: { type: "disabled" } },
  { output_config: { effort: "auto" } },
])(
  "requests without a supported explicit effort do not retry: %j",
  async (fields) => {
    const original = rejected();
    const clone = jest.spyOn(original, "clone");
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
    const init = request(fields);
    expect(await createReasoningFallbackFetch(fetcher)("/api/chat", init)).toBe(
      original,
    );
    expect(fetcher).toHaveBeenCalledWith("/api/chat", init);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(clone).not.toHaveBeenCalled();
  },
);

test.each([
  {
    message: "Quota exceeded with thinkingLevel",
    field: "generationConfig.thinkingConfig.thinkingLevel",
  },
  {
    message: "Invalid context length with thinkingBudget",
  },
  {
    message: "Invalid temperature with thinkingLevel",
    field: "generationConfig.temperature",
  },
  {
    message: "Request contains an invalid argument",
    status: "INVALID_ARGUMENT",
    details: [
      {
        fieldViolations: [
          { field: "generationConfig.thinkingConfig.thinkingLevel" },
          { field: "generationConfig.temperature" },
        ],
      },
    ],
  },
  {
    message: "Network connection reset while thinkingLevel is high",
  },
  {
    type: "invalid_request_error",
    message: "output_config.format: Invalid schema",
  },
  {
    type: "invalid_request_error",
    message: "Invalid request",
  },
])(
  "native settings do not retry unrelated parameter failures: %j",
  async (error) => {
    const original = rejected(400, error);
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
    const onFallback = jest.fn<() => void>();
    const init = request({
      generationConfig: { thinkingConfig: { thinkingLevel: "high" } },
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });
    expect(
      await createReasoningFallbackFetch(fetcher, { onFallback })(
        "/api/native",
        init,
      ),
    ).toBe(original);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  },
);

test("automatic retry removes only explicit controls and preserves automatic sentinels", async () => {
  const fetcher = jest
    .fn<typeof fetch>()
    .mockResolvedValueOnce(rejected(400, { message: "Unknown thinkingLevel" }))
    .mockResolvedValueOnce(Response.json({}));
  await createReasoningFallbackFetch(fetcher)(
    "/api/native",
    request({
      reasoning_effort: "auto",
      reasoning: { effort: "auto", summary: "auto" },
      generationConfig: {
        thinkingConfig: { thinkingLevel: "high", thinkingBudget: -1 },
      },
      thinking: { type: "disabled" },
      output_config: { effort: "auto" },
    }),
  );
  expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toMatchObject({
    reasoning_effort: "auto",
    reasoning: { effort: "auto", summary: "auto" },
    generationConfig: { thinkingConfig: { thinkingBudget: -1 } },
    thinking: { type: "disabled" },
    output_config: { effort: "auto" },
  });
});

test.each(["not JSON", "[]", "null"])(
  "does not inspect a response when request JSON is unusable: %s",
  async (body) => {
    const original = rejected();
    const clone = jest.spyOn(original, "clone");
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
    await createReasoningFallbackFetch(fetcher)("/api/chat", { body });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(clone).not.toHaveBeenCalled();
  },
);

test("preserves an unparseable error response for the existing error handler", async () => {
  const original = new Response("upstream error page", { status: 400 });
  const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
  expect(
    await createReasoningFallbackFetch(fetcher)(
      "/api/chat",
      request({ reasoning_effort: "high" }),
    ),
  ).toBe(original);
  expect(await original.text()).toBe("upstream error page");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("network errors propagate without a fallback or another request", async () => {
  const error = new TypeError("Failed to fetch");
  const fetcher = jest.fn<typeof fetch>().mockRejectedValue(error);
  const onFallback = jest.fn<() => void>();
  await expect(
    createReasoningFallbackFetch(fetcher, { onFallback })(
      "/api/chat",
      request({ reasoning_effort: "high" }),
    ),
  ).rejects.toBe(error);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(onFallback).not.toHaveBeenCalled();
});

test("a successful request with a large attachment does not parse its JSON payload", async () => {
  const init = request({
    reasoning_effort: "high",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${"a".repeat(2 * 1024 * 1024)}`,
            },
          },
        ],
      },
    ],
  });
  const response = Response.json({ choices: [] });
  const fetcher = jest.fn<typeof fetch>().mockResolvedValue(response);
  const wrapped = createReasoningFallbackFetch(fetcher);
  const parse = jest.spyOn(JSON, "parse");
  try {
    expect(await wrapped("/api/chat", init)).toBe(response);
    expect(parse).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toBe(init);
  } finally {
    parse.mockRestore();
  }
});

test("a successful SSE response is neither cloned, read, nor retried", async () => {
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        output = controller;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const clone = jest.spyOn(response, "clone");
  const text = jest.spyOn(response, "text");
  const json = jest.spyOn(response, "json");
  const fetcher = jest.fn<typeof fetch>().mockResolvedValue(response);
  const wrapped = createReasoningFallbackFetch(fetcher);
  expect(
    await wrapped("/api/chat", request({ reasoning_effort: "high" })),
  ).toBe(response);
  const reader = response.body!.getReader();
  output.enqueue(new TextEncoder().encode('data: {"content":"partial"}\n\n'));
  expect((await reader.read()).done).toBe(false);
  output.error(new Error("Connection lost after partial output"));
  await expect(reader.read()).rejects.toThrow("partial output");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(clone).not.toHaveBeenCalled();
  expect(text).not.toHaveBeenCalled();
  expect(json).not.toHaveBeenCalled();
});

test.each(["aborted", "credentials changed"] as const)(
  "does not retry after the %s",
  async (reason) => {
    const controller = new AbortController();
    const original = rejected();
    const onFallback = jest.fn<() => void>();
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
    const isCurrent = jest.fn(() => reason !== "credentials changed");
    if (reason === "aborted") controller.abort();
    const init = {
      ...request({ reasoning_effort: "high" }),
      signal: controller.signal,
    };
    expect(
      await createReasoningFallbackFetch(fetcher, { onFallback, isCurrent })(
        "/api/chat",
        init,
      ),
    ).toBe(original);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  },
);

test("rechecks current credentials after reading the error body", async () => {
  const original = rejected();
  const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
  const onFallback = jest.fn<() => void>();
  const isCurrent = jest
    .fn<() => boolean>()
    .mockReturnValueOnce(true)
    .mockReturnValue(false);
  await createReasoningFallbackFetch(fetcher, { onFallback, isCurrent })(
    "/api/chat",
    request({ reasoning_effort: "high" }),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(onFallback).not.toHaveBeenCalled();
});

test("a declined fallback callback runs at most once and preserves the original response", async () => {
  const original = rejected();
  const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
  const onFallback = jest.fn(() => false);
  const wrapped = createReasoningFallbackFetch(fetcher, { onFallback });
  const init = request({ reasoning_effort: "high" });
  expect(await wrapped("/api/chat", init)).toBe(original);
  expect(await wrapped("/api/chat", init)).toBe(original);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(onFallback).toHaveBeenCalledTimes(1);
  expect(await original.json()).toHaveProperty("error");
});

test("a fallback callback that aborts the request cannot trigger a retry", async () => {
  const original = rejected();
  const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
  const controller = new AbortController();
  await createReasoningFallbackFetch(fetcher, {
    onFallback: () => controller.abort(),
  })("/api/chat", {
    ...request({ reasoning_effort: "high" }),
    signal: controller.signal,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await original.json()).toHaveProperty("error");
});

test.each([400, 422])(
  "recognizes the production-safe reasoning marker for HTTP %s",
  async (status) => {
    const error = {
      error: true,
      message: `请求失败 (${status})`,
      reasoningUnsupported: true,
    };
    expect(isUnsupportedReasoningError(status, error)).toBe(true);
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(error, { status }))
      .mockResolvedValueOnce(Response.json({}));
    await createReasoningFallbackFetch(fetcher)(
      "/api/chat",
      request({ reasoning_effort: "high" }),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);

test.each([200, 401, 403, 429, 500])(
  "does not accept the safe marker outside parameter error statuses: %s",
  (status) => {
    expect(
      isUnsupportedReasoningError(status, { reasoningUnsupported: true }),
    ).toBe(false);
  },
);

test.each([
  { error: true, message: "请求失败 (400)" },
  { reasoningUnsupported: "true" },
  { reasoningUnsupported: false },
])("does not infer the safe marker from generic errors: %j", (error) => {
  expect(isUnsupportedReasoningError(400, error)).toBe(false);
});

test("rechecks credentials after the fallback callback before resending", async () => {
  const original = rejected();
  const fetcher = jest.fn<typeof fetch>().mockResolvedValue(original);
  let current = true;
  await createReasoningFallbackFetch(fetcher, {
    isCurrent: () => current,
    onFallback: () => {
      current = false;
    },
  })("/api/chat", request({ reasoning_effort: "high" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await original.json()).toHaveProperty("error");
});
