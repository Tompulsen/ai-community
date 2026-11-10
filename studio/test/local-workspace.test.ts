import { jest } from "@jest/globals";
import {
  createDeferredWriteQueue,
  createLatestWriteQueue,
} from "../app/utils/latest-write-queue";

const response = (data: unknown, ok = true) =>
  ({ ok, json: async () => data }) as Response;
const bootstrap = (id: number | null, enabled = true) =>
  response({
    success: true,
    data: {
      config: { newApiEnabled: enabled },
      session: {
        authenticated: id !== null,
        user: id ? { id } : null,
        selectedTokenId: id ? 100 : null,
      },
    },
  });

beforeEach(() => {
  localStorage.clear();
  delete window.__octopusWorkspaceBootstrap;
  delete window.__octopusWorkspaceEpoch;
  jest.resetModules();
  jest.mocked(fetch).mockReset();
});

test("maintenance waits for coalesced writes and prevents stale data after import", async () => {
  jest.mocked(fetch).mockResolvedValueOnce(bootstrap(null, false));
  const workspace = await import("../app/utils/local-workspace");
  await workspace.initializeLocalWorkspace();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  let saved = "";
  const queue = createLatestWriteQueue((write: () => Promise<void>) => write());
  const save = (value: string) =>
    workspace.persistLocalWrite(async () => {
      if (value === "first") {
        started();
        await blocked;
      }
      saved = value;
    }, queue);
  const first = save("first");
  await active;
  const latest = save("latest");
  let ready = false;
  const maintenance = workspace.beginLocalMaintenance().then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  release();
  await Promise.all([first, latest, maintenance]);
  expect(saved).toBe("latest");
  saved = "imported";
  workspace.endLocalMaintenance();
  await Promise.resolve();
  expect(saved).toBe("imported");
});

test("maintenance drains a previously accepted streaming checkpoint before importing", async () => {
  jest.useFakeTimers();
  jest.mocked(fetch).mockResolvedValueOnce(bootstrap(7));
  const workspace = await import("../app/utils/local-workspace");
  await workspace.initializeLocalWorkspace();
  const queue = createDeferredWriteQueue(
    (write: () => Promise<void>) => write(),
    250,
  );
  let saved = "";
  const checkpoint = workspace.persistLocalWrite(async () => {
    saved = "Last received tokens";
  }, queue);
  let ready = false;
  const maintenance = workspace.beginLocalMaintenance().then(() => {
    ready = true;
  });
  try {
    await jest.advanceTimersByTimeAsync(249);
    expect(ready).toBe(false);
    expect(saved).toBe("");
    await jest.advanceTimersByTimeAsync(1);
    await Promise.all([checkpoint, maintenance]);
    expect(saved).toBe("Last received tokens");
    expect(workspace.isLocalWorkspaceActive()).toBe(false);
    saved = "Imported history";
    workspace.endLocalMaintenance();
    await jest.advanceTimersByTimeAsync(1000);
    expect(saved).toBe("Imported history");
  } finally {
    workspace.endLocalMaintenance();
    jest.useRealTimers();
  }
});

test("maintenance rejects new writes while an accepted checkpoint drains", async () => {
  jest.mocked(fetch).mockResolvedValueOnce(bootstrap(7));
  const workspace = await import("../app/utils/local-workspace");
  await workspace.initializeLocalWorkspace();
  const queue = createDeferredWriteQueue(
    (write: () => Promise<void>) => write(),
    250,
  );
  const accepted = jest.fn<() => Promise<void>>(async () => {});
  const checkpoint = workspace.persistLocalWrite(accepted, queue);
  const maintenance = workspace.beginLocalMaintenance();
  const rejected = jest.fn<() => Promise<void>>(async () => {});
  const enqueue = jest.fn<() => Promise<void>>(async () => {});
  await workspace.persistLocalWrite(rejected, enqueue);
  expect(enqueue).not.toHaveBeenCalled();
  expect(rejected).not.toHaveBeenCalled();
  await queue.flush();
  await Promise.all([checkpoint, maintenance]);
  expect(accepted).toHaveBeenCalledTimes(1);
  workspace.endLocalMaintenance();
});

test.each(["identity", "revision", "foreign maintenance"] as const)(
  "accepted checkpoints cannot write after an account %s change",
  async (changed) => {
    jest.useFakeTimers();
    jest.mocked(fetch).mockResolvedValueOnce(bootstrap(7));
    const workspace = await import("../app/utils/local-workspace");
    await workspace.initializeLocalWorkspace();
    const queue = createDeferredWriteQueue(
      (write: () => Promise<void>) => write(),
      250,
    );
    const save = jest.fn<() => Promise<void>>(async () => {});
    const checkpoint = workspace.persistLocalWrite(save, queue);
    try {
      if (changed === "identity") workspace.confirmLocalIdentity(8);
      if (changed === "revision")
        localStorage.setItem(
          workspace.localKey("data-revision"),
          "newer-revision",
        );
      if (changed === "foreign maintenance")
        localStorage.setItem(
          workspace.localKey("data-maintenance"),
          JSON.stringify({ id: "other-tab", expires: Date.now() + 600000 }),
        );
      await queue.flush();
      await checkpoint;
      expect(save).not.toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  },
);

test("storage quota errors still release the maintenance lease", async () => {
  jest.mocked(fetch).mockResolvedValueOnce(bootstrap(null, false));
  const workspace = await import("../app/utils/local-workspace");
  await workspace.initializeLocalWorkspace();
  await workspace.beginLocalMaintenance();
  const original = Storage.prototype.setItem;
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const write = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key, value) {
      if (key === "data-revision")
        throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, key, value);
    });
  expect(() => workspace.endLocalMaintenance(true)).not.toThrow();
  expect(localStorage.getItem("data-maintenance")).toBeNull();
  expect(workspace.isLocalWorkspaceActive()).toBe(false);
  write.mockRestore();
  warn.mockRestore();
});

test("binds account-owned keys without changing legacy keys", async () => {
  jest.mocked(fetch).mockResolvedValueOnce(bootstrap(7));
  const workspace = await import("../app/utils/local-workspace");
  expect(await workspace.initializeLocalWorkspace()).toBe("user-7");
  expect(workspace.localKey("chat")).toBe("octopus:user-7:chat");
  expect(workspace.localKey("chat", "user-8")).not.toBe(
    workspace.localKey("chat"),
  );
  expect(workspace.localKey("chat", "legacy")).toBe("chat");
});

test("fails closed when a newer confirmed account races a stale startup response", async () => {
  let resolve!: (value: Response) => void;
  jest.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const workspace = await import("../app/utils/local-workspace");
  const loading = workspace.initializeLocalWorkspace();
  await Promise.resolve();
  await Promise.resolve();
  workspace.confirmLocalIdentity(8);
  jest.mocked(fetch).mockResolvedValueOnce(bootstrap(7));
  resolve(bootstrap(7));
  await expect(loading).rejects.toThrow("登录身份已变化");
  expect(() => workspace.getLocalScope()).toThrow();
});

test("never overwrites a newer confirmed token with startup session data", async () => {
  let resolve!: (value: Response) => void;
  jest.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const workspace = await import("../app/utils/local-workspace");
  const loading = workspace.initializeLocalWorkspace();
  await Promise.resolve();
  await Promise.resolve();
  workspace.confirmLocalToken(200);
  jest.mocked(fetch).mockResolvedValueOnce(bootstrap(7));
  resolve(bootstrap(7));
  await loading;
  expect(workspace.getLocalTokenId()).toBe(200);
});

test("identity failure never falls back to shared history", async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response({ success: false }, false));
  const workspace = await import("../app/utils/local-workspace");
  await expect(workspace.initializeLocalWorkspace()).rejects.toThrow();
  expect(() => workspace.getLocalScope()).toThrow();
});

test("maintenance freezes callbacks and waits for pending storage commits", async () => {
  const workspace = await import("../app/utils/local-workspace");
  jest.mocked(fetch).mockResolvedValueOnce(bootstrap(null, false));
  await workspace.initializeLocalWorkspace();
  let done!: () => void;
  workspace.trackLocalWrite(
    new Promise<void>((resolve) => {
      done = resolve;
    }),
  );
  let finished = false;
  const maintenance = workspace.beginLocalMaintenance().then(() => {
    finished = true;
  });
  expect(workspace.isLocalWorkspaceActive()).toBe(false);
  await Promise.resolve();
  expect(finished).toBe(false);
  done();
  await maintenance;
  workspace.endLocalMaintenance();
  expect(workspace.isLocalWorkspaceActive()).toBe(true);
});
