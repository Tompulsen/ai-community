/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest } from "next/server";

const authorize = jest.fn<() => Promise<{ error: boolean; msg?: string }>>();
const limit = jest.fn<() => Promise<void>>();
const proxy = jest.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const edgeFetch = jest.fn<typeof fetch>();
const credentials =
  jest.fn<() => Promise<{ baseUrl: string; apiKey: string }>>();

jest.unstable_mockModule("@/app/api/auth", () => ({
  auth: authorize,
}));
jest.unstable_mockModule("@/app/lib/model-rate-limit", () => ({
  limitModelRequest: limit,
}));
jest.unstable_mockModule("@/app/utils/proxy-fetch", () => ({
  proxyFetch: proxy,
}));
jest.unstable_mockModule("@/app/lib/new-api/relay", () => ({
  resolveRelayCredentials: credentials,
  relayHeaders: (request: NextRequest, key: string) =>
    new Headers({
      "content-type": request.headers.get("content-type") ?? "application/json",
      authorization: `Bearer ${key}`,
    }),
  relayErrorResponse: () =>
    Response.json(
      { error: true, message: "Relay unavailable" },
      { status: 503 },
    ),
}));

const { GET, POST } = await import("../app/api/v1/[...path]/route");
const { handleEdgeProxy } = await import("../app/api/v1/_proxy");
const { proxyGeminiChat } = await import("../app/api/gemini-proxy");
const originalEnv = process.env;
const privateDomain = "https://internal.upstream.test";
const privateKey = "sk-private-upstream-secret";

function context(path: string) {
  return { params: Promise.resolve({ path: path.split("/") }) };
}

function request(method = "POST", path = "chat/completions") {
  return new NextRequest(`https://chat.test/api/v1/${path}?trace=fixture`, {
    method,
    headers: { "content-type": "application/json" },
    body:
      method === "GET"
        ? undefined
        : JSON.stringify({ model: "gpt-5", reasoning_effort: "high" }),
  });
}

beforeEach(() => {
  process.env = { ...originalEnv, NODE_ENV: "production" };
  authorize.mockReset().mockResolvedValue({ error: false });
  limit.mockReset().mockResolvedValue();
  credentials.mockReset().mockResolvedValue({
    baseUrl: privateDomain,
    apiKey: privateKey,
  });
  proxy.mockReset();
  edgeFetch.mockReset();
  jest.spyOn(globalThis, "fetch").mockImplementation(edgeFetch);
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

test.each([
  [400, "reasoning_effort"],
  [422, "reasoning_effort"],
  [400, "reasoning.effort"],
  [422, "reasoning.effort"],
] as const)(
  "production %i rejection of %s exposes only the safe fallback marker",
  async (status, field) => {
    proxy.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            message: `Unsupported parameter '${field}' at ${privateDomain}; token ${privateKey}`,
            param: field,
            code: "unsupported_parameter",
          },
          internal: { upstream: privateDomain, credential: privateKey },
        },
        { status },
      ),
    );

    const path =
      field === "reasoning.effort" ? "responses" : "chat/completions";
    const response = await POST(request("POST", path), context(path));
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(body).toEqual({
      error: true,
      message: `请求失败 (${status})`,
      statusCode: status,
      reasoningUnsupported: true,
    });
    expect(JSON.stringify(body)).not.toContain(privateDomain);
    expect(JSON.stringify(body)).not.toContain(privateKey);
    expect(JSON.stringify(body)).not.toContain("unsupported_parameter");
    expect(proxy).toHaveBeenCalledTimes(1);
  },
);

test.each(["thinking", "output_config.effort"])(
  "Claude production reasoning rejection of %s exposes the safe marker without upstream details",
  async (field) => {
    proxy.mockResolvedValueOnce(
      Response.json(
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: `Unsupported parameter '${field}' at ${privateDomain}; token ${privateKey}`,
          },
        },
        { status: 400 },
      ),
    );
    const response = await POST(
      request("POST", "messages"),
      context("messages"),
    );
    expect(await response.json()).toEqual({
      error: true,
      message: "请求失败 (400)",
      statusCode: 400,
      reasoningUnsupported: true,
    });
    expect(proxy).toHaveBeenCalledTimes(1);
    const [, init] = proxy.mock.calls[0];
    expect(new Headers(init?.headers).get("anthropic-version")).toBe(
      "2023-06-01",
    );
  },
);

test.each([400, 422])(
  "Gemini production %i rejection exposes only the safe native reasoning marker",
  async (status) => {
    edgeFetch.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: status,
            status: "INVALID_ARGUMENT",
            message: `Invalid JSON payload received. Unknown name "thinkingLevel" at ${privateDomain}; token ${privateKey}`,
            details: [
              {
                fieldViolations: [
                  {
                    field: "generationConfig.thinkingConfig.thinkingLevel",
                    description: "Value unsupported",
                  },
                ],
              },
            ],
          },
        },
        { status },
      ),
    );
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: "Read this recording" },
            { inlineData: { mimeType: "audio/mpeg", data: "YXVkaW8=" } },
          ],
        },
      ],
      generationConfig: { thinkingConfig: { thinkingLevel: "high" } },
    };
    const nativeRequest = new NextRequest(
      "https://chat.test/api/v1beta/models/gemini-alias:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const response = await proxyGeminiChat(nativeRequest, [
      "models",
      "gemini-alias:streamGenerateContent",
    ]);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: true,
      message: `请求失败 (${status})`,
      statusCode: status,
      reasoningUnsupported: true,
    });
    expect(edgeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = edgeFetch.mock.calls[0];
    expect(url).toBe(
      `${privateDomain}/v1beta/models/gemini-alias:streamGenerateContent?alt=sse`,
    );
    expect(JSON.parse(Buffer.from(init?.body as Buffer).toString())).toEqual(
      body,
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${privateKey}`,
    );
  },
);

test.each([
  [400, "Quota exceeded with thinkingLevel"],
  [400, "Invalid temperature with thinkingLevel"],
  [400, "Invalid request"],
  [429, "Unsupported thinkingLevel"],
  [503, "Unsupported thinkingLevel"],
] as const)(
  "Gemini production %i unrelated error stays sanitized without a retry marker",
  async (status, message) => {
    edgeFetch.mockResolvedValueOnce(
      Response.json(
        { error: { message } },
        { status, headers: { "retry-after": "5" } },
      ),
    );
    const response = await proxyGeminiChat(
      new NextRequest(
        "https://chat.test/api/v1beta/models/gemini-alias:generateContent",
        { method: "POST", body: "{}" },
      ),
      ["models", "gemini-alias:generateContent"],
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toEqual({
      error: true,
      message: `请求失败 (${status})`,
      statusCode: status,
    });
    expect(edgeFetch).toHaveBeenCalledTimes(1);
  },
);

test.each(["images/generations", "videos/generations", "models"] as const)(
  "shared proxy does not attach a reasoning marker to %s",
  async (path) => {
    edgeFetch.mockResolvedValueOnce(
      Response.json(
        { error: { message: "Unsupported thinkingLevel" } },
        { status: 400 },
      ),
    );
    const response = await handleEdgeProxy(request("POST", path), path);
    expect(await response.json()).toEqual({
      error: true,
      message: "请求失败 (400)",
      statusCode: 400,
    });
    expect(edgeFetch).toHaveBeenCalledTimes(1);
  },
);

test("catchall image routes do not attach a reasoning marker", async () => {
  proxy.mockResolvedValueOnce(
    Response.json(
      { error: { message: "Unsupported reasoning_effort" } },
      { status: 400 },
    ),
  );
  const response = await POST(
    request("POST", "images/edits"),
    context("images/edits"),
  );
  expect(await response.json()).toEqual({
    error: true,
    message: "请求失败 (400)",
    statusCode: 400,
  });
});

test.each([
  [400, { message: "Unsupported temperature value", param: "temperature" }],
  [
    400,
    {
      message: "Insufficient quota for reasoning_effort",
      param: "reasoning_effort",
    },
  ],
  [
    422,
    {
      message: "Unknown model; reasoning_effort is unsupported",
      param: "model",
    },
  ],
  [
    429,
    {
      message: "Unsupported parameter reasoning_effort",
      param: "reasoning_effort",
    },
  ],
  [
    503,
    {
      message: "Unsupported parameter reasoning_effort",
      param: "reasoning_effort",
    },
  ],
] as const)(
  "production %i unrelated failure does not permit a reasoning retry",
  async (status, error) => {
    proxy.mockResolvedValueOnce(
      Response.json({ error }, { status, headers: { "retry-after": "7" } }),
    );

    const response = await POST(request(), context("chat/completions"));

    expect(response.status).toBe(status);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(await response.json()).toEqual({
      error: true,
      message: `请求失败 (${status})`,
      statusCode: status,
    });
    expect(proxy).toHaveBeenCalledTimes(1);
  },
);

test("non-JSON upstream errors remain sanitized without a fallback marker", async () => {
  proxy.mockResolvedValueOnce(
    new Response(
      `Unsupported reasoning_effort at ${privateDomain}; ${privateKey}`,
      { status: 400 },
    ),
  );

  const response = await POST(request(), context("chat/completions"));

  expect(await response.json()).toEqual({
    error: true,
    message: "请求失败 (400)",
    statusCode: 400,
  });
});

test.each(["GET", "POST"])(
  "%s preserves successful forwarding without inspecting the response body",
  async (method) => {
    const path = method === "GET" ? "dashboard/billing/usage" : "responses";
    const payload =
      method === "GET" ? '{"balance":12}' : 'data: {"delta":"hello"}\n\n';
    const upstream = new Response(payload, {
      headers: {
        "content-type":
          method === "GET" ? "application/json" : "text/event-stream",
        "set-cookie": "private-session=hidden",
        "content-length": String(payload.length),
      },
    });
    proxy.mockResolvedValueOnce(upstream);

    const response = await (method === "GET" ? GET : POST)(
      request(method, path),
      context(path),
    );
    const [url, init] = proxy.mock.calls[0];

    expect(url).toBe(`${privateDomain}/v1/${path}?trace=fixture`);
    expect(init?.method).toBe(method);
    if (method === "GET") expect(init?.body).toBeUndefined();
    else
      expect(JSON.parse(Buffer.from(init?.body as Buffer).toString())).toEqual({
        model: "gpt-5",
        reasoning_effort: "high",
      });
    expect(response.status).toBe(200);
    expect(upstream.bodyUsed).toBe(false);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(await response.text()).toBe(payload);
    expect(proxy).toHaveBeenCalledTimes(1);
  },
);

test("authorization failure still stops before relay access", async () => {
  authorize.mockResolvedValueOnce({ error: true, msg: "Sign in first" });

  const response = await GET(request("GET"), context("chat/completions"));

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: true, msg: "Sign in first" });
  expect(limit).not.toHaveBeenCalled();
  expect(credentials).not.toHaveBeenCalled();
  expect(proxy).not.toHaveBeenCalled();
});

test("the path allowlist still rejects unrelated endpoints", async () => {
  const response = await POST(request("POST", "models"), context("models"));

  expect(response.status).toBe(403);
  expect(credentials).not.toHaveBeenCalled();
  expect(proxy).not.toHaveBeenCalled();
});

test("Gemini video uses the selected relay credential as x-goog-api-key", async () => {
  credentials.mockResolvedValueOnce({
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: privateKey,
  });
  edgeFetch.mockResolvedValueOnce(
    Response.json({ name: "models/veo/operations/op" }),
  );
  const req = new NextRequest(
    "https://chat.test/api/v1beta/models/veo:predictLongRunning",
    { method: "POST" },
  );
  const result = await handleEdgeProxy(
    req,
    "v1beta/models/veo:predictLongRunning",
    {
      upstreamPath: "v1beta/models/veo:predictLongRunning",
      gemini: true,
    },
  );
  await result.text();
  const headers = new Headers(edgeFetch.mock.calls[0][1]?.headers);
  expect(headers.get("x-goog-api-key")).toBe(privateKey);
  expect(headers.has("authorization")).toBe(false);
});

test("media redirects never send a relay credential to cloud storage", async () => {
  edgeFetch
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location:
            "https://storage.googleapis.com/generated/video.mp4?signed=fixture",
        },
      }),
    )
    .mockResolvedValueOnce(
      new Response("video-bytes", { headers: { "content-type": "video/mp4" } }),
    );
  const response = await handleEdgeProxy(
    new NextRequest("https://chat.test/api/v1/videos/job/content"),
    "videos/job/content",
  );
  expect(await response.text()).toBe("video-bytes");
  expect(edgeFetch).toHaveBeenCalledTimes(2);
  const headers = new Headers(edgeFetch.mock.calls[1][1]?.headers);
  expect(headers.has("authorization")).toBe(false);
  expect(headers.has("x-goog-api-key")).toBe(false);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("media redirects cannot target an arbitrary host or internal service", async () => {
  edgeFetch.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }),
  );
  const response = await handleEdgeProxy(
    new NextRequest("https://chat.test/api/v1/videos/job/content"),
    "videos/job/content",
  );
  expect(response.status).toBe(502);
  expect(edgeFetch).toHaveBeenCalledTimes(1);
});
