// Isolated browser fixtures: no real account credentials, tools, or paid model calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const origin = new URL(base).origin;
const output =
  process.env.UI_TEST_OUTPUT_DIR ||
  "C:/Users/86136/.codex/visualizations/2026/11/02/01a19d7b-24fa-75e3-bd05-b433759e1c48/assistant-ui-chat/qa";
const model = "gpt-assistant-fixture-with-a-long-model-name-for-layout";
const reports = [];
const diagnosticWrites = [];
const modelConfig = {
  model,
  providerName: "gpt",
  stream: true,
  temperature: 0.4,
  top_p: 1,
  max_tokens: 6000,
  sendMemory: false,
  historyMessageCount: 30,
  compressMessageLengthThreshold: 999999,
  enableInjectSystemPrompts: false,
  template: "{{input}}",
  size: "auto",
  quality: "auto",
  style: "auto",
};

function session(tools) {
  const messages = tools
    ? [
        { id: "tool-question", role: "user", content: "QA_TOOL_RESULTS" },
        {
          id: "tool-answer",
          role: "assistant",
          content: "QA_TOOLS_COMPLETE",
          tools: [
            {
              id: "tool-table",
              function: {
                name: "inventory_report_with_a_very_long_tool_name_for_layout",
                arguments: '{"region":"Shanghai","limit":2}',
              },
              content: JSON.stringify({
                structuredContent: [
                  { product: "Camera", stock: 7, warehouse: "Shanghai" },
                  { product: "Lens", stock: 13, warehouse: "Hangzhou" },
                ],
              }),
              isError: false,
            },
            {
              id: "tool-web",
              function: {
                name: "web_search",
                arguments: '{"query":"assistant-ui official documentation"}',
              },
              content: JSON.stringify({
                results: [
                  {
                    title: "QA_OFFICIAL_SOURCE",
                    url: "https://www.assistant-ui.com/docs",
                    snippet: "Official documentation fixture.",
                  },
                  { title: "Unsafe source", url: "javascript:alert(1)" },
                ],
              }),
              isError: false,
            },
          ],
        },
      ].map((message) => ({
        date: "2026-11-03T08:00:00.000Z",
        model,
        ...message,
      }))
    : [];
  return {
    id: "assistant-qa",
    topic: "Assistant UI QA",
    memoryPrompt: "",
    stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,
    messages,
    mask: {
      id: "assistant-qa-mask",
      createdAt: Date.now(),
      name: "Assistant UI QA",
      avatar: "gpt-bot",
      context: [],
      syncGlobalConfig: false,
      modelConfig,
      lang: "cn",
      builtin: false,
    },
  };
}

async function attachDiagnostics(page, report) {
  report.exceptions = [];
  report.failedScripts = [];
  report.requestFailures = [];
  report.jsResponses = [];
  page.on("requestfailed", (request) =>
    report.requestFailures.push({
      url: request.url(),
      error: request.failure()?.errorText,
    }),
  );
  page.on("response", (response) => {
    if (!/\.js(?:\?|$)/.test(response.url())) return;
    const item = {
      url: response.url(),
      status: response.status(),
      contentType: response.headers()["content-type"],
    };
    report.jsResponses.push(item);
    diagnosticWrites.push(
      response
        .body()
        .then((body) => {
          item.bytes = body.length;
        })
        .catch((error) => {
          item.bodyError = error.message;
        }),
    );
  });
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    report.exceptions.push(exceptionDetails);
  });
  cdp.on("Debugger.scriptFailedToParse", (event) => {
    const item = { ...event };
    report.failedScripts.push(item);
    diagnosticWrites.push(
      cdp
        .send("Debugger.getScriptSource", { scriptId: event.scriptId })
        .then(({ scriptSource }) => {
          item.sourcePath = path.join(
            output,
            `failed-${report.width}-${report.scenario}-${event.scriptId}.js`,
          );
          fs.writeFileSync(item.sourcePath, scriptSource);
          item.bytes = Buffer.byteLength(scriptSource);
        })
        .catch((error) => {
          item.sourceError = error.message;
        }),
    );
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Debugger.enable");
}

async function prepare(
  page,
  theme,
  tools = false,
  { defaultPreview = false } = {},
) {
  await page.addInitScript(
    ({ theme, modelConfig, savedSession, defaultPreview }) => {
      if (window !== window.top) return;
      if (!localStorage.getItem("assistant-chat-qa")) {
        localStorage.setItem("assistant-chat-qa", "1");
        localStorage.setItem("lang", "cn");
        localStorage.setItem(
          "chat-next-web-store",
          JSON.stringify({
            version: 3.3,
            state: {
              sessions: [savedSession],
              currentSessionIndex: 0,
              lastInput: "",
            },
          }),
        );
        localStorage.setItem(
          "app-config",
          JSON.stringify({
            version: 4.3,
            state: {
              theme,
              models: [],
              modelConfig,
              enableAutoGenerateTitle: false,
              disablePromptHint: true,
              ...(defaultPreview ? {} : { sendPreviewBubble: false }),
            },
          }),
        );
      }
      const nativeFetch = window.fetch.bind(window);
      const encoder = new TextEncoder();
      const flows = [];
      const requests = [];
      window.__assistantQa = {
        flows,
        requests,
        push(index, delta) {
          const flow = flows[index];
          flow.controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`,
            ),
          );
        },
        finish(index, content) {
          const flow = flows[index];
          if (content) this.push(index, { content });
          flow.controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          flow.controller.close();
          flow.finished = true;
        },
      };
      window.fetch = async (input, init) => {
        const url = String(typeof input === "string" ? input : input.url);
        if (!url.includes("/chat/completions")) return nativeFetch(input, init);
        const payload = JSON.parse(init?.body || "{}");
        requests.push(payload);
        if (!payload.stream)
          return Response.json({
            choices: [{ message: { content: "QA_NONSTREAM" } }],
          });
        const flow = {
          finished: false,
          cancelled: false,
          aborted: false,
          payload,
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
          if (!flow.finished && !flow.cancelled)
            flow.controller.error(
              new DOMException("Fixture cancelled", "AbortError"),
            );
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
        flows.push(flow);
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      };
    },
    { theme, modelConfig, savedSession: session(tools), defaultPreview },
  );
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (request.headers()["next-action"])
      return route.fulfill({ status: 503, body: "Fixture: MCP unavailable" });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const config = {
      newApiEnabled: false,
      needCode: false,
      hasModelApiKey: true,
      enableMcp: false,
      defaultModel: model,
    };
    if (url.pathname === "/api/new-api/bootstrap")
      return route.fulfill({
        json: {
          success: true,
          data: {
            config,
            session: {
              authenticated: false,
              user: null,
              selectedTokenId: null,
            },
          },
        },
      });
    if (url.pathname === "/api/config") return route.fulfill({ json: config });
    if (url.pathname === "/api/new-api/status")
      return route.fulfill({
        json: { success: true, data: { enabled: false } },
      });
    if (url.pathname === "/api/announcement")
      return route.fulfill({ json: { announcement: null } });
    if (url.pathname === "/api/ai-daily")
      return route.fulfill({ json: { items: [] } });
    if (url.pathname === "/api/skills/capabilities")
      return route.fulfill({ json: { web: false, papers: false } });
    return route.fulfill({ json: { data: [{ id: model }], enabled: false } });
  });
}

async function geometry(page, mobile) {
  const expectedWidth = page.viewportSize().width;
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  const layoutSamples = await page.evaluate(
    (expectedWidth) =>
      new Promise((resolve) => {
        const samples = [];
        const started = performance.now();
        let stable = 0;
        const sample = () => {
          const width = document.documentElement.scrollWidth;
          samples.push({
            width,
            inner: innerWidth,
            client: document.documentElement.clientWidth,
            focused: document.activeElement?.tagName,
          });
          stable = width <= expectedWidth + 1 ? stable + 1 : 0;
          if (
            (stable >= 3 && samples.length >= 12) ||
            performance.now() - started > 1500
          )
            return resolve(samples);
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    expectedWidth,
  );
  const result = await page.evaluate((expectedWidth) => {
    const toolbar = document.querySelector(
      '[class*="chat-input-panel_"] [class*="composer-toolbar_"]',
    );
    const panel = document.querySelector('[class*="chat-input-panel_"]');
    return {
      width: innerWidth,
      expectedWidth,
      clientWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      overflowElements: [...document.querySelectorAll("html, body, body *")]
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.right > expectedWidth + 1)
        .slice(0, 15)
        .map(({ node, rect }) => ({
          tag: node.tagName,
          className: String(node.className).slice(0, 150),
          text: node.textContent?.slice(0, 50),
          rect: rect.toJSON(),
          position: getComputedStyle(node).position,
        })),
      bodyRect: document.body.getBoundingClientRect().toJSON(),
      overflowingContent: [...document.querySelectorAll("body *")]
        .filter(
          (node) =>
            node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 2,
        )
        .slice(0, 25)
        .map((node) => ({
          tag: node.tagName,
          className: String(node.className).slice(0, 150),
          client: node.clientWidth,
          scroll: node.scrollWidth,
          overflow: getComputedStyle(node).overflow,
          text: node.textContent?.slice(0, 50),
        })),
      pseudoElements: [...document.querySelectorAll("body, body *")]
        .flatMap((node) =>
          ["::before", "::after"].map((pseudo) => {
            const style = getComputedStyle(node, pseudo);
            return {
              tag: node.tagName,
              className: String(node.className).slice(0, 120),
              pseudo,
              content: style.content,
              position: style.position,
              width: style.width,
              left: style.left,
              right: style.right,
              transform: style.transform,
            };
          }),
        )
        .filter(
          (style) => style.content !== "none" && style.content !== "normal",
        ),
      focused: document.activeElement?.outerHTML.slice(0, 500),
      panel: panel?.getBoundingClientRect().toJSON(),
      controls: [...(toolbar?.querySelectorAll("button") || [])]
        .filter((button) => button.getBoundingClientRect().width > 0)
        .map((button) => ({
          name: button.getAttribute("aria-label"),
          ...button.getBoundingClientRect().toJSON(),
        })),
    };
  }, expectedWidth);
  result.layoutSamples = layoutSamples;
  if (result.documentWidth > expectedWidth + 1) {
    result.focusProbe = await page.evaluate(async () => {
      const active = document.activeElement;
      const snapshot = () => ({
        inner: innerWidth,
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        scrollX,
        viewport: visualViewport && {
          width: visualViewport.width,
          scale: visualViewport.scale,
          offsetLeft: visualViewport.offsetLeft,
          pageLeft: visualViewport.pageLeft,
        },
        html: getComputedStyle(document.documentElement).cssText,
        bodyRect: document.body.getBoundingClientRect().toJSON(),
      });
      const frame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const before = snapshot();
      window.scrollTo(100, window.scrollY);
      await frame();
      const horizontalScrollAttempt = snapshot();
      window.scrollTo(before.scrollX, window.scrollY);
      const previousDisplay = document.body.style.display;
      document.body.style.display = "none";
      await frame();
      const allBodyHidden = snapshot();
      document.body.style.display = previousDisplay;
      await frame();
      active?.focus({ preventScroll: true });
      const clipping = [];
      for (const selector of [
        '[class*="chat-input-panel_"]',
        '[class*="chat-body_"]',
      ]) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const previous = node.style.overflow;
        node.style.overflow = "clip";
        await frame();
        clipping.push({ selector, ...snapshot() });
        node.style.overflow = previous;
        await frame();
      }
      const pseudoStyle = document.createElement("style");
      pseudoStyle.textContent =
        "*::before, *::after { display: none !important; }";
      document.head.append(pseudoStyle);
      await frame();
      const withoutPseudos = snapshot();
      pseudoStyle.remove();
      await frame();
      active?.blur();
      await frame();
      const blurred = snapshot();
      active?.focus({ preventScroll: true });
      await frame();
      const refocused = snapshot();
      const style = document.createElement("style");
      style.textContent =
        "* { outline: none !important; box-shadow: none !important; }";
      document.head.append(style);
      await frame();
      const unpainted = snapshot();
      style.remove();
      await frame();
      return {
        before,
        horizontalScrollAttempt,
        allBodyHidden,
        clipping,
        withoutPseudos,
        blurred,
        refocused,
        unpainted,
        restored: snapshot(),
      };
    });
    await page.setViewportSize(page.viewportSize());
    result.sameViewportReset = await page.evaluate(() => ({
      inner: innerWidth,
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      scrollX,
      visualWidth: visualViewport?.width,
    }));
  }
  const residualMetric =
    result.focusProbe &&
    result.overflowElements.length === 0 &&
    result.bodyRect.right <= expectedWidth + 1 &&
    result.focusProbe.horizontalScrollAttempt.scrollX === 0 &&
    result.focusProbe.allBodyHidden.scroll === result.documentWidth &&
    result.focusProbe.allBodyHidden.viewport.width <= expectedWidth + 1;
  result.layoutViewportResidual = !!residualMetric;
  assert(
    result.documentWidth <= expectedWidth + 1 || residualMetric,
    JSON.stringify(result),
  );
  assert(
    result.panel.x >= -1 && result.panel.right <= expectedWidth + 1,
    JSON.stringify(result),
  );
  for (const control of result.controls) {
    assert(
      control.x >= -1 && control.right <= expectedWidth + 1,
      JSON.stringify(control),
    );
    if (mobile)
      assert(
        control.width >= 43 && control.height >= 43,
        JSON.stringify(control),
      );
  }
  return result;
}

const assistants = (page) => page.locator('[class*="chat-message_"]');
const answer = (page, text) => assistants(page).filter({ hasText: text });
const versions = (page) =>
  page.getByRole("navigation", { name: "回答版本" }).first();
const stop = (page) =>
  page.getByRole("button", { name: "停止响应", exact: true });
async function send(page, prompt, index) {
  await page.locator("#chat-input").fill(prompt);
  await page.locator("#chat-input").press("Enter");
  await page.waitForFunction(
    (length) => window.__assistantQa.flows.length >= length,
    index + 1,
  );
}
async function finish(page, index, text) {
  await page.evaluate(
    ({ index, text }) => window.__assistantQa.finish(index, text),
    { index, text },
  );
  await stop(page).waitFor({ state: "hidden" });
  await answer(page, text).waitFor();
}
async function screenshot(page, label, captures) {
  const target = path.join(output, `${label}.png`);
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await page.screenshot({ path: target, fullPage: true });
  captures.push(target);
}

async function runColdPreview(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    colorScheme: "light",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const report = {
    width: 1440,
    theme: "light",
    scenario: "cold-input-preview",
    screenshots: [],
    pageErrors: [],
  };
  page.on("pageerror", (error) =>
    report.pageErrors.push(error.stack || error.message),
  );
  try {
    await attachDiagnostics(page, report);
    await prepare(page, "light", false, { defaultPreview: true });
    await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
    const input = page.locator("#chat-input");
    await input.waitFor();
    await input.click();
    const first = "COLD_PREVIEW_TYPED_0123456789";
    await page.keyboard.type(first, { delay: 0 });
    assert.equal(await input.inputValue(), first);
    const preview = page.locator('[class*="chat-message-user_"]');
    await page.waitForFunction(
      (text) =>
        document
          .querySelector('[class*="chat-message-user_"]')
          ?.textContent.includes(text),
      first,
    );
    assert.equal(await preview.count(), 1);
    await page.evaluate(() => {
      window.__assistantQa.previewNode = document.querySelector(
        '[class*="chat-message-user_"]',
      );
    });
    const continued = first + "中文🙂";
    await page.keyboard.insertText("中文🙂");
    assert.equal(await input.inputValue(), continued);
    await page.waitForFunction(
      (text) =>
        document
          .querySelector('[class*="chat-message-user_"]')
          ?.textContent.includes(text),
      continued,
    );
    assert(
      await page.evaluate(
        () =>
          window.__assistantQa.previewNode?.isConnected &&
          window.__assistantQa.previewNode ===
            document.querySelector('[class*="chat-message-user_"]'),
      ),
      "Updating the draft must retain the existing preview DOM node",
    );
    await input.fill("");
    assert.equal(await preview.count(), 0, "Clearing must remove the preview");
    assert.equal(
      await page.evaluate(() => window.__assistantQa.requests.length),
      0,
    );
    assert.deepEqual(report.pageErrors, []);
    report.firstColdInput = first;
    report.continuedInput = continued;
    report.previewIdentity = true;
    report.clearRemovedPreview = true;
    report.passed = true;
    reports.push(report);
  } catch (error) {
    await screenshot(
      page,
      "cold-input-preview-failure",
      report.screenshots,
    ).catch(() => {});
    report.error = error.stack || error.message;
    reports.push(report);
    throw error;
  } finally {
    await context.close();
  }
}

async function runMain(browser, width, theme) {
  const mobile = width < 600;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 950 },
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: theme,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const report = {
    width,
    theme,
    scenario: "conversation",
    screenshots: [],
    pageErrors: [],
  };
  page.on("pageerror", (error) =>
    report.pageErrors.push(error.stack || error.message),
  );
  try {
    await attachDiagnostics(page, report);
    await prepare(page, theme);
    await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await page.locator('[class*="chat-welcome_"]').waitFor();
    report.welcomeGeometry = await geometry(page, mobile);
    await screenshot(page, `${width}-${theme}-welcome`, report.screenshots);
    const topbar = page.locator("[data-workspace-topbar]");
    const more = mobile
      ? page.getByRole("button", { name: "更多操作", exact: true })
      : topbar.locator('[data-workspace-menu="chat"]');
    await more.click();
    const menu = page.getByRole("menu", {
      name: mobile ? "更多操作" : "对话",
      exact: true,
    });
    for (const action of ["chat-settings", "search", "export"])
      await menu.locator(`[data-workspace-action="${action}"]`).waitFor();
    await page
      .getByRole("button", { name: "清除上下文", exact: true })
      .waitFor();
    assert.equal(
      await menu.getByRole("menuitem", { name: "快捷键", exact: true }).count(),
      0,
    );
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    await page.waitForFunction(
      (node) => node === document.activeElement,
      await more.elementHandle(),
    );
    report.moreMenu = true;
    if (width === 320 || process.env.UI_TEST_SCENARIO === "geometry") {
      assert.deepEqual(report.pageErrors, []);
      report.passed = true;
      reports.push(report);
      return;
    }

    await send(page, "QA_FIRST_QUESTION", 0);
    await page.evaluate(() =>
      window.__assistantQa.push(0, { reasoning_content: "QA_REASONING_A" }),
    );
    const reasoning = page.getByRole("button", { name: /思考过程/ }).last();
    await reasoning.waitFor();
    assert.equal(await reasoning.getAttribute("aria-expanded"), "true");
    await screenshot(
      page,
      `${width}-${theme}-reasoning-open`,
      report.screenshots,
    );
    await reasoning.click();
    await page.evaluate(() =>
      window.__assistantQa.push(0, { reasoning_content: " QA_REASONING_B" }),
    );
    assert.equal(await reasoning.getAttribute("aria-expanded"), "false");
    await finish(page, 0, "QA_ANSWER_ONE");
    const body = answer(page, "QA_ANSWER_ONE").locator(
      '[class*="chat-message-item_"] > .markdown-body',
    );
    assert.equal((await body.textContent()).trim(), "QA_ANSWER_ONE");
    await reasoning.click();
    await page
      .getByText("QA_REASONING_A QA_REASONING_B", { exact: true })
      .waitFor();
    await reasoning.click();
    report.independentReasoning = true;

    await answer(page, "QA_ANSWER_ONE").hover();
    await answer(page, "QA_ANSWER_ONE")
      .getByRole("button", { name: "重试", exact: true })
      .click();
    await page.waitForFunction(() => window.__assistantQa.flows.length === 2);
    await finish(page, 1, "QA_ANSWER_TWO");
    assert.equal(await answer(page, "QA_ANSWER_ONE").count(), 0);
    await versions(page).getByRole("button", { name: "上一个回答" }).click();
    await answer(page, "QA_ANSWER_ONE").waitFor();
    await send(page, "QA_FOLLOWUP_ONE", 2);
    const firstPath = await page.evaluate(() =>
      window.__assistantQa.requests.at(-1),
    );
    assert(JSON.stringify(firstPath.messages).includes("QA_ANSWER_ONE"));
    assert(!JSON.stringify(firstPath.messages).includes("QA_ANSWER_TWO"));
    assert(!JSON.stringify(firstPath.messages).includes("QA_REASONING"));
    await finish(page, 2, "QA_FOLLOWUP_ANSWER_ONE");

    await versions(page).getByRole("button", { name: "下一个回答" }).click();
    await answer(page, "QA_ANSWER_TWO").waitFor();
    assert.equal(
      await page
        .locator('[class*="chat-body_"]')
        .getByText("QA_FOLLOWUP_ONE", { exact: true })
        .count(),
      0,
    );
    await send(page, "QA_FOLLOWUP_TWO", 3);
    const secondPath = await page.evaluate(() =>
      window.__assistantQa.requests.at(-1),
    );
    assert(JSON.stringify(secondPath.messages).includes("QA_ANSWER_TWO"));
    assert(!JSON.stringify(secondPath.messages).includes("QA_ANSWER_ONE"));
    assert(!JSON.stringify(secondPath.messages).includes("QA_FOLLOWUP_ONE"));
    await finish(page, 3, "QA_FOLLOWUP_ANSWER_TWO");
    await versions(page).getByRole("button", { name: "上一个回答" }).click();
    await answer(page, "QA_FOLLOWUP_ANSWER_ONE").waitFor();
    assert.equal(await answer(page, "QA_FOLLOWUP_ANSWER_TWO").count(), 0);
    await versions(page).getByRole("button", { name: "下一个回答" }).click();
    await answer(page, "QA_FOLLOWUP_ANSWER_TWO").waitFor();
    await screenshot(page, `${width}-${theme}-branches`, report.screenshots);
    report.branchRequests = { firstPath, secondPath };

    await page.waitForTimeout(450);
    await page.reload({ waitUntil: "domcontentloaded" });
    await answer(page, "QA_FOLLOWUP_ANSWER_TWO").waitFor();
    await versions(page).getByRole("button", { name: "上一个回答" }).click();
    await answer(page, "QA_FOLLOWUP_ANSWER_ONE").waitFor();
    await versions(page).getByRole("button", { name: "下一个回答" }).click();
    await answer(page, "QA_FOLLOWUP_ANSWER_TWO").waitFor();
    await send(page, "QA_CANCEL_AFTER_RELOAD", 0);
    const restoredPath = await page.evaluate(() =>
      window.__assistantQa.requests.at(-1),
    );
    assert(JSON.stringify(restoredPath.messages).includes("QA_ANSWER_TWO"));
    assert(
      JSON.stringify(restoredPath.messages).includes("QA_FOLLOWUP_ANSWER_TWO"),
    );
    assert(
      !JSON.stringify(restoredPath.messages).includes("QA_FOLLOWUP_ANSWER_ONE"),
    );
    await page.evaluate(() =>
      window.__assistantQa.push(0, {
        reasoning_content: "QA_PENDING_REASONING",
      }),
    );
    await stop(page).waitFor();
    assert(
      await versions(page)
        .getByRole("button", { name: "上一个回答" })
        .isDisabled(),
    );
    report.streamingGeometry = await geometry(page, mobile);
    await screenshot(page, `${width}-${theme}-stop`, report.screenshots);
    await stop(page).click();
    await stop(page).waitFor({ state: "hidden" });
    assert(await page.evaluate(() => window.__assistantQa.flows[0].aborted));
    assert.equal(
      await page.evaluate(() => window.__assistantQa.requests.length),
      1,
    );
    assert.deepEqual(report.pageErrors, []);
    report.reloadAndStop = true;
    report.passed = true;
    reports.push(report);
  } catch (error) {
    await screenshot(
      page,
      `${width}-${theme}-failure`,
      report.screenshots,
    ).catch(() => {});
    report.error = error.stack || error.message;
    reports.push(report);
    throw error;
  } finally {
    await context.close();
  }
}

async function runTools(browser, width, theme) {
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 950 },
    isMobile: width < 600,
    hasTouch: width < 600,
    colorScheme: theme,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const report = {
    width,
    theme,
    scenario: "tool-results",
    screenshots: [],
    pageErrors: [],
  };
  page.on("pageerror", (error) =>
    report.pageErrors.push(error.stack || error.message),
  );
  try {
    await attachDiagnostics(page, report);
    await prepare(page, theme, true);
    await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
    const cards = page.getByTestId("tool-result-card");
    await cards.first().waitFor();
    assert.equal(await cards.count(), 2);
    await cards.first().locator(":scope > summary").click();
    await page.getByRole("cell", { name: "Camera", exact: true }).waitFor();
    await page.getByRole("cell", { name: "13", exact: true }).waitFor();
    await cards.first().scrollIntoViewIfNeeded();
    await screenshot(page, `${width}-${theme}-tool-table`, report.screenshots);
    await cards.last().locator(":scope > summary").click();
    const source = page.getByRole("link", { name: /QA_OFFICIAL_SOURCE/ });
    await source.waitFor();
    assert.equal(
      await source.getAttribute("href"),
      "https://www.assistant-ui.com/docs",
    );
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
    report.geometry = await geometry(page, width < 600);
    await screenshot(page, `${width}-${theme}-tools`, report.screenshots);
    assert.equal(
      await page.evaluate(() => window.__assistantQa.requests.length),
      0,
    );
    assert.deepEqual(report.pageErrors, []);
    report.structuredResultAndSources = true;
    report.formCallback =
      "Covered by component and MCP integration tests; not a live fixture tool invocation.";
    report.passed = true;
    reports.push(report);
  } catch (error) {
    await screenshot(
      page,
      `${width}-${theme}-tools-failure`,
      report.screenshots,
    ).catch(() => {});
    report.error = error.stack || error.message;
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
    if (process.env.UI_TEST_SCENARIO === "preview") {
      await runColdPreview(browser);
    } else {
      for (const [width, theme] of [
        [1440, "light"],
        [390, "dark"],
        [320, "light"],
      ]) {
        if (
          process.env.UI_TEST_WIDTH &&
          width !== Number(process.env.UI_TEST_WIDTH)
        )
          continue;
        if (process.env.UI_TEST_SCENARIO !== "tools")
          await runMain(browser, width, theme);
        if (process.env.UI_TEST_SCENARIO !== "geometry")
          await runTools(browser, width, theme);
      }
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
    await Promise.all(diagnosticWrites);
    fs.writeFileSync(
      path.join(output, "verification.json"),
      JSON.stringify({ reports, paidRequests: 0 }, null, 2),
    );
    await browser.close();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { prepare, geometry };
