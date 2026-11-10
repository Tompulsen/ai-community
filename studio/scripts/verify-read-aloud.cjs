// Isolated profiles and a synthetic speech engine; no model or audio API calls.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";

async function run(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  try {
    await prepare(page);
    await page.addInitScript(() => {
      const store = JSON.parse(localStorage.getItem("chat-next-web-store"));
      store.state.sessions[0].messages = [
        {
          id: "speech-user",
          role: "user",
          content: "你好",
          date: new Date().toISOString(),
        },
        {
          id: "speech-bot",
          role: "assistant",
          content:
            "## 你好\n这是**第一句**。这是第二句。\n\n```js\nconsole.log('skip');\n```",
          date: new Date().toISOString(),
        },
      ];
      localStorage.setItem("chat-next-web-store", JSON.stringify(store));
      const spoken = [];
      const voices = [
        {
          name: "系统中文声音",
          voiceURI: "local-zh",
          lang: "zh-CN",
          localService: true,
        },
        {
          name: "系统 English",
          voiceURI: "local-en",
          lang: "en-US",
          localService: true,
        },
        ...Array.from({ length: 180 }, (_, index) => ({
          name: `Microsoft Long Voice Online (Natural) - Language Variant ${index}`,
          voiceURI: `remote-${index}`,
          lang: "en-US",
          localService: false,
        })),
      ];
      const synth = Object.assign(new EventTarget(), {
        cancellations: 0,
        getVoices: () => voices,
        speak: (utterance) => {
          spoken.push(utterance);
        },
        cancel() {
          this.cancellations++;
        },
      });
      Object.defineProperty(window, "speechSynthesis", {
        value: synth,
        configurable: true,
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        configurable: true,
        value: class {
          constructor(text) {
            this.text = text;
          }
        },
      });
      window.__speechFixture = { spoken, synth };
    });
    await page.goto(`${base}#/chat`);
    const speak = page.getByRole("button", { name: "朗读", exact: true });
    const startReading = async () => {
      await speak
        .locator(
          "xpath=ancestor::div[contains(@class, 'chat-message-container')][1]",
        )
        .hover();
      await speak.click();
    };
    await speak.waitFor();
    await startReading();
    await page.getByRole("button", { name: "停止朗读", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.__speechFixture.spoken[0].voice.voiceURI,
      ),
      "local-zh",
    );
    await page.evaluate(() => window.__speechFixture.spoken.at(-1).onend());
    assert.equal(
      await page.evaluate(() => window.__speechFixture.spoken.length),
      2,
    );
    await page
      .getByRole("button", { name: "停止朗读", exact: true })
      .click({ force: true });
    await speak.waitFor();
    assert.equal(
      await page.evaluate(() => window.__speechFixture.synth.cancellations),
      1,
    );
    await startReading();
    await page.evaluate(() => {
      location.hash = "/settings";
    });
    await page.getByText("语音朗读", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.__speechFixture.synth.cancellations),
      2,
    );
    const select = page.getByLabel("朗读声音", { exact: true });
    await select.click();
    const voiceDialog = page.getByRole("dialog", {
      name: "朗读声音",
      exact: true,
    });
    await voiceDialog.waitFor();
    const bounds = await voiceDialog.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0);
    assert(bounds.x + bounds.width <= width);
    assert(bounds.y + bounds.height <= 1000);
    assert(
      await voiceDialog.evaluate((element) =>
        Array.from(element.querySelectorAll("*")).some(
          (child) =>
            child.scrollHeight > child.clientHeight &&
            getComputedStyle(child).overflowY === "auto",
        ),
      ),
    );
    await page.screenshot({
      animations: "disabled",
      path: path.join(os.tmpdir(), `octopus-voice-picker-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await voiceDialog.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => location.hash), "#/settings");
    await select.click();
    await voiceDialog
      .getByRole("button", {
        name: "系统 English · en-US · 本地",
        exact: true,
      })
      .click();
    const speed = page.getByRole("slider", { name: "朗读语速", exact: true });
    await speed.fill("1.3");
    const preview = page.getByRole("button", { name: "试听声音", exact: true });
    await preview.click();
    await page.getByRole("button", { name: "停止试听", exact: true }).waitFor();
    const last = await page.evaluate(() => {
      const utterance = window.__speechFixture.spoken.at(-1);
      return { voice: utterance.voice.voiceURI, rate: utterance.rate };
    });
    assert.deepEqual(last, { voice: "local-en", rate: 1.3 });
    await page.getByRole("button", { name: "停止试听", exact: true }).click();
    await speed.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-read-aloud-${width}.png`),
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const customSwitch = page.getByRole("switch", {
      name: "自定义模型",
      exact: true,
    });
    await customSwitch.scrollIntoViewIfNeeded();
    const alignment = await customSwitch.evaluate((element) => {
      const row = element.closest('[class*="list-item"]');
      const bounds = element.getBoundingClientRect();
      const rowBounds = row.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(row).paddingRight);
      return {
        rightGap: rowBounds.right - padding - bounds.right,
        verticalDelta:
          (bounds.top + bounds.bottom - rowBounds.top - rowBounds.bottom) / 2,
      };
    });
    assert(Math.abs(alignment.rightGap) <= 1);
    assert(Math.abs(alignment.verticalDelta) <= 1);
    await page.screenshot({
      animations: "disabled",
      path: path.join(os.tmpdir(), `octopus-settings-toggle-${width}.png`),
    });
    await page.evaluate(() => {
      location.hash = "/chat";
    });
    await speak.waitFor();
    await startReading();
    const saved = await page.evaluate(() => ({
      voice: window.__speechFixture.spoken.at(-1).voice.voiceURI,
      rate: window.__speechFixture.spoken.at(-1).rate,
      modelRequests: window.__chatScrollMock.requests.length,
    }));
    assert.deepEqual(saved, { voice: "local-en", rate: 1.3, modelRequests: 0 });
    console.log(
      JSON.stringify({
        width,
        replyPlayback: true,
        stopOnNavigation: true,
        voiceAndRateSaved: true,
        modelRequests: 0,
      }),
    );
  } catch (error) {
    await page.screenshot({
      path: path.join(os.tmpdir(), `octopus-read-aloud-failure-${width}.png`),
    });
    console.error(
      await page.evaluate(() => ({
        url: location.hash,
        speechCount: window.__speechFixture?.spoken.length,
        cancellations: window.__speechFixture?.synth.cancellations,
      })),
    );
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) await run(browser, width);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
