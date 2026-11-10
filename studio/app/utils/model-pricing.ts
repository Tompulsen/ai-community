export type ModelPriceRow = {
  model: string;
  group: string;
  billing: string;
  price: string;
  details?: {
    unit: "request" | "tokens";
    tiers: {
      context?: string;
      perRequest?: string;
      input?: string;
      output?: string;
      extras?: { label: string; amount: string }[];
    }[];
  };
};
export type ModelPricing = {
  rows: ModelPriceRow[];
  account: string;
  userId: number;
  walletUrl: string;
  pricingUrl: string;
  fetchedAt: string;
  currency: string;
};

type CatalogModel = {
  model_name?: unknown;
  enable_groups?: unknown;
  quota_type?: unknown;
  model_ratio?: unknown;
  completion_ratio?: unknown;
  model_price?: unknown;
  billing_mode?: unknown;
  billing_expr?: unknown;
  billing_plugin_variants?: unknown;
};
const positive = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;

function currency(status: Record<string, unknown>) {
  const kind = status.quota_display_type;
  if (
    kind === "CUSTOM" &&
    positive(status.custom_currency_exchange_rate) &&
    status.custom_currency_exchange_rate > 0 &&
    typeof status.custom_currency_symbol === "string"
  )
    return {
      symbol: status.custom_currency_symbol.slice(0, 12),
      rate: status.custom_currency_exchange_rate,
    };
  if (
    kind === "CNY" &&
    positive(status.usd_exchange_rate) &&
    status.usd_exchange_rate > 0
  )
    return { symbol: "¥", rate: status.usd_exchange_rate };
  return { symbol: "$", rate: 1 };
}

type SimplePrice = { perRequest?: number; tokens?: Record<string, number> };
type PriceTier = SimplePrice & { context?: string };
const tokenLabels: Record<string, string> = {
  p: "输入",
  c: "输出",
  cr: "缓存读取",
  cc: "缓存写入",
  cc1h: "缓存写入（1小时）",
};

// Locate only top-level delimiters, respecting quoted tier labels. This is a
// restricted display parser, never an expression evaluator.
function expressionShape(expression: string) {
  let depth = 0,
    quoted = false,
    escaped = false;
  let question = -1,
    colon = -1;
  let wrapped = expression.startsWith("(") && expression.endsWith(")");
  for (let index = 0; index < expression.length; index++) {
    const char = expression[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "(") depth++;
    else if (char === ")") {
      if (--depth < 0) return null;
      if (depth === 0 && index < expression.length - 1) wrapped = false;
    } else if (depth === 0 && char === "?") {
      if (question !== -1) return null;
      question = index;
    } else if (depth === 0 && char === ":") {
      if (colon !== -1) return null;
      colon = index;
    }
  }
  return depth || quoted ? null : { question, colon, wrapped };
}

function unwrapExpression(value: string): string | null {
  let expression = value.trim();
  for (;;) {
    const shape = expressionShape(expression);
    if (!shape) return null;
    if (!shape.wrapped) return expression;
    expression = expression.slice(1, -1).trim();
  }
}

// Display only complete fixed prices or linear token expressions. An unknown
// variable invalidates the whole price rather than silently omitting a charge.
function simpleDynamic(expression: string): SimplePrice | null {
  const unwrapped = unwrapExpression(expression);
  if (!unwrapped) return null;
  const tier = /^\s*tier\("(?:[^"\\]|\\.)*",\s*([\s\S]+)\)\s*$/.exec(unwrapped);
  if (!tier) return null;
  const fixed = /^fixed\(\s*(\d+(?:\.\d+)?)\s*\)\s*$/.exec(tier[1]);
  if (fixed)
    return positive(Number(fixed[1])) ? { perRequest: Number(fixed[1]) } : null;
  const tokens: Record<string, number> = {};
  for (const term of tier[1].split("+")) {
    const match = /^\s*(p|c|cr|cc|cc1h)\s*\*\s*(\d+(?:\.\d+)?)\s*$/.exec(term);
    if (
      !match ||
      !positive(Number(match[2])) ||
      Object.hasOwn(tokens, match[1])
    )
      return null;
    tokens[match[1]] = Number(match[2]);
  }
  return Object.hasOwn(tokens, "p") && Object.hasOwn(tokens, "c")
    ? { tokens }
    : null;
}

function dynamicPriceTiers(expression: string): PriceTier[] | null {
  const unwrapped = unwrapExpression(expression);
  if (!unwrapped) return null;
  const single = simpleDynamic(unwrapped);
  if (single) return [single];
  const shape = expressionShape(unwrapped);
  if (!shape || shape.question < 0 || shape.colon < shape.question) return null;
  const condition = unwrapExpression(unwrapped.slice(0, shape.question));
  const threshold = /^len\s*<=\s*(\d+)$/.exec(condition ?? "");
  if (!threshold || !Number.isSafeInteger(Number(threshold[1]))) return null;
  const lower = simpleDynamic(unwrapped.slice(shape.question + 1, shape.colon));
  const upper = simpleDynamic(unwrapped.slice(shape.colon + 1));
  if (
    !lower ||
    !upper ||
    (lower.perRequest !== undefined) !== (upper.perRequest !== undefined)
  )
    return null;
  const boundary = new Intl.NumberFormat("zh-CN").format(Number(threshold[1]));
  return [
    { ...lower, context: `上下文 ≤ ${boundary} tokens` },
    { ...upper, context: `上下文 > ${boundary} tokens` },
  ];
}

export function modelPriceRows(
  catalog: unknown,
  status: Record<string, unknown>,
): { rows: ModelPriceRow[]; currency: string } {
  const data = catalog as {
    data?: CatalogModel[];
    group_ratio?: Record<string, unknown>;
  };
  if (
    !Array.isArray(data?.data) ||
    !data.group_ratio ||
    typeof data.group_ratio !== "object"
  )
    throw new Error("模型价格数据不可用");
  const display = currency(status),
    rows: ModelPriceRow[] = [];
  const amount = (usd: number) =>
    `${display.symbol} ${new Intl.NumberFormat("zh-CN", {
      maximumSignificantDigits: 6,
    }).format(usd * display.rate)}`;
  for (const model of data.data) {
    if (
      typeof model.model_name !== "string" ||
      !Array.isArray(model.enable_groups)
    )
      continue;
    const groups = model.enable_groups.includes("all")
      ? Object.keys(data.group_ratio)
      : model.enable_groups;
    for (const group of new Set(groups)) {
      if (typeof group !== "string" || !Object.hasOwn(data.group_ratio, group))
        continue;
      const ratio = data.group_ratio[group];
      if (!positive(ratio)) continue;
      let billing = "未配置",
        price = "请查看模型广场";
      let details: ModelPriceRow["details"];
      const dynamic =
        (Boolean(model.billing_mode) && model.billing_mode !== "ratio") ||
        Boolean(model.billing_expr) ||
        (Array.isArray(model.billing_plugin_variants) &&
          model.billing_plugin_variants.length > 0);
      if (dynamic) {
        billing = "动态计费";
        const parsed =
          (!model.billing_mode || model.billing_mode === "tiered_expr") &&
          (!model.billing_plugin_variants ||
            (Array.isArray(model.billing_plugin_variants) &&
              model.billing_plugin_variants.length === 0))
            ? dynamicPriceTiers(
                typeof model.billing_expr === "string"
                  ? model.billing_expr
                  : "",
              )
            : null;
        if (parsed) {
          details = {
            unit: parsed[0].perRequest !== undefined ? "request" : "tokens",
            tiers: parsed.map((tier) => {
              const context = tier.context ? { context: tier.context } : {};
              if (tier.perRequest !== undefined)
                return {
                  ...context,
                  perRequest: amount(tier.perRequest * ratio),
                };
              const tokens = tier.tokens!;
              const extras = Object.entries(tokens)
                .filter(([key]) => key !== "p" && key !== "c")
                .map(([key, value]) => ({
                  label: tokenLabels[key],
                  amount: amount(value * ratio),
                }));
              return {
                ...context,
                input: amount(tokens.p * ratio),
                output: amount(tokens.c * ratio),
                ...(extras.length ? { extras } : {}),
              };
            }),
          };
          billing = `${parsed.length > 1 ? "上下文分档" : "动态"} · ${
            parsed[0].perRequest !== undefined ? "每次请求" : "每百万 tokens"
          }`;
          price = parsed
            .map((tier) => {
              const value =
                tier.perRequest !== undefined
                  ? amount(tier.perRequest * ratio)
                  : Object.entries(tier.tokens ?? {})
                      .map(
                        ([key, value]) =>
                          `${tokenLabels[key]} ${amount(value * ratio)}`,
                      )
                      .join(" / ");
              return tier.context ? `${tier.context}：${value}` : value;
            })
            .join("\n");
        }
      } else if (model.quota_type === 1 && positive(model.model_price)) {
        billing = "每次请求";
        price = amount(model.model_price * ratio);
        details = { unit: "request", tiers: [{ perRequest: price }] };
      } else if (
        model.quota_type === 0 &&
        positive(model.model_ratio) &&
        positive(model.completion_ratio)
      ) {
        billing = "基础文本 · 每百万 tokens";
        const input = model.model_ratio * 2 * ratio;
        price = `输入 ${amount(input)} / 输出 ${amount(
          input * model.completion_ratio,
        )}`;
        details = {
          unit: "tokens",
          tiers: [
            {
              input: amount(input),
              output: amount(input * model.completion_ratio),
            },
          ],
        };
      }
      rows.push({
        model: model.model_name,
        group,
        billing,
        price,
        ...(details ? { details } : {}),
      });
    }
  }
  return { rows, currency: display.symbol };
}
