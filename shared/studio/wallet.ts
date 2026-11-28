/** Browser-safe wallet contracts. Payment amounts come from the account server. */
export type WalletPaymentMethod = { type: string; name: string };
export type WalletSection = "topup" | "plans" | "history";
export type WalletPlan = {
  id: number;
  title: string;
  subtitle: string;
  priceAmount: number;
  currency: string;
  durationUnit: string;
  durationValue: number;
  customSeconds: number;
  totalAmount: number;
  resetPeriod: string;
  resetSeconds: number;
  maxPurchases: number;
  allowBalancePay: boolean;
};
export type WalletSubscription = {
  id: number;
  planId: number;
  status: string;
  startTime: number;
  endTime: number;
  amountTotal: number;
  amountUsed: number;
  nextResetTime: number;
};
export type WalletOrder = {
  id: number;
  tradeNo: string;
  amount: number;
  money: number;
  status: string;
  createdAt: number;
  completedAt: number;
  paymentMethod: string;
};
export type WalletOverview = {
  userId: number;
  currencySymbol: string;
  quotaPerUnit: number;
  quotaPerPoint?: number;
  quotaDisplayType: string;
  creditExchangeRate: number;
  topup: {
    enabled: boolean;
    redemptionEnabled: boolean;
    redemptionUrl?: string;
    minAmount: number;
    amountOptions: number[];
    discounts?: Record<string, number>;
    paymentMethods: WalletPaymentMethod[];
  };
  plans: WalletPlan[];
  subscriptions: WalletSubscription[];
  history: WalletOrder[];
  historyTotal: number;
};
export type WalletQuote = { userId: number; amount: number; money: string };

/** Display the existing API quota using New API's currency settings; never used for settlement. */
export function displayWalletQuota(quota: number, display: Pick<WalletOverview, "quotaDisplayType" | "quotaPerUnit" | "creditExchangeRate" | "currencySymbol">): string | null {
  if (!Number.isSafeInteger(quota) || !["USD", "CNY", "CUSTOM", "TOKENS"].includes(display.quotaDisplayType)) return null;
  if (display.quotaDisplayType === "TOKENS") return `${quota.toLocaleString("zh-CN")} tokens`;
  if (!Number.isFinite(display.quotaPerUnit) || display.quotaPerUnit <= 0 || !Number.isFinite(display.creditExchangeRate) || display.creditExchangeRate <= 0
    || typeof display.currencySymbol !== "string" || !display.currencySymbol.trim()) return null;
  const amount = quota / display.quotaPerUnit * display.creditExchangeRate;
  if (!Number.isFinite(amount)) return null;
  const digits = Math.abs(amount) >= 1 ? 2 : 4;
  const visible = amount !== 0 && Math.abs(amount) < 10 ** -digits ? Math.sign(amount) * 10 ** -digits : amount;
  return `${display.currencySymbol} ${visible.toLocaleString("zh-CN", { maximumFractionDigits: digits })}`;
}

export type WalletPayment = {
  userId: number;
  kind: "topup" | "subscription";
  action: string;
  method: "POST";
  fields: Record<string, string>;
  tradeNo: string;
  paymentMethod: string;
  money: string;
};
export type WalletRedemption = { userId: number; creditedQuota: number };

/** No arbitrary protocols, credentials, local names or IP literals in checkout. */
export function safeWalletPaymentUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== "443") ||
      !host.includes(".") ||
      host.includes(":") ||
      /^[\d.]+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
