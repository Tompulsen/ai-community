// Local browser fixtures: every account/model request is intercepted; no paid calls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3011/studio/";
const origin = new URL(base).origin;
const output =
  process.env.UI_TEST_OUTPUT_DIR ||
  path.join(os.tmpdir(), "community-image-canvas");
fs.mkdirSync(output, { recursive: true });

async function run(browser, width, theme = "light", model = "gpt-image-2") {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    hasTouch: width < 700,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [],
    consoleErrors = [],
    requests = [];
  let source;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const pathname = url.pathname.replace(/^\/studio(?=\/)/, "");
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin !== origin) return route.abort();
    if (pathname === "/__canvas-fixture")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Canvas fixture</title>",
      });
    if (request.headers()["next-action"])
      return route.fulfill({
        contentType: "text/x-component",
        body: '0:{"a":false,"f":[]}\n',
      });
    if (pathname === "/fixture-source.png" || pathname === "/api/proxy-image")
      return route.fulfill({ contentType: "image/png", body: source });
    if (/\/images\/(edits|generations)$/.test(pathname)) {
      const contentType = request.headers()["content-type"];
      const form = await new Response(request.postDataBuffer(), {
        headers: { "content-type": contentType },
      }).formData();
      const images = [...form.entries()]
        .filter(([, value]) => typeof value !== "string")
        .map(([key, file]) => ({ key, size: file.size, type: file.type }));
      requests.push({
        images,
        prompt: form.get("prompt"),
        model: form.get("model"),
      });
      return route.fulfill({
        json: {
          created: Math.floor(Date.now() / 1000),
          data: [{ b64_json: source.toString("base64") }],
        },
      });
    }
    const config = {
      newApiEnabled: false,
      needCode: false,
      hasModelApiKey: true,
      enableMcp: false,
    };
    if (pathname === "/api/new-api/bootstrap")
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
    if (pathname === "/api/config") return route.fulfill({ json: config });
    if (pathname === "/api/new-api/status")
      return route.fulfill({
        json: { success: true, data: { enabled: false } },
      });
    if (pathname.startsWith("/api/"))
      return route.fulfill({ json: { data: [{ id: model }] } });
    if (!["GET", "HEAD"].includes(request.method())) return route.abort();
    return route.continue();
  });
  try {
    await page.goto(origin + "/__canvas-fixture");
    const placeholder = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 640;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#537a65";
      ctx.fillRect(0, 0, 960, 640);
      ctx.fillStyle = "#f4ebcd";
      ctx.font = "80px sans-serif";
      ctx.fillText("Canvas reference", 100, 330);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    source = process.env.CANVAS_FIXTURE
      ? fs.readFileSync(process.env.CANVAS_FIXTURE)
      : Buffer.from(placeholder, "base64");
    const dataUrl = "data:image/png;base64," + source.toString("base64");
    await page.evaluate(
      async ({ model, theme, origin, dataUrl }) => {
        const modelConfig = {
          model,
          providerName: "gpt",
          template: "{{input}}",
          sendMemory: false,
          enableInjectSystemPrompts: false,
          historyMessageCount: 0,
          imageRequestMode: "sync",
          imageResponseFormat: "b64_json",
          imageStream: false,
          size: "auto",
          quality: "auto",
          n: 1,
        };
        localStorage.setItem("lang", "cn");
        localStorage.setItem(
          "app-config",
          JSON.stringify({
            version: 4.3,
            state: {
              modelConfig,
              theme,
              enableAutoGenerateTitle: false,
              disablePromptHint: true,
              models: [
                {
                  name: model,
                  available: true,
                  provider: {
                    id: "gpt",
                    providerName: "gpt",
                    providerType: "custom",
                  },
                },
              ],
            },
          }),
        );
        localStorage.setItem(
          "chat-next-web-store",
          JSON.stringify({
            version: 3.4,
            state: {
              currentSessionIndex: 0,
              sessions: [
                {
                  id: "canvas-test",
                  topic: "图片画布",
                  memoryPrompt: "",
                  lastUpdate: Date.now(),
                  stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
                  mask: {
                    id: "canvas-mask",
                    name: "canvas",
                    context: [],
                    modelConfig,
                    syncGlobalConfig: false,
                    lang: "cn",
                  },
                  messages: [
                    {
                      id: "canvas-user",
                      role: "user",
                      content: "一只恐龙，电影质感",
                      date: new Date().toISOString(),
                    },
                    {
                      id: "canvas-answer",
                      role: "assistant",
                      content: `![Generated Image](${origin}/fixture-source.png)`,
                      model,
                      imageRequestDurationMs: 31000,
                      date: new Date().toISOString(),
                    },
                  ],
                },
              ],
            },
          }),
        );
        await new Promise((resolve, reject) => {
          const open = indexedDB.open("octopus-gallery", 3);
          open.onupgradeneeded = () => {
            const db = open.result,
              store = db.createObjectStore("images", { keyPath: "id" });
            store.createIndex("createdAt", "createdAt");
            store.createIndex("model", "model");
            store.createIndex("createdAtId", ["createdAt", "id"]);
            db.createObjectStore("originals");
            db.createObjectStore("settings", { keyPath: "key" });
          };
          open.onerror = () => reject(open.error);
          open.onsuccess = async () => {
            const blob = await (await fetch(dataUrl)).blob();
            const db = open.result,
              tx = db.transaction(["images", "originals"], "readwrite");
            tx.objectStore("images").put({
              id: "canvas-reference",
              prompt: "作品库参考图",
              model,
              width: 960,
              height: 640,
              createdAt: Date.now(),
              imageData: dataUrl,
              status: "success",
            });
            tx.objectStore("originals").put(blob, "canvas-reference");
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      },
      { model, theme, origin, dataUrl },
    );

    await page.goto(base + "#/chat");
    await page.locator("#chat-input").waitFor();
    const generated = page
      .getByAltText("Generated Image", { exact: true })
      .first();
    await generated.click();
    await page.getByRole("button", { name: "画布编辑", exact: true }).waitFor();
    await page.getByRole("button", { name: "放大图片", exact: true }).click();
    await page.getByTitle("重置缩放").click();
    await page.screenshot({
      animations: "disabled",
      path: path.join(output, `preview-${width}-${theme}.png`),
    });
    await page.getByRole("button", { name: "画布编辑", exact: true }).click();
    const canvas = page.getByRole("img", { name: /可编辑图片/ });
    await canvas.waitFor();
    await page
      .getByRole("button", { name: "交给 AI 修改", exact: true })
      .click();
    assert.match(
      await page.getByRole("dialog").getByRole("alert").innerText(),
      /请填写整体修改要求/,
    );
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (width >= 700) {
      await page.mouse.move(
        box.x + box.width * 0.15,
        box.y + box.height * 0.15,
      );
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width * 0.48,
        box.y + box.height * 0.48,
        { steps: 10 },
      );
      await page.mouse.up();
    } else {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: box.x + box.width * 0.15, y: box.y + box.height * 0.15 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: box.x + box.width * 0.48, y: box.y + box.height * 0.48 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
    const region = await canvas.evaluate((element) => {
      const rect = element.querySelector("g[data-annotation-id] > rect");
      return (
        rect && {
          x: Number(rect.getAttribute("x")) / element.viewBox.baseVal.width,
          y: Number(rect.getAttribute("y")) / element.viewBox.baseVal.height,
          width:
            Number(rect.getAttribute("width")) / element.viewBox.baseVal.width,
          height:
            Number(rect.getAttribute("height")) /
            element.viewBox.baseVal.height,
        }
      );
    });
    assert(region, "The drag must create a region");
    for (const [key, expected] of Object.entries({
      x: 0.15,
      y: 0.15,
      width: 0.33,
      height: 0.33,
    })) {
      assert(
        Math.abs(region[key] - expected) < 0.02,
        `Incorrect ${key} after dragging: ${JSON.stringify(region)}`,
      );
    }
    await page.getByLabel("替换成的文字", { exact: true }).fill("侏罗纪探险");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await page
      .getByRole("button", { name: "从作品库选择", exact: true })
      .click();
    await page
      .getByRole("button", { name: "选择作品：作品库参考图", exact: true })
      .click();
    await page.getByText("1 / 14", { exact: true }).waitFor();
    await page
      .getByRole("dialog")
      .locator("aside")
      .evaluate((element) => {
        element.scrollTop = 0;
      });
    await canvas.scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: "disabled",
      path: path.join(output, `canvas-overview-${width}-${theme}.png`),
    });
    const extraCount = width === 1440 && theme === "light" ? 13 : 1;
    await page
      .getByLabel("上传本地参考图", { exact: true })
      .setInputFiles(
        Array.from({ length: extraCount }, (_, index) => ({
          name: `reference-${index}.png`,
          mimeType: "image/png",
          buffer: source,
        })),
      );
    await page.getByText(`${extraCount + 1} / 14`, { exact: true }).waitFor();
    await page
      .getByLabel("整体修改要求", { exact: true })
      .fill("保持构图和背景，仅修改指定区域。");
    await page.screenshot({
      animations: "disabled",
      path: path.join(output, `canvas-${width}-${theme}.png`),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "保存标注图片", exact: true })
      .click();
    const download = await downloadPromise;
    await download.saveAs(path.join(output, `annotated-${width}-${theme}.png`));
    await page.getByRole("button", { name: "返回预览", exact: true }).click();
    await page.getByRole("button", { name: "画布编辑", exact: true }).click();
    assert.equal(
      await page.getByLabel("整体修改要求", { exact: true }).inputValue(),
      "保持构图和背景，仅修改指定区域。",
    );
    await page
      .getByRole("button", { name: "交给 AI 修改", exact: true })
      .click();
    if (model === "gpt-image-2") {
      await page
        .getByRole("dialog", { name: "图片画布", exact: true })
        .waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          document.querySelectorAll('img[alt="Generated Image"]').length >= 2,
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].images.length, extraCount + 3);
      assert(
        requests[0].images.every(
          (item) => item.size > 0 && item.type.startsWith("image/"),
        ),
      );
      assert(requests[0].prompt.includes("保持构图和背景"));
      // Composer entry and independent removal remain usable after generation.
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "composer.png",
          mimeType: "image/png",
          buffer: source,
        });
      await page
        .getByRole("button", { name: "画布编辑附件 1", exact: true })
        .dblclick();
      await canvas.waitFor();
      await page
        .getByRole("button", { name: "关闭图片预览", exact: true })
        .click();
      await page
        .getByRole("button", { name: "移除附件 1", exact: true })
        .click();
      assert.equal(await page.locator("[data-canvas-attachment]").count(), 0);
    } else {
      assert.match(
        await page.getByRole("dialog").getByRole("alert").innerText(),
        /先选择图片生成模型/,
      );
      assert.equal(requests.length, 0);
    }
    assert.deepEqual(errors, []);
    return {
      width,
      theme,
      model,
      annotations: true,
      referenceCount: extraCount + 1,
      sentImages: requests[0]?.images.length ?? 0,
      save: download.suggestedFilename(),
      errors,
      consoleErrors,
    };
  } catch (error) {
    await page.screenshot({
      animations: "disabled",
      path: path.join(output, `failure-${width}-${theme}.png`),
      fullPage: true,
    });
    fs.writeFileSync(
      path.join(output, `failure-${width}-${theme}.txt`),
      (await page.locator("body").innerText()).slice(-12000),
    );
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const reports = [];
    for (const [width, theme, model] of [
      [1440, "light", "gpt-image-2"],
      [768, "light", "gpt-image-2"],
      [390, "light", "gpt-image-2"],
      [1440, "dark", "gpt-4o"],
    ]) {
      if (
        process.env.CANVAS_TEST_WIDTH &&
        width !== Number(process.env.CANVAS_TEST_WIDTH)
      )
        continue;
      const report = await run(browser, width, theme, model);
      reports.push(report);
      console.log(JSON.stringify(report));
    }
    fs.writeFileSync(
      path.join(output, "verification.json"),
      JSON.stringify({ reports, paidCalls: 0 }, null, 2),
    );
    console.log(JSON.stringify({ reports, output, paidCalls: 0 }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
