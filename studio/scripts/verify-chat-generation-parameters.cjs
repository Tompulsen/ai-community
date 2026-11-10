// Isolated local contexts and intercepted APIs never issue a real generation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
process.env.PLAYWRIGHT_MODULE ||=
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const { prepare } = require("./verify-chat-scroll.cjs");
const {
  readVideoState: readPersistedState,
} = require("./verify-video-conversation.cjs");

const base = process.env.UI_TEST_URL || "http://localhost:3001/";
assert.equal(new URL(base).origin, "http://localhost:3001");
const origin = new URL(base).origin;
const models = ["o3-mini", "gpt-image-1", "grok-imagine-video"];
const draftText = "QA_CHAT_VIDEO 海边列车缓缓经过，镜头跟随海浪。";
const nextDraft = "QA_KEEP_NEW_DRAFT 复用前的新草稿";
const output = fs.mkdtempSync(
  path.join(os.tmpdir(), "octopus-chat-generation-parameters-"),
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxkAAAAASUVORK5CYII=",
  "base64",
);

function makeClip() {
  const file = path.join(output, "fixture.mp4");
  const encoded = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=144x256:r=10",
    "-t",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-y",
    file,
  ]);
  assert.equal(encoded.status, 0, String(encoded.stderr));
  return fs.readFileSync(file);
}

async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    assert(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function fixture(browser, clip, options) {
  const { width, theme } = options;
  const mobile = width <= 600;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 950 },
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: theme,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const state = {
    ...options,
    mobile,
    context,
    page,
    checks: [],
    errors: [],
    environmentWarnings: [],
    calls: [],
    blocked: [],
    jobs: [],
  };
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      (text.includes("googletagmanager.com") &&
        text.includes("Content Security Policy")) ||
      text.includes("ServiceWorker registration failed")
    )
      state.environmentWarnings.push(text);
    else state.errors.push(text);
  });
  await prepare(page);
  await page.addInitScript(
    ({ theme, models, missingRecord }) => {
      if (window !== window.top) return;
      const config = JSON.parse(localStorage.getItem("app-config"));
      config.version = 4.4;
      Object.assign(config.state, {
        theme,
        dontShowMaskSplashScreen: true,
        enableAutoGenerateTitle: false,
        disablePromptHint: true,
        sendPreviewBubble: false,
        models: models.map((name) => ({
          name,
          available: true,
          provider: { id: "gpt", providerName: "gpt" },
        })),
      });
      Object.assign(config.state.modelConfig, {
        model: models[0],
        providerName: "gpt",
        template: "{{input}}",
        sendMemory: false,
        enableInjectSystemPrompts: false,
      });
      localStorage.setItem("app-config", JSON.stringify(config));
      const chat = JSON.parse(localStorage.getItem("chat-next-web-store"));
      chat.state.sessions = chat.state.sessions.slice(0, 1);
      const session = chat.state.sessions[0];
      session.id = "generation-parameter-fixture";
      session.topic = "Generation parameter fixture";
      session.messages = missingRecord
        ? [
            {
              id: "missing-video-question",
              role: "user",
              content: "QA_MISSING_VIDEO",
              date: new Date(1).toLocaleString(),
            },
            {
              id: "missing-video-answer",
              role: "assistant",
              content: "视频生成任务",
              model: models[2],
              videoResultId: "missing-video-record",
              date: new Date(2).toLocaleString(),
            },
          ]
        : [];
      session.mask.modelConfig = { ...config.state.modelConfig };
      session.mask.syncGlobalConfig = false;
      session.mask.context = [];
      localStorage.setItem("chat-next-web-store", JSON.stringify(chat));
    },
    { theme, models, missingRecord: options.missingRecord === true },
  );
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== origin) {
      state.blocked.push(url.origin);
      return route.abort();
    }
    if (request.headers()["next-action"])
      return route.fulfill({
        contentType: "text/x-component",
        body: '0:{"a":false,"f":[]}\n',
      });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    state.calls.push({ method: request.method(), path: url.pathname });
    const json = (data) => route.fulfill({ json: data });
    const config = {
      newApiEnabled: false,
      needCode: false,
      hasModelApiKey: true,
      enableMcp: false,
      defaultModel: `${models[0]}@gpt`,
    };
    if (url.pathname === "/api/new-api/bootstrap")
      return json({
        success: true,
        data: {
          config,
          session: { authenticated: false, selectedTokenId: null, user: null },
        },
      });
    if (url.pathname === "/api/config") return json(config);
    if (url.pathname === "/api/new-api/status")
      return json({ success: true, data: { enabled: false } });
    if (
      url.pathname === "/api/remote-models" ||
      url.pathname.endsWith("/models")
    )
      return json({ data: models.map((id) => ({ id })) });
    if (url.pathname === "/api/announcement")
      return json({ announcement: null });
    if (url.pathname === "/api/cache/upload")
      return json({ success: true, data: {} });
    if (
      url.pathname.endsWith("/content") ||
      url.pathname === "/api/qa-chat-video.mp4"
    )
      return route.fulfill({ contentType: "video/mp4", body: clip });
    if (request.method() === "POST" && url.pathname === "/api/v1/videos") {
      const job = {
        id: `qa_chat_${state.jobs.length + 1}`,
        payload: request.postDataJSON(),
        status: "in_progress",
        gets: 0,
      };
      state.jobs.push(job);
      return json({ id: job.id, status: "queued" });
    }
    const match = /^\/api\/v1\/videos\/(qa_chat_\d+)$/.exec(url.pathname);
    if (match && request.method() === "GET") {
      const job = state.jobs.find((item) => item.id === match[1]);
      assert(job, "Only mock jobs can be queried");
      job.gets++;
      return json({
        id: job.id,
        status: job.status,
        ...(job.status === "completed"
          ? { video_url: `${base}api/qa-chat-video.mp4` }
          : { progress: 37 }),
      });
    }
    if (request.method() !== "GET") {
      state.errors.push(`Unexpected mutation: ${url.pathname}`);
      return json({ error: "Unexpected fixture mutation" });
    }
    return json({ success: true, data: [] });
  });
  await page.goto(`${base}#/chat`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.locator("#chat-input").waitFor();
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  return state;
}

const picker = (page) => page.locator("button[data-model-picker-trigger]");
const attachments = (page) => page.locator('[class*="attach-image_"]');

async function messageActionScope(state, message) {
  const { page, mobile } = state;
  let actions = message;
  if (mobile) {
    await message
      .getByRole("button", { name: "更多消息操作", exact: true })
      .click();
    actions = page.getByRole("dialog", { name: "消息操作", exact: true });
    await actions.waitFor();
  } else await message.hover();
  for (const name of ["复用配置", "删除"]) {
    assert.equal(
      await actions.getByRole("button", { name, exact: true }).count(),
      1,
      `The message exposes ${name} only once`,
    );
  }
  return actions;
}

async function assertVideoOnlyActions(result) {
  assert.equal(
    await result
      .getByRole("button", { name: /复用|删除|更多|重试|重新生成/ })
      .count(),
    0,
    "The video card does not duplicate generic message actions",
  );
}

async function checkMissingVideoRecord(browser, clip, options) {
  const state = await fixture(browser, clip, {
    ...options,
    missingRecord: true,
  });
  try {
    const message = state.page.locator(
      '[data-message-id="missing-video-answer"]',
    );
    await message
      .getByRole("status")
      .filter({ hasText: "视频记录暂不可用" })
      .waitFor();
    const actions = await messageActionScope(state, message);
    if (state.mobile) {
      await state.page.keyboard.press("Escape");
      await actions.waitFor({ state: "hidden" });
    }
    assert.equal(
      state.jobs.length,
      0,
      "Missing video records never generate automatically",
    );
    assert.deepEqual(state.errors, []);
    console.log(
      `PASS ${state.width}/${state.theme}: missing video keeps one generic message toolbar without POST`,
    );
  } finally {
    await state.context.close();
  }
}

async function chooseModel(state, model) {
  const { page } = state;
  await picker(page).click();
  const dialog = page.getByRole("dialog", { name: "选择模型", exact: true });
  await dialog
    .getByRole("button", {
      name: new RegExp(`^${model} \\((?:gpt|OpenAI)\\)$`),
    })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await until(
    async () =>
      (await picker(page).getAttribute("title")) === `选择模型: ${model}`,
    `Model ${model} becomes selected`,
  );
}

async function assertGeometry(state, locator, name) {
  const bounds = await locator.boundingBox();
  assert(bounds, `${name} is rendered`);
  assert(
    bounds.x >= -1 &&
      bounds.x + bounds.width <= state.width + 1 &&
      bounds.y >= -1 &&
      bounds.y + bounds.height <= (state.mobile ? 844 : 950) + 1,
    `${name} fits viewport: ${JSON.stringify(bounds)}`,
  );
  return bounds;
}

async function openParameters(state, name, keyboard = false) {
  const { page, mobile } = state;
  const trigger = page.getByRole("button", { name: new RegExp(`^${name}`) });
  assert.equal(await trigger.count(), 1, `${name} has exactly one trigger`);
  const triggerBounds = await assertGeometry(state, trigger, `${name} trigger`);
  if (mobile) {
    assert(triggerBounds.width >= 43.5, `${name} mobile target width is 44px`);
    assert(
      triggerBounds.height >= 43.5,
      `${name} mobile target height is 44px`,
    );
  }
  if (keyboard) {
    await page.keyboard.press("Tab");
    await trigger.focus();
    await trigger.press("Enter");
  } else await trigger.click();
  const panel = page.getByRole("dialog", { name, exact: true });
  await panel.waitFor();
  await panel.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const panelBounds = await assertGeometry(state, panel, `${name} panel`);
  assert.equal(
    await panel.getAttribute("aria-modal"),
    mobile ? "true" : "false",
  );
  if (!mobile)
    assert(
      panelBounds.y + panelBounds.height <= triggerBounds.y + 1,
      `${name} desktop popover is above the trigger`,
    );
  return { panel, trigger, keyboard };
}

async function closeParameters(state, controls) {
  await state.page.keyboard.press("Escape");
  await controls.panel.waitFor({ state: "hidden" });
  if (controls.keyboard)
    await until(
      () =>
        controls.trigger.evaluate(
          (element) => document.activeElement === element,
        ),
      "Escape restores parameter trigger focus",
    );
}

async function setVideoParameters(state) {
  const controls = await openParameters(state, "视频参数");
  await controls.panel
    .getByRole("radiogroup", { name: "分辨率", exact: true })
    .getByRole("radio", { name: "720p", exact: true })
    .check();
  await controls.panel
    .getByRole("radiogroup", { name: "画面比例", exact: true })
    .getByRole("radio", { name: "9:16", exact: true })
    .check();
  const duration = controls.panel.getByRole("slider", {
    name: "视频时长",
    exact: true,
  });
  await duration.focus();
  await duration.press("Home");
  for (let step = 0; Number(await duration.inputValue()) < 6; step++) {
    assert(step < 20, "The duration slider can reach six seconds");
    await duration.press("ArrowRight");
  }
  assert.equal(await duration.inputValue(), "6");
  assert.equal(
    await controls.panel
      .getByRole("radio", { name: "720p", exact: true })
      .isChecked(),
    true,
  );
  assert.equal(
    await controls.panel
      .getByRole("radio", { name: "9:16", exact: true })
      .isChecked(),
    true,
  );
  const modes = controls.panel.getByRole("combobox", {
    name: "视频生成方式",
    exact: true,
  });
  assert.equal(await modes.count(), 1, "Generation mode is in the same panel");
  if (await modes.evaluate((element) => element.tagName === "SELECT")) {
    await modes.selectOption("image-to-video");
  } else {
    await modes.click();
    await state.page
      .getByRole("option", { name: "图生视频", exact: true })
      .click();
  }
  await controls.panel.waitFor({ state: "visible" });
  await state.page.getByRole("listbox").waitFor({ state: "hidden" });
  const scrollport = controls.panel
    .locator(
      state.mobile ? '[class*="selection-dialog_content"]' : ":scope > div",
    )
    .first();
  state.parameterMetrics = await scrollport.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    scrollTop: element.scrollTop,
  }));
  await scrollport.evaluate(async (element) => {
    element.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  const reset = controls.panel.getByRole("button", {
    name: "重置",
    exact: true,
  });
  await reset.waitFor();
  const resetBounds = await reset.boundingBox();
  const panelBounds = await controls.panel.boundingBox();
  assert(
    resetBounds.y >= panelBounds.y &&
      resetBounds.y + resetBounds.height <= panelBounds.y + panelBounds.height,
    "Reset is visibly inside the panel",
  );
  const heading = controls.panel.getByText("视频参数", { exact: true });
  const headingBounds = await heading.boundingBox();
  assert(
    headingBounds.y >= panelBounds.y &&
      headingBounds.y + headingBounds.height <=
        panelBounds.y + panelBounds.height,
    "The video parameter title is visibly inside the panel",
  );
  Object.assign(state.parameterMetrics, {
    captureScrollTop: await scrollport.evaluate((element) => element.scrollTop),
    resetBounds,
    headingBounds,
    panelBounds,
  });
  assert.equal(state.parameterMetrics.captureScrollTop, 0);
  const viewportBounds = await scrollport.boundingBox();
  const keyOptions = [
    ["mode", modes],
    [
      "resolution",
      controls.panel.getByRole("radio", { name: "720p", exact: true }),
    ],
    ["ratio", controls.panel.getByRole("radio", { name: "9:16", exact: true })],
    ["duration", duration],
  ];
  state.parameterMetrics.keyOptions = {};
  for (const [name, option] of keyOptions) {
    const bounds = await option.boundingBox();
    assert(
      bounds.y >= viewportBounds.y - 1 &&
        bounds.y + bounds.height <=
          viewportBounds.y + viewportBounds.height + 1,
      `${name} is visible without scrolling the default panel`,
    );
    state.parameterMetrics.keyOptions[name] = bounds;
  }
  state.parameterMetrics.horizontalOverflow = await scrollport.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  assert(
    state.parameterMetrics.horizontalOverflow <= 1,
    "No panel horizontal overflow",
  );
  if (state.mobile) {
    const targets = await controls.panel
      .locator(
        'button, summary, input[type="radio"], input[type="range"], select',
      )
      .evaluateAll((elements) =>
        elements.flatMap((element) => {
          const bounds = element.getBoundingClientRect();
          if (
            element.closest('[aria-hidden="true"], [hidden]') ||
            !bounds.width ||
            !bounds.height ||
            getComputedStyle(element).visibility === "hidden"
          )
            return [];
          return [
            {
              name:
                element.getAttribute("aria-label") ||
                element.getAttribute("value") ||
                element.textContent,
              width: bounds.width,
              height: bounds.height,
            },
          ];
        }),
      );
    assert(
      targets.every((target) => target.width >= 43.5 && target.height >= 43.5),
      `Mobile parameter targets are 44px: ${JSON.stringify(targets)}`,
    );
    state.parameterMetrics.touchTargets = targets;
  }
  await until(
    async () =>
      (await state.page
        .locator('[role="status"][aria-atomic="true"]')
        .count()) === 0,
    "Model selection toasts finish before the parameter screenshot",
    5000,
  );
  await state.page.screenshot({
    path: path.join(
      output,
      `video-parameters-${state.width}-${state.theme}.png`,
    ),
  });
  await closeParameters(state, controls);
}

async function checkNavigation(state) {
  const { page, mobile } = state;
  if (mobile) {
    await page.locator("[data-workspace-sidebar-toggle]").click();
    const sidebar = page.locator("[data-sidebar-panel]");
    await until(
      async () => (await sidebar.getAttribute("aria-hidden")) !== "true",
      "Mobile sidebar opens",
    );
    await page
      .locator("[data-workspace-mobile-more]")
      .getByRole("button", { name: "更多操作", exact: true })
      .click();
    const more = page.getByRole("menu", { name: "更多操作", exact: true });
    await more.waitFor();
    assert.equal(
      await more.getByRole("menuitem", { name: "视频", exact: true }).count(),
      0,
    );
    await more.getByRole("menuitem", { name: "返回对话", exact: true }).click();
    await more.waitFor({ state: "hidden" });
  } else {
    assert.equal(
      await page
        .locator("[data-workspace-rail]")
        .getByRole("button", { name: "视频", exact: true })
        .count(),
      0,
    );
  }
  await page.evaluate(() => {
    const state = {
      ...history.state,
      usr: { model: "grok-imagine-video", draft: "route-fixture" },
    };
    history.replaceState(
      state,
      "",
      "#/video-workspace?model=grok-imagine-video#reference",
    );
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
  await until(
    () =>
      page.evaluate(
        () => location.hash === "#/chat?model=grok-imagine-video#reference",
      ),
    "Legacy video URL redirects to chat with query/hash",
  );
  assert.deepEqual(await page.evaluate(() => history.state.usr), {
    model: "grok-imagine-video",
    draft: "route-fixture",
  });
  assert.equal(await page.locator("#chat-input").inputValue(), draftText);
}

async function run(browser, clip, options) {
  const state = await fixture(browser, clip, options);
  const { page } = state;
  const pass = (message) => {
    state.checks.push(message);
    console.log(`PASS ${state.width}/${state.theme}: ${message}`);
  };
  try {
    if (process.argv.includes("--probe")) {
      await chooseModel(state, models[2]);
      const count = await page
        .getByRole("button", { name: /^视频参数/ })
        .count();
      console.log(JSON.stringify({ videoParameterTriggers: count }));
      assert.equal(count, 1, "Video models need the shared parameter trigger");
      return;
    }
    const input = page.locator("#chat-input");
    await input.fill(draftText);
    const upload = page.waitForEvent("filechooser");
    await page
      .getByRole("group", { name: "消息输入", exact: true })
      .getByRole("button", { name: /上传/ })
      .click();
    await (
      await upload
    ).setFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: png,
    });
    await until(
      async () => (await attachments(page).count()) === 1,
      "Reference image attaches",
    );
    const imageBefore = await attachments(page).first().getAttribute("style");
    if (!options.parametersOnly) {
      const reasoning = await openParameters(state, "思考强度", true);
      await closeParameters(state, reasoning);
      await chooseModel(state, models[1]);
      assert.equal(await input.inputValue(), draftText);
      assert.equal(
        await attachments(page).first().getAttribute("style"),
        imageBefore,
      );
      assert.equal(
        await page.getByRole("button", { name: /^思考强度/ }).count(),
        0,
      );
      const image = await openParameters(state, "生图参数");
      await closeParameters(state, image);
    }
    await chooseModel(state, models[2]);
    assert.equal(await input.inputValue(), draftText);
    assert.equal(
      await attachments(page).first().getAttribute("style"),
      imageBefore,
    );
    assert.equal(
      await page.getByRole("button", { name: /^生图参数/ }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: /^思考强度/ }).count(),
      0,
    );
    pass(
      "model switches preserve prompt/materials and show only their parameter control",
    );
    await setVideoParameters(state);
    pass(
      "shared video panel supports resolution, ratio, duration, mode and Escape/focus",
    );
    await assertGeometry(
      state,
      page.getByRole("group", { name: "消息输入", exact: true }),
      "Composer",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "The page has no horizontal overflow",
    );
    if (options.layoutOnly) {
      await page.screenshot({
        path: path.join(output, `layout-${state.width}-${state.theme}.png`),
      });
      pass("narrow composer remains inside viewport");
      if (!options.parametersOnly) {
        await checkNavigation(state);
        assert((await picker(page).textContent()).includes(models[2]));
        pass(
          "retired navigation is absent and legacy route state is preserved",
        );
      }
      assert.equal(state.jobs.length, 0);
      assert.deepEqual(state.errors, []);
      return;
    }
    assert.equal(state.jobs.length, 0);
    assert.equal(
      await page.evaluate(() => window.__chatScrollMock.requests.length),
      0,
      "Parameter controls never submit a text request",
    );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await until(() => state.jobs.length === 1, "One mocked video POST is sent");
    const job = state.jobs[0];
    assert.equal(job.payload.model, models[2]);
    assert.equal(job.payload.prompt, draftText);
    assert.equal(String(job.payload.seconds), "6");
    assert.equal(
      job.payload.aspect_ratio ?? job.payload.metadata?.aspect_ratio,
      "9:16",
    );
    assert.equal(
      job.payload.resolution ?? job.payload.metadata?.resolution,
      "720p",
    );
    assert(
      job.payload.input_reference?.startsWith("data:image/") ||
        job.payload.images?.length === 1,
      "The submitted request retains the reference image",
    );
    const result = page.getByTestId("chat-video-result");
    await result.waitFor();
    const messageId = await result.evaluate((node) =>
      node.closest("[data-message-id]").getAttribute("data-message-id"),
    );
    const message = page.locator(`[data-message-id="${messageId}"]`);
    await assertVideoOnlyActions(result);
    await result
      .getByText(/正在生成|等待生成|正在提交/)
      .first()
      .waitFor();
    await input.fill(nextDraft);
    job.status = "completed";
    const video = result.locator("video");
    await video.waitFor({ timeout: 30000 });
    await until(
      () => video.evaluate((node) => node.readyState >= 2),
      "Mock clip decodes in the original chat message",
    );
    assert.equal(await page.getByTestId("chat-video-result").count(), 1);
    assert.equal(await page.locator('[data-message-role="user"]').count(), 1);
    let savedMessages;
    await until(async () => {
      const stored = await readPersistedState(page, "chat-next-web-store");
      savedMessages = (stored?.state ?? stored)?.sessions?.find(
        (session) => session.id === "generation-parameter-fixture",
      )?.messages;
      return savedMessages?.some(
        (message) => message.role === "assistant" && message.videoResultId,
      );
    }, "The actual user and video assistant messages are durable");
    assert.deepEqual(
      savedMessages.map((message) => message.role),
      ["user", "assistant"],
    );
    state.savedMessages = savedMessages.map(({ id, role, videoResultId }) => ({
      id,
      role,
      videoResultId,
    }));
    const originalVideoRequest = (
      await readPersistedState(page, "video-workspace-results")
    )?.find((entry) => entry.id === messageId)?.request;
    assert(
      originalVideoRequest,
      "The original video request is durably stored",
    );
    assert.equal(
      await result.evaluate((node) =>
        node.closest("[data-message-id]").getAttribute("data-message-id"),
      ),
      messageId,
    );
    assert.equal(await input.inputValue(), nextDraft);
    assert.equal(state.jobs.length, 1, "Polling never repeats the paid POST");
    pass(
      "one mocked POST carries 720p/9:16/6s and completes in the original message",
    );
    await assertVideoOnlyActions(result);
    let actions = await messageActionScope(state, message);
    await actions
      .getByRole("button", { name: "复用配置", exact: true })
      .click();
    const confirmation = page.locator("[data-modal-dialog]");
    await confirmation.waitFor();
    await confirmation
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), nextDraft);
    actions = await messageActionScope(state, message);
    await actions
      .getByRole("button", { name: "复用配置", exact: true })
      .click();
    await confirmation.waitFor();
    await confirmation
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), draftText);
    assert.equal(await attachments(page).count(), 1);
    const reused = await openParameters(state, "视频参数");
    assert.equal(
      await reused.panel
        .getByRole("radio", { name: "720p", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(
      await reused.panel
        .getByRole("radio", { name: "9:16", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(
      await reused.panel
        .getByRole("slider", { name: "视频时长", exact: true })
        .inputValue(),
      "6",
    );
    await closeParameters(state, reused);
    assert.equal(state.jobs.length, 1, "Reuse only fills the composer");
    assert.deepEqual(
      (await readPersistedState(page, "video-workspace-results"))?.find(
        (entry) => entry.id === messageId,
      )?.request,
      originalVideoRequest,
      "Message-level reuse never modifies the saved original video request",
    );
    pass(
      "reuse confirms a nonempty draft and restores parameters/materials without POST",
    );
    await page.screenshot({
      path: path.join(output, `complete-${state.width}-${state.theme}.png`),
    });
    await checkNavigation(state);
    assert((await picker(page).textContent()).includes(models[2]));
    pass("retired navigation is absent and legacy route state is preserved");
    assert.deepEqual(state.errors, []);
  } catch (error) {
    await page.screenshot({
      path: path.join(output, `failure-${state.width}-${state.theme}.png`),
    });
    console.error((await page.locator("body").innerText()).slice(-2200));
    throw error;
  } finally {
    const result = {
      width: state.width,
      theme: state.theme,
      checks: state.checks,
      errors: state.errors,
      environmentWarnings: state.environmentWarnings,
      calls: state.calls,
      mockPaidPosts: state.jobs.length,
      mockRequests: state.jobs.map(({ id, payload, gets }) => ({
        id,
        payload,
        gets,
      })),
      savedMessages: state.savedMessages,
      realPaidRequests: 0,
      blocked: state.blocked,
      parameterMetrics: state.parameterMetrics,
    };
    fs.writeFileSync(
      path.join(output, `result-${state.width}-${state.theme}.json`),
      JSON.stringify(result, null, 2),
    );
    await state.context.close();
  }
}

(async () => {
  const parametersOnly = process.argv.includes("--parameters-only");
  const clip = parametersOnly ? Buffer.alloc(0) : makeClip();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    let cases = process.argv.includes("--probe")
      ? [{ width: 1440, theme: "light" }]
      : [
          { width: 1440, theme: "light" },
          { width: 390, theme: "dark" },
          { width: 320, theme: "light", layoutOnly: true },
        ];
    if (parametersOnly)
      cases = cases.map((options) => ({
        ...options,
        parametersOnly: true,
        layoutOnly: true,
      }));
    const requestedWidth = process.argv.find((arg) =>
      arg.startsWith("--width="),
    );
    if (requestedWidth) {
      cases = cases.filter(
        (options) => options.width === Number(requestedWidth.split("=")[1]),
      );
      assert(cases.length, "Requested width must be 1440, 390 or 320");
    }
    for (const options of cases) {
      await run(browser, clip, options);
      if (
        !options.layoutOnly &&
        !parametersOnly &&
        !process.argv.includes("--probe")
      )
        await checkMissingVideoRecord(browser, clip, options);
    }
  } finally {
    await browser.close();
    console.log(JSON.stringify({ output, realPaidRequests: 0 }));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
