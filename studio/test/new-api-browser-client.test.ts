/** @jest-environment node */
import { jest } from "@jest/globals";

jest.unstable_mockModule("@/app/locales", () => ({
  default: { Account: { RequestFailed: "请求失败" } },
}));
const confirmIdentity = jest.fn();
const confirmToken = jest.fn();
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  confirmLocalIdentity: confirmIdentity,
  confirmLocalToken: confirmToken,
  getLocalTokenId: () => null,
}));

const {
  newApiClient,
  NewApiError,
  invalidateNewApiModelSource,
  setNewApiExpectedUser,
} = await import("../app/client/new-api");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setNewApiExpectedUser(null);
  jest.useRealTimers();
});

describe("wallet account isolation", () => {
  test("wallet query requires a current known user before sending requests", async () => {
    setNewApiExpectedUser(null);
    globalThis.fetch = jest.fn<typeof fetch>();
    await expect(newApiClient.walletOverview()).rejects.toMatchObject({
      status: 409,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  test("a stale view cannot submit a payment for the newly selected user", async () => {
    setNewApiExpectedUser(18);
    globalThis.fetch = jest.fn<typeof fetch>();
    await expect(
      newApiClient.walletPay(10, "alipay", 17),
    ).rejects.toMatchObject({ status: 409 });
    await expect(newApiClient.walletRedeem("secret", 17)).rejects.toMatchObject(
      { status: 409 },
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  test("wallet request captures expected identity in its header", async () => {
    setNewApiExpectedUser(17);
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        success: true,
        data: { userId: 17, amount: 10, money: "2.50" },
      }),
    );
    await expect(newApiClient.walletQuote(10, 17)).resolves.toMatchObject({
      userId: 17,
      money: "2.50",
    });
    const [url, options] = jest.mocked(fetch).mock.calls[0];
    expect(url).toBe("/studio/api/new-api/wallet/quote");
    expect(new Headers(options?.headers).get("X-New-Api-User")).toBe("17");
    expect(options?.credentials).toBe("same-origin");
    expect(options?.signal).toBeUndefined();
  });
  test.each(["account", "revision", "response"])(
    "a late wallet response is rejected after %s changes",
    async (change) => {
      setNewApiExpectedUser(17);
      let resolve!: (response: Response) => void;
      globalThis.fetch = jest.fn<typeof fetch>().mockReturnValue(
        new Promise<Response>((done) => {
          resolve = done;
        }),
      );
      const result = newApiClient.walletPay(10, "alipay", 17);
      if (change === "account") setNewApiExpectedUser(18);
      if (change === "revision") invalidateNewApiModelSource();
      resolve(
        Response.json({
          success: true,
          data: { userId: change === "response" ? 18 : 17 },
        }),
      );
      await expect(result).rejects.toMatchObject({ status: 409 });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  test("failed wallet writes are not retried", async () => {
    setNewApiExpectedUser(17);
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { success: false, message: "订单未确认" },
          { status: 502 },
        ),
      );
    await expect(
      newApiClient.walletPay(10, "alipay", 17),
    ).rejects.toMatchObject({ status: 502 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("account read reuse", () => {
  beforeEach(() => {
    invalidateNewApiModelSource();
    setNewApiExpectedUser(17);
    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ success: true, data: { items: [], total: 0 } }),
      );
  });

  test("same account and page share pending reads, while pagination and manual refresh read afresh", async () => {
    await Promise.all([
      newApiClient.tokens(1, 10, 17),
      newApiClient.tokens(1, 10, 17),
    ]);
    await newApiClient.tokens(1, 10, 17);
    expect(fetch).toHaveBeenCalledTimes(1);
    await newApiClient.tokens(2, 10, 17);
    await newApiClient.tokens(1, 10, 17, true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("usage expires after fifteen seconds and account changes drop all cached pages", async () => {
    let now = 1000;
    const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await newApiClient.logs(1, 10, 17);
      await newApiClient.logs(1, 10, 17);
      expect(fetch).toHaveBeenCalledTimes(1);
      now += 15_001;
      await newApiClient.logs(1, 10, 17);
      setNewApiExpectedUser(18);
      await newApiClient.logs(1, 10, 18);
      setNewApiExpectedUser(17);
      await newApiClient.logs(1, 10, 17);
      expect(fetch).toHaveBeenCalledTimes(4);
    } finally {
      clock.mockRestore();
    }
  });

  test("old in-flight results cannot refill caches after invalidation", async () => {
    let resolve!: (response: Response) => void;
    jest.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = newApiClient.tokens(1, 10, 17);
    invalidateNewApiModelSource();
    resolve(Response.json({ success: true, data: { items: [], total: 0 } }));
    await pending;
    await newApiClient.tokens(1, 10, 17);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("creating keys invalidates the earlier list and errors never become cached data", async () => {
    await newApiClient.tokens(1, 10, 17);
    await newApiClient.createToken(
      { name: "new" } as Parameters<typeof newApiClient.createToken>[0],
      17,
    );
    await newApiClient.tokens(1, 10, 17);
    expect(fetch).toHaveBeenCalledTimes(3);
    jest.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await expect(newApiClient.logs(1, 10, 17)).rejects.toThrow("offline");
    await newApiClient.logs(1, 10, 17);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  test("a changed account group invalidates cached group permissions", async () => {
    let group = "default";
    globalThis.fetch = jest.fn<typeof fetch>().mockImplementation(async (url) =>
      Response.json({
        success: true,
        data: String(url).endsWith("/session")
          ? { authenticated: true, selectedTokenId: 1, user: { id: 17, group } }
          : [],
      }),
    );
    await newApiClient.session();
    await newApiClient.groups(17);
    await newApiClient.autoGroups(17);
    group = "premium";
    await newApiClient.session();
    await newApiClient.groups(17);
    await newApiClient.autoGroups(17);
    expect(
      jest
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).endsWith("/groups")),
    ).toHaveLength(2);
    expect(
      jest
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).endsWith("/auto-groups")),
    ).toHaveLength(2);
  });
});

test("account queries time out instead of waiting indefinitely", async () => {
  jest.useFakeTimers();
  globalThis.fetch = jest.fn<typeof fetch>().mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  const result = newApiClient.status();
  const assertion = expect(result).rejects.toMatchObject({
    message: "请求超时，请稍后重试",
    status: 408,
  });
  await jest.advanceTimersByTimeAsync(15000);
  await assertion;
});

test("successful queries clear their timeout", async () => {
  jest.useFakeTimers();
  globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      success: true,
      data: { enabled: true },
    }),
  );
  await expect(newApiClient.status()).resolves.toEqual({ enabled: true });
  expect(jest.getTimerCount()).toBe(0);
});

test("account writes are not aborted by the query timeout", async () => {
  const mockedFetch = jest.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      success: true,
      data: {},
    }),
  );
  globalThis.fetch = mockedFetch;
  await newApiClient.createToken({
    name: "fixture",
    group: "",
    expired_time: -1,
    remain_quota: 0,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: "",
  });
  expect(mockedFetch.mock.calls[0][1]?.signal).toBeUndefined();
  expect(NewApiError).toBeDefined();
});

test("a late old session cannot overwrite the newer identity or selected key", async () => {
  confirmIdentity.mockClear();
  confirmToken.mockClear();
  let resolveOld!: (response: Response) => void;
  const oldResponse = new Promise<Response>(
    (resolve) => (resolveOld = resolve),
  );
  globalThis.fetch = jest
    .fn<typeof fetch>()
    .mockReturnValueOnce(oldResponse)
    .mockResolvedValueOnce(
      Response.json({
        success: true,
        data: {
          authenticated: true,
          user: { id: 8 },
          selectedTokenId: 80,
        },
      }),
    );
  const oldSession = newApiClient.session();
  invalidateNewApiModelSource();
  await newApiClient.session();
  resolveOld(
    Response.json({
      success: true,
      data: {
        authenticated: true,
        user: { id: 7 },
        selectedTokenId: 70,
      },
    }),
  );
  await oldSession;
  expect(confirmIdentity.mock.calls).toEqual([[8]]);
  expect(confirmToken.mock.calls).toEqual([[80]]);
});
