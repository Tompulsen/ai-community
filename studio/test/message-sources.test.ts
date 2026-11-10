import {
  findMessageSource,
  getMessageSources,
} from "../app/utils/message-sources";
import type { ChatMessageTool } from "../app/store/chat";

function search(
  content: unknown,
  overrides: Partial<ChatMessageTool> = {},
): ChatMessageTool {
  return {
    id: "search",
    function: { name: "web_search", arguments: '{"query":"Octopus"}' },
    content: typeof content === "string" ? content : JSON.stringify(content),
    isError: false,
    ...overrides,
  };
}

test("numbers actual search sources once in canonical tool result order", () => {
  expect(
    getMessageSources({
      tools: [
        search({
          results: [
            {
              title: "Docs",
              url: "https://EXAMPLE.com:443/docs",
              snippet: "Actual excerpt",
            },
            { title: "Duplicate", link: "https://example.com/docs" },
            { title: "Guide", href: "https://example.com/guide?lang=zh#intro" },
          ],
        }),
        search({
          sources: [{ title: "Docs again", url: "https://example.com/docs" }],
        }),
      ],
    }),
  ).toEqual([
    {
      number: 1,
      title: "Docs",
      url: "https://example.com/docs",
      snippet: "Actual excerpt",
    },
    {
      number: 2,
      title: "Guide",
      url: "https://example.com/guide?lang=zh#intro",
    },
  ]);
});

test("reads real MCP structured and text content source envelopes", () => {
  const result = {
    results: [{ title: "Primary", url: "https://example.com" }],
  };
  expect(
    getMessageSources({ tools: [search({ structuredContent: result })] })[0]
      ?.url,
  ).toBe("https://example.com/");
  expect(
    getMessageSources({
      tools: [
        search({ content: [{ type: "text", text: JSON.stringify(result) }] }),
      ],
    })[0]?.title,
  ).toBe("Primary");
  expect(
    getMessageSources({
      tools: [
        search({
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
        }),
      ],
    })[0]?.title,
  ).toBe("Primary");
});

test("does not manufacture citations from errors, malformed JSON or unrelated tool output", () => {
  const result = {
    results: [{ title: "Not a source", url: "https://example.com" }],
  };
  expect(
    getMessageSources({
      tools: [
        search("{"),
        search("[1] means https://example.com"),
        search(result, { isError: true }),
        search(result, { function: { name: "calculator" } }),
      ],
    }),
  ).toEqual([]);
  expect(getMessageSources({})).toEqual([]);
});

test("rejects unsafe URLs and accepts separately supplied known sources", () => {
  expect(
    getMessageSources(
      {
        tools: [
          search({
            results: [
              { title: "Script", url: "javascript:alert(1)" },
              { title: "Embedded", url: "data:text/html,hi" },
              {
                title: "Credentials",
                url: "https://user:password@example.com",
              },
              { title: "Relative", url: "/docs" },
            ],
          }),
        ],
      },
      [{ title: "", url: "https://known.example/docs" }],
    ),
  ).toEqual([
    { number: 1, title: "known.example", url: "https://known.example/docs" },
  ]);
});

test("maps only an explicit matching URL and preserves query and fragment identity", () => {
  const sources = getMessageSources({}, [
    { title: "First", url: "https://example.com/docs" },
    { title: "Second", url: "https://example.com/docs?page=2#part" },
  ]);
  expect(
    findMessageSource(sources, "https://EXAMPLE.com:443/docs")?.number,
  ).toBe(1);
  expect(
    findMessageSource(sources, "https://example.com/docs?page=2#part")?.number,
  ).toBe(2);
  expect(
    findMessageSource(sources, "https://example.com/docs?page=2"),
  ).toBeUndefined();
  expect(findMessageSource(sources, "[1]")).toBeUndefined();
  expect(
    findMessageSource(sources, "https://other.example/docs"),
  ).toBeUndefined();
  expect(findMessageSource(sources, "javascript:alert(1)")).toBeUndefined();
});

test("bounds sources collected from many tools and long excerpts", () => {
  const tools = Array.from({ length: 5 }, (_, tool) =>
    search({
      results: Array.from({ length: 30 }, (_, row) => ({
        title: `Title ${tool} ${row}`,
        url: `https://example.com/${tool}/${row}`,
        snippet: "x".repeat(3000),
      })),
    }),
  );
  const sources = getMessageSources({ tools });
  expect(sources).toHaveLength(30);
  expect(sources.at(-1)?.number).toBe(30);
  expect(sources[0].snippet).toHaveLength(1200);
});
