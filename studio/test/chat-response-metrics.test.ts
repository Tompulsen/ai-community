import type { ChatMessage } from "../app/store/chat";
import { getResponseMetrics } from "../app/utils/chat-response-metrics";

function answer(fields: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "answer",
    role: "assistant",
    date: "",
    content: "A measured answer",
    responseMetrics: {
      usage: { inputTokens: 1000, outputTokens: 84, cachedInputTokens: 994 },
      generationDurationMs: 3000,
    },
    ...fields,
  };
}

test("uses actual response usage and observed generation duration", () => {
  expect(getResponseMetrics([answer()])).toEqual({
    outputTokensPerSecond: 28,
    cacheHitPercent: 99.4,
    pending: false,
  });
});

test("does not treat legacy request duration as generation time", () => {
  const measured = answer({
    responseMetrics: {
      usage: { inputTokens: 1000, outputTokens: 84, cachedInputTokens: 994 },
      durationMs: 30000,
    },
  });
  expect(getResponseMetrics([measured])).toEqual({
    outputTokensPerSecond: undefined,
    cacheHitPercent: 99.4,
    pending: false,
  });
  measured.responseMetrics!.generationDurationMs = 3000;
  expect(getResponseMetrics([measured]).outputTokensPerSecond).toBe(28);
});

test("keeps empty conversations and legacy responses unknown", () => {
  expect(getResponseMetrics([])).toEqual({
    outputTokensPerSecond: undefined,
    cacheHitPercent: undefined,
    pending: false,
  });
  expect(getResponseMetrics([answer({ responseMetrics: undefined })])).toEqual(
    getResponseMetrics([]),
  );
});

test("keeps the last available metrics when the newest answer has no usage", () => {
  expect(
    getResponseMetrics([
      answer(),
      answer({ id: "latest", responseMetrics: undefined }),
    ]),
  ).toEqual({
    outputTokensPerSecond: 28,
    cacheHitPercent: 99.4,
    pending: false,
    speedIsPrevious: true,
    cacheIsPrevious: true,
  });
});

test.each([
  { streaming: true },
  { streaming: true, materialStatus: "processing" as const },
  { interrupted: true },
  { isError: true },
])(
  "preserves completed metrics while a new answer is unavailable: %j",
  (state) => {
    expect(
      getResponseMetrics([
        answer(),
        answer({ id: "latest", responseMetrics: undefined, ...state }),
      ]),
    ).toMatchObject({
      outputTokensPerSecond: 28,
      cacheHitPercent: 99.4,
      pending: !!state.streaming,
      speedIsPrevious: true,
      cacheIsPrevious: true,
    });
  },
);

test("replaces speed and cache independently as the new response arrives", () => {
  const latest = answer({
    id: "latest",
    streaming: true,
    responseMetrics: undefined,
    generationProgress: { outputTokens: 60, durationMs: 2000 },
  });
  expect(getResponseMetrics([answer(), latest])).toEqual({
    outputTokensPerSecond: 30,
    cacheHitPercent: 99.4,
    pending: true,
    speedIsEstimated: true,
    cacheIsPrevious: true,
  });
  latest.generationProgress = { outputTokens: 100, durationMs: 2500 };
  latest.responseMetrics = {
    usage: { inputTokens: 1000, cachedInputTokens: 0 },
  };
  expect(getResponseMetrics([answer(), latest])).toEqual({
    outputTokensPerSecond: 40,
    cacheHitPercent: 0,
    pending: true,
    speedIsEstimated: true,
  });
  latest.streaming = false;
  latest.responseMetrics = {
    usage: { inputTokens: 1000, outputTokens: 125, cachedInputTokens: 0 },
    generationDurationMs: 2500,
  };
  expect(getResponseMetrics([answer(), latest])).toEqual({
    outputTokensPerSecond: 50,
    cacheHitPercent: 0,
    pending: false,
  });
});

test("new cache usage does not clear the previous speed before output", () => {
  const latest = answer({
    id: "latest",
    streaming: true,
    responseMetrics: { usage: { inputTokens: 1000, cachedInputTokens: 250 } },
  });
  expect(getResponseMetrics([answer(), latest])).toEqual({
    outputTokensPerSecond: 28,
    cacheHitPercent: 25,
    pending: true,
    speedIsPrevious: true,
  });
});

test("retains a clearly estimated completed speed when output usage is unavailable", () => {
  const measured = answer({
    responseMetrics: {
      usage: {},
      generationDurationMs: 2000,
      estimatedOutputTokens: 60,
    },
  });
  expect(getResponseMetrics([measured])).toEqual({
    outputTokensPerSecond: 30,
    cacheHitPercent: undefined,
    pending: false,
    speedIsEstimated: true,
  });
  expect(
    getResponseMetrics([
      measured,
      answer({ id: "next", streaming: true, responseMetrics: undefined }),
    ]),
  ).toMatchObject({
    outputTokensPerSecond: 30,
    pending: true,
    speedIsEstimated: true,
    speedIsPrevious: true,
  });
  measured.responseMetrics!.usage.outputTokens = 0;
  expect(getResponseMetrics([measured])).toMatchObject({
    outputTokensPerSecond: 0,
  });
  expect(getResponseMetrics([measured]).speedIsEstimated).toBeUndefined();
});

test.each([
  { outputTokens: 10, durationMs: 0 },
  { outputTokens: 10, durationMs: Number.NaN },
  { outputTokens: -1, durationMs: 1000 },
  { outputTokens: 1.5, durationMs: 1000 },
])("ignores invalid live progress: %j", (generationProgress) => {
  expect(
    getResponseMetrics([answer({ streaming: true, generationProgress })])
      .outputTokensPerSecond,
  ).toBeUndefined();
});

test("keeps real zero cache hits and zero output distinct from unavailable data", () => {
  const metrics = answer({
    responseMetrics: {
      usage: { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 0 },
      generationDurationMs: 3000,
    },
  });
  expect(getResponseMetrics([metrics])).toEqual({
    outputTokensPerSecond: 0,
    cacheHitPercent: 0,
    pending: false,
  });
  metrics.responseMetrics!.usage.cachedInputTokens = undefined;
  expect(getResponseMetrics([metrics]).cacheHitPercent).toBeUndefined();
});

test.each([
  { streaming: true },
  { materialStatus: "processing" as const },
  { interrupted: true },
  { isError: true },
])(
  "does not give completed output speed to an unfinished answer: %j",
  (state) => {
    expect(
      getResponseMetrics([answer(state)]).outputTokensPerSecond,
    ).toBeUndefined();
  },
);

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined])(
  "rejects invalid or unknown duration %s",
  (generationDurationMs) => {
    expect(
      getResponseMetrics([
        answer({
          responseMetrics: {
            usage: { outputTokens: 84 },
            generationDurationMs,
          },
        }),
      ]).outputTokensPerSecond,
    ).toBeUndefined();
  },
);

test.each([
  { inputTokens: 0, cachedInputTokens: 0 },
  { inputTokens: 10, cachedInputTokens: 11 },
  { inputTokens: 10, cachedInputTokens: -1 },
  { inputTokens: Number.NaN, cachedInputTokens: 0 },
  { inputTokens: 10.5, cachedInputTokens: 0 },
  { cachedInputTokens: 0 },
])("rejects undefined or inconsistent cache usage %j", (usage) => {
  expect(
    getResponseMetrics([answer({ responseMetrics: { usage } })])
      .cacheHitPercent,
  ).toBeUndefined();
});

test("reads only the active path and leaves provider counts unchanged", () => {
  const messages = [answer(), answer({ id: "user", role: "user" })];
  const snapshot = JSON.stringify(messages);
  expect(getResponseMetrics(messages).outputTokensPerSecond).toBe(28);
  expect(JSON.stringify(messages)).toBe(snapshot);
});
