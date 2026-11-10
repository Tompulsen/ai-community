/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { POST } from "../app/api/new-api/[...path]/route";

const originalEnv = process.env;
const originalFetch = global.fetch;
const context = { params: Promise.resolve({ path: ["login"] }) };

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    NEW_API_BASE_URL: "https://accounts.example.test",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "",
  };
  global.fetch = jest.fn<typeof fetch>();
});

afterEach(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
  jest.useRealTimers();
});

function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new NextRequest("https://chat.example.test/api/new-api/login", {
    method: "POST",
    headers: {
      host: "chat.example.test",
      origin: "https://chat.example.test",
      "content-type": "application/json",
      ...headers,
    },
    body,
    duplex: "half",
  });
}

test("rejects cumulative stream bytes before reading a full oversized body", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.alloc(30_001));
      controller.enqueue(Buffer.alloc(30_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = await POST(
    request(body, { "content-length": "1" }),
    context,
  );
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ message: "请求内容过长" });
  expect(cancelled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

test("retains the 20,000-character contract for Chinese JSON", async () => {
  const body = JSON.stringify({ p: "中".repeat(19_992) });
  expect(body.length).toBe(20_000);
  const accepted = await POST(request(body), context);
  expect(accepted.status).toBe(400);
  expect(await accepted.json()).toMatchObject({
    message: "请输入有效的用户名和密码",
  });
  const oversized = await POST(request(`${body} `), context);
  expect(oversized.status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});

test("a stalled upload returns 408 without contacting the account service", async () => {
  jest.useFakeTimers();
  const body = new ReadableStream<Uint8Array>({
    pull: () => new Promise(() => {}),
    cancel: () => new Promise(() => {}),
  });
  const pending = POST(request(body), context);
  await jest.advanceTimersByTimeAsync(30_000);
  const response = await pending;
  expect(response.status).toBe(408);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(fetch).not.toHaveBeenCalled();
});
