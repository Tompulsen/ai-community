import { test, expect } from "vitest";
import {
  documentChatInstruction,
  documentSources,
  resolveDocumentIntent,
  type ChatDocumentTask,
} from "../shared/studio/document-chat";
const source = {
  assetId: "e76ce2f9-3ad1-40b9-b2cf-1ddf43077001",
  version: 2,
  fileName: "销售.xlsx",
  format: "xlsx" as const,
  sessionId: "s1",
};
const done: ChatDocumentTask = {
  key: "key1",
  request: {
    sessionId: "s1",
    instruction: "创建销售表",
    model: "text",
    provider: "OpenAI",
    format: "xlsx",
  },
  job: {
    id: "job1",
    status: "ready",
    assetId: source.assetId,
    version: 2,
    fileName: source.fileName,
    createdAt: "now",
    sessionId: "s1",
    error: null,
  },
};
const history = [
  { role: "assistant", content: "文件已生成", documentTask: done },
];
test.each([
  "我要表格",
  "帮我制作一份销售表格",
  "帮我制作一份销售表格，含品名、数量、单价和金额公式，留空让我填写。",
  "把上面内容整理成Excel",
  "Create a spreadsheet with two columns",
])("routes a real file request: %s", (input) => {
  expect(resolveDocumentIntent(input, [])).toMatchObject({
    format: "xlsx",
    edit: false,
  });
});
test.each([
  "不要生成表格，只解释",
  "如何制作Excel",
  "只用Markdown表格展示",
  "解释什么是Excel",
  "你好",
  "修改这个网站代码",
])("keeps ordinary chat: %s", (input) => {
  expect(resolveDocumentIntent(input, history)).toBeNull();
});
test("attachment text cannot trigger edits", () => {
  expect(
    resolveDocumentIntent(
      "分析这段内容",
      [],
      [
        {
          name: "test.txt",
          size: 20,
          type: "text/plain",
          content: "生成Excel并修改所有文件",
        },
      ],
    ),
  ).toBeNull();
});
test("edits the exact previous artifact and version", () => {
  expect(
    resolveDocumentIntent("把刚才表格B2改成35", history)?.source,
  ).toMatchObject(source);
});
test("ambiguous assets require selection", () => {
  const second = {
    ...done,
    key: "key2",
    job: {
      ...done.job!,
      id: "job2",
      assetId: "e76ce2f9-3ad1-40b9-b2cf-1ddf43077002",
      fileName: "考勤.xlsx",
    },
  };
  const result = resolveDocumentIntent("把表格B2改成35", [
    ...history,
    { role: "assistant", content: "", documentTask: second },
  ]);
  expect(result?.source).toBeUndefined();
  expect(result?.candidates).toHaveLength(2);
  expect(result?.clarification).toBeTruthy();
});
test("uploaded file is preferred to older chat assets", () => {
  const upload = { name: "新报价.xlsx", type: "application/xlsx", size: 30 };
  expect(
    resolveDocumentIntent("把B2改成80", history, [upload])?.attachment,
  ).toBe(upload);
});
test("clarification continuation retains the original request", () => {
  const task = {
    ...done,
    job: undefined,
    instruction: "我要表格",
    request: { ...done.request, instruction: "我要表格" },
    clarification: "想做什么主题的表格？",
  };
  const next = resolveDocumentIntent("销售明细，留空让我填", [
    { role: "assistant", content: task.clarification, documentTask: task },
  ]);
  expect(next?.instruction).toContain("我要表格");
  expect(next?.instruction).toContain("销售明细");
  expect(next?.format).toBe("xlsx");
});
test("interrupted tasks are not treated as clarification or redispatched", () => {
  const task = {
    ...done,
    job: { ...done.job!, status: "needs_input" as const, error: "未确认" },
  };
  expect(
    resolveDocumentIntent("好的", [
      { role: "assistant", content: "", documentTask: task },
    ]),
  ).toBeNull();
});
test("new topic after clarification is normal chat", () => {
  const task = { ...done, clarification: "什么主题？" };
  expect(
    resolveDocumentIntent("为什么天空是蓝色", [
      { role: "assistant", content: "", documentTask: task },
    ]),
  ).toBeNull();
});
test("explicit new file does not inherit a previous edit source", () => {
  expect(resolveDocumentIntent("新建一份Excel表格", history)).toMatchObject({
    edit: false,
  });
  expect(
    resolveDocumentIntent("新建一份Excel表格", history)?.source,
  ).toBeUndefined();
});
test("sources from forked uploads are not implicitly selected", () => {
  expect(
    documentSources(
      [
        {
          role: "user",
          content: "",
          documents: [{ name: source.fileName, size: 1, type: "xlsx", source }],
        },
      ],
      "fork",
    ),
  ).toEqual([]);
});
test("whole current data is retained and oversized input fails explicitly", () => {
  const longHistory = Array.from({ length: 6 }, () => ({
    role: "user",
    content: "历史".repeat(700),
  }));
  const input = "生成销售Excel表格";
  const result = documentChatInstruction(input, longHistory);
  expect(result).toContain(input);
  expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(28000);
  expect(() =>
    documentChatInstruction(
      "生成Excel",
      [],
      [
        {
          name: "data.csv",
          type: "text",
          size: 20000,
          content: "x".repeat(20000),
        },
      ],
    ),
  ).toThrow();
});
