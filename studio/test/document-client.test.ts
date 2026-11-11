/** @jest-environment node */
import { jest } from "@jest/globals";
import type { ChatMessage } from "../app/store/chat";
import type { ChatOptions } from "../app/client/api";

let scope = "user-7",
  token = 10;
let controller: AbortController;
const model = jest.fn<(options: ChatOptions) => Promise<void>>();
const fetchMock = jest.fn<typeof fetch>();
const session: any = { id: "chat-1", messages: [] };
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => scope,
  getLocalTokenId: () => token,
  isLocalWorkspaceActive: () => true,
}));
jest.unstable_mockModule("@/app/client/api", () => ({
  getHeaders: () => ({}),
  getClientApi: () => ({ llm: { chat: model } }),
}));
jest.unstable_mockModule("@/app/utils", () => ({
  getMessageTextContent: (message: any) => message.content,
}));
jest.unstable_mockModule("@/app/client/controller", () => ({
  ChatControllerPool: {
    addController: (_s: string, _m: string, value: AbortController) => {
      controller = value;
    },
    remove: jest.fn(),
  },
}));
jest.unstable_mockModule("@/app/store/chat", () => ({
  useChatStore: {
    getState: () => ({
      sessions: [session],
      updateTargetSession: (value: any, fn: any) => fn(value),
    }),
  },
}));
const { runDocumentChat, retryDocumentFile, captureDocumentAccount } =
  await import("../app/utils/document-client");
const plan = {
  schemaVersion: 1,
  kind: "create_word",
  fileName: "会议纪要.docx",
  blocks: [{ type: "paragraph", text: "会议纪要" }],
};
const realFetch = global.fetch;
const source = {
  assetId: "11111111-1111-4111-8111-111111111111",
  version: 1,
  fileName: "会议纪要.docx",
  format: "docx" as const,
  sessionId: "chat-1",
};
function options(input = "请生成一个 Word 文档：会议纪要") {
  const bot = {
    id: "bot-1",
    role: "assistant",
    content: "",
    streaming: true,
  } as ChatMessage;
  session.messages = [bot];
  return {
    input,
    sessionId: session.id,
    bot,
    turns: [],
    files: [],
    config: {
      model: "fixture-current",
      providerName: "OpenAI",
    } as ChatOptions["config"],
    accountTokenId: 10,
    assertActive: () => true,
    publish: jest.fn(),
    onSource: jest.fn(),
  };
}
beforeEach(() => {
  scope = "user-7";
  token = 10;
  delete session.documentSource;
  global.fetch = fetchMock;
  fetchMock.mockReset();
  model.mockReset();
  model.mockImplementation(async (value) => {
    value.onFinish?.(JSON.stringify(plan), new Response());
  });
  fetchMock.mockImplementation(async (url, request) => {
    if (String(url).endsWith("capabilities"))
      return Response.json({ enabled: true, docx: true, xlsx: true });
    if (String(url).endsWith("/versions"))
      return Response.json({ versions: [{ version: 2 }] });
    if (request?.method === "POST")
      return Response.json({
        id: "job-id",
        status: "queued",
        assetId: null,
        version: null,
        sessionId: session.id,
      });
    return Response.json({ error: "not found" }, { status: 404 });
  });
});
afterAll(() => {
  global.fetch = realFetch;
});

test.each(["你好", "不要生成文件，只展示 Markdown 表格"])(
  "ordinary text and opt-out do not call a model or document service: %s",
  async (input) => {
    expect(await runDocumentChat(options(input))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  },
);
test("stale document selection is rejected before a paid model request", async () => {
  const args = { ...options("请修改会议纪要.docx：标题改为总结"), source };
  expect(await runDocumentChat(args)).toBe(true);
  expect(args.bot.documentTask?.error).toMatch(/新版本/);
  expect(model).not.toHaveBeenCalled();
});
test("creation uses the selected model and saves its plan for file retries", async () => {
  const args = options();
  await runDocumentChat(args);
  expect(model).toHaveBeenCalledTimes(1);
  expect(model.mock.calls[0][0].config.model).toBe("fixture-current");
  expect(model.mock.calls[0][0].accountTokenId).toBe(10);
  expect(args.bot.documentTask?.plan).toMatchObject(plan);
  expect(args.bot.documentTask?.job?.status).toBe("queued");
  fetchMock.mockResolvedValue(
    Response.json({
      ...args.bot.documentTask!.job,
      status: "ready",
      assetId: source.assetId,
      version: 1,
      fileName: source.fileName,
    }),
  );
  await retryDocumentFile(session.id, args.bot.id);
  expect(model).toHaveBeenCalledTimes(1);
});
test("stopping while POST is in transit cancels by its known idempotency key", async () => {
  const args = options();
  fetchMock.mockImplementation(async (url, request) => {
    if (String(url).endsWith("capabilities"))
      return Response.json({ enabled: true, docx: true });
    if (request?.method === "POST") {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }
    return Response.json({
      id: args.bot.documentTask?.key,
      status: "cancelled",
      assetId: null,
      version: null,
      canRecover: false,
    });
  });
  await runDocumentChat(args);
  expect(
    fetchMock.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith("jobs/" + args.bot.documentTask?.key) &&
        init?.method === "DELETE",
    ),
  ).toBe(true);
  expect(args.bot.documentTask?.job?.status).toBe("cancelled");
  expect(model).toHaveBeenCalledTimes(1);
});
test("account and token switches invalidate captured document access", () => {
  const account = captureDocumentAccount();
  token++;
  expect(() => account.assertCurrent()).toThrow(/账号或密钥/);
  token--;
  scope = "user-8";
  expect(() => account.assertCurrent()).toThrow(/账号或密钥/);
});
