// Run against a local development server with a Playwright installation.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";

async function visit(page, route) {
  await page.goto(`${base}#${route}`);
  await page.waitForTimeout(500);
}

async function checkFields(scope, description) {
  const number = scope.getByRole("spinbutton", {
    name: "\u5386\u53f2\u6d88\u606f\u957f\u5ea6\u538b\u7f29\u9608\u503c",
    exact: true,
  });
  await number.scrollIntoViewIfNeeded();
  assert.equal(await number.inputValue(), "512000");
  const dimensions = await number.evaluate((element) => {
    const style = getComputedStyle(element);
    const row = element.parentElement.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const canvas = document.createElement("canvas").getContext("2d");
    canvas.font = `${style.fontSize} ${style.fontFamily}`;
    return {
      height: rect.height,
      radius: style.borderRadius,
      fits:
        canvas.measureText(element.value).width +
          parseFloat(style.paddingLeft) +
          parseFloat(style.paddingRight) +
          20 <
        element.clientWidth,
      inside: rect.left >= row.left && rect.right <= row.right,
    };
  });
  assert.equal(dimensions.height, 36);
  assert.equal(dimensions.radius, "10px");
  assert(dimensions.fits && dimensions.inside, JSON.stringify(dimensions));
  await number.focus();
  assert.equal(await number.evaluate((el) => getComputedStyle(el).boxShadow), "none");

  const checkbox = scope.locator('input[type="checkbox"]').first();
  await checkbox.scrollIntoViewIfNeeded();
  const before = await checkbox.isChecked();
  await checkbox.click();
  assert.equal(await checkbox.isChecked(), !before);
  assert.equal(
    await checkbox.evaluate((el) => getComputedStyle(el, "::after").content),
    "none",
  );
  await checkbox.click();

  const overflow = await scope.evaluate((root) =>
    [...root.querySelectorAll('input:not([type="range"]), textarea, select, button[class*="constrained"]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const parent = element.closest('[class*="list-item_"]') ?? element.parentElement;
        const bounds = parent.getBoundingClientRect();
        return rect.width && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
      })
      .map((element) => element.getAttribute("aria-label") || element.tagName),
  );
  assert.deepEqual(overflow, []);
  console.log(`${description}: dimensions, six-digit value, focus, toggle and overflow passed`);
}

async function checkPrompts(page) {
  await visit(page, "/settings");
  await page.getByRole("button", {
    name: "\u81ea\u5b9a\u4e49\u63d0\u793a\u8bcd\u5217\u8868\u7f16\u8f91",
    exact: true,
  }).click();
  const search = page.getByRole("textbox", { name: "\u641c\u7d22\u63d0\u793a\u8bcd", exact: true });
  await search.waitFor();
  const fullWidth = (element) =>
    element.offsetWidth / element.parentElement.clientWidth > 0.95;
  assert(await search.evaluate(fullWidth), "prompt search must use full width");
  await page.getByRole("button", { name: "\u65b0\u5efa", exact: true }).click();
  const title = page.getByRole("textbox", { name: "\u7f16\u8f91\u63d0\u793a\u8bcd", exact: true });
  await title.waitFor();
  assert(await title.evaluate(fullWidth), "prompt title must use full width");
  await title.fill("A long prompt title");
  assert.equal(await title.inputValue(), "A long prompt title");
  await page.keyboard.press("Escape");
}

(async () => {
  const browser = await chromium.launch({
    ...(process.env.UI_TEST_BROWSER ? { channel: process.env.UI_TEST_BROWSER } : {}),
    headless: true,
  });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.addInitScript(() => localStorage.setItem("lang", "cn"));
      await page.route("**/api/**", (route) => route.fulfill({
        json: { data: [], enabled: false, needCode: false },
      }));
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await visit(page, "/settings");
      const settings = page.locator('[class*="settings_"]').first();
      await settings.waitFor();
      await checkFields(settings, `${width} settings`);
      const language = page.getByRole("combobox", { name: "\u8bed\u8a00", exact: true });
      assert.equal(await language.evaluate((el) => el.getBoundingClientRect().height), 36);
      assert.equal(await language.evaluate((el) => getComputedStyle(el).backgroundImage), "none");

      await page.getByRole("button", { name: "\u914d\u8272\u76ae\u80a4", exact: true }).click();
      const skin = page.getByRole("button", { name: "\u7fe1\u7fe0\u7eff", exact: true });
      await skin.click();
      await page.waitForFunction(() => {
        const button = document.querySelector('button[aria-pressed="true"]');
        return button && getComputedStyle(button).borderTopColor === "rgb(5, 150, 105)";
      });
      assert.equal(await skin.getAttribute("aria-pressed"), "true");
      assert.equal(await skin.evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
      const confirm = page.getByRole("button", { name: "\u786e\u8ba4", exact: true });
      const confirmRect = await confirm.boundingBox();
      const footerRect = await page.locator('[class*="modal-footer"]').boundingBox();
      assert(confirmRect.width < 120 && confirmRect.x > footerRect.x + footerRect.width / 2);
      await page.screenshot({ path: path.join(os.tmpdir(), `octopus-controls-skin-${width}.png`) });
      await confirm.click();

      await visit(page, "/settings");
      const model = page.locator('button[class*="constrained"]').first();
      await model.scrollIntoViewIfNeeded();
      await model.focus();
      await page.keyboard.press("Enter");
      await page.getByPlaceholder("\u641c\u7d22\u6a21\u578b", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await checkPrompts(page);

      await visit(page, "/masks");
      await page.getByRole("button", { name: "\u65b0\u5efa", exact: true }).click();
      const mask = page.locator('[class*="mask-config"]');
      await mask.waitFor();
      await mask.getByRole("tab", { name: "角色与参数", exact: true }).click();
      await mask.getByRole("textbox", { name: "\u89d2\u8272\u540d\u79f0", exact: true })
        .fill("A very long custom mask name for responsive layout");
      await checkFields(mask, `${width} mask editor`);
      await page.screenshot({ path: path.join(os.tmpdir(), `octopus-controls-mask-${width}.png`) });
      await page.keyboard.press("Escape");

      await visit(page, "/chat");
      await page.locator('button[title="\u5bf9\u8bdd\u8bbe\u7f6e"]').click();
      const preset = page.locator('[class*="mask-config"]');
      await preset.waitFor();
      await preset.getByRole("tab", { name: "角色与参数", exact: true }).click();
      await checkFields(preset, `${width} chat preset`);
      assert.deepEqual(errors, []);
      console.log(`${width}: theme selection, keyboard model picker, prompt editors and runtime checks passed`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
