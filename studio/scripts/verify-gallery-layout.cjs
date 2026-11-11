// Isolated browser data and local media only; no account writes or generation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
process.env.PLAYWRIGHT_MODULE ||=
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const { prepare } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
assert.equal(new URL(base).origin, "http://localhost:3001");
const origin = new URL(base).origin;
const baseline = process.argv.includes("--baseline");
const output = fs.mkdtempSync(
  path.join(os.tmpdir(), "octopus-gallery-layout-"),
);
const image = `data:image/png;base64,${fs
  .readFileSync(path.join(__dirname, "../public/android-chrome-512x512.png"))
  .toString("base64")}`;
const clips = [
  { id: "portrait", size: "144x256", prompt: "竖屏视频：海边列车" },
  {
    id: "landscape",
    size: "256x144",
    prompt:
      "横屏视频：清晨阳光下的海岸与远处缓缓经过的列车，长标题用于验证卡片排版",
  },
].map((item) => {
  const file = path.join(output, `${item.id}.mp4`);
  const encoded = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=s=${item.size}:r=10`,
    "-t",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-y",
    file,
  ]);
  assert.equal(encoded.status, 0, String(encoded.stderr));
  return { ...item, body: fs.readFileSync(file) };
});

async function until(check, message, timeout = 15000) {
  const start = Date.now();
  while (!(await check())) {
    assert(Date.now() - start < timeout, message);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function seed(page, theme) {
  await page.evaluate(
    async ({ source, clips, theme, base }) => {
      const photo = new Image();
      photo.src = source;
      await photo.decode();
      const sizes = [
        [384, 384],
        [216, 384],
        [384, 216],
        [768, 192],
      ];
      const pictures = await Promise.all(
        sizes.map(async ([width, height], index) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = ["#e8f4f1", "#fff0e8", "#eaf0ff", "#fff7db"][index];
          ctx.fillRect(0, 0, width, height);
          const side = Math.min(width, height) * 0.6;
          ctx.drawImage(
            photo,
            (width - side) / 2,
            (height - side) / 2,
            side,
            side,
          );
          ctx.fillStyle = "#30343b";
          ctx.font = "16px sans-serif";
          ctx.fillText(`${width} x ${height}`, 12, height - 12);
          return {
            blob: await new Promise((resolve) =>
              canvas.toBlob(resolve, "image/png"),
            ),
            poster: canvas.toDataURL("image/png"),
          };
        }),
      );
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("octopus-gallery-user-7", 3);
        request.onupgradeneeded = () => {
          const db = request.result;
          const images = db.createObjectStore("images", { keyPath: "id" });
          images.createIndex("createdAt", "createdAt");
          images.createIndex("model", "model");
          images.createIndex("createdAtId", ["createdAt", "id"]);
          db.createObjectStore("originals");
          db.createObjectStore("settings", { keyPath: "key" });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const now = Date.now();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["images", "originals"], "readwrite");
        for (let index = 0; index < 6; index++) {
          const id = `layout-image-${index}`;
          const good = index < 4;
          if (good) tx.objectStore("originals").put(pictures[index].blob, id);
          tx.objectStore("images").put({
            id,
            prompt: [
              "正方形图片",
              "竖屏图片：一只猫在太阳下",
              "横屏图片：海边列车",
              "超宽图片：这是一段很长的提示词，用于确认标题截断以后所有卡片的模型、参数和操作行仍然工整对齐",
              "图片加载失败",
              "图片正在加载",
            ][index],
            model:
              index === 3
                ? "gpt-image-2.6-sunburst-with-a-very-long-model-name"
                : "gpt-image-2",
            width: good ? sizes[index][0] : 384,
            height: good ? sizes[index][1] : 384,
            thumbnail: good ? pictures[index].blob : undefined,
            imageData: good
              ? ""
              : `${base}api/qa-gallery/${
                  index === 4 ? "failed" : "loading"
                }.png`,
            createdAt: now - [0, 2, 4, 5, 6, 7][index] * 1000,
            status: index === 4 ? "failed" : "success",
          });
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      const store = await new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onupgradeneeded = () =>
          request.result.createObjectStore("keyval");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const key = "octopus:user-7:video-workspace-results";
      const results = clips.map((clip, index) => ({
        id: `layout-video-${clip.id}`,
        url: `${base}api/qa-gallery/${clip.id}.mp4`,
        coverUrl: pictures[index === 0 ? 1 : 2].poster,
        prompt: clip.prompt,
        model:
          index === 0
            ? "grok-imagine-video"
            : "sora-2-pro-with-a-very-long-model-name",
        aspectRatio: index === 0 ? "9:16" : "16:9",
        resolution: "720p",
        duration: 1,
        status: "success",
        createdAt: now - (index === 0 ? 1 : 3) * 1000,
      }));
      await new Promise((resolve, reject) => {
        const tx = store.transaction("keyval", "readwrite");
        const entries = tx.objectStore("keyval");
        entries.put(
          JSON.stringify({
            version: 1,
            state: { results, _hasHydrated: true },
          }),
          key,
        );
        const config = window.__galleryQaConfig;
        config.state.theme = theme;
        config.state._hasHydrated = true;
        entries.put(JSON.stringify(config), "octopus:user-7:app-config");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      store.close();
    },
    {
      source: image,
      clips: clips.map(({ body, ...clip }) => clip),
      theme,
      base,
    },
  );
}

async function measure(cards) {
  return cards.evaluateAll((elements) =>
    elements.map((element) => {
      const box = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      const part = (name) => element.querySelector(`[class*="${name}"]`);
      return {
        label:
          element.getAttribute("aria-label") || part("card-prompt").textContent,
        kind: element.hasAttribute("aria-label") ? "video" : "image",
        card: box(element),
        media: box(part("card-image-area")),
        metadata: box(part("card-meta")),
        actions: box(part("card-actions")),
      };
    }),
  );
}

async function run(browser, width, theme) {
  const mobile = width <= 600;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 1000 },
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: theme,
    serviceWorkers: "block",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const state = {
    width,
    theme,
    checks: [],
    calls: [],
    errors: [],
    environmentWarnings: [],
    realPaidRequests: 0,
    playback: [],
  };
  let pendingImage;
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      (text.includes("googletagmanager.com") &&
        text.includes("Content Security Policy")) ||
      text.includes("ServiceWorker registration failed")
    )
      state.environmentWarnings.push(text);
    else state.errors.push(text);
  });
  await prepare(page);
  await page.addInitScript((theme) => {
    window.__galleryMediaFailures = [];
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      const promise = nativePlay.apply(this, args);
      promise?.catch((error) =>
        window.__galleryMediaFailures.push({
          name: error.name,
          message: error.message,
        }),
      );
      return promise;
    };
    const config = JSON.parse(localStorage.getItem("app-config"));
    Object.assign(config.state, {
      theme,
      dontShowMaskSplashScreen: true,
      colorTheme: "violet",
    });
    window.__galleryQaConfig = config;
    localStorage.setItem("app-config", JSON.stringify(config));
  }, theme);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== origin) return route.abort();
    if (request.headers()["next-action"])
      return route.fulfill({
        contentType: "text/x-component",
        body: '0:{"a":false,"f":[]}\n',
      });
    if (!url.pathname.startsWith("/api/")) return route.continue();
    state.calls.push({ method: request.method(), path: url.pathname });
    assert.equal(request.method(), "GET", "No API writes or paid generation");
    const clip = clips.find(
      (clip) => url.pathname === `/api/qa-gallery/${clip.id}.mp4`,
    );
    if (clip)
      return route.fulfill({ contentType: "video/mp4", body: clip.body });
    if (url.pathname === "/api/qa-gallery/loading.png") {
      pendingImage = route;
      return;
    }
    if (url.pathname === "/api/qa-gallery/failed.png")
      return route.fulfill({ contentType: "image/png", body: "invalid image" });
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    const session = {
      authenticated: true,
      selectedTokenId: null,
      user: { id: 7, username: "fixture", group: "default", quota: 500000 },
    };
    if (url.pathname === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true } });
    if (url.pathname === "/api/new-api/bootstrap")
      return ok({ config: { newApiEnabled: true }, session });
    if (url.pathname === "/api/new-api/session") return ok(session);
    if (url.pathname === "/api/new-api/status")
      return ok({ enabled: true, configured: true, quotaPerUnit: 500000 });
    if (url.pathname.endsWith("/models"))
      return route.fulfill({ json: { data: [] } });
    if (url.pathname === "/api/announcement")
      return route.fulfill({ json: { announcement: null } });
    return ok([]);
  });
  try {
    await page.goto(`${base}#/gallery`, { waitUntil: "domcontentloaded" });
    await page.getByText("作品库", { exact: true }).waitFor();
    await seed(page, theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    const cards = page.locator('[class*="gallery-card"]');
    await cards.nth(7).waitFor();
    await page.locator(`body.${theme}`).waitFor();
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await until(
      () =>
        cards
          .first()
          .locator("img")
          .evaluate((node) => node.complete && node.naturalWidth === 384),
      "Real square image thumbnail decodes",
    );
    if (baseline)
      await until(
        () =>
          page
            .locator("video")
            .evaluateAll(
              (nodes) =>
                nodes.length === 2 &&
                nodes.every((node) => node.readyState >= 1),
            ),
        "Both baseline videos load actual metadata",
      );
    state.metrics = await measure(cards);
    const screenshot = path.join(
      output,
      `${baseline ? "before" : "after"}-${width}-${theme}.png`,
    );
    await page.mouse.move(0, 0);
    await page.screenshot({ path: screenshot });
    state.screenshot = screenshot;
    if (baseline) {
      state.checks.push("Captured mixed image/video baseline");
      return state;
    }
    for (const metric of state.metrics)
      assert(
        Math.abs(metric.media.width - metric.media.height) < 1.5,
        `${metric.label}: square cover ${JSON.stringify(metric.media)}`,
      );
    for (const metric of state.metrics) {
      const row = state.metrics.filter(
        (item) => Math.abs(item.card.y - metric.card.y) < 2,
      );
      for (const item of row) {
        assert(
          Math.abs(item.card.height - metric.card.height) < 2,
          "Same row card heights align",
        );
        assert(
          Math.abs(item.metadata.y - metric.metadata.y) < 2,
          "Same row metadata aligns",
        );
        assert(
          Math.abs(item.actions.y - metric.actions.y) < 2,
          "Same row actions align",
        );
      }
    }
    assert(
      await page
        .locator('[class*="gallery-page"]')
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      "Gallery has no horizontal overflow",
    );
    assert.equal(
      await page.locator("video[controls]").count(),
      0,
      "No native video controls in thumbnails",
    );
    state.checks.push(
      "Square mixed covers, card/metadata/actions alignment and no overflow",
    );
    const closedPlayers = [];
    const previews = [
      { ...clips[0], activation: "pointer" },
      { ...clips[1], activation: "Enter" },
      { ...clips[0], activation: "Space" },
    ];
    for (const clip of previews) {
      const card = page.getByLabel(`视频作品：${clip.prompt}`, { exact: true });
      const trigger = card
        .getByRole("button", { name: new RegExp("(?:播放|预览)视频") })
        .first();
      await trigger.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        window.__galleryMediaFailures = [];
      });
      if (clip.activation === "pointer") await trigger.click();
      else {
        await trigger.focus();
        await page.keyboard.press(clip.activation);
      }
      const dialog = page.getByRole("dialog").last();
      await dialog.waitFor();
      const video = dialog.locator("video");
      await until(
        () => video.evaluate((node) => node.readyState >= 2),
        "Video preview decodes",
      );
      const autoplay = await video.evaluate(
        (node) =>
          new Promise((resolve) => {
            const capture = () => {
              node.removeEventListener("playing", capture);
              resolve({
                requested: node.autoplay,
                playing: !node.paused,
                readyState: node.readyState,
                ended: node.ended,
                time: node.currentTime,
                failures: window.__galleryMediaFailures,
              });
            };
            if (!node.paused) capture();
            else {
              node.addEventListener("playing", capture, { once: true });
              setTimeout(capture, 700);
            }
          }),
      );
      assert(autoplay.requested, "Preview requests playback on open");
      assert(
        autoplay.playing ||
          autoplay.failures.some((error) => error.name === "NotAllowedError"),
        "Opening starts playback unless the browser explicitly blocks autoplay",
      );
      const player = await video.elementHandle();
      for (const previous of closedPlayers)
        assert(
          await previous.evaluate((node) => node.paused),
          "Opening another preview keeps the previous player paused",
        );
      assert.equal(
        await page.locator("video[controls]").count(),
        1,
        "Only the active preview owns playback controls",
      );
      const playback = await video.evaluate(async (node) => {
        await node.play();
        return new Promise((resolve) =>
          setTimeout(() => {
            node.pause();
            resolve({
              width: node.videoWidth,
              height: node.videoHeight,
              time: node.currentTime,
              paused: node.paused,
              objectFit: getComputedStyle(node).objectFit,
            });
          }, 180),
        );
      });
      const [videoWidth, videoHeight] = clip.size.split("x").map(Number);
      state.playback.push({
        id: clip.id,
        activation: clip.activation,
        autoplay,
        ...playback,
      });
      assert.equal(playback.width, videoWidth);
      assert.equal(playback.height, videoHeight);
      assert(playback.time > 0 && playback.paused, "Preview plays and pauses");
      assert.equal(
        playback.objectFit,
        "contain",
        "Preview preserves original ratio",
      );
      await dialog.evaluate((node) =>
        Promise.all(
          node
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
      await page.screenshot({
        path: path.join(
          output,
          `preview-${clip.id}-${clip.activation}-${width}-${theme}.png`,
        ),
      });
      await video.evaluate((node) => node.play());
      assert(
        await video.evaluate((node) => !node.paused),
        "Close is exercised during actual playback",
      );
      if (clip.id === "portrait") await page.keyboard.press("Escape");
      else
        await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert(
        await player.evaluate((node) => node.paused),
        "Closing a preview pauses its detached player",
      );
      closedPlayers.push(player);
      await until(
        () => trigger.evaluate((node) => document.activeElement === node),
        "Preview returns focus to opener",
      );
    }
    state.checks.push(
      "Portrait and landscape previews decode, play/pause, close/Escape and restore focus",
    );
    const imageTrigger = cards.first().locator('img[role="button"]');
    await imageTrigger.scrollIntoViewIfNeeded();
    await imageTrigger.focus();
    await page.keyboard.press("Enter");
    await page.locator('[class*="lightbox-content"]').waitFor();
    await page.keyboard.press("Escape");
    await page
      .locator('[class*="lightbox-content"]')
      .waitFor({ state: "hidden" });
    state.checks.push("Image lightbox remains usable");
    await page.getByRole("button", { name: "批量选择", exact: true }).click();
    const batchCard = page.getByLabel(`视频作品：${clips[0].prompt}`, {
      exact: true,
    });
    await batchCard.scrollIntoViewIfNeeded();
    if (mobile) await batchCard.tap();
    else await batchCard.click();
    assert(
      await batchCard.getByRole("checkbox").isChecked(),
      "Batch selects video",
    );
    assert.equal(
      await page.getByRole("dialog").count(),
      0,
      "Batch selection does not open player",
    );
    assert.equal(
      await page
        .locator("video")
        .evaluateAll((nodes) => nodes.filter((node) => !node.paused).length),
      0,
      "Batch does not play videos",
    );
    for (const player of closedPlayers)
      assert(
        await player.evaluate((node) => node.paused),
        "Entering batch mode keeps closed previews paused",
      );
    await page.getByRole("button", { name: "取消选择", exact: true }).click();
    state.checks.push(
      "Touch/click batch selection never opens or plays a video",
    );
    const grid = page.locator('[class*="gallery-grid"]');
    await grid.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page.getByText("图片加载失败", { exact: true }).first().waitFor();
    assert(
      await page.locator('[class*="card-image-loading"]').count(),
      "Loading fixture is present",
    );
    await page.screenshot({
      path: path.join(output, `states-${width}-${theme}.png`),
    });
    state.checks.push("Failed/loading cards keep the shared card geometry");
    assert.deepEqual(state.errors, []);
    return state;
  } catch (error) {
    await page.screenshot({
      path: path.join(output, `failed-${width}-${theme}.png`),
    });
    console.error({
      errors: state.errors,
      body: (await page.locator("body").innerText()).slice(0, 1800),
    });
    throw error;
  } finally {
    if (pendingImage)
      await pendingImage
        .fulfill({
          contentType: "image/png",
          body: fs.readFileSync(
            path.join(__dirname, "../public/android-chrome-512x512.png"),
          ),
        })
        .catch(() => {});
    await context.close();
    fs.writeFileSync(
      path.join(output, `result-${width}-${theme}.json`),
      JSON.stringify(state, null, 2),
    );
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const cases = process.env.UI_TEST_WIDTH
      ? [
          [
            Number(process.env.UI_TEST_WIDTH),
            process.env.UI_TEST_THEME || "light",
          ],
        ]
      : baseline
      ? [[1440, "light"]]
      : [
          [1440, "light"],
          [390, "dark"],
        ];
    for (const [width, theme] of cases) {
      const result = await run(browser, width, theme);
      console.log(JSON.stringify(result));
    }
    console.log(JSON.stringify({ output, realPaidRequests: 0 }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
