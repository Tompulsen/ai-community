// Model/account responses are fixtures; this never sends a paid request.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
  "base64",
);

async function run(browser, width, model, rejected = false) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const requests = [];
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.stack || error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(base).origin) {
      failures.push({
        url: url.pathname,
        failure: request.failure()?.errorText,
      });
    }
  });
  await page.addInitScript((model) => {
    if (window.top !== window) return;
    localStorage.setItem("lang", "cn");
    const modelConfig = {
      model,
      providerName: "gpt",
      stream: true,
      sendMemory: false,
      enableInjectSystemPrompts: false,
      historyMessageCount: 20,
      max_tokens: 4000,
      template: "{{input}}",
    };
    localStorage.setItem(
      "app-config",
      JSON.stringify({
        version: 4.3,
        state: {
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
          modelConfig,
          theme: "light",
          colorTheme: "violet",
          enableAutoGenerateTitle: false,
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
              id: "images",
              topic: "图片发送测试",
              messages: [],
              memoryPrompt: "",
              stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
              lastUpdate: Date.now(),
              lastSummarizeIndex: 0,
              mask: {
                id: "fixture",
                name: "fixture",
                context: [],
                modelConfig,
                syncGlobalConfig: false,
                lang: "cn",
              },
            },
          ],
        },
      }),
    );
  }, model);
  await page.route("**/*", (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (req.headers()["next-action"])
      return route.fulfill({
        contentType: "text/x-component",
        body: '0:{"a":false,"f":[]}\n',
      });
    if (url.pathname.includes("/chat/completions")) {
      requests.push(req.postDataJSON());
      return rejected
        ? route.fulfill({
            status: 400,
            json: { error: { message: "fixture image not supported" } },
          })
        : route.fulfill({
            contentType: "text/event-stream",
            body: `data: ${JSON.stringify({
              choices: [{ delta: { content: "已收到图片" } }],
            })}\n\ndata: [DONE]\n\n`,
          });
    }
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/new-api/bootstrap")
        return route.fulfill({
          json: {
            success: true,
            data: {
              config: {
                newApiEnabled: false,
                needCode: false,
                hasModelApiKey: true,
                enableMcp: false,
              },
              session: {
                authenticated: false,
                user: null,
                selectedTokenId: null,
              },
            },
          },
        });
      if (url.pathname === "/api/config")
        return route.fulfill({
          json: {
            newApiEnabled: false,
            needCode: false,
            hasModelApiKey: true,
            enableMcp: false,
          },
        });
      if (url.pathname === "/api/new-api/status")
        return route.fulfill({
          json: { success: true, data: { enabled: false } },
        });
      return route.fulfill({ json: { data: [{ id: model }] } });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method()))
      return route.abort();
    return route.continue();
  });
  try {
    await page.goto(`${base}#/chat`);
    await page.locator("#chat-input").waitFor();
    await page.locator('input[type="file"]').last().setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.locator('[class*="attach-images_"] > div').waitFor();
    await page.locator("#chat-input").fill("这张图片是什么");
    await page.locator("#chat-input").press("Enter");
    await page.waitForFunction(() => {
      const text =
        [...document.querySelectorAll(".markdown-body")].at(-1)?.textContent ||
        "";
      return /已收到图片|fixture image not supported/.test(text);
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, model);
    if (model.startsWith("glm-")) {
      await page.getByTitle(`选择模型: ${model}`, { exact: true }).click();
      const icon = page
        .locator('[data-model-vendor="chatglm"] svg path')
        .first();
      assert((await icon.getAttribute("d")).startsWith("M12.105"));
    }
    const user = requests[0].messages
      .filter((message) => message.role === "user")
      .at(-1);
    assert(
      Array.isArray(user.content),
      `${model}: image payload became plain text`,
    );
    assert(
      user.content.some(
        (part) =>
          part.type === "image_url" &&
          part.image_url.url.startsWith("data:image/png;base64,"),
      ),
      `${model}: attachment lost`,
    );
    if (!rejected) {
      await page.locator("#chat-input").fill("继续描述");
      await page.locator("#chat-input").press("Enter");
      await page.waitForFunction(() => {
        const messages = document.querySelectorAll(".markdown-body");
        return (
          messages.length >= 4 &&
          [...messages].at(-1)?.textContent.includes("已收到图片")
        );
      });
      assert.equal(requests.length, 2);
      assert(
        requests[1].messages.some(
          (message) =>
            Array.isArray(message.content) &&
            message.content.some((part) => part.type === "image_url"),
        ),
        "History attachment lost",
      );
      await page.getByTitle("导出聊天记录", { exact: true }).click();
      const includeContext = page.getByRole("checkbox", {
        name: "包含面具上下文",
      });
      assert(await includeContext.isChecked());
      assert.deepEqual(
        await includeContext.evaluate((element) => ({
          appearance: getComputedStyle(element).appearance,
          mark: getComputedStyle(element, "::after").content,
        })),
        { appearance: "none", mark: "none" },
      );
      await includeContext.uncheck();
      assert.equal(await includeContext.isChecked(), false);
      await includeContext.check();
      const selection = page.locator(
        '[class*="modal-container"] input[type="checkbox"]',
      );
      assert(
        await selection.evaluateAll((elements) =>
          elements.every(
            (element) =>
              getComputedStyle(element, "::after").content === "none",
          ),
        ),
        "Share controls must not render checkmarks",
      );
      await page.screenshot({
        path: path.join(os.tmpdir(), `octopus-share-no-checkmark-${width}.png`),
      });
      await page.getByRole("button", { name: /2.*预览/ }).click();
      await page
        .getByRole("button", { name: "下载文件", exact: true })
        .waitFor();
    }
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-image-input-${width}.png`),
    });
    console.log(
      JSON.stringify({
        width,
        model,
        imageSent: true,
        historyImages: !rejected,
        upstreamRejectionVisible: rejected,
        generationFullyMocked: true,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        width,
        model,
        requests,
        failures,
        body: (await page.locator("body").innerText()).slice(-10000),
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) {
      await run(browser, width, "deepseek-v4.1-flash");
      await run(browser, width, "unknown-text-alias", true);
      await run(browser, width, "glm-5.3", true);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
