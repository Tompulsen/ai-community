// Isolated contexts intercept all APIs; no paid requests or real account writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { readVideoState } = require("./verify-video-conversation.cjs");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
assert.equal(new URL(base).origin, "http://localhost:3001");
const artifactDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "octopus-video-openai-"),
);
const clipPath = path.join(artifactDir, "fixture.mp4");
const encoded = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=red:s=64x64:r=10",
  "-t",
  "1",
  "-pix_fmt",
  "yuv420p",
  "-y",
  clipPath,
]);
assert.equal(encoded.status, 0, String(encoded.stderr));
const clip = fs.readFileSync(clipPath);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
  "base64",
);
const models = [
  "sora-2",
  "grok-imagine-video-1.5",
  "doubao-seedance-2-0-260128",
  "veo-3.1-generate-preview",
  "kling-v2.1",
];

async function choose(page, name, label) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
}

async function run(browser, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: width < 600,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [];
  const submits = [];
  const gets = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ models }) => {
      if (localStorage.getItem("video-fixture")) return;
      localStorage.setItem("video-fixture", "1");
      localStorage.setItem("lang", "cn");
      localStorage.setItem(
        "app-config",
        JSON.stringify({
          version: 4.4,
          state: {
            theme: "light",
            models: models.map((name) => ({
              name,
              available: true,
              provider: {
                id: "gpt",
                providerName: "gpt",
                providerType: "custom",
              },
            })),
          },
        }),
      );
      localStorage.setItem(
        "video-workspace-draft",
        JSON.stringify({
          apiFormat: "xai",
          model: "sora-2@gpt",
          duration: 8,
          size: "invalid stale dimensions",
        }),
      );
    },
    { models },
  );
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    const p = url.pathname;
    if (!p.startsWith("/api/")) return route.continue();
    if (p === "/api/config")
      return route.fulfill({
        json: { newApiEnabled: false, hasModelApiKey: true },
      });
    if (p === "/api/new-api/bootstrap")
      return route.fulfill({
        json: {
          success: true,
          data: {
            config: { newApiEnabled: false },
            session: { authenticated: false },
          },
        },
      });
    if (p.endsWith("/models"))
      return route.fulfill({ json: { data: models.map((id) => ({ id })) } });
    if (p === "/api/announcement")
      return route.fulfill({ json: { announcement: null } });
    if (request.method() === "POST") {
      assert.equal(
        p,
        "/api/v1/videos",
        "only OpenAI Video can create new jobs",
      );
      const type = request.headers()["content-type"];
      submits.push({
        path: p,
        type,
        body: request.postData(),
        json: type?.includes("application/json")
          ? request.postDataJSON()
          : null,
      });
      return route.fulfill({
        json: { id: `job_${submits.length}`, status: "queued" },
      });
    }
    gets.push(p);
    if (
      p.endsWith("/content") ||
      p.endsWith(":download") ||
      p === "/api/fixture.mp4"
    )
      return route.fulfill({ contentType: "video/mp4", body: clip });
    if (p.includes("/operations/"))
      return route.fulfill({
        json: {
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                {
                  video: {
                    uri: "https://generativelanguage.googleapis.com/v1beta/files/video_1:download?alt=media",
                  },
                },
              ],
            },
          },
        },
      });
    if (p.startsWith("/api/ark/"))
      return route.fulfill({
        json: {
          status: "succeeded",
          content: { video_url: `${base}api/fixture.mp4` },
        },
      });
    if (p === "/api/v1/videos/old_xai")
      return route.fulfill({
        json: {
          status: "done",
          video: { url: `${base}api/fixture.mp4` },
        },
      });
    if (p.startsWith("/api/v1/videos/"))
      return route.fulfill({ json: { status: "completed" } });
    return route.fulfill({ json: { success: true, data: [] } });
  });

  const custom = page.getByRole("textbox", {
    name: "自定义参数 JSON",
    exact: true,
  });
  async function settings() {
    await page.waitForFunction(() => {
      const workspace = document.querySelector('[class*="video-workspace_"]');
      return workspace && getComputedStyle(workspace).display === "flex";
    });
    const trigger = page.getByLabel("视频设置", { exact: true });
    if ((await trigger.getAttribute("aria-expanded")) !== "true")
      await trigger.click();
    await page.locator('[class*="settings-panel_"]').waitFor();
    const advanced = page.locator('[class*="advanced-params_"]');
    if ((await advanced.getAttribute("open")) === null)
      await advanced.locator("summary").click();
    assert.equal(
      await page
        .getByRole("combobox", { name: "接口格式", exact: true })
        .count(),
      0,
    );
  }
  async function model(name) {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^模型：/ }).click();
    await page
      .getByRole("button", {
        name: new RegExp(
          "^" + name.replaceAll(".", "\\.") + "\\s+\\((OpenAI|gpt)\\)$",
        ),
      })
      .click();
    await page
      .getByRole("dialog", { name: "选择视频模型", exact: true })
      .waitFor({ state: "hidden" });
  }
  async function mode(label) {
    if (width < 600 || height < 500) {
      await settings();
      await choose(page, "生成模式", label);
      await page.keyboard.press("Escape");
    } else {
      await page.keyboard.press("Escape");
      await page
        .locator('[class*="composer-toolbar_"]')
        .getByRole("button", {
          name: /^生成模式：(文生视频|图生视频|首尾帧|多图参考)$/,
          exact: true,
        })
        .click();
      await page
        .locator('[class*="capsule-popup_"]')
        .getByRole("button", { name: label, exact: true })
        .click();
    }
  }
  async function parameters(resolution, duration) {
    const panel = await sizeSettings();
    assert.deepEqual(
      await panel
        .getByRole("radiogroup", { name: "分辨率", exact: true })
        .getByRole("radio")
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["480p", "720p", "1080p", "auto"],
    );
    await chooseParameter("分辨率", resolution);
    assert.deepEqual(
      await panel
        .getByRole("radiogroup", { name: "画面比例", exact: true })
        .getByRole("radio")
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ["auto", "1:1", "3:4", "4:3", "16:9", "9:16", "21:9"],
    );
    await chooseParameter("画面比例", "16:9");
    await customSize();
    assert.equal(await page.getByLabel("视频宽度", { exact: true }).count(), 0);
    assert.equal(await page.getByLabel("视频高度", { exact: true }).count(), 0);
    await chooseParameter("画面比例", "自动");
    await page.waitForFunction(() => {
      const saved = JSON.parse(
        localStorage.getItem("video-workspace-draft") || "{}",
      );
      return saved.size === "auto" && saved.aspectRatio === "auto";
    });
    const saved = await readVideoState(page, "video-workspace-draft");
    assert.equal(saved.aspectRatio, "auto");
    assert.equal(saved.size, "auto");
    const beforeReload = submits.length;
    await page.reload();
    await page
      .getByRole("textbox", { name: "视频提示词", exact: true })
      .waitFor();
    await sizeSettings();
    await customSize();
    assert.equal(
      submits.length,
      beforeReload,
      "size reload never regenerates a job",
    );
    await chooseParameter("画面比例", "16:9");
    const range = panel.getByRole("slider", { name: "视频时长", exact: true });
    assert.equal(await range.getAttribute("min"), "3");
    assert.equal(await range.getAttribute("max"), "30");
    assert.equal(await range.getAttribute("step"), "1");
    if (width < 600 || height < 500) {
      await range.scrollIntoViewIfNeeded();
      const box = await range.boundingBox();
      await page.touchscreen.tap(
        box.x + box.width * 0.75,
        box.y + box.height / 2,
      );
      assert(Number(await range.inputValue()) > 3);
      assert(await panel.isVisible(), "Touch keeps video parameters open");
    }
    await range.focus();
    await range.press("Home");
    if (duration === 30) await range.press("End");
    else
      for (let value = 3; value < duration; value++)
        await range.press("ArrowRight");
    assert.equal(await range.inputValue(), String(duration));
    assert(
      await panel.isVisible(),
      "Keyboard edits keep video parameters open",
    );
    await page.keyboard.press("Escape");
  }
  async function sizeSettings() {
    const panel = page.getByRole("group", { name: "视频参数", exact: true });
    if (!(await panel.isVisible())) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^视频参数：/ }).click();
    }
    await panel.waitFor();
    return panel;
  }
  async function chooseParameter(name, label) {
    const panel = await sizeSettings();
    await panel
      .getByRole("radiogroup", { name, exact: true })
      .getByRole("radio", { name: label, exact: true })
      .check();
    assert(
      await panel.isVisible(),
      "Repeated choices keep video parameters open",
    );
  }
  async function customSize() {
    const panel = await sizeSettings();
    const details = panel.locator("details");
    if ((await details.getAttribute("open")) === null)
      await details.getByText("自定义参数", { exact: true }).click();
    return panel;
  }
  async function upload(count) {
    await page
      .getByRole("button", { name: "上传参考内容", exact: true })
      .locator('input[type="file"]')
      .setInputFiles(
        Array.from({ length: count }, (_, i) => ({
          name: `${i === 0 ? "first" : i === 1 ? "last" : `ref-${i + 1}`}.png`,
          mimeType: "image/png",
          buffer: png,
        })),
      );
    await page
      .getByRole("button", { name: "移除素材 first.png", exact: true })
      .waitFor();
    if (count === 2)
      await page
        .getByRole("button", { name: "移除素材 last.png", exact: true })
        .waitFor();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('[aria-label^="移除素材 "]').length === count,
      count,
    );
  }
  async function generate() {
    await page.keyboard.press("Escape");
    await page
      .getByRole("textbox", { name: "视频提示词", exact: true })
      .fill("Ocean waves moving slowly");
    const expected = submits.length + 1;
    await page.getByRole("button", { name: "生成视频", exact: true }).click();
    await page.waitForFunction((expected) => {
      const results = JSON.parse(
        localStorage.getItem("video-workspace-results") || "[]",
      );
      return (
        results.filter((result) => result.status === "success").length ===
        expected
      );
    }, expected);
    const turn = page.locator("article[data-video-request]").last();
    await turn.scrollIntoViewIfNeeded();
    const video = turn.locator('[class*="result-card_"] video');
    await video.scrollIntoViewIfNeeded();
    await video.evaluate(
      (video) =>
        new Promise((resolve) => {
          if (video.readyState >= 2) resolve();
          else video.addEventListener("loadeddata", resolve, { once: true });
        }),
    );
    assert.equal(
      await video.evaluate((video) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return video.videoWidth === 64 && r > 200 && g < 50 && b < 50;
      }),
      true,
      "result decodes with nonblank pixels",
    );
    return submits.at(-1);
  }
  async function layout(label) {
    const bounds = await page
      .locator('[class*="settings-panel_"]')
      .boundingBox();
    assert(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, label);
    assert(bounds.y >= 0 && bounds.y + bounds.height <= height + 1, label);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(artifactDir, `${label}-${width}x${height}.png`),
    });
  }
  try {
    await page.goto(base + "#/video-workspace");
    await page
      .getByRole("textbox", { name: "视频提示词", exact: true })
      .waitFor();
    const initialPrompt = page.getByRole("textbox", {
      name: "视频提示词",
      exact: true,
    });
    await initialPrompt.fill("Check stored parameters");
    await page.waitForFunction(() => {
      const send = document.querySelector('button[aria-label="生成视频"]');
      return send && !send.disabled;
    });
    assert.equal(
      (await readVideoState(page, "video-workspace-draft")).size,
      "invalid stale dimensions",
      "Unused saved dimensions cannot block sending",
    );
    await initialPrompt.fill("");
    if (process.argv.includes("--mentions")) {
      await model("kling-v2.1");
      await upload(10);
      const prompt = page.getByRole("textbox", {
        name: "视频提示词",
        exact: true,
      });
      const menu = page.getByRole("listbox", {
        name: "选择参考图片",
        exact: true,
      });
      await prompt.fill("让 @");
      await menu.waitFor();
      assert.equal(await menu.getByRole("option").count(), 10);
      await page.screenshot({
        path: path.join(artifactDir, `mentions-${width}x${height}.png`),
      });
      await prompt.dispatchEvent("compositionstart");
      await menu.waitFor({ state: "detached" });
      await prompt.dispatchEvent("keydown", {
        key: "Enter",
        isComposing: true,
      });
      assert.equal(await prompt.inputValue(), "让 @");
      assert.equal(
        submits.length,
        0,
        "IME confirmation cannot submit or insert a reference",
      );
      await prompt.dispatchEvent("compositionend");
      await prompt.dispatchEvent("keyup", { key: "Enter" });
      await menu.waitFor();
      await prompt.press("ArrowDown");
      await prompt.press("Enter");
      assert.equal(await prompt.inputValue(), "让 @图片2 ");
      await prompt.press("End");
      await prompt.pressSequentially("站在 @10");
      assert.equal(await menu.getByRole("option").count(), 1);
      if (width < 600) await menu.getByRole("option").tap();
      else await menu.getByRole("option").click();
      assert.equal(await prompt.inputValue(), "让 @图片2 站在 @图片10 ");
      await prompt.pressSequentially("后方");
      await page
        .getByRole("button", { name: "移除素材 first.png", exact: true })
        .click();
      assert.equal(await prompt.inputValue(), "让 @图片1 站在 @图片9 后方");
      await page.reload();
      await prompt.waitFor();
      await page.waitForFunction(() =>
        document
          .querySelector('textarea[aria-label="视频提示词"]')
          ?.value.includes("@图片9"),
      );
      assert.equal(await prompt.inputValue(), "让 @图片1 站在 @图片9 后方");
      await page
        .getByRole("button", { name: "移除素材 last.png", exact: true })
        .click();
      assert.equal(
        await prompt.inputValue(),
        "让 [已移除图片] 站在 @图片8 后方",
      );
      await prompt.press("End");
      await prompt.pressSequentially(" @");
      await menu.waitFor();
      await prompt.press("Escape");
      await menu.waitFor({ state: "detached" });
      await prompt.fill("使用 @图片8 的灯光");
      await prompt.press("Shift+Enter");
      assert.equal(submits.length, 0, "Shift+Enter only adds a newline");
      assert.equal(await prompt.inputValue(), "使用 @图片8 的灯光\n");
      await prompt.press("Enter");
      await page.waitForFunction(() =>
        JSON.parse(
          localStorage.getItem("video-workspace-results") || "[]",
        ).some((item) => item.status === "success"),
      );
      assert.equal(submits.length, 1);
      assert.equal(submits[0].json.prompt, "使用 @图片8 的灯光\n");
      assert.equal(submits[0].json.images.length, 8);
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          width,
          height,
          mentions:
            "keyboard, click, image ten, deletion, reload and outgoing prompt",
          paidRequests: 0,
          errors,
        }),
      );
      return;
    }
    if (process.argv.includes("--uploads")) {
      await model("kling-v2.1");
      await mode("文生视频");
      await upload(1);
      await page
        .getByRole("button", { name: "上传参考内容", exact: true })
        .locator('input[type="file"]')
        .setInputFiles({
          name: "last.png",
          mimeType: "image/png",
          buffer: png,
        });
      await page
        .getByRole("button", { name: "移除素材 last.png", exact: true })
        .waitFor();
      const added = (await generate()).json;
      assert.equal(
        added.images.length,
        2,
        "adding a second image from single-image mode works",
      );
      assert.equal(added.metadata.reference_images.length, 2);
      await mode("文生视频");
      await upload(10);
      await page
        .getByRole("button", { name: "上传参考内容", exact: true })
        .locator('input[type="file"]')
        .setInputFiles({
          name: "overflow.png",
          mimeType: "image/png",
          buffer: png,
        });
      await page.getByText("最多使用 10 张参考图", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "移除素材 overflow.png", exact: true })
          .count(),
        0,
      );
      await settings();
      await layout("uploads");
      const batch = (await generate()).json;
      assert.equal(
        batch.images.length,
        10,
        "ten selected images are all included",
      );
      assert.equal(batch.metadata.reference_images.length, 10);
      for (const name of ["sora-2", "veo-3.1-generate-preview"]) {
        await model(name);
        await mode("文生视频");
        await upload(2);
        const sent = (await generate()).json;
        assert.equal(
          sent.images.length,
          2,
          `${name} is not blocked by a local model limit`,
        );
      }
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          width,
          height,
          uploads: "append, batch ten, overflow",
          modelLimits: false,
          paidRequests: 0,
          errors,
        }),
      );
      return;
    }
    if (
      process.argv.includes("--smoke") ||
      process.argv.includes("--parameters")
    ) {
      await parameters("720p", 8);
      const panel = await sizeSettings();
      await chooseParameter("分辨率", "1080p");
      await chooseParameter("画面比例", "16:9");
      await customSize();
      const customDuration = panel.getByRole("spinbutton", {
        name: "自定义视频时长",
        exact: true,
      });
      await customDuration.fill("45");
      await panel
        .getByRole("slider", { name: "视频时长", exact: true })
        .focus();
      assert.equal(await customDuration.inputValue(), "45");
      assert(
        await panel.isVisible(),
        "Custom edits keep video parameters open",
      );
      await page.waitForFunction(() => {
        const draft = JSON.parse(
          localStorage.getItem("video-workspace-draft") || "{}",
        );
        return draft.duration === 45;
      });
      await page.reload();
      await page.getByRole("textbox", { name: "视频提示词" }).waitFor();
      await customSize();
      assert.equal(await customDuration.inputValue(), "45");
      assert.equal(
        submits.length,
        0,
        "Parameter edits and reload never submit",
      );
      const saved = await readVideoState(page, "video-workspace-draft");
      assert.equal(saved.duration, 45);
      await page.screenshot({
        path: path.join(artifactDir, `parameters-${width}x${height}.png`),
      });
      const sent = await generate();
      assert(sent.type.includes("multipart/form-data"));
      assert(!sent.body.includes('name="size"\r\n'));
      assert(!sent.body.includes('name="resolution_name"\r\n'));
      assert(sent.body.includes('name="seconds"\r\n\r\n45'));
      assert.equal(submits.length, 1, "One explicit send creates one job");
      await page.reload();
      await page.getByRole("textbox", { name: "视频提示词" }).waitFor();
      assert.equal(submits.length, 1, "Reload never repeats the generation");
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          width,
          height,
          parameters: `choices, auto, ${
            width < 600 || height < 500 ? "keyboard/touch" : "keyboard"
          } range, custom duration, reload and default dimensions payload`,
          submissions: submits.length,
          paidRequests: 0,
          errors,
        }),
      );
      return;
    }
    await settings();
    await custom.fill("{");
    await page.getByRole("alert").filter({ hasText: "自定义参数" }).waitFor();
    await page
      .getByRole("textbox", { name: "视频提示词", exact: true })
      .fill("waves");
    assert(
      await page
        .getByRole("button", { name: "生成视频", exact: true })
        .isDisabled(),
    );
    await settings();
    await custom.fill(
      '{"seconds":20,"size":"2048x1080","seed":0,"generate_audio":false}',
    );
    await layout("sora");
    const sora = await generate();
    assert(sora.type.includes("multipart/form-data"));
    assert(sora.body.includes('name="seconds"\r\n\r\n20'));
    assert(sora.body.includes('name="size"\r\n\r\n2048x1080'));
    assert(sora.body.includes('name="generate_audio"\r\n\r\nfalse'));
    for (const [source, value] of [
      ["图片 URL", "https://cdn.test/ref.png"],
      ["文件 ID", "file-ref_1"],
    ]) {
      await settings();
      await custom.fill("");
      await choose(page, "参考图来源", source);
      await page
        .getByRole("textbox", {
          name: source === "图片 URL" ? "参考图片 URL" : "参考文件 ID",
          exact: true,
        })
        .fill(value);
      const sent = await generate();
      assert.deepEqual(
        sent.json.input_reference,
        source === "图片 URL" ? { image_url: value } : { file_id: value },
      );
    }
    await settings();
    await choose(page, "参考图来源", "本地上传");
    await page.keyboard.press("Escape");
    await upload(1);
    assert(
      (await generate()).body.includes(
        'name="input_reference"; filename="reference.png"',
      ),
    );

    for (const name of models.slice(1, 3)) {
      await model(name);
      await mode("首尾帧");
      const resolution = name.startsWith("grok") ? "480p" : "720p";
      const duration = name.startsWith("grok") ? 3 : 30;
      await parameters(resolution, duration);
      await upload(2);
      await settings();
      await custom.fill("");
      await choose(page, "生成声音", "关闭");
      await layout(name.startsWith("grok") ? "grok" : "seedance");
      const sent = (await generate()).json;
      assert(!Object.hasOwn(sent, "size"));
      assert(!Object.hasOwn(sent, "resolution_name"));
      assert.equal(sent.metadata.generate_audio, false);
      assert.equal(sent.metadata.resolution, resolution);
      assert.equal(sent.seconds, String(duration));
      if (name.startsWith("grok")) {
        assert.equal(typeof sent.input_reference, "string");
        assert(sent.last_frame.url);
        assert.deepEqual(sent.last_frame, sent.metadata.last_frame);
      } else
        assert.deepEqual(
          sent.metadata.content.map((item) => item.role),
          ["first_frame", "last_frame"],
        );
      await mode("多图参考");
      await upload(2);
      const refs = (await generate()).json;
      if (name.startsWith("grok"))
        assert.equal(refs.metadata.reference_images.length, 2);
      else
        assert(
          refs.metadata.content.every(
            (item) => item.role === "reference_image",
          ),
        );
    }
    await model(models[1]);
    await mode("多图参考");
    await upload(10);
    await page
      .getByRole("button", { name: "上传参考内容", exact: true })
      .locator('input[type="file"]')
      .setInputFiles({
        name: "overflow.png",
        mimeType: "image/png",
        buffer: png,
      });
    await page.getByText("最多使用 10 张参考图", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "移除素材 overflow.png", exact: true })
        .count(),
      0,
    );
    assert.equal((await generate()).json.metadata.reference_images.length, 10);
    await model(models[3]);
    await mode("图生视频");
    await parameters("1080p", 8);
    await upload(1);
    await settings();
    assert.equal(
      await page
        .getByRole("combobox", { name: "参考图来源", exact: true })
        .count(),
      0,
    );
    await page
      .getByRole("textbox", { name: "负面提示词", exact: true })
      .fill("blur");
    await page
      .getByRole("spinbutton", { name: "随机种子", exact: true })
      .fill("0");
    await choose(page, "人物生成", "仅成年人");
    await layout("veo");
    const veo = (await generate()).json;
    assert.equal(veo.images.length, 1);
    assert(veo.images[0].startsWith("data:image/png;base64,"));
    assert.equal(veo.metadata.seed, 0);
    assert.equal(veo.metadata.resolution, "1080p");
    assert.equal(veo.seconds, "8");
    assert.equal(veo.metadata.negativePrompt, "blur");
    assert.equal(veo.metadata.personGeneration, "allow_adult");
    assert.equal(veo.instances, undefined);

    await model(models[0]);
    await mode("文生视频");
    await sizeSettings();
    await chooseParameter("分辨率", "480p");
    await chooseParameter("画面比例", "自动");
    await customSize();
    assert.equal(await page.getByLabel("视频宽度", { exact: true }).count(), 0);
    assert.equal(await page.getByLabel("视频高度", { exact: true }).count(), 0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(artifactDir, `automatic-size-${width}x${height}.png`),
    });
    const automaticOpenai = await generate();
    assert(!automaticOpenai.body.includes('name="size"\r\n'));
    assert(!automaticOpenai.body.includes('name="resolution_name"\r\n'));
    await model(models[3]);
    await sizeSettings();
    await chooseParameter("分辨率", "自动");
    const automaticGemini = (await generate()).json;
    assert.equal(automaticGemini.metadata.aspectRatio, "16:9");
    assert.equal(automaticGemini.metadata.resolution, undefined);

    const count = submits.length;
    await page.evaluate(() => {
      for (const [apiFormat, upstreamId] of [
        ["xai", "old_xai"],
        ["seedance", "old_seedance"],
        ["gemini", "models/veo/operations/old_veo"],
      ])
        localStorage.setItem(
          `task:${apiFormat}`,
          JSON.stringify({
            id: apiFormat,
            kind: "video",
            upstreamId,
            tokenId: null,
            model: "old",
            prompt: "Old task",
            createdAt: Date.now(),
            video: { apiFormat, mode: "text-to-video" },
          }),
        );
    });
    await page.reload();
    await page.waitForFunction(
      () =>
        !["task:xai", "task:seedance", "task:gemini"].some((key) =>
          localStorage.getItem(key),
        ),
    );
    assert.equal(
      submits.length,
      count,
      "historical tasks recover using GET only",
    );
    assert(gets.includes("/api/v1/videos/old_xai"));
    assert(gets.includes("/api/ark/contents/generations/tasks/old_seedance"));
    assert(gets.includes("/api/v1beta/models/veo/operations/old_veo"));
    await settings();
    const saved = await readVideoState(page, "video-workspace-draft");
    assert.equal(saved.apiFormat, "openai", "old draft format is normalized");
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        height,
        submissions: count,
        formats: 1,
        history: "GET only",
        errors,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        width,
        height,
        submits: submits.length,
        draft: await readVideoState(page, "video-workspace-draft"),
      }),
    );
    await page.screenshot({
      path: path.join(artifactDir, `failure-${width}x${height}.png`),
    });
    console.error((await page.locator("body").innerText()).slice(-2500));
    throw error;
  } finally {
    await context.close();
  }
}
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const selectedViewport = process.argv
      .find((argument) => argument.startsWith("--viewport="))
      ?.slice("--viewport=".length);
    const viewports = process.argv.includes("--smoke")
      ? [[1440, 900]]
      : [
          [1440, 900],
          [390, 844],
          [320, 740],
          [844, 390],
        ];
    for (const [width, height] of viewports)
      if (!selectedViewport || `${width}x${height}` === selectedViewport)
        await run(browser, width, height);
    console.log(JSON.stringify({ artifactDir }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
