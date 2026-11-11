// Isolated account/model fixtures exercise session selection without paid calls.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const chatKey = "octopus:user-7:chat-next-web-store";

async function snapshot(page) {
  return page.evaluate(async (key) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const raw = await new Promise((resolve, reject) => {
        const request = database
          .transaction("keyval", "readonly")
          .objectStore("keyval")
          .get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return JSON.parse(raw || localStorage.getItem(key) || "null")?.state;
    } finally {
      database.close();
    }
  }, chatKey);
}

async function waitSnapshot(page, predicate, message) {
  const deadline = Date.now() + 10000;
  let state;
  while (Date.now() < deadline) {
    state = await snapshot(page);
    if (state && predicate(state)) return state;
    await page.waitForTimeout(50);
  }
  assert.fail(`${message}: ${JSON.stringify(state)}`);
}

async function fixture(page) {
  await prepare(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const config = JSON.parse(localStorage.getItem("app-config"));
    config.version = 4.4;
    config.state.theme = "light";
    config.state.dontShowMaskSplashScreen = true;
    config.state.modelConfig.model = "gpt-global";
    config.state.modelConfig.providerName = "gpt";
    config.state.modelConfig.temperature = 0.4;
    localStorage.setItem("app-config", JSON.stringify(config));
    localStorage.setItem(
      "octopus:user-7:custom-provider",
      JSON.stringify({
        useCustomConfig: true,
        customConfigName: "Fixture external provider",
        customApiMode: "auto",
        customModelNames: "gpt-external",
        openaiUrl: "https://models.fixture.invalid/v1",
        openaiApiKey: "fixture-key",
      }),
    );
    if (sessionStorage.getItem("model-memory-fixture-seeded")) return;
    sessionStorage.setItem("model-memory-fixture-seeded", "1");
    const chat = JSON.parse(localStorage.getItem("chat-next-web-store"));
    chat.state.sessions = chat.state.sessions.slice(0, 1);
    const session = chat.state.sessions[0];
    session.id = "model-memory-a";
    session.topic = "Model memory A";
    session.mask.modelConfig = {
      ...config.state.modelConfig,
      temperature: 1.3,
    };
    session.mask.syncGlobalConfig = false;
    session.mask.context = [
      { id: "fixture-context", role: "system", content: "A only context" },
    ];
    session.memoryPrompt = "A only summary";
    localStorage.setItem(
      "octopus:user-7:chat-next-web-store",
      JSON.stringify(chat),
    );
  });
  let group = "first";
  let tokenId = 100;
  let switches = 0;
  const models = {
    first: ["gpt-global", "gpt-alpha", "gpt-shared"],
    second: ["gpt-beta", "gpt-shared"],
  };
  const session = () => ({
    authenticated: true,
    selectedTokenId: tokenId,
    user: { id: 7, username: "fixture", group: "default" },
  });
  const config = {
    newApiEnabled: true,
    needCode: false,
    hasModelApiKey: true,
    enableMcp: false,
    defaultModel: "gpt-global@gpt",
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (request.headers()["next-action"])
      return route.fulfill({ status: 503, body: "Fixture: MCP unavailable" });
    if (url.pathname === "/api/new-api/bootstrap")
      return ok({ config, session: session() });
    if (url.pathname === "/api/config") return route.fulfill({ json: config });
    if (url.pathname === "/api/new-api/session") return ok(session());
    if (url.pathname === "/api/new-api/model-groups")
      return ok({
        groups: ["first", "second"].map((id) => ({
          id,
          name: id,
          ratio: 1,
          description: "",
        })),
        selectedGroup: group,
      });
    if (url.pathname === "/api/new-api/model-groups/select") {
      group = request.postDataJSON().group;
      assert(models[group], "Only fixture groups may be selected");
      tokenId = group === "first" ? 100 : 200;
      switches++;
      return ok({ selectedTokenId: tokenId, group });
    }
    if (url.pathname === "/api/remote-models")
      return route.fulfill({
        json: { data: models[group].map((id) => ({ id })) },
      });
    return route.fallback();
  });
  return { switches: () => switches };
}

function picker(page) {
  return page.locator('button[title^="选择模型:"]');
}

async function assertModel(page, model, custom = false) {
  await page.waitForFunction(
    ({ model, custom }) => {
      const button = document.querySelector('button[title^="选择模型:"]');
      return (
        button?.title === `选择模型: ${model}` &&
        button.textContent.includes("自定义") === custom
      );
    },
    { model, custom },
  );
}

async function chooseModel(page, model, provider = "gpt") {
  await picker(page).click();
  const dialog = page.getByRole("dialog", { name: "选择模型", exact: true });
  await dialog
    .getByRole("button", { name: `${model} (${provider})`, exact: true })
    .click();
  await dialog.waitFor({ state: "detached" });
  await assertModel(page, model, provider === "octopus-custom");
}

async function openSidebar(page, width) {
  if (width <= 600)
    await page
      .getByRole("button", { name: "查看消息列表", exact: true })
      .click();
}

async function newChat(page, width, count) {
  await openSidebar(page, width);
  await page.locator('button[title="新的聊天"]').click();
  await page.locator("#chat-input").waitFor();
  const state = await waitSnapshot(
    page,
    (state) => state.sessions.length === count,
    "New chat must be persisted",
  );
  return state.sessions[state.currentSessionIndex];
}

async function selectChat(page, width, id) {
  await openSidebar(page, width);
  await page.locator(`[data-rfd-draggable-id="${id}"]`).click();
  await page.locator("#chat-input").waitFor();
  await waitSnapshot(
    page,
    (state) => state.sessions[state.currentSessionIndex]?.id === id,
    "Sidebar must select the requested conversation",
  );
}

async function switchGroup(page, group) {
  await picker(page).click();
  const dialog = page.getByRole("dialog", { name: "选择模型", exact: true });
  await dialog.getByRole("button", { name: "分组", exact: true }).click();
  await dialog
    .getByRole("group", { name: "分组", exact: true })
    .getByRole("button", { name: `${group} · 1x`, exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "分组", exact: true })
    .filter({ hasText: group })
    .waitFor();
  await dialog
    .getByRole("button", {
      name: `${group === "first" ? "gpt-global" : "gpt-beta"} (gpt)`,
      exact: true,
    })
    .waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
}

async function run(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    isMobile: width <= 600,
    hasTouch: width <= 600,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  try {
    const source = await fixture(page);
    await page.goto(`${base}#/chat`, { waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await assertModel(page, "gpt-global");
    await chooseModel(page, "gpt-alpha");
    await waitSnapshot(
      page,
      (state) => state.sessions[0].mask.modelConfig.model === "gpt-alpha",
      "A must remember the chosen model",
    );
    const b = await newChat(page, width, 2);
    assert.equal(b.mask.modelConfig.model, "gpt-alpha");
    assert.equal(b.mask.modelConfig.providerName, "gpt");
    assert.equal(b.mask.syncGlobalConfig, false);
    assert.equal(b.mask.modelConfig.temperature, 0.4);
    assert.deepEqual(b.messages, []);
    assert.deepEqual(b.mask.context, []);
    assert.equal(b.memoryPrompt, "");
    await assertModel(page, "gpt-alpha");
    await chooseModel(page, "gpt-shared");
    await selectChat(page, width, "model-memory-a");
    await assertModel(page, "gpt-alpha");
    await selectChat(page, width, b.id);
    await assertModel(page, "gpt-shared");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await assertModel(page, "gpt-shared");
    await switchGroup(page, "second");
    await assertModel(page, "gpt-shared");
    await selectChat(page, width, "model-memory-a");
    await assertModel(page, "gpt-alpha");
    await page.locator("#chat-input").fill("Unavailable model must not send");
    await page.locator("#chat-input").press("Enter");
    await page
      .getByText("当前密钥没有可用的所选模型，请检查分组或重新选择模型。", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.locator("#chat-input").inputValue(),
      "Unavailable model must not send",
    );
    assert.equal(
      await page.evaluate(() => window.__chatScrollMock.requests.length),
      0,
    );
    await page.locator("#chat-input").fill("");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await assertModel(page, "gpt-alpha");
    await switchGroup(page, "first");
    await assertModel(page, "gpt-alpha");
    await switchGroup(page, "second");
    await assertModel(page, "gpt-beta");
    await selectChat(page, width, b.id);
    await assertModel(page, "gpt-shared");
    await chooseModel(page, "gpt-external", "octopus-custom");
    const c = await newChat(page, width, 3);
    assert.equal(c.mask.modelConfig.model, "gpt-external");
    assert.equal(c.mask.modelConfig.providerName, "octopus-custom");
    await assertModel(page, "gpt-external", true);
    await switchGroup(page, "first");
    await assertModel(page, "gpt-external", true);
    await selectChat(page, width, "model-memory-a");
    await assertModel(page, "gpt-beta");
    await selectChat(page, width, b.id);
    await assertModel(page, "gpt-external", true);
    await selectChat(page, width, c.id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await assertModel(page, "gpt-external", true);
    const state = await snapshot(page);
    assert.equal(
      state.sessions.find((session) => session.id === "model-memory-a").mask
        .modelConfig.model,
      "gpt-beta",
    );
    assert.equal(state.sessions.length, 3);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        passed: true,
        ordinaryNewChatInheritsModelAndProvider: true,
        previousParametersAndMessagesRemainSeparate: true,
        independentSessionsSurviveReload: true,
        unavailableSelectionPreservedAndSendBlocked: true,
        explicitGroupChangeSelectsAvailableModel: true,
        customProviderSurvivesNewChatAndGroupChange: true,
        groupSwitches: source.switches(),
        paidRequests: 0,
      }),
    );
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
