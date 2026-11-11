import {
  createMessageQuote,
  formatQuoteInput,
  readMessageQuote,
} from "../app/utils/message-quote";

const message = { id: "answer-1", role: "assistant" as const };

test("ignores empty and whitespace-only selections", () => {
  expect(createMessageQuote(message, "")).toBeUndefined();
  expect(createMessageQuote(message, " \n\t ")).toBeUndefined();
});

test("keeps the selected text and its source as a snapshot", () => {
  expect(createMessageQuote(message, " First step.\nNext step. ")).toEqual({
    messageId: "answer-1",
    role: "assistant",
    text: " First step.\nNext step. ",
  });
});

test("formats a multiline quote inside the new user request", () => {
  expect(
    formatQuoteInput("Explain this part.", {
      ...message,
      messageId: message.id,
      text: "First step.\r\n\r\nNext step.",
    }),
  ).toBe("引用内容：\n> First step.\n> \n> Next step.\n\nExplain this part.");
});

test("leaves an unquoted request unchanged", () => {
  expect(formatQuoteInput("Question")).toBe("Question");
});

test("rejects malformed persisted quote data", () => {
  for (const value of [
    null,
    "quote",
    { messageId: "a", role: "assistant", text: 42 },
    { messageId: "a", role: "assistant", text: " \n " },
    { messageId: "a", role: "unknown", text: "Text" },
    { role: "assistant", text: "Text" },
  ])
    expect(readMessageQuote(value)).toBeUndefined();
});

test("restores a quote snapshot without requiring its source to remain mounted", () => {
  const quote = {
    messageId: "archived-answer",
    role: "assistant" as const,
    text: "  Original indentation.\n",
  };
  expect(readMessageQuote(JSON.parse(JSON.stringify(quote)))).toEqual(quote);
});
