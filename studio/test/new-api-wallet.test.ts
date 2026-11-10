/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";

const dns = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("node:dns/promises", () => ({ lookup: dns }));
const { GET, POST } = await import("../app/api/new-api/[...path]/route");
const { createSession, removeSessionById, SESSION_COOKIE } = await import(
  "../app/lib/new-api/session"
);
const { validateWalletPaymentUrl } = await import("../app/lib/new-api/wallet");
const originalEnv = process.env;
const originalFetch = global.fetch;
const user = {
  id: 17,
  username: "account-a",
  display_name: "Account A",
  quota: 100,
  used_quota: 20,
  request_count: 2,
  group: "default",
};
const credentials = {
  user,
  accessToken: "private-login-token-a",
  accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  refreshToken: "private-refresh-token-a",
  upstreamSessionId: "upstream-session-a",
  selectedTokenId: 23,
  selectedKey: "sk-private-unmasked-key",
};
let sessionId: string;
let info: Record<string, unknown>;
let status: Record<string, unknown>;
let payment: Record<string, any>;
let quote: Record<string, unknown>;
let redemption: Record<string, unknown>;
function request(
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
  id = sessionId,
) {
  return new NextRequest(`https://chat.example.com/api/new-api/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      host: "chat.example.com",
      origin: "https://chat.example.com",
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${id}`,
      "x-new-api-user": "17",
      authorization: "Bearer forged-token",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function context(route: string) {
  return { params: Promise.resolve({ path: route.split("/") }) };
}
function post(
  route: string,
  body: unknown,
  headers?: Record<string, string>,
  id?: string,
) {
  return POST(request(route, body, headers, id), context(route));
}
function writes(path: string) {
  return jest
    .mocked(fetch)
    .mock.calls.filter(
      ([url, options]) =>
        new URL(String(url)).pathname === path && options?.method === "POST",
    );
}
beforeEach(async () => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    NEW_API_BASE_URL: "https://accounts.example.com",
    NEW_API_PUBLIC_URL: "https://accounts.example.com",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "",
  };
  dns.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  info = {
    enable_online_topup: true,
    enable_redemption: true,
    topup_link: "https://shop.example.com/codes",
    min_topup: 1,
    amount_options: [1, 10, 50],
    discount: { "50": 0.97, "10": 0, "1": 1.1, invalid: 0.5 },
    pay_methods: [
      { type: "alipay", name: "支付宝" },
      { type: "wxpay", name: "微信支付" },
      { type: "stripe", name: "卡" },
    ],
    secret: "must-not-leak",
  };
  status = {
    quota_per_unit: 500000,
    quota_display_type: "CUSTOM",
    custom_currency_symbol: "✦",
    custom_currency_exchange_rate: 2,
  };
  quote = { message: "success", data: "2.50" };
  redemption = { success: true, data: 500000 };
  payment = {
    message: "success",
    url: "https://pay.example.com/submit.php",
    data: {
      pid: "merchant",
      type: "alipay",
      out_trade_no: "USR17NOabcdef123",
      notify_url: "https://accounts.example.com/api/user/epay/notify",
      return_url: "https://accounts.example.com/usage-logs",
      name: "余额充值",
      money: "2.50",
      device: "pc",
      sign: "signed-by-server",
      sign_type: "MD5",
    },
  };
  global.fetch = jest.fn<typeof fetch>().mockImplementation(async (url) => {
    const parsed = new URL(String(url));
    if (parsed.origin !== "https://accounts.example.com")
      throw new Error("Unexpected upstream origin");
    const path = parsed.pathname;
    if (path === "/api/user/topup/info")
      return Response.json({ success: true, data: info });
    if (path === "/api/status")
      return Response.json({ success: true, data: status });
    if (path === "/api/subscription/plans")
      return Response.json({
        success: true,
        data: [
          {
            plan: {
              id: 2,
              title: "月包",
              enabled: true,
              price_amount: 20,
              currency: "CNY",
              total_amount: 5000000,
              private_field: "must-not-leak",
            },
          },
          { plan: { id: 3, enabled: false, price_amount: 9 } },
        ],
      });
    if (path === "/api/subscription/self")
      return Response.json({
        success: true,
        data: {
          all_subscriptions: [
            {
              subscription: {
                id: 3,
                plan_id: 2,
                status: "active",
                amount_total: 5000000,
                amount_used: 100,
              },
            },
          ],
        },
      });
    if (path === "/api/user/topup/self")
      return Response.json({
        success: true,
        data: {
          total: 2,
          items: [
            {
              id: 4,
              user_id: 17,
              trade_no: "USR17NOold",
              money: 2,
              status: "success",
              secret: "must-not-leak",
            },
            { id: 5, user_id: 18, trade_no: "foreign" },
            null,
          ],
        },
      });
    if (path === "/api/user/amount") return Response.json(quote);
    if (path === "/api/user/pay" || path === "/api/subscription/epay/pay")
      return Response.json(payment);
    if (path === "/api/user/topup") return Response.json(redemption);
    throw new Error(`Unexpected route ${path}`);
  });
  const created = await createSession(
    request("login", {}),
    NextResponse.json({}),
    credentials,
  );
  sessionId = created.id;
});
afterEach(() => {
  global.fetch = originalFetch;
  process.env = originalEnv;
});

test("wallet overview is read-only, sanitized and scoped to the authenticated account", async () => {
  const response = await GET(request("wallet"), context("wallet"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.data).toMatchObject({
    userId: 17,
    currencySymbol: "✦",
    creditExchangeRate: 2,
    topup: {
      enabled: true,
      redemptionEnabled: true,
      redemptionUrl: "https://shop.example.com/codes",
      discounts: { "50": 0.97 },
    },
  });
  expect(
    body.data.topup.paymentMethods.map((method: any) => method.type),
  ).toEqual(["alipay", "wxpay"]);
  expect(body.data.plans).toHaveLength(1);
  expect(body.data.history).toHaveLength(1);
  expect(JSON.stringify(body)).not.toMatch(
    /must-not-leak|private-login|private-refresh|sk-private|foreign/,
  );
  expect(fetch).toHaveBeenCalledTimes(5);
  for (const [url, options] of jest.mocked(fetch).mock.calls) {
    expect(options?.method).toBe("GET");
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe(
      new URL(String(url)).pathname === "/api/status"
        ? null
        : "Bearer private-login-token-a",
    );
  }
});
test("quote accepts the real Epay message envelope and preserves server total", async () => {
  const response = await post("wallet/quote", { amount: 10 });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({
    userId: 17,
    amount: 10,
    money: "2.50",
  });
  expect(JSON.parse(writes("/api/user/amount")[0][1]?.body as string)).toEqual({
    amount: 10,
  });
});
test("Epay HTTP 200 business failures are not interpreted as successful quotes or retried", async () => {
  quote = { message: "error", data: "最低充值数量为 5" };
  const response = await post("wallet/quote", { amount: 1 });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect((await response.json()).message).toContain("最低充值数量为 5");
  expect(writes("/api/user/amount")).toHaveLength(1);
});
test("topup payment re-quotes, forwards only accepted fields and preserves signed form", async () => {
  const response = await post("wallet/pay", {
    amount: 10,
    paymentMethod: "alipay",
  });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({
    userId: 17,
    action: payment.url,
    fields: payment.data,
    method: "POST",
    kind: "topup",
    money: "2.50",
  });
  expect(writes("/api/user/amount")).toHaveLength(1);
  expect(writes("/api/user/pay")).toHaveLength(1);
  expect(JSON.parse(writes("/api/user/pay")[0][1]?.body as string)).toEqual({
    amount: 10,
    payment_method: "alipay",
  });
});
test("payment configuration and final quote are read in parallel before creating an order", async () => {
  const implementation = jest.mocked(fetch).getMockImplementation()!;
  let releaseInfo!: () => void;
  let quoteStarted!: () => void;
  const infoReady = new Promise<void>((done) => {
    releaseInfo = done;
  });
  const quoteReady = new Promise<void>((done) => {
    quoteStarted = done;
  });
  jest.mocked(fetch).mockImplementation(async (url, options) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/user/topup/info") await infoReady;
    if (path === "/api/user/amount") quoteStarted();
    return implementation(url, options);
  });
  const pending = post("wallet/pay", { amount: 10, paymentMethod: "alipay" });
  await quoteReady;
  expect(writes("/api/user/pay")).toHaveLength(0);
  releaseInfo();
  expect((await pending).status).toBe(200);
  expect(writes("/api/user/amount")).toHaveLength(1);
  expect(writes("/api/user/pay")).toHaveLength(1);
});

test("a session revoked during payment reads is rechecked before creating the order", async () => {
  const implementation = jest.mocked(fetch).getMockImplementation()!;
  jest.mocked(fetch).mockImplementation(async (url, options) => {
    if (new URL(String(url)).pathname === "/api/user/amount")
      await removeSessionById(sessionId);
    return implementation(url, options);
  });
  const result = await post("wallet/pay", {
    amount: 10,
    paymentMethod: "alipay",
  });
  expect(result.status).toBe(401);
  expect(writes("/api/user/pay")).toHaveLength(0);
});
test("subscription payment forwards the plan ID and validates subscription callbacks", async () => {
  payment.data = {
    ...payment.data,
    out_trade_no: "SUBUSR17NOabc123",
    notify_url: "https://accounts.example.com/api/subscription/epay/notify",
    return_url: "https://accounts.example.com/api/subscription/epay/return",
  };
  const response = await post("wallet/subscription", {
    planId: 2,
    paymentMethod: "alipay",
    expectedPrice: { amount: 20, currency: "CNY" },
  });
  expect(response.status).toBe(200);
  expect((await response.json()).data.kind).toBe("subscription");
  expect(
    JSON.parse(writes("/api/subscription/epay/pay")[0][1]?.body as string),
  ).toEqual({ plan_id: 2, payment_method: "alipay" });
  expect(writes("/api/user/pay")).toHaveLength(0);
});
test.each([
  { amount: 19, currency: "CNY" },
  { amount: 20, currency: "USD" },
  { amount: "20", currency: "CNY" },
])(
  "changed or invalid subscription price does not create a payment: %j",
  async (expectedPrice) => {
    const response = await post("wallet/subscription", {
      planId: 2,
      paymentMethod: "alipay",
      expectedPrice,
    });
    expect(response.status).toBe(400);
    expect(writes("/api/subscription/epay/pay")).toHaveLength(0);
  },
);
test.each<Record<string, string>>([
  {},
  { "x-new-api-user": "18" },
  { "x-new-api-user": "" },
])("wallet mutations require the expected account: %j", async (headers) => {
  const supplied = Object.keys(headers).length
    ? headers
    : { "x-new-api-user": "0" };
  const response = await post(
    "wallet/pay",
    { amount: 10, paymentMethod: "alipay" },
    supplied,
  );
  expect(response.status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
});
test.each<Record<string, string>>([
  { origin: "https://evil.example.com" },
  { "sec-fetch-site": "cross-site" },
  { "x-community-embed": "malformed" },
])("wallet mutations reject untrusted contexts: %j", async (headers) => {
  const response = await post("wallet/redeem", { key: "code" }, headers);
  expect(response.status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
test("guests cannot read wallet or create orders", async () => {
  const read = await GET(
    request("wallet", undefined, {}, "unknown-session"),
    context("wallet"),
  );
  const write = await post(
    "wallet/pay",
    { amount: 1, paymentMethod: "alipay" },
    {},
    "unknown-session",
  );
  expect(read.status).toBe(401);
  expect(write.status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
test.each([-1, 0, 1.5, "10", Number.MAX_SAFE_INTEGER + 1])(
  "quote rejects invalid amount %p",
  async (amount) => {
    expect((await post("wallet/quote", { amount })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  },
);
test.each([
  { amount: 1, url: "https://evil.example.com" },
  { amount: 1, userId: 18 },
  { amount: 1, path: "/api/user/manage" },
  { amount: 1, money: "0.01" },
])("caller cannot inject upstream controls: %j", async (body) => {
  expect((await post("wallet/quote", body)).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
test.each(["stripe", "creem", "waffo", "bitcoin"])(
  "unsupported method %s cannot create an Epay order",
  async (paymentMethod) => {
    expect(
      (await post("wallet/pay", { amount: 10, paymentMethod })).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  },
);
test("disabled payment method cannot create an order", async () => {
  info.enable_online_topup = false;
  expect(
    (await post("wallet/pay", { amount: 10, paymentMethod: "alipay" })).status,
  ).toBe(400);
  expect(writes("/api/user/pay")).toHaveLength(0);
});
test.each([
  { out_trade_no: "USR18NOother" },
  { type: "wxpay" },
  { sign: "" },
  { notify_url: "https://evil.example.com/api/user/epay/notify" },
  { return_url: "https://accounts.example.com/admin" },
  { money: "-1" },
  { money: "0" },
  { money: "1e4" },
  { unexpected: "private-value" },
])("invalid signed payment response is withheld: %j", async (changes) => {
  Object.assign(payment.data, changes);
  const response = await post("wallet/pay", {
    amount: 10,
    paymentMethod: "alipay",
  });
  expect(response.status).toBe(502);
  expect((await response.json()).data).toBeUndefined();
  expect(writes("/api/user/pay")).toHaveLength(1);
});
test.each([
  "http://pay.example.com",
  "javascript:alert(1)",
  "https://user:pass@pay.example.com",
  "https://127.0.0.1",
  "https://localhost",
  "https://pay.example.com:8443",
  "https://pay.internal",
])("unsafe gateway %s is rejected", async (url) => {
  await expect(validateWalletPaymentUrl(url)).rejects.toMatchObject({
    status: 502,
  });
  expect(dns).not.toHaveBeenCalled();
});
test.each([
  "127.0.0.1",
  "10.1.2.3",
  "192.168.1.1",
  "169.254.169.254",
  "::1",
  "fc00::1",
  "::ffff:127.0.0.1",
  "2001:db8::1",
])("private or reserved DNS address %s is rejected", async (address) => {
  dns.mockResolvedValue([{ address }]);
  await expect(
    validateWalletPaymentUrl("https://pay.example.com"),
  ).rejects.toMatchObject({ status: 502 });
});
test("public gateway DNS is accepted without calling the payment host", async () => {
  await expect(
    validateWalletPaymentUrl("https://pay.example.com/submit.php"),
  ).resolves.toBe("https://pay.example.com/submit.php");
  expect(fetch).not.toHaveBeenCalled();
});
test("redemption forwards trimmed code exactly once without leaking it back", async () => {
  const response = await post("wallet/redeem", { key: "  secret-code  " });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({
    userId: 17,
    creditedQuota: 500000,
  });
  expect(writes("/api/user/topup")).toHaveLength(1);
  expect(JSON.parse(writes("/api/user/topup")[0][1]?.body as string)).toEqual({
    key: "secret-code",
  });
});
test("disabled redemption is rejected before consuming a code", async () => {
  info.enable_redemption = false;
  expect((await post("wallet/redeem", { key: "code" })).status).toBe(400);
  expect(writes("/api/user/topup")).toHaveLength(0);
});
test("failed redemption is not retried", async () => {
  redemption = { success: false, message: "兑换码已使用" };
  const response = await post("wallet/redeem", { key: "code" });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(writes("/api/user/topup")).toHaveLength(1);
});
