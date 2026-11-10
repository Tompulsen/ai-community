import {
  extractMessageInteractions,
  formatOptionResponse,
  messageInteractionOptionsSchema,
  messageInteractionPrompt,
  readMessageInteractions,
  validateOptionSelection,
  type MessageInteractionOptions,
} from "../app/utils/message-interactions";

const messageId = "answer-1";
const options: MessageInteractionOptions = {
  id: "question-1",
  question: "Which scope?",
  selection: "multiple",
  options: [
    { id: "a", label: "Current conversation" },
    { id: "b", label: "All conversations" },
    { id: "c", label: "Export first", description: "Keep a copy." },
  ],
  minSelections: 1,
  maxSelections: 2,
};

function footer(value: unknown) {
  return "```chat-ui\n" + JSON.stringify(value) + "\n```";
}

function envelope(extra = {}) {
  return {
    version: 1,
    messageId,
    suggestions: ["Compare approaches", "Give an example"],
    options,
    ...extra,
  };
}

test("parses only a complete bound trailing footer and preserves answer whitespace", () => {
  const result = extractMessageInteractions(
    "  Answer.\n\n" + footer(envelope()) + "\n \n",
    messageId,
  );
  expect(result.content).toBe("  Answer.");
  expect(result.interactions).toEqual({
    suggestions: ["Compare approaches", "Give an example"],
    options,
  });
});

test("buffers every possible opening prefix during streaming and interruption", () => {
  const opening = "```chat-ui";
  for (let length = 1; length <= opening.length; length++) {
    const prefix = "Answer.\n\n" + opening.slice(0, length);
    expect(extractMessageInteractions(prefix, messageId, "stream")).toEqual({
      content: "Answer.",
    });
    expect(
      extractMessageInteractions(prefix, messageId, "interrupted"),
    ).toEqual({ content: "Answer." });
  }
});

test("buffers every payload and closing-fence prefix until final success", () => {
  const block = footer(envelope());
  const openingLength = "```chat-ui".length;
  for (let length = openingLength; length <= block.length; length++) {
    const partial = "Answer.\n\n" + block.slice(0, length);
    expect(extractMessageInteractions(partial, messageId, "stream")).toEqual({
      content: "Answer.",
    });
    expect(
      extractMessageInteractions(partial, messageId, "interrupted"),
    ).toEqual({ content: "Answer." });
  }
});

test("can finish an answer that contains only interaction metadata", () => {
  const result = extractMessageInteractions(footer(envelope()), messageId);
  expect(result.content).toBe("");
  expect(result.interactions?.options?.id).toBe(options.id);
});

test.each([
  "```javascript\nconst x = 1;\n```",
  "````markdown\n" + footer(envelope()) + "\n````",
  "~~~markdown\n" + footer(envelope()) + "\n~~~",
  "    " + footer(envelope()).replace(/\n/g, "\n    "),
  footer(envelope()) + "\nThis is an example.",
  "```chat-ui-example\n" + JSON.stringify(envelope()) + "\n```",
])(
  "leaves ordinary code examples and nontrailing blocks unchanged: %s",
  (text) => {
    expect(extractMessageInteractions(text, messageId)).toEqual({
      content: text,
    });
    expect(extractMessageInteractions(text, messageId, "stream")).toEqual({
      content: text,
    });
  },
);

test("an inline protocol example cannot become final message interactions", () => {
  const text = "Inline " + footer(envelope());
  expect(extractMessageInteractions(text, messageId)).toEqual({
    content: text,
  });
});

test.each([
  envelope({ version: 2 }),
  envelope({ messageId: "another-answer" }),
  envelope({ suggestions: ["one", "two", "three", "four"] }),
  envelope({ options: { ...options, maxSelections: 5 } }),
])("rejects invalid or differently bound metadata", (value) => {
  const text = "Answer.\n" + footer(value);
  expect(extractMessageInteractions(text, messageId)).toEqual({
    content: text,
  });
});

test("unfinished and malformed final JSON remains ordinary answer text", () => {
  for (const text of [
    "Answer.\n```chat-ui\n{",
    "Answer.\n```chat-ui\n{broken}\n```",
    "Answer.\n```cha",
  ]) {
    expect(extractMessageInteractions(text, messageId)).toEqual({
      content: text,
    });
  }
});

test("deduplicates suggestions without creating fallback interactions", () => {
  expect(
    readMessageInteractions({ suggestions: [" one ", "one", "two"] }),
  ).toEqual({ suggestions: ["one", "two"] });
  expect(readMessageInteractions({})).toBeUndefined();
  expect(readMessageInteractions({ suggestions: [] })).toBeUndefined();
  expect(readMessageInteractions({ suggestions: [""] })).toBeUndefined();
});

test("validates choices and returns them in definition order", () => {
  expect(validateOptionSelection(options, ["c", "a"])).toEqual(["a", "c"]);
  expect(validateOptionSelection(options, [])).toBeUndefined();
  expect(validateOptionSelection(options, ["a", "a"])).toBeUndefined();
  expect(validateOptionSelection(options, ["a", "b", "c"])).toBeUndefined();
  expect(validateOptionSelection(options, ["unknown"])).toBeUndefined();
  expect(
    validateOptionSelection(
      { ...options, selection: "single", maxSelections: 1 },
      ["a", "b"],
    ),
  ).toBeUndefined();
});

test("rejects ambiguous definitions and permits an explicitly optional choice", () => {
  for (const definition of [
    { ...options, options: [] },
    { ...options, options: [...options.options, options.options[0]] },
    { ...options, minSelections: 3, maxSelections: 2 },
    { ...options, selection: "single", maxSelections: 2 },
  ]) {
    expect(messageInteractionOptionsSchema.safeParse(definition).success).toBe(
      false,
    );
  }
  expect(validateOptionSelection({ ...options, minSelections: 0 }, [])).toEqual(
    [],
  );
});

test("formats one plain-text reply from the validated selection", () => {
  expect(formatOptionResponse(options, ["c", "a"])).toBe(
    "针对“Which scope?”，我的选择：\n- Current conversation\n- Export first",
  );
  expect(formatOptionResponse({ ...options, minSelections: 0 }, [])).toBe(
    "针对“Which scope?”，我的选择：\n暂不选择以上选项。",
  );
  expect(formatOptionResponse(options, ["unknown"])).toBeUndefined();
});

test("the optional protocol instruction binds an actual multiline example", () => {
  const prompt = messageInteractionPrompt(messageId);
  expect(prompt).toContain("\n```chat-ui\n");
  expect(prompt).toContain(JSON.stringify(messageId));
  expect(prompt).toContain("不要改变用户要求的精确输出格式");
  expect(prompt).toContain("没有合适的交互时不输出此块");
});
