// Isolated localhost fixtures: no live account, provider, or MCP operations.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare, geometry } = require("./verify-assistant-chat.cjs");

const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const output =
  process.env.UI_TEST_OUTPUT_DIR ||
  "C:/Users/86136/.codex/visualizations/2026/11/02/01a19d7b-24fa-75e3-bd05-b433759e1c48/assistant-ui-chat/followups-options";
const bodySelector = '[class*="chat-body_"]';
const reports = [];
const scenarios = {};
const draft = "QA_EXISTING_DRAFT do not replace without confirmation.";
const quoteText = "QA_QUOTE_SNAPSHOT preserve with the existing draft.";
const suggestions = [
  "请给出一个具体示例。",
  "这两种方案的取舍是什么？",
  "如何验证最终结果？",
];
const choices = ["保留现有数据", "导出一份副本", "仅处理当前会话"];
const group = (page) => page.getByTestId("followup-suggestions");
const optionsPanel = (page) => page.getByTestId("message-option-list");
const receipt = (page) =>
  optionsPanel(page).getByRole("status").filter({ hasText: "已提交选择" });

const messageById = (page, id) => page.locator(`[data-message-id="${id}"]`);
const messageWith = (page, text) =>
  page.locator("[data-message-id]").filter({ hasText: text }).last();
const stop = (page) =>
  page.getByRole("button", { name: "停止响应", exact: true });
const textContent = (message) =>
  typeof message.content === "string"
    ? message.content
    : (message.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");

async function seed(page) {
  await page.addInitScript(
    ({ quoteText }) => {
      if (window !== window.top || localStorage.getItem("followups-options-qa"))
        return;
      localStorage.setItem("followups-options-qa", "1");
      const key = "chat-next-web-store";
      const saved = JSON.parse(localStorage.getItem(key));
      const session = saved.state.sessions[0];
      const model = session.mask.modelConfig.model;
      const message = (id, role, content) => ({
        id,
        role,
        content,
        model,
        date: "2026-11-04T08:00:00.000Z",
      });
      session.messages = [
        message("followups-question", "user", "QA_EXISTING_QUESTION"),
        message(
          "followups-answer",
          "assistant",
          `QA_EXISTING_ANSWER. ${quoteText}\n\n1. 普通文字列表\n2. 不推断为交互选项`,
        ),
      ];
      session.mask.modelConfig.sendMemory = false;
      session.mask.modelConfig.historyMessageCount = 100;
      session.mask.modelConfig.compressMessageLengthThreshold = 999999;
      const other = structuredClone(session);
      other.id = "assistant-qa-other";
      other.topic = "QA_OTHER_SESSION";
      other.mask.id = "assistant-qa-other-mask";
      other.messages = [
        message("other-question", "user", "QA_OTHER_QUESTION"),
        message("other-answer", "assistant", "QA_OTHER_ANSWER"),
      ];
      saved.state.sessions.push(other);
      localStorage.setItem(key, JSON.stringify(saved));
    },
    { quoteText },
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
  const inspect = async () => {
    if (!panel) return;
    const boxes = await panel.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      }),
    );
    const viewport = page.viewportSize();
    for (const box of boxes) {
      assert(box.width > 0 && box.height > 0);
      assert(
        box.left >= -1 && box.right <= viewport.width + 1,
        JSON.stringify({ box, viewport }),
      );
    }
  };
  report.geometry ??= {};
  report.geometry[phase] = await geometry(page, report.width < 600);
  await inspect();
  await capture(page, report, phase);
  if (report.width === 390) {
    await page.setViewportSize({ width: 320, height: 844 });
    report.geometry[`${phase}-320`] = await geometry(page, true);
    await inspect();
    await capture(page, report, `${phase}-320`);
    await page.setViewportSize({ width: 390, height: 844 });
  }
}

async function begin(page, prompt) {
  const before = await page.evaluate(() => window.__assistantQa.flows.length);
  await page.locator("#chat-input").fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(
    (count) => window.__assistantQa.flows.length === count,
    before + 1,
  );
  return before;
}

async function push(page, index, content) {
  await page.evaluate(
    ({ index, content }) => window.__assistantQa.push(index, { content }),
    { index, content },
  );
}

async function finish(page, index, content = "") {
  await page.evaluate(
    ({ index, content }) => window.__assistantQa.finish(index, content),
    { index, content },
  );
  await stop(page).waitFor({ state: "hidden" });
}

async function requestCount(page) {
  return page.evaluate(() => window.__assistantQa.requests.length);
}

async function latestUserPayload(page) {
  const request = await page.evaluate(() =>
    window.__assistantQa.requests.at(-1),
  );
  return textContent(
    request.messages.filter((message) => message.role === "user").at(-1),
  );
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const candidates = new Map();
    for (const name of Object.keys(localStorage)) {
      if (!name.endsWith("chat-next-web-store")) continue;
      const value = localStorage.getItem(name);
      candidates.set(name, {
        value,
        fallback: !!localStorage.getItem(`${name}:local-storage-fallback`),
      });
    }
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const store = database.transaction("keyval").objectStore("keyval");
      const read = (request) =>
        new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const [names, values] = await Promise.all([
        read(store.getAllKeys()),
        read(store.getAll()),
      ]);
      names.forEach((name, index) => {
        if (
          typeof name === "string" &&
          name.endsWith("chat-next-web-store") &&
          !candidates.get(name)?.fallback
        )
          candidates.set(name, { value: values[index] });
      });
    } finally {
      database.close();
    }
    for (const [name, entry] of candidates) {
      const saved = JSON.parse(entry.value || "null");
      if (saved?.state?.sessions?.some((item) => item.id === "assistant-qa"))
        return { name, state: saved.state };
    }
    throw new Error("Persisted fixture workspace not found");
  });
}

async function persisted(page) {
  return (await snapshot(page)).state;
}

async function restoreComposer(page, text = draft) {
  const { name } = await snapshot(page);
  await page.evaluate(
    ({ name, text, quoteText }) => {
      const prefix = name.slice(0, -"chat-next-web-store".length);
      localStorage.setItem(`${prefix}unfinished-input-assistant-qa`, text);
      localStorage.setItem(
        `${prefix}unfinished-input-assistant-qa:quote`,
        JSON.stringify({
          messageId: "followups-answer",
          role: "assistant",
          text: quoteText,
        }),
      );
    },
    { name, text, quoteText },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#chat-input").waitFor();
  await page.waitForFunction(
    (text) => document.querySelector("#chat-input")?.value === text,
    text,
  );
  await page.getByTestId("composer-quote").waitFor();
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}

async function assertComposer(page, text = draft) {
  assert.equal(await page.locator("#chat-input").inputValue(), text);
  assert(
    (await page.getByTestId("composer-quote").textContent()).includes(
      quoteText,
    ),
  );
}

async function assertNoAutomaticActions(page) {
  assert.equal(await page.getByRole("dialog").count(), 0);
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

async function assertNoMetadataLeak(page) {
  const bodies = await page
    .locator('[data-chat-search-content="true"]')
    .allTextContents();
  for (const content of bodies) {
    assert(!content.includes("chat-ui"), content);
    assert(!content.includes('"suggestions"'), content);
    assert(!content.includes('"options"'), content);
  }
}

async function assertNoEnabledInteractions(page) {
  const enabled = await page
    .locator(
      '[data-testid="followup-suggestions"] button:enabled, ' +
        '[data-testid="message-option-list"] input:enabled, ' +
        '[data-testid="message-option-list"] button:enabled',
    )
    .count();
  assert.equal(enabled, 0);
}

function optionDefinition(selection, suffix = selection) {
  return {
    id: `qa-${suffix}`,
    question:
      selection === "single"
        ? "请选择一项处理方式"
        : "请选择两项需要执行的操作",
    selection,
    ...(selection === "multiple" ? { minSelections: 2, maxSelections: 2 } : {}),
    options: choices.map((label, index) => ({
      id: String.fromCharCode(97 + index),
      label,
      description:
        index === 1
          ? "导出后保留原有记录，长说明文字应在窄屏中自然换行，不挤压选框或提交操作。"
          : "操作范围以当前会话为准。",
    })),
  };
}

async function structured(page, flow, body, interactions, complete = true) {
  await push(page, flow, body);
  await messageWith(page, body).waitFor();
  const id = await messageWith(page, body).getAttribute("data-message-id");
  assert(id, "The response must expose its real message ID");
  const visible = messageById(page, id).locator(
    '[data-chat-search-content="true"]',
  );
  await page.waitForFunction(
    ({ id, body }) =>
      document
        .querySelector(
          `[data-message-id="${id}"] [data-chat-search-content="true"]`,
        )
        ?.textContent.trim() === body,
    { id, body },
  );
  const json = JSON.stringify({ version: 1, messageId: id, ...interactions });
  const parts = [
    "\n\n`",
    "`",
    "`chat",
    "-ui\n",
    json.slice(0, 31),
    json.slice(31),
    "\n```",
  ];
  for (const part of complete ? parts.slice(0, -1) : parts) {
    await push(page, flow, part);
    await page.waitForTimeout(140);
    await assertNoMetadataLeak(page);
    assert.equal((await visible.textContent()).trim(), body);
  }
  await assertNoEnabledInteractions(page);
  if (complete) await finish(page, flow, parts.at(-1));
  return id;
}

scenarios.followups = async (page, report) => {
  const flow = await begin(page, "QA_REQUEST_SUGGESTIONS");
  const id = await structured(page, flow, "QA_SUGGESTIONS_ANSWER", {
    suggestions,
  });
  await group(page).waitFor();
  assert.equal(await group(page).count(), 1);
  assert.equal(await group(page).getByRole("button").count(), 3);
  await assertNoAutomaticActions(page);
  await assertNoMetadataLeak(page);
  await checkGeometry(page, report, "suggestions", group(page));
  const before = await requestCount(page);
  await group(page).getByRole("button", { name: suggestions[0] }).click();
  assert.equal(await page.locator("#chat-input").inputValue(), suggestions[0]);
  assert.equal(await requestCount(page), before);
  await assertNoAutomaticActions(page);
  report.suggestionClickRequests = (await requestCount(page)) - before;

  await restoreComposer(page);
  await group(page).waitFor();
  await assertComposer(page);
  await group(page).getByRole("button", { name: suggestions[1] }).click();
  const dialog = page
    .getByRole("dialog", { name: "确认", exact: true })
    .filter({ hasText: "替换草稿" });
  await dialog.waitFor();
  await assertComposer(page);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await assertComposer(page);
  assert.equal(await requestCount(page), 0);
  report.cancelPreservedDraftAndQuote = true;
  await group(page).getByRole("button", { name: suggestions[2] }).click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await assertComposer(page, suggestions[2]);
  assert.equal(await requestCount(page), 0);
  report.confirmedReplacementPreservedQuote = true;
  report.persistedSuggestions = (
    await persisted(page)
  ).sessions[0].messages.find((message) => message.id === id);

  await page.getByRole("button", { name: "取消引用", exact: true }).click();
  const nextFlow = await begin(page, "QA_REQUEST_NEWEST_SUGGESTION");
  await assertNoEnabledInteractions(page);
  const newest = "请只展开最后一个结论。";
  await structured(page, nextFlow, "QA_NEWEST_SUGGESTIONS_ANSWER", {
    suggestions: [newest],
  });
  await group(page).getByRole("button", { name: newest }).waitFor();
  assert.equal(await group(page).count(), 1);
  assert.equal(await group(page).getByRole("button").count(), 1);
  for (const text of suggestions)
    assert.equal(
      await group(page).getByRole("button", { name: text }).count(),
      0,
    );
  await assertNoMetadataLeak(page);
  await assertNoAutomaticActions(page);
  report.onlyLatestCompleteAssistant = true;
};

async function verifyOptions(page, report, selection) {
  const definition = optionDefinition(selection);
  const flow = await begin(
    page,
    `QA_REQUEST_${selection.toUpperCase()}_OPTIONS`,
  );
  const id = await structured(
    page,
    flow,
    `QA_${selection.toUpperCase()}_OPTIONS_ANSWER`,
    { options: definition },
  );
  await optionsPanel(page).waitFor();
  await assertNoAutomaticActions(page);
  await restoreComposer(page);
  await optionsPanel(page).waitFor();
  await assertComposer(page);
  const panel = optionsPanel(page);
  const role = selection === "single" ? "radio" : "checkbox";
  let submit = panel.getByRole("button", {
    name: "提交选择",
    exact: true,
  });
  assert(await submit.isDisabled());
  const selectedIds = selection === "single" ? ["b"] : ["a", "c"];
  if (selection === "single") {
    await panel.getByRole(role, { name: choices[0], exact: true }).check();
    await panel.getByRole(role, { name: choices[1], exact: true }).check();
    assert(
      !(await panel
        .getByRole(role, { name: choices[0], exact: true })
        .isChecked()),
    );
  } else {
    await panel.getByRole(role, { name: choices[0], exact: true }).check();
    assert(await submit.isDisabled());
    await panel.getByRole(role, { name: choices[2], exact: true }).check();
    assert(
      await panel
        .getByRole(role, { name: choices[1], exact: true })
        .isDisabled(),
    );
  }
  assert(!(await submit.isDisabled()));
  await assertComposer(page);
  await panel.scrollIntoViewIfNeeded();
  await checkGeometry(page, report, "selected-options", panel);
  const before = await requestCount(page);
  submit = panel.getByRole("button", { name: "提交选择", exact: true });
  await submit.evaluate((button) => {
    button.click();
    button.click();
  });
  await page.waitForFunction(
    (count) => window.__assistantQa.requests.length >= count,
    before + 1,
  );
  await page.waitForTimeout(180);
  assert.equal(await requestCount(page), before + 1);
  await assertNoEnabledInteractions(page);
  await assertComposer(page);
  const expected =
    `针对“${definition.question}”，我的选择：\n` +
    definition.options
      .filter((option) => selectedIds.includes(option.id))
      .map((option) => `- ${option.label}`)
      .join("\n");
  assert.equal(await latestUserPayload(page), expected);
  report.optionResponse = { selectedIds, exactPayload: expected };
  report.duplicateSubmitRequests = (await requestCount(page)) - before;
  await finish(page, 0, `QA_${selection.toUpperCase()}_SELECTION_RECEIVED`);
  await receipt(page).waitFor();
  assert.equal(await receipt(page).count(), 1);
  for (const option of definition.options)
    assert.equal(
      (await optionsPanel(page).textContent()).includes(option.label),
      selectedIds.includes(option.id),
    );
  await assertComposer(page);
  await assertNoAutomaticActions(page);
  await assertNoMetadataLeak(page);
  const state = await persisted(page);
  const session = state.sessions.find((item) => item.id === "assistant-qa");
  const response = session.messages.find(
    (message) => message.optionResponse?.sourceMessageId === id,
  );
  assert.deepEqual(response?.optionResponse, {
    sourceMessageId: id,
    optionsId: definition.id,
    selectedIds,
  });
  report.persistedOptionResponse = response.optionResponse;
  await page.reload({ waitUntil: "domcontentloaded" });
  await receipt(page).waitFor();
  assert.equal(await requestCount(page), 0);
  assert.equal(
    await optionsPanel(page)
      .getByRole("button", { name: "提交选择", exact: true })
      .count(),
    0,
  );
  report.receiptRestoredAfterReload = true;
  await capture(page, report, "persisted-receipt");
}

scenarios.single = (page, report) => verifyOptions(page, report, "single");
scenarios.multiple = (page, report) => verifyOptions(page, report, "multiple");

async function verifyBranchReceipts(page, report) {
  const flowA = await begin(page, "QA_BRANCH_BOUND_OPTION_QUESTION");
  const definitionA = {
    ...optionDefinition("single", "branch-a"),
    question: "QA_BRANCH_A_QUESTION",
  };
  const idA = await structured(page, flowA, "QA_BRANCH_A_ANSWER", {
    suggestions: ["QA_BRANCH_A_SUGGESTION"],
    options: definitionA,
  });
  const panelA = messageById(page, idA).getByTestId("message-option-list");
  await panelA.waitFor();
  await messageById(page, idA).hover();
  const flowB = await page.evaluate(() => window.__assistantQa.flows.length);
  await messageById(page, idA)
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await page.waitForFunction(
    (count) => window.__assistantQa.flows.length === count,
    flowB + 1,
  );
  const definitionB = {
    ...optionDefinition("single", "branch-b"),
    question: "QA_BRANCH_B_QUESTION",
  };
  const idB = await structured(page, flowB, "QA_BRANCH_B_ANSWER", {
    suggestions: ["QA_BRANCH_B_SUGGESTION"],
    options: definitionB,
  });
  const panelB = messageById(page, idB).getByTestId("message-option-list");
  await panelB.getByText(definitionB.question, { exact: true }).waitFor();
  const versions = page.getByRole("navigation", { name: "回答版本" }).first();
  await versions
    .getByRole("button", { name: "上一个回答", exact: true })
    .click();
  await messageById(page, idA).waitFor();
  await panelA.getByText(definitionA.question, { exact: true }).waitFor();
  assert.equal(await messageById(page, idB).count(), 0);
  await panelA.getByRole("radio", { name: choices[0], exact: true }).check();
  const submitted = await page.evaluate(
    () => window.__assistantQa.flows.length,
  );
  await panelA.getByRole("button", { name: "提交选择", exact: true }).click();
  await page.waitForFunction(
    (count) => window.__assistantQa.flows.length === count,
    submitted + 1,
  );
  const payload = await latestUserPayload(page);
  assert.equal(
    payload,
    `针对“${definitionA.question}”，我的选择：\n- ${choices[0]}`,
  );
  await finish(page, submitted, "QA_BRANCH_A_ACCEPTED_SELECTION");
  await receipt(page).waitFor();
  await versions
    .getByRole("button", { name: "下一个回答", exact: true })
    .click();
  await messageById(page, idB).waitFor();
  await panelB.getByText(definitionB.question, { exact: true }).waitFor();
  assert.equal(await receipt(page).count(), 0);
  assert.equal(
    await messageWith(page, "QA_BRANCH_A_ACCEPTED_SELECTION").count(),
    0,
  );
  await group(page)
    .getByRole("button", { name: "QA_BRANCH_B_SUGGESTION", exact: true })
    .waitFor();
  await versions
    .getByRole("button", { name: "上一个回答", exact: true })
    .click();
  await messageWith(page, "QA_BRANCH_A_ACCEPTED_SELECTION").waitFor();
  await receipt(page).waitFor();
  assert.equal(
    await panelA.getByRole("button", { name: "提交选择", exact: true }).count(),
    0,
  );
  report.branchBoundReceipt = {
    sourceA: idA,
    sourceB: idB,
    exactPayload: payload,
  };
  await capture(page, report, "branch-bound-receipt");
  const beforeEdit = await requestCount(page);
  await messageById(page, idA)
    .locator('[class*="chat-message-avatar_"]')
    .hover();
  await messageById(page, idA)
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "编辑", exact: true });
  await editor.waitFor();
  await editor.getByRole("textbox").fill("QA_EDITED_ASSISTANT_SOURCE");
  await editor.getByRole("button", { name: "确认", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await messageById(page, idA)
    .getByText("QA_EDITED_ASSISTANT_SOURCE", { exact: true })
    .waitFor();
  assert.equal(
    await messageById(page, idA).getByTestId("message-option-list").count(),
    0,
  );
  assert.equal(
    await messageById(page, idA).getByTestId("followup-suggestions").count(),
    0,
  );
  assert.equal(await requestCount(page), beforeEdit);
  report.editingAssistantClearedInteractions = true;
  await capture(page, report, "edited-source-clears-interactions");
}

scenarios.boundaries = async (page, report) => {
  const aborted = await begin(page, "QA_ABORT_PARTIAL_METADATA");
  await push(page, aborted, "QA_ABORT_VISIBLE_BODY");
  await messageWith(page, "QA_ABORT_VISIBLE_BODY").waitFor();
  await push(
    page,
    aborted,
    '\n\n```chat-ui\n{"version":1,"messageId":"not-complete',
  );
  await page.waitForTimeout(160);
  await assertNoMetadataLeak(page);
  await stop(page).click();
  await stop(page).waitFor({ state: "hidden" });
  assert(
    await page.evaluate(
      (index) => window.__assistantQa.flows[index].aborted,
      aborted,
    ),
  );
  await assertNoEnabledInteractions(page);
  await assertNoMetadataLeak(page);
  report.abortDiscardedMetadata = true;

  const failed = await begin(page, "QA_FAIL_COMPLETED_METADATA");
  await structured(
    page,
    failed,
    "QA_FAILURE_VISIBLE_BODY",
    { suggestions, options: optionDefinition("single", "failure") },
    false,
  );
  await page.evaluate((index) => {
    const flow = window.__assistantQa.flows[index];
    flow.controller.error(new Error("QA_FIXTURE_RESPONSE_FAILURE"));
    flow.finished = true;
  }, failed);
  await stop(page).waitFor({ state: "hidden" });
  await assertNoEnabledInteractions(page);
  await assertNoMetadataLeak(page);
  await messageWith(page, "QA_FAILURE_VISIBLE_BODY").waitFor();
  report.failureDiscardedMetadata = true;

  const otherFlow = await begin(page, "QA_SWITCH_SESSION_DURING_METADATA");
  await structured(
    page,
    otherFlow,
    "QA_ORIGINAL_SESSION_VISIBLE_BODY",
    { suggestions, options: optionDefinition("single", "session") },
    false,
  );
  await page
    .getByRole("button", { name: "QA_OTHER_SESSION", exact: true })
    .click();
  await messageById(page, "other-answer").waitFor();
  await page.locator("#chat-input").fill("QA_OTHER_SESSION_DRAFT");
  const completedOriginal = await page.evaluate((index) => {
    const flow = window.__assistantQa.flows[index];
    if (flow.aborted || flow.cancelled) return false;
    window.__assistantQa.finish(index);
    return true;
  }, otherFlow);
  await page.waitForTimeout(180);
  assert.equal(
    await page.locator("#chat-input").inputValue(),
    "QA_OTHER_SESSION_DRAFT",
  );
  assert.equal(await group(page).count(), 0);
  assert.equal(await optionsPanel(page).count(), 0);
  assert.equal(
    await messageWith(page, "QA_ORIGINAL_SESSION_VISIBLE_BODY").count(),
    0,
  );
  report.sessionIsolation = { completedOriginal, currentDraftPreserved: true };
  await page
    .getByRole("button", { name: "Assistant UI QA", exact: true })
    .click();
  await messageWith(page, "QA_ORIGINAL_SESSION_VISIBLE_BODY").waitFor();
  await assertNoAutomaticActions(page);
  await assertNoMetadataLeak(page);
  await capture(page, report, "failure-abort-session-boundaries");
  await verifyBranchReceipts(page, report);
};

async function run(browser, width, scenario) {
  const report = {
    width,
    theme: width < 600 ? "dark" : "light",
    scenario,
    screenshots: [],
    pageErrors: [],
    modelNetworkRequests: [],
  };
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 950 },
    isMobile: width < 600,
    hasTouch: width < 600,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("request", (request) => {
    if (/\/(?:chat\/completions|images\/generations)/.test(request.url()))
      report.modelNetworkRequests.push(request.url());
  });
  page.setDefaultTimeout(15000);
  try {
    await prepare(page, report.theme);
    await seed(page);
    await page.goto(new URL("#/chat", base).href, {
      waitUntil: "domcontentloaded",
    });
    await page.locator("#chat-input").waitFor();
    await messageById(page, "followups-answer").waitFor();
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    assert.equal(await group(page).count(), 0);
    assert.equal(await optionsPanel(page).count(), 0);
    assert(scenarios[scenario], `Unknown scenario: ${scenario}`);
    await scenarios[scenario](page, report);
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.modelNetworkRequests, []);
    report.passed = true;
    reports.push(report);
    console.log(JSON.stringify({ width, scenario, passed: true }));
  } catch (error) {
    report.error = error.stack || error.message;
    report.visibleText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    report.state = await persisted(page).catch(() => undefined);
    report.requests = await page
      .evaluate(() => window.__assistantQa?.requests)
      .catch(() => undefined);
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
    const names = process.env.UI_TEST_SCENARIO
      ? process.env.UI_TEST_SCENARIO.split(",").map((item) => item.trim())
      : Object.keys(scenarios);
    assert(names.length, "Followup and option scenarios must be configured");
    for (const width of widths)
      for (const name of names) {
        if (name === "boundaries" && width !== 1440) continue;
        await run(browser, width, name);
      }
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
