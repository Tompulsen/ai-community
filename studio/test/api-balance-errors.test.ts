/** @jest-environment node */
import { jest } from "@jest/globals";
import { isInsufficientBalance } from "../app/utils/quota-error";

jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({}),
}));
jest.unstable_mockModule("@/app/client/platforms/openai", () => ({
  ChatGPTApi: class {},
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: { getState: () => ({}) },
}));
jest.unstable_mockModule("@/app/client/new-api", () => ({
  getExpectedNewApiUserId: () => 1,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalTokenId: () => 1,
  getLocalScope: () => "account",
  localKey: (key: string) => key,
}));
jest.unstable_mockModule("@/app/locales", () => ({ default: {} }));
jest.unstable_mockModule("@/app/client/chat-formats", () => ({
  nativeChatUrl: () => "",
}));

const { classifyApiError, ApiFetchError } = await import("../app/client/api");

test.each([400, 403, 429, 500])(
  "wallet error takes precedence over HTTP %s's generic label",
  (status) => {
    const body = {
      error: { code: "insufficient_user_quota", message: "余额不足" },
    };
    const error = new ApiFetchError("余额不足", status, body);
    expect(error.tip).toBe("余额不足，请充值后重试");
    expect(error.message).toBe("余额不足");
    expect(error.code).toBe("insufficient_user_quota");
    expect(error.body).toBe(body);
    expect(isInsufficientBalance(error)).toBe(true);
  },
);

test("a nested error code is sufficient even if the server message is generic", () => {
  expect(
    classifyApiError({
      message: "Request rejected",
      status: 403,
      body: { error: { code: "insufficient_user_quota" } },
    }).tip,
  ).toBe("余额不足，请充值后重试");
});

test.each([
  ["token quota exhausted", "密钥额度不足或不可用，请检查密钥额度及状态"],
  ["令牌额度不足", "密钥额度不足或不可用，请检查密钥额度及状态"],
  ["subscription quota exhausted", "订阅额度不足，请检查套餐或切换计费方式"],
  ["套餐额度不足", "订阅额度不足，请检查套餐或切换计费方式"],
  ["rate_limit_exceeded", "请求限流，调用过于频繁"],
])("%s does not turn into a wallet recharge error", (message, expected) => {
  const error = new ApiFetchError(message, 403, { error: { message } });
  expect(error.tip).toBe(expected);
  expect(isInsufficientBalance(error)).toBe(false);
  expect(isInsufficientBalance(error.tip)).toBe(false);
});

test("authentication and unrelated insufficient errors keep their own category", () => {
  expect(
    classifyApiError({ message: "insufficient permissions", status: 403 }).tip,
  ).toContain("认证失败");
  expect(
    classifyApiError({ message: "Failed to fetch", isNetworkError: true })
      .errorType,
  ).toBe("网络错误");
});
