// Isolated browser fixtures; provider responses are mocked and never billed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/studio/";
const translation = JSON.parse(
  fs.readFileSync("skills/catalog.json", "utf8"),
).skills.find((skill) => skill.id === "translation");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const retrievals = [];
      const modelRequests = [];
      let retrievalFails = false;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("lang", "cn"));
      await page.route("**/api/**", (route) => {
        const pathname = new URL(route.request().url()).pathname.replace(
          /^\/studio(?=\/)/,
          "",
        );
        const ok = (data) => route.fulfill({ json: { success: true, data } });
        if (pathname === "/api/skills/retrieve") {
          retrievals.push(route.request().postDataJSON());
          if (retrievalFails)
            return route.fulfill({
              status: 502,
              json: { message: "联网检索测试失败" },
            });
          return route.fulfill({
            json: {
              searchedAt: "2026-11-11T03:00:00Z",
              sources: [
                {
                  title: "Verified source",
                  url: "https://example.test/evidence",
                  snippet: "Real fixture evidence.",
                  ...(route.request().postDataJSON().mode === "deep"
                    ? {
                        page: {
                          status: "read",
                          text: "Actual retrieved webpage body",
                          readAt: "2026-11-11T03:00:01Z",
                        },
                      }
                    : {}),
                },
              ],
            },
          });
        }
        if (pathname === "/api/v1/chat/completions") {
          modelRequests.push(route.request().postDataJSON());
          return route.fulfill({
            contentType: "text/event-stream",
            body: `data: ${JSON.stringify({
              choices: [
                { delta: { content: "Fixture answer" }, finish_reason: null },
              ],
            })}\n\ndata: [DONE]\n\n`,
          });
        }
        if (pathname === "/api/v1/videos")
          return route.fulfill({
            status: 400,
            json: { error: "Video fixture: no generation" },
          });
        assert.equal(
          route.request().method(),
          "GET",
          `Unexpected write: ${pathname}`,
        );
        if (pathname === "/api/config")
          return route.fulfill({ json: { newApiEnabled: true } });
        if (pathname === "/api/new-api/bootstrap")
          return ok({
            config: { newApiEnabled: true },
            session: {
              authenticated: true,
              selectedTokenId: 10,
              user: {
                id: 7,
                username: "fixture",
                group: "default",
                quota: 500000,
              },
            },
          });
        if (pathname === "/api/new-api/status")
          return ok({ enabled: true, configured: true, quotaPerUnit: 500000 });
        if (pathname === "/api/new-api/session")
          return ok({
            authenticated: true,
            selectedTokenId: 10,
            user: {
              id: 7,
              username: "fixture",
              group: "default",
              quota: 500000,
            },
          });
        if (pathname === "/api/skills/capabilities")
          return route.fulfill({ json: { web: true, papers: true } });
        if (pathname.endsWith("/models") || pathname === "/api/remote-models")
          return route.fulfill({
            json: {
              data: ["deepseek-v4.1-flash", "gpt-image-2", "sora-2"].map(
                (id) => ({
                  id,
                  object: "model",
                }),
              ),
            },
          });
        return ok([]);
      });
      try {
        await page.goto(`${base}#/chat`);
        // Next's development issue badge covers the composer at 320px; page errors remain asserted below.
        await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
        const trigger = page.locator(
          'button[aria-controls="composer-web-search"]',
        );
        await trigger.waitFor();
        await page.evaluate((translation) => {
          window.webpackChunk_N_E.push([
            [`web-search-fixture-${Date.now()}`],
            {},
            (require) => {
              window.webRequire = require;
            },
          ]);
          window.webModule = (suffix) => {
            const require = window.webRequire;
            const id = Object.keys(require.m).find((id) => id.endsWith(suffix));
            if (!id) throw new Error(`Missing module ${suffix}`);
            return require(id);
          };
          const chat = window.webModule("/app/store/chat.ts").useChatStore;
          const skills = window.webModule("/app/store/skills.ts").useSkillStore;
          skills.setState({
            _hasHydrated: true,
            installed: {
              translation: {
                ...translation,
                body: "TRANSLATION_INSTRUCTION",
                installedAt: 1,
                enabled: true,
              },
              legacy: {
                ...translation,
                id: "legacy",
                name: "旧联网技能",
                kind: "web",
                body: "Legacy.",
                installedAt: 1,
                enabled: true,
              },
            },
          });
          chat
            .getState()
            .updateTargetSession(
              chat.getState().currentSession(),
              (session) => {
                session.webSearchMode = "off";
                session.activeSkillId = "translation";
                session.mask.syncGlobalConfig = false;
                Object.assign(session.mask.modelConfig, {
                  model: "deepseek-v4.1-flash",
                  providerName: "OpenAI",
                  chatApiFormat: "chat-completions",
                  sendMemory: false,
                });
              },
            );
        }, translation);
        const input = page.locator("#chat-input");
        await input.fill("保留草稿");
        assert.equal(await trigger.getAttribute("aria-pressed"), "false");
        const choose = async (name) => {
          await trigger.click();
          const dialog = page.getByRole("dialog", {
            name: "联网搜索",
            exact: true,
          });
          const option = dialog.getByRole("button", { name, exact: true });
          await option.waitFor();
          await page.waitForFunction(
            (name) =>
              [...document.querySelectorAll("dialog button")].some(
                (button) => button.textContent === name && !button.disabled,
              ),
            name,
          );
          await option.click();
          await dialog.waitFor({ state: "hidden" });
        };
        await choose("快速搜索");
        assert.equal(retrievals.length, 0, "Selecting a mode must not search");
        assert.equal(await input.inputValue(), "保留草稿");
        const geometry = await page.evaluate(() => {
          const buttons = [
            ...document.querySelectorAll('[class*="composer-toolbar"] button'),
          ].filter((button) => button.getBoundingClientRect().width > 0);
          const rects = buttons.map((button) => ({
            name: button.getAttribute("aria-label"),
            rect: button.getBoundingClientRect().toJSON(),
          }));
          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i].rect,
                b = rects[j].rect;
              if (
                Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
              )
                throw new Error(
                  `Overlapping buttons: ${rects[i].name}, ${rects[j].name}`,
                );
            }
          }
          return rects;
        });
        assert.ok(
          geometry.every(({ rect }) => rect.x >= 0 && rect.right <= width + 1),
        );
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-web-search-${width}.png`),
          animations: "disabled",
        });
        const settled = () =>
          page.waitForFunction(
            () =>
              !window
                .webModule("/app/store/chat.ts")
                .useChatStore.getState()
                .currentSession()
                .messages.some((m) => m.streaming),
          );
        const send = async () => {
          await page.evaluate(async () => {
            await window
              .webModule("/app/store/chat.ts")
              .useChatStore.getState()
              .onUserInput("Search this question");
          });
          await settled();
          return modelRequests.at(-1)?.messages;
        };
        let messages = await send();
        assert.equal(retrievals.at(-1).mode, "quick");
        assert.ok(JSON.stringify(messages).includes("TRANSLATION_INSTRUCTION"));
        assert.ok(
          JSON.stringify(messages).includes("https://example.test/evidence"),
        );
        await choose("深度搜索");
        messages = await send();
        assert.equal(retrievals.at(-1).mode, "deep");
        assert.ok(JSON.stringify(messages).includes("untrusted evidence"));
        assert.ok(
          JSON.stringify(messages).includes("Actual retrieved webpage body"),
        );
        const verifyInput = async (messages) => {
          const input = messages.at(-1);
          assert.equal(input.role, "user");
          const text =
            typeof input.content === "string"
              ? input.content
              : input.content.find((part) => part.type === "text").text;
          assert.ok(text.includes("Actual retrieved webpage body"));
          assert.ok(text.includes("https://example.test/evidence"));
          assert.ok(text.includes("untrusted evidence"));
          assert.ok(text.endsWith("Search this question"));
          assert.equal((text.match(/<web_search_results>/g) || []).length, 1);
          const saved = await page.evaluate(
            () =>
              window
                .webModule("/app/store/chat.ts")
                .useChatStore.getState()
                .currentSession().messages,
          );
          assert.ok(!JSON.stringify(saved).includes("web_search_results"));
        };
        await verifyInput(messages);
        const beforeRetry = retrievals.length;
        const beforeRetryModelRequests = modelRequests.length;
        await page.evaluate(async () => {
          const chat = window.webModule("/app/store/chat.ts").useChatStore;
          const session = chat.getState().currentSession();
          await chat
            .getState()
            .retryMessage(session.id, session.messages.at(-1).id);
        });
        await settled();
        assert.equal(retrievals.length, beforeRetry + 1);
        assert.equal(modelRequests.length, beforeRetryModelRequests + 1);
        assert.equal(retrievals.at(-1).mode, "deep");
        await verifyInput(modelRequests.at(-1).messages);
        retrievalFails = true;
        const beforeFailure = modelRequests.length;
        await send();
        assert.equal(
          modelRequests.length,
          beforeFailure,
          "Failed search must not call the model",
        );
        await page.getByText("联网检索测试失败", { exact: true }).waitFor();
        retrievalFails = false;
        await choose("关闭联网");
        const count = retrievals.length;
        messages = await send();
        assert.ok(!JSON.stringify(messages).includes("web_search_results"));
        assert.equal(
          retrievals.length,
          count,
          "Disabled search must not make a retrieval",
        );
        await page.locator('button[aria-controls="composer-skills"]').click();
        assert.equal(
          await page.getByRole("button", { name: "旧联网技能" }).count(),
          0,
        );
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await page.evaluate(() => {
          const chat = window.webModule("/app/store/chat.ts").useChatStore;
          chat
            .getState()
            .updateTargetSession(
              chat.getState().currentSession(),
              (session) => {
                session.activeSkillId = "legacy";
                delete session.webSearchMode;
              },
            );
        });
        assert.equal(await trigger.getAttribute("aria-pressed"), "true");
        await choose("关闭联网");
        await send();
        assert.equal(
          retrievals.length,
          count,
          "Explicit off overrides a legacy skill",
        );
        await page.evaluate(() => {
          const chat = window.webModule("/app/store/chat.ts").useChatStore;
          chat
            .getState()
            .updateTargetSession(
              chat.getState().currentSession(),
              (session) => {
                session.webSearchMode = "deep";
                session.mask.modelConfig.model = "gpt-image-2";
              },
            );
        });
        await trigger.waitFor({ state: "hidden" });
        await page.evaluate(() => {
          const chat = window.webModule("/app/store/chat.ts").useChatStore;
          chat
            .getState()
            .updateTargetSession(
              chat.getState().currentSession(),
              (session) => {
                session.mask.modelConfig.model = "sora-2";
              },
            );
        });
        await trigger.waitFor({ state: "hidden" });
        await send();
        assert.equal(
          retrievals.length,
          count,
          "Video models must never search",
        );
        assert.deepEqual(errors, []);
        console.log(
          `${width}px: actual model payload, fresh retry evidence, unchanged history, failure stops model, modes, legacy compatibility, image/video hiding, no overlap passed`,
        );
      } catch (error) {
        await page.screenshot({
          path: path.join(
            os.tmpdir(),
            `octopus-web-search-failed-${width}.png`,
          ),
        });
        console.error({
          width,
          errors,
          text: (await page.locator("body").innerText()).slice(-1800),
        });
        throw error;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
