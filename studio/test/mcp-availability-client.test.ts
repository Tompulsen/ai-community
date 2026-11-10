import { jest } from "@jest/globals";

const status = jest.fn<() => Promise<boolean>>();
jest.unstable_mockModule("@/app/mcp/actions", () => ({
  isMcpEnabled: status,
}));
const { isMcpAvailable } = await import("../app/mcp/availability");
let now = 1000;

beforeEach(() => {
  status.mockReset();
  now = 1000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  window.dispatchEvent(new Event("new-api-session-changed"));
});

afterEach(() => {
  window.dispatchEvent(new Event("new-api-session-changed"));
  jest.restoreAllMocks();
});

test("concurrent optional controls share one MCP status request", async () => {
  let resolve!: (enabled: boolean) => void;
  status.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const requests = [isMcpAvailable(), isMcpAvailable(), isMcpAvailable()];
  await Promise.resolve();
  expect(status).toHaveBeenCalledTimes(1);
  resolve(true);
  await expect(Promise.all(requests)).resolves.toEqual([true, true, true]);
});

test.each([true, false])(
  "successful %s status is briefly reused and expires",
  async (enabled) => {
    status.mockResolvedValueOnce(enabled).mockResolvedValueOnce(!enabled);
    await expect(isMcpAvailable()).resolves.toBe(enabled);
    await expect(isMcpAvailable()).resolves.toBe(enabled);
    expect(status).toHaveBeenCalledTimes(1);
    now += 5001;
    await expect(isMcpAvailable()).resolves.toBe(!enabled);
    expect(status).toHaveBeenCalledTimes(2);
  },
);

test("transport errors do not cache a disabled result", async () => {
  status
    .mockRejectedValueOnce(new Error("temporarily unavailable"))
    .mockResolvedValueOnce(true);
  await expect(isMcpAvailable()).resolves.toBe(false);
  await expect(isMcpAvailable()).resolves.toBe(true);
  expect(status).toHaveBeenCalledTimes(2);
});

test.each(["new-api-session-changed", "local-workspace-switch"])(
  "%s invalidates the previous account status immediately",
  async (event) => {
    status.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(isMcpAvailable()).resolves.toBe(true);
    window.dispatchEvent(new Event(event));
    await expect(isMcpAvailable()).resolves.toBe(false);
    expect(status).toHaveBeenCalledTimes(2);
  },
);

test("an old account response cannot enable or replace the new status", async () => {
  let resolveOld!: (enabled: boolean) => void;
  status
    .mockReturnValueOnce(new Promise((done) => (resolveOld = done)))
    .mockResolvedValueOnce(false);
  const stale = isMcpAvailable();
  await Promise.resolve();
  window.dispatchEvent(new Event("new-api-session-changed"));
  await expect(isMcpAvailable()).resolves.toBe(false);
  resolveOld(true);
  await expect(stale).resolves.toBe(false);
  await expect(isMcpAvailable()).resolves.toBe(false);
  expect(status).toHaveBeenCalledTimes(2);
});
