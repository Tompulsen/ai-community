/** @jest-environment node */
import { createHash } from "node:crypto";
import { jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";

const values = new Map<string, string>();
class Redis {
  status = "ready";
  on() {}
  async get(key: string) { return values.get(key) ?? null; }
  async set(key: string, value: string, ...options: unknown[]) {
    if (options.includes("NX") && values.has(key)) return null;
    values.set(key, value);
    return "OK";
  }
  async del(key: string) { return Number(values.delete(key)); }
  async eval(_script: string, count: number, ...args: string[]) {
    if (count === 1) return values.get(args[0]) === args[1] ? Number(values.delete(args[0])) : 0;
    if (args[0].startsWith("octopus:new-api:lock:")) {
      const [lock, key, owner, value] = args;
      if (values.get(lock) !== owner) return 0;
      values.set(key, value);
      return 1;
    }
    const [key, generationKey, generation, id] = args;
    if (values.get(generationKey) !== generation) return [0, ""];
    const previous = values.get(key) || "";
    values.set(key, id);
    values.delete(generationKey);
    return [1, previous];
  }
}
jest.unstable_mockModule("ioredis", () => ({ default: Redis }));
const { handleCommunityEmbed } = await import("../app/lib/new-api/community-embed");
const { SESSION_COOKIE, createSession, deleteSession, readSessionById } = await import("../app/lib/new-api/session");
const { bindingForRequest, embeddedCookie } = await import("../app/lib/new-api/community-embed-validation");
const originalEnv = process.env, originalFetch = global.fetch;
const origin = "https://community.example.test", issuer = "https://accounts.example.test";
const context = "a".repeat(43), code = "b".repeat(43);
const user = { id: 17, username: "test", display_name: "Test", quota: 100, used_quota: 0, request_count: 0, group: "default" };
const select = jest.fn<() => Promise<{ selectedTokenId: number; selectedKey: string }>>();
const hash = (v: string) => createHash("sha256").update(v).digest("base64url");
let returnTo: string, bindingValid: boolean, launchContext: string;

function handle(url: string, body?: object, headers: Record<string, string> = {}) {
  const target = new URL(url, origin);
  return handleCommunityEmbed(new NextRequest(target, {
    method: body ? "POST" : "GET",
    headers: { host: new URL(origin).host, origin, "content-type": "application/json", "x-community-embed": context, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }), target.pathname.replace("/studio/api/new-api/", ""), select);
}
function initialize(headers: Record<string, string> = {}) {
  return handle("/studio/api/new-api/community/embedded/init", { code }, headers);
}
async function login(account = user, accessExpiresAt = Date.now() / 1000 + 3600) {
  return createSession(new NextRequest(origin + "/studio/api/new-api/login"), NextResponse.json({}), {
    user: account,
    accessToken: "test-access",
    accessExpiresAt,
    refreshToken: "test-refresh",
    upstreamSessionId: "test-session",
    selectedTokenId: 23,
    selectedKey: "sk-test-user-key",
  });
}
function legacyLaunch() {
  const ticket = "t".repeat(43);
  const launch = { community: origin, issuer, studio: origin, context, kind: "image", subject: "17", userId: "testUser", tokenHash: "c".repeat(43), returnTo, generation: hash(ticket) };
  const grant = "octopus:community-embed:grant:" + hash(JSON.stringify([
    launch.community, launch.studio, launch.issuer, launch.subject, launch.userId, launch.tokenHash, launch.context,
  ]));
  values.set(grant + ":generation", launch.generation);
  values.set("octopus:community-embed:authorize:" + hash(ticket), JSON.stringify(launch));
  return { authorizationUrl: origin + "/studio/api/new-api/community/embedded/authorize?" + new URLSearchParams({ ticket, returnTo }) };
}
async function authorize() {
  const launch = legacyLaunch();
  const response = (await handle(launch.authorizationUrl, undefined, { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }))!;
  const location = new URL(response.headers.get("location")!);
  expect(location.origin).toBe(issuer);
  return { launch, response, state: location.searchParams.get("state")!, cookie: response.headers.get("set-cookie")!.split(";")[0] };
}
function callback(state: string, cookie: string) {
  return handle(`/studio/api/new-api/community/callback?state=${state}&code=${code}`, undefined, { cookie });
}

beforeEach(() => {
  values.clear();
  bindingValid = true;
  launchContext = context;
  returnTo = "/create/image?remix=work123";
  select.mockReset().mockResolvedValue({ selectedTokenId: 23, selectedKey: "sk-test-user-key" });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  process.env = { ...originalEnv, NEW_API_BASE_URL: issuer, NEW_API_PUBLIC_URL: issuer,
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters", NEW_API_REDIS_URL: "redis://test:6379/3",
    COMMUNITY_SSO_ORIGIN: origin, STUDIO_PUBLIC_ORIGIN: origin, COMMUNITY_SSO_SECRET: "test-shared-secret-with-at-least-32-characters", COMMUNITY_INTERNAL_URL: origin };
  global.fetch = jest.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/newapi/studio/exchange") return Response.json({ issuer, studio: origin, context: launchContext, kind: "image", subject: "17", userId: "testUser", tokenHash: "c".repeat(43), returnTo });
    if (path === "/api/newapi/studio/validate") return Response.json({ valid: bindingValid });
    if (path === "/api/studio-sso/token") return Response.json({ success: true, data: { user, access_token: "test-access", access_expires_at: Date.now() / 1000 + 3600, session: { sid: "test-session" } } }, { headers: { "set-cookie": "new_api_refresh=test-refresh; Path=/api/user/auth; Secure; HttpOnly" } });
    if (path === "/api/user/auth/refresh") return Response.json({ success: true, data: { user, access_token: "refreshed-access", access_expires_at: Date.now() / 1000 + 3600, session: { sid: "test-session" } } }, { headers: { "set-cookie": "new_api_refresh=rotated-refresh; Path=/api/user/auth; Secure; HttpOnly" } });
    if (path === "/api/user/self") return Response.json({ success: true, data: user });
    throw new Error("Unexpected upstream request: " + path);
  });
});
afterEach(() => { process.env = originalEnv; global.fetch = originalFetch; jest.restoreAllMocks(); });

test("one account login opens the embedded workspace without another authorization", async () => {
  const created = await login();
  const response = await initialize({ cookie: `${SESSION_COOKIE}=${created.id}` });
  expect(response?.status).toBe(200);
  expect(await response!.json()).toMatchObject({ status: "verify", subject: "17", userId: "testUser" });
  expect(response!.headers.get("set-cookie")).toContain(`${embeddedCookie(context)}=${created.id}`);
  const stored = (await readSessionById(created.id))!;
  expect(stored.refreshToken).toBe("test-refresh");
  expect(stored.communityEmbed).toBeUndefined();
  expect(stored.communityBindings?.[context]).toMatchObject({ subject: "17", userId: "testUser", context });
  const verified = await handle("/studio/api/new-api/community/embedded/verify", {}, {
    cookie: `${embeddedCookie(context)}=${created.id}`,
  });
  expect(verified?.status).toBe(200);
  expect(await verified!.json()).toMatchObject({ status: "ready", context, subject: "17" });
  expect(jest.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/api/studio-sso/token"))).toBe(false);
  expect(select).not.toHaveBeenCalled();
});

test("missing account login asks for login without creating another OAuth flow", async () => {
  const response = await initialize();
  expect(response?.status).toBe(401);
  expect(await response!.json()).toEqual({ status: "error", code: "NEW_API_LOGIN_REQUIRED" });
  expect([...values.keys()].some(key => key.startsWith("octopus:community-embed:"))).toBe(false);
});

test("a different account cannot replace the community's billing identity", async () => {
  const created = await login({ ...user, id: 18 });
  const response = await initialize({ cookie: `${SESSION_COOKIE}=${created.id}` });
  expect(response?.status).toBe(409);
  expect(await response!.json()).toEqual({ status: "error", code: "NEW_API_ACCOUNT_CHANGED" });
  expect((await readSessionById(created.id))?.communityBindings).toBeUndefined();
});

test("a revoked community session cannot bind an otherwise valid account login", async () => {
  const created = await login();
  bindingValid = false;
  const response = await initialize({ cookie: `${SESSION_COOKIE}=${created.id}` });
  expect(response?.status).toBe(401);
  expect((await readSessionById(created.id))?.communityBindings).toBeUndefined();
});

test("account logout invalidates all embedded aliases", async () => {
  const created = await login();
  await initialize({ cookie: `${SESSION_COOKIE}=${created.id}` });
  await deleteSession(new NextRequest(origin + "/studio/api/new-api/logout", {
    headers: { cookie: `${SESSION_COOKIE}=${created.id}` },
  }), NextResponse.json({}));
  const response = await handle("/studio/api/new-api/community/embedded/verify", {}, {
    cookie: `${embeddedCookie(context)}=${created.id}`,
  });
  expect(response?.status).toBe(401);
  expect(await readSessionById(created.id)).toBeNull();
});

test("revalidates community ownership on every authenticated embedded request", async () => {
  const created = await login();
  await initialize({ cookie: `${SESSION_COOKIE}=${created.id}` });
  bindingValid = false;
  const response = await handle("/studio/api/new-api/community/embedded/verify", {}, {
    cookie: `${embeddedCookie(context)}=${created.id}`,
  });
  expect(response?.status).toBe(401);
  expect(await response!.json()).toEqual({ status: "error", code: "COMMUNITY_ACCOUNT_CHANGED" });
});

test("a shared login cookie cannot invent a new community context", async () => {
  const created = await login();
  await initialize({ cookie: `${SESSION_COOKIE}=${created.id}` });
  const other = "y".repeat(43);
  const response = await handle("/studio/api/new-api/community/embedded/verify", {}, {
    "x-community-embed": other,
    cookie: `${embeddedCookie(other)}=${created.id}`,
  });
  expect(response?.status).toBe(401);
  expect(await response!.json()).toEqual({ status: "error", code: "COMMUNITY_ACCOUNT_CHANGED" });
});

test("keeps a bounded set of independently validated community contexts", async () => {
  const created = await login();
  let lastResponse: Awaited<ReturnType<typeof initialize>> = null;
  for (let index = 0; index < 17; index++) {
    launchContext = String.fromCharCode(97 + index).repeat(43);
    const response = await initialize({ cookie: `${SESSION_COOKIE}=${created.id}`, "x-community-embed": launchContext });
    expect(response?.status).toBe(200);
    lastResponse = response;
  }
  const stored = (await readSessionById(created.id))!;
  expect(Object.keys(stored.communityBindings || {})).toHaveLength(16);
  expect(stored.communityBindings?.[context]).toBeUndefined();
  expect(stored.communityBindings?.[launchContext]?.subject).toBe("17");
  expect(lastResponse!.cookies.get(embeddedCookie(context))).toMatchObject({
    value: "", maxAge: 0, secure: true, httpOnly: true,
    sameSite: "none", partitioned: true, path: "/",
  });
  expect(lastResponse!.cookies.get(embeddedCookie(launchContext))?.value).toBe(created.id);
  expect(lastResponse!.cookies.get(embeddedCookie("b".repeat(43)))).toBeUndefined();
  expect(lastResponse!.cookies.get(SESSION_COOKIE)).toBeUndefined();
  expect(bindingForRequest(new NextRequest(origin + "/studio/api/new-api/session", {
    headers: { "x-community-embed": launchContext },
  }), stored)?.context).toBe(launchContext);
});

test("two embedded contexts share one serialized upstream refresh chain", async () => {
  const created = await login(user, 0);
  const other = "z".repeat(43);
  await initialize({ cookie: `${SESSION_COOKIE}=${created.id}` });
  launchContext = other;
  await initialize({ cookie: `${SESSION_COOKIE}=${created.id}`, "x-community-embed": other });
  const responses = await Promise.all([context, other].map(value => handle(
    "/studio/api/new-api/community/embedded/verify", {}, {
      "x-community-embed": value, cookie: `${embeddedCookie(value)}=${created.id}`,
    },
  )));
  expect(responses.map(value => value?.status)).toEqual([200, 200]);
  expect(jest.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/api/user/auth/refresh"))).toHaveLength(1);
  expect((await readSessionById(created.id))?.refreshToken).toBe("rotated-refresh");
});

test("native navigation issues browser-bound PKCE and preserves the remix return path", async () => {
  const { launch, response } = await authorize();
  const target = new URL(response.headers.get("location")!);
  expect(target.searchParams.get("scope")).toBe("chat_session");
  expect(target.searchParams.get("expected_subject")).toBe("17");
  expect(target.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(target.searchParams.get("redirect_uri")).toBe(origin + "/api/new-api/community/callback");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const replay = await handle(launch.authorizationUrl, undefined, { "sec-fetch-dest": "document" });
  expect(replay?.headers.get("location")).toBe(origin + returnTo + "&studio=authorization-failed");
});

test.each(["empty", "iframe"])("rejects %s requests before consuming the authorization ticket", async destination => {
  const launch = legacyLaunch();
  const ticket = new URL(launch.authorizationUrl).searchParams.get("ticket")!;
  const key = "octopus:community-embed:authorize:" + hash(ticket);
  const rejected = await handle(launch.authorizationUrl, undefined, { "sec-fetch-dest": destination, "sec-fetch-mode": "same-origin" });
  expect(rejected?.headers.get("location")).toBe(origin + returnTo + "&studio=authorization-failed");
  expect(values.has(key)).toBe(true);
  expect(JSON.stringify(jest.mocked(console.warn).mock.calls)).not.toContain(ticket);
  const accepted = await handle(launch.authorizationUrl, undefined, { "sec-fetch-dest": "document" });
  expect(new URL(accepted!.headers.get("location")!).origin).toBe(issuer);
});

test("callback returns to the requested work and stores the matching user's billing key", async () => {
  const flow = await authorize();
  const response = await callback(flow.state, flow.cookie);
  expect(response?.headers.get("location")).toBe(origin + returnTo);
  const grant = [...values.entries()].find(([key]) => key.startsWith("octopus:community-embed:grant:") && !key.endsWith(":generation"));
  expect(grant).toBeDefined();
  const session = await readSessionById(grant![1]);
  expect(session?.user?.id).toBe(17);
  expect(session?.selectedKey).toBe("sk-test-user-key");
  expect(session?.communityEmbed?.userId).toBe("testUser");
  expect(session?.communityEmbed?.context).toBe(context);
});

test("wrong-browser callbacks fail in the workbench without exchanging credentials", async () => {
  const flow = await authorize();
  const response = await callback(flow.state, "");
  expect(response?.headers.get("location")).toBe(origin + returnTo + "&studio=authorization-failed");
  expect(jest.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/api/studio-sso/token"))).toBe(false);
  expect(select).not.toHaveBeenCalled();
});

test("changed community identity cannot authorize", async () => {
  const launch = legacyLaunch();
  bindingValid = false;
  const response = await handle(launch.authorizationUrl, undefined, { "sec-fetch-dest": "document" });
  expect(response?.headers.get("location")).toBe(origin + returnTo + "&studio=authorization-failed");
  expect([...values.keys()].some(key => key.includes(":state:"))).toBe(false);
});

test.each(["https://evil.test/create/image", "//evil.test", "/create/image?remix=x&next=evil", "/create/image%0d%0aLocation:evil"])("rejects unsafe return paths: %s", async unsafe => {
  returnTo = unsafe;
  const flow = await authorize();
  const response = await callback(flow.state, flow.cookie);
  expect(response?.headers.get("location")).toBe(origin + "/create/image");
});
