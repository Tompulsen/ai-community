/** @jest-environment node */
import { createHash } from "node:crypto";
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";

const values = new Map<string, string>();
class Redis {
  status = "ready";
  on() {}
  async get(key: string) { return values.get(key) ?? null; }
  async set(key: string, value: string) { values.set(key, value); return "OK"; }
  async del(key: string) { return Number(values.delete(key)); }
  async eval(_script: string, count: number, ...args: string[]) {
    if (count === 1) return values.get(args[0]) === args[1] ? Number(values.delete(args[0])) : 0;
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
const { readSessionById } = await import("../app/lib/new-api/session");
const originalEnv = process.env, originalFetch = global.fetch;
const origin = "https://community.example.test", issuer = "https://accounts.example.test";
const context = "a".repeat(43), code = "b".repeat(43);
const user = { id: 17, username: "test", display_name: "Test", quota: 100, used_quota: 0, request_count: 0, group: "default" };
const select = jest.fn<() => Promise<{ selectedTokenId: number; selectedKey: string }>>();
const hash = (v: string) => createHash("sha256").update(v).digest("base64url");
let returnTo: string, bindingValid: boolean;

function handle(url: string, body?: object, headers: Record<string, string> = {}) {
  const target = new URL(url, origin);
  return handleCommunityEmbed(new NextRequest(target, {
    method: body ? "POST" : "GET",
    headers: { host: new URL(origin).host, origin, "content-type": "application/json", "x-community-embed": context, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }), target.pathname.replace("/studio/api/new-api/", ""), select);
}
async function initialize() {
  const response = await handle("/studio/api/new-api/community/embedded/init", { code });
  expect(response?.status).toBe(200);
  return response!.json();
}
async function authorize() {
  const launch = await initialize();
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
  returnTo = "/create/image?remix=work123";
  select.mockReset().mockResolvedValue({ selectedTokenId: 23, selectedKey: "sk-test-user-key" });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  process.env = { ...originalEnv, NEW_API_BASE_URL: issuer, NEW_API_PUBLIC_URL: issuer,
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters", NEW_API_REDIS_URL: "redis://test:6379/3",
    COMMUNITY_SSO_ORIGIN: origin, STUDIO_PUBLIC_ORIGIN: origin, COMMUNITY_SSO_SECRET: "test-shared-secret-with-at-least-32-characters", COMMUNITY_INTERNAL_URL: origin };
  global.fetch = jest.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/newapi/studio/exchange") return Response.json({ issuer, studio: origin, context, kind: "image", subject: "17", userId: "testUser", tokenHash: "c".repeat(43), returnTo });
    if (path === "/api/newapi/studio/validate") return Response.json({ valid: bindingValid });
    if (path === "/api/studio-sso/token") return Response.json({ success: true, data: { user, access_token: "test-access", access_expires_at: Date.now() / 1000 + 3600, session: { sid: "test-session" } } }, { headers: { "set-cookie": "new_api_refresh=test-refresh; Path=/api/user/auth; Secure; HttpOnly" } });
    if (path === "/api/user/self") return Response.json({ success: true, data: user });
    throw new Error("Unexpected upstream request: " + path);
  });
});
afterEach(() => { process.env = originalEnv; global.fetch = originalFetch; jest.restoreAllMocks(); });

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
  const launch = await initialize();
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
  const launch = await initialize();
  bindingValid = false;
  const response = await handle(launch.authorizationUrl, undefined, { "sec-fetch-dest": "document" });
  expect(response?.headers.get("location")).toBe(origin + returnTo + "&studio=authorization-failed");
  expect([...values.keys()].some(key => key.includes(":state:"))).toBe(false);
});

test.each(["https://evil.test/create/image", "//evil.test", "/create/image?remix=x&next=evil", "/create/image%0d%0aLocation:evil"])("rejects unsafe return paths: %s", async unsafe => {
  returnTo = unsafe;
  const flow = await authorize();
  expect(new URL(flow.launch.authorizationUrl).searchParams.get("returnTo")).toBe("/create/image");
  const response = await callback(flow.state, flow.cookie);
  expect(response?.headers.get("location")).toBe(origin + "/create/image");
});
