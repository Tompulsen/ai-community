// Local UI regression: persisted history and every model response are fixtures.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const bodySelector = '[class*="chat-body_"]';

const modelConfig = {
  model: "gpt-scroll-fixture",
  providerName: "gpt",
  temperature: 0.4,
  top_p: 1,
  max_tokens: 12000,
  presence_penalty: 0,
  frequency_penalty: 0,
  sendMemory: false,
  historyMessageCount: 20,
  compressMessageLengthThreshold: 999999,
  compressModel: "",
  compressProviderName: "",
  enableInjectSystemPrompts: false,
  template: "{{input}}",
  size: "auto",
  quality: "auto",
  style: "auto",
};

function historySession(id, topic, count = 8) {
  return {
    id,
    topic,
    memoryPrompt: "",
    stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,
    messages: Array.from({ length: count }, (_, index) => ({
      id: `${id}-message-${index}`,
      date: "2026-10-21T09:00:00.000Z",
      role: index % 2 ? "assistant" : "user",
      content: `${topic} history ${
        index + 1
      }\n\n${"History content for testing reader position. ".repeat(18)}`,
      model: modelConfig.model,
    })),
    mask: {
      id: `${id}-mask`,
      createdAt: Date.now(),
      name: topic,
      avatar: "gpt-bot",
      context: [],
      syncGlobalConfig: false,
      modelConfig,
      lang: "cn",
      builtin: false,
    },
  };
}

async function prepare(page) {
  await page.addInitScript(
    ({ modelConfig, sessions }) => {
      if (window.top !== window) return;
      localStorage.setItem("lang", "cn");
      localStorage.setItem(
        "chat-next-web-store",
        JSON.stringify({
          version: 3.3,
          state: { sessions, currentSessionIndex: 0, lastInput: "" },
        }),
      );
      localStorage.setItem(
        "app-config",
        JSON.stringify({
          version: 4.3,
          state: {
            models: [],
            modelConfig,
            enableAutoGenerateTitle: false,
            disablePromptHint: true,
          },
        }),
      );
      const nativeFetch = window.fetch.bind(window);
      const encoder = new TextEncoder();
      const flows = [];
      const requests = [];
      window.__chatScrollMock = {
        flows,
        requests,
        push(index, content) {
          const flow = flows[index];
          flow.controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                choices: [{ index: 0, delta: { content } }],
              })}\n\n`,
            ),
          );
        },
        async advance(index, count) {
          const flow = flows[index];
          for (let item = 0; item < count; item++) {
            flow.paragraph++;
            const content = `\n\n### Stream paragraph ${
              flow.paragraph
            }\n\n${"The response keeps growing while the reader controls the viewport. ".repeat(
              4,
            )}`;
            flow.controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: `fixture-${index}`,
                  object: "chat.completion.chunk",
                  choices: [{ index: 0, delta: { content } }],
                })}\n\n`,
              ),
            );
            await new Promise((resolve) => setTimeout(resolve, 45));
          }
        },
        finish(index) {
          const flow = flows[index];
          flow.controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                choices: [
                  {
                    index: 0,
                    delta: { content: "\n\nSCROLL_COMPLETE" },
                    finish_reason: "stop",
                  },
                ],
              })}\n\ndata: [DONE]\n\n`,
            ),
          );
          flow.controller.close();
          flow.finished = true;
        },
      };
      window.fetch = async (input, init) => {
        const url = String(typeof input === "string" ? input : input.url);
        if (!url.includes("/chat/completions")) {
          return nativeFetch(input, init);
        }
        const payload = JSON.parse(init?.body || "{}");
        requests.push({ method: init?.method || "GET", payload });
        if (!payload.stream) {
          return Response.json({
            choices: [{ message: { content: "Fixture" } }],
          });
        }
        const flow = {
          paragraph: 0,
          finished: false,
          startedAt: Date.now(),
          payload,
          aborted: false,
          cancelled: false,
        };
        const stream = new ReadableStream({
          start(controller) {
            flow.controller = controller;
          },
          cancel() {
            flow.cancelled = true;
          },
        });
        const abort = () => {
          flow.aborted = true;
          if (!flow.finished && !flow.cancelled) {
            flow.controller.error(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          }
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
        flows.push(flow);
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      };
    },
    {
      modelConfig,
      sessions: [
        historySession("scroll-a", "Scroll Session A"),
        historySession("scroll-b", "Scroll Session B", 70),
      ],
    },
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) {
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/new-api/bootstrap") {
      return route.fulfill({
        json: {
          success: true,
          data: {
            config: {
              newApiEnabled: false,
              needCode: false,
              hasModelApiKey: true,
              enableMcp: false,
              defaultModel: modelConfig.model,
            },
            session: {
              authenticated: false,
              user: null,
              selectedTokenId: null,
            },
          },
        },
      });
    }
    if (url.pathname === "/api/config") {
      return route.fulfill({
        json: {
          newApiEnabled: false,
          needCode: false,
          hasModelApiKey: true,
          enableMcp: false,
          defaultModel: modelConfig.model,
        },
      });
    }
    if (url.pathname === "/api/new-api/status") {
      return route.fulfill({
        json: { success: true, data: { enabled: false } },
      });
    }
    return route.fulfill({
      json: { data: [{ id: modelConfig.model }], enabled: false },
    });
  });
}

async function metrics(page) {
  return page.locator(bodySelector).evaluate((body) => ({
    top: body.scrollTop,
    height: body.scrollHeight,
    viewport: body.clientHeight,
    gap: body.scrollHeight - body.clientHeight - body.scrollTop,
  }));
}

async function bottom(page) {
  await page.waitForFunction(
    (selector) => {
      const body = document.querySelector(selector);
      return (
        body && body.scrollHeight - body.clientHeight - body.scrollTop <= 16
      );
    },
    bodySelector,
    { timeout: 4000 },
  );
}

async function advance(page, index, count) {
  const target = await page.evaluate(
    async ({ index, count }) => {
      await window.__chatScrollMock.advance(index, count);
      return window.__chatScrollMock.flows[index].paragraph;
    },
    { index, count },
  );
  await page
    .locator(bodySelector)
    .getByText(`Stream paragraph ${target}`, { exact: true })
    .waitFor();
  await page.waitForFunction(
    ({ selector, target, expected }) => {
      const heading = Array.from(
        document.querySelectorAll(`${selector} h3`),
      ).find((element) => element.textContent === `Stream paragraph ${target}`);
      return heading?.nextElementSibling?.textContent?.trim() === expected;
    },
    {
      selector: bodySelector,
      target,
      expected:
        "The response keeps growing while the reader controls the viewport. "
          .repeat(4)
          .trim(),
    },
  );
  await page.waitForTimeout(150);
}

async function send(page, prompt, flowIndex) {
  await page.locator("#chat-input").fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(
    (count) => window.__chatScrollMock.flows.length >= count,
    flowIndex + 1,
  );
}

async function readEarlier(page, mobile) {
  const body = page.locator(bodySelector);
  const rect = await body.boundingBox();
  if (process.env.UI_TEST_DEBUG === "1") {
    await body.evaluate((body) => {
      window.__scrollEvents = [];
      const record = (event) => {
        window.__scrollEvents.push({
          type: event.type,
          at: performance.now(),
          top: body.scrollTop,
          height: body.scrollHeight,
          viewport: body.clientHeight,
          y: event.touches?.[0]?.clientY,
          delta: event.deltaY,
          active: document.activeElement?.id,
          target: {
            tag: event.target?.tagName,
            id: event.target?.id,
            className: String(event.target?.className || "").slice(0, 100),
          },
          first: body.firstElementChild?.textContent?.slice(0, 60),
          last: body.lastElementChild?.textContent?.slice(0, 60),
        });
      };
      for (const type of [
        "touchstart",
        "touchmove",
        "touchend",
        "scroll",
        "wheel",
      ]) {
        body.addEventListener(type, record, { passive: true, capture: true });
      }
      for (const type of ["focusin", "click"]) {
        document.addEventListener(type, record, {
          passive: true,
          capture: true,
        });
      }
    });
  }
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height * 0.3);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (const distance of [60, 120, 200, 280]) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + distance }],
      });
      await page.waitForTimeout(40);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.wheel(0, -650);
  }
  await page.waitForFunction((selector) => {
    const body = document.querySelector(selector);
    return body && body.scrollHeight - body.clientHeight - body.scrollTop > 200;
  }, bodySelector);
  await page.waitForTimeout(450);
  if (process.env.UI_TEST_DEBUG === "1") {
    console.log(
      JSON.stringify({
        phase: "gesture-events",
        events: await page.evaluate(() => window.__scrollEvents),
      }),
    );
  }
  const contextMenu = page.locator('[class*="chat-context-menu_"]');
  if (await contextMenu.count()) {
    await page.keyboard.press("Escape");
    await contextMenu.waitFor({ state: "hidden" });
  }
}

async function seekHistory(page, latestText, direction) {
  const body = page.locator(bodySelector);
  const rect = await body.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  for (let attempt = 0; attempt < 7; attempt++) {
    // Existing history pagination runs on scroll; a second wheel at top=0
    // produces no scroll event, so leave the edge before seeking again.
    if (direction < 0 && (await metrics(page)).top <= 1) {
      await page.mouse.wheel(0, 48);
      await page.waitForTimeout(120);
    }
    await page.mouse.wheel(0, direction * 100000);
    await page.waitForTimeout(200);
    const includesLatest = await body
      .textContent()
      .then((text) => text.includes(latestText));
    if (
      direction < 0
        ? !includesLatest
        : includesLatest && (await metrics(page)).gap <= 16
    ) {
      return metrics(page);
    }
  }
  assert.fail(
    `cannot seek ${direction < 0 ? "older" : "latest"} history window`,
  );
}

async function waitForChunk(page, chunk, timeout = 4000) {
  await page.waitForFunction(
    ({ selector, chunk }) =>
      document.querySelector(selector)?.textContent?.includes(chunk),
    { selector: bodySelector, chunk },
    { polling: 50, timeout },
  );
}

async function runBackground(browser, width, phase) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    isMobile: width < 600,
    hasTouch: width < 600,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  const fixedTime = Date.now();
  const expectBroken = process.env.UI_TEST_EXPECT_BROKEN === "1";
  const report = { width, phase };
  try {
    await prepare(page);
    if (phase === "hidden") {
      await page.addInitScript(() => {
        const nativeRequest = window.requestAnimationFrame.bind(window);
        const nativeCancel = window.cancelAnimationFrame.bind(window);
        const nativeHidden = Object.getOwnPropertyDescriptor(
          Document.prototype,
          "hidden",
        ).get;
        const nativeVisibility = Object.getOwnPropertyDescriptor(
          Document.prototype,
          "visibilityState",
        ).get;
        const frames = new Map();
        let sequence = 0;
        let simulated = null;
        let completed = 0;
        const schedule = (id) => {
          const frame = frames.get(id);
          frame.native = nativeRequest((timestamp) => {
            frame.native = null;
            if (simulated) return;
            frames.delete(id);
            completed++;
            frame.callback(timestamp);
          });
        };
        window.requestAnimationFrame = (callback) => {
          const id = ++sequence;
          frames.set(id, { callback, native: null });
          if (!simulated) schedule(id);
          return id;
        };
        window.cancelAnimationFrame = (id) => {
          const frame = frames.get(id);
          if (frame && frame.native !== null) nativeCancel(frame.native);
          frames.delete(id);
        };
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => simulated ?? nativeHidden.call(document),
        });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () =>
            simulated === null
              ? nativeVisibility.call(document)
              : simulated
              ? "hidden"
              : "visible",
        });
        window.__backgroundFixture = {
          stats: () => ({ completed, queued: frames.size, simulated }),
          setHidden(hidden) {
            simulated = hidden;
            if (hidden) {
              for (const frame of frames.values()) {
                if (frame.native !== null) nativeCancel(frame.native);
                frame.native = null;
              }
            }
            document.dispatchEvent(new Event("visibilitychange"));
            if (!hidden) for (const id of frames.keys()) schedule(id);
          },
        };
      });
    }
    await page.goto(`${base}#/chat`);
    await page.locator("#chat-input").waitFor();
    await page.waitForFunction(
      () => document.body.classList.contains("theme-violet"),
      null,
      { polling: 50, timeout: 4000 },
    );
    report.theme = "theme-violet";
    if (["long", "stale"].includes(phase)) {
      await page.clock.setFixedTime(fixedTime);
    }
    await send(page, `BACKGROUND_FIXTURE_${phase.toUpperCase()}`, 0);
    await page.evaluate(() => window.__chatScrollMock.push(0, "STREAM_BEGIN"));
    await waitForChunk(page, "STREAM_BEGIN");
    if (phase === "navigation") {
      await page.evaluate(() => {
        location.hash = "#/settings";
      });
      await page.locator(bodySelector).waitFor({ state: "detached" });
      await page.evaluate(() =>
        window.__chatScrollMock.push(0, "\n\nSETTINGS_CHUNK"),
      );
      await page.waitForTimeout(350);
      await page.evaluate(() => {
        location.hash = "#/account";
      });
      await page.locator('[class*="account_body"]').waitFor();
      await page.evaluate(() =>
        window.__chatScrollMock.push(0, "\n\nACCOUNT_CHUNK"),
      );
      await page.waitForTimeout(350);
      await page.evaluate(() => {
        location.hash = "#/chat";
      });
      await page.locator("#chat-input").waitFor();
      await waitForChunk(page, "SETTINGS_CHUNK");
      await waitForChunk(page, "ACCOUNT_CHUNK");
      report.routes = ["settings", "account", "chat"];
    } else if (phase === "hidden") {
      const foreground = await context.newPage();
      await foreground.setContent("<h1>Foreground fixture</h1>");
      await foreground.bringToFront();
      const actualVisibility = await page.evaluate(
        () => document.visibilityState,
      );
      report.actualVisibility = actualVisibility;
      report.visibilityMode =
        actualVisibility === "hidden"
          ? "real-background-tab"
          : "simulated-hidden-with-paused-raf";
      if (actualVisibility !== "hidden") {
        await page.evaluate(() => window.__backgroundFixture.setHidden(true));
      }
      const before = await page.evaluate(() =>
        window.__backgroundFixture.stats(),
      );
      await page.evaluate(() =>
        window.__chatScrollMock.push(0, "\n\nHIDDEN_CHUNK"),
      );
      await page.waitForTimeout(1000);
      const hidden = await page.evaluate(
        (selector) => ({
          visibility: document.visibilityState,
          hidden: document.hidden,
          hasChunk: document
            .querySelector(selector)
            ?.textContent?.includes("HIDDEN_CHUNK"),
          scheduler: window.__backgroundFixture.stats(),
        }),
        bodySelector,
      );
      report.hidden = hidden;
      assert.equal(hidden.visibility, "hidden");
      assert.equal(hidden.hidden, true);
      if (actualVisibility !== "hidden") {
        assert.equal(
          hidden.scheduler.completed,
          before.completed,
          "simulated background must suspend RAF callbacks",
        );
      }
      assert.equal(hidden.hasChunk, !expectBroken, JSON.stringify(report));
      if (actualVisibility !== "hidden") {
        await page.evaluate(() => window.__backgroundFixture.setHidden(false));
      }
      await foreground.close();
      await page.bringToFront();
      await waitForChunk(page, "HIDDEN_CHUNK");
    } else if (phase === "long") {
      // Only Date is shifted; real timers keep running. 61 seconds stays below
      // the chat component's six-minute stale-message cleanup threshold.
      await page.clock.setFixedTime(fixedTime + 61001);
      await page.waitForTimeout(100);
      await page.evaluate(() =>
        window.__chatScrollMock.push(0, "\n\nAFTER_SIXTY_SECONDS"),
      );
      await page.waitForTimeout(1000);
      const duration = await page.evaluate(
        (selector) => ({
          elapsed: Date.now() - window.__chatScrollMock.flows[0].startedAt,
          hasChunk: document
            .querySelector(selector)
            ?.textContent?.includes("AFTER_SIXTY_SECONDS"),
          hasStaleError: document
            .querySelector(selector)
            ?.textContent?.includes("empty response"),
        }),
        bodySelector,
      );
      report.duration = duration;
      assert(
        duration.elapsed > 60000 && duration.elapsed < 360000,
        JSON.stringify(duration),
      );
      assert.equal(duration.hasStaleError, false);
      assert.equal(duration.hasChunk, !expectBroken, JSON.stringify(report));
    } else if (phase === "stale") {
      await page.evaluate(() => {
        location.hash = "#/settings";
      });
      await page.locator(bodySelector).waitFor({ state: "detached" });
      await page.clock.setFixedTime(fixedTime + 361001);
      await page.evaluate(() => {
        location.hash = "#/chat";
      });
      await page.locator("#chat-input").waitFor();
      await waitForChunk(page, "STREAM_BEGIN");
      await page.waitForTimeout(150);
      const active = await page.evaluate((selector) => {
        const container = Array.from(
          document.querySelectorAll(
            `${selector} [class*="chat-message-container"]`,
          ),
        ).find((element) => element.textContent.includes("STREAM_BEGIN"));
        return {
          elapsed: Date.now() - window.__chatScrollMock.flows[0].startedAt,
          typing: !!container?.querySelector('[class*="chat-typing-dots"]'),
          hasStaleError: document
            .querySelector(selector)
            ?.textContent?.includes("empty response"),
        };
      }, bodySelector);
      report.activeAfterReturn = active;
      assert(active.elapsed > 360000, JSON.stringify(active));
      assert.equal(active.typing, true);
      assert.equal(active.hasStaleError, false);
      await page.evaluate(() =>
        window.__chatScrollMock.push(0, "\n\nAFTER_SIX_MINUTES"),
      );
      await waitForChunk(page, "AFTER_SIX_MINUTES");
    } else {
      assert.fail(`unknown background phase ${phase}`);
    }
    if (!(expectBroken && phase === "long")) {
      await page.evaluate(() =>
        window.__chatScrollMock.push(0, "\n\nRESUMED_CHUNK"),
      );
      await waitForChunk(page, "RESUMED_CHUNK");
    }
    const beforeFinish = await page.evaluate(() => ({
      requests: window.__chatScrollMock.requests,
      flows: window.__chatScrollMock.flows.length,
      aborted: window.__chatScrollMock.flows[0].aborted,
      cancelled: window.__chatScrollMock.flows[0].cancelled,
      finished: window.__chatScrollMock.flows[0].finished,
    }));
    assert.equal(beforeFinish.requests.length, 1);
    assert.equal(beforeFinish.requests[0].method, "POST");
    assert.equal(beforeFinish.flows, 1);
    assert.equal(beforeFinish.aborted, false);
    assert.equal(beforeFinish.cancelled, false);
    assert.equal(beforeFinish.finished, false);
    await page.evaluate(() => window.__chatScrollMock.finish(0));
    await waitForChunk(page, "SCROLL_COMPLETE");
    const text = await page.locator(bodySelector).textContent();
    for (const marker of ["STREAM_BEGIN", "SCROLL_COMPLETE"]) {
      assert.equal(
        text.split(marker).length - 1,
        1,
        `${marker} must not duplicate`,
      );
    }
    if (phase === "long")
      assert.equal(text.split("AFTER_SIXTY_SECONDS").length - 1, 1);
    if (phase === "hidden")
      assert.equal(text.split("HIDDEN_CHUNK").length - 1, 1);
    if (phase === "stale")
      assert.equal(text.split("AFTER_SIX_MINUTES").length - 1, 1);
    assert.equal(
      await page.evaluate(() => window.__chatScrollMock.requests.length),
      1,
    );
    await bottom(page);
    const screenshot = path.join(
      os.tmpdir(),
      `octopus-chat-background-${width}-${phase}.png`,
    );
    await page.screenshot({ path: screenshot });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        ...report,
        posts: 1,
        screenshot,
        result: expectBroken ? "baseline-reproduced" : "passed",
      }),
    );
  } catch (error) {
    const screenshot = path.join(
      os.tmpdir(),
      `octopus-chat-background-${width}-${phase}-failure.png`,
    );
    await page.screenshot({ path: screenshot });
    console.error(JSON.stringify({ ...report, screenshot, errors }));
    throw error;
  } finally {
    await context.close();
  }
}

async function runReorder(browser, width) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    serviceWorkers: "block",
  });
  try {
    await prepare(page);
    await page.goto(`${base}#/`);
    const first = page.locator('[data-rfd-draggable-id="scroll-a"]');
    await first.waitFor();
    await first.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      window.__dragFrames = [];
      const observer = new MutationObserver(() => {
        const items = [...document.querySelectorAll("[data-rfd-draggable-id]")];
        if (items[0]?.getAttribute("data-rfd-draggable-id") !== "scroll-b")
          return;
        observer.disconnect();
        const sample = () => {
          window.__dragFrames.push(
            items.map((item) => ({
              id: item.getAttribute("data-rfd-draggable-id"),
              top: item.getBoundingClientRect().top,
              transition: getComputedStyle(item).transitionProperty,
            })),
          );
          if (window.__dragFrames.length < 24) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await page.keyboard.press("Space");
    await page.waitForFunction(() => window.__dragFrames.length === 24);
    const frames = await page.evaluate(() => window.__dragFrames);
    for (const frame of frames) {
      for (let index = 0; index < frame.length; index++) {
        assert(
          Math.abs(frame[index].top - frames.at(-1)[index].top) <= 1,
          JSON.stringify({ width, frames }),
        );
      }
    }
    const styles = await first.evaluate((item) => ({
      transition: getComputedStyle(item).transitionProperty,
      titleAnimation: getComputedStyle(
        item.querySelector('[class*="chat-item-title"]'),
      ).animationName,
      infoAnimation: getComputedStyle(
        item.querySelector('[class*="chat-item-info"]'),
      ).animationName,
    }));
    assert(!styles.transition.includes("transform"), JSON.stringify(styles));
    assert.equal(styles.titleAnimation, "none");
    assert.equal(styles.infoAnimation, "none");
    await first.hover();
    assert.equal(
      await first.evaluate((item) => getComputedStyle(item).transform),
      "none",
    );
    const source = await first.boundingBox();
    const target = await page
      .locator('[data-rfd-draggable-id="scroll-b"]')
      .boundingBox();
    const x = source.x + source.width / 2;
    await page.mouse.move(x, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(x + 8, source.y + source.height / 2, { steps: 4 });
    await page.mouse.move(x + 8, target.y + target.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-rfd-draggable-id]")
          ?.getAttribute("data-rfd-draggable-id") === "scroll-a",
    );
    const mouseFrames = await first.evaluate(
      (item) =>
        new Promise((resolve) => {
          const frames = [];
          const sample = () => {
            frames.push(item.getBoundingClientRect().top);
            if (frames.length < 24) requestAnimationFrame(sample);
            else resolve(frames);
          };
          requestAnimationFrame(sample);
        }),
    );
    assert(
      mouseFrames.every((top) => Math.abs(top - mouseFrames.at(-1)) <= 1),
      JSON.stringify({ width, mouseFrames }),
    );
    console.log(
      JSON.stringify({
        width,
        reorder: true,
        mouseDrag: true,
        stableDrop: true,
        noReplayedEntrance: true,
        result: "passed",
      }),
    );
  } finally {
    await page.close();
  }
}

async function runReturn(browser, width) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    isMobile: width < 600,
    hasTouch: width < 600,
    serviceWorkers: "block",
  });
  try {
    await prepare(page);
    await page.goto(`${base}#/chat`);
    await page.locator("#chat-input").waitFor();
    await send(page, "RETURN_STREAM_FIXTURE", 0);
    await page.evaluate(() =>
      window.__chatScrollMock.push(
        0,
        Array.from(
          { length: 12 },
          (_, i) =>
            `\n\nReturn paragraph ${i + 1}: ${"Current output content. ".repeat(
              12,
            )}`,
        ).join(""),
      ),
    );
    await waitForChunk(page, "Return paragraph 1");
    await page.goto(`${base}#/`);
    await page.getByText("Scroll Session B", { exact: true }).first().click();
    await bottom(page);
    // Allow the transport buffer to persist while A is offscreen; returning
    // must position already received content without replaying its scroll.
    await page.waitForTimeout(1500);
    await page.goto(`${base}#/`);
    await page.evaluate((selector) => {
      window.__returnFrames = [];
      const previous = document.querySelector(selector);
      const observer = new MutationObserver(() => {
        const body = document.querySelector(selector);
        if (
          !body ||
          body === previous ||
          !body.textContent.includes("RETURN_STREAM_FIXTURE")
        )
          return;
        observer.disconnect();
        const sample = () => {
          if (
            body.dataset.scrollReady !== "false" &&
            getComputedStyle(body).visibility === "visible"
          )
            window.__returnFrames.push({
              gap: body.scrollHeight - body.clientHeight - body.scrollTop,
              top: body.scrollTop,
            });
          if (window.__returnFrames.length < 8) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, bodySelector);
    await page.getByText("Scroll Session A", { exact: true }).first().click();
    await page.waitForFunction(() => window.__returnFrames.length === 8);
    const frames = await page.evaluate(() => window.__returnFrames);
    assert(
      frames.every((frame) => frame.gap <= 16),
      JSON.stringify({ width, frames }),
    );
    await page.evaluate(() =>
      window.__chatScrollMock.push(0, "\n\nRETURN_LIVE_CHUNK"),
    );
    await waitForChunk(page, "RETURN_LIVE_CHUNK", 30000);
    await bottom(page);
    await readEarlier(page, width < 600);
    const paused = await metrics(page);
    await page.evaluate(() =>
      window.__chatScrollMock.push(0, "\n\nREADER_STAYS_PAUSED"),
    );
    await waitForChunk(page, "READER_STAYS_PAUSED", 30000);
    const reading = await metrics(page);
    assert(
      Math.abs(reading.top - paused.top) <= 32,
      JSON.stringify({ paused, reading }),
    );
    await page
      .getByRole("button", { name: /回到底部|滚到最新/ })
      .last()
      .click();
    await bottom(page);
    await page.evaluate(() => window.__chatScrollMock.finish(0));
    await waitForChunk(page, "SCROLL_COMPLETE");
    await bottom(page);
    console.log(
      JSON.stringify({
        width,
        frames,
        immediateReturn: true,
        continuedFollowing: true,
        manualPause: true,
        result: "passed",
      }),
    );
  } finally {
    await page.close();
  }
}

async function runRestore(browser, width) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    isMobile: width < 600,
    hasTouch: width < 600,
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  const phases = [];
  try {
    await prepare(page);
    await page.addInitScript(() => {
      const saved = JSON.parse(localStorage.getItem("chat-next-web-store"));
      saved.state.currentSessionIndex = 1;
      for (const session of saved.state.sessions)
        for (const message of session.messages)
          if (message.role === "assistant")
            message.content = Array(4).fill(message.content).join("\n\n");
      localStorage.setItem("chat-next-web-store", JSON.stringify(saved));
      let revision = 0;
      window.__historyRestore = {
        samples: [],
        complete: false,
        start() {
          const current = ++revision;
          this.samples = [];
          this.complete = false;
          let firstVisible;
          const sample = () => {
            if (current !== revision) return;
            const body = document.querySelector('[class*="chat-body_"]');
            if (
              body?.clientHeight &&
              body.dataset.scrollReady !== "false" &&
              getComputedStyle(body).visibility === "visible"
            ) {
              firstVisible ??= performance.now();
              this.samples.push({
                gap: body.scrollHeight - body.clientHeight - body.scrollTop,
                top: body.scrollTop,
                height: body.scrollHeight,
                ready: body.dataset.scrollReady,
              });
              if (performance.now() - firstVisible >= 1200) {
                this.complete = true;
                return;
              }
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        },
      };
      window.__historyRestore.start();
    });
    const collect = async (name) => {
      await page.waitForFunction(() => window.__historyRestore.complete);
      const samples = await page.evaluate(
        () => window.__historyRestore.samples,
      );
      assert(samples.length > 2, `${name}: history must become visible`);
      assert(
        samples.every((sample) => sample.ready === "true" && sample.gap <= 16),
        JSON.stringify({ width, name, samples }),
      );
      phases.push({ name, first: samples[0], last: samples.at(-1) });
    };
    await page.goto(`${base}#/chat`);
    await collect("initial");
    await page.reload();
    await collect("reload");
    for (const id of ["scroll-a", "scroll-b"]) {
      if (width < 600) await page.goto(`${base}#/`);
      await page.evaluate(() => window.__historyRestore.start());
      await page.locator(`[data-rfd-draggable-id="${id}"]`).click();
      await collect(`switch-${id}`);
    }
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(() => window.__chatScrollMock.requests.length),
      0,
    );
    console.log(
      JSON.stringify({ width, phases, paidRequests: 0, result: "passed" }),
    );
  } finally {
    await page.close();
  }
}

async function run(browser, width) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    isMobile: width < 600,
    hasTouch: width < 600,
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  const screenshot = async (phase) => {
    const target = path.join(
      os.tmpdir(),
      `octopus-chat-scroll-${width}-${phase}.png`,
    );
    await page.screenshot({ path: target });
    return target;
  };
  try {
    await prepare(page);
    await page.goto(`${base}#/chat`);
    await page.locator("#chat-input").waitFor();
    await send(page, "SCROLL_FIXTURE_RUN", 0);
    await advance(page, 0, 14);
    const initial = await metrics(page);
    if (process.env.UI_TEST_EXPECT_BROKEN === "1") {
      console.log(
        JSON.stringify({
          width,
          phase: "baseline",
          ...initial,
          screenshot: await screenshot("baseline"),
        }),
      );
      assert(
        initial.gap > 100,
        "baseline must reproduce loss of stream following",
      );
      await page.evaluate(() => window.__chatScrollMock.finish(0));
      return;
    }
    await bottom(page);
    await screenshot("following");
    const toBottom = page
      .getByRole("button", { name: /回到底部|滚到最新/ })
      .last();
    let concurrentTouch;
    if (width < 600) {
      await Promise.all([advance(page, 0, 6), readEarlier(page, true)]);
      const paused = await metrics(page);
      assert(paused.gap > 100, JSON.stringify(paused));
      await advance(page, 0, 3);
      const reading = await metrics(page);
      assert(
        Math.abs(reading.top - paused.top) <= 32,
        JSON.stringify({ paused, reading }),
      );
      await screenshot("concurrent-paused");
      await toBottom.click();
      await advance(page, 0, 2);
      await bottom(page);
      concurrentTouch = { paused, reading, resumed: await metrics(page) };
      if (process.env.UI_TEST_TOUCH_CONCURRENT_ONLY === "1") {
        await page.evaluate(() => window.__chatScrollMock.finish(0));
        await toBottom.waitFor({ state: "hidden" });
        await bottom(page);
        assert.deepEqual(errors, []);
        console.log(
          JSON.stringify({ width, initial, concurrentTouch, result: "passed" }),
        );
        return;
      }
    }
    let smallScroll;
    if (width >= 600) {
      const rect = await page.locator(bodySelector).boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.wheel(0, -10);
      await page.waitForTimeout(180);
      const before = await metrics(page);
      assert(before.gap >= 8 && before.gap <= 16, JSON.stringify(before));
      await advance(page, 0, 2);
      const after = await metrics(page);
      assert(
        Math.abs(after.top - before.top) <= 3,
        JSON.stringify({ before, after }),
      );
      smallScroll = { before, after };
      await toBottom.click();
      await bottom(page);
    }
    await page.locator(bodySelector).evaluate((body) => {
      body.lastElementChild.style.paddingBottom = "320px";
    });
    await bottom(page);
    const beforeShrink = await metrics(page);
    await page.locator(bodySelector).evaluate((body) => {
      body.lastElementChild.style.removeProperty("padding-bottom");
    });
    await page.waitForTimeout(100);
    const afterShrink = await metrics(page);
    assert(afterShrink.top <= beforeShrink.top - 250);
    await advance(page, 0, 2);
    await bottom(page);
    const shrinkFollow = await metrics(page);
    await readEarlier(page, width < 600);
    const paused = await metrics(page);
    assert(paused.gap > 100, JSON.stringify({ paused }));
    await toBottom.waitFor();
    const bounds = await toBottom.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await advance(page, 0, 10);
    const reading = await metrics(page);
    assert(
      Math.abs(reading.top - paused.top) <= 32,
      JSON.stringify({ paused, reading }),
    );
    await screenshot("paused");
    await toBottom.click();
    await bottom(page);
    await advance(page, 0, 10);
    await bottom(page);
    const resumed = await metrics(page);
    await page.evaluate(() => window.__chatScrollMock.finish(0));
    await page
      .locator(bodySelector)
      .getByText("SCROLL_COMPLETE", { exact: true })
      .waitFor();
    await bottom(page);
    const finished = await metrics(page);
    await toBottom.waitFor({ state: "hidden" });
    await screenshot("finished");
    await send(page, "SCROLL_SWITCH_STREAM", 1);
    await advance(page, 1, 3);
    await page.goto(`${base}#/`);
    await page.getByText("Scroll Session B", { exact: true }).first().click();
    await page.waitForFunction(() =>
      document
        .querySelector(".window-header-title")
        ?.textContent?.includes("Scroll Session B"),
    );
    await bottom(page);
    await readEarlier(page, width < 600);
    const beforeBackground = await metrics(page);
    await page.evaluate(async () => {
      await window.__chatScrollMock.advance(1, 12);
      window.__chatScrollMock.finish(1);
    });
    await page.waitForTimeout(250);
    const afterBackground = await metrics(page);
    assert(
      Math.abs(afterBackground.top - beforeBackground.top) <= 32,
      JSON.stringify({ beforeBackground, afterBackground }),
    );
    assert(
      !(await page
        .locator(bodySelector)
        .textContent()
        .then((text) => text.includes("SCROLL_SWITCH_STREAM"))),
    );
    await screenshot("session-switch");
    const oldWindow = await seekHistory(
      page,
      "Scroll Session B history 70",
      -1,
    );
    await toBottom.evaluate((button, selector) => {
      const body = document.querySelector(selector);
      body.dispatchEvent(new Event("scroll", { bubbles: true }));
      button.click();
    }, bodySelector);
    await page
      .locator(bodySelector)
      .getByText("Scroll Session B history 70", { exact: true })
      .waitFor();
    await bottom(page);
    await page.waitForTimeout(200);
    const jumpedLatest = await metrics(page);
    assert(jumpedLatest.gap <= 16, JSON.stringify(jumpedLatest));
    await toBottom.waitFor({ state: "hidden" });
    await screenshot("pagination");
    await send(page, "SCROLL_PAGINATION_STREAM", 2);
    await advance(page, 2, 3);
    await seekHistory(page, "SCROLL_PAGINATION_STREAM", -1);
    await seekHistory(page, "SCROLL_PAGINATION_STREAM", 1);
    await advance(page, 2, 3);
    await bottom(page);
    const paginationFollow = await metrics(page);
    await page.evaluate(() => window.__chatScrollMock.finish(2));
    await toBottom.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        initial,
        concurrentTouch,
        smallScroll,
        beforeShrink,
        afterShrink,
        shrinkFollow,
        paused,
        reading,
        resumed,
        finished,
        beforeBackground,
        afterBackground,
        oldWindow,
        jumpedLatest,
        paginationFollow,
        result: "passed",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({ width, screenshot: await screenshot("failure") }),
    );
    if (process.env.UI_TEST_DEBUG === "1") {
      console.error(
        JSON.stringify(await page.evaluate(() => window.__scrollEvents)),
      );
    }
    throw error;
  } finally {
    await page.close();
  }
}

async function runSvgStream(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await prepare(page);
    if (process.env.UI_TEST_SVG_HISTORY_MB) {
      await page.addInitScript((size) => {
        if (window.top !== window) return;
        const key = "chat-next-web-store";
        const stored = JSON.parse(localStorage.getItem(key));
        stored.state.sessions[1].messages.push({
          id: "svg-large-history",
          role: "assistant",
          date: new Date().toISOString(),
          content:
            "![Generated Image](data:image/png;base64," +
            "A".repeat(size * 1048576) +
            ")",
        });
        localStorage.setItem(key, JSON.stringify(stored));
      }, Number(process.env.UI_TEST_SVG_HISTORY_MB));
    }
    await page.goto(base);
    await page.locator("#chat-input").fill("Return an animated SVG fixture.");
    await page.locator("#chat-input").press("Enter");
    await page.waitForFunction(() => window.__chatScrollMock?.flows.length > 0);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    let peakHeapMB = 0;
    let maxPendingLocks = 0;
    const sample = async (stage) => {
      const result = await cdp.send("Performance.getMetrics");
      const values = Object.fromEntries(
        result.metrics.map((metric) => [metric.name, metric.value]),
      );
      const locks = await page.evaluate(() => navigator.locks.query());
      peakHeapMB = Math.max(peakHeapMB, values.JSHeapUsedSize / 1048576);
      maxPendingLocks = Math.max(maxPendingLocks, locks.pending.length);
      console.log(
        JSON.stringify({
          stage,
          heapMB: Math.round(values.JSHeapUsedSize / 1048576),
          nodes: values.Nodes,
          documents: values.Documents,
          frames: page.frames().length,
          pendingLocks: locks.pending.length,
        }),
      );
    };
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><style>@keyframes spin {to {transform:rotate(360deg)}}</style>' +
      Array.from(
        { length: 150 },
        (_, i) =>
          `<g transform="translate(${
            i * 3
          } 100)"><circle cx="100" cy="100" r="30" fill="teal"/><animateTransform attributeName="transform" type="rotate" from="0 100 100" to="360 100 100" dur="2s" repeatCount="indefinite"/></g>\n`,
      ).join("") +
      "</svg>";
    const document =
      process.env.UI_TEST_SVG_HTML === "1"
        ? "<!DOCTYPE html><html><head><title>Fixture</title></head><body>" +
          svg +
          "</body></html>"
        : svg;
    const output =
      process.env.UI_TEST_SVG_FENCED === "1"
        ? "```xml\n" + document + "\n```"
        : document;
    await sample("before-svg");
    for (let offset = 0; offset < output.length; offset += 256) {
      await page.evaluate(
        (text) => window.__chatScrollMock.push(0, text),
        output.slice(offset, offset + 256),
      );
      await page.waitForTimeout(35);
      if (offset % 4096 === 0) {
        await sample(`stream-${offset}`);
        assert.equal(
          await page.locator(".markdown-body iframe").count(),
          0,
          "Incomplete streaming documents must not create a preview",
        );
      }
    }
    await page.evaluate(() => window.__chatScrollMock.finish(0));
    assert.equal(
      await page.locator(".markdown-body iframe").count(),
      0,
      "Finishing the network must not preview the remaining typing backlog",
    );
    // Flush the fixture's long typing backlog without waiting for a full replay.
    // The hook's pacing and completion behavior have separate unit coverage.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .locator(".markdown-body iframe")
      .first()
      .waitFor({ state: "attached", timeout: 30000 });
    assert.equal(
      await page.locator(".markdown-body iframe").count(),
      1,
      "The completed document must have one preview",
    );
    await page.waitForTimeout(3000);
    await cdp.send("HeapProfiler.collectGarbage");
    await sample("finished");
    await page.waitForTimeout(5000);
    await cdp.send("HeapProfiler.collectGarbage");
    await sample("idle");
    const persisted = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = db
            .transaction("keyval", "readonly")
            .objectStore("keyval")
            .get("chat-next-web-store");
          request.onsuccess = () => resolve(JSON.parse(request.result));
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
    assert.equal(
      persisted.state.sessions[0].messages.at(-1).content,
      output + "\n\nSCROLL_COMPLETE",
    );
    if (process.env.UI_TEST_SVG_HISTORY_MB)
      assert(
        persisted.state.sessions[1].messages.at(-1).content.length >
          Number(process.env.UI_TEST_SVG_HISTORY_MB) * 1048576,
      );
    assert(
      maxPendingLocks <= 1,
      "Streaming must not queue historical snapshots",
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        peakHeapMB: Math.round(peakHeapMB),
        maxPendingLocks,
        latestSnapshotSaved: true,
        paidRequests: 0,
      }),
    );
    console.log(JSON.stringify({ errors }));
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_TEST_BROWSER
      ? { channel: process.env.UI_TEST_BROWSER }
      : {}),
  });
  try {
    if (process.env.UI_TEST_SCENARIO === "svg") {
      await runSvgStream(browser);
      return;
    }
    const widths = process.env.UI_TEST_WIDTH
      ? [Number(process.env.UI_TEST_WIDTH)]
      : [1440, 390];
    if (process.env.UI_TEST_SCENARIO === "restore") {
      for (const width of widths) await runRestore(browser, width);
      return;
    }
    if (process.env.UI_TEST_SCENARIO === "reorder") {
      for (const width of widths) await runReorder(browser, width);
      return;
    }
    if (process.env.UI_TEST_SCENARIO === "return") {
      for (const width of widths) await runReturn(browser, width);
      return;
    }
    if (process.env.UI_TEST_SCENARIO === "background") {
      const phases = process.env.UI_TEST_BACKGROUND_PHASE
        ? process.env.UI_TEST_BACKGROUND_PHASE.split(",")
        : ["navigation", "hidden", "long"];
      for (const width of widths) {
        for (const phase of phases) await runBackground(browser, width, phase);
      }
      return;
    }
    for (const width of widths) await run(browser, width);
  } finally {
    await browser.close();
  }
}

module.exports = { prepare };
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
