const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    ...(process.env.UI_PROXY
      ? {
          proxy: {
            server: process.env.UI_PROXY,
            bypass: "localhost,127.0.0.1",
          },
        }
      : {}),
  });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        const errors = [];
        let requests = 0;
        let details = 0;
        let indexAttempts = 0;
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => localStorage.setItem("lang", "cn"));
        await page.route("**/api/ai-daily**", (route) => {
          requests++;
          const request = route.request();
          assert.equal(request.method(), "GET");
          const headers = request.headers();
          assert.equal(headers.cookie, undefined);
          assert.equal(headers.authorization, undefined);
          const url = new URL(request.url());
          if (!url.searchParams.has("date")) {
            // Exercise recovery without sending any writes or model requests.
            if (++indexAttempts === 1)
              return route.fulfill({
                status: 503,
                headers: { "access-control-allow-origin": "*" },
                json: {},
              });
          } else {
            details++;
          }
          return route.continue();
        });
        await page.route("**/api/**", (route) => {
          const url = new URL(route.request().url());
          if (url.pathname === "/api/ai-daily") return route.fallback();
          const ok = (data) => route.fulfill({ json: { success: true, data } });
          if (url.pathname === "/api/config")
            return route.fulfill({ json: { newApiEnabled: true } });
          if (url.pathname === "/api/announcement")
            return route.fulfill({
              json: {
                announcement: {
                  id: "fixture",
                  title: "本地验证公告",
                  content:
                    '<p>平台公告内容正常显示。</p><script>alert("unsafe")</script>',
                  type: "update",
                },
              },
            });
          if (url.pathname === "/api/new-api/session")
            return ok({
              authenticated: true,
              selectedTokenId: 10,
              user: { id: 7, username: "fixture", group: "default" },
            });
          if (url.pathname === "/api/new-api/status")
            return ok({ enabled: true, configured: true });
          if (url.pathname.endsWith("/models"))
            return route.fulfill({
              json: { data: [{ id: "gpt-4o", object: "model" }] },
            });
          return ok([]);
        });
        await page.goto("http://localhost:3001/#/chat");
        const input = page.locator("#chat-input");
        await input.fill("公告关闭后保留这个草稿");
        assert.equal(requests, 0, "News must not load before opening the bell");
        const bell = page.getByRole("button", { name: "公告", exact: true });
        await bell.click();
        const dialog = page.getByRole("dialog", { name: "公告与日报" });
        await dialog.getByText("AI 日报暂时无法读取，请稍后重试").waitFor();
        await dialog
          .getByRole("button", { name: "平台公告－本地验证公告" })
          .click();
        await dialog.getByText("平台公告内容正常显示。").waitFor();
        assert.equal(await dialog.locator("script").count(), 0);
        await dialog.getByRole("button", { name: "重试", exact: true }).click();
        const daily = dialog
          .getByRole("button", { name: /^AI 日报－/ })
          .first();
        await daily.waitFor();
        assert.ok(
          (await dialog.getByRole("button", { name: /^AI 日报－/ }).count()) <=
            7,
        );
        assert.equal(details, 0, "Reports must load only when expanded");
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-daily-list-${width}.png`),
          animations: "disabled",
        });
        await daily.click();
        await dialog.locator('[class*="newsItem"]').first().waitFor();
        assert.ok(
          await dialog.getByRole("link", { name: "AIHOT" }).isVisible(),
        );
        assert.ok(await dialog.getByRole("link", { name: "原文" }).count());
        assert.ok(
          await dialog.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth + 1;
          }),
        );
        const content = dialog.locator('[class*="content"]').first();
        assert.ok(
          await content.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
          "Content must not overflow horizontally",
        );
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-daily-expanded-${width}.png`),
          animations: "disabled",
        });
        const fetched = requests;
        await daily.click();
        await daily.click();
        await dialog.locator('[class*="newsItem"]').first().waitFor();
        assert.equal(
          requests,
          fetched,
          "Repeated expansion should reuse cache",
        );
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await input.inputValue(), "公告关闭后保留这个草稿");
        assert.ok(
          await bell.evaluate((element) => element === document.activeElement),
        );
        await bell.click();
        await dialog
          .getByRole("button", { name: /^AI 日报－/ })
          .first()
          .waitFor();
        assert.equal(requests, fetched, "Reopening should reuse index cache");
        await page.keyboard.press("Escape");
        await page.reload();
        await bell.click();
        await daily.waitFor();
        await daily.click();
        await dialog.locator('[class*="newsItem"]').first().waitFor();
        assert.equal(
          requests,
          fetched,
          "Reloading should reuse fresh index and report from session storage",
        );
        await page.keyboard.press("Escape");
        assert.deepEqual(errors, []);
        console.log(
          `PASS ${width}px: live AIHOT index/report, lazy fetch, retry, platform notice, cache across reload, safe links, responsive layout, Escape/focus and draft`,
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
