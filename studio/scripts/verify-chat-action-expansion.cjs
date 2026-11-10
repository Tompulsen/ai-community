// Isolated local regression; every API and model response is a fixture.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");

const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const action = 'button[class*="chat-input-action_"]';
const failures = [];
const screenshots = [];

async function check(name, run) {
  try {
    await run();
    process.stdout.write(JSON.stringify({ name, passed: true }) + "\n");
  } catch (error) {
    failures.push({ name, message: error.message });
    console.error(
      JSON.stringify({ name, passed: false, error: error.message }),
    );
  }
}

async function geometry(button) {
  return button.evaluate((node) => {
    const text = node.querySelector('[class*="text_"]');
    const icon = node.querySelector('[class*="icon_"]');
    const rect = node.getBoundingClientRect();
    const label = text.getBoundingClientRect();
    const glyph = icon.getBoundingClientRect();
    const css = getComputedStyle(text);
    return {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      textWidth: label.width,
      textLeft: label.left,
      textRight: label.right,
      iconLeft: glyph.left,
      opacity: Number(css.opacity),
      display: css.display,
      focusVisible: node.matches(":focus-visible"),
    };
  });
}

async function settled(page) {
  await page.waitForTimeout(450);
}

function expanded(before, after, name) {
  assert(after.width > before.width + 8, "Action width must expand");
  assert(after.textWidth > 5 && after.opacity > 0.9, "Label must be revealed");
  if (name === "header")
    assert(
      after.textRight <= after.iconLeft + 1,
      "Header text must expand left of icon",
    );
  else
    assert(
      after.textLeft >= after.iconLeft + 15,
      "Composer label must follow its icon",
    );
}

async function open(browser, options) {
  const context = await browser.newContext({
    viewport: { width: options.width || 1440, height: 900 },
    serviceWorkers: "block",
    ...options,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await prepare(page);
  await page.route("**/*", (route) =>
    route.request().headers()["next-action"]
      ? route.fulfill({
          status: 503,
          body: "Fixture: optional MCP unavailable",
        })
      : route.fallback(),
  );
  await page.addInitScript(() => {
    const Reader = window.FileReader;
    window.__actionUploadReads = [];
    window.FileReader = class extends Reader {
      readAsDataURL(blob) {
        window.__actionUploadReads.push(() => super.readAsDataURL(blob));
      }
    };
  });
  await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
  await page.locator("#chat-input").waitFor();
  await settled(page);
  return { context, page, errors };
}

async function screenshot(page, name) {
  const file = path.join(os.tmpdir(), `octopus-chat-action-${name}.png`);
  await page.screenshot({ path: file });
  screenshots.push(file);
}

async function desktop(browser, reducedMotion = "no-preference") {
  const { context, page, errors } = await open(browser, { reducedMotion });
  try {
    for (const [name, scope] of [
      ["header", '[class*="chat-header-actions_"]'],
      ["composer", '[class*="chat-input-panel_"] [class*="composer-toolbar_"]'],
    ]) {
      const button = page.locator(`${scope} ${action}`).first();
      await check(`${reducedMotion}-${name}-hover`, async () => {
        await page.mouse.move(5, 5);
        await page.locator("#chat-input").focus();
        await settled(page);
        const before = await geometry(button);
        await button.hover();
        await settled(page);
        const after = await geometry(button);
        await screenshot(page, `${reducedMotion}-${name}-expanded`);
        expanded(before, after, name);
        process.stdout.write(
          JSON.stringify({
            name: `${reducedMotion}-${name}-geometry`,
            before,
            after,
          }) + "\n",
        );
        if (name === "header")
          assert(
            Math.abs(after.right - before.right) < 2,
            "Header right edge must remain anchored",
          );
        await page.mouse.move(5, 5);
        await settled(page);
        assert(
          Math.abs((await geometry(button)).width - before.width) < 2,
          "Mouse exit must collapse",
        );
      });
      await check(`${reducedMotion}-${name}-keyboard`, async () => {
        await page.mouse.move(5, 5);
        await page.locator("#chat-input").focus();
        await settled(page);
        const before = await geometry(button);
        await page.keyboard.press("Tab");
        await button.focus();
        await settled(page);
        const after = await geometry(button);
        assert(after.focusVisible, "Keyboard focus must be visibly indicated");
        expanded(before, after, name);
        await page.locator("#chat-input").focus();
        await settled(page);
        assert(
          Math.abs((await geometry(button)).width - before.width) < 2,
          "Blur must collapse",
        );
      });
      await check(`${reducedMotion}-${name}-rapid-hover`, async () => {
        await page.locator("#chat-input").focus();
        await page.mouse.move(5, 5);
        await settled(page);
        const before = await geometry(button);
        for (let index = 0; index < 6; index++) {
          await button.hover();
          await page.mouse.move(5, 5);
        }
        await settled(page);
        assert(
          Math.abs((await geometry(button)).width - before.width) < 2,
          "Rapid pointer exit must not leave label open",
        );
      });
    }
    await check(`${reducedMotion}-show-label`, async () => {
      const labeled = page
        .locator('button[class*="chat-input-action-labeled_"]')
        .first();
      await page.mouse.move(5, 5);
      await page.locator("#chat-input").focus();
      await settled(page);
      const before = await geometry(labeled);
      assert(
        before.textWidth > 5 &&
          before.opacity > 0.9 &&
          before.display !== "none",
      );
      await labeled.hover();
      await settled(page);
      await page.mouse.move(5, 5);
      await settled(page);
      const after = await geometry(labeled);
      assert(
        after.textWidth > 5 && after.opacity > 0.9,
        "showLabel must remain visible after hover exit",
      );
    });
    if (reducedMotion === "reduce") {
      await check("reduced-motion-no-running-animation", async () => {
        const button = page
          .locator(`[class*="chat-header-actions_"] ${action}`)
          .first();
        await button.hover();
        const running = await button.evaluate(
          (node) =>
            node.getAnimations({ subtree: true }).filter((animation) => {
              const timing = animation.effect.getComputedTiming();
              return (
                animation.playState === "running" && Number(timing.duration) > 1
              );
            }).length,
        );
        assert.equal(running, 0);
      });
    } else {
      await check("app-reduced-motion-no-running-animation", async () => {
        await page.evaluate(() => document.body.classList.add("reduce-motion"));
        const button = page
          .locator(`[class*="chat-header-actions_"] ${action}`)
          .first();
        await page.mouse.move(5, 5);
        await page.locator("#chat-input").focus();
        await settled(page);
        const before = await geometry(button);
        await button.hover();
        await settled(page);
        expanded(before, await geometry(button), "header");
        assert.equal(
          await button.evaluate(
            (node) =>
              node
                .getAnimations({ subtree: true })
                .filter(
                  (animation) =>
                    animation.playState === "running" &&
                    Number(animation.effect.getComputedTiming().duration) > 1,
                ).length,
          ),
          0,
        );
        await page.evaluate(() =>
          document.body.classList.remove("reduce-motion"),
        );
      });
    }
    assert.deepEqual(errors, [], "Unexpected page error");
  } finally {
    await context.close();
  }
}

async function mobile(browser) {
  const { context, page, errors } = await open(browser, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await check("390px-coarse-no-overflow", async () => {
      assert(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      );
      const overflow = await page.evaluate(
        (selector) => ({
          page: document.documentElement.scrollWidth > innerWidth + 1,
          actions: [...document.querySelectorAll(selector)]
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.width && (rect.left < -1 || rect.right > innerWidth + 1)
              );
            })
            .map((node) => node.getAttribute("aria-label")),
        }),
        action,
      );
      assert.equal(overflow.page, false);
      assert.deepEqual(overflow.actions, []);
      const labeled = page
        .locator('button[class*="chat-input-action-labeled_"]')
        .first();
      assert((await geometry(labeled)).textWidth > 5);
      await screenshot(page, "390px-touch");
    });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function dynamicLabel(browser, keyboard) {
  const name = keyboard ? "dynamic-label-keyboard" : "dynamic-label-pointer";
  const { context, page, errors } = await open(browser, {
    viewport: { width: 1100, height: 900 },
  });
  try {
    await check(name, async () => {
      const button = page
        .locator('[class*="chat-header-actions_"]')
        .getByRole("button", { name: /^(退出)?全屏$/ });
      if (keyboard) {
        await page.mouse.move(5, 5);
        await page.keyboard.press("Tab");
        await button.focus();
      } else {
        await button.hover();
        // Isolate label remeasurement while fullscreen moves the whole header.
        const cdp = await context.newCDPSession(page);
        await cdp.send("DOM.enable");
        await cdp.send("CSS.enable");
        const { root } = await cdp.send("DOM.getDocument");
        const { nodeId } = await cdp.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector: `button[aria-label="${await button.getAttribute(
            "aria-label",
          )}"]`,
        });
        await cdp.send("CSS.forcePseudoState", {
          nodeId,
          forcedPseudoClasses: ["hover"],
        });
      }
      await settled(page);
      const before = await geometry(button);
      const oldLabel = await button.getAttribute("aria-label");
      if (keyboard) await button.press("Space");
      else {
        const rect = await button.boundingBox();
        await page.mouse.click(
          rect.x + rect.width - 10,
          rect.y + rect.height / 2,
        );
      }
      await page.waitForFunction(
        (label) => !document.querySelector(`button[aria-label="${label}"]`),
        oldLabel,
      );
      await settled(page);
      const after = await geometry(button);
      assert.notEqual(await button.getAttribute("aria-label"), oldLabel);
      assert(
        await button.evaluate(
          (node, keyboard) =>
            node.matches(keyboard ? ":focus-visible" : ":hover"),
          keyboard,
        ),
        "Interaction must remain active without another enter/focus event",
      );
      assert(after.opacity > 0.9);
      assert(
        after.textLeft >= after.left - 1 && after.textRight <= after.right + 1,
        "Changed label must fit entirely inside the expanded button",
      );
      assert(after.textRight <= after.iconLeft + 1);
      const textDelta = after.textWidth - before.textWidth;
      assert(
        Math.abs(after.width - before.width - textDelta) < 2,
        "Expanded width must track the changed label width",
      );
      await screenshot(page, name);
      process.stdout.write(
        JSON.stringify({ name: `${name}-geometry`, oldLabel, before, after }) +
          "\n",
      );
      assert.deepEqual(errors, []);
    });
  } finally {
    await context.close();
  }
}

async function appendUpload(browser, touch) {
  const name = touch ? "append-upload-390px-touch" : "append-upload-desktop";
  const { context, page, errors } = await open(
    browser,
    touch
      ? {
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        }
      : {},
  );
  try {
    await check(name, async () => {
      const upload = page.getByRole("button", {
        name: "上传素材",
        exact: true,
      });
      const panel = page.locator('[class*="chat-input-panel_"]');
      const input = page.locator("#chat-input");
      await input.fill("Keep both materials in this draft");
      const baseline = await page.evaluate(() => ({
        requests: window.__chatScrollMock.requests.length,
        history: localStorage.getItem("chat-next-web-store"),
      }));
      const buffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
        "base64",
      );
      for (const filename of ["append-first.png", "append-second.png"]) {
        const chooserPromise = page.waitForEvent("filechooser");
        await upload.click();
        const chooser = await chooserPromise;
        await chooser.setFiles({
          name: filename,
          mimeType: "image/png",
          buffer,
        });
        await panel.getByText(filename, { exact: true }).waitFor();
        await page.waitForFunction(
          () => window.__actionUploadReads.length === 1,
        );
        assert(await upload.isEnabled(), "Busy upload must stay interactive");
        assert.equal(await upload.getAttribute("aria-busy"), "true");
      }
      assert.equal(
        await page.evaluate(() => window.__actionUploadReads.length),
        1,
        "Second material must wait in the serial queue",
      );
      await page.evaluate(() => window.__actionUploadReads[0]());
      await page.waitForFunction(
        () =>
          window.__actionUploadReads.length === 2 &&
          document.querySelectorAll('[class*="attach-images_"] > div')
            .length === 1,
      );
      assert(await upload.isEnabled());
      assert.equal(await upload.getAttribute("aria-busy"), "true");
      await page.evaluate(() => window.__actionUploadReads[1]());
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[class*="attach-images_"] > div')
            .length === 2 &&
          !document
            .querySelector('button[aria-label="上传素材"]')
            .hasAttribute("aria-busy"),
      );
      assert.equal(
        await panel.locator('[class*="attach-images_"] > div').count(),
        2,
      );
      assert.equal(await panel.locator("[data-material-status]").count(), 0);
      assert.equal(
        await panel.locator('[data-file-status="failed"]').count(),
        0,
      );
      assert.equal(
        await input.inputValue(),
        "Keep both materials in this draft",
      );
      const after = await page.evaluate(() => ({
        requests: window.__chatScrollMock.requests.length,
        history: localStorage.getItem("chat-next-web-store"),
      }));
      assert.deepEqual(after, baseline, "Uploading must not send a message");
      assert.deepEqual(errors, []);
      await screenshot(page, name);
    });
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    if (process.env.UI_TEST_SCENARIO === "append-upload") {
      await appendUpload(browser, false);
      await appendUpload(browser, true);
    } else {
      if (process.env.UI_TEST_SCENARIO !== "dynamic-label") {
        await desktop(browser);
        await desktop(browser, "reduce");
        await mobile(browser);
        await appendUpload(browser, false);
        await appendUpload(browser, true);
      }
      await dynamicLabel(browser, false);
      await dynamicLabel(browser, true);
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(
    JSON.stringify({ failures, screenshots, mocked: true }) + "\n",
  );
  if (failures.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
