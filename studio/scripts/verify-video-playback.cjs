// Isolated account and media fixtures; never generates a paid video.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const base = process.env.UI_TEST_URL || "http://localhost:3001/";
assert.equal(new URL(base).origin, "http://localhost:3001");
const output = fs.mkdtempSync(
  path.join(os.tmpdir(), "octopus-video-playback-"),
);
const clipPath = path.join(output, "fixture.mp4");
const encoded = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=red:s=128x72:r=10",
  "-t",
  "2",
  "-pix_fmt",
  "yuv420p",
  "-y",
  clipPath,
]);
assert.equal(encoded.status, 0, String(encoded.stderr));
const clip = fs.readFileSync(clipPath);

async function run(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    isMobile: width < 600,
    hasTouch: width < 600,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  let selected = 100;
  const reads = [];
  const errors = [];
  let modelReads = 0;
  const models = ["sora-2", "grok-imagine-video-1.5", "provider-special"];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ base, models }) => {
      if (localStorage.getItem("playback-fixture")) return;
      localStorage.setItem("playback-fixture", "1");
      localStorage.setItem("lang", "cn");
      localStorage.setItem(
        "octopus:user-7:app-config",
        JSON.stringify({
          version: 4.4,
          state: {
            theme: "light",
            models: models.map((name) => ({
              name,
              available: true,
              provider: { id: "gpt", providerName: "gpt" },
            })),
          },
        }),
      );
      localStorage.setItem(
        "octopus:user-7:video-workspace-draft",
        JSON.stringify({
          apiFormat: "openai",
          model: "sora-2@gpt",
          prompt: "保留我的草稿和 @图片1",
          materials: [
            {
              id: "reference",
              type: "image",
              name: "reference.png",
              url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
            },
          ],
        }),
      );
      localStorage.setItem(
        "octopus:user-7:video-workspace-results",
        JSON.stringify([
          {
            id: "completed-job",
            model: "sora-2",
            prompt: "历史视频播放测试",
            url: `${base}api/v1/videos/completed-job/content`,
            mediaPath: "videos/completed-job/content",
            tokenId: 100,
            status: "success",
            createdAt: 1,
          },
        ]),
      );
    },
    { base, models },
  );
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    const p = url.pathname;
    if (!p.startsWith("/api/")) return route.continue();
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (p === "/api/new-api/bootstrap" || p === "/api/new-api/session") {
      const session = {
        authenticated: true,
        selectedTokenId: selected,
        user: {
          id: 7,
          username: "fixture",
          display_name: "Fixture",
          quota: 500000,
        },
      };
      return ok(
        p.endsWith("/bootstrap")
          ? { config: { newApiEnabled: true, enableMcp: false }, session }
          : session,
      );
    }
    if (p === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true, enableMcp: false } });
    if (p === "/api/new-api/model-groups")
      return ok({
        groups: [
          { id: "auto", name: "Auto 系统", ratio: "auto" },
          { id: "second", name: "其他视频分组", ratio: 1 },
        ],
        selectedGroup: selected === 100 ? "auto" : "second",
      });
    if (p === "/api/new-api/model-groups/select") {
      assert.equal(req.postDataJSON().group, "second");
      selected = 200;
      return ok({ selectedTokenId: selected, group: "second" });
    }
    if (p === "/api/remote-models") {
      modelReads++;
      return route.fulfill({
        json: { data: selected === 100 ? [] : models.map((id) => ({ id })) },
      });
    }
    if (p === "/api/v1/videos/completed-job/content") {
      assert.equal(req.method(), "GET");
      assert.equal(req.headers()["x-new-api-token"], "100");
      assert.equal(req.headers()["x-new-api-user"], "7");
      reads.push({ selected, token: req.headers()["x-new-api-token"] });
      return route.fulfill({ contentType: "video/mp4", body: clip });
    }
    assert.equal(req.method(), "GET", `Unexpected mutation: ${p}`);
    if (p === "/api/announcement")
      return route.fulfill({ json: { announcement: null } });
    return ok([]);
  });
  try {
    await page.goto(`${base}#/video-workspace`);
    const video = page.locator("video").first();
    await video.waitFor();
    await page.waitForFunction(
      () => document.querySelector("video")?.readyState >= 2,
    );
    const original = await video.getAttribute("src");
    if (process.argv.includes("--gallery")) {
      await page.goto(`${base}#/gallery`);
      await page
        .getByLabel("视频作品：历史视频播放测试", { exact: true })
        .waitFor();
      await page.waitForFunction(
        () => document.querySelector("video")?.readyState >= 2,
      );
      await page
        .locator("video")
        .first()
        .evaluate(async (el) => {
          await el.play();
        });
      const chooseType = async (name) => {
        await page
          .getByRole("combobox", { name: "作品类型", exact: true })
          .click();
        await page.getByRole("option", { name, exact: true }).click();
      };
      await chooseType("图片");
      await page.getByText("没有找到匹配的作品", { exact: true }).waitFor();
      await chooseType("视频");
      await page
        .getByLabel("视频作品：历史视频播放测试", { exact: true })
        .waitFor();
      const search = page.getByRole("textbox", {
        name: "搜索提示词...",
        exact: true,
      });
      await search.fill("不匹配");
      await page.getByText("没有找到匹配的作品", { exact: true }).waitFor();
      await page.getByRole("button", { name: "清除筛选", exact: true }).click();
      await page
        .getByLabel("视频作品：历史视频播放测试", { exact: true })
        .waitFor();
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "下载视频", exact: true }).click();
      const download = await downloaded;
      assert.equal(download.suggestedFilename(), "video-completed-job.mp4");
      assert.equal(await download.failure(), null);
      await page.waitForFunction(
        () => document.querySelector("video")?.readyState >= 2,
      );
      await page.screenshot({
        path: path.join(output, `gallery-${width}.png`),
      });
      await page
        .getByRole("button", { name: "移出作品库", exact: true })
        .click();
      await page.getByRole("button", { name: "确认", exact: true }).click();
      await page
        .getByLabel("视频作品：历史视频播放测试", { exact: true })
        .waitFor({ state: "detached" });
      await page.reload();
      await page.getByText("暂无作品", { exact: true }).waitFor();
      await page.goto(`${base}#/video-workspace`);
      await page.waitForFunction(
        () => document.querySelector("video")?.readyState >= 2,
      );
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ width, gallery: true, paidRequests: 0 }));
      return;
    }
    await page.getByRole("button", { name: /^模型：/ }).click();
    const picker = page.getByRole("dialog", {
      name: "选择视频模型",
      exact: true,
    });
    assert.equal(
      await picker.count(),
      1,
      "Video workspace exposes the complete model picker",
    );
    await picker.getByRole("button", { name: "分组", exact: true }).click();
    await picker
      .locator("#model-source-options")
      .getByRole("button", { name: /其他视频分组/ })
      .click();
    assert.equal(selected, 200);
    const search = picker.getByRole("searchbox", {
      name: "搜索模型",
      exact: true,
    });
    await search.fill("provider-special");
    await picker
      .getByRole("button", { name: "provider-special (provider)", exact: true })
      .waitFor();
    const beforeRefresh = modelReads;
    await picker.getByRole("button", { name: "刷新模型", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('button[aria-label="刷新模型"]')?.disabled,
    );
    assert(modelReads > beforeRefresh);
    await search.fill("grok");
    await picker.evaluate(async (el) => {
      await Promise.all(
        el
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await page.screenshot({ path: path.join(output, `picker-${width}.png`) });
    const bounds = await picker.boundingBox();
    assert(
      bounds.x >= -1 && bounds.x + bounds.width <= width + 1,
      JSON.stringify(bounds),
    );
    const closeBounds = await picker
      .getByRole("button", { name: "关闭", exact: true })
      .boundingBox();
    assert(
      closeBounds.y >= 0 && closeBounds.y + closeBounds.height <= 900,
      "The close button remains visible after mobile input focus",
    );
    await picker
      .getByRole("button", {
        name: "grok-imagine-video-1.5 (grok)",
        exact: true,
      })
      .click();
    await picker.waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute("aria-label")?.startsWith("模型："),
    );
    await page.getByRole("button", { name: /^模型：/ }).click();
    await picker.waitFor();
    await page.keyboard.press("Escape");
    await picker.waitFor({ state: "hidden" });
    assert.equal(new URL(page.url()).hash, "#/video-workspace");
    assert.equal(
      await page
        .getByRole("textbox", { name: "视频提示词", exact: true })
        .inputValue(),
      "保留我的草稿和 @图片1",
    );
    assert.equal(
      await page.getByRole("button", { name: /模型：.*grok/ }).count(),
      1,
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event("model-source-changing")),
    );
    assert.equal(
      await video.getAttribute("src"),
      original,
      "Model switching keeps the loaded video",
    );
    await video.evaluate(async (el) => {
      await el.play();
    });
    assert.equal(await video.evaluate((el) => el.paused), false);
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector("video")?.readyState >= 2,
    );
    assert(
      reads.some((read) => read.selected === 200 && read.token === "100"),
      "Reload uses the historical token despite the new current selection",
    );
    await video.evaluate(async (el) => {
      await el.play();
    });
    assert.equal(await video.evaluate((el) => el.paused), false);
    await page.screenshot({ path: path.join(output, `playback-${width}.png`) });
    await page.evaluate(() =>
      window.dispatchEvent(new Event("local-workspace-switch")),
    );
    await page.waitForFunction(() => !document.querySelector("video"));
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({ width, selected, reads, passed: true, paidRequests: 0 }),
    );
  } catch (error) {
    await page.screenshot({ path: path.join(output, `failure-${width}.png`) });
    console.error((await page.locator("body").innerText()).slice(-1800));
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) await run(browser, width);
    console.log(JSON.stringify({ output }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
