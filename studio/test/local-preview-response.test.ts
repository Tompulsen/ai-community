import { jest } from "@jest/globals";
import type { ChatGenerationProgress } from "../app/client/api";
import { contextTokens, prepareContext } from "../app/utils/context-budget";
import { estimateTokenLength } from "../app/utils/token";
import {
  LOCAL_PREVIEW_COMPONENTS_MODEL,
  LOCAL_PREVIEW_COMPRESSION_MODEL,
  LOCAL_PREVIEW_LONG_MODEL,
  LOCAL_PREVIEW_MEDIA_MODEL,
  LOCAL_PREVIEW_METRICS_MODEL,
  LOCAL_PREVIEW_NO_USAGE_MODEL,
  LOCAL_PREVIEW_RESPONSE,
} from "../app/utils/local-preview-models";
import {
  getLocalPreviewResponse,
  getLocalPreviewHistory,
  getLocalPreviewSummary,
  streamLocalPreviewResponse,
} from "../app/utils/local-preview-response";

beforeEach(() => {
  jest.useFakeTimers();
  jest.replaceProperty(process.env, "NODE_ENV", "development");
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("local simulation waits for thinking, streams cumulative text, and releases its timers", async () => {
  const controller = new AbortController();
  const onUpdate = jest.fn<(text: string) => void>();
  let finished = false;
  const pending = streamLocalPreviewResponse({
    signal: controller.signal,
    onUpdate,
  }).then((response) => {
    finished = true;
    return response;
  });
  await jest.advanceTimersByTimeAsync(699);
  expect(onUpdate).not.toHaveBeenCalled();
  expect(finished).toBe(false);

  await jest.advanceTimersByTimeAsync(41);
  expect(onUpdate).toHaveBeenCalled();
  expect(onUpdate.mock.calls[0][0].length).toBe(4);
  const partial = onUpdate.mock.calls.at(-1)![0];
  expect(finished).toBe(false);
  await jest.advanceTimersByTimeAsync(40);
  expect(onUpdate.mock.calls.at(-1)![0].length).toBe(partial.length + 4);

  await jest.runAllTimersAsync();
  expect(await pending).toEqual({ content: LOCAL_PREVIEW_RESPONSE });
  const parts = onUpdate.mock.calls.map(([text]) => text);
  const final = parts.at(-1)!;
  expect(final).toBe(LOCAL_PREVIEW_RESPONSE);
  for (let index = 0; index < parts.length; index++) {
    expect(final.startsWith(parts[index])).toBe(true);
    const previousLength = index ? parts[index - 1].length : 0;
    const added = parts[index].length - previousLength;
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThanOrEqual(4);
    if (index < parts.length - 1) expect(added).toBe(4);
  }
  expect(finished).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test("the long preview provides about ten thousand Chinese characters and many reflowing sections", () => {
  const response = getLocalPreviewResponse(LOCAL_PREVIEW_LONG_MODEL);
  const chinese = response.content.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  expect(chinese).toBeGreaterThanOrEqual(9000);
  expect(chinese).toBeLessThanOrEqual(11000);
  expect(response.content.match(/^## /gm)!.length).toBeGreaterThanOrEqual(15);
  expect(response.content.match(/^\d+\. /gm)!.length).toBeGreaterThanOrEqual(
    40,
  );
  expect(response.content).not.toMatch(
    /!\[|<(?:img|video|audio|iframe|script)\b/i,
  );
  expect(response.reasoning).toBeUndefined();
  expect(response.tools).toBeUndefined();
});

test("the media scene uses local single, four-image and playable video assets", async () => {
  const history = getLocalPreviewHistory(LOCAL_PREVIEW_MEDIA_MODEL);
  expect(history).toHaveLength(4);
  expect(history[1]).toMatchObject({
    content: "![Generated Image](/local-preview/media/image-1.jpg)",
    imageRequestDurationMs: 1850,
  });
  expect(
    String(history[3].content).match(/!\[Generated Image\]/g),
  ).toHaveLength(4);
  expect(history[3].imageRequestDurationMs).toBe(266000);
  const expected = getLocalPreviewResponse(LOCAL_PREVIEW_MEDIA_MODEL);
  expect(expected.content).toBe(
    "[本地视频预览](/local-preview/media/preview.mp4)",
  );
  expect(JSON.stringify([history, expected])).not.toMatch(/https?:\/\//);
  const onUpdate = jest.fn<(text: string) => void>();
  const pending = streamLocalPreviewResponse({
    model: LOCAL_PREVIEW_MEDIA_MODEL,
    signal: new AbortController().signal,
    onUpdate,
  });
  await jest.runAllTimersAsync();
  expect(await pending).toEqual(expected);
  expect(onUpdate.mock.calls.at(-1)![0]).toBe(expected.content);
  expect(jest.getTimerCount()).toBe(0);
});

test("the component preview includes Markdown examples, reasoning and independently owned static tool results", () => {
  const response = getLocalPreviewResponse(LOCAL_PREVIEW_COMPONENTS_MODEL);
  expect(response.content).toMatch(/^# /m);
  expect(response.content).toMatch(/^#### /m);
  expect(response.content).toContain("| 时间 |");
  expect(response.content).toMatch(/^> /m);
  expect(response.content).toMatch(/^- \[x\] /m);
  expect(response.content).toMatch(/^- \[ \] /m);
  expect(response.content).toMatch(/^\s{3,}- /m);
  expect(response.content).toContain("```ts");
  expect(response.content).toContain("$$");
  expect(response.content).toContain("\\begin{aligned}");
  expect(response.content).not.toMatch(
    /!\[|<(?:img|video|audio|iframe|script)\b/i,
  );
  expect(response.reasoning!.length).toBeGreaterThan(100);
  expect(response.tools).toHaveLength(2);
  for (const tool of response.tools!) {
    expect(tool.function!.name).toMatch(/^local_preview_/);
    expect(() => JSON.parse(tool.function!.arguments!)).not.toThrow();
    expect(tool.type).not.toBe("mcp");
    expect(tool.clientId).toBeUndefined();
    expect(tool.isError).toBe(false);
  }
  expect(
    JSON.parse(response.tools![0].content!).structuredContent.length,
  ).toBeGreaterThan(1);
  expect(JSON.parse(response.tools![1].content!).results).toHaveLength(2);
  const originalName = response.tools![0].function!.name;
  response.tools![0].function!.name = "changed";
  response.tools![0].content = "changed";
  const fresh = getLocalPreviewResponse(LOCAL_PREVIEW_COMPONENTS_MODEL);
  expect(fresh.tools![0].function!.name).toBe(originalName);
  expect(() => JSON.parse(fresh.tools![0].content!)).not.toThrow();
  expect(getLocalPreviewResponse("unrecognized-preview-model")).toEqual({
    content: LOCAL_PREVIEW_RESPONSE,
  });
});

test.each([LOCAL_PREVIEW_LONG_MODEL, LOCAL_PREVIEW_COMPONENTS_MODEL])(
  "%s streams cumulative preview phases in about twenty seconds and returns its result",
  async (model) => {
    const expected = getLocalPreviewResponse(model);
    const controller = new AbortController();
    const events: string[] = [];
    const onUpdate = jest.fn<(text: string) => void>(() => events.push("text"));
    const onReasoning = jest.fn<(text: string) => void>(() =>
      events.push("reasoning"),
    );
    const started = Date.now();
    const pending = streamLocalPreviewResponse({
      model,
      signal: controller.signal,
      onUpdate,
      onReasoning,
    });
    await jest.advanceTimersByTimeAsync(699);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onReasoning).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(301);
    if (expected.reasoning) {
      expect(onReasoning).toHaveBeenCalled();
      expect(onReasoning.mock.calls.at(-1)![0].length).toBeLessThan(
        expected.reasoning.length,
      );
      expect(onUpdate).not.toHaveBeenCalled();
    } else {
      expect(onUpdate).toHaveBeenCalled();
      expect(onUpdate.mock.calls.at(-1)![0].length).toBeLessThan(
        expected.content.length,
      );
    }

    await jest.runAllTimersAsync();
    expect(await pending).toEqual(expected);
    expect(Date.now() - started).toBeGreaterThanOrEqual(18500);
    expect(Date.now() - started).toBeLessThanOrEqual(20500);
    expect(onUpdate.mock.calls.at(-1)![0]).toBe(expected.content);
    for (const [calls, final] of [
      [onUpdate.mock.calls, expected.content],
      [onReasoning.mock.calls, expected.reasoning],
    ] as const) {
      if (!final) {
        expect(calls).toHaveLength(0);
        continue;
      }
      for (let index = 0; index < calls.length; index++) {
        expect(final.startsWith(calls[index][0])).toBe(true);
        if (index)
          expect(calls[index][0].length).toBeGreaterThan(
            calls[index - 1][0].length,
          );
      }
      expect(calls.at(-1)![0]).toBe(final);
    }
    if (expected.reasoning)
      expect(events.indexOf("text")).toBeGreaterThan(
        events.lastIndexOf("reasoning"),
      );
    expect(jest.getTimerCount()).toBe(0);
  },
);

test.each([
  ["thinking", 250],
  ["streaming", 780],
] as const)(
  "aborting during %s rejects and stops further updates",
  async (_, elapsed) => {
    const controller = new AbortController();
    const onUpdate = jest.fn<(text: string) => void>();
    const pending = streamLocalPreviewResponse({
      signal: controller.signal,
      onUpdate,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await jest.advanceTimersByTimeAsync(elapsed);
    const updates = onUpdate.mock.calls.length;
    if (elapsed < 700) expect(updates).toBe(0);
    else expect(updates).toBeGreaterThan(0);
    controller.abort();
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
    await jest.runAllTimersAsync();
    expect(onUpdate).toHaveBeenCalledTimes(updates);
  },
);

test("an already aborted simulation never schedules work", async () => {
  const controller = new AbortController();
  controller.abort();
  const onUpdate = jest.fn<(text: string) => void>();
  await expect(
    streamLocalPreviewResponse({ signal: controller.signal, onUpdate }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(onUpdate).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test.each([LOCAL_PREVIEW_LONG_MODEL, LOCAL_PREVIEW_COMPONENTS_MODEL])(
  "aborting %s releases all work and stops both output callbacks",
  async (model) => {
    const controller = new AbortController();
    const onUpdate = jest.fn<(text: string) => void>();
    const onReasoning = jest.fn<(text: string) => void>();
    const pending = streamLocalPreviewResponse({
      model,
      signal: controller.signal,
      onUpdate,
      onReasoning,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(
      onUpdate.mock.calls.length + onReasoning.mock.calls.length,
    ).toBeGreaterThan(0);
    controller.abort();
    await rejected;
    const counts = [onUpdate.mock.calls.length, onReasoning.mock.calls.length];
    expect(jest.getTimerCount()).toBe(0);
    await jest.runAllTimersAsync();
    expect([onUpdate.mock.calls.length, onReasoning.mock.calls.length]).toEqual(
      counts,
    );
  },
);

test.each([
  undefined,
  LOCAL_PREVIEW_LONG_MODEL,
  LOCAL_PREVIEW_COMPONENTS_MODEL,
  LOCAL_PREVIEW_METRICS_MODEL,
  LOCAL_PREVIEW_NO_USAGE_MODEL,
  LOCAL_PREVIEW_COMPRESSION_MODEL,
])(
  "production rejects %s simulation without scheduling work",
  async (model) => {
    jest.replaceProperty(process.env, "NODE_ENV", "production");
    const onUpdate = jest.fn<(text: string) => void>();
    const onReasoning = jest.fn<(text: string) => void>();
    await expect(
      streamLocalPreviewResponse({
        model,
        signal: new AbortController().signal,
        onUpdate,
        onReasoning,
      }),
    ).rejects.toThrow();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onReasoning).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  },
);

test.each([LOCAL_PREVIEW_METRICS_MODEL, LOCAL_PREVIEW_NO_USAGE_MODEL])(
  "%s seeds independently owned completed statistics for send retention",
  (model) => {
    const history = getLocalPreviewHistory(model);
    expect(history.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(history[1].responseMetrics).toEqual({
      usage: { inputTokens: 1000, outputTokens: 84, cachedInputTokens: 994 },
      generationDurationMs: 3000,
    });
    history[1].responseMetrics!.usage.outputTokens = 999;
    expect(
      getLocalPreviewHistory(model)[1].responseMetrics?.usage.outputTokens,
    ).toBe(84);
    expect(getLocalPreviewHistory(LOCAL_PREVIEW_LONG_MODEL)).toEqual([]);
  },
);

test("compression history exceeds its small preview threshold without a giant fixture", () => {
  const history = getLocalPreviewHistory(LOCAL_PREVIEW_COMPRESSION_MODEL);
  expect(history).toHaveLength(8);
  expect(history.map((message) => message.role)).toEqual([
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant",
  ]);
  const length = history.reduce(
    (total, message) => total + (message.content as string).length,
    0,
  );
  expect(length).toBeGreaterThanOrEqual(5000);
  expect(length).toBeLessThanOrEqual(8000);
  expect(contextTokens(history)).toBeGreaterThan(2000);
  expect(
    history.every((message) => message.responseMetrics === undefined),
  ).toBe(true);
});

test.each([
  LOCAL_PREVIEW_METRICS_MODEL,
  LOCAL_PREVIEW_NO_USAGE_MODEL,
  LOCAL_PREVIEW_COMPRESSION_MODEL,
])("%s exposes bounded static content and explicit mock metrics", (model) => {
  const response = getLocalPreviewResponse(model);
  expect(response.content.length).toBeGreaterThan(300);
  expect(response.content.length).toBeLessThan(1000);
  expect(response.responseMetrics?.generationDurationMs).toBe(6000);
  if (model === LOCAL_PREVIEW_NO_USAGE_MODEL)
    expect(response.responseMetrics).toEqual({
      usage: {},
      estimatedOutputTokens: estimateTokenLength(response.content),
      generationDurationMs: 6000,
    });
  else
    expect(response.responseMetrics?.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 300,
      cachedInputTokens: 100,
    });
});

test.each([
  LOCAL_PREVIEW_METRICS_MODEL,
  LOCAL_PREVIEW_NO_USAGE_MODEL,
  LOCAL_PREVIEW_COMPRESSION_MODEL,
])("%s streams changing estimates from observed output time", async (model) => {
  const controller = new AbortController();
  const output: Array<{ text: string; at: number }> = [];
  const progress: Array<ChatGenerationProgress & { at: number }> = [];
  const onUpdate = jest.fn<(text: string) => void>((text) =>
    output.push({ text, at: performance.now() }),
  );
  const onGenerationProgress = jest.fn<(value: ChatGenerationProgress) => void>(
    (value) => progress.push({ ...value, at: performance.now() }),
  );
  const pending = streamLocalPreviewResponse({
    model,
    signal: controller.signal,
    onUpdate,
    onGenerationProgress,
  });
  await jest.advanceTimersByTimeAsync(699);
  expect(onUpdate).not.toHaveBeenCalled();
  expect(onGenerationProgress).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(onUpdate).toHaveBeenCalledTimes(1);
  expect(onGenerationProgress).not.toHaveBeenCalled();
  await jest.runAllTimersAsync();
  const response = await pending;
  const generationDurationMs = output.at(-1)!.at - output[0].at;
  expect(generationDurationMs).toBeGreaterThanOrEqual(5000);
  expect(generationDurationMs).toBeLessThanOrEqual(8000);
  expect(output[0].at).toBe(700);
  expect(response.content).toBe(getLocalPreviewResponse(model).content);
  expect(output.at(-1)!.text).toBe(response.content);
  expect(response.responseMetrics?.generationDurationMs).toBe(
    generationDurationMs,
  );
  expect(progress.at(-1)).toEqual({
    outputTokens: estimateTokenLength(response.content),
    durationMs: generationDurationMs,
    at: output.at(-1)!.at,
  });
  const sizes = new Set<number>();
  const intervals = new Set<number>();
  for (let index = 0; index < output.length; index++) {
    const current = output[index];
    const previous = output[index - 1];
    expect(response.content.startsWith(current.text)).toBe(true);
    sizes.add(current.text.length - (previous?.text.length ?? 0));
    if (previous) intervals.add(current.at - previous.at);
  }
  expect(sizes.size).toBeGreaterThan(2);
  expect(intervals.size).toBeGreaterThan(1);
  const speeds = new Set(
    progress.map((value) =>
      ((value.outputTokens / value.durationMs) * 1000).toFixed(1),
    ),
  );
  expect(speeds.size).toBeGreaterThan(2);
  for (let index = 1; index < progress.length - 1; index++)
    expect(progress[index].at - progress[index - 1].at).toBeGreaterThanOrEqual(
      250,
    );
  if (model === LOCAL_PREVIEW_NO_USAGE_MODEL)
    expect(response.responseMetrics).toEqual({
      usage: {},
      estimatedOutputTokens: estimateTokenLength(response.content),
      generationDurationMs,
    });
  else {
    expect(response.responseMetrics?.usage.outputTokens).toBe(300);
    expect(response.responseMetrics?.estimatedOutputTokens).toBeUndefined();
  }
  expect(jest.getTimerCount()).toBe(0);
});

test.each([
  undefined,
  LOCAL_PREVIEW_LONG_MODEL,
  LOCAL_PREVIEW_COMPONENTS_MODEL,
])(
  "existing %s previews do not emit metric callbacks or metadata",
  async (model) => {
    const onGenerationProgress =
      jest.fn<(value: ChatGenerationProgress) => void>();
    const pending = streamLocalPreviewResponse({
      model,
      signal: new AbortController().signal,
      onUpdate: jest.fn(),
      onReasoning: jest.fn(),
      onGenerationProgress,
    });
    await jest.runAllTimersAsync();
    const response = await pending;
    expect(response).toEqual(getLocalPreviewResponse(model));
    expect(response.responseMetrics).toBeUndefined();
    expect(onGenerationProgress).not.toHaveBeenCalled();
  },
);

test.each([
  LOCAL_PREVIEW_METRICS_MODEL,
  LOCAL_PREVIEW_NO_USAGE_MODEL,
  LOCAL_PREVIEW_COMPRESSION_MODEL,
])("aborting %s stops output and statistics", async (model) => {
  const controller = new AbortController();
  const onUpdate = jest.fn<(value: string) => void>();
  const onGenerationProgress =
    jest.fn<(value: ChatGenerationProgress) => void>();
  const pending = streamLocalPreviewResponse({
    model,
    signal: controller.signal,
    onUpdate,
    onGenerationProgress,
  });
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await jest.advanceTimersByTimeAsync(1200);
  expect(onGenerationProgress).toHaveBeenCalled();
  controller.abort();
  await rejected;
  const updates = onUpdate.mock.calls.length;
  const progress = onGenerationProgress.mock.calls.length;
  await jest.runAllTimersAsync();
  expect(onUpdate).toHaveBeenCalledTimes(updates);
  expect(onGenerationProgress).toHaveBeenCalledTimes(progress);
  expect(jest.getTimerCount()).toBe(0);
});

test("local compression reuses real context preparation and leaves history intact without fetch", async () => {
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const fetchRequest = jest
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("Unexpected network request"));
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchRequest,
  });
  try {
    const history = getLocalPreviewHistory(LOCAL_PREVIEW_COMPRESSION_MODEL).map(
      (message, index) => ({ ...message, id: `preview-history-${index}` }),
    );
    const original = JSON.stringify(history);
    const controller = new AbortController();
    let completed = false;
    const pending = prepareContext({
      prefix: [],
      history,
      input: { role: "user", content: "继续整理下一次观察的路线。" },
      memory: "",
      config: { compressionThreshold: 2000 },
      summarize: () => getLocalPreviewSummary(controller.signal),
    }).then((result) => {
      completed = true;
      return result;
    });
    await jest.advanceTimersByTimeAsync(2499);
    expect(completed).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(completed).toBe(true);
    expect(result.memory).toContain("街角早餐店");
    expect(result.memory.length).toBeLessThan(300);
    expect(result.summarizedIds).toEqual(
      history.slice(0, -2).map((message) => message.id),
    );
    expect(contextTokens(result.messages)).toBeLessThan(2000);
    expect(JSON.stringify(history)).toBe(original);
    expect(fetchRequest).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    if (fetchDescriptor)
      Object.defineProperty(globalThis, "fetch", fetchDescriptor);
    else Reflect.deleteProperty(globalThis, "fetch");
  }
});

test.each([0, 1200])(
  "aborting a local summary at %ims releases its timer",
  async (elapsed) => {
    const controller = new AbortController();
    if (!elapsed) controller.abort();
    const pending = getLocalPreviewSummary(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await jest.advanceTimersByTimeAsync(elapsed);
    controller.abort();
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  },
);

test("production cannot seed preview history or start a local summary", async () => {
  jest.replaceProperty(process.env, "NODE_ENV", "production");
  expect(getLocalPreviewHistory(LOCAL_PREVIEW_METRICS_MODEL)).toEqual([]);
  expect(getLocalPreviewHistory(LOCAL_PREVIEW_COMPRESSION_MODEL)).toEqual([]);
  await expect(
    getLocalPreviewSummary(new AbortController().signal),
  ).rejects.toThrow();
  expect(jest.getTimerCount()).toBe(0);
});
