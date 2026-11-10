// Isolated browser profiles and synthetic model responses only.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const name =
  "这是一份用于验证文件名称缩略行为的很长很长很长的项目说明文档".repeat(4) +
  ".txt";

async function run(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    deviceScaleFactor: 2,
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await prepare(page);
    // Playwright's SW-blocking init script throws in opaque sandboxed iframes.
    // Keep isolation by disabling only the app's registration script instead.
    await page.route("**/serviceWorkerRegister.js", (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" }),
    );
    await page.addInitScript(() => {
      if (window.top !== window) return;
      const store = JSON.parse(localStorage.getItem("chat-next-web-store"));
      store.state.sessions[0].messages = [
        {
          id: "ui-user",
          role: "user",
          content: "预览交互测试",
          date: new Date().toISOString(),
        },
        {
          id: "ui-bot",
          role: "assistant",
          model: "fixture",
          content:
            '```html\n<!doctype html><html><head><title>Preview fixture</title></head><body style="margin:0;background:#e1eee8"><button onclick="this.textContent=String(++window.clicks)">Preview click</button><script>window.clicks=0</script></body></html>\n```',
          date: new Date().toISOString(),
        },
      ];
      store.state.sessions[0].mask.enableArtifacts = true;
      localStorage.setItem("chat-next-web-store", JSON.stringify(store));
      const config = JSON.parse(localStorage.getItem("app-config"));
      config.state.enableArtifacts = true;
      localStorage.setItem("app-config", JSON.stringify(config));
    });
    await page.goto(`${base}#/chat`);
    const input = page.locator("#chat-input");
    await input.waitFor();
    await page
      .getByRole("button", { name: "在侧栏预览", exact: true })
      .waitFor();
    const borderLayers = await page
      .locator('[class*="code-block"]')
      .first()
      .evaluate((block) => ({
        outer: parseFloat(getComputedStyle(block).borderTopWidth),
        bubble: parseFloat(
          getComputedStyle(block.closest('[class*="chat-message-item"]'))
            .borderTopWidth,
        ),
        pre: parseFloat(
          getComputedStyle(block.querySelector("pre")).borderTopWidth,
        ),
        copy: parseFloat(
          getComputedStyle(block.querySelector("button")).borderTopWidth,
        ),
        inset: getComputedStyle(
          block.querySelector('[class*="code-header"]'),
          "::after",
        ).left,
      }));
    assert.deepEqual(borderLayers, {
      outer: 1,
      bubble: 0,
      pre: 0,
      copy: 0,
      inset: "12px",
    });
    await input.fill("你好，候选确认不能发送");
    const ime = await input.evaluate((element) => {
      element.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      const candidate = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(candidate);
      element.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "好" }),
      );
      const committed = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(committed);
      return {
        candidateDefault: !candidate.defaultPrevented,
        trailingBlocked: committed.defaultPrevented,
      };
    });
    assert.deepEqual(ime, { candidateDefault: true, trailingBlocked: true });
    assert.equal(
      await page.evaluate(() => window.__chatScrollMock.requests.length),
      0,
    );
    assert.equal(await input.inputValue(), "你好，候选确认不能发送");

    await page.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("file fixture"),
    });
    const attachment = page
      .locator('[class*="attach-files_"]')
      .getByRole("button", {
        name: `移除 ${name}`,
        exact: true,
      });
    await attachment.waitFor();
    const filename = await attachment.evaluate((element) => {
      const stem = element.querySelector('[class*="stem_"]');
      const extension = element.querySelector('[class*="extension_"]');
      const bounds = extension.getBoundingClientRect();
      return {
        suffix: extension.textContent,
        clipped: stem.scrollWidth > stem.clientWidth,
        ellipsis: getComputedStyle(stem).textOverflow,
        visible: bounds.width > 0 && bounds.right <= innerWidth,
      };
    });
    assert.deepEqual(filename, {
      suffix: ".txt",
      clipped: true,
      ellipsis: "ellipsis",
      visible: true,
    });
    const corners = await page
      .getByRole("button", { name: "发送", exact: true })
      .evaluate((button) => {
        const parent = button.closest("label");
        const outer = getComputedStyle(parent);
        const inner = getComputedStyle(button);
        return {
          outer: parseFloat(outer.borderBottomRightRadius),
          inner: parseFloat(inner.borderBottomRightRadius),
          gap:
            parent.getBoundingClientRect().right -
            button.getBoundingClientRect().right,
          bottomGap:
            parent.getBoundingClientRect().bottom -
            button.getBoundingClientRect().bottom,
          stroke: parseFloat(inner.borderTopWidth),
        };
      });
    assert.equal(corners.outer, corners.inner + corners.gap);
    assert.equal(corners.gap, corners.bottomGap);
    assert.equal(corners.stroke, 0);
    await page.screenshot({
      path: `${process.env.TEMP}/octopus-ui-rules-${width}-chat.png`,
    });
    await page.getByRole("button", { name: "在侧栏预览", exact: true }).click();
    const preview = page.getByRole("region", { name: "侧栏预览", exact: true });
    await preview.waitFor();
    const frame = preview.frameLocator("iframe");
    await frame
      .getByRole("button", { name: "Preview click", exact: true })
      .waitFor();
    if (width > 800) {
      const divider = page.getByRole("separator", {
        name: "调整聊天与预览宽度",
      });
      const parent = divider.locator("..");
      assert.equal(
        await parent.evaluate((element) => getComputedStyle(element).display),
        "grid",
      );
      const split = await parent.boundingBox();
      const chatPane = await parent
        .locator(":scope > div")
        .first()
        .boundingBox();
      const previewPane = await preview.boundingBox();
      assert(Math.abs(chatPane.width - previewPane.width) < 1);
      const start = await divider.boundingBox();
      await page.mouse.move(start.x + start.width / 2, start.y + 140);
      await page.mouse.down();
      await page.mouse.move(split.x + split.width * 0.65, start.y + 140, {
        steps: 8,
      });
      await page.getByTestId("preview-drag-mask").waitFor();
      assert.equal(
        await preview
          .locator("iframe")
          .evaluate((element) => getComputedStyle(element).pointerEvents),
        "none",
      );
      await page.keyboard.press("Escape");
      await page.mouse.up();
      assert.equal(await divider.getAttribute("aria-valuenow"), "50");
      assert.equal(await page.getByTestId("preview-drag-mask").count(), 0);
      await divider.press("ArrowRight");
      await divider.dblclick();
      assert.equal(await divider.getAttribute("aria-valuenow"), "50");
      assert.equal(
        await frame.locator("body").evaluate(() => window.clicks),
        0,
      );
      await page.screenshot({
        path: `${process.env.TEMP}/octopus-ui-rules-${width}-split.png`,
      });
      const next = await divider.boundingBox();
      await page.mouse.move(next.x + next.width / 2, next.y + 140);
      await page.mouse.down();
      await page.mouse.move(split.x + split.width * 0.85, next.y + 140, {
        steps: 8,
      });
      await page.mouse.up();
      await preview.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "在侧栏预览", exact: true })
        .click();
    } else {
      assert.equal(await page.getByRole("separator").isVisible(), false);
      const bounds = await preview.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      await page.screenshot({
        path: `${process.env.TEMP}/octopus-ui-rules-${width}-split.png`,
      });
    }
    await page.getByRole("button", { name: "关闭预览", exact: true }).click();
    await preview.waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), "你好，候选确认不能发送");
    await attachment.click();
    await input.press("Enter");
    await page.waitForFunction(
      () => window.__chatScrollMock.flows.length === 1,
    );
    assert.equal(
      await page.evaluate(() => window.__chatScrollMock.requests.length),
      1,
    );
    await page.evaluate(() => window.__chatScrollMock.finish(0));
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        imeGuard: true,
        extensionVisible: true,
        concentricCorners: true,
        splitInteractions: width > 800,
        mobilePreviewClose: width <= 800,
        paidRequests: 0,
      }),
    );
  } finally {
    await context.close();
  }
}
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) await run(browser, width);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
