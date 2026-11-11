// Local browser fixtures only: no real account, model, or MCP requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare, geometry } = require("./verify-assistant-chat.cjs");

const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const output =
  process.env.UI_TEST_OUTPUT_DIR ||
  "C:/Users/86136/.codex/visualizations/2026/11/02/01a19d7b-24fa-75e3-bd05-b433759e1c48/assistant-ui-chat/message-features";
const bodySelector = '[class*="chat-body_"]';
const sourceUrl = "https://www.assistant-ui.com/docs";
const imageUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=";
const selectedText = "QA_SELECTED_FRAGMENT exact punctuation: 42%.";
const reports = [];

async function seed(page, scenario) {
  await page.addInitScript(
    ({ scenario, sourceUrl, imageUrl }) => {
      if (window !== window.top || localStorage.getItem("message-features-qa"))
        return;
      localStorage.setItem("message-features-qa", "1");
      const key = "chat-next-web-store";
      const saved = JSON.parse(localStorage.getItem(key));
      const session = saved.state.sessions[0];
      const model = session.mask.modelConfig.model;
      const message = (id, role, content, extra = {}) => ({
        id,
        role,
        content,
        date: "2026-11-04T08:00:00.000Z",
        model,
        ...extra,
      });
      if (scenario === "sources" || scenario === "citation-stream") {
        session.messages[1].content =
          `QA_SOURCE_ANSWER Read [documentation](${sourceUrl}). ` +
          "[Unmatched source](https://example.test/unmatched).\n\n" +
          "[Unsafe source](javascript:alert(1)) remains inactive. Plain [1].\n\n" +
          `\`[Code source](${sourceUrl})\``;
      } else {
        session.messages = [
          message(
            "feature-question",
            "user",
            scenario === "edit"
              ? [
                  {
                    type: "text",
                    text: "引用内容：\n> QA_EDIT_QUOTE_SNAPSHOT\n\nQA_ORIGINAL_QUESTION",
                  },
                  { type: "image_url", image_url: { url: imageUrl } },
                ]
              : "QA_ORIGINAL_QUESTION",
            scenario === "edit"
              ? {
                  composerInput: {
                    text: "QA_ORIGINAL_QUESTION",
                    files: [],
                    quote: {
                      messageId: "imported-quote-source",
                      role: "assistant",
                      text: "QA_EDIT_QUOTE_SNAPSHOT",
                    },
                  },
                }
              : {},
          ),
          message(
            "feature-answer",
            "assistant",
            "QA_ORIGINAL_ANSWER. Original lead. QA_SELECTED_FRAGMENT exact punctuation: 42%. Original tail.",
          ),
          message("feature-followup", "user", "QA_OLD_FOLLOWUP"),
          message("feature-followup-answer", "assistant", "QA_OLD_ANSWER"),
        ];
      }
      localStorage.setItem(key, JSON.stringify(saved));
    },
    { scenario, sourceUrl, imageUrl },
  );
}

async function capture(page, report, phase) {
  const target = path.join(
    output,
    `${report.width}-${report.scenario}-${phase}.png`,
  );
  await page.screenshot({ path: target, fullPage: true });
  report.screenshots.push(target);
}

async function checkGeometry(page, report, phase, overlay, editor) {
  const inspectEditor = async (label) => {
    if (!editor) return;
    report.editorVisibility ??= {};
    const measured = await editor.evaluate((form, selector) => {
      const rect = (node) => {
        const box = node.getBoundingClientRect();
        return {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
        };
      };
      return {
        body: rect(document.querySelector(selector)),
        controls: [...form.querySelectorAll("textarea, button")].map(rect),
      };
    }, bodySelector);
    report.editorVisibility[label] = measured;
    assert(
      measured.controls.length >= 3 &&
        measured.controls.every(
          (box) =>
            box.width > 0 &&
            box.left >= measured.body.left - 1 &&
            box.right <= measured.body.right + 1 &&
            box.top >= measured.body.top - 1 &&
            box.bottom <= measured.body.bottom + 1,
        ),
      `Editor text and actions must stay visible: ${JSON.stringify(measured)}`,
    );
  };
  report.geometry ??= {};
  report.geometry[phase] = await geometry(page, report.width < 600);
  await capture(page, report, phase);
  await inspectEditor(phase);
  if (report.width === 390) {
    await page.setViewportSize({ width: 320, height: 844 });
    report.geometry[`${phase}-320`] = await geometry(page, true);
    if (overlay) await inViewport(overlay);
    await capture(page, report, `${phase}-320`);
    await inspectEditor(`${phase}-320`);
    await page.setViewportSize({ width: 390, height: 844 });
  }
}

async function inViewport(locator) {
  await locator.waitFor();
  const box = await locator.boundingBox();
  const viewport = locator.page().viewportSize();
  assert(box && box.width > 0 && box.height > 0);
  assert(
    box.x >= -1 &&
      box.y >= -1 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1,
    JSON.stringify({ box, viewport }),
  );
}

const messageById = (page, id) => page.locator(`[data-message-id="${id}"]`);
const messageWith = (page, text) =>
  page.locator("[data-message-id]").filter({ hasText: text }).first();
const textContent = (message) =>
  typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");

async function request(page) {
  return page.evaluate(() => window.__assistantQa.requests.at(-1));
}

async function send(page, prompt, index) {
  await page.locator("#chat-input").fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(
    (count) => window.__assistantQa.flows.length >= count,
    index + 1,
  );
}

async function finish(page, index, text) {
  await page.evaluate(
    ({ index, text }) => window.__assistantQa.finish(index, text),
    { index, text },
  );
  await page.getByRole("button", { name: "停止响应", exact: true }).waitFor({
    state: "hidden",
  });
  await page.locator(bodySelector).getByText(text, { exact: true }).waitFor();
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

async function selectMessageText(page, text, crossMessage = false) {
  const body = messageById(page, "feature-answer").locator(".markdown-body");
  await body.scrollIntoViewIfNeeded();
  const point = await page.evaluate(
    ({ text, crossMessage }) => {
      const endpoint = (id, target) => {
        const container = document.querySelector(
          `[data-message-id="${id}"] .markdown-body`,
        );
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
        );
        let node;
        while ((node = walker.nextNode())) {
          const offset = node.textContent.indexOf(target);
          if (offset >= 0) return { node, offset };
        }
        throw new Error(`Text not found for selection: ${target}`);
      };
      const target = endpoint("feature-answer", text || "QA_ORIGINAL_ANSWER");
      const selection = window.getSelection();
      selection.removeAllRanges();
      const range = document.createRange();
      if (text !== null) {
        const first = crossMessage
          ? endpoint("feature-question", "QA_ORIGINAL_QUESTION")
          : target;
        range.setStart(first.node, first.offset);
        range.setEnd(target.node, target.offset + text.length);
        selection.addRange(range);
      } else {
        range.setStart(target.node, target.offset);
        range.setEnd(target.node, target.offset + 1);
      }
      document.dispatchEvent(new Event("selectionchange"));
      const rect = [...range.getClientRects()]
        .reverse()
        .find(
          (item) =>
            item.width > 0 && item.top >= 0 && item.bottom <= innerHeight,
        );
      if (!rect) throw new Error("The selected text must be visible");
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        selection: selection.toString(),
      };
    },
    { text, crossMessage },
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  return point;
}

async function selectAndOpenMenu(page, text, crossMessage = false) {
  const mobile = page.viewportSize().width < 600;
  if (mobile) await page.locator(bodySelector).focus();
  const point = await selectMessageText(page, text, crossMessage);
  assert.equal(
    await page
      .getByRole("button", { name: "引用选中文字", exact: true })
      .count(),
    0,
    "Selection alone must not expose an automatic quote action",
  );
  let menu;
  if (mobile) {
    await messageById(page, "feature-answer")
      .getByRole("button", { name: "更多消息操作", exact: true })
      .click();
    menu = page.getByRole("dialog", { name: "消息操作", exact: true });
  } else {
    await page.mouse.click(point.x, point.y, { button: "right" });
    menu = page.locator('div[class*="chat-context-menu_"]');
  }
  await menu.waitFor();
  assert.equal(
    await menu
      .getByRole("button", { name: "引用选中文字", exact: true })
      .count(),
    text?.trim() && !crossMessage ? 1 : 0,
  );
  return { menu, selection: point.selection };
}

async function selection(page, report) {
  const draft = "QA_SELECTION_DRAFT_UNCHANGED";
  const paragraph = messageById(page, "feature-answer")
    .locator(".markdown-body p")
    .first();
  await page.locator("#chat-input").fill(draft);
  await paragraph.scrollIntoViewIfNeeded();
  const points = await paragraph.evaluate((node) => {
    const text = node.firstChild;
    const point = (offset) => {
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      const rect = range.getClientRects()[0];
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    };
    return { start: point(0), end: point(28) };
  });
  report.selection = {};
  const inspect = async (phase) => {
    await page.waitForTimeout(150);
    const current = {
      selectedText: await page.evaluate(
        () => window.getSelection()?.toString() || "",
      ),
      draft: await page.locator("#chat-input").inputValue(),
      contextMenus: await page
        .locator('div[class*="chat-context-menu_"]')
        .count(),
      quoteActions: await page
        .getByRole("button", { name: "引用选中文字", exact: true })
        .count(),
    };
    report.selection[phase] = current;
    await capture(page, report, phase);
    assert.equal(
      current.contextMenus,
      0,
      `Selection must not open an app menu: ${JSON.stringify(current)}`,
    );
    assert.equal(
      current.quoteActions,
      0,
      `Selection must not open a floating quote action: ${JSON.stringify(
        current,
      )}`,
    );
    assert.equal(current.draft, draft);
    return current;
  };
  await selectMessageText(page, selectedText);
  const ranged = await inspect("native-range-selection");
  assert.equal(ranged.selectedText, selectedText);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  if (report.width < 600) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: points.start.x, y: points.start.y }],
    });
    try {
      await page.waitForTimeout(800);
    } finally {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    }
    await inspect("touch-long-press");
    await selectMessageText(page, selectedText);
    const selected = await inspect("touch-selection-change");
    assert.equal(selected.selectedText, selectedText);
  } else {
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    try {
      for (let step = 1; step <= 4; step++) {
        await page.waitForTimeout(210);
        await page.mouse.move(
          points.start.x + ((points.end.x - points.start.x) * step) / 4,
          points.start.y + ((points.end.y - points.start.y) * step) / 4,
        );
      }
    } finally {
      await page.mouse.up();
    }
    const selected = await inspect("slow-mouse-drag");
    assert(selected.selectedText.trim(), "A real slow drag must select text");
  }
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await paragraph.dblclick({ position: { x: 8, y: 14 } });
  const doubled = await inspect("double-click");
  assert(
    doubled.selectedText.trim(),
    "A real double click must retain selected text",
  );
  assert.equal(
    await page.evaluate(() => window.__assistantQa.requests.length),
    0,
  );
}

async function quote(page, report) {
  if (report.width < 600) {
    const draft = "QA_DRAFT_BEFORE_DOUBLE_CLICK";
    await page.locator("#chat-input").fill(draft);
    await messageById(page, "feature-answer")
      .locator(".markdown-body p")
      .first()
      .dblclick({ position: { x: 8, y: 14 } });
    assert(
      await page.evaluate(() =>
        Boolean(window.getSelection()?.toString().trim()),
      ),
      "A real double click must select a word before checking draft preservation",
    );
    assert.equal(await page.locator("#chat-input").inputValue(), draft);
    await page.locator("#chat-input").fill("");
    report.mobileDoubleClickPreservedDraft = true;
  }
  for (const [text, crossMessage] of [
    [null, false],
    [" ", false],
    ["QA_ORIGINAL_ANSWER", true],
  ]) {
    const { menu } = await selectAndOpenMenu(page, text, crossMessage);
    assert.equal(
      await menu
        .getByRole("button", { name: "引用选中文字", exact: true })
        .count(),
      0,
      "Empty, whitespace, and cross-message selections must not be quoted",
    );
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
  }
  let selected = await selectAndOpenMenu(page, selectedText);
  assert.equal(selected.selection, selectedText);
  await selected.menu
    .getByRole("button", { name: "引用选中文字", exact: true })
    .click();
  const preview = page.getByTestId("composer-quote");
  await preview.waitFor();
  assert((await preview.textContent()).includes(selectedText));
  await page.locator("#chat-input").fill("QA_CANCELLED_QUOTE_DRAFT");
  await page.getByRole("button", { name: "取消引用", exact: true }).click();
  await preview.waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("#chat-input").inputValue(),
    "QA_CANCELLED_QUOTE_DRAFT",
  );
  assert.equal(
    await page.evaluate(() => window.__assistantQa.requests.length),
    0,
  );
  await page.locator("#chat-input").fill("");

  selected = await selectAndOpenMenu(page, selectedText);
  await selected.menu
    .getByRole("button", { name: "引用选中文字", exact: true })
    .click();
  await preview.waitFor();
  await checkGeometry(page, report, "quote-preview");
  await send(page, "QA_QUOTE_FOLLOWUP", 0);
  const payload = await request(page);
  const user = payload.messages
    .filter((message) => message.role === "user")
    .at(-1);
  assert.equal(
    textContent(user),
    `引用内容：\n> ${selectedText}\n\nQA_QUOTE_FOLLOWUP`,
  );
  await preview.waitFor({ state: "hidden" });
  const sentQuote = page.getByTestId("message-quote");
  await sentQuote.waitFor();
  assert((await sentQuote.textContent()).includes(selectedText));
  report.quote = {
    selectedText,
    lastUser: user,
    invalidSelections: 3,
    explicitMenuEntry: report.width < 600 ? "more" : "right-click",
    cancelPreservedDraft: true,
  };

  const chunks = (prefix, count) =>
    Array.from(
      { length: count },
      (_, index) =>
        `\n\n${"Continued streaming response for reading. ".repeat(
          4,
        )}${prefix}_${index}`,
    ).join("");
  await page.evaluate(
    (content) => window.__assistantQa.push(0, { content }),
    chunks("QA_STREAM", 12),
  );
  await page.waitForFunction(() =>
    document.body.textContent.includes("QA_STREAM_11"),
  );
  await atBottom(page);
  const body = page.locator(bodySelector);
  const rect = await body.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(150);
  const before = await body.evaluate((node) => node.scrollTop);
  await page.evaluate(
    (content) => window.__assistantQa.push(0, { content }),
    chunks("QA_PAUSED_STREAM", 2),
  );
  await page.waitForFunction(() =>
    document.body.textContent.includes("QA_PAUSED_STREAM_1"),
  );
  const after = await body.evaluate((node) => node.scrollTop);
  assert(Math.abs(after - before) <= 3, JSON.stringify({ before, after }));
  await page.getByRole("button", { name: "回到底部", exact: true }).click();
  await atBottom(page);
  const stop = page.getByRole("button", { name: "停止响应", exact: true });
  await stop.click();
  await stop.waitFor({ state: "hidden" });
  assert(await page.evaluate(() => window.__assistantQa.flows[0].aborted));
  report.streamAndScroll = {
    pausedTop: before,
    afterGrowth: after,
    bottomResumed: true,
    aborted: true,
  };
}

async function edit(page, report) {
  const original = messageById(page, "feature-question");
  const form = page.getByRole("form", { name: "编辑消息", exact: true });
  const openEditor = async () => {
    await original.getByRole("button", { name: "编辑", exact: true }).click();
    await form.waitFor();
    assert.equal(
      await form
        .getByRole("textbox", { name: "消息内容", exact: true })
        .inputValue(),
      "QA_ORIGINAL_QUESTION",
    );
  };
  await openEditor();
  await form
    .getByRole("textbox", { name: "消息内容", exact: true })
    .fill("QA_CANCELLED_EDIT");
  await form.getByRole("button", { name: "取消", exact: true }).click();
  await form.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => window.__assistantQa.requests.length),
    0,
  );
  assert((await original.textContent()).includes("QA_ORIGINAL_QUESTION"));
  await openEditor();
  await form
    .getByRole("textbox", { name: "消息内容", exact: true })
    .fill("QA_EDITED_QUESTION");
  report.editorWidth = (await form.boundingBox()).width;
  if (report.width === 1440)
    assert(
      report.editorWidth >= 500,
      `Desktop editing should have a useful writing width: ${report.editorWidth}`,
    );
  await checkGeometry(page, report, "inline-editor", undefined, form);
  await form
    .getByRole("button", { name: "保存并重新生成", exact: true })
    .click();
  await page.waitForFunction(() => window.__assistantQa.flows.length === 1);
  const editedRequest = await request(page);
  const user = editedRequest.messages
    .filter((message) => message.role === "user")
    .at(-1);
  assert.equal(
    textContent(user),
    "引用内容：\n> QA_EDIT_QUOTE_SNAPSHOT\n\nQA_EDITED_QUESTION",
  );
  assert(
    user.content.some(
      (part) => part.type === "image_url" && part.image_url.url === imageUrl,
    ),
  );
  assert(!JSON.stringify(editedRequest.messages).includes("QA_OLD_FOLLOWUP"));
  assert(
    !JSON.stringify(editedRequest.messages).includes("QA_ORIGINAL_ANSWER"),
  );
  const streamedContent =
    Array.from(
      { length: 6 },
      (_, index) =>
        `${"The edited answer keeps growing after saving. ".repeat(
          4,
        )}QA_EDIT_STREAM_${index}`,
    ).join("\n\n") + "\n\n";
  await page.evaluate(
    (content) => window.__assistantQa.push(0, { content }),
    streamedContent,
  );
  await page.waitForFunction(() =>
    document.body.textContent.includes("QA_EDIT_STREAM_5"),
  );
  await atBottom(page);
  report.editedStreamFollowing = await page
    .locator(bodySelector)
    .evaluate((node) => ({
      top: node.scrollTop,
      height: node.scrollHeight,
      viewport: node.clientHeight,
      gap: node.scrollHeight - node.clientHeight - node.scrollTop,
    }));
  await finish(page, 0, "QA_EDITED_ANSWER");
  await send(page, "QA_NEW_FOLLOWUP", 1);
  const followup = await request(page);
  assert(JSON.stringify(followup.messages).includes("QA_EDITED_QUESTION"));
  assert(JSON.stringify(followup.messages).includes("QA_EDITED_ANSWER"));
  assert(!JSON.stringify(followup.messages).includes("QA_OLD_FOLLOWUP"));
  await finish(page, 1, "QA_NEW_ANSWER");
  const previous = () =>
    messageWith(page, "QA_EDITED_QUESTION")
      .getByRole("navigation", { name: "问题版本", exact: true })
      .getByRole("button", { name: "上一个问题", exact: true });
  const next = () =>
    original
      .getByRole("navigation", { name: "问题版本", exact: true })
      .getByRole("button", { name: "下一个问题", exact: true });
  await previous().click();
  await page
    .locator(bodySelector)
    .getByText("QA_OLD_FOLLOWUP", { exact: true })
    .waitFor();
  assert(
    (await page.locator(bodySelector).textContent()).includes(
      "QA_ORIGINAL_ANSWER",
    ),
  );
  assert(
    !(await page.locator(bodySelector).textContent()).includes(
      "QA_NEW_FOLLOWUP",
    ),
  );
  await next().click();
  await page
    .locator(bodySelector)
    .getByText("QA_NEW_ANSWER", { exact: true })
    .waitFor();
  assert(
    !(await page.locator(bodySelector).textContent()).includes(
      "QA_OLD_FOLLOWUP",
    ),
  );
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const opened = indexedDB.open("keyval-store");
        opened.onerror = () => resolve(false);
        opened.onsuccess = () => {
          const db = opened.result;
          if (!db.objectStoreNames.contains("keyval")) {
            db.close();
            return resolve(false);
          }
          const read = db
            .transaction("keyval", "readonly")
            .objectStore("keyval")
            .get("chat-next-web-store");
          read.onerror = () => {
            db.close();
            resolve(false);
          };
          read.onsuccess = () => {
            db.close();
            const saved =
              typeof read.result === "string"
                ? JSON.parse(read.result)
                : read.result;
            const active =
              saved?.state?.sessions?.[saved.state.currentSessionIndex];
            resolve(
              JSON.stringify(active?.messages)?.includes("QA_NEW_FOLLOWUP") &&
                JSON.stringify(active?.messages?.at(-1))?.includes(
                  "QA_NEW_ANSWER",
                ),
            );
          };
        };
      }),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator(bodySelector)
    .getByText("QA_NEW_ANSWER", { exact: true })
    .waitFor();
  await previous().click();
  await page
    .locator(bodySelector)
    .getByText("QA_OLD_FOLLOWUP", { exact: true })
    .waitFor();
  await next().click();
  await page
    .locator(bodySelector)
    .getByText("QA_NEW_ANSWER", { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.__assistantQa.requests.length),
    0,
  );
  await checkGeometry(page, report, "edited-branches");
  report.edit = {
    lastUser: user,
    cancelRequests: 0,
    originalHistoryRestored: true,
    editedFollowupRestored: true,
    persistedAfterReload: true,
  };
}

async function sources(page, report) {
  const citation = page.getByTestId("source-citation");
  await citation.waitFor();
  assert.equal(
    await citation.count(),
    1,
    "Code and unmatched links must not become citations",
  );
  assert.equal(await citation.getAttribute("data-source-url"), sourceUrl);
  const body = page.locator(bodySelector);
  const unmatched = body.getByRole("link", {
    name: "Unmatched source",
    exact: true,
  });
  assert.equal(
    await unmatched.getAttribute("href"),
    "https://example.test/unmatched",
  );
  const unsafeLinks = await body
    .locator('a[href^="javascript:"], a[href^="data:"], a[href^="vbscript:"]')
    .evaluateAll((links) =>
      links.map((link) => ({
        text: link.textContent,
        href: link.getAttribute("href"),
      })),
    );
  assert.deepEqual(unsafeLinks, [], "Unsafe links must have no active URL");
  const list = page.getByTestId("message-sources");
  await list.locator(":scope > summary").click();
  assert.equal(
    await list.locator("a").count(),
    1,
    "Unsafe tool sources must be excluded",
  );
  assert.equal(await list.locator("a").getAttribute("href"), sourceUrl);
  await list.locator(":scope > summary").click();

  const preview = page.getByRole("dialog", { name: "来源 1", exact: true });
  const originalFocus =
    report.width < 600
      ? await citation.elementHandle()
      : await page.evaluateHandle(() => document.activeElement);
  if (report.width < 600) await citation.tap();
  else await citation.hover();
  await preview.waitFor();
  assert.equal(await citation.getAttribute("aria-expanded"), "true");
  assert((await preview.textContent()).includes("QA_OFFICIAL_SOURCE"));
  assert.equal(
    await preview
      .getByRole("link", { name: "打开来源", exact: true })
      .getAttribute("href"),
    sourceUrl,
  );
  await inViewport(preview);
  await checkGeometry(page, report, "source-preview", preview);
  if (report.width === 390) await inViewport(preview);
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  await page.waitForFunction(
    (node) => document.activeElement === node,
    originalFocus,
  );

  await page.locator("#chat-input").focus();
  await citation.focus();
  await preview.waitFor();
  await page.keyboard.press("Tab");
  const openSource = preview.getByRole("link", {
    name: "打开来源",
    exact: true,
  });
  await page.waitForFunction(
    (node) => document.activeElement === node,
    await openSource.elementHandle(),
  );
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  await page.waitForFunction(
    (node) => document.activeElement === node,
    await citation.elementHandle(),
  );
  assert.equal(
    await page.evaluate(() => window.__assistantQa.requests.length),
    0,
  );
  report.sources = {
    citationCount: 1,
    hoverOrTap: true,
    keyboardPreview: true,
    unsafeLinks: 0,
  };
}

async function citationStream(page, report) {
  await send(page, "QA_CITATION_STREAM_QUESTION", 0);
  await page.evaluate(() =>
    window.__assistantQa.push(0, { content: "QA_CITATION_STREAM_START" }),
  );
  await page
    .locator(bodySelector)
    .getByText("QA_CITATION_STREAM_START", { exact: true })
    .waitFor();
  await atBottom(page);
  await page.getByTestId("source-citation").click();
  await page.getByRole("dialog", { name: "来源 1", exact: true }).waitFor();
  const body = page.locator(bodySelector);
  const measure = () =>
    body.evaluate((node) => ({
      top: node.scrollTop,
      height: node.scrollHeight,
      viewport: node.clientHeight,
    }));
  const before = await measure();
  const content = Array.from(
    { length: 6 },
    (_, index) =>
      `\n\n${"The active response grows while a source is being read. ".repeat(
        4,
      )}QA_CITATION_GROW_${index}`,
  ).join("");
  await page.evaluate(
    (content) => window.__assistantQa.push(0, { content }),
    content,
  );
  await page.waitForFunction(() =>
    document.body.textContent.includes("QA_CITATION_GROW_5"),
  );
  await page.waitForTimeout(150);
  const after = await measure();
  assert(after.height > before.height + 160, JSON.stringify({ before, after }));
  assert(
    Math.abs(after.top - before.top) <= 3,
    `Reading a citation must pause following: ${JSON.stringify({
      before,
      after,
    })}`,
  );
  await capture(page, report, "citation-paused-stream");
  const stop = page.getByRole("button", { name: "停止响应", exact: true });
  await stop.click();
  await stop.waitFor({ state: "hidden" });
  assert(await page.evaluate(() => window.__assistantQa.flows[0].aborted));
  report.citationPausedStream = { before, after, aborted: true };
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
  page.on("requestfailed", (request) => {
    if (request.resourceType() === "script")
      report.failedScripts.push({
        url: request.url(),
        error: request.failure()?.errorText,
      });
  });
  try {
    await prepare(
      page,
      theme,
      scenario === "sources" || scenario === "citation-stream",
    );
    await seed(page, scenario);
    await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    if (scenario === "sources") await sources(page, report);
    else if (scenario === "selection") await selection(page, report);
    else if (scenario === "quote") await quote(page, report);
    else if (scenario === "edit") await edit(page, report);
    else if (scenario === "citation-stream") await citationStream(page, report);
    else assert.fail(`Unknown scenario: ${scenario}`);
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.modelNetworkRequests, []);
    report.passed = true;
    reports.push(report);
    console.log(JSON.stringify({ width, scenario, passed: true }));
  } catch (error) {
    report.error = error.stack || error.message;
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
      : ["selection", "quote", "edit", "sources"];
    for (const width of widths)
      for (const scenario of scenarios) await run(browser, width, scenario);
    if (!process.env.UI_TEST_WIDTH && !process.env.UI_TEST_SCENARIO)
      await run(browser, 1440, "citation-stream");
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
