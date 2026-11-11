import { jest } from "@jest/globals";
import {
  compressionTriggerTokens,
  contextTokens,
  effectiveOutputTokens,
  inputBudget,
  prepareContext,
  validCompressThreshold,
  historyMedia,
} from "../app/utils/context-budget";
import {
  CONTEXT_LIMIT_MESSAGE,
  isContextLimitError,
} from "../app/utils/context-error";
import { getUserFriendlyError } from "../app/utils/error-hints";
import type { ContextEntry } from "../app/utils/context-budget";

const config = {
  sendMemory: true,
  max_tokens: 102400,
  contextBudget: 32768,
  compressMessageLengthThreshold: 500,
  compressionThreshold: 1000,
};
const message = (id: string, text: string): ContextEntry => ({
  id,
  role: "user",
  content: text,
});

test("compression uses one explicit threshold independent of legacy budgets and output limits", () => {
  for (const value of [NaN, undefined, null, 0, -1, Infinity]) {
    expect(validCompressThreshold(value as number)).toBe(272000);
    expect(compressionTriggerTokens(value as number)).toBe(244800);
  }
  expect(effectiveOutputTokens(102400)).toBe(102400);
  expect(effectiveOutputTokens(1024)).toBe(1024);
  expect(inputBudget(config)).toBe(1000);
  expect(inputBudget({ contextBudget: 8192, max_tokens: 52000 })).toBe(272000);
});

test("the compression trigger is 90 percent of the validated full capacity, rounded down", () => {
  expect(compressionTriggerTokens(272000)).toBe(244800);
  expect(compressionTriggerTokens(500)).toBe(450);
  expect(compressionTriggerTokens(1001.9)).toBe(900);
  expect(compressionTriggerTokens(3000000)).toBe(1800000);
});

test("generated proxy images survive compression and replay after the summary boundary", async () => {
  const url = "https://oc.example.com/api/images/abc";
  const old: ContextEntry = {
    id: "old",
    role: "assistant",
    content: `说明${"事实".repeat(2000)}\n![Generated Image](${url})`,
  };
  const result = await prepareContext({
    prefix: [],
    history: [old, message("b", "最近"), message("c", "回答")],
    input: message("new", "继续"),
    memory: "",
    config,
    summarize: async () => "保留事实",
  });
  expect(result.summarizedIds).toContain("old");
  expect(historyMedia(old)?.content).toEqual([
    { type: "image_url", image_url: { url } },
  ]);
  expect(result.messages).toContainEqual(historyMedia(old));
});

test("short conversations do not trigger a paid summary", async () => {
  const summarize = jest.fn<() => Promise<string>>();
  const history = [message("old", "你好")];
  const result = await prepareContext({
    prefix: [],
    history,
    input: message("new", "继续"),
    memory: "",
    config: { ...config, compressionThreshold: 272000 },
    summarize,
  });
  expect(result.messages.map((item) => item.id)).toEqual(["old", "new"]);
  expect(summarize).not.toHaveBeenCalled();
});

test("a completed context at the trigger adds no empty input or extra tokens", async () => {
  const history = [message("old", "x".repeat((450 - 8) * 4))];
  const summarize = jest.fn<() => Promise<string>>();
  const result = await prepareContext({
    prefix: [],
    history,
    memory: "",
    config: { ...config, compressionThreshold: 500 },
    summarize,
  });
  expect(result.messages).toEqual(history);
  expect(contextTokens(result.messages)).toBe(450);
  expect(result.summarizedIds).toEqual([]);
  expect(summarize).not.toHaveBeenCalled();
});

test("a completed context compresses without a new input and keeps its newest exchange and old media", async () => {
  const image = {
    type: "image_url" as const,
    image_url: { url: "https://example.com/history.png" },
  };
  const history: ContextEntry[] = [
    {
      id: "old",
      role: "user",
      content: [{ type: "text", text: "中".repeat(3000) }, image],
    },
    message("latest-user", "Latest question"),
    { ...message("latest-assistant", "Latest answer"), role: "assistant" },
  ];
  const before = JSON.stringify(history);
  const summarize = jest.fn(async (_messages: ContextEntry[]) => "Summary");
  const result = await prepareContext({
    prefix: [],
    history,
    memory: "",
    config,
    summarize,
  });
  const expected: ContextEntry[] = [
    { role: "system", content: "历史对话摘要：\nSummary" },
    { ...history[0], content: [image] },
    ...history.slice(-2),
  ];
  expect(summarize).toHaveBeenCalledWith([
    { role: "user", content: "中".repeat(3000) },
  ]);
  expect(result.summarizedIds).toEqual(["old"]);
  expect(result.memory).toBe("Summary");
  expect(result.messages).toEqual(expected);
  expect(contextTokens(result.messages)).toBe(contextTokens(expected));
  expect(result.messages.at(-2)).toBe(history.at(-2));
  expect(result.messages.at(-1)).toBe(history.at(-1));
  expect(JSON.stringify(history)).toBe(before);
});

test.each([
  [244800, false],
  [244801, true],
])(
  "a 272000 capacity compresses %i tokens only above its 90 percent trigger",
  async (totalTokens, shouldSummarize) => {
    const history = [message("old", "Fact")];
    const input = message("new", totalTokens === 244800 ? "" : "Next");
    const prefix = [message("preset", "x".repeat((244800 - 25) * 4))];
    expect(contextTokens([...prefix, ...history, input])).toBe(totalTokens);
    const summarize = jest.fn(async () => "Summary");
    const result = await prepareContext({
      prefix,
      history,
      input,
      memory: "",
      config: { ...config, compressionThreshold: 272000 },
      summarize,
    });
    expect(summarize).toHaveBeenCalledTimes(shouldSummarize ? 1 : 0);
    expect(result.summarizedIds).toEqual(shouldSummarize ? ["old"] : []);
  },
);

test("the current input crosses the 90 percent trigger from 89 percent without changing the full 272000 budget", async () => {
  const history = [
    message("old", "中".repeat(363078)),
    message("b", "最近"),
    message("c", "回复"),
  ];
  expect(contextTokens(history)).toBe(242080);
  const summarize = jest.fn(async () => "历史关键事实");
  const options = {
    prefix: [],
    history,
    memory: "",
    config: {
      ...config,
      compressionThreshold: 272000,
      max_tokens: 52000,
      contextBudget: 32768,
    },
    summarize,
  };
  await prepareContext({ ...options, input: message("new", "继续") });
  expect(summarize).not.toHaveBeenCalled();
  const result = await prepareContext({
    ...options,
    input: message("new", "中".repeat(9000)),
  });
  expect(inputBudget(options.config)).toBe(272000);
  expect(
    contextTokens([...history, message("new", "中".repeat(9000))]),
  ).toBeLessThan(272000);
  expect(summarize).toHaveBeenCalled();
  expect(result.summarizedIds).toEqual(["old"]);
  expect(result.memory).toBe("历史关键事实");
});

test("generated inline images are sent as media without summarizing base64 or changing saved history", async () => {
  const url = `data:image/png;base64,${"A".repeat(1000000)}`;
  const history: ContextEntry[] = Array.from({ length: 3 }, (_, i) => ({
    id: `image-${i}`,
    role: "assistant",
    content: `图片 ${i}\n![Generated Image](${url})`,
  }));
  const original = history.map((item) => item.content);
  const summarize = jest.fn<() => Promise<string>>();
  const result = await prepareContext({
    prefix: [],
    history,
    input: message("new", "二只猫"),
    memory: "",
    config: { ...config, compressionThreshold: 272000 },
    summarize,
  });
  expect(summarize).not.toHaveBeenCalled();
  expect(history.map((item) => item.content)).toEqual(original);
  expect(contextTokens(result.messages)).toBeLessThan(13000);
  expect(result.messages[0].content).toEqual([
    { type: "text", text: "图片 0\n" },
    { type: "image_url", image_url: { url } },
  ]);
});

test("inline image conversion preserves mixed content order and existing attachments", async () => {
  const existing = {
    type: "image_url" as const,
    image_url: { url: "https://example.com/image.png" },
  };
  const result = await prepareContext({
    prefix: [],
    history: [
      {
        role: "assistant",
        content: [
          existing,
          {
            type: "text",
            text: "前![Generated Image](data:image/png;base64,AAAA)中![Generated Image](data:image/png;base64,BBBB)后",
          },
        ],
      },
    ],
    input: message("new", "继续"),
    memory: "",
    config: { ...config, compressionThreshold: 272000 },
    summarize: async () => {
      throw new Error("不应摘要图片");
    },
  });
  expect(result.messages[0].content).toEqual([
    existing,
    { type: "text", text: "前" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    { type: "text", text: "中" },
    { type: "image_url", image_url: { url: "data:image/png;base64,BBBB" } },
    { type: "text", text: "后" },
  ]);
});

test("awaits summary, keeps newest exchange and source history intact", async () => {
  const history = [
    message("a", "内容".repeat(900)),
    message("b", "最近问题"),
    message("c", "最近回答"),
  ];
  const original = JSON.stringify(history);
  let finish: (text: string) => void = () => {};
  const summarize = jest.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const task = prepareContext({
    prefix: [message("preset", "预设")],
    history,
    input: message("new", "继续"),
    memory: "",
    config,
    summarize,
  });
  expect(summarize).toHaveBeenCalledTimes(1);
  finish("已压缩的关键事实");
  const result = await task;
  expect(result.summarizedIds).toEqual(["a"]);
  expect(result.messages.map((item) => item.id)).toEqual([
    "preset",
    undefined,
    "b",
    "c",
    "new",
  ]);
  expect(result.memory).toBe("已压缩的关键事实");
  expect(JSON.stringify(history)).toBe(original);
});

test("splits an oversized single message into bounded sequential summary calls", async () => {
  const summarize = jest.fn(async () => "摘要");
  const result = await prepareContext({
    prefix: [],
    history: [message("a", "中".repeat(100000))],
    input: message("new", "继续"),
    memory: "此前摘要",
    config,
    summarize,
  });
  expect(summarize.mock.calls.length).toBeGreaterThan(1);
  expect(result.summarizedIds).toEqual(["a"]);
  expect(contextTokens(result.messages)).toBeLessThan(inputBudget(config));
});

test("summary failure and oversized summary never mutate history", async () => {
  const history = [message("a", "中".repeat(3000))];
  const original = JSON.stringify(history);
  await expect(
    prepareContext({
      prefix: [],
      history,
      input: message("new", "继续"),
      memory: "",
      config,
      summarize: async () => {
        throw new Error("摘要网络失败");
      },
    }),
  ).rejects.toThrow("摘要网络失败");
  await expect(
    prepareContext({
      prefix: [],
      history,
      input: message("new", "继续"),
      memory: "",
      config,
      summarize: async () => "中".repeat(4000),
    }),
  ).rejects.toThrow("有效结果");
  expect(JSON.stringify(history)).toBe(original);
});

test("compression capacity is not a hard limit that blocks a single current input", async () => {
  const summarize = jest.fn<() => Promise<string>>();
  const result = await prepareContext({
    prefix: [message("preset", "中".repeat(6000))],
    history: [],
    input: message("new", "中".repeat(6000)),
    memory: "",
    config: { ...config, contextBudget: 8192 },
    summarize,
  });
  expect(result.messages).toHaveLength(2);
  expect(summarize).not.toHaveBeenCalled();
});

test("media remains byte-identical even beyond the compression threshold", async () => {
  const image: ContextEntry = {
    id: "image",
    role: "user",
    content: [
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
    ],
  };
  const summarize = jest.fn<() => Promise<string>>();
  const result = await prepareContext({
    prefix: [],
    history: [image],
    input: message("new", "继续"),
    memory: "",
    config,
    summarize,
  });
  expect(result.messages[0]).toBe(image);
  expect(summarize).not.toHaveBeenCalled();
  const large = await prepareContext({
    prefix: [],
    history: Array(8).fill(image),
    input: message("new", "继续"),
    memory: "",
    config,
    summarize,
  });
  expect(large.messages).toHaveLength(9);
  expect(summarize).not.toHaveBeenCalled();
});

test("retained media does not repeatedly summarize a few recent captions", async () => {
  const summarize = jest.fn(async () => "不应反复摘要");
  const result = await prepareContext({
    prefix: [],
    history: [
      {
        id: "image",
        role: "assistant",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAAA" },
          },
        ],
      },
      message("b", "最近"),
      message("c", "回复"),
      message("d", "继续"),
      message("e", "好"),
    ],
    input: message("new", "再继续"),
    memory: "已有摘要",
    config,
    summarize,
  });
  expect(summarize).not.toHaveBeenCalled();
  expect(result.memory).toBe("已有摘要");
  expect(result.messages).toHaveLength(7);
});

test("obsolete memory switches do not disable automatic compression", async () => {
  const summarize = jest.fn(async () => "历史摘要");
  const result = await prepareContext({
    prefix: [],
    history: [message("a", "中".repeat(40000))],
    input: message("new", "继续"),
    memory: "",
    config: { ...config, sendMemory: false },
    summarize,
  });
  expect(summarize).toHaveBeenCalled();
  expect(result.memory).toBe("历史摘要");
});

test("mixed history is summarized without losing media after the summarized index advances", async () => {
  const image = {
    type: "image_url" as const,
    image_url: { url: "data:image/png;base64,AAAA" },
  };
  const old: ContextEntry = {
    id: "old",
    role: "assistant",
    content: [{ type: "text", text: "事实".repeat(2000) }, image],
  };
  const result = await prepareContext({
    prefix: [],
    history: [old, message("b", "最近"), message("c", "回复")],
    input: message("new", "继续"),
    memory: "",
    config,
    summarize: async () => "保留事实",
  });
  expect(result.summarizedIds).toEqual(["old"]);
  expect(result.messages).toContainEqual({ ...old, content: [image] });
  expect(historyMedia(old)).toEqual({ ...old, content: [image] });
  expect(old.content as unknown[]).toHaveLength(2);
});

test("recognized context errors take priority over generic HTTP 502 hints", () => {
  const error = {
    status: 502,
    message: "Your input exceeds the context window of this model.",
  };
  expect(isContextLimitError(error.message)).toBe(true);
  expect(isContextLimitError("Gateway failure")).toBe(false);
  expect(getUserFriendlyError(error)).toBe(CONTEXT_LIMIT_MESSAGE);
});

test("oversized imported memory is chunked instead of prepended whole to every summary request", async () => {
  const summarize = jest.fn(async (_messages: unknown[]) => "简短摘要");
  const result = await prepareContext({
    prefix: [],
    history: [],
    input: message("new", "继续"),
    memory: "旧摘要".repeat(15000),
    config,
    summarize,
  });
  expect(summarize.mock.calls.length).toBeGreaterThan(1);
  expect(result.memory).toBe("简短摘要");
  expect(result.summarizedIds).toEqual([]);
  for (const [messages] of summarize.mock.calls) {
    expect(contextTokens(messages as ContextEntry[])).toBeLessThanOrEqual(
      26064,
    );
  }
});

test("rejects excessive summary batches before any paid call", async () => {
  const summarize = jest.fn<() => Promise<string>>();
  await expect(
    prepareContext({
      prefix: [],
      history: [message("a", "中".repeat(5000000))],
      input: message("new", "继续"),
      memory: "",
      config,
      summarize,
    }),
  ).rejects.toThrow("过多摘要请求");
  expect(summarize).not.toHaveBeenCalled();
});
