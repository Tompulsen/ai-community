/** @jest-environment node */

import { jest } from "@jest/globals";
import {
  clearWebSearchCacheForTests,
  searchWeb,
} from "@/app/lib/web-search/search";

function html(count = 3, title = "DeepSeek news") {
  return Array.from(
    { length: count },
    (_, index) =>
      `<a class="result__a" href="https://primary.example/${index}">${title}</a><a class="result__snippet">DeepSeek model details</a>`,
  ).join("");
}

function rss(count = 3, title = "DeepSeek news") {
  return `<rss>${Array.from(
    { length: count },
    (_, index) =>
      `<item><title>${title}</title><link>https://backup.example/${index}</link><description>Details</description></item>`,
  ).join("")}</rss>`;
}

function delayedResponse(
  body: string,
  delay: number,
  signal?: AbortSignal | null,
) {
  return new Promise<Response>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Search aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(new Response(body));
    }, delay);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function providers(
  primaryDelay: number,
  backupDelay: number,
  primaryBody = html(),
  backupBody = rss(),
) {
  return jest.fn<typeof fetch>((url, init) => {
    const primary = String(url).includes("duckduckgo");
    return delayedResponse(
      primary ? primaryBody : backupBody,
      primary ? primaryDelay : backupDelay,
      init?.signal,
    );
  });
}

describe("web search provider orchestration", () => {
  beforeEach(() => {
    clearWebSearchCacheForTests();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-05T00:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
    clearWebSearchCacheForTests();
  });

  it("prefers a quality primary source during the short preference window", async () => {
    const fetcher = providers(500, 10);
    const pending = searchWeb("DeepSeek", fetcher);
    await jest.advanceTimersByTimeAsync(500);
    const response = await pending;
    expect(response.results.every((item) => item.source === "duckduckgo")).toBe(
      true,
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it("uses quality fallback results without waiting five seconds for a stalled primary", async () => {
    const fetcher = providers(4_000, 10);
    const pending = searchWeb("DeepSeek", fetcher);
    await jest.advanceTimersByTimeAsync(800);
    const response = await pending;
    expect(response.results.every((item) => item.source === "bing")).toBe(true);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("never lets fast unrelated fallback results beat a relevant primary", async () => {
    const pending = searchWeb(
      "DeepSeek",
      providers(1_500, 5, html(), rss(6, "Other models")),
    );
    await jest.advanceTimersByTimeAsync(1_500);
    expect(
      (await pending).results.every((item) => item.source === "duckduckgo"),
    ).toBe(true);
  });

  it("merges a small number of valid results without padding to six", async () => {
    const pending = searchWeb("DeepSeek", providers(100, 200, html(1), rss(1)));
    await jest.advanceTimersByTimeAsync(200);
    expect((await pending).results.map((item) => item.source)).toEqual([
      "duckduckgo",
      "bing",
    ]);
  });

  it("falls back immediately when the primary has no usable results", async () => {
    const pending = searchWeb(
      "DeepSeek",
      providers(10, 50, "<html>Unavailable</html>"),
    );
    await jest.advanceTimersByTimeAsync(50);
    expect((await pending).results).toHaveLength(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not cache an empty or unrelated search", async () => {
    const fetcher = providers(
      10,
      10,
      "<html>No results</html>",
      rss(6, "Other models"),
    );
    const first = searchWeb("DeepSeek", fetcher);
    await jest.advanceTimersByTimeAsync(10);
    expect((await first).results).toEqual([]);
    const second = searchWeb("DeepSeek", fetcher);
    await jest.advanceTimersByTimeAsync(10);
    expect((await second).cached).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("shares in-flight searches and preserves the original search timestamp", async () => {
    const fetcher = providers(500, 20);
    const first = searchWeb("搜索 DeepSeek", fetcher);
    const shared = searchWeb("DeepSeek", fetcher);
    await jest.advanceTimersByTimeAsync(500);
    const response = await first;
    expect((await shared).cached).toBe(true);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(await searchWeb("DeepSeek", fetcher)).toEqual({
      ...response,
      cached: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(121_000);
    const expired = searchWeb("DeepSeek", fetcher);
    await jest.advanceTimersByTimeAsync(500);
    expect((await expired).cached).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("cleans up source timeouts and permits retry after failure", async () => {
    const slow = providers(60_000, 60_000);
    const failure = expect(searchWeb("DeepSeek", slow)).rejects.toThrow(
      "unavailable",
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await failure;
    expect(jest.getTimerCount()).toBe(0);
    const retried = searchWeb("DeepSeek", providers(5, 5));
    await jest.advanceTimersByTimeAsync(5);
    expect((await retried).results).toHaveLength(3);
  });

  it.each([503, 429])(
    "cancels unused HTTP %s response bodies",
    async (status) => {
      const cancel = jest.fn<() => void>();
      const fetcher = jest.fn<typeof fetch>((url) =>
        Promise.resolve(
          String(url).includes("duckduckgo")
            ? new Response(new ReadableStream({ cancel }), { status })
            : new Response(rss()),
        ),
      );
      expect((await searchWeb("DeepSeek", fetcher)).results).toHaveLength(3);
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it.each([true, false])(
    "bounds oversized bodies, declared=%s",
    async (declared) => {
      const cancel = jest.fn<() => void>();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1_500_001));
        },
        cancel,
      });
      const fetcher = jest.fn<typeof fetch>((url) =>
        Promise.resolve(
          String(url).includes("duckduckgo")
            ? new Response(body, {
                headers: declared ? { "content-length": "1500001" } : {},
              })
            : new Response(rss()),
        ),
      );
      expect((await searchWeb("DeepSeek", fetcher)).results).toHaveLength(3);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    },
  );
});
