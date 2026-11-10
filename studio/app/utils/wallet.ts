/** Browser-safe wallet contracts. Payment amounts come from the account server. */
export type WalletPaymentMethod = { type: string; name: string };
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
