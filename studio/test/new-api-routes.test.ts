/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";
import {
  DELETE,
  GET,
  PATCH,
  POST,
  PUT,
} from "../app/api/new-api/[...path]/route";
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
const token = {
  id: 23,
  user_id: 17,
  name: "Chat key",
  key: "private-unmasked-key",
  status: 1,
  expired_time: -1,
  remain_quota: 100,
  used_quota: 1,
  unlimited_quota: false,
  group: "default",
};
const credentials = {
  user,
  accessToken: "private-login-token-a",
  accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  refreshToken: "private-refresh-token-a",
  upstreamSessionId: "upstream-session-a",
  selectedTokenId: token.id,
  selectedKey: "sk-private-unmasked-key",
};
const availableGroups = {
  default: { ratio: 1, desc: "Account route" },
  premium: { ratio: 2, desc: "Premium route" },
  economy: { ratio: 0.5, desc: "Economy route" },
  auto: { ratio: "auto", desc: "Native automatic routing" },
};
const autoGroupSettings = { groups: ["premium", "default"], max_count: 2 };
const singleDefaultToken = {
  ...token,
  id: 41,
  name: "My default chat key",
  group: "",
  unlimited_quota: true,
  remain_quota: 0,
  expired_time: -1,
};

function request(
  route: string,
  options: {
    method?: string;
    id?: string;
    body?: unknown;
    origin?: string;
  } = {},
) {
  const headers = new Headers({
    host: "chat.example.test",
    origin: options.origin ?? "https://chat.example.test",
    "content-type": "application/json",
    authorization: "Bearer forged-dashboard-token",
    "new-api-user": "99",
  });
  if (options.id) headers.set("cookie", `${SESSION_COOKIE}=${options.id}`);
  return new NextRequest(`https://chat.example.test/api/new-api/${route}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function context(route: string) {
  return { params: Promise.resolve({ path: route.split("?")[0].split("/") }) };
}

function upstreamResponse(data?: unknown, status = 200) {
  return Response.json({ success: status < 400, data }, { status });
}

function loginResponse() {
  return Response.json(
    {
      success: true,
      data: {
        user,
        access_token: credentials.accessToken,
        access_expires_at: credentials.accessExpiresAt,
        session: { sid: credentials.upstreamSessionId },
      },
    },
    {
      headers: {
        "set-cookie": `new_api_refresh=${credentials.refreshToken}; HttpOnly; Secure`,
      },
    },
  );
}

function forwardedBody(index: number) {
  return JSON.parse(jest.mocked(fetch).mock.calls[index][1]?.body as string);
}

function tokenMutations() {
  return jest
    .mocked(fetch)
    .mock.calls.filter(
      ([url, options]) =>
        new URL(String(url)).pathname.startsWith("/api/token/") &&
        options?.method !== "GET",
    )
    .map(([url, options]) => [String(url), options?.method]);
}

async function login() {
  return POST(
    request("login", {
      method: "POST",
      body: { username: user.username, password: "private-password" },
    }),
    context("login"),
  );
}

async function account() {
  return createSession(
    request("login", { method: "POST" }),
    NextResponse.json({}),
    credentials,
  );
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    NEW_API_BASE_URL: "https://accounts.example.test",
    NEW_API_PUBLIC_URL: "https://accounts.example.test",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "",
  };
  global.fetch = jest.fn<typeof fetch>();
  (globalThis as any).__octopusModelGroups?.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = originalEnv;
});

describe("New API account browser routes", () => {
  test("guest bootstrap returns only public config and a guest identity without upstream reads", async () => {
    const response = await GET(request("bootstrap"), context("bootstrap"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = (await response.json()).data;
    expect(data.config.newApiEnabled).toBe(true);
    expect(data.session).toEqual({
      authenticated: false,
      user: null,
      selectedTokenId: null,
    });
    expect(JSON.stringify(data)).not.toContain("test-session-secret");
    expect(data.config).not.toHaveProperty("apiKey");
    expect(data.config).not.toHaveProperty("baseUrl");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("bootstrap also supports installations with account integration disabled", async () => {
    process.env.NEW_API_BASE_URL = "";
    const response = await GET(request("bootstrap"), context("bootstrap"));
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.config.newApiEnabled).toBe(false);
    expect(data.session.authenticated).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("authenticated bootstrap still verifies the upstream user and never exposes credentials", async () => {
    const { id } = await account();
    jest.mocked(fetch).mockResolvedValueOnce(upstreamResponse(user));
    const response = await GET(request("bootstrap", { id }), context("bootstrap"));
    expect(response.status).toBe(200);
    const text = await response.text();
    const data = JSON.parse(text).data;
    expect(data.session).toEqual({
      authenticated: true,
      user,
      selectedTokenId: token.id,
    });
    expect(String(jest.mocked(fetch).mock.calls[0][0])).toContain("/api/user/self");
    expect(text).not.toContain(credentials.accessToken);
    expect(text).not.toContain(credentials.refreshToken);
    expect(text).not.toContain(credentials.selectedKey);
  });

  test("bootstrap never returns an authenticated identity when upstream verification fails", async () => {
    const { id } = await account();
    jest.mocked(fetch).mockResolvedValueOnce(upstreamResponse(undefined, 502));
    const response = await GET(request("bootstrap", { id }), context("bootstrap"));
    expect(response.status).toBe(502);
    expect((await response.json()).success).toBe(false);
  });

  test("workspace status uses local flags without contacting the upstream", async () => {
    const route = "status?scope=workspace";
    const response = await GET(request(route), context(route));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).data).toMatchObject({
      enabled: true,
      configured: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("ordinary status still reads login and challenge settings", async () => {
    jest.mocked(fetch).mockResolvedValueOnce(
      upstreamResponse({
        password_login_enabled: true,
        turnstile_check: true,
        turnstile_site_key: "public-site-key",
      }),
    );
    const response = await GET(request("status"), context("status"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      passwordLoginEnabled: true,
      turnstileSiteKey: "public-site-key",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each(["rename", "secret"])(
    "next login recovers after failed %s even with another key present",
    async (failure) => {
      let created: any;
      let failing = true;
      let createCount = 0;
      jest.mocked(fetch).mockImplementation(async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/status")
          return upstreamResponse({ password_login_enabled: true });
        if (path === "/api/user/login") return loginResponse();
        if (path === "/api/user/self/groups")
          return upstreamResponse(availableGroups);
        if (path === "/api/token/" && options?.method === "POST") {
          createCount++;
          created = { ...JSON.parse(String(options.body)), id: 88, status: 1 };
          return upstreamResponse();
        }
        if (path === "/api/token/" && options?.method === "PUT") {
          if (failing && failure === "rename")
            throw Error("Temporary rename failure");
          Object.assign(created, JSON.parse(String(options.body)));
          return upstreamResponse();
        }
        if (path === "/api/token/")
          return upstreamResponse({
            items: created ? [created, token] : [],
            total: created ? 2 : 0,
          });
        if (path === "/api/token/88") return upstreamResponse(created);
        if (path === "/api/token/88/key") {
          if (failing && failure === "secret")
            throw Error("Temporary secret read failure");
          return upstreamResponse({ key: "recovered-private-key" });
        }
        throw Error(`Unexpected path ${path}`);
      });
      expect((await (await login()).json()).data.selectedTokenId).toBeNull();
      expect(created.name).toMatch(
        failure === "rename" ? /^系统创建-/ : /^系统创建$/,
      );
      failing = false;
      const second = await login();
      expect((await second.json()).data.selectedTokenId).toBe(88);
      expect(created.name).toBe("系统创建");
      expect(createCount).toBe(1);
      expect(
        (await readSessionById(second.cookies.get(SESSION_COOKIE)!.value))
          ?.selectedKey,
      ).toBe("sk-recovered-private-key");
    },
  );

  test.each(["login", "login-2fa"])(
    "%s creates and selects the initial Auto key without exposing its secret",
    async (route) => {
      let created: any;
      let createCount = 0;
      jest.mocked(fetch).mockImplementation(async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/status")
          return upstreamResponse({ password_login_enabled: true });
        if (path === "/api/user/login" || path === "/api/user/login/verify")
          return loginResponse();
        if (path === "/api/user/self/groups")
          return upstreamResponse(availableGroups);
        if (path === "/api/token/" && options?.method === "POST") {
          createCount++;
          created = { ...JSON.parse(String(options.body)), id: 88, status: 1 };
          return upstreamResponse();
        }
        if (path === "/api/token/" && options?.method === "PUT") {
          Object.assign(created, JSON.parse(String(options.body)));
          return upstreamResponse();
        }
        if (path === "/api/token/")
          return upstreamResponse({
            items: created ? [created] : [],
            total: created ? 1 : 0,
          });
        if (path === "/api/token/88") return upstreamResponse(created);
        if (path === "/api/token/88/key")
          return upstreamResponse({ key: "initial-private-key" });
        throw Error(`Unexpected path ${path}`);
      });
      const pending =
        route === "login-2fa"
          ? await createSession(request("login"), NextResponse.json({}), {
              flowToken: "pending-login",
              flowExpiresAt: Date.now() / 1000 + 300,
            })
          : undefined;
      const response = await POST(
        request(route, {
          method: "POST",
          id: pending?.id,
          body:
            route === "login"
              ? { username: user.username, password: "private-password" }
              : { code: "123456" },
        }),
        context(route),
      );
      const json = await response.json();
      expect(response.status).toBe(200);
      expect(json.data.selectedTokenId).toBe(88);
      expect(JSON.stringify(json)).not.toMatch(
        /initial-private-key|private-password|private-login-token/,
      );
      expect(createCount).toBe(1);
      expect(created).toMatchObject({
        name: "系统创建",
        group: "auto",
        auto_groups: [],
        unlimited_quota: true,
        expired_time: -1,
      });
      const saved = await readSessionById(
        response.cookies.get(SESSION_COOKIE)!.value,
      );
      expect(saved?.selectedKey).toBe("sk-initial-private-key");
    },
  );

  test("logs in without exposing dashboard credentials or storing the password", async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        upstreamResponse({ password_login_enabled: true }),
      );
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(upstreamResponse({ items: [], total: 0 }));
    const response = await POST(
      request("login", {
        method: "POST",
        body: { username: user.username, password: "private-password" },
      }),
      context("login"),
    );
    const data = await response.json();
    const id = response.cookies.get(SESSION_COOKIE)?.value;

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: { authenticated: true, user, selectedTokenId: null },
    });
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const saved = await readSessionById(id!);
    expect(saved?.accessToken).toBe(credentials.accessToken);
    expect(JSON.stringify(saved)).not.toContain("private-password");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(
      JSON.parse(jest.mocked(fetch).mock.calls[1][1]?.body as string),
    ).toEqual({ username: user.username, password: "private-password" });
    expect(jest.mocked(fetch).mock.calls[2][0]).toBe(
      "https://accounts.example.test/api/token/?p=1&page_size=2",
    );
    expect(tokenMutations()).toEqual([]);
  });

  test("completes an MFA flow by replacing its temporary cookie with a login session", async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(upstreamResponse({ password_login_enabled: true }))
      .mockResolvedValueOnce(
        upstreamResponse({
          require_verification: true,
          methods: [{ method: "2fa", available: true }],
          flow_token: "temporary-verification-flow",
          expires_at: Math.floor(Date.now() / 1000) + 300,
        }),
      );
    const login = await POST(
      request("login", {
        method: "POST",
        body: { username: user.username, password: "private-password" },
      }),
      context("login"),
    );
    const pendingId = login.cookies.get(SESSION_COOKIE)?.value;
    expect(await login.json()).toEqual({
      success: true,
      data: { requires2fa: true },
    });
    expect((await readSessionById(pendingId!))?.accessToken).toBeUndefined();
    const pendingSession = await GET(
      request("session", { id: pendingId }),
      context("session"),
    );
    expect((await pendingSession.json()).data.authenticated).toBe(false);

    jest
      .mocked(fetch)
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(upstreamResponse({ items: [], total: 0 }));
    const verified = await POST(
      request("login-2fa", {
        method: "POST",
        id: pendingId,
        body: { code: "123456" },
      }),
      context("login-2fa"),
    );
    const verifiedId = verified.cookies.get(SESSION_COOKIE)?.value;
    expect(verified.status).toBe(200);
    expect((await verified.json()).data.authenticated).toBe(true);
    expect(verifiedId).not.toBe(pendingId);
    expect(await readSessionById(pendingId!)).toBeNull();
    expect((await readSessionById(verifiedId!))?.user?.id).toBe(user.id);
    expect(
      JSON.parse(jest.mocked(fetch).mock.calls[2][1]?.body as string),
    ).toEqual({
      flow_token: "temporary-verification-flow",
      method: "2fa",
      code: "123456",
    });
    expect(tokenMutations()).toEqual([]);
  });

  test.each([
    { name: "默认聊天密钥", group: "" },
    { name: "My personal chat key", group: "" },
    { name: "Auto chat key", group: "auto" },
  ])(
    "selects the sole system key named $name without exposing its secret",
    async ({ name, group }) => {
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          upstreamResponse({ password_login_enabled: true }),
        )
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(
          upstreamResponse({
            items: [{ ...singleDefaultToken, name, group }],
            total: 1,
          }),
        )
        .mockResolvedValueOnce(upstreamResponse({ key: "single-private-key" }));

      const response = await login();
      const data = await response.json();
      const id = response.cookies.get(SESSION_COOKIE)?.value;

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        data: {
          authenticated: true,
          user,
          selectedTokenId: singleDefaultToken.id,
        },
      });
      expect((await readSessionById(id!))?.selectedKey).toBe(
        "sk-single-private-key",
      );
      expect(JSON.stringify(data)).not.toContain("single-private-key");
      expect(jest.mocked(fetch).mock.calls[2][0]).toBe(
        "https://accounts.example.test/api/token/?p=1&page_size=2",
      );
      expect(tokenMutations()).toEqual([
        ["https://accounts.example.test/api/token/41/key", "POST"],
      ]);
      const headers = new Headers(jest.mocked(fetch).mock.calls[3][1]?.headers);
      expect(headers.get("authorization")).toBe(
        `Bearer ${credentials.accessToken}`,
      );
      expect(headers.get("cookie")).toBeNull();
    },
  );

  test.each([
    { name: "explicit group", changes: { group: "default" } },
    {
      name: "custom automatic group",
      changes: { group: "auto", auto_groups: ["premium"] },
    },
    { name: "limited quota", changes: { unlimited_quota: false } },
    {
      name: "positive but finite quota",
      changes: { unlimited_quota: false, remain_quota: 100 },
    },
    { name: "disabled key", changes: { status: 2 } },
    { name: "expired status", changes: { status: 3 } },
    { name: "exhausted status", changes: { status: 4 } },
    { name: "expired key", changes: { expired_time: 1 } },
    {
      name: "future expiry instead of never",
      changes: { expired_time: Math.floor(Date.now() / 1000) + 86400 },
    },
  ])(
    "does not select or recreate a sole key with $name",
    async ({ changes }) => {
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          upstreamResponse({ password_login_enabled: true }),
        )
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(
          upstreamResponse({
            items: [{ ...singleDefaultToken, ...changes }],
            total: 1,
          }),
        );

      const response = await login();
      const data = await response.json();
      const id = response.cookies.get(SESSION_COOKIE)?.value;

      expect(response.status).toBe(200);
      expect(data.data).toEqual({
        authenticated: true,
        user,
        selectedTokenId: null,
      });
      expect((await readSessionById(id!))?.selectedKey).toBeUndefined();
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(tokenMutations()).toEqual([]);
    },
  );

  test.each([
    {
      name: "multiple eligible keys",
      items: [
        singleDefaultToken,
        { ...singleDefaultToken, id: singleDefaultToken.id + 1 },
      ],
      total: 2,
    },
    {
      name: "one eligible key among multiple keys",
      items: [singleDefaultToken, token],
      total: 2,
    },
    {
      name: "more keys than the returned page",
      items: [singleDefaultToken],
      total: 101,
    },
    { name: "null total", items: [singleDefaultToken], total: null },
    { name: "string total", items: [singleDefaultToken], total: "1" },
    { name: "missing total", items: [singleDefaultToken], total: undefined },
    { name: "zero total with an item", items: [singleDefaultToken], total: 0 },
    { name: "one total with no items", items: [], total: 1 },
    {
      name: "one total with multiple items",
      items: [singleDefaultToken, token],
      total: 1,
    },
    { name: "malformed list results", items: null, total: 1 },
  ])(
    "keeps login successful without provisioning a key for $name",
    async ({ items, total }) => {
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          upstreamResponse({ password_login_enabled: true }),
        )
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(upstreamResponse({ items, total }));

      const response = await login();
      expect(response.status).toBe(200);
      expect((await response.json()).data.selectedTokenId).toBeNull();
      expect(tokenMutations()).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );

  test.each([404, 502])(
    "keeps login successful when the initial key list returns %i",
    async (status) => {
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          upstreamResponse({ password_login_enabled: true }),
        )
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(upstreamResponse(undefined, status));

      const response = await login();
      expect(response.status).toBe(200);
      expect((await response.json()).data.selectedTokenId).toBeNull();
      expect(tokenMutations()).toEqual([]);
    },
  );

  test("keeps login successful when the sole key is deleted between listing and secret retrieval", async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(upstreamResponse({ password_login_enabled: true }))
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        upstreamResponse({ items: [singleDefaultToken], total: 1 }),
      )
      .mockResolvedValueOnce(upstreamResponse(undefined, 404));

    const response = await login();
    const id = response.cookies.get(SESSION_COOKIE)?.value;

    expect(response.status).toBe(200);
    expect((await response.json()).data.selectedTokenId).toBeNull();
    expect((await readSessionById(id!))?.selectedKey).toBeUndefined();
    expect(tokenMutations()).toEqual([
      ["https://accounts.example.test/api/token/41/key", "POST"],
    ]);
  });

  test("also selects the sole default route after MFA without depending on its name", async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(upstreamResponse({ password_login_enabled: true }))
      .mockResolvedValueOnce(
        upstreamResponse({
          require_verification: true,
          methods: [{ method: "2fa", available: true }],
          flow_token: "default-key-verification",
          expires_at: Math.floor(Date.now() / 1000) + 300,
        }),
      );
    const pending = await login();
    const pendingId = pending.cookies.get(SESSION_COOKIE)?.value;
    expect(fetch).toHaveBeenCalledTimes(2);
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        upstreamResponse({
          items: [{ ...singleDefaultToken, name: "我的首个密钥" }],
          total: 1,
        }),
      )
      .mockResolvedValueOnce(upstreamResponse({ key: "sk-mfa-default-key" }));

    const response = await POST(
      request("login-2fa", {
        method: "POST",
        id: pendingId,
        body: { code: "123456" },
      }),
      context("login-2fa"),
    );
    const data = await response.json();
    const id = response.cookies.get(SESSION_COOKIE)?.value;

    expect(response.status).toBe(200);
    expect(data.data.selectedTokenId).toBe(singleDefaultToken.id);
    expect((await readSessionById(id!))?.selectedKey).toBe(
      "sk-mfa-default-key",
    );
    expect(JSON.stringify(data)).not.toContain("sk-mfa-default-key");
    expect(jest.mocked(fetch).mock.calls[3][0]).toBe(
      "https://accounts.example.test/api/token/?p=1&page_size=2",
    );
    expect(tokenMutations()).toEqual([
      ["https://accounts.example.test/api/token/41/key", "POST"],
    ]);
  });

  test.each([
    { name: "no keys and no Auto permission", items: [], total: 0 },
    { name: "multiple keys", items: [singleDefaultToken, token], total: 2 },
    { name: "string total", items: [singleDefaultToken], total: "1" },
    { name: "null total", items: [singleDefaultToken], total: null },
    {
      name: "disabled key",
      items: [{ ...singleDefaultToken, status: 2 }],
      total: 1,
    },
    { name: "failed key list", items: [], total: 0, status: 502 },
  ])(
    "completes MFA with no selection and no token mutation for $name",
    async ({ items, total, status }) => {
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          upstreamResponse({ password_login_enabled: true }),
        )
        .mockResolvedValueOnce(
          upstreamResponse({
            require_verification: true,
            methods: [{ method: "2fa", available: true }],
            flow_token: "mfa-no-auto-selection",
            expires_at: Math.floor(Date.now() / 1000) + 300,
          }),
        );
      const pending = await login();
      const pendingId = pending.cookies.get(SESSION_COOKIE)?.value;
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(loginResponse())
        .mockResolvedValueOnce(upstreamResponse({ items, total }, status));
      const triesAuto = !status && total === 0 && items.length === 0;
      if (triesAuto)
        jest.mocked(fetch).mockResolvedValueOnce(upstreamResponse({}));

      const response = await POST(
        request("login-2fa", {
          method: "POST",
          id: pendingId,
          body: { code: "123456" },
        }),
        context("login-2fa"),
      );
      const id = response.cookies.get(SESSION_COOKIE)?.value;

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        authenticated: true,
        user,
        selectedTokenId: null,
      });
      expect((await readSessionById(id!))?.selectedKey).toBeUndefined();
      expect(tokenMutations()).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(triesAuto ? 5 : 4);
    },
  );

  test("does not submit a password when upstream password login is disabled", async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        upstreamResponse({ password_login_enabled: false }),
      );
    const response = await POST(
      request("login", {
        method: "POST",
        body: { username: user.username, password: "private-password" },
      }),
      context("login"),
    );

    expect(response.status).toBe(400);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each(["login", "tokens", "tokens/23/select", "logout"])(
    "rejects an external-origin mutation of %s before contacting New API",
    async (route) => {
      const response = await POST(
        request(route, {
          method: "POST",
          origin: "https://attacker.example.test",
          body: {},
        }),
        context(route),
      );

      expect(response.status).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test("returns only the authenticated user's key metadata", async () => {
    const created = await account();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(upstreamResponse({ items: [token], total: 1 }));
    const response = await GET(
      request("tokens", { id: created.id }),
      context("tokens"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.items).toHaveLength(1);
    expect(data.data.items[0].id).toBe(token.id);
    expect(data.data.items[0]).not.toHaveProperty("key");
    expect(data.data.items[0]).not.toHaveProperty("user_id");
    expect(JSON.stringify(data)).not.toContain(token.key);
    const [url, options] = jest.mocked(fetch).mock.calls[0];
    expect(url).toBe(
      "https://accounts.example.test/api/token/?p=1&page_size=20",
    );
    expect(new Headers(options?.headers).get("authorization")).toBe(
      `Bearer ${credentials.accessToken}`,
    );
    expect(new Headers(options?.headers).get("new-api-user")).toBeNull();
  });

  test("maps native automatic group defaults and maximum without changing their order", async () => {
    const created = await account();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(upstreamResponse(autoGroupSettings));

    const response = await GET(
      request("auto-groups", { id: created.id }),
      context("auto-groups"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        supported: true,
        defaultGroups: ["premium", "default"],
        maxCount: 2,
      },
    });
    expect(jest.mocked(fetch).mock.calls[0][0]).toBe(
      "https://accounts.example.test/api/token/auto-groups",
    );
    expect(
      new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers).get(
        "authorization",
      ),
    ).toBe(`Bearer ${credentials.accessToken}`);
  });

  test("reports native group routing as unsupported only for an upstream 404", async () => {
    const created = await account();
    jest.mocked(fetch).mockResolvedValueOnce(upstreamResponse(undefined, 404));

    const response = await GET(
      request("auto-groups", { id: created.id }),
      context("auto-groups"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { supported: false, defaultGroups: [], maxCount: 0 },
    });
  });

  test.each([401, 502])(
    "does not hide an upstream %i as unsupported automatic groups",
    async (status) => {
      const created = await account();
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(upstreamResponse(undefined, status));

      const response = await GET(
        request("auto-groups", { id: created.id }),
        context("auto-groups"),
      );

      expect(response.status).toBe(status);
      expect((await response.json()).success).toBe(false);
      expect(await readSessionById(created.id)).toEqual(
        status === 401 ? null : created.session,
      );
    },
  );

  test.each([
    { groups: "default", max_count: 2 },
    { groups: [1], max_count: 2 },
    { groups: ["default"], max_count: 0 },
    { groups: ["default"], max_count: 1.5 },
  ])(
    "rejects invalid upstream automatic group settings %j",
    async (settings) => {
      const created = await account();
      jest.mocked(fetch).mockResolvedValueOnce(upstreamResponse(settings));

      const response = await GET(
        request("auto-groups", { id: created.id }),
        context("auto-groups"),
      );

      expect(response.status).toBe(502);
      expect((await response.json()).success).toBe(false);
    },
  );

  test("does not initialize or replace a default key while reading account state", async () => {
    const created = await createSession(
      request("login", { method: "POST" }),
      NextResponse.json({}),
      {
        ...credentials,
        selectedTokenId: undefined,
        selectedKey: undefined,
      },
    );
    jest.mocked(fetch).mockResolvedValueOnce(upstreamResponse(user));

    const response = await GET(
      request("session", { id: created.id }),
      context("session"),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.selectedTokenId).toBeNull();
    expect(jest.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      "https://accounts.example.test/api/user/self",
    ]);
    expect(tokenMutations()).toEqual([]);
    expect((await readSessionById(created.id))?.selectedKey).toBeUndefined();
  });

  test("selects a key server-side and returns its ID only", async () => {
    const created = await account();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(upstreamResponse(token))
      .mockResolvedValueOnce(upstreamResponse({ key: "new-private-key" }));
    const response = await POST(
      request("tokens/23/select", {
        method: "POST",
        id: created.id,
        body: {},
      }),
      context("tokens/23/select"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { selectedTokenId: 23 },
    });
    expect((await readSessionById(created.id))?.selectedKey).toBe(
      "sk-new-private-key",
    );
    for (const [, options] of jest.mocked(fetch).mock.calls) {
      const headers = new Headers(options?.headers);
      expect(headers.get("authorization")).toBe(
        `Bearer ${credentials.accessToken}`,
      );
      expect(headers.get("cookie")).toBeNull();
    }
  });

  test.each([
    { status: 2 },
    { expired_time: Math.floor(Date.now() / 1000) - 60 },
    { remain_quota: 0 },
  ])(
    "rejects an unusable token %j before retrieving its secret",
    async (change) => {
      const created = await account();
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(upstreamResponse({ ...token, ...change }));
      const response = await POST(
        request("tokens/23/select", {
          method: "POST",
          id: created.id,
          body: {},
        }),
        context("tokens/23/select"),
      );

      expect(response.status).toBe(400);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((await readSessionById(created.id))?.selectedKey).toBe(
        credentials.selectedKey,
      );
    },
  );

  test("does not fetch a secret after New API rejects token ownership", async () => {
    const created = await account();
    jest.mocked(fetch).mockResolvedValueOnce(upstreamResponse(undefined, 403));
    const response = await POST(
      request("tokens/99/select", {
        method: "POST",
        id: created.id,
        body: {},
      }),
      context("tokens/99/select"),
    );

    expect(response.status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await readSessionById(created.id))?.selectedTokenId).toBe(23);
  });

  test("cannot override the token owner or inject a key while creating a token", async () => {
    const created = await account();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(upstreamResponse(availableGroups))
      .mockResolvedValueOnce(upstreamResponse());
    const response = await POST(
      request("tokens", {
        method: "POST",
        id: created.id,
        body: {
          name: "New chat key",
          group: "default",
          remain_quota: 100,
          expired_time: -1,
          user_id: 99,
          id: 99,
          key: "injected-key",
        },
      }),
      context("tokens"),
    );
    const forwarded = forwardedBody(1);

    expect(response.status).toBe(200);
    expect(jest.mocked(fetch).mock.calls[0][0]).toBe(
      "https://accounts.example.test/api/user/self/groups",
    );
    expect(forwarded.name).toBe("New chat key");
    expect(forwarded).not.toHaveProperty("user_id");
    expect(forwarded).not.toHaveProperty("id");
    expect(forwarded).not.toHaveProperty("key");
  });

  test("creates an inherited default route without querying explicit groups", async () => {
    const created = await account();
    jest.mocked(fetch).mockResolvedValueOnce(upstreamResponse());

    const response = await POST(
      request("tokens", {
        method: "POST",
        id: created.id,
        body: {
          name: "Inherited chat key",
          group: "",
          unlimited_quota: true,
          expired_time: -1,
          auto_groups: [],
        },
      }),
      context("tokens"),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jest.mocked(fetch).mock.calls[0][0]).toBe(
      "https://accounts.example.test/api/token/",
    );
    expect(forwardedBody(0)).toMatchObject({
      name: "Inherited chat key",
      group: "",
      unlimited_quota: true,
      expired_time: -1,
      auto_groups: [],
      cross_group_retry: false,
    });
  });

  test.each([{ autoGroups: ["premium", "default"] }, { autoGroups: [] }])(
    "creates native group routing with ordered/default groups %j",
    async ({ autoGroups }) => {
      const created = await account();
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(upstreamResponse(availableGroups))
        .mockResolvedValueOnce(upstreamResponse(autoGroupSettings))
        .mockResolvedValueOnce(upstreamResponse());

      const response = await POST(
        request("tokens", {
          method: "POST",
          id: created.id,
          body: {
            name: "Multiple groups",
            group: "auto",
            auto_groups: autoGroups,
            cross_group_retry: false,
            unlimited_quota: true,
            expired_time: -1,
          },
        }),
        context("tokens"),
      );

      expect(response.status).toBe(200);
      expect(jest.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(
        [
          "https://accounts.example.test/api/user/self/groups",
          "https://accounts.example.test/api/token/auto-groups",
          "https://accounts.example.test/api/token/",
        ],
      );
      expect(forwardedBody(2)).toMatchObject({
        group: "auto",
        auto_groups: autoGroups,
        cross_group_retry: false,
      });
    },
  );

  test("does not allow a newly created key to enable cross-group retry", async () => {
    const created = await account();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(upstreamResponse(availableGroups))
      .mockResolvedValueOnce(upstreamResponse(autoGroupSettings))
      .mockResolvedValueOnce(upstreamResponse());

    const response = await POST(
      request("tokens", {
        method: "POST",
        id: created.id,
        body: {
          name: "Retry injection",
          group: "auto",
          auto_groups: ["premium"],
          cross_group_retry: true,
        },
      }),
      context("tokens"),
    );

    expect(response.status).toBe(200);
    expect(forwardedBody(2).cross_group_retry).toBe(false);
  });

  test.each([
    { name: "non-string group", body: { group: 1 } },
    { name: "spaced group", body: { group: " default " } },
    { name: "non-array groups", body: { auto_groups: "premium" } },
    { name: "object groups", body: { auto_groups: { 0: "premium" } } },
    { name: "non-string member", body: { auto_groups: [1] } },
    { name: "empty member", body: { auto_groups: [""] } },
    { name: "nested auto group", body: { auto_groups: ["auto"] } },
    {
      name: "duplicate members",
      body: { auto_groups: ["premium", "premium"] },
    },
    { name: "spaced member", body: { auto_groups: [" premium"] } },
    { name: "invalid retry type", body: { cross_group_retry: "false" } },
  ])("rejects $name before contacting upstream", async ({ body }) => {
    const created = await account();

    const response = await POST(
      request("tokens", {
        method: "POST",
        id: created.id,
        body: { name: "Invalid groups", group: "auto", ...body },
      }),
      context("tokens"),
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "explicit group absent from the account",
      groups: availableGroups,
      group: "admin-only",
      selected: [],
      calls: 1,
    },
    {
      name: "automatic routing absent from the account",
      groups: { default: availableGroups.default },
      group: "auto",
      selected: ["default"],
      calls: 1,
    },
    {
      name: "selected group absent from the account",
      groups: availableGroups,
      group: "auto",
      selected: ["admin-only"],
      calls: 2,
    },
    {
      name: "too many selected groups",
      groups: availableGroups,
      group: "auto",
      selected: ["premium", "default", "economy"],
      calls: 2,
    },
  ])(
    "rejects $name without creating a token",
    async ({ groups, group, selected, calls }) => {
      const created = await account();
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(upstreamResponse(groups))
        .mockResolvedValueOnce(upstreamResponse(autoGroupSettings));

      const response = await POST(
        request("tokens", {
          method: "POST",
          id: created.id,
          body: { name: "Unavailable groups", group, auto_groups: selected },
        }),
        context("tokens"),
      );

      expect(response.status).toBe(400);
      expect(fetch).toHaveBeenCalledTimes(calls);
      expect(tokenMutations()).toEqual([]);
    },
  );

  test.each([404, 502])(
    "does not create an automatic key when native group settings return %i",
    async (status) => {
      const created = await account();
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(upstreamResponse(availableGroups))
        .mockResolvedValueOnce(upstreamResponse(undefined, status));

      const response = await POST(
        request("tokens", {
          method: "POST",
          id: created.id,
          body: { name: "Unavailable routing", group: "auto", auto_groups: [] },
        }),
        context("tokens"),
      );

      expect(response.status).toBe(status);
      expect(tokenMutations()).toEqual([]);
    },
  );

  test("updates the authorized path token instead of a client-supplied token ID", async () => {
    const created = await account();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(upstreamResponse(token))
      .mockResolvedValueOnce(upstreamResponse());
    const response = await PUT(
      request("tokens/23", {
        method: "PUT",
        id: created.id,
        body: { id: 99, user_id: 99, name: "Updated key" },
      }),
      context("tokens/23"),
    );
    const forwarded = JSON.parse(
      jest.mocked(fetch).mock.calls[1][1]?.body as string,
    );

    expect(response.status).toBe(200);
    expect(forwarded.id).toBe(23);
    expect(forwarded.name).toBe("Updated key");
    expect(forwarded).not.toHaveProperty("user_id");
  });

  test("preserves legacy single-group routing fields and IP restrictions when unchanged", async () => {
    const created = await account();
    const legacy = {
      ...token,
      allow_ips: "192.0.2.1\n198.51.100.0/24",
      cross_group_retry: true,
      auto_groups: ["economy", "premium"],
    };
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(upstreamResponse(legacy))
      .mockResolvedValueOnce(upstreamResponse());

    const response = await PUT(
      request("tokens/23", {
        method: "PUT",
        id: created.id,
        body: { name: "Renamed legacy", group: "default", allow_ips: "" },
      }),
      context("tokens/23"),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(forwardedBody(1)).toMatchObject({
      name: "Renamed legacy",
      group: "default",
      allow_ips: legacy.allow_ips,
      cross_group_retry: true,
      auto_groups: ["economy", "premium"],
    });
  });

  test.each([
    { auto_groups: [], supplied: true },
    { auto_groups: undefined, supplied: false },
  ])(
    "keeps an existing automatic key on the backend default list %j",
    async ({ auto_groups, supplied }) => {
      const created = await account();
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(
          upstreamResponse({ ...token, group: "auto", auto_groups }),
        )
        .mockResolvedValueOnce(upstreamResponse());

      const response = await PUT(
        request("tokens/23", {
          method: "PUT",
          id: created.id,
          body: {
            name: "Keep automatic defaults",
            ...(supplied ? { auto_groups: [] } : {}),
          },
        }),
        context("tokens/23"),
      );

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(forwardedBody(1)).toMatchObject({
        group: "auto",
        auto_groups: [],
      });
    },
  );

  test.each([
    { from: "default", to: "", validation: false },
    { from: "auto", to: "default", validation: true },
  ])(
    "clears automatic routing when changing $from to $to",
    async ({ from, to, validation }) => {
      const created = await account();
      jest.mocked(fetch).mockResolvedValueOnce(
        upstreamResponse({
          ...token,
          group: from,
          auto_groups: ["premium"],
          cross_group_retry: true,
          allow_ips: "192.0.2.3",
        }),
      );
      if (validation) {
        jest
          .mocked(fetch)
          .mockResolvedValueOnce(upstreamResponse(availableGroups));
      }
      jest.mocked(fetch).mockResolvedValueOnce(upstreamResponse());

      const response = await PUT(
        request("tokens/23", {
          method: "PUT",
          id: created.id,
          body: {
            name: "Changed route",
            group: to,
            auto_groups: ["premium"],
            cross_group_retry: true,
          },
        }),
        context("tokens/23"),
      );

      expect(response.status).toBe(200);
      expect(forwardedBody(validation ? 2 : 1)).toMatchObject({
        group: to,
        auto_groups: [],
        cross_group_retry: false,
        allow_ips: "192.0.2.3",
      });
      expect(fetch).toHaveBeenCalledTimes(validation ? 3 : 2);
    },
  );

  test("disables legacy cross-group retry when switching a single-group key to automatic routing", async () => {
    const created = await account();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        upstreamResponse({
          ...token,
          cross_group_retry: true,
          auto_groups: ["economy"],
          allow_ips: "192.0.2.8",
        }),
      )
      .mockResolvedValueOnce(upstreamResponse(availableGroups))
      .mockResolvedValueOnce(upstreamResponse(autoGroupSettings))
      .mockResolvedValueOnce(upstreamResponse());

    const response = await PUT(
      request("tokens/23", {
        method: "PUT",
        id: created.id,
        body: {
          group: "auto",
          auto_groups: ["premium", "default"],
          cross_group_retry: true,
        },
      }),
      context("tokens/23"),
    );

    expect(response.status).toBe(200);
    expect(jest.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      "https://accounts.example.test/api/token/23",
      "https://accounts.example.test/api/user/self/groups",
      "https://accounts.example.test/api/token/auto-groups",
      "https://accounts.example.test/api/token/",
    ]);
    expect(forwardedBody(3)).toMatchObject({
      group: "auto",
      auto_groups: ["premium", "default"],
      cross_group_retry: false,
      allow_ips: "192.0.2.8",
    });
  });

  test("validates permission and ordering when editing an automatic key's groups", async () => {
    const created = await account();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        upstreamResponse({
          ...token,
          group: "auto",
          auto_groups: ["default", "premium"],
          cross_group_retry: true,
        }),
      )
      .mockResolvedValueOnce(upstreamResponse(availableGroups))
      .mockResolvedValueOnce(upstreamResponse(autoGroupSettings))
      .mockResolvedValueOnce(upstreamResponse());

    const response = await PUT(
      request("tokens/23", {
        method: "PUT",
        id: created.id,
        body: { group: "auto", auto_groups: ["premium", "default"] },
      }),
      context("tokens/23"),
    );

    expect(response.status).toBe(200);
    expect(forwardedBody(3)).toMatchObject({
      group: "auto",
      auto_groups: ["premium", "default"],
      cross_group_retry: true,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  test.each(["PATCH", "DELETE"])(
    "clears the selected model credential when %s disables or deletes it",
    async (method) => {
      const created = await account();
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(upstreamResponse(token))
        .mockResolvedValueOnce(upstreamResponse());
      const route = method === "PATCH" ? PATCH : DELETE;
      const response = await route(
        request("tokens/23", {
          method,
          id: created.id,
          ...(method === "PATCH" ? { body: { status: 2 } } : {}),
        }),
        context("tokens/23"),
      );

      expect(response.status).toBe(200);
      const saved = await readSessionById(created.id);
      expect(saved?.selectedTokenId).toBeUndefined();
      expect(saved?.selectedKey).toBeUndefined();
    },
  );

  test("always removes the local session when upstream logout is unavailable", async () => {
    const created = await account();
    jest.mocked(fetch).mockRejectedValueOnce(new Error("Network unavailable"));
    const response = await POST(
      request("logout", {
        method: "POST",
        id: created.id,
        body: {},
      }),
      context("logout"),
    );

    expect(response.status).toBe(200);
    expect(await readSessionById(created.id)).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("does not log out the current user when a stale browser tab expects another account", async () => {
    const created = await account();
    const req = request("logout", {
      method: "POST",
      id: created.id,
      body: {},
    });
    req.headers.set("x-new-api-user", "29");
    const response = await POST(req, context("logout"));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("NEW_API_ACCOUNT_CHANGED");
    expect(fetch).not.toHaveBeenCalled();
    expect(await readSessionById(created.id)).toEqual(created.session);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("does not delete a key when a stale browser tab expects another account", async () => {
    const created = await account();
    const req = request("tokens/23", {
      method: "DELETE",
      id: created.id,
    });
    req.headers.set("x-new-api-user", "29");
    const response = await DELETE(req, context("tokens/23"));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("NEW_API_ACCOUNT_CHANGED");
    expect(fetch).not.toHaveBeenCalled();
    expect(await readSessionById(created.id)).toEqual(created.session);
  });
});


test("model pricing requires the current account and returns private group-aware rates", async () => {
  const route = "model-pricing";
  expect((await GET(request(route), context(route))).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
  const { id } = await account();
  const mismatch = request(route, { id });
  mismatch.headers.set("x-new-api-user", "999");
  expect((await GET(mismatch, context(route))).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
  jest.mocked(fetch).mockImplementation(async (input, options) => {
    if (String(input).endsWith("/api/status")) return upstreamResponse({quota_display_type: "CUSTOM", custom_currency_symbol: "✦", custom_currency_exchange_rate: 1});
    expect(String(input)).toBe("https://accounts.example.test/api/pricing");
    expect(new Headers(options?.headers).get("authorization")).toBe(`Bearer ${credentials.accessToken}`);
    expect(options?.cache).toBe("no-store");
    return Response.json({success: true, group_ratio: { default: 0.04 }, data: [{model_name: "gpt-image-2.6", enable_groups: ["all"], billing_mode: "tiered_expr", billing_expr: 'tier("base", fixed(0.25))'}]});
  });
  const response = await GET(request(route, { id }), context(route));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const payload = await response.json();
  expect(payload.data).toMatchObject({userId: user.id, walletUrl: "https://accounts.example.test/wallet", pricingUrl: "https://accounts.example.test/pricing", rows: [{model: "gpt-image-2.6", group: "default", price: "✦ 0.01"}]});
  expect(JSON.stringify(payload)).not.toContain(credentials.accessToken);
  expect(JSON.stringify(payload)).not.toContain(credentials.refreshToken);
});
