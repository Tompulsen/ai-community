import {
  getConversationMessageMatches,
  getConversationSearchText,
  navigateConversationMatch,
  type ConversationSearchMessage,
} from "../app/utils/conversation-search";
import {
  getConversationSearchPlainText,
  searchConversation,
} from "../app/utils/conversation-search-parser";

const message = (
  id: string,
  content: ConversationSearchMessage["content"],
  extra: Partial<ConversationSearchMessage> = {},
): ConversationSearchMessage => ({
  id,
  role: "assistant",
  content,
  ...extra,
});

test("finds each literal occurrence in branch order with exact UTF16 offsets", () => {
  const messages = [
    message("one", "Hi octopus, OCTOPUS.", { role: "user" }),
    message("two", "章鱼聊天，章鱼助手"),
    message("three", "No match"),
  ];
  const matches = searchConversation(messages, "octopus");
  expect(matches).toEqual([
    { messageId: "one", messageIndex: 0, start: 3, end: 10 },
    { messageId: "one", messageIndex: 0, start: 12, end: 19 },
  ]);
  expect(searchConversation(messages, "章鱼")).toEqual([
    { messageId: "two", messageIndex: 1, start: 0, end: 2 },
    { messageId: "two", messageIndex: 1, start: 5, end: 7 },
  ]);
  expect(getConversationMessageMatches(matches, "one")).toEqual(matches);
  expect(getConversationMessageMatches(matches, "three")).toEqual([]);
});

test("search terms containing regex syntax stay literal and preserve Unicode positions", () => {
  const text = "😀 [a.\\*+] [A.\\*+] İ one";
  const plainText = "😀 [a.*+] [A.*+] İ one";
  const literal = message("literal", text);
  expect(getConversationSearchPlainText(literal)).toBe(plainText);
  expect(searchConversation([literal], "[a.*+]")).toEqual([
    { messageId: "literal", messageIndex: 0, start: 3, end: 9 },
    { messageId: "literal", messageIndex: 0, start: 10, end: 16 },
  ]);
  const matches = searchConversation([message("unicode", text)], "one");
  expect(matches).toHaveLength(1);
  expect(plainText.slice(matches[0].start, matches[0].end)).toBe("one");
  expect(
    searchConversation([message("slashes", "a\\b a\\b")], "a\\b"),
  ).toHaveLength(2);
});

test("matches rendered Markdown text without counting link destinations or image metadata", () => {
  const linked = message(
    "linked",
    "[needle](https://example.com/needle)\n\nneedle",
  );
  expect(getConversationSearchText(linked)).toBe(linked.content);
  expect(getConversationSearchPlainText(linked)).toBe("needle\n\nneedle");
  expect(searchConversation([linked], "needle")).toEqual([
    { messageId: "linked", messageIndex: 0, start: 0, end: 6 },
    { messageId: "linked", messageIndex: 0, start: 8, end: 14 },
  ]);
  expect(searchConversation([linked], "example.com")).toEqual([]);
  expect(
    searchConversation(
      [message("image", "![needle](https://example.com/needle)")],
      "needle",
    ),
  ).toEqual([]);
  expect(
    searchConversation(
      [
        message(
          "reference-image",
          "![needle][picture]\n\n[picture]: /needle.png",
        ),
      ],
      "needle",
    ),
  ).toEqual([]);
});

test("finds phrases across inline formatting and retains code text and literal brackets", () => {
  expect(searchConversation([message("bold", "a **b**")], "a b")).toEqual([
    { messageId: "bold", messageIndex: 0, start: 0, end: 3 },
  ]);
  expect(
    searchConversation(
      [message("code", "```js\nconst needle = 1;\n```")],
      "needle",
    ),
  ).toEqual([{ messageId: "code", messageIndex: 0, start: 6, end: 12 }]);
  expect(
    searchConversation([message("bracket", "Read [1] here.")], "[1]"),
  ).toEqual([{ messageId: "bracket", messageIndex: 0, start: 5, end: 8 }]);
});

test("retains raw HTML that the message renderer displays as code or escaped text", () => {
  const html = message("html", "<html><body>needle</body></html>");
  expect(getConversationSearchPlainText(html)).toBe(html.content);
  expect(searchConversation([html], "needle")).toEqual([
    { messageId: "html", messageIndex: 0, start: 12, end: 18 },
  ]);
});

test("extracts all multimodal text without searching image or file payloads", () => {
  const multimodal = message("media", [
    { type: "text", text: "First needle" },
    { type: "image_url", image_url: { url: "https://example.com/needle" } },
    { type: "text", text: "Second NEEDLE" },
    { type: "file", file: { filename: "needle.pdf", file_data: "needle" } },
  ]);
  expect(getConversationSearchText(multimodal)).toBe(
    "First needle\nSecond NEEDLE",
  );
  const matches = searchConversation([multimodal], "needle");
  expect(matches).toEqual([
    { messageId: "media", messageIndex: 0, start: 6, end: 12 },
    { messageId: "media", messageIndex: 0, start: 20, end: 26 },
  ]);
});

test("excludes context, synthetic MCP and preview messages while retaining actual branch indices", () => {
  const messages = [
    message("system", "needle", { role: "system" }),
    message("context", "needle", { isContext: true }),
    message("mcp", "needle", { isMcpResponse: true, role: "user" }),
    message("preview", "needle", { preview: true }),
    message("real", "needle"),
  ];
  expect(searchConversation(messages, "needle")).toEqual([
    { messageId: "real", messageIndex: 4, start: 0, end: 6 },
  ]);
});

test("empty and whitespace-only queries produce no results and matches do not overlap", () => {
  const messages = [message("one", "aaaa")];
  for (const query of ["", " ", "\n\t"])
    expect(searchConversation(messages, query)).toEqual([]);
  expect(searchConversation(messages, "missing")).toEqual([]);
  expect(searchConversation(messages, "aa").map(({ start }) => start)).toEqual([
    0, 2,
  ]);
});

test("navigation cycles in both directions and starts predictably without an active match", () => {
  expect(navigateConversationMatch(0, 0, 1)).toBe(-1);
  expect(navigateConversationMatch(-1, 3, 1)).toBe(0);
  expect(navigateConversationMatch(-1, 3, -1)).toBe(2);
  expect(navigateConversationMatch(2, 3, 1)).toBe(0);
  expect(navigateConversationMatch(0, 3, -1)).toBe(2);
  expect(navigateConversationMatch(0, 1, 1)).toBe(0);
  expect(navigateConversationMatch(9, 3, 1)).toBe(0);
});
