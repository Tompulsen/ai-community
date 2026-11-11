/** @jest-environment node */
import { jest } from "@jest/globals";
import { Response, type fetch as FetchPage } from "undici";
import {
  extractPageText,
  isPublicPageAddress,
  resolvePublicPageUrl,
  readWebPage,
  readLimitedPageBody,
  PAGE_MAX_BYTES,
  PAGE_MAX_CHARS,
} from "@/app/lib/web-search/page-reader";

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
const html =
  "<html><head><title>Article</title></head><body><main><h1>Article</h1><p>" +
  "Real article content. ".repeat(20) +
  "</p></main></body></html>";
const pageResponse = (body = html) =>
  new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

describe("safe webpage reader", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "fc00::1",
    "2002:7f00:1::",
    "2001:db8::1",
    "3fff::1",
  ])("blocks non-public address %s", (ip) => {
    expect(isPublicPageAddress(ip)).toBe(false);
  });
  it.each(["93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "allows public address %s",
    (ip) => {
      expect(isPublicPageAddress(ip)).toBe(true);
    },
  );
  it.each([
    "http://127.1/",
    "http://2130706433/",
    "http://[::ffff:7f00:1]/",
    "ftp://example.com/",
    "https://user:pass@example.com/",
    "http://example.com:8889/",
    "http://metadata.internal/",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(resolvePublicPageUrl(url, publicDns)).rejects.toThrow();
  });
  it("rejects DNS answers containing any private address", async () => {
    await expect(
      resolvePublicPageUrl("https://example.com", async () => [
        ...(await publicDns()),
        { address: "10.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow("内网");
  });
  it("extracts article text, entities and paragraphs without executable or hidden content", () => {
    const result = extractPageText(
      Buffer.from(
        html.replace(
          "<main>",
          "<nav>Navigation</nav><script>malicious()</script><main><div hidden>Secret</div><p>A &amp; B</p>",
        ),
      ),
      "text/html",
    );
    expect(result.text).toContain("A & B");
    expect(result.text).toContain("Real article content.");
    expect(result.text).not.toMatch(/Navigation|malicious|Secret/);
    expect(result.truncated).toBe(false);
  });
  it("marks oversized extracted text as partial rather than full text", () => {
    const result = extractPageText(
      Buffer.from("<main>" + "字".repeat(PAGE_MAX_CHARS + 1) + "</main>"),
      "text/html; charset=utf-8",
    );
    expect(result.text.length).toBe(PAGE_MAX_CHARS);
    expect(result.truncated).toBe(true);
  });
  it("rejects verification and empty dynamic app pages", () => {
    expect(() =>
      extractPageText(
        Buffer.from("<title>Just a moment...</title>" + html),
        "text/html",
      ),
    ).toThrow("验证");
    expect(() =>
      extractPageText(
        Buffer.from("<div id='app'></div><script>load()</script>"),
        "text/html",
      ),
    ).toThrow("动态加载");
  });

  it("preserves article headers and multiple article sections", () => {
    const body =
      "<body><header>Site navigation</header><article><header>Published September 5</header><p>" +
      "First section. ".repeat(8) +
      "</p></article><article><p>Second section.</p></article></body>";
    const result = extractPageText(Buffer.from(body), "text/html");
    expect(result.text).toContain("Published September 5");
    expect(result.text).toContain("Second section.");
    expect(result.text).not.toContain("Site navigation");
  });

  it("rejects excessive markup before building a large DOM", () => {
    expect(() =>
      extractPageText(Buffer.from("<i></i>".repeat(10_001)), "text/html"),
    ).toThrow("结构过于复杂");
  });
  it("bounds response bytes with and without a content-length", async () => {
    await expect(
      readLimitedPageBody(
        new Response("x", {
          headers: { "content-length": String(PAGE_MAX_BYTES + 1) },
        }),
      ),
    ).rejects.toThrow("大小");
    await expect(
      readLimitedPageBody(new Response("x".repeat(PAGE_MAX_BYTES + 1))),
    ).rejects.toThrow("大小");
  });
  it("reads through a pinned dispatcher without forwarding cookies or authorization", async () => {
    const fetcher = jest
      .fn<typeof FetchPage>()
      .mockResolvedValue(pageResponse());
    const result = await readWebPage("https://example.com/article", {
      resolve: publicDns,
      fetcher,
    });
    expect(result.status).toBe("read");
    expect(result.text).toContain("Real article content.");
    const init = fetcher.mock.calls[0][1]!;
    expect(init.redirect).toBe("manual");
    expect(init.dispatcher).toBeDefined();
    expect(JSON.stringify(init.headers)).not.toMatch(/cookie|authorization/i);
  });
  it("revalidates redirect targets and never fetches a redirected private address", async () => {
    const fetcher = jest.fn<typeof FetchPage>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    const result = await readWebPage("https://example.com", {
      resolve: publicDns,
      fetcher,
    });
    expect(result.status).toBe("failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("follows a public redirect and records its actual source URL", async () => {
    const fetcher = jest
      .fn<typeof FetchPage>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/article" } }),
      )
      .mockResolvedValueOnce(pageResponse());
    expect(
      await readWebPage("https://example.com", { resolve: publicDns, fetcher }),
    ).toMatchObject({ status: "read", url: "https://example.com/article" });
  });
  it("returns explicit access failure rather than presenting an error page as evidence", async () => {
    const fetcher = jest
      .fn<typeof FetchPage>()
      .mockResolvedValue(new Response(html, { status: 403 }));
    expect(
      await readWebPage("https://example.com", { resolve: publicDns, fetcher }),
    ).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("403"),
    });
  });
  it("does not read a link after cancellation", async () => {
    const signal = AbortSignal.abort();
    const fetcher = jest.fn<typeof FetchPage>();
    expect(
      (await readWebPage("https://example.com", { signal, fetcher })).status,
    ).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("caps active reads and releases slots even when DNS stalls and is cancelled", async () => {
    const controller = new AbortController();
    const pending = Array.from({ length: 4 }, () =>
      readWebPage("https://example.com", {
        signal: controller.signal,
        resolve: () => new Promise(() => {}),
      }),
    );
    expect((await readWebPage("https://example.com")).status).toBe("skipped");
    controller.abort();
    expect(
      (await Promise.all(pending)).every(
        (result) => result.status === "failed",
      ),
    ).toBe(true);
    expect(
      (
        await readWebPage("https://example.com", {
          resolve: publicDns,
          fetcher: jest
            .fn<typeof FetchPage>()
            .mockResolvedValue(pageResponse()),
        })
      ).status,
    ).toBe("read");
  });
});
