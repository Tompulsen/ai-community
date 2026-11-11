// Adapted from QXChat / NextChat; MIT license, see studio/LICENSE and UPSTREAM.md.
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { loadBuffer } from "cheerio";
import { Agent, fetch as fetchPage } from "undici";
import { publicAddress as isPublicPageAddress } from "../../utils/public-image-fetch";
export { publicAddress as isPublicPageAddress } from "../../utils/public-image-fetch";
type ResolveHostname = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;
import type {
  WebPageContent,
  WebSearchResult,
} from "../../utils/web-search-context";

export const PAGE_MAX_BYTES = 1_000_000;
export const PAGE_MAX_CHARS = 20_000;
const PAGE_TIMEOUT_MS = 7_000;
const MAX_ACTIVE_READS = 4;
let activeReads = 0;

export async function resolvePublicPageUrl(
  value: string,
  resolve: ResolveHostname = (host) =>
    lookup(host, { all: true, verbatim: true }),
) {
  if (value.length > 2048) throw new Error("不支持超过 2048 字符的网页地址");
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    /(^|\.)(localhost|local|internal|home|lan)\.?$/i.test(host)
  )
    throw new Error("仅允许读取公开网站的标准 HTTP/HTTPS 地址");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolve(host);
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicPageAddress(address))
  ) {
    throw new Error("不允许读取内网、回环或保留地址");
  }
  url.hash = "";
  return { url, host, addresses };
}

export function createPageDispatcher(
  target: Awaited<ReturnType<typeof resolvePublicPageUrl>>,
) {
  // Pin DNS at connection time as well as validating it, preventing DNS rebinding.
  const pinnedLookup: LookupFunction = (hostname, options, callback) => {
    if (hostname.replace(/^\[|\]$/g, "") !== target.host) {
      callback(new Error("Unexpected page hostname"), "", 4);
      return;
    }
    if ((options as { all?: boolean }).all) {
      (
        callback as unknown as (
          error: null,
          addresses: typeof target.addresses,
        ) => void
      )(null, target.addresses);
    } else {
      const first = target.addresses[0];
      callback(null, first.address, first.family);
    }
  };
  return new Agent({
    connect: { lookup: pinnedLookup, timeout: PAGE_TIMEOUT_MS },
    connections: 1,
  });
}

export function extractPageText(bytes: Buffer, contentType: string) {
  if (contentType.startsWith("text/plain")) {
    const text = new TextDecoder().decode(bytes).trim();
    if (!text) throw new Error("网页没有可读取的文本");
    return {
      text: text.slice(0, PAGE_MAX_CHARS),
      title: "",
      truncated: text.length > PAGE_MAX_CHARS,
    };
  }
  // Bound DOM construction work as well as download size on hostile HTML.
  let tags = 0;
  for (const byte of bytes) {
    if (byte === 60 && ++tags > 20_000)
      throw new Error("网页结构过于复杂，已停止正文解析");
  }
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1];
  const $ = loadBuffer(bytes, {
    encoding: {
      defaultEncoding: "utf-8",
      ...(charset ? { transportLayerEncodingLabel: charset } : {}),
    },
  });
  const title = $("title")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  if (
    /^(just a moment|access denied|attention required|verify you are human|登录|登录验证|安全验证)/i.test(
      title,
    ) ||
    $("input[type=password]").length
  ) {
    throw new Error("网页需要登录或安全验证，未读取到目标正文");
  }
  $(
    "script, style, noscript, template, svg, canvas, iframe, nav, body > footer, body > header, aside, form, button, [hidden], [aria-hidden=true]",
  ).remove();
  $("[style]").each((_, element) => {
    if (
      /(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
        $(element).attr("style") ?? "",
      )
    )
      $(element).remove();
  });
  const main = $("main, [role=main]");
  const body = main.length === 1 ? main : $("body");
  body.find("br").replaceWith("\n");
  body
    .find("p, div, section, h1, h2, h3, h4, li, tr, pre, blockquote")
    .append("\n");
  const text = body
    .text()
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 40)
    throw new Error("网页正文不足，可能需要浏览器动态加载或登录");
  return {
    title,
    text: text.slice(0, PAGE_MAX_CHARS),
    truncated: text.length > PAGE_MAX_CHARS,
  };
}

export async function readLimitedPageBody(
  response: Awaited<ReturnType<typeof fetchPage>>,
) {
  if (!response.body) throw new Error("网页返回空内容");
  const declared = Number(response.headers.get("content-length"));
  if (declared > PAGE_MAX_BYTES) {
    await response.body.cancel();
    throw new Error("网页超过安全读取大小，未读取正文");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PAGE_MAX_BYTES)
        throw new Error("网页解压后超过安全读取大小，未读取正文");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

type ReaderOptions = {
  signal?: AbortSignal;
  resolve?: ResolveHostname;
  fetcher?: typeof fetchPage;
};

export async function readWebPage(
  value: string,
  options: ReaderOptions = {},
): Promise<WebPageContent> {
  if (activeReads >= MAX_ACTIVE_READS)
    return {
      status: "skipped",
      reason: "网页读取繁忙，本次未读取正文，请稍后重试",
    };
  if (options.signal?.aborted)
    return { status: "failed", reason: "网页读取已停止" };
  activeReads++;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, PAGE_TIMEOUT_MS);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(new Error("网页读取超时或已停止")),
      { once: true },
    );
  });
  try {
    let current = value;
    for (let redirect = 0; redirect <= 3; redirect++) {
      const target = await Promise.race([
        resolvePublicPageUrl(current, options.resolve),
        aborted,
      ]);
      if (controller.signal.aborted) throw new Error("网页读取已停止");
      const dispatcher = createPageDispatcher(target);
      try {
        const response = await (options.fetcher ?? fetchPage)(target.url, {
          dispatcher,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "Clodesen-WebReader/1.0",
            Accept: "text/html, application/xhtml+xml, text/plain;q=0.8",
          },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location || redirect === 3)
            throw new Error("网页重定向过多或无效");
          current = new URL(location, target.url).href;
          continue;
        }
        const type = (response.headers.get("content-type") ?? "").toLowerCase();
        if (
          !response.ok ||
          !/^(text\/html|application\/xhtml\+xml|text\/plain)(;|$)/.test(type)
        ) {
          await response.body?.cancel();
          throw new Error(
            response.ok
              ? "该链接不是可读取的 HTML/纯文本网页"
              : "网页访问失败（HTTP " + response.status + "），未读取正文",
          );
        }
        const extracted = extractPageText(
          await readLimitedPageBody(response),
          type,
        );
        return {
          status: extracted.truncated ? "truncated" : "read",
          title: extracted.title,
          text: extracted.text,
          url: target.url.href,
          readAt: new Date().toISOString(),
          ...(extracted.truncated
            ? { reason: "正文超过 20000 字符，仅提供前段，不能视为完整全文" }
            : {}),
        };
      } finally {
        await dispatcher.destroy();
      }
    }
    throw new Error("网页重定向过多");
  } catch (error) {
    return {
      status: "failed",
      reason: controller.signal.aborted
        ? "网页读取超时或已停止"
        : error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
        ? error.message
        : "网页无法访问，未读取正文",
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    activeReads--;
  }
}

export async function enrichWebResults(
  results: WebSearchResult[],
  signal?: AbortSignal,
  limit = 2,
) {
  return Promise.all(
    results.map(async (result, index): Promise<WebSearchResult> => {
      if (index >= limit)
        return {
          ...result,
          page: { status: "skipped", reason: "仅展示搜索摘要，未打开此网页" },
        };
      return { ...result, page: await readWebPage(result.url, { signal }) };
    }),
  );
}
