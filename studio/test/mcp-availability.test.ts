/** @jest-environment node */
import { jest } from "@jest/globals";

const status = jest.fn<() => Promise<boolean>>();
jest.unstable_mockModule("@/app/mcp/actions", () => ({
  isMcpEnabled: status,
}));
const { isMcpAvailable } = await import("../app/mcp/availability");

beforeEach(() => {
  status.mockReset();
});

test.each([true, false])("preserves the MCP status %s", async (enabled) => {
  status.mockResolvedValueOnce(enabled);
  await expect(isMcpAvailable()).resolves.toBe(enabled);
});

test("a rejected 503 server action disables optional MCP without rejecting its caller", async () => {
  const response = new Response("Service unavailable", { status: 503 });
  status.mockImplementationOnce(async () => {
    throw new Error(
      `Server action failed (${response.status}): ${await response.text()}`,
    );
  });
  await expect(isMcpAvailable()).resolves.toBe(false);
});

test("a failed status transport does not produce an unhandled rejection", async () => {
  status.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(isMcpAvailable()).resolves.toBe(false);
});

test("a temporary failure does not hide MCP after it recovers", async () => {
  status.mockRejectedValueOnce(new Error("503"));
  status.mockResolvedValueOnce(true);
  await expect(isMcpAvailable()).resolves.toBe(false);
  await expect(isMcpAvailable()).resolves.toBe(true);
  expect(status).toHaveBeenCalledTimes(2);
});
