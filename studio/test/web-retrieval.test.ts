/** @jest-environment node */
import { jest } from "@jest/globals";
jest.unstable_mockModule("@/app/lib/web-search/page-reader", () => ({
  enrichWebResults: jest.fn(async (results: any[]) =>
    results.map((result, index) => ({
      ...result,
      page:
        index < 2
          ? { status: "read", text: "Actual body evidence" }
          : { status: "skipped" },
    })),
  ),
}));
const { retrieveSkillSources } = await import("../app/lib/skills-retrieval");
const { enrichWebResults } = await import("../app/lib/web-search/page-reader");
const { searchWeb, clearWebSearchCacheForTests } = await import(
  "../app/lib/web-search/search"
);
beforeEach(() => {
  clearWebSearchCacheForTests();
  jest.mocked(enrichWebResults).mockClear();
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test("quick search supplies actual web evidence without a Tavily channel", async () => {
  global.fetch = jest.fn<typeof fetch>(
    async () =>
      new Response(
        '<a class="result__a" href="https://example.org/guide">Community guide</a><a class="result__snippet">Community evidence from the web</a>',
      ),
  );
  const result = await retrieveSkillSources(
    "web",
    "Community guide",
    new AbortController().signal,
    undefined,
    "quick",
  );
  expect(result.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        url: "https://example.org/guide",
        snippet: "Community evidence from the web",
      }),
    ]),
  );
  expect(
    jest
      .mocked(fetch)
      .mock.calls.every(([url]) => !String(url).includes("/chat/completions")),
  ).toBe(true);
});

test("deep mode enriches actual results while quick mode stays on snippets", async () => {
  global.fetch = jest.fn<typeof fetch>(
    async () =>
      new Response(
        '<a class="result__a" href="https://example.org/guide">Community guide</a><a class="result__snippet">Community evidence from the web</a>',
      ),
  );
  const signal = new AbortController().signal;
  const quick = await retrieveSkillSources(
    "web",
    "Community guide",
    signal,
    undefined,
    "quick",
  );
  expect(enrichWebResults).not.toHaveBeenCalled();
  expect(quick.coverage).toBe("search-snippets");
  const deep = await retrieveSkillSources(
    "web",
    "Community guide",
    signal,
    undefined,
    "deep",
  );
  expect(enrichWebResults).toHaveBeenCalledWith(quick.sources, signal, 2);
  expect(deep.coverage).toBe("webpage-content");
  expect(deep.sources[0]).toHaveProperty("page.text", "Actual body evidence");
});

test("direct links are read without querying an engine", async () => {
  global.fetch = jest.fn<typeof fetch>();
  const result = await retrieveSkillSources(
    "web",
    "Read https://example.org/article",
    new AbortController().signal,
    undefined,
    "quick",
  );
  expect(result.coverage).toBe("webpage-content");
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    retrieveSkillSources(
      "web",
      "https://a.test https://b.test https://c.test https://d.test",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 400 });
});

test("failed deep pages retain snippets; failed direct reads cannot claim success", async () => {
  jest.mocked(enrichWebResults).mockImplementationOnce(async (results) =>
    results.map((source) => ({
      ...source,
      page: { status: "failed", reason: "requires login" },
    })),
  );
  global.fetch = jest.fn<typeof fetch>(
    async () =>
      new Response(
        '<a class="result__a" href="https://example.org/guide">Community guide</a><a class="result__snippet">Community evidence</a>',
      ),
  );
  const result = await retrieveSkillSources(
    "web",
    "Community guide",
    new AbortController().signal,
    undefined,
    "deep",
  );
  expect(result.coverage).toBe("search-snippets");
  expect(result.sources[0].snippet).toBe("Community evidence");
  jest.mocked(enrichWebResults).mockResolvedValueOnce([
    {
      title: "Page",
      url: "https://example.org",
      snippet: "",
      source: "webpage",
      page: { status: "failed" },
    },
  ]);
  await expect(
    retrieveSkillSources(
      "web",
      "https://example.org",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "SKILL_WEB_NO_CONTENT" });
});

test("one cancelled waiter does not abort another user's shared search", async () => {
  const controller = new AbortController();
  const fetcher = jest.fn<typeof fetch>(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(
      '<a class="result__a" href="https://example.org/guide">Community guide</a><a class="result__snippet">Community evidence</a>',
    );
  });
  const first = searchWeb("Community guide", fetcher, controller.signal);
  const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = searchWeb(
    "Community guide",
    fetcher,
    new AbortController().signal,
  );
  controller.abort();
  await cancelled;
  expect((await second).results).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await searchWeb("Community guide", fetcher)).cached).toBe(true);
});
