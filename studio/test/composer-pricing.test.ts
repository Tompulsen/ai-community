import { composerPrice, composerQuota } from "../app/utils/composer-pricing";
import type { NewApiStatus, NewApiUser } from "../app/client/new-api";
import type { ModelPricing } from "../app/utils/model-pricing";

const user = { quota: 12500, group: "member" } as NewApiUser;
const pricing = {
  rows: [
    {
      model: "image",
      group: "default",
      price: "¥ 1",
      billing: "每次请求",
      details: { unit: "request", tiers: [{ perRequest: "¥ 1" }] },
    },
    {
      model: "image",
      group: "member",
      price: "¥ 0.5",
      billing: "每次请求",
      details: { unit: "request", tiers: [{ perRequest: "¥ 0.5" }] },
    },
    {
      model: "text",
      group: "member",
      price: "输入 ¥ 1 / 输出 ¥ 2",
      billing: "基础文本",
      details: { unit: "tokens", tiers: [{ input: "¥ 1", output: "¥ 2" }] },
    },
    {
      model: "dynamic",
      group: "member",
      price: "请查看模型广场",
      billing: "动态计费",
    },
  ],
} as ModelPricing;

test("matches both model and the selected group, including inherited user group", () => {
  expect(
    composerPrice(
      "image",
      user,
      { groups: [], selectedGroup: "member" },
      pricing,
    ).text,
  ).toBe("¥ 0.5 / 次调用");
  expect(
    composerPrice("image", user, { groups: [], selectedGroup: "" }, pricing)
      .text,
  ).toBe("¥ 0.5 / 次调用");
  expect(
    composerPrice(
      "image",
      user,
      { groups: [], selectedGroup: "missing" },
      pricing,
    ).text,
  ).toBe("当前模型暂无报价");
});
test("auto groups, missing token and variable billing never promise a fixed charge", () => {
  expect(
    composerPrice("image", user, { groups: [], selectedGroup: "auto" }, pricing)
      .text,
  ).toContain("按实际分组");
  expect(
    composerPrice("image", user, { groups: [], selectedGroup: null }, pricing)
      .text,
  ).toContain("选择分组");
  expect(
    composerPrice(
      "dynamic",
      user,
      { groups: [], selectedGroup: "member" },
      pricing,
    ).text,
  ).toBe("按实际用量计费");
  expect(
    composerPrice(
      "text",
      user,
      { groups: [], selectedGroup: "member" },
      pricing,
    ).text,
  ).toBe("输入 ¥ 1 · 输出 ¥ 2 / 百万 tokens");
});
test("context tiers retain their conditions instead of using the first price", () => {
  const tiered = {
    rows: [
      {
        model: "image",
        group: "member",
        billing: "上下文分档",
        price: "上下文 ≤ 100：¥ 1\n上下文 > 100：¥ 2",
        details: {
          unit: "request",
          tiers: [
            { context: "≤ 100", perRequest: "¥ 1" },
            { context: "> 100", perRequest: "¥ 2" },
          ],
        },
      },
    ],
  } as ModelPricing;
  expect(
    composerPrice(
      "image",
      user,
      { groups: [], selectedGroup: "member" },
      tiered,
    ),
  ).toEqual(
    expect.objectContaining({
      text: "按上下文分档计费",
      detail: expect.stringContaining("上下文 > 100"),
    }),
  );
});
test("quota uses server conversion and distinguishes zero from missing data", () => {
  const status = { quotaPerUnit: 500, currencySymbol: "¥" } as NewApiStatus;
  expect(composerQuota(12500, status)).toBe("¥25");
  expect(composerQuota(0, status)).toBe("¥0");
  expect(composerQuota(100)).toBe("—");
  expect(composerQuota(100, { ...status, quotaPerUnit: 0 })).toBe("—");
});
