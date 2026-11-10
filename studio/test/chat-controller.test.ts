/** @jest-environment node */
import { jest } from "@jest/globals";

const forgetTask = jest.fn();
jest.unstable_mockModule("@/app/utils/local-tasks", () => ({ forgetTask }));
const { ChatControllerPool } = await import("../app/client/controller");

beforeEach(() => {
  ChatControllerPool.stopAll();
  forgetTask.mockClear();
});

test("stopping a session aborts only its requests and releases its task records", () => {
  const first = new AbortController();
  const second = new AbortController();
  const other = new AbortController();
  ChatControllerPool.addController("session", "first", first);
  ChatControllerPool.addController("session", "second", second);
  ChatControllerPool.addController("session-other", "first", other);

  ChatControllerPool.stopSession("session");

  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(true);
  expect(other.signal.aborted).toBe(false);
  expect(Object.keys(ChatControllerPool.controllers)).toEqual([
    "session-other,first",
  ]);
  expect(forgetTask.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
});

test("stopping one message preserves other requests in the same session", () => {
  const removed = new AbortController();
  const retained = new AbortController();
  ChatControllerPool.addController("session", "removed", removed);
  ChatControllerPool.addController("session", "retained", retained);

  ChatControllerPool.stop("session", "removed");

  expect(removed.signal.aborted).toBe(true);
  expect(retained.signal.aborted).toBe(false);
  expect(ChatControllerPool.hasPending()).toBe(true);
  ChatControllerPool.stopSession("session");
  expect(ChatControllerPool.hasPending()).toBe(false);
});

test("pending snapshots follow the requested session and notify every lifecycle change", () => {
  const snapshots: boolean[][] = [];
  const unsubscribe = ChatControllerPool.subscribe(() => {
    snapshots.push([
      ChatControllerPool.hasPending("session"),
      ChatControllerPool.hasPending("session-other"),
    ]);
  });
  try {
    ChatControllerPool.addController("session", "first", new AbortController());
    ChatControllerPool.addController(
      "session-other",
      "first",
      new AbortController(),
    );
    ChatControllerPool.remove("session", "first");
    ChatControllerPool.stopAll();
    expect(snapshots).toEqual([
      [true, false],
      [true, true],
      [false, true],
      [false, false],
    ]);
  } finally {
    unsubscribe();
  }
  ChatControllerPool.addController("session", "later", new AbortController());
  expect(snapshots).toHaveLength(4);
});

test("stopping output can preserve resumable tasks without stopping another session", () => {
  const first = new AbortController();
  const second = new AbortController();
  const other = new AbortController();
  ChatControllerPool.addController("session", "first", first);
  ChatControllerPool.addController("session", "second", second);
  ChatControllerPool.addController("session-other", "first", other);
  const notify = jest.fn();
  const unsubscribe = ChatControllerPool.subscribe(notify);
  try {
    ChatControllerPool.stopSession("session", { preserveTasks: true });
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    expect(forgetTask).not.toHaveBeenCalled();
    expect(ChatControllerPool.hasPending("session")).toBe(false);
    expect(ChatControllerPool.hasPending("session-other")).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
  }
});
