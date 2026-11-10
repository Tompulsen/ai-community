// Isolated local UI fixtures; no account API or provider request may be used.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";

async function assertNoOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
}

async function assertAccountToolbar(page, actionName) {
  const navigation = page.getByRole("navigation", { name: "账户内容" });
  assert.deepEqual(
    (await navigation.getByRole("button").allTextContents()).map((text) =>
      text.trim(),
    ),
    ["充值与套餐", "密钥与用量"],
  );
  const wallet = await navigation
    .getByRole("button", { name: "充值与套餐", exact: true })
    .boundingBox();
  const keys = await navigation
    .getByRole("button", { name: "密钥与用量", exact: true })
    .boundingBox();
  assert.ok(wallet && keys && wallet.x < keys.x);
  assert.ok(
    Math.abs(wallet.y + wallet.height / 2 - keys.y - keys.height / 2) <= 2,
  );
  const action = await page
    .getByRole("button", { name: actionName, exact: true })
    .boundingBox();
  const nav = await navigation.boundingBox();
  assert.ok(
    nav &&
      action &&
      nav.y < action.y + action.height &&
      action.y < nav.y + nav.height,
    `Account toolbar must share one row: ${JSON.stringify({
      width: page.viewportSize()?.width,
      actionName,
      nav,
      action,
    })}`,
  );
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [width, theme] of [
      [1440, "light"],
      [390, "light"],
      [1440, "dark"],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 950 },
        serviceWorkers: "block",
      });
      await context.addInitScript((theme) => {
        localStorage.setItem("lang", "cn");
        localStorage.setItem(
          "app-config",
          JSON.stringify({
            version: 4.4,
            state: { theme, models: [], modelConfig: {} },
          }),
        );
      }, theme);
      const page = await context.newPage();
      const accountRequests = [],
        writes = [],
        errors = [],
        consoleErrors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !message.text().startsWith("Failed to load resource") &&
          !message.text().startsWith("ServiceWorker registration failed:") &&
          !message
            .text()
            .startsWith("Loading the script 'https://www.googletagmanager.com/")
        )
          consoleErrors.push(message.text());
      });
      await page.route("**/*", (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (["blob:", "data:"].includes(url.protocol)) return route.continue();
        if (url.origin !== new URL(base).origin) return route.abort();
        if (request.headers()["next-action"])
          return route.fulfill({
            contentType: "text/x-component",
            body: '0:{"a":false,"f":[]}\n',
          });
        if (!url.pathname.startsWith("/api/")) return route.continue();
        const config = {
          newApiEnabled: false,
          needCode: false,
          enableMcp: false,
        };
        const ok = (data) => route.fulfill({ json: { success: true, data } });
        if (url.pathname.endsWith("/bootstrap"))
          return ok({
            config,
            session: {
              authenticated: false,
              user: null,
              selectedTokenId: null,
            },
          });
        if (url.pathname === "/api/config")
          return route.fulfill({ json: config });
        if (url.pathname.endsWith("/status"))
          return ok({ enabled: false, configured: false });
        if (url.pathname.startsWith("/api/new-api/"))
          accountRequests.push(url.pathname);
        if (request.method() !== "GET") writes.push(url.pathname);
        return ok([]);
      });
      await page.goto(base + "#/account?local-preview=account");
      await page
        .getByRole("heading", { name: "本地预览账号", exact: true })
        .waitFor({ timeout: 60000 });
      await page.locator(`body.${theme}`).waitFor();
      await page.getByText("图像创作测试", { exact: true }).waitFor();
      await page.getByText("gpt-6-astra", { exact: true }).waitFor();
      await assertNoOverflow(page);
      await assertAccountToolbar(page, "创建密钥");
      if (width === 390) {
        await page.setViewportSize({ width: 320, height: 950 });
        await assertNoOverflow(page);
        await assertAccountToolbar(page, "创建密钥");
        await page.setViewportSize({ width, height: 950 });
      }
      const accountScreenshot = path.join(
        os.tmpdir(),
        `octopus-account-preview-${width}-${theme}.png`,
      );
      await page.screenshot({ path: accountScreenshot });
      await page.getByRole("button", { name: "刷新账户余额" }).click();
      const firstToken = page.locator("article[data-token-id]").first();
      await firstToken.hover();
      await firstToken
        .getByRole("button", { name: "更多密钥操作", exact: true })
        .click();
      await firstToken
        .getByRole("button", { name: "刷新密钥列表", exact: true })
        .click();
      await page.getByRole("button", { name: "刷新消费记录" }).click();
      await page.getByRole("button", { name: "创建密钥", exact: true }).click();
      let dialog = page
        .getByRole("dialog", { name: "创建密钥", exact: true })
        .last();
      await dialog.getByRole("textbox").first().fill("交互测试密钥");
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      const key = () =>
        page
          .locator("article[data-token-id]")
          .filter({ hasText: "交互测试密钥" });
      await key().getByText("交互测试密钥", { exact: true }).waitFor();
      await key().hover();
      await key().getByRole("button", { name: "更多密钥操作" }).click();
      await key().getByRole("button", { name: "编辑密钥" }).click();
      dialog = page
        .getByRole("dialog", { name: "编辑密钥", exact: true })
        .last();
      await dialog.getByRole("checkbox", { name: "限制可用模型" }).check();
      await dialog
        .getByRole("textbox", { name: "允许的模型" })
        .fill("gpt-6-astra");
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await key()
        .getByText(/允许的模型.*gpt-6-astra/)
        .waitFor();
      await key().getByRole("button", { name: "更多密钥操作" }).click();
      await key()
        .getByRole("button", { name: "停用密钥", exact: true })
        .click();
      await key().getByText("已停用", { exact: true }).waitFor();
      await key().getByRole("button", { name: "更多密钥操作" }).click();
      await key()
        .getByRole("button", { name: "启用密钥", exact: true })
        .click();
      await key()
        .getByRole("button", {
          name: "用于聊天 · 交互测试密钥",
          exact: true,
        })
        .click();
      await page.waitForURL("**/#/chat?local-preview=components");
      await page.evaluate(() => {
        location.hash = "/account?local-preview=account";
      });
      await key().getByText("聊天使用中", { exact: true }).waitFor();
      await key().getByRole("button", { name: "更多密钥操作" }).click();
      await key()
        .getByRole("button", { name: "删除密钥", exact: true })
        .click();
      await page.getByRole("button", { name: "确认", exact: true }).click();
      await key().waitFor({ state: "detached" });

      await page
        .getByRole("button", { name: "充值与套餐", exact: true })
        .first()
        .click();
      await page.getByTestId("account-wallet").waitFor();
      await page.getByRole("spinbutton", { name: "自定义金额" }).waitFor();
      const walletScreenshot = path.join(
        os.tmpdir(),
        `octopus-wallet-preview-${width}-${theme}.png`,
      );
      await page.screenshot({ path: walletScreenshot });
      await assertAccountToolbar(page, "刷新余额");
      if (width === 390) {
        await page.setViewportSize({ width: 320, height: 950 });
        await assertNoOverflow(page);
        await assertAccountToolbar(page, "刷新余额");
        await page.setViewportSize({ width, height: 950 });
      }
      await page.getByRole("spinbutton", { name: "自定义金额" }).fill("20");
      await page.getByRole("radio", { name: "微信支付" }).check();
      await page.getByRole("button", { name: "确认金额，去支付" }).click();
      await page.getByRole("heading", { name: "模拟收银台" }).waitFor();
      assert.equal(await page.locator('iframe[title="安全支付"]').count(), 0);
      assert.equal(
        await page.locator('form[action^="https://checkout"]').count(),
        0,
      );
      await page.screenshot({
        path: path.join(
          os.tmpdir(),
          `octopus-checkout-preview-${width}-${theme}.png`,
        ),
      });
      await page
        .getByRole("button", { name: "模拟支付成功", exact: true })
        .click();
      await page.getByRole("heading", { name: "模拟支付成功" }).waitFor();
      await page.getByText("✦116.522", { exact: true }).waitFor();
      await page.getByRole("button", { name: "返回充值" }).click();
      await page
        .getByRole("button", { name: /^选择此套餐：/ })
        .first()
        .click();
      await page.getByRole("button", { name: "确认套餐，去支付" }).click();
      await page
        .getByRole("button", { name: "模拟支付成功", exact: true })
        .click();
      await page.getByRole("heading", { name: "模拟支付成功" }).waitFor();
      await page.getByRole("button", { name: "返回充值" }).click();
      await page.getByText("我的订阅 · 1 个生效中", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "使用兑换码", exact: true })
        .click();
      await page.getByRole("link", { name: "获取兑换码", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "本地预览兑换码：PREVIEW-50" })
        .waitFor();
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page
        .getByRole("textbox", { name: "兑换码", exact: true })
        .fill("bad-code");
      await page.getByRole("button", { name: "兑换额度" }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: "模拟兑换码无效" })
        .waitFor();
      await page
        .getByRole("textbox", { name: "兑换码", exact: true })
        .fill("PREVIEW-50");
      await page.getByRole("button", { name: "兑换额度" }).click();
      await page.getByText("✦166.522", { exact: true }).waitFor();
      await page.getByRole("button", { name: "退出登录" }).click();
      await page.getByRole("heading", { name: "登录章鱼账号" }).waitFor();
      await page
        .getByRole("textbox", { name: "用户名", exact: true })
        .fill("preview-user");
      await page.getByLabel("密码", { exact: true }).fill("preview");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page
        .getByRole("heading", { name: "本地预览账号", exact: true })
        .waitFor();
      if (width > 600) {
        await page
          .locator('[data-workspace-rail] [aria-label="模型价格"]')
          .click();
        await page.waitForURL("**/#/pricing?local-preview=account");
      } else
        await page.evaluate(() => {
          location.hash = "/pricing?local-preview=account";
        });
      await page.getByTestId("model-price-grid").waitFor();
      assert.equal(
        await page
          .getByRole("article", { name: "claude-sonnet 模型价格", exact: true })
          .getByRole("button", {
            name: "查看 claude-sonnet 价格详情",
            exact: true,
          })
          .count(),
        1,
      );
      const pricingScreenshot = path.join(
        os.tmpdir(),
        `octopus-pricing-preview-${width}-${theme}.png`,
      );
      await page.screenshot({ path: pricingScreenshot });
      await page.getByRole("searchbox").fill("gpt-image");
      assert.equal(
        await page
          .getByTestId("model-price-grid")
          .getByText("gpt-image-2.6")
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByTestId("model-price-grid")
          .getByText("gpt-6-astra")
          .count(),
        0,
      );
      await page.getByRole("button", { name: "刷新价格", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "前往充值", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.getByRole("link", { name: "模型广场", exact: true }).count(),
        0,
      );
      assert.ok(page.url().includes("/pricing?local-preview=account"));
      assert.deepEqual(accountRequests, []);
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      console.log(
        JSON.stringify({
          width,
          theme,
          accountScreenshot,
          walletScreenshot,
          pricingScreenshot,
          mockAccountOnly: true,
          accountToolbarAligned: true,
          narrowViewportChecked: width === 390,
          accountRequests: 0,
          writes: 0,
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
