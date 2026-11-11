import type {
  NewApiModelGroups,
  NewApiStatus,
  NewApiUser,
} from "../client/new-api";
import type { ModelPricing } from "./model-pricing";

export function composerPrice(
  model: string,
  user: NewApiUser,
  groups?: NewApiModelGroups,
  pricing?: ModelPricing,
) {
  if (!groups || groups.selectedGroup === null)
    return { text: "选择分组后显示价格" };
  if (groups.selectedGroup === "auto")
    return { text: "自动分组 · 按实际分组计费" };
  const group = groups.selectedGroup || user.group;
  const row = pricing?.rows.find(
    (item) => item.model === model && item.group === group,
  );
  if (!row) return { text: "当前模型暂无报价" };
  const detail = `${model} · ${group}\n${row.billing}\n${row.price}`;
  if (row.details?.tiers.length === 1) {
    const tier = row.details.tiers[0];
    if (
      !tier.context &&
      row.details.unit === "request" &&
      tier.perRequest !== undefined
    )
      return { text: `${tier.perRequest} / 次调用`, detail };
    if (!tier.context && row.details.unit === "tokens")
      return {
        text: `输入 ${tier.input} · 输出 ${tier.output} / 百万 tokens`,
        detail,
      };
  }
  return {
    text: row.details?.tiers.length ? "按上下文分档计费" : "按实际用量计费",
    detail,
  };
}

export function composerQuota(quota: number, status?: NewApiStatus) {
  if (
    !status ||
    !Number.isFinite(quota) ||
    !Number.isFinite(status.quotaPerUnit) ||
    status.quotaPerUnit <= 0
  )
    return "—";
  return `${status.currencySymbol}${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 6,
  }).format(quota / status.quotaPerUnit)}`;
}
