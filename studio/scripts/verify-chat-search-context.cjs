// Isolated local browser fixtures: all model, account, and MCP traffic is mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare, geometry } = require("./verify-assistant-chat.cjs");

const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const output =
  process.env.UI_TEST_OUTPUT_DIR ||
  "C:/Users/86136/.codex/visualizations/2026/11/02/01a19d7b-24fa-75e3-bd05-b433759e1c48/assistant-ui-chat/search-context";
const bodySelector = '[class*="chat-body_"]';
const imageUrl = "[image omitted]";
const reports = [];

async function seed(page, scenario) {
  await page.addInitScript(
    ({ scenario, imageUrl }) => {
      if (window !== window.top || localStorage.getItem("search-context-qa"))
        return;
      localStorage.setItem("search-context-qa", "1");
      const key = "chat-next-web-store";
      const saved = JSON.parse(localStorage.getItem(key));
      const session = saved.state.sessions[0];
      const model = session.mask.modelConfig.model;
      const message = (id, role, content, extra = {}) => ({
        id,
        role,
        content,
        model,
        date: "2026-11-04T08:00:00.000Z",
        ...extra,
      });
      session.mask.modelConfig.sendMemory = false;
      session.mask.modelConfig.historyMessageCount = 200;
      session.mask.modelConfig.compressionThreshold =
        scenario === "context-threshold" ? 500 : 272000;
      session.mask.modelConfig.compressMessageLengthThreshold = 999999;
      if (["search", "global-search", "search-visual"].includes(scenario)) {
        session.messages = Array.from({ length: 80 }, (_, index) =>
          message(
            `search-history-${index}`,
            index % 2 ? "assistant" : "user",
            `QA_HISTORY_${index}.\n\n${"A persisted conversation message with readable body content. ".repeat(
              5,
            )}`,
            {
              branchOrder: index,
              ...(index ? { parentId: `search-history-${index - 1}` } : {}),
            },
          ),
        );
        session.messages[4].content = [
          { type: "text", text: "远处中文定位 MixedCase [literal]." },
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: "多模态片段精确匹配。" },
        ];
        for (const index of [6, 42, 78])
          session.messages[index].content += "\n\nQA_MULTI_MATCH";
        session.messages[22].content =
          "QA_DOUBLE_NEEDLE first occurrence.\n\n" +
          "A long paragraph separates two matches in the same message. ".repeat(
            45,
          ) +
          "\n\nQA_DOUBLE_NEEDLE second occurrence.";
        session.messages[71].content += "\n\nAnother MixedCase occurrence.";
        session.messages[71].reasoning =
          "Reasoning is separate and does not include the body needle.";
        session.messages[73].content =
          "QA_LINK_NEEDLE outside [QA_LINK_NEEDLE](https://example.test/QA_LINK_NEEDLE)";
        session.messages[75].content = "a **b**";
        session.messages[79].content = "QA_ACTIVE_BRANCH_ONLY";
        session.messageBranches = [
          message(
            "search-archived-answer",
            "assistant",
            "QA_ARCHIVED_BRANCH_ONLY",
            {
              parentId: "search-history-78",
              branchOrder: 80,
            },
          ),
          message(
            "search-archived-followup",
            "user",
            "QA_ARCHIVED_FOLLOWUP_ONLY",
            {
              parentId: "search-archived-answer",
              branchOrder: 81,
            },
          ),
          message(
            "search-archived-followup-answer",
            "assistant",
            "QA_ARCHIVED_FOLLOWUP_ANSWER",
            {
              parentId: "search-archived-followup",
              branchOrder: 82,
            },
          ),
        ];
        session.branchSelections = Object.fromEntries(
          session.messages.map((item, index) => [
            index ? session.messages[index - 1].id : "__root__",
            item.id,
          ]),
        );
        session.branchSelections["search-archived-answer"] =
          "search-archived-followup";
        session.branchSelections["search-archived-followup"] =
          "search-archived-followup-answer";
      } else {
        session.messages = [
          message("context-question", "user", "QA_CONTEXT_HISTORY_QUESTION"),
          message("context-answer", "assistant", "QA_CONTEXT_HISTORY_ANSWER"),
        ];
        session.mask.context = [
          message("context-system", "system", "QA_CONTEXT_SYSTEM_INSTRUCTION"),
        ];
      }
      localStorage.setItem(key, JSON.stringify(saved));
    },
    { scenario, imageUrl },
  );
}

async function capture(page, report, phase) {
  const file = path.join(
    output,
    `${report.width}-${report.scenario}-${phase}.png`,
  );
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots.push(file);
}

async function checkGeometry(page, report, phase, panel) {
  const inspectPanel = async (label) => {
    if (!panel) return;
    const rect = await panel.boundingBox();
    const viewport = page.viewportSize();
    assert(rect && rect.width > 0 && rect.height > 0);
    assert(
      rect.x >= -1 &&
        rect.y >= -1 &&
        rect.x + rect.width <= viewport.width + 1 &&
        rect.y + rect.height <= viewport.height + 1,
      `${label}: ${JSON.stringify({ rect, viewport })}`,
    );
  };
  report.geometry ??= {};
  report.geometry[phase] = await geometry(page, report.width < 600);
  await inspectPanel(phase);
  await capture(page, report, phase);
  if (report.width === 390) {
    await page.setViewportSize({ width: 320, height: 844 });
    report.geometry[`${phase}-320`] = await geometry(page, true);
    await inspectPanel(`${phase}-320`);
    await capture(page, report, `${phase}-320`);
    await page.setViewportSize({ width: 390, height: 844 });
  }
}

async function send(page, text, index) {
  await page.locator("#chat-input").fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(
    (count) => window.__assistantQa.flows.length >= count,
    index + 1,
  );
}

async function assertNoAutomaticActions(page) {
  assert.equal(
    await page.locator('div[class*="chat-context-menu_"]').count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "引用选中文字", exact: true })
      .count(),
    0,
  );
}

async function currentMatch(page, id, text) {
  const current = page.locator(
    `[data-chat-search-current="true"][data-message-id="${id}"]`,
  );
  await current.waitFor();
  await page.waitForFunction(
    ({ id, text, selector }) => {
      const message = document.querySelector(
        `[data-chat-search-current="true"][data-message-id="${id}"]`,
      );
      const body = document.querySelector(selector);
      if (!message || !body) return false;
      const viewport = body.getBoundingClientRect();
      const highlight = CSS.highlights?.get(
        "octopus-conversation-search-current",
      );
      if (highlight) {
        const ranges = [...highlight];
        return (
          ranges.length === 1 &&
          ranges[0].toString().toLowerCase() === text.toLowerCase() &&
          [...ranges[0].getClientRects()].some(
            (rect) =>
              rect.width > 0 &&
              rect.top >= viewport.top - 1 &&
              rect.bottom <= viewport.bottom + 1,
          )
        );
      }
      const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const start = node.textContent
          .toLowerCase()
          .indexOf(text.toLowerCase());
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + text.length);
        if (
          [...range.getClientRects()].some(
            (rect) =>
              rect.width > 0 &&
              rect.top >= viewport.top - 1 &&
              rect.bottom <= viewport.bottom + 1,
          )
        )
          return true;
      }
      return false;
    },
    { id, text, selector: bodySelector },
  );
  return current.boundingBox();
}

async function search(page, report) {
  const draft = "QA_SEARCH_COMPOSER_DRAFT";
  const trigger = page.getByRole("button", { name: "搜索对话", exact: true });
  const panel = page.getByRole("search", { name: "当前对话搜索", exact: true });
  const input = page.getByRole("searchbox", {
    name: "搜索当前对话",
    exact: true,
  });
  const status = panel.getByRole("status");
  const next = panel.getByRole("button", { name: "下一个匹配", exact: true });
  const previous = panel.getByRole("button", {
    name: "上一个匹配",
    exact: true,
  });
  const query = async (value, count, id) => {
    await input.fill(value);
    await page.waitForFunction(
      ({ count, id }) => {
        const status = document.querySelector(
          '[data-testid="conversation-search"] [role="status"]',
        );
        const text = status?.textContent.trim();
        return (
          text === (count ? `1 / ${count}` : "0 / 0") &&
          (!id ||
            document.querySelector(
              `[data-chat-search-current="true"][data-message-id="${id}"]`,
            ))
        );
      },
      { count, id },
    );
    if (id) await currentMatch(page, id, value);
  };
  assert.equal(await panel.count(), 0);
  assert.equal(
    await page.locator('[data-message-id="search-history-4"]').count(),
    0,
  );
  await page.locator("#chat-input").fill(draft);
  await trigger.click();
  await panel.waitFor();
  await page.waitForFunction(
    (node) => document.activeElement === node,
    await input.elementHandle(),
  );
  assert.equal(await page.locator("#chat-input").inputValue(), draft);
  await query("QA_ACTIVE_BRANCH_ONLY", 1, "search-history-79");
  await input.fill("active_branch_only");
  await currentMatch(page, "search-history-79", "active_branch_only");
  await assertNoAutomaticActions(page);

  await query("远处中文定位", 1, "search-history-4");
  report.farHistory = {
    id: "search-history-4",
    rect: await currentMatch(page, "search-history-4", "远处中文定位"),
  };
  await checkGeometry(page, report, "far-history-search", panel);
  await query("多模态片段", 1, "search-history-4");
  await query("[literal]", 1, "search-history-4");
  await query("mIxEdCaSe", 2, "search-history-4");
  await next.click();
  await currentMatch(page, "search-history-71", "MixedCase");
  assert.equal((await status.textContent()).trim(), "2 / 2");
  await next.click();
  await currentMatch(page, "search-history-4", "MixedCase");
  assert.equal((await status.textContent()).trim(), "1 / 2");
  await query("QA_LINK_NEEDLE", 2, "search-history-73");
  await next.click();
  await currentMatch(page, "search-history-73", "QA_LINK_NEEDLE");
  assert.equal((await status.textContent()).trim(), "2 / 2");
  await query("a b", 1, "search-history-75");
  await query("QA_MULTI_MATCH", 3, "search-history-6");
  await input.press("Enter");
  await currentMatch(page, "search-history-42", "QA_MULTI_MATCH");
  await input.press("Shift+Enter");
  await currentMatch(page, "search-history-6", "QA_MULTI_MATCH");
  await previous.click();
  await currentMatch(page, "search-history-78", "QA_MULTI_MATCH");
  assert.equal((await status.textContent()).trim(), "3 / 3");
  await next.click();
  await currentMatch(page, "search-history-6", "QA_MULTI_MATCH");
  await query("QA_DOUBLE_NEEDLE", 2, "search-history-22");
  await input.focus();
  await page.evaluate(() => {
    window.__firstSearchMatch = [
      ...CSS.highlights.get("octopus-conversation-search-current"),
    ][0].cloneRange();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(window.__firstSearchMatch.cloneRange());
    document.dispatchEvent(new Event("selectionchange"));
  });
  await input.press("Enter");
  await currentMatch(page, "search-history-22", "QA_DOUBLE_NEEDLE");
  assert.equal((await status.textContent()).trim(), "2 / 2");
  await page.waitForFunction(() => {
    const current = [
      ...CSS.highlights.get("octopus-conversation-search-current"),
    ][0];
    return (
      current.compareBoundaryPoints(
        Range.START_TO_START,
        window.__firstSearchMatch,
      ) > 0
    );
  });
  assert.equal(
    await page.evaluate(() => window.getSelection()?.toString()),
    "QA_DOUBLE_NEEDLE",
  );
  await assertNoAutomaticActions(page);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await query("QA_NO_MATCH", 0);
  assert(await next.isDisabled());
  assert(await previous.isDisabled());
  assert.equal(
    await page.locator('[data-chat-search-current="true"]').count(),
    0,
  );

  await query("QA_ACTIVE_BRANCH_ONLY", 1, "search-history-79");
  await query("QA_ARCHIVED_BRANCH_ONLY", 0);
  await page
    .locator('[data-message-id="search-history-79"]')
    .getByRole("navigation", { name: "回答版本", exact: true })
    .getByRole("button", { name: "下一个回答", exact: true })
    .click();
  await currentMatch(page, "search-archived-answer", "QA_ARCHIVED_BRANCH_ONLY");
  assert.equal((await status.textContent()).trim(), "1 / 1");
  await query("QA_ACTIVE_BRANCH_ONLY", 0);
  await page
    .locator('[data-message-id="search-archived-answer"]')
    .getByRole("navigation", { name: "回答版本", exact: true })
    .getByRole("button", { name: "上一个回答", exact: true })
    .click();
  await currentMatch(page, "search-history-79", "QA_ACTIVE_BRANCH_ONLY");
  assert.equal((await status.textContent()).trim(), "1 / 1");
  assert.equal(await page.locator("#chat-input").inputValue(), draft);
  await input.focus();
  await input.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert.equal(
    await page.locator('[data-chat-search-current="true"]').count(),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.__assistantQa.requests.length),
    0,
  );
  report.literalAndBranches = {
    chinese: true,
    mixedCase: true,
    literalBrackets: true,
    multimodal: true,
    looping: true,
    branchIsolation: true,
  };

  await send(page, "QA_SEARCH_STREAM", 0);
  await page.evaluate(() =>
    window.__assistantQa.push(0, { content: "QA_SEARCH_STREAM_START" }),
  );
  await page
    .locator(bodySelector)
    .getByText("QA_SEARCH_STREAM_START", { exact: true })
    .waitFor();
  await trigger.click();
  await query("远处中文定位", 1, "search-history-4");
  const body = page.locator(bodySelector);
  const before = await body.evaluate((node) => node.scrollTop);
  await page.evaluate(() =>
    window.__assistantQa.push(0, {
      content:
        "\n\nQA_UNMOUNTED_STREAM_GROWTH " +
        "Live text continues at the latest turn. ".repeat(80),
    }),
  );
  await page.waitForTimeout(600);
  const after = await body.evaluate((node) => node.scrollTop);
  assert(Math.abs(after - before) <= 3, JSON.stringify({ before, after }));
  await currentMatch(page, "search-history-4", "远处中文定位");
  await assertNoAutomaticActions(page);
  const stop = page.getByRole("button", { name: "停止响应", exact: true });
  await stop.click();
  await stop.waitFor({ state: "hidden" });
  assert(await page.evaluate(() => window.__assistantQa.flows[0].aborted));
  report.searchPausedStream = { before, after, aborted: true };
  await capture(page, report, "search-stream-paused");
}

async function globalSearch(page, report) {
  await page.goto(base + "#/search-chat", { waitUntil: "domcontentloaded" });
  const input = page.locator('input[type="text"]').first();
  await input.waitFor();
  await input.fill("远处中文定位");
  await input.press("Enter");
  const result = page
    .locator('div[class*="mask-item_"]')
    .filter({ hasText: "远处中文定位" })
    .first();
  await result.waitFor();
  await result.click();
  const panel = page.getByRole("search", { name: "当前对话搜索", exact: true });
  await panel.waitFor();
  assert.equal(
    await panel
      .getByRole("searchbox", { name: "搜索当前对话", exact: true })
      .inputValue(),
    "远处中文定位",
  );
  await currentMatch(page, "search-history-4", "远处中文定位");
  await checkGeometry(page, report, "global-search-routed", panel);
  assert.equal(
    await page.evaluate(() => window.__assistantQa.requests.length),
    0,
  );
  report.globalSearch = {
    query: "远处中文定位",
    messageId: "search-history-4",
    requests: 0,
  };
}

async function searchVisual(page, report) {
  await page.getByRole("button", { name: "搜索对话", exact: true }).click();
  const panel = page.getByRole("search", { name: "当前对话搜索", exact: true });
  await panel
    .getByRole("searchbox", { name: "搜索当前对话", exact: true })
    .fill("远处中文定位");
  await currentMatch(page, "search-history-4", "远处中文定位");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  report.highlightVisual = await page.evaluate(() => {
    const current = document.querySelector('[data-chat-search-current="true"]');
    const content = current.querySelector('[data-chat-search-content="true"]');
    const style = getComputedStyle(
      content,
      "::highlight(octopus-conversation-search-current)",
    );
    const sample = document.createElement("span");
    sample.style.color = "var(--warning)";
    document.body.append(sample);
    const warning = getComputedStyle(sample).color;
    sample.remove();
    return {
      background: style.backgroundColor,
      color: style.color,
      warning,
      outline: getComputedStyle(content).outlineStyle,
      shadow: getComputedStyle(content).boxShadow,
      fallback: current.getAttribute("data-chat-search-fallback"),
      nativeSelection: window.getSelection()?.toString(),
      textAlign: getComputedStyle(
        document.querySelector('[data-testid="conversation-search"] input'),
      ).textAlign,
    };
  });
  assert.equal(
    report.highlightVisual.background,
    report.highlightVisual.warning,
  );
  assert.equal(report.highlightVisual.color, "rgb(23, 23, 23)");
  assert.equal(report.highlightVisual.outline, "none");
  assert.equal(report.highlightVisual.shadow, "none");
  assert.equal(report.highlightVisual.fallback, null);
  assert.equal(report.highlightVisual.nativeSelection, "");
  assert.equal(report.highlightVisual.textAlign, "start");
  await checkGeometry(page, report, "contrasting-highlight", panel);
  assert.equal(
    await page.evaluate(() => window.__assistantQa.requests.length),
    0,
  );
}

async function contextUsage(page, report) {
  const trigger = page.getByTestId("context-usage").getByRole("button");
  const panel = page.getByRole("dialog", { name: "上下文估算", exact: true });
  const readTotal = async () => {
    const label = await trigger.getAttribute("aria-label");
    const match = /^上下文估算：([\d,]+) Token$/.exec(label);
    assert(match, label);
    return Number(match[1].replaceAll(",", ""));
  };
  await trigger.waitFor();
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  assert.equal(await panel.count(), 0);
  const baseline = await readTotal();
  const draft = "QA_CONTEXT_DRAFT ".repeat(150);
  await page.locator("#chat-input").fill(draft);
  await page.waitForFunction((baseline) => {
    const label =
      document
        .querySelector('[data-testid="context-usage"] button')
        ?.getAttribute("aria-label") || "";
    return Number(label.match(/[\d,]+/)?.[0].replaceAll(",", "")) > baseline;
  }, baseline);
  const withDraft = await readTotal();
  assert.equal(
    withDraft - baseline,
    8 + Math.ceil(draft.length / 4),
    "An ASCII draft with the existing input template should add its estimated text and message overhead",
  );
  await trigger.click();
  await panel.waitFor();
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  const breakdown = await panel.evaluate((node) =>
    Object.fromEntries(
      [...node.querySelectorAll("dl > div")].map((row) => [
        row.querySelector("dt")?.textContent,
        row.querySelector("dd")?.textContent,
      ]),
    ),
  );
  assert(Number(breakdown["预设与系统"].replaceAll(",", "")) > 0);
  assert.equal(breakdown["历史摘要"], "0");
  assert(Number(breakdown["历史消息（2 条）"].replaceAll(",", "")) > 0);
  assert.equal(
    Number(breakdown["草稿与素材"].replaceAll(",", "")),
    withDraft - baseline,
  );
  assert.equal(breakdown["模型窗口"], "未提供");
  const progress = panel.getByRole("progressbar", {
    name: "压缩阈值占比",
    exact: true,
  });
  const threshold = report.scenario === "context-threshold" ? 500 : 272000;
  assert.equal(Number(await progress.getAttribute("max")), threshold);
  assert.equal(
    await progress.getAttribute("aria-valuetext"),
    `估算为压缩阈值的 ${Math.round((withDraft / threshold) * 100)}%`,
  );
  if (report.scenario === "context-threshold") {
    assert(withDraft >= threshold);
    assert(
      (await panel.textContent()).includes(
        "已达到阈值，发送时会检查是否压缩较早的文字。",
      ),
    );
    assert.equal(Number(await progress.getAttribute("value")), threshold);
  }
  await assertNoAutomaticActions(page);
  assert.equal(
    await page.evaluate(() => window.__assistantQa.requests.length),
    0,
  );
  await checkGeometry(page, report, "usage-details", panel);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  await page.waitForFunction(
    (node) => document.activeElement === node,
    await trigger.elementHandle(),
  );
  assert.equal(await page.locator("#chat-input").inputValue(), draft);
  await page.locator("#chat-input").fill("");
  await page.waitForFunction((baseline) => {
    const label =
      document
        .querySelector('[data-testid="context-usage"] button')
        ?.getAttribute("aria-label") || "";
    return Number(label.match(/[\d,]+/)?.[0].replaceAll(",", "")) === baseline;
  }, baseline);
  await trigger.click();
  await panel.waitFor();
  if (report.width < 600)
    await panel.getByRole("button", { name: "关闭", exact: true }).click();
  else await trigger.click();
  await panel.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => window.__assistantQa.requests.length),
    0,
  );
  report.context = {
    baseline,
    withDraft,
    threshold,
    breakdown,
    unknownCapacity: true,
    automaticRequests: 0,
  };
}

async function run(browser, width, scenario) {
  const mobile = width < 600;
  const theme = mobile ? "dark" : "light";
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
    scenario,
    screenshots: [],
    pageErrors: [],
    modelNetworkRequests: [],
    failedScripts: [],
  };
  page.on("pageerror", (error) =>
    report.pageErrors.push(error.stack || error.message),
  );
  page.on("request", (request) => {
    if (request.url().includes("/chat/completions"))
      report.modelNetworkRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (
      response.request().resourceType() === "script" &&
      response.status() >= 400
    )
      report.failedScripts.push({
        url: response.url(),
        status: response.status(),
      });
  });
  try {
    await prepare(page, theme);
    await seed(page, scenario);
    await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    if (scenario === "search") await search(page, report);
    else if (scenario === "global-search") await globalSearch(page, report);
    else if (scenario === "search-visual") await searchVisual(page, report);
    else if (scenario === "context" || scenario === "context-threshold")
      await contextUsage(page, report);
    else assert.fail(`Unknown scenario: ${scenario}`);
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.modelNetworkRequests, []);
    report.passed = true;
    reports.push(report);
    console.log(JSON.stringify({ width, scenario, passed: true }));
  } catch (error) {
    report.error = error.stack || error.message;
    report.activeElement = await page
      .evaluate(() => document.activeElement?.outerHTML)
      .catch(() => "");
    report.searchState = await page
      .evaluate((selector) => {
        const body = document.querySelector(selector);
        const active = document.querySelector(
          '[data-chat-search-current="true"]',
        );
        const box = (node) => {
          const rect = node?.getBoundingClientRect();
          return (
            rect && {
              top: rect.top,
              left: rect.left,
              bottom: rect.bottom,
              right: rect.right,
              height: rect.height,
            }
          );
        };
        const ranges = CSS.highlights?.get(
          "octopus-conversation-search-current",
        );
        return {
          status: document.querySelector(
            '[data-testid="conversation-search"] [role="status"]',
          )?.textContent,
          body: body && {
            top: body.scrollTop,
            height: body.scrollHeight,
            viewport: body.clientHeight,
            rect: box(body),
            following: body.getAttribute("data-scroll-following"),
          },
          current: active && {
            id: active.getAttribute("data-message-id"),
            rect: box(active),
            contentRoots: active.querySelectorAll(
              '[data-chat-search-content="true"]',
            ).length,
          },
          ranges:
            ranges &&
            [...ranges].map((range) => ({
              text: range.toString(),
              rect: box(range),
            })),
        };
      }, bodySelector)
      .catch(() => undefined);
    report.visibleError = await page
      .locator("body")
      .innerText()
      .catch(() => "");
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
      ? process.env.UI_TEST_SCENARIO.split(",").map((name) => name.trim())
      : ["search", "context", "context-threshold"];
    for (const width of widths)
      for (const scenario of scenarios) await run(browser, width, scenario);
    if (!process.env.UI_TEST_WIDTH && !process.env.UI_TEST_SCENARIO)
      await run(browser, 1440, "global-search");
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
