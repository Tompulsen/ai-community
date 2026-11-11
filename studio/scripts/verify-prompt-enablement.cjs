const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.stack || error.message));
      await page.addInitScript(() => localStorage.setItem("lang", "cn"));
      await page.route("**/api/**", (route) =>
        route.fulfill({ json: { data: [], enabled: false, needCode: false } }),
      );
      await page.goto("http://localhost:3001/#/chat");
      const input = page.locator("#chat-input");
      await input.fill("/");
      const hints = page.locator('[class*="prompt-hints"]');
      await hints.getByText("目前没有启用提示词", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await hints.waitFor({ state: "hidden" });
      await input.fill("/ ");
      await hints.getByText("打开设置进行启用", { exact: true }).click();
      await page.waitForURL("**/#/settings");
      const search = page.getByRole("textbox", {
        name: "搜索提示词",
        exact: true,
      });
      await search.waitFor();
      const toggles = page.getByRole("checkbox", { name: /^启用提示词：/ });
      await toggles.first().waitFor();
      const label = await toggles.first().getAttribute("aria-label");
      const title = label.slice("启用提示词：".length);
      assert.equal(await toggles.first().isChecked(), false);
      await toggles.first().check();
      await page.waitForFunction((name) => {
        const element = Array.from(document.querySelectorAll('input[type="checkbox"]'))
          .find((item) => item.getAttribute("aria-label") === name);
        const style = element && getComputedStyle(element);
        return element?.checked && style.backgroundColor === style.borderTopColor;
      }, label);
      await page.screenshot({
        path: path.join(os.tmpdir(), `octopus-prompt-enable-${width}.png`),
      });
      assert(
        await toggles.first().evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= innerWidth;
        }),
      );
      await page.keyboard.press("Escape");
      await page.goto("http://localhost:3001/#/chat");
      await input.fill("/");
      await hints.locator('button[class*="hint-main"]').waitFor();
      assert.equal(
        await hints.locator('button[class*="hint-main"]').count(),
        1,
      );
      assert.equal(
        await hints.locator('[class*="hint-title"]').textContent(),
        title,
      );
      await page.reload();
      await input.fill("/");
      await hints.locator('[class*="hint-title"]').waitFor();
      assert.equal(
        await hints.locator('[class*="hint-title"]').textContent(),
        title,
      );
      await page.keyboard.press("Enter");
      await hints.waitFor({ state: "hidden" });
      assert.notEqual(await input.inputValue(), "/");
      assert.match(
        await page.locator(".window-header-sub-title").textContent(),
        /0/,
      );
      await page.goto("http://localhost:3001/#/settings");
      await page
        .getByRole("button", { name: "自定义提示词列表编辑", exact: true })
        .click();
      await search.fill(title);
      const toggle = page.getByRole("checkbox", { name: label, exact: true });
      await toggle.uncheck();
      await page.keyboard.press("Escape");
      await page.goto("http://localhost:3001/#/chat");
      await input.fill("/");
      await hints.getByText("目前没有启用提示词", { exact: true }).waitFor();
      await page.reload();
      await input.fill("/");
      await hints.getByText("目前没有启用提示词", { exact: true }).waitFor();
      await page.screenshot({
        path: path.join(os.tmpdir(), `octopus-prompt-empty-${width}.png`),
      });
      await hints.getByText("打开设置进行启用", { exact: true }).click();
      await page.getByRole("button", { name: "新建", exact: true }).click();
      await page.getByRole("textbox", { name: "编辑提示词", exact: true }).fill("回归专用提示词");
      await page.locator('[class*="edit-prompt-content"]').fill("自定义提示词正文");
      await page.getByRole("button", { name: "确认", exact: true }).click();
      const customToggle = page.getByRole("checkbox", { name: "启用提示词：回归专用提示词", exact: true });
      assert.equal(await customToggle.isChecked(), false);
      await customToggle.check();
      await page.keyboard.press("Escape");
      await page.goto("http://localhost:3001/#/chat");
      await input.fill("/回归专用");
      await hints.getByText("回归专用提示词", { exact: true }).waitFor();
      await page.goto("http://localhost:3001/#/settings");
      await page.getByRole("button", { name: "自定义提示词列表编辑", exact: true }).click();
      await search.fill("回归专用");
      await page.locator('[class*="user-prompt-item"]').filter({ hasText: "回归专用提示词" })
        .locator('button[class*="user-prompt-button"]').first().click();
      await page.keyboard.press("Escape");
      await page.goto("http://localhost:3001/#/chat");
      await input.fill("/");
      await hints.getByText("目前没有启用提示词", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log(
        `${width}: opt-in default, settings link, per-prompt enable/disable, persistence, keyboard and no-send passed`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
