// Isolated browser fixtures; account APIs and every model response are mocked.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");

const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const cases = [];
const requestCount = (page) =>
  page.evaluate(() => window.__chatScrollMock.requests.length);

async function expectRequests(page, count) {
  await page.waitForFunction(
    (count) => window.__chatScrollMock.requests.length === count,
    count,
    { timeout: 5000 },
  );
}

async function finish(page, index) {
  await page.evaluate((index) => window.__chatScrollMock.finish(index), index);
}

function scenario(name, run, submitKey = "Enter") {
  cases.push({ name, run, submitKey });
}

async function imeSequence(page, order, repeat = false) {
  return page.locator("#chat-input").evaluate(
    (input, { order, repeat }) => {
      const events = [];
      const key = (type, options = {}) => {
        const event = new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          ...options,
        });
        input.dispatchEvent(event);
        events.push({
          type,
          composing: event.isComposing,
          repeat: event.repeat,
          prevented: event.defaultPrevented,
          elapsed: performance.now(),
        });
      };
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      if (order === "chrome")
        key("keydown", { isComposing: true, keyCode: 229 });
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "字" }),
      );
      const committedAt = performance.now();
      if (order === "safari") key("keydown");
      if (repeat) key("keydown", { repeat: true });
      key("keyup");
      key("keydown");
      const secondEnterAfterCommitMs = performance.now() - committedAt;
      key("keyup");
      return { events, secondEnterAfterCommitMs };
    },
    { order, repeat },
  );
}

scenario("ordinary-enter-and-new-input", async (page) => {
  const input = page.locator("#chat-input");
  await input.fill("ENTER_FIRST_FIXTURE");
  await input.press("Enter");
  await expectRequests(page, 1);
  assert.equal(await input.inputValue(), "");
  await input.press("Enter");
  await page.waitForTimeout(100);
  assert.equal(
    await requestCount(page),
    1,
    "Empty Enter must not submit twice",
  );
  await finish(page, 0);
  await input.fill("ENTER_SECOND_FIXTURE");
  await input.press("Enter");
  await expectRequests(page, 2);
  assert.equal(await input.inputValue(), "");
  await finish(page, 1);
});

for (const order of ["chrome", "safari"]) {
  scenario(`${order}-fast-second-enter`, async (page) => {
    const input = page.locator("#chat-input");
    await input.fill("输入法选字后主动发送");
    const sequence = await imeSequence(page, order);
    assert(
      sequence.secondEnterAfterCommitMs < 200,
      "The deliberate second Enter must occur within the former 200ms window",
    );
    if (order === "chrome") {
      assert.equal(
        sequence.events[0].prevented,
        false,
        "Candidate selection must not be cancelled",
      );
    } else {
      assert.equal(
        sequence.events[0].prevented,
        true,
        "Safari's trailing commit Enter must be suppressed",
      );
    }
    process.stdout.write(
      JSON.stringify({ phase: "ime-sequence", order, ...sequence }) + "\n",
    );
    await expectRequests(page, 1);
    assert.equal(await input.inputValue(), "");
    await input.press("Enter");
    assert.equal(await requestCount(page), 1);
    await finish(page, 0);
  });
}

scenario("candidate-and-held-enter", async (page) => {
  const input = page.locator("#chat-input");
  await input.fill("尚未完成选字");
  const evidence = await input.evaluate((input) => {
    const dispatch = (type, options = {}) => {
      const event = new KeyboardEvent(type, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true,
        ...options,
      });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const candidatePrevented = dispatch("keydown", {
      isComposing: true,
      keyCode: 229,
    });
    input.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "字" }),
    );
    const repeatPrevented = dispatch("keydown", { repeat: true });
    return { candidatePrevented, repeatPrevented };
  });
  await page.waitForTimeout(220);
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    repeat: true,
    bubbles: true,
    cancelable: true,
  });
  assert.deepEqual(evidence, {
    candidatePrevented: false,
    repeatPrevented: true,
  });
  assert.equal(await requestCount(page), 0);
  assert.equal(await input.inputValue(), "尚未完成选字");
  await input.dispatchEvent("keyup", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    bubbles: true,
  });
  await input.press("Enter");
  await expectRequests(page, 1);
  await finish(page, 0);
});

scenario("shift-enter-keeps-newline", async (page) => {
  const input = page.locator("#chat-input");
  await input.fill("FIRST_LINE");
  await input.press("Shift+Enter");
  assert.equal(await input.inputValue(), "FIRST_LINE\n");
  assert.equal(await requestCount(page), 0);
  await input.press("Enter");
  await expectRequests(page, 1);
  await finish(page, 0);
});

scenario(
  "ctrl-enter-submit-mode",
  async (page) => {
    const input = page.locator("#chat-input");
    await input.fill("CTRL_ENTER_FIXTURE");
    await input.press("Enter");
    assert.equal(await input.inputValue(), "CTRL_ENTER_FIXTURE\n");
    assert.equal(await requestCount(page), 0);
    await input.press("Control+Enter");
    await expectRequests(page, 1);
    assert.equal(await input.inputValue(), "");
    await finish(page, 0);
  },
  "Ctrl + Enter",
);

async function run(browser, scenario, width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    isMobile: width < 600,
    hasTouch: width < 600,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await prepare(page);
    await page.route("**/*", (route) =>
      route.request().headers()["next-action"]
        ? route.fulfill({ status: 503, body: "Fixture: MCP unavailable" })
        : route.fallback(),
    );
    await page.addInitScript((submitKey) => {
      const config = JSON.parse(localStorage.getItem("app-config"));
      config.state.submitKey = submitKey;
      localStorage.setItem("app-config", JSON.stringify(config));
    }, scenario.submitKey);
    await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await scenario.run(page);
    assert.deepEqual(errors, [], "Unexpected browser exception");
    let screenshot;
    if (process.env.UI_TEST_SCREENSHOTS === "1") {
      await page.getByText("SCROLL_COMPLETE", { exact: true }).last().waitFor();
      await page.waitForTimeout(300);
      screenshot = path.join(
        os.tmpdir(),
        `octopus-enter-${scenario.name}-${width}.png`,
      );
      await page.screenshot({ path: screenshot });
    }
    process.stdout.write(
      JSON.stringify({
        name: scenario.name,
        width,
        passed: true,
        mocked: true,
        screenshot,
      }) + "\n",
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        name: scenario.name,
        width,
        passed: false,
        requests: await requestCount(page).catch(() => null),
        input: await page
          .locator("#chat-input")
          .inputValue()
          .catch(() => null),
        errors,
        reason: error.message,
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const widths = process.env.UI_TEST_WIDTH
    ? [Number(process.env.UI_TEST_WIDTH)]
    : [1440, 390];
  try {
    for (const width of widths) {
      for (const test of cases) {
        if (process.env.UI_TEST_CASE && process.env.UI_TEST_CASE !== test.name)
          continue;
        await run(browser, test, width);
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
