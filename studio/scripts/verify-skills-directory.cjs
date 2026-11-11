// Browser-only catalog fixtures; no account writes or model requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const original = JSON.parse(fs.readFileSync("skills/catalog.json", "utf8"));
const skills = [
  ...original.skills,
  ...Array.from({ length: 100 - original.skills.length }, (_, index) => ({
    ...original.skills[index % original.skills.length],
    id: `fixture-${index}`,
    name:
      index === 0
        ? "用于验证很长标题自动换行与对齐的模拟技能名称".repeat(2)
        : `测试技能 ${index}`,
    description:
      index === 0
        ? "这是用于验证长描述完整查看与目录布局的模拟内容。".repeat(15)
        : `模拟技能的简短作用描述 ${index}。`,
  })),
];

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1440, 1024, 390, 320]) {
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
        if (pathname === "/api/skills/preview/catalog.json")
          return route.fulfill({ json: { version: 1, skills } });
        if (pathname.startsWith("/api/skills/preview/"))
          return route.continue();
        const ok = (data) => route.fulfill({ json: { success: true, data } });
        if (pathname === "/api/config")
          return route.fulfill({ json: { newApiEnabled: true } });
        assert.equal(
          route.request().method(),
          "GET",
          `Unexpected API write: ${pathname}`,
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
          return route.fulfill({ json: { web: true, papers: true } });
        if (pathname.endsWith("/models") || pathname === "/api/remote-models")
          return route.fulfill({
            json: {
              data: ["gpt-4o", "gpt-image-2"].map((id) => ({
                id,
                object: "model",
              })),
            },
          });
        return ok([]);
      });
      try {
        await page.goto(`${base}#/skills`);
        await page.getByText("共 100 个技能", { exact: true }).waitFor();
        assert.equal(await page.locator("article").count(), 20);
        const bounds = () =>
          page.locator("article").evaluateAll((items) =>
            items.map((item) => {
              const { x, y, width, height } = item.getBoundingClientRect();
              return { x, y, width, height };
            }),
          );
        const long = skills[7];
        const info = page.getByRole("button", {
          name: `查看${long.name}详情`,
          exact: true,
        });
        await info.scrollIntoViewIfNeeded();
        const before = await bounds();
        await info.click();
        const panel = page.getByRole("complementary", {
          name: `${long.name}详情`,
        });
        await panel.getByText(long.description, { exact: true }).waitFor();
        assert.deepEqual(
          await bounds(),
          before,
          "Details do not resize the catalog",
        );
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "hidden" });
        assert.equal(
          await info.evaluate((element) => element === document.activeElement),
          true,
        );
        const next = page.getByRole("button", { name: "下一页", exact: true });
        for (let i = 0; i < 4; i++) await next.click();
        await page.getByText("5 / 5", { exact: true }).waitFor();
        assert.equal(await next.isDisabled(), true);
        assert.equal(await page.locator("article").count(), 20);
        const search = page.getByRole("textbox", {
          name: "搜索技能",
          exact: true,
        });
        await search.fill("照片手绘");
        await page.getByText("共 1 个技能", { exact: true }).waitFor();
        assert.equal(await page.locator("article").count(), 1);
        assert.equal(
          await page.getByRole("navigation", { name: "技能分页" }).count(),
          0,
        );
        await search.fill("");
        await page.getByText("1 / 5", { exact: true }).waitFor();
        await page
          .getByRole("combobox", { name: "技能分类" })
          .selectOption("image");
        const categoryCount = skills.filter(
          (skill) => skill.category === "image",
        ).length;
        await page
          .getByText(`共 ${categoryCount} 个技能`, { exact: true })
          .waitFor();
        await page
          .getByRole("combobox", { name: "技能分类" })
          .selectOption("all");
        const entry = page.locator("article").filter({
          has: page.getByRole("heading", { name: "翻译", exact: true }),
        });
        const actionBox = await entry
          .getByRole("button", { name: "启用", exact: true })
          .boundingBox();
        await entry.getByRole("button", { name: "启用", exact: true }).click();
        const stop = entry.getByRole("button", { name: "停用", exact: true });
        await stop.waitFor();
        assert.equal(new URL(page.url()).hash, "#/skills");
        const stopBox = await stop.boundingBox();
        assert.equal(
          actionBox.x,
          stopBox.x,
          "Enable state preserves action alignment",
        );
        assert.equal(actionBox.width, stopBox.width);
        await entry
          .getByRole("button", { name: "查看翻译详情", exact: true })
          .click();
        const translationPanel = page.getByRole("complementary", {
          name: "翻译详情",
        });
        await translationPanel
          .getByRole("button", { name: "移除本地技能", exact: true })
          .click();
        await translationPanel.waitFor({ state: "hidden" });
        await entry
          .getByRole("button", { name: "启用", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "客户端仓库", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "客户端技能仓库", exact: true })
          .waitFor();
        assert.equal(await page.locator("article").count(), 0);
        assert.equal(
          await page.getByRole("link", { name: /^下载/ }).count(),
          4,
        );
        await page
          .getByRole("button", { name: "全部技能", exact: true })
          .click();
        await page.getByText("1 / 5", { exact: true }).waitFor();
        await search.fill("no-such-skill-fixture");
        await page.getByText("没有找到匹配的技能", { exact: true }).waitFor();
        await search.fill("");
        await page.getByText("共 100 个技能", { exact: true }).waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-skills-directory-${width}.png`),
        });
        assert.deepEqual(errors, []);
        console.log(
          `PASS ${width}px: 100 skills, pagination/filter resets, long content, stable details/actions, keyboard focus, install/remove, resources, empty state`,
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
