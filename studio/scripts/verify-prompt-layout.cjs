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
      let submissions = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("lang", "cn"));
      await page.route("**/api/**", (route) => {
        if (route.request().url().includes("completions")) submissions++;
        return route.fulfill({
          json: { data: [], enabled: false, needCode: false },
        });
      });
      await page.goto("http://localhost:3001/#/masks");
      await page.getByRole("button", { name: "新建", exact: true }).click();
      const mask = page.locator('[class*="mask-config"]');
      await mask.getByRole("tab", { name: "预设对话", exact: true }).waitFor();
      const add = mask.locator('[class*="context-add"] button');
      await add.click();
      const texts = mask.locator("textarea");
      const content = "第一条预设。\n".repeat(24);
      await texts.first().fill(content);
      await add.click();
      await texts.nth(1).fill("第二条预设");
      await mask
        .getByRole("button", { name: "拖动排序", exact: true })
        .first()
        .focus();
      await page.keyboard.press("Space");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Space");
      await page.waitForTimeout(350);
      assert.equal(await texts.first().inputValue(), "第二条预设");
      await mask
        .getByRole("button", { name: "完整查看与编辑", exact: true })
        .first()
        .click();
      const preview = page.getByRole("dialog");
      await preview.locator("textarea").fill("修改后的第二条预设");
      await page.keyboard.press("Tab");
      assert(
        await preview.evaluate((el) => el.contains(document.activeElement)),
      );
      await page.keyboard.press("Escape");
      await mask.waitFor();
      assert.equal(await texts.first().inputValue(), "修改后的第二条预设");
      await mask.getByRole("tab", { name: "角色与参数", exact: true }).click();
      await mask.getByRole("tab", { name: "预设对话", exact: true }).click();
      assert.equal(await texts.first().inputValue(), "修改后的第二条预设");
      assert(
        await texts.first().evaluate((el) => {
          const bounds = el.getBoundingClientRect();
          return (
            bounds.width > 200 && bounds.left >= 0 && bounds.right <= innerWidth
          );
        }),
      );
      await page.screenshot({
        path: path.join(os.tmpdir(), `octopus-preset-${width}.png`),
      });
      await page.keyboard.press("Escape");
      const search = page.locator('input[class*="search-bar"]');
      await search.fill("AI文生图");
      const builtin = page
        .locator('[class*="mask-item"]')
        .filter({ hasText: "AI文生图" });
      await builtin.getByRole("button", { name: "查看", exact: true }).click();
      await mask.waitFor();
      assert.equal(await mask.locator("textarea, select").count(), 0);
      assert.equal(
        await mask
          .getByRole("button", { name: "拖动排序", exact: true })
          .count(),
        0,
      );
      await mask
        .getByRole("button", { name: "完整查看与编辑", exact: true })
        .first()
        .click();
      assert.equal(
        await preview.locator("textarea").getAttribute("readonly"),
        "",
      );
      assert(
        (await preview.locator("textarea").inputValue()).startsWith("你是一名"),
      );
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await mask.getByRole("tab", { name: "角色与参数", exact: true }).click();
      assert.equal(await mask.locator("fieldset").getAttribute("disabled"), "");
      assert(await mask.locator("fieldset input").first().isDisabled());
      await page.keyboard.press("Escape");
      await page.goto("http://localhost:3001/#/settings");
      await page.getByRole("button", { name: "自定义提示词列表编辑", exact: true }).click();
      const promptSwitches = page.getByRole("checkbox", { name: /^启用提示词：/ });
      await promptSwitches.nth(0).check();
      await promptSwitches.nth(1).check();
      await page.keyboard.press("Escape");
      await page.goto("http://localhost:3001/#/chat");
      const messageCount = () =>
        page.locator(".window-header-sub-title").textContent();
      const initialMessageCount = await messageCount();
      const input = page.locator("#chat-input");
      await input.fill("/");
      const hints = page.locator('[class*="prompt-hints"]');
      await hints.waitFor();
      const bounds = await hints.boundingBox();
      assert(bounds.width <= 560 && bounds.height <= 320);
      await hints.locator('button[class*="hint-preview"]').first().click();
      assert.equal(
        await messageCount(),
        initialMessageCount,
        "preview must not submit",
      );
      assert.equal(await input.inputValue(), "/");
      await page.keyboard.press("Escape");
      await hints.waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await hints.count(), 0);
      assert(await input.evaluate((el) => el === document.activeElement));
      assert.equal(
        await messageCount(),
        initialMessageCount,
        "Escape must not submit",
      );
      await input.fill("/ ");
      await input.fill("/");
      await hints.waitFor();
      assert.equal(
        await messageCount(),
        initialMessageCount,
        "opening suggestions must not submit",
      );
      await page.keyboard.press("ArrowDown");
      const selected = hints.locator(
        'button[aria-current="true"] [class*="hint-content"]',
      );
      const expected = await selected.textContent();
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (value) => document.querySelector("#chat-input").value === value,
        expected,
      );
      assert.equal(await input.inputValue(), expected);
      assert.equal(
        await messageCount(),
        initialMessageCount,
        "prompt selection must not submit",
      );
      assert.equal(submissions, 0);
      await input.fill("/");
      await hints.waitFor();
      await page.screenshot({
        path: path.join(os.tmpdir(), `octopus-prompts-${width}.png`),
      });
      assert.deepEqual(errors, []);
      console.log(
        `${width}: preset editing, drag sorting, readonly preview, focus, prompt keyboard and no-send checks passed`,
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
