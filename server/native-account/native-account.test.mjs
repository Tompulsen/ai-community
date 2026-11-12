import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import test, { after } from "node:test"
import {
  AccountRequest, handleAccountRequest, readNativeAccount, resolveRelayCredentials, relayHeaders,
  readSessionById, saveSession, removeSessionById,
} from "./index.ts"

const origin = "https://community.test"
const user = { id: 7, username: "creator", display_name: "Creator", quota: 1250000,
  used_quota: 100, request_count: 2, group: "default" }
const originalEnvironment = { ...process.env }
after(() => {
  for (const key of ["NODE_ENV", "NEW_API_BASE_URL", "NEW_API_PUBLIC_URL",
    "NEW_API_SESSION_SECRET", "NEW_API_REDIS_URL", "NEW_API_IMAGE_BASE_URL",
    "NEW_API_ASYNC_BASE_URL", "MODEL_API_KEY"]) {
    if (originalEnvironment[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnvironment[key]
  }
})

function configure(t, changes = {}) {
  const values = {
    NODE_ENV: "test", NEW_API_BASE_URL: "https://account-internal.test",
    NEW_API_PUBLIC_URL: "https://accounts.test", NEW_API_SESSION_SECRET: "native-test-".repeat(5),
    NEW_API_REDIS_URL: "", NEW_API_IMAGE_BASE_URL: "", NEW_API_ASYNC_BASE_URL: "", ...changes,
  }
  Object.assign(process.env, values)
}

function request(path, options = {}) {
  return new AccountRequest(origin + path, {
    ...options,
    headers: { host: new URL(origin).host, origin,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  })
}

const envelope = (data, headers) => Response.json({ success: true, data }, { headers })

async function session(t, changes = {}) {
  const id = randomBytes(32).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  await saveSession(id, { user, accessToken: "private-access", refreshToken: "private-refresh",
    upstreamSessionId: "private-sid", accessExpiresAt: now + 3600,
    selectedTokenId: 9, selectedKey: "sk-private-selection",
    createdAt: now, expiresAt: now + 3600, version: 1, ...changes })
  t.after(() => removeSessionById(id))
  const cookie = `octopus_new_api_session=${id}`
  return { id, cookie, request: (path = "/api/new-api/session", options = {}) =>
    request(path, { ...options, headers: { cookie, ...options.headers } }) }
}

test("native account status preserves the authoritative quota display conversion", async t => {
  configure(t)
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(String(url), "https://account-internal.test/api/status")
    return envelope({ quota_per_unit: 500000, quota_display_type: "CNY", usd_exchange_rate: 7,
      password_login_enabled: true, turnstile_check: true, turnstile_site_key: "public-site-key" })
  })
  for (const prefix of ["/api/new-api", "/studio/api/new-api"]) {
    const response = await handleAccountRequest(request(prefix + "/status"))
    const result = await response.json()
    assert.equal(response.status, 200)
    assert.equal(result.data.quotaPerUnit, 500000 / 7)
    assert.equal(result.data.currencySymbol, "¥")
    assert.equal(result.data.turnstileSiteKey, "public-site-key")
    assert.match(response.headers.get("cache-control"), /no-store/)
  }
})

test("existing normal session cookies return sanitized account information without creating another login", async t => {
  configure(t)
  const fixture = await session(t)
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://account-internal.test/api/user/self")
    assert.equal(options.headers.get("Authorization"), "Bearer private-access")
    assert.equal(options.headers.has("Cookie"), false)
    return envelope({ ...user, username: "renamed-creator", token: "must-not-leak" })
  })
  const response = await handleAccountRequest(fixture.request())
  const result = await response.json()
  assert.equal(result.data.authenticated, true)
  assert.equal(result.data.user.username, "renamed-creator")
  assert.equal(result.data.selectedTokenId, 9)
  assert.doesNotMatch(JSON.stringify(result), /private-access|private-refresh|private-sid|sk-private|must-not-leak/)
  const account = await readNativeAccount(fixture.request("/api/session"))
  assert.equal(account.binding.subject, "7")
  assert.equal(account.binding.issuer, "https://accounts.test")
  assert.equal(account.username, "renamed-creator")
  assert.equal(account.binding.sessionHash.length, 64)
})

test("rotating refresh tokens are serialized across simultaneous native requests", async t => {
  configure(t)
  const fixture = await session(t, { accessExpiresAt: 1 })
  let refreshes = 0
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).endsWith("/api/user/auth/refresh")) {
      refreshes++
      assert.equal(options.headers.get("Cookie"), "new_api_refresh=private-refresh")
      await new Promise(resolve => setTimeout(resolve, 15))
      return envelope({ user, access_token: "rotated-access",
        access_expires_at: Date.now() / 1000 + 3600, session: { sid: "rotated-sid" } },
      { "Set-Cookie": "new_api_refresh=rotated-refresh; HttpOnly; Path=/" })
    }
    assert.equal(options.headers.get("Authorization"), "Bearer rotated-access")
    return envelope(user)
  })
  const results = await Promise.all([handleAccountRequest(fixture.request()), handleAccountRequest(fixture.request())])
  assert.equal(refreshes, 1)
  assert(results.every(result => result.status === 200))
  const stored = await readSessionById(fixture.id)
  assert.equal(stored.refreshToken, "rotated-refresh")
  assert.equal(stored.version, 2)
})

test("an upstream refresh for another user revokes the original session", async t => {
  configure(t)
  const fixture = await session(t, { accessExpiresAt: 1 })
  t.mock.method(globalThis, "fetch", async () => envelope({
    user: { ...user, id: 8 }, access_token: "wrong-account",
    access_expires_at: Date.now() / 1000 + 3600, session: { sid: "wrong-sid" },
  }, { "Set-Cookie": "new_api_refresh=wrong-refresh; HttpOnly" }))
  const result = await handleAccountRequest(fixture.request())
  assert.equal(result.status, 401)
  assert.equal(await readSessionById(fixture.id), null)
})

test("native login reuses password and verification protocol and sets the existing HttpOnly cookie", async t => {
  configure(t)
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname
    if (path === "/api/status") return envelope({ password_login_enabled: true })
    if (path === "/api/user/login") {
      assert.deepEqual(JSON.parse(options.body), { username: "creator", password: "fixture-password" })
      return envelope({ user, access_token: "login-access",
        access_expires_at: Date.now() / 1000 + 3600, session: { sid: "login-sid" } },
      { "Set-Cookie": "new_api_refresh=login-refresh; HttpOnly" })
    }
    assert.equal(path, "/api/token/")
    return envelope({ total: 2, items: [{ id: 1 }, { id: 2 }] })
  })
  const response = await handleAccountRequest(request("/api/new-api/login", {
    method: "POST", body: JSON.stringify({ username: "creator", password: "fixture-password" }),
  }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.data.user.id, 7)
  assert.doesNotMatch(JSON.stringify(result), /login-access|login-refresh|login-sid/)
  const cookie = response.headers.getSetCookie().find(value => value.startsWith("octopus_new_api_session="))
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Secure/)
  assert.match(cookie, /SameSite=lax/i)
  const id = cookie.match(/^octopus_new_api_session=([^;]+)/)[1]
  assert.equal((await readSessionById(id)).user.id, 7)
  await removeSessionById(id)
})

test("logout removes native sessions even when the upstream account service is unavailable", async t => {
  configure(t)
  const fixture = await session(t)
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline fixture") })
  const response = await handleAccountRequest(fixture.request("/api/new-api/logout", { method: "POST", body: "{}" }))
  assert.equal(response.status, 200)
  assert.equal(await readSessionById(fixture.id), null)
  assert.match(response.headers.get("Set-Cookie"), /octopus_new_api_session=;.*Max-Age=0/)
})

test("mutations reject cross-site origins before invoking the account service", async t => {
  configure(t)
  t.mock.method(globalThis, "fetch", async () => assert.fail("A cross-site mutation must not leave the server"))
  const response = await handleAccountRequest(request("/api/new-api/login", {
    method: "POST", headers: { origin: "https://other.test" },
    body: '{"username":"creator","password":"fixture"}',
  }))
  assert.equal(response.status, 403)
})

test("native session transport refuses embedded aliases and ambiguous cookies", async t => {
  configure(t)
  const fixture = await session(t)
  t.mock.method(globalThis, "fetch", async () => assert.fail("Rejected session transports must not call upstream"))
  const ambiguous = await handleAccountRequest(fixture.request("/api/new-api/session", {
    headers: { cookie: `${fixture.cookie}; ${fixture.cookie}` },
  }))
  assert.equal((await ambiguous.json()).data.authenticated, false)
  const embedded = await handleAccountRequest(fixture.request("/api/new-api/session", {
    headers: { "x-community-embed": "a".repeat(43) },
  }))
  assert.equal(embedded.status, 403)
})

test("historical generation keys must belong to the current account", async t => {
  configure(t)
  const fixture = await session(t)
  t.mock.method(globalThis, "fetch", async url => {
    const path = new URL(url).pathname
    if (path === "/api/user/self") return envelope(user)
    assert.equal(path, "/api/token/12")
    return envelope({ id: 12, user_id: 8 })
  })
  await assert.rejects(resolveRelayCredentials(fixture.request("/api/studio/tasks/old", {
    headers: { "x-new-api-token": "12" },
  })), { status: 403 })
})

test("native account and relay reject a mismatching upstream identity and revoke its session", async t => {
  configure(t)
  const fixture = await session(t)
  t.mock.method(globalThis, "fetch", async () => envelope({ ...user, id: 8 }))
  const response = await handleAccountRequest(fixture.request())
  assert.equal(response.status, 401)
  assert.equal(await readSessionById(fixture.id), null)
  const relayFixture = await session(t)
  await assert.rejects(resolveRelayCredentials(relayFixture.request("/api/studio/generate", {
    method: "POST", body: "{}",
  })), { status: 401 })
  assert.equal(await readSessionById(relayFixture.id), null)
})

test("native relay routes v1 images to the image origin and keeps expected-account checks", async t => {
  configure(t, { NEW_API_IMAGE_BASE_URL: "https://images.test", NEW_API_ASYNC_BASE_URL: "https://async.test" })
  const fixture = await session(t)
  let requests = 0
  t.mock.method(globalThis, "fetch", async () => {
    requests++
    return envelope(user)
  })
  for (const subpath of ["images/generations", "v1/images/generations", "v1/images/edits", "v1/images/variations/"]) {
    const credentials = await resolveRelayCredentials(fixture.request("/api/studio/generate", {
      method: "POST", body: "{}", headers: { "x-new-api-user": "7" },
    }), subpath)
    assert.equal(credentials.baseUrl, "https://images.test")
    assert.equal(credentials.userId, 7)
  }
  const asynchronous = await resolveRelayCredentials(fixture.request("/api/studio/generate", {
    method: "POST", body: "{}",
  }), "async-videos/v1/videos")
  assert.equal(asynchronous.baseUrl, "https://async.test")
  const previous = requests
  await assert.rejects(resolveRelayCredentials(fixture.request("/api/studio/generate", {
    method: "POST", body: "{}", headers: { "x-new-api-user": "8" },
  }), "v1/images/generations"), { status: 409, code: "NEW_API_ACCOUNT_CHANGED" })
  assert.equal(requests, previous, "A different expected account must fail before upstream requests")
})

test("an account without a selection reuses its system Auto key without revealing it to the browser", async t => {
  configure(t)
  const fixture = await session(t, { selectedTokenId: undefined, selectedKey: undefined })
  const token = { id: 9, name: "系统创建", user_id: 7, group: "auto", status: 1,
    expired_time: -1, unlimited_quota: true, remain_quota: 0, auto_groups: [] }
  const writes = []
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname
    if (options.method === "POST") writes.push(path)
    if (path === "/api/user/self") return envelope(user)
    if (path === "/api/user/self/groups") return envelope({ auto: { ratio: 1 } })
    if (path === "/api/token/") return envelope({ items: [token], total: 1 })
    if (path === "/api/token/9") return envelope(token)
    assert.equal(path, "/api/token/9/key")
    return envelope({ key: " native-system-secret " })
  })
  const credentials = await resolveRelayCredentials(fixture.request("/api/studio/generate", { method: "POST", body: "{}" }))
  assert.deepEqual(credentials, { baseUrl: "https://account-internal.test",
    apiKey: "sk-native-system-secret", tokenId: 9, userId: 7 })
  const stored = await readSessionById(fixture.id)
  assert.equal(stored.selectedTokenId, 9)
  assert.deepEqual(writes, ["/api/token/9/key"])
})

test("relay forwarding excludes account cookies and arbitrary authentication headers", () => {
  const headers = relayHeaders(request("/api/studio/generate", {
    headers: { cookie: "private-cookie", authorization: "private-access", "x-api-key": "admin-key",
      "content-type": "application/json", accept: "text/event-stream" },
  }), "sk-owned-model")
  assert.equal(headers.get("Authorization"), "Bearer sk-owned-model")
  assert.equal(headers.has("Cookie"), false)
  assert.equal(headers.has("X-Api-Key"), false)
  assert.equal(headers.get("Accept"), "text/event-stream")
})

test("native relay never falls back to a shared server API key", async t => {
  configure(t, { NEW_API_BASE_URL: "", MODEL_API_KEY: "must-not-be-used" })
  t.mock.method(globalThis, "fetch", async () => assert.fail("A disabled account bridge must not invoke a provider"))
  await assert.rejects(resolveRelayCredentials(request("/api/studio/generate", { method: "POST", body: "{}" })),
    { status: 503, code: "NEW_API_DISABLED" })
})
