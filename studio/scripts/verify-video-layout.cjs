// Fresh browser contexts and mocked APIs keep real accounts and requests untouched.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const {
  readVideoState,
  writeVideoState,
} = require("./verify-video-conversation.cjs");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
assert.equal(new URL(base).origin, "http://localhost:3001");

let fixtureMedia;
if (process.argv.includes("--with-result")) {
  const file = path.join(
    os.tmpdir(),
    `octopus-video-layout-${process.pid}.mp4`,
  );
  const encoded = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=720x1280:r=10",
    "-t",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-y",
    file,
  ]);
  assert.equal(encoded.status, 0, String(encoded.stderr));
  fixtureMedia = fs.readFileSync(file);
}

const parameterPanel = (page) =>
  page.getByRole("group", { name: "视频参数", exact: true });

async function openParameters(page) {
  const panel = parameterPanel(page);
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: /^视频参数：/ }).click();
  await panel.waitFor();
  return panel;
}

async function chooseParameter(page, name, label) {
  const panel = await openParameters(page);
  await panel
    .getByRole("radiogroup", { name, exact: true })
    .getByRole("radio", { name: label, exact: true })
    .check();
  assert(await panel.isVisible(), "Parameter selection keeps the panel open");
}

async function setDuration(page, seconds) {
  const panel = await openParameters(page);
  const range = panel.getByRole("slider", { name: "视频时长", exact: true });
  assert.equal(await range.getAttribute("min"), "3");
  assert.equal(await range.getAttribute("max"), "30");
  assert.equal(await range.getAttribute("step"), "1");
  await range.focus();
  await range.press("Home");
  for (let value = 3; value < seconds; value++) await range.press("ArrowRight");
  assert.equal(await range.inputValue(), String(seconds));
  assert(
    await panel.isVisible(),
    "Keyboard duration edits keep the panel open",
  );
}

async function focusedControl(page, selector) {
  await page.waitForFunction(
    (selector) => {
      const first = Array.from(document.querySelectorAll(selector)).find(
        (node) =>
          node.getClientRects().length > 0 &&
          getComputedStyle(node).visibility === "visible",
      );
      return first && first === document.activeElement;
    },
    selector,
    { timeout: 5000 },
  );
}

async function composerLayout(page, width, height, touch) {
  const layout = await page
    .locator(
      '[class*="video-workspace_video-workspace__"] [class*="input-card_"]',
    )
    .evaluate((card) => {
      const box = (node) => node?.getBoundingClientRect().toJSON();
      const toolbar = card.querySelector('[class*="composer-toolbar_"]');
      const left = toolbar.querySelector('[class*="composer-toolbar-start_"]');
      const right = toolbar.querySelector('[class*="param-bar_"]');
      const controls = [
        ...toolbar.querySelectorAll('button, summary, [role="button"]'),
      ].filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const model = controls.find((node) =>
        node.getAttribute("aria-label")?.startsWith("模型："),
      );
      return {
        card: box(card),
        input: box(card.querySelector("textarea")),
        toolbar: box(toolbar),
        cardOverflow: card.scrollWidth - card.clientWidth,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        modelText: model?.innerText.trim(),
        modelArrow: [...(model?.querySelectorAll("svg") ?? [])].some((node) => {
          const style = getComputedStyle(node);
          return (
            /chevron|capsule-arrow/i.test(node.getAttribute("class") || "") &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        }),
        controls: controls.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            name: node.getAttribute("aria-label") || node.textContent.trim(),
            side: left.contains(node)
              ? "left"
              : right.contains(node)
              ? "right"
              : "",
            hit:
              document
                .elementFromPoint(
                  rect.x + rect.width / 2,
                  rect.y + rect.height / 2,
                )
                ?.closest('button, summary, [role="button"]') === node,
            ...rect.toJSON(),
          };
        }),
      };
    });
  assert(
    layout.overflow <= 1 && layout.cardOverflow <= 1,
    "No horizontal overflow",
  );
  assert(
    layout.input.bottom <= layout.toolbar.top + 1,
    "The prompt sits above its toolbar",
  );
  assert(layout.toolbar.bottom <= layout.card.bottom + 1);
  assert(layout.card.x >= -1 && layout.card.right <= width + 1);
  assert(layout.card.y >= -1 && layout.card.bottom <= height + 1);
  assert.equal(
    layout.controls.length,
    touch ? 5 : 6,
    "The composer keeps its expected controls visible",
  );
  assert.deepEqual(
    layout.controls.map((control) => control.side),
    touch
      ? ["left", "right", "right", "right", "right"]
      : ["left", "left", "right", "right", "right", "right"],
  );
  assert(
    layout.modelText && !/^模型/.test(layout.modelText),
    "The model name has no visible prefix",
  );
  assert.equal(
    layout.modelArrow,
    false,
    "The model name has no visible chevron",
  );
  for (let index = 0; index < layout.controls.length; index++) {
    const control = layout.controls[index];
    assert(
      control.x >= -1 && control.right <= width + 1,
      `${control.name}: within viewport`,
    );
    assert(
      control.y >= layout.toolbar.y - 1 &&
        control.bottom <= layout.card.bottom + 1,
    );
    const rowStart = touch && width <= 360 && index >= 2 ? 2 : 0;
    assert(
      Math.abs(
        control.y +
          control.height / 2 -
          (layout.controls[rowStart].y + layout.controls[rowStart].height / 2),
      ) <= 1,
      `${control.name}: aligns with its toolbar row`,
    );
    assert(control.hit, `${control.name}: remains reachable`);
    if (touch) {
      assert(
        control.width >= 44 && control.height >= 44,
        `${control.name}: 44px touch target (actual ${control.width}×${control.height})`,
      );
    } else if (!control.name.startsWith("模型：")) {
      assert(
        Math.abs(control.height - 28) <= 1 &&
          (control.name.startsWith("视频参数：") ||
            Math.abs(control.width - 28) <= 1),
        `${control.name}: compact desktop control`,
      );
    }
    for (const previous of layout.controls.slice(0, index)) {
      const overlapWidth =
        Math.min(previous.right, control.right) -
        Math.max(previous.left, control.left);
      const overlapHeight =
        Math.min(previous.bottom, control.bottom) -
        Math.max(previous.top, control.top);
      assert(
        overlapWidth <= 1 || overlapHeight <= 1,
        `${previous.name} and ${control.name} do not overlap`,
      );
    }
  }
  if (touch && width <= 360)
    assert(
      layout.controls[0].bottom <= layout.controls[2].top + 1,
      "Narrow screens put parameters, settings and send on a second row",
    );
  return layout;
}

async function resultAlignment(page) {
  return page
    .locator('[class*="video-workspace_video-workspace__"]')
    .evaluate((root) => {
      const rect = (selector) =>
        root.querySelector(selector)?.getBoundingClientRect().toJSON();
      const composer = rect('[class*="_composer__"]');
      const video = rect('article[data-video-request="layout-result"] video');
      const heading = rect('[class*="response-heading_"]');
      const request = rect('[class*="request-message_"]');
      const resultArea = root.querySelector('[class*="result-area_"]');
      return {
        composer,
        video,
        heading,
        request,
        videoLeftOffset: video.left - composer.left,
        headingLeftOffset: heading.left - composer.left,
        requestRightOffset: request.right - composer.right,
        scrollbarGutter: getComputedStyle(resultArea).scrollbarGutter,
      };
    });
}

async function resultTimes(page, createdAt, completedAt) {
  const turn = page.locator('article[data-video-request="layout-result"]');
  const userTime = turn.locator(
    '[class*="request-meta_"] [class*="message-time_"]',
  );
  const modelTime = turn.locator(
    '[class*="response-heading_"] [class*="message-time_"]',
  );
  assert.equal(
    await userTime.count(),
    1,
    "The video request shows one user message time",
  );
  assert.equal(
    await modelTime.count(),
    1,
    "The video response shows one model message time",
  );
  assert.equal(
    await turn.locator('[class*="message-time_"]').count(),
    2,
    "Each side shows its timestamp once",
  );
  await page.locator('[class*="result-area_"]').evaluate((node) => {
    node.scrollTop = 0;
  });
  const times = await turn.evaluate(
    (node, timestamps) => {
      const box = (element) => element.getBoundingClientRect().toJSON();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 1 &&
          rect.height > 1 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      };
      const user = node.querySelector(
        '[class*="request-meta_"] [class*="message-time_"]',
      );
      const model = node.querySelector(
        '[class*="response-heading_"] [class*="message-time_"]',
      );
      const name = node.querySelector(
        '[class*="response-heading_"] > span:not([class*="message-time_"])',
      );
      const meta = user.parentElement;
      return {
        expected: timestamps.map((timestamp) =>
          new Date(timestamp).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
        ),
        user: {
          text: user.textContent.trim(),
          visible: visible(user),
          ...box(user),
        },
        model: {
          text: model.textContent.trim(),
          visible: visible(model),
          ...box(model),
        },
        bubble: box(node.querySelector('[class*="request-message_"]')),
        userContainer: box(node.querySelector('[class*="request-user_"]')),
        name: box(name),
        area: box(node.closest('[class*="result-area_"]')),
        otherMeta: [...meta.children]
          .filter((element) => element !== user)
          .map(box),
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    },
    [createdAt, completedAt],
  );
  assert.equal(
    times.user.text,
    times.expected[0],
    "User time matches createdAt",
  );
  assert.equal(
    times.model.text,
    times.expected[1],
    "Model time matches completedAt",
  );
  assert(
    times.user.visible && times.model.visible,
    "Both message times are visible without hover",
  );
  assert(
    times.user.top >= times.bubble.bottom - 1,
    "User time is below the request bubble",
  );
  assert(
    times.userContainer.right - times.user.right >= -1 &&
      times.userContainer.right - times.user.right <= 12,
    "User time aligns to the right",
  );
  assert(
    times.model.left >= times.name.right - 1 &&
      times.model.left - times.name.right <= 10,
    "Model time follows its model name",
  );
  assert(
    Math.abs(times.model.bottom - times.name.bottom) < 2,
    "Model name and time share a baseline",
  );
  assert(times.overflow <= 1, "Message times introduce no horizontal overflow");
  for (const rect of [times.user, times.model]) {
    assert(rect.left >= -1 && rect.right <= page.viewportSize().width + 1);
    assert(
      rect.top >= times.area.top - 1 && rect.bottom <= times.area.bottom + 1,
      "The result viewport displays both message times",
    );
  }
  for (const rect of times.otherMeta) {
    const overlapWidth =
      Math.min(rect.right, times.user.right) -
      Math.max(rect.left, times.user.left);
    const overlapHeight =
      Math.min(rect.bottom, times.user.bottom) -
      Math.max(rect.top, times.user.top);
    assert(
      overlapWidth <= 1 || overlapHeight <= 1,
      "User time does not overlap request parameters",
    );
  }
  return times;
}

async function quietEmptyState(page) {
  const hint = page.getByText("暂无视频作品", { exact: true });
  await hint.waitFor({ state: "attached" });
  assert(
    await hint.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        !node.closest('[aria-hidden="true"]') &&
        ((box.width <= 1 && box.height <= 1) || style.clipPath !== "none")
      );
    }),
    "The accessible empty hint does not occupy the center of the page",
  );
  for (const graphic of await page
    .locator('[class*="empty-state_"] svg')
    .all()) {
    const box = await graphic.boundingBox();
    assert(
      !box || box.width <= 1 || box.height <= 1,
      "The empty state has no central illustration",
    );
  }
}

async function run(
  browser,
  width,
  theme,
  reducedMotion = "no-preference",
  height = 900,
) {
  const mobile = width <= 600 || height < 500;
  const initialModel = mobile
    ? "grok-imagine-video-with-an-exceptionally-long-model-label@OpenAI"
    : "grok-imagine-video@OpenAI";
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width <= 600,
    hasTouch: mobile,
    reducedMotion,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const fixtureNow = Date.now();
  const createdAt = fixtureNow - 120000;
  const completedAt = fixtureNow - 60000;
  const errors = [];
  const writes = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ theme, initialModel, results }) => {
      localStorage.setItem("lang", "cn");
      localStorage.setItem(
        "app-config",
        JSON.stringify({
          version: 4.4,
          state: {
            theme,
            colorTheme: "violet",
            models: [
              {
                name: initialModel.split("@")[0],
                available: true,
                provider: { id: "OpenAI", providerName: "OpenAI" },
              },
            ],
          },
        }),
      );
      localStorage.setItem(
        "octopus:user-7:video-workspace-draft",
        JSON.stringify({
          model: initialModel,
          apiFormat: "xai",
          duration: 5,
          resolution: "720p",
          prompt: "海边的列车缓缓驶过，镜头跟随海浪移动",
        }),
      );
      localStorage.setItem(
        "octopus:user-7:video-workspace-results",
        JSON.stringify(results),
      );
    },
    {
      theme,
      initialModel,
      results: fixtureMedia
        ? [
            {
              id: "layout-result",
              prompt: "本地视频排版预览：海边列车缓缓驶过，镜头跟随海浪。",
              url: `${base}api/video-layout-fixture.mp4`,
              model: initialModel.split("@")[0],
              mode: "text-to-video",
              size: "720x1280",
              resolution: "720p",
              aspectRatio: "9:16",
              duration: 8,
              status: "success",
              createdAt,
              completedAt,
            },
          ]
        : [],
    },
  );
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    const name = url.pathname;
    if (!name.startsWith("/api/")) return route.continue();
    if (route.request().method() !== "GET") {
      writes.push({ method: route.request().method(), path: name });
      assert.fail(`Unexpected API write: ${name}`);
    }
    if (name.startsWith("/api/new-api/"))
      assert.equal(route.request().method(), "GET", "No account writes");
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    const session = {
      authenticated: true,
      selectedTokenId: null,
      user: { id: 7, username: "fixture", group: "default" },
    };
    if (name === "/api/new-api/bootstrap")
      return ok({
        config: { newApiEnabled: true },
        session,
      });
    if (name === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true } });
    if (name === "/api/new-api/session") return ok(session);
    if (name === "/api/new-api/status")
      return ok({ enabled: true, configured: true, quotaPerUnit: 500000 });
    if (name === "/api/video-layout-fixture.mp4")
      return route.fulfill({ contentType: "video/mp4", body: fixtureMedia });
    if (name.endsWith("/models"))
      return route.fulfill({
        json: { data: [{ id: initialModel.split("@")[0] }] },
      });
    if (name === "/api/announcement")
      return route.fulfill({ json: { announcement: null } });
    return ok([]);
  });
  try {
    await page.goto(`${base}#/video-workspace`);
    await page.getByRole("textbox", { name: "视频提示词" }).waitFor();
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => {
            const timing = animation.effect?.getTiming();
            return (
              Number(timing?.duration) < 1000 && timing?.iterations < Infinity
            );
          })
          .map((animation) => animation.finished.catch(() => {})),
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    if (fixtureMedia) {
      const video = page.locator(
        'article[data-video-request="layout-result"] video',
      );
      await video.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const video = document.querySelector(
          'article[data-video-request="layout-result"] video',
        );
        return video && video.readyState >= 2;
      });
      await video.evaluate((node) => node.play());
      await page.waitForFunction(
        () =>
          document.querySelector(
            'article[data-video-request="layout-result"] video',
          )?.currentTime > 0,
      );
      await video.evaluate((node) => node.pause());
    } else await quietEmptyState(page);
    await composerLayout(page, width, height, mobile);
    const messageTimes = fixtureMedia
      ? await resultTimes(page, createdAt, completedAt)
      : undefined;
    if (mobile) {
      await page.getByLabel("视频设置", { exact: true }).click();
      await page
        .getByRole("combobox", { name: "生成模式", exact: true })
        .click();
      await page.getByRole("option", { name: "图生视频", exact: true }).click();
      await page.getByRole("listbox").waitFor({ state: "hidden" });
      await page.keyboard.press("Escape");
      await page
        .locator('[class*="settings-panel_"]')
        .waitFor({ state: "detached" });
    } else {
      await page
        .getByRole("button", { name: /^(?:生成模式：)?文生视频$/, exact: true })
        .click();
      await focusedControl(
        page,
        '[class*="capsule-popup_"] button:not(:disabled)',
      );
      const selectedMode = page.locator(
        '[class*="capsule-popup_"] button[aria-pressed="true"]',
      );
      assert.equal(await selectedMode.count(), 1);
      assert.equal(await selectedMode.innerText(), "文生视频");
      assert(
        await selectedMode.evaluate((node) => node === document.activeElement),
      );
      assert.equal(await selectedMode.locator("svg").count(), 1);
      await page.getByRole("button", { name: "图生视频", exact: true }).click();
      await page
        .getByRole("button", { name: "生成模式：图生视频", exact: true })
        .click();
      assert.equal(await selectedMode.count(), 1);
      assert.equal(await selectedMode.innerText(), "图生视频");
      assert(
        await selectedMode.evaluate((node) => node === document.activeElement),
      );
      await selectedMode.evaluate((node) =>
        Promise.all(
          node.parentElement
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      await page.screenshot({
        path: path.join(
          os.tmpdir(),
          `octopus-video-mode-${width}-${theme}.png`,
        ),
      });
      await page.keyboard.press("Escape");
    }
    if (process.argv.includes("--composer-only")) {
      await openParameters(page);
      await page.keyboard.press("Escape");
      await parameterPanel(page).waitFor({ state: "detached" });
      const model = page.getByRole("button", { name: /^模型：/ });
      await model.click();
      const modelDialog = page.getByRole("dialog", {
        name: "选择视频模型",
        exact: true,
      });
      await modelDialog.waitFor();
      assert.equal(await model.getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Escape");
      await modelDialog.waitFor({ state: "detached" });
      assert.equal(await model.getAttribute("aria-expanded"), "false");
      if (!mobile) {
        await page.getByLabel("视频设置", { exact: true }).click();
        await page.locator('[class*="settings-panel_"]').waitFor();
        await page.keyboard.press("Escape");
        await page
          .locator('[class*="settings-panel_"]')
          .waitFor({ state: "detached" });
      }
      await composerLayout(page, width, height, mobile);
      const screenshot = path.join(
        os.tmpdir(),
        `octopus-video-composer-${width}x${height}-${theme}.png`,
      );
      await page.getByText("视频工作区", { exact: true }).click();
      await page.mouse.move(0, 0);
      const resultScreenshot = fixtureMedia
        ? path.join(
            os.tmpdir(),
            `octopus-video-times-${width}x${height}-${theme}.png`,
          )
        : undefined;
      if (resultScreenshot) {
        await resultTimes(page, createdAt, completedAt);
        await page
          .locator('[class*="result-area_"]')
          .screenshot({ path: resultScreenshot });
      }
      await page.screenshot({ path: screenshot });
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          width,
          height,
          theme,
          composer:
            "prompt above toolbar, reachable controls, quiet empty state",
          submissions: 0,
          paidRequests: 0,
          errors,
          screenshot,
          ...(fixtureMedia
            ? {
                resultAlignment: await resultAlignment(page),
                messageTimes,
                resultScreenshot,
              }
            : {}),
        }),
      );
      return;
    }
    const parameters = await openParameters(page);
    assert.deepEqual(
      await parameters
        .getByRole("radiogroup", { name: "分辨率", exact: true })
        .getByRole("radio")
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["480p", "720p", "1080p", "auto"],
    );
    assert.deepEqual(
      await parameters
        .getByRole("radiogroup", { name: "画面比例", exact: true })
        .getByRole("radio")
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["auto", "1:1", "3:4", "4:3", "16:9", "9:16", "21:9"],
    );
    await chooseParameter(page, "分辨率", "1080p");
    await chooseParameter(page, "画面比例", "16:9");
    await chooseParameter(page, "画面比例", "21:9");
    await chooseParameter(page, "画面比例", "9:16");
    await chooseParameter(page, "分辨率", "720p");
    const custom = parameters.locator("details");
    assert.equal(await custom.getAttribute("open"), null);
    await custom.getByText("自定义参数", { exact: true }).click();
    assert.equal(
      await parameters.getByLabel("视频宽度", { exact: true }).count(),
      0,
    );
    assert.equal(
      await parameters.getByLabel("视频高度", { exact: true }).count(),
      0,
    );
    if (height < 500) {
      const customDuration = parameters.getByRole("spinbutton", {
        name: "自定义视频时长",
        exact: true,
      });
      await customDuration.scrollIntoViewIfNeeded();
      const customBox = await customDuration.boundingBox();
      assert(
        customBox.y >= 0 && customBox.y + customBox.height <= height + 1,
        "Short-screen scrolling reaches the final custom field",
      );
    }
    await chooseParameter(page, "画面比例", "自动");
    await chooseParameter(page, "画面比例", "9:16");
    if (mobile) {
      const range = parameters.getByRole("slider", { name: "视频时长" });
      await range.scrollIntoViewIfNeeded();
      const rangeBox = await range.boundingBox();
      await page.touchscreen.tap(
        rangeBox.x + rangeBox.width * 0.75,
        rangeBox.y + rangeBox.height / 2,
      );
      assert(
        Number(await range.inputValue()) > 5,
        "Touch changes the duration",
      );
      assert(await parameters.isVisible());
    }
    await setDuration(page, 8);
    await custom.getByText("自定义参数", { exact: true }).click();
    await parameters
      .getByRole("radiogroup", { name: "分辨率", exact: true })
      .scrollIntoViewIfNeeded();
    const parameterBounds = await page
      .locator('[class*="capsule-popup_"]')
      .filter({ has: parameters })
      .boundingBox();
    assert(
      parameterBounds.x >= 0 &&
        parameterBounds.x + parameterBounds.width <= width &&
        parameterBounds.y >= -1 &&
        parameterBounds.y + parameterBounds.height <= height + 1,
      "Video parameters fit the viewport",
    );
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-video-parameters-${width}-${theme}.png`,
      ),
    });
    await page.keyboard.press("Escape");
    await parameters.waitFor({ state: "detached" });
    const parameterTrigger = page.getByRole("button", {
      name: /^视频参数：/,
    });
    assert.equal(await parameterTrigger.getAttribute("aria-expanded"), "false");
    assert(
      await parameterTrigger.evaluate(
        (node) => node === document.activeElement,
      ),
      "Escape restores the video parameters trigger focus",
    );
    if (process.argv.includes("--parameters-only")) {
      const draft = await readVideoState(
        page,
        "octopus:user-7:video-workspace-draft",
      );
      assert.equal(draft.duration, 8);
      assert.equal(draft.aspectRatio, "9:16");
      assert.equal(draft.resolution, "720p");
      assert.equal(draft.model, initialModel);
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          width,
          height,
          theme,
          reducedMotion,
          parameters: "choices stay open, keyboard/touch range, custom fields",
          submissions: writes.length,
          paidRequests: 0,
          errors,
        }),
      );
      return;
    }
    const settings = page.getByLabel("视频设置", { exact: true });
    await settings.click();
    const panel = page.locator('[class*="settings-panel"]');
    await panel.waitFor();
    assert.equal(
      await panel.evaluate(
        (node) => getComputedStyle(node).animationName !== "none",
      ),
      reducedMotion !== "reduce",
      "Panel entrance respects reduced motion",
    );
    await focusedControl(
      page,
      '[class*="settings-panel"] [data-select-trigger]',
    );
    assert.equal(
      await panel.getByRole("radiogroup", { name: "分辨率" }).count(),
      0,
      "The settings panel does not duplicate video parameters",
    );
    assert.equal(
      await page
        .getByRole("combobox", { name: "接口格式", exact: true })
        .count(),
      0,
    );
    const box = await panel.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width, "Settings fit viewport");
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-video-settings-${width}-${theme}.png`,
      ),
    });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    assert.equal(await page.locator("details[open]").count(), 0);
    assert.equal(await settings.getAttribute("aria-expanded"), "false");
    assert(
      await settings.evaluate((node) => node === document.activeElement),
      "Escape restores settings trigger focus",
    );
    await settings.click();
    await panel.waitFor();
    await focusedControl(
      page,
      '[class*="settings-panel"] [data-select-trigger]',
    );
    await page.keyboard.press("Tab");
    assert(
      await panel.isVisible(),
      "Tab to the next settings field keeps the panel open",
    );
    await page.getByRole("textbox", { name: "视频提示词" }).focus();
    await panel.waitFor({ state: "detached" });
    await settings.click();
    await panel.waitFor();
    await focusedControl(
      page,
      '[class*="settings-panel"] [data-select-trigger]',
    );
    await page.getByRole("textbox", { name: "视频提示词" }).click();
    await panel.waitFor({ state: "detached" });
    const key = "octopus:user-7:video-workspace-draft";
    const draft = await readVideoState(page, key);
    assert.equal(draft.duration, 8);
    assert.equal(draft.mode, "image-to-video");
    assert.equal(draft.aspectRatio, "9:16");
    assert.equal(draft.resolution, "720p");
    assert.equal(draft.apiFormat, "openai");
    assert.equal(draft.model, initialModel);
    assert.equal(
      await page.getByRole("textbox", { name: "视频提示词" }).inputValue(),
      draft.prompt,
      "Changing settings preserves the prompt draft",
    );
    const generateBox = await page
      .getByRole("button", { name: "生成视频", exact: true })
      .boundingBox();
    assert(generateBox.x >= 0 && generateBox.x + generateBox.width <= width);
    assert(generateBox.y + generateBox.height <= height);
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-video-layout-${width}-${theme}.png`,
      ),
    });
    await page
      .getByRole("button", { name: "上传参考内容" })
      .locator('input[type="file"]')
      .setInputFiles({
        name: "reference.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await page.getByRole("button", { name: "移除素材 reference.png" }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "移除素材 reference.png" })
        .count(),
      0,
    );
    await writeVideoState(page, "octopus:user-7:video-workspace-results", [
      {
        id: "sample-failed",
        url: "",
        prompt:
          "海边的列车缓缓驶过，镜头跟随海浪移动。长提示词用于检查结果卡片的双行排版和参数对齐。",
        model: "sora-2",
        mode: "text-to-video",
        aspectRatio: "9:16",
        resolution: "1080p",
        duration: 8,
        status: "failed",
        createdAt: Date.now(),
      },
    ]);
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "生成失败" }).waitFor();
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-video-results-${width}-${theme}.png`,
      ),
    });
    const failed = page.locator('article[data-video-request="sample-failed"]');
    assert.equal(await failed.locator("video").count(), 0);
    await failed.getByLabel("更多视频操作", { exact: true }).click();
    await page.getByRole("button", { name: "删除视频", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await quietEmptyState(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, [], "Parameter changes never submit a generation");
    console.log(
      JSON.stringify({
        width,
        height,
        theme,
        reducedMotion,
        parameters: "saved",
        material: "added/removed",
        errors,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        width,
        theme,
        errors,
        body: (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(-3000),
      }),
    );
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-video-failure-${width}-${theme}.png`,
      ),
    });
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({
    ...(process.env.UI_TEST_EXECUTABLE_PATH
      ? { executablePath: process.env.UI_TEST_EXECUTABLE_PATH }
      : { channel: process.env.UI_TEST_BROWSER || "msedge" }),
    headless: true,
  });
  try {
    const viewport = process.argv
      .find((argument) => argument.startsWith("--viewport="))
      ?.slice("--viewport=".length);
    if (viewport) {
      assert(/^\d+x\d+$/.test(viewport), "Use --viewport=WIDTHxHEIGHT");
      const [width, height] = viewport.split("x").map(Number);
      const theme =
        process.argv
          .find((argument) => argument.startsWith("--theme="))
          ?.slice("--theme=".length) || "light";
      await run(
        browser,
        width,
        theme,
        process.argv.includes("--reduced-motion") ? "reduce" : "no-preference",
        height,
      );
      return;
    }
    if (process.argv.includes("--smoke")) {
      await run(browser, 1440, "light");
      return;
    }
    if (process.env.UI_TEST_SCENARIO !== "reduced-motion") {
      for (const width of [1440, 768, 390, 320])
        await run(browser, width, "light");
    }
    await run(browser, 1440, "dark", "reduce");
    await run(browser, 390, "dark", "reduce");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
