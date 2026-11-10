// Isolated browser state and existing API fixtures; no real model requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
process.env.UI_TEST_URL = base;
const { prepare } = require("./verify-chat-scroll.cjs");
const output =
  process.env.UI_TEST_OUTPUT_DIR ||
  path.join(os.tmpdir(), "octopus-interaction-surfaces");
const probeColor = "rgb(216, 220, 224)";
const probeText = "rgb(65, 79, 93)";
const themes = process.env.UI_TEST_THEMES?.split(",") || ["light", "dark"];
const widths = process.env.UI_TEST_WIDTHS?.split(",").map(Number) || [
  1440, 390,
];
const names = {
  general: "\u901a\u7528\u8bbe\u7f6e",
  theme: "\u4e3b\u9898",
  sendKey: "\u53d1\u9001\u952e",
  model: "\u9009\u62e9\u6a21\u578b:",
  upload: "\u4e0a\u4f20\u53c2\u8003\u5185\u5bb9",
};

async function checkSurface(locator, color, description) {
  await locator.page().waitForFunction(
    ({ selector, color }) => {
      const element = document.querySelector(selector);
      return element && getComputedStyle(element).backgroundColor === color;
    },
    {
      selector: await locator.evaluate((element) => {
        element.dataset.surfaceProbe = "current";
        return '[data-surface-probe="current"]';
      }),
      color,
    },
    { timeout: 5000 },
  );
  const actual = await locator.evaluate((element) => {
    delete element.dataset.surfaceProbe;
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, shadow: style.boxShadow };
  });
  assert.deepEqual(actual, { background: color, shadow: "none" }, description);
}

async function checkFeedbackSurface(locator, color, description) {
  const selector = await locator.evaluate((element) => {
    element.dataset.feedbackProbe = "current";
    return '[data-feedback-probe="current"]';
  });
  await locator.page().waitForFunction(
    ({ selector, color }) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const style = getComputedStyle(element);
      const before = getComputedStyle(element, "::before");
      const layers = [
        style.backgroundColor,
        before.content === "none" ? "transparent" : before.backgroundColor,
      ].filter(
        (background) =>
          !["transparent", "rgba(0, 0, 0, 0)"].includes(background),
      );
      return color === "transparent"
        ? layers.length === 0
        : layers.length === 1 && layers[0] === color;
    },
    { selector, color },
    { timeout: 5000 },
  );
  const shadows = await locator.evaluate((element) => {
    delete element.dataset.feedbackProbe;
    return [
      getComputedStyle(element).boxShadow,
      getComputedStyle(element, "::before").boxShadow,
    ];
  });
  assert.deepEqual(shadows, ["none", "none"], description);
}

async function checkForeground(locator, color, description) {
  const selector = await locator.evaluate((element) => {
    element.dataset.foregroundProbe = "current";
    return '[data-foreground-probe="current"]';
  });
  await locator.page().waitForFunction(
    ({ selector, color }) => {
      const element = document.querySelector(selector);
      return element && getComputedStyle(element).color === color;
    },
    { selector, color },
    { timeout: 5000 },
  );
  const actual = await locator.evaluate((element) => {
    delete element.dataset.foregroundProbe;
    return getComputedStyle(element).color;
  });
  assert.equal(actual, color, description);
}

async function setProbe(page, enabled) {
  await page.evaluate(
    ({ enabled, color, text }) => {
      if (enabled) {
        document.body.style.setProperty("--state-hover-surface", color);
        document.body.style.setProperty("--state-hover-text", text);
      } else {
        document.body.style.removeProperty("--state-hover-surface");
        document.body.style.removeProperty("--state-hover-text");
      }
    },
    { enabled, color: probeColor, text: probeText },
  );
}

async function run(browser, width, theme, imageOnly = false) {
  const context = await browser.newContext({
    viewport: { width, height: 960 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await prepare(page);
    await page.addInitScript(
      ({ theme, imageOnly }) => {
        const config = JSON.parse(localStorage.getItem("app-config"));
        Object.assign(config.state, {
          theme,
          colorTheme: "rose",
          fontSize: 13,
        });
        localStorage.setItem("app-config", JSON.stringify(config));
        const chat = JSON.parse(localStorage.getItem("chat-next-web-store"));
        chat.state.sessions[0].mask.modelConfig.model = imageOnly
          ? "gpt-image-2"
          : "gpt-6-astra";
        chat.state.sessions[0].mask.modelConfig.providerName = imageOnly
          ? "gpt"
          : "\u672c\u5730\u9884\u89c8";
        localStorage.setItem("chat-next-web-store", JSON.stringify(chat));
      },
      { theme, imageOnly },
    );
    const neutral =
      theme === "light" ? "rgb(239, 239, 239)" : "rgb(44, 44, 46)";
    const foreground =
      theme === "light" ? "rgb(38, 38, 41)" : "rgb(230, 230, 235)";
    if (imageOnly) {
      await page.goto(`${base}#/chat`);
      const parameterId = await page
        .getByRole("button", {
          name: /^\u751f\u56fe\u53c2\u6570/,
        })
        .getAttribute("aria-controls");
      assert.ok(
        parameterId,
        "image parameters must be linked to their trigger",
      );
      const imageTrigger = page.locator(
        `button[aria-controls=${JSON.stringify(parameterId)}]`,
      );
      await imageTrigger.click();
      const panel = page.locator(`[id=${JSON.stringify(parameterId)}]:visible`);
      const reset = page
        .getByRole("button", { name: "\u91cd\u7f6e", exact: true })
        .filter({ visible: true });
      const ratio = panel.getByRole("button", { name: /^\u6bd4\u4f8b\uff1a/ });
      const resolution = panel
        .getByRole("radiogroup", { name: "\u5206\u8fa8\u7387", exact: true })
        .locator("input:checked + span");
      await checkForeground(
        imageTrigger,
        foreground,
        "image parameter open text",
      );
      await checkForeground(reset, foreground, "image reset resting text");
      await checkFeedbackSurface(
        imageTrigger,
        neutral,
        "image parameter open surface",
      );
      await setProbe(page, true);
      await checkForeground(
        imageTrigger,
        probeText,
        "image parameter shared text",
      );
      await checkForeground(
        imageTrigger.locator("svg"),
        probeText,
        "image parameter icon inherits shared text",
      );
      await checkFeedbackSurface(
        imageTrigger,
        probeColor,
        "image parameter shared surface",
      );
      await reset.hover();
      await checkSurface(reset, probeColor, "image reset shared surface");
      await checkForeground(reset, probeText, "image reset shared text");
      await ratio.hover();
      await checkSurface(ratio, probeColor, "image ratio shared surface");
      for (const control of [
        ratio,
        resolution,
        ...(await ratio.locator("span, svg").all()),
      ]) {
        await checkForeground(
          control,
          probeText,
          "image ratio/resolution shared text",
        );
      }
      await checkSurface(
        resolution,
        probeColor,
        "image resolution shared surface",
      );
      const quality = panel.locator(
        '[data-select-trigger][aria-label="\u753b\u8d28"]',
      );
      await quality.click();
      await checkSurface(quality, probeColor, "image quality open surface");
      await checkForeground(quality, probeText, "image quality open text");
      await checkForeground(
        quality.locator("svg"),
        probeText,
        "image quality open icon",
      );
      const qualitySelection = page
        .getByRole("listbox")
        .locator('[role="option"][data-state="checked"]');
      await checkSurface(
        qualitySelection,
        probeColor,
        "image quality selection shared surface",
      );
      await checkForeground(
        qualitySelection,
        probeText,
        "image quality selection shared text",
      );
      await page.keyboard.press("Escape");
      await setProbe(page, false);
      await page.mouse.move(0, 0);
      await checkForeground(
        imageTrigger,
        foreground,
        "image parameter foreground restores",
      );
      await page.screenshot({
        path: path.join(output, `image-${theme}-${width}.png`),
      });
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      console.log(
        `${theme}/${width}: image parameter trigger, reset, ratio, resolution and quality share surface/text/icon variables`,
      );
      return;
    }
    await page.goto(`${base}#/settings`);
    const general = page.getByRole("tab", { name: names.general, exact: true });
    await general.click();
    const group = page.getByRole("radiogroup", {
      name: names.theme,
      exact: true,
      includeHidden: true,
    });
    await group.waitFor();
    const selected = group.locator("input:checked + span");
    await checkSurface(selected, neutral, "segmented selection");
    await checkForeground(selected, foreground, "segmented foreground");
    assert.equal(
      await group
        .locator(":scope > div")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
      "the segment wrapper must not add another background",
    );
    const neighbor = group.locator("input:not(:checked)").first();
    await neighbor.hover();
    await checkSurface(
      neighbor.locator("+ span"),
      neutral,
      "segment hover equals selection",
    );
    await page.mouse.move(0, 0);
    await checkSurface(
      neighbor.locator("+ span"),
      "rgba(0, 0, 0, 0)",
      "unselected feedback clears when the pointer leaves",
    );
    await page.screenshot({
      path: path.join(output, `settings-${theme}-${width}.png`),
    });

    await page
      .getByRole("combobox", { name: names.sendKey, exact: true })
      .click();
    const listbox = page.getByRole("listbox");
    const checked = listbox.locator('[role="option"][data-state="checked"]');
    const unchecked = listbox
      .locator('[role="option"]:not([data-state="checked"])')
      .first();
    await checkSurface(checked, neutral, "dropdown selection");
    await checkForeground(checked, foreground, "dropdown selected foreground");
    await unchecked.hover();
    await checkSurface(unchecked, neutral, "dropdown hover equals selection");
    await setProbe(page, true);
    await checkSurface(
      checked,
      probeColor,
      "dropdown uses the shared variable",
    );
    await checkSurface(
      unchecked,
      probeColor,
      "dropdown hover uses the shared variable",
    );
    await checkSurface(
      selected,
      probeColor,
      "segments use the same variable as dropdowns",
    );
    for (const control of [selected, checked, unchecked]) {
      await checkForeground(
        control,
        probeText,
        "settings feedback uses the shared text variable",
      );
    }
    await setProbe(page, false);
    await page.keyboard.press("Escape");
    await listbox.waitFor({ state: "hidden" });

    await page.goto(`${base}#/chat`);
    await page
      .getByRole("button", { name: new RegExp(`^${names.model}`) })
      .click();
    const dialog = page.locator("dialog[open]");
    const selectedModel = dialog.locator(
      '[class*="model-select-item_"]:has(button[aria-pressed="true"])',
    );
    const selectedGroup = dialog.locator(
      'button[class*="model-select-group-item"][aria-pressed="true"]',
    );
    await checkSurface(selectedModel, neutral, "model selection");
    await checkSurface(selectedGroup, neutral, "vendor selection");
    await checkForeground(selectedGroup, foreground, "selected vendor text");
    const anotherModel = dialog
      .locator('button[class*="model-select-option"][aria-pressed="false"]')
      .first();
    const anotherRow = anotherModel.locator("../..");
    await anotherModel.hover();
    await checkSurface(anotherRow, neutral, "model hover equals selection");
    await setProbe(page, true);
    await checkSurface(
      selectedModel,
      probeColor,
      "model selection uses the shared variable",
    );
    await checkSurface(
      selectedGroup,
      probeColor,
      "vendor selection uses the shared variable",
    );
    await checkSurface(
      anotherRow,
      probeColor,
      "model hover uses the shared variable",
    );
    for (const control of [
      selectedModel,
      selectedModel.locator('[class*="model-select-item-name"]'),
      selectedGroup,
      selectedGroup.locator('[class*="group-name"]'),
      selectedGroup.locator('[class*="group-count"]'),
      anotherRow.locator('[class*="model-select-item-name"]'),
    ]) {
      await checkForeground(
        control,
        probeText,
        "model and vendor labels inherit the shared feedback text",
      );
    }
    const source = dialog.locator(
      'button[aria-controls="model-source-options"]',
    );
    await source.click();
    const sourceSelection = dialog.locator(
      '#model-source-options button[aria-pressed="true"]',
    );
    await checkSurface(
      sourceSelection,
      probeColor,
      "account model group uses the shared variable",
    );
    await checkForeground(
      sourceSelection,
      probeText,
      "account model group uses the shared text variable",
    );
    await sourceSelection.press("Escape");
    await setProbe(page, false);
    await dialog.getByText("\u9009\u62e9\u6a21\u578b", { exact: true }).click();
    await page.mouse.move(0, 0);
    await checkSurface(
      selectedModel,
      neutral,
      "model selection restores its theme",
    );
    await page.screenshot({
      path: path.join(output, `models-${theme}-${width}.png`),
    });

    await page.goto(`${base}#/video-workspace`);
    const upload = page.getByRole("button", {
      name: names.upload,
      exact: true,
    });
    await upload.hover();
    await checkSurface(upload, neutral, "video upload hover stays neutral");
    assert.equal(
      await upload
        .locator('[class*="material-entry-inner"]')
        .evaluate((element) => getComputedStyle(element).color),
      theme === "light" ? "rgb(38, 38, 41)" : "rgb(230, 230, 235)",
      "video upload text must not take the skin's accent on hover",
    );
    await setProbe(page, true);
    await checkSurface(
      upload,
      probeColor,
      "video upload hover uses the shared variable",
    );
    await checkForeground(
      upload.locator('[class*="material-entry-inner"]'),
      probeText,
      "video upload label inherits the shared feedback text",
    );
    await setProbe(page, false);
    await page.mouse.move(0, 0);
    await checkSurface(
      upload,
      "rgba(0, 0, 0, 0)",
      "video upload feedback clears when the pointer leaves",
    );

    const capsules = page.locator(
      'button[class*="capsule-btn"][aria-expanded]:visible',
    );
    const capsuleCount = await capsules.count();
    assert.ok(capsuleCount > 0, "video controls must be available");
    for (let index = 0; index < capsuleCount; index++) {
      const capsule = capsules.nth(index);
      const label = await capsule.getAttribute("aria-label");
      const restingColor = await capsule.evaluate((element) => {
        const background = getComputedStyle(element).backgroundColor;
        const before = getComputedStyle(element, "::before");
        if (background !== "rgba(0, 0, 0, 0)") return background;
        return before.content !== "none" &&
          before.backgroundColor !== "rgba(0, 0, 0, 0)"
          ? before.backgroundColor
          : "transparent";
      });
      await capsule.hover();
      await page.mouse.down();
      await checkFeedbackSurface(capsule, neutral, `${label}: pressed`);
      await checkForeground(capsule, foreground, `${label}: pressed text`);
      await page.mouse.up();
      assert.equal(await capsule.getAttribute("aria-expanded"), "true");
      await page.mouse.move(0, 0);
      await checkFeedbackSurface(
        capsule,
        neutral,
        `${label}: open without hover`,
      );
      await checkForeground(capsule, foreground, `${label}: open text`);
      await setProbe(page, true);
      await checkFeedbackSurface(
        capsule,
        probeColor,
        `${label}: open uses shared selection variable`,
      );
      await checkForeground(
        capsule,
        probeText,
        `${label}: open uses shared text variable`,
      );
      for (const child of await capsule.locator("span, svg").all()) {
        await checkForeground(
          child,
          probeText,
          `${label}: nested labels and icons inherit feedback text`,
        );
      }
      await setProbe(page, false);
      await page.keyboard.press("Escape");
      assert.equal(await capsule.getAttribute("aria-expanded"), "false");
      await page.mouse.move(0, 0);
      await checkFeedbackSurface(
        capsule,
        restingColor,
        `${label}: closed without stale feedback`,
      );
    }
    assert.equal(
      await page.locator('[class*="capsule-popup"]').count(),
      0,
      "all video parameter popovers must close",
    );
    const videoSettings = page.getByLabel("\u89c6\u9891\u8bbe\u7f6e", {
      exact: true,
    });
    await videoSettings.click();
    await page.mouse.move(0, 0);
    await checkFeedbackSurface(
      videoSettings,
      neutral,
      "video settings open without hover",
    );
    await checkForeground(
      videoSettings,
      foreground,
      "video settings open text",
    );
    await checkForeground(
      videoSettings.locator("svg"),
      foreground,
      "video settings open icon",
    );
    await setProbe(page, true);
    await checkFeedbackSurface(
      videoSettings,
      probeColor,
      "video settings open uses the shared selection variable",
    );
    await checkForeground(
      videoSettings,
      probeText,
      "video settings open uses the shared text variable",
    );
    await checkForeground(
      videoSettings.locator("svg"),
      probeText,
      "video settings icon inherits the shared text variable",
    );
    await setProbe(page, false);
    await page
      .getByRole("textbox", { name: "\u89c6\u9891\u63d0\u793a\u8bcd" })
      .click();
    assert.equal(await videoSettings.getAttribute("aria-expanded"), "false");
    await page.screenshot({
      path: path.join(output, `video-${theme}-${width}.png`),
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "the page must not overflow horizontally",
    );
    assert.deepEqual(errors, []);
    console.log(
      `${theme}/${width}: shared surfaces/text/icons, hover/pressed/open/closed states and single feedback layer passed (${capsuleCount} video controls)`,
    );
  } catch (error) {
    await page.screenshot({
      path: path.join(output, `failure-${theme}-${width}.png`),
    });
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_TEST_BROWSER
      ? { channel: process.env.UI_TEST_BROWSER }
      : {}),
  });
  try {
    for (const theme of themes)
      for (const width of widths) {
        await run(browser, width, theme);
        await run(browser, width, theme, true);
      }
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
