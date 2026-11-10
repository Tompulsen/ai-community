import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

function reply(id: number | null) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        config: { newApiEnabled: true },
        session: {
          authenticated: id !== null,
          user: id === null ? null : { id },
          selectedTokenId: id === null ? null : 100,
        },
      },
    }),
  } as Response;
}

beforeEach(() => {
  jest.resetModules();
  jest.mocked(fetch).mockReset();
  delete window.__octopusWorkspaceBootstrap;
  delete window.__octopusWorkspaceEpoch;
});

afterEach(() => {
  jest.useRealTimers();
});

function stalledBody(signal: AbortSignal) {
  return {
    ok: true,
    json: () =>
      new Promise((_, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }),
  } as Response;
}

test("the startup deadline aborts a stalled body after headers arrive", async () => {
  jest.useFakeTimers();
  const api = await import("../app/utils/workspace-bootstrap");
  let signal!: AbortSignal;
  jest.mocked(fetch).mockImplementationOnce(async (_, options) => {
    signal = options!.signal!;
    return stalledBody(signal);
  });
  const loading = api.loadWorkspaceBootstrap();
  const rejected = expect(loading).rejects.toMatchObject({ name: "AbortError" });
  await jest.advanceTimersByTimeAsync(14999);
  expect(signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(window.__octopusWorkspaceBootstrap).toBeUndefined();
  expect(jest.getTimerCount()).toBe(0);
});

test("a prefetched response keeps its original deadline while its body is read", async () => {
  jest.useFakeTimers();
  const api = await import("../app/utils/workspace-bootstrap");
  let signal!: AbortSignal;
  const earlyWindow: Record<string, unknown> = {
    location: { pathname: "/" },
    addEventListener() {},
  };
  runInNewContext(
    readFileSync(resolve("public/workspace-bootstrap.v1.js"), "utf8"),
    {
      window: earlyWindow, AbortController, Date, setTimeout, clearTimeout,
      fetch: async (_: string, options: RequestInit) => {
        signal = options.signal!;
        return stalledBody(signal);
      },
    },
  );
  window.__octopusWorkspaceBootstrap =
    earlyWindow.__octopusWorkspaceBootstrap as Window["__octopusWorkspaceBootstrap"];
  await jest.advanceTimersByTimeAsync(14000);
  const loading = api.loadWorkspaceBootstrap();
  const rejected = expect(loading).rejects.toMatchObject({ name: "AbortError" });
  await jest.advanceTimersByTimeAsync(999);
  expect(signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await rejected;
  expect(fetch).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test("a successfully decoded body clears its startup timer", async () => {
  jest.useFakeTimers();
  const api = await import("../app/utils/workspace-bootstrap");
  jest.mocked(fetch).mockResolvedValueOnce(reply(7));
  expect((await api.loadWorkspaceBootstrap()).session.user?.id).toBe(7);
  expect(jest.getTimerCount()).toBe(0);
});

test("reuses the early verified response and consumes its session once", async () => {
  window.__octopusWorkspaceBootstrap = {
    startedAt: Date.now(),
    response: Promise.resolve(reply(7)),
  };
  const api = await import("../app/utils/workspace-bootstrap");
  const revision = api.getWorkspaceBootstrapRevision();
  const data = await api.loadWorkspaceBootstrap();
  api.rememberWorkspaceBootstrap(data, revision);
  expect(api.consumeWorkspaceConfig()).toEqual({ newApiEnabled: true });
  expect(api.consumeWorkspaceConfig()).toBeUndefined();
  expect(api.peekWorkspaceSession()).toBe(data.session);
  expect(api.peekWorkspaceSession()).toBe(data.session);
  expect(api.consumeWorkspaceSession()?.user?.id).toBe(7);
  expect(api.peekWorkspaceSession()).toBeUndefined();
  expect(api.consumeWorkspaceSession()).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

test("refetches when an account notification arrives while awaiting the early response", async () => {
  let release!: (response: Response) => void;
  const cancel = jest.fn();
  window.__octopusWorkspaceBootstrap = {
    startedAt: Date.now(),
    response: new Promise((resolve) => (release = resolve)),
    cancel,
  };
  const api = await import("../app/utils/workspace-bootstrap");
  const pending = api.loadWorkspaceBootstrap();
  api.discardWorkspaceSession();
  expect(cancel).toHaveBeenCalledTimes(1);
  jest.mocked(fetch).mockResolvedValueOnce(reply(8));
  release(reply(7));
  expect((await pending).session.user?.id).toBe(8);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a late head script does not restart an already initialized workspace", () => {
  const fetch = jest.fn();
  runInNewContext(
    readFileSync(resolve("public/workspace-bootstrap.v1.js"), "utf8"),
    {
      window: { location: { pathname: "/" }, __octopusWorkspaceStarted: true },
      fetch,
    },
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("the embedded workspace waits for its authenticated handshake instead of prefetching", () => {
  const fetch = jest.fn();
  const earlyWindow: Record<string, unknown> = {
    location: { pathname: "/studio/community-embed" },
  };
  runInNewContext(
    readFileSync(resolve("public/workspace-bootstrap.v1.js"), "utf8"),
    { window: earlyWindow, fetch },
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(earlyWindow.__octopusWorkspaceBootstrap).toBeUndefined();
  expect(earlyWindow.__octopusWorkspaceStarted).toBeUndefined();
});

test("invalidates a consumed response and saved session on early cross-tab events", async () => {
  const api = await import("../app/utils/workspace-bootstrap");
  jest.mocked(fetch).mockResolvedValueOnce(reply(7));
  const revision = api.getWorkspaceBootstrapRevision();
  const data = await api.loadWorkspaceBootstrap();
  api.rememberWorkspaceBootstrap(data, revision);
  window.__octopusWorkspaceEpoch = 1;
  expect(api.isWorkspaceBootstrapCurrent(data)).toBe(false);
  expect(api.peekWorkspaceSession()).toBeUndefined();
  expect(api.consumeWorkspaceSession()).toBeUndefined();
});

test("does not accept an identity changed while response JSON was being decoded", async () => {
  const api = await import("../app/utils/workspace-bootstrap");
  jest
    .mocked(fetch)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => {
        api.discardWorkspaceSession();
        return await reply(7).json();
      },
    } as Response)
    .mockResolvedValueOnce(reply(8));
  expect((await api.loadWorkspaceBootstrap()).session.user?.id).toBe(8);
});

test.each([
  { authenticated: true, user: { id: -1 } },
  { authenticated: false, user: { id: 7 } },
  { authenticated: true, user: { id: 7 }, selectedTokenId: "100" },
])("rejects malformed identity %#", async (session) => {
  const api = await import("../app/utils/workspace-bootstrap");
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      success: true,
      data: { config: { newApiEnabled: true }, session },
    }),
  } as Response);
  await expect(api.loadWorkspaceBootstrap()).rejects.toThrow();
});

test("the head script subscribes before fetch and marks pending data stale", () => {
  const order: string[] = [];
  let message!: (event: { data: { type: string } }) => void;
  let storage!: (event: { key: string }) => void;
  const earlyWindow: Record<string, unknown> = {
    location: { pathname: "/" },
    BroadcastChannel: true,
    addEventListener: (_: string, listener: typeof storage) => {
      order.push("storage");
      storage = listener;
    },
  };
  class Channel {
    addEventListener(_: string, listener: typeof message) {
      order.push("channel");
      message = listener;
    }
  }
  runInNewContext(
    readFileSync(resolve("public/workspace-bootstrap.v1.js"), "utf8"),
    {
      window: earlyWindow,
      BroadcastChannel: Channel,
      AbortController,
      setTimeout: () => 1,
      clearTimeout: () => {},
      fetch: () => {
        order.push("fetch");
        return Promise.resolve(reply(7));
      },
    },
  );
  expect(order).toEqual(["storage", "channel", "fetch"]);
  message({ data: { type: "session-changed" } });
  expect(earlyWindow.__octopusWorkspaceEpoch).toBe(1);
  expect(
    (earlyWindow.__octopusWorkspaceBootstrap as { invalidated: boolean })
      .invalidated,
  ).toBe(true);
  storage({ key: "octopus-new-api-session" });
  expect(earlyWindow.__octopusWorkspaceEpoch).toBe(2);
});
