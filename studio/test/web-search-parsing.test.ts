import {
  filterAndRankSearchResults,
  parseBingRss,
  parseDuckDuckGoHtml,
  selectSearchResults,
} from "../app/lib/web-search/search";
describe("QX search parsing and relevance", () => {
  const result = (
    title: string,
    url = "https://example.com/article",
    snippet = "",
  ) => ({ title, url, snippet, source: "bing" as const });
  it("requires the named subject, not just the word model", () => {
    expect(
      filterAndRankSearchResults("DeepSeek 最新模型", [
        result(
          "无关模型发布",
          "https://example.com/other",
          "另一家公司公布模型更新",
        ),
        result("DeepSeek 新模型", "https://example.com/deepseek"),
      ]),
    ).toEqual([result("DeepSeek 新模型", "https://example.com/deepseek")]);
  });

  it.each([
    "今天 DeepSeek 有什么最新消息",
    "What are the latest DeepSeek models today",
  ])("ignores conversational timing words in %s", (query) => {
    expect(
      filterAndRankSearchResults(query, [
        result("DeepSeek release", "https://example.com/news/deepseek"),
      ]),
    ).toHaveLength(1);
  });

  it("does not match short keywords inside unrelated English words or query parameters", () => {
    expect(
      filterAndRankSearchResults("AI", [
        result("Chair repair", "https://example.com/?q=AI"),
      ]),
    ).toEqual([]);
    expect(
      filterAndRankSearchResults("AI", [result("AI research")]),
    ).toHaveLength(1);
  });

  it("does not treat product landing pages as latest news", () => {
    const candidates = [
      result("DeepSeek", "https://deepseek.com/en/index.html"),
      result("DeepSeek", "https://platform.deepseek.com/usage"),
      result("DeepSeek App", "https://download.deepseek.com/"),
      result(
        "DeepSeek model release",
        "https://api-docs.deepseek.com/news/release",
      ),
    ];
    expect(
      filterAndRankSearchResults("DeepSeek 最新模型消息", candidates),
    ).toEqual([candidates[3]]);
    expect(
      filterAndRankSearchResults("DeepSeek 官网", candidates.slice(0, 1)),
    ).toHaveLength(1);
    expect(
      filterAndRankSearchResults("DeepSeek", candidates.slice(0, 1)),
    ).toHaveLength(1);
  });

  it("keeps Chinese location and subject matches", () => {
    const results = filterAndRankSearchResults("北京天气", [
      result("上海天气", "https://example.com/shanghai"),
      result("北京天气预报", "https://example.com/beijing"),
    ]);
    expect(results.map((item) => item.title)).toEqual(["北京天气预报"]);
  });

  it("filters engine search pages without dropping news and product subdomains", () => {
    const results = filterAndRankSearchResults("DeepSeek", [
      result("DeepSeek", "https://www.google.com/search?q=deepseek"),
      result("DeepSeek", "https://www.baidu.com/s?wd=deepseek"),
      result("DeepSeek", "https://news.yahoo.com/"),
      result("DeepSeek", "https://cloud.google.com/"),
    ]);
    expect(results.map((item) => new URL(item.url).hostname)).toEqual([
      "news.yahoo.com",
      "cloud.google.com",
    ]);
  });

  it("deduplicates tracking URLs but preserves case-sensitive page paths", () => {
    const results = filterAndRankSearchResults("DeepSeek", [
      result("DeepSeek", "https://example.com/A?utm_source=test#top"),
      result("DeepSeek", "https://example.com/A"),
      result("DeepSeek", "https://example.com/a"),
    ]);
    expect(results.map((item) => item.url)).toEqual([
      "https://example.com/A",
      "https://example.com/a",
    ]);
  });

  it.each([parseDuckDuckGoHtml, parseBingRss])(
    "filters before applying the six-result output limit",
    (parse) => {
      const items = Array.from({ length: 10 }, (_, index) => ({
        title: index < 6 ? "Unrelated" : "DeepSeek news",
        url: `https://example.com/${index}`,
      }));
      const body =
        parse === parseDuckDuckGoHtml
          ? items
              .map(
                (item) =>
                  `<a class="result__a" href="${item.url}">${item.title}</a>`,
              )
              .join("")
          : `<rss>${items
              .map(
                (item) =>
                  `<item><title>${item.title}</title><link>${item.url}</link></item>`,
              )
              .join("")}</rss>`;
      expect(parse(body)).toHaveLength(10);
      expect(filterAndRankSearchResults("DeepSeek", parse(body))).toHaveLength(
        4,
      );
    },
  );

  it("tolerates invalid entities and does not read data-href as href", () => {
    const parsed = parseDuckDuckGoHtml(
      `<a class="result__a" data-href="https://wrong.example" href="https://example.com">DeepSeek &#999999999;</a>`,
    );
    expect(parsed).toEqual([
      expect.objectContaining({
        url: "https://example.com/",
        title: "DeepSeek &#999999999;",
      }),
    ]);
  });

  it("rejects unsafe results without failing the entire search", () => {
    expect(
      filterAndRankSearchResults("DeepSeek", [
        result("DeepSeek", "javascript:alert(1)"),
        result("DeepSeek", "https://user:password@example.com"),
        result("DeepSeek", "broken"),
        result("DeepSeek", "https://example.com/"),
      ]),
    ).toHaveLength(1);
  });

  it("filters search-engine landing pages and unrelated results", () => {
    const results = filterAndRankSearchResults("DeepSeek 最新模型", [
      {
        title: "Google",
        url: "https://www.google.com/",
        snippet: "Search the web",
        source: "bing",
      },
      {
        title: "Yahoo",
        url: "https://www.yahoo.com/",
        snippet: "News and search",
        source: "bing",
      },
      {
        title: "Completely unrelated page",
        url: "https://unrelated.example/",
        snippet: "Nothing useful here",
        source: "bing",
      },
      {
        title: "DeepSeek 发布最新模型",
        url: "https://example.com/deepseek-model",
        snippet: "DeepSeek 公布了模型更新信息。",
        source: "duckduckgo",
      },
    ]);

    expect(results).toEqual([
      expect.objectContaining({ title: "DeepSeek 发布最新模型" }),
    ]);
  });

  it("keeps quality primary results first and only supplements an insufficient set", () => {
    const primary = [
      {
        title: "DeepSeek 官方模型更新",
        url: "https://deepseek.com/news",
        snippet: "最新模型信息",
        source: "duckduckgo" as const,
      },
    ];
    const fallback = [
      {
        title: "DeepSeek 新模型报道",
        url: "https://news.example/deepseek",
        snippet: "模型发布详情",
        source: "bing" as const,
      },
      {
        title: "Bing",
        url: "https://www.bing.com/",
        snippet: "Search",
        source: "bing" as const,
      },
    ];

    expect(selectSearchResults("DeepSeek 最新模型", primary, fallback)).toEqual(
      [primary[0], fallback[0]],
    );
  });

  it("parses DuckDuckGo HTML results and unwraps redirect links", () => {
    const html = `
      <div class="result results_links">
        <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews%3Fa%3D1&amp;rut=x">最新 &amp; 新闻</a></h2>
        <a class="result__snippet">这是 <b>最新</b> 的网页摘要。</a>
      </div>
      <div class="result results_links">
        <a href="https://second.example/path" class="result__a">第二条</a>
        <div class="result__snippet">第二条摘要</div>
      </div>`;

    expect(parseDuckDuckGoHtml(html)).toEqual([
      {
        title: "最新 & 新闻",
        url: "https://example.com/news?a=1",
        snippet: "这是 最新 的网页摘要。",
        source: "duckduckgo",
      },
      {
        title: "第二条",
        url: "https://second.example/path",
        snippet: "第二条摘要",
        source: "duckduckgo",
      },
    ]);
  });

  it("parses Bing RSS and rejects non-http result URLs", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title><![CDATA[搜索结果一]]></title><link>https://example.cn/a</link><description><![CDATA[<b>摘要</b> 内容]]></description></item>
      <item><title>危险链接</title><link>javascript:alert(1)</link><description>忽略</description></item>
    </channel></rss>`;

    expect(parseBingRss(xml)).toEqual([
      {
        title: "搜索结果一",
        url: "https://example.cn/a",
        snippet: "摘要 内容",
        source: "bing",
      },
    ]);
  });
});
