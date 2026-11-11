/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";
import { createSession, SESSION_COOKIE } from "../app/lib/new-api/session";
import fs from "fs/promises";

let requestHeaders = new Headers();
const readFile = jest.spyOn(fs, "readFile");
const writeFile = jest.spyOn(fs, "writeFile").mockResolvedValue();
const mkdir = jest.spyOn(fs, "mkdir").mockResolvedValue(undefined);
const createClient = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const executeRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("next/headers", () => ({
  headers: async () => requestHeaders,
}));
jest.unstable_mockModule("@/app/mcp/client", () => ({
  createClient,
  executeRequest,
  listTools: jest.fn(),
  removeClient: jest.fn(),
}));
const actions = await import("../app/mcp/actions");
const { authorizeMcp } = await import("../app/mcp/authorize");
const originalEnv = process.env;
const originalFetch = global.fetch;
const user = {
  id: 731,
  username: "admin",
  display_name: "Admin",
  quota: 0,
  used_quota: 0,
  request_count: 0,
  group: "default",
};

beforeEach(async () => {
  jest.clearAllMocks();
  process.env = {
    ...originalEnv,
    ENABLE_MCP: "true",
    MCP_ADMIN_USER_IDS: String(user.id),
    NEW_API_BASE_URL: "https://accounts.example.test",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "",
  };
  const created = await createSession(
    new NextRequest("https://chat.example.test"),
    NextResponse.json({}),
    {
      user,
      accessToken: "test-admin-token",
      accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      refreshToken: "test-refresh",
      upstreamSessionId: "test-upstream",
    },
  );
  requestHeaders = new Headers({ cookie: `${SESSION_COOKIE}=${created.id}` });
  global.fetch = jest
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ success: true, data: { ...user, role: 10 } }),
    );
  readFile.mockResolvedValue(JSON.stringify({ mcpServers: {} }));
});

afterEach(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
});

afterAll(() => {
  readFile.mockRestore();
  writeFile.mockRestore();
  mkdir.mockRestore();
});

const protectedCalls = [
  () => actions.getClientsStatus(),
  () => actions.getClientTools("test"),
  () => actions.getAvailableClientsCount(),
  () => actions.getAllTools(),
  () => actions.initializeMcpSystem(),
  () => actions.addMcpServer("test", { command: "node", args: [] }),
  () => actions.pauseMcpServer("test"),
  () => actions.resumeMcpServer("test"),
  () => actions.removeMcpServer("test"),
  () => actions.restartAllClients(),
  () => actions.executeMcpAction("test", { method: "tools/list" }),
  () => actions.getMcpConfigFromFile(),
];

test.each([
  "disabled",
  "anonymous",
  "no-allowlist",
  "unlisted",
  "normal-role",
  "mismatched-id",
  "revoked",
])(
  "%s callers cannot read config, mutate processes, or execute tools",
  async (mode) => {
    if (mode === "disabled") process.env.ENABLE_MCP = "false";
    if (mode === "anonymous") requestHeaders = new Headers();
    if (mode === "no-allowlist") delete process.env.MCP_ADMIN_USER_IDS;
    if (mode === "unlisted") process.env.MCP_ADMIN_USER_IDS = "999";
    if (mode === "normal-role" || mode === "mismatched-id") {
      jest.mocked(fetch).mockImplementation(async () =>
        Response.json({
          success: true,
          data: {
            ...user,
            id: mode === "mismatched-id" ? 999 : user.id,
            role: mode === "normal-role" ? 1 : 10,
          },
        }),
      );
    }
    if (mode === "revoked") {
      jest.mocked(fetch).mockImplementation(async () =>
        Response.json(
          {
            success: false,
          },
          { status: 401 },
        ),
      );
    }
    for (const call of protectedCalls) await expect(call()).rejects.toThrow();
    expect(await actions.isMcpEnabled()).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(executeRequest).not.toHaveBeenCalled();
  },
);

test("only an explicitly listed account with a live administrator role passes", async () => {
  await expect(authorizeMcp()).resolves.toBeUndefined();
  expect(await actions.isMcpEnabled()).toBe(true);
  expect(await actions.getMcpConfigFromFile()).toEqual({ mcpServers: {} });
  expect(readFile).toHaveBeenCalledTimes(1);
});

test("trusted administrators still receive runtime config validation", async () => {
  await expect(
    actions.addMcpServer("../escape", {
      command: "node",
      args: [],
    }),
  ).rejects.toThrow();
  await expect(
    actions.addMcpServer("valid", {
      command: "",
      args: [],
    }),
  ).rejects.toThrow();
  expect(writeFile).not.toHaveBeenCalled();
  expect(createClient).not.toHaveBeenCalled();
});
