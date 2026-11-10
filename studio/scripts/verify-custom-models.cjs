// All account/provider responses are fixtures; no real keys or model calls.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";

async function run(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let providerReads = 0;
  let failModels = false;
  let failAccountModels = false;
  const sent = [];
  await page.addInitScript(() => {
    localStorage.setItem("lang", "cn");
    localStorage.setItem(
      "app-config",
      JSON.stringify({
        version: 4.3,
        state: {
          models: [],
          theme: "light",
          enableAutoGenerateTitle: false,
          modelConfig: { model: "", providerName: "", stream: false },
        },
      }),
    );
  });
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (url.origin === "https://custom.fixture.test") {
      providerReads++;
      assert.equal(request.headers().authorization, "Bearer sk-custom-fixture");
      assert(!request.headers()["x-new-api-token"]);
      assert(!request.headers().cookie);
      if (url.pathname === "/v1/chat/completions") {
        sent.push({ source: "custom", body: request.postDataJSON() });
        if (request.postDataJSON().stream)
          return route.fulfill({
            contentType: "text/event-stream",
            body: 'data: {"choices":[{"delta":{"content":"custom reply"}}]}\n\ndata: [DONE]\n\n',
          });
        return route.fulfill({
          json: { choices: [{ message: { content: "custom reply" } }] },
        });
      }
      return route.fulfill(
        failModels
          ? { status: 401, json: { error: "fixture" } }
          : {
              json: {
                data: [
                  { id: "gpt-external-a" },
                  { id: "claude-external-b" },
                  { id: "gpt-account" },
                ],
              },
            },
      );
    }
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === "/api/new-api/bootstrap")
      return ok({
        config: { newApiEnabled: true },
        session: {
          authenticated: true,
          user: { id: 7, username: "fixture" },
          selectedTokenId: 100,
        },
      });
    if (url.pathname === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true } });
    if (url.pathname === "/api/new-api/session")
      return ok({
        authenticated: true,
        user: { id: 7, username: "fixture" },
        selectedTokenId: 100,
      });
    if (url.pathname === "/api/new-api/status")
      return ok({ enabled: true, configured: true });
    if (url.pathname === "/api/new-api/model-groups")
      return ok({
        groups: [{ id: "auto", name: "Auto 系统", ratio: "auto" }],
        selectedGroup: "auto",
      });
    if (url.pathname === "/api/remote-models")
      return route.fulfill(
        failAccountModels
          ? { status: 503, json: { message: "fixture unavailable" } }
          : { json: { data: [{ id: "gpt-account" }] } },
      );
    if (url.pathname === "/api/v1/chat/completions") {
      assert.equal(request.headers()["x-new-api-token"], "100");
      assert.notEqual(
        request.headers().authorization,
        "Bearer sk-custom-fixture",
      );
      sent.push({ source: "account", body: request.postDataJSON() });
      if (request.postDataJSON().stream)
        return route.fulfill({
          contentType: "text/event-stream",
          body: 'data: {"choices":[{"delta":{"content":"account reply"}}]}\n\ndata: [DONE]\n\n',
        });
      return route.fulfill({
        json: { choices: [{ message: { content: "account reply" } }] },
      });
    }
    if (url.pathname === "/api/announcement")
      return route.fulfill({ json: { announcement: null } });
    if (url.pathname === "/api/ai-daily")
      return route.fulfill({ json: { items: [] } });
    if (url.pathname === "/api/skills/capabilities")
      return route.fulfill({ json: { web: false, papers: false } });
    if (url.pathname.startsWith("/api/"))
      throw new Error(`Unexpected request ${url.pathname}`);
    return route.continue();
  });
  const choose = async (control, value, label) => {
    if (await control.evaluate((element) => element.tagName === "SELECT"))
      await control.selectOption(value);
    else {
      await control.click();
      await page
        .getByRole("dialog", { name: "自定义模型", exact: true })
        .getByRole("button", { name: label, exact: true })
        .click();
    }
  };
  try {
    await page.goto(`${base}#/settings`);
    const form = page.getByRole("region", { name: "模型接口配置" });
    const source = form.getByLabel("自定义模型", { exact: true });
    await source.waitFor();
    await source.check();
    await form
      .getByLabel("API URL", { exact: true })
      .fill("https://custom.fixture.test/v1");
    await form.getByLabel("API Key", { exact: true }).fill("sk-custom-fixture");
    failModels = true;
    await form.getByRole("button", { name: "获取模型", exact: true }).click();
    await form.getByRole("alert").filter({ hasText: "HTTP 401" }).waitFor();
    failModels = false;
    await form.getByRole("button", { name: "获取模型", exact: true }).click();
    const models = form.getByRole("group", { name: "选择自定义模型" });
    await models
      .getByRole("button", { name: "claude-external-b", exact: true })
      .click();
    assert.equal(
      await models
        .getByRole("button", { name: "claude-external-b", exact: true })
        .getAttribute("aria-pressed"),
      "false",
    );
    await form.getByRole("button", { name: "保存并应用", exact: true }).click();
    await form.getByRole("status").filter({ hasText: "配置已保存" }).waitFor();
    assert.equal(await models.getByRole("button").count(), 3);
    await page.screenshot({
      animations: "disabled",
      path: path.join(
        os.tmpdir(),
        `octopus-custom-models-settings-${width}.png`,
      ),
    });
    await page.goto(`${base}#/chat`);
    const picker = page.locator('button[title^="选择模型:"]');
    await picker.waitFor();
    await picker.click();
    const panel = page.locator('[class*="model-selector-container"]');
    const row = panel
      .locator('[class*="model-select-item__"]')
      .filter({ hasText: "gpt-external-a" });
    await row.getByText("自定义", { exact: true }).waitFor();
    assert.equal(
      await panel.getByText("claude-external-b", { exact: true }).count(),
      0,
    );
    assert.equal(
      await panel.getByText("gpt-account", { exact: true }).count(),
      2,
    );
    await page.screenshot({
      animations: "disabled",
      path: path.join(os.tmpdir(), `octopus-custom-models-picker-${width}.png`),
    });
    const sameName = panel
      .locator('[class*="model-select-item__"]')
      .filter({ has: page.getByText("gpt-account", { exact: true }) });
    assert.equal(await sameName.count(), 2);
    await sameName.filter({ hasText: "自定义" }).click();
    assert.match(await picker.innerText(), /自定义/);
    const input = page.locator("textarea:visible").first();
    await input.fill("custom request fixture");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByText("custom reply", { exact: true }).waitFor();
    await picker.click();
    await sameName.filter({ hasNotText: "自定义" }).click();
    await input.fill("account request fixture");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByText("account reply", { exact: true }).waitFor();
    assert.deepEqual(
      sent.map((entry) => entry.source),
      ["custom", "account"],
    );
    assert(sent.every((entry) => entry.body.model === "gpt-account"));
    failAccountModels = true;
    await page.reload();
    await picker.click();
    await sameName.filter({ hasText: "自定义" }).click();
    await input.fill("custom remains available");
    const customRequest = page.waitForRequest(
      (request) =>
        request.url() === "https://custom.fixture.test/v1/chat/completions",
    );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await customRequest;
    await page.getByText("custom reply", { exact: true }).nth(1).waitFor();
    assert.equal(sent.at(-1).source, "custom");
    failAccountModels = false;
    await page.goto(`${base}#/settings`);
    await source.uncheck();
    await form.getByRole("button", { name: "保存并应用", exact: true }).click();
    await form.getByRole("status").filter({ hasText: "配置已保存" }).waitFor();
    await page.goto(`${base}#/chat`);
    await picker.click();
    await panel.getByText("gpt-account", { exact: true }).waitFor();
    assert.equal(await panel.getByText("自定义", { exact: true }).count(), 0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        fetchedModelsSelectable: true,
        customBadge: true,
        accountIsolated: true,
        providerReads,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        sent,
        errors,
        body: (await page.locator("body").innerText()).slice(-3500),
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
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
