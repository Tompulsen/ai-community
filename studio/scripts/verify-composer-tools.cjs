// Isolated fixtures cover the relocated controls without real model requests.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";

async function run(browser, width, theme, reducedMotion = "no-preference") {
  const context = await browser.newContext({
    viewport: { width, height: width <= 600 ? 844 : 900 },
    isMobile: width <= 600,
    hasTouch: width <= 600,
    serviceWorkers: "block",
    reducedMotion,
    colorScheme: theme,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  try {
    await prepare(page);
    await page.addInitScript((theme) => {
      const config = JSON.parse(localStorage.getItem("app-config"));
      config.state.theme = theme;
      localStorage.setItem("app-config", JSON.stringify(config));
    }, theme);
    await page.route("**/*", (route) =>
      route.request().headers()["next-action"]
        ? route.fulfill({ status: 503, body: "Fixture: MCP unavailable" })
        : route.fallback(),
    );
    await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
    const input = page.locator("#chat-input");
    await input.waitFor();
    await input.fill("Keep this draft while changing conversation tools");
    await page.waitForTimeout(3800);
    await page.evaluate(() =>
      document
        .querySelector("nextjs-portal")
        ?.style.setProperty("display", "none"),
    );

    const toolbar = page.locator(
      '[class*="chat-input-panel_"] [class*="composer-toolbar_"]',
    );
    const topbar = page.locator("[data-workspace-topbar]");
    const geometry = await toolbar.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        height: rect.height,
        buttons: [...node.querySelectorAll("button")].map((button) => {
          const box = button.getBoundingClientRect();
          return {
            label: button.getAttribute("aria-label"),
            x: box.x,
            y: box.y,
            right: box.right,
            width: box.width,
            height: box.height,
          };
        }),
      };
    });
    assert(geometry.buttons.every((button) => button.x >= -1));
    assert(geometry.buttons.every((button) => button.right <= width + 1));
    if (width <= 600) {
      assert(geometry.height <= 56, "Keep the tools on one compact row");
      assert(
        geometry.buttons.every(
          (button) => button.width >= 44 && button.height >= 44,
        ),
        "Compacting must preserve touch targets",
      );
      assert(
        Math.max(...geometry.buttons.map((button) => button.y)) -
          Math.min(...geometry.buttons.map((button) => button.y)) <
          1,
        "All persistent controls must share a baseline",
      );
      const title = page.locator('[class*="chat-body-main-title_"]');
      assert((await title.boundingBox()).height >= 44);
    } else {
      if (width <= 1100)
        assert(
          geometry.height <= 90,
          "Narrow desktop tools use at most two rows",
        );
      assert.equal(
        await toolbar
          .getByRole("button", { name: "对话设置", exact: true })
          .count(),
        0,
      );
    }
    assert.equal(
      await toolbar
        .getByRole("button", { name: "更多对话操作", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await toolbar
        .getByRole("button", { name: "对话设置", exact: true })
        .count(),
      0,
    );
    const clear = toolbar.getByRole("button", {
      name: "清除上下文",
      exact: true,
    });
    await clear.waitFor({ state: "visible" });
    for (const expected of [true, false]) {
      await input.focus();
      await clear.click();
      assert.equal(
        await clear.getAttribute("aria-pressed"),
        String(expected),
        "The persistent eraser must clear and restore context directly",
      );
      assert.equal(await page.getByRole("dialog").count(), 0);
      const actionFocus = width <= 600 ? clear : input;
      assert(
        await actionFocus.evaluate((node) => document.activeElement === node),
      );
      assert.equal(
        await input.inputValue(),
        "Keep this draft while changing conversation tools",
      );
    }
    const sidebar = page.locator("[data-sidebar-panel]");
    if ((await sidebar.getAttribute("aria-hidden")) === "true")
      await topbar.locator("[data-workspace-sidebar-toggle]").click();
    const settingsOpener = sidebar.locator(
      '[data-chat-session-id="scroll-b"] [data-chat-more]',
    );
    const rowMenu = page.locator('[id="chat-item-actions-scroll-b"]');
    const settings = page.locator("[data-modal-dialog]");
    const openSettings = async () => {
      await settingsOpener.click();
      await rowMenu.waitFor({ state: "visible" });
      assert.equal(await rowMenu.getAttribute("role"), "menu");
      await rowMenu
        .getByRole("menuitem", { name: "对话设置", exact: true })
        .click();
      await rowMenu.waitFor({ state: "hidden" });
      await settings.waitFor({ state: "visible" });
      assert.equal(await settings.count(), 1);
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(
        await sidebar
          .locator('[data-chat-session-id="scroll-a"]')
          .getAttribute("aria-current"),
        "page",
        "Opening another conversation's settings must keep the active chat",
      );
      assert.equal(
        await input.inputValue(),
        "Keep this draft while changing conversation tools",
      );
    };
    await openSettings();
    await page.keyboard.press("Escape");
    await settings.waitFor({ state: "detached" });
    assert(
      await settingsOpener.evaluate((node) => document.activeElement === node),
      "Escape must restore focus to the selected conversation's more button",
    );
    await openSettings();
    await settings.click({ position: { x: 20, y: 20 } });
    assert.equal(await settings.count(), 1, "Clicks inside must stay open");
    await page
      .locator(".modal-mask")
      .last()
      .click({
        position: { x: 10, y: 10 },
      });
    await settings.waitFor({ state: "detached" });
    assert(
      await settingsOpener.evaluate((node) => document.activeElement === node),
      "Backdrop dismissal must restore focus to its opener",
    );
    if (width <= 600) {
      await sidebar
        .locator("[data-workspace-mobile-more]")
        .getByRole("button", { name: "更多操作", exact: true })
        .click();
      await page
        .getByRole("menu", { name: "更多操作", exact: true })
        .getByRole("menuitem", { name: "返回对话", exact: true })
        .click();
      await topbar.waitFor({ state: "visible" });
      await input.waitFor({ state: "visible" });
    }

    const editOpener =
      width <= 600
        ? page.getByRole("button", { name: "更多操作", exact: true })
        : topbar.locator('[data-workspace-menu="tools"]');
    await editOpener.click();
    if (width <= 600) {
      const menu = page.getByRole("menu", { name: "更多操作", exact: true });
      await menu.getByRole("menuitem", { name: "编辑", exact: true }).click();
      await menu.waitFor({ state: "hidden" });
    }
    const edit = page.getByRole("menu", { name: "编辑", exact: true });
    await edit.waitFor();
    const shortcuts = edit;
    const rows = shortcuts.getByRole("menuitem");
    assert.equal(await rows.count(), 13);
    assert.equal(
      await rows.evaluateAll(
        (items) =>
          items.filter(
            (item) =>
              item.tagName === "BUTTON" &&
              item.hasAttribute("data-workspace-edit-action"),
          ).length,
      ),
      13,
    );
    for (const label of [
      "撤销",
      "重做",
      "剪切",
      "复制",
      "粘贴",
      "删除",
      "全选",
      "打开新聊天",
      "聚焦输入框",
      "复制最后一个代码块",
      "复制最后一个回复",
      "清除上下文",
      "设置",
    ])
      await shortcuts.getByText(label, { exact: true }).waitFor();
    assert.equal(
      await shortcuts.getByText("显示快捷键", { exact: true }).count(),
      0,
    );
    assert(
      await rows.evaluateAll((items) =>
        items.every(
          (item) =>
            item.lastElementChild?.textContent.trim() &&
            item.lastElementChild !== item.firstElementChild,
        ),
      ),
      "Each edit command must include its key combination",
    );
    assert.equal(await page.locator("[data-modal-dialog]").count(), 0);
    await page.keyboard.press("Escape");
    await edit.waitFor({ state: "hidden" });
    assert(
      await editOpener.evaluate((node) => document.activeElement === node),
      "Closing edit must restore focus to its topbar opener",
    );
    assert.equal(
      await input.inputValue(),
      "Keep this draft while changing conversation tools",
    );
    assert.deepEqual(errors, []);
    const screenshot = path.join(
      os.tmpdir(),
      `octopus-polish-composer-${width}-${theme}.png`,
    );
    await page.screenshot({ path: screenshot });
    console.log(
      JSON.stringify({ width, theme, passed: true, geometry, screenshot }),
    );
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    await run(browser, 320, "light", "reduce");
    await run(browser, 390, "dark");
    await run(browser, 768, "light");
    await run(browser, 1440, "light");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
