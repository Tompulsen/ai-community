// Every generation request is intercepted; no provider request is sent.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=";

async function run(browser, width, theme) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
  });
  const page = await context.newPage();
  const requests = [];
  await page.addInitScript(
    ({ theme }) => {
      if (window !== window.top) return;
      if (localStorage.getItem("image-params-fixture")) return;
      localStorage.setItem("image-params-fixture", "1");
      localStorage.setItem("lang", "cn");
      const modelConfig = {
        model: "gpt-image-2",
        providerName: "gpt",
        size: "720x1280",
        quality: "hd",
        sendMemory: false,
        enableInjectSystemPrompts: false,
        historyMessageCount: 0,
        template: "{{input}}",
      };
      localStorage.setItem(
        "app-config",
        JSON.stringify({
          version: 4.3,
          state: {
            models: [
              {
                name: "gpt-image-2",
                available: true,
                provider: {
                  id: "gpt",
                  providerName: "gpt",
                  providerType: "custom",
                },
              },
            ],
            modelConfig,
            theme,
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
                id: "image-params",
                topic: "Image parameters",
                messages: [],
                memoryPrompt: "",
                stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
                lastUpdate: Date.now(),
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
    },
    { theme },
  );
  await context.route("**/*", (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname.endsWith("/images/generations")) {
      const payload = req.postDataJSON();
      requests.push(payload);
      if (payload.stream)
        return route.fulfill({
          contentType: "text/event-stream",
          body: [
            {
              type: "image_generation.partial_image",
              b64_json: png,
              output_format: "png",
            },
            {
              type: "image_generation.completed",
              b64_json: png,
              output_format: "png",
            },
          ]
            .map(
              (event) =>
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            )
            .join(""),
        });
      return route.fulfill({ json: { data: [{ b64_json: png }] } });
    }
    if (url.pathname.endsWith("/images/edits")) {
      requests.push({ multipart: req.postDataBuffer().toString("utf8") });
      return route.fulfill({
        json: { data: [{ url: `data:image/png;base64,${png}` }] },
      });
    }
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: {
          newApiEnabled: false,
          needCode: false,
          hasModelApiKey: true,
        },
      });
    if (url.pathname === "/api/new-api/status")
      return route.fulfill({
        json: { success: true, data: { enabled: false } },
      });
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({
        json: { data: [{ id: "gpt-image-2" }] },
      });
    return route.continue();
  });
  try {
    await page.goto(base + "#/chat");
    await page.getByRole("button", { name: "生图参数", exact: true }).click();
    const panel = page.locator('[class*="image-params-panel"]');
    const withImageSettings = async (change) => {
      await page.evaluate(() => { location.hash = "/settings"; });
      const format = page.getByRole("combobox", { name: "返回格式", exact: true });
      await format.waitFor();
      await change(format);
      await page.evaluate(() => { location.hash = "/chat"; });
      await page.getByRole("button", { name: "生图参数", exact: true }).click();
    };
    assert.match(await panel.getByLabel("请求尺寸").innerText(), /720 × 1280/);
    await panel.getByText("自动（1K）", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("button", { name: /风格/ }).count(), 0);
    await panel.getByText("限制说明", { exact: true }).click();
    await panel.getByText(/宽高均为 16 的倍数/).waitFor();
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-image-output-${width}-${theme}.png`,
      ),
    });
    await panel.getByText("限制说明", { exact: true }).click();
    assert.equal(await panel.getByRole("switch", { name: "流式生图" }).count(), 0);
    assert.equal(await panel.getByLabel("中间预览图数量").count(), 0);
    assert(
      await panel.getByRole("spinbutton", { name: "压缩设置" }).isDisabled(),
    );
    await withImageSettings(async (format) => {
      assert.equal(await format.inputValue(), "url");
      assert(!await page.getByRole("switch", { name: "流式生图" }).isChecked());
      assert(await page.getByRole("spinbutton", { name: "中间预览图数量" }).isDisabled());
    });
    assert.equal(await page.locator("#image-prompt-counter").count(), 0);
    await page.locator("#chat-input").fill("图".repeat(32000));
    assert.equal(await page.locator("#image-prompt-counter").count(), 0);
    assert(
      await page.getByRole("button", { name: "发送", exact: true }).isEnabled(),
    );
    await page.locator("#chat-input").fill("图".repeat(32001));
    await page
      .getByRole("alert")
      .filter({ hasText: "提示词超过 32,000 字符" })
      .waitFor();
    assert(
      await page
        .getByRole("button", { name: "发送", exact: true })
        .isDisabled(),
    );
    await page.locator("#chat-input").press("Enter");
    assert.equal(requests.length, 0);
    assert.equal(
      (await page.locator("#chat-input").inputValue()).length,
      32001,
    );
    await page.locator("#chat-input").fill("");
    assert.equal(await page.locator("#image-prompt-counter").count(), 0);
    assert.equal(await panel.getByRole("button", { name: /细节/ }).count(), 0);
    assert.equal(
      await panel.getByRole("button", { name: /数量|张数/ }).count(),
      0,
    );
    await panel.getByRole("button", { name: /比例/ }).click();
    const list = page.locator('[class*="image-param-selector"]');
    for (const label of [
      "1:1",
      "3:2",
      "2:3",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "21:9",
    ])
      await list.getByText(label, { exact: true }).waitFor();
    assert.equal(await page.locator('[class*="image-option-grid"]').count(), 0);
    const bounds = await list
      .locator('[class*="selector-content"]')
      .boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.waitForTimeout(450);
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-image-ratios-${width}-${theme}.png`,
      ),
    });
    await list.getByText("21:9", { exact: true }).click();
    assert.match(await panel.getByLabel("请求尺寸").innerText(), /1280 × 544/);
    await panel.getByRole("button", { name: /分辨率/ }).click();
    for (const label of ["1K", "2K", "4K"])
      await list.getByText(label, { exact: true }).waitFor();
    await list.getByText("2K", { exact: true }).click();
    assert.match(await panel.getByLabel("请求尺寸").innerText(), /2560 × 1088/);
    await panel.getByRole("button", { name: /画质/ }).click();
    for (const label of ["low", "medium", "high", "xhigh", "max"])
      await list.getByText(label, { exact: true }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-image-quality-list-${width}-${theme}.png`,
      ),
    });
    await list.getByText("xhigh", { exact: true }).click();
    await panel.getByRole("button", { name: /输出格式/ }).click();
    await list.getByText("JPEG", { exact: true }).click();
    await panel.getByRole("spinbutton", { name: "压缩设置" }).fill("75");
    await panel.getByRole("button", { name: /背景/ }).click();
    await list.getByText("不透明", { exact: true }).click();
    await page.locator("#chat-input").fill("image parameter fixture");
    await page.locator("#chat-input").press("Enter");
    await page.waitForFunction(() =>
      document.querySelector(".markdown-body img"),
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].size, "2560x1088");
    assert(!("resolution" in requests[0]));
    assert.equal(requests[0].quality, "xhigh");
    assert.equal(requests[0].n, 1);
    assert.equal(requests[0].output_format, "jpeg");
    assert.equal(requests[0].background, "opaque");
    assert.equal(requests[0].output_compression, 75);
    assert.equal(requests[0].stream, false);
    assert.equal(requests[0].response_format, "url");
    assert(!("partial_images" in requests[0]));
    assert(!("style" in requests[0]));
    assert(!JSON.stringify(requests[0]).includes("720x1280"));
    await panel.getByRole("button", { name: /比例/ }).click();
    await list.getByText("自动（推荐）", { exact: true }).click();
    await panel.getByText("自动（1:1）", { exact: true }).waitFor();
    assert.match(await panel.getByLabel("请求尺寸").innerText(), /2048 × 2048/);
    await panel.getByRole("button", { name: /背景/ }).click();
    await list.getByText("透明", { exact: true }).click();
    assert(
      await panel.getByRole("spinbutton", { name: "压缩设置" }).isDisabled(),
    );
    await panel.getByRole("button", { name: /输出格式/ }).click();
    await list.getByText("WebP", { exact: true }).click();
    await withImageSettings(async (format) => {
      await format.selectOption("b64_json");
      await page.getByRole("switch", { name: "流式生图" }).check();
      const previews = page.getByRole("spinbutton", { name: "中间预览图数量" });
      await previews.fill("0");
      assert.equal(await previews.inputValue(), "0");
      await page.reload();
      await format.waitFor();
      assert.equal(await format.inputValue(), "b64_json");
      assert(await page.getByRole("switch", { name: "流式生图" }).isChecked());
      assert.equal(await previews.inputValue(), "0");
      await format.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(os.tmpdir(),
        `octopus-image-request-settings-${width}-${theme}.png`) });
    });
    await panel.getByRole("button", { name: /分辨率/ }).click();
    await list.getByText("自动（推荐）", { exact: true }).click();
    await panel.getByRole("button", { name: /画质/ }).click();
    await list.getByText("自动（推荐）", { exact: true }).click();
    await page.locator("#chat-input").fill("automatic fixture");
    await page.locator("#chat-input").press("Enter");
    await page.waitForFunction(
      () => document.querySelectorAll(".markdown-body img").length === 2,
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[1].n, 1);
    assert.equal(requests[1].stream, true);
    assert.equal(requests[1].response_format, "b64_json");
    assert.equal(requests[1].partial_images, 0);
    assert.equal(requests[1].output_format, "webp");
    assert.equal(requests[1].background, "transparent");
    for (const field of ["size", "quality"])
      assert.equal(requests[1][field], "auto");
    assert(!("resolution" in requests[1]));
    await withImageSettings(async () => {
      await page.getByRole("spinbutton", { name: "中间预览图数量" }).fill("3");
    });
    await page
      .locator('input[type="file"]')
      .last()
      .setInputFiles([
        {
          name: "fixture.png",
          mimeType: "image/png",
          buffer: Buffer.from(png, "base64"),
        },
        {
          name: "reference.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("reuse-file-content"),
        },
      ]);
    await page.getByText("成功上传 1 张图片", { exact: true }).waitFor();
    await page.getByRole("button", { name: "移除 reference.txt" }).waitFor();
    await panel.getByRole("button", { name: /比例/ }).click();
    await list.getByText("16:9", { exact: true }).click();
    await panel.getByRole("button", { name: /分辨率/ }).click();
    await list.getByText("4K", { exact: true }).click();
    await panel.getByRole("button", { name: /画质/ }).click();
    await list.getByText("max", { exact: true }).click();
    await page.locator("#chat-input").fill("reference image fixture");
    const editRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname.endsWith("/images/edits"),
    );
    await page.locator("#chat-input").press("Enter");
    await editRequest;
    await page.waitForTimeout(150);
    assert.equal(requests.length, 3);
    for (const [key, value] of [
      ["n", "1"],
      ["size", "3840x2160"],
      ["quality", "max"],
      ["stream", "true"],
      ["partial_images", "3"],
      ["output_format", "webp"],
      ["background", "transparent"],
      ["response_format", "b64_json"],
      ["output_compression", "75"],
    ]) {
      assert(
        requests[2].multipart.includes(`name="${key}"\r\n\r\n${value}\r\n`),
      );
    }
    assert(!requests[2].multipart.includes('name="resolution"'));
    const reuse = page.getByRole("button", {
      name: "复用配置",
      exact: true,
    });
    const clickReuse = async () => {
      await reuse
        .last()
        .locator("xpath=ancestor::div[contains(@class, 'chat-message-header')]")
        .hover();
      await reuse.last().click();
    };
    await reuse.last().waitFor();
    await clickReuse();
    assert.equal(
      await page.locator("#chat-input").inputValue(),
      "reference image fixture",
    );
    await page.getByRole("button", { name: "移除 reference.txt" }).waitFor();
    assert.equal(
      await page.locator('[class*="attach-images"] > div').count(),
      1,
    );
    assert.equal(requests.length, 3, "reuse must not submit");
    await page.locator("#chat-input").fill("keep my draft");
    await clickReuse();
    await page
      .locator(".modal-mask")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    assert.equal(
      await page.locator("#chat-input").inputValue(),
      "keep my draft",
    );
    await clickReuse();
    await page
      .locator(".modal-mask")
      .getByRole("button", { name: "确认", exact: true })
      .click();
    assert.equal(
      await page.locator("#chat-input").inputValue(),
      "reference image fixture",
    );
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-reuse-${width}-${theme}.png`),
    });
    const reusedRequest = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/images/edits"),
    );
    await page.locator("#chat-input").press("Enter");
    await reusedRequest;
    assert.equal(requests.length, 4);
    assert.equal(
      requests[3].multipart.split("reuse-file-content").length - 1,
      1,
      "restored file must not be duplicated in prompt",
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll('img[alt="Generated Image"]').length === 4,
    );
    await page.evaluate(
      ({ png }) => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
              ? input.href
              : input.url;
          if (
            url.includes("/images/generations") &&
            init?.body &&
            JSON.parse(init.body).prompt === "preview-render-fixture"
          ) {
            return new Response(
              new ReadableStream({
                start(controller) {
                  const send = (type) =>
                    controller.enqueue(
                      new TextEncoder().encode(
                        `event: ${type}\ndata: ${JSON.stringify({
                          type,
                          b64_json: png,
                          output_format: "png",
                        })}\n\n`,
                      ),
                    );
                  send("image_generation.partial_image");
                  window.finishImagePreviewFixture = () => {
                    send("image_generation.completed");
                    controller.close();
                  };
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            );
          }
          return originalFetch(input, init);
        };
      },
      { png },
    );
    await page.locator("#chat-input").fill("preview-render-fixture");
    await page.locator("#chat-input").press("Enter");
    await page.locator('img[alt="生成预览"]').waitFor({ state: "visible" });
    assert.equal(await page.locator('img[alt="Generated Image"]').count(), 4);
    await page.screenshot({
      path: path.join(
        os.tmpdir(),
        `octopus-stream-preview-${width}-${theme}.png`,
      ),
    });
    await page.evaluate(() => window.finishImagePreviewFixture());
    await page.waitForFunction(
      () =>
        document.querySelectorAll('img[alt="Generated Image"]').length === 5,
    );
    assert.equal(await page.locator('img[alt="生成预览"]').count(), 0);
    assert.equal(requests.length, 4);
    console.log(
      JSON.stringify({
        width,
        theme,
        legacyMigration: true,
        ratioList: true,
        separatePayload: true,
        editsParams: true,
        auto: true,
        reuseInput: true,
        imageOutputControls: true,
        promptLimit: true,
        streamedFinalImage: true,
        livePreview: true,
        result: "passed",
      }),
    );
  } finally {
    await context.close();
  }
}
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"]) await run(browser, width, theme);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
