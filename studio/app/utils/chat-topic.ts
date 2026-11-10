type TopicMessage = {
  role: string;
  content: string | { type: string; text?: string }[];
  isError?: boolean;
};

export function stripTopicReasoning(text: string) {
  return text
    .replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, "")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .trim();
}

export function topicMessageText(message: TopicMessage) {
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text || "")
          .join("\n");
  return stripTopicReasoning(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/data:image\/[^\s)]+/g, "")
    .trim();
}

export function hasLeakedTopicReasoning(topic: string) {
  return (
    /^\s*(?:>\s*|<think(?:ing)?>)/i.test(topic) &&
    /(?:we need|we should|let me|the user|analysis|reasoning|需要|用户|思考)/i.test(
      topic,
    )
  );
}

export function resolveChatTopic(
  output: string,
  messages: TopicMessage[],
  defaultTopic: string,
) {
  const title = stripTopicReasoning(output)
    .replace(/^[#*"'“”`「」\s]+|[*"'“”`「」\s]+$/g, "")
    .replace(/^(?:标题|主题|title)\s*[:：]\s*/i, "")
    .replace(/[，。！？”“"、,.!?*]+$/, "")
    .trim();
  if (
    title &&
    Array.from(title).length <= 32 &&
    !/[\r\n<>]|https?:\/\/|!\[/.test(title) &&
    !/(?:we need|we should|let me|the user|analysis:|reasoning:)/i.test(title)
  )
    return title;
  const first = messages.find(
    (message) =>
      message.role === "user" && !message.isError && topicMessageText(message),
  );
  const fallback = first ? topicMessageText(first).replace(/\s+/g, " ") : "";
  return fallback ? Array.from(fallback).slice(0, 20).join("") : defaultTopic;
}
