// All account/model endpoints are fixtures. No paid generation request is sent.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=";
const modelConfig = {
  model: "gpt-4o",
  providerName: "gpt",
  stream: true,
  sendMemory: false,
  historyMessageCount: 20,
  max_tokens: 4000,
  template: "{{input}}",
  imageResponseFormat: "b64_json",
};
const chat = (id, topic) => ({
  id,
  topic,
  messages: [
    {
      id: `${id}-m`,
      role: "assistant",
      content: `${topic} PRIVATE CONTENT`,
      date: new Date().toISOString(),
    },
  ],
  mask: {
    id: "mask",
    name: "mask",
    context: [],
    modelConfig,
    syncGlobalConfig: false,
    lang: "cn",
  },
  memoryPrompt: "",
  lastUpdate: Date.now(),
  lastSummarizeIndex: 0,
  stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
});
async function setup(browser, width, seed) {
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    serviceWorkers: "block",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const state = {
    userId: 7,
    queries: 0,
    paid: 0,
    videoPosts: 0,
    enableVideo: false,
    slowReads: false,
    readStarts: [],
    sessionReads: 0,
  };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ seed, chats, modelConfig }) => {
      localStorage.setItem("lang", "cn");
      if (localStorage.getItem("fixture-seeded")) return;
      localStorage.setItem("fixture-seeded", "1");
      localStorage.setItem(
        "app-config",
        JSON.stringify({
          version: 4.3,
          state: {
            theme: "light",
            colorTheme: "violet",
            models: [],
            modelConfig,
            enableAutoGenerateTitle: false,
          },
        }),
      );
      localStorage.setItem("custom_api_key", "sk-DO-NOT-EXPORT");
      if (seed)
        for (const [owner, session] of Object.entries(chats)) {
          const key =
            owner === "legacy"
              ? "chat-next-web-store"
              : `octopus:${owner}:chat-next-web-store`;
          localStorage.setItem(
            key,
            JSON.stringify({
              version: 3.4,
              state: { sessions: [session], currentSessionIndex: 0 },
            }),
          );
        }
    },
    {
      seed,
      chats: {
        "user-7": chat("a", "Account A"),
        "user-8": chat("b", "Account B"),
        legacy: chat("old", "Legacy History"),
      },
      modelConfig,
    },
  );
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (req.headers()["next-action"])
      return route.fulfill({
        contentType: "text/x-component",
        body: '0:[false,["fixture",null]]\n',
      });
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (url.pathname === "/api/new-api/status") {
      if (state.slowReads) {
        state.readStarts.push({ path: "status", at: Date.now() });
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return ok({
        enabled: true,
        configured: true,
        passwordLoginEnabled: true,
        quotaPerUnit: 500000,
        currencySymbol: "$",
      });
    }
    if (url.pathname === "/api/new-api/session") {
      state.sessionReads++;
      if (state.slowReads) {
        state.readStarts.push({ path: "session", at: Date.now() });
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return ok({
        authenticated: true,
        selectedTokenId: 100,
        user: {
          id: state.userId,
          username: "fixture",
          display_name: "Fixture Account",
          quota: 500000,
          used_quota: 0,
          request_count: 0,
          group: "default",
        },
      });
    }
    if (url.pathname === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true, needCode: false } });
    if (url.pathname === "/api/remote-models")
      return route.fulfill({
        json: { data: [{ id: "gpt-4o" }, { id: "sora-2" }] },
      });
    if (url.pathname === "/api/new-api/tokens")
      return ok({
        items: [
          {
            id: 100,
            name: "Fixture",
            status: 1,
            unlimited_quota: true,
            expired_time: -1,
            remain_quota: 1,
            used_quota: 0,
            group: "",
          },
        ],
        page: 1,
        size: 20,
        total: 1,
      });
    if (url.pathname === "/api/new-api/groups")
      return ok([{ id: "default", name: "Default", ratio: 1 }]);
    if (url.pathname === "/api/new-api/auto-groups")
      return ok({ supported: false, defaultGroups: [], maxCount: 1 });
    if (url.pathname === "/api/new-api/logs")
      return ok({ items: [], page: 1, size: 10, total: 0 });
    if (url.pathname === "/api/proxy-image")
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(png.split(",")[1], "base64"),
      });
    if (
      /\/api\/v1\/images\/generations/.test(url.pathname) &&
      req.method() === "GET"
    ) {
      state.queries++;
      return route.fulfill({
        json: {
          status: "success",
          data: [{ url: "https://fixture.test/recovered.png" }],
        },
      });
    }
    if (
      state.enableVideo &&
      url.pathname === "/api/v1/videos/generations" &&
      req.method() === "POST"
    ) {
      state.videoPosts++;
      assert.equal(req.headers()["x-new-api-token"], "100");
      assert.equal(req.postDataJSON().prompt, "Mocked video prompt");
      return route.fulfill({
        json: { id: "fixture-video-task", status: "pending" },
      });
    }
    if (
      state.enableVideo &&
      url.pathname === "/api/v1/videos/fixture-video-task" &&
      req.method() === "GET"
    ) {
      return route.fulfill({
        json: {
          status: "completed",
          video_url: "https://fixture.test/video.mp4",
        },
      });
    }
    if (/\/(?:chat\/completions|images\/|videos\/)/.test(url.pathname)) {
      state.paid++;
      return route.abort();
    }
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({ json: { data: [], enabled: false } });
    if (url.pathname.startsWith("/google-fonts")) return route.abort();
    return route.continue();
  });
  return { context, page, state, errors };
}
async function readChat(page, owner = "user-7") {
  return page.evaluate(
    async (owner) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            key = `octopus:${owner}:chat-next-web-store`;
          const tx = db.transaction("keyval", "readonly"),
            read = tx.objectStore("keyval").get(key);
          read.onsuccess = () =>
            resolve(JSON.parse(read.result || localStorage.getItem(key)));
          tx.oncomplete = () => db.close();
        };
      }),
    owner,
  );
}
async function seedGallery(page, count) {
  await page.evaluate(
    async ({ count }) =>
      new Promise((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        canvas.getContext("2d").fillRect(0, 0, 1, 1);
        const png = canvas.toDataURL("image/png");
        const req = indexedDB.open("octopus-gallery-user-7", 1);
        req.onupgradeneeded = () => {
          const db = req.result,
            store = db.createObjectStore("images", { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("model", "model");
          db.createObjectStore("settings", { keyPath: "key" });
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("images", "readwrite");
          for (let i = 0; i < count; i++)
            tx.objectStore("images").put({
              id: `img-${i}`,
              prompt: `Fixture picture ${i}`,
              model: "gpt-image-1",
              createdAt: 100000 + i,
              width: 1,
              height: 1,
              status: "success",
              imageData: png,
            });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { count, png },
  );
}
async function run(browser, width) {
  const source = await setup(browser, width, true);
  const target = await setup(browser, width, false);
  try {
    await source.page.goto(`${base}#/chat`);
    await source.page
      .getByText("Account A PRIVATE CONTENT", { exact: true })
      .waitFor();
    assert.equal(
      await source.page
        .getByText("Account B PRIVATE CONTENT", { exact: true })
        .count(),
      0,
    );
    source.state.userId = 8;
    await source.page.evaluate(() =>
      window.dispatchEvent(new Event("new-api-session-changed")),
    );
    await source.page
      .getByText("Account B PRIVATE CONTENT", { exact: true })
      .waitFor();
    assert.equal(
      await source.page
        .getByText("Account A PRIVATE CONTENT", { exact: true })
        .count(),
      0,
    );
    source.state.userId = 7;
    await source.page.reload();
    await source.page
      .getByText("Account A PRIVATE CONTENT", { exact: true })
      .waitFor();
    source.state.slowReads = true;
    await source.page.goto(`${base}#/account`);
    await source.page.getByText("我的 API 密钥", { exact: true }).waitFor();
    const statusStart = source.state.readStarts.find(
      (item) => item.path === "status",
    );
    const sessionStart = source.state.readStarts.find(
      (item) => item.path === "session",
    );
    assert(statusStart && sessionStart);
    assert(
      Math.abs(statusStart.at - sessionStart.at) < 150,
      "Account initialization reads must start concurrently",
    );
    const readsBeforeFocus = source.state.sessionReads;
    await source.page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await source.page.waitForTimeout(550);
    assert.equal(
      source.state.sessionReads - readsBeforeFocus,
      1,
      "Focus and visibility refresh should merge",
    );
    source.state.slowReads = false;
    assert.equal(
      await source.page.getByRole("region", { name: "本地数据与备份" }).count(),
      0,
    );
    await seedGallery(source.page, 65);
    await source.page.goto(`${base}#/gallery`);
    await source.page.locator('img[class*="card-image_"]').first().waitFor();
    assert.equal(
      await source.page.locator('img[class*="card-image_"]').count(),
      60,
    );
    await source.page.getByRole("button", { name: /加载更多/ }).click();
    await source.page.waitForFunction(
      () =>
        document.querySelectorAll('img[class*="card-image_"]').length === 65,
    );
    await source.page.goto(`${base}#/settings`);
    const panel = source.page.getByRole("region", { name: "本地数据与备份" });
    assert.equal(await panel.getByRole("checkbox").count(), 0);
    const imageSwitch = panel.getByRole("switch", { name: "图片作品原图" });
    assert.equal(await imageSwitch.getAttribute("aria-checked"), "false");
    await imageSwitch.click();
    assert.equal(await imageSwitch.getAttribute("aria-checked"), "true");
    const downloadEvent = source.page.waitForEvent("download");
    await panel.getByRole("button", { name: "导出备份", exact: true }).click();
    const download = await downloadEvent;
    const content = await fs.readFile(await download.path(), "utf8");
    const backup = JSON.parse(content);
    assert.equal(backup.chats[0].id, "a");
    assert.equal(backup.images.length, 65);
    assert.equal(backup.settings.modelConfig.imageResponseFormat, "b64_json");
    assert.equal(
      backup.chats[0].mask.modelConfig.imageResponseFormat,
      "b64_json",
    );
    assert(!content.includes("DO-NOT-EXPORT"));
    assert(
      !content.includes("Account B") && !content.includes("Legacy History"),
    );
    await panel.scrollIntoViewIfNeeded();
    assert(
      await panel.evaluate((element) =>
        [...element.querySelectorAll("button")].every((button) => {
          const parent = element.getBoundingClientRect();
          const bounds = button.getBoundingClientRect();
          return (
            bounds.left >= parent.left - 1 &&
            bounds.right <= parent.right + 1 &&
            button.scrollWidth <= button.clientWidth + 1
          );
        }),
      ),
      "Backup controls must fit at every viewport",
    );
    await source.page.screenshot({
      path: path.join(os.tmpdir(), `octopus-local-backup-${width}.png`),
    });
    await source.page.evaluate(() => document.body.classList.add("dark"));
    await source.page.waitForTimeout(400);
    await source.page.screenshot({
      path: path.join(os.tmpdir(), `octopus-local-backup-dark-${width}.png`),
    });
    await source.page.evaluate(() => document.body.classList.remove("dark"));
    await source.page.waitForTimeout(400);
    await panel
      .getByRole("button", { name: "认领旧版本地历史", exact: true })
      .click();
    const sourceReload = source.page.waitForEvent(
      "framenavigated",
      (frame) => frame === source.page.mainFrame(),
    );
    await source.page
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await sourceReload;
    await source.page.getByRole("region", { name: "本地数据与备份" }).waitFor();
    await source.page.waitForFunction(
      () => localStorage.getItem("octopus:user-7:legacy-imported") === "1",
    );
    assert(
      (await readChat(source.page)).state.sessions.some(
        (item) => item.id === "old",
      ),
    );
    assert(
      await source.page.evaluate(() =>
        localStorage.getItem("chat-next-web-store"),
      ),
    );
    await target.page.goto(`${base}#/settings`);
    const peer = await target.context.newPage();
    peer.on("pageerror", (error) => target.errors.push(error.message));
    await peer.goto(`${base}#/chat`);
    await peer.locator("#chat-input").waitFor();
    const targetPanel = target.page.getByRole("region", {
      name: "本地数据与备份",
    });
    await targetPanel.locator('input[type="file"]').setInputFiles({
      name: "fixture-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(content),
    });
    await targetPanel.getByText(/65 张图片/).waitFor();
    await targetPanel
      .getByRole("button", { name: "确认导入", exact: true })
      .click();
    const targetReload = target.page.waitForEvent(
      "framenavigated",
      (frame) => frame === target.page.mainFrame(),
    );
    await target.page
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await targetReload;
    await target.page.getByRole("region", { name: "本地数据与备份" }).waitFor();
    const responseFormat = target.page.getByLabel("返回格式", { exact: true });
    if ((await responseFormat.evaluate((node) => node.tagName)) === "SELECT") {
      assert.equal(await responseFormat.inputValue(), "b64_json");
    } else {
      assert.match(await responseFormat.innerText(), /Base64/);
    }
    await target.page.goto(`${base}#/chat`);
    await target.page
      .getByText("Account A PRIVATE CONTENT", { exact: true })
      .waitFor();
    await peer
      .getByText("Account A PRIVATE CONTENT", { exact: true })
      .waitFor();
    assert(
      (await readChat(target.page)).state.sessions.some(
        (item) => item.id === "a",
      ),
    );
    await target.page.goto(`${base}#/gallery`);
    const images = target.page.locator('img[class*="card-image_"]');
    await images.first().waitFor();
    await images.first().scrollIntoViewIfNeeded();
    try {
      await target.page.waitForFunction(
        () =>
          document.querySelector('img[class*="card-image_"]')?.naturalWidth > 0,
        undefined,
        { timeout: 5000 },
      );
    } catch (error) {
      console.log(
        await images.first().evaluate((image) => ({
          src: image.src,
          width: image.naturalWidth,
          className: image.className,
          text: image.parentElement.textContent,
        })),
      );
      console.log(
        await images.first().evaluate(async (image) => {
          try {
            const response = await fetch(image.src);
            const blob = await response.blob();
            const bytes = [...new Uint8Array(await blob.arrayBuffer())].slice(
              0,
              16,
            );
            return {
              status: response.status,
              size: blob.size,
              type: blob.type,
              bytes,
            };
          } catch (error) {
            return { fetchError: String(error) };
          }
        }),
      );
      console.log("backup-image", backup.images[0].imageData.slice(0, 180));
      await target.page.screenshot({
        path: path.join(os.tmpdir(), "octopus-local-data-image-debug.png"),
      });
      throw error;
    }
    const assets = await target.page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open("octopus-gallery-user-7", 3);
          req.onsuccess = () => {
            const db = req.result,
              tx = db.transaction(["images", "originals"]);
            const read = tx.objectStore("originals").get("img-0");
            read.onsuccess = () =>
              resolve({
                blob: read.result instanceof Blob,
                size: read.result?.size,
              });
            tx.oncomplete = () => db.close();
          };
        }),
    );
    assert(assets.blob && assets.size > 0);
    await target.page.evaluate(() =>
      localStorage.setItem(
        "octopus:user-7:task:recovery",
        JSON.stringify({
          id: "recovery",
          kind: "image",
          upstreamId: "fixture-task",
          tokenId: 100,
          sessionId: "a",
          messageId: "a-m",
          model: "gpt-image-1",
          prompt: "Recovery",
          createdAt: Date.now(),
        }),
      ),
    );
    await target.page.reload();
    await target.page.waitForFunction(
      () => !localStorage.getItem("octopus:user-7:task:recovery"),
    );
    assert(target.state.queries >= 1);
    target.state.enableVideo = true;
    await target.page.goto(`${base}#/video-workspace`);
    await target.page.locator("textarea").fill("Mocked video prompt");
    await target.page.getByTitle("生成视频", { exact: true }).click();
    await target.page.waitForFunction(() =>
      JSON.parse(
        localStorage.getItem("octopus:user-7:video-workspace-results") || "[]",
      ).some((item) => item.url === "https://fixture.test/video.mp4"),
    );
    assert.equal(target.state.videoPosts, 1);
    await target.page.goto(`${base}#/settings`);
    await target.page.evaluate(() =>
      localStorage.setItem(
        "octopus:user-7:task:clear-fixture",
        JSON.stringify({
          id: "clear-fixture",
          kind: "image",
          upstreamId: "must-not-restore",
          tokenId: 999,
          model: "gpt-image-1",
          prompt: "Clear",
          createdAt: Date.now(),
        }),
      ),
    );
    await target.page.evaluate(() =>
      localStorage.setItem(
        "octopus:user-8:video-workspace-results",
        "other-account-sentinel",
      ),
    );
    await target.page
      .getByRole("button", { name: "清除当前本地数据", exact: true })
      .click();
    const clearReload = target.page.waitForEvent(
      "framenavigated",
      (frame) => frame === target.page.mainFrame(),
    );
    await target.page
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await clearReload;
    await target.page.getByRole("region", { name: "本地数据与备份" }).waitFor();
    assert.equal(
      await target.page.evaluate(() =>
        localStorage.getItem("octopus:user-7:task:clear-fixture"),
      ),
      null,
    );
    assert.equal(
      await target.page.evaluate(() =>
        localStorage.getItem("octopus:user-7:video-workspace-results"),
      ),
      null,
    );
    assert.equal(
      await target.page.evaluate(() =>
        localStorage.getItem("octopus:user-8:video-workspace-results"),
      ),
      "other-account-sentinel",
    );
    assert(
      !(await readChat(target.page))?.state.sessions.some(
        (item) => item.id === "a",
      ),
    );
    assert.equal(source.state.paid + target.state.paid, 0);
    assert.deepEqual([...source.errors, ...target.errors], []);
    console.log(
      JSON.stringify({
        width,
        accountIsolation: true,
        crossDeviceBackup: true,
        originalBlob: true,
        pagination: 65,
        recoveryGetOnly: true,
        videoSubmissionMocked: true,
        scopedClear: true,
        legacyOwnership: true,
        crossTabImport: true,
        credentialsExcluded: true,
        concurrentAccountReads: true,
        mergedFocusRefresh: true,
        backupSwitchesWithoutCheckmarks: true,
      }),
    );
  } finally {
    await source.context.close();
    await target.context.close();
  }
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
