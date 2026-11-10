// Cold browser contexts, controlled latency, and fixture-only account/model APIs.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const latency = Number(process.env.STARTUP_LATENCY_MS || 350);
const optimized = process.env.STARTUP_OPTIMIZED === "1";

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
      });
      const errors = [];
      let identityConfirmed = false;
      let bootstrapCalls = 0;
      let bootstrapScripts = 0;
      let promptCalls = 0;
      let earlyPrompts = 0;
      await context.addInitScript(() => {
        localStorage.setItem("lang", "cn");
        window.__startupAudit = { input: 0 };
        const observer = new MutationObserver(() => {
          const input = document.querySelector("#chat-input");
          if (input?.getBoundingClientRect().height > 0) {
            window.__startupAudit.input = performance.now();
            observer.disconnect();
          }
        });
        observer.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      });
      await context.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.origin !== new URL(base).origin) return route.abort();
        if (url.pathname === "/workspace-bootstrap.v1.js") bootstrapScripts++;
        if (url.pathname.startsWith("/api/")) {
          assert.equal(
            request.method(),
            "GET",
            "No model generation or account writes",
          );
          const ok = (data) => route.fulfill({ json: { success: true, data } });
          if (url.pathname.endsWith("/bootstrap")) {
            bootstrapCalls++;
            await new Promise((resolve) => setTimeout(resolve, latency));
            identityConfirmed = true;
            return route.fulfill({
              headers: { "cache-control": "private, no-store" },
              json: {
                success: true,
                data: {
                  config: { newApiEnabled: true },
                  session: {
                    authenticated: false,
                    user: null,
                    selectedTokenId: null,
                  },
                },
              },
            });
          }
          if (url.pathname.endsWith("/status"))
            return ok({ enabled: true, configured: true });
          if (url.pathname === "/api/config")
            return route.fulfill({ json: { newApiEnabled: true } });
          if (url.pathname.endsWith("/models"))
            return route.fulfill({ json: { data: [] } });
          return ok([]);
        }
        if (url.pathname.endsWith("/prompts.json")) {
          promptCalls++;
          if (!identityConfirmed) earlyPrompts++;
          return route.fulfill({
            json: { cn: [["预览测试", "仅供本地验证"]] },
          });
        }
        if (url.pathname !== "/")
          await new Promise((resolve) => setTimeout(resolve, latency));
        return route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base, { waitUntil: "load" });
      const input = page.locator("#chat-input");
      await input.waitFor({ state: "visible", timeout: 30000 });
      await page.waitForTimeout(2200);
      await input.pressSequentially("startup input check", { delay: 15 });
      assert.equal(await input.inputValue(), "startup input check");
      const metrics = await page.evaluate(() => {
        const resources = performance.getEntriesByType("resource");
        const bootstrap = resources.find((entry) =>
          entry.name.includes("/api/new-api/bootstrap"),
        );
        return {
          ...window.__startupAudit,
          bootstrapStart: bootstrap?.startTime,
          bootstrapEnd: bootstrap?.responseEnd,
          bootstrapPriority: document.querySelector(
            'link[rel="preload"][href*="workspace-bootstrap.v1.js"]',
          )?.fetchPriority,
          inlineBootstrap:
            document.querySelector(
              'script#workspace-bootstrap[type="module"][async]:not([src])',
            ) !== null,
        };
      });
      assert.equal(
        bootstrapCalls,
        1,
        "Startup must reuse the early identity response",
      );
      assert.equal(promptCalls, 1);
      assert.equal(
        bootstrapScripts + Number(metrics.inlineBootstrap),
        1,
        "The page must deliver the bootstrap once",
      );
      assert.deepEqual(errors, []);
      if (optimized) {
        assert.equal(earlyPrompts, 0);
        assert.equal(metrics.inlineBootstrap, true);
        assert.equal(
          bootstrapScripts,
          0,
          "Inline bootstrap needs no script fetch",
        );
      }
      console.log(
        JSON.stringify({
          width,
          latency,
          ...metrics,
          bootstrapCalls,
          earlyPrompts,
          errors,
        }),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
