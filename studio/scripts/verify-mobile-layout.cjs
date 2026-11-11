// All remote/model requests are intercepted; fixtures stay in this browser.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";

async function run(browser, width, height, theme, system) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width <= 600,
    hasTouch: width <= 600,
    colorScheme: system,
  });
  await context.addInitScript(({ theme }) => {
    localStorage.setItem("lang", "cn");
    localStorage.setItem("app-config", JSON.stringify({
      version: 4.3,
      state: {
        theme, colorTheme: "violet", models: [],
        dontShowMaskSplashScreen: true,
        enableAutoGenerateTitle: false,
      },
    }));
  }, { theme });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === "/api/config")
      return route.fulfill({ json: {
        newApiEnabled: false, needCode: false, hasModelApiKey: true,
      } });
    if (url.pathname === "/api/new-api/status")
      return route.fulfill({ json: { success: true, data: { enabled: false } } });
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({ json: { data: [] } });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const effective = theme === "auto" ? system : theme;
  try {
    await page.goto(base + "#/chat");
    await page.waitForFunction((effective) =>
      document.body.classList.contains(effective) &&
      document.querySelector("textarea"), effective);
    const palette = () => page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {
        dark: document.body.classList.contains("dark"),
        second: style.getPropertyValue("--second").trim(),
        scheme: style.colorScheme,
      };
    });
    assert.equal((await palette()).second,
      effective === "dark" ? "#1e1633" : "#ede9fe");
    if (theme === "auto") {
      const opposite = system === "dark" ? "light" : "dark";
      await page.emulateMedia({ colorScheme: opposite });
      await page.waitForFunction((opposite) =>
        document.body.classList.contains(opposite), opposite);
      assert.equal((await palette()).second,
        opposite === "dark" ? "#1e1633" : "#ede9fe");
      await page.emulateMedia({ colorScheme: system });
      await page.waitForFunction((system) =>
        document.body.classList.contains(system), system);
    }
    if (width <= 600) {
      const sidebar = page.locator('[class*="sidebar-show"]');
      await page.getByRole("button", { name: "查看消息列表" }).click();
      await sidebar.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const box = document.querySelector('[class*="sidebar-show"]')
          ?.getBoundingClientRect();
        return box && Math.abs(box.x) < 1;
      });
      const box = await sidebar.boundingBox();
      assert(Math.abs(box.width - width) < 1, JSON.stringify(box));
      assert(Math.abs(box.height - height) < 1, JSON.stringify(box));
      await page.screenshot({ path: path.join(os.tmpdir(),
        `octopus-mobile-home-${width}-${height}-${theme}-${system}.png`) });
      await sidebar.getByRole("button", { name: "发现", exact: true }).click();
      const discovery = page.locator('[class*="selector-content"]');
      await discovery.waitFor();
      await discovery.locator('[class*="list-item"]').first().click({ trial: true });
      assert(await discovery.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(
          box.x + box.width / 2, box.y + box.height / 2));
      }), "Sidebar covers discovery selector");
      await page.locator('[class*="selector_"]').click({ position: { x: 4, y: 4 } });
      await discovery.waitFor({ state: "detached" });
      await sidebar.getByRole("button", { name: "新的聊天", exact: true }).click();
      await page.waitForURL("**/#/chat");
      assert.equal(await sidebar.count(), 0);
      await page.locator("textarea").fill("mobile composer");
      await page.locator("textarea").clear();
    }
    const routeResults = [];
    for (const route of ["/chat", "/settings", "/account", "/gallery", "/video-workspace"]) {
      console.log(`Checking ${width}x${height} ${route}`);
      await page.evaluate((route) => { location.hash = route; }, route);
      await page.waitForFunction(() =>
        !document.querySelector('[class*="loading-content"]'));
      await page.locator(".window-header").first().waitFor();
      await page.evaluate(() => Promise.all(document.getAnimations()
        .filter((animation) =>
          animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {}))));
      const result = await page.evaluate(() => {
        const content = document.querySelector('[id="app-body"]') ||
          document.querySelector('[class*="window-content"]');
        const box = content.getBoundingClientRect();
        const outside = [...content.querySelectorAll("button,input,textarea")]
          .filter((element) => {
            const r = element.getBoundingClientRect();
            const s = getComputedStyle(element);
            return r.width > 0 && r.height > 0 &&
              s.visibility !== "hidden" &&
              (r.left < -1 || r.right > innerWidth + 1);
          })
          .map((element) => element.getAttribute("aria-label") ||
            element.textContent.trim().slice(0, 40));
        return { x: box.x, width: box.width, outside };
      });
      assert(result.x >= -1 && result.x + result.width <= width + 1,
        `${route}: ${JSON.stringify(result)}`);
      assert.deepEqual(result.outside, [], `${route}: offscreen controls`);
      routeResults.push(route);
      if (route === "/settings" || route === "/chat")
        await page.screenshot({ path: path.join(os.tmpdir(),
          `octopus-mobile-${route.slice(1)}-${width}-${height}-${theme}-${system}.png`) });
    }
    if (width <= 600) {
      await page.evaluate(() => { location.hash = "/chat"; });
      const input = page.locator("textarea");
      await input.waitFor();
      await page.setViewportSize({ width, height: Math.min(height, 400) });
      await input.fill("viewport resize");
      const box = await input.boundingBox();
      assert(box.y >= 0 && box.y + box.height <= Math.min(height, 400) + 1,
        `Input outside resized viewport: ${JSON.stringify(box)}`);
      await page.getByRole("button", { name: "查看消息列表" }).click();
      await page.locator('[class*="sidebar-show"]').waitFor();
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() =>
        document.querySelector('[class*="sidebar-show"]')
          ?.getBoundingClientRect().width < 500);
      await page.setViewportSize({ width, height });
      await page.waitForFunction((width) =>
        Math.abs(document.querySelector('[class*="sidebar-show"]')
          ?.getBoundingClientRect().width - width) < 1, width);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ width, height, theme, system,
      routes: routeResults, result: "passed" }));
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const args of [
      [320, 568, "light", "dark"],
      [390, 844, "auto", "dark"],
      [412, 915, "dark", "light"],
      [600, 720, "auto", "light"],
      [568, 320, "light", "light"],
      [601, 720, "light", "light"],
    ]) await run(browser, ...args);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
