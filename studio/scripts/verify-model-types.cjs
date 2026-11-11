// Isolated account/provider fixtures; no real keys or model calls are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const origin = new URL(base).origin;
const output =
  process.env.UI_TEST_OUTPUT_DIR ||
  path.join(os.tmpdir(), "octopus-model-types");
const captureOnly = process.env.UI_REASONING_CAPTURE_ONLY === "1";
const model = "studio-alias";
const longModel =
  "studio-extended-model-alias-for-checking-the-visible-ultra-effort-label";
const customOrigin = "https://custom.fixture.test";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=";
const audioBytes = Buffer.from("fixture original m4a audio bytes");
const videoBytes = Buffer.from("fixture original mp4 video bytes");

async function run(browser, width, theme) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    isMobile: width < 600,
    hasTouch: width < 600,
    colorScheme: theme,
    reducedMotion: "no-preference",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const sent = [];
  const screenshots = [];
  const popoverObservations = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ theme, model }) => {
      if (window !== window.top || localStorage.getItem("model-types-fixture"))
        return;
      localStorage.setItem("model-types-fixture", "1");
      localStorage.setItem("lang", "cn");
      localStorage.setItem(
        "app-config",
        JSON.stringify({
          version: 4.3,
          state: {
            models: [],
            theme,
            enableAutoGenerateTitle: false,
            modelConfig: {
              model,
              providerName: "studio",
              stream: false,
              imageRequestMode: "sync",
              imageStream: false,
              sendMemory: false,
              enableInjectSystemPrompts: false,
              historyMessageCount: 0,
              template: "{{input}}",
            },
          },
        }),
      );
      localStorage.setItem(
        "octopus:user-7:custom-provider",
        JSON.stringify({
          useCustomConfig: true,
          customConfigName: "Fixture",
          customApiMode: "auto",
          customModelNames: model,
          openaiUrl: "https://custom.fixture.test/v1",
          openaiApiKey: "sk-custom-fixture",
        }),
      );
    },
    { theme, model },
  );
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    const eventStream = (events) =>
      route.fulfill({
        contentType: "text/event-stream; charset=utf-8",
        body:
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
          "data: [DONE]\n\n",
      });
    if (
      url.origin === customOrigin ||
      (url.origin === origin && /^\/api\/v1(?:beta)?\//.test(url.pathname))
    ) {
      const source = url.origin === customOrigin ? "custom" : "account";
      if (request.method() === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": origin,
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
          },
        });
      if (source === "custom") {
        if (url.pathname.startsWith("/v1beta/")) {
          assert.equal(
            request.headers()["x-goog-api-key"],
            "sk-custom-fixture",
          );
          assert(!request.headers().authorization);
        } else if (url.pathname.endsWith("/messages")) {
          assert.equal(request.headers()["x-api-key"], "sk-custom-fixture");
          assert.equal(request.headers()["anthropic-version"], "2023-06-01");
          assert(!request.headers().authorization);
        } else {
          assert.equal(
            request.headers().authorization,
            "Bearer sk-custom-fixture",
          );
        }
        assert(!request.headers()["x-new-api-token"]);
      } else {
        assert.equal(request.headers()["x-new-api-token"], "100");
        assert.notEqual(
          request.headers().authorization,
          "Bearer sk-custom-fixture",
        );
        assert(!request.headers()["x-goog-api-key"]);
        assert(!request.headers()["x-api-key"]);
      }
      if (url.pathname.endsWith("/images/generations")) {
        sent.push({ source, path: url.pathname, body: request.postDataJSON() });
        return route.fulfill({ json: { data: [{ b64_json: png }] } });
      }
      if (url.pathname.endsWith("/chat/completions")) {
        const body = request.postDataJSON();
        sent.push({ source, path: url.pathname, body });
        if (body.stream)
          return eventStream([
            { choices: [{ delta: { content: `${source} chat fixture` } }] },
          ]);
        return route.fulfill({
          json: {
            choices: [{ message: { content: `${source} chat fixture` } }],
          },
        });
      }
      if (/:(?:generateContent|streamGenerateContent)$/.test(url.pathname)) {
        const body = request.postDataJSON();
        sent.push({ source, path: url.pathname, body });
        if (
          body.generationConfig?.thinkingConfig?.thinkingLevel === "ultra" &&
          JSON.stringify(body).includes("GEMINI_REASONING_FALLBACK_FIXTURE")
        )
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 400,
                status: "INVALID_ARGUMENT",
                message: "Unsupported thinkingLevel value: ultra",
                details: [
                  {
                    fieldViolations: [
                      {
                        field: "generationConfig.thinkingConfig.thinkingLevel",
                        description: "Unsupported thinkingLevel value: ultra",
                      },
                    ],
                  },
                ],
              },
            },
          });
        const response = {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: `${source} gemini fixture` }],
              },
              finishReason: "STOP",
            },
          ],
        };
        return url.pathname.endsWith(":streamGenerateContent")
          ? eventStream([response])
          : route.fulfill({ json: response });
      }
      if (url.pathname.endsWith("/responses")) {
        const body = request.postDataJSON();
        sent.push({ source, path: url.pathname, body });
        if (body.stream)
          return eventStream([
            {
              type: "response.output_text.delta",
              delta: `${source} responses fixture`,
            },
            {
              type: "response.completed",
              response: { output_text: `${source} responses fixture` },
            },
          ]);
        return route.fulfill({
          json: {
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: `${source} responses fixture`,
                  },
                ],
              },
            ],
          },
        });
      }
      if (url.pathname.endsWith("/messages")) {
        const body = request.postDataJSON();
        sent.push({ source, path: url.pathname, body });
        if (
          body.output_config?.effort === "ultra" &&
          JSON.stringify(body).includes("CLAUDE_REASONING_FALLBACK_FIXTURE")
        )
          return route.fulfill({
            status: 400,
            json: {
              error: {
                type: "invalid_request_error",
                param: "output_config.effort",
                message: "Unsupported output_config.effort: ultra",
              },
            },
          });
        if (body.stream)
          return eventStream([
            {
              type: "content_block_delta",
              delta: { type: "text_delta", text: `${source} claude fixture` },
            },
            { type: "message_stop" },
          ]);
        return route.fulfill({
          json: {
            content: [{ type: "text", text: `${source} claude fixture` }],
          },
        });
      }
      if (url.pathname.endsWith("/models"))
        return route.fulfill({ json: { data: [{ id: model }] } });
      throw new Error(`Unexpected model request ${url.pathname}`);
    }
    if (url.origin !== origin) return route.abort();
    if (request.headers()["next-action"])
      return route.fulfill({ status: 503, body: "Fixture: MCP unavailable" });
    if (url.pathname === "/api/new-api/bootstrap")
      return ok({
        config: { newApiEnabled: true, enableMcp: false },
        session: {
          authenticated: true,
          user: { id: 7, username: "fixture" },
          selectedTokenId: 100,
        },
      });
    if (url.pathname === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true, enableMcp: false } });
    if (url.pathname === "/api/new-api/session")
      return ok({
        authenticated: true,
        user: { id: 7, username: "fixture" },
        selectedTokenId: 100,
      });
    if (url.pathname === "/api/new-api/status")
      return ok({ enabled: true, configured: true });
    if (url.pathname === "/api/new-api/model-groups")
      return ok({
        groups: [{ id: "auto", name: "Auto 系统", ratio: "auto" }],
        selectedGroup: "auto",
      });
    if (url.pathname === "/api/remote-models")
      return route.fulfill({
        json: { data: [{ id: model }, { id: longModel }] },
      });
    if (url.pathname === "/api/announcement")
      return route.fulfill({ json: { announcement: null } });
    if (url.pathname === "/api/ai-daily")
      return route.fulfill({ json: { items: [] } });
    if (url.pathname === "/api/skills/capabilities")
      return route.fulfill({ json: { web: false, papers: false } });
    if (url.pathname.startsWith("/api/"))
      throw new Error(`Unexpected fixture request ${url.pathname}`);
    return route.continue();
  });

  const trigger = page.locator('button[title^="选择模型:"]');
  const combined = page.getByRole("dialog", {
    name: "模型与推理",
    exact: true,
  });
  const picker = page.getByRole("dialog", { name: "选择模型", exact: true });
  const option = (source) =>
    picker.getByRole("button", {
      name: `${model} (${source === "account" ? "studio" : "octopus-custom"})`,
      exact: true,
    });
  const row = (source) => option(source).locator("xpath=../..");
  const adjust = (source) =>
    row(source).getByRole("button", {
      name: `调整模型类型: ${model}`,
      exact: true,
    });
  const open = async () => {
    await trigger.click();
    if ((await trigger.getAttribute("aria-expanded")) === "true") {
      await combined.waitFor();
      await combined.getByRole("button", { name: /^选择模型:/ }).click();
      await combined.waitFor({ state: "detached" });
    }
    await picker.waitFor();
    await option("account").waitFor();
    await adjust("account").waitFor({ state: "visible" });
  };
  const changeType = async (source, type) => {
    if ((await adjust(source).getAttribute("aria-expanded")) !== "true")
      await adjust(source).click();
    const select = row(source).getByRole("combobox", {
      name: "模型类型",
      exact: true,
    });
    await select.selectOption(type);
    assert.equal(await select.inputValue(), type);
    return select;
  };
  const changeFormat = async (source, format) => {
    if ((await adjust(source).getAttribute("aria-expanded")) !== "true")
      await adjust(source).click();
    const select = row(source).getByRole("combobox", {
      name: "聊天接口格式",
      exact: true,
    });
    await select.selectOption(format);
    assert.equal(await select.inputValue(), format);
    return select;
  };
  const close = async () => {
    await picker.getByRole("button", { name: "关闭", exact: true }).click();
    await picker.waitFor({ state: "detached" });
  };
  const openCombined = async () => {
    await trigger.click();
    await combined.waitFor();
    assert.equal(await page.getByRole("dialog").count(), 1);
    assert.equal(await picker.count(), 0);
    assert.equal(await combined.getAttribute("aria-modal"), "false");
    assert.equal(
      await page.locator("dialog:modal").count(),
      0,
      "the compact control must not open a native modal",
    );
    return combined.getByRole("slider", { name: "推理强度", exact: true });
  };
  const closeCombined = async () => {
    await page.keyboard.press("Escape");
    await combined.waitFor({ state: "detached" });
  };
  const setEffort = async (label) => {
    if (!(await combined.isVisible())) await openCombined();
    if (label === "自动") {
      await combined.getByRole("button", { name: "自动", exact: true }).click();
      return;
    }
    const index = ["Low", "Medium", "High", "XHigh", "Max", "Ultra"].indexOf(
      label,
    );
    assert(index >= 0, `unknown fixture effort ${label}`);
    const range = combined.getByRole("slider", {
      name: "推理强度",
      exact: true,
    });
    await range.focus();
    await page.keyboard.press("Home");
    for (let step = 0; step < index; step++)
      await page.keyboard.press("ArrowRight");
    assert.equal(await range.getAttribute("aria-valuetext"), label);
  };
  const visibleEffort = () => trigger.locator('[aria-label^="推理强度："]');
  const sliderControl = () =>
    combined.locator("[data-automatic][data-dragging]");
  const readPopoverMetrics = async () =>
    combined.evaluate((panel) => {
      const style = getComputedStyle(panel);
      const bounds = panel.getBoundingClientRect();
      const clientBounds = {
        left: bounds.left + panel.clientLeft,
        top: bounds.top + panel.clientTop,
        right: bounds.left + panel.clientLeft + panel.clientWidth,
        bottom: bounds.top + panel.clientTop + panel.clientHeight,
      };
      const probe = document.createElement("div");
      Object.assign(probe.style, {
        position: "fixed",
        left: "-9999px",
        width: "100px",
        height: "100px",
        overflow: "scroll",
        scrollbarGutter: "auto",
        border: "0",
        padding: "0",
      });
      document.body.append(probe);
      const classicScrollbarGutter = probe.offsetWidth - probe.clientWidth;
      probe.remove();
      return {
        viewportWidth: innerWidth,
        effort: panel.getAttribute("data-effort"),
        bounds: bounds.toJSON(),
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollbarGutter: style.scrollbarGutter,
        clientWidth: panel.clientWidth,
        clientHeight: panel.clientHeight,
        scrollWidth: panel.scrollWidth,
        scrollHeight: panel.scrollHeight,
        verticalGutter:
          panel.offsetWidth -
          panel.clientWidth -
          Number.parseFloat(style.borderLeftWidth) -
          Number.parseFloat(style.borderRightWidth),
        classicScrollbarGutter,
        clippedControls: [
          ...panel.querySelectorAll("button, input[type='range']"),
        ].filter((control) => {
          const rect = control.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            (rect.left < clientBounds.left - 0.5 ||
              rect.right > clientBounds.right + 0.5 ||
              rect.top < clientBounds.top - 0.5 ||
              rect.bottom > clientBounds.bottom + 0.5)
          );
        }).length,
      };
    });
  const checkSliderPosition = async (position) => {
    await page.waitForFunction((expected) => {
      const input = document.querySelector(
        '[role="dialog"][aria-label="模型与推理"] input[aria-label="推理强度"]',
      );
      const control = document.querySelector(
        '[role="dialog"][aria-label="模型与推理"] [data-automatic]',
      );
      const thumb = control?.querySelector("[class*='_thumb']");
      const rail = control?.querySelector("[class*='_rail']");
      if (!input || !thumb || !rail) return false;
      const bounds = rail.getBoundingClientRect();
      const diameter = Number.parseFloat(
        getComputedStyle(control).getPropertyValue("--slider-thumb-size"),
      );
      const center =
        bounds.left + diameter / 2 + expected * (bounds.width - diameter);
      return Math.abs(thumb.getBoundingClientRect().left - center) < 1;
    }, position);
  };
  const checkPopoverBounds = async () => {
    await page.waitForFunction(() => {
      const panel = document.querySelector(
        '[role="dialog"][aria-label="模型与推理"]',
      );
      const trigger = document.querySelector("[data-model-picker-trigger]");
      if (!panel || !trigger) return false;
      const bounds = panel.getBoundingClientRect();
      const anchor = trigger.getBoundingClientRect();
      const gap = anchor.top - bounds.bottom;
      return (
        panel
          .getAnimations()
          .every((animation) => animation.playState !== "running") &&
        bounds.left >= -1 &&
        bounds.right <= innerWidth + 1 &&
        gap >= -2 &&
        gap <= 32
      );
    });
    const panel = await combined.boundingBox();
    const anchor = await trigger.boundingBox();
    const send = await page
      .getByRole("button", { name: "发送", exact: true })
      .boundingBox();
    const viewport = page.viewportSize();
    assert(panel && anchor && send && viewport);
    assert(
      panel.x >= -1 &&
        panel.x + panel.width <= viewport.width + 1 &&
        panel.y >= -1 &&
        panel.width <= 221 &&
        panel.height < 320,
      "anchored effort panel must stay compact and inside the viewport",
    );
    const gapAbove = anchor.y - panel.y - panel.height;
    assert(
      gapAbove >= -2 && gapAbove <= 32,
      "the effort panel must expand immediately above its trigger",
    );
    assert(
      anchor.y + anchor.height <= send.y + 1,
      "model/effort entry must remain in the toolbar above the input actions",
    );
    const composerLayout = await trigger.evaluate((element) => {
      const toolbar = element.closest('[class*="composer-toolbar"]');
      const input = document.querySelector("#chat-input");
      const editor = input?.closest("label");
      const actions = editor?.querySelector(
        '[class*="chat-input-send-actions"]',
      );
      if (!toolbar || !input || !editor || !actions) return null;
      return {
        toolbar: toolbar.getBoundingClientRect().toJSON(),
        editor: editor.getBoundingClientRect().toJSON(),
        actions: actions.getBoundingClientRect().toJSON(),
        buttons: [...actions.querySelectorAll("button")].map((button) => ({
          name: button.getAttribute("aria-label"),
          bounds: button.getBoundingClientRect().toJSON(),
        })),
      };
    });
    assert(composerLayout, "the toolbar and original input actions must exist");
    assert(
      Math.abs(anchor.x + anchor.width - composerLayout.toolbar.right) <= 2 &&
        composerLayout.toolbar.bottom <= composerLayout.editor.top + 1,
      `model/effort entry must align to the right of the toolbar above the editor: ${JSON.stringify(
        {
          anchor,
          toolbar: composerLayout.toolbar,
          editor: composerLayout.editor,
        },
      )}`,
    );
    assert.deepEqual(
      composerLayout.buttons.map((button) => button.name),
      ["语音输入", "展开编辑", "发送"],
      "microphone, expand and send must share the original input action group",
    );
    const { editor, actions, buttons } = composerLayout;
    assert(
      actions.left >= editor.left &&
        actions.top >= editor.top &&
        actions.right <= editor.right &&
        actions.bottom <= editor.bottom &&
        editor.right - actions.right <= 16 &&
        buttons.every(
          (button, index) =>
            Math.abs(
              button.bounds.top +
                button.bounds.height / 2 -
                send.y -
                send.height / 2,
            ) <= 1 &&
            (index === 0 ||
              buttons[index - 1].bounds.right <= button.bounds.left),
        ),
      "the three input actions must form one aligned row at the editor's right",
    );
    const background = await page.evaluate(() => ({
      inert: Boolean(document.querySelector("#chat-input")?.closest("[inert]")),
      masks: [...document.querySelectorAll(".modal-mask")].filter(
        (element) =>
          getComputedStyle(element).display !== "none" &&
          element.getBoundingClientRect().width > 0,
      ).length,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.equal(
      background.inert,
      false,
      "background editor remains interactive",
    );
    assert.equal(background.masks, 0, "the effort popover must not add a mask");
    assert.equal(background.overflow, false);
    const metrics = await readPopoverMetrics();
    popoverObservations.push(metrics);
    assert.equal(metrics.overflowX, "hidden");
    assert.equal(metrics.overflowY, "hidden");
    assert.equal(metrics.verticalGutter, 0);
    assert.equal(metrics.clippedControls, 0);
    assert(
      metrics.scrollHeight <= metrics.clientHeight,
      "visible controls must fit inside the fixed popover height",
    );
    if (viewport.width >= 600)
      assert(
        metrics.classicScrollbarGutter > 0,
        "desktop must exercise real non-overlay scrollbars",
      );
    if (viewport.width < 600) {
      const touchTargets = await combined
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getBoundingClientRect().toJSON()),
        );
      assert(
        touchTargets.length >= 2 &&
          touchTargets.every(
            (button) => button.width >= 44 && button.height >= 44,
          ),
        `mobile model and automatic controls must retain 44px touch targets: ${JSON.stringify(
          touchTargets,
        )}`,
      );
    }
  };
  const screenshot = async (name) => {
    if (captureOnly && name !== "reasoning-ultra") return;
    const file = path.join(
      output,
      `${name}-${page.viewportSize().width}-${theme}.png`,
    );
    await page.screenshot({
      path: file,
      animations: ["reasoning-high", "reasoning-ultra"].includes(name)
        ? "allow"
        : "disabled",
    });
    screenshots.push(file);
  };
  const checkBounds = async () => {
    const invalid = await page.evaluate(() => {
      const width = innerWidth;
      const dialog = document.querySelector("dialog[open]");
      const inputs = [
        ...(dialog || document).querySelectorAll(
          'button[aria-label^="调整模型类型:"], button[aria-label*="收藏:"], select',
        ),
      ];
      const rows = [
        ...(dialog || document).querySelectorAll('[class*="model-select-row"]'),
      ];
      return {
        overflow: document.documentElement.scrollWidth > width,
        clipped: inputs.filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            (rect.left < -1 || rect.right > width + 1)
          );
        }).length,
        overlapping: rows.filter((row) => {
          const buttons = [...row.children].filter(
            (element) => element.tagName === "BUTTON",
          );
          return buttons.some((element, index) => {
            const rect = element.getBoundingClientRect();
            const next = buttons[index + 1]?.getBoundingClientRect();
            return next && rect.right > next.left + 1;
          });
        }).length,
        smallTouchTargets:
          width >= 600
            ? 0
            : inputs.filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width < 44 || rect.height < 44;
              }).length,
        clippedNames: rows.filter((row) => {
          const name = row.querySelector('[class*="model-select-item-name"]');
          return name && name.scrollWidth > name.clientWidth + 1;
        }).length,
      };
    });
    assert.equal(
      invalid.overflow,
      false,
      "page must not overflow horizontally",
    );
    assert.equal(invalid.clipped, 0, "model type controls must remain in view");
    assert.equal(invalid.overlapping, 0, "model controls must not overlap");
    assert.equal(
      invalid.smallTouchTargets,
      0,
      "mobile controls must be at least 44px",
    );
    assert.equal(invalid.clippedNames, 0, "model names must fit their column");
  };
  const send = async (text, expectedSource, expectedPath, count = 1) => {
    const before = sent.length;
    const pending = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.replace(
          /:streamGenerateContent$/,
          ":generateContent",
        ) === expectedPath,
    );
    await page.locator("#chat-input").fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await pending;
    await page.getByRole("button", { name: "发送", exact: true }).waitFor();
    assert.equal(sent.length, before + count);
    assert.equal(sent.at(-1).source, expectedSource);
    if (expectedPath.includes("/v1beta/"))
      assert(
        expectedPath.endsWith(`/models/${model}:generateContent`),
        "native Gemini must preserve the selected model alias",
      );
    else assert.equal(sent.at(-1).body.model, model);
    return sent.at(-1);
  };
  const uploadMedia = () =>
    page.locator('input[type="file"][aria-label="上传素材"]').setInputFiles([
      { name: "sample.m4a", mimeType: "audio/mp4", buffer: audioBytes },
      { name: "sample.mp4", mimeType: "video/mp4", buffer: videoBytes },
    ]);
  const checkGeminiMedia = (request, text) => {
    const message = request.body.contents
      .filter((entry) => entry.role === "user")
      .at(-1);
    assert(
      message.parts.some((part) => part.text?.includes(text)),
      "the user's text must accompany the original audio/video",
    );
    assert.deepEqual(
      message.parts
        .filter((part) => part.inlineData)
        .map((part) => part.inlineData),
      [
        { mimeType: "audio/mp4", data: audioBytes.toString("base64") },
        { mimeType: "video/mp4", data: videoBytes.toString("base64") },
      ],
      "native Gemini must receive original bytes and MIME types",
    );
  };

  try {
    await page.goto(`${base}#/chat`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.locator("#chat-input").waitFor({ timeout: 90000 });
    const slider = await openCombined();
    assert.equal(await slider.getAttribute("max"), "5");
    assert.equal(await sliderControl().getAttribute("data-automatic"), "true");
    await checkPopoverBounds();
    await screenshot("reasoning-auto");
    if (width === 390) {
      await page.setViewportSize({ width: 320, height: 950 });
      await checkPopoverBounds();
      await screenshot("reasoning-narrow");
      await page.setViewportSize({ width, height: 950 });
      await checkPopoverBounds();
    }
    await setEffort("High");
    await checkSliderPosition(0.4);
    assert((await visibleEffort().innerText()).includes("High"));
    await screenshot("reasoning-high");
    const palette = await sliderControl().evaluate((control) => ({
      rail:
        getComputedStyle(control.querySelector("[class*='_rail']"))
          .backgroundColor +
        "|" +
        getComputedStyle(control.querySelector("[class*='_rail']"))
          .backgroundImage,
      fill: getComputedStyle(control.querySelector("[class*='_fill']"))
        .backgroundImage,
      thumb: getComputedStyle(
        control.querySelector("[class*='_thumb']"),
        "::before",
      ).backgroundColor,
      foreground: getComputedStyle(control).color,
      surface: getComputedStyle(control).getPropertyValue("--white").trim(),
    }));
    assert.notEqual(
      palette.rail,
      palette.thumb,
      "knob must contrast with rail",
    );
    assert(
      palette.fill.includes("gradient("),
      "the compact effort track must render its gradient",
    );
    await slider.focus();
    await page.keyboard.press("End");
    await checkSliderPosition(1);
    assert.equal(await slider.getAttribute("aria-valuetext"), "Ultra");
    assert.equal(await sliderControl().getAttribute("data-energized"), "true");
    const visualMotion = await sliderControl().evaluate(async (control) => {
      const dots = [...control.querySelectorAll("span[data-brightness]")];
      const starsLayer = dots[0]?.parentElement?.parentElement;
      const sweep = control.querySelector("[class*='_sweep']");
      const energy = sweep?.parentElement;
      const positions = dots.map((dot) => dot.getBoundingClientRect().x);
      const sweepTransform = sweep ? getComputedStyle(sweep).transform : null;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const stars = dots.map((dot, index) => {
        const particle = dot.parentElement;
        const style = getComputedStyle(particle);
        const dotStyle = getComputedStyle(dot);
        const bounds = dot.getBoundingClientRect();
        const clip = starsLayer.getBoundingClientRect();
        const colors = dotStyle.backgroundColor.match(/[\d.]+/g) || [];
        return {
          opacity:
            Number(style.opacity) *
            Number(dotStyle.opacity) *
            Number(getComputedStyle(starsLayer).opacity),
          running: particle
            .getAnimations({ subtree: true })
            .some((animation) => animation.playState === "running"),
          moved: Math.abs(bounds.x - positions[index]) > 0.1,
          clipped:
            bounds.right <= clip.left ||
            bounds.left >= clip.right ||
            bounds.bottom <= clip.top ||
            bounds.top >= clip.bottom,
          dotSize: Number.parseFloat(dotStyle.width),
          bright: colors.slice(0, 3).every((color) => Number(color) >= 200),
          duration: Number.parseFloat(style.animationDuration),
          delay: Number.parseFloat(style.animationDelay),
        };
      });
      return {
        thumbSize: Number.parseFloat(
          getComputedStyle(control).getPropertyValue("--slider-thumb-size"),
        ),
        railHeight: control
          .querySelector("[class*='_rail']")
          .getBoundingClientRect().height,
        starCount: stars.length,
        firstStarDuration: stars[0]?.duration,
        firstStarDelay: stars[0]?.delay,
        starDurationMin: Math.min(...stars.map((star) => star.duration)),
        starDurationMax: Math.max(...stars.map((star) => star.duration)),
        visibleMovingStars: stars.filter(
          (star) =>
            star.running &&
            star.moved &&
            !star.clipped &&
            star.opacity > 0.1 &&
            star.dotSize > 0 &&
            star.bright,
        ).length,
        independentLayers:
          Boolean(starsLayer && energy) &&
          starsLayer !== energy &&
          starsLayer.parentElement === energy.parentElement,
        nebulaVisible:
          Boolean(energy) &&
          Number(getComputedStyle(energy).opacity) > 0.1 &&
          getComputedStyle(energy).backgroundImage.includes("gradient("),
        sweepRunning:
          Boolean(sweep) &&
          sweep
            .getAnimations()
            .some((animation) => animation.playState === "running"),
        sweepMoved:
          Boolean(sweep) &&
          sweepTransform !== getComputedStyle(sweep).transform,
        sweepDuration: sweep ? getComputedStyle(sweep).animationDuration : null,
      };
    });
    assert.equal(
      visualMotion.starCount,
      22,
      "Ultra must expose its 22 particle nodes",
    );
    assert(
      visualMotion.visibleMovingStars > 0,
      "at least one bright particle must actually be visible and moving",
    );
    assert(
      visualMotion.independentLayers,
      "stars must have an independent layer",
    );
    assert(visualMotion.nebulaVisible, "Ultra must render its nebula gradient");
    assert(
      visualMotion.sweepRunning && visualMotion.sweepMoved,
      "the nebula sweep must actually move",
    );
    assert.equal(visualMotion.thumbSize, 22);
    assert.equal(visualMotion.railHeight, 22);
    assert.equal(visualMotion.sweepDuration, "1.2s");
    await screenshot("reasoning-ultra");
    if (captureOnly) {
      assert.deepEqual(errors, [], "capture must not produce page errors");
      assert.deepEqual(sent, [], "capture must not send model requests");
      const bounds = await combined.boundingBox();
      popoverObservations.push(await readPopoverMetrics());
      console.log(
        JSON.stringify({
          width,
          theme,
          screenshots,
          popoverSize: { width: bounds.width, height: bounds.height },
          popoverObservations,
          visualMotion,
          result: "captured",
        }),
      );
      return { width, theme, palette };
    }
    await page.keyboard.press("Home");
    assert.equal(await slider.getAttribute("aria-valuetext"), "Low");
    await page.keyboard.press("ArrowRight");
    assert.equal(await slider.getAttribute("aria-valuetext"), "Medium");
    for (const [index, label] of [
      "Low",
      "Medium",
      "High",
      "XHigh",
      "Max",
      "Ultra",
    ].entries()) {
      await setEffort(label);
      await checkSliderPosition(index / 5);
    }
    await setEffort("High");
    await checkSliderPosition(0.4);
    let sliderBounds = await slider.boundingBox();
    const sliderX = (position) =>
      sliderBounds.x + 22 + position * (sliderBounds.width - 44);
    const sliderY = () => sliderBounds.y + sliderBounds.height / 2;
    await page.mouse.move(sliderX(0.4), sliderY());
    await page.mouse.down();
    for (const position of [0.41, 0.49, 0.57]) {
      await page.mouse.move(sliderX(position), sliderY(), { steps: 3 });
      const draft = await sliderControl().evaluate((control) =>
        Number(control.style.getPropertyValue("--effort-position")),
      );
      assert(Math.abs(draft - position) < 0.01, "drag must remain continuous");
    }
    await page.mouse.up();
    await checkSliderPosition(0.6);
    assert.equal(await slider.getAttribute("aria-valuetext"), "XHigh");
    await setEffort("High");
    await checkSliderPosition(0.4);
    sliderBounds = await slider.boundingBox();
    await page.mouse.move(sliderX(0.4), sliderY());
    await page.mouse.down();
    await page.mouse.move(sliderX(0.95), sliderY());
    await page.keyboard.press("Escape");
    assert(await combined.isVisible(), "Escape first cancels a live drag");
    assert.equal(await sliderControl().getAttribute("data-dragging"), "false");
    await page.mouse.up();
    assert.equal(await slider.getAttribute("aria-valuetext"), "High");
    await page.keyboard.press("Escape");
    await combined.waitFor({ state: "detached" });
    await openCombined();
    await page.mouse.click(4, 4);
    await combined.waitFor({ state: "detached" });
    await open();
    await picker
      .getByRole("button", { name: `${longModel} (studio)`, exact: true })
      .click();
    await picker.waitFor({ state: "detached" });
    await setEffort("Ultra");
    await closeCombined();
    const truncation = await trigger.evaluate((button) => {
      const name = button.querySelector("[class*='_model']");
      const effort = button.querySelector('[aria-label^="推理强度："]');
      const bounds = button.getBoundingClientRect();
      const text = effort.getBoundingClientRect();
      return {
        clipped: name.scrollWidth > name.clientWidth,
        fits: text.left >= bounds.left && text.right <= bounds.right,
        effort: effort.textContent,
      };
    });
    assert(truncation.clipped, "long toolbar model names must truncate");
    assert(truncation.fits && truncation.effort.includes("Ultra"));
    await screenshot("reasoning-long-model");
    await open();
    await option("account").click();
    await picker.waitFor({ state: "detached" });
    assert((await visibleEffort().innerText()).includes("Ultra"));
    await setEffort("自动");
    await closeCombined();
    await open();
    assert.equal(await option("account").getAttribute("aria-pressed"), "true");
    assert.equal(await option("custom").getAttribute("aria-pressed"), "false");
    const select = await changeType("account", "image");
    assert.equal(await option("account").getAttribute("aria-pressed"), "true");
    assert.equal(await option("custom").getAttribute("aria-pressed"), "false");
    await row("account")
      .getByRole("button", { name: `收藏: ${model}`, exact: true })
      .click();
    assert.equal(await option("account").getAttribute("aria-pressed"), "true");
    await select.focus();
    await page.keyboard.press("Escape");
    assert(
      await picker.isVisible(),
      "Escape closes settings before the picker",
    );
    assert.equal(await row("account").getByRole("combobox").count(), 0);
    assert(
      await adjust("account").evaluate(
        (element) => element === document.activeElement,
      ),
    );
    await adjust("account").click();
    await checkBounds();
    await screenshot("model-type-picker");
    await close();
    const imageParams = page.getByRole("button", {
      name: /^(生图参数|收起参数)$/,
    });
    await imageParams.waitFor();
    assert.equal(await visibleEffort().count(), 0);
    await imageParams.click();
    await page.getByRole("button", { name: /比例/ }).waitFor();
    await checkBounds();
    await screenshot("model-type-image-params");
    await send(
      "ACCOUNT_IMAGE_FIXTURE",
      "account",
      "/api/v1/images/generations",
    );
    await page.locator('img[alt="Generated Image"]').waitFor();

    await open();
    await changeType("account", "chat");
    await close();
    assert.equal(await imageParams.count(), 0);
    await send("ACCOUNT_CHAT_FIXTURE", "account", "/api/v1/chat/completions");
    await page.getByText("account chat fixture", { exact: true }).waitFor();
    await open();
    await adjust("custom").click();
    assert.equal(
      await row("custom")
        .getByRole("combobox", { name: "模型类型" })
        .inputValue(),
      "auto",
      "account corrections must not affect a same-name custom model",
    );
    await changeType("custom", "image");
    await adjust("account").click();
    assert.equal(
      await row("account")
        .getByRole("combobox", { name: "模型类型" })
        .inputValue(),
      "chat",
    );
    await option("custom").click();
    await picker.waitFor({ state: "detached" });
    await imageParams.waitFor();
    await send("CUSTOM_IMAGE_FIXTURE", "custom", "/v1/images/generations");
    await page.locator('img[alt="Generated Image"]').nth(1).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await imageParams.waitFor();
    await open();
    await adjust("custom").click();
    assert.equal(
      await row("custom")
        .getByRole("combobox", { name: "模型类型" })
        .inputValue(),
      "image",
      "custom corrections must survive reload",
    );
    await adjust("account").click();
    assert.equal(
      await row("account")
        .getByRole("combobox", { name: "模型类型" })
        .inputValue(),
      "chat",
      "account corrections must survive reload",
    );
    await changeType("account", "auto");
    assert.equal(
      await row("account").getByText("手动", { exact: true }).count(),
      0,
    );
    await adjust("custom").click();
    assert.equal(
      await row("custom")
        .getByRole("combobox", { name: "模型类型" })
        .inputValue(),
      "image",
    );
    await changeType("custom", "auto");
    assert.equal(
      await row("custom").getByText("手动", { exact: true }).count(),
      0,
    );
    await checkBounds();
    await screenshot("model-type-restored");
    await close();
    assert.equal(await imageParams.count(), 0);

    await setEffort("High");
    await closeCombined();
    await open();
    await changeFormat("account", "gemini");
    assert.equal(await option("custom").getAttribute("aria-pressed"), "true");
    assert.equal(await option("account").getAttribute("aria-pressed"), "false");
    await adjust("custom").click();
    assert.equal(
      await row("custom")
        .getByRole("combobox", { name: "聊天接口格式" })
        .inputValue(),
      "auto",
      "account protocol preferences must not change same-name custom models",
    );
    await changeFormat("custom", "responses");
    await option("account").click();
    await picker.waitFor({ state: "detached" });
    await open();
    await adjust("account").click();
    assert.equal(
      await row("account")
        .getByRole("combobox", { name: "聊天接口格式" })
        .inputValue(),
      "gemini",
    );
    assert.equal(await row("account").getByRole("combobox").count(), 2);
    await checkBounds();
    await screenshot("model-protocol-picker");
    await close();
    assert((await visibleEffort().innerText()).includes("High"));
    await uploadMedia();
    const accountGemini = await send(
      "ACCOUNT_GEMINI_MEDIA_FIXTURE",
      "account",
      `/api/v1beta/models/${model}:generateContent`,
    );
    checkGeminiMedia(accountGemini, "ACCOUNT_GEMINI_MEDIA_FIXTURE");
    assert.equal(
      accountGemini.body.generationConfig.thinkingConfig.thinkingLevel,
      "high",
    );
    await open();
    await option("custom").click();
    await picker.waitFor({ state: "detached" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await open();
    await adjust("custom").click();
    assert.equal(
      await row("custom")
        .getByRole("combobox", { name: "聊天接口格式" })
        .inputValue(),
      "responses",
      "custom protocol selection must survive reload",
    );
    await adjust("account").click();
    assert.equal(
      await row("account")
        .getByRole("combobox", { name: "聊天接口格式" })
        .inputValue(),
      "gemini",
      "account protocol selection must survive reload independently",
    );
    await close();
    const responseRequest = await send(
      "CUSTOM_RESPONSES_FIXTURE",
      "custom",
      "/v1/responses",
    );
    assert.equal(responseRequest.body.reasoning.effort, "high");
    assert.equal(responseRequest.body.store, false);
    assert(
      responseRequest.body.input.some((message) =>
        message.content.some(
          (part) =>
            part.type === "input_text" &&
            part.text.includes("CUSTOM_RESPONSES_FIXTURE"),
        ),
      ),
    );
    await open();
    await changeFormat("custom", "gemini");
    await close();
    assert((await visibleEffort().innerText()).includes("High"));
    await uploadMedia();
    checkGeminiMedia(
      await send(
        "CUSTOM_GEMINI_MEDIA_FIXTURE",
        "custom",
        `/v1beta/models/${model}:generateContent`,
      ),
      "CUSTOM_GEMINI_MEDIA_FIXTURE",
    );
    await open();
    await changeFormat("custom", "claude");
    await close();
    assert((await visibleEffort().innerText()).includes("High"));
    const claudeRequest = await send(
      "CUSTOM_CLAUDE_FIXTURE",
      "custom",
      "/v1/messages",
    );
    assert.equal(claudeRequest.body.output_config.effort, "high");
    assert.equal(claudeRequest.body.thinking.type, "adaptive");
    assert(!Object.hasOwn(claudeRequest.body, "temperature"));
    assert(
      claudeRequest.body.messages.some((message) =>
        message.content.some(
          (part) =>
            part.type === "text" && part.text.includes("CUSTOM_CLAUDE_FIXTURE"),
        ),
      ),
    );
    await setEffort("Ultra");
    await closeCombined();
    await uploadMedia();
    const claudeBefore = sent.length;
    await send(
      "CLAUDE_REASONING_FALLBACK_FIXTURE",
      "custom",
      "/v1/messages",
      2,
    );
    const [claudeExplicit, claudeAutomatic] = sent.slice(claudeBefore);
    assert.equal(claudeExplicit.body.output_config.effort, "ultra");
    assert(!Object.hasOwn(claudeAutomatic.body, "output_config"));
    assert(!Object.hasOwn(claudeAutomatic.body, "thinking"));
    assert.deepEqual(
      claudeAutomatic.body.messages,
      claudeExplicit.body.messages,
      "Claude fallback must preserve original material bytes",
    );
    assert((await visibleEffort().innerText()).includes("自动"));
    await open();
    await changeFormat("custom", "gemini");
    await close();
    await setEffort("Ultra");
    await closeCombined();
    await uploadMedia();
    const geminiBefore = sent.length;
    await send(
      "GEMINI_REASONING_FALLBACK_FIXTURE",
      "custom",
      `/v1beta/models/${model}:generateContent`,
      2,
    );
    const [geminiExplicit, geminiAutomatic] = sent.slice(geminiBefore);
    assert.equal(
      geminiExplicit.body.generationConfig.thinkingConfig.thinkingLevel,
      "ultra",
    );
    assert(
      !Object.hasOwn(geminiAutomatic.body.generationConfig, "thinkingConfig"),
    );
    assert.deepEqual(
      geminiAutomatic.body.contents,
      geminiExplicit.body.contents,
    );
    checkGeminiMedia(geminiAutomatic, "GEMINI_REASONING_FALLBACK_FIXTURE");
    assert((await visibleEffort().innerText()).includes("自动"));
    await open();
    await changeFormat("custom", "auto");
    await close();
    await send(
      "CUSTOM_FOLLOW_SETTINGS_FIXTURE",
      "custom",
      "/v1/chat/completions",
    );
    await open();
    await changeFormat("account", "auto");
    await option("account").click();
    await picker.waitFor({ state: "detached" });
    await send(
      "ACCOUNT_FOLLOW_SETTINGS_FIXTURE",
      "account",
      "/api/v1/chat/completions",
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        theme,
        unknownAlias: true,
        imageRequest: true,
        chatRequest: true,
        independentSources: true,
        reload: true,
        automaticRestore: true,
        selectionPreserved: true,
        keyboardAndFavorites: true,
        protocolSelectionPreserved: true,
        independentProtocols: true,
        protocolReload: true,
        geminiOriginalAudioVideo: true,
        responsesRequest: true,
        claudeRequest: true,
        followSettingsRestore: true,
        noHorizontalOverflow: true,
        combinedModelEffort: true,
        anchoredPopoverAboveToolbar: true,
        unmaskedBackground: true,
        narrow320Layout: width === 390,
        visibleMovingStars: true,
        streamingResponses: sent.filter(
          (request) =>
            request.body.stream ||
            request.path.endsWith(":streamGenerateContent"),
        ).length,
        sixReasoningLevels: true,
        continuousSliderDrag: true,
        dragEscapeCancellation: true,
        sliderKeyboardAndEndpoints: true,
        nativeReasoningAndFallback: true,
        longModelRetainsUltra: true,
        palette,
        screenshots,
        result: "passed",
      }),
    );
    return { width, theme, palette };
  } catch (error) {
    await screenshot("model-type-failure").catch(() => {});
    console.error(
      JSON.stringify({
        width,
        theme,
        sent,
        errors,
        screenshots,
        body: (await page.locator("body").innerText()).slice(-6000),
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    ignoreDefaultArgs: ["--hide-scrollbars"],
  });
  try {
    const reports = [];
    const captureWidth = Number(process.env.UI_REASONING_CAPTURE_WIDTH);
    const widths =
      captureOnly && [1440, 390].includes(captureWidth)
        ? [captureWidth]
        : [1440, 390];
    const representative =
      captureOnly && process.env.UI_REASONING_CAPTURE_REPRESENTATIVE === "1";
    for (const width of widths) {
      const themes = representative
        ? [width === 1440 ? "light" : "dark"]
        : ["light", "dark"];
      for (const theme of themes)
        reports.push(await run(browser, width, theme));
    }
    if (!representative) {
      for (const width of widths) {
        const light = reports.find(
          (report) => report.width === width && report.theme === "light",
        );
        const dark = reports.find(
          (report) => report.width === width && report.theme === "dark",
        );
        assert.notEqual(light.palette.rail, dark.palette.rail);
        assert.notEqual(light.palette.surface, dark.palette.surface);
        assert.notEqual(light.palette.foreground, dark.palette.foreground);
      }
      console.log(
        "PASS light/dark rail, surface and foreground palettes differ",
      );
    } else {
      console.log("PASS representative captures");
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
