// Isolated browser fixtures; no real account writes or model calls.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const errors = [];
      let documentDownloads = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("lang", "cn");
        localStorage.setItem(
          "app-config",
          JSON.stringify({
            version: 4.4,
            state: { theme: "light", colorTheme: "violet", models: [] },
          }),
        );
      });
      await page.route("**/api/**", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith("/api/skills/preview/")) {
          if (pathname.endsWith("SKILL.md")) documentDownloads++;
          return route.continue();
        }
        const ok = (data) => route.fulfill({ json: { success: true, data } });
        if (pathname === "/api/config")
          return route.fulfill({ json: { newApiEnabled: true } });
        assert.equal(
          route.request().method(),
          "GET",
          `Unexpected write: ${pathname}`,
        );
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
        if (pathname === "/api/new-api/status")
          return ok({ enabled: true, configured: true, quotaPerUnit: 500000 });
        if (pathname === "/api/skills/capabilities")
          return route.fulfill({ json: { web: false, papers: true } });
        if (pathname.endsWith("/models") || pathname === "/api/remote-models")
          return route.fulfill({
            json: {
              data: ["gpt-4o", "gpt-image-2"].map((id) => ({
                id,
                object: "model",
              })),
            },
          });
        if (pathname === "/api/announcement")
          return route.fulfill({ json: { announcement: null } });
        return ok([]);
      });
      try {
        await page.goto(`${base}#/skills`);
        await page
          .getByRole("heading", { name: "翻译", exact: true })
          .waitFor();
        await page.evaluate(() => {
          window.webpackChunk_N_E.push([
            [`activation-${Date.now()}`],
            {},
            (require) => {
              window.skillTestModule = (suffix) =>
                require(Object.keys(require.m).find((id) =>
                  id.endsWith(suffix),
                ));
            },
          ]);
          const chat =
            window.skillTestModule("/app/store/chat.ts").useChatStore;
          chat
            .getState()
            .updateTargetSession(
              chat.getState().currentSession(),
              (session) => {
                session.mask = {
                  ...session.mask,
                  syncGlobalConfig: false,
                  modelConfig: {
                    ...session.mask.modelConfig,
                    model: "gpt-4o",
                    providerName: "OpenAI",
                    chatApiFormat: "chat-completions",
                  },
                };
              },
            );
        });
        const entry = (name) =>
          page.locator("article").filter({
            has: page.getByRole("heading", { name, exact: true }),
          });
        assert.equal(
          await entry("联网搜索")
            .getByRole("button", { name: "启用", exact: true })
            .isDisabled(),
          true,
        );
        const originalOrder = await page
          .locator("article h2")
          .allTextContents();
        await entry("翻译")
          .getByRole("button", { name: "启用", exact: true })
          .click();
        await entry("翻译")
          .getByRole("button", { name: "停用", exact: true })
          .waitFor();
        assert.equal(
          new URL(page.url()).hash,
          "#/skills",
          "Enabling stays in market",
        );
        assert.deepEqual(
          await page.locator("article h2").allTextContents(),
          originalOrder,
          "Enabling preserves catalog order",
        );
        await entry("翻译")
          .getByText("保留语义、语气与原文结构，输出自然译文。", {
            exact: true,
          })
          .waitFor();
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-skills-compact-${width}.png`),
        });
        const rows = await page.locator("article").evaluateAll((items) =>
          items.slice(0, 2).map((item) => {
            const box = item.getBoundingClientRect();
            return { x: box.x, y: box.y };
          }),
        );
        assert.equal(
          rows[0].x,
          rows[1].x,
          "Directory rows share the same baseline",
        );
        assert(rows[1].y > rows[0].y);
        await page.goto(`${base}#/chat`);
        await page.getByTitle("技能", { exact: true }).click();
        const translationToggle = page.getByRole("button", {
          name: "翻译",
          exact: true,
        });
        await translationToggle.waitFor();
        assert.equal(
          await translationToggle.getAttribute("aria-pressed"),
          "true",
        );
        assert.equal(
          documentDownloads,
          1,
          "First enable downloads automatically",
        );
        await page.goto(`${base}#/skills`);
        await entry("翻译")
          .getByRole("button", { name: "停用", exact: true })
          .click();
        await entry("翻译")
          .getByRole("button", { name: "启用", exact: true })
          .click();
        await entry("翻译")
          .getByRole("button", { name: "停用", exact: true })
          .waitFor();
        assert.equal(new URL(page.url()).hash, "#/skills");
        await page.goto(`${base}#/chat`);
        await page.getByTitle("技能", { exact: true }).click();
        await translationToggle.waitFor();
        assert.equal(
          await translationToggle.getAttribute("aria-pressed"),
          "true",
        );
        assert.equal(documentDownloads, 1, "Re-enabling uses local copy");
        await page.goto(`${base}#/skills`);
        await entry("照片手绘")
          .getByRole("button", { name: "启用", exact: true })
          .click();
        await entry("照片手绘")
          .getByRole("button", { name: "停用", exact: true })
          .waitFor();
        assert.equal(new URL(page.url()).hash, "#/skills");
        await page.goto(`${base}#/chat`);
        await page.getByTitle("技能", { exact: true }).click();
        const photoToggle = page.getByRole("button", {
          name: "照片手绘",
          exact: true,
        });
        await photoToggle.waitFor();
        assert.equal(await photoToggle.getAttribute("aria-pressed"), "true");
        const config = await page.evaluate(
          () =>
            window
              .skillTestModule("/app/store/chat.ts")
              .useChatStore.getState()
              .currentSession().mask.modelConfig,
        );
        assert.equal(
          config.model,
          "gpt-image-2",
          "Image style selects compatible model",
        );
        await page.goto(`${base}#/skills`);
        await entry("翻译")
          .getByRole("button", { name: "停用", exact: true })
          .click();
        await entry("翻译")
          .getByRole("button", { name: "启用", exact: true })
          .click();
        await entry("翻译")
          .getByRole("button", { name: "停用", exact: true })
          .waitFor();
        assert.equal(new URL(page.url()).hash, "#/skills");
        await page.goto(`${base}#/chat`);
        await page.getByTitle("技能", { exact: true }).click();
        await translationToggle.waitFor();
        assert.equal(
          await translationToggle.getAttribute("aria-pressed"),
          "true",
        );
        const selectedModel = await page.evaluate(
          () =>
            window
              .skillTestModule("/app/store/chat.ts")
              .useChatStore.getState()
              .currentSession().mask.modelConfig.model,
        );
        assert.equal(
          selectedModel,
          "gpt-4o",
          "Text skill selects compatible chat model",
        );
        await page.goto(`${base}#/skills`);
        await entry("翻译")
          .getByText("当前对话已启用", { exact: true })
          .waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-skills-enable-${width}.png`),
        });
        assert.deepEqual(errors, []);
        console.log(
          `PASS ${width}px: one-click download/enable, cached reuse, disable, compatible model selection, service status and layout`,
        );
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
