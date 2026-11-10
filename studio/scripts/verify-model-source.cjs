// Account/model endpoints are fixtures. No real keys or paid requests are created.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const imageModels = [
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
  "gemini-nano-banana-2.1",
];

async function run(browser, width, theme = "light") {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  let selected = 100;
  let selectedGroup = "";
  let failSelect = false;
  let failModels = false;
  const bound = new Map([["", 100]]);
  let creates = 0;
  let groupReads = 0;
  let sessionReads = 0;
  let modelReads = 0;
  let holdModels = false;
  let releaseModels;
  const perf = process.env.UI_TEST_SOURCE_PERF === "1";
  const errors = [];
  const writes = [];
  const groups = [
    { id: "", name: "", ratio: 0 },
    { id: "auto", name: "Auto 系统", ratio: "auto" },
    { id: "second", name: "优质分组", ratio: 0.6 },
    { id: "third", name: "新分组", ratio: 2.5 },
    ...Array.from({ length: 13 }, (_, index) => ({
      id: `extra-${index}`,
      name: `其他分组 ${index + 1}`,
      ratio: 1,
    })),
  ];
  const groupLabel = (name) => {
    const group = groups.find((item) => (item.name || "跟随账号") === name);
    return group.id === "" || group.id === "auto"
      ? name
      : `${name} · ${group.ratio}x`;
  };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((theme) => {
    localStorage.setItem("lang", "cn");
    localStorage.setItem(
      "app-config",
      JSON.stringify({
        version: 4.3,
        state: {
          theme,
          colorTheme: "violet",
          models: [],
          enableAutoGenerateTitle: false,
          modelConfig: { model: "", providerName: "" },
        },
      }),
    );
  }, theme);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (url.pathname === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true } });
    if (url.pathname === "/api/announcement")
      return route.fulfill({ json: { announcement: null } });
    if (url.pathname === "/api/skills/capabilities")
      return route.fulfill({ json: { web: false, papers: false } });
    if (url.pathname === "/api/ai-daily")
      return route.fulfill({ json: { items: [] } });
    if (url.pathname === "/api/new-api/status")
      return ok({
        enabled: true,
        configured: true,
        quotaPerUnit: 500000,
        currencySymbol: "$",
      });
    if (
      url.pathname === "/api/new-api/session" ||
      url.pathname === "/api/new-api/bootstrap"
    ) {
      sessionReads++;
      if (perf) await new Promise((resolve) => setTimeout(resolve, 250));
      const session = {
        authenticated: true,
        selectedTokenId: selected,
        user: {
          id: 7,
          username: "fixture",
          display_name: "Fixture",
          group: "default",
          quota: 500000,
        },
      };
      return ok(
        url.pathname.endsWith("/bootstrap")
          ? { config: { newApiEnabled: true, enableMcp: false }, session }
          : session,
      );
    }
    if (url.pathname === "/api/new-api/model-groups") {
      groupReads++;
      if (perf) await new Promise((resolve) => setTimeout(resolve, 450));
      return ok({ groups, selectedGroup });
    }
    if (url.pathname === "/api/new-api/model-groups/select") {
      const { group } = request.postDataJSON();
      writes.push(group);
      if (failSelect)
        return route.fulfill({
          status: 503,
          json: { success: false, message: "模拟切换失败" },
        });
      if (!bound.has(group)) {
        creates++;
        bound.set(
          group,
          group === "auto" ? 400 : group === "second" ? 200 : 300,
        );
      }
      selected = bound.get(group);
      selectedGroup = group;
      return ok({ group, selectedTokenId: selected });
    }
    if (url.pathname === "/api/remote-models") {
      modelReads++;
      if (holdModels)
        await new Promise((resolve) => {
          releaseModels = resolve;
        });
      if (perf) await new Promise((resolve) => setTimeout(resolve, 800));
      assert.equal(request.headers()["x-new-api-token"], String(selected));
      if (failModels)
        return route.fulfill({ status: 503, json: { error: "fixture" } });
      const models =
        selectedGroup === "auto"
          ? ["gpt-shared", "gpt-first", "gpt-second"]
          : selectedGroup === "third"
          ? ["gpt-third"]
          : ["gpt-shared", selectedGroup === "" ? "gpt-first" : "gpt-second"];
      if (process.env.UI_TEST_MODEL_LABELS === "1") models.push(...imageModels);
      return route.fulfill({ json: { data: models.map((id) => ({ id })) } });
    }
    if (url.pathname.startsWith("/api/"))
      throw new Error(`Unexpected API: ${request.method()} ${url.pathname}`);
    return route.continue();
  });
  const picker = () => page.locator('button[title^="选择模型:"]');
  const panel = () => page.locator('[class*="model-selector-container"]');
  const source = () =>
    panel().getByRole("button", { name: "分组", exact: true });
  const options = () => panel().locator("#model-source-options");
  const waitForModel = (name) =>
    page.waitForFunction(
      (name) =>
        [...document.querySelectorAll('button[title^="选择模型:"]')].some(
          (button) => button.title.includes(name),
        ),
      name,
    );
  const openOptions = async () => {
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.getAttribute("aria-label") === "分组" && !button.disabled,
      ),
    );
    if ((await source().getAttribute("aria-expanded")) !== "true")
      await source().click();
    await options().waitFor();
  };
  const choose = async (name) => {
    await openOptions();
    await options()
      .getByRole("button", { name: groupLabel(name), exact: true })
      .click();
  };
  try {
    await page.goto(`${base}#/chat`);
    await picker().click();
    await waitForModel("gpt-shared");
    await source().waitFor();
    if (process.env.UI_TEST_GROUP_CONCURRENCY === "1") {
      await page.evaluate(() =>
        localStorage.setItem(
          "octopus:user-7:task:fixture-lock",
          JSON.stringify({
            id: "fixture-lock",
            kind: "image",
            upstreamId: "fixture-lock",
            tokenId: 100,
            createdAt: Date.now(),
          }),
        ),
      );
      await choose("优质分组");
      await panel().getByText("gpt-second", { exact: true }).waitFor();
      assert.equal(selected, 200);
      assert.equal(selectedGroup, "second");
      const task = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("octopus:user-7:task:fixture-lock")),
      );
      assert.equal(task.tokenId, 100);
      await page.screenshot({
        path: path.join(
          os.tmpdir(),
          `octopus-concurrent-groups-${width}-${theme}.png`,
        ),
      });
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          width,
          theme,
          groupSwitchWhileTaskPending: true,
          originalTaskToken: task.tokenId,
          selectedToken: selected,
          paidRequests: 0,
        }),
      );
      return;
    }
    if (perf) {
      await openOptions();
      await panel().locator('[class*="model-selector-header"]').click();
      await panel().locator('[class*="model-selector-close"]').click();
      const before = { sessionReads, groupReads, modelReads };
      const start = Date.now();
      await picker().click();
      await openOptions();
      const reopenMs = Date.now() - start;
      await panel().locator('[class*="model-selector-header"]').click();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForTimeout(250);
      const visibleDuringFocus = await panel()
        .getByText("gpt-first", { exact: true })
        .isVisible();
      assert(
        visibleDuringFocus,
        "Background checks must not blank confirmed models",
      );
      assert.equal(sessionReads - before.sessionReads, 0);
      assert.equal(groupReads - before.groupReads, 0);
      assert.equal(modelReads - before.modelReads, 0);
      await panel().getByText("gpt-first", { exact: true }).waitFor();
      await page.screenshot({
        path: path.join(
          os.tmpdir(),
          `octopus-source-cache-${width}-${theme}.png`,
        ),
        animations: "disabled",
      });
      console.log(
        JSON.stringify({
          width,
          theme,
          reopenMs,
          visibleDuringFocus,
          reopenSessionReads: sessionReads - before.sessionReads,
          reopenGroupReads: groupReads - before.groupReads,
          focusModelReads: modelReads - before.modelReads,
          paidRequests: 0,
        }),
      );
      return;
    }
    if (process.env.UI_TEST_MODEL_LABELS === "1") {
      for (const name of imageModels) {
        const row = panel()
          .locator('[class*="model-select-item"]')
          .filter({ has: page.getByText(name, { exact: true }) });
        await row.getByText("生图", { exact: true }).waitFor();
        await row.getByText("图像生成与创作", { exact: true }).waitFor();
        assert.equal(await row.getByText("对话", { exact: true }).count(), 0);
      }
      assert.deepEqual(errors, []);
      assert.equal(creates, 0);
      console.log(
        JSON.stringify({ width, theme, imageLabels: true, paidRequests: 0 }),
      );
      return;
    }
    await panel().evaluate((element) => {
      for (const animation of element.getAnimations()) animation.finish();
    });
    const modelList = panel().locator('[class*="model-select-dropdown"]');
    const listBefore = await modelList.boundingBox();
    await openOptions();
    const listAfter = await modelList.boundingBox();
    assert(
      Math.abs(listBefore.y - listAfter.y) < 1,
      "Group menu must not move models",
    );
    assert(
      Math.abs(listBefore.height - listAfter.height) < 1,
      "Group menu must not shrink models",
    );
    const triggerBox = await source().boundingBox();
    const menuBox = await options().boundingBox();
    assert(Math.abs(menuBox.x - triggerBox.x) < 1);
    assert(Math.abs(menuBox.width - triggerBox.width) < 1);
    assert(menuBox.y >= triggerBox.y + triggerBox.height);
    assert(menuBox.height > 300, "Group menu should show more groups");
    const panelBox = await panel().boundingBox();
    assert(menuBox.y + menuBox.height <= panelBox.y + panelBox.height);
    assert.equal((await source().textContent()).trim(), "分组选择分组");
    assert.equal(
      await options()
        .getByRole("button", { name: "跟随账号", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await panel().getByText("生图参数", { exact: true }).count(),
      0,
    );
    await panel().locator('[class*="model-selector-header"]').click();
    assert.equal(await source().getAttribute("aria-expanded"), "false");
    await openOptions();
    assert.equal(writes.length, 0);
    assert.equal(creates, 0, "Browsing must not create keys");
    assert.equal(
      await options().getByRole("button").count(),
      groups.filter((group) => group.id !== "").length,
    );
    assert.equal(
      await options()
        .getByRole("button", { name: "优质分组 · 0.6x", exact: true })
        .count(),
      1,
    );
    assert(!(await source().innerText()).includes("#100"));
    assert.equal(
      await panel()
        .getByRole("button", { name: "创建并使用", exact: true })
        .count(),
      0,
    );
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-direct-groups-open-${width}-${theme}.png`,
      ),
      animations: "disabled",
    });
    assert.equal(
      await panel()
        .getByRole("textbox", { name: "搜索模型", exact: true })
        .count(),
      0,
    );
    const readsBeforeSwitch = groupReads;
    await choose("优质分组");
    await panel().getByText("gpt-second", { exact: true }).waitFor();
    await openOptions();
    assert(
      groupReads - readsBeforeSwitch <= 1,
      "At most one group refresh per switch",
    );
    const writesBeforeNoop = writes.length;
    await choose("优质分组");
    assert.equal(
      writes.length,
      writesBeforeNoop,
      "Selecting the current group is a no-op",
    );
    assert((await source().innerText()).includes("优质分组"));
    assert((await picker().getAttribute("title")).includes("gpt-shared"));
    assert.equal(creates, 1);
    await choose("Auto 系统");
    await panel().getByText("gpt-first", { exact: true }).waitFor();
    assert.equal(creates, 2);
    const beforeRevisit = { sessionReads, groupReads, modelReads };
    await page.evaluate(() => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + 61_000;
    });
    holdModels = true;
    await choose("优质分组");
    await panel().getByText("gpt-second", { exact: true }).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.getAttribute("aria-label") === "分组" && !button.disabled,
      ),
    );
    assert(releaseModels, "Revisiting must revalidate the cached models");
    assert.equal(modelReads - beforeRevisit.modelReads, 1);
    assert.equal(sessionReads - beforeRevisit.sessionReads, 0);
    assert.equal(groupReads - beforeRevisit.groupReads, 0);
    assert.equal(
      await panel().getByText("gpt-first", { exact: true }).count(),
      0,
      "Only the confirmed group's cached models may be displayed",
    );
    holdModels = false;
    releaseModels();
    releaseModels = undefined;
    assert.equal(creates, 2, "Revisiting a group reuses its key");

    failSelect = true;
    await choose("新分组");
    await panel().getByText("模拟切换失败", { exact: true }).waitFor();
    await panel().getByText("gpt-second", { exact: true }).waitFor();
    assert.equal(selectedGroup, "second");
    assert.equal(creates, 2);
    failSelect = false;
    await panel().getByRole("button", { name: "重试", exact: true }).click();
    await panel().getByText("gpt-third", { exact: true }).waitFor();
    assert.equal(selectedGroup, "third");
    assert.equal(creates, 3);
    await waitForModel("gpt-third");
    assert((await picker().getAttribute("title")).includes("gpt-third"));
    assert.equal(
      await panel()
        .locator('[class*="model-select-item"][class*="selected"]')
        .filter({ hasText: "gpt-third" })
        .count(),
      1,
    );
    await panel().getByText("gpt-third", { exact: true }).click();
    await picker().click();

    // Expire the cached model list to exercise an actual failed revalidation.
    await page.evaluate(() => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + 61_000;
    });
    failModels = true;
    await choose("优质分组");
    await panel().getByRole("alert").waitFor();
    await panel().getByText("gpt-second", { exact: true }).waitFor();
    failModels = false;
    await panel().getByRole("button", { name: "重试", exact: true }).click();
    await panel().getByText("gpt-second", { exact: true }).waitFor();
    await waitForModel("gpt-shared");
    assert.equal(creates, 3);

    await page.evaluate(() =>
      localStorage.setItem(
        "octopus:user-7:task:fixture-lock",
        JSON.stringify({
          id: "fixture-lock",
          kind: "image",
          upstreamId: "fixture-lock",
          tokenId: 200,
          createdAt: Date.now(),
        }),
      ),
    );
    await openOptions();
    assert(
      await options()
        .getByRole("button", { name: "Auto 系统", exact: true })
        .isEnabled(),
    );
    await options()
      .getByRole("button", { name: "Auto 系统", exact: true })
      .focus();
    await page.keyboard.press("Escape");
    assert.equal(await source().getAttribute("aria-expanded"), "false");
    assert(await panel().isVisible());
    await choose("Auto 系统");
    await panel().getByText("gpt-first", { exact: true }).waitFor();
    await panel().getByText("gpt-second", { exact: true }).waitFor();
    assert.equal(selectedGroup, "auto");
    assert.equal(creates, 3);
    assert(!(await source().innerText()).includes("autox"));
    await choose("优质分组");
    await choose("Auto 系统");
    assert.equal(creates, 3, "Auto must reuse its existing key");
    await openOptions();
    assert.equal(
      await options().getByRole("button").first().getAttribute("aria-label"),
      "Auto 系统",
    );
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-direct-groups-${width}-${theme}.png`,
      ),
      animations: "disabled",
    });
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
        theme,
        groupOnly: true,
        sharedModelPreserved: true,
        automaticDefaultModel: true,
        failureRecovery: true,
        groupReuse: true,
        cachedRevisitDuringRefresh: true,
        singleModelRefreshPerSwitch: true,
        groupSwitchWhileTaskPending: true,
        paidRequests: 0,
      }),
    );
  } catch (error) {
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-direct-groups-failed-${width}.png`),
    });
    console.error(
      (await page.locator("body").innerText()).slice(-4000),
      errors,
    );
    throw error;
  } finally {
    releaseModels?.();
    await context.close();
  }
}
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) await run(browser, width);
    await run(browser, 390, "dark");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
