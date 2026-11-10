// Local fixtures only: generation, media and account APIs never reach a provider.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const output = process.env.UI_TEST_OUTPUT || path.join(os.tmpdir(), "octopus-image-batch");
fs.mkdirSync(output, { recursive: true });

async function run(browser, width, recovery) {
  const context = await browser.newContext({
    viewport: { width, height: 950 }, serviceWorkers: "block",
  });
  const page = await context.newPage();
  const errors = [], posts = [];
  const urls = Array.from({ length: 4 }, (_, index) => `https://media.test/${index}.png`);
  let fixtures = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === "/__batch-fixture")
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Batch fixture</title>" });
    if (request.headers()["next-action"])
      return route.fulfill({ contentType: "text/x-component", body: '0:{"a":false,"f":[]}\n' });
    if (url.pathname === "/api/proxy-image") {
      const index = Number(new URL(url.searchParams.get("url")).pathname.slice(1).split(".")[0]);
      return route.fulfill({ contentType: "image/png", body: fixtures[index] });
    }
    if (url.pathname.includes("async-images/v1/tasks")) {
      if (request.method() === "POST") {
        posts.push(request.postDataJSON());
        return route.fulfill({ status: 202, json: { id: "img-batch-fixture" } });
      }
      return route.fulfill({ json: {
        id: "img-batch-fixture", status: "succeeded", requested_n: 1, actual_n: 4,
        data: urls.map((url) => ({ url })),
      } });
    }
    const config = { newApiEnabled: false, needCode: false, hasModelApiKey: true, enableMcp: false };
    if (url.pathname === "/api/new-api/bootstrap")
      return route.fulfill({ json: { success: true, data: {
        config, session: { authenticated: false, user: null, selectedTokenId: null },
      } } });
    if (url.pathname === "/api/config") return route.fulfill({ json: config });
    if (url.pathname === "/api/new-api/status")
      return route.fulfill({ json: { success: true, data: { enabled: false } } });
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({ json: { data: [{ id: "midjourney-v8.2" }] } });
    if (!["GET", "HEAD"].includes(request.method())) return route.abort();
    return route.continue();
  });
  try {
    await page.goto(new URL("/__batch-fixture", base).href);
    const pictures = await page.evaluate(({ recovery }) => {
      const colors = ["#297a89", "#975970", "#50724e", "#9e743f"];
      const pictures = colors.map((color, index) => {
        const canvas = document.createElement("canvas");
        canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color; ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = "#ffffff"; ctx.font = "96px sans-serif";
        ctx.textAlign = "center"; ctx.fillText(String(index + 1), 320, 270);
        return canvas.toDataURL("image/png").split(",")[1];
      });
      const modelConfig = {
        model: "midjourney-v8.2", providerName: "gpt", template: "{{input}}",
        sendMemory: false, enableInjectSystemPrompts: false, historyMessageCount: 0,
        imageRequestMode: "async", imageResponseFormat: "url",
      };
      localStorage.setItem("lang", "cn");
      localStorage.setItem("app-config", JSON.stringify({ version: 4.3, state: {
        modelConfig, theme: "light", enableAutoGenerateTitle: false,
        models: [{ name: modelConfig.model, available: true,
          provider: { id: "gpt", providerName: "gpt", providerType: "custom" } }],
      } }));
      localStorage.setItem("chat-next-web-store", JSON.stringify({ version: 3.4, state: {
        currentSessionIndex: 0, sessions: [{
          id: "batch-session", topic: "多图返回验收", memoryPrompt: "", lastUpdate: Date.now(),
          stat: { tokenCount: 0, wordCount: 0, charCount: 0 },
          mask: { id: "batch-mask", name: "batch", context: [], modelConfig, syncGlobalConfig: false, lang: "cn" },
          messages: recovery ? [
            { id: "batch-user", role: "user", content: "一只猫", date: new Date().toISOString() },
            { id: "batch-answer", role: "assistant", content: "", streaming: true, interrupted: true,
              model: modelConfig.model, date: new Date().toISOString() },
          ] : [],
        }],
      } }));
      if (recovery)
        localStorage.setItem("task:batch-answer", JSON.stringify({
          id: "batch-answer", kind: "image", protocol: "async", upstreamId: "img-batch-fixture",
          sessionId: "batch-session", messageId: "batch-answer", tokenId: null,
          model: modelConfig.model, prompt: "一只猫", createdAt: Date.now(),
        }));
      return pictures;
    }, { recovery });
    fixtures = pictures.map((item) => Buffer.from(item, "base64"));
    await page.goto(base + "#/chat");
    await page.locator("#chat-input").waitFor();
    if (!recovery) {
      await page.locator("#chat-input").fill("一只猫");
      await page.getByRole("button", { name: "发送", exact: true }).click();
    }
    const images = page.locator('img[alt^="Generated Image "]');
    await images.nth(3).waitFor({ timeout: 45000 });
    assert.equal(await images.count(), 4);
    assert.equal(posts.length, recovery ? 0 : 1);
    if (!recovery) assert.equal(posts[0].n, 1);
    const boxes = await images.evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height,
        loaded: node.complete && node.naturalWidth > 0 };
    }));
    assert.ok(boxes.every((box) => box.loaded && box.width > 60 && box.height > 40));
    assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 2);
    assert.ok(boxes[2].y > boxes[0].y + 20);
    assert.ok(boxes[1].x > boxes[0].x);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.waitForFunction(async () => {
      const databases = await indexedDB.databases();
      const name = databases.find((item) => item.name?.startsWith("octopus-gallery"))?.name;
      if (!name) return false;
      return new Promise((resolve) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("images", "readonly");
          const request = transaction.objectStore("images").count();
          request.onsuccess = () => resolve(request.result === 4);
          transaction.oncomplete = () => database.close();
        };
      });
    }, null, { timeout: 20000 });
    await page.screenshot({ path: path.join(output, `${width}-${recovery ? "recovery" : "send"}.png`) });
    await images.first().click();
    await page.locator('img').filter({ visible: true }).count();
    assert.deepEqual(errors, []);
    return { width, recovery, images: 4, galleryImages: 4, generationPosts: posts.length, errors };
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const reports = [];
    for (const [width, recovery] of [[1440, false], [390, false], [390, true]])
      reports.push(await run(browser, width, recovery));
    fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ reports, screenshots: output, paidCalls: 0 }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
