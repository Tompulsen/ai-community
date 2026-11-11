// Isolated fixtures: model calls are intercepted before transport.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";

function videoFixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "octopus-video-input-"));
  const file = path.join(folder, "two-scenes.mp4");
  execFileSync(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=96x64:r=6:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=96x64:r=6:d=1",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      file,
    ],
    { windowsHide: true, stdio: "pipe" },
  );
  return {
    name: "two-scenes.mp4",
    mimeType: "video/mp4",
    buffer: fs.readFileSync(file),
  };
}

async function run(browser, material, format, width, invalid = false) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    isMobile: width < 600,
    hasTouch: width < 600,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await prepare(page);
  await page.route("**/*", (route) =>
    route.request().headers()["next-action"]
      ? route.fulfill({ status: 503, body: "Fixture: MCP unavailable" })
      : route.fallback(),
  );
  await page.addInitScript((format) => {
    for (const name of ["chat-next-web-store", "app-config"]) {
      const value = JSON.parse(localStorage.getItem(name));
      if (name === "app-config") value.state.modelConfig.chatApiFormat = format;
      else
        for (const session of value.state.sessions)
          session.mask.modelConfig.chatApiFormat = format;
      localStorage.setItem(name, JSON.stringify(value));
    }
    const nativeFetch = window.fetch.bind(window);
    window.__videoInputRequests = [];
    window.fetch = async (input, init) => {
      const url = String(typeof input === "string" ? input : input.url);
      if (
        !/\/(?:chat\/completions|responses|messages|v1beta\/models\/)/.test(url)
      )
        return nativeFetch(input, init);
      window.__videoInputRequests.push(JSON.parse(init.body));
      const data =
        format === "responses"
          ? [
              {
                type: "response.output_text.delta",
                delta: "VIDEO_INPUT_VERIFIED",
              },
              { type: "response.completed", response: {} },
            ]
          : format === "claude"
          ? [
              {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "VIDEO_INPUT_VERIFIED" },
              },
              { type: "message_stop" },
            ]
          : format === "gemini"
          ? [
              {
                candidates: [
                  {
                    content: { parts: [{ text: "VIDEO_INPUT_VERIFIED" }] },
                    finishReason: "STOP",
                  },
                ],
              },
            ]
          : [{ choices: [{ delta: { content: "VIDEO_INPUT_VERIFIED" } }] }];
      return new Response(
        data.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") +
          "data: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
  }, format);
  try {
    await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    await page
      .locator('input[type="file"][aria-label="上传素材"]')
      .setInputFiles(
        invalid
          ? {
              name: "broken.mp4",
              mimeType: "video/mp4",
              buffer: Buffer.from("invalid video"),
            }
          : material,
      );
    await page.locator("#chat-input").fill("VIDEO_INPUT_QUESTION");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    if (invalid) {
      await page
        .getByText(/视频.*(?:解码|读取|处理|无法|失败)/)
        .first()
        .waitFor();
      assert.equal(
        await page.evaluate(() => window.__videoInputRequests.length),
        0,
      );
    } else {
      await page.getByText("VIDEO_INPUT_VERIFIED", { exact: true }).waitFor();
      const payload = await page.evaluate(() => window.__videoInputRequests[0]);
      const content =
        format === "gemini"
          ? payload.contents.filter((m) => m.role === "user").at(-1).parts
          : format === "responses"
          ? payload.input.filter((m) => m.role === "user").at(-1).content
          : payload.messages.filter((m) => m.role === "user").at(-1).content;
      assert.equal(
        await page.evaluate(() => window.__videoInputRequests.length),
        1,
      );
      if (format === "gemini") {
        assert(
          content.some(
            (part) =>
              part.inlineData?.mimeType === "video/mp4" &&
              part.inlineData.data === material.buffer.toString("base64"),
          ),
        );
        assert(
          !content.some((part) =>
            part.inlineData?.mimeType.startsWith("image/"),
          ),
        );
      } else {
        const images = content.flatMap((part) =>
          part.image_url
            ? [
                typeof part.image_url === "string"
                  ? part.image_url
                  : part.image_url.url,
              ]
            : part.type === "image"
            ? [`data:${part.source.media_type};base64,${part.source.data}`]
            : [],
        );
        assert(
          images.length >= 2 && images.length <= 12,
          `${format}: expected video frame images, got ${images.length}`,
        );
        assert(!JSON.stringify(content).includes("video_url"));
        assert(!JSON.stringify(content).includes("data:video/"));
        assert(
          content.some((part) => part.text && /音频|音轨/.test(part.text)),
        );
        const colors = await page.evaluate(async (images) => {
          const result = [];
          for (const url of [images[0], images.at(-1)]) {
            const bitmap = await createImageBitmap(
              await (await fetch(url)).blob(),
            );
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(bitmap, 0, 0);
            result.push([...ctx.getImageData(0, 0, 1, 1).data]);
            bitmap.close();
          }
          return result;
        }, images);
        assert(
          colors[0][0] > colors[0][2] + 100,
          "first frame must contain the red scene",
        );
        assert(
          colors[1][2] > colors[1][0] + 100,
          "last frame must contain the blue scene",
        );
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({ format, width, invalid, passed: true, mocked: true }),
    );
  } finally {
    await context.close();
  }
}

(async () => {
  const material = videoFixture();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const format of ["chat-completions", "responses", "claude", "gemini"])
      await run(browser, material, format, 1440);
    await run(browser, material, "chat-completions", 390);
    await run(browser, material, "chat-completions", 1440, true);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
