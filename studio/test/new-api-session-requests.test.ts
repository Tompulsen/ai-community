import { jest } from "@jest/globals";
import { discardWorkspaceSession } from "../app/utils/workspace-bootstrap";

let tokenId: number | null = null;
const confirmLocalToken = jest.fn((id: number | null) => {
  discardWorkspaceSession();
  tokenId = id;
});
const confirmLocalIdentity = jest.fn();
jest.unstable_mockModule("@/app/locales", () => ({
  default: { Account: { RequestFailed: "Request failed" } },
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  confirmLocalToken,
  confirmLocalIdentity,
  getLocalTokenId: () => tokenId,
}));
const { newApiClient, setNewApiExpectedUser, getCachedModelSource } =
  await import("../app/client/new-api");
const originalFetch = global.fetch;
const session = (token = 100) => ({
  authenticated: true,
  user: { id: 7 },
  selectedTokenId: token,
});
const response = (data: unknown) =>
  ({ ok: true, json: async () => ({ success: true, data }) }) as Response;

beforeEach(() => {
  window.dispatchEvent(new Event("new-api-session-changed"));
  global.fetch = jest.fn<typeof fetch>();
  confirmLocalToken.mockClear();
  confirmLocalIdentity.mockClear();
  setNewApiExpectedUser(null);
  tokenId = null;
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test("uses the verified startup session once and revalidates later reads", async () => {
  const bootstrap = await import("../app/utils/workspace-bootstrap");
  bootstrap.rememberWorkspaceBootstrap(
    {
      config: { newApiEnabled: true } as DangerConfig,
      session: session(),
    } as import("../app/utils/workspace-bootstrap").WorkspaceBootstrap,
    bootstrap.getWorkspaceBootstrapRevision(),
  );
  jest.mocked(fetch).mockResolvedValue(response(session()));
  expect((await newApiClient.session()).user?.id).toBe(7);
  expect(fetch).not.toHaveBeenCalled();
  await newApiClient.session();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("account entry reuses a recent verified startup session but expires and invalidates it", async () => {
  const bootstrap = await import("../app/utils/workspace-bootstrap");
  bootstrap.rememberWorkspaceBootstrap(
    {
      config: { newApiEnabled: true } as DangerConfig,
      session: session(),
    } as import("../app/utils/workspace-bootstrap").WorkspaceBootstrap,
    bootstrap.getWorkspaceBootstrapRevision(),
  );
  let now = 1000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  jest.mocked(fetch).mockResolvedValue(response(session()));
  await newApiClient.session();
  setNewApiExpectedUser(7);
  await newApiClient.session(true);
  expect(fetch).not.toHaveBeenCalled();
  now += 15_001;
  await newApiClient.session(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("new-api-session-changed"));
  await newApiClient.session(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("account entry cannot reuse startup identity after a different account or key is selected", async () => {
  jest.mocked(fetch).mockResolvedValue(response(session()));
  await newApiClient.session();
  setNewApiExpectedUser(7);
  setNewApiExpectedUser(8);
  setNewApiExpectedUser(7);
  await newApiClient.session(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  tokenId = 200;
  await newApiClient.session(true);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("concurrent selections of the same account and group share one write and notification", async () => {
  setNewApiExpectedUser(7);
  let finish!: (value: Response) => void;
  const delayed = new Promise<Response>((resolve) => (finish = resolve));
  jest.mocked(fetch).mockReturnValue(delayed);
  const changed = jest.fn();
  window.addEventListener("new-api-session-changed", changed);
  try {
    const first = newApiClient.selectModelGroup("premium", 7);
    const second = newApiClient.selectModelGroup("premium", 7);
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(confirmLocalToken).not.toHaveBeenCalled();
    finish(response({ selectedTokenId: 200, group: "premium" }));
    await Promise.all([first, second]);
    expect(confirmLocalToken.mock.calls).toEqual([[200]]);
    expect(changed).toHaveBeenCalledTimes(1);
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        response({ selectedTokenId: 200, group: "premium" }),
      );
    await newApiClient.selectModelGroup("premium", 7);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    window.removeEventListener("new-api-session-changed", changed);
  }
});

test("a delayed selection cannot change the key after account invalidation", async () => {
  setNewApiExpectedUser(7);
  let finish!: (value: Response) => void;
  jest
    .mocked(fetch)
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const pending = newApiClient.selectModelGroup("premium", 7);
  window.dispatchEvent(new Event("new-api-session-changed"));
  setNewApiExpectedUser(8);
  finish(response({ selectedTokenId: 200, group: "premium" }));
  await expect(pending).rejects.toThrow();
  expect(confirmLocalToken).not.toHaveBeenCalled();
});

test("a delayed direct key selection cannot overwrite the newer account's key", async () => {
  setNewApiExpectedUser(7);
  let finish!: (value: Response) => void;
  jest
    .mocked(fetch)
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const pending = newApiClient.selectToken(200, 7);
  window.dispatchEvent(new Event("new-api-session-changed"));
  setNewApiExpectedUser(8);
  confirmLocalToken(800);
  const changed = jest.fn();
  window.addEventListener("new-api-session-changed", changed);
  try {
    finish(response({ selectedTokenId: 200 }));
    await expect(pending).rejects.toMatchObject({ status: 409 });
    expect(confirmLocalToken.mock.calls).toEqual([[800]]);
    expect(tokenId).toBe(800);
    expect(changed).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("new-api-session-changed", changed);
  }
});

test("a current direct key selection confirms its key and notifies consumers once", async () => {
  setNewApiExpectedUser(7);
  jest.mocked(fetch).mockResolvedValueOnce(response({ selectedTokenId: 200 }));
  const changed = jest.fn();
  window.addEventListener("new-api-session-changed", changed);
  try {
    await expect(newApiClient.selectToken(200, 7)).resolves.toEqual({
      selectedTokenId: 200,
    });
    expect(confirmLocalToken.mock.calls).toEqual([[200]]);
    expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("new-api-session-changed", changed);
  }
});

test("concurrent session reads share one request, completed reads are revalidated", async () => {
  jest.mocked(fetch).mockResolvedValue(response(session()));
  const first = newApiClient.session();
  const second = newApiClient.session();
  expect(second).toBe(first);
  await Promise.all([first, second]);
  expect(fetch).toHaveBeenCalledTimes(1);
  await newApiClient.session();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("a key change bypasses an older read and its late response cannot restore the old key", async () => {
  let finish!: (value: Response) => void;
  jest
    .mocked(fetch)
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    .mockResolvedValueOnce(response(session(200)));
  const old = newApiClient.session();
  window.dispatchEvent(new Event("new-api-session-changed"));
  await newApiClient.session();
  finish(response(session(100)));
  await old;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(confirmLocalToken.mock.calls).toEqual([[200]]);
});

test("a failed shared read does not prevent retrying", async () => {
  jest
    .mocked(fetch)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(response(session()));
  await expect(newApiClient.session()).rejects.toThrow("offline");
  await expect(newApiClient.session()).resolves.toEqual(session());
});

test("group snapshots are prefetched, shared, refreshed after five minutes and cleared on account changes", async () => {
  const groups = {
    groups: [{ id: "", name: "", ratio: 1, description: "" }],
    selectedGroup: "",
  };
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response(session()))
    .mockResolvedValue(response(groups));
  await newApiClient.session();
  setNewApiExpectedUser(7);
  const first = newApiClient.modelGroups(7);
  expect(newApiClient.modelGroups(7)).toBe(first);
  await first;
  const requests = jest.mocked(fetch).mock.calls.length;
  expect(getCachedModelSource()?.modelGroups).toEqual(groups);
  await newApiClient.modelGroups(7);
  expect(fetch).toHaveBeenCalledTimes(requests);
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now + 300_001);
  await newApiClient.modelGroups(7);
  expect(fetch).toHaveBeenCalledTimes(requests + 1);
  clock.mockRestore();
  window.dispatchEvent(new Event("new-api-session-changed"));
  expect(getCachedModelSource()).toBeUndefined();
  await newApiClient.modelGroups(7);
  expect(fetch).toHaveBeenCalledTimes(requests + 2);
});

test("delayed metadata from a previous key cannot populate a new key's cache", async () => {
  let finish!: (value: Response) => void;
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response(session()))
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    .mockResolvedValueOnce(response(session(200)));
  await newApiClient.session();
  setNewApiExpectedUser(7);
  const old = newApiClient.modelGroups(7);
  window.dispatchEvent(new Event("new-api-session-changed"));
  await newApiClient.session();
  finish(response({ groups: [], selectedGroup: "old" }));
  await old;
  expect(getCachedModelSource()).toBeUndefined();
});

test("a session-detected key change invalidates older group reads without a broadcast", async () => {
  let finish!: (value: Response) => void;
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(response(session()))
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    .mockResolvedValueOnce(response(session(200)))
    .mockResolvedValue(response({ groups: [], selectedGroup: "new" }));
  await newApiClient.session();
  setNewApiExpectedUser(7);
  const old = newApiClient.modelGroups(7);
  await newApiClient.session();
  finish(response({ groups: [], selectedGroup: "wrong" }));
  await old;
  await newApiClient.modelGroups(7);
  jest.mocked(fetch).mockResolvedValueOnce(response(session(100)));
  await newApiClient.session();
  expect(getCachedModelSource()).toBeUndefined();
});
