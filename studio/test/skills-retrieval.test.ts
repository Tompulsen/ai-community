/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "../app/api/skills/retrieve/route";
import { GET } from "../app/api/skills/capabilities/route";
import { retrieveSkillSources } from "../app/lib/skills-retrieval";
import { createSession, SESSION_COOKIE } from "../app/lib/new-api/session";

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
  (globalThis as any).__octopusModelGroups?.clear();
});

afterEach(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("capabilities report missing web service without exposing configuration", async () => {
  const response = await GET(request());
  expect(await response.json()).toEqual({ web: false, papers: true });
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

test("web search requires account mode", async () => {
  const response = await POST(request({ kind: "web", query: "weather" }));
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe("SKILL_WEB_UNAVAILABLE");
  expect(fetch).not.toHaveBeenCalled();
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
  const first = await POST(request({ kind: "web", query: "x" }));
  expect(first.status).toBe(503);
  const second = await POST(request({ kind: "web", query: "x" }));
  expect(second.status).toBe(429);
  expect(fetch).not.toHaveBeenCalled();
  jest.advanceTimersByTime(5 * 60 * 1000);
  jest.useRealTimers();
});

async function billedRequest(
  model = "tavily-quick",
  tokenId = 23,
  selectedKey: string | undefined = "sk-selected-user-key",
  signal?: AbortSignal,
  mode?: unknown,
) {
  process.env.NEW_API_BASE_URL = "https://accounts.example.test";
  process.env.NEW_API_SESSION_SECRET =
    "test-secret-with-at-least-32-characters";
  process.env.NEW_API_REDIS_URL = "";
  process.env.SKILLS_WEB_SEARCH_MODEL = model;
  const user = {
    id: 17,
    username: "search-user",
    display_name: "Search User",
    quota: 100,
    used_quota: 0,
    request_count: 0,
    group: "default",
  };
  const session = await createSession(request(), NextResponse.json({}), {
    user,
    accessToken: "private-account-token",
    accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    refreshToken: "private-refresh-token",
    selectedTokenId: 23,
    selectedKey,
  });
  const req = new NextRequest("https://chat.example.test/api/skills/retrieve", {
    method: "POST",
    signal,
    headers: {
      host: "chat.example.test",
      origin: "https://chat.example.test",
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${session.id}`,
      "x-new-api-user": "17",
      "x-new-api-token": String(tokenId),
      "x-api-key": "Bearer forged-client-key",
    },
    body: JSON.stringify({
      kind: "web",
      ...(mode === undefined ? {} : { mode }),
      query: "test query",
      model: "forged-model",
      url: "https://attacker.test",
    }),
  });
  return { req, user };
}

function billedSuccess() {
  return Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            sources: [
              {
                title: "<b>Actual source</b>",
                url: "https://example.test/source",
                snippet: "<i>Actual evidence</i>",
              },
              {
                title: "Duplicate source",
                url: "https://example.test/source",
                snippet: "Duplicate evidence",
              },
              { title: "Unsafe", url: "javascript:alert(1)" },
            ],
          }),
        },
      },
    ],
  });
}

function mockBilledFetch(
  user: unknown,
  paid: typeof fetch = async () => billedSuccess(),
) {
  jest.mocked(fetch).mockImplementation(async (url, options) => {
    const pathname = new URL(String(url)).pathname;
    const ok = (data: unknown) => Response.json({ success: true, data });
    const token = {
      id: 42,
      name: "系统创建",
      group: "auto",
      auto_groups: [],
      status: 1,
      expired_time: -1,
      unlimited_quota: true,
    };
    if (pathname === "/api/user/self") return ok(user);
    if (pathname === "/api/user/self/groups")
      return ok({ auto: { ratio: "auto" } });
    if (pathname === "/api/token/") return ok({ items: [token], total: 1 });
    if (pathname === "/api/token/42") return ok(token);
    if (pathname === "/api/token/42/key") return ok({ key: "system-user-key" });
    return paid(url, options);
  });
}

test.each(["quick", "deep"])(
  "the independent %s mode selects only its allowlisted Tavily model",
  async (mode) => {
    const { req, user } = await billedRequest(
      "tavily-quick",
      23,
      "sk-selected-user-key",
      undefined,
      mode,
    );
    mockBilledFetch(user);
    expect((await POST(req)).status).toBe(200);
    const paidCall = jest
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith("/v1/chat/completions"));
    expect(JSON.parse(String(paidCall?.[1]?.body)).model).toBe(
      `tavily-${mode}`,
    );
  },
);

test.each(["gpt-4o", "off", {}, 1, null])(
  "invalid search mode %s is rejected before billing",
  async (mode) => {
    const { req } = await billedRequest(
      "tavily-quick",
      23,
      "sk-selected-user-key",
      undefined,
      mode,
    );
    expect((await POST(req)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  },
);

test.each(["tavily-quick", "tavily-deep"])(
  "billed %s uses only the logged-in user's system Auto token and fixed model",
  async (model) => {
    const { req, user } = await billedRequest(model);
    mockBilledFetch(user);
    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "web",
      provider: "Tavily",
      coverage: "search-snippets",
      sources: [
        {
          title: "Actual source",
          url: "https://example.test/source",
          snippet: "Actual evidence",
        },
      ],
    });
    const paidCalls = jest
      .mocked(fetch)
      .mock.calls.filter(([url]) =>
        String(url).endsWith("/v1/chat/completions"),
      );
    expect(paidCalls).toHaveLength(1);
    const [url, options] = paidCalls[0];
    expect(url).toBe("https://accounts.example.test/v1/chat/completions");
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-system-user-key");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
    expect(options?.redirect).toBe("error");
    expect(JSON.parse(String(options?.body))).toEqual({
      model,
      messages: [{ role: "user", content: "test query" }],
      stream: false,
    });
  },
);

test.each(["", undefined])(
  "web search defaults to quick when model is %s",
  async (model) => {
    const { req, user } = await billedRequest();
    if (model === undefined) delete process.env.SKILLS_WEB_SEARCH_MODEL;
    else process.env.SKILLS_WEB_SEARCH_MODEL = model;
    mockBilledFetch(user);
    expect((await POST(req)).status).toBe(200);
    const paidCall = jest
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith("/v1/chat/completions"));
    expect(JSON.parse(String(paidCall?.[1]?.body)).model).toBe("tavily-quick");
  },
);

test("billed search requires account mode and valid fixed configuration", async () => {
  process.env.SKILLS_WEB_SEARCH_MODEL = "tavily-quick";
  expect(await (await GET(request())).json()).toEqual({
    web: false,
    papers: true,
  });
  expect((await POST(request({ kind: "web", query: "x" }))).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
  const { req } = await billedRequest("invalid-search-model");
  expect((await POST(req)).status).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
});

test("billed capabilities do not make a paid model call", async () => {
  const { req } = await billedRequest();
  const capabilityReq = new NextRequest(
    "https://chat.example.test/api/skills/capabilities",
    { headers: req.headers },
  );
  expect(await (await GET(capabilityReq)).json()).toEqual({
    web: true,
    papers: true,
  });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([401, 402, 403, 429, 500])(
  "billed upstream %s never falls back, retries, or leaks provider text",
  async (status) => {
    const { req, user } = await billedRequest();
    mockBilledFetch(
      user,
      async () => new Response("secret-internal-provider-detail", { status }),
    );
    const response = await POST(req);
    expect(response.status).toBe(status === 500 ? 502 : status);
    expect(await response.text()).not.toContain(
      "secret-internal-provider-detail",
    );
    expect(
      jest
        .mocked(fetch)
        .mock.calls.map(([url]) => String(url))
        .filter((url) => url.endsWith("/v1/chat/completions")),
    ).toEqual(["https://accounts.example.test/v1/chat/completions"]);
  },
);

test.each(["revoked"])(
  "%s account credentials prevent a paid request",
  async (reason) => {
    const { req, user } = await billedRequest(
      "tavily-quick",
      23,
      "sk-selected-user-key",
    );
    jest
      .mocked(fetch)
      .mockResolvedValue(
        reason === "revoked"
          ? Response.json(
              { success: false, message: "revoked" },
              { status: 401 },
            )
          : Response.json({ success: true, data: user }),
      );
    const response = await POST(req);
    expect(response.status).toBe(401);
    expect(
      jest
        .mocked(fetch)
        .mock.calls.every(([url]) => String(url).endsWith("/api/user/self")),
    ).toBe(true);
  },
);

test.each(["changed", "missing"])(
  "a %s chat key does not affect independent system-key search",
  async (reason) => {
    const { req, user } = await billedRequest(
      "tavily-quick",
      reason === "changed" ? 999 : 23,
      reason === "missing" ? "" : "sk-selected-user-key",
    );
    mockBilledFetch(user);
    expect((await POST(req)).status).toBe(200);
    const paid = jest
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith("/v1/chat/completions"));
    expect(new Headers(paid?.[1]?.headers).get("authorization")).toBe(
      "Bearer sk-system-user-key",
    );
  },
);

test("billed response size and format are checked", async () => {
  for (const result of [
    { choices: [] },
    { choices: [{ message: { content: "not-json" } }] },
    { choices: [{ message: { content: '{"sources":{}}' } }] },
  ]) {
    const { req, user } = await billedRequest();
    mockBilledFetch(user, async () => Response.json(result));
    expect((await POST(req)).status).toBe(502);
  }
  const { req, user } = await billedRequest();
  mockBilledFetch(user, async () => new Response("x".repeat(1024 * 1024 + 1)));
  expect((await POST(req)).status).toBe(413);
});

test("billed cancellation aborts one paid request without fallback", async () => {
  const controller = new AbortController();
  const { req, user } = await billedRequest(
    "tavily-quick",
    23,
    "sk-selected-user-key",
    controller.signal,
  );
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  mockBilledFetch(user, async (_url, options) => {
    ready();
    return new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      );
    });
  });
  const pending = POST(req);
  await started;
  controller.abort();
  const response = await pending;
  expect(response.status).toBe(499);
  expect(
    jest
      .mocked(fetch)
      .mock.calls.filter(([url]) =>
        String(url).endsWith("/v1/chat/completions"),
      ),
  ).toHaveLength(1);
});

test("cancelling while resolving the system key prevents the paid request", async () => {
  const controller = new AbortController();
  const { req, user } = await billedRequest(
    "tavily-quick",
    23,
    "sk-chat",
    controller.signal,
  );
  mockBilledFetch(user);
  const original = jest.mocked(fetch).getMockImplementation()!;
  jest.mocked(fetch).mockImplementation(async (url, options) => {
    const response = await original(url, options);
    if (String(url).endsWith("/api/token/42/key")) controller.abort();
    return response;
  });
  expect((await POST(req)).status).toBe(499);
  expect(
    jest
      .mocked(fetch)
      .mock.calls.filter(([url]) =>
        String(url).endsWith("/v1/chat/completions"),
      ),
  ).toHaveLength(0);
});

test("Crossref remains independent of the paid search model", async () => {
  process.env.SKILLS_WEB_SEARCH_MODEL = "tavily-quick";
  jest
    .mocked(fetch)
    .mockResolvedValue(Response.json({ message: { items: [] } }));
  const response = await POST(request({ kind: "papers", query: "x" }));
  expect(response.status).toBe(200);
  expect(String(jest.mocked(fetch).mock.calls[0][0])).toContain(
    "api.crossref.org",
  );
});

test("billed search timeout aborts once without fallback", async () => {
  jest.useFakeTimers();
  const { req, user } = await billedRequest();
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  mockBilledFetch(user, async (_url, options) => {
    ready();
    return new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () =>
        reject(new Error("timeout")),
      );
    });
  });
  const pending = POST(req);
  await started;
  await jest.advanceTimersByTimeAsync(45000);
  const response = await pending;
  expect(response.status).toBe(504);
  expect((await response.json()).code).toBe("SKILL_TIMEOUT");
  expect(
    jest
      .mocked(fetch)
      .mock.calls.filter(([url]) =>
        String(url).endsWith("/v1/chat/completions"),
      ),
  ).toHaveLength(1);
});
