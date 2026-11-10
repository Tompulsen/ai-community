/** @jest-environment node */

import { jest } from "@jest/globals";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import type { Socket } from "node:net";
import {
  brotliCompressSync,
  constants,
  createBrotliCompress,
  createDeflate,
  createGzip,
  deflateSync,
  gzipSync,
} from "node:zlib";
import { proxyFetch } from "../app/utils/proxy-fetch";

const originalEnv = process.env;
const fixtures: Array<{ close: () => Promise<void> }> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(
  handler: http.RequestListener,
  options: {
    connectStatus?: number;
    holdConnect?: boolean;
    breakTls?: boolean;
  } = {},
) {
  const sockets = new Set<Socket>();
  const connected = deferred<void>();
  const tunnelClosed = deferred<void>();
  const upstream = http.createServer(handler);
  const proxy = http.createServer();
  const seen = { authority: "", requests: 0 };
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  };
  upstream.on("connection", track);
  proxy.on("connection", track);
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamPort = (upstream.address() as net.AddressInfo).port;
  proxy.on("connect", (request, socket, head) => {
    seen.requests++;
    seen.authority = request.url || "";
    socket.once("close", () => tunnelClosed.resolve());
    connected.resolve();
    if (options.holdConnect) {
      socket.once("end", () => socket.destroy());
      socket.resume();
      return;
    }
    if (options.connectStatus) {
      socket.end(`HTTP/1.1 ${options.connectStatus} Proxy Rejected\r\n\r\n`);
      return;
    }
    if (options.breakTls) {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.once("data", () => socket.end("invalid TLS response"));
      return;
    }
    const target = net.connect(
      { host: "127.0.0.1", port: upstreamPort },
      () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) target.write(head);
        socket.pipe(target);
        target.pipe(socket);
      },
    );
    track(target);
    socket.once("close", () => target.destroy());
    target.once("error", () => socket.destroy());
    target.once("close", () => socket.destroy());
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const proxyPort = (proxy.address() as net.AddressInfo).port;
  process.env.PROXY_URL = `http://127.0.0.1:${proxyPort}`;
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      [proxy, upstream].map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  };
  fixtures.push({ close });
  return {
    connected: connected.promise,
    tunnelClosed: tunnelClosed.promise,
    seen,
    // The proxy deliberately routes port 1 to the fixture server.
    url: "http://127.0.0.1:1/v1/chat/completions",
  };
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PROXY_URL: "",
    HTTPS_PROXY: "",
    https_proxy: "",
    HTTP_PROXY: "",
    http_proxy: "",
  };
});

afterEach(async () => {
  jest.useRealTimers();
  await Promise.all(fixtures.splice(0).map(({ close }) => close()));
  jest.restoreAllMocks();
  process.env = originalEnv;
});

test("without a proxy delegates the unchanged request to native fetch", async () => {
  const response = new Response("native");
  const native = jest.spyOn(globalThis, "fetch").mockResolvedValue(response);
  const request = jest.spyOn(http, "request");
  const options = {
    method: "POST",
    body: "payload",
    signal: new AbortController().signal,
  };
  expect(await proxyFetch("https://native.invalid", options)).toBe(response);
  expect(native).toHaveBeenCalledWith("https://native.invalid", options);
  expect(request).not.toHaveBeenCalled();
});

test("CONNECT returns headers immediately and delivers SSE bytes before upstream completion", async () => {
  let source!: http.ServerResponse;
  let receivedBody = "";
  const local = await fixture((request, response) => {
    source = response;
    request.on("data", (chunk) => (receivedBody += chunk));
    response.writeHead(201, "Created", {
      "Content-Type": "text/event-stream",
      "X-Stream-Probe": "preserved",
    });
    response.flushHeaders();
  });
  const response = await proxyFetch(local.url, {
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: '{"stream":true}',
  });
  expect(local.seen).toEqual({
    authority: "127.0.0.1:1",
    requests: 1,
  });
  expect(response.status).toBe(201);
  expect(response.statusText).toBe("Created");
  expect(response.headers.get("x-stream-probe")).toBe("preserved");
  expect(source.writableEnded).toBe(false);
  const reader = response.body!.getReader();
  const first = reader.read();
  source.write('data: {"delta":"first"}\n\n');
  expect(new TextDecoder().decode((await first).value)).toContain('"first"');
  expect(source.writableEnded).toBe(false);
  expect(receivedBody).toBe('{"stream":true}');
  source.end("data: [DONE]\n\n");
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    "[DONE]",
  );
  expect((await reader.read()).done).toBe(true);
  await local.tunnelClosed;
});

test.each([
  ["gzip", gzipSync],
  ["deflate", deflateSync],
  ["br", brotliCompressSync],
] as const)(
  "CONNECT decodes %s compressed JSON and removes encoded lengths",
  async (encoding, compress) => {
    const payload = { message: "compressed-payload".repeat(20_000) };
    const encoded = compress(Buffer.from(JSON.stringify(payload)));
    const local = await fixture((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Encoding": encoding,
        "Content-Length": encoded.length,
        "X-Probe": "preserved",
      });
      response.end(encoded);
    });
    const response = await proxyFetch(local.url, {
      headers: { "Accept-Encoding": "gzip, deflate, br" },
    });
    await expect(response.json()).resolves.toEqual(payload);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("x-probe")).toBe("preserved");
    await local.tunnelClosed;
  },
);

test.each([
  ["gzip", createGzip, constants.Z_SYNC_FLUSH],
  ["deflate", createDeflate, constants.Z_SYNC_FLUSH],
  ["br", createBrotliCompress, constants.BROTLI_OPERATION_FLUSH],
] as const)(
  "CONNECT streams %s decoded SSE before the upstream ends",
  async (encoding, createCompressor, flush) => {
    const compressor = createCompressor();
    let source!: http.ServerResponse;
    const local = await fixture((_request, response) => {
      source = response;
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Content-Encoding": encoding,
      });
      response.flushHeaders();
      compressor.pipe(response);
    });
    const response = await proxyFetch(local.url, {});
    const reader = response.body!.getReader();
    const first = reader.read();
    compressor.write('data: {"delta":"first"}\n\n');
    compressor.flush(flush);
    expect(new TextDecoder().decode((await first).value)).toContain('"first"');
    expect(source.writableEnded).toBe(false);
    compressor.end("data: [DONE]\n\n");
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "[DONE]",
    );
    expect((await reader.read()).done).toBe(true);
    await local.tunnelClosed;
  },
);

test("stacked content encodings are decoded in reverse application order", async () => {
  const payload = { message: "Stacked encodings" };
  const encoded = brotliCompressSync(
    gzipSync(Buffer.from(JSON.stringify(payload))),
  );
  const local = await fixture((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip, br",
      "Content-Length": encoded.length,
    });
    response.end(encoded);
  });
  const response = await proxyFetch(local.url, {});
  await expect(response.json()).resolves.toEqual(payload);
  expect(response.headers.get("content-encoding")).toBeNull();
  expect(response.headers.get("content-length")).toBeNull();
  await local.tunnelClosed;
});

test("a corrupt compressed response errors its body and releases the tunnel", async () => {
  const local = await fixture((_request, response) => {
    response.writeHead(200, { "Content-Encoding": "gzip" });
    response.end("not gzip data");
  });
  const response = await proxyFetch(local.url, {});
  await expect(response.text()).rejects.toThrow();
  await local.tunnelClosed;
});

test("client abort errors a compressed response and releases the tunnel", async () => {
  const local = await fixture((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Content-Encoding": "gzip",
    });
    response.flushHeaders();
  });
  const controller = new AbortController();
  const response = await proxyFetch(local.url, { signal: controller.signal });
  const pending = response.body!.getReader().read();
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  await local.tunnelClosed;
});

test("consumer cancellation destroys a compressed response and its tunnel", async () => {
  const local = await fixture((_request, response) => {
    response.writeHead(200, { "Content-Encoding": "gzip" });
    response.flushHeaders();
  });
  const response = await proxyFetch(local.url, {});
  await response.body!.cancel();
  await local.tunnelClosed;
});

test("an upstream reset errors a compressed response and releases the tunnel", async () => {
  let source!: http.ServerResponse;
  const local = await fixture((_request, response) => {
    source = response;
    response.writeHead(200, { "Content-Encoding": "gzip" });
    response.flushHeaders();
  });
  const response = await proxyFetch(local.url, {});
  const pending = response.body!.getReader().read();
  const rejected = expect(pending).rejects.toThrow();
  source.destroy();
  await rejected;
  await local.tunnelClosed;
});

test("a compressed body timeout errors the decoded stream and clears resources", async () => {
  const local = await fixture((_request, response) => {
    response.writeHead(200, { "Content-Encoding": "gzip" });
    response.flushHeaders();
  });
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  const response = await proxyFetch(local.url, {});
  const pending = response.body!.getReader().read();
  const rejected = expect(pending).rejects.toThrow("上游响应超时");
  await jest.advanceTimersByTimeAsync(600_000);
  await rejected;
  await local.tunnelClosed;
  expect(jest.getTimerCount()).toBe(0);
});

test.each([
  ["HEAD", 200],
  ["GET", 204],
  ["GET", 205],
  ["GET", 304],
])("%s status %s has no response body", async (method, status) => {
  const local = await fixture((_request, response) => {
    response.writeHead(status as number, { "X-Probe": "empty" });
    response.end();
  });
  const response = await proxyFetch(local.url, { method: method as string });
  expect(response.status).toBe(status);
  expect(response.headers.get("x-probe")).toBe("empty");
  expect(response.body).toBeNull();
  await local.tunnelClosed;
});

test("a rejected CONNECT response fails without opening an upstream request", async () => {
  const upstream = jest.fn<http.RequestListener>();
  const local = await fixture(upstream, { connectStatus: 407 });
  await expect(proxyFetch(local.url, {})).rejects.toThrow(
    "CONNECT 请求失败 (407)",
  );
  await local.tunnelClosed;
  expect(upstream).not.toHaveBeenCalled();
});

test("a pre-aborted request never opens CONNECT", async () => {
  process.env.PROXY_URL = "http://127.0.0.1:1";
  const request = jest.spyOn(http, "request");
  const controller = new AbortController();
  controller.abort();
  await expect(
    proxyFetch("https://upstream.invalid", { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(request).not.toHaveBeenCalled();
});

test("aborting while buffering a request body cancels its reader before CONNECT", async () => {
  process.env.PROXY_URL = "http://127.0.0.1:1";
  const request = jest.spyOn(http, "request");
  const cancel = jest.fn<() => void>();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const controller = new AbortController();
  const pending = proxyFetch("https://upstream.invalid", {
    method: "POST",
    body,
    signal: controller.signal,
  });
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
});

test("client abort during CONNECT destroys the socket and removes its listener", async () => {
  const local = await fixture(() => {}, { holdConnect: true });
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  const pending = proxyFetch(local.url, { signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await local.connected;
  controller.abort();
  await rejected;
  await local.tunnelClosed;
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

test("client abort after headers errors a pending body read and destroys the tunnel", async () => {
  const local = await fixture((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.flushHeaders();
  });
  const controller = new AbortController();
  const response = await proxyFetch(local.url, { signal: controller.signal });
  const pending = response.body!.getReader().read();
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  await local.tunnelClosed;
});

test("consumer cancellation closes the CONNECT tunnel", async () => {
  const local = await fixture((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.flushHeaders();
  });
  const response = await proxyFetch(local.url, {});
  await response.body!.cancel();
  await local.tunnelClosed;
});

test("an upstream reset errors the response body and closes the tunnel", async () => {
  let source!: http.ServerResponse;
  const local = await fixture((_request, response) => {
    source = response;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.flushHeaders();
  });
  const response = await proxyFetch(local.url, {});
  const pending = response.body!.getReader().read();
  const rejected = expect(pending).rejects.toThrow();
  source.destroy();
  await rejected;
  await local.tunnelClosed;
});

test("an HTTPS handshake failure releases the CONNECT tunnel", async () => {
  const local = await fixture(() => {}, { breakTls: true });
  await expect(
    proxyFetch(local.url.replace("http:", "https:"), {}),
  ).rejects.toThrow();
  await local.tunnelClosed;
});

test("CONNECT timeout closes its socket and clears its timer", async () => {
  const local = await fixture(() => {}, { holdConnect: true });
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  const pending = proxyFetch(local.url, {});
  const rejected = expect(pending).rejects.toThrow("CONNECT 隧道建立超时");
  await local.connected;
  await jest.advanceTimersByTimeAsync(30_000);
  await rejected;
  await local.tunnelClosed;
  expect(jest.getTimerCount()).toBe(0);
});

test("upstream header timeout rejects the request and clears resources", async () => {
  const reached = deferred<void>();
  const local = await fixture(() => reached.resolve());
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  const pending = proxyFetch(local.url, {});
  const rejected = expect(pending).rejects.toThrow("上游响应超时");
  await reached.promise;
  await jest.advanceTimersByTimeAsync(600_000);
  await rejected;
  await local.tunnelClosed;
  expect(jest.getTimerCount()).toBe(0);
});

test("upstream body timeout still errors the stream after headers have resolved", async () => {
  const local = await fixture((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.flushHeaders();
  });
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  const response = await proxyFetch(local.url, {});
  const pending = response.body!.getReader().read();
  const rejected = expect(pending).rejects.toThrow("上游响应超时");
  await jest.advanceTimersByTimeAsync(600_000);
  await rejected;
  await local.tunnelClosed;
  expect(jest.getTimerCount()).toBe(0);
});
