import {
  buildChatRequest,
  createChatStreamParser,
  extractChatResponse,
  extractChatReasoning,
  nativeChatUrl,
} from "../app/client/chat-formats";
import { chatApiFormat } from "../app/utils/chat-api-format";
import { fileContentParts, parseFile } from "../app/utils/file-upload";
import type { RequestMessage } from "../app/client/api";
import { jest } from "@jest/globals";

const config = { model: "test-model", stream: true, max_tokens: 2048 };
const bytes = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4";
const messages: RequestMessage[] = [
  { role: "system", content: "System instruction" },
  { role: "user", content: "Previous question" },
  { role: "assistant", content: "Previous answer" },
  {
    role: "user",
    content: [
      { type: "text", text: "Read this" },
      {
        type: "file",
        file: {
          filename: "test.txt",
          file_data: `data:text/plain;base64,${bytes}`,
        },
      },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,aW1hZ2U=" },
      },
    ],
  },
];

test("unknown and legacy formats retain Chat Completions", () => {
  expect(chatApiFormat()).toBe("chat-completions");
  expect(chatApiFormat("unknown")).toBe("chat-completions");
});

test("explicit output token limits are respected without magic numeric exceptions", () => {
  const legacy = { ...config, max_tokens: 102400 };
  expect(
    buildChatRequest("responses", messages, legacy).body.max_output_tokens,
  ).toBe(102400);
  expect(
    buildChatRequest("gemini", messages, legacy).body.generationConfig
      .maxOutputTokens,
  ).toBe(102400);
  expect(buildChatRequest("claude", messages, legacy).body.max_tokens).toBe(
    102400,
  );
});

test("Responses preserves history and original file bytes", () => {
  const { endpoint, body } = buildChatRequest("responses", messages, config);
  expect(endpoint).toBe("responses");
  expect(body.store).toBe(false);
  expect(body.input).toHaveLength(4);
  expect(body.input[2].content[0]).toEqual({
    type: "output_text",
    text: "Previous answer",
  });
  expect(body.input[3].content[1]).toEqual({
    type: "input_file",
    filename: "test.txt",
    file_data: `data:text/plain;base64,${bytes}`,
  });
});

test("Gemini separates system instructions and preserves inline material", () => {
  const { endpoint, body } = buildChatRequest("gemini", messages, config);
  expect(endpoint).toBe(
    "v1beta/models/test-model:streamGenerateContent?alt=sse",
  );
  expect(body.systemInstruction.parts).toEqual([
    { text: "System instruction" },
  ]);
  expect(body.contents[1].role).toBe("model");
  expect(body.contents[2].parts[1]).toEqual({
    inlineData: { mimeType: "text/plain", data: bytes },
  });
  expect(nativeChatUrl("https://example.test/gateway/v1/", endpoint)).toBe(
    `https://example.test/gateway/${endpoint}`,
  );
  expect(() =>
    buildChatRequest("gemini", messages, { ...config, model: "../bad" }),
  ).toThrow();
});

test.each([
  ["sample.mp3", "audio/mpeg"],
  ["sample.m4a", "audio/mp4"],
  ["sample.wav", "audio/wav"],
  ["sample.opus", "audio/opus"],
  ["sample.mp4", "video/mp4"],
  ["sample.mov", "video/quicktime"],
  ["sample.webm", "video/webm"],
])(
  "Gemini sends %s with its MIME type and intact bytes",
  async (name, mimeType) => {
    const file = await parseFile(new File(["original material bytes"], name));
    const content = fileContentParts([file]);
    const { body } = buildChatRequest(
      "gemini",
      [{ role: "user", content }],
      config,
    );
    expect(body.contents).toEqual([
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: btoa("original material bytes") } },
        ],
      },
    ]);
    expect(content[0].type).toBe(
      mimeType.startsWith("video/") ? "video_url" : "input_audio",
    );
  },
);

test.each([true, false])(
  "Gemini preserves text, audio/video history and selected model when stream=%s",
  async (stream) => {
    const audio = await parseFile(new File(["audio bytes"], "audio.m4a"));
    const video = await parseFile(new File(["video bytes"], "video.mp4"));
    const { endpoint, body } = buildChatRequest(
      "gemini",
      [
        { role: "system", content: "Follow the user request" },
        {
          role: "user",
          content: [
            { type: "text", text: "Listen to this" },
            ...fileContentParts([audio]),
          ],
        },
        { role: "assistant", content: "Previous answer" },
        {
          role: "user",
          content: [
            { type: "text", text: "Compare with this video" },
            ...fileContentParts([video]),
          ],
        },
      ],
      { ...config, model: "gemini-selected-alias", stream },
    );
    expect(endpoint).toBe(
      `v1beta/models/gemini-selected-alias:${
        stream ? "streamGenerateContent?alt=sse" : "generateContent"
      }`,
    );
    expect(body.systemInstruction.parts).toEqual([
      { text: "Follow the user request" },
    ]);
    expect(body.contents).toEqual([
      {
        role: "user",
        parts: [
          { text: "Listen to this" },
          { inlineData: { mimeType: "audio/mp4", data: btoa("audio bytes") } },
        ],
      },
      { role: "model", parts: [{ text: "Previous answer" }] },
      {
        role: "user",
        parts: [
          { text: "Compare with this video" },
          { inlineData: { mimeType: "video/mp4", data: btoa("video bytes") } },
        ],
      },
    ]);
  },
);

test("Gemini preserves unknown audio MIME subtypes for the upstream to evaluate", () => {
  const { body } = buildChatRequest(
    "gemini",
    [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { format: "custom-audio", data: bytes },
          },
        ],
      },
    ],
    config,
  );
  expect(body.contents[0].parts[0]).toEqual({
    inlineData: { mimeType: "audio/custom-audio", data: bytes },
  });
});

test("Gemini retains an audio file's declared MIME when its extension is not recognized", async () => {
  const file = await parseFile(
    new File(["original audio bytes"], "clip.recording", {
      type: "audio/mpeg",
    }),
  );
  const { body } = buildChatRequest(
    "gemini",
    [{ role: "user", content: fileContentParts([file]) }],
    config,
  );
  expect(body.contents[0].parts).toEqual([
    {
      inlineData: {
        mimeType: "audio/mpeg",
        data: btoa("original audio bytes"),
      },
    },
  ]);
});

test.each(["gemini", "claude"] as const)(
  "explicit native %s reasoning keeps all conversation and attachment blocks intact",
  (format) => {
    const automatic = buildChatRequest(format, messages, config);
    const explicitConfig = {
      ...config,
      reasoningEffort: "high" as const,
      temperature: 0.7,
    };
    const originalConfig = { ...explicitConfig };
    const explicit = buildChatRequest(format, messages, explicitConfig);
    expect(explicit.endpoint).toBe(automatic.endpoint);
    if (format === "gemini") {
      expect(explicit.body.contents).toEqual(automatic.body.contents);
      expect(explicit.body.systemInstruction).toEqual(
        automatic.body.systemInstruction,
      );
      expect(explicit.body.generationConfig.thinkingConfig).toEqual({
        thinkingLevel: "high",
      });
    } else {
      expect(explicit.body.messages).toEqual(automatic.body.messages);
      expect(explicit.body.system).toEqual(automatic.body.system);
      expect(explicit.body.output_config).toEqual({ effort: "high" });
    }
    expect(explicitConfig).toEqual(originalConfig);
  },
);

test("Claude preserves original files, images and history", () => {
  const { endpoint, body } = buildChatRequest("claude", messages, config);
  expect(endpoint).toBe("messages");
  expect(body.system).toEqual([{ type: "text", text: "System instruction" }]);
  expect(body.messages[1].role).toBe("assistant");
  expect(body.messages[2].content[1]).toEqual({
    type: "document",
    title: "test.txt",
    source: { type: "base64", media_type: "text/plain", data: bytes },
  });
  expect(body.messages[2].content[2].type).toBe("image");
});

test.each(["gemini", "claude"] as const)(
  "native %s rejects system attachments explicitly",
  (format) => {
    expect(() =>
      buildChatRequest(format, [{ ...messages[3], role: "system" }], config),
    ).toThrow("系统指令");
  },
);

test("Responses finishes without duplicating text and surfaces upstream errors", () => {
  const parse = createChatStreamParser("responses");
  expect(
    parse(
      JSON.stringify({ type: "response.output_text.delta", delta: "Answer" }),
    ).content,
  ).toBe("Answer");
  expect(
    parse(
      JSON.stringify({
        type: "response.completed",
        response: { output_text: "Answer" },
      }),
    ),
  ).toMatchObject({ content: "", done: true });
  expect(
    parse(
      JSON.stringify({
        type: "response.failed",
        response: { error: { message: "quota exhausted" } },
      }),
    ).error,
  ).toBe("quota exhausted");
});

test("Gemini and Claude parse text, thinking and completion", () => {
  const gemini = createChatStreamParser("gemini");
  expect(
    gemini(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "Answer" }] }, finishReason: "STOP" },
        ],
      }),
    ),
  ).toMatchObject({ content: "Answer", done: true });
  const claude = createChatStreamParser("claude");
  expect(
    claude(
      JSON.stringify({
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "Thinking" },
      }),
    ),
  ).toMatchObject({ content: "Thinking", isThinking: true });
  expect(claude(JSON.stringify({ type: "message_stop" })).done).toBe(true);
  expect(
    gemini(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })).error,
  ).toContain("SAFETY");
});

test("mixed Gemini chunks preserve both the reasoning and final answer", () => {
  const parse = createChatStreamParser("gemini");
  expect(
    parse(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: "Check facts" },
                { text: "Answer" },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }),
    ),
  ).toMatchObject({
    content: "Answer",
    reasoning: "Check facts",
    isThinking: false,
    done: true,
  });
});

test.each([
  [
    "responses",
    {
      output: [
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Summary" }],
        },
        { type: "message", content: [{ type: "output_text", text: "Answer" }] },
      ],
    },
  ],
  [
    "gemini",
    {
      candidates: [
        {
          content: {
            parts: [{ thought: true, text: "Summary" }, { text: "Answer" }],
          },
        },
      ],
    },
  ],
  [
    "claude",
    {
      content: [
        { type: "thinking", thinking: "Summary" },
        { type: "text", text: "Answer" },
      ],
    },
  ],
] as const)(
  "nonstream %s extracts reasoning separately",
  (format, response) => {
    expect(extractChatReasoning(format, response)).toBe("Summary");
    expect(extractChatResponse(format, response)).toBe("Answer");
  },
);

test("nonstream extraction reports errors instead of empty success", () => {
  expect(
    extractChatResponse("responses", {
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Response" }],
        },
      ],
    }),
  ).toBe("Response");
  expect(
    extractChatResponse("claude", {
      content: [{ type: "text", text: "Claude" }],
    }),
  ).toBe("Claude");
  expect(
    extractChatResponse("gemini", {
      candidates: [
        {
          content: {
            parts: [{ thought: true, text: "Private" }, { text: "Gemini" }],
          },
        },
      ],
    }),
  ).toBe("Gemini");
  expect(() =>
    extractChatResponse("claude", { error: { message: "Unsupported file" } }),
  ).toThrow("Unsupported file");
  expect(() => extractChatResponse("responses", {})).toThrow("未返回");
});

test("Responses terminal usage is delivered when all text arrived earlier", () => {
  const onUsage = jest.fn();
  const parse = createChatStreamParser("responses", onUsage);
  parse(
    JSON.stringify({ type: "response.output_text.delta", delta: "Answer" }),
  );
  expect(
    parse(
      JSON.stringify({
        type: "response.completed",
        response: {
          output_text: "Answer",
          usage: {
            input_tokens: 20,
            output_tokens: 8,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      }),
    ),
  ).toMatchObject({ content: "", done: true });
  expect(onUsage).toHaveBeenCalledWith({
    inputTokens: 20,
    outputTokens: 8,
    cachedInputTokens: 0,
  });
});

test("Gemini usage-only chunks report counters without inventing text", () => {
  const onUsage = jest.fn();
  const parse = createChatStreamParser("gemini", onUsage);
  expect(
    parse(
      JSON.stringify({
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 4,
          cachedContentTokenCount: 0,
        },
      }),
    ),
  ).toMatchObject({ content: "", isThinking: false });
  expect(onUsage).toHaveBeenCalledWith({
    inputTokens: 10,
    outputTokens: 4,
    cachedInputTokens: 0,
  });
});

test("Claude usage survives message_start and cumulative message_delta events", () => {
  const onUsage = jest.fn();
  const parse = createChatStreamParser("claude", onUsage);
  parse(
    JSON.stringify({
      type: "message_start",
      message: {
        usage: {
          input_tokens: 10,
          output_tokens: 0,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 5,
        },
      },
    }),
  );
  parse(JSON.stringify({ type: "message_delta", usage: { output_tokens: 4 } }));
  expect(parse(JSON.stringify({ type: "message_stop" }))).toMatchObject({
    done: true,
  });
  expect(onUsage).toHaveBeenLastCalledWith({
    inputTokens: 35,
    outputTokens: 4,
    cachedInputTokens: 20,
  });
});
