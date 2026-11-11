// Isolated local previews and intercepted APIs never touch real accounts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
assert.equal(new URL(base).origin, "http://localhost:3001");
const output = fs.mkdtempSync(
  path.join(os.tmpdir(), "octopus-pricing-layout-"),
);
const longModel =
  "gpt-extended-context-vendor-model-with-a-long-name-that-must-wrap-without-moving-the-copy-button-or-footer";
const tokens = (input, out, extras) => ({
  unit: "tokens",
  tiers: [{ input, output: out, ...(extras ? { extras } : {}) }],
});
const mockRows = [
  {
    model: "claude-sonnet",
    group: "默认分组",
    billing: "动态 · 每百万 tokens",
    price: "输入 ✦ 3 / 输出 ✦ 15",
    details: tokens("✦ 3", "✦ 15", [
      { label: "缓存读取", amount: "✦ 0.3" },
      { label: "缓存写入", amount: "✦ 3.75" },
      { label: "缓存写入（1小时）", amount: "✦ 6" },
    ]),
  },
  ...[
    ["默认分组", "✦ 2", "✦ 10"],
    ["优惠分组", "✦ 1.2", "✦ 6"],
  ].map(([group, input, out]) => ({
    model: "gpt-6-astra",
    group,
    billing: "基础文本 · 每百万 tokens",
    price: `输入 ${input} / 输出 ${out}`,
    details: tokens(input, out),
  })),
  {
    model: longModel,
    group: "用于验证自然换行的长调用分组名称",
    billing: "基础文本 · 每百万 tokens",
    price: "输入 ✦ 12.123456 / 输出 ✦ 9876.12",
    details: tokens("✦ 12.123456", "✦ 9876.12"),
  },
];

async function fixture(browser, width, theme, live = false) {
  const context = await browser.newContext({
    viewport: { width, height: width > 600 ? 1000 : 844 },
    colorScheme: theme,
    isMobile: width <= 600,
    hasTouch: width <= 600,
    serviceWorkers: "block",
  });
  await context.addInitScript(
    ({ theme }) => {
      localStorage.setItem("lang", "cn");
      const config = JSON.stringify({
        version: 4.4,
        state: { theme, models: [], modelConfig: {} },
      });
      for (const key of ["app-config", "octopus:user-7:app-config"])
        localStorage.setItem(key, config);
    },
    { theme },
  );
  const page = await context.newPage();
  const state = {
    width,
    theme,
    live,
    context,
    page,
    calls: [],
    errors: [],
    warnings: [],
  };
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      text.startsWith("ServiceWorker registration failed:") ||
      text.startsWith(
        "Loading the script 'https://www.googletagmanager.com/",
      ) ||
      text.startsWith("Failed to load resource: net::ERR_FAILED")
    )
      state.warnings.push(text);
    else state.errors.push(text);
  });
  await page.route("**/*", (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (request.headers()["next-action"])
      return route.fulfill({
        contentType: "text/x-component",
        body: '0:{"a":false,"f":[]}\n',
      });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    state.calls.push({ method: request.method(), path: url.pathname });
    const config = { newApiEnabled: live, needCode: false, enableMcp: false };
    if (url.pathname === "/api/config") return route.fulfill({ json: config });
    if (request.method() !== "GET") {
      state.errors.push(
        `Blocked unexpected ${request.method()} ${url.pathname}`,
      );
      return route.fulfill({
        status: 403,
        json: { success: false, message: "Fixture blocks account writes" },
      });
    }
    const session = {
      authenticated: live,
      selectedTokenId: live ? 1 : null,
      user: live
        ? {
            id: 7,
            username: "fixture",
            group: "default",
            quota: 500000,
            used_quota: 0,
            request_count: 0,
          }
        : null,
    };
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (url.pathname === "/api/new-api/bootstrap")
      return ok({ config, session });
    if (url.pathname === "/api/new-api/session") return ok(session);
    if (url.pathname === "/api/new-api/tokens")
      return ok({
        items: [
          {
            id: 1,
            name: "Fixture system key",
            group: "auto",
            status: 1,
            unlimited_quota: true,
            model_limits_enabled: false,
            model_limits: "",
            expired_time: -1,
          },
        ],
        total: 1,
        page: 1,
        size: 10,
      });
    if (url.pathname === "/api/new-api/status")
      return ok({
        enabled: live,
        configured: live,
        passwordLoginEnabled: true,
        turnstileSiteKey: "",
        quotaPerUnit: 500000,
        currencySymbol: "✦",
      });
    if (url.pathname === "/api/new-api/model-pricing") {
      assert(live, "Local preview never requests account prices");
      return ok({
        userId: 7,
        account: "fixture",
        currency: "✦",
        rows: mockRows,
        fetchedAt: "2026-11-09",
        pricingUrl: "",
        walletUrl: "",
      });
    }
    return ok([]);
  });
  await page.goto(`${base}#/pricing${live ? "" : "?local-preview=account"}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("model-price-grid").waitFor({ timeout: 60000 });
  await page.locator(`body.${theme}`).waitFor();
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
  await page.addStyleTag({
    content: "nextjs-portal { display:none !important; }",
  });
  return state;
}

async function inspect(state) {
  return state.page.getByTestId("account-model-pricing").evaluate((root) => {
    const box = (node) => {
      const r = node.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
      };
    };
    const grid = root.querySelector('[data-testid="model-price-grid"]');
    const cards = Array.from(grid.querySelectorAll(":scope > article")).map(
      (node) => ({
        name: node.getAttribute("aria-label"),
        bounds: box(node),
        footer: box(node.querySelector("footer")),
        overflow: node.scrollWidth - node.clientWidth,
      }),
    );
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      documentWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      viewportWidth: innerWidth,
      scrollingElement: {
        tag: document.scrollingElement.tagName,
        clientWidth: document.scrollingElement.clientWidth,
        scrollWidth: document.scrollingElement.scrollWidth,
      },
      outsideElements:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1
          ? Array.from(document.querySelectorAll("body *"))
              .map((node) => ({
                tag: node.tagName,
                class: String(node.className),
                role: node.getAttribute("role"),
                ariaHidden: node.getAttribute("aria-hidden"),
                bounds: box(node),
                transform: getComputedStyle(node).transform,
              }))
              .filter(
                (entry) =>
                  entry.bounds.width > 0 &&
                  (entry.bounds.x < -1 ||
                    entry.bounds.x + entry.bounds.width >
                      document.documentElement.clientWidth + 1),
              )
              .slice(0, 20)
          : [],
      catalogWidth: root.clientWidth,
      catalogScrollWidth: root.scrollWidth,
      heading: box(root.querySelector("h2")),
      toolbar: box(root.querySelector("input").closest("label").parentElement),
      cards,
    };
  });
}

async function dialogCheck(state, model, expected, capture = false) {
  const { page } = state;
  const trigger = page.getByRole("button", {
    name: `查看 ${model} 价格详情`,
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "模型计费详情",
    exact: true,
  });
  await dialog.waitFor();
  for (const value of expected)
    assert((await dialog.innerText()).includes(value), value);
  if (capture) {
    await dialog.evaluate((node) =>
      Promise.all(
        node
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    await page.screenshot({
      path: path.join(output, `detail-${state.width}-${state.theme}.png`),
    });
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert(
    await trigger.evaluate((node) => document.activeElement === node),
    "Focus returns after detail closes",
  );
}

async function run(browser, width, theme) {
  const state = await fixture(browser, width, theme);
  try {
    const initialMetrics = await inspect(state);
    fs.writeFileSync(
      path.join(output, `initial-${width}-${theme}.json`),
      JSON.stringify(initialMetrics, null, 2),
    );
    await state.page.waitForFunction(
      () =>
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        innerWidth <= document.documentElement.clientWidth + 1,
      null,
      { timeout: 3000 },
    );
    const metrics = await inspect(state);
    assert.equal(metrics.columns, width > 600 ? 3 : 1);
    assert(
      metrics.documentWidth <= width + 1,
      `Document overflow at ${width}/${theme}: ${JSON.stringify(metrics)}`,
    );
    assert(metrics.catalogScrollWidth <= metrics.catalogWidth + 1);
    for (const card of metrics.cards) {
      assert(card.overflow <= 1, card.name);
      for (const peer of metrics.cards.filter(
        (entry) => Math.abs(entry.bounds.y - card.bounds.y) < 2,
      )) {
        assert(Math.abs(peer.bounds.height - card.bounds.height) < 2);
        assert(Math.abs(peer.footer.bottom - card.footer.bottom) < 2);
      }
    }
    if (width > 600)
      assert(Math.abs(metrics.heading.y - metrics.toolbar.y) < 20);
    const screenshot = path.join(output, `pricing-${width}-${theme}.png`);
    await state.page.screenshot({ path: screenshot });
    console.log(
      JSON.stringify({ screenshot, width, theme, columns: metrics.columns }),
    );
    const search = state.page.getByRole("searchbox", {
      name: "搜索模型",
      exact: true,
    });
    await search.fill("no-matching-price");
    await state.page
      .getByText("没有匹配的模型，试试其他名称。", { exact: true })
      .waitFor();
    assert.equal(await state.page.getByTestId("model-price-grid").count(), 0);
    await search.fill("");
    const gpt = state.page.getByRole("article", {
      name: "gpt-6-astra 模型价格",
      exact: true,
    });
    await gpt
      .getByRole("combobox", { name: "gpt-6-astra 计费分组", exact: true })
      .click();
    await state.page
      .getByRole("option", { name: "优惠分组", exact: true })
      .click();
    assert((await gpt.innerText()).includes("✦ 1.2"));
    assert((await gpt.innerText()).includes("✦ 6"));
    await dialogCheck(
      state,
      "claude-sonnet",
      ["缓存读取", "缓存写入", "3.75"],
      true,
    );
    await dialogCheck(state, "gemini-3.1-pro", [
      "≤ 200,000",
      "> 200,000",
      "13.5",
    ]);
    assert.deepEqual(state.errors, []);
    fs.writeFileSync(
      path.join(output, `result-${width}-${theme}.json`),
      JSON.stringify(
        {
          width,
          theme,
          metrics,
          calls: state.calls,
          errors: state.errors,
          warnings: state.warnings,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await state.page.screenshot({
      path: path.join(output, `failed-${width}-${theme}.png`),
    });
    console.error({ output, width, theme });
    throw error;
  } finally {
    await state.context.close();
  }
}

async function checkLongAndSession(browser) {
  const state = await fixture(browser, 1440, "light", true);
  try {
    const metrics = await inspect(state);
    assert(metrics.catalogScrollWidth <= metrics.catalogWidth + 1);
    assert(metrics.cards.every((card) => card.overflow <= 1));
    for (const card of metrics.cards)
      for (const peer of metrics.cards.filter(
        (entry) => Math.abs(entry.bounds.y - card.bounds.y) < 2,
      ))
        assert(
          Math.abs(peer.footer.bottom - card.footer.bottom) < 2,
          "Long model footer aligns",
        );
    await state.page.screenshot({
      path: path.join(output, "long-model-mock.png"),
    });
    const trigger = state.page.getByRole("button", {
      name: "查看 claude-sonnet 价格详情",
      exact: true,
    });
    await trigger.click();
    const dialog = state.page.getByRole("dialog", {
      name: "模型计费详情",
      exact: true,
    });
    await dialog.waitFor();
    assert((await dialog.innerText()).includes("缓存写入（1小时）"));
    await state.page.evaluate(() =>
      window.dispatchEvent(new Event("new-api-session-changed")),
    );
    await state.page
      .getByTestId("model-price-grid")
      .waitFor({ state: "hidden" });
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await state.page.getByRole("article").count(),
      0,
      "Session changes remove old account prices",
    );
    assert.deepEqual(state.errors, []);
    console.log(
      JSON.stringify({
        longModel: true,
        accountSessionCleared: true,
        paidRequests: 0,
      }),
    );
  } finally {
    await state.context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const cases = process.env.UI_TEST_LONG_ONLY
      ? []
      : process.env.UI_TEST_CASES
      ? process.env.UI_TEST_CASES.split(",").map((entry) => {
          const [width, theme] = entry.split(":");
          return [Number(width), theme];
        })
      : process.env.UI_TEST_WIDTH
      ? [
          [
            Number(process.env.UI_TEST_WIDTH),
            process.env.UI_TEST_THEME || "light",
          ],
        ]
      : [1440, 390, 320].flatMap((width) =>
          ["light", "dark"].map((theme) => [width, theme]),
        );
    for (const [width, theme] of cases) await run(browser, width, theme);
    await checkLongAndSession(browser);
    console.log(JSON.stringify({ output, realPaidRequests: 0 }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
