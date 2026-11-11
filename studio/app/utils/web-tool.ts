export type WebToolSource = { title: string; url: string; snippet?: string };

export function getWebToolInfo(tool: {
  function?: { name: string; arguments?: string };
  content?: string;
}) {
  const name = tool.function?.name ?? "";
  if (
    !/(?:search|browse|fetch.*(?:url|web)|crawl|visit.*(?:url|page)|web.*(?:read|open))/i.test(
      name,
    )
  ) {
    return null;
  }
  let query = "";
  try {
    const args = JSON.parse(tool.function?.arguments ?? "{}");
    query =
      [args.query, args.q, args.search_query, args.url].find(
        (value) => typeof value === "string",
      ) ?? "";
  } catch {}
  const sources: WebToolSource[] = [];
  const seen = new Set<string>();
  function visit(value: unknown, depth = 0) {
    if (
      depth > 5 ||
      sources.length >= 30 ||
      !value ||
      typeof value !== "object"
    )
      return;
    if (Array.isArray(value)) {
      value.slice(0, 50).forEach((item) => visit(item, depth + 1));
      return;
    }
    const row = value as Record<string, unknown>;
    const url = row.url ?? row.link ?? row.href;
    if (typeof url === "string") {
      try {
        const parsed = new URL(url);
        if (
          ["http:", "https:"].includes(parsed.protocol) &&
          !seen.has(parsed.href)
        ) {
          seen.add(parsed.href);
          sources.push({
            url: parsed.href,
            title: typeof row.title === "string" ? row.title : parsed.hostname,
            snippet: typeof row.snippet === "string" ? row.snippet : undefined,
          });
        }
      } catch {}
    }
    for (const key of [
      "results",
      "sources",
      "data",
      "items",
      "organic",
      "organic_results",
      "content",
    ]) {
      if (key in row) visit(row[key], depth + 1);
    }
  }
  try {
    visit(JSON.parse(tool.content ?? ""));
  } catch {}
  return { query, sources };
}
