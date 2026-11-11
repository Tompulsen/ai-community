/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";
import {
  relayHeaders,
  resolveRelayCredentials,
} from "../app/lib/new-api/relay";
import {
  getNewApiConfig,
  getNewApiImageBaseUrl,
} from "../app/lib/new-api/config";
import {
  SESSION_COOKIE,
  createSession,
  readSessionById,
} from "../app/lib/new-api/session";

const originalEnv = process.env;
const user = {
  id: 17,
  username: "account-a",
  display_name: "Account A",
  quota: 100,
  used_quota: 20,
  request_count: 2,
  group: "default",
};

function request(id?: string) {
  const headers = new Headers({
    host: "chat.example.test",
    origin: "https://chat.example.test",
    "x-api-key": "Bearer sk-forged-client-key",
  });
  if (id) headers.set("cookie", `${SESSION_COOKIE}=${id}`);
  return new NextRequest("https://chat.example.test/api/v1/chat/completions", {
    method: "POST",
    headers,
  });
}

async function session(accountId: number, selected = true) {
  return createSession(request(), NextResponse.json({}), {
    user: { ...user, id: accountId },
    accessToken: `private-login-${accountId}`,
    accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    refreshToken: `private-refresh-${accountId}`,
    upstreamSessionId: `upstream-session-${accountId}`,
    ...(selected
      ? {
          selectedTokenId: accountId * 100,
          selectedKey: `sk-private-model-key-${accountId}`,
        }
      : {}),
  });
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    NEW_API_BASE_URL: "https://accounts.example.test",
    NEW_API_IMAGE_BASE_URL: "",
    NEW_API_PUBLIC_URL: "https://accounts.example.test",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "",
    BASE_URL: "https://legacy-models.example.test/",
    MODEL_API_KEY: "sk-shared-server-key",
    NEW_API_TRUST_PROXY: "false",
  };
  global.fetch = jest.fn<typeof fetch>();
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = originalEnv;
});

describe("New API model relay account isolation", () => {
  test.each([
    "images/generations",
    "images/edits",
    "images/variations",
    "images/edits/",
  ])(
    "routes %s to the optional image origin with the selected user key",
    async (path) => {
      process.env.NEW_API_IMAGE_BASE_URL = "http://image-async:8000/";
      const created = await session(17);
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(Response.json({ success: true, data: user }));
      await expect(
        resolveRelayCredentials(request(created.id), path),
      ).resolves.toEqual({
        baseUrl: "http://image-async:8000",
        apiKey: "sk-private-model-key-17",
      });
      expect(String(jest.mocked(fetch).mock.calls[0][0])).toContain(
        "https://accounts.example.test/api/user/self",
      );
    },
  );

  test.each([
    undefined,
    "models",
    "chat/completions",
    "videos",
    "images/edits/other",
    "images/generations?unexpected=true",
    "images/edits//",
  ])(
    "keeps %s on the account origin even if image configuration is invalid",
    async (path) => {
      process.env.NEW_API_IMAGE_BASE_URL = "https://invalid.test/v1";
      const created = await session(17);
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(Response.json({ success: true, data: user }));
      await expect(
        resolveRelayCredentials(request(created.id), path),
      ).resolves.toMatchObject({ baseUrl: "https://accounts.example.test" });
      expect(getNewApiConfig().baseUrl).toBe("https://accounts.example.test");
    },
  );

  test.each([
    "file:///tmp/images",
    "https://user:password@images.example.test",
    "https://images.example.test/v1",
    "https://images.example.test?token=private",
    "https://images.example.test#fragment",
    "not-a-url",
  ])(
    "rejects image origin %s instead of silently bypassing the image service",
    async (origin) => {
      process.env.NEW_API_IMAGE_BASE_URL = origin;
      expect(() => getNewApiImageBaseUrl()).toThrow();
      const created = await session(17);
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(Response.json({ success: true, data: user }));
      await expect(
        resolveRelayCredentials(request(created.id), "images/generations"),
      ).rejects.toThrow();
    },
  );

  test("keeps BYOK image requests independent from account image configuration", async () => {
    process.env.NEW_API_BASE_URL = "";
    process.env.NEW_API_IMAGE_BASE_URL = "https://invalid.test/v1";
    await expect(
      resolveRelayCredentials(request(), "images/generations"),
    ).resolves.toEqual({
      baseUrl: "https://legacy-models.example.test",
      apiKey: "sk-forged-client-key",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects another account's captured token before any paid submission", async () => {
    const created = await session(17);
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(Response.json({ success: true, data: user }))
      .mockResolvedValueOnce(
        Response.json({ success: true, data: { id: 2900, user_id: 29 } }),
      );
    const req = request(created.id);
    req.headers.set("X-New-Api-Token", "2900");
    await expect(resolveRelayCredentials(req)).rejects.toMatchObject({
      status: 403,
    });
  });

  test.each([
    "videos/job/content",
    "tasks/job/artifacts/output.mp4/content",
    "v1beta/files/job:download",
  ])(
    "reads historical video %s using its original account-owned key",
    async (path) => {
      const created = await session(17);
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(Response.json({ success: true, data: user }))
        .mockResolvedValueOnce(
          Response.json({
            success: true,
            data: { id: 1600, user_id: 17 },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            success: true,
            data: { key: "original-video-key" },
          }),
        );
      const req = new NextRequest(
        `https://chat.example.test/api/${path}${
          path.startsWith("v1beta/") ? "?alt=media" : ""
        }`,
        {
          headers: {
            cookie: `${SESSION_COOKIE}=${created.id}`,
            "X-New-Api-Token": "1600",
          },
        },
      );
      await expect(resolveRelayCredentials(req, path)).resolves.toEqual({
        baseUrl: "https://accounts.example.test",
        apiKey: "sk-original-video-key",
      });
      expect(String(jest.mocked(fetch).mock.calls[2][0])).toBe(
        "https://accounts.example.test/api/token/1600/key",
      );
      expect(
        new Headers(jest.mocked(fetch).mock.calls[2][1]?.headers).get(
          "authorization",
        ),
      ).toBe("Bearer private-login-17");
      expect((await readSessionById(created.id))?.selectedTokenId).toBe(1700);
    },
  );

  test("reads an owned historical video with no current model key selected", async () => {
    const created = await session(17, false);
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(Response.json({ success: true, data: user }))
      .mockResolvedValueOnce(
        Response.json({ success: true, data: { id: 1600, user_id: 17 } }),
      )
      .mockResolvedValueOnce(
        Response.json({ success: true, data: { key: "sk-original" } }),
      );
    const req = new NextRequest(
      "https://chat.example.test/api/v1/videos/job/content",
      {
        headers: {
          cookie: `${SESSION_COOKIE}=${created.id}`,
          "X-New-Api-Token": "1600",
        },
      },
    );
    await expect(
      resolveRelayCredentials(req, "videos/job/content"),
    ).resolves.toMatchObject({ apiKey: "sk-original" });
    expect(
      (await readSessionById(created.id))?.selectedTokenId,
    ).toBeUndefined();
  });

  test.each([
    { id: 1600, user_id: 29 },
    { id: 1500, user_id: 17 },
  ])(
    "rejects an unowned or mismatched historical token %j before reading its key",
    async (token) => {
      const created = await session(17);
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(Response.json({ success: true, data: user }))
        .mockResolvedValueOnce(Response.json({ success: true, data: token }));
      const req = new NextRequest(
        "https://chat.example.test/api/v1/videos/job/content",
        {
          headers: {
            cookie: `${SESSION_COOKIE}=${created.id}`,
            "X-New-Api-Token": "1600",
          },
        },
      );
      await expect(
        resolveRelayCredentials(req, "videos/job/content"),
      ).rejects.toMatchObject({ status: 403 });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  test.each(["", "0", "-1", "1.5", "01", "NaN", "9007199254740992"])(
    "rejects invalid historical token %s before token lookup",
    async (token) => {
      const created = await session(17);
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(Response.json({ success: true, data: user }));
      const req = new NextRequest(
        "https://chat.example.test/api/v1/videos/job/content",
        {
          headers: {
            cookie: `${SESSION_COOKIE}=${created.id}`,
            "X-New-Api-Token": token,
          },
        },
      );
      await expect(
        resolveRelayCredentials(req, "videos/job/content"),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ["POST", "videos"],
    ["POST", "videos/job/content"],
    ["HEAD", "videos/job/content"],
    ["GET", "videos/job"],
    ["GET", "tasks/job/artifacts"],
    ["GET", "chat/completions"],
    ["GET", "v1beta/files/job:download"],
    ["POST", "chat/completions"],
    ["POST", "responses"],
    ["POST", "images/generations"],
    ["GET", "async-images/v1/tasks/job"],
    ["GET", "async-videos/v1/tasks/job"],
  ])(
    "uses the owned captured token for %s %s after group selection changes",
    async (method, path) => {
      process.env.NEW_API_IMAGE_BASE_URL = "https://images.example.test";
      process.env.NEW_API_ASYNC_BASE_URL = "https://async.example.test";
      const created = await session(17);
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(Response.json({ success: true, data: user }))
        .mockResolvedValueOnce(
          Response.json({ success: true, data: { id: 1600, user_id: 17 } }),
        )
        .mockResolvedValueOnce(
          Response.json({ success: true, data: { key: "original" } }),
        );
      const req = new NextRequest(`https://chat.example.test/api/v1/${path}`, {
        method,
        headers: {
          origin: "https://chat.example.test",
          host: "chat.example.test",
          cookie: `${SESSION_COOKIE}=${created.id}`,
          "X-New-Api-Token": "1600",
        },
      });
      await expect(resolveRelayCredentials(req, path)).resolves.toMatchObject({
        apiKey: "sk-original",
        baseUrl: path.startsWith("async-")
          ? "https://async.example.test"
          : path === "images/generations"
          ? "https://images.example.test"
          : "https://accounts.example.test",
      });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect((await readSessionById(created.id))?.selectedTokenId).toBe(1700);
    },
  );

  test("never falls back to the current key when the historical key was deleted", async () => {
    const created = await session(17);
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(Response.json({ success: true, data: user }))
      .mockResolvedValueOnce(
        Response.json({ success: false, message: "record not found" }),
      );
    const req = new NextRequest(
      "https://chat.example.test/api/v1/videos/job/content",
      {
        headers: {
          cookie: `${SESSION_COOKIE}=${created.id}`,
          "X-New-Api-Token": "1600",
        },
      },
    );
    await expect(
      resolveRelayCredentials(req, "videos/job/content"),
    ).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  test("never falls back to a client or shared server key before login", async () => {
    await expect(resolveRelayCredentials(request())).rejects.toMatchObject({
      status: 401,
      code: "NEW_API_LOGIN_REQUIRED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects a cross-origin multipart request before it can spend user quota", async () => {
    const created = await session(17);
    const req = new NextRequest(
      "https://chat.example.test/api/v1/images/edits",
      {
        method: "POST",
        headers: {
          host: "chat.example.test",
          origin: "https://untrusted.example.test",
          cookie: `${SESSION_COOKIE}=${created.id}`,
          "content-type": "multipart/form-data; boundary=test-boundary",
          "sec-fetch-site": "same-site",
        },
      },
    );

    await expect(resolveRelayCredentials(req)).rejects.toMatchObject({
      status: 403,
      code: "NEW_API_CSRF",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects a cross-site GET that carries a logged-in cookie", async () => {
    const created = await session(17);
    const req = new NextRequest("https://chat.example.test/api/v1/models", {
      headers: {
        host: "chat.example.test",
        cookie: `${SESSION_COOKIE}=${created.id}`,
        "sec-fetch-site": "cross-site",
      },
    });

    await expect(resolveRelayCredentials(req)).rejects.toMatchObject({
      status: 403,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("requires a selected user key instead of a client or shared server key", async () => {
    const created = await session(17, false);
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(Response.json({ success: true, data: user }));

    await expect(
      resolveRelayCredentials(request(created.id)),
    ).rejects.toMatchObject({
      status: 409,
      code: "NEW_API_TOKEN_REQUIRED",
    });
  });

  test("keeps the model credentials of simultaneous users separate", async () => {
    const first = await session(17);
    const second = await session(29);
    jest
      .mocked(fetch)
      .mockImplementation(async () =>
        Response.json({ success: true, data: user }),
      );

    const [firstRelay, secondRelay] = await Promise.all([
      resolveRelayCredentials(request(first.id)),
      resolveRelayCredentials(request(second.id)),
    ]);

    expect(firstRelay).toEqual({
      baseUrl: "https://accounts.example.test",
      apiKey: "sk-private-model-key-17",
    });
    expect(secondRelay).toEqual({
      baseUrl: "https://accounts.example.test",
      apiKey: "sk-private-model-key-29",
    });
    expect(
      jest
        .mocked(fetch)
        .mock.calls.map(([, options]) =>
          new Headers(options?.headers).get("authorization"),
        )
        .sort(),
    ).toEqual(["Bearer private-login-17", "Bearer private-login-29"]);
  });

  test("rejects a revoked dashboard login even if a model key remains saved", async () => {
    const created = await session(17);
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(
          { success: false, message: "Session revoked" },
          { status: 401 },
        ),
      );

    await expect(
      resolveRelayCredentials(request(created.id)),
    ).rejects.toMatchObject({ status: 401 });
    expect(await readSessionById(created.id)).toBeNull();
  });

  test("deduplicates checks within a model request but revalidates the next request", async () => {
    const created = await session(17);
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(Response.json({ success: true, data: user }))
      .mockResolvedValueOnce(
        Response.json(
          { success: false, message: "Session revoked" },
          { status: 401 },
        ),
      );
    const req = request(created.id);
    await Promise.all([
      resolveRelayCredentials(req, "chat/completions"),
      resolveRelayCredentials(req, "models"),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(
      resolveRelayCredentials(request(created.id), "chat/completions"),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readSessionById(created.id)).toBeNull();
  });

  test("retains explicit BYOK behavior when account mode is disabled", async () => {
    process.env.NEW_API_BASE_URL = "";

    await expect(resolveRelayCredentials(request())).resolves.toEqual({
      baseUrl: "https://legacy-models.example.test",
      apiKey: "sk-forged-client-key",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Model relay request header boundary", () => {
  test("range headers are restricted to media transfers and a single byte range", () => {
    const req = new NextRequest(
      "https://chat.example.test/api/v1/videos/job/content",
      {
        headers: { range: "bytes=10-19", "if-range": '"one"' },
      },
    );
    expect(relayHeaders(req, "key").has("range")).toBe(false);
    expect(relayHeaders(req, "key").has("if-range")).toBe(false);
    expect(relayHeaders(req, "key", true).get("range")).toBe("bytes=10-19");
    expect(relayHeaders(req, "key", true).get("if-range")).toBe('"one"');
    req.headers.set("range", "bytes=0-1,5-9");
    expect(relayHeaders(req, "key", true).has("range")).toBe(false);
    expect(relayHeaders(req, "key", true).has("if-range")).toBe(false);
  });
  test.each(["203.0.113.42", "2001:db8::42"])(
    "forwards the validated real IP %s and bounds the user agent in trusted account mode",
    (ip) => {
      process.env.NEW_API_TRUST_PROXY = "true";
      const req = new NextRequest(
        "https://chat.example.test/api/v1/chat/completions",
        {
          headers: {
            "x-real-ip": ip,
            "x-forwarded-for": "198.51.100.99, 10.0.0.1",
            "user-agent": "a".repeat(700),
            "x-new-api-user": "17",
          },
        },
      );
      const headers = relayHeaders(req, "sk-selected-user-key");

      expect(headers.get("x-real-ip")).toBe(ip);
      expect(headers.get("x-forwarded-for")).toBe(ip);
      expect(headers.get("user-agent")).toBe("a".repeat(512));
      expect(headers.get("x-new-api-user")).toBeNull();
    },
  );

  test("does not trust proxy-supplied IP headers unless explicitly enabled", () => {
    const req = new NextRequest(
      "https://chat.example.test/api/v1/chat/completions",
      {
        headers: {
          "x-real-ip": "203.0.113.42",
          "x-forwarded-for": "198.51.100.99",
          "user-agent": "account-browser",
        },
      },
    );
    const headers = relayHeaders(req, "sk-selected-user-key");

    expect(headers.get("x-real-ip")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("user-agent")).toBe("account-browser");
  });

  test.each([
    "not-an-ip",
    "203.0.113.42, 10.0.0.1",
    "https://attacker.example.test",
    "203.0.113.42:1234",
  ])("rejects malformed trusted proxy IP %s", (ip) => {
    process.env.NEW_API_TRUST_PROXY = "true";
    const req = new NextRequest(
      "https://chat.example.test/api/v1/chat/completions",
      {
        headers: {
          "x-real-ip": ip,
          "x-forwarded-for": "198.51.100.99",
        },
      },
    );
    const headers = relayHeaders(req, "sk-selected-user-key");

    expect(headers.get("x-real-ip")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
  });

  test("does not disclose user IP or agent to a custom upstream outside account mode", () => {
    process.env.NEW_API_BASE_URL = "";
    process.env.NEW_API_TRUST_PROXY = "true";
    const req = new NextRequest(
      "https://chat.example.test/api/v1/chat/completions",
      {
        headers: {
          "x-real-ip": "203.0.113.42",
          "x-forwarded-for": "198.51.100.99",
          "user-agent": "private-browser-user-agent",
        },
      },
    );
    const headers = relayHeaders(req, "sk-custom-model-key");

    expect(headers.get("x-real-ip")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("user-agent")).toBeNull();
  });

  test("forwards model headers and strips every browser/account credential", () => {
    const req = new NextRequest(
      "https://chat.example.test/api/v1/chat/completions",
      {
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          "openai-organization": "model-organization",
          authorization: "Bearer forged-dashboard-credential",
          cookie: `${SESSION_COOKIE}=opaque-session`,
          "new-api-user": "99",
          "x-auth-session": "forged-upstream-session",
          "x-api-key": "Bearer sk-client-credential",
          "x-forwarded-for": "untrusted-client",
          host: "chat.example.test",
          origin: "https://chat.example.test",
        },
      },
    );
    const headers = relayHeaders(req, "sk-selected-user-key");

    expect(Object.fromEntries(headers.entries())).toEqual({
      accept: "text/event-stream",
      authorization: "Bearer sk-selected-user-key",
      "cache-control": "no-store",
      "content-type": "application/json",
      "openai-organization": "model-organization",
    });
  });
});
