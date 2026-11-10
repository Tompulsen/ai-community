// Local isolated fixtures only: no real model, account, or MCP requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare, geometry } = require("./verify-assistant-chat.cjs");
const { prepare: prepareHistory } = require("./verify-chat-scroll.cjs");

const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const output =
  process.env.UI_TEST_OUTPUT_DIR ||
  "C:/Users/86136/.codex/visualizations/2026/11/02/01a19d7b-24fa-75e3-bd05-b433759e1c48/assistant-ui-chat/scroll-isolation";
const bodySelector = '[class*="chat-body_"]';
const reports = [];

async function position(page) {
  return page.locator(bodySelector).evaluate((body) => ({
    top: body.scrollTop,
    height: body.scrollHeight,
    viewport: body.clientHeight,
    gap: body.scrollHeight - body.clientHeight - body.scrollTop,
  }));
}

async function atBottom(page) {
  await page.waitForFunction(
    (selector) => {
      const body = document.querySelector(selector);
      return (
        body && body.scrollHeight - body.clientHeight - body.scrollTop <= 16
      );
    },
    bodySelector,
    { timeout: 10000 },
  );
}

async function visibleText(page, text) {
  await page.waitForFunction(
    ({ selector, text }) =>
      document.querySelector(selector)?.textContent?.includes(text),
    { selector: bodySelector, text },
    { timeout: 15000 },
  );
}

async function push(page, index, delta) {
  await page.evaluate(
    ({ index, delta }) => window.__assistantQa.push(index, delta),
    { index, delta },
  );
}

async function send(page, prompt, index) {
  await page.locator("#chat-input").fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(
    (count) => window.__assistantQa.flows.length >= count,
    index + 1,
  );
}

async function grow(page, index, prefix, count = 10) {
  const chunks = Array.from(
    { length: count },
    (_, number) =>
      `\n\n${"Continued output for the active response. ".repeat(4)}${prefix}_${
        number + 1
      }`,
  );
  for (const content of chunks) {
    await push(page, index, { content });
    await page.waitForTimeout(35);
  }
  await visibleText(page, `${prefix}_${count}`);
  await page.waitForTimeout(150);
}

async function finish(page, index) {
  await page.evaluate((index) => window.__assistantQa.finish(index), index);
  await page.getByRole("button", { name: "停止响应", exact: true }).waitFor({
    state: "hidden",
  });
}

async function pausedGrowth(page, index, prefix) {
  await page.waitForTimeout(150);
  const before = await position(page);
  await grow(page, index, prefix);
  const after = await position(page);
  assert(
    after.height > before.height + 160,
    `The live response must keep growing: ${JSON.stringify({ before, after })}`,
  );
  assert(
    Math.abs(after.top - before.top) <= 3,
    `Opening details must hold the reading position: ${JSON.stringify({
      before,
      after,
    })}`,
  );
  assert(after.gap > 80, JSON.stringify({ before, after }));
  return { before, after };
}

async function capture(page, report, phase) {
  const target = path.join(
    output,
    `${report.width}-${report.scenario}-${phase}.png`,
  );
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await page.screenshot({ path: target });
  report.screenshots.push(target);
}

async function reasoning(page, report) {
  await send(page, "SCROLL_ISOLATION_REASONING", 0);
  await push(page, 0, {
    reasoning_content:
      "Automatic reasoning expansion.\n\n" +
      "A readable thought with enough detail to inspect.\n\n".repeat(12),
  });
  const disclosure = page.getByRole("button", { name: /思考过程/ }).last();
  await disclosure.waitFor();
  assert.equal(await disclosure.getAttribute("aria-expanded"), "true");
  await atBottom(page);
  await push(page, 0, { content: "QA_REASONING_ANSWER_START" });
  await visibleText(page, "QA_REASONING_ANSWER_START");
  await page.waitForFunction(
    () =>
      document.querySelector('button[aria-controls][aria-expanded="false"]') &&
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.textContent.includes("思考过程") &&
          button.getAttribute("aria-expanded") === "false",
      ),
  );
  await atBottom(page);
  report.automaticExpansionKeptFollowing = await position(page);

  await disclosure.click();
  assert.equal(await disclosure.getAttribute("aria-expanded"), "true");
  report.pointerPause = await pausedGrowth(page, 0, "QA_REASONING_PAUSED");
  await capture(page, report, "pointer-paused");
  const toBottom = page
    .getByRole("button", { name: "回到底部", exact: true })
    .last();
  await toBottom.click();
  await atBottom(page);
  await grow(page, 0, "QA_REASONING_RESUMED", 3);
  await atBottom(page);
  report.bottomButtonResumed = await position(page);

  await finish(page, 0);
  await send(page, "SCROLL_ISOLATION_KEYBOARD", 1);
  await push(page, 1, {
    reasoning_content: "A second thought for keyboard reading.\n\n".repeat(10),
  });
  const keyboardDisclosure = page
    .getByRole("button", { name: /思考过程/ })
    .last();
  await keyboardDisclosure.waitFor();
  await push(page, 1, { content: "QA_KEYBOARD_ANSWER_START" });
  await visibleText(page, "QA_KEYBOARD_ANSWER_START");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")]
        .filter((button) => button.textContent.includes("思考过程"))
        .at(-1)
        ?.getAttribute("aria-expanded") === "false",
  );
  await atBottom(page);
  await keyboardDisclosure.focus();
  await page.keyboard.press("Enter");
  assert.equal(await keyboardDisclosure.getAttribute("aria-expanded"), "true");
  report.keyboardPause = await pausedGrowth(page, 1, "QA_REASONING_KEYBOARD");
  await page.locator(bodySelector).focus();
  await page.keyboard.press("End");
  await atBottom(page);
  await grow(page, 1, "QA_MANUAL_BOTTOM_RESUMED", 3);
  await atBottom(page);
  report.manualBottomResumed = await position(page);
  await finish(page, 1);
}

async function tools(page, report) {
  const card = page.getByTestId("tool-result-card").first();
  await card.waitFor();
  await send(page, "SCROLL_ISOLATION_TOOLS", 0);
  await push(page, 0, { content: "QA_TOOL_ANSWER_START" });
  await visibleText(page, "QA_TOOL_ANSWER_START");
  await atBottom(page);
  const summary = card.locator(":scope > summary");
  assert.equal(await card.getAttribute("open"), null);
  await summary.click();
  assert.notEqual(await card.getAttribute("open"), null);
  report.toolPause = await pausedGrowth(page, 0, "QA_TOOL_PAUSED");
  await capture(page, report, "tool-paused");
  await finish(page, 0);

  // A fresh request is an explicit return to the latest conversation.
  await send(page, "SCROLL_ISOLATION_NEW_MESSAGE", 1);
  await push(page, 1, { content: "QA_NEW_MESSAGE_START" });
  await visibleText(page, "QA_NEW_MESSAGE_START");
  await atBottom(page);
  await grow(page, 1, "QA_NEW_MESSAGE_FOLLOWING", 4);
  await atBottom(page);
  report.newMessageResumed = await position(page);
  await finish(page, 1);
}

async function wheelBoundary(page, report) {
  const card = page.getByTestId("tool-result-card").first();
  const summary = card.locator(":scope > summary");
  await card.waitFor();
  await send(page, "SCROLL_ISOLATION_WHEEL", 0);
  await push(page, 0, { content: "QA_WHEEL_ANSWER_START" });
  await visibleText(page, "QA_WHEEL_ANSWER_START");
  await atBottom(page);
  await summary.click();
  const pre = card.locator("pre").first();
  await pre.waitFor();
  await pre.hover();
  const beforeInner = await position(page);
  const preBefore = await pre.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 180);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="tool-result-card"] pre')
        ?.scrollTop > 0,
  );
  await grow(page, 0, "QA_INNER_WHEEL", 2);
  const afterInner = await position(page);
  const preAfter = await pre.evaluate((node) => node.scrollTop);
  assert(preAfter > preBefore, "The nested pre must consume the real wheel");
  assert(
    Math.abs(afterInner.top - beforeInner.top) <= 3,
    JSON.stringify({ beforeInner, afterInner, preBefore, preAfter }),
  );
  assert(afterInner.height > beforeInner.height + 160);
  report.innerWheelConsumed = { beforeInner, afterInner, preBefore, preAfter };
  await capture(page, report, "inner-wheel-paused");

  await summary.hover();
  const beforeSmallWheel = await position(page);
  await page.mouse.wheel(0, 30);
  await page.waitForTimeout(120);
  const afterSmallWheel = await position(page);
  await grow(page, 0, "QA_FAR_FROM_BOTTOM", 1);
  const afterSmallGrowth = await position(page);
  assert(
    afterSmallWheel.top > beforeSmallWheel.top + 10 && afterSmallWheel.gap > 80,
    JSON.stringify({ beforeSmallWheel, afterSmallWheel }),
  );
  assert(
    Math.abs(afterSmallGrowth.top - afterSmallWheel.top) <= 3,
    "A small outer movement far from the bottom must not resume following",
  );
  report.smallWheelStayedPaused = {
    beforeSmallWheel,
    afterSmallWheel,
    afterSmallGrowth,
  };

  // The summary belongs to the isolated card but has no inner scroll range.
  // Its real wheel must be allowed to move the outer chat to the latest text.
  await summary.scrollIntoViewIfNeeded();
  await summary.hover();
  report.wheelInput = await summary.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return {
      target: target?.tagName,
      isolated: !!target?.closest("[data-chat-scroll-isolation]"),
    };
  });
  assert(
    report.wheelInput.isolated,
    "Wheel must start inside the actual tool card",
  );
  const beforeOuter = await position(page);
  await page.locator(bodySelector).evaluate((body) => {
    window.__isolationWheelEvents = [];
    for (const type of ["wheel", "scroll"])
      body.addEventListener(
        type,
        (event) => {
          if (window.__isolationWheelEvents.length >= 200) return;
          window.__isolationWheelEvents.push({
            type,
            at: performance.now(),
            target: event.target?.tagName,
            isolated: !!event.target?.closest?.("[data-chat-scroll-isolation]"),
            deltaY: event.deltaY,
            top: body.scrollTop,
            height: body.scrollHeight,
            viewport: body.clientHeight,
            gap: body.scrollHeight - body.clientHeight - body.scrollTop,
          });
        },
        { capture: true, passive: true },
      );
  });
  const concurrentGrowth = grow(page, 0, "QA_OUTER_WHEEL", 8);
  await page.mouse.wheel(0, 15000);
  await concurrentGrowth;
  report.outerWheelAttempt = {
    beforeOuter,
    afterGrowth: await position(page),
    events: await page.evaluate(() => window.__isolationWheelEvents),
  };
  assert(
    report.outerWheelAttempt.events.some(
      (event) => event.type === "wheel" && event.isolated,
    ),
    "A real wheel event must hit the isolated tool card",
  );
  await atBottom(page);
  const afterOuter = await position(page);
  assert(
    afterOuter.top > beforeOuter.top + 100,
    JSON.stringify({ beforeOuter, afterOuter }),
  );
  await grow(page, 0, "QA_AFTER_OUTER_WHEEL", 3);
  await atBottom(page);
  report.outerWheelResumed = {
    beforeOuter,
    afterOuter,
    followed: await position(page),
    continuedChunks: 8,
  };
  await finish(page, 0);
}

async function pagination(page, report) {
  const prompt = "SCROLL_PAGINATION_STREAM";
  const body = page.locator(bodySelector);
  report.historySeeks = [];
  const advanceHistory = async () => {
    const target = await page.evaluate(async () => {
      await window.__chatScrollMock.advance(0, 3);
      return window.__chatScrollMock.flows[0].paragraph;
    });
    await body
      .getByText(`Stream paragraph ${target}`, { exact: true })
      .waitFor();
    await page.waitForFunction(
      ({ selector, target }) => {
        const heading = [...document.querySelectorAll(`${selector} h3`)].find(
          (node) => node.textContent === `Stream paragraph ${target}`,
        );
        return (
          heading?.nextElementSibling?.textContent?.trim() ===
          "The response keeps growing while the reader controls the viewport. "
            .repeat(4)
            .trim()
        );
      },
      { selector: bodySelector, target },
    );
    await page.waitForTimeout(150);
  };
  const seekHistory = async (direction) => {
    const rect = await body.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    for (let attempt = 0; attempt < 7; attempt++) {
      if (direction < 0 && (await position(page)).top <= 1) {
        await page.mouse.wheel(0, 48);
        await page.waitForTimeout(120);
      }
      await page.mouse.wheel(0, direction * 100000);
      await page.waitForTimeout(200);
      const latest = (await body.textContent()).includes(prompt);
      const current = { direction, attempt, latest, ...(await position(page)) };
      report.historySeeks.push(current);
      if (direction < 0 ? !latest : latest && current.gap <= 16) return current;
    }
    assert.fail(
      `Could not reach ${direction < 0 ? "earlier" : "latest"} history`,
    );
  };

  await atBottom(page);
  await page.locator("#chat-input").fill(prompt);
  await page.locator("#chat-input").press("Enter");
  await page.waitForFunction(() => window.__chatScrollMock.flows.length === 1);
  await advanceHistory();
  await atBottom(page);
  report.beforePagination = await position(page);
  await seekHistory(-1);
  report.returnedToLatest = await seekHistory(1);
  await advanceHistory();
  await atBottom(page);
  report.followedAfterPagination = await position(page);
  assert(
    report.followedAfterPagination.top > report.returnedToLatest.top + 160,
    "New stream output must remain followed after history content shrinks",
  );
  await page.evaluate(() => window.__chatScrollMock.finish(0));
  await page.getByRole("button", { name: "停止响应", exact: true }).waitFor({
    state: "hidden",
  });
}

async function run(browser, width, scenario) {
  const mobile = width < 600;
  const theme = mobile ? "dark" : "light";
  const context = await browser.newContext({
    viewport: {
      width,
      height:
        scenario === "wheel"
          ? 1600
          : scenario === "pagination" || mobile
          ? 1000
          : 950,
    },
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: theme,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const report = { width, theme, scenario, screenshots: [], errors: [] };
  page.on("pageerror", (error) =>
    report.errors.push(error.stack || error.message),
  );
  try {
    if (scenario === "pagination") {
      await prepareHistory(page);
      await page.addInitScript(() => {
        const key = "chat-next-web-store";
        const saved = JSON.parse(localStorage.getItem(key));
        saved.state.currentSessionIndex = 1;
        localStorage.setItem(key, JSON.stringify(saved));
      });
      await page.route("**/*", (route) =>
        route.request().headers()["next-action"]
          ? route.fulfill({ status: 503, body: "Fixture: MCP unavailable" })
          : route.fallback(),
      );
    } else {
      await prepare(page, theme, scenario === "tools" || scenario === "wheel");
    }
    if (scenario === "tools" || scenario === "wheel")
      await page.addInitScript((scenario) => {
        const key = "chat-next-web-store";
        const saved = JSON.parse(localStorage.getItem(key));
        if (saved?.state?.sessions[0]?.messages[1]?.tools) {
          saved.state.sessions[0].messages[1].tools =
            saved.state.sessions[0].messages[1].tools.slice(0, 1);
          if (scenario === "wheel")
            saved.state.sessions[0].messages[1].tools[0].content = Array.from(
              { length: 120 },
              (_, index) =>
                `Tool result line ${index + 1}: nested scroll content.`,
            ).join("\n");
        }
        localStorage.setItem(key, JSON.stringify(saved));
      }, scenario);
    await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    if (scenario === "reasoning") await reasoning(page, report);
    else if (scenario === "wheel") await wheelBoundary(page, report);
    else if (scenario === "pagination") await pagination(page, report);
    else await tools(page, report);
    report.geometry = await geometry(page, mobile);
    await capture(page, report, "complete");
    assert.deepEqual(report.errors, []);
    report.passed = true;
    reports.push(report);
    console.log(JSON.stringify({ width, scenario, passed: true }));
  } catch (error) {
    report.error = error.stack || error.message;
    await capture(page, report, "failure").catch(() => {});
    reports.push(report);
    throw error;
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.UI_TEST_BROWSER || "msedge",
  });
  try {
    const widths = process.env.UI_TEST_WIDTH
      ? [Number(process.env.UI_TEST_WIDTH)]
      : [1440, 390];
    const scenarios = process.env.UI_TEST_SCENARIO
      ? [process.env.UI_TEST_SCENARIO]
      : ["reasoning", "tools"];
    for (const width of widths)
      for (const scenario of scenarios) await run(browser, width, scenario);
    if (!process.env.UI_TEST_SCENARIO && !process.env.UI_TEST_WIDTH) {
      if (process.env.UI_TEST_SKIP_WHEEL !== "1")
        await run(browser, 1440, "wheel");
      await run(browser, 1440, "pagination");
    }
    console.log(
      JSON.stringify({
        passed: true,
        scenarios: reports.length,
        paidRequests: 0,
        output,
      }),
    );
  } finally {
    fs.writeFileSync(
      path.join(output, "verification.json"),
      JSON.stringify({ reports, paidRequests: 0 }, null, 2),
    );
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
