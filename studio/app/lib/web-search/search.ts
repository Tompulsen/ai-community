// Adapted from QXChat / NextChat; MIT license, see studio/LICENSE and UPSTREAM.md.
import {
  normalizeWebSearchQuery,
  type WebSearchResult,
  type WebSearchSource,
} from "../../utils/web-search-context";

const RESULT_LIMIT = 6;
const CANDIDATE_LIMIT = 30;
const FETCH_TIMEOUT_MS = 5_000;
const PRIMARY_PREFERENCE_MS = 800;
const MAX_RESPONSE_BYTES = 1_500_000;
const CACHE_TTL_MS = 3 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 300;
const MIN_PRIMARY_RESULTS = 3;

const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "how",
  "is",
  "latest",
  "model",
  "models",
  "news",
  "of",
  "please",
  "search",
  "the",
  "to",
  "what",
  "update",
  "updates",
  "today",
  "recent",
  "recently",
  "current",
  "currently",
  "now",
  "about",
  "tell",
  "me",
  "can",
  "you",
  "which",
  "when",
  "who",
  "are",
  "in",
  "on",
  "with",
  "new",
  "has",
  "have",
]);
const CHINESE_STOP_TERMS = new Set([
  "一下",
  "为何",
  "什么",
  "关于",
  "内容",
  "帮我",
  "怎么",
  "搜索",
  "新消",
  "最新",
  "查询",
  "消息",
  "现在",
  "相关",
  "给我",
  "联网",
  "资料",
  "模型",
  "新闻",
  "更新",
  "的",
  "了",
  "吗",
  "是",
  "有哪些",
  "有什么",
  "官网",
  "首页",
  "官方",
  "今天",
  "昨天",
  "近日",
  "最近",
  "当前",
  "目前",
  "最新消息",
  "最新新闻",
]);
const wordSegmenter = new Intl.Segmenter("zh", { granularity: "word" });

type CachedSearch = {
  expiresAt: number;
  promise: Promise<{ results: WebSearchResult[]; searchedAt: string }>;
};

const searchCache = new Map<string, CachedSearch>();

function decodeHtml(value: string) {
  return value.replace(
    /&(#x?[0-9a-f]+|amp|quot|apos|lt|gt|nbsp);/gi,
    (entity, code: string) => {
      const normalized = code.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "nbsp") return " ";
      const numeric = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : entity;
    },
  );
}

function plainText(value: string, maxLength: number) {
  return decodeHtml(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function attribute(attributes: string, name: string) {
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return decodeHtml(match?.[1] ?? match?.[2] ?? "");
}

function safeResultUrl(value: string, depth = 0): string {
  try {
    if (depth > 3 || value.length > 2_000) return "";
    const raw = value.startsWith("//") ? `https:${value}` : value;
    const url = new URL(raw);
    if (
      (url.hostname === "duckduckgo.com" ||
        url.hostname.endsWith(".duckduckgo.com")) &&
      url.pathname === "/l/"
    ) {
      const destination = url.searchParams.get("uddg");
      return destination ? safeResultUrl(destination, depth + 1) : "";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|gclid|fbclid|msclkid)$/i.test(key))
        url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return "";
  }
}

function deduplicateResults(results: WebSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = safeResultUrl(result.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedMatchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
}

function queryTerms(query: string) {
  const normalized = normalizedMatchText(query);
  const terms = new Set<string>();

  for (const word of normalized.match(/[a-z0-9]+(?:[._+-][a-z0-9]+)*/g) ?? []) {
    if (word.length >= 2 && !ENGLISH_STOP_WORDS.has(word)) terms.add(word);
  }
  for (const run of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    for (const { segment, isWordLike } of wordSegmenter.segment(run)) {
      if (
        isWordLike &&
        segment.length >= 2 &&
        !CHINESE_STOP_TERMS.has(segment)
      ) {
        terms.add(segment);
      }
    }
  }

  return [...terms];
}

function isSearchEngineLandingPage(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname
      .toLocaleLowerCase()
      .replace(/^(www|cn|m|html|lite|search)\./, "");
    const isSearchEngine =
      /^google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(hostname) ||
      /^yahoo\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(hostname) ||
      /^yandex\.(com|ru|[a-z]{2})$/.test(hostname) ||
      ["baidu.com", "bing.com", "duckduckgo.com", "sogou.com", "so.com"].some(
        (domain) => hostname === domain,
      );
    return (
      isSearchEngine &&
      /^\/(?:search|s|html|lite|webhp|yandsearch|index\.(?:html?|php))?\/?$/i.test(
        url.pathname,
      )
    );
  } catch {
    return true;
  }
}

function relevanceScore(result: WebSearchResult, terms: string[]) {
  if (terms.length === 0) return 1;
  const title = normalizedMatchText(result.title);
  const snippet = normalizedMatchText(result.snippet);
  const parsedUrl = new URL(result.url);
  const url = normalizedMatchText(
    decodeURIComponentSafe(parsedUrl.hostname + parsedUrl.pathname),
  );
  const matches = (text: string, term: string) => {
    if (!/^[a-z0-9]/.test(term)) return text.includes(term);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
  };
  const matchedTerms = terms.filter(
    (term) =>
      matches(title, term) || matches(snippet, term) || matches(url, term),
  );
  const latinTerms = terms.filter((term) => /^[a-z]/.test(term));
  if (
    matchedTerms.length <
      Math.max(Math.min(2, terms.length), Math.ceil(terms.length / 2)) ||
    (latinTerms.length > 0 &&
      !latinTerms.some((term) => matchedTerms.includes(term)))
  )
    return 0;
  return terms.reduce((score, term) => {
    if (matches(title, term)) score += 4;
    if (matches(url, term)) score += 3;
    if (matches(snippet, term)) score += 1;
    return score;
  }, 0);
}

function isUnhelpfulNavigation(query: string, url: string) {
  if (
    !/(最新|消息|新闻|更新|发布|\b(?:latest|news|updates?|releases?)\b)/i.test(
      query,
    )
  )
    return false;
  if (/(官网|首页|登录|下载|\b(?:homepage|login|download)\b)/i.test(query))
    return false;
  const path = new URL(url).pathname;
  return /^\/(?:(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:index\.html?)?|(?:login|signin|sign-in|usage|download))\/?$/i.test(
    path,
  );
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function filterAndRankSearchResults(
  query: string,
  results: WebSearchResult[],
) {
  const terms = queryTerms(normalizeWebSearchQuery(query));
  const candidates = results.flatMap((result) => {
    const url = safeResultUrl(result.url);
    return url &&
      result.title.trim() &&
      !isSearchEngineLandingPage(url) &&
      !isUnhelpfulNavigation(query, url)
      ? [{ ...result, url }]
      : [];
  });
  return deduplicateResults(candidates)
    .map((result, index) => ({
      index,
      result,
      score: relevanceScore(result, terms),
    }))
    .filter(
      ({ result, score }) =>
        !isSearchEngineLandingPage(result.url) && score > 0,
    )
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ result }) => result)
    .slice(0, RESULT_LIMIT);
}

export function selectSearchResults(
  query: string,
  primary: WebSearchResult[],
  fallback: WebSearchResult[] = [],
) {
  const primaryResults = filterAndRankSearchResults(query, primary);
  if (primaryResults.length >= MIN_PRIMARY_RESULTS) {
    return primaryResults.slice(0, RESULT_LIMIT);
  }
  return deduplicateResults([
    ...primaryResults,
    ...filterAndRankSearchResults(query, fallback),
  ]).slice(0, RESULT_LIMIT);
}

export function parseDuckDuckGoHtml(html: string): WebSearchResult[] {
  const anchorElements = Array.from(
    html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi),
  ).map((match) => ({
    attributes: match[1],
    body: match[2],
    index: match.index ?? 0,
    className: attribute(match[1], "class"),
  }));
  const snippetDivs = Array.from(
    html.matchAll(
      /<div\b([^>]*\bclass\s*=\s*(?:"[^"]*\bresult__snippet\b[^"]*"|'[^']*\bresult__snippet\b[^']*')[^>]*)>([\s\S]*?)<\/div>/gi,
    ),
  ).map((match) => ({
    attributes: match[1],
    body: match[2],
    index: match.index ?? 0,
    className: attribute(match[1], "class"),
  }));
  const titles = anchorElements.filter((element) =>
    element.className.split(/\s+/).includes("result__a"),
  );
  const snippets = anchorElements
    .concat(snippetDivs)
    .filter((element) =>
      element.className.split(/\s+/).includes("result__snippet"),
    );

  const results = titles.flatMap((title, index): WebSearchResult[] => {
    const nextTitleIndex = titles[index + 1]?.index ?? Number.POSITIVE_INFINITY;
    const snippet = snippets.find(
      (candidate) =>
        candidate.index > title.index && candidate.index < nextTitleIndex,
    );
    const url = safeResultUrl(attribute(title.attributes, "href"));
    const titleText = plainText(title.body, 180);
    if (!url || !titleText) return [];
    return [
      {
        title: titleText,
        url,
        snippet: plainText(snippet?.body ?? "", 500),
        source: "duckduckgo",
      },
    ];
  });

  return deduplicateResults(results).slice(0, CANDIDATE_LIMIT);
}

function xmlTag(item: string, tag: string) {
  return (
    item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? ""
  );
}

export function parseBingRss(xml: string): WebSearchResult[] {
  const results = Array.from(
    xml.matchAll(/<item>([\s\S]*?)<\/item>/gi),
  ).flatMap((match): WebSearchResult[] => {
    const item = match[1];
    const title = plainText(xmlTag(item, "title"), 180);
    const url = safeResultUrl(plainText(xmlTag(item, "link"), 1_000));
    if (!title || !url) return [];
    return [
      {
        title,
        url,
        snippet: plainText(xmlTag(item, "description"), 500),
        source: "bing",
      },
    ];
  });
  return deduplicateResults(results).slice(0, CANDIDATE_LIMIT);
}

async function readLimitedText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Search response is too large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        throw new Error("Search response is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function fetchSearchSource(
  url: string,
  source: WebSearchSource,
  parser: (body: string) => WebSearchResult[],
  fetcher: typeof fetch,
  controller: AbortController,
) {
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      headers: {
        Accept:
          source === "bing"
            ? "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8"
            : "text/html,application/xhtml+xml;q=0.9",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (compatible; ClodesenWebSearch/1.0; +https://clodesen.com)",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`${source} returned ${response.status}`);
    }
    return parser(await readLimitedText(response));
  } finally {
    clearTimeout(timeout);
  }
}

async function querySearchSources(query: string, fetcher: typeof fetch) {
  const encodedQuery = encodeURIComponent(query);
  const controllers = [new AbortController(), new AbortController()];
  const settle = async (promise: Promise<WebSearchResult[]>) => {
    try {
      return {
        results: filterAndRankSearchResults(query, await promise),
        error: undefined,
      };
    } catch (error) {
      return { results: [] as WebSearchResult[], error };
    }
  };
  const primary = settle(
    fetchSearchSource(
      `https://html.duckduckgo.com/html/?kl=cn-zh&q=${encodedQuery}`,
      "duckduckgo",
      parseDuckDuckGoHtml,
      fetcher,
      controllers[0],
    ),
  );
  const fallback = settle(
    fetchSearchSource(
      `https://www.bing.com/search?format=rss&setlang=zh-hans&q=${encodedQuery}`,
      "bing",
      parseBingRss,
      fetcher,
      controllers[1],
    ),
  );
  let preferenceTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<WebSearchResult[]>((resolve, reject) => {
      let primaryOutcome: Awaited<typeof primary> | undefined;
      let fallbackOutcome: Awaited<typeof fallback> | undefined;
      let preferenceExpired = false;
      const choose = () => {
        if (
          primaryOutcome &&
          primaryOutcome.results.length >= MIN_PRIMARY_RESULTS
        ) {
          resolve(primaryOutcome.results);
        } else if (primaryOutcome && fallbackOutcome) {
          if (primaryOutcome.error && fallbackOutcome.error) {
            reject(
              new AggregateError(
                [primaryOutcome.error, fallbackOutcome.error],
                "Search providers unavailable",
              ),
            );
          } else {
            resolve(
              selectSearchResults(
                query,
                primaryOutcome.results,
                fallbackOutcome.results,
              ),
            );
          }
        } else if (
          preferenceExpired &&
          fallbackOutcome &&
          fallbackOutcome.results.length >= MIN_PRIMARY_RESULTS
        ) {
          resolve(fallbackOutcome.results);
        }
      };
      preferenceTimer = setTimeout(() => {
        preferenceExpired = true;
        choose();
      }, PRIMARY_PREFERENCE_MS);
      void primary.then((outcome) => {
        primaryOutcome = outcome;
        choose();
      });
      void fallback.then((outcome) => {
        fallbackOutcome = outcome;
        choose();
      });
    });
  } finally {
    clearTimeout(preferenceTimer);
    controllers.forEach((controller) => controller.abort());
  }
}

function pruneCache(now: number) {
  for (const [key, value] of searchCache) {
    if (value.expiresAt <= now) searchCache.delete(key);
  }
  while (searchCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = searchCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    searchCache.delete(oldestKey);
  }
}

function waitForSearch<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Search aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function searchWeb(
  query: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{
  results: WebSearchResult[];
  cached: boolean;
  searchedAt: string;
}> {
  signal?.throwIfAborted();
  const normalizedQuery = normalizeWebSearchQuery(query);
  if (!normalizedQuery) throw new Error("Search query is empty");
  const cacheKey = normalizedQuery.toLocaleLowerCase();
  const now = Date.now();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { ...(await waitForSearch(cached.promise, signal)), cached: true };
  }

  pruneCache(now);
  const promise = querySearchSources(normalizedQuery, fetcher).then(
    (results) => ({ results, searchedAt: new Date().toISOString() }),
  );
  const entry = { expiresAt: now + CACHE_TTL_MS, promise };
  searchCache.set(cacheKey, entry);
  void promise.then(
    (response) => {
      if (searchCache.get(cacheKey) !== entry) return;
      if (response.results.length) entry.expiresAt = Date.now() + CACHE_TTL_MS;
      else searchCache.delete(cacheKey);
    },
    () => {
      if (searchCache.get(cacheKey) === entry) searchCache.delete(cacheKey);
    },
  );
  return { ...(await waitForSearch(promise, signal)), cached: false };
}

export function clearWebSearchCacheForTests() {
  searchCache.clear();
}
