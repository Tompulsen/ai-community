/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest, NextResponse } from "next/server";
import { handleEdgeProxy } from "../app/api/v1/_proxy";
import { proxyAsyncTask } from "../app/api/async-task-proxy";
import { GET, POST } from "../app/api/v1/[...path]/route";
import { proxyGeminiChat } from "../app/api/gemini-proxy";
import { GET as remoteModels } from "../app/api/remote-models/route";
import { SESSION_COOKIE, createSession } from "../app/lib/new-api/session";

const originalEnv = process.env;
const user = {
  id: 17,
  username: "account-a",
  display_name: "Account A",
  quota: 100,
  used_quota: 20,
  request_count: 2,
  group: "default",
};

function request(
  id: string,
  path: string,
  method = "GET",
  signal?: AbortSignal,
) {
  return new NextRequest(`https://chat.example.test/api/v1/${path}`, {
    method,
    signal,
    headers: {
      host: "chat.example.test",
      origin: "https://chat.example.test",
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${id}`,
      "x-api-key": "Bearer sk-forged-client-key",
    },
    ...(method === "POST"
      ? { body: JSON.stringify({ model: "test-model" }) }
      : {}),
  });
}

async function account() {
  const req = new NextRequest("https://chat.example.test/api/new-api/login");
  return createSession(req, NextResponse.json({}), {
    user,
    accessToken: "private-login-token",
    accessExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    refreshToken: "private-refresh-token",
    upstreamSessionId: "upstream-session",
    selectedTokenId: 23,
    selectedKey: "sk-selected-user-key",
  });
}

function modelCalls() {
  return jest
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).includes("/v1/"));
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    NEW_API_BASE_URL: "https://accounts.example.test",
    NEW_API_IMAGE_BASE_URL: "",
    NEW_API_ASYNC_BASE_URL: "",
    NEW_API_PUBLIC_URL: "https://accounts.example.test",
    NEW_API_SESSION_SECRET: "test-session-secret-with-at-least-32-characters",
    NEW_API_REDIS_URL: "",
    ENABLE_RATE_LIMIT: "false",
    MODEL_API_KEY: "sk-shared-server-key",
    PROXY_URL: "",
    HTTPS_PROXY: "",
    https_proxy: "",
    HTTP_PROXY: "",
    http_proxy: "",
    NEW_API_TRUST_PROXY: "false",
  };
  global.fetch = jest.fn<typeof fetch>();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = originalEnv;
});

describe("Authenticated model proxies", () => {
  test("public video redirects preserve ranges without leaking credentials", async () => {
    const created = await account();
    jest.mocked(fetch).mockImplementation(async (url, options) => {
      if (String(url).includes("/api/user/self"))
        return Response.json({ success: true, data: user });
      if (String(url).startsWith("https://accounts.example.test/"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://media.amazonaws.com/clip.mp4" },
        });
      expect(String(url)).toBe("https://media.amazonaws.com/clip.mp4");
      expect(Object.fromEntries(new Headers(options?.headers))).toEqual({
        accept: "video/*",
        range: "bytes=10-19",
        "if-range": '"one"',
      });
      return new Response("0123456789", {
        status: 206,
        headers: { "content-range": "bytes 10-19/20" },
      });
    });
    const req = request(created.id, "videos/job/content");
    req.headers.set("range", "bytes=10-19");
    req.headers.set("if-range", '"one"');
    const response = await handleEdgeProxy(req, "videos/job/content");
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("0123456789");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  test("authenticated video transfers preserve byte ranges and version validators", async () => {
    const created = await account();
    jest.mocked(fetch).mockImplementation(async (url, options) => {
      if (String(url).includes("/api/user/self"))
        return Response.json({ success: true, data: user });
      const headers = new Headers(options?.headers);
      expect(headers.get("range")).toBe("bytes=10-19");
      expect(headers.get("if-range")).toBe('"video-one"');
      expect(headers.get("authorization")).toBe("Bearer sk-selected-user-key");
      expect(headers.has("cookie")).toBe(false);
      return new Response("0123456789", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 10-19/20",
          etag: '"video-one"',
        },
      });
    });
    const req = request(created.id, "videos/job/content");
    req.headers.set("range", "bytes=10-19");
    req.headers.set("if-range", '"video-one"');
    const response = await handleEdgeProxy(req, "videos/job/content");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 10-19/20");
    expect(await response.text()).toBe("0123456789");
  });
  test.each(["chat/completions", "images/generations"])(
    "%s cancels upstream while waiting for headers without replaying the POST",
    async (path) => {
      const created = await account();
      let started!: () => void;
      const reachedModel = new Promise<void>((resolve) => (started = resolve));
      let signal: AbortSignal | undefined;
      jest.mocked(fetch).mockImplementation(async (url, options) => {
        if (String(url).includes("/api/user/self"))
          return Response.json({ success: true, data: user });
        signal = options?.signal ?? undefined;
        started();
        return new Promise<Response>((_resolve, reject) => {
          signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
        });
      });
      const controller = new AbortController();
      const req = request(created.id, path, "POST", controller.signal);
      const pending =
        path === "chat/completions"
          ? POST(req, { params: Promise.resolve({ path: path.split("/") }) })
          : handleEdgeProxy(req, path);
      await reachedModel;
      controller.abort();
      const response = await pending;
      expect(response.status).toBe(499);
      expect(signal!.aborted).toBe(true);
      expect(modelCalls()).toHaveLength(1);
    },
  );

  test.each(["chat/completions", "images/generations"])(
    "%s keeps client cancellation connected after response headers",
    async (path) => {
      const created = await account();
      let signal: AbortSignal | undefined;
      const cancel = jest.fn<() => void>();
      jest.mocked(fetch).mockImplementation(async (url, options) => {
        if (String(url).includes("/api/user/self"))
          return Response.json({ success: true, data: user });
        signal = options?.signal ?? undefined;
        return new Response(
          new ReadableStream({
            start(source) {
              source.enqueue(new TextEncoder().encode("data: first\n\n"));
            },
            cancel,
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      });
      const controller = new AbortController();
      const req = request(created.id, path, "POST", controller.signal);
      const response =
        path === "chat/completions"
          ? await POST(req, {
              params: Promise.resolve({ path: path.split("/") }),
            })
          : await handleEdgeProxy(req, path);
      const reader = response.body!.getReader();
      expect((await reader.read()).value!.length).toBeGreaterThan(0);
      const rejected = expect(reader.read()).rejects.toMatchObject({
        name: "AbortError",
      });
      controller.abort();
      await rejected;
      expect(signal!.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(modelCalls()).toHaveLength(1);
    },
  );

  test.each(["chat/completions", "images/generations"])(
    "%s rejects oversized uploads without forwarding them",
    async (path) => {
      const created = await account();
      jest
        .mocked(fetch)
        .mockImplementation(async () =>
          Response.json({ success: true, data: user }),
        );
      const req = request(created.id, path, "POST");
      req.headers.set("content-length", String(65 * 1024 * 1024));
      const response =
        path === "chat/completions"
          ? await POST(req, {
              params: Promise.resolve({ path: path.split("/") }),
            })
          : await handleEdgeProxy(req, path);
      expect(response.status).toBe(413);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(modelCalls()).toHaveLength(0);
    },
  );

  test.each(["responses", "messages"])(
    "%s retains account authentication and original request body",
    async (path) => {
      const created = await account();
      jest.mocked(fetch).mockImplementation(async (url) =>
        String(url).includes("/api/user/self")
          ? Response.json({ success: true, data: user })
          : new Response("data: [DONE]\n\n", {
              headers: { "content-type": "text/event-stream" },
            }),
      );
      const req = request(created.id, path, "POST");
      const response = await POST(req, {
        params: Promise.resolve({ path: [path] }),
      });
      expect(response.status).toBe(200);
      expect(modelCalls()).toHaveLength(1);
      expect(modelCalls()[0][0]).toBe(
        `https://accounts.example.test/v1/${path}`,
      );
      const headers = new Headers(modelCalls()[0][1]?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk-selected-user-key");
      if (path === "messages")
        expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(JSON.parse(String(modelCalls()[0][1]?.body))).toEqual({
        model: "test-model",
      });
    },
  );

  test("Gemini uses the native path and selected account key", async () => {
    const created = await account();
    jest.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes("/api/user/self")
        ? Response.json({ success: true, data: user })
        : new Response('data: {"candidates":[]}\n\n', {
            headers: { "content-type": "text/event-stream" },
          }),
    );
    const req = new NextRequest(
      "https://chat.example.test/api/v1beta/models/gemini-test:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: {
          host: "chat.example.test",
          origin: "https://chat.example.test",
          cookie: `${SESSION_COOKIE}=${created.id}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        }),
      },
    );
    const response = await proxyGeminiChat(req, [
      "models",
      "gemini-test:streamGenerateContent",
    ]);
    expect(response.status).toBe(200);
    const call = jest
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes("/v1beta/"))!;
    expect(call[0]).toBe(
      "https://accounts.example.test/v1beta/models/gemini-test:streamGenerateContent?alt=sse",
    );
    expect(new Headers(call[1]?.headers).get("authorization")).toBe(
      "Bearer sk-selected-user-key",
    );
    expect(JSON.parse(String(call[1]?.body)).contents[0].parts[0].text).toBe(
      "Hello",
    );
  });

  test("Gemini rejects alternate paths and credential query parameters", async () => {
    for (const [path, query] of [
      [["models", "../other:generateContent"], ""],
      [["models", "gemini:generateContent"], "?key=client-secret"],
    ] as const) {
      const response = await proxyGeminiChat(
        new NextRequest(`https://chat.example.test/api/v1beta/test${query}`, {
          method: "POST",
        }),
        [...path],
      );
      expect(response.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  test("chat forwards a 24-byte original text attachment unchanged to New API", async () => {
    const created = await account();
    const bytes = Buffer.from("abcdefghijklmnopqrstuvwx");
    const body = JSON.stringify({
      model: "gemini-3.8-flash",
      stream: true,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "--- 素材: test.txt (24 B) ---\n\n翻译" },
            {
              type: "file",
              file: {
                filename: "test.txt",
                file_data: `data:text/plain;base64,${bytes.toString("base64")}`,
              },
            },
          ],
        },
      ],
    });
    jest.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes("/api/user/self")
        ? Response.json({ success: true, data: user })
        : new Response("data: [DONE]\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
    );
    const req = new NextRequest(
      "https://chat.example.test/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          host: "chat.example.test",
          origin: "https://chat.example.test",
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${created.id}`,
        },
        body,
      },
    );
    const response = await POST(req, {
      params: Promise.resolve({ path: ["chat", "completions"] }),
    });
    expect(response.status).toBe(200);
    expect(modelCalls()).toHaveLength(1);
    expect(modelCalls()[0][0]).toBe(
      "https://accounts.example.test/v1/chat/completions",
    );
    expect(String(modelCalls()[0][1]?.body)).toBe(body);
    const original = JSON.parse(String(modelCalls()[0][1]?.body)).messages[0]
      .content[1].file;
    expect(Buffer.from(original.file_data.split(",")[1], "base64")).toEqual(
      bytes,
    );
    expect(bytes.length).toBe(24);
    await response.text();
  });

  test.each(["images", "videos"] as const)(
    "async %s uses the public gateway root and preserves idempotency and account isolation",
    async (kind) => {
      process.env.NEW_API_PUBLIC_URL = "https://public.example.test";
      const created = await account();
      jest
        .mocked(fetch)
        .mockImplementation(async (url) =>
          String(url).includes("/api/user/self")
            ? Response.json({ success: true, data: user })
            : Response.json(
                { id: "job_123", status: "queued" },
                { status: 202 },
              ),
        );
      const req = request(created.id, `async-${kind}/v1/tasks`, "POST");
      req.headers.set("Idempotency-Key", "request-12345678");
      const response = await proxyAsyncTask(req, kind, ["tasks"]);
      expect(response.status).toBe(202);
      const [url, options] = modelCalls()[0];
      expect(url).toBe(`https://public.example.test/async-${kind}/v1/tasks`);
      const headers = new Headers(options?.headers);
      expect(headers.get("Idempotency-Key")).toBe("request-12345678");
      expect(headers.get("authorization")).toBe("Bearer sk-selected-user-key");
      expect(headers.get("cookie")).toBeNull();
    },
  );

  test("async multipart edits retain binary bytes on the configured gateway", async () => {
    process.env.NEW_API_ASYNC_BASE_URL = "https://async.example.test";
    const created = await account();
    const bytes = new Uint8Array([0, 255, 254, 128, 1, 2]);
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        String(url).includes("/api/user/self")
          ? Response.json({ success: true, data: user })
          : Response.json({ id: "img_123" }, { status: 202 }),
      );
    const req = new NextRequest(
      "https://chat.example.test/api/async-images/v1/edits",
      {
        method: "POST",
        headers: {
          origin: "https://chat.example.test",
          host: "chat.example.test",
          cookie: `${SESSION_COOKIE}=${created.id}`,
          "content-type": "multipart/form-data; boundary=example",
        },
        body: bytes,
      },
    );
    expect((await proxyAsyncTask(req, "images", ["edits"])).status).toBe(202);
    expect(modelCalls()[0][0]).toBe(
      "https://async.example.test/async-images/v1/edits",
    );
    expect(new Uint8Array(modelCalls()[0][1]?.body as ArrayBuffer)).toEqual(
      bytes,
    );
  });

  test("async submission failures never replay a paid POST", async () => {
    const created = await account();
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        String(url).includes("/api/user/self")
          ? Response.json({ success: true, data: user })
          : new Response("unavailable", { status: 502 }),
      );
    expect(
      (
        await proxyAsyncTask(request(created.id, "tasks", "POST"), "images", [
          "tasks",
        ])
      ).status,
    ).toBe(502);
    expect(modelCalls()).toHaveLength(1);
  });

  test.each([
    ["tasks", ".."],
    ["tasks", "id", "retry-save"],
    ["models"],
    ["edits"],
  ])("async video proxy rejects unsupported paths %j", async (...path) => {
    expect(
      (await proxyAsyncTask(request("", "tasks"), "videos", path)).status,
    ).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(["images/generations", "images/edits", "images/variations"])(
    "preserves %s request bytes, query and SSE when using the image origin",
    async (path) => {
      process.env.NEW_API_IMAGE_BASE_URL = "http://image-async:8000";
      const created = await account();
      const isMultipart = path !== "images/generations";
      const contentType = isMultipart
        ? "multipart/form-data; boundary=test-boundary"
        : "application/json";
      const body = isMultipart
        ? '--test-boundary\r\nContent-Disposition: form-data; name="image"; filename="input.png"\r\nContent-Type: image/png\r\n\r\nimage-bytes\r\n--test-boundary--\r\n'
        : JSON.stringify({ model: "test-model", stream: true });
      const events =
        'event: image_generation.completed\ndata: {"url":"https://images.example.test/media/image-id"}\n\n';
      jest.mocked(fetch).mockImplementation(async (url) =>
        String(url).includes("/api/user/self")
          ? Response.json({ success: true, data: user })
          : new Response(events, {
              headers: { "content-type": "text/event-stream" },
            }),
      );
      const req = new NextRequest(
        `https://chat.example.test/api/v1/${path}?mode=async&task_id=task-123`,
        {
          method: "POST",
          headers: {
            host: "chat.example.test",
            origin: "https://chat.example.test",
            "content-type": contentType,
            accept: "text/event-stream",
            cookie: `${SESSION_COOKIE}=${created.id}`,
          },
          body,
        },
      );
      const response = isMultipart
        ? await POST(req, {
            params: Promise.resolve({ path: path.split("/") }),
          })
        : await handleEdgeProxy(req, path);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(events);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(modelCalls()).toHaveLength(1);
      const [url, options] = modelCalls()[0];
      expect(url).toBe(
        `http://image-async:8000/v1/${path}?mode=async&task_id=task-123`,
      );
      expect(
        typeof options?.body === "string"
          ? options.body
          : Buffer.from(options?.body as Uint8Array).toString(),
      ).toBe(body);
      const headers = new Headers(options?.headers);
      expect(headers.get("content-type")).toBe(contentType);
      expect(headers.get("authorization")).toBe("Bearer sk-selected-user-key");
      expect(headers.get("cookie")).toBeNull();
    },
  );

  test("remote model discovery uses the same validated IP and account header boundary", async () => {
    const created = await account();
    process.env.NEW_API_TRUST_PROXY = "true";
    jest
      .mocked(fetch)
      .mockImplementation(async (url) =>
        String(url).includes("/api/user/self")
          ? Response.json({ success: true, data: user })
          : Response.json({ data: [{ id: "private-model" }] }),
      );
    const req = request(created.id, "models");
    req.headers.set("x-real-ip", "203.0.113.42");
    req.headers.set("x-forwarded-for", "198.51.100.99, 10.0.0.1");
    req.headers.set("user-agent", "a".repeat(700));
    req.headers.set("x-new-api-user", String(user.id));
    const response = await remoteModels(req);

    expect(response.status).toBe(200);
    expect(modelCalls()).toHaveLength(1);
    const [, options] = modelCalls()[0];
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-selected-user-key");
    expect(headers.get("x-real-ip")).toBe("203.0.113.42");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.42");
    expect(headers.get("user-agent")).toBe("a".repeat(512));
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-new-api-user")).toBeNull();
    expect(options?.body).toBeUndefined();
  });

  test("blocks a paid model request from a tab belonging to an earlier account", async () => {
    const created = await account();
    const req = request(created.id, "chat/completions", "POST");
    req.headers.set("x-new-api-user", "29");
    const response = await POST(req, {
      params: Promise.resolve({ path: ["chat", "completions"] }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("NEW_API_ACCOUNT_CHANGED");
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(["models", "videos/task-123", "dashboard/billing/usage"])(
    "forwards GET %s without a request body or browser credentials",
    async (path) => {
      const created = await account();
      jest.mocked(fetch).mockImplementation(async (url) =>
        String(url).includes("/api/user/self")
          ? Response.json({ success: true, data: user })
          : Response.json(
              { data: [] },
              {
                headers: { "set-cookie": "untrusted-upstream-cookie=value" },
              },
            ),
      );
      const req = request(created.id, path);
      const response = path.startsWith("dashboard/")
        ? await GET(req, { params: Promise.resolve({ path: path.split("/") }) })
        : await handleEdgeProxy(req, path);

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(modelCalls()).toHaveLength(1);
      const [url, options] = modelCalls()[0];
      expect(url).toBe(`https://accounts.example.test/v1/${path}`);
      expect(options?.body).toBeUndefined();
      expect(options?.method).toBe("GET");
      const headers = new Headers(options?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk-selected-user-key");
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("x-api-key")).toBeNull();
    },
  );

  test.each(["chat/completions", "images/generations"])(
    "does not automatically repeat a paid POST %s after a gateway error",
    async (path) => {
      const created = await account();
      jest
        .mocked(fetch)
        .mockImplementation(async (url) =>
          String(url).includes("/api/user/self")
            ? Response.json({ success: true, data: user })
            : Response.json(
                { error: { message: "Temporary gateway failure" } },
                { status: 502 },
              ),
        );
      const req = request(created.id, path, "POST");
      const response =
        path === "chat/completions"
          ? await POST(req, {
              params: Promise.resolve({ path: path.split("/") }),
            })
          : await handleEdgeProxy(req, path);

      expect(response.status).toBe(502);
      expect(modelCalls()).toHaveLength(1);
    },
  );

  test.each([
    ["chat/completions", "gateway"],
    ["images/generations", "gateway"],
    ["chat/completions", "network"],
    ["images/generations", "network"],
  ])(
    "legacy mode does not replay paid POST %s after a %s failure",
    async (path, failure) => {
      delete process.env.NEW_API_BASE_URL;
      jest.mocked(fetch).mockImplementation(async () => {
        if (failure === "network")
          throw new Error("Lost response after acceptance");
        return Response.json({ error: "Gateway failure" }, { status: 502 });
      });
      const req = request("", path, "POST");
      const result =
        path === "chat/completions"
          ? await POST(req, {
              params: Promise.resolve({ path: path.split("/") }),
            })
          : await handleEdgeProxy(req, path);
      expect(result.status).toBe(502);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["chat/completions", "images/generations"])(
    "does not automatically repeat a paid POST %s after a network failure",
    async (path) => {
      const created = await account();
      jest.mocked(fetch).mockImplementation(async (url) => {
        if (String(url).includes("/api/user/self")) {
          return Response.json({ success: true, data: user });
        }
        throw new Error("Connection lost after the upstream accepted the body");
      });
      const req = request(created.id, path, "POST");
      const response =
        path === "chat/completions"
          ? await POST(req, {
              params: Promise.resolve({ path: path.split("/") }),
            })
          : await handleEdgeProxy(req, path);

      expect(response.status).toBe(502);
      expect(modelCalls()).toHaveLength(1);
    },
  );

  test("preserves Retry-After when the model upstream returns 429", async () => {
    const created = await account();
    jest.mocked(fetch).mockImplementation(async (url) =>
      String(url).includes("/api/user/self")
        ? Response.json({ success: true, data: user })
        : new Response("Too many requests", {
            status: 429,
            headers: { "retry-after": "25" },
          }),
    );
    const response = await handleEdgeProxy(
      request(created.id, "models"),
      "models",
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("25");
  });

  test.each(["chat/completions", "images/generations"])(
    "normalizes upstream context-window 502 for %s without exposing provider details",
    async (path) => {
      const created = await account();
      jest.mocked(fetch).mockImplementation(async (url) =>
        String(url).includes("/api/user/self")
          ? Response.json({ success: true, data: user })
          : Response.json(
              {
                error: {
                  message:
                    "Your input exceeds the context window of this model. private-provider-details",
                },
              },
              { status: 502 },
            ),
      );
      const req = request(created.id, path, "POST");
      const response =
        path === "chat/completions"
          ? await POST(req, {
              params: Promise.resolve({ path: path.split("/") }),
            })
          : await handleEdgeProxy(req, path);
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).toContain("上下文");
      expect(body).not.toContain("private-provider-details");
      expect(modelCalls()).toHaveLength(1);
    },
  );

  test("preserves Retry-After when the account API blocks a model request", async () => {
    const created = await account();
    jest.mocked(fetch).mockResolvedValueOnce(
      new Response("Too many requests", {
        status: 429,
        headers: { "retry-after": "30" },
      }),
    );
    const response = await POST(
      request(created.id, "chat/completions", "POST"),
      { params: Promise.resolve({ path: ["chat", "completions"] }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(modelCalls()).toHaveLength(0);
  });
});
