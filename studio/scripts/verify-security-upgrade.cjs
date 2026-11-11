// Local browser fixtures; no model calls or account writes reach upstream.
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
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => localStorage.setItem("lang", "cn"));
        await page.route("**/api/**", async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          const ok = (data) => route.fulfill({ json: { success: true, data } });
          if (pathname === "/api/config")
            return route.fulfill({ json: { newApiEnabled: true } });
          if (pathname === "/api/new-api/session")
            return ok({
              authenticated: true,
              selectedTokenId: 10,
              user: {
                id: 7, username: "fixture", group: "default", quota: 500000,
              },
            });
          if (pathname === "/api/new-api/status")
            return ok({ enabled: true, configured: true, quotaPerUnit: 500000 });
          if (pathname.endsWith("/models") || pathname === "/api/remote-models")
            return route.fulfill({
              json: { data: [{ id: "gpt-4o", object: "model" }] },
            });
          if (pathname === "/api/v1/chat/completions") {
            const body = route.request().postDataJSON();
            const content = "验证完成。\n\n```mermaid\nflowchart LR\n A[Input] --> B[Output]\n```";
            if (!body.stream)
              return route.fulfill({ json: {
                choices: [{ message: { role: "assistant", content } }],
              } });
            const chunks = [
              { choices: [{ delta: { role: "assistant", content: "验证完成。\n\n" } }] },
              { choices: [{ delta: { content: content.split("\n\n")[1] } }] },
              { choices: [{ delta: {}, finish_reason: "stop" }] },
            ];
            return route.fulfill({
              contentType: "text/event-stream",
              body: chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
                "data: [DONE]\n\n",
            });
          }
          assert.equal(route.request().method(), "GET", `Unexpected write: ${pathname}`);
          return ok([]);
        });
        await page.goto(base + "#/chat");
        const input = page.locator("#chat-input");
        await input.fill("请画一个流程图");
        await page.getByRole("button", { name: "发送", exact: true }).click();
        await page.locator(".mermaid svg").waitFor({ timeout: 30000 });
        assert(await page.locator(".mermaid svg").first().isVisible());
        await page.screenshot({
          path: path.join(os.tmpdir(), `octopus-security-next15-${width}.png`),
          fullPage: true,
        });
        for (const view of ["settings", "account", "gallery", "video-workspace", "chat"]) {
          await page.goto(base + "#/" + view);
          await page.locator("body").waitFor();
        }
        await input.waitFor();
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}px: chat completion, Mermaid SVG, settings/account/gallery/video navigation, no page errors`);
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
