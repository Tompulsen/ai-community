import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import type { ChatSession } from "../app/store/chat";
import type { ModelConfig } from "../app/store/config";
import { useComposerFocus } from "../app/utils/use-composer-focus";
import { estimateChatContextUsage } from "../app/utils/chat-context-usage";

const models: unknown[] = [];
const formatTemplate = jest.fn((text: string, config: ModelConfig) =>
  (config.template ?? "{{input}}").replaceAll("{{input}}", text),
);
jest.unstable_mockModule("@/app/store/chat", () => ({
  fillTemplateWith: formatTemplate,
}));
jest.unstable_mockModule("@/app/store/config", () => ({
  useAppConfig: (select: (state: { models: unknown[] }) => unknown) =>
    select({ models }),
}));
const { ContextUsage } = await import("../app/components/context-usage");
const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

function session(): ChatSession {
  return {
    id: "context-session",
    topic: "Context usage fixture",
    stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
    lastUpdate: 0,
    messages: [
      {
        id: "prior-question",
        role: "user",
        content: "Original question",
        date: "",
      },
      {
        id: "prior-answer",
        role: "assistant",
        content: "Original answer",
        date: "",
      },
    ],
    memoryPrompt: "",
    lastSummarizeIndex: 0,
    mask: {
      id: "context-mask",
      createdAt: 0,
      avatar: "",
      name: "Context usage fixture",
      lang: "cn",
      builtin: false,
      context: [],
      modelConfig: {
        model: "custom-context-model",
        template: "{{input}}",
        enableInjectSystemPrompts: false,
        compressionThreshold: 500,
        contextBudget: 32768,
        max_tokens: 128000,
      } as ModelConfig,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
  jest.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 20,
    y: 400,
    left: 20,
    top: 400,
    right: 260,
    bottom: 444,
    width: 240,
    height: 44,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  if (mediaDescriptor)
    Object.defineProperty(window, "matchMedia", mediaDescriptor);
  else Reflect.deleteProperty(window, "matchMedia");
});

function trigger(
  metric: "上下文占用" | "输出速度" | "缓存命中" = "上下文占用",
) {
  return screen.getByRole("button", { name: new RegExp(`^${metric}：`) });
}

function open(metric: Parameters<typeof trigger>[0] = "上下文占用") {
  fireEvent.click(trigger(metric));
  return screen.getByRole("dialog", { name: "对话状态详情" });
}

function ComposerHarness() {
  const input = React.useRef<HTMLTextAreaElement>(null);
  const file = React.useRef<HTMLInputElement>(null);
  const focus = useComposerFocus(input, file, false);
  return (
    <div
      ref={focus.ref}
      onClick={focus.onClick}
      onPointerDownCapture={focus.onPointerDownCapture}
      onMouseDownCapture={focus.onMouseDownCapture}
      onFocusCapture={focus.onFocusCapture}
      onKeyDownCapture={focus.onKeyDownCapture}
    >
      <textarea ref={input} aria-label="Draft" defaultValue="Keep my draft" />
      <input ref={file} type="file" hidden />
      <ContextUsage session={session()} />
    </div>
  );
}

test("shows three icon metrics without token estimates or hover-only details", () => {
  render(<ContextUsage session={session()} />);
  const bar = screen.getByRole("group", { name: "对话状态" });
  expect(within(bar).getAllByRole("button")).toHaveLength(3);
  expect(bar).not.toHaveTextContent("Token");
  expect(bar).not.toHaveTextContent("估算");
  expect(bar).not.toHaveTextContent("上下文");
  expect(trigger("输出速度")).toHaveTextContent("\u2014 tok/s");
  expect(trigger("缓存命中")).toHaveTextContent("\u2014");
  fireEvent.mouseEnter(trigger());
  document.dispatchEvent(new Event("selectionchange"));
  expect(screen.queryByRole("dialog")).toBeNull();
  const panel = open();
  expect(panel).toHaveTextContent("背景信息窗口：");
  expect(panel).toHaveTextContent(/% 已用（剩余 \d+%）/);
  expect(panel).toHaveTextContent(/已用 \d+ 标记，共 500/);
  expect(panel).toHaveTextContent("总量以当前对话的压缩容量为准");
  expect(panel).not.toHaveTextContent("Token");
  expect(panel).not.toHaveTextContent("预设与系统");
  expect(panel).not.toHaveTextContent("模型窗口");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("the percentage follows the current conversation threshold and draft", () => {
  const current = session();
  const original = JSON.stringify(current);
  const percent = (target: ChatSession, draftText = "") =>
    `${
      estimateChatContextUsage({
        session: target,
        draftText,
        formatTemplate,
      }).thresholdPercent
    }%`;
  const { rerender } = render(<ContextUsage session={current} />);
  expect(trigger()).toHaveTextContent(percent(current));
  const adjusted = {
    ...current,
    mask: {
      ...current.mask,
      modelConfig: { ...current.mask.modelConfig, compressionThreshold: 1000 },
    },
  };
  rerender(<ContextUsage session={adjusted} />);
  expect(trigger()).toHaveTextContent(percent(adjusted));
  const text = "x".repeat(6000);
  rerender(<ContextUsage session={adjusted} draftText={text} />);
  expect(trigger()).toHaveTextContent(percent(adjusted, text));
  expect(open()).toHaveTextContent("已超过压缩容量的 90%");
  expect(screen.getByRole("dialog")).toHaveTextContent("剩余 0%");
  expect(screen.getByRole("dialog")).toHaveTextContent("共 1k");
  expect(JSON.stringify(current)).toBe(original);
});

test("uses compact token counts with the existing threshold rather than the model budget", () => {
  const current = session();
  current.messages = [
    {
      id: "long-history",
      role: "user",
      content: "a".repeat((239000 - 8) * 4),
      date: "",
    },
  ];
  current.mask.modelConfig.compressionThreshold = 512000;
  render(<ContextUsage session={current} />);
  const panel = open();
  expect(panel).toHaveTextContent("47% 已用（剩余 53%）");
  expect(panel).toHaveTextContent("已用 239k 标记，共 512k");
});

test("zero usage shows the entire capacity remaining", () => {
  const current = session();
  current.messages = [];
  render(<ContextUsage session={current} />);
  const panel = open();
  expect(panel).toHaveTextContent("0% 已用（剩余 100%）");
  expect(panel).toHaveTextContent("已用 0 标记，共 500");
});

test("shows measured response metrics and preserves an actual zero cache hit", () => {
  const current = session();
  current.messages[1].responseMetrics = {
    usage: { inputTokens: 1000, outputTokens: 280, cachedInputTokens: 0 },
    generationDurationMs: 10000,
  };
  const { rerender } = render(<ContextUsage session={current} />);
  expect(trigger("输出速度")).toHaveTextContent("28 tok/s");
  expect(open("输出速度")).toHaveTextContent("不含首字前的等待");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(trigger("缓存命中")).toHaveTextContent("0%");
  const next = session();
  next.messages[1].responseMetrics = {
    usage: { inputTokens: 1000, outputTokens: 280, cachedInputTokens: 994 },
    generationDurationMs: 10000,
  };
  rerender(<ContextUsage session={next} />);
  expect(trigger("缓存命中")).toHaveTextContent("99.4%");
});

test("retains previous metrics during a request and updates live speed before completion", () => {
  const current = session();
  current.messages[1].responseMetrics = {
    usage: { inputTokens: 1000, outputTokens: 280, cachedInputTokens: 994 },
    generationDurationMs: 10000,
  };
  current.messages.push({
    id: "next-answer",
    role: "assistant",
    content: "",
    date: "",
    streaming: true,
  });
  const { rerender } = render(<ContextUsage session={current} />);
  expect(trigger("输出速度")).toHaveTextContent("28 tok/s");
  expect(trigger("缓存命中")).toHaveTextContent("99.4%");
  expect(open("输出速度")).toHaveTextContent("暂保留上一轮输出速度");
  const live = {
    ...current,
    messages: current.messages.map((message) =>
      message.id === "next-answer"
        ? {
            ...message,
            generationProgress: { outputTokens: 60, durationMs: 2000 },
          }
        : message,
    ),
  };
  rerender(<ContextUsage session={live} />);
  expect(trigger("输出速度")).toHaveTextContent("30 tok/s");
  expect(screen.getByRole("dialog")).toHaveTextContent("实时估算");
  expect(trigger("缓存命中")).toHaveTextContent("99.4%");
  live.messages.at(-1)!.generationProgress = {
    outputTokens: 100,
    durationMs: 2500,
  };
  rerender(<ContextUsage session={{ ...live }} />);
  expect(trigger("输出速度")).toHaveTextContent("40 tok/s");
  live.messages.at(-1)!.streaming = false;
  live.messages.at(-1)!.responseMetrics = {
    usage: { inputTokens: 1000, outputTokens: 125, cachedInputTokens: 0 },
    generationDurationMs: 2500,
  };
  rerender(<ContextUsage session={{ ...live }} />);
  expect(trigger("输出速度")).toHaveTextContent("50 tok/s");
  expect(screen.getByRole("dialog")).not.toHaveTextContent("实时估算");
  expect(trigger("缓存命中")).toHaveTextContent("0%");
});

test("first streaming answer waits for observable output without inventing stats", () => {
  const current = session();
  current.messages[1] = {
    ...current.messages[1],
    content: "",
    streaming: true,
  };
  render(<ContextUsage session={current} />);
  expect(trigger("输出速度")).toHaveTextContent("\u2014 tok/s");
  expect(trigger("缓存命中")).toHaveTextContent("\u2014");
  expect(open("输出速度")).toHaveTextContent("随后实时显示估算速度");
});

test("switches details in the same panel and toggles the selected metric closed", () => {
  render(<ContextUsage session={session()} />);
  const panel = open("输出速度");
  fireEvent.pointerDown(trigger("缓存命中"));
  fireEvent.click(trigger("缓存命中"));
  expect(screen.getByRole("dialog")).toBe(panel);
  expect(panel).toHaveTextContent("缓存命中");
  expect(trigger("输出速度")).toHaveAttribute("aria-expanded", "false");
  expect(trigger("缓存命中")).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(trigger("缓存命中"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("Escape restores focus to the last metric after switching details", () => {
  render(<ContextUsage session={session()} />);
  open();
  fireEvent.click(trigger("缓存命中"));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger("缓存命中")).toHaveFocus();
});

test("the composer preserves the metric trigger focus and draft on click and Escape", () => {
  render(<ComposerHarness />);
  const input = screen.getByRole("textbox", { name: "Draft" });
  act(() => input.focus());
  const pointer = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  Object.defineProperty(pointer, "pointerType", { value: "mouse" });
  fireEvent(trigger(), pointer);
  const allowed = fireEvent.mouseDown(trigger(), { button: 0 });
  if (allowed) act(() => trigger().focus());
  fireEvent.mouseUp(trigger(), { button: 0 });
  fireEvent.click(trigger(), { button: 0, detail: 1 });
  expect(
    screen.getByRole("dialog", { name: "对话状态详情" }),
  ).toBeInTheDocument();
  expect(trigger()).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger()).toHaveFocus();
  expect(input).toHaveValue("Keep my draft");
});

test("outside pointer closes details without stealing focus", () => {
  render(
    <>
      <ContextUsage session={session()} />
      <button type="button">Other action</button>
    </>,
  );
  open();
  const outside = screen.getByRole("button", { name: "Other action" });
  fireEvent.pointerDown(outside);
  act(() => outside.focus());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(outside).toHaveFocus();
});

test("mobile uses the same small nonmodal detail panel", () => {
  render(<ContextUsage session={session()} mobile pendingAttachments={2} />);
  const panel = open();
  expect(panel).toHaveAttribute("aria-modal", "false");
  expect(panel).toHaveTextContent("2 个素材处理中");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger()).toHaveFocus();
});

test("switching conversations closes old details and recalculates progress", () => {
  const current = session();
  current.messages[1].responseMetrics = {
    usage: { inputTokens: 1000, outputTokens: 280, cachedInputTokens: 994 },
    generationDurationMs: 10000,
  };
  const { rerender } = render(<ContextUsage session={current} />);
  open();
  rerender(
    <ContextUsage
      session={{ ...current, id: "next-context-session", messages: [] }}
    />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger()).toHaveAttribute("aria-expanded", "false");
  expect(trigger()).toHaveTextContent("0%");
  expect(trigger("输出速度")).toHaveTextContent("\u2014 tok/s");
  expect(trigger("缓存命中")).toHaveTextContent("\u2014");
});
