import assert from "node:assert/strict"
import test from "node:test"
import { AccountRequest, handleAccountRequest } from "./index.ts"

const origin = "https://community.test"
const accountOrigin = "https://account-internal.test"
const settings = {
  register_enabled: true, password_register_enabled: true, email_verification: true,
  turnstile_check: true, turnstile_site_key: "registration-public-key",
  user_agreement_enabled: true, privacy_policy_enabled: true,
}
const registration = {
  username: "creator", password: "fixture-password", email: "creator@example.com",
  verification_code: "123456", aff_code: "wf" + "a".repeat(24), turnstile_token: "fresh-challenge",
}

function configure(t) {
  const values = {
    NODE_ENV: "test", NEW_API_BASE_URL: accountOrigin, NEW_API_PUBLIC_URL: "https://accounts.test",
    NEW_API_SESSION_SECRET: "registration-test-".repeat(4), NEW_API_REDIS_URL: "", NEW_API_TRUST_PROXY: "true",
  }
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]
    process.env[key] = value
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
}

function request(path, input, headers = {}, method = "POST") {
  return new AccountRequest(origin + path, {
    method, headers: {
      host: new URL(origin).host, origin, "content-type": "application/json", ...headers,
    },
    ...(!["GET", "HEAD"].includes(method) ? { body: JSON.stringify(input) } : {}),
  })
}

const envelope = (data) => Response.json({ success: true, data })

test("registration status mirrors account-center booleans and defaults missing flags to closed", async t => {
  configure(t)
  let upstreamSettings = settings
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(String(url), accountOrigin + "/api/status")
    return envelope(upstreamSettings)
  })
  for (const prefix of ["/api/new-api", "/studio/api/new-api"]) {
    const response = await handleAccountRequest(request(prefix + "/status", undefined, {}, "GET"))
    const data = (await response.json()).data
    for (const key of ["registerEnabled", "passwordRegisterEnabled", "emailVerificationEnabled", "userAgreementEnabled", "privacyPolicyEnabled"]) {
      assert.equal(data[key], true)
    }
    assert.equal(data.turnstileSiteKey, "registration-public-key")
  }
  upstreamSettings = { register_enabled: "true", password_register_enabled: 1 }
  const data = (await (await handleAccountRequest(request("/api/new-api/status", undefined, {}, "GET"))).json()).data
  assert.equal(data.registerEnabled, false)
  assert.equal(data.passwordRegisterEnabled, false)
  assert.equal(data.emailVerificationEnabled, false)
  const local = (await (await handleAccountRequest(request("/api/new-api/status?scope=workspace", undefined, {}, "GET"))).json()).data
  assert.equal(local.registerEnabled, false)
})

test("registration forwards only supported account fields and never logs in or reflects account secrets", async t => {
  configure(t)
  const calls = []
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url)
    calls.push(target.pathname)
    if (target.pathname === "/api/status") return envelope(settings)
    assert.equal(target.pathname, "/api/user/register")
    assert.equal(target.searchParams.get("turnstile"), registration.turnstile_token)
    assert.equal(options.method, "POST")
    const { turnstile_token, ...expected } = registration
    assert.deepEqual(JSON.parse(options.body), expected)
    assert.equal(options.headers.get("X-Real-IP"), "203.0.113.24")
    assert.equal(options.headers.get("X-Forwarded-For"), "203.0.113.24")
    assert.equal(options.headers.get("Authorization"), null)
    assert.equal(options.headers.get("Cookie"), null)
    return Response.json({ success: true, data: { access_token: "upstream-private-token", user: { id: 7 } } }, {
      headers: { "Set-Cookie": "new_api_refresh=upstream-private-cookie; HttpOnly" },
    })
  })
  for (const prefix of ["/api/new-api", "/studio/api/new-api"]) {
    const response = await handleAccountRequest(request(prefix + "/register", {
      ...registration, username: " creator ", role: 100, group: "vip", quota: 999, id: 1, inviter_id: 1,
    }, { "x-real-ip": "203.0.113.24", "x-forwarded-for": "attacker-input" }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { success: true, data: { registered: true } })
    assert.equal(response.headers.get("set-cookie"), null)
    assert.match(response.headers.get("cache-control"), /no-store/)
  }
  assert.deepEqual(calls, ["/api/status", "/api/user/register", "/api/status", "/api/user/register"])
})

test("registration code requires a same-origin POST and uses the existing verification endpoint", async t => {
  configure(t)
  const calls = []
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url)
    calls.push(target.pathname)
    if (target.pathname === "/api/status") return envelope(settings)
    assert.equal(target.pathname, "/api/verification")
    assert.equal(target.searchParams.get("email"), "a+b@example.com")
    assert.equal(target.searchParams.get("turnstile"), "challenge+with/&symbols")
    assert.equal(options.method, "GET")
    assert.equal(options.body, undefined)
    assert.equal(options.headers.get("X-Real-IP"), "203.0.113.25")
    return Response.json({ success: true })
  })
  for (const prefix of ["/api/new-api", "/studio/api/new-api"]) {
    const response = await handleAccountRequest(request(prefix + "/registration-code", {
      email: "a+b@example.com", turnstile_token: "challenge+with/&symbols",
    }, { "x-real-ip": "203.0.113.25" }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { success: true, data: { sent: true } })
  }
  const before = calls.length
  for (const path of ["/api/new-api/registration-code", "/api/new-api/register"]) {
    const crossOrigin = await handleAccountRequest(request(path, registration, { origin: "https://attacker.test" }))
    assert.equal(crossOrigin.status, 403)
    const crossSite = await handleAccountRequest(request(path, registration, { "sec-fetch-site": "cross-site" }))
    assert.equal(crossSite.status, 403)
    assert.equal((await handleAccountRequest(request(path, undefined, {}, "GET"))).status, 404)
  }
  assert.equal(calls.length, before)
})

test("registration rechecks upstream switches on each call and refuses missing or malformed input", async t => {
  configure(t)
  let upstreamSettings = settings
  let writes = 0
  t.mock.method(globalThis, "fetch", async url => {
    if (new URL(url).pathname === "/api/status") return envelope(upstreamSettings)
    writes++
    return envelope()
  })
  for (const disabled of [{}, { ...settings, register_enabled: false }, { ...settings, password_register_enabled: false }]) {
    upstreamSettings = disabled
    for (const route of ["registration-code", "register"]) {
      const response = await handleAccountRequest(request("/api/new-api/" + route, registration))
      assert.equal(response.status, 403)
    }
  }
  upstreamSettings = settings
  for (const change of [
    { username: "" }, { username: "a".repeat(21) }, { username: {} }, { password: "short" },
    { password: "a".repeat(129) }, { password: {} }, { email: "" }, { email: "bad" }, { email: {} },
    { verification_code: "" }, { verification_code: {} }, { aff_code: "bad&code" }, { aff_code: {} },
    { turnstile_token: "" }, { turnstile_token: "a".repeat(2049) }, { turnstile_token: {} }, { turnstile_token: null },
  ]) {
    const response = await handleAccountRequest(request("/api/new-api/register", { ...registration, ...change }))
    assert.equal(response.status, 400, JSON.stringify(change))
  }
  const malformed = await handleAccountRequest(new AccountRequest(origin + "/api/new-api/register", {
    method: "POST", headers: { host: new URL(origin).host, origin, "content-type": "application/json" }, body: "[]",
  }))
  assert.equal(malformed.status, 400)
  assert.equal(writes, 0)
})

test("password registration follows account-center behavior when email verification and Turnstile are disabled", async t => {
  configure(t)
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (new URL(url).pathname === "/api/status") return envelope({
      ...settings, email_verification: false, turnstile_check: false,
    })
    assert.equal(String(url), accountOrigin + "/api/user/register")
    assert.deepEqual(JSON.parse(options.body), { username: "creator", password: "fixture-password", aff_code: "legacy123" })
    return Response.json({ success: true })
  })
  const response = await handleAccountRequest(request("/api/new-api/register", {
    username: "creator", password: "fixture-password", aff_code: "legacy123",
  }))
  assert.equal(response.status, 200)
  const codeResponse = await handleAccountRequest(request("/api/new-api/registration-code", { email: "creator@example.com" }))
  assert.equal(codeResponse.status, 403)
})

test("registration preserves upstream validation and rate-limit errors without retrying a write", async t => {
  configure(t)
  let upstreamResponse = Response.json({ success: false, message: "验证码不正确或已过期" })
  let writes = 0
  t.mock.method(globalThis, "fetch", async url => {
    if (new URL(url).pathname === "/api/status") return envelope(settings)
    writes++
    if (upstreamResponse instanceof Error) throw upstreamResponse
    return upstreamResponse.clone()
  })
  const invalidCode = await handleAccountRequest(request("/api/new-api/register", registration))
  assert.equal(invalidCode.status, 400)
  assert.match((await invalidCode.json()).message, /验证码/)
  assert.equal(writes, 1)
  upstreamResponse = Response.json({ success: false }, { status: 429, headers: { "Retry-After": "60" } })
  const limited = await handleAccountRequest(request("/api/new-api/registration-code", registration))
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get("retry-after"), "60")
  assert.equal(writes, 2)
  upstreamResponse = new DOMException("timed out", "TimeoutError")
  const unavailable = await handleAccountRequest(request("/api/new-api/register", registration))
  assert.equal(unavailable.status, 502)
  assert.equal(writes, 3)
  assert.equal(unavailable.headers.get("set-cookie"), null)
})

test("registration and email delivery require an explicit upstream success envelope", async t => {
  configure(t)
  let upstreamBody = {}
  t.mock.method(globalThis, "fetch", async url => new URL(url).pathname === "/api/status"
    ? envelope(settings) : Response.json(upstreamBody))
  for (const invalid of [{}, null, [], "success", { success: "true" }]) {
    upstreamBody = invalid
    for (const route of ["registration-code", "register"]) {
      const response = await handleAccountRequest(request("/api/new-api/" + route, registration))
      assert.equal(response.status, 502, JSON.stringify(invalid))
      const result = await response.json()
      assert.equal(result.success, false)
      assert.equal(result.data, undefined)
    }
  }
})
