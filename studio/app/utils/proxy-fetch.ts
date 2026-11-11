/**
 * HTTPS 代理出口（HTTP CONNECT 隧道）
 * 当设置 PROXY_URL 环境变量时，通过代理转发请求
 * 用于 Docker/VPS 部署需要走代理出网的场景
 */
import https from "https";
import http from "http";
import tls from "tls";
import { isIP } from "net";
import { pipeline, Readable } from "stream";
import type { Duplex, Transform } from "stream";
import { URL } from "url";
import { createBrotliDecompress, createGunzip, createInflate } from "zlib";

/** 代理隧道超时（10 分钟，覆盖图片生成等慢接口） */
const PROXY_TIMEOUT_MS = 10 * 60 * 1000;
/** CONNECT 隧道建立超时 */
const CONNECT_TIMEOUT_MS = 30 * 1000;

const responseDecoders = new Map<string, () => Transform>([
  ["gzip", createGunzip],
  ["x-gzip", createGunzip],
  ["deflate", createInflate],
  ["br", createBrotliDecompress],
]);

// Older Node typings omit the byte strategy supported by the deployed runtime.
const readableToWeb = Readable.toWeb as (
  readable: Readable,
  options: {
    strategy: {
      highWaterMark: number;
      size: (chunk: Uint8Array) => number;
    };
  },
) => ReadableStream<Uint8Array>;

function getProxyUrl(): string | undefined {
  return (
    process.env.PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
  );
}

/**
 * 将 ReadableStream 读取为 Buffer（用于代理隧道不支持流式 body 的场景）
 */
async function streamToBuffer(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal | null,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  const onAbort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

/**
 * 带代理支持的 fetch。
 * - 无代理 → 原生 fetch
 * - 有代理 + ReadableStream body → 先缓冲为 Buffer 再走 CONNECT 隧道
 * - 有代理 + 普通 body → CONNECT 隧道
 *
 * 响应头到达即返回，响应体使用原生流传递背压和取消。
 * CONNECT 和整个上游请求均有超时，响应体结束后释放隧道。
 */
export async function proxyFetch(
  url: string,
  options: RequestInit,
): Promise<Response> {
  const proxyUrl = getProxyUrl();
  // 无代理 → 直接用原生 fetch
  if (!proxyUrl) {
    return fetch(url, options);
  }
  options.signal?.throwIfAborted();

  // 有代理 + body 是流 → 先缓冲为 Buffer，再走代理隧道
  if (options.body instanceof ReadableStream) {
    const buffered = await streamToBuffer(options.body, options.signal);
    options = { ...options, body: buffered };
  }
  options.signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const proxy = new URL(proxyUrl);
    const isHttps = parsedUrl.protocol === "https:";

    // 提取请求头
    const headers: Record<string, string> = {};
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((v, k) => {
          headers[k] = v;
        });
      } else if (Array.isArray(options.headers)) {
        options.headers.forEach(([k, v]) => {
          headers[k] = v;
        });
      } else {
        Object.assign(headers, options.headers);
      }
    }

    // 获取请求体（支持 string / ArrayBuffer / Uint8Array / Buffer）
    const bodyStr = typeof options.body === "string" ? options.body : undefined;
    const bodyBuf =
      options.body instanceof ArrayBuffer
        ? Buffer.from(options.body)
        : options.body instanceof Uint8Array
        ? Buffer.from(options.body)
        : undefined;

    // 重算 Content-Length
    if (bodyStr) {
      headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
    } else if (bodyBuf) {
      headers["Content-Length"] = bodyBuf.length.toString();
    }

    let finished = false;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let reqTimer: ReturnType<typeof setTimeout> | null = null;
    let connectReq: http.ClientRequest | undefined;
    let upstreamReq: http.ClientRequest | undefined;
    let upstreamRes: http.IncomingMessage | undefined;
    let responseStream: Readable | undefined;
    let decoders: Transform[] = [];
    let tunnel: Duplex | undefined;
    let agent: http.Agent | undefined;

    const cleanup = () => {
      if (connectTimer) clearTimeout(connectTimer);
      if (reqTimer) clearTimeout(reqTimer);
      connectTimer = null;
      reqTimer = null;
      options.signal?.removeEventListener("abort", onAbort);
    };
    const closeTransport = (error?: Error) => {
      responseStream?.destroy(error);
      for (const decoder of decoders) decoder.destroy(error);
      upstreamRes?.destroy(error);
      upstreamReq?.destroy(error);
      connectReq?.destroy(error);
      tunnel?.destroy(error);
      agent?.destroy();
    };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      closeTransport(error);
      reject(error);
    };
    const complete = () => {
      if (finished) return;
      finished = true;
      cleanup();
      closeTransport();
    };
    const onAbort = () => {
      const reason = options.signal?.reason;
      fail(
        reason instanceof Error
          ? reason
          : new DOMException("请求已取消", "AbortError"),
      );
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    // CONNECT 隧道建立阶段超时
    connectTimer = setTimeout(() => {
      fail(new Error("代理 CONNECT 隧道建立超时"));
    }, CONNECT_TIMEOUT_MS);

    try {
      connectReq = http.request({
        hostname: proxy.hostname,
        port: proxy.port || 80,
        method: "CONNECT",
        path: `${parsedUrl.hostname}:${parsedUrl.port || (isHttps ? 443 : 80)}`,
      });
      connectReq.on("error", fail);
      connectReq.on("connect", (response, socket, head) => {
        if (finished) {
          socket.destroy();
          return;
        }
        tunnel = socket;
        socket.on("error", fail);
        if (response.statusCode !== 200) {
          fail(new Error(`代理 CONNECT 请求失败 (${response.statusCode})`));
          return;
        }
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        reqTimer = setTimeout(() => {
          fail(new Error("代理请求上游响应超时"));
        }, PROXY_TIMEOUT_MS);

        try {
          if (head.length) socket.unshift(head);
          // Give the agent the established tunnel instead of opening a direct socket.
          agent = Object.assign(
            isHttps ? new https.Agent() : new http.Agent(),
            {
              createConnection: () => {
                if (!isHttps) return socket;
                const secure = tls.connect({
                  socket,
                  servername: isIP(parsedUrl.hostname)
                    ? undefined
                    : parsedUrl.hostname,
                });
                secure.on("error", fail);
                return secure;
              },
            },
          );
          const transport = isHttps ? https : http;
          upstreamReq = transport.request(
            {
              hostname: parsedUrl.hostname,
              port: parsedUrl.port || (isHttps ? 443 : 80),
              path: parsedUrl.pathname + parsedUrl.search,
              method: options.method || "GET",
              headers,
              agent,
            },
            (res) => {
              upstreamRes = res;
              res.on("error", fail);
              res.once("aborted", () => fail(new Error("代理上游响应中断")));
              res.once("close", () => {
                if (!finished && !res.complete)
                  fail(new Error("代理上游响应在完成前关闭"));
              });
              try {
                const respHeaders = new Headers();
                Object.entries(res.headers).forEach(([key, value]) => {
                  if (value)
                    respHeaders.set(
                      key,
                      Array.isArray(value) ? value.join(", ") : value,
                    );
                });
                const status = res.statusCode || 500;
                const noBody =
                  options.method?.toUpperCase() === "HEAD" ||
                  [204, 205, 304].includes(status);
                if (!noBody) {
                  const factories = (respHeaders.get("content-encoding") ?? "")
                    .toLowerCase()
                    .split(",")
                    .map((encoding) => responseDecoders.get(encoding.trim()));
                  if (factories.every((factory) => factory)) {
                    decoders = factories.reverse().map((factory) => factory!());
                    respHeaders.delete("content-encoding");
                    respHeaders.delete("content-length");
                  }
                }
                responseStream = decoders.at(-1) ?? res;
                for (const decoder of decoders) decoder.on("error", fail);
                // Raw input can end while a decoder still has buffered output.
                responseStream.once("end", complete);
                responseStream.once("close", () => {
                  if (!finished) fail(new Error("代理响应体在完成前关闭"));
                });
                const body = noBody
                  ? null
                  : readableToWeb(responseStream, {
                      strategy: {
                        highWaterMark: responseStream.readableHighWaterMark,
                        size: (chunk) => chunk.byteLength,
                      },
                    });
                const result = new Response(body, {
                  status,
                  statusText: res.statusMessage || "Error",
                  headers: respHeaders,
                });
                if (decoders.length) {
                  pipeline(
                    [res, ...decoders],
                    (error: NodeJS.ErrnoException | null) => {
                      if (error) fail(error);
                    },
                  );
                }
                if (noBody) res.resume();
                resolve(result);
              } catch (error) {
                fail(error as Error);
              }
            },
          );
          upstreamReq.on("error", fail);
          if (bodyStr) upstreamReq.write(bodyStr);
          else if (bodyBuf) upstreamReq.write(bodyBuf);
          upstreamReq.end();
        } catch (error) {
          fail(error as Error);
        }
      });
      connectReq.end();
    } catch (error) {
      fail(error as Error);
    }
  });
}
