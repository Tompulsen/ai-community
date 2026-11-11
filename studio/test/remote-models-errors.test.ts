/** @jest-environment node */

import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { GET } from "../app/api/remote-models/route";

const originalEnv = process.env;
const originalFetch = global.fetch;
const request = () =>
  new NextRequest("https://chat.example.test/api/remote-models");

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NEW_API_BASE_URL: "",
    ACCESS_PASSWORD: "",
    MODELS_API_URL: "https://models.example.test/v1",
    MODEL_API_KEY: "fixture-key",
  };
  global.fetch = jest.fn<typeof fetch>();
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test.each([401, 403, 429, 500, 503])(
  "model discovery preserves HTTP %s instead of reporting an empty success",
  async (status) => {
    jest.mocked(fetch).mockResolvedValueOnce(
      new Response("upstream private details", {
        status,
        headers: { "Retry-After": "5" },
      }),
    );
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    const json = await response.json();
    expect(json).toMatchObject({ error: true });
    expect(json).not.toHaveProperty("data");
    expect(JSON.stringify(json)).not.toContain("upstream private details");
  },
);

test("network and timeout failures remain recoverable errors", async () => {
  jest
    .mocked(fetch)
    .mockRejectedValueOnce(new Error("private network details"))
    .mockRejectedValueOnce(new DOMException("expired", "TimeoutError"));
  const network = await GET(request());
  expect(network.status).toBe(502);
  expect(JSON.stringify(await network.json())).not.toContain("private network");
  const timeout = await GET(request());
  expect(timeout.status).toBe(504);
});

test("malformed model responses fail while legitimate empty lists remain valid", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(Response.json({ message: "wrong envelope" }))
    .mockResolvedValueOnce(new Response("invalid json"))
    .mockResolvedValueOnce(Response.json({ data: [] }));
  expect((await GET(request())).status).toBe(502);
  expect((await GET(request())).status).toBe(502);
  const empty = await GET(request());
  expect(empty.status).toBe(200);
  expect(await empty.json()).toEqual({ data: [] });
});

test("successful discovery bounds request duration and disables shared caching", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(Response.json({ data: [{ id: "fixture-model" }] }));
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const [url, options] = jest.mocked(fetch).mock.calls[0];
  expect(url).toBe("https://models.example.test/v1/models");
  expect(options).toMatchObject({ cache: "no-store", redirect: "error" });
  expect(options?.signal).toBeDefined();
});
