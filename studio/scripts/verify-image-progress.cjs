// Local image streams only; model and account APIs are mocked.
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7F8AAAAASUVORK5CYII=",
  "base64",
);
const image = Buffer.concat([png, Buffer.alloc(1024 * 1024 - png.length)]);

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "image/png");
    if (req.url.startsWith("/known"))
      res.setHeader("Content-Length", image.length);
    res.flushHeaders();
    let offset = 0;
    const timer = setInterval(() => {
      if (offset >= image.length) {
        clearInterval(timer);
        res.end();
      } else {
        res.write(image.subarray(offset, offset + 65536));
        offset += 65536;
      }
    }, 350);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["blob:", "data:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === "/__image-progress-fixture")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Image progress fixture</title>",
      });
    if (url.pathname === "/api/proxy-image") return route.continue();
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { newApiEnabled: false, needCode: false, hasModelApiKey: true },
      });
    if (url.pathname === "/api/new-api/status")
      return route.fulfill({
        json: { success: true, data: { enabled: false } },
      });
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({ json: { data: [{ id: "gpt-image-2" }] } });
    return route.continue();
  });

  try {
    await page.goto(new URL("/__image-progress-fixture", base).href);
    await page.evaluate(async (imageBase) => {
      const modelConfig = {
        model: "gpt-image-2",
        providerName: "gpt",
        template: "{{input}}",
        sendMemory: false,
      };
      const session = (id, topic, image) => ({
        id,
        topic,
        memoryPrompt: "",
        lastUpdate: Date.now(),
        stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
        mask: {
          id,
          name: id,
          context: [],
          modelConfig,
          syncGlobalConfig: false,
          lang: "cn",
        },
        messages: [
          {
            id: `${id}-u`,
            role: "user",
            content: "图片下载进度测试",
            date: new Date().toISOString(),
          },
          {
            id: `${id}-a`,
            role: "assistant",
            content: `![Generated Image](${imageBase}/${image}.png)`,
            model: "gpt-image-2",
            ...(id === "known" && { imageRequestDurationMs: 65432 }),
            date: new Date().toISOString(),
          },
        ],
      });
      const open = indexedDB.open("keyval-store", 1);
      const db = await new Promise((resolve, reject) => {
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const tx = db.transaction("keyval", "readwrite");
      tx.objectStore("keyval").put(
        JSON.stringify({
          version: 3.4,
          state: {
            currentSessionIndex: 0,
            sessions: [
              session("known", "Download size known", "known"),
              session("unknown", "Download size unknown", "unknown"),
            ],
          },
        }),
        "chat-next-web-store",
      );
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem("lang", "cn");
      localStorage.setItem(
        "app-config",
        JSON.stringify({
          version: 4.3,
          state: {
            modelConfig,
            theme: "light",
            enableAutoGenerateTitle: false,
          },
        }),
      );
    }, `http://127.0.0.1:${server.address().port}`);
    await page.goto(base + "#/chat");
    const progress = page.getByRole("progressbar", { name: "图片下载进度" });
    await page.waitForFunction(
      () => {
        const element = document.querySelector(
          'progress[aria-label="图片下载进度"]',
        );
        return element && element.value > 0 && element.value < 100;
      },
      null,
      { timeout: 30000 },
    );
    assert.match(
      await page.getByRole("status").filter({ has: progress }).innerText(),
      /正在下载图片/,
    );
    await page
      .getByText(/下载耗时 00:0[1-9]/)
      .first()
      .waitFor();
    await page.getByText("请求耗时 01:05", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(os.tmpdir(), "octopus-image-progress-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(os.tmpdir(), "octopus-image-progress-mobile.png"),
    });
    await page
      .locator('img[alt="Generated Image"]')
      .waitFor({ timeout: 20000 });
    assert.equal(await progress.count(), 0);
    assert.equal(
      await page.getByText("请求耗时 01:05", { exact: true }).count(),
      1,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByText("Download size unknown", { exact: true })
      .first()
      .click();
    await progress.waitFor();
    assert.equal(await page.getByText(/请求耗时/).count(), 0);
    assert.equal(await progress.getAttribute("value"), null);
    await page.getByText(/已下载 \d/).waitFor();
    await page.screenshot({
      path: path.join(os.tmpdir(), "octopus-image-progress-unknown.png"),
    });
    await page
      .locator('img[alt="Generated Image"]')
      .waitFor({ timeout: 20000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        knownLength: "real percentage and elapsed time",
        unknownLength: "bytes without invented percentage",
        completed: "image decoded; progress removed",
        screenshots: ["desktop", "mobile", "unknown"].map((name) =>
          path.join(os.tmpdir(), `octopus-image-progress-${name}.png`),
        ),
      }),
    );
  } catch (error) {
    await page.screenshot({
      path: path.join(os.tmpdir(), "octopus-image-progress-failure.png"),
    });
    console.error((await page.locator("body").innerText()).slice(0, 2500));
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
