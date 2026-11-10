import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import type { WalletOverview, WalletPayment } from "../app/utils/wallet";
const overview: WalletOverview = {
  userId: 7,
  currencySymbol: "✦",
  quotaPerUnit: 500000,
  quotaDisplayType: "CUSTOM",
  creditExchangeRate: 1,
  topup: {
    enabled: true,
    redemptionEnabled: true,
    minAmount: 1,
    amountOptions: [10, 20, 50],
    paymentMethods: [{ type: "alipay", name: "支付宝" }],
  },
  plans: [
    {
      id: 1,
      title: "7日体验包",
      subtitle: "日常创作",
      priceAmount: 19.99,
      currency: "USD",
      durationUnit: "day",
      durationValue: 7,
      customSeconds: 0,
      totalAmount: 2500000,
      resetPeriod: "daily",
      resetSeconds: 0,
      maxPurchases: 1,
      allowBalancePay: true,
    },
  ],
  subscriptions: [],
  history: [],
  historyTotal: 0,
};
const payment: WalletPayment = {
  userId: 7,
  kind: "topup",
  action: "https://checkout.example.com/submit",
  method: "POST",
  fields: { out_trade_no: "test-order", money: "10" },
  tradeNo: "test-order",
  money: "10",
  paymentMethod: "alipay",
};
const read = jest.fn<(...args: unknown[]) => Promise<WalletOverview>>();
const quote =
  jest.fn<
    (
      amount: number,
    ) => Promise<{ userId: number; amount: number; money: string }>
  >();
const pay = jest.fn<(...args: unknown[]) => Promise<WalletPayment>>();
const subPay = jest.fn<(...args: unknown[]) => Promise<WalletPayment>>();
const redeem = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const refresh = jest.fn<() => Promise<void>>();
jest.unstable_mockModule("@/app/client/new-api", () => ({
  newApiClient: {
    walletOverview: read,
    walletQuote: quote,
    walletPay: pay,
    walletSubscriptionPay: subPay,
    walletRedeem: redeem,
  },
}));
const { AccountWallet } = await import("../app/components/account-wallet");
let submit: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
  window.dispatchEvent(new Event("new-api-session-changed"));
  jest.spyOn(window, "open").mockReturnValue(null);
  read.mockReset().mockResolvedValue(overview);
  quote.mockReset().mockImplementation(async (amount) => ({
    userId: 7,
    amount,
    money: String(amount),
  }));
  pay.mockReset().mockResolvedValue(payment);
  subPay.mockReset().mockResolvedValue({ ...payment, kind: "subscription" });
  redeem.mockReset().mockResolvedValue({ userId: 7, creditedQuota: 5 });
  refresh.mockReset().mockResolvedValue();
  submit = jest
    .spyOn(HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});
async function mount() {
  await act(async () => {
    render(<AccountWallet userId={7} onRefreshBalance={refresh} />);
  });
}
test("mixed legacy and Unix order dates render without crashing the wallet", async () => {
  const timestamps = [
    20260619104538,
    1794177604,
    20260230094500,
    20261301094500,
    Number.MAX_VALUE,
    0,
  ];
  read.mockResolvedValue({
    ...overview,
    history: timestamps.map((createdAt, index) => ({
      id: index + 1,
      tradeNo: `date-order-${index}`,
      amount: 10,
      money: 10,
      status: "success",
      createdAt,
      completedAt: 0,
      paymentMethod: "alipay",
    })),
    historyTotal: timestamps.length,
  });
  await mount();
  const legacy = screen.getByText("date-order-0").closest("tr")!;
  expect(legacy.querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-06-19T10:45:38",
  );
  expect(legacy).toHaveTextContent("2026/6/19 10:45");
  expect(
    screen.getByText("date-order-1").closest("tr")?.querySelector("time"),
  ).toHaveAttribute("datetime", new Date(1794177604 * 1000).toISOString());
  expect(screen.getAllByText("时间未知")).toHaveLength(4);
  expect(
    screen.getByRole("button", { name: "确认金额，去支付" }),
  ).toBeInTheDocument();
  expect(pay).not.toHaveBeenCalled();
});

test("wallet stays local and creates one order only after amount confirmation", async () => {
  await mount();
  expect(pay).not.toHaveBeenCalled();
  expect(subPay).not.toHaveBeenCalled();
  const confirm = screen.getByRole("button", { name: "确认金额，去支付" });
  await waitFor(() =>
    expect((confirm as HTMLButtonElement).disabled).toBe(false),
  );
  await act(async () => {
    fireEvent.click(confirm);
    fireEvent.click(confirm);
  });
  expect(pay).toHaveBeenCalledTimes(1);
  expect(pay).toHaveBeenCalledWith(10, "alipay", 7);
  expect(screen.queryByTitle("安全支付")).toBeNull();
  expect(window.open).not.toHaveBeenCalled();
  expect(document.querySelector("form")?.target).toBe("_self");
  expect(submit).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "正在跳转…" }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/充值已到账/)).toBeNull();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "我已支付，刷新余额" })),
  );
  expect(refresh).toHaveBeenCalled();
  expect(screen.queryByText(/充值已到账/)).toBeNull();
});

test("order creation stays in the wallet panel without opening a blank page", async () => {
  let resolve!: (value: WalletPayment) => void;
  pay.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount();
  const confirm = screen.getByRole("button", { name: "确认金额，去支付" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  expect(
    screen.getByRole("heading", { name: "正在创建订单，请稍候…" }),
  ).toBeTruthy();
  expect(window.open).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  await act(async () => resolve(payment));
  expect(submit).toHaveBeenCalledTimes(1);
});

test("failed navigation leaves a retry action for the existing order", async () => {
  submit.mockImplementationOnce(() => {
    throw new Error("navigation failed");
  });
  await mount();
  const confirm = screen.getByRole("button", { name: "确认金额，去支付" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await screen.findByText("无法打开支付页，请点击继续支付重试。");
  fireEvent.click(screen.getByRole("button", { name: "继续支付" }));
  expect(submit).toHaveBeenCalledTimes(2);
  expect(pay).toHaveBeenCalledTimes(1);
});

test("embedded navigation replaces the repeated heading while refresh bypasses the cached wallet and updates balance", async () => {
  await act(async () => {
    render(
      <AccountWallet
        userId={7}
        onRefreshBalance={refresh}
        navigation={
          <nav aria-label="账户内容">
            <button type="button">充值与套餐</button>
            <button type="button">密钥与用量</button>
          </nav>
        }
      />,
    );
  });
  expect(
    screen.getByRole("navigation", { name: "账户内容" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "充值与套餐" })).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "刷新余额" })),
  );
  expect(read).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/余额与订单状态已刷新/)).toBeInTheDocument();
  expect(pay).not.toHaveBeenCalled();
  expect(subPay).not.toHaveBeenCalled();
});

test("switching amounts and remounting reuse quotes and wallet configuration", async () => {
  await mount();
  await waitFor(() => expect(quote).toHaveBeenCalledWith(10, 7));
  fireEvent.click(screen.getByRole("button", { name: "20" }));
  await waitFor(() => expect(quote).toHaveBeenCalledWith(20, 7));
  fireEvent.click(screen.getByRole("button", { name: "10" }));
  expect(
    screen.getByRole("button", { name: "确认金额，去支付" }),
  ).toBeEnabled();
  expect(quote).toHaveBeenCalledTimes(2);
  cleanup();
  await mount();
  expect(screen.queryByText("正在读取充值方式与套餐…")).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
  expect(quote).toHaveBeenCalledTimes(2);
});

test("changed checkout price waits for confirmation instead of submitting", async () => {
  pay.mockResolvedValue({ ...payment, money: "11", fields: { money: "11" } });
  await mount();
  const confirm = screen.getByRole("button", { name: "确认金额，去支付" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await screen.findByText(/支付报价已变化/);
  expect(submit).not.toHaveBeenCalled();
  const continueButton = screen.getByRole("button", { name: "继续支付" });
  fireEvent.click(continueButton);
  fireEvent.click(continueButton);
  expect(submit).toHaveBeenCalledTimes(1);
});

test("failed orders and unmounting never navigate to payment", async () => {
  pay.mockRejectedValue(new Error("订单创建失败"));
  await mount();
  const confirm = screen.getByRole("button", { name: "确认金额，去支付" });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await screen.findByText("订单创建失败");
  expect(window.open).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  pay.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "确认金额，去支付" }));
  cleanup();
  expect(submit).not.toHaveBeenCalled();
});

test("leaving preview never submits the pending mock checkout as a live form", async () => {
  const { createLocalAccountPreviewClient } = await import(
    "../app/utils/local-account-preview"
  );
  const demo = createLocalAccountPreviewClient();
  const view = render(
    <AccountWallet
      userId={-1}
      onRefreshBalance={refresh}
      previewClient={demo}
    />,
  );
  const confirm = await screen.findByRole("button", {
    name: "确认金额，去支付",
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await screen.findByRole("heading", { name: "模拟收银台" });
  expect(submit).not.toHaveBeenCalled();
  await act(async () =>
    view.rerender(<AccountWallet userId={7} onRefreshBalance={refresh} />),
  );
  expect(screen.queryByRole("heading", { name: "模拟收银台" })).toBeNull();
  expect(screen.queryByTitle("安全支付")).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});
test("plan purchase requires its own confirmation and keeps current account binding", async () => {
  await mount();
  const trigger = screen.getByRole("button", { name: /^选择此套餐：/ });
  fireEvent.click(trigger);
  const cancel = screen.getByRole("button", { name: "取消" });
  cancel.focus();
  fireEvent.click(cancel);
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("button", { name: "确认套餐，去支付" })).toBeNull();
  expect(subPay).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "确认套餐，去支付" })),
  );
  expect(subPay).toHaveBeenCalledWith(1, "alipay", 7, {
    amount: 19.99,
    currency: "USD",
  });
});
test("configured discounts are displayed while payable total uses the server quote", async () => {
  read.mockResolvedValue({
    ...overview,
    topup: { ...overview.topup, discounts: { "20": 0.97 } },
  });
  quote.mockImplementation(async (amount) => ({
    userId: 7,
    amount,
    money: amount === 20 ? "17.46" : String(amount),
  }));
  await mount();
  fireEvent.click(screen.getByRole("button", { name: /20.*优惠 3%/ }));
  await waitFor(() => expect(screen.getByText("17.46")).toBeTruthy());
  expect(screen.getByText("已享优惠 3%")).toBeTruthy();
});

test("redemption acquisition uses the configured link and rejects unsafe URLs", async () => {
  read.mockResolvedValue({
    ...overview,
    topup: {
      ...overview.topup,
      redemptionUrl: "https://shop.example.com/codes",
    },
  });
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "使用兑换码" }));
  expect(
    screen.getByRole("link", { name: "获取兑换码" }).getAttribute("href"),
  ).toBe("https://shop.example.com/codes");
  cleanup();
  window.dispatchEvent(new Event("new-api-session-changed"));
  read.mockResolvedValue({
    ...overview,
    topup: { ...overview.topup, redemptionUrl: "javascript:alert(1)" },
  });
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "使用兑换码" }));
  expect(screen.queryByRole("link", { name: "获取兑换码" })).toBeNull();
});

test("invalid amount never enables payment", async () => {
  await mount();
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "-2" } });
  expect(
    (
      screen.getByRole("button", {
        name: "确认金额，去支付",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(pay).not.toHaveBeenCalled();
});
test("account change discards a pending checkout response", async () => {
  let resolve!: (value: WalletPayment) => void;
  pay.mockImplementation(() => new Promise((done) => (resolve = done)));
  await mount();
  const confirm = screen.getByRole("button", { name: "确认金额，去支付" });
  await waitFor(() =>
    expect((confirm as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(confirm);
  act(() => window.dispatchEvent(new Event("new-api-session-changed")));
  await act(async () => resolve(payment));
  expect(window.open).not.toHaveBeenCalled();
  expect(screen.queryByTitle("安全支付")).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});
test("only a matching settled order reports that the topup arrived", async () => {
  await mount();
  const confirm = screen.getByRole("button", { name: "确认金额，去支付" });
  await waitFor(() =>
    expect((confirm as HTMLButtonElement).disabled).toBe(false),
  );
  await act(async () => fireEvent.click(confirm));
  read.mockResolvedValue({
    ...overview,
    history: [
      {
        id: 1,
        tradeNo: "test-order",
        amount: 10,
        money: 10,
        status: "success",
        createdAt: 1,
        completedAt: 2,
        paymentMethod: "alipay",
      },
    ],
    historyTotal: 1,
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "我已支付，刷新余额" })),
  );
  expect(screen.getByText("充值已到账，账户余额已更新。")).toBeTruthy();
});

test("credit display uses the configured currency exchange rate", async () => {
  read.mockResolvedValue({
    ...overview,
    currencySymbol: "¥",
    quotaDisplayType: "CNY",
    creditExchangeRate: 7,
  });
  await mount();
  expect(screen.getByLabelText("预计到账额度")).toHaveTextContent("到账 ¥70");
  expect(screen.getByText("¥35")).toBeTruthy();
});

test("token recharge prevents rounded-down quantities and shows raw token credit", async () => {
  read.mockResolvedValue({
    ...overview,
    currencySymbol: "tokens",
    quotaDisplayType: "TOKENS",
    topup: { ...overview.topup, minAmount: 500000, amountOptions: [500000] },
  });
  await mount();
  expect(screen.getByLabelText("预计到账额度")).toHaveTextContent(
    "到账 tokens500,000",
  );
  fireEvent.change(screen.getByRole("spinbutton"), {
    target: { value: "500001" },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "确认金额，去支付",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(pay).not.toHaveBeenCalled();
});

test("redemption disclosure stays accessible through entry, success and closing", async () => {
  await mount();
  const trigger = screen.getByRole("button", { name: "使用兑换码" });
  const panelId = trigger.getAttribute("aria-controls")!;
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById(panelId)).toHaveAttribute("inert");
  expect(document.getElementById(panelId)).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(screen.queryByRole("textbox", { name: "兑换码" })).toBeNull();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(document.getElementById(panelId)).not.toHaveAttribute("inert");
  expect(document.getElementById(panelId)).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "兑换码" }), {
    target: { value: " TEST-CODE " },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /^兑换(?:额度)?$/ })),
  );
  expect(redeem).toHaveBeenCalledWith("TEST-CODE", 7);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByText("兑换成功，账户余额已更新。")).toBeVisible();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
  expect(document.getElementById(panelId)).toHaveAttribute("inert");
  expect(document.getElementById(panelId)).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(screen.queryByRole("textbox", { name: "兑换码" })).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByRole("textbox", { name: "兑换码" })).toHaveValue("");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById(panelId)).toHaveAttribute("inert");
  expect(document.getElementById(panelId)).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(screen.queryByRole("textbox", { name: "兑换码" })).toBeNull();
});

test("redemption remains available when online recharge is disabled", async () => {
  read.mockResolvedValue({
    ...overview,
    topup: {
      ...overview.topup,
      enabled: false,
      redemptionEnabled: true,
      paymentMethods: [],
    },
  });
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "使用兑换码" }));
  fireEvent.change(screen.getByRole("textbox", { name: "兑换码" }), {
    target: { value: "REDEEM-ONLY" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /^兑换(?:额度)?$/ })),
  );
  expect(redeem).toHaveBeenCalledWith("REDEEM-ONLY", 7);
  expect(screen.getByText("兑换成功，账户余额已更新。")).toBeVisible();
  expect(quote).not.toHaveBeenCalled();
  expect(pay).not.toHaveBeenCalled();
  expect(subPay).not.toHaveBeenCalled();
});

test("plans show full terms and expired subscriptions still count toward purchase limits", async () => {
  read.mockResolvedValue({
    ...overview,
    subscriptions: [
      {
        id: 71,
        planId: 1,
        status: "expired",
        startTime: 1,
        endTime: 2,
        amountTotal: 2500000,
        amountUsed: 500000,
        nextResetTime: 0,
      },
    ],
  });
  await mount();
  const plan = screen
    .getByRole("heading", { name: "7日体验包" })
    .closest("article")!;
  expect(plan).toHaveTextContent(/7\s*天/);
  expect(plan).toHaveTextContent("每日重置");
  expect(plan).toHaveTextContent(/限购\s*1\s*次/);
  const select = within(plan).getByRole("button", {
    name: /^已达购买上限：7日体验包$/,
  });
  expect(select).toBeDisabled();
  expect(select).toHaveTextContent("已达购买上限");
  expect(subPay).not.toHaveBeenCalled();
});

test.each(["pending", "success", "expired", "failed"])(
  "history stays open and only the matching pending checkout can resume (current order: %s)",
  async (status) => {
    await mount();
    const confirm = screen.getByRole("button", { name: "确认金额，去支付" });
    await waitFor(() => expect(confirm).toBeEnabled());
    await act(async () => fireEvent.click(confirm));
    fireEvent.click(screen.getByRole("button", { name: "返回充值" }));
    expect(screen.getAllByRole("button", { name: /继续支付/ })).toHaveLength(1);
    const order = {
      amount: 10,
      money: 10,
      createdAt: 1,
      completedAt: 0,
      paymentMethod: "alipay",
    };
    const history = [
      { ...order, id: 1, tradeNo: "test-order", status },
      { ...order, id: 2, tradeNo: "unknown-pending", status: "pending" },
      { ...order, id: 3, tradeNo: "settled-order", status: "success" },
      { ...order, id: 4, tradeNo: "expired-order", status: "expired" },
      { ...order, id: 5, tradeNo: "failed-order", status: "failed" },
    ];
    read.mockResolvedValue({
      ...overview,
      history,
      historyTotal: history.length,
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "刷新余额" })),
    );
    for (const item of history) {
      expect(screen.getByText(item.tradeNo)).toBeVisible();
    }
    const resume = screen.queryAllByRole("button", { name: /继续支付/ });
    expect(resume).toHaveLength(status === "pending" ? 1 : 0);
    if (status === "pending") {
      fireEvent.click(resume[0]);
      expect(
        screen.getByRole("heading", { name: "订单已准备好" }),
      ).toBeVisible();
      expect(screen.getByText("test-order")).toBeVisible();
    }
    expect(pay).toHaveBeenCalledTimes(1);
    expect(subPay).not.toHaveBeenCalled();
  },
);
