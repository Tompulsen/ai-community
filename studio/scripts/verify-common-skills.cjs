// Local browser fixtures; account/model calls are mocked and no message is sent.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const additions = JSON.parse(
  fs.readFileSync("skills/catalog.json", "utf8"),
).skills.filter(
  (skill) =>
    skill.kind === "prompt" &&
    ["writing", "coding", "productivity"].includes(skill.category),
);

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
      });
      try {
        const page = await context.newPage();
        const errors = [];
        let downloads = 0;
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => localStorage.setItem("lang", "cn"));
        await page.route("**/api/**", (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === "/api/config")
            return route.fulfill({ json: { newApiEnabled: true } });
          assert.equal(route.request().method(), "GET");
          if (pathname.startsWith("/api/skills/preview/")) {
            if (pathname.endsWith("/SKILL.md")) downloads++;
            return route.continue();
          }
          const ok = (data) => route.fulfill({ json: { success: true, data } });
          if (pathname === "/api/new-api/bootstrap")
            return ok({
              config: { newApiEnabled: true },
              session: {
                authenticated: true,
                selectedTokenId: 10,
                user: { id: 7, username: "fixture", group: "default" },
              },
            });
          if (pathname === "/api/new-api/session")
            return ok({
              authenticated: true,
              selectedTokenId: 10,
              user: { id: 7, username: "fixture", group: "default" },
            });
          if (pathname === "/api/new-api/status")
            return ok({
              enabled: true,
              configured: true,
              quotaPerUnit: 500000,
            });
          if (pathname === "/api/skills/capabilities")
            return route.fulfill({ json: { web: true, papers: true } });
          if (pathname.endsWith("/models") || pathname === "/api/remote-models")
            return route.fulfill({
              json: { data: [{ id: "gpt-4o", object: "model" }] },
            });
          return ok([]);
        });
        await page.goto(`${base}#/skills`);
        await page
          .getByRole("heading", { name: "自然化润色", exact: true })
          .waitFor()
          .catch(async (error) => {
            console.error(
              "Marketplace load failed:",
              await page.locator("body").innerText(),
            );
            console.error("Page errors:", errors);
            throw error;
          });
        const category = page.getByRole("combobox", { name: "技能分类" });
        const selectCategory = async (value) => {
          if (
            (await category.evaluate((element) => element.tagName)) === "SELECT"
          ) {
            await category.selectOption(value);
          } else {
            await category.click();
            await page
              .getByRole("option", {
                name: {
                  all: "全部分类",
                  writing: "写作与润色",
                  coding: "编程与排错",
                  productivity: "思考与效率",
                }[value],
                exact: true,
              })
              .click();
          }
        };
        for (const value of ["writing", "coding", "productivity"]) {
          await selectCategory(value);
          const names = additions
            .filter((skill) => skill.category === value)
            .map((skill) => skill.name);
          await page
            .getByRole("heading", { name: names[0], exact: true })
            .waitFor();
          assert.equal(
            await page.locator("article").count(),
            names.length + (value === "writing" ? 1 : 0),
          );
          if (value === "writing") {
            const client = page.locator("article").filter({
              has: page.getByRole("heading", {
                name: "Lieflat Less AI Tone",
                exact: true,
              }),
            });
            assert.equal(
              await client
                .getByRole("button", { name: "启用", exact: true })
                .count(),
              0,
            );
            assert.equal(
              await client
                .getByRole("link", { name: "查看", exact: true })
                .getAttribute("href"),
              "https://github.com/larashero3-dotcom/lieflat-less-ai-tone",
            );
          }
          for (const name of names) {
            const entry = page.locator("article").filter({
              has: page.getByRole("heading", { name, exact: true }),
            });
            await entry
              .getByRole("button", { name: "启用", exact: true })
              .click();
            await entry
              .getByRole("button", { name: "停用", exact: true })
              .waitFor();
            assert.equal(new URL(page.url()).hash, "#/skills");
          }
        }
        assert.equal(downloads, additions.length);
        await selectCategory("writing");
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-common-skills-${width}.png`),
          animations: "disabled",
        });
        await page.goto(`${base}#/chat`);
        const input = page.locator("#chat-input");
        await input.fill("保留这份草稿");
        const trigger = page.locator('button[aria-controls="composer-skills"]');
        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "已启用技能" });
        await dialog
          .getByRole("button", { name: "SQL 助手", exact: true })
          .waitFor();
        assert.equal(
          await dialog.locator("button[aria-pressed]").count(),
          additions.length + 1,
        );
        for (const skill of additions) {
          const option = dialog.getByRole("button", {
            name: skill.name,
            exact: true,
          });
          assert.equal(await option.getAttribute("title"), skill.description);
        }
        await dialog
          .getByRole("button", { name: "SQL 助手", exact: true })
          .click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await input.inputValue(), "保留这份草稿");
        await trigger.click();
        assert.equal(
          await dialog
            .getByRole("button", { name: "SQL 助手", exact: true })
            .getAttribute("aria-pressed"),
          "true",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.deepEqual(errors, []);
        console.log(
          `PASS ${width}px: ${additions.length} real local downloads, client source link, category filters, persistent enablement, composer selection, draft preserved`,
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
