/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "../app/api/auth";
import { getServerSideConfig } from "../app/config/server";
import { generateAccessToken } from "../app/utils/access-token";
import { getClientIp } from "../app/utils/request-ip";
import { limitModelRequest } from "../app/lib/model-rate-limit";
import { createSession, SESSION_COOKIE } from "../app/lib/new-api/session";

const originalEnv = process.env;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NEW_API_BASE_URL: "",
    ACCESS_PASSWORD: "",
    TRUST_PROXY: "false",
    NEW_API_TRUST_PROXY: "false",
    ENABLE_RATE_LIMIT: "true",
    RATE_LIMIT_MAX: "2",
    RATE_LIMIT_WINDOW: "60",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "",
  };
  jest.useFakeTimers();
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.advanceTimersByTime(5 * 60_000 + 1);
  jest.useRealTimers();
  jest.restoreAllMocks();
  process.env = originalEnv;
});

function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://chat.example.test/api/v1/chat/completions", {
    headers: { host: "chat.example.test", ...headers },
  });
}

test("configured site passwords reject anonymous and invalid requests", async () => {
  process.env.ACCESS_PASSWORD = " first-password, ,second-password ";
  expect(getServerSideConfig().needCode).toBe(true);
  expect(getServerSideConfig().accessPasswords).toEqual([
    "first-password",
    "second-password",
  ]);
  expect((await auth(request())).error).toBe(true);
  expect((await auth(request({ authorization: "Bearer wrong" }))).error).toBe(
    true,
  );
  for (const password of ["first-password", "second-password"]) {
    const token = await generateAccessToken(password);
    expect(
      (await auth(request({ authorization: `Bearer ${token}` }))).error,
    ).toBe(false);
    expect(
      (await auth(request({ cookie: `site_access_token=${token}` }))).error,
    ).toBe(false);
  }
});

test("an unset site password preserves public mode", async () => {
  expect(getServerSideConfig().needCode).toBe(false);
  expect((await auth(request())).error).toBe(false);
});

test("untrusted forwarding headers cannot reset the legacy limit", async () => {
  for (let index = 0; index < 2; index++) {
    await limitModelRequest(request({ "x-real-ip": `203.0.113.${index}` }));
  }
  await expect(
    limitModelRequest(request({ "x-forwarded-for": "192.0.2.4" })),
  ).rejects.toMatchObject({ status: 429 });
});

test("trusted ingress accepts only a single valid x-real-ip", () => {
  process.env.TRUST_PROXY = "true";
  expect(getClientIp(request({ "x-real-ip": "::ffff:192.0.2.4" }))).toBe(
    "192.0.2.4",
  );
  expect(getClientIp(request({ "x-real-ip": "192.0.2.4, 192.0.2.5" }))).toBe(
    "unknown",
  );
  expect(getClientIp(request({ "x-forwarded-for": "192.0.2.4" }))).toBe(
    "unknown",
  );
});

test("account rate limits ignore forged user IDs and changing IPs", async () => {
  process.env.NEW_API_BASE_URL = "https://accounts.example.test";
  async function account(id: number) {
    const created = await createSession(request(), NextResponse.json({}), {
      user: {
        id,
        username: `user-${id}`,
        display_name: "",
        quota: 0,
        used_quota: 0,
        request_count: 0,
        group: "default",
      },
      accessToken: "test-token",
      accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      refreshToken: "test-refresh",
      upstreamSessionId: `test-session-${id}`,
    });
    return created.id;
  }
  const first = await account(611);
  const second = await account(612);
  for (let index = 0; index < 2; index++) {
    await limitModelRequest(
      request({
        cookie: `${SESSION_COOKIE}=${first}`,
        "new-api-user": String(index),
        "x-forwarded-for": `192.0.2.${index}`,
      }),
    );
  }
  await expect(
    limitModelRequest(
      request({
        cookie: `${SESSION_COOKIE}=${first}`,
        "new-api-user": "999",
      }),
    ),
  ).rejects.toMatchObject({ status: 429 });
  await expect(
    limitModelRequest(
      request({
        cookie: `${SESSION_COOKIE}=${second}`,
      }),
    ),
  ).resolves.toBeUndefined();
  await expect(
    limitModelRequest(
      request({
        "new-api-user": "612",
      }),
    ),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    limitModelRequest(
      request({
        cookie: `${SESSION_COOKIE}=${second}`,
        "x-new-api-user": "999",
      }),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
