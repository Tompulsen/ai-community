/** @jest-environment node */

import { jest } from "@jest/globals";
import type { ChatGenerationProgress } from "../app/client/api";

type SourceOptions = {
  fetch: typeof fetch;
  signal: AbortSignal;
  onopen: (response: Response) => Promise<void>;
  onmessage: (message: { data: string }) => void;
  onclose: () => void;
  onerror: (error: Error) => unknown;
  openWhenHidden: boolean;
};

const fetchEventSource =
  jest.fn<(url: string, options: SourceOptions) => Promise<void>>();
const tauriFetch = jest.fn<typeof fetch>();

jest.unstable_mockModule("@fortaine/fetch-event-source", () => ({
  EventStreamContentType: "text/event-stream",
  fetchEventSource,
}));
jest.unstable_mockModule("@/app/constant", () => ({
  CACHE_URL_PREFIX: "/api/cache/",
  UPLOAD_URL: "/api/cache/upload",
  REQUEST_TIMEOUT_MS: 120000,
}));
jest.unstable_mockModule("@/app/utils/image-cache", () => ({
  getCachedImage: jest.fn(),
  setCachedImage: jest.fn(),
}));
jest.unstable_mockModule("@/app/client/api", () => ({}));
jest.unstable_mockModule("@/app/utils/format", () => ({
  prettyObject: (value: unknown) => JSON.stringify(value),
}));
jest.unstable_mockModule("@/app/utils/error-hints", () => ({
  getUserFriendlyError: (error: Error) => error.message,
}));
jest.unstable_mockModule("@/app/utils/stream", () => ({
  fetch: tauriFetch,
}));

const { stream, streamWithThink, preProcessImageContentBase } = await import(
  "../app/utils/chat"
);
const { chatInFormat } = await import("../app/client/native-chat");

class VisibilityDocument extends EventTarget {
  visibilityState: "visible" | "hidden" = "visible";
  listeners = new Set<EventListenerOrEventListenerObject>();

  get hidden() {
    return this.visibilityState === "hidden";
  }

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (type === "visibilitychange" && callback) this.listeners.add(callback);
    super.addEventListener(type, callback, options);
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (type === "visibilitychange" && callback)
      this.listeners.delete(callback);
    super.removeEventListener(type, callback, options);
  }

  setHidden(hidden: boolean) {
    this.visibilityState = hidden ? "hidden" : "visible";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

const originalGlobals = new Map(
  ["document", "window", "requestAnimationFrame", "cancelAnimationFrame"].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)],
  ),
);
let visibleDocument: VisibilityDocument;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let transport: { options: SourceOptions; reject: (error: Error) => void };
let controllers: AbortController[];

function runFrames(count = 1) {
  for (let index = 0; index < count; index++) {
    if (visibleDocument.hidden || frames.size === 0) return;
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(performance.now());
  }
}

async function start(mode: "text" | "think", account = false, open = true) {
  const controller = new AbortController();
  controllers.push(controller);
  const onUpdate = jest.fn<(text: string, delta: string) => void>();
  const onReasoningUpdate = jest.fn<(text: string, delta: string) => void>();
  const onFinish = jest.fn<(text: string, response: Response) => void>();
  const onError = jest.fn<(error: Error) => void>();
  const onGenerationTiming = jest.fn<(durationMs: number) => void>();
  const onGenerationProgress =
    jest.fn<(progress: ChatGenerationProgress) => void>();
  const headers = account ? { "X-New-Api-User": "17" } : {};
  const parseText = (text: string) => text;
  const parseThink = (text: string) =>
    JSON.parse(text) as { isThinking: boolean; content: string };
  const tools: unknown[] = [];
  const args = [
    "/api/chat",
    { messages: [], stream: true },
    headers,
    tools,
    {},
    controller,
  ] as const;
  const options = {
    onUpdate,
    onReasoningUpdate,
    onFinish,
    onError,
    onGenerationTiming,
    onGenerationProgress,
  };
  if (mode === "text") {
    stream(...args, parseText, () => {}, options);
  } else {
    streamWithThink(...args, parseThink, () => {}, options);
  }
  const source = transport.options;
  if (open) {
    await source.onopen(
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  }
  return {
    source,
    controller,
    onUpdate,
    onReasoningUpdate,
    onFinish,
    onError,
    onGenerationTiming,
    onGenerationProgress,
    emit(content: string, isThinking = false) {
      source.onmessage({
        data:
          mode === "text" ? content : JSON.stringify({ content, isThinking }),
      });
    },
    done() {
      source.onmessage({ data: "[DONE]" });
    },
  };
}

test("native terminal chunk flushes final content exactly once", async () => {
  const chat = await start("think");
  chat.source.onmessage({
    data: JSON.stringify({
      content: "Final native text",
      isThinking: false,
      done: true,
    }),
  });
  chat.source.onclose();
  expect(chat.onFinish).toHaveBeenCalledTimes(1);
  expect(chat.onFinish.mock.calls[0][0]).toBe("Final native text");
});

test("cancelling native chat before material processing finishes settles the message", async () => {
  const onFinish = jest.fn();
  const onError = jest.fn();
  await chatInFormat(
    "responses",
    {
      messages: [{ role: "user", content: "Hello" }],
      config: { model: "test", stream: true },
      onController: (controller) => controller.abort(),
      onFinish,
      onError,
    },
    { model: "test", stream: true },
    (endpoint) => `/api/v1/${endpoint}`,
    {},
  );
  expect(onFinish).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
  expect(fetchEventSource).not.toHaveBeenCalled();
});

test("native upstream error aborts without a successful finish", async () => {
  const chat = await start("think");
  chat.source.onmessage({
    data: JSON.stringify({
      content: "",
      isThinking: false,
      error: "Unsupported file",
    }),
  });
  chat.source.onclose();
  expect(chat.onError).toHaveBeenCalledTimes(1);
  expect(chat.onError.mock.calls[0][0].message).toBe("Unsupported file");
  expect(chat.controller.signal.aborted).toBe(true);
  expect(chat.onFinish).not.toHaveBeenCalled();
});

test.each([429, 500])(
  "strict HTTP %s failures never enter successful chat history",
  async (status) => {
    const controller = new AbortController();
    controllers.push(controller);
    const onFinish = jest.fn();
    const onError = jest.fn();
    streamWithThink(
      "/api/v1/chat/completions",
      {},
      {},
      [],
      {},
      controller,
      () => ({ content: "", isThinking: false }),
      () => {},
      { onFinish, onError, strictApiErrors: true, disableRetry: true },
    );
    const source = transport.options;
    await source.onopen(
      Response.json({ error: { message: "quota exhausted" } }, { status }),
    );
    source.onclose();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onFinish).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(true);
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(visibleDocument.listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  },
);

async function startToolFlow(
  mode: "text" | "think",
  name = "lookup",
  argumentsText = "{}",
) {
  const controller = new AbortController();
  controllers.push(controller);
  const executeTool = jest.fn<(args: unknown) => unknown>().mockReturnValue({
    status: 200,
    data: "Tool result",
  });
  const processToolMessage =
    jest.fn<(payload: unknown, call: unknown, results: any[]) => unknown>();
  const onUpdate = jest.fn<(text: string, delta: string) => void>();
  const onFinish = jest.fn<(text: string) => void>();
  const onError = jest.fn<(error: Error) => unknown>();
  const onBeforeTool = jest.fn<(tool: unknown) => unknown>();
  const onAfterTool = jest.fn<(tool: any) => unknown>();
  const onGenerationTiming = jest.fn<(durationMs: number) => void>();
  const onGenerationProgress =
    jest.fn<(progress: ChatGenerationProgress) => void>();
  const options = {
    onUpdate,
    onFinish,
    onError,
    onBeforeTool,
    onAfterTool,
    onGenerationTiming,
    onGenerationProgress,
  };
  const tools: unknown[] = [];
  const args = [
    "/api/chat",
    { messages: [] },
    { "X-New-Api-User": "17" },
    tools,
    { lookup: executeTool },
    controller,
  ] as const;
  function parseText(text: string, tools: any[]) {
    if (text === "TOOL") {
      tools.push({
        id: "lookup-call",
        function: { name, arguments: argumentsText },
      });
      return;
    }
    return text;
  }
  if (mode === "text") {
    stream(...args, parseText, processToolMessage, options);
  } else {
    streamWithThink(
      ...args,
      (text, tools) => ({
        isThinking: false,
        content: parseText(text, tools),
      }),
      processToolMessage,
      options,
    );
  }
  const source = transport.options;
  await source.onopen(
    new Response(null, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
  );
  return {
    ...options,
    source,
    controller,
    executeTool,
    processToolMessage,
    invokeTool() {
      source.onmessage({ data: "TOOL" });
      source.onmessage({ data: "[DONE]" });
    },
  };
}

function expectConsistentUpdates(
  updates: ReturnType<typeof jest.fn<(text: string, delta: string) => void>>,
) {
  let accumulated = "";
  for (const [text, delta] of updates.mock.calls) {
    accumulated += delta;
    expect(text).toBe(accumulated);
  }
  return accumulated;
}

beforeEach(() => {
  jest.useFakeTimers();
  visibleDocument = new VisibilityDocument();
  frames = new Map();
  nextFrame = 0;
  controllers = [];
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: visibleDocument },
    window: { configurable: true, value: new EventTarget() },
    requestAnimationFrame: {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      },
    },
    cancelAnimationFrame: {
      configurable: true,
      value: (id: number) => frames.delete(id),
    },
  });
  fetchEventSource.mockReset().mockImplementation(
    (_url, options) =>
      new Promise<void>((_resolve, reject) => {
        transport = { options, reject };
      }),
  );
  tauriFetch
    .mockReset()
    .mockRejectedValue(new Error("Unexpected real request"));
  jest.spyOn(console, "debug").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  for (const controller of controllers) controller.abort();
  frames.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe("raw streaming generation timing", () => {
  test("excludes the initial wait, empty usage chunks and the delayed finish flush", async () => {
    const flow = await start("think");
    flow.source.onmessage({
      data: JSON.stringify({
        content: "",
        isThinking: false,
        role: "assistant",
      }),
    });
    jest.advanceTimersByTime(25000);
    flow.emit("First buffered paragraph. ".repeat(10));
    jest.advanceTimersByTime(350);
    flow.emit("Last output.");
    expect(flow.onUpdate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(6000);
    flow.source.onmessage({
      data: JSON.stringify({ isThinking: false, usage: { output_tokens: 64 } }),
    });
    const lastProgress = flow.onGenerationProgress.mock.calls.at(-1)?.[0];
    jest.advanceTimersByTime(4000);
    flow.done();
    flow.source.onclose();

    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
    expect(lastProgress?.durationMs).toBe(350);
    expect(flow.onGenerationProgress.mock.calls.at(-1)?.[0]).toBe(lastProgress);
    expect(flow.onGenerationTiming).toHaveBeenCalledTimes(1);
    expect(flow.onGenerationTiming).toHaveBeenCalledWith(350);
    expect(flow.onGenerationTiming.mock.invocationCallOrder[0]).toBeLessThan(
      flow.onFinish.mock.invocationCallOrder[0],
    );
    expect(flow.onFinish).toHaveBeenCalledTimes(1);
    expect(flow.onFinish.mock.calls[0][0]).toBe(
      "First buffered paragraph. ".repeat(10) + "Last output.",
    );
  });

  test.each(["native", "thinking"] as const)(
    "starts with the first %s reasoning delta",
    async (kind) => {
      const flow = await start("think");
      jest.advanceTimersByTime(12000);
      if (kind === "native") {
        flow.source.onmessage({
          data: JSON.stringify({
            content: "",
            reasoning: "Check the question.",
            isThinking: false,
          }),
        });
      } else {
        flow.emit("Check the question.", true);
      }
      jest.advanceTimersByTime(240);
      flow.emit("Final answer.");
      jest.advanceTimersByTime(5000);
      flow.done();

      expect(flow.onGenerationTiming).toHaveBeenCalledWith(240);
      expect(flow.onReasoningUpdate.mock.calls.at(-1)?.[0]).toBe(
        "Check the question.",
      );
      expect(flow.onFinish.mock.calls[0][0]).toBe("Final answer.");
    },
  );

  test.each([1, 2])(
    "does not fabricate timing from %i output packets at a single timestamp",
    async (packetCount) => {
      const flow = await start("think");
      for (let index = 0; index < packetCount; index++) {
        flow.emit("Output.");
      }
      jest.advanceTimersByTime(5000);
      flow.done();

      expect(flow.onGenerationTiming).not.toHaveBeenCalled();
      expect(flow.onGenerationProgress).not.toHaveBeenCalled();
      expect(flow.onFinish).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["abort", "native error", "transport error"] as const)(
    "does not report partially observed generation after %s",
    async (ending) => {
      const flow = await start("think");
      flow.emit("First output.");
      jest.advanceTimersByTime(200);
      flow.emit("Second output.");
      if (ending === "abort") {
        flow.controller.abort();
      } else if (ending === "native error") {
        flow.source.onmessage({
          data: JSON.stringify({
            isThinking: false,
            content: "",
            error: "Upstream failed",
          }),
        });
      } else {
        transport.reject(new Error("Connection failed"));
        await Promise.resolve();
        await Promise.resolve();
      }
      flow.source.onclose();

      expect(flow.onGenerationTiming).not.toHaveBeenCalled();
      if (ending === "abort") {
        expect(flow.onFinish).toHaveBeenCalledTimes(1);
        expect(flow.onFinish.mock.calls[0][1].status).toBe(499);
      } else {
        expect(flow.onError).toHaveBeenCalledTimes(1);
        expect(flow.onFinish).not.toHaveBeenCalled();
      }
    },
  );

  test.each(["text/plain", "application/json"])(
    "does not report timing for the %s response fallback",
    async (contentType) => {
      const flow = await start("think", false, false);
      jest.advanceTimersByTime(1000);
      await flow.source.onopen(
        new Response(
          contentType === "text/plain" ? "Plain answer." : '{"answer":"JSON"}',
          { status: 200, headers: { "content-type": contentType } },
        ),
      );
      flow.source.onclose();

      expect(flow.onGenerationTiming).not.toHaveBeenCalled();
      expect(flow.onGenerationProgress).not.toHaveBeenCalled();
      expect(flow.onFinish).toHaveBeenCalledTimes(1);
    },
  );

  test("adds output intervals across rounds without tool or next-round queue time", async () => {
    const flow = await startToolFlow("think");
    let resolveTool!: (value: { status: number; data: string }) => void;
    flow.executeTool.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTool = resolve;
        }),
    );
    jest.advanceTimersByTime(10000);
    flow.source.onmessage({ data: "Before " });
    jest.advanceTimersByTime(200);
    flow.source.onmessage({ data: "the tool. " });
    expect(flow.onGenerationProgress).toHaveBeenLastCalledWith({
      outputTokens: 5,
      durationMs: 200,
    });
    jest.advanceTimersByTime(1500);
    flow.invokeTool();
    await jest.advanceTimersByTimeAsync(8000);
    expect(flow.executeTool).toHaveBeenCalledTimes(1);
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
    resolveTool({ status: 200, data: "Tool result" });
    await jest.advanceTimersByTimeAsync(60);

    expect(fetchEventSource).toHaveBeenCalledTimes(2);
    const continuation = transport.options;
    await continuation.onopen(
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    jest.advanceTimersByTime(4000);
    continuation.onmessage({ data: "After " });
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(300);
    continuation.onmessage({ data: "the tool." });
    expect(flow.onGenerationProgress).toHaveBeenLastCalledWith({
      outputTokens: 8,
      durationMs: 500,
    });
    jest.advanceTimersByTime(7000);
    continuation.onmessage({ data: "[DONE]" });

    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(2);
    expect(flow.onGenerationTiming).toHaveBeenCalledTimes(1);
    expect(flow.onGenerationTiming).toHaveBeenCalledWith(500);
    expect(flow.onGenerationTiming.mock.invocationCallOrder[0]).toBeLessThan(
      flow.onFinish.mock.invocationCallOrder[0],
    );
    expect(flow.onFinish.mock.calls[0][0]).toBe(
      "Before the tool. After the tool.",
    );
  });

  test.each(["tool-only first", "single first", "single final"] as const)(
    "suppresses timing when the %s round cannot be measured",
    async (kind) => {
      const flow = await startToolFlow("think");
      if (kind !== "tool-only first") {
        flow.source.onmessage({ data: "Before the tool. " });
        if (kind === "single final") {
          jest.advanceTimersByTime(100);
          flow.source.onmessage({ data: "Still before. " });
        }
      }
      flow.invokeTool();
      await jest.advanceTimersByTimeAsync(60);
      const continuation = transport.options;
      await continuation.onopen(
        new Response(null, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
      continuation.onmessage({ data: "After the tool." });
      if (kind !== "single final") {
        jest.advanceTimersByTime(200);
        continuation.onmessage({ data: " Final output." });
      }
      continuation.onmessage({ data: "[DONE]" });

      expect(flow.onGenerationTiming).not.toHaveBeenCalled();
      expect(flow.onGenerationProgress).toHaveBeenCalledTimes(
        kind === "single final" ? 1 : 0,
      );
      expect(flow.onFinish).toHaveBeenCalledTimes(1);
    },
  );

  test("still finishes the response if the timing observer throws", async () => {
    const flow = await start("think");
    const error = new Error("Timing observer failed");
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    flow.onGenerationTiming.mockImplementation(() => {
      throw error;
    });
    flow.emit("First output.");
    jest.advanceTimersByTime(100);
    flow.emit("Second output.");
    flow.done();

    expect(log).toHaveBeenCalledWith(
      "[ChatAPI] generation timing callback failed",
      error,
    );
    expect(flow.onFinish).toHaveBeenCalledTimes(1);
    expect(flow.onError).not.toHaveBeenCalled();
  });
});

describe("live raw streaming generation progress", () => {
  test("publishes changing estimates before any animated content is painted", async () => {
    const flow = await start("think");
    jest.advanceTimersByTime(20000);
    flow.emit("abcd");
    expect(flow.onGenerationProgress).not.toHaveBeenCalled();
    jest.advanceTimersByTime(250);
    flow.emit("efgh");
    expect(flow.onGenerationProgress).toHaveBeenLastCalledWith({
      outputTokens: 2,
      durationMs: 250,
    });
    jest.advanceTimersByTime(500);
    flow.emit("ijkl");
    expect(flow.onGenerationProgress).toHaveBeenLastCalledWith({
      outputTokens: 3,
      durationMs: 750,
    });
    expect(flow.onUpdate).not.toHaveBeenCalled();
    expect(flow.onGenerationTiming).not.toHaveBeenCalled();
    flow.done();
    expect(flow.onGenerationTiming).toHaveBeenCalledWith(750);
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(2);
  });

  test("limits updates to once per 250ms without new timers", async () => {
    const flow = await start("think");
    flow.emit("a");
    const scheduledTimers = jest.getTimerCount();
    jest.advanceTimersByTime(100);
    flow.emit("b");
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(100);
    flow.emit("c");
    jest.advanceTimersByTime(149);
    flow.emit("d");
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    flow.emit("e");
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(2);
    expect(flow.onGenerationProgress).toHaveBeenLastCalledWith({
      outputTokens: 2,
      durationMs: 350,
    });
    expect(jest.getTimerCount()).toBe(scheduledTimers);
    flow.done();
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(2);
  });

  test("flushes the final complete estimate before timing and finish despite throttling", async () => {
    const flow = await start("think");
    flow.emit("abcd");
    jest.advanceTimersByTime(100);
    flow.emit("efgh");
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(50);
    flow.emit("ijkl");
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(9000);
    flow.done();
    flow.source.onclose();
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(2);
    expect(flow.onGenerationProgress).toHaveBeenLastCalledWith({
      outputTokens: 3,
      durationMs: 150,
    });
    expect(flow.onGenerationProgress.mock.invocationCallOrder[1]).toBeLessThan(
      flow.onGenerationTiming.mock.invocationCallOrder[0],
    );
    expect(flow.onGenerationTiming.mock.invocationCallOrder[0]).toBeLessThan(
      flow.onFinish.mock.invocationCallOrder[0],
    );
  });

  test.each(["native", "thinking"] as const)(
    "counts %s reasoning-only output once",
    async (kind) => {
      const flow = await start("think");
      const emit = (text: string) => {
        if (kind === "native") {
          flow.source.onmessage({
            data: JSON.stringify({
              isThinking: false,
              content: "",
              reasoning: text,
            }),
          });
        } else flow.emit(text, true);
      };
      emit("abcd");
      jest.advanceTimersByTime(250);
      emit("efgh");
      expect(flow.onGenerationProgress).toHaveBeenLastCalledWith({
        outputTokens: 2,
        durationMs: 250,
      });
      expect(flow.onReasoningUpdate.mock.calls.at(-1)?.[0]).toBe("abcdefgh");
      flow.done();
      expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
      expect(flow.onFinish.mock.calls[0][0]).toBe("");
    },
  );

  test("combines simultaneous content and reasoning without animation recounting", async () => {
    const flow = await start("think");
    const emit = () =>
      flow.source.onmessage({
        data: JSON.stringify({
          isThinking: false,
          content: "abcd",
          reasoning: "efgh",
        }),
      });
    emit();
    jest.advanceTimersByTime(250);
    emit();
    expect(flow.onGenerationProgress).toHaveBeenLastCalledWith({
      outputTokens: 4,
      durationMs: 250,
    });
    runFrames(20);
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
    flow.done();
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
  });

  test.each(["abort", "native error", "transport error"] as const)(
    "does not publish late updates after %s",
    async (ending) => {
      const flow = await start("think");
      flow.emit("abcd");
      jest.advanceTimersByTime(250);
      flow.emit("efgh");
      expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(100);
      flow.emit("ijkl");
      expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(300);
      if (ending === "abort") flow.controller.abort();
      else if (ending === "native error")
        flow.source.onmessage({
          data: JSON.stringify({
            isThinking: false,
            content: "Must not count an error payload",
            error: "Upstream failed",
          }),
        });
      else {
        transport.reject(new Error("Connection failed"));
        await Promise.resolve();
        await Promise.resolve();
      }
      flow.emit("late output");
      flow.done();
      flow.source.onclose();
      expect(flow.onGenerationProgress).toHaveBeenCalledTimes(1);
      expect(flow.onGenerationTiming).not.toHaveBeenCalled();
    },
  );

  test("continues answering when the progress observer throws", async () => {
    const flow = await start("think");
    const error = new Error("Progress observer failed");
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    flow.onGenerationProgress.mockImplementation(() => {
      throw error;
    });
    flow.emit("abcd");
    jest.advanceTimersByTime(250);
    flow.emit("efgh");
    jest.advanceTimersByTime(100);
    flow.emit("ijkl");
    flow.done();
    expect(log).toHaveBeenCalledWith(
      "[ChatAPI] generation progress callback failed",
      error,
    );
    expect(flow.onGenerationProgress).toHaveBeenCalledTimes(2);
    expect(flow.onFinish).toHaveBeenCalledTimes(1);
    expect(flow.onFinish.mock.calls[0][0]).toBe("abcdefghijkl");
    expect(flow.onGenerationTiming).toHaveBeenCalledWith(350);
    expect(flow.onError).not.toHaveBeenCalled();
  });
});

test("preserves text and every image when preparing multimodal content", async () => {
  const content = [
    { type: "text" as const, text: "Describe these" },
    {
      type: "image_url" as const,
      image_url: { url: "data:image/png;base64,aA==" },
    },
    {
      type: "image_url" as const,
      image_url: { url: "https://fixture.test/image.png" },
    },
  ];
  await expect(
    preProcessImageContentBase(content, async (url) => ({
      type: "image_url",
      image_url: { url },
    })),
  ).resolves.toEqual(content);
});

test("image preprocessing failures reject instead of silently dropping the image", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  await expect(
    preProcessImageContentBase(
      [
        { type: "text", text: "Describe this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aA==" } },
      ],
      async () => {
        throw new Error("fixture decode failed");
      },
    ),
  ).rejects.toThrow("图片读取失败");
});

describe.each(["text", "think"] as const)("%s response streaming", (mode) => {
  test("finishes buffered content exactly once and disposes animation work", async () => {
    const flow = await start(mode);
    const first = "First streamed paragraph. ".repeat(12);
    const last = "Final buffered paragraph.";
    flow.emit(first);
    runFrames();
    flow.emit(last);
    flow.done();

    expect(flow.onFinish).toHaveBeenCalledTimes(1);
    expect(flow.onFinish.mock.calls[0][0]).toBe(first + last);
    expect(
      (first + last).startsWith(expectConsistentUpdates(flow.onUpdate)),
    ).toBe(true);
    expect(frames.size).toBe(0);
    expect(visibleDocument.listeners.size).toBe(0);
    const updates = flow.onUpdate.mock.calls.length;
    runFrames(10);
    flow.source.onclose();
    expect(flow.onUpdate).toHaveBeenCalledTimes(updates);
    expect(flow.onFinish).toHaveBeenCalledTimes(1);
    expect(flow.onError).not.toHaveBeenCalled();
  });

  test("keeps updating beyond 61 seconds while the SSE connection remains open", async () => {
    const flow = await start(mode);
    flow.emit("Before timeout.");
    runFrames(100);
    jest.advanceTimersByTime(61000);
    flow.emit(" After 61 seconds.");
    runFrames(100);

    expect(flow.controller.signal.aborted).toBe(false);
    expect(flow.onUpdate.mock.calls.at(-1)?.[0]).toBe(
      "Before timeout. After 61 seconds.",
    );
    expect(flow.onFinish).not.toHaveBeenCalled();
    expect(flow.onError).not.toHaveBeenCalled();
    flow.done();
    expect(flow.onFinish.mock.calls[0][0]).toBe(
      "Before timeout. After 61 seconds.",
    );
  });

  test("updates every hidden SSE chunk without RAF and resumes without repeated text", async () => {
    const flow = await start(mode);
    const first = "Visible buffered text. ".repeat(10);
    flow.emit(first);
    runFrames();
    visibleDocument.setHidden(true);
    let expected = first;
    for (const chunk of [" Hidden one.", " Hidden two.", " Hidden three."]) {
      expected += chunk;
      flow.emit(chunk);
      expect(flow.onUpdate.mock.calls.at(-1)?.[0]).toBe(expected);
    }
    expect(frames.size).toBe(0);
    visibleDocument.setHidden(false);
    runFrames(100);
    expect(expectConsistentUpdates(flow.onUpdate)).toBe(expected);
    flow.emit(" Visible again.");
    runFrames(100);
    flow.done();

    expect(flow.onFinish.mock.calls[0][0]).toBe(expected + " Visible again.");
    expect(flow.onError).not.toHaveBeenCalled();
  });

  test.each([true, false])(
    "disposes a failed stream and never replays its billed POST (account=%s)",
    async (account) => {
      const flow = await start(mode, account);
      flow.emit("Buffered before the connection fails. ".repeat(10));
      runFrames();
      const failure = new Error("Connection failed");
      expect(() => flow.source.onerror(failure)).toThrow(failure);
      transport.reject(failure);
      await Promise.resolve();
      await Promise.resolve();

      expect(flow.onError).toHaveBeenCalledTimes(1);
      expect(flow.onError.mock.calls[0][0].message).toBe("Connection failed");
      expect(frames.size).toBe(0);
      expect(visibleDocument.listeners.size).toBe(0);
      const updates = flow.onUpdate.mock.calls.length;
      visibleDocument.setHidden(true);
      flow.controller.abort();
      jest.advanceTimersByTime(61000);
      runFrames(100);
      expect(flow.onUpdate).toHaveBeenCalledTimes(updates);
      expect(flow.onFinish).not.toHaveBeenCalled();
      expect(flow.onError).toHaveBeenCalledTimes(1);
      expect(fetchEventSource).toHaveBeenCalledTimes(1);
      expect(tauriFetch).not.toHaveBeenCalled();
    },
  );

  test("flushes an aborted account stream once and removes its RAF and visibility listener", async () => {
    const flow = await start(mode, true);
    const text = "Buffered content when account request aborts. ".repeat(10);
    flow.emit(text);
    runFrames();
    flow.controller.abort();

    expect(flow.onFinish).toHaveBeenCalledTimes(1);
    expect(flow.onFinish.mock.calls[0][0]).toBe(text);
    expect(flow.onFinish.mock.calls[0][1].status).toBe(499);
    expect(frames.size).toBe(0);
    expect(visibleDocument.listeners.size).toBe(0);
    const updates = flow.onUpdate.mock.calls.length;
    visibleDocument.setHidden(true);
    flow.emit("Late content must be ignored.");
    flow.done();
    jest.advanceTimersByTime(61000);
    runFrames(100);
    expect(flow.onUpdate).toHaveBeenCalledTimes(updates);
    expect(flow.onFinish).toHaveBeenCalledTimes(1);
    expect(flow.onError).not.toHaveBeenCalled();
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
  });

  test("reports an empty completed response once and disposes its work", async () => {
    const flow = await start(mode);
    flow.source.onclose();
    flow.done();
    runFrames(10);

    expect(flow.onError).toHaveBeenCalledTimes(1);
    expect(flow.onError.mock.calls[0][0].message).toBe(
      "empty response from server",
    );
    expect(frames.size).toBe(0);
    expect(visibleDocument.listeners.size).toBe(0);
  });

  test("does not report an empty-response error when the user aborts", async () => {
    const flow = await start(mode, true);
    flow.controller.abort();
    flow.source.onclose();
    runFrames(10);

    expect(flow.onError).not.toHaveBeenCalled();
    expect(flow.onFinish).toHaveBeenCalledTimes(1);
    expect(flow.onFinish.mock.calls[0][0]).toBe("");
    expect(frames.size).toBe(0);
    expect(visibleDocument.listeners.size).toBe(0);
  });

  test("terminates a failed non-account handshake without replaying the POST", async () => {
    const flow = await start(mode, false, false);
    const failure = new Error("Handshake unavailable");
    expect(() => flow.source.onerror(failure)).toThrow(failure);
    transport.reject(failure);
    await Promise.resolve();
    await Promise.resolve();

    expect(flow.onError).toHaveBeenCalledTimes(1);
    expect(flow.controller.signal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(120000);

    expect(flow.onFinish).not.toHaveBeenCalled();
    expect(flow.onError).toHaveBeenCalledTimes(1);
    expect(fetchEventSource).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(visibleDocument.listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

test("thinking blocks stay separate from a buffered final answer", async () => {
  const flow = await start("think");
  flow.emit("Consider the question.", true);
  flow.emit("\n\nCheck the details.", true);
  runFrames();
  flow.emit("The answer is ready.");
  flow.done();

  expect(flow.onFinish.mock.calls[0][0]).toBe("The answer is ready.");
  expect(flow.onReasoningUpdate.mock.calls.at(-1)?.[0]).toBe(
    "Consider the question.\n\nCheck the details.",
  );
  expect(flow.onError).not.toHaveBeenCalled();
});

test("split think tags stream into reasoning without leaking markers into the answer", async () => {
  const flow = await start("think");
  for (const content of ["<thi", "nk>Plan", " carefully.</th", "ink>Answer"]) {
    flow.emit(content);
    runFrames();
  }
  flow.done();
  expect(flow.onReasoningUpdate.mock.calls.at(-1)?.[0]).toBe("Plan carefully.");
  expect(flow.onFinish.mock.calls[0][0]).toBe("Answer");
});

test("reasoning-only replies finish without an empty-response error", async () => {
  const flow = await start("think");
  flow.emit("Visible reasoning", true);
  flow.done();
  expect(flow.onReasoningUpdate.mock.calls.at(-1)?.[0]).toBe(
    "Visible reasoning",
  );
  expect(flow.onFinish.mock.calls[0][0]).toBe("");
  expect(flow.onError).not.toHaveBeenCalled();
});

test("aborting a tagged reasoning stream retains its final partial chunk", async () => {
  const flow = await start("think");
  flow.emit("<think>Still checking</thi");
  flow.controller.abort();
  expect(flow.onReasoningUpdate.mock.calls.at(-1)?.[0]).toBe(
    "Still checking</thi",
  );
  expect(flow.onFinish.mock.calls[0][1].status).toBe(499);
  expect(flow.onError).not.toHaveBeenCalled();
});

test("aborting before the connection opens clears its timeout and animation lifecycle", async () => {
  const flow = await start("text", true, false);
  flow.controller.abort();
  expect(jest.getTimerCount()).toBe(0);
  expect(frames.size).toBe(0);
  expect(visibleDocument.listeners.size).toBe(0);
  jest.advanceTimersByTime(120000);

  expect(flow.onFinish).toHaveBeenCalledTimes(1);
  expect(flow.onError).not.toHaveBeenCalled();
  expect(fetchEventSource).toHaveBeenCalledTimes(1);
});

test.each(["text", "think"] as const)(
  "%s tool continuation ignores late close/error events from its completed first round",
  async (mode) => {
    const controller = new AbortController();
    controllers.push(controller);
    const onUpdate = jest.fn<(text: string, delta: string) => void>();
    const onFinish = jest.fn<(text: string) => void>();
    const onError = jest.fn<(error: Error) => void>();
    const executeTool = jest
      .fn<() => Promise<{ status: number; data: string }>>()
      .mockResolvedValue({ status: 200, data: "Tool result" });
    const processToolMessage = jest.fn();
    const tools: unknown[] = [];
    const args = [
      "/api/chat",
      { messages: [] },
      { "X-New-Api-User": "17" },
      tools,
      { lookup: executeTool },
      controller,
    ] as const;
    function parseText(text: string, runTools: any[]) {
      if (text === "TOOL") {
        runTools.push({
          id: "lookup-call",
          function: { name: "lookup", arguments: "{}" },
        });
        return;
      }
      return text;
    }
    const options = { onUpdate, onFinish, onError };
    if (mode === "text") {
      stream(...args, parseText, processToolMessage, options);
    } else {
      streamWithThink(
        ...args,
        (text, runTools) => ({
          isThinking: false,
          content: parseText(text, runTools),
        }),
        processToolMessage,
        options,
      );
    }
    const first = transport.options;
    const rejectFirst = transport.reject;
    await first.onopen(
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    first.onmessage({ data: "Before tool. " });
    first.onmessage({ data: "TOOL" });
    first.onmessage({ data: "[DONE]" });
    await jest.advanceTimersByTimeAsync(60);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(processToolMessage).toHaveBeenCalledTimes(1);
    expect(fetchEventSource).toHaveBeenCalledTimes(2);
    expect(onFinish).not.toHaveBeenCalled();
    const second = transport.options;
    const secondTimers = jest.getTimerCount();
    expect(secondTimers).toBeGreaterThan(0);
    first.onclose();
    expect(onFinish).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(secondTimers);
    const lateError = new Error("Completed round connection closed");
    expect(() => first.onerror(lateError)).toThrow(lateError);
    rejectFirst(lateError);
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(secondTimers);
    await second.onopen(
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    second.onmessage({ data: "After tool." });
    runFrames(100);
    second.onmessage({ data: "[DONE]" });

    expect(onUpdate.mock.calls.at(-1)?.[0]).toBe("Before tool. After tool.");
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0][0]).toBe("Before tool. After tool.");
    expect(onError).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(visibleDocument.listeners.size).toBe(0);
  },
);

describe.each(["text", "think"] as const)("%s tool failures", (mode) => {
  test.each(["unknown tool", "invalid JSON", "synchronous throw"] as const)(
    "continues with an error result after %s",
    async (failure) => {
      const flow = await startToolFlow(
        mode,
        failure === "unknown tool" ? "missing" : "lookup",
        failure === "invalid JSON" ? "{" : "{}",
      );
      if (failure === "synchronous throw") {
        flow.executeTool.mockImplementationOnce(() => {
          throw new Error("Tool threw synchronously");
        });
      }
      expect(() => flow.invokeTool()).not.toThrow();
      await jest.advanceTimersByTimeAsync(60);

      expect(flow.onAfterTool).toHaveBeenCalledTimes(1);
      expect(flow.onAfterTool.mock.calls[0][0]).toMatchObject({
        isError: true,
        errorMsg: expect.any(String),
      });
      expect(flow.processToolMessage).toHaveBeenCalledTimes(1);
      expect(flow.processToolMessage.mock.calls[0][2]).toEqual([
        expect.objectContaining({
          role: "tool",
          content: flow.onAfterTool.mock.calls[0][0].errorMsg,
          tool_call_id: "lookup-call",
        }),
      ]);
      expect(flow.executeTool).toHaveBeenCalledTimes(
        failure === "synchronous throw" ? 1 : 0,
      );
      expect(fetchEventSource).toHaveBeenCalledTimes(2);
      const continuation = transport.options;
      await continuation.onopen(
        new Response(null, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
      continuation.onmessage({ data: "Recovered final answer." });
      continuation.onmessage({ data: "[DONE]" });

      expect(flow.onFinish).toHaveBeenCalledTimes(1);
      expect(flow.onFinish.mock.calls[0][0]).toBe("Recovered final answer.");
      expect(flow.onError).not.toHaveBeenCalled();
      expect(frames.size).toBe(0);
      expect(visibleDocument.listeners.size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  test.each([
    "before tool",
    "after tool",
    "process tool",
    "async process tool",
  ] as const)(
    "terminates and cleans up after a failing %s callback",
    async (phase) => {
      const flow = await startToolFlow(mode);
      const failure = new Error(`${phase} failed`);
      const throwFailure = () => {
        throw failure;
      };
      if (phase === "before tool") {
        flow.onBeforeTool.mockImplementation(throwFailure);
      } else if (phase === "after tool") {
        flow.onAfterTool.mockImplementation(throwFailure);
      } else if (phase === "async process tool") {
        flow.processToolMessage.mockImplementation(async () => {
          throw failure;
        });
      } else {
        flow.processToolMessage.mockImplementation(throwFailure);
      }
      flow.source.onmessage({ data: "Buffered before the tool." });
      flow.invokeTool();
      await jest.advanceTimersByTimeAsync(60);

      expect(flow.onError).toHaveBeenCalledTimes(1);
      expect(flow.onError.mock.calls[0][0].message).toBe(failure.message);
      expect(flow.onUpdate.mock.calls.at(-1)?.[0]).toBe(
        "Buffered before the tool.",
      );
      expect(flow.onFinish).not.toHaveBeenCalled();
      expect(fetchEventSource).toHaveBeenCalledTimes(1);
      expect(frames.size).toBe(0);
      expect(visibleDocument.listeners.size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
      flow.source.onclose();
      flow.controller.abort();
      expect(flow.onError).toHaveBeenCalledTimes(1);
      expect(flow.onFinish).not.toHaveBeenCalled();
    },
  );

  test.each(["throw", "reject"] as const)(
    "consumes an error callback that may %s after cleanup",
    async (behavior) => {
      const flow = await startToolFlow(mode);
      const failure = new Error("After tool callback failed");
      const notificationFailure = new Error("Error callback failed");
      const log = jest.spyOn(console, "error").mockImplementation(() => {});
      flow.onAfterTool.mockImplementation(() => {
        throw failure;
      });
      flow.onError.mockImplementation(() => {
        if (behavior === "reject") return Promise.reject(notificationFailure);
        throw notificationFailure;
      });
      flow.invokeTool();
      await jest.advanceTimersByTimeAsync(60);

      expect(flow.onError).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        "[ChatAPI] error callback failed",
        notificationFailure,
      );
      expect(flow.onFinish).not.toHaveBeenCalled();
      expect(fetchEventSource).toHaveBeenCalledTimes(1);
      expect(frames.size).toBe(0);
      expect(visibleDocument.listeners.size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    },
  );
});
