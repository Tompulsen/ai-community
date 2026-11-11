// Isolated account startup and checkout fixtures. Every API and payment is mocked.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [width, failStatus] of [
      [1440, false],
      [390, false],
      [1440, true],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 950 },
        serviceWorkers: "block",
      });
      await context.addInitScript(() => localStorage.setItem("lang", "cn"));
      const statusGate = deferred(),
        orderGate = deferred();
      let statusFails = failStatus,
        sessionReads = 0,
        submissions = 0;
      const errors = [];
      const session = {
        authenticated: true,
        selectedTokenId: 1,
        user: {
          id: 7,
          username: "startup-test",
          display_name: "账号首屏测试",
          group: "default",
          quota: 50000000,
          used_quota: 0,
          request_count: 0,
        },
      };
      const status = {
        enabled: true,
        configured: true,
        publicUrl: "https://accounts.example.com",
        passwordLoginEnabled: true,
        turnstileSiteKey: "",
        quotaPerUnit: 500000,
        currencySymbol: "✦",
      };
      const config = { newApiEnabled: true, needCode: false, enableMcp: false };
      const wallet = {
        userId: 7,
        currencySymbol: "✦",
        quotaPerUnit: 500000,
        quotaDisplayType: "CUSTOM",
        creditExchangeRate: 1,
        topup: {
          enabled: true,
          redemptionEnabled: true,
          minAmount: 1,
          amountOptions: [10, 20],
          paymentMethods: [{ type: "alipay", name: "支付宝" }],
        },
        plans: [],
        subscriptions: [],
        history: [],
        historyTotal: 0,
      };
      await context.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (url.hostname === "checkout.example.com") {
          submissions++;
          assert.equal(request.method(), "POST");
          return route.fulfill({
            contentType: "text/html",
            body: "<h1>Mock payment accepted</h1>",
          });
        }
        if (url.origin !== new URL(base).origin) return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        const ok = (data) => route.fulfill({ json: { success: true, data } });
        const key = url.pathname.split("/").pop();
        if (key === "config") return route.fulfill({ json: config });
        if (key === "bootstrap") return ok({ config, session });
        if (key === "status") {
          await statusGate.promise;
          return statusFails
            ? route.fulfill({
                status: 502,
                json: { success: false, message: "模拟配置读取失败" },
              })
            : ok(status);
        }
        if (key === "session") {
          sessionReads++;
          return ok(session);
        }
        if (key === "groups") return ok([]);
        if (key === "auto-groups")
          return ok({ supported: true, defaultGroups: [], maxCount: 9 });
        if (key === "wallet") return ok(wallet);
        if (key === "quote") {
          const { amount } = request.postDataJSON();
          return ok({ userId: 7, amount, money: String(amount) });
        }
        if (key === "pay") {
          await orderGate.promise;
          return ok({
            userId: 7,
            kind: "topup",
            money: "10",
            tradeNo: "FIXTURE",
            action: "https://checkout.example.com/submit",
            method: "POST",
            fields: { money: "10" },
            paymentMethod: "alipay",
          });
        }
        assert.equal(
          request.method(),
          "GET",
          `Unexpected write: ${url.pathname}`,
        );
        return ok({ items: [], total: 0, page: 1, size: 10 });
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base + "#/account?view=keys");
      await page
        .getByRole("heading", { name: "账号首屏测试", exact: true })
        .waitFor({ timeout: 60000 });
      assert.equal(
        await page.getByRole("heading", { name: "登录章鱼账号" }).count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "创建密钥", exact: true })
          .isDisabled(),
        true,
      );
      session.user.display_name = "已刷新账号";
      await page
        .getByRole("button", { name: "刷新账户余额", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "已刷新账号", exact: true })
        .waitFor();
      statusGate.resolve();
      if (failStatus) {
        await page.getByText("模拟配置读取失败", { exact: true }).waitFor();
        statusFails = false;
        await page
          .getByRole("button", { name: "重新读取账号配置", exact: true })
          .click();
      }
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("button")).some(
          (button) =>
            (button.getAttribute("aria-label") === "创建密钥" ||
              button.textContent.includes("创建密钥")) &&
            !button.disabled,
        ),
      );
      await page
        .getByRole("heading", { name: "已刷新账号", exact: true })
        .waitFor();

      await page.evaluate(() => {
        location.hash = "/settings";
      });
      await page
        .getByRole("heading", { name: "已刷新账号", exact: true })
        .waitFor({ state: "detached" });
      const readsBeforeReturn = sessionReads;
      await page.evaluate(() => {
        location.hash = "/account?view=wallet";
      });
      await page
        .getByRole("heading", { name: "已刷新账号", exact: true })
        .waitFor();
      const pay = page.getByRole("button", {
        name: "确认金额，去支付",
        exact: true,
      });
      await pay.waitFor();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("button")).some(
          (button) =>
            button.getAttribute("aria-label") === "确认金额，去支付" &&
            !button.disabled,
        ),
      );
      assert.equal(
        sessionReads,
        readsBeforeReturn,
        "Recent verified session should be reused",
      );
      await pay.click();
      await page
        .getByRole("heading", { name: "正在创建订单，请稍候…", exact: true })
        .waitFor();
      assert.equal(context.pages().length, 1);
      if (!failStatus) {
        await page.screenshot({
          path: require("node:path").join(
            require("node:os").tmpdir(),
            `wallet-inline-wait-${width}.png`,
          ),
        });
      }
      orderGate.resolve();
      await page
        .getByRole("heading", { name: "Mock payment accepted" })
        .waitFor();
      assert.equal(submissions, 1);
      assert.equal(context.pages().length, 1);
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          width,
          failStatus,
          progressiveAccount: true,
          statusSurvivesRefresh: true,
          verifiedSessionReused: true,
          automaticCheckout: true,
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
