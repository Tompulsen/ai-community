import { jest } from "@jest/globals";
import type { NewApiSession } from "../app/client/new-api";

let tokenId: number | null = null;
const confirmLocalToken = jest.fn((id: number | null) => {
  tokenId = id;
});
jest.unstable_mockModule("@/app/locales", () => ({
  default: { Account: { RequestFailed: "Request failed" } },
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  confirmLocalToken,
  confirmLocalIdentity: jest.fn(),
  getLocalTokenId: () => tokenId,
}));

let client: typeof import("../app/client/new-api");
let bootstrap: typeof import("../app/utils/workspace-bootstrap");
const originalFetch = global.fetch;
const session = (userId = 7, token = 100, quota = 100): NewApiSession => ({
  authenticated: true,
  user: {
    id: userId,
    username: "fixture",
    display_name: "Fixture",
    quota,
    used_quota: 0,
    request_count: 0,
    group: "default",
  },
  selectedTokenId: token,
});
const guest: NewApiSession = {
  authenticated: false,
  user: null,
  selectedTokenId: null,
};
const response = (data: NewApiSession) =>
  ({ ok: true, json: async () => ({ success: true, data }) }) as Response;

beforeEach(async () => {
  jest.resetModules();
  tokenId = null;
  confirmLocalToken.mockClear();
  global.fetch = jest.fn<typeof fetch>().mockResolvedValue(response(session()));
  client = await import("../app/client/new-api");
  bootstrap = await import("../app/utils/workspace-bootstrap");
});
afterEach(() => {
  global.fetch = originalFetch;
});

async function start(data = session()) {
  bootstrap.rememberWorkspaceBootstrap(
    {
      config: { newApiEnabled: true } as DangerConfig,
      session: data,
    },
    bootstrap.getWorkspaceBootstrapRevision(),
  );
  await client.newApiClient.session();
  client.setNewApiExpectedUser(data.user?.id ?? null);
}

test("anonymous startup guidance can read bootstrap before access consumes it", async () => {
  bootstrap.rememberWorkspaceBootstrap(
    { config: { newApiEnabled: true } as DangerConfig, session: guest },
    bootstrap.getWorkspaceBootstrapRevision(),
  );
  expect(client.getInitialAccountReadinessSession()).toBe(guest);
  expect(client.getInitialAccountReadinessSession()).toBe(guest);
  expect(fetch).not.toHaveBeenCalled();
  await expect(client.getAccountReadinessSession(true)).resolves.toBe(guest);
  expect(client.getInitialAccountReadinessSession()).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

test.each([guest, session()])(
  "startup guidance remains available while access confirms bootstrap %j",
  async (initial) => {
    tokenId = initial.selectedTokenId;
    client.setNewApiExpectedUser(initial.user?.id ?? null);
    bootstrap.rememberWorkspaceBootstrap(
      { config: { newApiEnabled: true } as DangerConfig, session: initial },
      bootstrap.getWorkspaceBootstrapRevision(),
    );
    const confirmation = client.newApiClient.session();
    expect(client.getInitialAccountReadinessSession()).toBe(initial);
    const readiness = client.getAccountReadinessSession(true);
    await expect(confirmation).resolves.toBe(initial);
    await expect(readiness).resolves.toBe(initial);
    expect(client.getInitialAccountReadinessSession()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  },
);

test.each(["user", "token", "workspace revision", "route"])(
  "pending startup guidance rejects a changed %s",
  async (changed) => {
    const initial = session();
    tokenId = initial.selectedTokenId;
    client.setNewApiExpectedUser(initial.user!.id);
    bootstrap.rememberWorkspaceBootstrap(
      { config: { newApiEnabled: true } as DangerConfig, session: initial },
      bootstrap.getWorkspaceBootstrapRevision(),
    );
    const confirmation = client.newApiClient.session();
    if (changed === "user") client.setNewApiExpectedUser(8);
    else if (changed === "token") tokenId = 200;
    else if (changed === "workspace revision")
      bootstrap.discardWorkspaceSession();
    else window.dispatchEvent(new Event("hashchange"));
    expect(client.getInitialAccountReadinessSession()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    await confirmation;
  },
);

test("failed bootstrap confirmation clears its pending guidance", async () => {
  bootstrap.rememberWorkspaceBootstrap(
    { config: { newApiEnabled: true } as DangerConfig, session: guest },
    bootstrap.getWorkspaceBootstrapRevision(),
  );
  confirmLocalToken.mockImplementationOnce(() => {
    throw new Error("Local identity unavailable");
  });
  const confirmation = client.newApiClient.session();
  expect(client.getInitialAccountReadinessSession()).toBe(guest);
  await expect(confirmation).rejects.toThrow("Local identity unavailable");
  expect(client.getInitialAccountReadinessSession()).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

test("confirmed startup guidance can be read without consuming its handoff", async () => {
  const initial = session();
  await start(initial);
  expect(client.getInitialAccountReadinessSession()).toBe(initial);
  expect(client.getInitialAccountReadinessSession()).toBe(initial);
  await expect(client.getAccountReadinessSession(true)).resolves.toBe(initial);
  expect(client.getInitialAccountReadinessSession()).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

test.each(["user", "token", "workspace revision", "route"])(
  "the synchronous startup snapshot rejects a changed %s before confirmation",
  async (changed) => {
    const initial = session();
    tokenId = initial.selectedTokenId;
    client.setNewApiExpectedUser(initial.user!.id);
    bootstrap.rememberWorkspaceBootstrap(
      { config: { newApiEnabled: true } as DangerConfig, session: initial },
      bootstrap.getWorkspaceBootstrapRevision(),
    );
    expect(client.getInitialAccountReadinessSession()).toBe(initial);
    if (changed === "user") client.setNewApiExpectedUser(8);
    else if (changed === "token") tokenId = 200;
    else if (changed === "workspace revision")
      bootstrap.discardWorkspaceSession();
    else window.dispatchEvent(new Event("hashchange"));
    expect(client.getInitialAccountReadinessSession()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  },
);

test("an authenticated bootstrap waits until its expected identity is bound", () => {
  tokenId = 100;
  const initial = session();
  bootstrap.rememberWorkspaceBootstrap(
    { config: { newApiEnabled: true } as DangerConfig, session: initial },
    bootstrap.getWorkspaceBootstrapRevision(),
  );
  expect(client.getInitialAccountReadinessSession()).toBeUndefined();
  client.setNewApiExpectedUser(7);
  expect(client.getInitialAccountReadinessSession()).toBe(initial);
  expect(fetch).not.toHaveBeenCalled();
});

test("first readiness consumes verified bootstrap once without a duplicate GET", async () => {
  await start();
  await expect(client.getAccountReadinessSession(true)).resolves.toEqual(
    session(),
  );
  expect(fetch).not.toHaveBeenCalled();
  jest.mocked(fetch).mockResolvedValue(response(session(7, 100, 250)));
  await expect(client.getAccountReadinessSession(true)).resolves.toEqual(
    session(7, 100, 250),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  await client.newApiClient.session();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("concurrent startup consumers share the bootstrap handoff", async () => {
  await start();
  const first = client.getAccountReadinessSession(true);
  const second = client.getAccountReadinessSession(true);
  await expect(Promise.all([first, second])).resolves.toEqual([
    session(),
    session(),
  ]);
  expect(fetch).not.toHaveBeenCalled();
  await client.getAccountReadinessSession(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("readiness arriving during bootstrap confirmation leaves no handoff for a later mount", async () => {
  bootstrap.rememberWorkspaceBootstrap(
    { config: { newApiEnabled: true } as DangerConfig, session: session() },
    bootstrap.getWorkspaceBootstrapRevision(),
  );
  const initial = client.newApiClient.session();
  const readiness = client.getAccountReadinessSession(true);
  await Promise.all([initial, readiness]);
  expect(fetch).not.toHaveBeenCalled();
  client.setNewApiExpectedUser(7);
  await client.getAccountReadinessSession(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("without bootstrap, readiness shares a live request and later reads revalidate", async () => {
  let finish!: (value: Response) => void;
  jest
    .mocked(fetch)
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const readiness = client.getAccountReadinessSession(true);
  const live = client.newApiClient.session();
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(response(session()));
  await Promise.all([readiness, live]);
  await client.getAccountReadinessSession(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each(["user", "token", "workspace revision"])(
  "a changed %s rejects the startup handoff and queries current state",
  async (changed) => {
    await start();
    let current = session();
    if (changed === "user") {
      client.setNewApiExpectedUser(8);
      current = session(8, 800);
    } else if (changed === "token") {
      tokenId = 200;
      current = session(7, 200);
    } else {
      bootstrap.discardWorkspaceSession();
    }
    expect(client.getInitialAccountReadinessSession()).toBeUndefined();
    jest.mocked(fetch).mockResolvedValue(response(current));
    await expect(client.getAccountReadinessSession(true)).resolves.toEqual(
      current,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test("a bridged cross-tab logout invalidates an already claimed bootstrap result", async () => {
  await start();
  const outdated = client.getAccountReadinessSession(true);
  window.dispatchEvent(new Event("new-api-session-changed"));
  client.setNewApiExpectedUser(null);
  jest.mocked(fetch).mockResolvedValue(response(guest));
  const current = client.getAccountReadinessSession();
  await expect(outdated).rejects.toMatchObject({ status: 409 });
  await expect(current).resolves.toEqual(guest);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(tokenId).toBeNull();
});

test("late live responses cannot restore a readiness result after changing keys", async () => {
  client.setNewApiExpectedUser(7);
  let finish!: (value: Response) => void;
  jest
    .mocked(fetch)
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const previous = client.getAccountReadinessSession(true);
  window.dispatchEvent(
    new CustomEvent("new-api-session-changed", {
      detail: { userId: 7, tokenId: 200 },
    }),
  );
  tokenId = 200;
  jest.mocked(fetch).mockResolvedValue(response(session(7, 200)));
  await expect(client.getAccountReadinessSession()).resolves.toEqual(
    session(7, 200),
  );
  finish(response(session()));
  await expect(previous).rejects.toMatchObject({ status: 409 });
  expect(tokenId).toBe(200);
});

test("a failed fresh authentication cannot fall back to the old startup result", async () => {
  await start();
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: async () => ({ success: false, message: "Signed out" }),
  } as Response);
  await expect(client.newApiClient.session()).rejects.toMatchObject({
    status: 401,
  });
  expect(client.getInitialAccountReadinessSession()).toBeUndefined();
  client.setNewApiExpectedUser(null);
  jest.mocked(fetch).mockResolvedValue(response(guest));
  await expect(client.getAccountReadinessSession(true)).resolves.toEqual(guest);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("route changes discard an unused startup handoff", async () => {
  await start();
  window.dispatchEvent(new Event("hashchange"));
  await client.getAccountReadinessSession(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("foreground refreshes and normal invalidation do not reuse startup data", async () => {
  await start();
  await client.getAccountReadinessSession();
  expect(fetch).toHaveBeenCalledTimes(1);
  client.invalidateNewApiModelSource();
  await client.getAccountReadinessSession(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});
