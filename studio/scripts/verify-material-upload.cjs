// Isolated local fixtures; every account and model response is mocked.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";
const image = (name = "material.png") => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
    "base64",
  ),
});
const document = (name = "material.pdf") => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\nmaterial fixture\n%%EOF"),
});
const imageSelector = '[class*="attach-images_"] > div';

async function fixture(browser, name, run, width = 1440) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    isMobile: width < 600,
    hasTouch: width < 600,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await prepare(page);
  await page.route("**/*", (route) =>
    route.request().headers()["next-action"]
      ? route.fulfill({ status: 503, body: "Fixture: MCP unavailable" })
      : route.fallback(),
  );
  await page.addInitScript(() => {
    const Reader = window.FileReader;
    window.__materials = { mode: "normal", reads: [], started: 0, finished: 0 };
    window.FileReader = class extends Reader {
      readAsDataURL(blob) {
        const fixture = window.__materials;
        const start = (outcome) => {
          fixture.started++;
          if (outcome === "fail" || outcome === "abort") {
            const event = outcome === "fail" ? "error" : "abort";
            setTimeout(() => {
              this.dispatchEvent(new ProgressEvent(event));
              fixture.finished++;
            }, 0);
            return;
          }
          this.addEventListener("loadend", () => fixture.finished++, {
            once: true,
          });
          super.readAsDataURL(blob);
        };
        if (fixture.mode === "hold") return void fixture.reads.push(start);
        if (["fail", "abort"].includes(fixture.mode)) {
          const outcome = fixture.mode;
          fixture.mode = "normal";
          return start(outcome);
        }
        start();
      }
    };
  });
  try {
    await page.goto(base + "#/chat", { waitUntil: "domcontentloaded" });
    await page.locator("#chat-input").waitFor();
    const input = page.locator('input[type="file"][aria-label="上传素材"]');
    const upload = page.getByRole("button", { name: "上传素材", exact: true });
    const send = page.getByRole("button", { name: "发送", exact: true });
    const images = page.locator(imageSelector);
    await run({ page, input, upload, send, images, width });
    assert.deepEqual(errors, [], `${name}: unexpected page error`);
    console.log(JSON.stringify({ name, width, passed: true, mocked: true }));
  } catch (error) {
    console.error(
      JSON.stringify({
        name,
        width,
        errors,
        requests: await requestCount(page).catch(() => null),
        body: (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(-3000),
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}

function setMode(page, mode) {
  return page.evaluate((mode) => (window.__materials.mode = mode), mode);
}

function waitForReads(page, count) {
  return page.waitForFunction(
    (count) => window.__materials.reads.length === count,
    count,
  );
}

function release(page, index = 0, outcome) {
  return page.evaluate(
    ({ index, outcome }) => window.__materials.reads[index](outcome),
    { index, outcome },
  );
}

function waitForImages(page, count) {
  return page.waitForFunction(
    ({ selector, count }) =>
      document.querySelectorAll(selector).length === count,
    { selector: imageSelector, count },
  );
}

function requestCount(page) {
  return page.evaluate(() => window.__chatScrollMock.requests.length);
}

function materialStatus(page, status) {
  return page.locator(
    `[class*="chat-message-user_"] [data-material-status="${status}"]`,
  );
}

async function messages(page, sessionId = "scroll-a", minimum = 0) {
  const result = await page.waitForFunction(
    async ({ sessionId, minimum }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const raw = await new Promise((resolve, reject) => {
          const request = db
            .transaction("keyval", "readonly")
            .objectStore("keyval")
            .get("chat-next-web-store");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const stored = JSON.parse(
          raw || localStorage.getItem("chat-next-web-store"),
        );
        const messages = stored.state.sessions.find(
          (session) => session.id === sessionId,
        ).messages;
        return messages.length >= minimum ? messages : false;
      } finally {
        db.close();
      }
    },
    { sessionId, minimum },
  );
  try {
    return await result.jsonValue();
  } finally {
    await result.dispose();
  }
}

async function waitForRequests(page, count) {
  await page.waitForFunction(
    (count) => window.__chatScrollMock.requests.length === count,
    count,
  );
}

function requestContent(page, index = 0) {
  return page.evaluate(
    (index) =>
      window.__chatScrollMock.requests[index].payload.messages
        .filter((message) => message.role === "user")
        .at(-1).content,
    index,
  );
}

async function pendingSend(
  { page, input, upload, send, width },
  material,
  attachmentOnly = false,
) {
  const before = await messages(page);
  const text = attachmentOnly ? "" : "MATERIAL_SEND_FIXTURE";
  await setMode(page, "hold");
  await input.setInputFiles(material);
  await waitForReads(page, 1);
  await page.locator("#chat-input").fill(text);
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="发送"]').disabled,
  );
  if (width < 600) await send.click();
  else await page.locator("#chat-input").press("Enter");
  await materialStatus(page, "processing").waitFor();
  assert(
    (await materialStatus(page, "processing").textContent()).includes(
      material.name,
    ),
    "Processing status must identify the submitted material",
  );
  assert(
    (await materialStatus(page, "processing").innerText()).includes("处理中"),
  );
  assert.equal(
    await page.locator('[data-state="thinking"]').count(),
    0,
    "Model thinking must wait for attachment preparation",
  );
  const submitted = await messages(page, "scroll-a", before.length + 2);
  assert.equal(submitted.length, before.length + 2);
  assert.equal(submitted.at(-2).role, "user");
  assert.equal(submitted.at(-1).role, "assistant");
  assert.equal(await page.locator("#chat-input").inputValue(), "");
  assert(await page.locator("#chat-input").isEnabled());
  assert(await upload.isEnabled(), "Old preparation must not lock a new draft");
  await page.locator("#chat-input").press("Enter");
  await page.locator("#chat-input").press("Enter");
  assert.equal((await messages(page)).length, submitted.length);
  assert.equal(
    await requestCount(page),
    0,
    "Model request must wait for material preparation",
  );
  if (!attachmentOnly && material.mimeType.startsWith("image/")) {
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-material-status-${width}.png`),
    });
  }
  await release(page);
  await waitForRequests(page, 1);
  const content = await requestContent(page);
  const expected = material.mimeType.startsWith("image/")
    ? "image_url"
    : "file";
  assert(
    Array.isArray(content) && content.some((part) => part.type === expected),
  );
  assert.equal(content.filter((part) => part.type === expected).length, 1);
  const completed = await messages(page);
  assert.deepEqual(
    completed.slice(-2).map(({ id }) => id),
    submitted.slice(-2).map(({ id }) => id),
    "Ready material must update the original message pair",
  );
  assert.equal(completed.length, submitted.length);
  if (text) {
    const occurrences = await page.evaluate(
      (text) =>
        window.__chatScrollMock.requests[0].payload.messages.filter(
          (message) =>
            message.role === "user" &&
            Array.isArray(message.content) &&
            message.content.some(
              (part) => part.type === "text" && part.text.includes(text),
            ),
        ).length,
      text,
    );
    assert.equal(occurrences, 1, "User input must only occur once");
  }
  await page.evaluate(() => window.__chatScrollMock.finish(0));
}

async function failedRetry({ page, input, send }, material, outcome) {
  const before = await messages(page);
  await setMode(page, "hold");
  await input.setInputFiles(material);
  await waitForReads(page, 1);
  await page.locator("#chat-input").fill("RETRY_MATERIAL_FIXTURE");
  await send.click();
  await materialStatus(page, "processing").waitFor();
  const submitted = await messages(page, "scroll-a", before.length + 2);
  await release(page, 0, outcome);
  await materialStatus(page, "failed").waitFor();
  assert.equal(await requestCount(page), 0);
  assert.equal((await messages(page)).at(-2).id, submitted.at(-2).id);
  await setMode(page, "normal");
  await page.getByRole("button", { name: "重试处理素材", exact: true }).click();
  await waitForRequests(page, 1);
  const retried = await messages(page);
  assert.equal(retried.length, submitted.length);
  assert.deepEqual(
    retried.slice(-2).map(({ id }) => id),
    submitted.slice(-2).map(({ id }) => id),
  );
  const expected = material.mimeType.startsWith("image/")
    ? "image_url"
    : "file";
  assert((await requestContent(page)).some((part) => part.type === expected));
  assert.equal(await page.locator("#chat-input").inputValue(), "");
  await page.evaluate(() => window.__chatScrollMock.finish(0));
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) {
      await fixture(
        browser,
        "image-message-waits",
        (f) => pendingSend(f, image()),
        width,
      );
      await fixture(
        browser,
        "document-message-waits",
        (f) => pendingSend(f, document()),
        width,
      );
    }
    await fixture(
      browser,
      "attachment-only-message",
      (f) => pendingSend(f, image(), true),
      390,
    );
    await fixture(
      browser,
      "delete-stays-deleted",
      async ({ page, input, images }) => {
        await input.setInputFiles(image("first.png"));
        await waitForImages(page, 1);
        await setMode(page, "hold");
        await input.setInputFiles(image("second.png"));
        await waitForReads(page, 1);
        await images.first().hover();
        await page.locator('[class*="delete-image_"]').first().click();
        assert.equal(await images.count(), 0);
        await release(page);
        await waitForImages(page, 1);
        assert.equal(await requestCount(page), 0);
      },
    );
    await fixture(
      browser,
      "overlap-is-queued",
      async ({ page, input, images }) => {
        await setMode(page, "hold");
        await input.setInputFiles(image("first.png"));
        await waitForReads(page, 1);
        await input.setInputFiles(image("second.png"));
        assert.equal(
          await page.evaluate(() => window.__materials.reads.length),
          1,
        );
        await release(page);
        await waitForReads(page, 2);
        assert.equal(await images.count(), 1);
        await release(page, 1);
        await waitForImages(page, 2);
        await page.waitForFunction(
          () =>
            !document.querySelector('button[aria-label="上传素材"]').disabled,
        );
        assert.equal(await images.count(), 2);
        assert.equal(await requestCount(page), 0);
      },
    );
    await fixture(
      browser,
      "paste-and-drop-share-queue",
      async ({ page, images }) => {
        await setMode(page, "hold");
        for (const kind of ["paste", "drop"]) {
          await page.evaluate(
            ({ kind, base64 }) => {
              const data = Uint8Array.from(atob(base64), (c) =>
                c.charCodeAt(0),
              );
              const transfer = new DataTransfer();
              transfer.items.add(
                new File([data], `${kind}.png`, { type: "image/png" }),
              );
              const options = { bubbles: true, cancelable: true };
              const event =
                kind === "paste"
                  ? new ClipboardEvent("paste", {
                      ...options,
                      clipboardData: transfer,
                    })
                  : new DragEvent("drop", {
                      ...options,
                      dataTransfer: transfer,
                    });
              document.querySelector("#chat-input").dispatchEvent(event);
            },
            { kind, base64: image().buffer.toString("base64") },
          );
        }
        await waitForReads(page, 1);
        await release(page);
        await waitForReads(page, 2);
        assert.equal(await images.count(), 1);
        await release(page, 1);
        await waitForImages(page, 2);
        assert.equal(await images.count(), 2);
        assert.equal(await requestCount(page), 0);
      },
    );
    await fixture(
      browser,
      "five-image-limit",
      async ({ page, input, send }) => {
        await setMode(page, "hold");
        await input.setInputFiles(
          Array.from({ length: 6 }, (_, i) => image(`${i}.png`)),
        );
        await waitForReads(page, 1);
        await send.click();
        await materialStatus(page, "processing").waitFor();
        for (let index = 0; index < 5; index++) {
          await waitForReads(page, index + 1);
          await release(page, index);
        }
        await materialStatus(page, "failed").waitFor();
        assert.equal(await page.evaluate(() => window.__materials.started), 5);
        assert.equal(await requestCount(page), 0);
        assert(
          (
            await materialStatus(page, "failed")
              .locator('[data-file-status="failed"]')
              .innerText()
          ).includes("5"),
          "Image limit failure must be visible in the submitted message",
        );
      },
    );
    await fixture(browser, "failed-image-retries-in-place", (f) =>
      failedRetry(f, image("failed.png"), "fail"),
    );
    await fixture(
      browser,
      "aborted-document-retries-in-place",
      (f) => failedRetry(f, document("aborted.pdf"), "abort"),
      390,
    );
    await fixture(
      browser,
      "cancel-stops-preparation-request",
      async ({ page, input, send }) => {
        await setMode(page, "hold");
        await input.setInputFiles(image());
        await waitForReads(page, 1);
        await page.locator("#chat-input").fill("CANCEL_MATERIAL_FIXTURE");
        await send.click();
        await materialStatus(page, "processing").waitFor();
        await page
          .getByRole("button", { name: "取消本次请求", exact: true })
          .click();
        await release(page);
        await page.waitForFunction(() => window.__materials.finished === 1);
        assert.equal(await requestCount(page), 0);
        assert.equal(await materialStatus(page, "processing").count(), 0);
      },
    );
    for (const width of [1440, 390]) {
      await fixture(
        browser,
        "submitted-material-detaches-from-new-draft",
        async ({ page, input, upload, send, images }) => {
          await setMode(page, "hold");
          await input.setInputFiles(image("submitted.png"));
          await waitForReads(page, 1);
          await page.locator("#chat-input").fill("FIRST_MATERIAL_FIXTURE");
          await send.click();
          await materialStatus(page, "processing").waitFor();
          assert(await upload.isEnabled());
          await page.locator("#chat-input").fill("NEW_DRAFT_FIXTURE");
          await input.setInputFiles(document("new-draft.pdf"));
          await release(page);
          await waitForRequests(page, 1);
          await waitForReads(page, 2);
          assert.equal(
            await page.locator("#chat-input").inputValue(),
            "NEW_DRAFT_FIXTURE",
          );
          assert.equal(await images.count(), 0);
          const first = await requestContent(page);
          assert(first.some((part) => part.type === "image_url"));
          assert(!first.some((part) => part.type === "file"));
          await page.evaluate(() => window.__chatScrollMock.finish(0));
          await release(page, 1);
          await page
            .getByText("new-draft.pdf", { exact: true })
            .first()
            .waitFor();
          assert.equal(await requestCount(page), 1);
          await send.click();
          await waitForRequests(page, 2);
          const second = await requestContent(page, 1);
          assert(second.some((part) => part.type === "file"));
          assert(!second.some((part) => part.type === "image_url"));
          assert(
            second.some(
              (part) =>
                part.type === "text" && part.text.includes("NEW_DRAFT_FIXTURE"),
            ),
          );
          await page.evaluate(() => window.__chatScrollMock.finish(1));
        },
        width,
      );
    }
    await fixture(
      browser,
      "later-text-waits-for-prior-material-history",
      async ({ page, input, send }) => {
        const before = await messages(page);
        await setMode(page, "hold");
        await input.setInputFiles(image("prior-history.png"));
        await waitForReads(page, 1);
        await page.locator("#chat-input").fill("PRIOR_MATERIAL_TURN");
        await send.click();
        await materialStatus(page, "processing").waitFor();
        await page.locator("#chat-input").fill("LATER_TEXT_TURN");
        await page.locator("#chat-input").press("Enter");
        const submitted = await messages(page, "scroll-a", before.length + 4);
        assert.equal(submitted.length, before.length + 4);
        assert.equal(await page.locator("#chat-input").inputValue(), "");
        assert.equal(await requestCount(page), 0);
        await release(page);
        await page.waitForFunction(
          () => window.__chatScrollMock.requests.length >= 1,
        );
        const first = await page.evaluate(
          () => window.__chatScrollMock.requests[0].payload.messages,
        );
        assert(
          !JSON.stringify(first).includes("LATER_TEXT_TURN"),
          "Earlier request must not include a future turn",
        );
        assert(
          first.some(
            (message) =>
              Array.isArray(message.content) &&
              message.content.some((part) => part.type === "image_url"),
          ),
        );
        await page.evaluate(() => window.__chatScrollMock.finish(0));
        await waitForRequests(page, 2);
        const second = await page.evaluate(
          () => window.__chatScrollMock.requests[1].payload.messages,
        );
        assert(
          second.some(
            (message) =>
              Array.isArray(message.content) &&
              message.content.some((part) => part.type === "image_url"),
          ),
          "Later request must retain prepared earlier attachments as history",
        );
        assert.equal(
          second.filter(
            (message) =>
              message.role === "user" &&
              JSON.stringify(message.content).includes("LATER_TEXT_TURN"),
          ).length,
          1,
        );
        assert.deepEqual(
          (await messages(page)).slice(-4).map(({ id }) => id),
          submitted.slice(-4).map(({ id }) => id),
        );
        await page.evaluate(() => window.__chatScrollMock.finish(1));
      },
    );
    await fixture(
      browser,
      "submitted-queue-finishes-in-original-session",
      async ({ page, input, send, images }) => {
        const original = await messages(page);
        const other = await messages(page, "scroll-b");
        await setMode(page, "hold");
        await input.setInputFiles(image("first.png"));
        await waitForReads(page, 1);
        await input.setInputFiles(image("queued.png"));
        await page.locator("#chat-input").fill("ORIGINAL_SESSION_FIXTURE");
        await send.click();
        await materialStatus(page, "processing").waitFor();
        const submitted = await messages(page, "scroll-a", original.length + 2);
        await page
          .getByText("Scroll Session B", { exact: true })
          .first()
          .click();
        await release(page);
        await waitForReads(page, 2);
        assert.equal(await requestCount(page), 0);
        await release(page, 1);
        await waitForRequests(page, 1);
        assert.equal(await images.count(), 0);
        assert.equal(await page.locator("#chat-input").inputValue(), "");
        assert.equal((await messages(page, "scroll-b")).length, other.length);
        const completed = await messages(page);
        assert.equal(completed.length, original.length + 2);
        assert.equal(completed.at(-2).id, submitted.at(-2).id);
        const content = await requestContent(page);
        assert.equal(
          content.filter((part) => part.type === "image_url").length,
          2,
        );
        await page.evaluate(() => window.__chatScrollMock.finish(0));
      },
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
