import { jest } from "@jest/globals";
import { createMemoryKeyvalStore } from "./mocks/memory-keyval-store";

const records = new Map<string, unknown>();
const read = jest.fn<(key: string) => Promise<unknown>>();
const atomicWrite =
  jest.fn<(entries: [IDBValidKey, unknown][]) => Promise<void>>();
const atomicDelete = jest.fn<(keys: IDBValidKey[]) => Promise<void>>();
const remove = jest.fn<(key: string) => Promise<void>>();
const toast = jest.fn();
const writes = new Set<Promise<unknown>>();
const transactions = createMemoryKeyvalStore(records, {
  write: atomicWrite,
  remove: atomicDelete,
});
let active = true;
let owner = "user-7";
jest.unstable_mockModule("idb-keyval", () => ({
  get: read,
  set: async (key: string, value: unknown) => records.set(key, value),
  createStore: () => transactions,
  del: remove,
  delMany: atomicDelete,
  clear: async () => records.clear(),
}));
jest.unstable_mockModule("@/app/utils", () => ({
  safeLocalStorage: () => localStorage,
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: toast,
}));
const track = (promise: Promise<unknown>) => {
  writes.add(promise);
  void promise.finally(() => writes.delete(promise)).catch(() => {});
  return promise;
};
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  initializeLocalWorkspace: async () => owner,
  localKey: (key: string, scope = owner) => `octopus:${scope}:${key}`,
  isLocalWorkspaceActive: () => active,
  persistLocalWrite: (
    action: () => Promise<void>,
    enqueue?: (write: () => Promise<void>) => Promise<void>,
  ) =>
    active ? track(enqueue ? enqueue(action) : action()) : Promise.resolve(),
  trackLocalWrite: track,
}));
const {
  hasDeferredChatAssets,
  loadChatSessionAssets,
  readChatSnapshot,
  restoreChatAssets,
  writeChatSnapshot,
  removeChatSnapshot,
} = await import("../app/utils/chat-persistence");
const { createPersistStore } = await import("../app/utils/store");
const { StoreKey } = await import("../app/constant");
const name = `octopus:user-7:${StoreKey.Chat}`;
const attachment = `data:video/mp4;base64,${"A".repeat(
  Math.ceil((10 * 1024 * 1024) / 3) * 4,
)}`;
const snapshot = (payload = attachment) => ({
  version: 3.5,
  state: {
    _hasHydrated: true,
    sessions: [
      {
        id: "chat",
        messages: [
          {
            content: [{ type: "video_url", video_url: { url: payload } }],
            composerInput: {
              text: "Review this video",
              files: [{ name: "video.mp4", content: payload }],
            },
          },
        ],
      },
    ],
  },
});
async function settle() {
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
}
function pause() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function createChat() {
  return createPersistStore(
    {
      sessions: [{ messages: [{ content: "", streaming: false }] }],
    },
    (set) => ({
      append(content: string, streaming = true) {
        set({ sessions: [{ messages: [{ content, streaming }] }] });
      },
    }),
    { name: StoreKey.Chat, version: 3.5 },
  );
}
beforeEach(() => {
  jest.useFakeTimers();
  records.clear();
  read.mockReset().mockImplementation(async (key) => records.get(key));
  localStorage.clear();
  writes.clear();
  active = true;
  owner = "user-7";
  toast.mockClear();
  atomicWrite.mockReset().mockResolvedValue(undefined);
  atomicDelete.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockImplementation(async (key) => {
    await atomicDelete([key]);
  });
});
afterEach(() => jest.useRealTimers());

test("stores a large duplicated video once and restores the exact transport fields", async () => {
  const original = snapshot();
  await writeChatSnapshot(name, original);
  const raw = String(records.get(name));
  expect(raw.length).toBeLessThan(2000);
  expect(raw).not.toContain(attachment.slice(0, 100));
  expect(
    [...records.keys()].filter((key) => key.startsWith(`${name}:asset:`)),
  ).toHaveLength(1);
  expect(await readChatSnapshot(name)).toEqual(original);
  expect(
    original.state.sessions[0].messages[0].composerInput.files[0].content,
  ).toBe(attachment);
  await writeChatSnapshot(name, original);
  expect(atomicWrite.mock.calls.at(-1)?.[0]).toHaveLength(1);
});

test("reads old inline snapshots without changing their version or content", async () => {
  const original = snapshot();
  records.set(name, JSON.stringify(original));
  expect(await readChatSnapshot(name)).toEqual(original);
  expect(atomicWrite).not.toHaveBeenCalled();
});

test("projects and conversation assignments round-trip within their owning account", async () => {
  const project = { id: "project-1", name: "Research", createdAt: 1 };
  const original = {
    ...snapshot("Small attachment"),
    version: 3.6,
    state: {
      ...snapshot("Small attachment").state,
      projects: [project],
      sessions: [
        {
          ...snapshot("Small attachment").state.sessions[0],
          projectId: project.id,
        },
      ],
    },
  };
  await writeChatSnapshot(name, original);
  const other = `octopus:user-8:${StoreKey.Chat}`;
  await writeChatSnapshot(other, {
    version: 3.6,
    state: { _hasHydrated: true, sessions: [], projects: [] },
  });
  expect(await readChatSnapshot(name)).toEqual(original);
  expect((await readChatSnapshot(other))?.state.projects).toEqual([]);
  expect((await readChatSnapshot(name))?.state.sessions[0].projectId).toBe(
    project.id,
  );
});

test("externalizes generated image Markdown and raw audio without interpreting bytes", async () => {
  const original = snapshot(
    "![Generated Image](data:image/png;base64," + "A".repeat(100000) + ")",
  );
  const audio = "A".repeat(100000);
  (original.state as Record<string, unknown>).audio = {
    data: audio,
    format: "wav",
  };
  await writeChatSnapshot(name, original);
  expect(String(records.get(name)).length).toBeLessThan(2500);
  expect(await readChatSnapshot(name)).toEqual(original);
});

test("account scoped asset keys cannot read another account's payload", async () => {
  await writeChatSnapshot(name, snapshot());
  const other = `octopus:user-8:${StoreKey.Chat}`;
  records.set(other, records.get(name));
  await expect(readChatSnapshot(other)).rejects.toThrow(
    "attachment is missing",
  );
  expect(await readChatSnapshot(name)).toEqual(snapshot());
});

test("failed atomic writes leave the previous chat and assets intact", async () => {
  await writeChatSnapshot(name, snapshot());
  const before = new Map(records);
  atomicWrite.mockRejectedValueOnce(new Error("QuotaExceededError"));
  await expect(
    writeChatSnapshot(name, snapshot(`${attachment}B`)),
  ).rejects.toThrow("QuotaExceededError");
  expect(records).toEqual(before);
  expect(await readChatSnapshot(name)).toEqual(snapshot());
  expect(localStorage.getItem(name)).toBeNull();
});

test("failed atomic deletion preserves the previous snapshot and its attachments", async () => {
  await writeChatSnapshot(name, snapshot());
  const before = new Map(records);
  const raw = String(records.get(name));
  localStorage.setItem(name, raw);
  localStorage.setItem(`${name}:local-storage-fallback`, "existing-fallback");
  atomicDelete.mockRejectedValueOnce(new Error("IndexedDB unavailable"));
  await expect(removeChatSnapshot(name)).rejects.toThrow(
    "IndexedDB unavailable",
  );
  expect(records).toEqual(before);
  expect(localStorage.getItem(name)).toBe(raw);
  expect(localStorage.getItem(`${name}:local-storage-fallback`)).toBe(
    "existing-fallback",
  );
  expect(await readChatSnapshot(name)).toEqual(snapshot());
});

test("missing attachment reads fail without replacing the committed snapshot", async () => {
  await writeChatSnapshot(name, snapshot());
  const asset = [...records.keys()].find((key) =>
    key.startsWith(`${name}:asset:`),
  )!;
  records.delete(asset);
  const raw = records.get(name);
  await expect(readChatSnapshot(name)).rejects.toThrow("attachment is missing");
  expect(records.get(name)).toBe(raw);
});

test("a snapshot replaced during attachment reads retries the newer committed version", async () => {
  await writeChatSnapshot(name, snapshot());
  const reading = readChatSnapshot(name);
  const asset = [...records.keys()].find((key) =>
    key.startsWith(`${name}:asset:`),
  )!;
  records.delete(asset);
  const replacement = snapshot("Newer committed content");
  records.set(name, JSON.stringify(replacement));
  await expect(reading).resolves.toEqual(replacement);
});

test("concurrent replacement cannot retire attachments referenced by a pending snapshot", async () => {
  await writeChatSnapshot(name, snapshot());
  jest.resetModules();
  const secondTab = await import("../app/utils/chat-persistence");
  await secondTab.readChatSnapshot(name);
  const started = pause();
  const commit = pause();
  atomicWrite.mockImplementationOnce(async () => {
    started.release();
    await commit.promise;
  });
  const firstTab = writeChatSnapshot(name, snapshot());
  await started.promise;
  const second = secondTab.writeChatSnapshot(
    name,
    snapshot("Another tab's text"),
  );
  await settle();
  commit.release();
  await Promise.all([firstTab, second]);
  await expect(readChatSnapshot(name)).resolves.toEqual(
    snapshot("Another tab's text"),
  );
});

test("concurrent attachment reuse cannot be removed by an earlier snapshot's cleanup", async () => {
  await writeChatSnapshot(name, snapshot());
  jest.resetModules();
  const secondTab = await import("../app/utils/chat-persistence");
  await secondTab.readChatSnapshot(name);
  const started = pause();
  const cleanup = pause();
  atomicDelete.mockImplementationOnce(async () => {
    started.release();
    await cleanup.promise;
  });
  const first = writeChatSnapshot(name, snapshot("Attachment removed"));
  await started.promise;
  const second = secondTab.writeChatSnapshot(name, snapshot());
  await settle();
  cleanup.release();
  await Promise.all([first, second]);
  await expect(readChatSnapshot(name)).resolves.toEqual(snapshot());
});

test("a queued checkpoint cannot be retargeted to a different account", async () => {
  const store = createChat();
  await settle();
  const previous = records.get(name);
  atomicWrite.mockClear();
  store.getState().append("Belongs to the first account");
  await settle();
  owner = "user-8";
  await jest.advanceTimersByTimeAsync(250);
  await settle();
  expect(atomicWrite).not.toHaveBeenCalled();
  expect(records.get(name)).toBe(previous);
  expect(records.has(`octopus:user-8:${StoreKey.Chat}`)).toBe(false);
});

test("snapshot encoding captures mutable messages before the first async read", async () => {
  const original = snapshot();
  const writing = writeChatSnapshot(name, original);
  original.state.sessions[0].messages[0].composerInput.text = "Changed later";
  await writing;
  expect(
    (await readChatSnapshot(name))?.state.sessions[0].messages[0].composerInput
      .text,
  ).toBe("Review this video");
});

test("replaced and deleted snapshots release only their own unreferenced assets", async () => {
  await writeChatSnapshot(name, snapshot());
  const other = `octopus:user-8:${StoreKey.Chat}`;
  await writeChatSnapshot(other, snapshot());
  await writeChatSnapshot(name, snapshot("Small text"));
  expect(
    [...records.keys()].filter((key) => key.startsWith(`${name}:asset:`)),
  ).toHaveLength(0);
  await removeChatSnapshot(name);
  expect(records.has(name)).toBe(false);
  expect(await readChatSnapshot(other)).toEqual(snapshot());
  await removeChatSnapshot(other);
  expect(records.size).toBe(0);
});

test("many streamed updates checkpoint before serialization and completion flushes immediately", async () => {
  const store = createChat();
  await settle();
  atomicWrite.mockClear();
  const stringify = jest.spyOn(JSON, "stringify");
  for (let index = 0; index < 50; index++) {
    store.getState().append(`Chunk ${index}`);
    await settle();
    await jest.advanceTimersByTimeAsync(4);
  }
  expect(stringify).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(50);
  await settle();
  expect(atomicWrite).toHaveBeenCalledTimes(1);
  expect(stringify).toHaveBeenCalledTimes(1);
  store.getState().append("Finished", false);
  await settle();
  expect((await readChatSnapshot(name))?.state.sessions[0].messages[0]).toEqual(
    { content: "Finished", streaming: false },
  );
  stringify.mockRestore();
  await Promise.all([...writes]);
});

test("a hidden document flushes a queued stream checkpoint", async () => {
  const store = createChat();
  await settle();
  atomicWrite.mockClear();
  store.getState().append("Received before hiding");
  await settle();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
  await settle();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  expect(atomicWrite).toHaveBeenCalledTimes(1);
  expect(
    (await readChatSnapshot(name))?.state.sessions[0].messages[0].content,
  ).toBe("Received before hiding");
});

test("a failed save reports a visible error and permits a later successful retry", async () => {
  const store = createChat();
  await settle();
  const previous = records.get(name);
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  atomicWrite.mockRejectedValueOnce(new Error("QuotaExceededError"));
  store.getState().append("Cannot persist", false);
  await jest.advanceTimersByTimeAsync(0);
  await settle();
  expect(records.get(name)).toBe(previous);
  expect(toast).toHaveBeenCalledTimes(1);
  store.getState().append("Saved after retry", false);
  await settle();
  expect(
    (await readChatSnapshot(name))?.state.sessions[0].messages[0].content,
  ).toBe("Saved after retry");
  error.mockRestore();
});

test("failed attachment hydration reports an error and never saves the empty default", async () => {
  await writeChatSnapshot(name, snapshot());
  const asset = [...records.keys()].find((key) =>
    key.startsWith(`${name}:asset:`),
  )!;
  records.delete(asset);
  const previous = records.get(name);
  atomicWrite.mockClear();
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  const store = createChat();
  await settle();
  expect(store.getState()._hasHydrated).toBe(false);
  expect(atomicWrite).not.toHaveBeenCalled();
  expect(records.get(name)).toBe(previous);
  expect(toast).toHaveBeenCalledTimes(1);
  error.mockRestore();
});

function historySnapshot() {
  const first = snapshot(`data:video/mp4;base64,${"A".repeat(70000)}`);
  const second = snapshot(`data:video/mp4;base64,${"B".repeat(70000)}`);
  second.state.sessions[0].id = "inactive";
  return {
    ...first,
    state: {
      ...first.state,
      currentSessionIndex: 0,
      sessions: [...first.state.sessions, ...second.state.sessions],
      audio: { format: "wav", data: "C".repeat(70000) },
    },
  };
}

function storedSessionAsset(index: number) {
  const stored = JSON.parse(String(records.get(name)));
  return `${name}:asset:${stored.state.sessions[index].messages[0].content[0].video_url.url.__octopusChatAsset}`;
}

test("deferred hydration only reads current-session and non-session payloads", async () => {
  const original = historySnapshot();
  await writeChatSnapshot(name, original);
  const activeAsset = storedSessionAsset(0);
  const inactiveAsset = storedSessionAsset(1);
  read.mockClear();
  const loaded = await readChatSnapshot(name, {
    deferInactiveSessions: true,
  });
  expect(loaded?.state.sessions[0]).toEqual(original.state.sessions[0]);
  expect(loaded?.state.audio).toEqual(original.state.audio);
  expect(hasDeferredChatAssets(loaded?.state.sessions[1])).toBe(true);
  expect(read.mock.calls.map(([key]) => key)).toContain(activeAsset);
  expect(read.mock.calls.map(([key]) => key)).not.toContain(inactiveAsset);
  expect(
    read.mock.calls.filter(([key]) => key.startsWith(`${name}:asset:`)),
  ).toHaveLength(2);
});

test("the store explicitly opts into deferred history hydration", async () => {
  const original = historySnapshot();
  await writeChatSnapshot(name, original);
  const inactiveAsset = storedSessionAsset(1);
  read.mockClear();
  const store = createChat();
  await settle();
  expect(store.getState()._hasHydrated).toBe(true);
  expect(hasDeferredChatAssets(store.getState().sessions[1])).toBe(true);
  expect(read.mock.calls.map(([key]) => key)).not.toContain(inactiveAsset);
});

test("an account change during hydration cannot publish the previous account's chats", async () => {
  await writeChatSnapshot(name, historySnapshot());
  const before = new Map(records);
  const loading = pause();
  read.mockImplementation(async (key) => {
    const value = records.get(key);
    if (key.startsWith(`${name}:asset:`)) await loading.promise;
    return value;
  });
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  const store = createChat();
  await settle();
  owner = "user-8";
  loading.release();
  await settle();
  expect(store.getState()._hasHydrated).toBe(false);
  expect(store.getState().sessions[0].messages[0].content).toBe("");
  expect(records).toEqual(before);
  error.mockRestore();
});

test("pre-3.5 snapshots restore every attachment before migrations", async () => {
  const original = { ...historySnapshot(), version: 3.4 };
  await writeChatSnapshot(name, original);
  const inactiveAsset = storedSessionAsset(1);
  read.mockClear();
  expect(await readChatSnapshot(name, { deferInactiveSessions: true })).toEqual(
    original,
  );
  expect(read.mock.calls.map(([key]) => key)).toContain(inactiveAsset);
});

test("saving a partial snapshot retains unloaded bytes without reading or rewriting them", async () => {
  const original = historySnapshot();
  await writeChatSnapshot(name, original);
  const inactiveAsset = storedSessionAsset(1);
  const payload = records.get(inactiveAsset);
  const partial = (await readChatSnapshot(name, {
    deferInactiveSessions: true,
  }))!;
  partial.state.lastInput = "Changed after startup";
  read.mockClear();
  atomicWrite.mockClear();
  await writeChatSnapshot(name, partial);
  expect(records.get(inactiveAsset)).toBe(payload);
  expect(read.mock.calls).toHaveLength(0);
  expect(
    atomicWrite.mock.calls.flatMap(([entries]) => entries.map(([key]) => key)),
  ).not.toContain(inactiveAsset);
  expect(await readChatSnapshot(name)).toEqual({
    ...original,
    state: { ...original.state, lastInput: "Changed after startup" },
  });
});

test("first access restores only the requested session and default reads remain portable", async () => {
  const original = historySnapshot();
  await writeChatSnapshot(name, original);
  const inactiveAsset = storedSessionAsset(1);
  const partial = (await readChatSnapshot(name, {
    deferInactiveSessions: true,
  }))!;
  read.mockClear();
  const loaded = await loadChatSessionAssets(name, partial.state.sessions[1]);
  expect(read.mock.calls).toEqual([[inactiveAsset, expect.any(Function)]]);
  expect(restoreChatAssets(partial.state.sessions[1], loaded)).toEqual(
    original.state.sessions[1],
  );
  expect(await readChatSnapshot(name)).toEqual(original);
});

test("a missing deferred asset aborts the atomic save without replacing the committed snapshot", async () => {
  await writeChatSnapshot(name, historySnapshot());
  const inactiveAsset = storedSessionAsset(1);
  const partial = (await readChatSnapshot(name, {
    deferInactiveSessions: true,
  }))!;
  records.delete(inactiveAsset);
  const before = new Map(records);
  partial.state.lastInput = "Must not replace the committed snapshot";
  await expect(writeChatSnapshot(name, partial)).rejects.toThrow(
    "attachment is missing",
  );
  expect(records).toEqual(before);
  expect(records.has(inactiveAsset)).toBe(false);
});

test("unloaded references cannot be saved into another account's namespace", async () => {
  await writeChatSnapshot(name, historySnapshot());
  const partial = (await readChatSnapshot(name, {
    deferInactiveSessions: true,
  }))!;
  const before = new Map(records);
  await expect(
    writeChatSnapshot(`octopus:user-8:${StoreKey.Chat}`, partial),
  ).rejects.toThrow("attachment is missing");
  expect(records).toEqual(before);
});

test("deferred sessions still validate references against committed metadata", async () => {
  await writeChatSnapshot(name, historySnapshot());
  const stored = JSON.parse(String(records.get(name)));
  stored.state.sessions[1].messages[0].content[0].video_url.url = {
    __octopusChatAsset: "not-declared-in-metadata",
  };
  records.set(name, JSON.stringify(stored));
  await expect(
    readChatSnapshot(name, { deferInactiveSessions: true }),
  ).rejects.toThrow("Invalid local chat attachment reference");
});

test("inactive metadata such as a large sidebar avatar remains immediately available", async () => {
  const original = historySnapshot();
  const avatar = `data:image/png;base64,${"D".repeat(70000)}`;
  (original.state.sessions[1] as any).mask = { avatar };
  await writeChatSnapshot(name, original);
  expect(
    JSON.parse(String(records.get(name))).state.sessions[1].mask.avatar,
  ).toEqual({ __octopusChatAsset: expect.any(String) });
  const loaded = await readChatSnapshot(name, {
    deferInactiveSessions: true,
  });
  expect(loaded?.state.sessions[1].mask.avatar).toBe(avatar);
  expect(hasDeferredChatAssets(loaded?.state.sessions[1].messages)).toBe(true);
});

test("twenty attachment histories require one payload read at startup instead of twenty", async () => {
  const sessions = Array.from({ length: 20 }, (_, index) => {
    const session = snapshot(
      `data:video/mp4;base64,${"A".repeat(70000)}${index}`,
    ).state.sessions[0];
    session.id = `session-${index}`;
    return session;
  });
  await writeChatSnapshot(name, {
    version: 3.5,
    state: { _hasHydrated: true, currentSessionIndex: 0, sessions },
  });
  read.mockClear();
  await readChatSnapshot(name);
  expect(
    read.mock.calls.filter(([key]) => key.startsWith(`${name}:asset:`)),
  ).toHaveLength(20);
  read.mockClear();
  await readChatSnapshot(name, { deferInactiveSessions: true });
  expect(
    read.mock.calls.filter(([key]) => key.startsWith(`${name}:asset:`)),
  ).toHaveLength(1);
});
