// All account/model endpoints are fixtures. No generation request is sent.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";

async function run(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  let selected = 100;
  let group = "first";
  let reads = 0;
  await page.addInitScript(() => {
    localStorage.setItem("lang", "cn");
    localStorage.setItem(
      "app-config",
      JSON.stringify({
        version: 4.3,
        state: {
          theme: "light",
          models: [],
          customModels: "gpt-old-custom",
          modelConfig: { model: "gpt-first", providerName: "gpt" },
        },
      }),
    );
  });
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (url.pathname === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true } });
    if (url.pathname === "/api/remote-models") {
      reads++;
      assert.equal(req.headers()["x-new-api-token"], String(selected));
      return route.fulfill({
        json: { data: group === "empty" ? [] : [{ id: `gpt-${group}` }] },
      });
    }
    if (url.pathname === "/api/new-api/status")
      return ok({
        enabled: true,
        configured: true,
        passwordLoginEnabled: true,
      });
    if (url.pathname === "/api/new-api/session")
      return ok({
        authenticated: true,
        selectedTokenId: selected,
        user: {
          id: 7,
          username: "fixture",
          display_name: "Fixture",
          group: "default",
          quota: 500000,
          used_quota: 0,
          request_count: 0,
        },
      });
    if (url.pathname === "/api/new-api/tokens")
      return ok({
        items: [100, 200].map((id) => ({
          id,
          name: `Key ${id}`,
          group: id === 100 ? group : "second",
          status: 1,
          unlimited_quota: true,
          expired_time: -1,
          remain_quota: 1,
          used_quota: 0,
        })),
        total: 2,
        page: 1,
        size: 20,
      });
    if (url.pathname === "/api/new-api/groups")
      return ok(
        ["first", "second", "third"].map((id) => ({ id, name: id, ratio: 1 })),
      );
    if (url.pathname === "/api/new-api/auto-groups")
      return ok({ supported: false, defaultGroups: [], maxCount: 0 });
    if (url.pathname === "/api/new-api/logs")
      return ok({ items: [], total: 0, page: 1, size: 20 });
    if (url.pathname === "/api/new-api/tokens/100" && req.method() === "PUT") {
      group = req.postDataJSON().group;
      return ok();
    }
    if (url.pathname === "/api/new-api/tokens/200/select") {
      selected = 200;
      group = "second";
      return ok({ selectedTokenId: 200 });
    }
    if (/\/(?:chat\/completions|images\/|videos\/)/.test(url.pathname))
      throw new Error("Unexpected generation request");
    return route.continue();
  });
  async function assertModels(expected) {
    await page.goto(`${base}#/chat`);
    const picker = page.locator('button[title^="选择模型:"]');
    await picker.waitFor();
    await page.waitForFunction((expected) => {
      const button = document.querySelector('button[title^="选择模型:"]');
      return button?.title.includes(expected);
    }, expected);
    await picker.click();
    const panel = page.locator('[class*="model-selector-container"]');
    await panel.waitFor();
    const text = await panel.innerText();
    assert(text.includes(expected), text);
    assert(!text.includes("gpt-old-custom"), text);
    assert(
      !text.includes(expected === "gpt-first" ? "gpt-second" : "gpt-first"),
      text,
    );
    await page.screenshot({
      path: `${process.env.TEMP}/octopus-group-models-${width}.png`,
    });
    await panel.locator('button[class*="model-selector-close"]').click();
  }
  await page.goto(`${base}#/account`);
  await page
    .getByRole("button", { name: "编辑密钥", exact: true })
    .first()
    .waitFor();
  await assertModels("gpt-first");
  await page.goto(`${base}#/account`);
  await page
    .getByRole("button", { name: "编辑密钥", exact: true })
    .first()
    .click();
  await page
    .locator("select")
    .filter({ has: page.locator('option[value="third"]') })
    .selectOption("third");
  const beforeEdit = reads;
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForResponse((res) => res.url().endsWith("/api/remote-models"));
  assert(reads > beforeEdit);
  await assertModels("gpt-third");
  await page.goto(`${base}#/account`);
  await page.getByRole("button", { name: "用于聊天", exact: true }).click();
  await page.waitForResponse((res) => res.url().endsWith("/api/remote-models"));
  await assertModels("gpt-second");
  group = "third";
  const refreshed = page.waitForResponse(
    (res) => res.url().endsWith("/api/remote-models"),
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await refreshed;
  await assertModels("gpt-third");
  group = "empty";
  const emptied = page.waitForResponse((res) =>
    res.url().endsWith("/api/remote-models"),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await emptied;
  await page.waitForFunction(() => {
    const button = document.querySelector('button[title^="选择模型:"]');
    return button && !button.title.includes("gpt-");
  });
  const input = page.locator("textarea").first();
  await input.fill("Empty group must not send this");
  await input.press("Enter");
  await page
    .getByText("当前密钥没有可用的所选模型，请检查分组或重新选择模型。", {
      exact: true,
    })
    .waitFor();
  assert.equal(await input.inputValue(), "Empty group must not send this");
  console.log(
    JSON.stringify({
      width,
      editedGroup: true,
      selectedKey: true,
      externalGroupRefresh: true,
      customModelsExcluded: true,
      emptyGroupBlocked: true,
      reads,
    }),
  );
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) await run(browser, width);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
