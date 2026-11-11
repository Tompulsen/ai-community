// Delayed local fixtures verify first-load updates without user interaction.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../public/masks.json"), "utf8"),
);

async function verifyStore() {
  const file = path.join(__dirname, "../app/masks/index.ts");
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: file,
  }).outputText;
  const evaluate = (browser) => {
    const result = {};
    let resolveFetch;
    let requests = 0;
    const scope = {
      exports: result,
      require,
      console,
      fetch() {
        requests++;
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      },
      ...(browser ? { window: {} } : {}),
    };
    vm.runInNewContext(source, scope, { filename: file });
    return {
      ...result,
      requests: () => requests,
      finish: () => resolveFetch({ ok: true, json: async () => fixture }),
    };
  };

  const server = evaluate(false);
  await server.loadBuiltinMasks();
  assert.equal(server.requests(), 0, "SSR must not fetch browser resources");
  assert.equal(server.BUILTIN_MASK_STORE.getSnapshot(), false);
  assert.equal(server.BUILTIN_MASK_STORE.getServerSnapshot(), false);

  const browser = evaluate(true);
  const store = browser.BUILTIN_MASK_STORE;
  const originalList = browser.BUILTIN_MASKS;
  const expected = fixture.cn.length + fixture.en.length;
  let notifications = 0;
  let removedNotifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications++;
    assert.equal(browser.BUILTIN_MASKS.length, expected);
    assert.equal(store.getSnapshot(), true);
  });
  const removed = store.subscribe(() => removedNotifications++);
  removed();
  assert.equal(browser.requests(), 0, "Importing masks must not start a request");
  const loading = browser.loadBuiltinMasks();
  assert.strictEqual(browser.loadBuiltinMasks(), loading);
  assert.equal(browser.requests(), 1);
  assert.equal(store.getSnapshot(), store.getSnapshot());
  assert.equal(store.getSnapshot(), false);
  browser.finish();
  await loading;
  assert.equal(notifications, 1, "Publish once after the entire list is ready");
  assert.equal(
    removedNotifications,
    0,
    "Unsubscribed listeners must stay quiet",
  );
  assert.strictEqual(browser.BUILTIN_MASKS, originalList);
  assert.equal(store.getSnapshot(), store.getSnapshot());
  assert.equal(store.getServerSnapshot(), false);
  assert.equal(
    store.get(String(browser.BUILTIN_MASK_ID)),
    browser.BUILTIN_MASKS[0],
    "The existing numeric IDs and lookup API must stay compatible",
  );
  unsubscribe();
  console.log(JSON.stringify({ store: "passed", masks: expected }));
}

async function verifyRoute(browser, route) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  try {
    await prepare(page);
    await page.addInitScript(() => {
      window.__maskLoadingInputs = 0;
      document.addEventListener("input", () => window.__maskLoadingInputs++);
    });
    await page.route("**/masks.json", async (request) => {
      await gate;
      await request.fulfill({ json: fixture });
    });
    await page.goto(base + route, { waitUntil: "domcontentloaded" });
    const deepLink = route.includes("?mask=");
    const rows = route.startsWith("#/masks")
      ? page.locator('[class*="mask-list_"] [role="listitem"]')
      : page.locator('[class*="mask-row_"]');
    await page
      .getByText(
        route.startsWith("#/masks") ? "预设角色面具" : "挑选一个面具",
        { exact: true },
      )
      .waitFor();
    assert.equal(await rows.count(), 0);
    await page.waitForTimeout(1600);
    assert.equal(await rows.count(), 0);
    if (deepLink)
      assert(page.url().includes(route), "Keep the mask command until loaded");
    const response = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/masks.json",
    );
    release();
    assert.equal((await response).status(), 200);
    if (deepLink) {
      await page.waitForURL(/#\/chat$/);
      await page
        .locator('[class*="chat-body-main-title_"]')
        .getByText(fixture.cn[0].name, { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", {
            name: fixture.cn[0].name,
            exact: true,
            includeHidden: true,
          })
          .count(),
        1,
        "Start exactly one chat with the requested built-in mask",
      );
    } else {
      await rows.first().waitFor();
      if (route.startsWith("#/masks"))
        assert.equal(await rows.count(), fixture.cn.length);
      else
        assert(
          (await rows.locator('[class*="mask-name_"]').count()) > 0,
          "Rebuild the new-chat groups when built-ins arrive",
        );
    }
    assert.equal(await page.evaluate(() => window.__maskLoadingInputs), 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        route,
        passed: true,
        delayedMs: 1600,
        inputs: 0,
        ...(deepLink ? {} : { rows: await rows.count() }),
      }),
    );
  } finally {
    release();
    await context.close();
  }
}

(async () => {
  await verifyStore();
  const browser = await chromium.launch({
    channel: process.env.UI_TEST_BROWSER || "msedge",
    headless: true,
  });
  try {
    const routes = process.env.UI_TEST_MASK_ROUTE
      ? [process.env.UI_TEST_MASK_ROUTE]
      : ["#/masks", "#/new-chat", "#/new-chat?mask=100000"];
    for (const route of routes) await verifyRoute(browser, route);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
