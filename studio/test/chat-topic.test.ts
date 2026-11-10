import {
  hasLeakedTopicReasoning,
  resolveChatTopic,
  topicMessageText,
} from "../app/utils/chat-topic";

const messages = [{ role: "user", content: "帮我生成一张城市夜景图片" }];

describe("conversation titles", () => {
  it("extracts a short final title after reasoning and markdown", () => {
    expect(
      resolveChatTopic(
        "<think>We need to summarize the conversation</think>\n**城市夜景**",
        messages,
        "新的聊天",
      ),
    ).toBe("城市夜景");
    expect(
      resolveChatTopic(
        "> We need answer to user\n\n城市夜景",
        messages,
        "新的聊天",
      ),
    ).toBe("城市夜景");
  });
  it.each([
    "> We need answer to user: They ask summarize this sentence",
    "We need answer to user",
    "<think>unfinished reasoning",
    "first line\nsecond line",
    "a".repeat(100),
    "![Generated Image](https://example.com/image.png)",
    "",
  ])("uses a local fallback for invalid output %s", (output) => {
    expect(resolveChatTopic(output, messages, "新的聊天")).toBe(
      messages[0].content,
    );
  });
  it("removes images and thinking from title input", () => {
    expect(
      topicMessageText({
        role: "assistant",
        content:
          "> thinking\n\n![Generated Image](https://example.com/a.png)\n最终内容",
      }),
    ).toBe("最终内容");
    expect(
      topicMessageText({
        role: "user",
        content: [{ type: "image_url" }, { type: "text", text: "夜景" }],
      }),
    ).toBe("夜景");
  });
  it("only identifies clearly leaked historical titles", () => {
    expect(hasLeakedTopicReasoning("> We need answer to user: summarize")).toBe(
      true,
    );
    expect(hasLeakedTopicReasoning("手动命名的对话")).toBe(false);
    expect(hasLeakedTopicReasoning("> 引用与排版")).toBe(false);
  });
  it("limits fallback titles and handles image-only conversations", () => {
    expect(
      resolveChatTopic(
        "",
        [{ role: "user", content: "字".repeat(100) }],
        "新的聊天",
      ),
    ).toHaveLength(20);
    expect(
      resolveChatTopic(
        "",
        [{ role: "user", content: [{ type: "image_url" }] }],
        "新的聊天",
      ),
    ).toBe("新的聊天");
  });
});
