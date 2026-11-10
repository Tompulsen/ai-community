// Isolated browser fixtures. No real account writes or paid model calls.
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  let retrievals = 0;
  let fixtureUser = 7;
  let actualPayload;
  const errors = [];
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
    if (pathname.startsWith("/api/skills/preview/")) return route.continue();
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (pathname.endsWith("/chat/completions")) {
      actualPayload = route.request().postDataJSON();
      return route.fulfill({
        json: {
          choices: [
            {
              message: { role: "assistant", content: "Fixture response" },
              finish_reason: "stop",
            },
          ],
        },
      });
    }
    if (pathname === "/api/config")
      return route.fulfill({ json: { newApiEnabled: true } });
    if (pathname === "/api/new-api/status")
      return ok({ enabled: true, configured: true, quotaPerUnit: 500000 });
    if (pathname === "/api/new-api/session")
      return ok({
        authenticated: true,
        selectedTokenId: null,
        user: { id: fixtureUser, username: "fixture", group: "default" },
      });
    if (pathname === "/api/skills/capabilities")
      return route.fulfill({ json: { web: false, papers: true } });
    if (pathname === "/api/skills/retrieve") {
      retrievals++;
      if (retrievals === 2) return; // Pending request is aborted by the chat controller.
      return route.fulfill({
        json: {
          sources: [
            {
              title: "Verified paper",
              url: "https://doi.org/10.123/example",
              snippet: "Author · 2026",
            },
          ],
        },
      });
    }
    if (pathname === "/api/announcement")
      return route.fulfill({ json: { announcement: null } });
    if (pathname.endsWith("/models"))
      return route.fulfill({ json: { data: [] } });
    assert.equal(
      route.request().method(),
      "GET",
      `Unexpected external write: ${pathname}`,
    );
    return ok([]);
  });
  try {
    await page.goto(`${base}#/chat`);
    await page.getByTitle("技能", { exact: true }).waitFor();
    await page.goto(`${base}#/skills`);
    await page.getByText("全部技能", { exact: true }).waitFor();
    await page.evaluate(() => {
      window.webpackChunk_N_E.push([
        [`skills-test-${Date.now()}`],
        {},
        (require) => {
          window.skillsTestRequire = require;
        },
      ]);
      window.skillModule = (suffix) => {
        const require = window.skillsTestRequire;
        const id = Object.keys(require.m).find((id) => id.endsWith(suffix));
        if (!id) throw new Error(`Module not found: ${suffix}`);
        return require(id);
      };
      window.originalSkillChat = window.skillModule(
        "/app/client/platforms/openai.ts",
      ).ChatGPTApi.prototype.chat;
      window.skillModule(
        "/app/client/platforms/openai.ts",
      ).ChatGPTApi.prototype.chat = async function (options) {
        window.capturedSkillCalls ??= [];
        window.capturedSkillCalls.push(
          JSON.parse(
            JSON.stringify({
              messages: options.messages,
              config: options.config,
            }),
          ),
        );
      };
      window.skillModule(
        "/app/client/image-generation.ts",
      ).ImageGenerationService.prototype.generateImage = async function (
        options,
        imageOptions,
      ) {
        window.capturedImageSkill = JSON.parse(
          JSON.stringify(options.messages),
        );
        window.capturedImageOptions = imageOptions;
      };
    });
    await page.waitForFunction(
      () =>
        window.skillModule("/app/store/skills.ts").useSkillStore.getState()
          ._hasHydrated,
    );
    const result = await page.evaluate(async () => {
      const skillStore = window.skillModule(
        "/app/store/skills.ts",
      ).useSkillStore;
      const chatStore = window.skillModule("/app/store/chat.ts").useChatStore;
      const catalog = await window
        .skillModule("/app/skills/catalog.ts")
        .loadSkillCatalog();
      for (const id of ["translation", "paper-search", "photo-revival"]) {
        await skillStore
          .getState()
          .install(catalog.find((skill) => skill.id === id));
        skillStore.getState().setEnabled(id, true);
      }
      const session = chatStore.getState().currentSession();
      chatStore.getState().updateTargetSession(session, (target) => {
        target.mask.syncGlobalConfig = false;
        target.mask.modelConfig.model = "gpt-4o";
        target.mask.modelConfig.chatApiFormat = "chat-completions";
        target.mask.modelConfig.providerName = "OpenAI";
        target.activeSkillId = "translation";
      });
      await chatStore.getState().onUserInput("Hello");
      const first = window.capturedSkillCalls.at(-1);
      const originalHistory = JSON.stringify(
        chatStore.getState().currentSession().messages,
      );
      chatStore
        .getState()
        .updateTargetSession(
          chatStore.getState().currentSession(),
          (target) => {
            target.activeSkillId = undefined;
          },
        );
      await chatStore.getState().onUserInput("No skill");
      const disabled = window.capturedSkillCalls.at(-1);
      chatStore
        .getState()
        .updateTargetSession(
          chatStore.getState().currentSession(),
          (target) => {
            target.activeSkillId = "paper-search";
          },
        );
      await chatStore.getState().onUserInput("Language research");
      const papers = window.capturedSkillCalls.at(-1);
      chatStore
        .getState()
        .updateTargetSession(
          chatStore.getState().currentSession(),
          (target) => {
            target.mask.modelConfig.model = "gpt-image-1";
            target.activeSkillId = "photo-revival";
            target.mask.modelConfig.size = "16:9";
          },
        );
      await chatStore
        .getState()
        .onUserInput("Draw my photo in 16:9", ["data:image/png;base64,YQ=="]);
      return {
        first,
        originalHistory,
        disabled,
        papers,
        images: window.capturedImageSkill,
        imageOptions: window.capturedImageOptions,
        imageHistory: chatStore.getState().currentSession().messages.at(-2),
        finalModel: chatStore.getState().currentSession().mask.modelConfig,
        calls: window.capturedSkillCalls,
      };
    });
    assert.match(JSON.stringify(result.first.messages), /Active skill: 翻译/);
    assert.doesNotMatch(
      result.originalHistory,
      /Translate the user's|Active skill/,
    );
    assert.doesNotMatch(
      JSON.stringify(result.disabled.messages),
      /Active skill/,
    );
    assert.match(
      JSON.stringify(result.papers.messages),
      /doi\.org\/10\.123\/example/,
    );
    assert.match(
      JSON.stringify(result.images) || JSON.stringify(result.finalModel),
      /Image style direction/,
    );
    assert.doesNotMatch(
      JSON.stringify(result.imageHistory),
      /Image style direction/,
    );
    assert.match(JSON.stringify(result.images), /Photo Revival/);
    assert.match(JSON.stringify(result.images), /take priority/);
    assert.deepEqual(result.imageOptions.referenceImages, [
      "data:image/png;base64,YQ==",
    ]);
    assert.equal(result.finalModel.size, "16:9");
    const pendingRetrieval = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/skills/retrieve",
    );
    await page.evaluate(() => {
      const store = window.skillModule("/app/store/chat.ts").useChatStore;
      store
        .getState()
        .updateTargetSession(store.getState().currentSession(), (target) => {
          target.mask.modelConfig.model = "gpt-4o";
          target.activeSkillId = "paper-search";
        });
      window.beforeAbortCalls = window.capturedSkillCalls.length;
      window.pendingSkillRequest = store
        .getState()
        .onUserInput("Cancel this search");
    });
    await pendingRetrieval;
    await page.evaluate(async () => {
      window
        .skillModule("/app/client/controller.ts")
        .ChatControllerPool.stopAll();
      await window.pendingSkillRequest;
    });
    assert.equal(
      await page.evaluate(
        () => window.capturedSkillCalls.length === window.beforeAbortCalls,
      ),
      true,
    );
    assert.equal(retrievals, 2);
    // Wait until scoped persistence has committed before exporting a snapshot.
    await page.waitForFunction(async () => {
      const db = await new Promise((resolve) => {
        const request = indexedDB.open("keyval-store");
        request.onsuccess = () => resolve(request.result);
      });
      return new Promise((resolve) => {
        const request = db
          .transaction("keyval")
          .objectStore("keyval")
          .get("octopus:user-7:skills-store");
        request.onsuccess = () => {
          db.close();
          resolve(
            Object.keys(
              JSON.parse(request.result || "{}").state?.installed || {},
            ).length === 3,
          );
        };
      });
    });
    await page.goto(`${base}#/settings`);
    await page.getByText("本地数据与备份", { exact: true }).waitFor();
    const exported = await page.evaluate(async () => {
      const { createLocalBackup } = window.skillModule(
        "/app/utils/local-backup.ts",
      );
      const snapshot = await createLocalBackup({
        chats: true,
        images: false,
        settings: true,
      });
      return {
        skillIds: Object.keys(snapshot.skills),
        activeSkillId: snapshot.chats[0].activeSkillId,
      };
    });
    assert.equal(exported.skillIds.length, 3);
    assert.equal(exported.activeSkillId, "paper-search");
    const actualRequest = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/chat/completions"),
    );
    await page.evaluate(async () => {
      window.skillModule(
        "/app/client/platforms/openai.ts",
      ).ChatGPTApi.prototype.chat = window.originalSkillChat;
      const chat = window.skillModule("/app/store/chat.ts").useChatStore;
      chat
        .getState()
        .updateTargetSession(chat.getState().currentSession(), (target) => {
          target.mask.modelConfig.model = "o3";
          target.mask.modelConfig.stream = false;
          target.activeSkillId = "translation";
        });
      await chat.getState().onUserInput("Reasoning model translation");
    });
    await actualRequest;
    assert.equal(actualPayload.model, "o3");
    assert.match(JSON.stringify(actualPayload.messages), /Active skill: 翻译/);
    assert.equal(
      actualPayload.messages.find((message) =>
        JSON.stringify(message.content).includes("Active skill:"),
      ).role,
      "user",
    );
    fixtureUser = 8;
    await page.goto(`${base}#/chat`);
    await page.reload();
    await page.getByTitle("技能", { exact: true }).waitFor();
    await page.evaluate(() => {
      window.webpackChunk_N_E.push([
        [`skills-isolation-${Date.now()}`],
        {},
        (require) => {
          const id = Object.keys(require.m).find((id) =>
            id.endsWith("/app/store/skills.ts"),
          );
          window.testSkillStore = require(id).useSkillStore;
        },
      ]);
    });
    await page.waitForFunction(
      () => window.testSkillStore.getState()._hasHydrated,
    );
    assert.equal(
      await page.evaluate(
        () => Object.keys(window.testSkillStore.getState().installed).length,
      ),
      0,
      "Another account must not inherit installed skills",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real skill installation, ephemeral outbound context, disable, paper provenance, image style, retrieval cancellation, scoped persistence and backup.",
    );
  } catch (error) {
    console.error("Browser errors:", errors);
    console.error((await page.locator("body").innerText()).slice(0, 3000));
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
