// Reused from qzq00767/octopus_chat 0eac2b4; MIT.
import { AccountRequest as NextRequest, AccountResponse as NextResponse } from "../native-account/http.ts";
import { assertSameOrigin, getAuthenticatedSession } from "../native-account/client.ts";
import { isNewApiEnabled, NewApiError } from "../native-account/config.ts";
import { relayHeaders, resolveWebSearchCredentials } from "../native-account/relay.ts";

export type SkillSource = { title: string; url: string; snippet: string };
export type SkillRetrievalKind = "papers" | "web";

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_QUERY_LENGTH = 2000;
const MAX_SOURCES = 6;

export class SkillRetrievalError extends Error {
  status: number;
  code: string;
  constructor(
    message: string,
    status = 502,
    code = "SKILL_RETRIEVAL_FAILED",
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function webSearchModel() {
  return process.env.SKILLS_WEB_SEARCH_MODEL?.trim() || "tavily-quick";
}

export function skillRetrievalCapabilities() {
  return {
    web:
      isNewApiEnabled() &&
      ["tavily-quick", "tavily-deep"].includes(webSearchModel()),
    papers: true,
  };
}

export async function authorizeSkillRetrieval(req: NextRequest) {
  if (req.method !== "GET") assertSameOrigin(req);
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    throw new SkillRetrievalError("请求来源无效", 403, "SKILL_ORIGIN");
  }
  if (isNewApiEnabled()) {
    await getAuthenticatedSession(req, true);
  } else {
    throw new SkillRetrievalError("请先登录章鱼账号", 401, "SKILL_AUTH_REQUIRED");
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

function webSources(data: any): SkillSource[] {
  if (!Array.isArray(data?.sources)) {
    throw new SkillRetrievalError("联网搜索服务返回的数据格式无效");
  }
  const seen = new Set<string>();
  const sources: SkillSource[] = [];
  for (const item of data.sources) {
    const url = sourceUrl(item?.url);
    const title = plainText(item?.title, 300);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    sources.push({ title, url, snippet: plainText(item?.snippet, 1000) });
    if (sources.length === MAX_SOURCES) break;
  }
  return sources;
}

export async function retrieveSkillSources(
  kind: SkillRetrievalKind,
  query: string,
  signal: AbortSignal,
  req?: NextRequest,
  mode?: "quick" | "deep",
) {
  if (kind === "web") {
    return retrieveBilledWebSources(
      mode === "deep"
        ? "tavily-deep"
        : mode === "quick"
        ? "tavily-quick"
        : webSearchModel(),
      query,
      signal,
      req,
    );
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

async function retrieveBilledWebSources(
  model: string,
  query: string,
  signal: AbortSignal,
  req?: NextRequest,
) {
  if (
    !isNewApiEnabled() ||
    !req ||
    !["tavily-quick", "tavily-deep"].includes(model)
  ) {
    throw new SkillRetrievalError(
      "联网搜索需要登录账号并配置 Tavily 搜索渠道，请联系管理员",
      503,
      "SKILL_WEB_UNAVAILABLE",
    );
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(cancel, 45000);
  try {
    if (controller.signal.aborted) throw new Error("aborted");
    const { baseUrl, apiKey } = await resolveWebSearchCredentials(req);
    if (controller.signal.aborted) throw new Error("aborted");
    const headers = relayHeaders(req, apiKey);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: query }],
        stream: false,
      }),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SkillRetrievalError(
        [402, 403].includes(response.status)
          ? "联网搜索被拒绝，请检查账户余额、密钥权限和搜索模型分组"
          : response.status === 429
          ? "联网搜索请求过于频繁，请稍后重试"
          : "联网搜索请求失败，请检查搜索渠道配置",
        [401, 402, 403, 429].includes(response.status) ? response.status : 502,
      );
    }
    const data = (await boundedJson(
      response.body,
      response.headers.get("content-length"),
      MAX_RESPONSE_BYTES,
    )) as { choices?: { message?: { content?: unknown } }[] };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("invalid response");
    const result = JSON.parse(content);
    return {
      kind: "web" as const,
      provider: "Tavily",
      coverage: "search-snippets",
      sources: webSources(result),
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
    if (error instanceof SkillRetrievalError || error instanceof NewApiError)
      throw error;
    throw new SkillRetrievalError("联网搜索返回异常，请联系管理员");
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}
