// Isolated workspace QA; existing chat fixtures intercept every model/API call.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.UI_TEST_URL ||= "http://localhost:3001/";
process.env.PLAYWRIGHT_MODULE ||=
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";

const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const { prepare, geometry } = require("./verify-assistant-chat.cjs");
const { prepare: prepareHistory } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL;
const output =
  process.env.UI_TEST_OUTPUT_DIR ||
  path.join(os.tmpdir(), "octopus-workspace-layout-20261105");
const baselinePath =
  process.env.UI_TEST_BASELINE || path.join(output, "composer-baseline.json");
const phase = process.argv.includes("--baseline") ? "baseline" : "verify";
const widths = (process.env.UI_TEST_WIDTHS || "1440,1024,390,320")
  .split(",")
  .map(Number);
const themes = (process.env.UI_TEST_THEMES || "light,dark").split(",");
const repository = path.resolve(__dirname, "..");
const flowsOnly = process.argv.includes("--flows-only");
const protectedOnly = process.argv.includes("--protected-only");
const flowWidths = (process.env.UI_TEST_FLOW_WIDTHS || "1440,390")
  .split(",")
  .map(Number);

function protectedSources() {
  const files = [
    "app/components/context-usage.tsx",
    "app/components/context-usage.module.scss",
  ];
  const result = Object.fromEntries(
    files.map((file) => [
      file,
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(repository, file)))
        .digest("hex"),
    ]),
  );
  const chat = fs.readFileSync(
    path.join(repository, "app/components/chat.tsx"),
    "utf8",
  );
  const start = chat.indexOf(
    '<div {...composerFocus} className={styles["chat-input-panel"]}>',
  );
  const end = chat.indexOf("</ChatActions>", start);
  assert(start >= 0 && end > start, "Protected composer source was not found");
  result.composerMarkup = crypto
    .createHash("sha256")
    .update(chat.slice(start, end + "</ChatActions>".length))
    .digest("hex");
  return result;
}

async function captureProtected(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[class*="chat-input-panel_"]');
    const input = document.getElementById("chat-input");
    const inner = panel?.querySelector('[class*="chat-input-panel-inner_"]');
    const toolbar = panel?.querySelector('[class*="composer-toolbar_"]');
    const usage = panel?.querySelector('[data-testid="context-usage"]');
    const metrics = usage?.querySelector('[role="group"]');
    const styleKeys = [
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "marginTop",
      "marginBottom",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "borderRadius",
      "boxShadow",
      "backgroundColor",
      "color",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "display",
      "alignItems",
      "justifyContent",
      "rowGap",
      "columnGap",
      "flexDirection",
      "outlineStyle",
      "outlineWidth",
      "outlineOffset",
    ];
    const summarize = (element) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        className: element.className,
        styles: Object.fromEntries(styleKeys.map((key) => [key, style[key]])),
        box: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          right: bounds.right,
          bottom: bounds.bottom,
        },
      };
    };
    const controls = [...panel.querySelectorAll("button")]
      .filter((button) => button.getBoundingClientRect().width > 0)
      .map((button) => ({
        label: button.getAttribute("aria-label"),
        metric: button.dataset.metric || null,
        ...summarize(button),
      }));
    return {
      page: {
        width: innerWidth,
        height: innerHeight,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        dark: document.body.classList.contains("dark"),
      },
      panel: summarize(panel),
      inner: summarize(inner),
      input: summarize(input),
      toolbar: summarize(toolbar),
      usage: summarize(usage),
      metrics: summarize(metrics),
      controls,
      metricOrder: [...metrics.querySelectorAll("button")].map(
        (button) => button.dataset.metric,
      ),
      usageBeforeInput: Boolean(
        usage.compareDocumentPosition(inner) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    };
  });
}

function compareProtected(previous, current) {
  const differences = [];
  for (const key of [
    "panel",
    "inner",
    "input",
    "toolbar",
    "usage",
    "metrics",
  ]) {
    for (const [property, value] of Object.entries(previous[key].styles)) {
      // An outline offset has no painted effect when both outlines are removed.
      if (
        property === "outlineOffset" &&
        previous[key].styles.outlineStyle === "none" &&
        current[key].styles.outlineStyle === "none"
      )
        continue;
      if (current[key].styles[property] !== value)
        differences.push({
          element: key,
          property,
          before: value,
          after: current[key].styles[property],
        });
    }
  }
  const beforeControls = previous.controls.map((control) => ({
    label: control.label,
    metric: control.metric,
    className: control.className,
    styles: control.styles,
  }));
  const afterControls = current.controls.map((control) => ({
    label: control.label,
    metric: control.metric,
    className: control.className,
    styles: control.styles,
  }));
  assert.deepEqual(afterControls, beforeControls, "Composer controls changed");
  assert.deepEqual(
    current.metricOrder,
    previous.metricOrder,
    "Context metric order changed",
  );
  assert.equal(current.usageBeforeInput, true);
  assert.deepEqual(differences, [], "Protected composer styles changed");
}

async function assertGeometry(page, snapshot, mobile, layout) {
  assert(
    snapshot.page.overflow <= 1 || layout.layoutViewportResidual,
    "Page has horizontal overflow",
  );
  assert(snapshot.usageBeforeInput, "Context metrics must remain above input");
  assert.deepEqual(snapshot.metricOrder, ["speed", "cache", "context"]);
  for (const key of ["panel", "inner", "input", "usage"]) {
    const box = snapshot[key].box;
    assert(box.x >= -1, `${key} extends before the viewport`);
    assert(
      box.right <= snapshot.page.width + 1,
      `${key} extends beyond the viewport`,
    );
  }
  for (const control of snapshot.controls) {
    assert(control.box.x >= -1, `${control.label} is clipped`);
    assert(
      control.box.right <= snapshot.page.width + 1,
      `${control.label} is clipped`,
    );
    if (mobile) {
      assert(
        control.box.height >= 43 && control.box.width >= 43,
        `${control.label} touch target is below 44px`,
      );
    }
  }
  await page
    .getByTestId("context-usage")
    .locator('[data-metric="context"]')
    .click();
  const details = page.getByRole("dialog", { name: "对话状态详情" });
  await details.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await details.waitFor({ state: "hidden" });
  const focus = await page.evaluate(() => ({
    metric: document.activeElement?.getAttribute("data-metric"),
    connected: document.activeElement?.isConnected,
  }));
  assert.deepEqual(focus, { metric: "context", connected: true });
}

async function captureCase(browser, width, theme, reference) {
  const mobile = width <= 600;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 950 },
    hasTouch: mobile,
    isMobile: mobile,
    colorScheme: theme,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const errors = [];
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(error.message));
    await prepare(page, theme, false, { defaultPreview: true });
    await page.goto(new URL("#/chat", base).href, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.locator("#chat-input").waitFor({ state: "visible" });
    await page.getByTestId("context-usage").waitFor({ state: "visible" });
    await page.waitForFunction(
      (dark) => document.body.classList.contains("dark") === dark,
      theme === "dark",
    );
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await page.locator("#chat-input").evaluate((input) => input.blur());
    const snapshot = await captureProtected(page);
    await page.locator("#chat-input").focus();
    const focused = await captureProtected(page);
    if (reference) {
      compareProtected(reference.snapshot, snapshot);
      compareProtected(reference.focused, focused);
    }
    const layout = await geometry(page, mobile);
    await assertGeometry(page, focused, mobile, layout);
    await page.screenshot({
      path: path.join(output, `${phase}-${width}-${theme}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, [], `${width}/${theme} browser errors`);
    return {
      width,
      theme,
      snapshot,
      focused,
      errors,
      residual: layout.layoutViewportResidual,
    };
  } finally {
    await context.close();
  }
}

async function validFocus(page) {
  await page.waitForFunction(() => {
    const active = document.activeElement;
    return (
      active &&
      active !== document.body &&
      active.isConnected &&
      !active.closest("[hidden],[inert],[aria-hidden='true']") &&
      active.getBoundingClientRect().width > 0 &&
      getComputedStyle(active).visibility !== "hidden"
    );
  });
}

async function runWorkspaceFlow(browser, width) {
  const mobile = width <= 600;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 950 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const report = { width, checks: [], errors: [], passed: false };
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  const pass = (name) => {
    report.checks.push(name);
    console.log(`PASS flow ${width} ${name}`);
  };
  const topbar = page.locator("[data-workspace-topbar]");
  const sidebar = page.locator("[data-sidebar-panel]");
  const toggle = topbar.locator("[data-workspace-sidebar-toggle]");
  const row = (id) => page.locator(`[data-chat-session-id="${id}"]`);
  const openSidebar = async () => {
    if (
      (await sidebar.count()) === 0 ||
      (await sidebar.getAttribute("aria-hidden")) === "true"
    )
      await toggle.click();
    await page.waitForFunction(() => {
      const element = document.querySelector("[data-sidebar-panel]");
      return (
        element &&
        !element.inert &&
        element.getAttribute("aria-hidden") !== "true" &&
        element.getBoundingClientRect().width > 0
      );
    });
    const conversations = sidebar.getByRole("button", {
      name: "对话",
      exact: true,
    });
    if ((await conversations.getAttribute("aria-expanded")) !== "true")
      await conversations.click();
  };
  const chooseSession = async (id) => {
    await openSidebar();
    await row(id).click();
    await page.locator("#chat-input").waitFor({ state: "visible" });
    assert.equal(await row(id).getAttribute("aria-current"), "page");
  };
  const openMenu = async (key) => {
    if (mobile) {
      await page.getByRole("button", { name: "更多操作", exact: true }).click();
      const menu = page.getByRole("menu", { name: "更多操作", exact: true });
      await menu.waitFor({ state: "visible" });
      return menu;
    }
    await topbar.locator(`[data-workspace-menu="${key}"]`).click();
    const label = { chat: "对话", tools: "编辑", view: "视图", help: "帮助" }[
      key
    ];
    const menu = page.getByRole("menu", {
      name: label,
      exact: true,
    });
    await menu.waitFor({ state: "visible" });
    return menu;
  };
  const action = async (id, key = "chat") => {
    const menu = await openMenu(key);
    await menu.locator(`[data-workspace-action="${id}"]`).click();
  };
  const closeDialog = async (dialog) => {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await validFocus(page);
  };
  const openRowMenu = async (id) => {
    await openSidebar();
    await row(id).locator("[data-chat-more]").click();
    const menu = page.locator(`[id="chat-item-actions-${id}"]`);
    await menu.waitFor({ state: "visible" });
    assert.equal(await menu.getAttribute("role"), "menu");
    return menu;
  };
  try {
    await prepareHistory(page);
    await page.goto(new URL("#/chat", base).href, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.locator("#chat-input").waitFor({ state: "visible" });
    await topbar.waitFor({ state: "visible" });
    if (mobile) {
      assert.equal(await topbar.getByRole("button").count(), 3);
      assert.equal(
        await page.locator('[class*="chat-header-actions_"]').count(),
        0,
      );
    }
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });

    if (!mobile) {
      const trigger = topbar.locator('[data-workspace-menu="chat"]');
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      await page
        .getByRole("menu", { name: "对话", exact: true })
        .waitFor({ state: "visible" });
      await page.keyboard.press("ArrowRight");
      const tools = page.getByRole("menu", { name: "编辑", exact: true });
      await tools.waitFor({ state: "visible" });
      assert.equal(await tools.getByRole("menuitem").count(), 13);
      assert.equal(
        await tools.locator("button[data-workspace-edit-action]").count(),
        13,
      );
      assert.equal(
        await tools.getByText("显示快捷键", { exact: true }).count(),
        0,
      );
      await page.keyboard.press("Escape");
      await tools.waitFor({ state: "hidden" });
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.getAttribute("data-workspace-menu"),
        ),
        "tools",
      );
      pass("menu keyboard switches retain focus");
    }

    const input = page.locator("#chat-input");
    await input.fill("WORKSPACE_DRAFT_A");
    await chooseSession("scroll-b");
    assert.equal(await input.inputValue(), "");
    await input.fill("WORKSPACE_DRAFT_B");
    await chooseSession("scroll-a");
    assert.equal(await input.inputValue(), "WORKSPACE_DRAFT_A");
    if (mobile) await action("next", "chat");
    else
      await topbar
        .getByRole("button", { name: "下一个对话", exact: true })
        .click();
    await page.waitForFunction(
      () =>
        document.getElementById("chat-input")?.value === "WORKSPACE_DRAFT_B",
    );
    if (mobile) await action("previous", "chat");
    else
      await topbar
        .getByRole("button", { name: "上一个对话", exact: true })
        .click();
    await page.waitForFunction(
      () =>
        document.getElementById("chat-input")?.value === "WORKSPACE_DRAFT_A",
    );
    pass("session switch and adjacent navigation preserve drafts");

    if (!mobile) {
      await toggle.click();
      await page.waitForFunction(
        () => document.querySelector("[data-sidebar-panel]")?.inert,
      );
      assert.equal(await input.inputValue(), "WORKSPACE_DRAFT_A");
      await toggle.click();
      await openSidebar();
      const handle = sidebar.getByRole("separator", {
        name: "调整侧栏宽度",
      });
      const before = Number(await handle.getAttribute("aria-valuenow"));
      const bounds = await handle.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + 100, {
        steps: 4,
      });
      await page.mouse.up();
      await page.waitForFunction(
        (before) =>
          Number(
            document
              .querySelector('[role="separator"][aria-label="调整侧栏宽度"]')
              ?.getAttribute("aria-valuenow"),
          ) > before,
        before,
      );
      assert.equal(await input.inputValue(), "WORKSPACE_DRAFT_A");
      pass("sidebar collapse and resize preserve draft");
    } else {
      await openSidebar();
      assert.equal(await topbar.isVisible(), false);
      const sidebarBox = await sidebar.boundingBox();
      assert(
        sidebarBox && Math.abs(sidebarBox.y) <= 1,
        "Mobile sidebar must reach the top of the viewport",
      );
      const announcement = sidebar.getByRole("button", {
        name: "公告",
        exact: true,
      });
      const more = sidebar
        .locator("[data-workspace-mobile-more]")
        .getByRole("button", { name: "更多操作", exact: true });
      await more.waitFor({ state: "visible" });
      const [announcementBox, moreBox] = await Promise.all([
        announcement.boundingBox(),
        more.boundingBox(),
      ]);
      assert(announcementBox && moreBox, "Brand actions must be visible");
      assert(
        moreBox.x >= announcementBox.x + announcementBox.width &&
          Math.abs(
            announcementBox.y +
              announcementBox.height / 2 -
              (moreBox.y + moreBox.height / 2),
          ) <= 1,
        "Mobile more must align to the right of announcements",
      );
      await more.click();
      await page
        .getByRole("menu", { name: "更多操作", exact: true })
        .getByRole("menuitem", { name: "返回对话", exact: true })
        .click();
      await topbar.waitFor({ state: "visible" });
      await input.waitFor({ state: "visible" });
      assert.equal(await input.inputValue(), "WORKSPACE_DRAFT_A");
      pass("mobile brand actions return to chat without losing draft");
    }

    for (const [id, title] of [
      ["model", "选择模型"],
      ["skills", "已启用技能"],
      ["chat-settings", "当前对话预设"],
    ]) {
      await action(id);
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await dialog.waitFor({ state: "visible" });
      await closeDialog(dialog);
      assert.equal(await input.inputValue(), "WORKSPACE_DRAFT_A");
      pass(`${id} opens the existing dialog`);
    }

    for (const destination of [
      { label: "作品库", hash: "#/gallery" },
      { label: "账号与密钥", hash: "#/account" },
      { label: "设置", hash: "#/settings" },
    ]) {
      if (mobile) {
        if (destination.label === "作品库") {
          const navigation = await openMenu("tools");
          await navigation
            .getByRole("menuitem", {
              name: destination.label,
              exact: true,
            })
            .click();
        } else {
          await openSidebar();
          await sidebar
            .getByRole("button", { name: destination.label, exact: true })
            .click();
        }
      } else
        await page
          .locator("[data-workspace-rail]")
          .getByRole("button", { name: destination.label, exact: true })
          .click();
      await page.waitForFunction(
        (hash) => location.hash === hash,
        destination.hash,
      );
      await input.waitFor({ state: "hidden" });
      await chooseSession("scroll-a");
      assert.equal(await input.inputValue(), "WORKSPACE_DRAFT_A");
      pass(`${destination.label} route returns to saved draft`);
    }

    let menu = await openRowMenu("scroll-b");
    assert.equal(
      await menu.getByRole("menuitem", { name: /^(收藏|取消收藏)$/ }).count(),
      0,
    );
    assert.equal(await sidebar.locator("svg.lucide-star").count(), 0);
    await menu.getByRole("menuitem", { name: "移至项目", exact: true }).click();
    await menu.waitFor({ state: "hidden" });
    let projectChooser = page.getByRole("dialog", {
      name: "移至项目",
      exact: true,
    });
    await projectChooser.waitFor({ state: "visible" });
    await projectChooser
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await projectChooser.waitFor({ state: "hidden" });
    menu = await openRowMenu("scroll-b");
    await menu
      .getByRole("menuitem", { name: "重命名对话", exact: true })
      .click();
    const rename = page.getByRole("dialog", {
      name: "重命名对话",
      exact: true,
    });
    await rename.waitFor({ state: "visible" });
    await rename.getByRole("textbox", { name: "重命名对话" }).fill("RENAMED_B");
    await rename.getByRole("button", { name: "确认", exact: true }).click();
    await rename.waitFor({ state: "hidden" });
    await validFocus(page);
    assert.equal(await row("scroll-b").getAttribute("aria-label"), "RENAMED_B");
    assert.equal(
      await row("scroll-a").getAttribute("aria-label"),
      "Scroll Session A",
    );
    pass("project move cancel and rename target the selected row");

    menu = await openRowMenu("scroll-b");
    await menu.getByRole("menuitem", { name: "选择对话：RENAMED_B" }).click();
    await menu.waitFor({ state: "hidden" });
    const batch = sidebar.getByRole("toolbar");
    await batch.waitFor({ state: "visible" });
    await batch.getByRole("button", { name: "全选", exact: true }).click();
    assert.equal(await batch.getAttribute("aria-label"), "已选 2 项");
    assert.equal(await batch.getByRole("button", { name: /收藏/ }).count(), 0);
    assert.equal(await batch.locator("svg.lucide-star").count(), 0);
    await batch.getByRole("button", { name: "移至项目", exact: true }).click();
    projectChooser = page.getByRole("dialog", {
      name: "移至项目",
      exact: true,
    });
    await projectChooser.waitFor({ state: "visible" });
    await projectChooser
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await projectChooser.waitFor({ state: "hidden" });
    assert.equal(await batch.getAttribute("aria-label"), "已选 2 项");
    await batch.getByRole("button", { name: "删除所选", exact: true }).click();
    let confirmation = page.getByRole("dialog").last();
    await confirmation.waitFor({ state: "visible" });
    await confirmation
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(await page.locator("[data-chat-session-id]").count(), 2);
    await batch.getByRole("button", { name: "取消", exact: true }).click();
    await batch.waitFor({ state: "hidden" });
    pass("bulk project move and delete cancel preserve sessions");

    menu = await openRowMenu("scroll-b");
    await menu
      .getByRole("menuitem", { name: "确认删除选中的对话？", exact: true })
      .click();
    confirmation = page.getByRole("dialog").last();
    await confirmation.waitFor({ state: "visible" });
    await confirmation
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await confirmation.waitFor({ state: "hidden" });
    await row("scroll-b").waitFor({ state: "detached" });
    await validFocus(page);
    assert.equal(await page.locator("[data-chat-session-id]").count(), 1);
    pass("delete confirmation restores a valid focus target");

    await chooseSession("scroll-a");
    assert.equal(await input.inputValue(), "WORKSPACE_DRAFT_A");
    const snapshot = await captureProtected(page);
    const layout = await geometry(page, mobile);
    await assertGeometry(page, snapshot, mobile, layout);
    assert.deepEqual(report.errors, [], "Workspace flow browser errors");
    await page.screenshot({
      path: path.join(output, `flow-${width}.png`),
      fullPage: true,
    });
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    console.error(`FAIL flow ${width}: ${error.message}`);
    await page
      .screenshot({
        path: path.join(output, `failure-flow-${width}.png`),
        fullPage: true,
      })
      .catch(() => {});
  } finally {
    await context.close();
  }
  return report;
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const previous =
    phase === "verify"
      ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
      : null;
  const recorded =
    phase === "baseline" && process.argv.includes("--resume")
      ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
      : null;
  const verificationPath = path.join(output, "verification.json");
  const verified =
    (flowsOnly || (phase === "verify" && process.argv.includes("--resume"))) &&
    fs.existsSync(verificationPath)
      ? JSON.parse(fs.readFileSync(verificationPath, "utf8"))
      : null;
  if (recorded)
    assert.deepEqual(
      protectedSources(),
      recorded.protectedSources,
      "Cannot resume a baseline after protected source changes",
    );
  if (previous)
    assert.deepEqual(
      protectedSources(),
      previous.protectedSources,
      "Protected ContextUsage/composer source changed",
    );
  const browser = await chromium.launch({
    channel: process.env.UI_TEST_BROWSER || "msedge",
    headless: true,
  });
  const report = {
    phase,
    base,
    generatedAt: new Date().toISOString(),
    protectedSources: protectedSources(),
    results: verified?.results || recorded?.results || [],
    flows: protectedOnly ? verified?.flows || [] : [],
  };
  try {
    for (const width of flowsOnly ? [] : widths)
      for (const theme of themes) {
        if (
          (phase === "baseline" || process.argv.includes("--resume")) &&
          report.results.some(
            (result) => result.width === width && result.theme === theme,
          )
        )
          continue;
        const reference = previous?.results.find(
          (result) => result.width === width && result.theme === theme,
        );
        if (previous)
          assert(reference, `Missing baseline for ${width}/${theme}`);
        const result = await captureCase(browser, width, theme, reference);
        report.results.push(result);
        console.log(`PASS ${phase} ${width} ${theme}`);
      }
    if (phase !== "baseline" && !protectedOnly)
      for (const width of flowWidths) {
        const result = await runWorkspaceFlow(browser, width);
        report.flows.push(result);
        if (!result.passed) break;
      }
  } finally {
    await browser.close();
    fs.writeFileSync(
      phase === "baseline" ? baselinePath : verificationPath,
      JSON.stringify(report, null, 2),
    );
  }
  console.log(
    JSON.stringify({
      passed: report.flows.every((result) => result.passed),
      phase,
      cases: report.results.length,
      flows: report.flows.map(({ width, checks, passed, error }) => ({
        width,
        passed,
        checks: checks.length,
        error: error?.split("\n")[0],
      })),
      output,
      baselinePath,
    }),
  );
  assert(
    report.flows.every((result) => result.passed),
    "Workspace functional verification failed",
  );
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { captureProtected, compareProtected };
