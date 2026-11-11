// Local fixtures only: all API and external requests are mocked.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const errors = [];
  const optimizedImageRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/_next/image")) {
      optimizedImageRequests.push(request.url());
    }
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === "/__performance-fixture")
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Performance fixture</title>",
      });
    if (url.pathname === "/api/config")
      return route.fulfill({
        json: { newApiEnabled: false, needCode: false, hasModelApiKey: true },
      });
    if (url.pathname === "/api/new-api/bootstrap")
      return route.fulfill({
        json: {
          success: true,
          data: {
            config: {
              newApiEnabled: false,
              needCode: false,
              hasModelApiKey: true,
            },
            session: {
              authenticated: false,
              user: null,
              selectedTokenId: null,
            },
          },
        },
      });
    if (url.pathname === "/api/new-api/status")
      return route.fulfill({
        json: { success: true, data: { enabled: false } },
      });
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({
        json: { data: [{ id: "gpt-image-2.5-sunburst" }] },
      });
    return route.continue();
  });
  try {
    await page.goto(new URL("/__performance-fixture", base).href);
    const fixture = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 1024;
      const ctx = canvas.getContext("2d");
      const pixels = ctx.createImageData(canvas.width, canvas.height);
      let seed = 7;
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels.data[i] = seed & 255;
        pixels.data[i + 1] = (seed >>> 8) & 255;
        pixels.data[i + 2] = (seed >>> 16) & 255;
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const source = canvas.toDataURL("image/png");
      const modelConfig = {
        model: "gpt-image-2.5-sunburst",
        providerName: "gpt",
        template: "{{input}}",
        sendMemory: false,
        enableInjectSystemPrompts: false,
        historyMessageCount: 0,
      };
      const session = (id, topic, messages) => ({
        id,
        topic,
        messages,
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
      });
      const messages = Array.from({ length: 6 }, (_, i) => [
        {
          id: `u${i}`,
          role: "user",
          content: `image prompt ${i}`,
          date: new Date().toISOString(),
        },
        {
          id: `a${i}`,
          role: "assistant",
          content: `![Generated Image](${source})`,
          model: modelConfig.model,
          date: new Date().toISOString(),
        },
      ]).flat();
      const open = indexedDB.open("keyval-store", 1);
      const db = await new Promise((resolve, reject) => {
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const tx = db.transaction("keyval", "readwrite");
      tx.objectStore("keyval").put(
        JSON.stringify({
          version: 3.5,
          state: {
            currentSessionIndex: 0,
            sessions: [
              session("image-history", "Performance image history", messages),
              session("blank", "Performance blank chat", []),
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
            models: [
              {
                name: modelConfig.model,
                available: true,
                provider: {
                  id: "gpt",
                  providerName: "gpt",
                  providerType: "custom",
                },
              },
            ],
            enableAutoGenerateTitle: false,
            theme: "light",
          },
        }),
      );
      return { bytesPerImage: source.length, messageCount: messages.length };
    });
    await page.addInitScript(() => {
      window.performanceFixture = { jsonMs: 0, jsonCalls: 0, decodes: 0 };
      const stringify = JSON.stringify;
      JSON.stringify = function (...args) {
        const start = performance.now();
        const result = stringify.apply(this, args);
        if (result?.length > 1000000) {
          window.performanceFixture.jsonMs += performance.now() - start;
          window.performanceFixture.jsonCalls++;
        }
        return result;
      };
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (...args) {
        window.performanceFixture.decodes++;
        return decode.apply(this, args);
      };
    });
    await page.goto(base + "#/chat");
    const history = page
      .getByText("Performance image history", { exact: true })
      .first();
    const blank = page
      .getByText("Performance blank chat", { exact: true })
      .first();
    await history.waitFor({ timeout: 5000 });
    const waitForVisibleImages = () =>
      page.waitForFunction(
        () => {
          const frames = [
            ...document.querySelectorAll('span[class*="image-frame"]'),
          ];
          const visible = frames.filter((frame) => {
            let root = frame.parentElement;
            while (
              root &&
              !/(auto|scroll)/.test(getComputedStyle(root).overflowY)
            )
              root = root.parentElement;
            const bounds = root?.getBoundingClientRect() ?? {
              top: 0,
              bottom: innerHeight,
            };
            const rect = frame.getBoundingClientRect();
            return rect.bottom > bounds.top && rect.top < bounds.bottom;
          });
          return (
            visible.length > 0 &&
            visible.every((frame) => {
              const image = frame.querySelector("img");
              return image?.complete && image.naturalWidth > 0;
            })
          );
        },
        undefined,
        { timeout: 15000 },
      );
    await waitForVisibleImages();
    // Visit screen-external images through scrolling before testing warm switches.
    const frames = page.locator('span[class*="image-frame"]');
    assert.equal(await frames.count(), 6);
    const body = page.locator('[class*="chat-body"]').first();
    await body.hover();
    await page.mouse.wheel(0, -10000);
    for (let index = 0; index < 6; index++) {
      const frame = frames.nth(index);
      await frame.scrollIntoViewIfNeeded();
      await frame.locator("img").waitFor();
      await frame.locator("img").evaluate(async (image) => {
        if (!image.complete) await image.decode();
        if (!image.naturalWidth)
          throw new Error("Fixture image failed to load");
      });
    }
    assert.equal(await page.locator('img[alt="Generated Image"]').count(), 6);
    const results = [];
    for (let i = 0; i < 3; i++) {
      await blank.click();
      await page.waitForFunction(
        () => !document.querySelector('img[alt="Generated Image"]'),
      );
      const metrics = await history.evaluate(async (element) => {
        window.performanceFixture.jsonMs = 0;
        window.performanceFixture.jsonCalls = 0;
        window.performanceFixture.decodes = 0;
        const start = performance.now();
        element.click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return {
          frameMs: performance.now() - start,
          ...window.performanceFixture,
        };
      });
      await waitForVisibleImages();
      results.push({
        ...metrics,
        totalDecodes: await page.evaluate(
          () => window.performanceFixture.decodes,
        ),
        renderedImages: await page
          .locator('img[alt="Generated Image"]')
          .count(),
      });
    }
    const maxSwitchMs = Number(process.env.IMAGE_SWITCH_BUDGET_MS || 2000);
    assert.ok(Number.isFinite(maxSwitchMs) && maxSwitchMs > 0);
    for (const result of results) {
      assert.ok(
        result.frameMs < maxSwitchMs,
        `Image session switch took ${result.frameMs.toFixed(
          1,
        )}ms (budget ${maxSwitchMs}ms)`,
      );
    }
    assert.deepEqual(errors, [], "No uncaught browser errors");
    assert.deepEqual(
      optimizedImageRequests,
      [],
      "Cached image sources must load without server image optimization",
    );
    console.log(
      JSON.stringify({
        fixture: {
          ...fixture,
          uniqueImageSources: 1,
          lazyLoading: true,
          warmup: "scroll through all six images",
        },
        results,
      }),
    );
  } catch (error) {
    console.error(
      await page.evaluate(async () => ({
        body: document.body.innerText.slice(0, 1400),
        databases: await indexedDB.databases(),
        stored: await new Promise((resolve) => {
          const request = indexedDB.open("keyval-store");
          request.onsuccess = () => {
            const db = request.result;
            const read = db
              .transaction("keyval")
              .objectStore("keyval")
              .get("chat-next-web-store");
            read.onsuccess = () => {
              resolve(String(read.result).slice(0, 500));
              db.close();
            };
          };
        }),
      })),
    );
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
