// Local fixtures only; model and account requests are intercepted.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";

async function observeOpening(page) {
  await page.evaluate(() => {
    window.selectorMotion = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const panel = document.querySelector('[class*="selector-content"]');
        if (!panel) return;
        observer.disconnect();
        clearTimeout(timeout);
        const samples = [];
        const started = performance.now();
        const sample = () => {
          const marker =
            panel.querySelector(
              '[class*="selector-selection-indicator"][data-selected="true"]',
            ) ||
            [...panel.querySelectorAll('[class*="list-item"] > div')].find(
              (element) => element.style.width === "10px",
            );
          const row = marker?.closest('[class*="list-item"]');
          const list = panel.firstElementChild;
          if (!marker || !row)
            return resolve({ error: "Missing selected marker" });
          const dot = marker.getBoundingClientRect();
          const bounds = panel.getBoundingClientRect();
          samples.push({
            x: dot.x,
            y: dot.y,
            rightOffset: bounds.right - dot.right,
            width: dot.width,
            panelY: bounds.y,
            panelHeight: bounds.height,
            overlayY: panel.parentElement.getBoundingClientRect().y,
            overlayHeight: panel.parentElement.getBoundingClientRect().height,
            scrollY: window.scrollY,
            bodyHeight: document.body.getBoundingClientRect().height,
            bodyScroll: document.body.scrollTop,
            bodyY: document.body.getBoundingClientRect().y,
            transform: getComputedStyle(panel.parentElement).transform,
            scrollTop: list.scrollTop,
            panelAnimation: getComputedStyle(panel).animationName,
            listAnimation: getComputedStyle(list).animationName,
            rowAnimation: getComputedStyle(row).animationName,
          });
          if (performance.now() - started < 450) requestAnimationFrame(sample);
          else resolve({ samples });
        };
        sample();
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        resolve({ error: "Selector did not open" });
      }, 5000);
      observer.observe(document.body, { childList: true, subtree: true });
    });
  });
}

async function run(browser, width, theme, reducedMotion = "no-preference", height = 950, appReduced = false) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion,
  });
  const page = await context.newPage();
  await page.addInitScript(
    ({ theme, appReduced }) => {
      localStorage.setItem("lang", "cn");
      localStorage.setItem(
        "app-config",
        JSON.stringify({
          version: 4.3,
          state: {
            theme,
            colorTheme: "pink",
            reduceMotion: appReduced,
            enableAutoGenerateTitle: false,
            models: [
              {
                name: "gpt-image-2.5-sunburst",
                available: true,
                provider: {
                  id: "gpt",
                  providerName: "gpt",
                  providerType: "custom",
                },
              },
            ],
            modelConfig: {
              model: "gpt-image-2.5-sunburst",
              providerName: "gpt",
              size: "auto",
              resolution: "auto",
              quality: "auto",
            },
          },
        }),
      );
    },
    { theme, appReduced },
  );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { newApiEnabled: false, needCode: false, hasModelApiKey: true },
      });
    if (url.pathname === "/api/new-api/status")
      return route.fulfill({
        json: { success: true, data: { enabled: false } },
      });
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({
        json: { data: [{ id: "gpt-image-2.5-sunburst" }] },
      });
    return route.continue();
  });
  try {
    await page.goto(base + "#/chat");
    await page.waitForFunction(
      (theme) =>
        document.body.classList.contains(theme) &&
        document.body.classList.contains("theme-pink"),
      theme,
    );
    await page.getByRole("button", { name: "生图参数", exact: true }).click();
    const controls = page.locator('[class*="image-params-panel"]');
    const cases = [
      ["比例", "16:9"],
      ["比例", "9:16"],
      ["比例", "21:9"],
      ["分辨率", "2K"],
      ["画质", "high"],
      ["输出格式", "WebP"],
      ["背景", "不透明"],
    ];
    const results = [];
    for (const [label, choice] of cases) {
      await observeOpening(page);
      await controls
        .getByRole("button", { name: new RegExp(`^${label}`) })
        .click();
      const result = await page.evaluate(() => window.selectorMotion);
      assert(!result.error, result.error);
      assert(result.samples.length >= 2);
      if (reducedMotion === "reduce" || appReduced)
        assert(result.samples.every((sample) => sample.panelAnimation === "none"));
      const range = (key) => {
        const values = result.samples.map((sample) => sample[key]);
        return Math.max(...values) - Math.min(...values);
      };
      const drift = {
        label,
        x: range("x"),
        y: range("y"),
        rightOffset: range("rightOffset"),
        diameter: range("width"),
      };
      results.push(drift);
      assert(drift.rightOffset < 0.5, JSON.stringify(drift));
      assert(drift.diameter < 0.5, JSON.stringify(drift));
      assert(drift.x < 0.5 && drift.y < 0.5, JSON.stringify({
        drift, first: result.samples[0], last: result.samples.at(-1),
      }));
      assert(
        result.samples.every(
          (sample) =>
            sample.listAnimation === "none" && sample.rowAnimation === "none",
        ),
      );
      const selector = page.locator('[class*="selector-content"]');
      if (width <= 600) {
        const box = await selector.boundingBox();
        assert(box.x >= 15 && box.x + box.width <= width - 15);
        assert(Math.abs(box.y + box.height / 2 - height / 2) < 1);
        assert(box.y >= 15 && box.y + box.height <= height - 15);
      }
      const rows = selector.locator(
        ':scope > [class*="list"] > [class*="list-item"]',
      );
      assert.equal(
        await selector
          .locator('[class*="selector-selection-indicator"]')
          .count(),
        await rows.count(),
      );
      assert.equal(await selector.locator('[data-selected="true"]').count(), 1);
      if (results.length === 1)
        await page.screenshot({
          path: path.join(
            os.tmpdir(),
            `octopus-selector-open-${width}-${theme}-${reducedMotion}.png`,
          ),
        });
      await selector.getByText(choice, { exact: true }).click();
      await selector.waitFor({ state: "detached" });
    }
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-selector-stable-${width}-${theme}-${reducedMotion}.png`,
      ),
    });
    console.log(
      JSON.stringify({
        width,
        theme,
        reducedMotion,
        results,
        result: "passed",
      }),
    );
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    if (!process.env.SHORT_ONLY) {
      for (const width of [1440, 390])
        for (const theme of ["light", "dark"]) await run(browser, width, theme);
      await run(browser, 390, "light", "reduce");
      await run(browser, 390, "light", "no-preference", 950, true);
      await run(browser, 320, "light", "no-preference", 568);
    }
    await run(browser, 568, "dark", "no-preference", 320);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
