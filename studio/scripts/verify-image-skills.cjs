// Local fixture: download real skill documents without sending model requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.UI_TEST_URL || "http://localhost:3001/";
const definitions = JSON.parse(
  fs.readFileSync("skills/catalog.json", "utf8"),
).skills;
const images = definitions.filter((skill) => skill.kind === "image-style");
const additions = images.filter(
  (skill) =>
    skill.id !== "photo-revival" && !skill.sourceUrl.includes("/qzq00767/"),
);

async function assertPreviewFits(viewer) {
  const bounds = await viewer.locator("img").evaluate(async (img) => {
    await img.decode();
    const image = img.getBoundingClientRect();
    const stage = img.parentElement.getBoundingClientRect();
    return {
      loaded: img.naturalWidth > 0 && img.naturalHeight > 0,
      fit: getComputedStyle(img).objectFit,
      inset: [
        image.left - stage.left,
        image.top - stage.top,
        stage.right - image.right,
        stage.bottom - image.bottom,
      ],
      size: [image.width, image.height],
    };
  });
  assert.ok(bounds.loaded, "Preview must load before measuring");
  assert.equal(bounds.fit, "contain");
  assert.ok(bounds.size.every((value) => value > 0));
  assert.ok(
    bounds.inset.every((value) => value >= -1),
    `Preview must fit inside its stage: ${JSON.stringify(bounds)}`,
  );
  assert.ok(
    await viewer.locator('[class*="previewCredit"]').evaluate((credit) => {
      const content = credit.getBoundingClientRect();
      const dialog = credit.closest("dialog").getBoundingClientRect();
      return content.bottom <= dialog.bottom && content.top >= dialog.top;
    }),
    "Attribution and controls must remain visible",
  );
}

(async () => {
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    ...(process.env.UI_PROXY
      ? {
          proxy: {
            server: process.env.UI_PROXY,
            bypass: "localhost,127.0.0.1",
          },
        }
      : {}),
  });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
        reducedMotion: width === 390 ? "reduce" : "no-preference",
      });
      try {
        const page = await context.newPage();
        const errors = [];
        let downloads = 0;
        let imageRequests = 0;
        const previewUrls = new Set(
          definitions.flatMap((skill) =>
            (skill.preview?.images || []).map((image) => image.url),
          ),
        );
        page.on("request", (request) => {
          if (previewUrls.has(request.url())) imageRequests++;
        });
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
              json: { data: [{ id: "gpt-image-2", object: "model" }] },
            });
          return ok([]);
        });
        await page.goto(`${base}#/chat`);
        const emptyDraft = page.locator("#chat-input");
        await emptyDraft.fill("保留技能广场引导草稿");
        await page.getByRole("button", { name: "技能", exact: true }).click();
        const emptyPicker = page.getByRole("dialog", { name: "已启用技能" });
        await emptyPicker
          .getByText("暂无已启用技能", { exact: true })
          .waitFor();
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-empty-skills-${width}.png`),
          animations: "disabled",
        });
        await emptyPicker
          .getByRole("button", { name: "前往技能广场挑选", exact: true })
          .click();
        await emptyPicker.waitFor({ state: "hidden" });
        assert.equal(new URL(page.url()).hash, "#/skills");
        await page.goto(`${base}#/chat`);
        assert.equal(
          await page.locator("#chat-input").inputValue(),
          "保留技能广场引导草稿",
        );
        await page.goto(`${base}#/skills`);
        await page
          .getByRole("heading", { name: additions[0].name, exact: true })
          .waitFor();
        const numberOf = (name) =>
          page
            .locator("article")
            .filter({ has: page.getByRole("heading", { name, exact: true }) })
            .locator('[class*="skillNumber"]');
        assert.equal(await numberOf(definitions[0].name).innerText(), "01");
        await page.getByPlaceholder("搜索技能名称或序号").fill("#17");
        await page
          .getByRole("heading", { name: definitions[16].name, exact: true })
          .waitFor();
        assert.equal(await page.locator("article").count(), 1);
        assert.equal(await numberOf(definitions[16].name).innerText(), "17");
        await page.getByPlaceholder("搜索技能名称或序号").fill("");
        await page.getByRole("button", { name: "下一页", exact: true }).click();
        assert.equal(await numberOf(definitions[20].name).innerText(), "21");
        await page.getByRole("button", { name: "上一页", exact: true }).click();
        await page
          .getByRole("combobox", { name: "技能分类" })
          .selectOption("image");
        await page
          .getByRole("heading", { name: "产品摄影", exact: true })
          .waitFor();
        assert.equal(await numberOf("产品摄影").innerText(), "05");
        const example = definitions.find(
          (skill) => skill.id === "gc-minimal-zine-poster",
        );
        assert.equal(await page.locator("article img").count(), 0);
        assert.equal(
          imageRequests,
          0,
          "Collapsed skills must not download examples",
        );
        for (const id of [
          "photo-to-ink-painting",
          "paper-cut-illustration",
          "solar-polaroid",
          "commercial-poster",
          "photo-to-minimal-illustration",
        ]) {
          const entry = definitions.find((skill) => skill.id === id);
          await page.getByPlaceholder("搜索技能名称或序号").fill(entry.name);
          assert.equal(
            await numberOf(entry.name).innerText(),
            String(definitions.indexOf(entry) + 1).padStart(2, "0"),
          );
          await page
            .getByRole("button", { name: entry.name, exact: true })
            .click();
          const gallery = page.getByRole("region", {
            name: `${entry.name}风格示例`,
          });
          const image = gallery.locator("img").first();
          await image.scrollIntoViewIfNeeded();
          await image.evaluate(
            (img) =>
              new Promise((resolve, reject) => {
                if (img.complete)
                  return img.naturalWidth
                    ? resolve(true)
                    : reject(Error("Empty style preview"));
                img.onload = () => resolve(true);
                img.onerror = () => reject(Error("Style preview failed"));
              }),
          );
          await page.screenshot({
            path: path.join(os.tmpdir(), `octopus-${id}-${width}.png`),
            animations: "disabled",
          });
          if (id === "commercial-poster") {
            const landscapeUrl = entry.preview.images[1].url;
            await page.route(landscapeUrl, (route) =>
              route.fulfill({
                contentType: "image/svg+xml",
                body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#ddd"/><rect x="4" y="4" width="1592" height="892" fill="none" stroke="#222" stroke-width="8"/></svg>',
              }),
            );
            await page
              .getByRole("button", {
                name: `预览${entry.name}风格`,
                exact: true,
              })
              .first()
              .click();
            const posterViewer = page.getByRole("dialog", {
              name: `${entry.name}风格预览`,
            });
            for (const height of [900, 600]) {
              await page.setViewportSize({ width, height });
              await assertPreviewFits(posterViewer);
              await page.screenshot({
                path: path.join(
                  os.tmpdir(),
                  `octopus-poster-fit-${width}-${height}.png`,
                ),
                animations: "disabled",
              });
            }
            await posterViewer
              .getByRole("button", { name: "下一张示例" })
              .click();
            await assertPreviewFits(posterViewer);
            await page.setViewportSize({ width, height: 900 });
            await assertPreviewFits(posterViewer);
            await page.keyboard.press("Escape");
            await posterViewer.waitFor({ state: "hidden" });
            await page.unroute(landscapeUrl);
          }
        }
        await page.getByPlaceholder("搜索技能名称或序号").fill("");
        const expandTrigger = page.getByRole("button", {
          name: example.name,
          exact: true,
        });
        assert.equal(
          await expandTrigger.getAttribute("aria-expanded"),
          "false",
        );
        await page.route(example.preview.images[1].url, (route) =>
          route.abort(),
        );
        await expandTrigger.click();
        const expanded = page.getByRole("region", {
          name: `${example.name}风格示例`,
        });
        await expanded.waitFor();
        assert.equal(await expandTrigger.getAttribute("aria-expanded"), "true");
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-style-expanded-${width}.png`),
          animations: "disabled",
        });
        const previewTrigger = page.getByRole("button", {
          name: `预览${example.name}风格`,
          exact: true,
        });
        await previewTrigger.click();
        const viewer = page.getByRole("dialog", {
          name: `${example.name}风格预览`,
        });
        await viewer.waitFor();
        await viewer.locator("img").evaluate(
          (img) =>
            new Promise((resolve, reject) => {
              if (img.complete)
                return img.naturalWidth
                  ? resolve(true)
                  : reject(new Error("Example did not load"));
              img.addEventListener("load", () => resolve(true), { once: true });
              img.addEventListener(
                "error",
                () => reject(new Error("Example download failed")),
                { once: true },
              );
            }),
        );
        assert.equal(
          await viewer
            .locator("img")
            .evaluate((img) => getComputedStyle(img).objectFit),
          "contain",
        );
        assert.ok(
          await viewer.getByRole("link", { name: /LiamGvchi/ }).isVisible(),
        );
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-style-preview-${width}.png`),
          animations: "disabled",
        });
        await viewer.getByRole("button", { name: "下一张示例" }).click();
        await viewer
          .getByRole("status")
          .filter({ hasText: "预览暂不可用" })
          .waitFor();
        await viewer.getByRole("button", { name: "上一张示例" }).click();
        await viewer.locator("img").waitFor();
        await page.keyboard.press("Escape");
        await viewer.waitFor({ state: "hidden" });
        assert.equal(
          await previewTrigger.evaluate(
            (button) => button === document.activeElement,
          ),
          true,
        );
        const anotherExpand = page.getByRole("button", {
          name: "照片手绘",
          exact: true,
        });
        await anotherExpand.click();
        await expanded.waitFor({ state: "hidden" });
        assert.equal(
          await expandTrigger.getAttribute("aria-expanded"),
          "false",
        );
        assert.equal(await anotherExpand.getAttribute("aria-expanded"), "true");
        await anotherExpand.click();
        assert.equal(await page.locator("article img").count(), 0);
        await page.unroute(example.preview.images[1].url);
        for (let offset = 0; offset < images.length; offset += 20) {
          const visible = images.slice(offset, offset + 20);
          await page
            .getByRole("heading", { name: visible[0].name, exact: true })
            .waitFor();
          assert.equal(await page.locator("article").count(), visible.length);
          for (const skill of visible.filter((entry) =>
            additions.includes(entry),
          )) {
            const row = page.locator("article").filter({
              has: page.getByRole("heading", { name: skill.name, exact: true }),
            });
            await row
              .getByRole("button", { name: "启用", exact: true })
              .click();
            await row
              .getByRole("button", { name: "停用", exact: true })
              .waitFor();
            assert.equal(new URL(page.url()).hash, "#/skills");
          }
          if (offset + 20 < images.length)
            await page
              .getByRole("button", { name: "下一页", exact: true })
              .click();
        }
        assert.equal(downloads, additions.length);
        await page.getByRole("button", { name: "上一页", exact: true }).click();
        await page
          .getByRole("heading", { name: images[0].name, exact: true })
          .waitFor();
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-image-skills-${width}.png`),
          animations: "disabled",
        });
        await page.reload();
        await page
          .getByRole("heading", { name: additions[0].name, exact: true })
          .waitFor();
        const enabled = page.locator("article").filter({
          has: page.getByRole("heading", {
            name: additions[0].name,
            exact: true,
          }),
        });
        await enabled
          .getByRole("button", { name: "停用", exact: true })
          .waitFor();
        await page.goto(`${base}#/chat`);
        const input = page.locator("#chat-input");
        await input.fill("保留照片编辑草稿");
        await page.evaluate(() => {
          let modules;
          window.webpackChunk_N_E.push([
            [`image-skill-fixture-${Date.now()}`],
            {},
            (require) => {
              modules = require;
            },
          ]);
          const id = Object.keys(modules.m).find((id) =>
            id.endsWith("/app/store/chat.ts"),
          );
          const chat = modules(id).useChatStore;
          chat
            .getState()
            .updateTargetSession(
              chat.getState().currentSession(),
              (session) => {
                session.mask.syncGlobalConfig = false;
                session.mask.modelConfig.model = "gpt-image-2";
              },
            );
        });
        await page.getByRole("button", { name: "技能", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "已启用技能" });
        await dialog
          .getByRole("button", { name: additions.at(-1).name, exact: true })
          .waitFor();
        assert.equal(
          await dialog.locator("button[aria-pressed]").count(),
          additions.length + 1,
        );
        for (const skill of additions)
          assert.equal(
            await dialog
              .getByRole("button", { name: skill.name, exact: true })
              .getAttribute("title"),
            skill.description,
          );
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-image-picker-${width}.png`),
          animations: "disabled",
        });
        await dialog
          .getByRole("button", { name: additions.at(-1).name, exact: true })
          .click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(await input.inputValue(), "保留照片编辑草稿");
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.deepEqual(errors, []);
        console.log(
          `PASS ${width}px: collapsed previews make no image requests; accordion, modal, fallback, focus, ${additions.length} downloads, image selection, draft preserved`,
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
