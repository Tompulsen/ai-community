/** @jest-environment node */

import { jest } from "@jest/globals";

const transportOptions: { env?: Record<string, string> }[] = [];
jest.unstable_mockModule("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  getDefaultEnvironment: () => ({ PATH: "/test/bin" }),
  StdioClientTransport: class {
    constructor(options: { env?: Record<string, string> }) {
      transportOptions.push(options);
    }
  },
}));
jest.unstable_mockModule("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    async connect() {}
  },
}));
const { createClient } = await import("../app/mcp/client");

test("MCP children receive SDK defaults and explicit config without application secrets", async () => {
  const previous = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "must-not-be-inherited";
  try {
    await createClient("test", {
      command: "node",
      args: [],
      env: { TOOL_KEY: "explicit-tool-key" },
    });
    expect(transportOptions[0].env).toEqual({
      PATH: "/test/bin",
      TOOL_KEY: "explicit-tool-key",
    });
  } finally {
    if (previous === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = previous;
  }
});
