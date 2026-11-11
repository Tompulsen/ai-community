import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/api/auth";
import { assertSameOrigin, getAuthenticatedSession } from "./new-api/client";
import { isNewApiEnabled, NewApiError } from "./new-api/config";
import { checkRateLimit } from "@/app/utils/rate-limit";
import { searchWeb } from "./web-search/search";
import { enrichWebResults } from "./web-search/page-reader";
import {
  extractWebPageUrls,
  MAX_WEB_PAGE_URLS,
  type WebSearchResult,
} from "../utils/web-search-context";

export type SkillSource = { title: string; url: string; snippet: string };
export type SkillRetrievalKind = "papers" | "web";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_QUERY_LENGTH = 2000;
const MAX_SOURCES = 6;

export class SkillRetrievalError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = "SKILL_RETRIEVAL_FAILED",
  ) {
    super(message);
  }
}

export function skillRetrievalCapabilities() {
  return { web: true, papers: true };
}

export async function authorizeSkillRetrieval(req: NextRequest) {
  if (req.method !== "GET") assertSameOrigin(req);
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    throw new SkillRetrievalError("请求来源无效", 403, "SKILL_ORIGIN");
  }
  if (isNewApiEnabled()) {
    await getAuthenticatedSession(req, true);
  } else {
    const result = await auth(req);
    if (result.error) {
      throw new SkillRetrievalError(
        result.msg || "请先验证访问密码",
        401,
        "SKILL_AUTH_REQUIRED",
      );
    }
  }
  const ip =
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0] ||
    "unknown";
  if (!checkRateLimit(ip).allowed) {
    throw new SkillRetrievalError(
      "检索请求过于频繁，请稍后重试",
      429,
      "SKILL_RATE_LIMIT",
    );
  }
}

export function skillJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function skillErrorResponse(error: unknown) {
  if (error instanceof SkillRetrievalError || error instanceof NewApiError) {
    return skillJson(
      { error: true, message: error.message, code: error.code },
      error.status,
    );
  }
  return skillJson(
    {
      error: true,
      message: "检索服务暂时不可用，请稍后重试",
      code: "SKILL_RETRIEVAL_FAILED",
    },
    502,
  );
}

async function boundedJson(
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
  maxBytes: number,
) {
  if (Number(contentLength) > maxBytes) {
    await body?.cancel();
    throw new SkillRetrievalError(
      "检索数据超出大小限制",
      413,
      "SKILL_SIZE_LIMIT",
    );
  }
  if (!body) throw new SkillRetrievalError("检索服务返回空数据");
  const reader = body.getReader();
  let bytes = 0;
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new SkillRetrievalError(
          "检索数据超出大小限制",
          413,
          "SKILL_SIZE_LIMIT",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof SkillRetrievalError) throw error;
    throw new SkillRetrievalError("检索服务返回了无法识别的数据");
  } finally {
    reader.releaseLock();
  }
}

export async function readSkillRetrievalInput(req: NextRequest): Promise<{
  kind: SkillRetrievalKind;
  query: string;
  mode?: "quick" | "deep";
}> {
  let input: unknown;
  try {
    input = await boundedJson(
      req.body,
      req.headers.get("content-length"),
      12000,
    );
  } catch (error) {
    if (error instanceof SkillRetrievalError && error.status === 413)
      throw error;
    throw new SkillRetrievalError("检索请求格式无效", 400, "SKILL_INPUT");
  }
  const value = input as {
    kind?: unknown;
    query?: unknown;
    mode?: unknown;
  } | null;
  if (
    !value ||
    (value.kind !== "web" && value.kind !== "papers") ||
    typeof value.query !== "string" ||
    !value.query.trim() ||
    value.query.length > MAX_QUERY_LENGTH ||
    (value.mode !== undefined &&
      value.mode !== "quick" &&
      value.mode !== "deep")
  ) {
    throw new SkillRetrievalError(
      `请选择检索类型，并输入 1–${MAX_QUERY_LENGTH} 字符的查询`,
      400,
      "SKILL_INPUT",
    );
  }
  return { kind: value.kind, query: value.query.trim(), mode: value.mode };
}

function plainText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength)
    : "";
}

function sourceUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function paperSources(data: any): SkillSource[] {
  if (!Array.isArray(data?.message?.items)) {
    throw new SkillRetrievalError("论文检索服务返回的数据格式无效");
  }
  return data.message.items.slice(0, MAX_SOURCES).flatMap((item: any) => {
    const title = plainText(item?.title?.[0], 300);
    const doi = typeof item?.DOI === "string" ? item.DOI : "";
    const url = sourceUrl(
      doi ? `https://doi.org/${encodeURI(doi)}` : item?.URL,
    );
    if (!title || !url) return [];
    const authors = Array.isArray(item.author)
      ? item.author
          .slice(0, 5)
          .map((author: any) =>
            [plainText(author?.given, 60), plainText(author?.family, 60)]
              .filter(Boolean)
              .join(" "),
          )
          .filter(Boolean)
          .join(", ")
      : "";
    const year = item?.published?.["date-parts"]?.[0]?.[0];
    const snippet = [
      authors,
      Number.isInteger(year) && year > 0 && year < 10000 ? String(year) : "",
      plainText(item?.["container-title"]?.[0], 160),
      doi ? `DOI: ${plainText(doi, 200)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return [{ title, url, snippet }];
  });
}

export async function retrieveSkillSources(
  kind: SkillRetrievalKind,
  query: string,
  signal: AbortSignal,
  _req?: NextRequest,
  mode?: "quick" | "deep",
) {
  if (kind === "web") {
    return retrieveWebSources(query, signal, mode);
  }
  const url = new URL("https://api.crossref.org/works");
  const headers = new Headers({ Accept: "application/json" });
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", String(MAX_SOURCES));
  url.searchParams.set(
    "select",
    "title,DOI,URL,author,published,container-title",
  );
  headers.set(
    "User-Agent",
    "OctopusChat/1.0 (https://github.com/qzq00767/octopus_chat)",
  );
  const contact = process.env.SKILLS_CROSSREF_MAILTO?.trim();
  if (contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    url.searchParams.set("mailto", contact);
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(cancel, 12000);
  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SkillRetrievalError(
        response.status === 429
          ? "检索服务繁忙，请稍后重试"
          : "检索服务请求失败，请稍后重试",
        response.status === 429 ? 429 : 502,
      );
    }
    const data = await boundedJson(
      response.body,
      response.headers.get("content-length"),
      MAX_RESPONSE_BYTES,
    );
    return {
      kind,
      provider: "Crossref",
      coverage: "bibliographic-metadata",
      sources: paperSources(data),
    };
  } catch (error) {
    if (signal.aborted)
      throw new SkillRetrievalError("检索已取消", 499, "SKILL_ABORTED");
    if (controller.signal.aborted)
      throw new SkillRetrievalError(
        "检索超时，请稍后重试",
        504,
        "SKILL_TIMEOUT",
      );
    if (error instanceof SkillRetrievalError) throw error;
    throw new SkillRetrievalError("无法连接检索服务，请稍后重试");
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}

async function retrieveWebSources(
  query: string,
  signal: AbortSignal,
  mode?: "quick" | "deep",
) {
  try {
    signal.throwIfAborted();
    const urls = extractWebPageUrls(query);
    if (urls.length > MAX_WEB_PAGE_URLS) {
      throw new SkillRetrievalError(
        "每次最多读取 3 个网页链接，请分批发送",
        400,
        "SKILL_INPUT",
      );
    }
    const search = urls.length
      ? {
          results: urls.map(
            (url): WebSearchResult => ({
              title: new URL(url).hostname,
              url,
              snippet: "",
              source: "webpage",
            }),
          ),
          searchedAt: new Date().toISOString(),
          cached: false,
        }
      : await searchWeb(query, fetch, signal);
    signal.throwIfAborted();
    if (!search.results.length) {
      throw new SkillRetrievalError(
        "未找到相关网页资料，请调整关键词后重试",
        502,
        "SKILL_WEB_NO_RESULTS",
      );
    }
    const sources =
      mode === "deep" || urls.length
        ? await enrichWebResults(
            search.results,
            signal,
            urls.length ? MAX_WEB_PAGE_URLS : 2,
          )
        : search.results;
    signal.throwIfAborted();
    if (urls.length && !sources.some((source) => source.page?.text)) {
      throw new SkillRetrievalError(
        "网页正文未能读取，可能需要登录、动态加载或地址不受支持",
        502,
        "SKILL_WEB_NO_CONTENT",
      );
    }
    return {
      kind: "web" as const,
      provider: urls.length ? "Web" : "DuckDuckGo / Bing",
      coverage: sources.some((source) => source.page?.text)
        ? "webpage-content"
        : "search-snippets",
      query,
      searchedAt: search.searchedAt,
      cached: search.cached,
      sources,
    };
  } catch (error) {
    if (signal.aborted)
      throw new SkillRetrievalError("检索已取消", 499, "SKILL_ABORTED");
    if (error instanceof SkillRetrievalError) throw error;
    throw new SkillRetrievalError(
      "联网搜索暂时不可用，请稍后重试",
      502,
      "SKILL_WEB_UNAVAILABLE",
    );
  }
}
