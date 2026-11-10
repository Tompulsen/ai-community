import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { NextRequest } from "next/server";
import { accountRequest, getAuthenticatedSession, upstream } from "./client";
import { NewApiError, requireNewApiConfig } from "./config";
import {
  safeWalletPaymentUrl,
  type WalletOverview,
  type WalletPayment,
  type WalletPaymentMethod,
  type WalletPlan,
  type WalletQuote,
  type WalletRedemption,
} from "../../utils/wallet";

const EPAY_METHODS = new Set(["alipay", "wxpay"]);
const safeNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const text = (value: unknown, max = 300) =>
  typeof value === "string" ? value.slice(0, max) : "";
const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);
function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
function positiveInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new NewApiError("请输入有效的正整数", 400);
  return value;
}
function fieldsOnly(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new NewApiError("支付请求包含不支持的参数", 400);
}
async function identity(
  req: NextRequest,
  mutation = false,
  reuseRequestSession = false,
) {
  const { session } = await getAuthenticatedSession(req, reuseRequestSession);
  if (!session.user) throw new NewApiError("请先登录账号", 401);
  if (mutation && req.headers.get("x-new-api-user") !== String(session.user.id))
    throw new NewApiError(
      "账号已变化，请刷新充值页面后重试",
      409,
      "NEW_API_ACCOUNT_CHANGED",
    );
  return session.user.id;
}

function paymentMethods(info: Record<string, any>): WalletPaymentMethod[] {
  if (info.enable_online_topup !== true) return [];
  return array(info.pay_methods)
    .filter(
      (item) =>
        item && EPAY_METHODS.has(item.type) && typeof item.name === "string",
    )
    .map((item) => ({ type: item.type as string, name: text(item.name, 50) }));
}
function normalizePlan(value: unknown): WalletPlan | null {
  const plan = object(object(value).plan);
  if (
    !Number.isSafeInteger(plan.id) ||
    plan.id <= 0 ||
    plan.enabled !== true ||
    !Number.isFinite(plan.price_amount) ||
    plan.price_amount < 0
  )
    return null;
  return {
    id: plan.id,
    title: text(plan.title, 200),
    subtitle: text(plan.subtitle, 500),
    priceAmount: plan.price_amount,
    currency: text(plan.currency, 10),
    durationUnit: text(plan.duration_unit, 20),
    durationValue: safeNumber(plan.duration_value),
    customSeconds: safeNumber(plan.custom_seconds),
    totalAmount: safeNumber(plan.total_amount),
    resetPeriod: text(plan.quota_reset_period, 20),
    resetSeconds: safeNumber(plan.quota_reset_custom_seconds),
    maxPurchases: safeNumber(plan.max_purchase_per_user),
    allowBalancePay: plan.allow_balance_pay !== false,
  };
}

export async function readWallet(req: NextRequest): Promise<WalletOverview> {
  const userId = await identity(req, false, true);
  const [
    infoResult,
    planResult,
    subscriptionsResult,
    historyResult,
    statusResult,
  ] = await Promise.all([
    accountRequest(req, "/api/user/topup/info", { reuseRequestSession: true }),
    accountRequest(req, "/api/subscription/plans", {
      reuseRequestSession: true,
    }),
    accountRequest(req, "/api/subscription/self", {
      reuseRequestSession: true,
    }),
    accountRequest(req, "/api/user/topup/self?p=1&page_size=20", {
      reuseRequestSession: true,
    }),
    upstream("/api/status"),
  ]);
  const info = object(infoResult.data),
    status = object(statusResult.data);
  const subscriptions = object(subscriptionsResult.data),
    history = object(historyResult.data);
  const quotaPerUnit = safeNumber(status.quota_per_unit, 500000);
  const quotaDisplayType = text(status.quota_display_type, 20) || "USD";
  const creditExchangeRate =
    quotaDisplayType === "CUSTOM"
      ? safeNumber(status.custom_currency_exchange_rate, 1)
      : quotaDisplayType === "CNY"
      ? safeNumber(status.usd_exchange_rate, 1)
      : 1;
  const currencySymbol =
    quotaDisplayType === "CUSTOM"
      ? text(status.custom_currency_symbol, 12)
      : quotaDisplayType === "CNY"
      ? "¥"
      : quotaDisplayType === "TOKENS"
      ? "tokens"
      : "$";
  const min = safeNumber(info.min_topup, 1);
  const minAmount = quotaDisplayType === "TOKENS" ? min * quotaPerUnit : min;
  const methods = paymentMethods(info);
  return {
    userId,
    currencySymbol,
    quotaPerUnit,
    quotaDisplayType,
    creditExchangeRate,
    topup: {
      enabled: info.enable_online_topup === true && methods.length > 0,
      redemptionEnabled: info.enable_redemption === true,
      redemptionUrl: safeWalletPaymentUrl(info.topup_link) ?? undefined,
      minAmount,
      amountOptions: array(info.amount_options)
        .map(Number)
        .filter((amount) => Number.isSafeInteger(amount) && amount >= minAmount)
        .slice(0, 20),
      paymentMethods: methods,
      discounts: Object.fromEntries(
        Object.entries(object(info.discount)).filter(
          ([amount, rate]) =>
            Number.isSafeInteger(Number(amount)) &&
            Number(amount) >= minAmount &&
            typeof rate === "number" &&
            Number.isFinite(rate) &&
            rate > 0 &&
            rate < 1,
        ),
      ),
    },
    plans: array(planResult.data)
      .map(normalizePlan)
      .filter((plan): plan is WalletPlan => plan !== null),
    subscriptions: array(
      subscriptions.all_subscriptions ?? subscriptions.subscriptions,
    )
      .slice(0, 100)
      .map((entry) => {
        const subscription = object(object(entry).subscription);
        return {
          id: safeNumber(subscription.id),
          planId: safeNumber(subscription.plan_id),
          status: text(subscription.status, 30),
          startTime: safeNumber(subscription.start_time),
          endTime: safeNumber(subscription.end_time),
          amountTotal: safeNumber(subscription.amount_total),
          amountUsed: safeNumber(subscription.amount_used),
          nextResetTime: safeNumber(subscription.next_reset_time),
        };
      }),
    history: array(history.items)
      .slice(0, 20)
      .map(object)
      .filter(
        (entry) =>
          Number.isSafeInteger(entry.id) &&
          entry.id > 0 &&
          (!entry.user_id || entry.user_id === userId),
      )
      .map((entry) => ({
        id: safeNumber(entry.id),
        tradeNo: text(entry.trade_no, 150),
        amount: safeNumber(entry.amount),
        money: safeNumber(entry.money),
        status: text(entry.status, 30),
        createdAt: safeNumber(entry.create_time),
        completedAt: safeNumber(entry.complete_time),
        paymentMethod: text(entry.payment_method, 30),
      })),
    historyTotal: safeNumber(history.total),
  };
}

function moneyString(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d+(?:\.\d{1,2})?$/.test(value) ||
    !Number.isFinite(Number(value)) ||
    Number(value) <= 0
  )
    throw new NewApiError("支付金额响应无效，请刷新后重试", 502);
  return value;
}

export async function quoteWallet(
  req: NextRequest,
  input: Record<string, unknown>,
): Promise<WalletQuote> {
  fieldsOnly(input, ["amount"]);
  const userId = await identity(req, true, true);
  const amount = positiveInteger(input.amount);
  return { userId, amount, money: await quoteMoney(req, amount) };
}

async function quoteMoney(req: NextRequest, amount: number) {
  const { data } = await accountRequest(req, "/api/user/amount", {
    method: "POST",
    body: { amount },
    paymentEnvelope: true,
    reuseRequestSession: true,
  });
  return moneyString(data);
}

// No requests are sent to a payment URL here. Resolve its public destination
// before returning it as a browser form target; never expose an internal host.
const blocked = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(ip, bits, "ipv4");
const ipv6Public = new BlockList();
ipv6Public.addSubnet("2000::", 3, "ipv6");
const ipv6Reserved = new BlockList();
for (const [ip, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  ipv6Reserved.addSubnet(ip, bits, "ipv6");
export async function validateWalletPaymentUrl(
  value: unknown,
): Promise<string> {
  const url = safeWalletPaymentUrl(value);
  if (!url) throw new NewApiError("支付网关地址不安全，请联系管理员", 502);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(new URL(url).hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("DNS timeout")), 3000);
      }),
    ]);
    if (
      !addresses.length ||
      addresses.some(({ address }) =>
        isIP(address) === 4
          ? blocked.check(address, "ipv4")
          : !ipv6Public.check(address, "ipv6") ||
            ipv6Reserved.check(address, "ipv6"),
      )
    )
      throw new Error("Private payment host");
    return url;
  } catch {
    throw new NewApiError("支付网关暂不可用，请稍后再试", 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function paymentResult(
  userId: number,
  kind: WalletPayment["kind"],
  paymentMethod: string,
  result: { data: unknown; url?: string },
): Promise<WalletPayment> {
  const action = await validateWalletPaymentUrl(result.url);
  const data = object(result.data),
    fields: Record<string, string> = {};
  const allowed = new Set([
    "pid",
    "type",
    "out_trade_no",
    "notify_url",
    "return_url",
    "name",
    "money",
    "device",
    "sign",
    "sign_type",
    "sitename",
    "param",
  ]);
  for (const [key, value] of Object.entries(data)) {
    if (!allowed.has(key) || typeof value !== "string" || value.length > 4096)
      throw new NewApiError("支付表单响应无效，请联系管理员", 502);
    fields[key] = value;
  }
  const tradeNo = fields.out_trade_no;
  if (
    !tradeNo ||
    tradeNo.length > 150 ||
    !tradeNo.startsWith(
      `${kind === "subscription" ? "SUB" : ""}USR${userId}NO`,
    ) ||
    fields.type !== paymentMethod ||
    !fields.pid ||
    !fields.sign ||
    !fields.sign_type
  )
    throw new NewApiError("支付订单响应无效，请重新读取订单", 502);
  const origin = requireNewApiConfig().publicUrl;
  const callbackPaths =
    kind === "subscription"
      ? {
          notify_url: "/api/subscription/epay/notify",
          return_url: "/api/subscription/epay/return",
        }
      : { notify_url: "/api/user/epay/notify", return_url: "/usage-logs" };
  for (const [key, path] of Object.entries(callbackPaths)) {
    const target = safeWalletPaymentUrl(fields[key]);
    if (
      !target ||
      new URL(target).origin !== origin ||
      new URL(target).pathname !== path ||
      new URL(target).search
    )
      throw new NewApiError("支付回调配置不匹配，请联系管理员", 502);
  }
  return {
    userId,
    kind,
    action,
    method: "POST",
    fields,
    tradeNo,
    paymentMethod,
    money: moneyString(fields.money),
  };
}

export async function createWalletPayment(
  req: NextRequest,
  input: Record<string, unknown>,
  kind: WalletPayment["kind"],
): Promise<WalletPayment> {
  fieldsOnly(
    input,
    kind === "topup"
      ? ["amount", "paymentMethod"]
      : ["planId", "paymentMethod", "expectedPrice"],
  );
  const userId = await identity(req, true, true);
  const method = input.paymentMethod;
  if (typeof method !== "string" || !EPAY_METHODS.has(method))
    throw new NewApiError("请选择当前可用的支付方式", 400);
  const amount = kind === "topup" ? positiveInteger(input.amount) : undefined;
  const planId =
    kind === "subscription" ? positiveInteger(input.planId) : undefined;
  const expected =
    input.expectedPrice === undefined ? undefined : object(input.expectedPrice);
  if (expected) {
    fieldsOnly(expected, ["amount", "currency"]);
    if (
      typeof expected.amount !== "number" ||
      !Number.isFinite(expected.amount) ||
      expected.amount < 0 ||
      typeof expected.currency !== "string"
    )
      throw new NewApiError("套餐价格信息无效，请刷新套餐后重试", 400);
  }
  // Independent reads share this request's authenticated snapshot; the write below revalidates.
  const [{ data: info }, pricing] = await Promise.all([
    accountRequest(req, "/api/user/topup/info", { reuseRequestSession: true }),
    kind === "topup"
      ? quoteMoney(req, amount!)
      : expected
      ? accountRequest(req, "/api/subscription/plans", {
          reuseRequestSession: true,
        })
      : Promise.resolve(undefined),
  ]);
  if (!paymentMethods(object(info)).some((item) => item.type === method))
    throw new NewApiError("该支付方式暂未开放，请刷新后重试", 400);
  let result;
  if (kind === "topup") {
    result = await accountRequest(req, "/api/user/pay", {
      method: "POST",
      body: { amount, payment_method: method },
      paymentEnvelope: true,
    });
  } else {
    if (expected) {
      const plan = array(
        typeof pricing === "object" ? pricing?.data : undefined,
      )
        .map(normalizePlan)
        .find((item) => item?.id === planId);
      if (
        !plan ||
        plan.priceAmount !== expected.amount ||
        plan.currency !== expected.currency
      )
        throw new NewApiError(
          "套餐价格或状态已变化，请刷新套餐后重新确认",
          400,
        );
    }
    result = await accountRequest(req, "/api/subscription/epay/pay", {
      method: "POST",
      body: { plan_id: planId, payment_method: method },
      paymentEnvelope: true,
    });
  }
  return paymentResult(userId, kind, method, result);
}

export async function redeemWallet(
  req: NextRequest,
  input: Record<string, unknown>,
): Promise<WalletRedemption> {
  fieldsOnly(input, ["key"]);
  const userId = await identity(req, true);
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (!key || key.length > 256)
    throw new NewApiError("请输入有效的兑换码", 400);
  const { data: info } = await accountRequest(req, "/api/user/topup/info");
  if (object(info).enable_redemption !== true)
    throw new NewApiError("兑换码充值暂未开放", 400);
  const { data } = await accountRequest(req, "/api/user/topup", {
    method: "POST",
    body: { key },
  });
  if (typeof data !== "number" || !Number.isFinite(data) || data <= 0)
    throw new NewApiError("兑换结果暂未确认，请刷新余额，勿重复提交", 502);
  return { userId, creditedQuota: data };
}
