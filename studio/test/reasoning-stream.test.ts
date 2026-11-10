import {
  createReasoningStream,
  splitReasoningContent,
} from "../app/utils/reasoning-stream";

test("separates tags split at every character boundary", () => {
  const stream = createReasoningStream();
  const result = { content: "", reasoning: "" };
  for (const character of "<think>Compare options.\nThen decide.</think>The answer.") {
    const delta = stream.push(character);
    result.content += delta.content;
    result.reasoning += delta.reasoning;
  }
  const last = stream.finish();
  expect(result.content + last.content).toBe("The answer.");
  expect(result.reasoning + last.reasoning).toBe(
    "Compare options.\nThen decide.",
  );
});

test("preserves quotes and literal tags after answer text", () => {
  expect(
    splitReasoningContent("> A quoted passage.\nUse <think> as an example."),
  ).toEqual({
    content: "> A quoted passage.\nUse <think> as an example.",
    reasoning: "",
  });
});

test("keeps unfinished reasoning and unfinished ordinary angle text", () => {
  expect(splitReasoningContent("<think>Still working")).toEqual({
    content: "",
    reasoning: "Still working",
  });
  expect(splitReasoningContent("<thi")).toEqual({
    content: "<thi",
    reasoning: "",
  });
});

test("combines a dedicated reasoning channel with a tagged answer", () => {
  const stream = createReasoningStream();
  expect(stream.push("Plan first.", true)).toEqual({
    content: "",
    reasoning: "Plan first.",
  });
  expect(stream.push("Final answer.")).toEqual({
    content: "Final answer.",
    reasoning: "",
  });
});
