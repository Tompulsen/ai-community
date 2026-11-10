/** @jest-environment node */
import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { isIP } from "node:net";
import { gzipSync } from "node:zlib";
import { NextRequest } from "next/server";

const dns = jest.fn<any>();
const transport = jest.fn<any>();
jest.unstable_mockModule("node:dns/promises", () => ({ lookup: dns }));
jest.unstable_mockModule("node:http", () => ({ request: transport }));
jest.unstable_mockModule("node:https", () => ({ request: transport }));
const { GET } = await import("../app/api/proxy-image/route");
const { fetchPublicImage } = await import("../app/utils/public-image-fetch");

type Fixture = {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  stream?: PassThrough;
  pending?: boolean;
};
let fixtures: Fixture[];
let responses: PassThrough[];
let connected: any[];

beforeEach(() => {
  fixtures = [];
  responses = [];
  connected = [];
  dns.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  transport
    .mockReset()
    .mockImplementation((url: URL, options: any, receive: any) => {
      const request = new EventEmitter() as any;
      let incoming: PassThrough | undefined;
      request.setTimeout = jest.fn(() => request);
      request.destroy = (error?: Error) => {
        if (error) request.emit("error", error);
        incoming?.destroy(error);
        return request;
      };
      request.end = () =>
        queueMicrotask(() => {
          const onLookup = (error: Error, value: any, family: number) => {
            if (error) return request.emit("error", error);
            connected.push({ address: value, family });
            const fixture = fixtures.shift() || {};
            if (fixture.pending) return;
            const response = fixture.stream || new PassThrough();
            incoming = response;
            responses.push(response);
            Object.assign(response, {
              statusCode: fixture.status || 200,
              headers: fixture.headers || { "content-type": "image/png" },
            });
            receive(response);
            if (!fixture.stream) response.end(fixture.body || "image");
          };
          if (isIP(url.hostname))
            onLookup(null as any, url.hostname, isIP(url.hostname));
          else options.lookup(url.hostname, { all: true }, onLookup);
        });
      options.signal.addEventListener("abort", () =>
        request.destroy(
          Object.assign(new Error("Aborted"), { name: "AbortError" }),
        ),
      );
      return request;
    });
});
afterEach(() => jest.useRealTimers());

const request = (url: string) =>
  new NextRequest(
    `https://chat.test/api/proxy-image?url=${encodeURIComponent(url)}`,
    {
      headers: { Cookie: "session=secret", Authorization: "Bearer private" },
    },
  );

test.each([
  "http://127.0.0.1:8080/private",
  "http://2130706433/",
  "http://0x7f000001/",
  "http://10.0.0.1/",
  "http://172.16.0.1/",
  "http://192.168.1.1/",
  "http://169.254.169.254/",
  "http://100.64.0.1/",
  "http://0.0.0.0/",
  "http://[::1]/",
  "http://[fc00::1]/",
  "http://[fe80::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[2002:7f00:1::]/",
  "https://user:pass@images.example.com/a.png",
  "file:///etc/passwd",
])("rejects unsafe URL %s before connecting", async (url) => {
  const req = request(url);
  const response = await GET(req);
  expect(response.status).toBe(400);
  expect(transport).not.toHaveBeenCalled();
});

test.each(["127.0.0.1", "10.1.2.3", "169.254.1.2", "::1", "fd00::1"])(
  "rejects hostnames resolving to %s without a connection",
  async (address) => {
    dns.mockResolvedValue([{ address, family: isIP(address) }]);
    expect((await GET(request("https://images.example.com/a"))).status).toBe(
      400,
    );
    expect(connected).toHaveLength(0);
  },
);

test("rejects mixed public and private DNS results", async () => {
  dns.mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "::1", family: 6 },
  ]);
  expect((await GET(request("https://images.example.com/a"))).status).toBe(400);
  expect(connected).toHaveLength(0);
});

test("pins checked DNS answers and never forwards client credentials", async () => {
  const response = await GET(
    request("https://cdn.example.com/image?signature=abc"),
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("image");
  expect(dns).toHaveBeenCalledTimes(1);
  expect(connected[0].address).toEqual([{ address: "8.8.8.8", family: 4 }]);
  const [url, options] = transport.mock.calls[0] as [URL, any];
  expect(url.href).toBe("https://cdn.example.com/image?signature=abc");
  expect(options.agent).toBe(false);
  const headers = new Headers(options.headers);
  expect(headers.has("cookie")).toBe(false);
  expect(headers.has("authorization")).toBe(false);
  expect(headers.get("accept-encoding")).toBe("identity");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});

test("supports checked IPv6 CDN addresses", async () => {
  dns.mockResolvedValue([{ address: "2606:4700::1111", family: 6 }]);
  const response = await GET(request("https://ipv6.example.com/a"));
  expect(response.status).toBe(200);
  await response.text();
});

test("checks every redirect and refuses private redirect destinations", async () => {
  fixtures.push(
    { status: 302, headers: { location: "https://second.example.com/a" } },
    { status: 307, headers: { location: "http://127.0.0.1/private" } },
  );
  expect((await GET(request("https://first.example.com/a"))).status).toBe(400);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(responses.every((response) => response.destroyed)).toBe(true);
});

test("checks DNS again for relative redirects and caps redirect loops", async () => {
  fixtures.push({ status: 302, headers: { location: "/next" } });
  dns
    .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  expect((await GET(request("https://images.example.com/a"))).status).toBe(400);
  expect(connected).toHaveLength(1);
  dns.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  fixtures = Array.from({ length: 6 }, () => ({
    status: 302,
    headers: { location: "/loop" },
  }));
  expect((await GET(request("https://images.example.com/a"))).status).toBe(502);
});

test.each([
  "text/html",
  "application/json",
  "image/svg+xml",
  "application/octet-stream",
  "",
])(
  "rejects %s instead of serving active content on the chat origin",
  async (type) => {
    fixtures.push({
      headers: { "content-type": type },
      body: "<script>alert(1)</script>",
    });
    const response = await GET(request("https://images.example.com/evil"));
    expect(response.status).toBe(415);
    expect(await response.text()).not.toContain("<script>");
    expect(responses[0].destroyed).toBe(true);
  },
);

test("streams before completion and retains accurate download length", async () => {
  const stream = new PassThrough();
  fixtures.push({
    stream,
    headers: { "content-type": "image/png", "content-length": "4" },
  });
  const result = await GET(request("https://images.example.com/a"));
  expect(result.headers.get("content-length")).toBe("4");
  expect(result.headers.get("x-image-content-length")).toBe("4");
  const reader = result.body!.getReader();
  stream.write(Buffer.from([1, 2]));
  expect((await reader.read()).value).toEqual(new Uint8Array([1, 2]));
  stream.end(Buffer.from([3, 4]));
  expect((await reader.read()).value).toEqual(new Uint8Array([3, 4]));
  expect((await reader.read()).done).toBe(true);
});

test("decodes compressed images without forwarding compressed length", async () => {
  const compressed = gzipSync("decoded-image");
  fixtures.push({
    body: compressed,
    headers: {
      "content-type": "image/png",
      "content-encoding": "gzip",
      "content-length": String(compressed.length),
    },
  });
  const result = await GET(request("https://images.example.com/a"));
  expect(result.headers.has("content-length")).toBe(false);
  expect(result.headers.has("x-image-content-length")).toBe(false);
  expect(result.headers.has("content-encoding")).toBe(false);
  expect(await result.text()).toBe("decoded-image");
});

test("rejects oversized declared images and cancels oversized decoded streams", async () => {
  fixtures.push({
    headers: {
      "content-type": "image/png",
      "content-length": String(33 * 1024 * 1024),
    },
  });
  expect((await GET(request("https://images.example.com/a"))).status).toBe(413);
  fixtures.push({
    body: gzipSync(Buffer.alloc(33 * 1024 * 1024)),
    headers: {
      "content-type": "image/png",
      "content-encoding": "gzip",
    },
  });
  const response = await GET(request("https://images.example.com/b"));
  await expect(response.arrayBuffer()).rejects.toThrow("Image exceeds");
});

test("aborts a stalled response after the total deadline", async () => {
  jest.useFakeTimers();
  const stream = new PassThrough();
  fixtures.push({ stream });
  const promise = fetchPublicImage("https://images.example.com/a");
  await jest.advanceTimersByTimeAsync(0);
  const response = await promise;
  const read = response.text().catch((error) => error);
  await jest.advanceTimersByTimeAsync(60000);
  expect(await read).toBeInstanceOf(Error);
});

test("returns a timeout when a connection stalls before headers", async () => {
  fixtures.push({ pending: true });
  const pending = GET(request("https://images.example.com/a"));
  await Promise.resolve();
  const client = transport.mock.results[0].value as any;
  client.setTimeout.mock.calls[0][1]();
  expect((await pending).status).toBe(504);
});

test("cancelling the client body destroys the upstream download", async () => {
  const stream = new PassThrough();
  fixtures.push({ stream });
  const result = await GET(request("https://images.example.com/a"));
  await result.body!.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  expect(stream.destroyed).toBe(true);
});

test.each(["image/jpeg", "image/webp", "image/gif", "image/avif"])(
  "supports public CDN %s images without a hostname allowlist",
  async (type) => {
    fixtures.push({ headers: { "content-type": type } });
    const result = await GET(request("https://custom-cdn.example.com/a"));
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe(type);
    await result.text();
  },
);
