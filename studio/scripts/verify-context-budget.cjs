// Synthetic responses only. No model request is sent to a real provider.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { prepare } = require("./verify-chat-scroll.cjs");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:3001/";

async function run(browser, width, mode) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();
    await prepare(page);
    await page.addInitScript(
      ({ mode }) => {
        const store = JSON.parse(localStorage.getItem("chat-next-web-store"));
        const session = store.state.sessions[0];
        session.messages = [
          {
            id: "budget-old",
            role: "user",
            content: "旧事实".repeat(1200),
            date: new Date().toISOString(),
          },
          {
            id: "budget-recent-user",
            role: "user",
            content: "最近的问题",
            date: new Date().toISOString(),
          },
          {
            id: "budget-recent-bot",
            role: "assistant",
            content: "最近的回答",
            date: new Date().toISOString(),
          },
        ];
        session.mask.modelConfig.sendMemory = true;
        session.mask.modelConfig.max_tokens = 102400;
        session.mask.modelConfig.compressionThreshold = 1500;
        session.mask.modelConfig.contextBudget = 32768;
        if (mode === "nonstream") {
          session.mask.modelConfig.stream = false;
          session.mask.modelConfig.reasoningEffort = "high";
          session.mask.modelConfig.stop = "END";
          session.mask.modelConfig.compressionThreshold = 272000;
        }
        if (mode === "media-summary") {
          session.messages[0].content = [
            { type: "text", text: "旧事实".repeat(1200) },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=",
              },
            },
          ];
        }
        if (mode === "inline-images") {
          session.mask.modelConfig.model = "gemini-3-pro-image";
          session.messages = Array.from({ length: 3 }, (_, i) => ({
            id: `inline-${i}`,
            role: "assistant",
            model: "gemini-3-pro-image",
            content: `![Generated Image](data:image/png;base64,${"A".repeat(
              1000000,
            )})`,
            date: new Date().toISOString(),
          }));
        }
        if (mode === "cleared") {
          session.memoryPrompt = "CLEARED_MEMORY_MUST_NOT_RETURN";
          session.lastSummarizeIndex = 1;
          session.clearContextIndex = session.messages.length;
        }
        localStorage.setItem("chat-next-web-store", JSON.stringify(store));
        const previousFetch = window.fetch;
        const state = { summaries: [], chats: [], release: null };
        window.__contextFixture = state;
        window.fetch = async (input, init) => {
          const url = String(typeof input === "string" ? input : input.url);
          if (!url.includes("/chat/completions"))
            return previousFetch(input, init);
          const body = JSON.parse(init.body);
          if (!body.stream && body.max_tokens === 1024) {
            state.summaries.push(body);
            return new Promise((resolve, reject) => {
              init.signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              );
              state.release = () =>
                resolve(
                  mode === "failure"
                    ? Response.json(
                        { message: "摘要暂时失败" },
                        { status: 503 },
                      )
                    : Response.json({
                        choices: [{ message: { content: "历史关键事实摘要" } }],
                      }),
                );
            });
          }
          state.chats.push(body);
          if (!body.stream)
            return Response.json({
              choices: [{ message: { content: "CONTEXT_TEST_COMPLETE" } }],
            });
          const encoder = new TextEncoder();
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    'data: {"choices":[{"delta":{"content":"CONTEXT_TEST_COMPLETE"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                  ),
                );
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        };
      },
      { mode },
    );
    await page.goto(`${base}#/chat`);
    const input = page.locator("#chat-input");
    await input.fill("继续讨论");
    await input.press("Enter");
    if (mode === "nonstream") {
      await page.getByText("CONTEXT_TEST_COMPLETE", { exact: true }).waitFor();
      const body = await page.evaluate(() => window.__contextFixture.chats[0]);
      assert.equal(body.stream, false);
      assert.equal(body.reasoning_effort, "high");
      assert.deepEqual(body.stop, ["END"]);
      assert.equal(body.max_tokens, 128000);
      console.log(
        JSON.stringify({ width, mode, passed: true, paidRequests: 0 }),
      );
      return;
    }
    if (mode === "inline-images") {
      await page.waitForFunction(
        () => window.__contextFixture.chats.length === 1,
      );
      const result = await page.evaluate(() => {
        const state = window.__contextFixture;
        const icons = [
          ...document.querySelectorAll('[data-model-vendor="gemini"] svg'),
        ];
        return {
          summaries: state.summaries.length,
          images: state.chats[0].messages
            .flatMap((m) => m.content)
            .filter((p) => p.type === "image_url").length,
          textContainsBase64: state.chats[0].messages
            .flatMap((m) => m.content)
            .some((p) => p.type === "text" && p.text.includes("data:image/")),
          gradients: icons.map(
            (icon) => icon.querySelector("linearGradient")?.id,
          ),
          ownReferences: icons.every(
            (icon) =>
              icon.querySelector("path").getAttribute("fill") ===
              `url(#${icon.querySelector("linearGradient")?.id})`,
          ),
        };
      });
      assert.equal(result.summaries, 0);
      assert.equal(result.images, 3);
      assert.equal(result.textContainsBase64, false);
      assert.ok(result.gradients.length >= 3);
      assert.equal(new Set(result.gradients).size, result.gradients.length);
      assert.equal(result.ownReferences, true);
      console.log(
        JSON.stringify({ width, mode, passed: true, paidRequests: 0 }),
      );
      return;
    }
    if (mode === "cleared") {
      await page.waitForFunction(
        () => window.__contextFixture.chats.length === 1,
      );
      const result = await page.evaluate(() => ({
        text: JSON.stringify(window.__contextFixture.chats[0]),
        summaries: window.__contextFixture.summaries.length,
      }));
      assert.equal(result.summaries, 0);
      assert.ok(!result.text.includes("CLEARED_MEMORY_MUST_NOT_RETURN"));
      assert.ok(!result.text.includes("旧事实"));
      console.log(
        JSON.stringify({ width, mode, passed: true, paidRequests: 0 }),
      );
      return;
    }
    await page.waitForFunction(
      () => window.__contextFixture.summaries.length === 1,
    );
    assert.equal(
      await page.evaluate(() => window.__contextFixture.chats.length),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => window.__contextFixture.summaries[0].max_tokens,
      ),
      1024,
    );
    if (mode === "invalidate") {
      await page
        .getByRole("button", { name: "清除上下文", exact: true })
        .click();
      await page.evaluate(() => window.__contextFixture.release());
      await page.getByText("请求已取消", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => window.__contextFixture.chats.length),
        0,
      );
    } else if (mode === "cancel") {
      const stop = page
        .locator('[class*="chat-message-actions"]')
        .getByRole("button", { name: "停止", exact: true });
      await stop
        .locator(
          "xpath=ancestor::div[contains(@class,'chat-message-container')][1]",
        )
        .hover();
      await stop.click();
      await page.getByText("请求已取消", { exact: true }).waitFor();
      await page.evaluate(() => window.__contextFixture.release());
      assert.equal(
        await page.evaluate(() => window.__contextFixture.chats.length),
        0,
      );
    } else {
      await page.evaluate(() => window.__contextFixture.release());
      if (mode === "failure") {
        await page
          .getByText(/历史摘要失败/)
          .last()
          .waitFor();
        assert.equal(
          await page.evaluate(() => window.__contextFixture.chats.length),
          0,
        );
      } else {
        await page
          .getByText("CONTEXT_TEST_COMPLETE", { exact: true })
          .waitFor();
        const body = await page.evaluate(
          () => window.__contextFixture.chats[0],
        );
        const text = JSON.stringify(body.messages);
        assert.ok(text.includes("历史关键事实摘要"));
        assert.ok(text.includes("最近的问题") && text.includes("最近的回答"));
        assert.ok(!text.includes("旧事实".repeat(100)));
        assert.equal(body.max_tokens, 128000);
        // The full original message stays visible in local history.
        assert.equal(
          await page.getByText("旧事实".repeat(1200), { exact: true }).count(),
          1,
        );
        await input.fill("再继续");
        await input.press("Enter");
        await page.waitForFunction(
          () => window.__contextFixture.chats.length === 2,
        );
        assert.equal(
          await page.evaluate(() => window.__contextFixture.summaries.length),
          1,
        );
        assert.ok(
          await page.evaluate(() =>
            JSON.stringify(window.__contextFixture.chats[1]).includes(
              "历史关键事实摘要",
            ),
          ),
        );
        if (mode === "media-summary") {
          const imageCounts = await page.evaluate(() =>
            window.__contextFixture.chats.map(
              (chat) =>
                chat.messages
                  .flatMap((m) => m.content)
                  .filter((p) => p.type === "image_url").length,
            ),
          );
          assert.deepEqual(imageCounts, [1, 1]);
        }
        await page.evaluate(() => {
          location.hash = "/settings";
        });
        const threshold = page.getByRole("spinbutton", {
          name: "自动压缩容量",
          exact: true,
        });
        await threshold.fill("8000");
        await threshold.blur();
        assert.equal(await threshold.inputValue(), "8000");
        await threshold.fill("");
        await threshold.blur();
        assert.equal(await threshold.inputValue(), "272000");
        assert.equal(
          await page.getByText("上下文预算", { exact: true }).count(),
          0,
        );
        assert.equal(
          await page.getByText("附带历史消息数", { exact: true }).count(),
          0,
        );
        await threshold.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: require("node:path").join(
            require("node:os").tmpdir(),
            `octopus-context-settings-${width}.png`,
          ),
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
      }
    }
    console.log(JSON.stringify({ width, mode, passed: true, paidRequests: 0 }));
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const [width, mode] of [
      [1440, "nonstream"],
      [390, "nonstream"],
      [1440, "media-summary"],
      [1440, "inline-images"],
      [390, "inline-images"],
      [1440, "success"],
      [390, "success"],
      [1440, "failure"],
      [1440, "cancel"],
      [1440, "cleared"],
      [1440, "invalidate"],
    ]) {
      await run(browser, width, mode);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
