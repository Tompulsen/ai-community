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
import type { ModelPricing } from "../app/utils/model-pricing";

const pricing = jest.fn<(signal?: AbortSignal) => Promise<ModelPricing>>();
const copyModel = jest.fn<(text: string) => Promise<boolean>>();
jest.unstable_mockModule("@/app/client/new-api", () => ({
  newApiClient: { modelPricing: pricing },
}));
jest.unstable_mockModule("@/app/utils", () => ({
  copyToClipboard: copyModel,
  safeLocalStorage: () => localStorage,
}));
for (const icon of [
  "three-dots",
  "close",
  "eye",
  "eye-off",
  "confirm",
  "cancel",
  "max",
  "min",
]) {
  jest.unstable_mockModule(`@/app/icons/${icon}.svg`, () => ({
    default: () => <svg />,
  }));
}
jest.unstable_mockModule("@/app/components/emoji", () => ({
  Avatar: () => null,
}));
const { AccountModelPricing } = await import(
  "../app/components/account-model-pricing"
);
const { QuotaPricingCard } = await import(
  "../app/components/quota-pricing-card"
);
const data: ModelPricing = {
  userId: 7,
  account: "fixture",
  currency: "✦",
  fetchedAt: "2026-11-08",
  pricingUrl: "https://zhangyuapi.com/pricing",
  walletUrl: "https://zhangyuapi.com/wallet",
  rows: [
    {
      model: "gpt-image-2.6",
      group: "default",
      billing: "每次请求",
      price: "✦ 0.01",
    },
    {
      model: "gpt-6.1",
      group: "GPT",
      billing: "每百万 tokens",
      price: "输入 ✦ 0.4 / 输出 ✦ 2",
    },
  ],
};
const browserDescriptors = {
  scrollIntoView: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  ),
  hasPointerCapture: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "hasPointerCapture",
  ),
  releasePointerCapture: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "releasePointerCapture",
  ),
  ResizeObserver: Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver"),
  showModal: Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  ),
  closeModal: Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "close",
  ),
};
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
beforeEach(() => {
  pricing.mockReset().mockResolvedValue(data);
  copyModel.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);
afterAll(() => {
  for (const key of [
    "scrollIntoView",
    "hasPointerCapture",
    "releasePointerCapture",
  ] as const) {
    const descriptor = browserDescriptors[key];
    if (descriptor)
      Object.defineProperty(HTMLElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, key);
  }
  if (browserDescriptors.ResizeObserver) {
    Object.defineProperty(
      globalThis,
      "ResizeObserver",
      browserDescriptors.ResizeObserver,
    );
  } else Reflect.deleteProperty(globalThis, "ResizeObserver");
  for (const [property, descriptor] of [
    ["showModal", browserDescriptors.showModal],
    ["close", browserDescriptors.closeModal],
  ] as const) {
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, property, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, property);
  }
});

async function renderPreview(model = "") {
  const { localAccountPreview } = await import(
    "../app/utils/local-account-preview"
  );
  await act(async () =>
    render(
      <AccountModelPricing
        userId={-1}
        model={model}
        previewData={localAccountPreview.pricing}
      />,
    ),
  );
  return localAccountPreview.pricing;
}

async function chooseGroup(model: string, group: string) {
  const control = screen.getByRole("combobox", { name: `${model} 计费分组` });
  fireEvent.click(control);
  fireEvent.click(await screen.findByRole("option", { name: group }));
  await waitFor(() => expect(control).toHaveTextContent(group));
}

test("balance notice links to exact failed model without fetching prices in chat", () => {
  render(<QuotaPricingCard model="vendor/model + v2" />);
  const href = screen
    .getByRole("link", { name: "余额不足，前往充值" })
    .getAttribute("href")!;
  expect(new URLSearchParams(href.split("?")[1]).get("model")).toBe(
    "vendor/model + v2",
  );
  expect(pricing).not.toHaveBeenCalled();
});
test("failed model stays highlighted while all models are visible and searchable", async () => {
  await act(async () =>
    render(<AccountModelPricing userId={7} model="gpt-image-2.6" />),
  );
  const grid = screen.getByTestId("model-price-grid");
  const featured = screen.getByRole("article", {
    name: "gpt-image-2.6 模型价格",
  });
  expect(within(featured).getByText("本次调用模型")).toBeTruthy();
  expect(within(featured).getByText("✦ 0.01")).toBeTruthy();
  const copy = within(featured).getByRole("button", {
    name: "复制 gpt-image-2.6 名称",
  });
  expect(copy).toBeEnabled();
  await act(async () => fireEvent.click(copy));
  expect(copyModel).toHaveBeenCalledWith("gpt-image-2.6");
  expect(within(grid).getAllByRole("article")[0]).toBe(featured);
  expect(within(grid).getAllByRole("article")).toHaveLength(2);
  expect(
    screen.getByRole("article", { name: "gpt-6.1 模型价格" }),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "gpt-6.1" },
  });
  expect(within(featured).getByText("✦ 0.01")).toBeTruthy();
  expect(
    screen.getAllByRole("article", { name: "gpt-image-2.6 模型价格" }),
  ).toHaveLength(1);
  expect(within(grid).getAllByRole("article")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "前往充值" })).toBeNull();
  expect(screen.queryByRole("link", { name: "模型广场" })).toBeNull();
});
test("missing model price is explicit and does not hide the other models", async () => {
  await act(async () =>
    render(<AccountModelPricing userId={7} model="unlisted-model" />),
  );
  expect(screen.getByText(/暂未提供此模型/)).toBeTruthy();
  expect(screen.getByTestId("model-price-grid")).toBeTruthy();
  expect(screen.getAllByRole("article")).toHaveLength(2);
});
test("failed read can be retried and account change removes prices", async () => {
  pricing.mockRejectedValueOnce(new Error("offline"));
  await act(async () => render(<AccountModelPricing userId={7} />));
  expect(screen.getByRole("alert")).toBeTruthy();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "重新读取" })),
  );
  expect(screen.getByTestId("model-price-grid")).toBeTruthy();
  act(() => window.dispatchEvent(new Event("new-api-session-changed")));
  expect(screen.queryByTestId("model-price-grid")).toBeNull();
  expect(screen.queryByTestId("quota-wallet-link")).toBeNull();
});
test("another user's response is never displayed", async () => {
  pricing.mockResolvedValue({ ...data, userId: 8 });
  await act(async () => render(<AccountModelPricing userId={7} />));
  expect(screen.queryByTestId("model-price-grid")).toBeNull();
  expect(screen.getByRole("alert")).toBeTruthy();
});

test.each(["account", "unmount"])(
  "%s aborts an outstanding price read and ignores its late response",
  async (change) => {
    let complete!: (value: ModelPricing) => void;
    pricing.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const view = render(<AccountModelPricing userId={7} />);
    const signal = pricing.mock.calls[0][0]!;
    if (change === "account")
      act(() => window.dispatchEvent(new Event("new-api-session-changed")));
    else view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => complete(data));
    expect(screen.queryByTestId("model-price-grid")).toBeNull();
  },
);

test("legacy price rows retain their complete original text", async () => {
  await act(async () => render(<AccountModelPricing userId={7} />));
  expect(
    screen.getByRole("article", { name: "gpt-6.1 模型价格" }),
  ).toHaveTextContent("输入 ✦ 0.4 / 输出 ✦ 2");
});

test("one model card switches all prices with its billing group", async () => {
  await renderPreview();
  const card = screen.getByRole("article", { name: "gpt-6-astra 模型价格" });
  expect(screen.getAllByRole("article")).toHaveLength(7);
  expect(
    screen.getAllByRole("article", { name: "gpt-6-astra 模型价格" }),
  ).toHaveLength(1);
  await chooseGroup("gpt-6-astra", "默认分组");
  expect(within(card).getByText("✦ 2")).toBeVisible();
  expect(within(card).getByText("✦ 10")).toBeVisible();
  await chooseGroup("gpt-6-astra", "优惠分组");
  expect(within(card).getByText("✦ 1.2")).toBeVisible();
  expect(within(card).getByText("✦ 6")).toBeVisible();
  expect(within(card).queryByText("✦ 2")).toBeNull();
  expect(within(card).queryByText("✦ 10")).toBeNull();
  fireEvent.click(
    within(card).getByRole("button", { name: "查看 gpt-6-astra 价格详情" }),
  );
  const dialog = screen.getByRole("dialog", { name: "模型计费详情" });
  expect(within(dialog).getByText("✦ 1.2")).toBeVisible();
  expect(within(dialog).getByText("✦ 6")).toBeVisible();
  expect(pricing).not.toHaveBeenCalled();
});

test("cache details retain read and write charges", async () => {
  await renderPreview();
  const card = screen.getByRole("article", { name: "claude-sonnet 模型价格" });
  fireEvent.click(
    within(card).getByRole("button", { name: "查看 claude-sonnet 价格详情" }),
  );
  const dialog = screen.getByRole("dialog", { name: "模型计费详情" });
  expect(within(dialog).getByText("缓存读取")).toBeVisible();
  expect(within(dialog).getByText("✦ 0.3")).toBeVisible();
  expect(within(dialog).getByText("缓存写入")).toBeVisible();
  expect(within(dialog).getByText("✦ 3.75")).toBeVisible();
});

test("cache summary includes upper tiers and counts repeated charge types once", async () => {
  const preview: ModelPricing = {
    ...data,
    rows: [
      {
        model: "tiered-cache",
        group: "default",
        billing: "上下文分档 · 每百万 tokens",
        price: "输入 ✦ 1 / 输出 ✦ 2",
        details: {
          unit: "tokens",
          tiers: [
            { context: "上下文 ≤ 100,000 tokens", input: "✦ 1", output: "✦ 2" },
            {
              context: "上下文 > 100,000 tokens",
              input: "✦ 2",
              output: "✦ 4",
              extras: [
                { label: "缓存读取", amount: "✦ 0.2" },
                { label: "缓存写入", amount: "✦ 2.5" },
              ],
            },
          ],
        },
      },
    ],
  };
  const view = render(<AccountModelPricing userId={7} previewData={preview} />);
  expect(screen.getByRole("button", { name: "2 项缓存费用" })).toBeVisible();
  const updated: ModelPricing = JSON.parse(JSON.stringify(preview));
  updated.rows[0].details!.tiers[0].extras = [
    { label: "缓存读取", amount: "✦ 0.1" },
  ];
  await act(async () =>
    view.rerender(<AccountModelPricing userId={7} previewData={updated} />),
  );
  expect(screen.getByRole("button", { name: "2 项缓存费用" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "3 项缓存费用" })).toBeNull();
});

test("tier details preserve both context limits and their prices", async () => {
  await renderPreview();
  const card = screen.getByRole("article", { name: "gemini-3.1-pro 模型价格" });
  fireEvent.click(
    within(card).getByRole("button", { name: "查看 gemini-3.1-pro 价格详情" }),
  );
  const dialog = screen.getByRole("dialog", { name: "模型计费详情" });
  expect(within(dialog).getByText("上下文 ≤ 200,000 tokens")).toBeVisible();
  expect(within(dialog).getByText("上下文 > 200,000 tokens")).toBeVisible();
  expect(within(dialog).getByText("✦ 13.5")).toBeVisible();
  expect(within(dialog).getByText("✦ 9")).toBeVisible();
});

test("zero request prices stay distinct from unknown prices", async () => {
  await renderPreview();
  const free = screen.getByRole("article", {
    name: "free-text-preview 模型价格",
  });
  const unknown = screen.getByRole("article", {
    name: "midjourney-v8.2 模型价格",
  });
  expect(within(free).getByText("✦ 0")).toBeVisible();
  expect(unknown).toHaveTextContent("请查看模型广场");
  expect(within(unknown).queryByText("✦ 0")).toBeNull();
});

test("local preview uses fixture data for search and refresh without requesting prices", async () => {
  await renderPreview();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "gpt-image" },
  });
  expect(screen.getByTestId("model-price-grid")).toHaveTextContent(
    "gpt-image-2.6",
  );
  expect(screen.getByTestId("model-price-grid")).not.toHaveTextContent(
    "gpt-6-astra",
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "刷新价格" })),
  );
  expect(pricing).not.toHaveBeenCalled();
});
