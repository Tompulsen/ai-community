import { modelPriceRows } from "./model-pricing";
const catalog = (model: object, ratio = 0.6) => ({
  data: [{ model_name: "fixture", enable_groups: ["images"], ...model }],
  group_ratio: { images: ratio },
});
const currency = {
  quota_display_type: "CUSTOM",
  custom_currency_symbol: "✦",
  custom_currency_exchange_rate: 1,
};
test("per-request price uses group ratio and configured currency", () => {
  expect(
    modelPriceRows(catalog({ quota_type: 1, model_price: 0.25 }), currency)
      .rows[0],
  ).toMatchObject({
    group: "images",
    price: "✦ 0.15",
    billing: "每次请求",
    details: { unit: "request", tiers: [{ perRequest: "✦ 0.15" }] },
  });
});
test("input and output are per million tokens, not a fixed request fee", () => {
  expect(
    modelPriceRows(
      catalog({ quota_type: 0, model_ratio: 1.5, completion_ratio: 5 }, 0.2),
      {},
    ).rows[0],
  ).toMatchObject({
    price: "输入 $ 0.6 / 输出 $ 3",
    details: {
      unit: "tokens",
      tiers: [{ input: "$ 0.6", output: "$ 3" }],
    },
  });
});
test("simple dynamic expressions override legacy model ratios", () => {
  expect(
    modelPriceRows(
      catalog({
        billing_mode: "tiered_expr",
        billing_expr: 'tier("base", fixed(0.25))',
        model_ratio: 37.5,
      }),
      currency,
    ).rows[0].price,
  ).toBe("✦ 0.15");
  expect(
    modelPriceRows(
      catalog(
        {
          billing_mode: "tiered_expr",
          billing_expr: 'tier("base", p * 2 + c * 10 + cr * 0.1 + cc * 2.5)',
        },
        0.2,
      ),
      currency,
    ).rows[0].price,
  ).toBe("输入 ✦ 0.4 / 输出 ✦ 2 / 缓存读取 ✦ 0.02 / 缓存写入 ✦ 0.5");
});
test.each([
  {
    billing_mode: "tiered_expr",
    billing_expr: 'p > 100 ? tier("a", fixed(1)) : tier("b", fixed(2))',
  },
  {
    billing_mode: "tiered_expr",
    billing_expr: 'tier("base", p * 2 + c * 10 + audio * 50)',
  },
  { billing_plugin_variants: [{ plugin_id: "video" }] },
  { billing_mode: "new-unsupported-mode" },
])("unsupported dynamic pricing does not use legacy prices", (dynamic) => {
  const row = modelPriceRows(
    catalog({ ...dynamic, quota_type: 1, model_price: 0.01 }),
    {},
  ).rows[0];
  expect(row).toMatchObject({
    billing: "动态计费",
    price: "请查看模型广场",
  });
  expect(row).not.toHaveProperty("details");
});
test("unknown, zero and tiny prices remain distinct", () => {
  expect(modelPriceRows(catalog({ quota_type: 1 }), {}).rows[0].billing).toBe(
    "未配置",
  );
  expect(
    modelPriceRows(catalog({ quota_type: 1, model_price: 0 }), {}).rows[0]
      .price,
  ).toBe("$ 0");
  expect(
    modelPriceRows(catalog({ quota_type: 1, model_price: 0.00000001 }), {})
      .rows[0].price,
  ).toBe("$ 0.000000006");
  expect(
    modelPriceRows(catalog({ quota_type: 1 }), {}).rows[0],
  ).not.toHaveProperty("details");
  expect(
    modelPriceRows(catalog({ quota_type: 1, model_price: 0 }), {}).rows[0]
      .details,
  ).toEqual({ unit: "request", tiers: [{ perRequest: "$ 0" }] });
});
test("unavailable groups are not advertised", () => {
  expect(
    modelPriceRows(
      {
        data: [{ model_name: "m", enable_groups: ["hidden"] }],
        group_ratio: {},
      },
      {},
    ).rows,
  ).toEqual([]);
});

test("all expands available groups once", () => {
  const result = modelPriceRows(
    {
      data: [
        {
          model_name: "all-model",
          enable_groups: ["all", "images"],
          quota_type: 1,
          model_price: 1,
        },
      ],
      group_ratio: { images: 0.6, default: 0.2 },
    },
    {},
  );
  expect(result.rows.map((row) => [row.group, row.price])).toEqual([
    ["images", "$ 0.6"],
    ["default", "$ 0.2"],
  ]);
});

test("ratio mode keeps ordinary configured request prices", () => {
  expect(
    modelPriceRows(
      catalog({ billing_mode: "ratio", quota_type: 1, model_price: 0.25 }),
      currency,
    ).rows[0],
  ).toMatchObject({ price: "✦ 0.15", billing: "每次请求" });
});

test("single token tiers accept outer parentheses and one-hour cache writes", () => {
  expect(
    modelPriceRows(
      catalog(
        {
          billing_mode: "tiered_expr",
          billing_expr: '((tier("base", p * 2 + c * 10 + cc1h * 4)))',
        },
        0.6,
      ),
      currency,
    ).rows[0],
  ).toMatchObject({
    billing: "动态 · 每百万 tokens",
    price: "输入 ✦ 1.2 / 输出 ✦ 6 / 缓存写入（1小时） ✦ 2.4",
  });
});

test.each([
  '((len <= 272000)) ? (tier("标准", fixed(0.25))) : (tier("长上下文", fixed(0.625)))',
  '((len <= 272000 ? tier("标准:低", fixed(0.25)) : tier("长上下文?高", fixed(0.625))))',
])(
  "fixed context tiers expose both prices and the exact boundary: %s",
  (billing_expr) => {
    expect(
      modelPriceRows(
        catalog({ billing_mode: "tiered_expr", billing_expr }, 0.04),
        currency,
      ).rows[0],
    ).toMatchObject({
      billing: "上下文分档 · 每次请求",
      price:
        "上下文 ≤ 272,000 tokens：✦ 0.01\n上下文 > 272,000 tokens：✦ 0.025",
      details: {
        unit: "request",
        tiers: [
          {
            context: "上下文 ≤ 272,000 tokens",
            perRequest: "✦ 0.01",
          },
          {
            context: "上下文 > 272,000 tokens",
            perRequest: "✦ 0.025",
          },
        ],
      },
    });
  },
);

test("context token tiers keep every supported charge and multiply the viewer group once", () => {
  const billing_expr =
    'len <= 100000 ? tier("short", p * 0.1 + c * 0.5 + cc * 0.125 + cr * 0.01 + cc1h * 10) : tier("long", p * 0.5 + c * 2.5 + cc * 0.625 + cr * 0.05)';
  expect(
    modelPriceRows(
      catalog({ billing_mode: "tiered_expr", billing_expr }, 0.6),
      currency,
    ).rows[0],
  ).toMatchObject({
    billing: "上下文分档 · 每百万 tokens",
    price:
      "上下文 ≤ 100,000 tokens：输入 ✦ 0.06 / 输出 ✦ 0.3 / 缓存写入 ✦ 0.075 / 缓存读取 ✦ 0.006 / 缓存写入（1小时） ✦ 6\n上下文 > 100,000 tokens：输入 ✦ 0.3 / 输出 ✦ 1.5 / 缓存写入 ✦ 0.375 / 缓存读取 ✦ 0.03",
    details: {
      unit: "tokens",
      tiers: [
        {
          context: "上下文 ≤ 100,000 tokens",
          input: "✦ 0.06",
          output: "✦ 0.3",
          extras: [
            { label: "缓存写入", amount: "✦ 0.075" },
            { label: "缓存读取", amount: "✦ 0.006" },
            { label: "缓存写入（1小时）", amount: "✦ 6" },
          ],
        },
        {
          context: "上下文 > 100,000 tokens",
          input: "✦ 0.3",
          output: "✦ 1.5",
          extras: [
            { label: "缓存写入", amount: "✦ 0.375" },
            { label: "缓存读取", amount: "✦ 0.03" },
          ],
        },
      ],
    },
  });
});

test("structured dynamic charges apply each group and currency conversion once", () => {
  const { rows, currency: symbol } = modelPriceRows(
    {
      data: [
        {
          model_name: "grouped-model",
          enable_groups: ["default", "discount"],
          billing_mode: "tiered_expr",
          billing_expr: 'tier("base", p * 2 + c * 10 + cc1h * 4)',
        },
      ],
      group_ratio: { default: 1, discount: 0.25 },
    },
    { quota_display_type: "CNY", usd_exchange_rate: 7 },
  );
  expect(symbol).toBe("¥");
  expect(rows.map(({ group, details }) => ({ group, details }))).toEqual([
    {
      group: "default",
      details: {
        unit: "tokens",
        tiers: [
          {
            input: "¥ 14",
            output: "¥ 70",
            extras: [{ label: "缓存写入（1小时）", amount: "¥ 28" }],
          },
        ],
      },
    },
    {
      group: "discount",
      details: {
        unit: "tokens",
        tiers: [
          {
            input: "¥ 3.5",
            output: "¥ 17.5",
            extras: [{ label: "缓存写入（1小时）", amount: "¥ 7" }],
          },
        ],
      },
    },
  ]);
});

test.each([
  'len < 100 ? tier("a", fixed(1)) : tier("b", fixed(2))',
  'len <= 100 ? tier("a", fixed(1)) : tier("b", p * 2 + c * 3)',
  'len <= 100 ? tier("a", fixed(1)) : len <= 200 ? tier("b", fixed(2)) : tier("c", fixed(3))',
  'len <= 100 ? tier("a", p * 1 + c * 2 + unknown * 3) : tier("b", p * 2 + c * 4)',
  '(len <= 100 ? tier("a", fixed(1)) : tier("b", fixed(2))',
  'tier("base", p * 1 + p * 2 + c * 3)',
  'tier("base", fixed(1)) * 2',
  'tier("base", fixed(1)); globalThis.untrusted = true',
])(
  "unsupported or malformed expressions never display a guessed price: %s",
  (billing_expr) => {
    const row = modelPriceRows(
      catalog({
        billing_mode: "tiered_expr",
        billing_expr,
        quota_type: 1,
        model_price: 0.01,
      }),
      currency,
    ).rows[0];
    expect(row).toMatchObject({
      billing: "动态计费",
      price: "请查看模型广场",
    });
    expect(row).not.toHaveProperty("details");
  },
);

test("an unknown billing mode cannot borrow a familiar expression's semantics", () => {
  expect(
    modelPriceRows(
      catalog({
        billing_mode: "future-mode",
        billing_expr: 'tier("base", fixed(1))',
      }),
      currency,
    ).rows[0].price,
  ).toBe("请查看模型广场");
});
