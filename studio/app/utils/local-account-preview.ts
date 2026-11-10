import type {
  NewApiAutoGroups,
  NewApiGroup,
  NewApiLog,
  NewApiPage,
  NewApiSession,
  NewApiStatus,
  NewApiToken,
  NewApiTokenInput,
} from "../client/new-api";
import type { ModelPricing } from "./model-pricing";
import type { WalletOverview, WalletPayment } from "./wallet";

const timestamp = 1794182400;
export const localAccountPreview = {
  status: {
    enabled: true,
    configured: true,
    publicUrl: "https://preview.invalid",
    passwordLoginEnabled: true,
    turnstileSiteKey: "",
    quotaPerUnit: 500000,
    currencySymbol: "✦",
  } satisfies NewApiStatus,
  session: {
    authenticated: true,
    selectedTokenId: 1,
    user: {
      id: -1,
      username: "preview-user",
      display_name: "本地预览账号",
      group: "default",
      quota: 48261000,
      used_quota: 20237650,
      request_count: 770,
    },
  } satisfies NewApiSession,
  groups: [
    {
      id: "auto",
      name: "Auto系统",
      ratio: "auto",
      description: "自动选择可用分组",
    },
    {
      id: "default",
      name: "默认分组",
      ratio: 1,
      description: "日常文本与图像模型",
    },
  ] satisfies NewApiGroup[],
  autoGroups: {
    supported: true,
    defaultGroups: ["default"],
    maxCount: 9,
  } satisfies NewApiAutoGroups,
  tokens: {
    total: 2,
    page: 1,
    size: 10,
    items: [
      {
        id: 1,
        name: "系统创建",
        group: "auto",
        status: 1,
        created_time: timestamp,
        accessed_time: timestamp + 3600,
        expired_time: -1,
        remain_quota: 0,
        used_quota: 1560000,
        unlimited_quota: true,
        model_limits_enabled: false,
        model_limits: "",
      },
      {
        id: 2,
        name: "图像创作测试",
        group: "default",
        status: 2,
        created_time: timestamp,
        accessed_time: timestamp + 1800,
        expired_time: -1,
        remain_quota: 2500000,
        used_quota: 500000,
        unlimited_quota: false,
        model_limits_enabled: true,
        model_limits: "gpt-image-2.5,gpt-image-2.6",
      },
    ],
  } satisfies NewApiPage<NewApiToken>,
  logs: {
    total: 3,
    page: 1,
    size: 10,
    items: [
      {
        id: 1,
        created_at: timestamp + 3600,
        model_name: "gpt-6-astra",
        token_name: "系统创建",
        prompt_tokens: 1820,
        completion_tokens: 640,
        quota: 2400,
        type: 2,
        content: "",
      },
      {
        id: 2,
        created_at: timestamp + 2400,
        model_name: "gpt-image-2.6",
        token_name: "系统创建",
        prompt_tokens: 220,
        completion_tokens: 0,
        quota: 5000,
        type: 2,
        content: "",
      },
      {
        id: 3,
        created_at: timestamp + 1200,
        model_name: "gemini-3.1-pro",
        token_name: "系统创建",
        prompt_tokens: 8450,
        completion_tokens: 1620,
        quota: 3200,
        type: 2,
        content: "",
      },
    ],
  } satisfies NewApiPage<NewApiLog>,
  pricing: {
    userId: -1,
    account: "preview-user",
    currency: "✦",
    fetchedAt: "2026-11-09T00:00:00Z",
    walletUrl: "#/account?local-preview=account",
    pricingUrl: "#/pricing?local-preview=account",
    rows: [
      {
        model: "gpt-6-astra",
        group: "默认分组",
        billing: "基础文本 · 每百万 tokens",
        price: "输入 ✦ 2 / 输出 ✦ 10",
        details: {
          unit: "tokens",
          tiers: [{ input: "✦ 2", output: "✦ 10" }],
        },
      },
      {
        model: "gpt-6-astra",
        group: "优惠分组",
        billing: "基础文本 · 每百万 tokens",
        price: "输入 ✦ 1.2 / 输出 ✦ 6",
        details: {
          unit: "tokens",
          tiers: [{ input: "✦ 1.2", output: "✦ 6" }],
        },
      },
      {
        model: "gemini-3.1-pro",
        group: "默认分组",
        billing: "上下文分档 · 每百万 tokens",
        price:
          "上下文 ≤ 200,000 tokens：输入 ✦ 1.5 / 输出 ✦ 9\n上下文 > 200,000 tokens：输入 ✦ 3 / 输出 ✦ 13.5",
        details: {
          unit: "tokens",
          tiers: [
            {
              context: "上下文 ≤ 200,000 tokens",
              input: "✦ 1.5",
              output: "✦ 9",
            },
            {
              context: "上下文 > 200,000 tokens",
              input: "✦ 3",
              output: "✦ 13.5",
            },
          ],
        },
      },
      {
        model: "claude-sonnet",
        group: "默认分组",
        billing: "动态 · 每百万 tokens",
        price: "输入 ✦ 3 / 输出 ✦ 15 / 缓存读取 ✦ 0.3 / 缓存写入 ✦ 3.75",
        details: {
          unit: "tokens",
          tiers: [
            {
              input: "✦ 3",
              output: "✦ 15",
              extras: [
                { label: "缓存读取", amount: "✦ 0.3" },
                { label: "缓存写入", amount: "✦ 3.75" },
              ],
            },
          ],
        },
      },
      {
        model: "gpt-image-2.6",
        group: "图像分组",
        billing: "每次请求",
        price: "✦ 0.04",
        details: {
          unit: "request",
          tiers: [{ perRequest: "✦ 0.04" }],
        },
      },
      {
        model: "midjourney-v8.2",
        group: "图像分组",
        billing: "动态计费",
        price: "请查看模型广场",
      },
      {
        model: "grok-imagine-video",
        group: "视频分组",
        billing: "每次请求",
        price: "✦ 0.12",
        details: {
          unit: "request",
          tiers: [{ perRequest: "✦ 0.12" }],
        },
      },
      {
        model: "free-text-preview",
        group: "公益分组",
        billing: "每次请求",
        price: "✦ 0",
        details: {
          unit: "request",
          tiers: [{ perRequest: "✦ 0" }],
        },
      },
    ],
  } satisfies ModelPricing,
};

export function createLocalAccountPreviewClient() {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const data = {
    ...copy(localAccountPreview),
    tokens: copy<NewApiPage<NewApiToken>>(localAccountPreview.tokens),
  };
  let authenticated = true;
  let selectedTokenId: number | null = data.session.selectedTokenId;
  let nextTokenId = 3;
  let nextOrderId = 2;
  let email = "preview@example.com";
  const redeemed = new Set<string>();
  const wallet: WalletOverview = {
    userId: -1,
    currencySymbol: "✦",
    quotaPerUnit: 500000,
    quotaDisplayType: "CUSTOM",
    creditExchangeRate: 1,
    topup: {
      enabled: true,
      redemptionEnabled: true,
      redemptionUrl: "https://example.com/redemption",
      minAmount: 1,
      amountOptions: [10, 20, 50, 100, 200, 500, 1000, 2000],
      discounts: { "200": 0.97, "500": 0.96, "1000": 0.95, "2000": 0.94 },
      paymentMethods: [
        { type: "alipay", name: "支付宝" },
        { type: "wxpay", name: "微信支付" },
      ],
    },
    plans: [
      {
        id: 1,
        title: "轻量创作",
        subtitle: "日常聊天与图片创作",
        priceAmount: 19.9,
        currency: "¥",
        durationUnit: "month",
        durationValue: 1,
        customSeconds: 0,
        totalAmount: 15000000,
        resetPeriod: "monthly",
        resetSeconds: 0,
        maxPurchases: 1,
        allowBalancePay: false,
      },
      {
        id: 2,
        title: "进阶创作",
        subtitle: "适合长对话与视频创作",
        priceAmount: 59.9,
        currency: "¥",
        durationUnit: "month",
        durationValue: 1,
        customSeconds: 0,
        totalAmount: 50000000,
        resetPeriod: "monthly",
        resetSeconds: 0,
        maxPurchases: 3,
        allowBalancePay: false,
      },
    ],
    subscriptions: [],
    history: [
      {
        id: 1,
        tradeNo: "PREVIEW-INITIAL",
        amount: 50,
        money: 50,
        status: "success",
        createdAt: timestamp,
        completedAt: timestamp + 60,
        paymentMethod: "alipay",
      },
    ],
    historyTotal: 1,
  };
  const orders = new Map<string, { amount?: number; planId?: number }>();
  const finish = async <T>(value: T): Promise<T> => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return copy(value);
  };
  const session = (): NewApiSession => ({
    authenticated,
    selectedTokenId: authenticated ? selectedTokenId : null,
    user: authenticated ? copy(data.session.user) : null,
  });
  function token(id: number) {
    const value = data.tokens.items.find((item) => item.id === id);
    if (!value) throw new Error("模拟密钥不存在");
    return value;
  }
  async function payment(
    method: string,
    amount?: number,
    planId?: number,
  ): Promise<WalletPayment> {
    if (!wallet.topup.paymentMethods.some((item) => item.type === method))
      throw new Error("请选择支付方式");
    const plan = wallet.plans.find((item) => item.id === planId);
    if (planId && !plan) throw new Error("模拟套餐不存在");
    if (!plan && (!Number.isSafeInteger(amount) || amount! < 1))
      throw new Error("请输入有效充值金额");
    const id = nextOrderId++;
    const tradeNo = `PREVIEW-${id}`;
    const money = plan
      ? plan.priceAmount
      : amount! * (wallet.topup.discounts?.[amount!] ?? 1);
    wallet.history.unshift({
      id,
      tradeNo,
      amount: amount ?? 0,
      money,
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
      completedAt: 0,
      paymentMethod: method,
    });
    wallet.historyTotal = wallet.history.length;
    orders.set(tradeNo, { amount, planId });
    return finish({
      userId: -1,
      kind: plan ? "subscription" : "topup",
      action: "https://checkout.example.com/local-preview",
      method: "POST",
      fields: {},
      tradeNo,
      paymentMethod: method,
      money: `¥ ${money.toFixed(2)}`,
    });
  }
  return {
    status: () => finish(data.status),
    session: () => finish(session()),
    async login(username: string, password: string) {
      if (!username.trim() || !password) throw new Error("请输入用户名和密码");
      authenticated = true;
      data.session.user.username = username.trim();
      return finish(session());
    },
    async login2fa(code: string) {
      if (!code.trim()) throw new Error("请输入验证码");
      authenticated = true;
      return finish(session());
    },
    async logout() {
      authenticated = false;
    },
    tokens: (page = 1, size = 10) =>
      finish({
        items: data.tokens.items.slice((page - 1) * size, page * size),
        total: data.tokens.items.length,
        page,
        size,
      }),
    logs: (page = 1, size = 10) =>
      finish({
        items: data.logs.items.slice((page - 1) * size, page * size),
        total: data.logs.items.length,
        page,
        size,
      }),
    groups: () => finish(data.groups),
    autoGroups: () => finish(data.autoGroups),
    async createToken(input: NewApiTokenInput) {
      data.tokens.items.unshift({
        ...input,
        id: nextTokenId++,
        status: 1,
        created_time: Math.floor(Date.now() / 1000),
        accessed_time: -1,
        used_quota: 0,
      });
    },
    async updateToken(id: number, input: NewApiTokenInput) {
      Object.assign(token(id), input);
    },
    async setTokenStatus(id: number, status: 1 | 2) {
      token(id).status = status;
    },
    async deleteToken(id: number) {
      token(id);
      data.tokens.items = data.tokens.items.filter((item) => item.id !== id);
      if (selectedTokenId === id) selectedTokenId = null;
    },
    async selectToken(id: number) {
      if (token(id).status !== 1) throw new Error("请先启用此密钥");
      selectedTokenId = id;
      return { selectedTokenId: id };
    },
    walletOverview: () => finish(wallet),
    walletQuote: (amount: number) =>
      finish({
        userId: -1,
        amount,
        money: `¥ ${(amount * (wallet.topup.discounts?.[amount] ?? 1)).toFixed(
          2,
        )}`,
      }),
    walletPay: (amount: number, method: string) => payment(method, amount),
    walletSubscriptionPay: (planId: number, method: string) =>
      payment(method, undefined, planId),
    async completePayment(tradeNo: string) {
      const order = wallet.history.find((item) => item.tradeNo === tradeNo);
      const purchase = orders.get(tradeNo);
      if (!order || !purchase) throw new Error("模拟订单不存在");
      if (order.status === "success") return;
      order.status = "success";
      order.completedAt = Math.floor(Date.now() / 1000);
      if (purchase.planId) {
        const plan = wallet.plans.find((item) => item.id === purchase.planId)!;
        wallet.subscriptions.push({
          id: order.id,
          planId: plan.id,
          status: "active",
          startTime: order.completedAt,
          endTime: order.completedAt + 30 * 86400,
          amountTotal: plan.totalAmount,
          amountUsed: 0,
          nextResetTime: order.completedAt + 30 * 86400,
        });
      } else data.session.user.quota += purchase.amount! * wallet.quotaPerUnit;
    },
    async walletRedeem(code: string) {
      if (code.trim().toUpperCase() !== "PREVIEW-50")
        throw new Error("模拟兑换码无效，请使用 PREVIEW-50");
      if (redeemed.has("PREVIEW-50")) throw new Error("该模拟兑换码已使用");
      redeemed.add("PREVIEW-50");
      data.session.user.quota += 50 * wallet.quotaPerUnit;
      return finish({ userId: -1, creditedQuota: 50 * wallet.quotaPerUnit });
    },
    profile: () => ({
      username: data.session.user.username,
      displayName: data.session.user.display_name,
      email,
    }),
    async updateProfile(profile: {
      username: string;
      displayName: string;
      email: string;
    }) {
      data.session.user.username = profile.username;
      data.session.user.display_name = profile.displayName;
      email = profile.email;
    },
    async register(username: string, password: string) {
      if (!username.trim() || !password) throw new Error("请输入用户名和密码");
      data.session.user.username = username.trim();
      data.session.user.display_name = username.trim();
      authenticated = true;
    },
    async resetPassword(address: string, password: string) {
      if (!address.trim() || !password) throw new Error("请输入邮箱和新密码");
      await finish(null);
    },
  };
}

export type LocalAccountPreviewClient = ReturnType<
  typeof createLocalAccountPreviewClient
>;

let activePreview: LocalAccountPreviewClient | undefined;
export function getLocalAccountPreviewClient() {
  return (activePreview ??= createLocalAccountPreviewClient());
}
