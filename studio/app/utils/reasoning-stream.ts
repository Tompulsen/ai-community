export type ReasoningDelta = { content: string; reasoning: string };

const OPEN = "<think>";
const CLOSE = "</think>";

export function createReasoningStream() {
  let mode: "prefix" | "answer" | "reasoning" = "prefix";
  let pending = "";

  function push(text: string, isThinking = false): ReasoningDelta {
    if (isThinking) return { content: "", reasoning: text };
    if (mode === "answer") return { content: text, reasoning: "" };
    pending += text;

    if (mode === "prefix") {
      const prefix = pending.trimStart();
      if (!prefix || (prefix.length < OPEN.length && OPEN.startsWith(prefix)))
        return { content: "", reasoning: "" };
      if (!prefix.startsWith(OPEN)) {
        mode = "answer";
        const content = pending;
        pending = "";
        return { content, reasoning: "" };
      }
      mode = "reasoning";
      pending = prefix.slice(OPEN.length);
    }

    const closingIndex = pending.indexOf(CLOSE);
    if (closingIndex !== -1) {
      const reasoning = pending.slice(0, closingIndex);
      const content = pending.slice(closingIndex + CLOSE.length);
      pending = "";
      mode = "answer";
      return { content, reasoning };
    }

    // Keep only a possible split closing tag until the next chunk arrives.
    let suffixLength = Math.min(pending.length, CLOSE.length - 1);
    while (suffixLength && !CLOSE.startsWith(pending.slice(-suffixLength)))
      suffixLength--;
    const reasoning = pending.slice(0, pending.length - suffixLength);
    pending = pending.slice(pending.length - suffixLength);
    return { content: "", reasoning };
  }

  function finish(): ReasoningDelta {
    const rest = pending;
    pending = "";
    return mode === "reasoning"
      ? { content: "", reasoning: rest }
      : { content: rest, reasoning: "" };
  }

  return { push, finish };
}

export function splitReasoningContent(content: string, reasoning = "") {
  const stream = createReasoningStream();
  const first = stream.push(content);
  const last = stream.finish();
  return {
    content: first.content + last.content,
    reasoning: reasoning + first.reasoning + last.reasoning,
  };
}
