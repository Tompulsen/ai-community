// Run against a local development server; every account API is mocked.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";

const labels = {
  username: "\u7528\u6237\u540d",
  password: "\u5bc6\u7801",
  login: "\u767b\u5f55",
  logout: "\u9000\u51fa\u767b\u5f55",
  code: "\u4e24\u6b65\u9a8c\u8bc1\u4ee3\u7801\u6216\u6062\u590d\u7801",
  create: "\u521b\u5efa\u5bc6\u94a5",
  edit: "\u7f16\u8f91\u5bc6\u94a5",
  name: "\u5bc6\u94a5\u540d\u79f0",
  group: "\u5206\u7ec4",
  remaining: "\u5269\u4f59\u989d\u5ea6",
  unlimited: "\u4e0d\u9650\u5bc6\u94a5\u989d\u5ea6",
  expiry: "\u6709\u6548\u671f",
  models: "\u9650\u5236\u53ef\u7528\u6a21\u578b",
  allowedModels: "\u5141\u8bb8\u7684\u6a21\u578b",
  save: "\u4fdd\u5b58",
  use: "\u7528\u4e8e\u804a\u5929",
  selected: "\u804a\u5929\u4f7f\u7528\u4e2d",
  more: "更多密钥操作",
  startChat: "开始聊天",
  disable: "\u505c\u7528\u5bc6\u94a5",
  enable: "\u542f\u7528\u5bc6\u94a5",
  remove: "\u5220\u9664\u5bc6\u94a5",
  confirm: "\u786e\u8ba4",
  next: "\u4e0b\u4e00\u9875",
  previous: "\u4e0a\u4e00\u9875",
  challenge: "\u91cd\u65b0\u52a0\u8f7d\u5b89\u5168\u9a8c\u8bc1",
  refreshTokens: "\u5237\u65b0\u5bc6\u94a5\u5217\u8868",
  inherit: "\u8ddf\u968f\u8d26\u53f7",
  auto: "Auto \u7cfb\u7edf",
  single: "\u5355\u5206\u7ec4",
  multi: "\u81ea\u5b9a\u4e49\u7ec4\u5408",
  searchGroups: "\u641c\u7d22\u53ef\u7528\u5206\u7ec4",
  backendGroups: "\u4f7f\u7528\u540e\u53f0\u9ed8\u8ba4\u5206\u7ec4\u5217\u8868",
  up: "\u4e0a\u79fb",
  down: "\u4e0b\u79fb",
  namePlaceholder:
    "\u804a\u5929\u4e13\u7528 / Cursor / \u4e2a\u4eba\u6d4b\u8bd5",
  systemDefault: "\u7cfb\u7edf",
  systemDefaultHint:
    "\u4f7f\u7528\u7ae0\u9c7c\u540e\u53f0\u7684\u81ea\u52a8\u5206\u7ec4\u5217\u8868\uff0c\u540e\u53f0\u8c03\u6574\u540e\u540c\u6b65\u751f\u6548\u3002",
};

const premiumName = ("Premium " + "Model Group ".repeat(10)).trim();

function fixtureToken(id, changes = {}) {
  return {
    id,
    name: `Chat Key ${id}`,
    status: 1,
    created_time: 1780000000,
    accessed_time: 1780000000,
    expired_time: -1,
    remain_quota: 500000,
    used_quota: 125000,
    unlimited_quota: false,
    model_limits_enabled: false,
    model_limits: "",
    group: "default",
    allow_ips: "203.0.113.8",
    cross_group_retry: true,
    auto_groups: ["default", "premium"],
    ...changes,
  };
}

function createState(challenge = false) {
  return {
    authenticated: false,
    userId: 7,
    username: "demo",
    selectedTokenId: null,
    challenge,
    edits: [],
    creates: [],
    selects: [],
    groups: [
      {
        id: "default",
        name: "Default",
        ratio: 1,
        description: "Standard models",
      },
      {
        id: "premium",
        name: premiumName,
        ratio: 2,
        description: "Premium model group",
      },
      {
        id: "auto",
        name: "Auto",
        ratio: "auto",
        description: "Ordered account groups",
      },
    ],
    autoGroups: {
      supported: true,
      defaultGroups: ["default", "premium"],
      maxCount: 10,
    },
    tokens: Array.from({ length: 12 }, (_, index) =>
      fixtureToken(index + 1, {
        status: index === 2 ? 2 : 1,
        expired_time: index === 1 ? 1 : -1,
        remain_quota: index === 3 ? 0 : 500000,
      }),
    ),
  };
}

function session(state) {
  return {
    authenticated: state.authenticated,
    selectedTokenId: state.selectedTokenId,
    user: state.authenticated
      ? {
          id: state.userId,
          username: state.username,
          display_name: state.userId === 7 ? "Octopus Demo" : "Second Account",
          quota: 6250000,
          used_quota: 1250000,
          request_count: 42,
          group: "default",
        }
      : null,
  };
}

async function mockApis(page, state) {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.abort(),
  );
  await page.route("**/google-fonts/**", (route) => route.abort());
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.replace("/api/new-api/", "");
    const method = request.method();
    const body = request.postDataJSON();
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    const fail = (message, status = 400) =>
      route.fulfill({ status, json: { success: false, message } });
    if (!url.pathname.startsWith("/api/new-api/")) {
      return route.fulfill({
        json: {
          newApiEnabled: true,
          data: [],
          enabled: false,
          needCode: false,
        },
      });
    }
    if (state.accountWrites && !["GET", "HEAD"].includes(method)) {
      state.accountWrites.push({ endpoint, method, body });
    }
    if (endpoint === "status") {
      return ok({
        enabled: true,
        configured: true,
        publicUrl: "https://newapi.example",
        passwordLoginEnabled: true,
        turnstileSiteKey: state.challenge ? "test-site-key" : "",
        quotaPerUnit: 500000,
        currencySymbol: "$",
      });
    }
    if (endpoint === "session") return ok(session(state));
    if (endpoint === "login") {
      if (body.password !== "correct-password") {
        return fail("Incorrect username or password", 401);
      }
      return ok({ requires2fa: true });
    }
    if (endpoint === "login-2fa") {
      if (body.code !== "123456")
        return fail("Incorrect verification code", 401);
      state.authenticated = true;
      return ok(session(state));
    }
    const expectedUser = request.headers()["x-new-api-user"];
    if (
      state.authenticated &&
      expectedUser &&
      Number(expectedUser) !== state.userId
    ) {
      state.identityRejections = (state.identityRejections || 0) + 1;
      return fail("Account changed. Refresh and try again.", 409);
    }
    if (endpoint === "logout") {
      state.authenticated = false;
      state.selectedTokenId = null;
      return ok(null);
    }
    if (!state.authenticated) return fail("Sign in first", 401);
    if (endpoint === "groups") {
      return ok(
        state.groups.map((group) => ({
          ...group,
          ...(state.userId !== 7 && group.id === "default"
            ? { name: "Account B Group" }
            : {}),
        })),
      );
    }
    if (endpoint === "auto-groups") return ok(state.autoGroups);
    if (endpoint === "tokens" && method === "POST") {
      if (state.failCreate) return fail("Fixture create failed", 503);
      state.creates.push(body);
      state.tokens.unshift(
        fixtureToken(100 + state.creates.length, {
          allow_ips: "",
          cross_group_retry: false,
          auto_groups: [],
          ...body,
        }),
      );
      return ok(null);
    }
    if (endpoint === "tokens") {
      const current = Number(url.searchParams.get("page"));
      const size = Number(url.searchParams.get("size"));
      const result = {
        items: state.tokens
          .slice((current - 1) * size, current * size)
          .map((token) => ({ ...token })),
        total: state.tokens.length,
        page: current,
        size,
      };
      if (state.delayTokens && Number(expectedUser) === 7) {
        const delay = state.delayTokens;
        state.delayTokens = null;
        delay.started();
        await delay.wait;
        await ok(result);
        delay.finished();
        return;
      }
      return ok(result);
    }
    if (endpoint === "logs") {
      const current = Number(url.searchParams.get("page"));
      const size = Number(url.searchParams.get("size"));
      return ok({
        items: Array.from({ length: current === 1 ? 10 : 2 }, (_, index) => ({
          id: (current - 1) * 10 + index + 1,
          created_at: 1780000000,
          model_name: "gpt-example-model-with-a-long-name",
          token_name: state.userId === 7 ? "Chat Key 1" : "Account B Key 1",
          prompt_tokens: 123456,
          completion_tokens: 500,
          quota: 250000,
          type: 2,
          content: "",
        })),
        total: 12,
        page: current,
        size,
      });
    }
    const tokenMatch = endpoint.match(/^tokens\/(\d+)(\/select)?$/);
    if (tokenMatch) {
      const id = Number(tokenMatch[1]);
      const token = state.tokens.find((token) => token.id === id);
      assert(token, "mock token must exist");
      if (tokenMatch[2]) {
        state.selects.push(id);
        state.selectedTokenId = id;
        return ok({ selectedTokenId: id });
      }
      if (method === "PUT") {
        state.edits.push(body);
        Object.assign(token, body);
      } else if (method === "PATCH") {
        token.status = body.status;
        if (state.selectedTokenId === id && token.status !== 1) {
          state.selectedTokenId = null;
        }
      } else if (method === "DELETE") {
        state.tokens = state.tokens.filter((token) => token.id !== id);
        if (state.selectedTokenId === id) state.selectedTokenId = null;
      }
      return ok(null);
    }
    return fail(`Unmocked account route: ${endpoint}`, 404);
  });
}

async function checkOverflow(page, description) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const page = document.querySelector('[class*="account_body"]');
    const fields = [
      ...document.querySelectorAll(
        ".modal-mask input, .modal-mask select, .modal-mask textarea",
      ),
    ];
    return {
      page: root.scrollWidth <= root.clientWidth + 1,
      body: !page || page.scrollWidth <= page.clientWidth + 1,
      fields: fields.every((field) => {
        const rect = field.getBoundingClientRect();
        const parent = (
          field.closest("label") || field.parentElement
        ).getBoundingClientRect();
        return (
          rect.width === 0 ||
          (rect.left >= parent.left - 1 && rect.right <= parent.right + 1)
        );
      }),
    };
  });
  assert(
    result.page && result.body && result.fields,
    `${description}: ${JSON.stringify(result)}`,
  );
}

async function runFlow(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const state = createState();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("lang", "cn"));
  await mockApis(page, state);
  await page.goto(`${base}#/account`);
  await page.getByLabel(labels.username, { exact: true }).fill("demo");
  await page.getByLabel(labels.password, { exact: true }).fill("bad-password");
  await page.getByRole("button", { name: labels.login, exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Incorrect username" })
    .waitFor();
  await page.screenshot({
    path: path.join(os.tmpdir(), `octopus-account-login-${width}.png`),
  });
  await page
    .getByLabel(labels.password, { exact: true })
    .fill("correct-password");
  await page.getByRole("button", { name: labels.login, exact: true }).click();
  await page.getByLabel(labels.code, { exact: true }).fill("000000");
  await page.getByRole("button", { name: labels.login, exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Incorrect verification" })
    .waitFor();
  await page.getByLabel(labels.code, { exact: true }).fill("123456");
  await page.getByRole("button", { name: labels.login, exact: true }).click();
  await page
    .getByRole("button", { name: labels.logout, exact: true })
    .waitFor();
  await page.getByText("$12.5", { exact: true }).waitFor();
  assert.equal(await page.locator("article").count(), 10);
  assert(
    await page
      .locator("article")
      .filter({ hasText: /^Chat Key 2\b/ })
      .getByRole("button", { name: labels.use, exact: true })
      .isDisabled(),
  );
  assert(
    await page
      .locator("article")
      .filter({ hasText: /^Chat Key 4\b/ })
      .getByRole("button", { name: labels.use, exact: true })
      .isDisabled(),
  );

  const firstKey = page.locator("article").filter({ hasText: /^Chat Key 1\b/ });
  await firstKey
    .getByRole("button", { name: labels.edit, exact: true })
    .click();
  const modal = page.locator(".modal-mask").last();
  await modal.getByLabel(labels.name, { exact: true }).fill("Updated Key");
  await modal.getByRole("spinbutton").fill("123456.125");
  await modal.getByLabel(labels.models, { exact: true }).check();
  await modal
    .getByLabel(labels.allowedModels, { exact: true })
    .fill("gpt-example,gpt-example\nimage-example");
  await modal.getByLabel(labels.group, { exact: true }).selectOption("premium");
  await checkOverflow(page, `${width} editor`);
  await page.screenshot({
    path: path.join(os.tmpdir(), `octopus-account-editor-${width}.png`),
  });
  await modal.getByRole("button", { name: labels.save, exact: true }).click();
  await modal.waitFor({ state: "detached" });
  assert.equal(state.edits[0].remain_quota, 61728062500);
  assert.equal(state.edits[0].model_limits, "gpt-example,image-example");
  assert.equal(state.edits[0].allow_ips, "203.0.113.8");
  assert.equal(state.edits[0].cross_group_retry, true);
  assert.deepEqual(state.edits[0].auto_groups, ["default", "premium"]);
  assert.equal(state.edits[0].expired_time, -1);

  const updated = page.locator("article").filter({ hasText: "Updated Key" });
  await updated.getByRole("button", { name: labels.use, exact: true }).click();
  await updated.getByText(labels.selected, { exact: true }).waitFor();
  assert.equal(state.selectedTokenId, 1);
  assert.equal(
    await updated.getByText(labels.selected, { exact: true }).count(),
    1,
  );
  await updated.getByRole("button", { name: labels.more, exact: true }).click();
  await updated
    .getByRole("button", { name: labels.disable, exact: true })
    .click();
  await updated.getByRole("button", { name: labels.more, exact: true }).click();
  await updated
    .getByRole("button", { name: labels.enable, exact: true })
    .waitFor();
  assert.equal(state.selectedTokenId, null);
  await updated
    .getByRole("button", { name: labels.enable, exact: true })
    .click();
  await updated.getByRole("button", { name: labels.more, exact: true }).click();
  await updated
    .getByRole("button", { name: labels.disable, exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await updated.locator("details").getAttribute("open"), null);

  await page
    .getByRole("button", { name: labels.next, exact: true })
    .first()
    .click();
  await page.getByText("Chat Key 12", { exact: true }).waitFor();
  assert.equal(await page.locator("article").count(), 2);
  await page
    .getByRole("button", { name: labels.previous, exact: true })
    .first()
    .click();
  await page.getByText("Updated Key", { exact: true }).waitFor();

  await page.getByRole("button", { name: labels.create, exact: true }).click();
  const create = page.locator(".modal-mask").last();
  const name = create.getByLabel(labels.name, { exact: true });
  assert.equal(await name.inputValue(), "");
  assert.equal(await name.getAttribute("placeholder"), labels.namePlaceholder);
  await create.getByRole("button", { name: labels.save, exact: true }).click();
  assert(await name.evaluate((input) => input.validity.valueMissing));
  assert.equal(
    state.creates.length,
    0,
    "a placeholder must not become the submitted name",
  );
  assert(
    await create
      .getByRole("radio", { name: labels.auto, exact: true })
      .isChecked(),
  );
  await create.getByLabel(labels.name, { exact: true }).fill("New Chat Key");
  assert.equal(
    await create.getByLabel(labels.unlimited, { exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await create.getByLabel(labels.expiry, { exact: true }).inputValue(),
    "never",
  );
  const beforeCreateSelects = [...state.selects];
  await create.getByRole("button", { name: labels.save, exact: true }).click();
  await create.waitFor({ state: "detached" });
  assert.equal(state.creates[0].unlimited_quota, true);
  assert.equal(state.creates[0].expired_time, -1);
  assert.equal(state.creates[0].group, "auto");
  assert.deepEqual(state.creates[0].auto_groups, []);
  assert.equal(Boolean(state.creates[0].cross_group_retry), false);
  assert.deepEqual(
    state.selects,
    beforeCreateSelects,
    "manual creation must not guess or select a token ID",
  );
  const created = page.locator("article").filter({ hasText: "New Chat Key" });
  await created.getByRole("button", { name: labels.more, exact: true }).click();
  await created
    .getByRole("button", { name: labels.remove, exact: true })
    .click();
  await page
    .locator(".modal-mask")
    .last()
    .getByRole("button", {
      name: labels.confirm,
      exact: true,
    })
    .click();
  await created.waitFor({ state: "detached" });
  assert.equal(state.tokens.length, 12);

  await page
    .getByRole("button", { name: labels.next, exact: true })
    .last()
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("tbody tr").length === 2,
  );
  await checkOverflow(page, `${width} account`);
  await page
    .locator('[class*="account_body"]')
    .evaluate((element) => (element.scrollTop = 0));
  await page.screenshot({
    path: path.join(os.tmpdir(), `octopus-account-${width}.png`),
  });
  await page.getByRole("button", { name: labels.logout, exact: true }).click();
  await page.getByLabel(labels.password, { exact: true }).waitFor();
  assert.equal(await page.locator("article").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    `${width}: login errors, 2FA, balance, quota conversion, preserved restrictions, select/disable, CRUD, pagination, logout, and overflow passed`,
  );
  await context.close();
}

async function accountFixture(browser, width, state) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((theme) => {
    localStorage.setItem("lang", "cn");
    localStorage.setItem(
      "app-config",
      JSON.stringify({
        version: 4.4,
        state: { theme, colorTheme: "violet", models: [] },
      }),
    );
  }, state.theme || "light");
  await mockApis(page, state);
  await page.goto(`${base}#/account`);
  await page
    .getByRole("button", { name: labels.logout, exact: true })
    .waitFor();
  return { context, page, errors };
}

async function checkLayout(browser, width, theme = "light") {
  const state = createState();
  state.theme = theme;
  state.authenticated = true;
  state.selectedTokenId = 51;
  state.tokens = [
    fixtureToken(51, {
      name: "系统创建",
      group: "auto",
      auto_groups: [],
      unlimited_quota: true,
    }),
    fixtureToken(52, { name: "默认", group: "", unlimited_quota: true }),
  ];
  const { context, page, errors } = await accountFixture(browser, width, state);
  try {
    await page.locator(`body.${theme}`).waitFor();
    const current = page.locator("article").filter({ hasText: "系统创建" });
    await current.getByText(labels.selected, { exact: true }).waitFor();
    assert.equal(
      await page.getByText(labels.selected, { exact: true }).count(),
      1,
    );
    assert.equal(await page.getByText(/^当前聊天密钥/).count(), 0);
    assert.equal(
      await current.getByRole("button", { name: labels.selected }).count(),
      0,
    );
    await current
      .getByRole("button", { name: labels.startChat, exact: true })
      .waitFor();
    assert.equal(
      await current.getByRole("button", { name: labels.remove }).count(),
      0,
    );
    const more = current.getByRole("button", {
      name: labels.more,
      exact: true,
    });
    await more.click();
    await current
      .getByRole("button", { name: labels.remove, exact: true })
      .waitFor();
    await checkOverflow(page, `${width} action menu`);
    await page.keyboard.press("Escape");
    assert(await more.evaluate((el) => el === document.activeElement));
    assert.equal(await current.locator("details").getAttribute("open"), null);
    await more.click();
    await page.getByRole("heading", { name: "我的 API 密钥" }).click();
    assert.equal(await current.locator("details").getAttribute("open"), null);
    await checkOverflow(page, `${width} compact account layout`);
    if (width > 1000) {
      const aligned = await page.locator("article").evaluateAll((rows) => {
        const positions = rows.map((row) =>
          [...row.children].map((cell) => cell.getBoundingClientRect().left),
        );
        return positions[0].every(
          (x, index) => Math.abs(x - positions[1][index]) < 1,
        );
      });
      assert(aligned, "All key rows must share column baselines");
    }
    const screenshot = path.join(
      os.tmpdir(),
      `octopus-account-layout-${width}-${theme}.png`,
    );
    await page.screenshot({ path: screenshot });
    await current
      .getByRole("button", { name: labels.startChat, exact: true })
      .click();
    await page.waitForURL("**/#/chat");
    assert.equal(state.selectedTokenId, 51);
    assert.deepEqual(state.creates, []);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        theme,
        compactLayout: true,
        singleSelectedBadge: true,
        menuKeyboard: true,
        noKeyCreation: true,
        screenshot,
      }),
    );
  } finally {
    await context.close();
  }
}

async function openCreateEditor(page, name) {
  await page
    .getByRole("button", { name: labels.create, exact: true })
    .first()
    .click();
  const modal = page.locator(".modal-mask").last();
  await modal.getByLabel(labels.name, { exact: true }).fill(name);
  return modal;
}

async function openSavedEditor(page, name) {
  await page
    .locator("article")
    .filter({ hasText: name })
    .getByRole("button", { name: labels.edit, exact: true })
    .click();
  return page.locator(".modal-mask").last();
}

async function saveEditor(modal) {
  await modal.getByRole("button", { name: labels.save, exact: true }).click();
  await modal.waitFor({ state: "detached" });
}

async function checkGroupModes(browser, width) {
  const state = createState();
  state.authenticated = true;
  state.selectedTokenId = 21;
  state.autoGroups.maxCount = 2;
  state.groups.splice(2, 0, {
    id: "economy",
    name: "Economy",
    ratio: 0.5,
    description: "Lower cost models",
  });
  state.tokens = [
    fixtureToken(21, {
      name: "Inherited saved key",
      group: "",
      auto_groups: [],
      expired_time: Math.floor(Date.now() / 1000) + 86400,
    }),
    fixtureToken(22, {
      name: "Saved auto defaults",
      group: "auto",
      auto_groups: [],
    }),
    fixtureToken(23, {
      name: "Saved auto order",
      group: "auto",
      auto_groups: ["premium", "default"],
    }),
  ];
  const { context, page, errors } = await accountFixture(browser, width, state);
  try {
    const inheritedExpiry = state.tokens[0].expired_time;
    const inherited = await openSavedEditor(page, "Inherited saved key");
    assert(
      await inherited
        .getByRole("radio", { name: labels.inherit, exact: true })
        .isChecked(),
    );
    assert.equal(
      await inherited.getByLabel(labels.unlimited, { exact: true }).isChecked(),
      false,
    );
    assert.equal(
      await inherited.getByLabel(labels.expiry, { exact: true }).inputValue(),
      "keep",
    );
    await inherited
      .getByLabel(labels.name, { exact: true })
      .fill("Renamed inherited key");
    await saveEditor(inherited);
    assert.equal(state.edits[0].group, "");
    assert.equal(state.edits[0].expired_time, inheritedExpiry);
    assert.equal(state.edits[0].unlimited_quota, false);
    assert.equal(state.edits[0].cross_group_retry, true);
    assert.deepEqual(state.edits[0].auto_groups, []);
    assert.equal(state.edits[0].allow_ips, "203.0.113.8");

    const defaultAuto = await openSavedEditor(page, "Saved auto defaults");
    assert(
      await defaultAuto
        .getByRole("radio", { name: labels.auto, exact: true })
        .isChecked(),
    );
    await checkOverflow(page, `${width} Auto system editor`);
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-account-auto-editor-${width}.png`),
      animations: "disabled",
    });
    await defaultAuto
      .getByLabel(labels.name, { exact: true })
      .fill("Renamed auto defaults");
    await saveEditor(defaultAuto);
    assert.equal(state.edits[1].group, "auto");
    assert.deepEqual(state.edits[1].auto_groups, []);
    assert.equal(state.edits[1].cross_group_retry, true);
    assert.equal(state.edits[1].allow_ips, "203.0.113.8");

    const orderedAuto = await openSavedEditor(page, "Saved auto order");
    assert(
      await orderedAuto
        .getByRole("radio", { name: labels.multi, exact: true })
        .isChecked(),
    );
    await orderedAuto
      .getByLabel(labels.name, { exact: true })
      .fill("Renamed auto order");
    await saveEditor(orderedAuto);
    assert.deepEqual(state.edits[2].auto_groups, ["premium", "default"]);
    assert.equal(state.edits[2].cross_group_retry, true);
    assert.equal(state.edits[2].allow_ips, "203.0.113.8");

    const single = await openCreateEditor(page, "Finite single key");
    await single
      .getByRole("radio", { name: labels.single, exact: true })
      .check();
    await single
      .getByLabel(labels.group, { exact: true })
      .selectOption("premium");
    await single.getByLabel(labels.unlimited, { exact: true }).uncheck();
    await single.getByRole("spinbutton").fill("2.5");
    await single.getByLabel(labels.expiry, { exact: true }).selectOption("7");
    await saveEditor(single);
    assert.equal(state.creates[0].group, "premium");
    assert.equal(state.creates[0].unlimited_quota, false);
    assert.equal(state.creates[0].remain_quota, 1250000);
    assert(state.creates[0].expired_time > Date.now() / 1000 + 6 * 86400);
    assert(state.creates[0].expired_time <= Date.now() / 1000 + 7 * 86400);
    assert.deepEqual(state.creates[0].auto_groups, []);
    assert.equal(Boolean(state.creates[0].cross_group_retry), false);

    const multi = await openCreateEditor(page, "Ordered multi key");
    await multi.getByRole("radio", { name: labels.multi, exact: true }).check();
    await multi.getByRole("button", { name: labels.save, exact: true }).click();
    await multi.getByRole("alert").waitFor();
    assert.equal(
      state.creates.length,
      1,
      "empty multi-group selection must not be submitted",
    );
    assert.equal(
      await multi
        .getByRole("checkbox", { name: labels.backendGroups, exact: true })
        .count(),
      0,
    );
    const defaultGroup = multi.getByRole("checkbox", {
      name: "Default",
      exact: true,
    });
    const premiumGroup = multi.getByRole("checkbox", {
      name: premiumName,
      exact: true,
    });
    await defaultGroup.check();
    await multi.getByRole("alert").waitFor({ state: "hidden" });
    const search = multi.getByRole("searchbox", {
      name: labels.searchGroups,
      exact: true,
    });
    await search.fill("premium");
    assert(
      await defaultGroup.isChecked(),
      "search must retain already selected groups",
    );
    assert.equal(
      await multi
        .getByRole("checkbox", { name: "Economy", exact: true })
        .count(),
      0,
    );
    await premiumGroup.check();
    await search.fill("");
    assert(await defaultGroup.isChecked());
    assert(await premiumGroup.isChecked());
    assert(
      await multi
        .getByRole("checkbox", { name: "Economy", exact: true })
        .isDisabled(),
    );
    await multi
      .getByRole("button", { name: `${labels.up} ${premiumName}`, exact: true })
      .click();
    await multi
      .getByRole("button", {
        name: `${labels.down} ${premiumName}`,
        exact: true,
      })
      .click();
    await multi
      .getByRole("button", { name: `${labels.up} ${premiumName}`, exact: true })
      .click();
    await checkOverflow(page, `${width} multi-group editor`);
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-account-multi-${width}.png`),
    });
    await saveEditor(multi);
    assert.equal(state.creates[1].group, "auto");
    assert.deepEqual(state.creates[1].auto_groups, ["premium", "default"]);
    assert.equal(state.creates[1].cross_group_retry, false);
    assert.equal(state.creates[1].unlimited_quota, true);
    assert.equal(state.creates[1].expired_time, -1);
    assert.equal(
      state.selectedTokenId,
      21,
      "manual creation must retain the current selected key",
    );
    assert.deepEqual(state.selects, []);
    assert.equal(
      await page
        .getByRole("button", {
          name: /\u521b\u5efa\u5206\u7ec4|\u65b0\u5efa\u5206\u7ec4/,
        })
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      `${width}: inherit/single/multi payloads, finite seven-day key, empty-group validation, search, ordered groups, cap, and saved restrictions passed`,
    );
  } finally {
    await context.close();
  }
}

async function checkDefaultLabel(browser, width) {
  const state = createState();
  state.authenticated = true;
  state.selectedTokenId = 53;
  state.accountWrites = [];
  state.tokens = [
    fixtureToken(51, { name: "My saved inherited key", group: "" }),
    fixtureToken(52, { name: "Another inherited key", group: "" }),
    fixtureToken(53, { name: "Explicit default group key", group: "default" }),
    fixtureToken(54, { name: "My ordered group key", group: "auto" }),
    fixtureToken(55, {
      name: "Global Auto key",
      group: "auto",
      auto_groups: [],
    }),
  ];
  const originalTokens = structuredClone(state.tokens);
  const { context, page, errors } = await accountFixture(browser, width, state);
  try {
    await page
      .locator("article")
      .getByText("My ordered group key", { exact: true })
      .waitFor();
    const first = page
      .locator("article")
      .filter({ hasText: "My saved inherited key" });
    const explicit = page
      .locator("article")
      .filter({ hasText: "Explicit default group key" });
    const titleArea = (token) => token.locator('[class*="token-name"]');
    for (const token of state.tokens) {
      const card = page.locator("article").filter({ hasText: token.name });
      const title = titleArea(card);
      assert.equal(
        await title.locator(":scope > span").first().textContent(),
        token.name,
      );
      assert.equal(
        await card.getByText(labels.systemDefault, { exact: true }).count(),
        token.group === "auto" && !token.auto_groups.length ? 1 : 0,
      );
      assert.equal(
        await card
          .getByTitle(labels.systemDefaultHint, { exact: true })
          .count(),
        token.group === "auto" && !token.auto_groups.length ? 1 : 0,
      );
    }
    assert.equal(
      await page.getByText(labels.systemDefault, { exact: true }).count(),
      1,
    );
    assert.equal(
      await titleArea(explicit)
        .getByText(labels.selected, { exact: true })
        .count(),
      1,
    );
    assert.equal(
      await titleArea(first)
        .getByText(labels.selected, { exact: true })
        .count(),
      0,
    );
    assert.deepEqual(
      state.accountWrites,
      [],
      "rendering default labels must not write account APIs",
    );
    assert.deepEqual(
      state.tokens,
      originalTokens,
      "default labels must preserve saved keys and their names",
    );
    await first.getByRole("button", { name: labels.use, exact: true }).click();
    await first.getByText(labels.selected, { exact: true }).waitFor();
    assert.equal(state.selectedTokenId, 51);
    assert.deepEqual(state.selects, [51]);
    assert.equal(state.accountWrites.length, 1);
    assert.equal(state.accountWrites[0].endpoint, "tokens/51/select");
    assert.equal(state.accountWrites[0].method, "POST");
    assert.equal(
      await titleArea(first)
        .getByText(labels.selected, { exact: true })
        .count(),
      1,
    );
    assert.equal(
      await titleArea(explicit)
        .getByText(labels.selected, { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByText(labels.systemDefault, { exact: true }).count(),
      1,
    );
    assert.deepEqual(state.tokens, originalTokens);
    await checkOverflow(page, `${width} system-default badges`);
    await first.scrollIntoViewIfNeeded();
    const screenshot = path.join(
      os.tmpdir(),
      `octopus-account-default-label-${width}.png`,
    );
    await page.screenshot({ path: screenshot });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        badges: 1,
        namesPreserved: true,
        renderingWrites: 0,
        explicitSelection: state.selectedTokenId,
        screenshot,
        result: "passed",
      }),
    );
  } finally {
    await context.close();
  }
}

async function checkSingleToMulti(browser, width) {
  const state = createState();
  state.authenticated = true;
  state.selectedTokenId = 41;
  state.tokens = [
    fixtureToken(41, {
      name: "Legacy single key",
      group: "default",
      cross_group_retry: true,
      auto_groups: [],
      allow_ips: "203.0.113.41",
    }),
  ];
  const { context, page, errors } = await accountFixture(browser, width, state);
  try {
    const modal = await openSavedEditor(page, "Legacy single key");
    assert(
      await modal
        .getByRole("radio", { name: labels.single, exact: true })
        .isChecked(),
    );
    await modal.getByRole("radio", { name: labels.multi, exact: true }).check();
    await modal.getByRole("checkbox", { name: "Default", exact: true }).check();
    await modal
      .getByRole("checkbox", { name: premiumName, exact: true })
      .check();
    await saveEditor(modal);
    assert.equal(state.edits.length, 1);
    assert.equal(state.edits[0].group, "auto");
    assert.deepEqual(state.edits[0].auto_groups, ["default", "premium"]);
    assert.equal(state.edits[0].cross_group_retry, false);
    assert.equal(state.edits[0].allow_ips, "203.0.113.41");
    assert.equal(state.selectedTokenId, 41);
    assert.deepEqual(errors, []);
    console.log(
      `${width}: legacy single-to-multi editing disables cross-group retry and preserves IP restrictions`,
    );
  } finally {
    await context.close();
  }
}

async function checkFirstCreation(browser, width) {
  const state = createState();
  state.authenticated = true;
  state.tokens = [];
  const { context, page, errors } = await accountFixture(browser, width, state);
  try {
    await page
      .getByRole("button", { name: labels.create, exact: true })
      .first()
      .waitFor();
    assert.equal(await page.locator("article").count(), 0);
    assert.deepEqual(
      state.creates,
      [],
      "opening an existing account must not create a key",
    );
    assert.equal(state.selectedTokenId, null);
    await checkOverflow(page, `${width} first-key guidance`);
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-account-first-key-${width}.png`),
    });
    const modal = await openCreateEditor(page, "First chat key");
    state.failCreate = true;
    await modal.getByRole("button", { name: labels.save, exact: true }).click();
    await modal
      .getByRole("alert")
      .filter({ hasText: "Fixture create failed" })
      .waitFor();
    assert.equal(
      await modal.getByLabel(labels.name, { exact: true }).inputValue(),
      "First chat key",
    );
    assert.equal(state.tokens.length, 0);
    state.failCreate = false;
    await saveEditor(modal);
    const token = page.locator("article").filter({ hasText: "First chat key" });
    await token.waitFor();
    assert.equal(state.tokens.length, 1);
    assert.equal(state.creates[0].group, "auto");
    assert.equal(state.creates[0].expired_time, -1);
    assert.equal(state.creates[0].unlimited_quota, true);
    assert.equal(
      state.selectedTokenId,
      null,
      "manual creation must wait for an explicit selection",
    );
    assert.deepEqual(state.selects, []);
    await token.getByRole("button", { name: labels.use, exact: true }).click();
    await token.getByText(labels.selected, { exact: true }).waitFor();
    assert.equal(state.selectedTokenId, 101);
    assert.deepEqual(state.selects, [101]);
    assert.deepEqual(errors, []);
    console.log(
      `${width}: empty-account guidance, no automatic key creation, failed-create recovery, and explicit first-key selection passed`,
    );
  } finally {
    await context.close();
  }
}

async function checkGroupCapabilities(browser) {
  for (const missingPermission of [true, false]) {
    const state = createState();
    state.authenticated = true;
    state.selectedTokenId = 1;
    if (missingPermission)
      state.groups = state.groups.filter((group) => group.id === "default");
    else state.autoGroups.supported = false;
    const { context, page, errors } = await accountFixture(
      browser,
      Number(process.env.UI_TEST_WIDTH || 390),
      state,
    );
    try {
      const modal = await openCreateEditor(page, "Unavailable multi-group key");
      assert.equal(
        await modal
          .getByRole("radio", { name: labels.multi, exact: true })
          .count(),
        0,
      );
      assert.equal(
        await modal
          .getByText(/当前账号未开放多分组|当前章鱼后台暂不支持多分组/)
          .count(),
        0,
      );
      assert.equal(
        await modal.getByText(/由章鱼后台使用账户默认链路处理请求/).count(),
        0,
      );
      await checkOverflow(page, "unavailable multi-group editor");
      await page.waitForTimeout(350);
      await page.screenshot({
        path: path.join(
          os.tmpdir(),
          `octopus-account-capability-${process.env.UI_TEST_WIDTH || 390}.png`,
        ),
      });
      assert(
        await modal
          .getByRole("radio", { name: labels.inherit, exact: true })
          .isChecked(),
      );
      if (missingPermission) {
        await modal
          .getByRole("radio", { name: labels.single, exact: true })
          .check();
        const group = modal.getByLabel(labels.group, { exact: true });
        assert.equal(await group.locator("option").count(), 1);
        assert.equal(await group.inputValue(), "default");
        await saveEditor(modal);
        assert.equal(state.creates[0].group, "default");
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
  console.log(
    "Auto permission and capability gates, plus a single available group, passed",
  );
}

async function checkChallenge(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("lang", "cn"));
  await mockApis(page, createState(true));
  await page.goto(`${base}#/account`);
  await page
    .getByRole("button", { name: labels.challenge, exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: labels.login, exact: true })
      .isDisabled(),
  );
  await page
    .getByRole("button", { name: labels.challenge, exact: true })
    .click();
  await page
    .getByRole("button", { name: labels.challenge, exact: true })
    .waitFor();
  await checkOverflow(page, "challenge failure");
  console.log(
    "Turnstile blocked script: visible failure, retry, and sign-in disabled passed",
  );
  await context.close();
}

function switchToSecondAccount(state) {
  state.userId = 8;
  state.username = "second";
  state.selectedTokenId = null;
  state.tokens = state.tokens.map((token, index) => ({
    ...token,
    id: token.id + 100,
    name: `Account B Key ${index + 1}`,
  }));
}

async function checkAccountSwitch(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const state = createState();
  state.authenticated = true;
  const pageA = await context.newPage();
  await pageA.addInitScript(() => localStorage.setItem("lang", "cn"));
  await mockApis(pageA, state);
  await pageA.goto(`${base}#/account`);
  await pageA
    .locator("article")
    .getByText("Chat Key 1", { exact: true })
    .waitFor();
  let release;
  let started;
  let finished;
  const requestStarted = new Promise((resolve) => (started = resolve));
  const oldResponse = new Promise((resolve) => (finished = resolve));
  state.delayTokens = {
    started,
    finished,
    wait: new Promise((resolve) => (release = resolve)),
  };
  await pageA
    .getByRole("button", { name: labels.refreshTokens, exact: true })
    .click();
  await requestStarted;
  switchToSecondAccount(state);
  const pageB = await context.newPage();
  await pageB.addInitScript(() => localStorage.setItem("lang", "cn"));
  await mockApis(pageB, state);
  await pageB.goto(`${base}#/account`);
  await pageB
    .locator("article")
    .filter({ hasText: /^Account B Key 1\b/ })
    .getByRole("button", { name: labels.use, exact: true })
    .click();
  await pageA
    .getByRole("heading", { name: "Second Account", exact: true })
    .waitFor();
  await pageA
    .locator("article")
    .getByText("Account B Key 1", { exact: true })
    .waitFor();
  release();
  await oldResponse;
  await pageA.waitForTimeout(100);
  assert.equal(await pageA.getByText("Chat Key 1", { exact: true }).count(), 0);
  assert.equal(await pageA.locator("article").count(), 10);
  assert(
    (await pageA.locator("article").allTextContents()).every((text) =>
      text.startsWith("Account B Key"),
    ),
  );
  await pageB.getByRole("button", { name: labels.logout, exact: true }).click();
  await pageA.getByLabel(labels.password, { exact: true }).waitFor();
  assert.equal(await pageA.locator("article").count(), 0);
  console.log(
    "Cross-tab A to B switch and sign-out: identity, keys, and logs refresh; delayed A response discarded",
  );
  await context.close();
}

async function checkIdentityMismatch(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 1000 },
    serviceWorkers: "block",
  });
  const state = createState();
  state.authenticated = true;
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("lang", "cn"));
  await mockApis(page, state);
  await page.goto(`${base}#/account`);
  const oldKey = page.locator("article").filter({ hasText: /^Chat Key 1\b/ });
  await oldKey.waitFor();
  switchToSecondAccount(state);
  await oldKey.getByRole("button", { name: labels.use, exact: true }).click();
  await page
    .getByRole("heading", { name: "Second Account", exact: true })
    .waitFor();
  await page
    .locator("article")
    .getByText("Account B Key 1", { exact: true })
    .waitFor();
  assert(
    state.identityRejections >= 1,
    "stale account must attach its original identity",
  );
  assert.equal(
    state.selectedTokenId,
    null,
    "stale action must not select another account's key",
  );
  console.log(
    "Cookie identity changed before notification: stale key action rejected and account refreshed",
  );
  await context.close();
}

(async () => {
  const browser = await chromium.launch({
    ...(process.env.UI_TEST_BROWSER
      ? { channel: process.env.UI_TEST_BROWSER }
      : {}),
    headless: true,
  });
  try {
    if (process.env.UI_TEST_SCENARIO === "layout") {
      for (const width of [1440, 1100, 768, 390, 320])
        await checkLayout(browser, width);
      for (const width of [1440, 390])
        await checkLayout(browser, width, "dark");
      return;
    }
    if (process.env.UI_TEST_SCENARIO === "group-capabilities") {
      await checkGroupCapabilities(browser);
      return;
    }
    if (process.env.UI_TEST_SCENARIO === "default-label") {
      const widths = process.env.UI_TEST_WIDTH
        ? [Number(process.env.UI_TEST_WIDTH)]
        : [1440, 390];
      for (const width of widths) await checkDefaultLabel(browser, width);
      return;
    }
    if (process.env.UI_TEST_SCENARIO === "single-to-multi") {
      const widths = process.env.UI_TEST_WIDTH
        ? [Number(process.env.UI_TEST_WIDTH)]
        : [1440, 390];
      for (const width of widths) await checkSingleToMulti(browser, width);
      return;
    }
    const groupScenariosOnly = process.env.UI_TEST_SCENARIO === "groups";
    if (process.env.UI_TEST_SCENARIO !== "switch") {
      const widths = process.env.UI_TEST_WIDTH
        ? [Number(process.env.UI_TEST_WIDTH)]
        : [1440, 390];
      for (const width of widths) {
        if (!groupScenariosOnly) await runFlow(browser, width);
        await checkGroupModes(browser, width);
        await checkSingleToMulti(browser, width);
        await checkFirstCreation(browser, width);
      }
      await checkGroupCapabilities(browser);
      if (!groupScenariosOnly) await checkChallenge(browser);
    }
    if (!groupScenariosOnly) {
      await checkAccountSwitch(browser);
      await checkIdentityMismatch(browser);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
