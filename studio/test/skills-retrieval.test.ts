/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { POST } from "../app/api/skills/retrieve/route";
import { GET } from "../app/api/skills/capabilities/route";
import { retrieveSkillSources } from "../app/lib/skills-retrieval";
import { clearWebSearchCacheForTests } from "../app/lib/web-search/search";

const originalEnv = process.env;
const originalFetch = global.fetch;

function request(body?: unknown, origin = "https://chat.example.test") {
  return new NextRequest(
    `https://chat.example.test/api/skills/${
      body === undefined ? "capabilities" : "retrieve"
    }`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        host: "chat.example.test",
        origin,
        "content-type": "application/json",
        authorization: "Bearer user-model-secret",
        "x-new-api-user": "17",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NEW_API_BASE_URL: "",
    ENABLE_RATE_LIMIT: "false",
    SKILLS_WEB_SEARCH_MODEL: "",
  };
  global.fetch = jest.fn<typeof fetch>();
  clearWebSearchCacheForTests();
  (globalThis as any).__octopusModelGroups?.clear();
});

afterEach(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("capabilities expose built-in web search without a paid channel", async () => {
  const response = await GET(request());
  expect(await response.json()).toEqual({ web: true, papers: true });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(fetch).not.toHaveBeenCalled();
});

test("papers return actual bibliographic metadata without claiming full text", async () => {
  jest.mocked(fetch).mockResolvedValue(
    Response.json({
      message: {
        items: [
          {
            title: ["<i>Attention</i> mechanisms"],
            DOI: "10.1234/abc",
            author: [{ given: "Ada", family: "Researcher" }],
            published: { "date-parts": [[2026]] },
            "container-title": ["Journal"],
          },
        ],
      },
    }),
  );
  const response = await POST(
    request({ kind: "papers", query: "attention mechanisms" }),
  );
  const data = await response.json();
  expect(data.coverage).toBe("bibliographic-metadata");
  expect(data.sources).toEqual([
    {
      title: "Attention mechanisms",
      url: "https://doi.org/10.1234/abc",
      snippet: "Ada Researcher · 2026 · Journal · DOI: 10.1234/abc",
    },
  ]);
  const [input, options] = jest.mocked(fetch).mock.calls[0];
  expect(new URL(String(input)).origin).toBe("https://api.crossref.org");
  expect(new URL(String(input)).searchParams.get("query.bibliographic")).toBe(
    "attention mechanisms",
  );
  expect(new Headers(options?.headers).get("authorization")).toBeNull();
  expect(new Headers(options?.headers).get("cookie")).toBeNull();
  expect(options?.redirect).toBe("error");
});

test("invalid origin and invalid query are rejected before upstream access", async () => {
  expect(
    (await POST(request({ kind: "papers", query: "x" }, "https://evil.test")))
      .status,
  ).toBe(403);
  for (const body of [
    { kind: "arbitrary", query: "x" },
    { kind: "papers", query: " " },
    { kind: "papers", query: "x".repeat(2001) },
    { kind: "papers", query: "x".repeat(13000) },
  ]) {
    expect((await POST(request(body))).status).toBeGreaterThanOrEqual(400);
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("account mode requires the real login session", async () => {
  process.env.NEW_API_BASE_URL = "https://accounts.example.test";
  process.env.NEW_API_SESSION_SECRET =
    "test-secret-with-at-least-32-characters";
  const response = await POST(request({ kind: "papers", query: "x" }));
  expect(response.status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

test("oversized streaming upstream responses are rejected even without content length", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(new Response("x".repeat(1024 * 1024 + 1)));
  const response = await POST(request({ kind: "papers", query: "x" }));
  expect(response.status).toBe(413);
});

test("cancellation propagates to upstream fetch", async () => {
  const controller = new AbortController();
  jest.mocked(fetch).mockImplementation(
    async (_input, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  const result = retrieveSkillSources("papers", "x", controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({
    status: 499,
    code: "SKILL_ABORTED",
  });
});

test("slow providers time out without an automatic retry", async () => {
  jest.useFakeTimers();
  jest.mocked(fetch).mockImplementation(
    async (_input, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new Error("timeout")),
        );
      }),
  );
  const pending = expect(
    retrieveSkillSources("papers", "x", new AbortController().signal),
  ).rejects.toMatchObject({ status: 504, code: "SKILL_TIMEOUT" });
  await jest.advanceTimersByTimeAsync(12000);
  await pending;
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("provider errors do not reveal upstream response text or secrets", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(new Response("secret-upstream-debug", { status: 500 }));
  const response = await POST(request({ kind: "papers", query: "x" }));
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("secret-upstream-debug");
});

test("rate limit is applied before querying providers", async () => {
  jest.useFakeTimers();
  process.env.ENABLE_RATE_LIMIT = "true";
  process.env.RATE_LIMIT_MAX = "0";
  // The existing limiter permits its first request, then denies this IP.
  jest
    .mocked(fetch)
    .mockResolvedValue(new Response("provider unavailable", { status: 503 }));
  const first = await POST(request({ kind: "web", query: "x" }));
  expect(first.status).toBe(502);
  jest.mocked(fetch).mockClear();
  const second = await POST(request({ kind: "web", query: "x" }));
  expect(second.status).toBe(429);
  expect(fetch).not.toHaveBeenCalled();
  jest.advanceTimersByTime(5 * 60 * 1000);
  jest.useRealTimers();
});

test.each(["gpt-4o", "off", {}, 1, null])(
  "rejects invalid search mode %s before searching",
  async (mode) => {
    expect(
      (await POST(request({ kind: "web", query: "test query", mode }))).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  },
);

test("web search still requires a real login session in account mode", async () => {
  process.env.NEW_API_BASE_URL = "https://accounts.example.test";
  process.env.NEW_API_SESSION_SECRET =
    "test-secret-with-at-least-32-characters";
  expect(
    (await POST(request({ kind: "web", query: "test query" }))).status,
  ).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

test("quick search returns real sources without forwarding browser or account credentials", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(
      new Response(
        '<a class="result__a" href="https://example.org/guide">Community guide</a><a class="result__snippet">Community evidence</a>',
      ),
    );
  const response = await POST(
    request({ kind: "web", mode: "quick", query: "Community guide" }),
  );
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(data.coverage).toBe("search-snippets");
  expect(data.sources[0].url).toBe("https://example.org/guide");
  expect(Number.isFinite(Date.parse(data.searchedAt))).toBe(true);
  for (const [url, options] of jest.mocked(fetch).mock.calls) {
    expect(["html.duckduckgo.com", "www.bing.com"]).toContain(
      new URL(String(url)).hostname,
    );
    const headers = new Headers(options?.headers);
    for (const key of [
      "authorization",
      "cookie",
      "x-api-key",
      "x-new-api-user",
    ])
      expect(headers.get(key)).toBeNull();
  }
});

test("no results and provider failures return explicit errors instead of fabricated sources", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(new Response("<html>Nothing related</html>"));
  const empty = await POST(request({ kind: "web", query: "test query" }));
  expect(empty.status).toBe(502);
  expect((await empty.json()).code).toBe("SKILL_WEB_NO_RESULTS");
  jest
    .mocked(fetch)
    .mockResolvedValue(
      new Response("private-provider-detail", { status: 503 }),
    );
  const failed = await POST(request({ kind: "web", query: "test query" }));
  expect(failed.status).toBe(502);
  expect(await failed.text()).not.toContain("private-provider-detail");
});

test("pre-cancelled search does not contact providers", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    retrieveSkillSources("web", "test", controller.signal),
  ).rejects.toMatchObject({ status: 499, code: "SKILL_ABORTED" });
  expect(fetch).not.toHaveBeenCalled();
});
