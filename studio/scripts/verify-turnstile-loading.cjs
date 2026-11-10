// Isolated account and Turnstile fixtures; no real credentials or captcha calls.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");

const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const sdkUrl =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const loadingText = "正在加载安全验证…";
const retryText = "重新加载安全验证";
const screenshots = [];
const sdkFixture = `(() => {
  const state = window.__turnstileFixture = { renders: [], removed: [] };
  window.turnstile = {
    render(element, options) {
      const id = "fixture-widget-" + (state.renders.length + 1);
      const widget = document.createElement("div");
      widget.dataset.turnstileFixture = id;
      widget.dataset.widgetSize = options.size;
      widget.textContent = "Cloudflare verification fixture";
      widget.style.cssText = "width:" + (options.size === "compact" ? "150px" : "100%") +
        ";height:" + (options.size === "compact" ? 140 : 65) +
        "px;box-sizing:border-box;background:#f5f5f5;display:grid;place-items:center;font:12px sans-serif";
      element.replaceChildren(widget);
      state.renders.push({ id, options });
      window.__turnstileOptions = options;
      return id;
    },
    remove(id) {
      state.removed.push(id);
      document.querySelector('[data-turnstile-fixture="' + id + '"]')?.remove();
    }
  };
})();`;

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

async function fixture(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: options.width || 1440, height: 900 },
    serviceWorkers: "block",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await prepare(page);
  if (options.clock) await page.clock.install();
  const statusGate = deferred();
  const pendingSdk = [];
  const scriptRequests = [];
  let sdkHeld = options.sdkHeld || false;
  if (!options.statusHeld) statusGate.resolve();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (url.href === sdkUrl) {
      scriptRequests.push(url.href);
      if (sdkHeld) {
        const gate = deferred();
        pendingSdk.push(gate);
        const action = await gate.promise;
        if (action === "abort") return route.abort("failed");
      }
      return route.fulfill({
        contentType: "application/javascript",
        body: sdkFixture,
      });
    }
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/new-api/bootstrap")
      return ok({
        config: { newApiEnabled: true },
        session: { authenticated: false, user: null, selectedTokenId: null },
      });
    if (url.pathname === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true } });
    if (url.pathname === "/api/new-api/status") {
      await statusGate.promise;
      return ok({
        enabled: true,
        configured: true,
        passwordLoginEnabled: true,
        publicUrl: "https://accounts.fixture.test",
        turnstileSiteKey: "fixture-site-key",
      });
    }
    if (url.pathname === "/api/new-api/session")
      return ok({
        authenticated: false,
        user: null,
        selectedTokenId: null,
      });
    if (url.pathname === "/api/new-api/login")
      throw new Error("Turnstile fixture must never submit credentials");
    return ok([]);
  });

  return {
    context,
    page,
    scriptRequests,
    releaseStatus: () => statusGate.resolve(),
    releaseSdk(action = "fulfill") {
      sdkHeld = false;
      pendingSdk.splice(0).forEach((gate) => gate.resolve(action));
    },
    async close() {
      statusGate.resolve();
      pendingSdk.splice(0).forEach((gate) => gate.resolve("abort"));
      await context.close();
    },
  };
}

function loading(page) {
  return page.getByRole("status").filter({ hasText: loadingText });
}

function retry(page) {
  return page.getByRole("button", { name: retryText, exact: true });
}

function login(page) {
  return page.getByRole("button", { name: "登录", exact: true });
}

async function loginDisabled(page, disabled, message) {
  await login(page)
    .and(page.locator(disabled ? ":disabled" : ":enabled"))
    .waitFor();
  assert.equal(await login(page).isDisabled(), disabled, message);
}

async function rendered(page, minimum = 1) {
  await page.waitForFunction(
    (count) => window.__turnstileFixture?.renders.length >= count,
    minimum,
  );
}

async function invoke(page, name, value) {
  await page.evaluate(
    ({ name, value }) => {
      const callback = window.__turnstileOptions?.[name];
      if (typeof callback !== "function")
        throw new Error(`Missing Turnstile ${name}`);
      callback(value);
    },
    { name, value },
  );
}

async function fill(page) {
  await page.locator('input[autocomplete="username"]').fill("fixture-user");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("fixture-password");
}

async function screenshot(page, name) {
  const target = path.join(os.tmpdir(), `octopus-turnstile-${name}.png`);
  await page.screenshot({ path: target });
  screenshots.push(target);
}

async function earlyLoadAndReuse(browser) {
  const test = await fixture(browser, { statusHeld: true, sdkHeld: true });
  const { page } = test;
  try {
    const scriptRequested = page.waitForRequest(
      (request) => request.url() === sdkUrl,
    );
    const statusRequested = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/new-api/status",
    );
    await page.goto(`${base}#/account`, { waitUntil: "domcontentloaded" });
    await Promise.all([scriptRequested, statusRequested]);
    assert.equal(
      await page.locator('input[autocomplete="username"]').count(),
      0,
      "SDK request must start before the status-gated form is available",
    );
    test.releaseStatus();
    await fill(page);
    await loading(page).waitFor();
    await loginDisabled(page, true, "pending captcha must block login");
    await screenshot(page, "desktop-loading");
    test.releaseSdk();
    await rendered(page);
    await loading(page).waitFor();
    await invoke(page, "callback", "fixture-valid-token");
    await loading(page).waitFor({ state: "hidden" });
    await loginDisabled(page, false, "valid captcha must permit login");

    const before = await page.evaluate(
      () => window.__turnstileFixture.renders.length,
    );
    await page.evaluate(() => (location.hash = "/chat"));
    await page.locator("#chat-input").waitFor();
    await page.evaluate(() => (location.hash = "/account"));
    await fill(page);
    await rendered(page, before + 1);
    assert.equal(
      test.scriptRequests.length,
      1,
      "returning to account must reuse the loaded SDK",
    );
    assert.equal(
      await page.locator("script[data-octopus-turnstile]").count(),
      1,
    );
    await loginDisabled(page, true, "remount must require a new token");
    console.log(
      "Turnstile: SDK loads in parallel with account status; loading feedback, token gating and SDK reuse passed",
    );
  } finally {
    await test.close();
  }
}

async function loadFailureAndRetry(browser) {
  const test = await fixture(browser, { width: 390, sdkHeld: true });
  const { page } = test;
  try {
    await page.goto(`${base}#/account`, { waitUntil: "domcontentloaded" });
    await fill(page);
    await loading(page).waitFor();
    await screenshot(page, "mobile-loading");
    test.releaseSdk("abort");
    await retry(page).waitFor();
    await loginDisabled(page, true);
    assert.equal(
      await page.locator("script[data-octopus-turnstile]").count(),
      0,
      "failed SDK tag must be removed",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "retry state must fit a phone viewport",
    );
    await screenshot(page, "mobile-failure");
    await retry(page).click();
    await rendered(page);
    await invoke(page, "callback", "fixture-retry-token");
    await loginDisabled(page, false);
    assert.equal(test.scriptRequests.length, 2, "SDK retry must refetch once");
    console.log(
      "Turnstile: SDK failure removes the failed script; mobile feedback and manual retry passed",
    );
  } finally {
    await test.close();
  }
}

async function callbacksAndWatchdog(browser) {
  const test = await fixture(browser, { clock: true });
  const { page } = test;
  try {
    await page.goto(`${base}#/account`, { waitUntil: "domcontentloaded" });
    await fill(page);
    await rendered(page);
    await loading(page).waitFor();
    await page.clock.fastForward(15001);
    await retry(page).waitFor();
    await loginDisabled(page, true);
    await screenshot(page, "desktop-widget-timeout");
    await retry(page).click();
    await rendered(page, 2);
    await invoke(page, "before-interactive-callback");
    await loading(page).waitFor({ state: "hidden" });
    await page.clock.fastForward(15001);
    assert.equal(
      await retry(page).count(),
      0,
      "visible interactive challenge must not trip initialization watchdog",
    );
    await loginDisabled(page, true);
    await invoke(page, "callback", "fixture-interactive-token");
    await loginDisabled(page, false);

    await invoke(page, "expired-callback");
    await retry(page).waitFor();
    await loginDisabled(page, true, "expiry must invalidate the token");
    await retry(page).click();
    await rendered(page, 3);
    await invoke(page, "callback", "fixture-after-expiry-token");
    await loginDisabled(page, false);
    await invoke(page, "error-callback", "300030");
    await retry(page).waitFor();
    await loginDisabled(page, true, "widget error must clear token");
    assert.equal(test.scriptRequests.length, 1, "widget errors retain the SDK");

    await retry(page).click();
    await rendered(page, 4);
    await invoke(page, "callback", "fixture-before-timeout-token");
    await invoke(page, "timeout-callback");
    await retry(page).waitFor();
    await loginDisabled(page, true, "interaction timeout clears token");
    await retry(page).click();
    await rendered(page, 5);
    await invoke(page, "callback", "fixture-final-token");
    await loginDisabled(page, false);
    assert.equal(test.scriptRequests.length, 1);
    console.log(
      "Turnstile: stalled widget watchdog, interactive waiting, expiry, error and timeout recovery passed",
    );
  } finally {
    await test.close();
  }
}

async function sdkTimeout(browser) {
  const test = await fixture(browser, { clock: true, sdkHeld: true });
  const { page } = test;
  try {
    await page.goto(`${base}#/account`, { waitUntil: "domcontentloaded" });
    await fill(page);
    await loading(page).waitFor();
    await page.clock.fastForward(15001);
    await retry(page).waitFor();
    assert.equal(
      await page.locator("script[data-octopus-turnstile]").count(),
      0,
    );
    test.releaseSdk("abort");
    await retry(page).click();
    await rendered(page);
    await invoke(page, "callback", "fixture-sdk-timeout-retry");
    await loginDisabled(page, false);
    assert.equal(test.scriptRequests.length, 2);
    console.log("Turnstile: pending SDK timeout and fresh retry passed");
  } finally {
    await test.close();
  }
}

async function slowSdkHasIndependentWidgetBudget(browser) {
  const test = await fixture(browser, { clock: true, sdkHeld: true });
  const { page } = test;
  try {
    await page.goto(`${base}#/account`, { waitUntil: "domcontentloaded" });
    await fill(page);
    await loading(page).waitFor();
    await page.clock.fastForward(14000);
    test.releaseSdk();
    await rendered(page);
    await page.clock.fastForward(14000);
    assert.equal(
      await retry(page).count(),
      0,
      "slow SDK download must not consume the widget initialization budget",
    );
    await loading(page).waitFor();
    await page.clock.fastForward(1001);
    await retry(page).waitFor();
    await loginDisabled(page, true);
    assert.equal(test.scriptRequests.length, 1);
    console.log(
      "Turnstile: slow SDK download preserves the complete widget timeout budget",
    );
  } finally {
    await test.close();
  }
}

async function compactLoadingHeight(browser) {
  const test = await fixture(browser, { width: 320, sdkHeld: true });
  const { page } = test;
  try {
    await page.goto(`${base}#/account`, { waitUntil: "domcontentloaded" });
    await fill(page);
    await loading(page).waitFor();
    const container = page.locator("form div[aria-busy]");
    const before = await container.boundingBox();
    const buttonBefore = await login(page).boundingBox();
    await screenshot(page, "compact-loading");
    test.releaseSdk();
    await rendered(page);
    await invoke(page, "before-interactive-callback");
    await loading(page).waitFor({ state: "hidden" });
    const after = await container.boundingBox();
    const buttonAfter = await login(page).boundingBox();
    assert.equal(after.height, 140, "compact SDK fixture uses native height");
    assert(
      Math.abs(after.height - before.height) < 1,
      `compact loading height changed from ${before.height} to ${after.height}`,
    );
    assert(
      Math.abs(buttonAfter.y - buttonBefore.y) < 1,
      "compact widget must not shift the login button",
    );
    await screenshot(page, "compact-ready");
    console.log(
      `Turnstile: compact loading and rendered widget keep ${after.height}px height`,
    );
  } finally {
    await test.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const checks = {
      early: earlyLoadAndReuse,
      failure: loadFailureAndRetry,
      watchdog: callbacksAndWatchdog,
      "sdk-timeout": sdkTimeout,
      "slow-sdk": slowSdkHasIndependentWidgetBudget,
      compact: compactLoadingHeight,
    };
    const selected = process.env.TURNSTILE_TEST_CASE;
    if (selected) assert(checks[selected], `Unknown fixture: ${selected}`);
    for (const [name, check] of Object.entries(checks)) {
      if (!selected || selected === name) await check(browser);
    }
    screenshots.forEach((target) => console.log(`Screenshot: ${target}`));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
