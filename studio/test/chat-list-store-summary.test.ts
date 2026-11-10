import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createStore } from "zustand/vanilla";
import type { ChatSession } from "../app/store/chat";
import {
  createChatListStoreSelector,
  createChatListSummarySelector,
} from "../app/utils/chat-list-summary";

function session(id: string, projectId?: string): ChatSession {
  return {
    id,
    topic: `Topic ${id}`,
    messages: [
      {
        id: `${id}-message`,
        role: "assistant",
        content: "Original body",
        date: "2026-11-06",
      },
    ],
    lastUpdate: 1,
    projectId,
    mask: {
      avatar: `avatar-${id}`,
      modelConfig: { model: `model-${id}` },
    } as ChatSession["mask"],
    memoryPrompt: "",
    lastSummarizeIndex: 0,
    stat: { charCount: 0, tokenCount: 0, wordCount: 0 },
  };
}

function chatStore(sessions: ChatSession[]) {
  return createStore(() => ({ sessions, currentSessionIndex: 0 }));
}

test("real store notifications share one primitive scan across all list selectors", () => {
  function measure(factory: typeof createChatListSummarySelector) {
    let reads = 0;
    const sessions = Array.from({ length: 200 }, (_, index) => {
      const item = session(String(index), index % 2 ? "writing" : undefined);
      const messages = item.messages;
      Object.defineProperty(item, "messages", {
        get() {
          reads++;
          return messages;
        },
      });
      return item;
    });
    const store = chatStore(sessions);
    const selectors = [null, null, undefined, "writing", "empty"].map(factory);
    const select = () =>
      selectors.map((selector) => selector(store.getState()));
    const before = select();
    let after = before;
    const unsubscribe = store.subscribe(() => {
      after = select();
    });
    reads = 0;
    store.setState({ sessions: sessions.slice() });
    unsubscribe();
    expect(after).toEqual(before);
    after.forEach((snapshot, index) => expect(snapshot).toBe(before[index]));
    return reads;
  }
  expect(measure(createChatListSummarySelector)).toBe(600);
  expect(measure(createChatListStoreSelector)).toBe(200);
});

test("store selectors reuse shared project snapshots and ignore body-only updates", () => {
  const store = chatStore([session("first"), session("second", "writing")]);
  const all = createChatListStoreSelector(null);
  const anotherAll = createChatListStoreSelector(null);
  const writing = createChatListStoreSelector("writing");
  const anotherWriting = createChatListStoreSelector("writing");
  const initial = all(store.getState());
  const project = writing(store.getState());
  expect(anotherAll(store.getState())).toBe(initial);
  expect(anotherWriting(store.getState())).toBe(project);
  expect(project.sessions[0]).toBe(initial.sessions[1]);
  store.getState().sessions[0].messages[0].content = "Streamed body";
  store.getState().sessions[0].messages[0].reasoning = "Streamed reasoning";
  store.setState({ sessions: store.getState().sessions });
  expect(all(store.getState())).toBe(initial);
  expect(writing(store.getState())).toBe(project);
  expect(anotherAll(store.getState())).toBe(initial);
});

test("in-place fields invalidate after a store notification without retaining masks", () => {
  const store = chatStore([session("first"), session("second", "writing")]);
  const all = createChatListStoreSelector(null);
  const writing = createChatListStoreSelector("writing");
  const initial = all(store.getState());
  const entry = store.getState().sessions[1];
  const originalMask = entry.mask;
  entry.topic = "Updated topic";
  entry.messages.push({ ...entry.messages[0], id: "new-message" });
  entry.lastUpdate = 5;
  entry.favorite = true;
  entry.mask.avatar = "updated-avatar";
  entry.mask.modelConfig.model = "updated-model";
  store.setState({ sessions: store.getState().sessions });
  const updated = all(store.getState());
  expect(updated.sessions[0]).toBe(initial.sessions[0]);
  expect(updated.sessions[1]).toEqual({
    id: "second",
    topic: "Updated topic",
    count: 2,
    time: 5,
    index: 1,
    favorite: true,
    projectId: "writing",
    avatar: "updated-avatar",
    model: "updated-model",
  });
  expect(entry.mask).toBe(originalMask);
  expect(writing(store.getState()).sessions[0]).toBe(updated.sessions[1]);
  expect(
    Object.values(updated.sessions[1]).every(
      (value) => value === undefined || typeof value !== "object",
    ),
  ).toBe(true);
});

test("selection and project movement keep filtered positions and unchanged groups", () => {
  const store = chatStore([
    session("first"),
    session("second", "writing"),
    session("third", "research"),
  ]);
  const all = createChatListStoreSelector(null);
  const unassigned = createChatListStoreSelector();
  const writing = createChatListStoreSelector("writing");
  const research = createChatListStoreSelector("research");
  const first = unassigned(store.getState());
  const initialRows = all(store.getState()).sessions;
  const oldResearch = research(store.getState());
  store.setState({ currentSessionIndex: 1 });
  expect(all(store.getState()).sessions).toBe(initialRows);
  expect(writing(store.getState()).selectedIndex).toBe(0);
  expect(unassigned(store.getState()).selectedIndex).toBe(-1);
  expect(research(store.getState())).toBe(oldResearch);
  store.getState().sessions[1].projectId = undefined;
  store.setState({ sessions: store.getState().sessions });
  expect(writing(store.getState()).sessions).toEqual([]);
  expect(
    unassigned(store.getState()).sessions.map((item) => [item.id, item.index]),
  ).toEqual([
    ["first", 0],
    ["second", 1],
  ]);
  expect(unassigned(store.getState()).selectedIndex).toBe(1);
  expect(research(store.getState())).toBe(oldResearch);
  expect(first.sessions[0]).toBe(unassigned(store.getState()).sessions[0]);
});

test("reordering, deleting and undoing use the current global indices", () => {
  const first = session("first", "writing");
  const second = session("second");
  const third = session("third", "writing");
  const store = chatStore([first, second, third]);
  const all = createChatListStoreSelector(null);
  const writing = createChatListStoreSelector("writing");
  all(store.getState());
  store.setState({ sessions: [third, first, second], currentSessionIndex: 1 });
  expect(
    writing(store.getState()).sessions.map((item) => [item.id, item.index]),
  ).toEqual([
    ["third", 0],
    ["first", 1],
  ]);
  expect(writing(store.getState()).selectedIndex).toBe(1);
  const beforeDelete = store.getState();
  const before = all(beforeDelete);
  store.setState({ sessions: [second], currentSessionIndex: 0 });
  expect(writing(store.getState()).sessions).toEqual([]);
  expect(all(store.getState()).sessions[0]).toMatchObject({
    id: "second",
    index: 0,
  });
  store.setState(beforeDelete);
  expect(all(store.getState())).toEqual(before);
  expect(writing(store.getState()).sessions.map((item) => item.id)).toEqual([
    "third",
    "first",
  ]);
  expect(writing(store.getState()).selectedIndex).toBe(1);
});

test("account replacement with matching ids cannot reuse stale display values", () => {
  const store = chatStore([session("same-id", "writing")]);
  const all = createChatListStoreSelector(null);
  const writing = createChatListStoreSelector("writing");
  const original = all(store.getState());
  writing(store.getState());
  store.setState({ sessions: [] });
  expect(all(store.getState())).toEqual({ sessions: [], selectedIndex: -1 });
  expect(writing(store.getState())).toEqual({
    sessions: [],
    selectedIndex: -1,
  });
  const otherAccount = session("same-id", "research");
  otherAccount.topic = "Other account";
  otherAccount.mask.avatar = "other-avatar";
  store.setState({ sessions: [otherAccount] });
  expect(all(store.getState()).sessions[0]).toMatchObject({
    id: "same-id",
    topic: "Other account",
    projectId: "research",
    avatar: "other-avatar",
  });
  expect(writing(store.getState()).sessions).toEqual([]);
  store.setState({ sessions: [session("same-id", "writing")] });
  expect(all(store.getState())).toEqual(original);
  expect(writing(store.getState()).sessions[0].topic).toBe("Topic same-id");
});

test("direct helper callers still observe mutations of the same root object", () => {
  const state = {
    sessions: [session("first", "writing")],
    currentSessionIndex: 0,
  };
  const select = createChatListSummarySelector("writing");
  expect(select(state).sessions).toHaveLength(1);
  state.sessions[0].projectId = undefined;
  expect(select(state).sessions).toHaveLength(0);
  state.sessions[0].projectId = "writing";
  state.sessions[0].topic = "Changed without notification";
  expect(select(state).sessions[0].topic).toBe("Changed without notification");
});

test("shared caches release replaced store roots, sessions, masks and message arrays", () => {
  const require = createRequire(import.meta.url);
  const modulePath = fileURLToPath(
    new URL("../app/utils/chat-list-summary.ts", import.meta.url),
  );
  const probe = `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const ts = require(${JSON.stringify(require.resolve("typescript"))});
    const { createStore } = require(${JSON.stringify(
      require.resolve("zustand/vanilla"),
    )});
    const source = ts.transpileModule(
      fs.readFileSync(${JSON.stringify(modulePath)}, "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText;
    const exports = {};
    new Function("exports", source)(exports);
    const select = exports.createChatListStoreSelector(null);
    const selectProject = exports.createChatListStoreSelector("writing");
    const store = createStore(() => ({ sessions: [], currentSessionIndex: 0 }));
    let references;
    (() => {
      const messages = [{ content: "Released body" }];
      const mask = { avatar: "old", modelConfig: { model: "old" } };
      const session = { id: "old", topic: "old", messages, mask, projectId: "writing" };
      store.setState({ sessions: [session] });
      const root = store.getState();
      select(root);
      selectProject(root);
      references = [root, session, messages, mask].map((item) => new WeakRef(item));
    })();
    store.setState({ sessions: [] });
    select(store.getState());
    selectProject(store.getState());
    (async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setImmediate(resolve));
        global.gc();
      }
      assert(references.every((reference) => reference.deref() === undefined));
      console.log("released");
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  expect(
    execFileSync(process.execPath, ["--expose-gc", "-e", probe], {
      encoding: "utf8",
      timeout: 10000,
    }).trim(),
  ).toBe("released");
});
