/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest } from "next/server";

const authenticated = jest.fn(async (req: NextRequest) => {
  const id = Number(req.headers.get("x-test-user"));
  if (!id) throw Object.assign(new Error("login required"), { status: 401 });
  return { session: { user: { id } } };
});
jest.unstable_mockModule("@/app/lib/new-api/client", () => ({
  getAuthenticatedSession: authenticated,
}));
const { limitModelRequest } = await import("../app/lib/model-rate-limit");
const originalEnv = process.env;

function request(path: string, method = "GET", user = 17, ip = "203.0.113.7") {
  return new NextRequest(`https://chat.test/api/${path}`, {
    method,
    headers: {
      "x-test-user": String(user),
      "x-real-ip": ip,
    },
  });
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NEW_API_BASE_URL: "https://accounts.test",
    ENABLE_RATE_LIMIT: "true",
    RATE_LIMIT_MAX: "2",
    RATE_LIMIT_WINDOW: "60",
    MODEL_QUERY_RATE_LIMIT_MAX: "3",
    MODEL_QUERY_RATE_LIMIT_WINDOW: "60",
    TRUST_PROXY: "true",
  };
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-31T00:00:00Z"));
});

afterEach(() => {
  jest.advanceTimersByTime(5 * 60_000);
  jest.useRealTimers();
  authenticated.mockClear();
  process.env = originalEnv;
});

test.each([
  "async-images/v1/tasks/image_1",
  "async-videos/v1/tasks/video_1",
  "v1/videos/video_1",
  "v1/tasks/task_1",
  "ark/contents/generations/tasks/cgt_1",
  "v1/tasks/task_1/artifacts",
  "v1beta/models/veo-3.1/operations/op_1",
  "v1/images/generations?task_id=image_1",
])(
  "query budget is independent from paid submission budget: %s",
  async (path) => {
    await limitModelRequest(request("v1/chat/completions", "POST"));
    await limitModelRequest(request("v1/images/generations", "POST"));
    await expect(
      limitModelRequest(request("v1/chat/completions", "POST")),
    ).rejects.toMatchObject({ status: 429, retryAfter: "60" });
    for (let i = 0; i < 3; i++) await limitModelRequest(request(path));
    await expect(limitModelRequest(request(path))).rejects.toMatchObject({
      status: 429,
      retryAfter: "60",
    });
  },
);

test("query limits preserve account isolation and refresh exactly at window expiry", async () => {
  for (let i = 0; i < 3; i++)
    await limitModelRequest(request("async-images/v1/tasks/job"));
  await expect(
    limitModelRequest(request("async-images/v1/tasks/job")),
  ).rejects.toMatchObject({ status: 429 });
  await limitModelRequest(request("async-images/v1/tasks/job", "GET", 29));
  await jest.advanceTimersByTimeAsync(10_000);
  await expect(
    limitModelRequest(request("async-images/v1/tasks/job")),
  ).rejects.toMatchObject({ retryAfter: "50" });
  await jest.advanceTimersByTimeAsync(50_000);
  await limitModelRequest(request("async-images/v1/tasks/job"));
});

test("legacy mode keeps IP-based scope and does not request an account session", async () => {
  process.env.NEW_API_BASE_URL = "";
  for (let i = 0; i < 3; i++)
    await limitModelRequest(request("async-images/v1/tasks/job"));
  await expect(
    limitModelRequest(request("async-images/v1/tasks/job")),
  ).rejects.toMatchObject({ status: 429 });
  await limitModelRequest(
    request("async-images/v1/tasks/job", "GET", 17, "203.0.113.8"),
  );
  expect(authenticated).not.toHaveBeenCalled();
});

test("query access still requires a logged-in account when account mode is enabled", async () => {
  await expect(
    limitModelRequest(request("async-images/v1/tasks/job", "GET", 0)),
  ).rejects.toMatchObject({ status: 401 });
  expect(authenticated).toHaveBeenCalledWith(expect.any(NextRequest), true);
});
