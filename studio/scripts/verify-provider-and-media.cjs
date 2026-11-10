// Requests are fully mocked. No paid request or real provider credential is used.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=";

async function run(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const selectSetting = async (control, value, label) => {
    if (await control.evaluate((element) => element.tagName === "SELECT")) {
      await control.selectOption(value);
    } else {
      const title = await control.getAttribute("aria-label");
      await control.click();
      await page
        .getByRole("dialog", { name: title, exact: true })
        .getByRole("button", { name: label, exact: true })
        .click();
    }
  };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" && errors.length < 12)
      errors.push(msg.text().slice(0, 800));
  });
  const requests = [];
  let imageReads = 0;
  let accountId = 7;
  let releaseChat;
  let replyGate = Promise.resolve();
  let modelsGate = Promise.resolve();
  await page.addInitScript(() => {
    if (localStorage.getItem("fixture-ready")) return;
    localStorage.setItem("fixture-ready", "1");
    localStorage.setItem("lang", "cn");
    const modelConfig = {
      model: "gpt-4o",
      providerName: "gpt",
      stream: true,
      sendMemory: false,
      enableInjectSystemPrompts: false,
      historyMessageCount: 10,
      size: "16:9",
      resolution: "2k",
      max_tokens: 4000,
      template: "{{input}}",
    };
    localStorage.setItem("site_access_token", "site-secret-never-forward");
    localStorage.setItem(
      "app-config",
      JSON.stringify({
        version: 4.3,
        state: {
          models: [],
          modelConfig,
          enableAutoGenerateTitle: false,
          theme: "light",
        },
      }),
    );
    localStorage.setItem(
      "octopus:user-7:chat-next-web-store",
      JSON.stringify({
        version: 3.4,
        state: {
          currentSessionIndex: 0,
          sessions: [
            {
              id: "saved-media",
              topic: "Saved image",
              memoryPrompt: "",
              lastUpdate: Date.now(),
              lastSummarizeIndex: 0,
              stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
              mask: {
                id: "fixture",
                name: "fixture",
                context: [],
                modelConfig,
                syncGlobalConfig: false,
                lang: "cn",
              },
              messages: [
                {
                  id: "prompt",
                  role: "user",
                  content: "Saved media",
                  date: new Date().toISOString(),
                },
                {
                  id: "saved-image",
                  role: "assistant",
                  content:
                    "![Generated Image](https://images.fixture.test/expired.png)",
                  model: "gpt-image-2",
                  gallerySave: "saved",
                  date: new Date().toISOString(),
                },
              ],
            },
          ],
        },
      }),
    );
  });
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.hostname === "provider.fixture.test") {
      const headers = {
        "Access-Control-Allow-Origin": new URL(base).origin,
        "Access-Control-Allow-Headers": "authorization, content-type, accept",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      };
      if (req.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      assert.equal(req.headers().authorization, "Bearer sk-fixture-custom");
      assert.equal(req.headers()["x-new-api-user"], undefined);
      assert.equal(req.headers()["x-new-api-token"], undefined);
      assert.equal(req.headers()["x-api-key"], undefined);
      assert.equal(req.headers().cookie, undefined);
      if (url.pathname === "/v1/models") {
        await modelsGate;
        return route.fulfill({
          headers,
          json: { data: [{ id: "custom-model" }] },
        });
      }
      requests.push({ path: url.pathname, body: req.postDataJSON() });
      if (url.pathname === "/v1/chat/completions") {
        await replyGate;
        return route.fulfill({
          headers,
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({
            choices: [{ delta: { content: "Custom provider connected" } }],
          })}\n\ndata: [DONE]\n\n`,
        });
      }
      if (url.pathname === "/v1/images/generations")
        return route.fulfill({ headers, json: { data: [{ b64_json: png }] } });
      if (url.pathname === "/v1/responses")
        return route.fulfill({
          headers,
          json: { output: [{ type: "image_generation_call", result: png }] },
        });
      throw new Error(`Unexpected custom endpoint ${url.pathname}`);
    }
    if (url.origin !== new URL(base).origin) {
      if (
        req.resourceType() === "image" ||
        url.hostname === "images.fixture.test"
      )
        imageReads++;
      return route.abort();
    }
    if (url.pathname === "/api/proxy-image") {
      imageReads++;
      return route.fulfill({
        status: 504,
        json: { error: "Remote unavailable" },
      });
    }
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (url.pathname === "/api/new-api/status")
      return ok({
        enabled: true,
        configured: true,
        passwordLoginEnabled: true,
      });
    if (url.pathname === "/api/new-api/session")
      return ok({
        authenticated: true,
        selectedTokenId: 100,
        user: {
          id: accountId,
          username: "fixture",
          display_name: "Fixture",
          group: "default",
          quota: 500000,
          used_quota: 0,
          request_count: 0,
        },
      });
    if (url.pathname === "/api/config") {
      assert.equal(req.headers().authorization, undefined);
      return route.fulfill({ json: { newApiEnabled: true } });
    }
    if (url.pathname === "/api/remote-models")
      return route.fulfill({ json: { data: [{ id: "gpt-4o" }] } });
    if (url.pathname === "/api/new-api/tokens")
      return ok({ items: [], total: 0, page: 1, size: 20 });
    if (url.pathname === "/api/new-api/groups") return ok([]);
    if (url.pathname === "/api/new-api/auto-groups")
      return ok({ supported: false, defaultGroups: [], maxCount: 0 });
    if (url.pathname === "/api/new-api/logs")
      return ok({ items: [], total: 0, page: 1, size: 20 });
    if (/\/(?:chat\/completions|images\/generations)/.test(url.pathname))
      throw new Error("Custom generation reached the account relay");
    return route.continue();
  });
  await page.goto(`${base}#/account`);
  try {
    await page.getByText(/账号\s*ID[:：]\s*7/).waitFor();
  } catch (error) {
    console.error({ errors, body: await page.locator("body").innerText() });
    throw error;
  }
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("octopus-gallery-user-7", 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        const images = db.createObjectStore("images", { keyPath: "id" });
        images.createIndex("createdAt", "createdAt");
        images.createIndex("model", "model");
        images.createIndex("createdAtId", ["createdAt", "id"]);
        db.createObjectStore("settings", { keyPath: "key" });
        db.createObjectStore("originals");
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["images", "originals"], "readwrite");
        const canvas = document.createElement("canvas");
        canvas.width = 480;
        canvas.height = 270;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#dcece4";
        ctx.fillRect(0, 0, 480, 270);
        ctx.fillStyle = "#243c30";
        ctx.font = "24px sans-serif";
        ctx.fillText("Local image fixture", 30, 140);
        const bytes = Uint8Array.from(
          atob(canvas.toDataURL().split(",")[1]),
          (c) => c.charCodeAt(0),
        );
        tx.objectStore("originals").put(
          new Blob([bytes], { type: "image/png" }),
          "saved-image",
        );
        tx.objectStore("images").put({
          id: "saved-image",
          prompt: "Saved",
          model: "gpt-image-2",
          createdAt: Date.now(),
          imageData: "",
          width: 480,
          height: 270,
          status: "success",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.evaluate(() => {
    if (localStorage.getItem("image-decode-tested")) return;
    const decode = HTMLImageElement.prototype.decode;
    let held = false;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (held) return;
      held = true;
      await new Promise((resolve) => {
        window.releaseFixtureImage = () => {
          localStorage.setItem("image-decode-tested", "1");
          resolve();
        };
      });
    };
  });
  await page.goto(`${base}#/chat`);
  await page.waitForFunction(
    () => typeof window.releaseFixtureImage === "function",
  );
  const imageFrame = page.locator('[class*="image-frame"]').first();
  await imageFrame.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const frame = document.querySelector('[class*="image-frame"]');
    return (
      Math.abs(
        Number(frame.style.getPropertyValue("--image-ratio")) - 480 / 270,
      ) < 0.001
    );
  });
  const imageBefore = await imageFrame.boundingBox();
  assert(imageBefore.width > 0 && imageBefore.height > 0);
  await page.evaluate(() => window.releaseFixtureImage());
  const savedImage = page.locator('img[alt="Generated Image"]').first();
  await savedImage.waitFor();
  const imageAfter = await imageFrame.boundingBox();
  assert(
    Math.abs(imageBefore.height - imageAfter.height) < 1,
    "Image reveal must preserve reserved height",
  );
  assert(
    Math.abs(imageBefore.width - imageAfter.width) < 1,
    "Image reveal must preserve reserved width",
  );
  const actionLayout = await savedImage.evaluate((image) => {
    const container = image.closest('[class*="chat-message-container"]');
    const content = container.querySelector('[class*="chat-message-item"]');
    const actions = container.querySelector('[class*="chat-message-actions"]');
    const body = content.getBoundingClientRect();
    const toolbar = actions.getBoundingClientRect();
    return {
      below: toolbar.top >= body.bottom,
      aligned: Math.abs(toolbar.left - body.left) < 1,
      inHeader: !!actions.closest('[class*="chat-message-header"]'),
      buttons: actions.querySelectorAll("button").length,
      fits: toolbar.right <= document.documentElement.clientWidth,
    };
  });
  assert.deepEqual(actionLayout, {
    below: true,
    aligned: true,
    inHeader: false,
    buttons: await page.evaluate(() =>
      window.speechSynthesis && window.SpeechSynthesisUtterance ? 6 : 5,
    ),
    fits: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await savedImage.evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await savedImage.evaluate(async (el) => {
    await Promise.all(
      el.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
  });
  assert((await savedImage.getAttribute("src")).startsWith("blob:"));
  assert.equal(imageReads, 0, "Saved images must load without remote reads");
  await page.screenshot({
    path: `${process.env.TEMP}/octopus-local-image-${width}.png`,
  });
  const originalImageUrl = await savedImage.getAttribute("src");
  const originalReadable = await page.evaluate(async (src) => {
    try {
      return (await fetch(src)).ok;
    } catch {
      return false;
    }
  }, originalImageUrl);
  await savedImage.click();
  const downloadButton = page.getByRole("button", {
    name: "下载图片",
    exact: true,
  });
  await downloadButton.waitFor();
  assert(originalReadable, "Decoded local image must remain readable");
  assert.equal(
    await savedImage.getAttribute("src"),
    originalImageUrl,
    "Opening a preview must preserve the local image URL",
  );
  const downloadBefore = await downloadButton.boundingBox();
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      if (String(args[0]).startsWith("blob:")) {
        await new Promise((resolve) => {
          window.releaseFixtureDownload = resolve;
        });
        window.fetch = original;
      }
      try {
        return await original.apply(window, args);
      } catch (error) {
        window.fixtureDownloadError = String(error);
        throw error;
      }
    };
  });
  await downloadButton.click();
  const pendingDownload = page.getByRole("button", {
    name: "正在下载",
    exact: true,
  });
  await pendingDownload.waitFor();
  assert(await pendingDownload.isDisabled());
  assert(
    Math.abs(
      (await pendingDownload.boundingBox()).width - downloadBefore.width,
    ) < 1,
  );
  const downloaded = page
    .waitForEvent("download", { timeout: 5000 })
    .catch(() => null);
  await page.evaluate(() => window.releaseFixtureDownload());
  await page.getByRole("button", { name: "下载图片", exact: true }).waitFor();
  const downloadNotice = await page
    .locator('[class*="toast"]')
    .allTextContents();
  const completedDownload = await downloaded;
  assert(
    completedDownload,
    JSON.stringify({
      downloadNotice,
      fetchError: await page.evaluate(() => window.fixtureDownloadError),
      errors: errors.slice(0, 2),
    }),
  );
  assert(completedDownload.suggestedFilename().endsWith(".png"));
  assert.equal(await completedDownload.failure(), null);
  await page.keyboard.press("Escape");
  await page.goto(`${base}#/settings`);
  const form = page.getByRole("region", { name: "模型接口配置" });
  await form.waitFor();
  assert.equal(
    await form.getByRole("button", { name: "保存并应用" }).count(),
    0,
  );
  const refreshButton = form.getByRole("button", { name: "刷新模型" });
  assert.equal((await refreshButton.innerText()).trim(), "");
  await refreshButton.scrollIntoViewIfNeeded();
  const sourceBox = await form.getByLabel("模型来源").boundingBox();
  const refreshBox = await refreshButton.boundingBox();
  assert(sourceBox && refreshBox);
  assert(
    Math.abs(
      sourceBox.y + sourceBox.height / 2 - refreshBox.y - refreshBox.height / 2,
    ) < 2,
    JSON.stringify({ width, sourceBox, refreshBox }),
  );
  assert(refreshBox.x + refreshBox.width <= width + 1);
  await form.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${process.env.TEMP}/octopus-provider-account-${width}.png`,
  });
  await page.evaluate(() => {
    window.fixtureImageStatuses = [];
    window.fixtureImageFrames = [];
    window.fixtureImageObserver = new MutationObserver(() => {
      const frame = document.querySelector('[class*="image-frame"]');
      if (!frame) return;
      if (frame.querySelector('[role="status"]'))
        window.fixtureImageStatuses.push(frame.textContent);
      const image = frame.querySelector("img");
      if (image)
        window.fixtureImageFrames.push({
          url: image.getAttribute("src"),
          ratio: frame.style.getPropertyValue("--image-ratio"),
          animation: getComputedStyle(image).animationName,
        });
    });
    window.fixtureImageObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
  await page.goto(`${base}#/chat`);
  await savedImage.waitFor();
  assert.equal(await savedImage.getAttribute("src"), originalImageUrl);
  const restored = await page.evaluate(() => {
    window.fixtureImageObserver.disconnect();
    return {
      statuses: window.fixtureImageStatuses,
      frames: window.fixtureImageFrames,
    };
  });
  assert.deepEqual(
    restored.statuses,
    [],
    "Returning must not flash a decoding placeholder",
  );
  assert(restored.frames.length > 0);
  assert(
    restored.frames.every(
      (frame) =>
        frame.url === originalImageUrl &&
        Math.abs(Number(frame.ratio) - 480 / 270) < 0.001 &&
        frame.animation === "none",
    ),
    `Returning must preserve the URL, aspect ratio and skip reveal animation: ${JSON.stringify(
      restored.frames.slice(0, 5),
    )}`,
  );
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  await page.screenshot({
    path: `${process.env.TEMP}/octopus-image-return-${width}.png`,
  });
  await page.goto(`${base}#/settings`);
  await form.waitFor();
  await selectSetting(form.getByLabel("模型来源"), "custom", "自定义接口");
  await form
    .getByLabel("API URL", { exact: true })
    .waitFor({ state: "visible" });
  assert.equal(
    await form.locator('[class*="provider-disclosure"]').getAttribute("inert"),
    null,
  );
  await selectSetting(
    form.getByLabel("模型来源"),
    "account",
    "账号密钥 · 当前分组",
  );
  assert.equal(
    await form.locator('[class*="provider-disclosure"]').getAttribute("inert"),
    "",
  );
  await form
    .getByLabel("API URL", { exact: true })
    .waitFor({ state: "hidden" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await form
      .locator('[class*="provider-disclosure"]')
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await selectSetting(form.getByLabel("模型来源"), "custom", "自定义接口");
  await form.getByLabel("配置名称", { exact: true }).fill("Fixture provider");
  await form
    .getByLabel("API URL", { exact: true })
    .fill("https://provider.fixture.test/v1");
  await form.getByLabel("API Key", { exact: true }).fill("sk-fixture-custom");
  assert.equal(
    await form.getByLabel("API Key", { exact: true }).getAttribute("type"),
    "password",
  );
  await form.getByRole("button", { name: "显示密钥" }).click();
  assert.equal(
    await form.getByLabel("API Key", { exact: true }).getAttribute("type"),
    "text",
  );
  await form.getByRole("button", { name: "隐藏密钥" }).click();
  await form
    .getByLabel("自定义模型", { exact: true })
    .fill("custom-model\nmanual-only-model");
  const fields = await form
    .locator('[class*="provider-form"]')
    .locator("input, select, textarea")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right,
      })),
    );
  assert(fields.every((field) => Math.abs(field.left - fields[0].left) < 2));
  assert(fields.every((field) => field.right <= innerWidthFixture(width)));
  function innerWidthFixture(width) {
    return width + 1;
  }
  const modelsLoaded = page.waitForResponse((res) =>
    res.url().endsWith("/v1/models"),
  );
  let releaseModels;
  modelsGate = new Promise((resolve) => {
    releaseModels = resolve;
  });
  const apply = form.getByRole("button", { name: "保存并应用" });
  const applyBefore = await apply.boundingBox();
  await apply.click();
  const busyApply = form.getByRole("button", { name: "正在保存…" });
  await busyApply.waitFor();
  assert.equal(await busyApply.getAttribute("aria-busy"), "true");
  assert(await busyApply.isDisabled());
  const applyDuring = await busyApply.boundingBox();
  assert(
    Math.abs(applyBefore.width - applyDuring.width) < 1,
    "Save must not resize while busy",
  );
  releaseModels();
  modelsGate = Promise.resolve();
  try {
    await modelsLoaded;
  } catch (error) {
    console.error({
      errors,
      form: await form.innerText(),
      profile: await page.evaluate(() =>
        localStorage.getItem("octopus:user-7:custom-provider"),
      ),
    });
    throw error;
  }
  await form
    .getByRole("button", { name: "保存并应用" })
    .waitFor({ state: "detached" });
  await form.getByRole("status").filter({ hasText: "配置已保存" }).waitFor();
  modelsGate = new Promise((resolve) => {
    releaseModels = resolve;
  });
  await form.getByRole("button", { name: "刷新模型" }).click();
  const busyRefresh = form.getByRole("button", { name: "正在刷新模型" });
  await busyRefresh.waitFor();
  assert(await busyRefresh.isDisabled());
  assert(
    Math.abs((await busyRefresh.boundingBox()).width - refreshBox.width) < 1,
  );
  const refreshed = page.waitForResponse((res) =>
    res.url().endsWith("/v1/models"),
  );
  releaseModels();
  modelsGate = Promise.resolve();
  await refreshed;
  await form.getByRole("button", { name: "刷新模型" }).waitFor();
  await page.screenshot({
    path: `${process.env.TEMP}/octopus-provider-${width}.png`,
  });
  const profile = await page.evaluate(() => ({
    scoped: localStorage.getItem("octopus:user-7:custom-provider"),
    global: localStorage.getItem("access-control"),
  }));
  assert(profile.scoped.includes("sk-fixture-custom"));
  assert(!profile.global?.includes("sk-fixture-custom"));
  const persistedAccess = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onsuccess = () => {
          const db = request.result;
          const read = db
            .transaction("keyval")
            .objectStore("keyval")
            .get("access-control");
          read.onsuccess = () => {
            resolve(read.result);
            db.close();
          };
          read.onerror = () => reject(read.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  assert(!String(persistedAccess).includes("sk-fixture-custom"));
  await page.goto(`${base}#/chat`);
  const picker = page.locator('button[title^="选择模型:"]');
  await picker.click();
  const modelPanel = page.locator('[class*="model-selector-container"]');
  await modelPanel.getByText("manual-only-model", { exact: true }).waitFor();
  await modelPanel.getByText("custom-model", { exact: true }).click();
  replyGate = new Promise((resolve) => {
    releaseChat = resolve;
  });
  await page.locator("textarea").first().fill("Custom text fixture");
  await page.locator("textarea").first().press("Enter");
  const waiting = page.locator('[data-state="thinking"]').last();
  await waiting.waitFor();
  await page.screenshot({
    path: `${process.env.TEMP}/octopus-thinking-align-${width}.png`,
  });
  const geometry = await waiting
    .locator(
      'xpath=ancestor::div[contains(@class,"chat-message-container")][1]',
    )
    .evaluate((node) => {
      const model = node.querySelector('[class*="chat-model-name"]');
      const label = node.querySelector('[class*="status-label"]');
      const bubble = node.querySelector('[data-waiting="true"]');
      const date = node.querySelector('[class*="chat-message-time"]');
      return {
        modelLeft: model.getBoundingClientRect().left,
        labelLeft: label.getBoundingClientRect().left,
        modelRight: model.getBoundingClientRect().right,
        modelBaseline: model.getBoundingClientRect().bottom,
        dateLeft: date.getBoundingClientRect().left,
        dateBaseline: date.getBoundingClientRect().bottom,
        footerCount: node.querySelectorAll(
          '[class*="chat-message-action-date"]',
        ).length,
        hiddenBubble: getComputedStyle(bubble).display === "none",
        canvases: node.querySelectorAll("canvas").length,
        nonblank: [
          ...node
            .querySelector("canvas")
            .getContext("2d")
            .getImageData(0, 0, 32, 32).data,
        ].some((x) => x > 0),
      };
    });
  assert(
    Math.abs(geometry.modelLeft - geometry.labelLeft) < 2,
    JSON.stringify(geometry),
  );
  assert(
    geometry.dateLeft >= geometry.modelRight &&
      geometry.dateLeft - geometry.modelRight <= 10 &&
      Math.abs(geometry.modelBaseline - geometry.dateBaseline) < 2 &&
      geometry.footerCount === 0,
    JSON.stringify(geometry),
  );
  assert(geometry.hiddenBubble && geometry.nonblank && geometry.canvases === 1);
  await page.screenshot({
    path: `${process.env.TEMP}/octopus-thinking-align-${width}.png`,
  });
  releaseChat();
  await page.getByText("Custom provider connected", { exact: true }).waitFor();
  for (const mode of ["images", "responses"]) {
    await page.goto(`${base}#/settings`);
    await selectSetting(
      page.getByLabel("返回格式", { exact: true }),
      "b64_json",
      "图片数据（Base64）",
    );
    await page.getByRole("switch", { name: "流式生图" }).check();
    await page.getByRole("spinbutton", { name: "中间预览图数量" }).fill("0");
    try {
      await form.getByLabel("API 接口").selectOption(mode, { timeout: 8000 });
    } catch (error) {
      console.error({
        mode,
        errors,
        body: await page.locator("body").innerText(),
        profile: await page.evaluate(() =>
          localStorage.getItem("octopus:user-7:custom-provider"),
        ),
      });
      throw error;
    }
    const refreshed = page.waitForResponse((res) =>
      res.url().endsWith("/v1/models"),
    );
    await form.getByRole("button", { name: "保存并应用" }).click();
    await refreshed;
    await page.goto(`${base}#/chat`);
    await page.locator("textarea").first().fill(`${mode} fixture`);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page
      .waitForFunction(
        (expected) =>
          document.querySelectorAll('img[alt="Generated Image"]').length >=
          expected,
        mode === "images" ? 2 : 3,
        { timeout: 10000 },
      )
      .catch(async (error) => {
        console.error({
          mode,
          requests,
          body: await page.locator("body").innerText(),
        });
        throw error;
      });
  }
  assert.deepEqual(
    requests.map((r) => r.path),
    ["/v1/chat/completions", "/v1/images/generations", "/v1/responses"],
  );
  const response = requests.at(-1).body;
  assert.equal(response.store, false);
  assert.equal(response.tools[0].type, "image_generation");
  assert.equal(requests[1].body.response_format, "b64_json");
  assert(!("response_format" in response));
  assert(!("response_format" in response.tools[0]));
  assert.equal(response.stream, true);
  assert.equal(response.tools[0].partial_images, 0);
  assert.equal(requests[1].body.size, "2560x1440");
  assert(!("resolution" in requests[1].body));
  assert.equal(response.tools[0].size, "2560x1440");
  assert(!("resolution" in response.tools[0]));
  assert.equal(response.input[0].content[0].type, "input_text");
  await page.reload();
  await page.locator('button[title^="选择模型:"]').waitFor();
  assert.equal(imageReads, 0);
  accountId = 8;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(
    () => !document.body.innerText.includes("Saved image"),
  );
  await page.goto(`${base}#/settings`);
  await selectSetting(form.getByLabel("模型来源"), "custom", "自定义接口");
  assert.equal(
    await form.getByLabel("API Key", { exact: true }).inputValue(),
    "",
  );
  console.log(
    JSON.stringify({
      width,
      localOriginalReused: true,
      customCredentialsIsolated: true,
      customTextAndImages: true,
      responsesImage: true,
      thinkingAligned: true,
      stableImageReveal: true,
      seamlessImageReturn: true,
      actionsBelowReply: true,
      stableBusyControls: true,
      accessibleDisclosure: true,
      directDownloadFeedback: true,
    }),
  );
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of process.env.UI_TEST_WIDTH
      ? [Number(process.env.UI_TEST_WIDTH)]
      : [1440, 390])
      await run(browser, width);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
