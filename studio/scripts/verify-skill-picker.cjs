// Isolated local UI fixtures. No model requests or account writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const definitions = JSON.parse(
  fs.readFileSync("skills/catalog.json", "utf8"),
).skills;
const installed = Object.fromEntries(
  ["translation", "paper-search", "product-photo"].map((id) => [
    id,
    {
      ...definitions.find((skill) => skill.id === id),
      body: fs.readFileSync(`skills/${id}/SKILL.md`, "utf8"),
      installedAt: 1,
      enabled: id !== "paper-search",
    },
  ]),
);

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
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("lang", "cn"));
      await page.route("**/api/**", (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === "/api/config")
          return route.fulfill({ json: { newApiEnabled: true } });
        assert.equal(
          route.request().method(),
          "GET",
          `Unexpected model/account write: ${pathname}`,
        );
        const ok = (data) => route.fulfill({ json: { success: true, data } });
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
        if (pathname.endsWith("/models") || pathname === "/api/remote-models")
          return route.fulfill({
            json: {
              data: ["gpt-4o", "gpt-image-2"].map((id) => ({
                id,
                object: "model",
              })),
            },
          });
        if (pathname === "/api/skills/capabilities")
          return route.fulfill({ json: { web: true, papers: true } });
        return ok([]);
      });
      try {
        await page.goto(`${base}#/chat`);
        const trigger = page.getByRole("button", { name: "技能", exact: true });
        const input = page.locator("#chat-input");
        await input.fill("保留这段草稿");
        const before = await input.boundingBox();
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "已启用技能" });
        await dialog.getByText("暂无已启用技能", { exact: true }).waitFor();
        assert.equal(new URL(page.url()).hash, "#/chat");
        assert.equal(
          (await input.boundingBox()).y,
          before.y,
          "Opening must not shift composer",
        );
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.evaluate((installed) => {
          window.webpackChunk_N_E.push([
            [`picker-fixture-${Date.now()}`],
            {},
            (require) => {
              window.pickerRequire = require;
            },
          ]);
          window.pickerModule = (suffix) => {
            const require = window.pickerRequire;
            return require(Object.keys(require.m).find((id) =>
              id.endsWith(suffix),
            ));
          };
          const skills = window.pickerModule(
            "/app/store/skills.ts",
          ).useSkillStore;
          skills.setState({ installed, _hasHydrated: true });
          const chat = window.pickerModule("/app/store/chat.ts").useChatStore;
          chat
            .getState()
            .updateTargetSession(
              chat.getState().currentSession(),
              (session) => {
                session.mask.syncGlobalConfig = false;
                session.mask.modelConfig.model = "gpt-4o";
                session.mask.modelConfig.chatApiFormat = "chat-completions";
              },
            );
        }, installed);
        await trigger.click();
        const translation = dialog.getByRole("button", {
          name: "翻译",
          exact: true,
        });
        await translation.waitFor();
        assert.equal(await dialog.locator("button[aria-pressed]").count(), 2);
        await translation.click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await input.inputValue(), "保留这段草稿");
        assert.equal(await trigger.getAttribute("aria-pressed"), "true");
        await trigger.click();
        assert.equal(await translation.getAttribute("aria-pressed"), "true");
        assert.equal(
          await translation.evaluate(
            (element) => element === document.activeElement,
          ),
          true,
        );
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-skill-picker-${width}.png`),
          animations: "disabled",
        });
        await page.keyboard.press("Enter");
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await trigger.getAttribute("aria-pressed"), "true");
        await trigger.click();
        await dialog.getByRole("button", { name: "不使用技能" }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await trigger.getAttribute("aria-pressed"), "false");
        await trigger.click();
        if (width > 600) {
          await page.mouse.click(1, 1);
        } else {
          await dialog
            .getByRole("button", { name: "关闭", exact: true })
            .click();
        }
        await dialog.waitFor({ state: "hidden" });
        await page.evaluate(() => {
          const chat = window.pickerModule("/app/store/chat.ts").useChatStore;
          chat
            .getState()
            .updateTargetSession(
              chat.getState().currentSession(),
              (session) => {
                session.mask.modelConfig.model = "gpt-image-2";
              },
            );
        });
        await trigger.click();
        await dialog
          .getByRole("button", { name: "产品摄影", exact: true })
          .waitFor();
        assert.equal(await dialog.locator("button[aria-pressed]").count(), 2);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: /^选择模型:/ }).click();
        const modelDialog = page.getByRole("dialog", {
          name: "选择模型",
          exact: true,
        });
        await modelDialog.waitFor();
        const modelBounds = await modelDialog.boundingBox();
        assert.ok(modelBounds.width > (width > 600 ? 700 : width - 2));
        await modelDialog.getByText("gpt-4o", { exact: true }).first().click();
        await modelDialog.waitFor({ state: "hidden" });
        assert.equal(await input.inputValue(), "保留这段草稿");
        await page.getByRole("button", { name: /^选择模型:/ }).click();
        await page.keyboard.press("Escape");
        await modelDialog.waitFor({ state: "hidden" });
        await page.evaluate(() => {
          const store = window.pickerModule("/app/store/skills.ts").useSkillStore;
          const template = store.getState().installed.translation;
          store.setState({
            installed: Object.fromEntries(
              Array.from({ length: 60 }, (_, index) => [
                `translation-${index}`,
                {
                  ...template,
                  id: `translation-${index}`,
                  name: `翻译技能 ${index}`,
                },
              ]),
            ),
          });
        });
        await trigger.click();
        await dialog.getByRole("button", { name: "翻译技能 59", exact: true }).waitFor();
        const list = dialog.locator("button[aria-pressed]").first().locator("..");
        assert.ok(await list.evaluate((node) => node.scrollHeight > node.clientHeight));
        await dialog.getByRole("button", { name: "关闭", exact: true }).focus();
        await page.keyboard.press("Shift+Tab");
        assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true);
        await dialog.getByRole("button", { name: "翻译技能 59", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await input.inputValue(), "保留这段草稿");
        assert.equal(new URL(page.url()).hash, "#/chat");
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.deepEqual(errors, []);
        console.log(
          `PASS ${width}px: enabled-only list, no navigation/shift, draft, explicit clearing, Escape, dismissal, image filtering, shared model selector`,
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
