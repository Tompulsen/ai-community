// Fresh contexts, fixture tasks and intercepted APIs never touch a real account.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = process.env.UI_TEST_URL || "http://localhost:3001/";
assert.equal(new URL(base).origin, "http://localhost:3001");
process.env.UI_TEST_URL = base;
const { prepare } = require("./verify-chat-scroll.cjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const output = fs.mkdtempSync(
  path.join(os.tmpdir(), "octopus-task-recovery-layout-"),
);
const taskKey = "task:recovery-layout-fixture";
const noticeText =
  "有未完成任务，请选择提交时使用的密钥后重新进入页面恢复查询。";
const report = { base, cases: [], paidRequests: 0, output };

const appRoot = (page) => page.locator('[class*="home_container__"]');

async function geometry(page, notice) {
  return notice.evaluate((node) => {
    const app = document.querySelector('[class*="home_container__"]');
    const style = getComputedStyle(node);
    const text =
      [...node.querySelectorAll("span")].find((element) =>
        element.textContent.includes("有未完成任务"),
      ) || node;
    const range = document.createRange();
    range.selectNodeContents(text);
    const rect = (element) => element.getBoundingClientRect().toJSON();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      notice: rect(node),
      content: rect(node.querySelector('[class*="toast-content_"]')),
      app: rect(app),
      input: rect(app.querySelector("#chat-input")),
      send: rect(app.querySelector('button[aria-label="发送"]')),
      toolbar: rect(
        app.querySelector('[class*="workspace-navigation_topbar__"]'),
      ),
      position: style.position,
      placement: node.getAttribute("data-placement"),
      className: node.className,
      role: node.getAttribute("role"),
      atomic: node.getAttribute("aria-atomic"),
      text: text.textContent.trim(),
      textRects: [...range.getClientRects()].map((box) => box.toJSON()),
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
}

async function run(browser, width, height, theme) {
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width <= 600,
    hasTouch: width <= 600,
    serviceWorkers: "block",
    colorScheme: theme,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const pending = new Set();
  page.on("request", (request) => pending.add(new URL(request.url()).pathname));
  page.on("requestfinished", (request) =>
    pending.delete(new URL(request.url()).pathname),
  );
  page.on("requestfailed", (request) =>
    pending.delete(new URL(request.url()).pathname),
  );
  const errors = [];
  const writes = [];
  const taskQueries = [];
  const label = `${width}x${height}-${theme}`;
  const storedTask = JSON.stringify({
    id: "recovery-layout-fixture",
    kind: "image",
    tokenId: 987654,
    upstreamId: "fixture-remote",
    model: "fixture",
    prompt: "Isolated task recovery layout",
    createdAt: Date.now(),
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await prepare(page);
  await page.addInitScript(
    ({ theme, taskKey, storedTask }) => {
      localStorage.setItem(taskKey, storedTask);
      const config = JSON.parse(
        localStorage.getItem("app-config") || '{"state":{}}',
      );
      config.state ??= {};
      config.state.theme = theme;
      localStorage.setItem("app-config", JSON.stringify(config));
    },
    { theme, taskKey, storedTask },
  );
  // Registered after prepare so this guard also covers its general API fixture.
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.fallback();
    if (request.method() !== "GET") {
      writes.push({ method: request.method(), path: url.pathname });
      return route.fulfill({
        status: 409,
        json: { error: "Fixture blocks writes" },
      });
    }
    if (
      url.pathname.includes("fixture-remote") ||
      /\/(?:async-images|async-videos|tasks|v1\/videos)(?:\/|$)/.test(
        url.pathname,
      )
    ) {
      taskQueries.push(url.pathname);
      return route.fulfill({
        status: 409,
        json: { error: "Wrong fixture token" },
      });
    }
    return route.fallback();
  });
  let bounds;
  try {
    await page.goto(`${base}#/chat`, { waitUntil: "commit" });
    const notice = page.getByRole("status").filter({ hasText: noticeText });
    await notice.waitFor();
    await appRoot(page).waitFor();
    await page.locator("#chat-input").waitFor();
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => {
            const timing = animation.effect?.getTiming();
            return (
              Number(timing?.duration) < 1000 && timing?.iterations < Infinity
            );
          })
          .map((animation) => animation.finished.catch(() => {})),
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    assert(
      await page
        .locator("body")
        .evaluate((node, theme) => node.classList.contains(theme), theme),
      "The fixture uses the requested theme",
    );
    await page.waitForTimeout(3500);
    assert(
      await notice.isVisible(),
      "The task notice persists beyond transient toast duration",
    );
    bounds = await geometry(page, notice);
    console.log(JSON.stringify({ scenario: label, bounds }));
    assert.equal(
      bounds.position,
      "fixed",
      "The task notice stays out of the app layout",
    );
    assert(
      String(bounds.className).includes("ui-lib_toast-container__"),
      "Task recovery reuses the shared Toast container",
    );
    assert.equal(bounds.role, "status");
    assert.equal(bounds.atomic, "true");
    assert.equal(bounds.placement, "top");
    for (const [name, control] of [
      ["input", bounds.input],
      ["send", bounds.send],
      ["toolbar", bounds.toolbar],
    ]) {
      const overlapWidth =
        Math.min(bounds.content.right, control.right) -
        Math.max(bounds.content.left, control.left);
      const overlapHeight =
        Math.min(bounds.content.bottom, control.bottom) -
        Math.max(bounds.content.top, control.top);
      assert(
        overlapWidth <= 1 || overlapHeight <= 1,
        `The notice content does not overlap the ${name}`,
      );
    }
    assert(
      bounds.content.top >= bounds.toolbar.bottom,
      "The recovery notice sits below the top toolbar",
    );
    assert(
      bounds.overflow <= 1,
      "The recovery notice adds no horizontal overflow",
    );
    assert(
      Math.abs(bounds.app.left - (width - bounds.app.width) / 2) <= 1,
      "The app stays centered",
    );
    if (width <= 600)
      assert(
        bounds.app.width >= width - 1,
        "The mobile app keeps its full width",
      );
    assert.equal(bounds.text, noticeText);
    assert(
      bounds.textRects.length > 0,
      "The full recovery notice has rendered text",
    );
    for (const rect of bounds.textRects) {
      assert(
        rect.left >= -1 &&
          rect.right <= width + 1 &&
          rect.top >= -1 &&
          rect.bottom <= height + 1,
        "Every line of the notice fits the viewport",
      );
    }
    await notice.getByText(noticeText, { exact: true }).waitFor();
    const closeButton = notice.getByRole("button", {
      name: "关闭",
      exact: true,
    });
    await closeButton.waitFor();
    const closeBounds = await closeButton.boundingBox();
    if (width <= 600) {
      assert(
        closeBounds.width >= 44 && closeBounds.height >= 44,
        "The dismiss action has a 44px touch target",
      );
    }
    const screenshot = path.join(output, `${label}.png`);
    await page.screenshot({ path: screenshot });
    const beforeClose = await appRoot(page).boundingBox();
    await closeButton.click();
    await notice.waitFor({ state: "detached" });
    assert.deepEqual(
      await appRoot(page).boundingBox(),
      beforeClose,
      "Dismissing the notice never moves or resizes the app",
    );
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), taskKey),
      storedTask,
      "Dismissing the notice preserves the complete task record",
    );
    assert.deepEqual(writes, [], "Recovery guidance never submits API writes");
    assert.deepEqual(
      taskQueries,
      [],
      "A mismatched key never queries the task",
    );
    assert.equal(
      await page.evaluate(() => window.__chatScrollMock.requests.length),
      0,
      "The shared chat fixture never sends a model request",
    );
    assert.deepEqual(errors, []);
    report.cases.push({
      scenario: label,
      bounds,
      screenshot,
      persistentMs: 3500,
      taskUnchanged: true,
      closeBounds,
      writes,
      taskQueries,
      errors,
    });
    console.log(`PASS task recovery layout ${label}`);
  } catch (error) {
    console.error(
      JSON.stringify({
        scenario: label,
        pending: [...pending],
        body: (await page.locator("body").innerText()).slice(0, 1500),
        taskPresent: await page.evaluate(
          (key) => Boolean(localStorage.getItem(key)),
          taskKey,
        ),
      }),
    );
    const screenshot = path.join(output, `failure-${label}.png`);
    await page.screenshot({ path: screenshot }).catch(() => {});
    report.cases.push({
      scenario: label,
      bounds,
      screenshot,
      writes,
      taskQueries,
      errors,
      taskUnchanged:
        (await page.evaluate((key) => localStorage.getItem(key), taskKey)) ===
        storedTask,
      error: error.stack,
    });
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath:
      process.env.UI_TEST_EXECUTABLE_PATH ||
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  try {
    const selected = process.argv
      .find((argument) => argument.startsWith("--viewport="))
      ?.slice("--viewport=".length);
    const theme =
      process.argv
        .find((argument) => argument.startsWith("--theme="))
        ?.slice("--theme=".length) || "light";
    if (selected) {
      assert(/^\d+x\d+$/.test(selected));
      const [width, height] = selected.split("x").map(Number);
      await run(browser, width, height, theme);
    } else {
      await run(browser, 1440, 900, "light");
      await run(browser, 390, 844, "dark");
      await run(browser, 320, 740, "light");
    }
    console.log(
      JSON.stringify({ passed: true, cases: report.cases.length, output }),
    );
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(output, "verification.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify({ output, paidRequests: 0 }));
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
