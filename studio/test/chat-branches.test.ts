/** @jest-environment node */

import type { ChatMessage, ChatSession } from "../app/store/chat";
import { jest } from "@jest/globals";
import {
  answerBranches,
  branchBusy,
  branchMessages,
  cloneBranchMessages,
  createAnswerBranch,
  createEditedMessageBranch,
  deleteBranchMessage,
  selectAnswerBranch,
  synchronizeBranches,
} from "../app/utils/chat-branches";

const message = (
  id: string,
  role: ChatMessage["role"],
  content = id,
): ChatMessage => ({ id, role, content, date: "2026-11-03" });
function session(): ChatSession {
  return {
    id: "session",
    messages: [
      message("question", "user"),
      message("answer-1", "assistant"),
      message("follow-up", "user"),
      message("follow-up-answer", "assistant"),
    ],
    memoryPrompt: "Summary from answer 1",
    lastSummarizeIndex: 4,
    clearContextIndex: 3,
    lastUpdate: 0,
    topic: "",
    stat: { charCount: 0, tokenCount: 0, wordCount: 0 },
    mask: { context: [], modelConfig: {} } as unknown as ChatSession["mask"],
  };
}

test("legacy paths stay unchanged until the first retry", () => {
  const chat = session();
  synchronizeBranches(chat);
  expect(chat.messageBranches).toBeUndefined();
  expect(chat.messages.every((item) => item.parentId === undefined)).toBe(true);
  expect(answerBranches(chat, "answer-1")).toEqual({
    index: 0,
    total: 1,
    messageIds: ["answer-1"],
  });
});

test("retry preserves the original answer and restores each answer's continuation", () => {
  const chat = session();
  const answer = message("answer-2", "assistant");
  expect(createAnswerBranch(chat, "question", answer)).toBe(true);
  expect(chat.messages.map((item) => item.id)).toEqual([
    "question",
    "answer-2",
  ]);
  expect(answerBranches(chat, answer.id)).toEqual({
    index: 1,
    total: 2,
    messageIds: ["answer-1", "answer-2"],
  });
  chat.messages.push(
    message("different-follow-up", "user"),
    message("different-follow-up-answer", "assistant"),
  );
  synchronizeBranches(chat);
  expect(selectAnswerBranch(chat, "answer-2", "answer-1")).toBe(true);
  expect(chat.messages.map((item) => item.id)).toEqual([
    "question",
    "answer-1",
    "follow-up",
    "follow-up-answer",
  ]);
  expect(selectAnswerBranch(chat, "answer-1", "answer-2")).toBe(true);
  expect(chat.messages.map((item) => item.id)).toEqual([
    "question",
    "answer-2",
    "different-follow-up",
    "different-follow-up-answer",
  ]);
  expect(new Set(branchMessages(chat).map((item) => item.id)).size).toBe(7);
});

test("nested answer choices survive selecting the parent branch away and back", () => {
  const chat = session();
  createAnswerBranch(
    chat,
    "follow-up",
    message("follow-up-answer-2", "assistant"),
  );
  createAnswerBranch(chat, "question", message("answer-2", "assistant"));
  selectAnswerBranch(chat, "answer-2", "answer-1");
  expect(chat.messages.at(-1)?.id).toBe("follow-up-answer-2");
  selectAnswerBranch(chat, "follow-up-answer-2", "follow-up-answer");
  selectAnswerBranch(chat, "answer-1", "answer-2");
  selectAnswerBranch(chat, "answer-2", "answer-1");
  expect(chat.messages.at(-1)?.id).toBe("follow-up-answer");
});

test.each(["stream", "materials"])(
  "%s work prevents retry and selection from changing the active path",
  (work) => {
    const chat = session();
    createAnswerBranch(chat, "question", message("answer-2", "assistant"));
    const bot = chat.messages[1];
    if (work === "stream") bot.streaming = true;
    if (work === "materials") bot.materialStatus = "processing";
    expect(branchBusy(chat)).toBe(true);
    expect(selectAnswerBranch(chat, "answer-2", "answer-1")).toBe(false);
    expect(
      createAnswerBranch(chat, "question", message("answer-3", "assistant")),
    ).toBe(false);
    expect(chat.messages[1]).toBe(bot);
    expect(branchMessages(chat)).toHaveLength(5);
  },
);

test("switching removes the other answer's summary and clamps the context boundary", () => {
  const chat = session();
  createAnswerBranch(chat, "question", message("answer-2", "assistant"));
  expect(chat.memoryPrompt).toBe("");
  expect(chat.lastSummarizeIndex).toBe(0);
  expect(chat.clearContextIndex).toBe(1);
  chat.clearContextIndex = 2;
  selectAnswerBranch(chat, "answer-2", "answer-1");
  expect(chat.clearContextIndex).toBe(1);
});

test("deleting an answer removes its descendants and selects another answer", () => {
  const chat = session();
  createAnswerBranch(chat, "question", message("answer-2", "assistant"));
  selectAnswerBranch(chat, "answer-2", "answer-1");
  expect(deleteBranchMessage(chat, "answer-1")).toBe(true);
  expect(chat.messages.map((item) => item.id)).toEqual([
    "question",
    "answer-2",
  ]);
  expect(branchMessages(chat).map((item) => item.id)).toEqual([
    "question",
    "answer-2",
  ]);
  expect(Object.values(chat.branchSelections ?? {})).not.toContain("follow-up");
  deleteBranchMessage(chat, "question");
  expect(chat.messages).toEqual([]);
  expect(chat.messageBranches).toEqual([]);
  expect(chat.branchSelections).toEqual({});
});

test("fork remaps every node and selection without sharing editable metadata", () => {
  const chat = session();
  chat.messages[1].reasoning = "private reasoning";
  chat.messages[1].tools = [
    {
      id: "tool",
      function: { name: "lookup", arguments: '{"q":"first"}' },
      isError: false,
    },
  ];
  createAnswerBranch(chat, "question", message("answer-2", "assistant"));
  let serial = 0;
  const fork = {
    ...chat,
    ...cloneBranchMessages(chat, () => `copy-${++serial}`),
  };
  const all = branchMessages(fork);
  const ids = new Set(all.map((item) => item.id));
  expect(all.every((item) => !item.parentId || ids.has(item.parentId))).toBe(
    true,
  );
  expect(
    Object.values(fork.branchSelections ?? {}).every((id) => ids.has(id)),
  ).toBe(true);
  const copiedOriginal = all.find((item) => item.content === "answer-1")!;
  expect(copiedOriginal.reasoning).toBe("private reasoning");
  copiedOriginal.tools![0].function!.arguments = '{"q":"second"}';
  expect(
    branchMessages(chat).find((item) => item.id === "answer-1")?.tools?.[0]
      .function?.arguments,
  ).toBe('{"q":"first"}');
  selectAnswerBranch(fork, fork.messages[1].id, copiedOriginal.id);
  expect(fork.messages.map((item) => item.content)).toEqual([
    "question",
    "answer-1",
    "follow-up",
    "follow-up-answer",
  ]);
});

test("serialized state retains archived answers and their selected continuations", () => {
  const chat = session();
  createAnswerBranch(chat, "question", message("answer-2", "assistant"));
  const restored: ChatSession = JSON.parse(JSON.stringify(chat));
  expect(selectAnswerBranch(restored, "answer-2", "answer-1")).toBe(true);
  expect(restored.messages.at(-1)?.id).toBe("follow-up-answer");
});

test("body updates reuse normalized metadata across shallow session copies", () => {
  const chat = session();
  createAnswerBranch(chat, "question", message("answer-2", "assistant"));
  const next = { ...chat, messages: chat.messages.slice() };
  const active = next.messages;
  const archived = next.messageBranches;
  const selections = next.branchSelections;
  next.messages[1].content = "Streaming body";
  const sorting = jest.spyOn(Array.prototype, "sort");
  try {
    synchronizeBranches(next, chat);
    const state = {};
    answerBranches(next, "answer-2", state);
    answerBranches(next, "answer-2", state);
    expect(sorting).not.toHaveBeenCalled();
  } finally {
    sorting.mockRestore();
  }
  expect(next.messages).toBe(active);
  expect(next.messageBranches).toBe(archived);
  expect(next.branchSelections).toBe(selections);
  expect(branchMessages(next).find((item) => item.id === "answer-2")).toBe(
    next.messages[1],
  );
});

test("visible answer queries validate structure only once per store snapshot", () => {
  const chat = session();
  createAnswerBranch(chat, "question", message("answer-2", "assistant"));
  const archived = chat.messageBranches![0];
  const order = archived.branchOrder;
  let reads = 0;
  Object.defineProperty(archived, "branchOrder", {
    configurable: true,
    get() {
      reads++;
      return order;
    },
  });
  const state = {};
  answerBranches(chat, "answer-2", state);
  expect(reads).toBeGreaterThan(0);
  reads = 0;
  answerBranches(chat, "answer-2", state);
  branchBusy(chat, state);
  answerBranches(chat, "question", state);
  expect(reads).toBe(0);
});

test("new store snapshots detect in-place parent and order changes", () => {
  const chat = session();
  createAnswerBranch(chat, "question", message("answer-2", "assistant"));
  expect(answerBranches(chat, "answer-2", {})).toMatchObject({ total: 2 });
  const original = chat.messageBranches!.find(
    (item) => item.id === "answer-1",
  )!;
  original.parentId = "different-question";
  expect(answerBranches(chat, "answer-2", {})).toEqual({
    index: 0,
    total: 1,
    messageIds: ["answer-2"],
  });
  original.parentId = "question";
  original.branchOrder = chat.messages[1].branchOrder! + 1;
  expect(answerBranches(chat, "answer-2", {})).toEqual({
    index: 0,
    total: 2,
    messageIds: ["answer-2", "answer-1"],
  });
});

test("replacement messages and restored sessions never retain stale objects", () => {
  const chat = session();
  createAnswerBranch(chat, "question", message("answer-2", "assistant"));
  answerBranches(chat, "answer-2", {});
  const replacement = {
    ...chat.messages[1],
    content: "Replacement content",
  };
  chat.messages[1] = replacement;
  answerBranches(chat, "answer-2", {});
  expect(branchMessages(chat).find((item) => item.id === replacement.id)).toBe(
    replacement,
  );
  const restored: ChatSession = JSON.parse(JSON.stringify(chat));
  restored.messageBranches = [];
  expect(answerBranches(restored, "answer-2", {})).toMatchObject({ total: 1 });
  expect(answerBranches(chat, "answer-2", {})).toMatchObject({ total: 2 });
});

test("querying an imported path does not skip its first normalization", () => {
  const chat = session();
  chat.messageBranches = [];
  chat.messages[1].parentId = "stale-imported-parent";
  answerBranches(chat, "answer-1", {});
  synchronizeBranches(chat);
  expect(chat.messages[1].parentId).toBe("question");
  expect(chat.messages.every((item) => item.branchOrder !== undefined)).toBe(
    true,
  );
  chat.branchSelections!.missing = "missing-answer";
  synchronizeBranches(chat);
  expect(chat.branchSelections).not.toHaveProperty("missing");
});

test("editing the first question preserves and restores both complete paths", () => {
  const chat = session();
  const edited = message("edited-question", "user", "Edited question");
  expect(
    createEditedMessageBranch(
      chat,
      "question",
      edited,
      message("edited-answer", "assistant"),
    ),
  ).toBe(true);
  expect(chat.messages.map((item) => item.id)).toEqual([
    "edited-question",
    "edited-answer",
  ]);
  expect(answerBranches(chat, edited.id)).toEqual({
    index: 1,
    total: 2,
    messageIds: ["question", "edited-question"],
  });
  selectAnswerBranch(chat, edited.id, "question");
  expect(chat.messages.map((item) => item.id)).toEqual([
    "question",
    "answer-1",
    "follow-up",
    "follow-up-answer",
  ]);
  selectAnswerBranch(chat, "question", edited.id);
  expect(chat.messages.at(-1)?.id).toBe("edited-answer");
  deleteBranchMessage(chat, edited.id);
  expect(chat.messages.map((item) => item.id)).toEqual([
    "question",
    "answer-1",
    "follow-up",
    "follow-up-answer",
  ]);
});

test("an edited follow-up stays attached to its selected answer", () => {
  const chat = session();
  createAnswerBranch(chat, "question", message("answer-2", "assistant"));
  selectAnswerBranch(chat, "answer-2", "answer-1");
  createEditedMessageBranch(
    chat,
    "follow-up",
    message("edited-follow-up", "user"),
    message("edited-follow-up-answer", "assistant"),
  );
  expect(chat.messages[2].parentId).toBe("answer-1");
  selectAnswerBranch(chat, "answer-1", "answer-2");
  selectAnswerBranch(chat, "answer-2", "answer-1");
  expect(chat.messages.at(-1)?.id).toBe("edited-follow-up-answer");
  selectAnswerBranch(chat, "edited-follow-up", "follow-up");
  expect(chat.messages.at(-1)?.id).toBe("follow-up-answer");
  const restored: ChatSession = JSON.parse(JSON.stringify(chat));
  selectAnswerBranch(restored, "follow-up", "edited-follow-up");
  expect(restored.messages.at(-1)?.id).toBe("edited-follow-up-answer");
});
