// Isolated UI fixtures: no real credentials, captcha, or model requests.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";

async function startup(browser) {
  const page = await browser.newPage();
  await prepare(page);
  let release;
  const pending = new Promise((resolve) => (release = resolve));
  await page.route("**/api/new-api/bootstrap", async (route) => {
    await pending;
    await route.fulfill({
      json: {
        success: true,
        data: {
          config: { newApiEnabled: false },
          session: { authenticated: false, user: null, selectedTokenId: null },
        },
      },
    });
  });
  try {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.locator('[role="status"][aria-label="Loading"]').waitFor();
    assert.equal(
      await page.getByText("Scroll Session A", { exact: true }).count(),
      0,
    );
    release();
    await page.getByText("Scroll Session A", { exact: true }).first().waitFor();
    console.log(
      "startup: loading visible while identity is pending; history appears after confirmation",
    );
  } finally {
    release();
    await page.close();
  }
}

async function login(
  browser,
  width,
  challenge,
  theme = "light",
  preview = false,
  options = {},
) {
  const { height = 900, lang = "cn" } = options;
  const context = await browser.newContext({
    viewport: { width, height },
    serviceWorkers: "block",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const posts = [];
  let failLogin = true;
  await page.addInitScript(
    ({ theme, lang }) => {
      localStorage.setItem("lang", lang);
      localStorage.setItem(
        "app-config",
        JSON.stringify({
          version: 4.3,
          state: { theme, models: [] },
        }),
      );
      window.turnstile = {
        render(element, options) {
          const fixture = document.createElement("div");
          const compact = options.size === "compact";
          fixture.dataset.widgetSize = options.size;
          fixture.textContent = "Cloudflare verification fixture";
          fixture.style.cssText =
            `width:${compact ? "150px" : "100%"};min-width:${
              compact ? 150 : 300
            }px;height:${compact ? 140 : 65}px;` +
            "box-sizing:border-box;background:#f5f5f5;display:grid;place-items:center;font:12px sans-serif";
          element.replaceChildren(fixture);
          options.callback("fixture-challenge-token");
          return "fixture-widget";
        },
        remove() {},
      };
    },
    { theme, lang },
  );
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/new-api/bootstrap")
      return ok({
        config: { newApiEnabled: true },
        session: { authenticated: false, user: null, selectedTokenId: null },
      });
    if (url.pathname === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true } });
    if (url.pathname === "/api/new-api/status")
      return ok({
        enabled: !preview,
        configured: !preview,
        passwordLoginEnabled: true,
        publicUrl: preview ? "" : "https://accounts.fixture.test",
        turnstileSiteKey: challenge || preview ? "fixture-site-key" : "",
      });
    if (url.pathname === "/api/new-api/session")
      return ok({
        authenticated: false,
        user: null,
        selectedTokenId: null,
      });
    if (url.pathname === "/api/new-api/login") {
      posts.push(route.request().postDataJSON());
      if (failLogin)
        return route.fulfill({
          status: 400,
          json: { success: false, message: "登录失败，请重试" },
        });
      return ok({ requires2fa: true });
    }
    return ok([]);
  });
  try {
    await page.goto(`${base}#/account`);
    const username = page.locator('input[autocomplete="username"]');
    const password = page.locator('input[autocomplete="current-password"]');
    const form = page.locator("form").filter({ has: username });
    const text =
      lang === "cn"
        ? {
            login: "登录",
            show: "显示密码",
            hide: "隐藏密码",
            register: "注册账号",
            reset: "找回密码",
          }
        : {
            login: "Sign In",
            show: "Show password",
            hide: "Hide password",
            register: "Create Account",
            reset: "Reset Password",
          };
    const button = form.getByRole("button", { name: text.login, exact: true });
    await username.waitFor();
    await button.waitFor({ state: "visible" });
    assert(
      await page
        .locator('img[alt="logo"]')
        .evaluateAll(
          (images) =>
            images.length > 0 &&
            images.every((image) => image.complete && image.naturalWidth > 0),
        ),
      "login artwork must render",
    );
    const a = await username.boundingBox(),
      b = await button.boundingBox();
    assert(Math.abs(a.x - b.x) < 1 && Math.abs(a.width - b.width) < 1);
    assert(b.height >= 44);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    if (challenge) {
      const captcha = await page.getByText("Cloudflare verification fixture");
      const c = await captcha.boundingBox();
      assert(Math.abs(c.x - a.x) < 1, "captcha must share the input baseline");
      assert(
        a.width < 300
          ? (await captcha.getAttribute("data-widget-size")) === "compact"
          : Math.abs(c.width - a.width) < 1,
        "captcha must fit the input width with native responsive sizing",
      );
    }
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-login-${width}-${height}-${challenge}-${theme}-${lang}-${preview}.png`,
      ),
    });
    if (width === 1440 && challenge && theme === "light") {
      await page.setViewportSize({ width: 320, height });
      await page.locator('[data-widget-size="compact"]').waitFor();
      await page.setViewportSize({ width, height });
      await page.locator('[data-widget-size="flexible"]').waitFor();
    }
    await username.fill("fixture-user");
    await password.fill("fixture-password");
    await form.getByRole("button", { name: text.show, exact: true }).click();
    assert.equal(await password.getAttribute("type"), "text");
    assert.equal(await password.inputValue(), "fixture-password");
    assert.equal(posts.length, 0, "password reveal must not submit the form");
    await form.getByRole("button", { name: text.hide, exact: true }).click();
    assert.equal(await password.getAttribute("type"), "password");
    if (preview) {
      await page.getByText("本地界面预览，不会提交账号信息。").waitFor();
      await page
        .getByRole("link", { name: text.register, exact: true })
        .click();
      await page.getByRole("link", { name: text.reset, exact: true }).click();
      assert.equal(
        page.url(),
        `${base}#/account`,
        "preview links must not navigate",
      );
      await button.click();
      assert.equal(posts.length, 0, "preview must never submit credentials");
      console.log(
        `login ${width}px: unconfigured preview, auxiliary links and captcha bypass passed`,
      );
      return;
    }
    if (lang !== "cn") {
      assert.equal(
        await page
          .getByRole("link", { name: text.register, exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page.getByRole("link", { name: text.reset, exact: true }).count(),
        1,
      );
      console.log(
        `login ${width}x${height} ${lang}: layout, labels and password visibility passed`,
      );
      return;
    }
    await button.click();
    await page.getByText("登录失败，请重试", { exact: true }).waitFor();
    assert.equal(posts[0].username, "fixture-user");
    assert.equal(posts[0].password, "fixture-password");
    if (challenge)
      assert.equal(posts[0].turnstile_token, "fixture-challenge-token");
    failLogin = false;
    await button.click();
    await page.locator('input[autocomplete="one-time-code"]').waitFor();
    await page.getByRole("button", { name: /返回登录/ }).click();
    await username.waitFor();
    console.log(
      `login ${width}px ${theme} challenge=${challenge}: artwork, alignment, submit, errors, two-factor and back passed`,
    );
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    await startup(browser);
    for (const width of [1440, 390, 320]) {
      await login(browser, width, true);
    }
    await login(browser, 1024, true, "dark");
    await login(browser, 390, true, "dark");
    await login(browser, 1440, false, "light", true);
    await login(browser, 812, false, "light", false, { height: 375 });
    await login(browser, 390, false, "light", false, { lang: "en" });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
