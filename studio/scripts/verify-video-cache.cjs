// Isolated real-video fixtures; all account and media endpoints are mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/86136/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const ranged = process.env.VIDEO_RANGE_FIXTURE === "1";
const expectedDownloads = ranged ? 3 : 1;
const output = fs.mkdtempSync(path.join(os.tmpdir(), "video-cache-"));
const file = path.join(output, "clip.mp4");
assert.equal(
  spawnSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=256x144:r=10",
    "-t",
    "1",
    "-pix_fmt",
    "yuv420p",
    file,
  ]).status,
  0,
);
const bytes = fs.readFileSync(file);
const cover = fs.readFileSync(
  path.join(__dirname, "../public/android-chrome-512x512.png"),
);

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 950 },
        serviceWorkers: "block",
      });
      await context.addInitScript(() => localStorage.setItem("lang", "cn"));
      let downloads = 0;
      const errors = [];
      const session = {
        authenticated: true,
        selectedTokenId: 10,
        user: {
          id: 7,
          username: "cover-test",
          group: "default",
          quota: 500000,
        },
      };
      await context.route("**/*", (route) => {
        const request = route.request(),
          url = new URL(request.url());
        if (["blob:", "data:"].includes(url.protocol)) return route.continue();
        if (url.origin !== new URL(base).origin) return route.abort();
        if (url.pathname === "/qa-cover.png")
          return route.fulfill({ contentType: "image/png", body: cover });
        if (!url.pathname.startsWith("/api/")) return route.continue();
        assert.equal(request.method(), "GET");
        const ok = (data) => route.fulfill({ json: { success: true, data } });
        if (url.pathname.endsWith("/videos/cover-fixture/content")) {
          downloads++;
          if (ranged) {
            const range = /^bytes=(\d+)-(\d+)$/.exec(
              request.headers().range || "",
            );
            assert.ok(range, "Account video requests must carry a byte range");
            const start = Number(range[1]);
            const end =
              start === 0 ? Math.floor(bytes.length / 3) - 1 : Number(range[2]);
            if (start !== 0)
              assert.equal(request.headers()["if-range"], '"fixture-v1"');
            return route.fulfill({
              status: 206,
              contentType: "video/mp4",
              headers: {
                "content-range": `bytes ${start}-${end}/${bytes.length}`,
                etag: '"fixture-v1"',
              },
              body: bytes.subarray(start, end + 1),
            });
          }
          return route.fulfill({ contentType: "video/mp4", body: bytes });
        }
        if (url.pathname.endsWith("/bootstrap"))
          return ok({ config: { newApiEnabled: true }, session });
        if (url.pathname.endsWith("/session")) return ok(session);
        if (url.pathname === "/api/config")
          return route.fulfill({ json: { newApiEnabled: true } });
        if (url.pathname.endsWith("/status"))
          return ok({ enabled: true, configured: true });
        if (url.pathname.endsWith("/models"))
          return route.fulfill({ json: { data: [] } });
        return ok([]);
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base + "#/gallery");
      await page
        .getByText("作品库", { exact: true })
        .waitFor({ timeout: 60000 });
      await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("keyval-store", 1);
          request.onupgradeneeded = () =>
            request.result.createObjectStore("keyval");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const video = {
          id: "cover-fixture",
          url: location.origin + "/api/v1/videos/cover-fixture/content",
          mediaPath: "videos/cover-fixture/content",
          coverUrl: location.origin + "/qa-cover.png",
          tokenId: 10,
          prompt: "封面加载验证",
          model: "sora-2",
          status: "success",
          createdAt: Date.now(),
        };
        await new Promise((resolve, reject) => {
          const tx = db.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put(
            JSON.stringify({
              version: 1,
              state: { results: [video], _hasHydrated: true },
            }),
            "octopus:user-7:video-workspace-results",
          );
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      });
      await page.reload();
      const button = () =>
        page.getByRole("button", {
          name: "预览视频 封面加载验证",
          exact: true,
        });
      await button().waitFor({ timeout: 60000 });
      await page.waitForFunction(
        () =>
          document.querySelector('button[aria-label^="预览视频"] img')
            ?.naturalWidth > 0,
      );
      assert.equal(downloads, 0, "A cover must not fetch the full video");
      await page.screenshot({ path: path.join(output, `cover-${width}.png`) });
      await button().click();
      await page.waitForFunction(
        () => document.querySelector("dialog video")?.readyState >= 2,
      );
      assert.equal(downloads, expectedDownloads);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.evaluate(() => {
        location.hash = "/settings";
      });
      await button().waitFor({ state: "detached" });
      await page.evaluate(() => {
        location.hash = "/gallery";
      });
      await button().waitFor({ timeout: 30000 });
      assert.equal(downloads, expectedDownloads);
      await button().click();
      await page.waitForFunction(
        () => document.querySelector("dialog video")?.readyState >= 2,
      );
      assert.equal(
        downloads,
        expectedDownloads,
        "Returning to the video must reuse the blob",
      );
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          width,
          ranged,
          firstViewVideoDownloads: 0,
          downloadsAfterPlayAndReturn: downloads,
          errors,
        }),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
