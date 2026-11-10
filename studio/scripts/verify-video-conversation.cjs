// Isolated contexts, local media and intercepted APIs never use a real account.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const base = process.env.UI_TEST_URL || "http://localhost:3001/";
assert.equal(new URL(base).origin, "http://localhost:3001");
const origin = new URL(base).origin;
const model = "sora-2";
const draftKey = "video-workspace-draft";
const resultsKey = "video-workspace-results";
const prompt = "QA_VIDEO_FIRST 海边列车缓缓经过，镜头跟随海浪。";
const nextDraft = "QA_VIDEO_NEXT_DRAFT 这一条草稿不能被结果更新覆盖。";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxkAAAAASUVORK5CYII=",
  "base64",
);
const report = { base, cases: [], paidRequests: 0 };

// Video snapshots use the same attachment-aware store as chat snapshots.
async function readVideoState(page, key) {
  return page.evaluate(async (key) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = (name) =>
        new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains("keyval")) return resolve(null);
          const request = db
            .transaction("keyval", "readonly")
            .objectStore("keyval")
            .get(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const raw = (await read(key)) ?? localStorage.getItem(key);
      if (!raw) return null;
      const stored = typeof raw === "string" ? JSON.parse(raw) : raw;
      const restore = async (value) => {
        if (!value || typeof value !== "object") return value;
        if (typeof value.__octopusChatAsset === "string")
          return read(`${key}:asset:${value.__octopusChatAsset}`);
        if (Array.isArray(value)) return Promise.all(value.map(restore));
        return Object.fromEntries(
          await Promise.all(
            Object.entries(value).map(async ([name, child]) => [
              name,
              await restore(child),
            ]),
          ),
        );
      };
      return await restore(
        stored.state?.results ?? stored.state?.draft ?? stored,
      );
    } finally {
      db.close();
    }
  }, key);
}

async function writeVideoState(page, key, value) {
  await page.evaluate(
    async ({ key, value }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onupgradeneeded = () =>
          request.result.createObjectStore("keyval");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const transaction = db.transaction("keyval", "readwrite");
          transaction.objectStore("keyval").put(
            JSON.stringify({
              version: 1,
              state: {
                [Array.isArray(value) ? "results" : "draft"]: value,
                _hasHydrated: true,
              },
            }),
            key,
          );
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        localStorage.setItem(key, JSON.stringify(value));
      } finally {
        db.close();
      }
    },
    { key, value },
  );
}

async function until(check, message, timeout = 15000) {
  const started = Date.now();
  while (!(await check())) {
    assert(Date.now() - started < timeout, message);
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
}

function makeClip(output) {
  const file = path.join(output, "fixture-portrait.mp4");
  const encoded = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=144x256:r=10",
    "-t",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-y",
    file,
  ]);
  assert.equal(encoded.status, 0, String(encoded.stderr));
  return fs.readFileSync(file);
}

function history(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `history-${index}`,
    prompt: `QA_EARLIER_VIDEO_${index} ${"早前的镜头内容。".repeat(8)}`,
    url: `${base}api/video-fixture.mp4`,
    model,
    mode: "text-to-video",
    size: "720x1280",
    aspectRatio: "9:16",
    resolution: "720p",
    duration: 8,
    status: "success",
    createdAt: Date.now() - (count - index) * 60000,
  }));
}

async function fixture(browser, clip, options = {}) {
  const {
    width = 1440,
    height = 950,
    theme = "light",
    reducedMotion = "no-preference",
    historyCount = 0,
    touch = width <= 600 || height < 500,
  } = options;
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: width <= 600,
    hasTouch: touch,
    colorScheme: theme,
    reducedMotion,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const calls = [];
  const jobs = [];
  const blocked = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ theme, model, results, draftKey, resultsKey }) => {
      if (window !== window.top || localStorage.getItem("video-thread-fixture"))
        return;
      localStorage.setItem("video-thread-fixture", "1");
      localStorage.setItem("lang", "cn");
      localStorage.setItem(
        "app-config",
        JSON.stringify({
          version: 4.4,
          state: {
            theme,
            colorTheme: "pink",
            motionPreference: "system",
            reduceMotion: false,
            models: [
              {
                name: model,
                available: true,
                provider: { id: "gpt", providerName: "gpt" },
              },
            ],
          },
        }),
      );
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          model: `${model}@gpt`,
          apiFormat: "openai",
          mode: "image-to-video",
          size: "720x1280",
          aspectRatio: "9:16",
          resolution: "720p",
          duration: 8,
          prompt: "",
          materials: [],
          autoPlay: false,
          autoSaveGallery: false,
          confirmBeforeGenerate: false,
        }),
      );
      localStorage.setItem(resultsKey, JSON.stringify(results));
    },
    {
      theme,
      model,
      results: options.initialResults ?? history(historyCount),
      draftKey,
      resultsKey,
    },
  );
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== origin) {
      blocked.push(url.origin);
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const call = { method: request.method(), path: url.pathname };
    calls.push(call);
    const json = (data) => route.fulfill({ json: data });
    if (url.pathname === "/api/new-api/bootstrap")
      return json({
        success: true,
        data: {
          config: {
            newApiEnabled: false,
            needCode: false,
            hasModelApiKey: true,
          },
          session: { authenticated: false, selectedTokenId: null },
        },
      });
    if (url.pathname === "/api/config")
      return json({
        newApiEnabled: false,
        needCode: false,
        hasModelApiKey: true,
        enableMcp: false,
      });
    if (url.pathname === "/api/new-api/status")
      return json({ success: true, data: { enabled: false } });
    if (url.pathname.endsWith("/models"))
      return json({ data: [{ id: model }] });
    if (url.pathname === "/api/announcement")
      return json({ announcement: null });
    if (
      url.pathname.endsWith("/content") ||
      url.pathname === "/api/video-fixture.mp4"
    )
      return route.fulfill({ contentType: "video/mp4", body: clip });
    if (request.method() === "POST" && url.pathname === "/api/v1/videos") {
      const job = {
        id: `thread_${jobs.length + 1}`,
        payload: request.postData(),
        status: "in_progress",
        progress: undefined,
        gets: 0,
      };
      jobs.push(job);
      return json({ id: job.id, status: "queued" });
    }
    const match = /^\/api\/v1\/videos\/(thread_\d+)$/.exec(url.pathname);
    if (match && request.method() === "GET") {
      const job = jobs.find((item) => item.id === match[1]);
      assert(job, "Only fixture jobs can be queried");
      job.gets++;
      if (job.queryGate) await job.queryGate();
      return json({
        id: job.id,
        status: job.status,
        ...(job.progress === undefined ? {} : { progress: job.progress }),
        ...(job.status === "failed"
          ? { error: { message: "QA_PROVIDER_REJECTED 素材不符合要求" } }
          : {}),
      });
    }
    assert.equal(request.method(), "GET", `Unexpected write: ${url.pathname}`);
    return json({ success: true, data: [] });
  });
  await page.goto(`${base}#/video-workspace`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.getByRole("textbox", { name: "视频提示词" }).waitFor();
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  return { context, page, errors, calls, jobs, blocked, touch };
}

const turnFor = (page, text) =>
  page.locator("article[data-video-request]").filter({ hasText: text }).last();

async function upload(page, name) {
  await page
    .getByRole("button", { name: "上传参考内容", exact: true })
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: "image/png", buffer: png });
  await page
    .getByRole("button", { name: `移除素材 ${name}`, exact: true })
    .waitFor();
}

async function submit(state, text) {
  const before = state.jobs.length;
  const input = state.page.getByRole("textbox", { name: "视频提示词" });
  if (!(await state.page.getByRole("button", { name: /^移除素材 / }).count()))
    await upload(state.page, "reference.png");
  await input.fill(text);
  await state.page
    .getByRole("button", { name: "生成视频", exact: true })
    .click();
  await until(() => state.jobs.length === before + 1, "One generation POST");
  const latest = turnFor(state.page, text);
  await latest.waitFor();
  const id = await latest.getAttribute("data-video-request");
  const turn = state.page.locator(`article[data-video-request="${id}"]`);
  assert.equal(
    await input.inputValue(),
    "",
    "Sending clears only the submitted draft",
  );
  await turn.locator('[class*="request-status_"]').waitFor();
  return { turn, job: state.jobs.at(-1) };
}

async function playable(turn) {
  await turn.scrollIntoViewIfNeeded();
  const video = turn.locator('video[class*="result-video_"]');
  await video.scrollIntoViewIfNeeded();
  await until(
    () => video.evaluate((node) => node.readyState >= 2 || !!node.error),
    "Local fixture media decodes",
  );
  assert.equal(
    await video.evaluate((node) => node.error?.message ?? null),
    null,
  );
  assert.equal(await video.evaluate((node) => node.videoWidth), 144);
  const box = await video.boundingBox();
  assert(
    Math.abs(box.width / box.height - 9 / 16) < 0.03,
    "Portrait media retains its ratio",
  );
  return video;
}

async function geometry(state) {
  const layout = await state.page
    .locator('[class*="video-workspace_video-workspace__"]')
    .evaluate((root) => {
      const visible = (node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden";
      };
      const viewport = { width: innerWidth, height: innerHeight };
      const controls = [
        ...root.querySelectorAll('button, summary, [role="button"], textarea'),
      ]
        .filter(visible)
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return box.bottom > 0 && box.top < innerHeight;
        })
        .map((node) => ({
          label:
            node.getAttribute("aria-label") ||
            node.textContent.trim().slice(0, 40),
          tag: node.tagName,
          ...node.getBoundingClientRect().toJSON(),
        }));
      const input = root
        .querySelector("textarea")
        .getBoundingClientRect()
        .toJSON();
      const generate = [...root.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === "生成视频",
      );
      const button = generate?.getBoundingClientRect();
      return {
        viewport,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        overflowElements: [...document.querySelectorAll("body *")]
          .filter(visible)
          .map((node) => ({
            tag: node.tagName,
            className: String(node.className),
            ...node.getBoundingClientRect().toJSON(),
          }))
          .filter((box) => box.left < -1 || box.right > innerWidth + 1)
          .slice(0, 20),
        controls,
        input,
        generate: button?.toJSON(),
        generateHit:
          button &&
          document
            .elementFromPoint(
              button.x + button.width / 2,
              button.y + button.height / 2,
            )
            ?.closest("button") === generate,
      };
    });
  if (layout.overflow > 1)
    console.error(JSON.stringify({ horizontalOverflow: layout }));
  assert(
    layout.overflow <= 1,
    `No horizontal page overflow (actual ${layout.overflow}px)`,
  );
  assert(
    layout.input.height > 0 &&
      layout.input.bottom <= layout.viewport.height + 1,
  );
  assert(
    layout.generate && layout.generate.bottom <= layout.viewport.height + 1,
  );
  assert(layout.generateHit, "The send control remains reachable");
  for (const control of layout.controls) {
    assert(
      control.x >= -1 && control.right <= layout.viewport.width + 1,
      `${control.label}: within viewport`,
    );
    if (state.touch && control.tag !== "TEXTAREA")
      assert(
        control.width >= 43 && control.height >= 43,
        `${control.label}: 44px touch target`,
      );
  }
  return layout;
}

async function runFlow(browser, clip, output, smoke) {
  const state = await fixture(browser, clip, { historyCount: smoke ? 0 : 8 });
  const { page, jobs } = state;
  const checks = [];
  const pass = (label) => {
    checks.push(label);
    console.log(`PASS video conversation ${label}`);
  };
  try {
    await upload(page, "first-frame.png");
    const first = await submit(state, prompt);
    const id = await first.turn.getAttribute("data-video-request");
    await first.turn.evaluate((node) => {
      window.__videoTurn = node;
    });
    await first.turn
      .locator('[class*="request-message_"]')
      .getByText(prompt, { exact: true })
      .waitFor();
    await first.turn
      .getByRole("button", {
        name: "查看参考素材：first-frame.png",
        exact: true,
      })
      .waitFor();
    const status = first.turn.locator('[class*="request-status_"]');
    assert.equal(await status.getAttribute("role"), "status");
    assert.equal(await status.getAttribute("aria-live"), "polite");
    assert(
      !/\d+(?:\.\d+)?%/.test(await status.innerText()),
      "Unknown progress must not invent a percentage",
    );
    await until(() => first.job.gets > 0, "Initial GET starts");
    await page.getByRole("textbox", { name: "视频提示词" }).fill(nextDraft);
    await upload(page, "next-frame.png");
    first.job.progress = 37;
    await until(
      async () => /37\s*%/.test(await status.innerText()),
      "Real provider progress is displayed",
    );
    pass("request snapshot, unknown/real progress and independent next draft");

    first.job.status = "completed";
    const video = await playable(first.turn);
    assert.equal(await first.turn.getAttribute("data-video-request"), id);
    assert(
      await first.turn.evaluate((node) => node === window.__videoTurn),
      "Completion keeps the same turn node",
    );
    assert.equal(
      await page.getByRole("textbox", { name: "视频提示词" }).inputValue(),
      nextDraft,
    );
    await page
      .getByRole("button", { name: "移除素材 next-frame.png", exact: true })
      .waitFor();
    await first.turn
      .getByRole("button", { name: "下载视频", exact: true })
      .waitFor();
    await first.turn
      .getByRole("button", { name: "复用配置", exact: true })
      .waitFor();
    await video.evaluate((node) => node.play());
    await until(
      () => video.evaluate((node) => node.currentTime > 0),
      "Decoded fixture video plays",
    );
    assert(
      await video.evaluate((node) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(node, 0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        node.pause();
        return r > 200 && g < 50 && b < 50;
      }),
      "Video contains the expected decoded pixels",
    );
    pass("in-place success, portrait ratio, controls and decoded playback");
    await page.screenshot({ path: path.join(output, "flow-success.png") });
    if (smoke) {
      assert.deepEqual(state.errors, []);
      report.cases.push({
        scenario: "happy-path",
        checks,
        errors: state.errors,
      });
      return;
    }

    const download = page.waitForEvent("download");
    await first.turn
      .getByRole("button", { name: "下载视频", exact: true })
      .click();
    assert((await download).suggestedFilename().endsWith(".mp4"));
    const more = first.turn.getByLabel("更多视频操作", { exact: true });
    await more.click();
    await page.getByRole("button", { name: "删除视频", exact: true }).waitFor();
    assert.equal(
      await page.getByTestId("publish-to-community").count(),
      0,
      "Standalone local preview has no verified community bridge",
    );
    await page.keyboard.press("Escape");
    await first.turn
      .getByRole("button", { name: "复用配置", exact: true })
      .click();
    assert.equal(
      await page.getByRole("textbox", { name: "视频提示词" }).inputValue(),
      prompt,
    );
    await page
      .getByRole("button", { name: "移除素材 first-frame.png", exact: true })
      .waitFor();
    const reused = await readVideoState(page, draftKey);
    assert.equal(reused.size, "720x1280");
    assert.equal(reused.duration, 8);
    assert.equal(reused.materials[0].name, "first-frame.png");
    pass(
      "download and more actions; explicit reuse restores parameters and materials",
    );

    const paused = await submit(state, "QA_VIDEO_PAUSE");
    await until(() => paused.job.gets > 0, "Pending task queried before pause");
    await paused.turn
      .getByRole("button", { name: "停止等待", exact: true })
      .click();
    const resume = paused.turn.getByRole("button", {
      name: "继续查询",
      exact: true,
    });
    await resume.waitFor();
    const submitted = jobs.length;
    paused.job.status = "completed";
    const gets = paused.job.gets;
    await resume.click();
    await until(() => paused.job.gets > gets, "Resume starts GET polling");
    await playable(paused.turn);
    assert.equal(
      jobs.length,
      submitted,
      "Continuing never repeats a paid POST",
    );
    pass("stop waiting and GET-only continuation");

    const failed = await submit(state, "QA_VIDEO_FAILURE");
    failed.job.status = "failed";
    await failed.turn.getByText(/QA_PROVIDER_REJECTED/).waitFor();
    assert.equal(await failed.turn.locator("video").count(), 0);
    await failed.turn
      .getByRole("button", { name: "重新生成", exact: true })
      .click();
    await until(
      () => jobs.length === submitted + 2,
      "Retry submits exactly one new generation",
    );
    jobs.at(-1).status = "completed";
    const retry = turnFor(page, "QA_VIDEO_FAILURE");
    assert.notEqual(
      await retry.getAttribute("data-video-request"),
      await failed.turn.getAttribute("data-video-request"),
    );
    await playable(retry);
    await failed.turn.getByText(/QA_PROVIDER_REJECTED/).waitFor();
    pass("failure explanation and explicit retry preserve the failed turn");

    const restored = await submit(state, "QA_VIDEO_RELOAD_PENDING");
    await until(
      () => restored.job.gets > 0,
      "Pending recovery job reaches upstream",
    );
    await page.getByRole("textbox", { name: "视频提示词" }).fill(nextDraft);
    await until(
      async () => (await readVideoState(page, draftKey))?.prompt === nextDraft,
      "The next draft is durably stored before reload",
    );
    const beforeReload = { posts: jobs.length, gets: restored.job.gets };
    await page.reload({ waitUntil: "domcontentloaded" });
    const recovered = turnFor(page, "QA_VIDEO_RELOAD_PENDING");
    await recovered.waitFor();
    await until(
      () => restored.job.gets > beforeReload.gets,
      "Reload resumes a saved GET",
    );
    assert.equal(jobs.length, beforeReload.posts);
    assert.equal(
      await page.getByRole("textbox", { name: "视频提示词" }).inputValue(),
      nextDraft,
    );
    restored.job.status = "completed";
    await playable(recovered);
    pass("reload restores pending query and draft without a duplicate POST");

    const arriving = await submit(state, "QA_VIDEO_NEW_RESULT");
    const area = page.locator('[class*="result-area_"]');
    await area.evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event("scroll"));
    });
    const before = await area.evaluate((node) => node.scrollTop);
    arriving.job.status = "completed";
    const arrivingId = await arriving.turn.getAttribute("data-video-request");
    await until(
      async () =>
        (await readVideoState(page, resultsKey))?.some(
          (item) => item.id === arrivingId && item.status === "success",
        ),
      "The offscreen request completes",
    );
    const newResults = page.getByRole("button", {
      name: "查看新结果",
      exact: true,
    });
    await newResults.waitFor();
    assert(
      Math.abs((await area.evaluate((node) => node.scrollTop)) - before) < 3,
      "Completing a new result must not pull a reader away from history",
    );
    await newResults.click();
    await until(
      () =>
        area.evaluate(
          (node) => node.scrollHeight - node.scrollTop - node.clientHeight < 80,
        ),
      "New-results control returns to the latest turn",
    );
    pass("reading history stays anchored and new-results navigation works");
    const saved = await readVideoState(page, resultsKey);
    const created = new Map(saved.map((item) => [item.id, item.createdAt]));
    const order = await page
      .locator("article[data-video-request]")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.videoRequest));
    assert(
      order.every((id) => typeof created.get(id) === "number"),
      "Every displayed turn has a durable creation timestamp",
    );
    assert.deepEqual(
      order.map((id) => created.get(id)),
      order.map((id) => created.get(id)).sort((a, b) => a - b),
      "Turns remain chronological after pending updates",
    );
    await geometry(state);
    assert.deepEqual(state.errors, []);
    assert.equal(
      state.calls.filter(
        (call) =>
          call.method !== "GET" &&
          !(call.method === "POST" && call.path === "/api/v1/videos"),
      ).length,
      0,
      "No upstream cancellation or account write",
    );
    report.cases.push({
      scenario: "conversation-lifecycle",
      checks,
      errors: state.errors,
      posts: jobs.length,
    });
  } catch (error) {
    await page
      .screenshot({ path: path.join(output, "failure-flow.png") })
      .catch(() => {});
    report.cases.push({
      scenario: "conversation-lifecycle",
      checks,
      errors: state.errors,
      error: error.stack,
    });
    throw error;
  } finally {
    await state.context.close();
  }
}

async function runLayout(browser, clip, output, options) {
  const state = await fixture(browser, clip, { ...options, historyCount: 1 });
  const { page } = state;
  const label = `${options.width}x${options.height}-${options.theme}`;
  try {
    const existing = page.locator('article[data-video-request="history-0"]');
    await playable(existing);
    await upload(page, "mobile-frame.png");
    const pending = await submit(state, `QA_LAYOUT_${label}`);
    await pending.turn.locator('[class*="request-status_"]').waitFor();
    const layout = await geometry(state);
    if (options.reducedMotion === "reduce") {
      const animations = await page
        .locator('[class*="video-workspace_video-workspace__"]')
        .evaluate((node) =>
          node.getAnimations({ subtree: true }).map((animation) => ({
            name: animation.animationName,
            property: animation.transitionProperty,
            target: String(animation.effect?.target?.className),
            playState: animation.playState,
            duration: animation.effect?.getTiming().duration,
            iterations: animation.effect?.getTiming().iterations,
          })),
        );
      const active = animations.filter(
        (animation) =>
          animation.playState === "running" &&
          Number(animation.duration) > 1 &&
          !(
            animation.iterations === 1 &&
            Number(animation.duration) <= 200 &&
            ["opacity", "color", "background-color", "border-color"].includes(
              animation.property,
            )
          ),
      );
      if (active.length)
        console.error(JSON.stringify({ reducedMotionAnimations: active }));
      assert(
        active.length === 0,
        "Reduced motion removes continuous and entrance animation",
      );
    }
    await page.screenshot({ path: path.join(output, `layout-${label}.png`) });
    assert.deepEqual(state.errors, []);
    report.cases.push({
      scenario: label,
      layout,
      reducedMotion: options.reducedMotion,
      errors: state.errors,
    });
    console.log(`PASS video conversation layout ${label}`);
  } catch (error) {
    await page
      .screenshot({ path: path.join(output, `failure-${label}.png`) })
      .catch(() => {});
    report.cases.push({
      scenario: label,
      errors: state.errors,
      error: error.stack,
    });
    throw error;
  } finally {
    await state.context.close();
  }
}

async function runScrollProbe(browser, clip, output) {
  const state = await fixture(browser, clip, { historyCount: 12 });
  const { page } = state;
  let releaseQuery;
  let scrollCalls = [];
  try {
    const pending = await submit(state, "QA_SMOOTH_SCROLL_PENDING");
    const area = page.locator('[class*="result-area_"]');
    await area.evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event("scroll"));
    });
    pending.job.progress = 11;
    await until(
      async () =>
        /11\s*%/.test(
          await pending.turn.locator('[class*="request-status_"]').innerText(),
        ),
      "Initial pending progress exposes new-results navigation",
    );
    const newResults = page.getByRole("button", {
      name: "查看新结果",
      exact: true,
    });
    await newResults.waitFor();
    pending.job.queryGate = () =>
      new Promise((resolve) => {
        releaseQuery = resolve;
      });
    await until(
      () => Boolean(releaseQuery),
      "The next GET is held for the smooth-scroll probe",
    );
    await area.evaluate((node) => {
      window.__videoScrollCalls = [];
      const original = node.scrollTo.bind(node);
      node.scrollTo = (...args) => {
        window.__videoScrollCalls.push({
          at: performance.now(),
          behavior: args[0]?.behavior ?? "auto",
          top: args[0]?.top,
          before: node.scrollTop,
        });
        return original(...args);
      };
    });
    const posts = state.jobs.length;
    await newResults.click();
    pending.job.progress = 38;
    releaseQuery();
    releaseQuery = undefined;
    pending.job.queryGate = undefined;
    await until(
      async () =>
        /38\s*%/.test(
          await pending.turn.locator('[class*="request-status_"]').innerText(),
        ),
      "The pending task updates during smooth navigation",
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    scrollCalls = await page.evaluate(() => window.__videoScrollCalls);
    const smooth = scrollCalls.find((call) => call.behavior === "smooth");
    assert(smooth, "New-results navigation starts a smooth scroll");
    const interruptions = scrollCalls.filter(
      (call) =>
        call !== smooth &&
        call.at >= smooth.at &&
        call.at - smooth.at < 500 &&
        call.behavior !== "smooth",
    );
    console.log(JSON.stringify({ scrollCalls, interruptions }));
    assert.equal(state.jobs.length, posts, "Progress injection is GET only");
    assert.deepEqual(
      interruptions,
      [],
      "Pending progress must not interrupt the smooth-scroll intent",
    );
    await until(
      () =>
        area.evaluate(
          (node) => node.scrollHeight - node.scrollTop - node.clientHeight < 80,
        ),
      "The smooth-scroll probe reaches the latest result",
    );
    await page.screenshot({ path: path.join(output, "scroll-probe.png") });
    report.cases.push({
      scenario: "smooth-scroll-progress",
      scrollCalls,
      errors: state.errors,
    });
    console.log("PASS video conversation smooth-scroll-progress");
  } catch (error) {
    await page
      .screenshot({ path: path.join(output, "failure-scroll-probe.png") })
      .catch(() => {});
    report.cases.push({
      scenario: "smooth-scroll-progress",
      scrollCalls,
      errors: state.errors,
      error: error.stack,
    });
    throw error;
  } finally {
    releaseQuery?.();
    await state.context.close();
  }
}

async function runPendingActions(browser, clip, output) {
  for (const noUpstream of [false, true]) {
    const scenario = noUpstream
      ? "paused-no-upstream-actions"
      : "pending-and-paused-actions";
    const state = await fixture(browser, clip, {
      initialResults: noUpstream
        ? [
            {
              id: "paused-no-upstream",
              status: "pending",
              phase: "paused",
              prompt: "QA_PAUSED_BEFORE_TASK_ID",
              model,
              mode: "image-to-video",
              createdAt: Date.now(),
            },
          ]
        : [],
    });
    const { page } = state;
    try {
      const turn = noUpstream
        ? page.locator('article[data-video-request="paused-no-upstream"]')
        : (await submit(state, "QA_PENDING_ACTIONS")).turn;
      await turn.waitFor();
      const id = await turn.getAttribute("data-video-request");
      const openDelete = async () => {
        await turn.getByRole("button", { name: "更多视频操作" }).click();
        await page
          .getByRole("button", { name: "删除视频", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog
          .getByText("删除这条本地记录并停止等待？服务端任务可能仍在运行。", {
            exact: true,
          })
          .waitFor();
        return dialog;
      };
      if (!noUpstream) {
        const dialog = await openDelete();
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
        await turn
          .getByRole("button", { name: "停止等待", exact: true })
          .click();
      }
      await turn.getByText("已停止等待", { exact: true }).waitFor();
      await turn.getByRole("button", { name: "复用", exact: true }).waitFor();
      if (noUpstream) {
        assert.equal(
          await turn.getByRole("button", { name: "继续查询" }).count(),
          0,
        );
        const result = (await readVideoState(page, resultsKey)).find(
          (item) => item.id === id,
        );
        assert.equal(result.upstreamId, undefined);
      }
      const dialog = await openDelete();
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      await turn.waitFor({ state: "detached" });
      await until(
        async () =>
          !(await readVideoState(page, resultsKey)).some(
            (item) => item.id === id,
          ),
        "Deleting the local pending record is durable",
      );
      assert.equal(
        state.calls.filter(
          (call) =>
            call.method !== "GET" &&
            !(call.method === "POST" && call.path === "/api/v1/videos"),
        ).length,
        0,
        "Deleting a local record never issues an upstream cancellation",
      );
      assert.equal(state.jobs.length, noUpstream ? 0 : 1);
      assert.deepEqual(state.errors, []);
      await page.screenshot({
        path: path.join(output, `${scenario}.png`),
      });
      report.cases.push({ scenario, errors: state.errors });
      console.log(`PASS video conversation ${scenario}`);
    } catch (error) {
      await page
        .screenshot({ path: path.join(output, `failure-${scenario}.png`) })
        .catch(() => {});
      report.cases.push({
        scenario,
        errors: state.errors,
        error: error.stack,
      });
      throw error;
    } finally {
      await state.context.close();
    }
  }
}

async function main() {
  const output =
    process.env.UI_TEST_OUTPUT_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), "octopus-video-conversation-"));
  fs.mkdirSync(output, { recursive: true });
  const clip = makeClip(output);
  const browser = await chromium.launch({
    channel: process.env.UI_TEST_BROWSER || "msedge",
    headless: true,
  });
  try {
    if (
      process.argv.includes("--scroll-probe") ||
      process.argv.includes("--pending-actions")
    ) {
      if (process.argv.includes("--scroll-probe"))
        await runScrollProbe(browser, clip, output);
      else await runPendingActions(browser, clip, output);
      console.log(
        JSON.stringify({
          passed: true,
          cases: report.cases.length,
          paidRequests: 0,
          output,
        }),
      );
      return;
    }
    const selectedLayout = process.argv
      .find((argument) => argument.startsWith("--layout="))
      ?.slice("--layout=".length);
    if (!selectedLayout)
      await runFlow(browser, clip, output, process.argv.includes("--smoke"));
    if (!process.argv.includes("--smoke"))
      for (const options of [
        { width: 1440, height: 950, theme: "dark" },
        { width: 320, height: 740, theme: "light" },
        { width: 390, height: 844, theme: "dark", reducedMotion: "reduce" },
        { width: 430, height: 932, theme: "light" },
        { width: 844, height: 390, theme: "dark", touch: true },
      ])
        if (
          !selectedLayout ||
          `${options.width}x${options.height}-${options.theme}` ===
            selectedLayout
        )
          await runLayout(browser, clip, output, options);
    console.log(
      JSON.stringify({
        passed: true,
        cases: report.cases.length,
        paidRequests: 0,
        output,
      }),
    );
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(output, "verification.json"),
      JSON.stringify(report, null, 2),
    );
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { readVideoState, writeVideoState };
