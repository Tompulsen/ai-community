import { isInsufficientBalance } from "./quota-error";
test.each([
  "用户额度不足",
  "余额不足",
  "insufficient_quota",
  "账户余额已耗尽",
  "user_quota_not_enough",
  "预扣额度失败",
  "Insufficient user quota, remaining quota: 0",
  "Not enough quota to pre-consume for this request: 100",
  "预扣费额度失败, 用户剩余额度: 0, 需要预扣费额度: 100",
])("wallet exhaustion: %s", (message) =>
  expect(isInsufficientBalance(new Error(message))).toBe(true),
);

test("structured response codes survive a generic display message", () => {
  expect(
    isInsufficientBalance({
      message: "Request rejected",
      body: { error: { code: "insufficient_user_quota" } },
    }),
  ).toBe(true);
  expect(
    isInsufficientBalance({
      message: "额度不足",
      body: { error: { code: "token_quota_exhausted" } },
    }),
  ).toBe(false);
  expect(
    isInsufficientBalance({
      message: "额度不足",
      body: { error: { code: "subscription_quota_exhausted" } },
    }),
  ).toBe(false);
});

test("does not read request payloads or recurse through cyclic errors", () => {
  const error: { message: string; body?: unknown } = {
    message: "Request failed",
  };
  error.body = error;
  expect(isInsufficientBalance(error)).toBe(false);
  expect(
    isInsufficientBalance({
      message: "Request failed",
      request: { prompt: "余额不足" },
    }),
  ).toBe(false);
});
test.each([
  "订阅额度不足或未配置订阅",
  "subscription quota exhausted",
  "套餐额度不足",
  "429 Too many requests",
  "rate_limit_exceeded",
  "令牌额度不足",
  "token quota exhausted",
  "NEW_API_GROUP_TOKEN_UNAVAILABLE 额度不足",
  "该密钥已停用、过期、额度不足或被修改",
  "Failed to fetch",
  "unsupported model",
  "context length exceeded",
])("not wallet exhaustion: %s", (message) =>
  expect(isInsufficientBalance(message)).toBe(false),
);
