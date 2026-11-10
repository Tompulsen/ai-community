const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createTavilyServer } = require("./server.cjs");

const proxyKey = "test-proxy-secret-at-least-32-characters";
const sources = [
  {
    title: "Source",
    url: "https://example.test/article",
    content: "Search evidence",
  },
];

async function fixture(t, fetchImpl, options = {}) {
  const server = createTavilyServer({
    apiKey: "private-tavily-key",
    proxyKey,
    fetchImpl,
    ...options,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const request = (path, input, headers = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: {
        Authorization: `Bearer ${proxyKey}`,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(input === undefined
        ? {}
        : {
            method: "POST",
            body: typeof input === "string" ? input : JSON.stringify(input),
          }),
    });
  return { request };
}

function input(model = "tavily-quick", extra = {}) {
  return {
    model,
    messages: [{ role: "user", content: "test query" }],
    ...extra,
  };
}

test("startup fails closed without independent credentials", () => {
  assert.throws(() => createTavilyServer(), /TAVILY_API_KEY/);
  assert.throws(() => createTavilyServer({ apiKey: "key", proxyKey: "short" }));
});

test("health and model listing do not call Tavily; listing requires auth", async (t) => {
  const { request } = await fixture(t, () => assert.fail("unexpected search"));
  assert.equal(
    (await request("/healthz", undefined, { Authorization: "" })).status,
    200,
  );
  assert.equal(
    (await request("/v1/models", undefined, { Authorization: "" })).status,
    401,
  );
  const response = await request("/v1/models");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    (await response.json()).data.map(({ id }) => id),
    ["tavily-quick", "tavily-deep"],
  );
});

for (const [model, depth] of [
  ["tavily-quick", "basic"],
  ["tavily-deep", "advanced"],
]) {
  test(`${model} makes one bounded search with fixed depth and server credentials`, async (t) => {
    let calls = 0;
    const { request } = await fixture(t, async (url, options) => {
      calls++;
      assert.equal(url, "https://api.tavily.com/search");
      assert.equal(options.headers.Authorization, "Bearer private-tavily-key");
      assert.equal(options.redirect, "error");
      assert.deepEqual(JSON.parse(options.body), {
        query: "test query",
        search_depth: depth,
        auto_parameters: false,
        max_results: 6,
        include_answer: false,
        include_raw_content: false,
      });
      return Response.json({
        results: [
          ...sources,
          ...sources,
          { title: "Unsafe", url: "javascript:alert(1)" },
          { title: "Credentials", url: "https://secret:secret@example.test/" },
        ],
      });
    });
    const response = await request(
      "/v1/chat/completions",
      input(model, {
        search_depth: "advanced",
        api_key: "attacker",
        max_results: 100,
        messages: [
          { role: "system", content: "not the query" },
          { role: "user", content: "earlier query" },
          { role: "assistant", content: "not the query" },
          { role: "user", content: [{ type: "text", text: "test query" }] },
        ],
      }),
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.model, model);
    assert.deepEqual(result.usage, {
      prompt_tokens: 1,
      completion_tokens: 0,
      total_tokens: 1,
    });
    assert.deepEqual(JSON.parse(result.choices[0].message.content).sources, [
      {
        title: "Source",
        url: sources[0].url,
        snippet: "Search evidence",
      },
    ]);
    assert.equal(JSON.stringify(result).includes("private-tavily-key"), false);
    assert.equal(calls, 1);
  });
}

test("SSE returns evidence, finish reason, accounting usage, and DONE", async (t) => {
  const { request } = await fixture(t, async () =>
    Response.json({ results: sources }),
  );
  const response = await request(
    "/v1/chat/completions",
    input(undefined, { stream: true }),
  );
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const events = (await response.text())
    .trim()
    .split("\n\n")
    .map((event) => event.slice(6));
  assert.equal(events.pop(), "[DONE]");
  const chunks = events.map((event) => JSON.parse(event));
  assert.equal(
    JSON.parse(chunks[0].choices[0].delta.content).sources.length,
    1,
  );
  assert.equal(chunks[1].choices[0].finish_reason, "stop");
  assert.equal(chunks[2].usage.total_tokens, 1);
});

test("invalid requests never reach the paid provider", async (t) => {
  const { request } = await fixture(t, () =>
    assert.fail("unexpected paid search"),
  );
  for (const body of [
    "{",
    null,
    input("unknown"),
    input("constructor"),
    input("__proto__"),
    input({ toString: null }),
    input(undefined, { messages: [] }),
    input(undefined, {
      messages: [{ role: "user", content: "x".repeat(2001) }],
    }),
    input(undefined, { stream: "yes" }),
    input(undefined, { n: 2 }),
  ]) {
    assert.equal(
      (await request("/v1/chat/completions", JSON.stringify(body))).status,
      400,
    );
  }
  assert.equal(
    (await request("/v1/chat/completions", "x".repeat(16001))).status,
    413,
  );
  assert.equal(
    (
      await request("/v1/chat/completions", input(), {
        Authorization: "Bearer wrong",
      })
    ).status,
    401,
  );
  assert.equal((await request("/missing")).status, 404);
});

test("provider errors are terminal, redacted, and never retried", async (t) => {
  let calls = 0;
  const { request } = await fixture(t, async () => {
    calls++;
    return new Response("private-tavily-key internal detail", { status: 429 });
  });
  const response = await request("/v1/chat/completions", input());
  assert.equal(response.status, 400);
  const body = await response.text();
  assert.match(body, /tavily_search_failed/);
  assert.equal(body.includes("private-tavily-key"), false);
  assert.equal(calls, 1);
});

test("invalid and oversized provider responses fail before a success response", async (t) => {
  for (const body of [
    "not JSON",
    '{"results":{}}',
    "x".repeat(1024 * 1024 + 1),
  ]) {
    const { request } = await fixture(t, async () => new Response(body));
    assert.equal((await request("/v1/chat/completions", input())).status, 400);
  }
});

test("empty results are a successful billable search", async (t) => {
  const { request } = await fixture(t, async () =>
    Response.json({ results: [] }),
  );
  const response = await request("/v1/chat/completions", input());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(JSON.parse(result.choices[0].message.content).sources, []);
  assert.equal(result.usage.total_tokens, 1);
});

test("provider timeout aborts once and does not replay a search", async (t) => {
  let calls = 0;
  const { request } = await fixture(
    t,
    async (_url, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
    { timeoutMs: 20 },
  );
  assert.equal((await request("/v1/chat/completions", input())).status, 400);
  assert.equal(calls, 1);
});

test("disconnect cancels the in-flight Tavily request", async (t) => {
  let ready;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  let cancelled;
  const aborted = new Promise((resolve) => {
    cancelled = resolve;
  });
  let calls = 0;
  const { request } = await fixture(
    t,
    async (_url, { signal }) => {
      calls++;
      ready();
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            cancelled();
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
    { apiKeys: "key-a,key-b" },
  );
  // Use a real client socket so closing it exercises res.close on the server.
  const http = require("node:http");
  const health = await request("/healthz");
  const client = http.request(new URL("/v1/chat/completions", health.url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${proxyKey}`,
      "Content-Type": "application/json",
    },
  });
  client.on("error", () => {});
  client.end(JSON.stringify(input()));
  await started;
  client.destroy();
  await aborted;
  assert.equal(calls, 1);
});

test("key pool overrides the legacy key, removes duplicates, and rotates", async (t) => {
  const calls = [];
  const { request } = await fixture(
    t,
    async (_url, { headers }) => {
      calls.push(headers.Authorization);
      return Response.json({ results: sources });
    },
    { apiKeys: " key-a,key-b\nkey-a  key-c " },
  );
  for (let i = 0; i < 4; i++) {
    assert.equal((await request("/v1/chat/completions", input())).status, 200);
  }
  assert.deepEqual(calls, [
    "Bearer key-a",
    "Bearer key-b",
    "Bearer key-c",
    "Bearer key-a",
  ]);
});

test("an empty pool preserves the existing single-key configuration", async (t) => {
  const { request } = await fixture(
    t,
    async (_url, { headers }) => {
      assert.equal(headers.Authorization, "Bearer private-tavily-key");
      return Response.json({ results: sources });
    },
    { apiKeys: " \n " },
  );
  assert.equal((await request("/v1/chat/completions", input())).status, 200);
  assert.throws(() => createTavilyServer({ apiKeys: " , \n", proxyKey }));
});

for (const status of [401, 429, 432, 433]) {
  test(`explicit ${status} rejection fails over and skips the unavailable key`, async (t) => {
    const calls = [];
    const { request } = await fixture(
      t,
      async (_url, { headers }) => {
        calls.push(headers.Authorization);
        return headers.Authorization === "Bearer key-a"
          ? new Response("private key-a debug", { status })
          : Response.json({ results: sources });
      },
      { apiKeys: "key-a,key-b" },
    );
    for (let i = 0; i < 2; i++) {
      const response = await request("/v1/chat/completions", input());
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.equal(body.includes("key-a"), false);
      assert.equal(body.includes("key-b"), false);
      assert.equal(JSON.parse(body).usage.total_tokens, 1);
    }
    assert.deepEqual(calls, ["Bearer key-a", "Bearer key-b", "Bearer key-b"]);
  });
}

test("all rejected keys are tried once, then fail without another provider request", async (t) => {
  const calls = [];
  const { request } = await fixture(
    t,
    async (_url, { headers }) => {
      calls.push(headers.Authorization);
      return new Response("secret upstream detail", { status: 432 });
    },
    { apiKeys: "key-a,key-b" },
  );
  for (let i = 0; i < 2; i++) {
    const response = await request("/v1/chat/completions", input());
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.match(body, /tavily_search_failed/);
    assert.equal(body.includes("secret upstream detail"), false);
  }
  assert.deepEqual(calls, ["Bearer key-a", "Bearer key-b"]);
});

for (const status of [401, 432, 433]) {
  test(`${status} has the documented recovery time`, async (t) => {
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    const calls = [];
    const { request } = await fixture(
      t,
      async (_url, { headers }) => {
        calls.push(headers.Authorization);
        return calls.length === 1
          ? new Response("", { status })
          : Response.json({ results: sources });
      },
      { apiKeys: "key-a,key-b" },
    );
    assert.equal((await request("/v1/chat/completions", input())).status, 200);
    now += 5 * 60000 - 1;
    assert.equal((await request("/v1/chat/completions", input())).status, 200);
    assert.deepEqual(calls, ["Bearer key-a", "Bearer key-b", "Bearer key-b"]);
    now += 1;
    assert.equal((await request("/v1/chat/completions", input())).status, 200);
    assert.equal(
      calls.at(-1),
      status === 401 ? "Bearer key-b" : "Bearer key-a",
    );
  });
}

for (const retryAfter of [
  null,
  "",
  "  ",
  "not-a-delay",
  "0x10",
  "1e2",
  "2.5",
  "-1",
  "120",
  "http-date",
]) {
  test(`429 honors Retry-After ${retryAfter} and recovers after cooldown`, async (t) => {
    let now = Date.parse("2026-11-06T00:00:00Z");
    t.mock.method(Date, "now", () => now);
    const delay = ["120", "http-date"].includes(retryAfter) ? 120000 : 60000;
    const value =
      retryAfter === "http-date"
        ? new Date(now + delay).toUTCString()
        : retryAfter;
    const calls = [];
    const { request } = await fixture(
      t,
      async (_url, { headers }) => {
        calls.push(headers.Authorization);
        return calls.length === 1
          ? new Response("", {
              status: 429,
              headers: value === null ? {} : { "Retry-After": value },
            })
          : Response.json({ results: sources });
      },
      { apiKeys: "key-a,key-b" },
    );
    assert.equal((await request("/v1/chat/completions", input())).status, 200);
    now += delay - 1;
    assert.equal((await request("/v1/chat/completions", input())).status, 200);
    assert.equal(calls.at(-1), "Bearer key-b");
    now++;
    assert.equal((await request("/v1/chat/completions", input())).status, 200);
    assert.equal(calls.at(-1), "Bearer key-a");
  });
}

for (const result of [
  "network",
  "timeout",
  "invalid-json",
  "invalid-results",
  400,
  403,
  500,
  504,
]) {
  test(`ambiguous or other failure (${result}) never switches keys`, async (t) => {
    const calls = [];
    const { request } = await fixture(
      t,
      async (_url, { headers, signal }) => {
        calls.push(headers.Authorization);
        if (result === "network") throw new Error("secret provider detail");
        if (result === "timeout") {
          return new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
        }
        if (result === "invalid-json") return new Response("not JSON");
        if (result === "invalid-results") return Response.json({ results: {} });
        return new Response("secret provider detail", { status: result });
      },
      { apiKeys: "key-a,key-b", timeoutMs: 20 },
    );
    const response = await request("/v1/chat/completions", input());
    assert.equal(response.status, 400);
    assert.equal(
      (await response.text()).includes("secret provider detail"),
      false,
    );
    assert.deepEqual(calls, ["Bearer key-a"]);
  });
}

test("concurrent requests reserve different keys before waiting for Tavily", async (t) => {
  let ready;
  let release;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const { request } = await fixture(
    t,
    async (_url, { headers }) => {
      calls.push(headers.Authorization);
      if (calls.length === 1) {
        ready();
        await waiting;
      }
      return Response.json({ results: sources });
    },
    { apiKeys: "key-a,key-b" },
  );
  const first = request("/v1/chat/completions", input());
  await started;
  const second = await request("/v1/chat/completions", input());
  release();
  assert.equal(second.status, 200);
  assert.equal((await first).status, 200);
  assert.deepEqual(calls, ["Bearer key-a", "Bearer key-b"]);
});

test("a concurrent quota response cannot re-enable a key already rejected as invalid", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  let ready;
  let release;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const { request } = await fixture(
    t,
    async () => {
      calls++;
      if (calls === 1) {
        ready();
        await waiting;
        return new Response("", { status: 432 });
      }
      return new Response("", { status: 401 });
    },
    { apiKeys: "key-a" },
  );
  const first = request("/v1/chat/completions", input());
  await started;
  const second = await request("/v1/chat/completions", input());
  release();
  assert.equal(second.status, 400);
  assert.equal((await first).status, 400);
  now += 6 * 60000;
  assert.equal((await request("/v1/chat/completions", input())).status, 400);
  assert.equal(calls, 2);
});
