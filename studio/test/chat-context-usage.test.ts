import { jest } from "@jest/globals";
import type { ChatMessage, ChatSession } from "../app/store/chat";
import type { ModelConfig } from "../app/store/config";
import { DEFAULT_SYSTEM_TEMPLATE } from "../app/constant";
import {
  combineContextUsage,
  estimateChatContextUsage,
  getContextDraftUsage,
} from "../app/utils/chat-context-usage";
import { contextTokens, messageTokens } from "../app/utils/context-budget";
import type { ParsedFile } from "../app/utils/file-upload";

const formatTemplate = jest.fn((text: string, config: ModelConfig) =>
  (config.template ?? "{{input}}").replaceAll("{{input}}", text),
);

function message(
  content: ChatMessage["content"],
  fields: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `message-${Math.random()}`,
    role: "user",
    content,
    date: "",
    ...fields,
  };
}

function session(
  messages: ChatMessage[] = [],
  fields: Partial<ChatSession> = {},
): ChatSession {
  return {
    id: "context-session",
    topic: "Context usage fixture",
    stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
    lastUpdate: 0,
    messages,
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
        model: "gemini-context-test",
        template: "{{input}}",
        enableInjectSystemPrompts: false,
        compressionThreshold: 272000,
        contextBudget: 32768,
        max_tokens: 128000,
        historyMessageCount: 1,
        sendMemory: false,
      } as ModelConfig,
    },
    ...fields,
  };
}

beforeEach(() => jest.clearAllMocks());

test("counts preset, all eligible unsummarized history and the next input", () => {
  const current = session([
    message("The first question"),
    message("The first answer", { role: "assistant" }),
    message("The next question"),
    message("The next answer", { role: "assistant" }),
  ]);
  current.mask.context = [message("Preset facts", { role: "system" })];
  const usage = estimateChatContextUsage({
    session: current,
    draftText: "Next input",
    formatTemplate,
  });
  expect(usage.prefixTokens).toBe(
    messageTokens({ role: "system", content: "Preset facts" }),
  );
  expect(usage.historyTokens).toBe(contextTokens(current.messages));
  expect(usage.historyMessageCount).toBe(4);
  expect(usage.draftTokens).toBe(
    messageTokens({ role: "user", content: "Next input" }),
  );
  expect(usage.totalTokens).toBe(
    usage.prefixTokens + usage.historyTokens + usage.draftTokens,
  );
  expect(global.fetch).not.toHaveBeenCalled();
});

test("clear context and transient messages are excluded without losing MCP replies", () => {
  const current = session(
    [
      message("Before clearing"),
      message("Failed", { isError: true }),
      message("Still streaming", { streaming: true }),
      message("Preparing", { materialStatus: "processing" }),
      message("Material failed", { materialStatus: "failed" }),
      message("Tool result", { isMcpResponse: true }),
      message("Assistant continuation", { role: "assistant" }),
    ],
    { clearContextIndex: 1 },
  );
  const usage = estimateChatContextUsage({ session: current, formatTemplate });
  expect(usage.historyMessageCount).toBe(2);
  expect(usage.historyTokens).toBe(contextTokens(current.messages.slice(5)));
});

test("summary boundaries retain old media, replace old text and preserve source history", () => {
  const image = {
    type: "image_url" as const,
    image_url: { url: "https://example.com/image.png" },
  };
  const current = session(
    [
      message("Old text that was already summarized"),
      message([{ type: "text", text: "An old image caption" }, image]),
      message("Recent question"),
      message("Recent answer", { role: "assistant" }),
    ],
    {
      memoryPrompt: "Summary facts",
      lastSummarizeIndex: 2,
    },
  );
  const before = JSON.stringify(current);
  const usage = estimateChatContextUsage({ session: current, formatTemplate });
  expect(usage.memoryTokens).toBe(
    messageTokens({
      role: "system",
      content: "历史对话摘要：\nSummary facts",
    }),
  );
  expect(usage.historyTokens).toBe(
    contextTokens([
      { role: "user", content: [image] },
      ...current.messages.slice(2),
    ]),
  );
  expect(usage.historyMessageCount).toBe(3);
  expect(usage.mediaCount).toBe(1);
  expect(JSON.stringify(current)).toBe(before);
});

test("clearing past the summary excludes the old memory", () => {
  const current = session(
    [message("Summarized"), message("Cleared"), message("Current")],
    {
      memoryPrompt: "Stale summary",
      lastSummarizeIndex: 1,
      clearContextIndex: 2,
    },
  );
  const usage = estimateChatContextUsage({ session: current, formatTemplate });
  expect(usage.memoryTokens).toBe(0);
  expect(usage.historyTokens).toBe(contextTokens(current.messages.slice(2)));
});

test("inline generated images use the existing media estimate without counting encoded bytes", () => {
  const image = `data:image/png;base64,${"A".repeat(200000)}`;
  const current = session([
    message(`Caption\n![Generated](${image})`, { role: "assistant" }),
  ]);
  const usage = estimateChatContextUsage({ session: current, formatTemplate });
  expect(usage.historyTokens).toBe(
    messageTokens({
      role: "assistant",
      content: [
        { type: "text", text: "Caption\n" },
        { type: "image_url", image_url: { url: image } },
      ],
    }),
  );
  expect(usage.mediaCount).toBe(1);
  expect(usage.totalTokens).toBeLessThan(4200);
});

test("uses the real system template only for models with automatic system injection", () => {
  const current = session();
  current.mask.modelConfig.model = "gpt-context-test";
  current.mask.modelConfig.enableInjectSystemPrompts = true;
  estimateChatContextUsage({ session: current, formatTemplate });
  expect(formatTemplate).toHaveBeenCalledTimes(1);
  expect(formatTemplate).toHaveBeenCalledWith("", {
    ...current.mask.modelConfig,
    template: DEFAULT_SYSTEM_TEMPLATE,
  });
  formatTemplate.mockClear();
  current.mask.modelConfig.model = "other-model";
  const usage = estimateChatContextUsage({ session: current, formatTemplate });
  expect(formatTemplate).not.toHaveBeenCalled();
  expect(usage.prefixTokens).toBe(0);
});

test("raw draft, quoted text, file prefix and input template are each counted once", () => {
  const current = session();
  current.mask.modelConfig.template = "Template: {{input}}";
  const files: ParsedFile[] = [
    {
      name: "notes.txt",
      type: "text/plain",
      size: 5,
      content: "Notes",
      isText: true,
    },
  ];
  const usage = estimateChatContextUsage({
    session: current,
    draftText: "My question",
    files,
    quote: { messageId: "quoted", role: "assistant", text: "Quoted facts" },
    formatTemplate,
  });
  const outgoing =
    "--- 文件: notes.txt (5 B) ---\nNotes\n--- 文件结束 ---\n\n" +
    "引用内容：\n> Quoted facts\n\nMy question";
  expect(formatTemplate).toHaveBeenCalledTimes(1);
  expect(formatTemplate).toHaveBeenCalledWith(
    outgoing,
    current.mask.modelConfig,
  );
  expect(usage.draftTokens).toBe(
    messageTokens({ role: "user", content: `Template: ${outgoing}` }),
  );
});

test("image drafts bypass input templates and binary attachments use media costs", () => {
  const current = session();
  current.mask.modelConfig.template = "Long template: {{input}}";
  const file: ParsedFile = {
    name: "scan.pdf",
    type: "application/pdf",
    size: 6,
    content: `data:application/pdf;base64,${"A".repeat(100000)}`,
    isText: false,
  };
  const usage = estimateChatContextUsage({
    session: current,
    draftText: "Caption",
    imageCount: 2,
    files: [file],
    formatTemplate,
  });
  expect(formatTemplate).not.toHaveBeenCalled();
  expect(usage.mediaCount).toBe(3);
  expect(usage.draftTokens).toBe(
    messageTokens({
      role: "user",
      content: [
        { type: "text", text: "--- 素材: scan.pdf (6 B) ---\n\nCaption" },
        { type: "image_url", image_url: { url: "" } },
        { type: "image_url", image_url: { url: "" } },
        { type: "file", file: { filename: "scan.pdf", file_data: "" } },
      ],
    }),
  );
  expect(usage.totalTokens).toBeLessThan(12400);
});

test("an empty or quote-only unsendable draft adds no new request message", () => {
  const current = session();
  for (const draftText of ["", " \n "]) {
    expect(
      getContextDraftUsage(
        current.mask.modelConfig,
        {
          draftText,
          quote: { messageId: "quoted", role: "assistant", text: "Quoted" },
        },
        formatTemplate,
      ),
    ).toEqual({ draftTokens: 0, mediaCount: 0 });
  }
  expect(formatTemplate).not.toHaveBeenCalled();
});

test.each([
  [244800, false],
  [244801, true],
])(
  "a 272000 capacity marks %i tokens for compression only above 90 percent",
  (totalTokens, shouldCompress) => {
    const usage = combineContextUsage(
      {
        prefixTokens: 0,
        memoryTokens: 0,
        historyTokens: totalTokens,
        historyMessageCount: 1,
        mediaCount: 0,
        compressionThreshold: 272000,
      },
      { draftTokens: 0, mediaCount: 0 },
    );
    expect(usage.compressionThreshold).toBe(272000);
    expect(usage.thresholdPercent).toBe(90);
    expect(usage.reachesCompressionThreshold).toBe(shouldCompress);
  },
);

test("the next draft can cross the trigger from 89 percent while the percentage uses full capacity", () => {
  const current = session([message("中".repeat(363108))]);
  const before = estimateChatContextUsage({
    session: current,
    formatTemplate,
  });
  expect(before.totalTokens).toBe(242080);
  expect(before.thresholdPercent).toBe(89);
  expect(before.reachesCompressionThreshold).toBe(false);
  const usage = estimateChatContextUsage({
    session: current,
    draftText: "x".repeat(10852),
    formatTemplate,
  });
  expect(usage.draftTokens).toBe(2721);
  expect(usage.totalTokens).toBe(244801);
  expect(usage.compressionThreshold).toBe(272000);
  expect(usage.thresholdPercent).toBe(90);
  expect(usage.reachesCompressionThreshold).toBe(true);
});

test("compression percentage uses the full configured capacity", () => {
  const current = session();
  current.mask.modelConfig.compressionThreshold = 500;
  const usage = estimateChatContextUsage({
    session: current,
    draftText: "x".repeat(4000),
    formatTemplate,
  });
  expect(usage.compressionThreshold).toBe(500);
  expect(usage.totalTokens).toBe(1008);
  expect(usage.thresholdPercent).toBe(202);
  expect(usage.reachesCompressionThreshold).toBe(true);
  expect(usage).not.toHaveProperty("modelWindowTokens");
  expect(global.fetch).not.toHaveBeenCalled();
});
