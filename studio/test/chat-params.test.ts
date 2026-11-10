import {
  REASONING_EFFORT_OPTIONS,
  migrateChatParams,
  reasoningEffort,
  stopSequences,
} from "../app/utils/chat-params";
import { buildChatRequest } from "../app/client/chat-formats";

test("stop sequences retain intentional whitespace and reject more than four entries", () => {
  expect(stopSequences("")).toBeUndefined();
  expect(stopSequences(" END\n\nSTOP")).toEqual([" END", "STOP"]);
  expect(() => stopSequences("a\nb\nc\nd\ne")).toThrow("最多");
});

test("migration changes only the old output default and supplies the new compression capacity", () => {
  const old = { max_tokens: 102400 };
  migrateChatParams(old);
  expect(old).toEqual({ max_tokens: 128000, compressionThreshold: 272000 });
  const custom = { max_tokens: 8192, compressionThreshold: 80000 };
  migrateChatParams(custom);
  expect(custom).toEqual({ max_tokens: 8192, compressionThreshold: 80000 });
});

test.each(["low", "medium", "high", "xhigh", "max", "ultra"] as const)(
  "Responses retains the explicitly selected reasoning effort %s",
  (effort) => {
    expect(reasoningEffort(effort)).toBe(effort);
    const body = buildChatRequest("responses", [], {
      model: "test",
      stream: false,
      reasoningEffort: effort,
      max_tokens: 52000,
    }).body;
    expect(body).toMatchObject({
      stream: false,
      max_output_tokens: 52000,
      reasoning: { effort },
    });
  },
);

test.each(["auto", "none", "minimal", "", "unknown", "HIGH", undefined])(
  "optional reasoning omits automatic or invalid setting %s",
  (value) => {
    expect(reasoningEffort(value)).toBeUndefined();
  },
);

test("automatic Responses reasoning omits the API parameter", () => {
  const body = buildChatRequest("responses", [], {
    model: "test",
    stream: false,
    reasoningEffort: "auto",
    max_tokens: 52000,
  }).body;
  expect(body).toMatchObject({
    stream: false,
    max_output_tokens: 52000,
  });
  expect(body).not.toHaveProperty("reasoning");
});

test.each(["low", "medium", "high", "xhigh", "max", "ultra"] as const)(
  "Gemini retains explicit %s without inventing budget or clamping levels",
  (effort) => {
    const body = buildChatRequest("gemini", [], {
      model: "gemini-custom-alias",
      reasoningEffort: effort,
      temperature: 0.7,
      stop: "END",
    }).body;
    expect(body.generationConfig).toMatchObject({
      temperature: 0.7,
      thinkingConfig: { thinkingLevel: effort },
      stopSequences: ["END"],
    });
    expect(body.generationConfig.thinkingConfig).not.toHaveProperty(
      "thinkingBudget",
    );
    expect(body).not.toHaveProperty("reasoning_effort");
  },
);

test.each(["low", "medium", "high", "xhigh", "max", "ultra"] as const)(
  "Claude retains explicit %s with native adaptive thinking and effort",
  (effort) => {
    const body = buildChatRequest("claude", [], {
      model: "claude-sonnet-4-6",
      reasoningEffort: effort,
      temperature: 0.7,
      top_p: 0.5,
      stop: "END",
    }).body;
    expect(body.output_config).toEqual({ effort });
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.stop_sequences).toEqual(["END"]);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("reasoning_effort");
  },
);

test.each(["gemini", "claude"] as const)(
  "automatic %s reasoning leaves native thinking fields omitted",
  (format) => {
    const body = buildChatRequest(format, [], {
      model: "custom-alias",
      reasoningEffort: "auto",
      temperature: 0.7,
    }).body;
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("output_config");
    expect(body.generationConfig ?? {}).not.toHaveProperty("thinkingConfig");
    expect(
      format === "gemini"
        ? body.generationConfig.temperature
        : body.temperature,
    ).toBe(0.7);
  },
);

test.each([
  "claude-opus-4-5",
  "claude-opus-4.5",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
])("older native Claude %s does not receive adaptive thinking", (model) => {
  const body = buildChatRequest("claude", [], {
    model,
    reasoningEffort: "high",
  }).body;
  expect(body.output_config).toEqual({ effort: "high" });
  expect(body).not.toHaveProperty("thinking");
});

test.each([
  "claude-opus-4-6",
  "claude-sonnet-4.7",
  "claude-opus-5",
  "custom-alias",
])(
  "native Claude %s uses upstream validation instead of blocking explicit effort",
  (model) => {
    const body = buildChatRequest("claude", [], {
      model,
      reasoningEffort: "high",
    }).body;
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body.thinking).toEqual({ type: "adaptive" });
  },
);

test("shared reasoning options list automatic mode before increasing effort", () => {
  expect(REASONING_EFFORT_OPTIONS).toEqual([
    { value: "auto", label: "自动" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "XHigh" },
    { value: "max", label: "Max" },
    { value: "ultra", label: "Ultra" },
  ]);
});

test("native stop fields are adapted and unsupported settings fail explicitly", () => {
  const config = { model: "test", stop: "END\nSTOP" };
  expect(
    buildChatRequest("gemini", [], config).body.generationConfig.stopSequences,
  ).toEqual(["END", "STOP"]);
  const claude = buildChatRequest("claude", [], {
    ...config,
    top_p: 0.5,
    temperature: 0.4,
  }).body;
  expect(claude.stop_sequences).toEqual(["END", "STOP"]);
  expect(claude.top_p).toBeUndefined();
  expect(() => buildChatRequest("responses", [], config)).toThrow(
    "不支持停止序列",
  );
  expect(
    buildChatRequest("gemini", [], {
      ...config,
      reasoningEffort: "medium",
    }).body.generationConfig,
  ).toMatchObject({
    stopSequences: ["END", "STOP"],
    thinkingConfig: { thinkingLevel: "medium" },
  });
});
