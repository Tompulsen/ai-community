import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { jest } from "@jest/globals";
import type { ChatMessageTool, ChatSession } from "../app/store/chat";
import type { ToolRerun } from "../app/components/tool-activity";

const registry = jest.fn<() => Promise<unknown>>();
const execute =
  jest.fn<(client: string, request: unknown) => Promise<unknown>>();
jest.unstable_mockModule("@/app/mcp/actions", () => ({
  getAllTools: registry,
  executeMcpAction: execute,
}));
const controllers = new Map<string, AbortController>();
const pool = {
  get controllers() {
    return Object.fromEntries(controllers);
  },
  key: (session: string, tool: string) => `${session}:${tool}`,
  addController: jest.fn(
    (session: string, tool: string, controller: AbortController) => {
      controllers.set(`${session}:${tool}`, controller);
    },
  ),
  remove: jest.fn((session: string, tool: string) => {
    controllers.delete(`${session}:${tool}`);
  }),
  hasPending: (session: string) =>
    [...controllers.keys()].some((key) => key.startsWith(`${session}:`)),
};
jest.unstable_mockModule("@/app/client/controller", () => ({
  ChatControllerPool: pool,
}));
let scope = "user-1";
let token = 7;
let active = true;
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => scope,
  getLocalTokenId: () => token,
  isLocalWorkspaceActive: () => active,
}));
let state: {
  sessions: ChatSession[];
  currentSessionIndex: number;
  currentSession: () => ChatSession;
  updateTargetSession: (
    target: ChatSession,
    update: (session: ChatSession) => void,
  ) => void;
};
jest.unstable_mockModule("@/app/store/chat", () => ({
  useChatStore: { getState: () => state },
}));
let props: { onRerun?: ToolRerun; tool: ChatMessageTool; disabled: boolean };
jest.unstable_mockModule("@/app/components/tool-activity", () => ({
  ToolActivity: (next: typeof props) => {
    props = next;
    return <div />;
  },
}));
const { MessageToolActivity } = await import(
  "../app/components/message-tool-activity"
);

function tool(): ChatMessageTool {
  return {
    id: "tool-1",
    type: "mcp",
    clientId: "server-1",
    function: { name: "lookup", arguments: '{"query":"old"}' },
    content: '{"old":true}',
    isError: false,
  };
}

function session(): ChatSession {
  return {
    id: "session-1",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        date: "",
        content: "",
        tools: [tool()],
      },
    ],
  } as ChatSession;
}

function latest() {
  const target = state.sessions[0];
  return [...target.messages, ...(target.messageBranches ?? [])][0].tools![0];
}

function mount() {
  render(
    <MessageToolActivity
      sessionId="session-1"
      messageId="message-1"
      tool={latest()}
    />,
  );
  return props.onRerun!(props.tool, { query: "new" });
}

async function flushAsync() {
  await act(async () => {});
}

beforeEach(() => {
  scope = "user-1";
  token = 7;
  active = true;
  controllers.clear();
  registry
    .mockReset()
    .mockResolvedValue([
      { clientId: "server-1", tools: { tools: [{ name: "lookup" }] } },
    ]);
  execute
    .mockReset()
    .mockResolvedValue({ content: [{ type: "text", text: "New result" }] });
  pool.addController.mockClear();
  pool.remove.mockClear();
  state = {
    sessions: [session()],
    currentSessionIndex: 0,
    currentSession: () => state.sessions[state.currentSessionIndex],
    updateTargetSession(target, update) {
      const current = state.sessions.find((entry) => entry.id === target.id);
      if (current) update(current);
    },
  };
});
afterEach(cleanup);

test("executes only a still registered tool and persists its result on the original message", async () => {
  await mount();
  expect(execute).toHaveBeenCalledWith("server-1", {
    method: "tools/call",
    params: { name: "lookup", arguments: { query: "new" } },
  });
  expect(latest()).toMatchObject({
    isError: false,
    function: { arguments: '{"query":"new"}' },
    content: JSON.stringify(
      { content: [{ type: "text", text: "New result" }] },
      null,
      2,
    ),
  });
  expect(pool.addController).toHaveBeenCalledWith(
    "session-1",
    "tool-1",
    expect.any(AbortController),
  );
  expect(controllers.size).toBe(0);
});

test("preserves the previous result when a tool is no longer registered", async () => {
  registry.mockResolvedValueOnce([]);
  await expect(mount()).rejects.toThrow("工具当前不可用");
  expect(execute).not.toHaveBeenCalled();
  expect(latest().content).toBe('{"old":true}');
  expect(latest().isError).toBe(false);
  expect(controllers.size).toBe(0);
});

test("does not execute when the account or selected conversation changes during registration lookup", async () => {
  let release!: (value: unknown) => void;
  registry.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const request = mount();
  scope = "user-2";
  release([{ clientId: "server-1", tools: { tools: [{ name: "lookup" }] } }]);
  await expect(request).rejects.toThrow("会话或账号已变化");
  expect(execute).not.toHaveBeenCalled();
  expect(latest().content).toBe('{"old":true}');
});

test("discards late results after a token change or removed message", async () => {
  let finish!: (value: unknown) => void;
  execute.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const request = mount();
  await flushAsync();
  expect(latest().isError).toBeUndefined();
  token = 8;
  const pendingTool = latest();
  state.sessions[0].messages = [];
  finish({ answer: "Should be discarded" });
  await request;
  expect(pendingTool.content).toBeUndefined();
  expect(state.sessions[0].messages).toEqual([]);
  expect(controllers.size).toBe(0);
});

test("can write back to an archived branch after unmounting in the same account", async () => {
  let finish!: (value: unknown) => void;
  execute.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const request = mount();
  await flushAsync();
  cleanup();
  state.sessions[0].messageBranches = state.sessions[0].messages;
  state.sessions[0].messages = [];
  finish({ answer: 21 });
  await request;
  expect(latest()).toMatchObject({
    isError: false,
    content: '{\n  "answer": 21\n}',
  });
});

test("stopping waiting clears pending state and rejects a late result", async () => {
  let finish!: (value: unknown) => void;
  execute.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const request = mount();
  await flushAsync();
  const stopped = expect(request).rejects.toThrow("已停止等待");
  controllers.get("session-1:tool-1")!.abort();
  expect(latest()).toMatchObject({
    isError: true,
    errorMsg: "已停止等待，工具可能仍在运行。",
  });
  await stopped;
  expect(latest().content).toBeUndefined();
  expect(latest().isError).toBe(true);
  expect(controllers.size).toBe(0);
  finish({ answer: "Late result" });
  await flushAsync();
  expect(latest().content).toBeUndefined();
});

test("stopping registration lookup settles immediately without waiting for a remote response", async () => {
  registry.mockReturnValueOnce(new Promise(() => {}));
  const request = mount();
  const stopped = expect(request).rejects.toThrow("操作已取消");
  controllers.get("session-1:tool-1")!.abort();
  await stopped;
  expect(execute).not.toHaveBeenCalled();
  expect(latest().content).toBe('{"old":true}');
  expect(controllers.size).toBe(0);
});

test("treats both MCP tool errors and JSON RPC errors as failed execution", async () => {
  execute.mockResolvedValueOnce({
    error: { code: -1, message: "Permission denied" },
  });
  await mount();
  expect(latest()).toMatchObject({
    isError: true,
    errorMsg: "Permission denied",
  });
});

test("a concurrent rerun cannot submit the same tool twice", async () => {
  let finish!: (value: unknown) => void;
  execute.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const request = mount();
  await flushAsync();
  await expect(
    props.onRerun!(props.tool, { query: "duplicate" }),
  ).rejects.toThrow("无法重新执行");
  expect(execute).toHaveBeenCalledTimes(1);
  finish({ answer: 1 });
  await request;
});

test("an old request cannot remove a newer controller with the same tool identity", async () => {
  let finish!: (value: unknown) => void;
  execute.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const request = mount();
  await flushAsync();
  const newer = new AbortController();
  controllers.set("session-1:tool-1", newer);
  scope = "user-2";
  finish({ answer: "Stale result" });
  await request;
  expect(controllers.get("session-1:tool-1")).toBe(newer);
  expect(pool.remove).not.toHaveBeenCalled();
});
