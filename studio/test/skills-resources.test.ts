/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
import * as route from "../app/api/skills/resources/[...path]/route";

const originalFetch = global.fetch;
const fetchMock = jest.fn<typeof fetch>();
const upstream =
  "https://raw.githubusercontent.com/qzq00767/octopus-skills/main/skills/";
const request = (path: string[], headers?: HeadersInit) =>
  route.GET(
    new NextRequest("https://chat.example.test/api/skills/resources/ignored", {
      headers,
    }),
    { params: Promise.resolve({ path }) },
  );

beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
afterAll(() => {
  global.fetch = originalFetch;
});

test.each(["catalog.json", "catalog-v2.json"])(
  "serves %s from the fixed public upstream",
  async (name) => {
    const body = '{"version":1,"skills":[]}';
    fetchMock.mockResolvedValueOnce(new Response(body));
    const response = await request([name], {
      authorization: "Bearer private-token",
      cookie: "session=private-session",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, must-revalidate",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      upstream + name,
      expect.objectContaining({
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    expect("POST" in route).toBe(false);
  },
);

test("serves a skill document with its original UTF-8 bytes", async () => {
  const body = new TextEncoder().encode("---\nname: 翻译\n---\n正文\r\n");
  fetchMock.mockResolvedValueOnce(new Response(body));
  const response = await request(["translation", "SKILL.md"]);
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
  expect(response.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8",
  );
  expect(fetchMock.mock.calls[0][0]).toBe(upstream + "translation/SKILL.md");
  expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
    Accept: "text/plain",
  });
});

test("rejects traversal, external URLs and unexpected resource names before fetching", async () => {
  for (const path of [
    [],
    ["..", "SKILL.md"],
    ["%2e%2e", "SKILL.md"],
    ["translation%2f..", "SKILL.md"],
    ["translation/../other", "SKILL.md"],
    ["https://example.com", "SKILL.md"],
    ["translation", "..", "SKILL.md"],
    ["translation", "skill.md"],
    ["translation", "SKILL.md?url=https://example.com"],
    ["catalog-v2.json", "SKILL.md"],
    ["catalog-v3.json"],
    ["a".repeat(65), "SKILL.md"],
  ]) {
    const response = await request(path);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([
  [404, 404],
  [410, 410],
  [429, 429],
  [500, 502],
  [302, 502],
])(
  "maps upstream %s to %s without exposing upstream data",
  async (status, expected) => {
    const cancel = jest.fn<() => void>();
    const body = new ReadableStream<Uint8Array>({ cancel });
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status,
        headers: {
          location: "https://example.com/private",
          "set-cookie": "private=upstream-secret",
        },
      }),
    );
    const response = await request(["catalog-v2.json"]);
    expect(response.status).toBe(expected);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

test("network and redirect failures return a bodyless gateway error", async () => {
  fetchMock.mockRejectedValueOnce(new Error("private upstream DNS details"));
  const response = await request(["catalog-v2.json"]);
  expect(response.status).toBe(502);
  expect(await response.text()).toBe("");
});

test.each([
  [["catalog-v2.json"], 128000],
  [["translation", "SKILL.md"], 32000],
])("enforces the byte limit for %j", async (path, limit) => {
  const cancel = jest.fn<() => void>();
  fetchMock.mockResolvedValueOnce(
    new Response(new ReadableStream({ cancel }), {
      headers: { "Content-Length": String(limit + 1) },
    }),
  );
  expect((await request(path)).status).toBe(413);
  expect(cancel).toHaveBeenCalledTimes(1);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(limit));
      controller.enqueue(new Uint8Array(1));
    },
    cancel,
  });
  fetchMock.mockResolvedValueOnce(new Response(stream));
  expect((await request(path)).status).toBe(413);
  expect(stream.locked).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(2);

  fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(limit)));
  const response = await request(path);
  expect(response.status).toBe(200);
  expect((await response.arrayBuffer()).byteLength).toBe(limit);
});

test("times out an upstream fetch after 15 seconds and clears its timer", async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(
    async (_url, init) =>
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  const pending = request(["catalog-v2.json"]);
  await jest.advanceTimersByTimeAsync(15000);
  expect((await pending).status).toBe(504);
  expect(jest.getTimerCount()).toBe(0);
});

test("keeps the deadline active while streaming the response body", async () => {
  jest.useFakeTimers();
  let bodyController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      bodyController = controller;
      controller.enqueue(new TextEncoder().encode("partial"));
    },
  });
  fetchMock.mockImplementation(async (_url, init) => {
    init?.signal?.addEventListener(
      "abort",
      () => bodyController.error(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
    return new Response(stream);
  });
  const pending = request(["translation", "SKILL.md"]);
  await jest.advanceTimersByTimeAsync(15000);
  expect((await pending).status).toBe(504);
  expect(stream.locked).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

test("client cancellation aborts the upstream and removes request listeners", async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const req = new NextRequest(
    "https://chat.example.test/api/skills/resources/catalog-v2.json",
    { signal: controller.signal },
  );
  const remove = jest.spyOn(req.signal, "removeEventListener");
  fetchMock.mockImplementation(
    async (_url, init) =>
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  const pending = route.GET(req, {
    params: Promise.resolve({ path: ["catalog-v2.json"] }),
  });
  await jest.advanceTimersByTimeAsync(0);
  controller.abort();
  expect((await pending).status).toBe(499);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(jest.getTimerCount()).toBe(0);
});
