// All model/task/media APIs are intercepted. No paid requests are sent.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
  "base64",
);

async function run(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const calls = [];
  const errors = [];
  let holdVideo = true;
  let holdImage = false;
  let failedImageQueries = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (localStorage.getItem("async-fixture")) return;
    localStorage.setItem("async-fixture", "1");
    localStorage.setItem("lang", "cn");
    const modelConfig = {
      model: "gpt-image-2",
      providerName: "gpt",
      size: "auto",
      imageStream: true,
      imagePartialImages: 2,
      imageRequestMode: "sync",
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
          models: ["gpt-image-2", "sora-2", "grok-imagine-video"].map(
            (name) => ({
              name,
              available: true,
              provider: {
                id: "gpt",
                providerName: "gpt",
                providerType: "custom",
              },
            }),
          ),
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
              id: "async-images",
              topic: "Async image test",
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
  });
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === "/api/proxy-image")
      return route.fulfill({ contentType: "image/png", body: png });
    if (/^\/api\/v1\/videos\/(?:generations|vid_fixture)$/.test(url.pathname)) {
      calls.push({
        method: req.method(),
        path: url.pathname,
        json: req.method() === "POST" ? req.postDataJSON() : undefined,
      });
      return route.fulfill({
        json:
          req.method() === "POST"
            ? { request_id: "vid_fixture" }
            : holdVideo
            ? { status: "pending" }
            : {
                status: "done",
                video: {
                  url: "https://media.example.test/video-media/vid_fixture",
                },
              },
      });
    }
    if (url.pathname.startsWith("/api/async-")) {
      calls.push({
        method: req.method(),
        path: url.pathname,
        headers: req.headers(),
        body: req.postData(),
        json:
          req.headers()["content-type"]?.includes("application/json") &&
          req.postData()
            ? req.postDataJSON()
            : undefined,
      });
      const video = url.pathname.includes("async-videos");
      if (req.method() === "POST")
        return route.fulfill({
          status: 202,
          json: { id: video ? "vid_fixture" : "img_fixture", status: "queued" },
        });
      if (!video && failedImageQueries > 0) {
        failedImageQueries--;
        return route.fulfill({
          status: 502,
          headers: { "Retry-After": "1" },
          json: { error: "任务查询失败 (502)" },
        });
      }
      return route.fulfill({
        headers: { "Retry-After": "1" },
        json:
          (video && holdVideo) || (!video && holdImage)
            ? { status: "generating", progress: 42 }
            : {
                status: "succeeded",
                data: [
                  {
                    url: video
                      ? "https://media.example.test/video-media/vid_fixture"
                      : "https://media.example.test/media/img_fixture",
                  },
                ],
              },
      });
    }
    if (url.pathname === "/api/v1/images/generations") {
      calls.push({
        method: req.method(),
        path: url.pathname,
        json: req.postDataJSON(),
      });
      return route.fulfill({
        json: { data: [{ b64_json: png.toString("base64") }] },
      });
    }
    if (
      ["/api/v1/responses", "/api/v1/messages"].includes(url.pathname) ||
      url.pathname.startsWith("/api/v1beta/models/")
    ) {
      calls.push({ path: url.pathname, json: req.postDataJSON() });
      const events = url.pathname.endsWith("/responses")
        ? [
            { type: "response.output_text.delta", delta: "Native received" },
            { type: "response.completed", response: {} },
          ]
        : url.pathname.endsWith("/messages")
        ? [
            {
              type: "content_block_delta",
              delta: { type: "text_delta", text: "Native received" },
            },
            { type: "message_stop" },
          ]
        : [
            {
              candidates: [
                {
                  content: { parts: [{ text: "Native received" }] },
                  finishReason: "STOP",
                },
              ],
            },
          ];
      return route.fulfill({
        contentType: "text/event-stream",
        body: events
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      });
    }
    if (url.pathname === "/api/v1/chat/completions") {
      calls.push({ path: url.pathname, json: req.postDataJSON() });
      return route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"delta":{"content":"Materials received"}}]}\n\ndata: [DONE]\n\n',
      });
    }
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { newApiEnabled: false, needCode: false, hasModelApiKey: true },
      });
    if (url.pathname === "/api/new-api/status")
      return route.fulfill({
        json: { success: true, data: { enabled: false } },
      });
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({
        json: {
          data: [
            { id: "gpt-image-2" },
            { id: "sora-2" },
            { id: "grok-imagine-video" },
          ],
        },
      });
    if (req.headers()["next-action"])
      return route.fulfill({
        contentType: "text/x-component",
        body: '0:[false,["fixture",null]]\n',
      });
    return route.continue();
  });
  const navigate = async (hash) => {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, hash);
  };
  const selectImageMode = async (mode) => {
    if (width > 600)
      await page
        .getByRole("combobox", { name: "生图请求方式", exact: true })
        .selectOption(mode);
    else {
      await page
        .getByRole("button", { name: "生图请求方式", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "生图请求方式", exact: true })
        .getByRole("button", {
          name: mode === "async" ? "异步任务" : "同步请求",
          exact: true,
        })
        .click();
    }
  };
  try {
    await page.goto(base + "#/settings");
    await selectImageMode("async");
    assert(
      await page
        .getByRole("switch", { name: "流式生图", exact: true })
        .isDisabled(),
    );
    assert(
      !(await page
        .getByRole("switch", { name: "流式生图", exact: true })
        .isChecked()),
    );
    await page
      .getByText("生图设置", { exact: true })
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-async-settings-${width}.png`),
    });
    await navigate("/chat");
    await page.locator("#chat-input").fill("A quiet seaside");
    await page.locator("#chat-input").press("Enter");
    await page.locator('img[alt="Generated Image"]').first().waitFor();
    await page
      .getByText(/请求耗时/)
      .first()
      .waitFor();
    const imageSubmit = calls.find(
      (call) =>
        call.path === "/api/async-images/v1/tasks" && call.method === "POST",
    );
    assert(imageSubmit);
    assert.match(
      imageSubmit.headers["idempotency-key"],
      /^[A-Za-z0-9_.:-]{8,128}$/,
    );
    assert(!("stream" in imageSubmit.json));
    assert(!("partial_images" in imageSubmit.json));
    assert.equal(imageSubmit.json.n, 1);
    holdImage = true;
    await page.locator("#chat-input").fill("Recover this image after refresh");
    await page.locator("#chat-input").press("Enter");
    await page.waitForFunction(() =>
      Object.keys(localStorage).some((key) => {
        if (!key.startsWith("task:")) return false;
        const task = JSON.parse(localStorage.getItem(key));
        return (
          task.kind === "image" &&
          task.prompt === "Recover this image after refresh"
        );
      }),
    );
    holdImage = false;
    // A pending video must not block image recovery after a reload.
    await page.evaluate(() => {
      localStorage.setItem(
        "task:blocking-video",
        JSON.stringify({
          id: "blocking-video",
          kind: "video",
          protocol: "async",
          upstreamId: "vid_blocking",
          tokenId: null,
          model: "sora-2",
          prompt: "Pending video",
          createdAt: Date.now(),
        }),
      );
    });
    await page.reload();
    await page.locator('img[alt="Generated Image"]').nth(1).waitFor();
    assert.equal(await page.getByText(/请求耗时/).count(), 2);
    await page.evaluate(() => localStorage.removeItem("task:blocking-video"));
    await page.reload();
    assert.equal(
      calls.filter(
        (call) =>
          call.path === "/api/async-images/v1/tasks" && call.method === "POST",
      ).length,
      2,
    );
    let imageCount = 2;
    failedImageQueries = 3;
    await page.locator("#chat-input").fill("Resume after query failure");
    await page.locator("#chat-input").press("Enter");
    await page.getByText("HTTP 502", { exact: true }).last().waitFor();
    const submitsBeforeRetry = calls.filter(
      (call) =>
        call.method === "POST" && call.path === "/api/async-images/v1/tasks",
    ).length;
    await page
      .getByTitle("重试", { exact: true })
      .last()
      .click({ force: true });
    await page
      .locator('img[alt="Generated Image"]')
      .nth(imageCount++)
      .waitFor();
    assert.equal(
      calls.filter(
        (call) =>
          call.method === "POST" && call.path === "/api/async-images/v1/tasks",
      ).length,
      submitsBeforeRetry,
    );
    assert.equal(await page.getByText(/请求耗时/).count(), imageCount);
    if (width > 600) {
      await page.locator('input[type="file"]').last().setInputFiles({
        name: "fixture.png",
        mimeType: "image/png",
        buffer: png,
      });
      await page.getByText("成功上传 1 张图片", { exact: true }).waitFor();
      await page.locator("#chat-input").fill("Edit the reference");
      await page.locator("#chat-input").press("Enter");
      await page
        .locator('img[alt="Generated Image"]')
        .nth(imageCount++)
        .waitFor();
      const edits = calls.find(
        (call) =>
          call.path === "/api/async-images/v1/edits" && call.method === "POST",
      );
      assert(
        edits?.headers["content-type"].startsWith(
          "multipart/form-data; boundary=",
        ),
      );
      assert(!edits.body.includes('name="stream"'));
    }
    await navigate("/settings");
    await selectImageMode("sync");
    assert(
      !(await page
        .getByRole("switch", { name: "流式生图", exact: true })
        .isDisabled()),
    );
    assert(
      await page
        .getByRole("switch", { name: "流式生图", exact: true })
        .isChecked(),
    );
    await page.getByRole("switch", { name: "流式生图", exact: true }).uncheck();
    await navigate("/chat");
    await page.locator("#chat-input").fill("Synchronous image");
    await page.locator("#chat-input").press("Enter");
    await page.locator('img[alt="Generated Image"]').nth(imageCount).waitFor();
    assert(calls.some((call) => call.path === "/api/v1/images/generations"));

    await navigate("/video-workspace");
    await page.getByLabel("视频设置", { exact: true }).click();
    await page.getByRole("combobox", { name: "接口格式", exact: true }).click();
    await page.getByRole("option", { name: "xAI / Grok", exact: true }).click();
    await page.getByRole("listbox").waitFor({ state: "hidden" });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^模型：/ }).click();
    await page.getByRole("button", { name: /^grok-imagine-video/ }).click();
    await page
      .getByRole("textbox", { name: "视频提示词" })
      .fill("Waves moving slowly");
    await page.getByRole("button", { name: "生成视频", exact: true }).click();
    await page.waitForFunction(() =>
      Object.keys(localStorage).some((key) => key.startsWith("task:")),
    );
    const videoSubmit = calls.find(
      (call) =>
        call.path === "/api/v1/videos/generations" && call.method === "POST",
    );
    assert.equal(videoSubmit.json.model, "grok-imagine-video");
    assert(!("api_format" in videoSubmit.json));
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-async-video-${width}.png`),
    });
    holdVideo = false;
    await page.reload();
    await page
      .locator(
        'video[src="https://media.example.test/video-media/vid_fixture"]',
      )
      .waitFor();
    assert.equal(
      calls.filter(
        (call) =>
          call.path === "/api/v1/videos/generations" && call.method === "POST",
      ).length,
      1,
    );
    assert(
      calls.some(
        (call) =>
          call.path === "/api/v1/videos/vid_fixture" && call.method === "GET",
      ),
    );
    await navigate("/chat");
    const materials = [
      { name: "reference.png", mimeType: "image/png", buffer: png },
      {
        name: "note.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("PRIVATE_TEXT\r\n0123456789"),
      },
      {
        name: "code.ts",
        mimeType: "text/typescript",
        buffer: Buffer.from("PRIVATE_CODE\r\nexport {};"),
      },
      {
        name: "paper.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-fixture"),
      },
      {
        name: "clip.mp4",
        mimeType: "video/mp4",
        buffer: Buffer.from("video-fixture"),
      },
      {
        name: "sound.wav",
        mimeType: "audio/wav",
        buffer: Buffer.from("audio-fixture"),
      },
    ];
    await page
      .locator('input[type="file"][aria-label="上传素材"]')
      .setInputFiles(materials);
    await page.getByText("sound.wav", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-materials-${width}.png`),
    });
    await page.locator("#chat-input").fill("Check original materials");
    await page.locator("#chat-input").press("Enter");
    await page
      .getByText("Materials received", { exact: true })
      .last()
      .waitFor();
    await page
      .getByText(/note\.txt \(24 B\)/)
      .last()
      .waitFor();
    const materialCalls = () =>
      calls.filter((call) => call.path === "/api/v1/chat/completions");
    const checkMaterials = (body) => {
      const content = body.messages
        .filter((message) => message.role === "user")
        .at(-1).content;
      assert(content.some((part) => part.type === "image_url"));
      for (const material of materials.slice(1, 4)) {
        const part = content.find(
          (part) => part.file?.filename === material.name,
        );
        assert(part, material.name);
        assert.equal(
          part.file.file_data.split(",")[1],
          material.buffer.toString("base64"),
        );
      }
      assert.equal(
        content
          .find((part) => part.type === "video_url")
          .video_url.url.split(",")[1],
        materials[4].buffer.toString("base64"),
      );
      assert.deepEqual(
        content.find((part) => part.type === "input_audio").input_audio,
        { data: materials[5].buffer.toString("base64"), format: "wav" },
      );
      assert(
        !content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
          .includes("PRIVATE_"),
      );
    };
    checkMaterials(materialCalls().at(-1).json);
    await page.reload();
    await page
      .getByText("Materials received", { exact: true })
      .last()
      .waitFor();
    await page
      .getByTitle("重试", { exact: true })
      .last()
      .click({ force: true });
    await page.waitForFunction(
      () => !document.querySelector("#chat-input")?.disabled,
    );
    await page
      .getByText("Materials received", { exact: true })
      .last()
      .waitFor();
    assert.equal(materialCalls().length, 2);
    checkMaterials(materialCalls().at(-1).json);
    await page
      .getByTitle("复用配置", { exact: true })
      .last()
      .click({ force: true });
    await page.getByText("sound.wav", { exact: true }).waitFor();
    await page.locator("#chat-input").fill("");
    const materialResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/chat/completions" &&
        response.request().method() === "POST",
    );
    await page.locator("#chat-input").press("Enter");
    await materialResponse;
    await page
      .getByText("Materials received", { exact: true })
      .nth(1)
      .waitFor();
    assert.equal(materialCalls().length, 3);
    checkMaterials(materialCalls().at(-1).json);
    for (const [format, label] of [
      ["responses", "OpenAI Responses"],
      ["gemini", "Gemini"],
      ["claude", "Claude Messages"],
    ]) {
      await page.getByRole("button", { name: "对话设置", exact: true }).click();
      await page.getByRole("tab", { name: "角色与参数", exact: true }).click();
      if (width > 600) {
        await page
          .getByRole("combobox", { name: "聊天接口格式", exact: true })
          .selectOption(format);
      } else {
        await page
          .getByRole("button", { name: "聊天接口格式", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "聊天接口格式",
          exact: true,
        });
        await dialog.getByRole("button", { name: label, exact: true }).click();
      }
      await page.screenshot({
        path: path.join(
          os.tmpdir(),
          `octopus-chat-format-${format}-${width}.png`,
        ),
      });
      await page.keyboard.press("Escape");
      await page
        .locator('input[type="file"][aria-label="上传素材"]')
        .setInputFiles(materials.slice(1, 4));
      await page.getByText("paper.pdf", { exact: true }).waitFor();
      await page.locator("#chat-input").fill(`Test ${format}`);
      await page.locator("#chat-input").press("Enter");
      await page.waitForFunction(
        () => !document.querySelector("#chat-input")?.disabled,
      );
      await page.getByText("Native received", { exact: true }).last().waitFor();
      const request = calls.at(-1);
      if (format === "responses") {
        assert.equal(request.path, "/api/v1/responses");
        assert.equal(
          request.json.input
            .at(-1)
            .content.find((part) => part.filename === "note.txt")
            .file_data.split(",")[1],
          materials[1].buffer.toString("base64"),
        );
      } else if (format === "gemini") {
        assert(request.path.startsWith("/api/v1beta/models/"));
        assert(
          request.json.contents
            .at(-1)
            .parts.some(
              (part) =>
                part.inlineData?.data ===
                materials[1].buffer.toString("base64"),
            ),
        );
      } else {
        assert.equal(request.path, "/api/v1/messages");
        assert.equal(
          request.json.messages
            .at(-1)
            .content.find((part) => part.title === "note.txt").source.data,
          materials[1].buffer.toString("base64"),
        );
      }
      await page.reload();
      await page.getByText("Native received", { exact: true }).last().waitFor();
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        image: "async submit/poll; sync switch preserved",
        edits: width > 600 ? "multipart async supported" : "covered on desktop",
        video: "native submit; reload recovers via GET only",
        materials:
          "original bytes; image/document/video/audio; reload, retry, reuse and attachment-only send",
        paidRequests: 0,
      }),
    );
  } catch (error) {
    console.error("Browser errors:", errors);
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-async-failure-${width}.png`),
    });
    console.error((await page.locator("body").innerText()).slice(-5000));
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) await run(browser, width);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
