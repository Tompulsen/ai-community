import { getMessageError } from "../app/utils/message-error";
import { getWebToolInfo } from "../app/utils/web-tool";

describe("message error presentation", () => {
  const body = { status: 502, title: "Bad gateway", cloudflare_error: true };
  it("collapses existing gateway errors even without the legacy error flag", () => {
    const content = `服务器暂时不可用（502），请稍后重试\n\n\`\`\`json\n${JSON.stringify(
      body,
    )}\n\`\`\``;
    expect(getMessageError(content)).toEqual({
      summary: "服务器暂时不可用（502），请稍后重试",
      details: JSON.stringify(body, null, 2),
    });
  });
  it.each(["章鱼登录", "New API 登录"])(
    "shows account errors with Zhangyu branding for the %s prefix",
    (prefix) => {
      const content = `${prefix}状态已失效，请重新登录\n\n\`\`\`json\n${JSON.stringify(
        { error: "unauthorized", status: 401 },
      )}\n\`\`\``;
      expect(getMessageError(content)?.summary).toBe(
        "章鱼登录状态已失效，请重新登录",
      );
    },
  );
  it("keeps a normal answer containing a JSON error example intact", () => {
    expect(
      getMessageError(
        `Here is an error example:\n\`\`\`json\n${JSON.stringify(
          body,
        )}\n\`\`\``,
      ),
    ).toBeNull();
  });
  it("leaves incomplete JSON and text errors readable", () => {
    expect(getMessageError("请求失败", true)).toBeNull();
    expect(getMessageError("失败\n```json\n{", true)).toBeNull();
    expect(
      getMessageError('Partial reply\n```json\n{"config":true}\n```', true),
    ).toBeNull();
  });
});

describe("web tool source presentation", () => {
  it("deduplicates actual result URLs and rejects unsafe source URLs", () => {
    const info = getWebToolInfo({
      function: { name: "web_search", arguments: '{"query":"Octopus"}' },
      content: JSON.stringify({
        results: [
          {
            title: "Docs",
            url: "https://example.com/docs",
            snippet: "Docs excerpt",
          },
          { title: "Duplicate", link: "https://example.com/docs" },
          { title: "Unsafe", url: "javascript:alert(1)" },
        ],
      }),
    });
    expect(info?.query).toBe("Octopus");
    expect(info?.sources).toEqual([
      {
        title: "Docs",
        url: "https://example.com/docs",
        snippet: "Docs excerpt",
      },
    ]);
  });
  it("does not manufacture sources for tool output without source URLs", () => {
    expect(
      getWebToolInfo({
        function: { name: "web_search" },
        content: "plain result",
      })?.sources,
    ).toEqual([]);
    expect(getWebToolInfo({ function: { name: "calculator" } })).toBeNull();
  });
});
