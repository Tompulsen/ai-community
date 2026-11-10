// Isolated local fixtures: never sends a request to a real model.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");

const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const results = [];
const shots = [];
const labels = ["自动", "低", "中", "高", "超高", "最高"];
const button = (page) => page.getByRole("button", { name: /^思考强度：/ });
const dialog = (page) =>
  page.getByRole("dialog", { name: "思考强度", exact: true });

async function open(browser, width, config = {}, display = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    isMobile: width < 600,
    hasTouch: width < 600,
    serviceWorkers: "block",
    reducedMotion: display.reduceMotion ? "reduce" : "no-preference",
    colorScheme: display.theme === "dark" ? "dark" : "light",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  // Preserve persisted product changes when prepare seeds its reload fixture.
  await page.addInitScript(() => {
    window.__reasoningPersisted = localStorage.getItem("__reasoningSeeded")
      ? { ...localStorage }
      : null;
  });
  await prepare(page);
  await page.addInitScript(
    ({ config, display }) => {
      if (window.__reasoningPersisted) {
        for (const [key, value] of Object.entries(window.__reasoningPersisted))
          localStorage.setItem(key, value);
      } else {
        const store = JSON.parse(localStorage.getItem("chat-next-web-store"));
        for (const session of store.state.sessions)
          Object.assign(session.mask.modelConfig, config);
        localStorage.setItem("chat-next-web-store", JSON.stringify(store));
        const app = JSON.parse(localStorage.getItem("app-config"));
        Object.assign(app.state, display);
        localStorage.setItem("app-config", JSON.stringify(app));
        localStorage.setItem("__reasoningSeeded", "1");
      }
    },
    { config, display },
  );
  await page.route("**/*", (route) => {
    const request = route.request();
    if (request.headers()["next-action"])
      return route.fulfill({ status: 503, body: "Fixture: MCP unavailable" });
    const url = new URL(request.url());
    if (url.hostname === "api.github.com")
      return route.fulfill({
        json: [
          {
            name: "fixture",
            commit: {
              sha: "fixture",
              author: { date: "2026-10-30T00:00:00Z" },
            },
          },
        ],
      });
    if (
      config.model &&
      url.origin === new URL(base).origin &&
      url.pathname.startsWith("/api/") &&
      ![
        "/api/config",
        "/api/new-api/bootstrap",
        "/api/new-api/status",
      ].includes(url.pathname)
    )
      return route.fulfill({ json: { data: [{ id: config.model }] } });
    return route.fallback();
  });
  await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
  await page.locator("#chat-input").waitFor();
  return { context, page, errors, consoleErrors };
}

async function choose(page, label) {
  await button(page).click();
  await dialog(page)
    .getByRole("button", { name: label, exact: true })
    .and(dialog(page).locator("[aria-pressed]"))
    .click();
  assert(
    await dialog(page).isVisible(),
    "Changing a level must keep the slider open",
  );
  assert.equal(
    await button(page).getAttribute("aria-label"),
    `思考强度：${label}`,
  );
  await page.keyboard.press("Escape");
  await dialog(page).waitFor({ state: "detached" });
}

async function check(name, run) {
  try {
    await run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.stack });
  }
  process.stdout.write(JSON.stringify(results.at(-1)) + "\n");
}

async function screenshot(page, name) {
  const file = path.join(os.tmpdir(), `octopus-reasoning-${name}.png`);
  await page.waitForTimeout(450);
  await page.screenshot({ path: file });
  shots.push(file);
}

function assertConsole(consoleErrors) {
  const unexpected = consoleErrors.filter(
    (text) =>
      !text.includes("503") &&
      !text.includes("MCP") &&
      !text.includes("mcp") &&
      !text.includes("Content Security Policy") &&
      !text.includes("ServiceWorker registration failed"),
  );
  assert.deepEqual(unexpected, []);
}

async function switchSession(page, topic, width) {
  if (width < 600)
    await page
      .getByRole("button", { name: "查看消息列表", exact: true })
      .click();
  await page
    .locator("[data-rfd-draggable-id]")
    .filter({ hasText: topic })
    .click();
  await page.locator("#chat-input").waitFor();
}

async function mainCase(browser, width) {
  const fixture = await open(browser, width);
  const { context, page, errors, consoleErrors } = fixture;
  try {
    await page.locator("#chat-input").fill("REASONING_DRAFT");
    await button(page).click();
    for (const label of labels)
      assert.equal(
        await dialog(page)
          .getByRole("button", { name: label, exact: true })
          .and(dialog(page).locator("[aria-pressed]"))
          .count(),
        1,
      );
    const range = dialog(page).getByRole("slider", {
      name: "思考强度",
      exact: true,
    });
    assert.equal(await range.getAttribute("min"), "0");
    assert.equal(await range.getAttribute("max"), "4");
    assert.equal(await range.getAttribute("step"), "1");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await screenshot(page, `${width}-options`);
    await page.keyboard.press("Escape");
    await dialog(page).waitFor({ state: "detached" });
    assert(
      await button(page).evaluate((node) => node === document.activeElement),
    );
    assert.equal(
      await page.locator("#chat-input").inputValue(),
      "REASONING_DRAFT",
    );
    await button(page).click();
    await page.locator(".modal-mask").click({ position: { x: 2, y: 2 } });
    await dialog(page).waitFor({ state: "detached" });
    assert(
      await button(page).evaluate((node) => node === document.activeElement),
    );
    await choose(page, "高");
    await switchSession(page, "Scroll Session B", width);
    assert.equal(
      await button(page).getAttribute("aria-label"),
      "思考强度：自动",
    );
    await switchSession(page, "Scroll Session A", width);
    assert.equal(await button(page).getAttribute("aria-label"), "思考强度：高");
    assert.equal(
      await page.locator("#chat-input").inputValue(),
      "REASONING_DRAFT",
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    assert.equal(await button(page).getAttribute("aria-label"), "思考强度：高");

    for (const [label, expected] of [
      ["最高", "max"],
      ["自动", undefined],
    ]) {
      await choose(page, label);
      const index = await page.evaluate(
        () => window.__chatScrollMock.requests.length,
      );
      await page.locator("#chat-input").fill(`REQUEST_${label}`);
      await page.locator("#chat-input").press("Enter");
      await page.waitForFunction(
        (index) => window.__chatScrollMock.requests.length > index,
        index,
      );
      const payload = await page.evaluate(
        (index) => window.__chatScrollMock.requests[index].payload,
        index,
      );
      assert.equal(payload.reasoning_effort, expected);
      if (!expected) assert(!Object.hasOwn(payload, "reasoning_effort"));
      await page.evaluate(
        (index) => window.__chatScrollMock.finish(index),
        index,
      );
    }
    await page.getByRole("button", { name: "对话设置", exact: true }).click();
    await page.getByRole("tab", { name: "角色与参数", exact: true }).click();
    assert.equal(
      await page
        .locator(".modal-mask")
        .getByText("思考强度", { exact: true })
        .count(),
      0,
    );
    await page.keyboard.press("Escape");
    await page.goto(base + "#/settings");
    const globalSelect =
      width < 600
        ? page.getByRole("button", { name: "思考强度", exact: true })
        : page.getByRole("combobox", { name: "思考强度", exact: true });
    await globalSelect.waitFor();
    if (width < 600) {
      await globalSelect.click();
      await dialog(page)
        .getByRole("button", { name: "中", exact: true })
        .click();
      assert(await dialog(page).isVisible());
      await page.keyboard.press("Escape");
    } else {
      assert.equal(await globalSelect.locator("option").count(), 6);
      await globalSelect.selectOption("medium");
    }
    if (width < 600) assert.equal(await globalSelect.innerText(), "中");
    else assert.equal(await globalSelect.inputValue(), "medium");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    assertConsole(consoleErrors);
    process.stdout.write(
      JSON.stringify({
        width,
        pageErrors: errors,
        expectedConsoleErrors: consoleErrors.length,
      }) + "\n",
    );
  } finally {
    await context.close();
  }
}

async function entryCase(browser, width, config, expected) {
  const { context, page, errors, consoleErrors } = await open(
    browser,
    width,
    config,
  );
  try {
    await page.waitForTimeout(500);
    assert.equal(await button(page).count(), expected ? 1 : 0);
    if (expected) {
      await button(page).click();
      await dialog(page)
        .getByRole("button", { name: "最高", exact: true })
        .click();
      assert(await dialog(page).isVisible());
      await page.keyboard.press("Escape");
    }
    assert.deepEqual(errors, []);
    assertConsole(consoleErrors);
    process.stdout.write(
      JSON.stringify({
        width,
        config,
        expectedConsoleErrors: consoleErrors.length,
      }) + "\n",
    );
  } finally {
    await context.close();
  }
}

async function astraCase(browser, width) {
  const { context, page, errors } = await open(browser, width, {
    model: "gpt-6-astra",
    reasoningEffort: "minimal",
  });
  try {
    assert.equal(
      await button(page).getAttribute("aria-label"),
      "思考强度：自动",
    );
    await button(page).click();
    for (const label of labels)
      assert.equal(
        await dialog(page)
          .getByRole("button", {
            name: label,
            exact: true,
          })
          .and(dialog(page).locator("[aria-pressed]"))
          .count(),
        1,
      );
    assert.equal(
      await dialog(page)
        .getByRole("slider", { name: "思考强度", exact: true })
        .count(),
      1,
    );
    await page.keyboard.press("Escape");
    await page.locator("#chat-input").fill("ASTRA_INVALID_EFFORT_FIXTURE");
    await page.locator("#chat-input").press("Enter");
    await page.waitForFunction(
      () => window.__chatScrollMock.requests.length === 1,
    );
    assert.equal(
      await page.evaluate(() =>
        Object.hasOwn(
          window.__chatScrollMock.requests[0].payload,
          "reasoning_effort",
        ),
      ),
      false,
    );
    await page.evaluate(() => window.__chatScrollMock.finish(0));
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function fallbackCase(browser, width, mode) {
  const { context, page, errors } = await open(browser, width, {
    reasoningEffort: "high",
  });
  try {
    await page.evaluate(
      ({ mode, sanitized }) => {
        const upstream = window.fetch.bind(window);
        window.__reasoningAttempts = [];
        window.fetch = async (input, init) => {
          const url = String(typeof input === "string" ? input : input.url);
          if (!url.includes("/chat/completions")) return upstream(input, init);
          const payload = JSON.parse(init?.body || "{}");
          window.__reasoningAttempts.push(payload);
          if (window.__reasoningAttempts.length === 1) {
            if (mode === "stale")
              await new Promise((resolve) => {
                window.__releaseReasoningError = resolve;
              });
            const status = mode === "rate" ? 429 : 400;
            const error =
              mode === "other"
                ? {
                    message: "Invalid value for temperature",
                    param: "temperature",
                    code: "invalid_value",
                  }
                : {
                    message: "Unsupported parameter: reasoning_effort",
                    param: "reasoning_effort",
                    code: "unsupported_parameter",
                  };
            return Response.json(
              sanitized && mode === "unsupported"
                ? {
                    error: true,
                    message: "请求失败 (400)",
                    statusCode: 400,
                    reasoningUnsupported: true,
                  }
                : { error },
              { status },
            );
          }
          return upstream(input, init);
        };
      },
      { mode, sanitized: width === 1440 },
    );
    await page.locator("#chat-input").fill(`FALLBACK_${mode}`);
    await page.locator("#chat-input").press("Enter");
    await page.waitForFunction(() => window.__reasoningAttempts.length === 1);
    if (mode === "stale") {
      await choose(page, "最高");
      await page.evaluate(() => window.__releaseReasoningError());
    }
    if (mode === "unsupported") {
      await page.waitForFunction(() => window.__reasoningAttempts.length === 2);
      await page
        .getByRole("button", { name: "思考强度：自动", exact: true })
        .waitFor();
      const attempts = await page.evaluate(() => window.__reasoningAttempts);
      assert.equal(attempts[0].reasoning_effort, "high");
      assert(!Object.hasOwn(attempts[1], "reasoning_effort"));
      await page.evaluate(() => window.__chatScrollMock.finish(0));
    } else {
      await page.waitForTimeout(600);
      assert.equal(
        await page.evaluate(() => window.__reasoningAttempts.length),
        1,
      );
      assert.equal(
        await button(page).getAttribute("aria-label"),
        mode === "stale" ? "思考强度：最高" : "思考强度：高",
      );
    }
    assert.deepEqual(errors, []);
    process.stdout.write(
      JSON.stringify({
        width,
        mode,
        attempts: await page.evaluate(() =>
          window.__reasoningAttempts.map((payload) => ({
            effort: payload.reasoning_effort ?? "omitted",
          })),
        ),
      }) + "\n",
    );
  } finally {
    await context.close();
  }
}

async function layoutCase(browser, width) {
  const { context, page, errors } = await open(browser, width);
  try {
    const effort = await button(page).boundingBox();
    const model = await page
      .getByRole("button", { name: /^选择模型:/ })
      .boundingBox();
    assert(effort.x + effort.width <= model.x + 1);
    assert(Math.abs(effort.y - model.y) <= 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await screenshot(page, `${width}-toolbar`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function sliderCase(browser, width, display) {
  const { context, page, errors, consoleErrors } = await open(
    browser,
    width,
    {},
    display,
  );
  try {
    await page.locator("#chat-input").fill("SLIDER_DRAFT");
    await button(page).click();
    const range = dialog(page).getByRole("slider", {
      name: "思考强度",
      exact: true,
    });
    await dialog(page).getByRole("button", { name: "低", exact: true }).click();
    await page.waitForTimeout(450);
    const bounds = await range.boundingBox();
    const levels = labels.slice(1);
    for (let index = 0; index < levels.length; index++) {
      const x = bounds.x + 1 + ((bounds.width - 2) * index) / 4;
      const y = bounds.y + bounds.height / 2;
      if (width < 600) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      assert.equal(await range.inputValue(), String(index));
      assert.equal(await range.getAttribute("aria-valuetext"), levels[index]);
      assert.equal(
        await button(page).getAttribute("aria-label"),
        `思考强度：${levels[index]}`,
      );
      assert.equal(
        await dialog(page)
          .getByRole("button", { name: levels[index], exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert(await dialog(page).isVisible());
    }
    await range.press("Home");
    assert.equal(await range.inputValue(), "0");
    await range.press("End");
    assert.equal(await range.inputValue(), "4");
    for (const [key, value] of [
      ["ArrowLeft", "3"],
      ["ArrowDown", "2"],
      ["ArrowRight", "3"],
      ["ArrowUp", "4"],
    ]) {
      await range.press(key);
      assert.equal(await range.inputValue(), value);
    }
    // Exercise a real pointer drag across the thumb's complete travel.
    await range.press("Home");
    await page.mouse.move(bounds.x + 8, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width - 2,
      bounds.y + bounds.height / 2,
      { steps: 16 },
    );
    await page.mouse.up();
    assert.equal(await range.inputValue(), "4");
    const auto = dialog(page).getByRole("button", {
      name: "自动",
      exact: true,
    });
    await auto.click();
    assert.equal(await auto.getAttribute("aria-pressed"), "true");
    assert.equal(
      await button(page).getAttribute("aria-label"),
      "思考强度：自动",
    );
    assert.equal(
      await range.getAttribute("aria-valuetext"),
      "自动，使用服务商默认设置",
    );
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    if (width < 600) await page.touchscreen.tap(centerX, centerY);
    else await page.mouse.click(centerX, centerY);
    assert.equal(await range.inputValue(), "2");
    assert.equal(await range.getAttribute("aria-valuetext"), "高");
    assert.equal(await button(page).getAttribute("aria-label"), "思考强度：高");
    await dialog(page)
      .getByRole("button", { name: "超高", exact: true })
      .click();
    assert.equal(await range.inputValue(), "3");
    await page.waitForTimeout(450);
    const geometry = await dialog(page).evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        controls: [
          ...node.querySelectorAll('input[type="range"], button[aria-pressed]'),
        ].map((control) => {
          const r = control.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      };
    });
    assert.equal(geometry.overflow, false);
    assert(geometry.left >= -1 && geometry.right <= geometry.width + 1);
    for (const control of geometry.controls)
      assert(
        control.left >= geometry.left - 1 &&
          control.right <= geometry.right + 1,
      );
    const tickCenters = await dialog(page).evaluate((node, levels) => {
      const rail = node
        .querySelector('input[type="range"]')
        .getBoundingClientRect();
      return levels.map((label, index) => {
        const tick = [...node.querySelectorAll("button")]
          .find((item) => item.textContent.trim() === label)
          .getBoundingClientRect();
        return {
          label,
          actual: tick.left + tick.width / 2,
          expected: rail.left + 14 + ((rail.width - 28) * index) / 4,
        };
      });
    }, levels);
    for (const tick of tickCenters)
      assert(
        Math.abs(tick.actual - tick.expected) < 1,
        `${tick.label} label must align with its native slider position`,
      );
    if (display.theme === "dark")
      assert(
        await page
          .locator("body")
          .evaluate((node) => node.classList.contains("dark")),
      );
    if (display.colorTheme)
      assert(
        await page
          .locator("body")
          .evaluate(
            (node, theme) => node.classList.contains(`theme-${theme}`),
            display.colorTheme,
          ),
      );
    if (display.reduceMotion) {
      assert(
        await page
          .locator("body")
          .evaluate((node) => node.classList.contains("reduce-motion")),
      );
      assert.equal(
        await dialog(page).evaluate(
          (node) =>
            node
              .getAnimations({ subtree: true })
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  Number(animation.effect.getComputedTiming().duration) > 1,
              ).length,
        ),
        0,
      );
    }
    await screenshot(page, `${width}-${display.theme || "light"}-slider`);
    if (width === 1440) {
      const preview = path.join(
        os.tmpdir(),
        "octopus-reasoning-slider-preview.png",
      );
      await dialog(page).screenshot({ path: preview });
      shots.push(preview);
    }
    await page.keyboard.press("Escape");
    await dialog(page).waitFor({ state: "detached" });
    assert(
      await button(page).evaluate((node) => node === document.activeElement),
    );
    assert.equal(
      await page.locator("#chat-input").inputValue(),
      "SLIDER_DRAFT",
    );
    assert.deepEqual(errors, []);
    assertConsole(consoleErrors);
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    if (process.env.UI_TEST_SCENARIO === "slider") {
      for (const [width, display] of [
        [1440, { theme: "light", colorTheme: "violet" }],
        [390, { theme: "dark", colorTheme: "emerald", reduceMotion: true }],
        [320, { theme: "light", colorTheme: "rose" }],
      ])
        await check(
          `${width}-${display.theme}-slider-pointer-keyboard-theme`,
          () => sliderCase(browser, width, display),
        );
    } else {
      for (const width of [1440, 390]) {
        if (process.env.UI_TEST_SCENARIO === "fallback") {
          for (const mode of width === 1440
            ? ["unsupported", "other", "rate", "stale"]
            : ["unsupported"])
            await check(`${width}-fallback-${mode}`, () =>
              fallbackCase(browser, width, mode),
            );
          await check(`${width}-toolbar-layout`, () =>
            layoutCase(browser, width),
          );
          continue;
        }
        await check(`${width}-interaction-isolation-persistence-payload`, () =>
          mainCase(browser, width),
        );
        await check(`${width}-astra-six-options-invalid-history`, () =>
          astraCase(browser, width),
        );
        if (process.env.UI_TEST_SCENARIO === "main") continue;
        for (const [name, config, expected] of [
          ["responses", { chatApiFormat: "responses" }, true],
          ["vision-chat", { model: "gpt-5" }, true],
          ["gemini-native", { chatApiFormat: "gemini" }, false],
          ["claude-native", { chatApiFormat: "claude" }, false],
          ["image", { model: "gpt-image-1" }, false],
          ["gemini-image", { model: "gemini-2.5-flash-image" }, false],
          ["video", { model: "sora-2" }, false],
        ])
          await check(`${width}-${name}-entry`, () =>
            entryCase(browser, width, config, expected),
          );
      }
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(
    JSON.stringify({ results, screenshots: shots, mocked: true }) + "\n",
  );
  if (results.some((result) => !result.passed)) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
