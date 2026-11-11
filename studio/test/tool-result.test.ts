import {
  getToolArguments,
  getToolResult,
  getToolTable,
  MAX_TOOL_TABLE_ROWS,
  parseToolArgumentInput,
  restoreInterruptedToolCalls,
  safeToolUrl,
} from "../app/utils/tool-result";

describe("tool result data", () => {
  test("restores saved pending tools without changing completed results", () => {
    const pending: { isError?: boolean; errorMsg?: string } = {};
    const done = { isError: false, content: "Saved result" };
    const failed = { isError: true, errorMsg: "Original failure" };
    restoreInterruptedToolCalls([
      { tools: [pending, done] },
      { tools: [failed] },
      {},
    ]);
    expect(pending).toEqual({
      isError: true,
      errorMsg: "页面已刷新，执行状态未确认。",
    });
    expect(done).toEqual({ isError: false, content: "Saved result" });
    expect(failed.errorMsg).toBe("Original failure");
  });
  test("unwraps real MCP text and structured result formats", () => {
    expect(
      getToolResult(
        JSON.stringify({
          content: [{ type: "text", text: '{"temperature":19}' }],
        }),
      ),
    ).toEqual({ temperature: 19 });
    expect(
      getToolResult(
        JSON.stringify({
          content: [{ type: "text", text: "Summary" }],
          structuredContent: { temperature: 19 },
        }),
      ),
    ).toEqual({ temperature: 19 });
  });

  test("keeps plain text, incomplete JSON and mixed MCP content readable", () => {
    expect(getToolResult("<script>alert(1)</script>")).toBe(
      "<script>alert(1)</script>",
    );
    expect(getToolResult('{"partial":')).toBe('{"partial":');
    const mixed = {
      content: [
        { type: "text", text: "Photo" },
        { type: "image", data: "x" },
      ],
    };
    expect(getToolResult(JSON.stringify(mixed))).toEqual(mixed);
    expect(getToolResult()).toBeUndefined();
    expect(getToolResult("0")).toBe(0);
  });

  test("bounds wide or long tables without losing the original row count", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      name: `Row ${index}`,
      value: index,
    }));
    const table = getToolTable(rows);
    expect(table?.columns).toEqual(["name", "value"]);
    expect(table?.rows).toHaveLength(MAX_TOOL_TABLE_ROWS);
    expect(table?.totalRows).toBe(100);
    expect(getToolTable(["a", "b"])).toBeNull();
    expect(getToolTable([])).toBeNull();
    expect(getToolTable([{ only: 1 }, null])).toBeNull();
  });

  test("preserves argument types and refuses invalid numeric or JSON fields", () => {
    expect(getToolArguments('{"query":"old","page":2,"live":true}')).toEqual({
      query: "old",
      page: 2,
      live: true,
    });
    expect(getToolArguments("[]")).toBeNull();
    expect(getToolArguments("{")).toBeNull();
    expect(parseToolArgumentInput("old", "new")).toBe("new");
    expect(parseToolArgumentInput(2, "3.5")).toBe(3.5);
    expect(parseToolArgumentInput(true, "false")).toBe(false);
    expect(parseToolArgumentInput({}, '{"nested":[1]}')).toEqual({
      nested: [1],
    });
    expect(() => parseToolArgumentInput(1, "")).toThrow("有效数字");
    expect(() => parseToolArgumentInput(1, "Infinity")).toThrow("有效数字");
    expect(() => parseToolArgumentInput(null, "{")).toThrow("有效的 JSON");
  });

  test("only exposes usable HTTP source URLs without embedded credentials", () => {
    expect(safeToolUrl("https://example.com/docs")).toBe(
      "https://example.com/docs",
    );
    expect(safeToolUrl("javascript:alert(1)")).toBeNull();
    expect(safeToolUrl("data:text/html,hello")).toBeNull();
    expect(safeToolUrl("https://user:secret@example.com")).toBeNull();
    expect(safeToolUrl("/relative")).toBeNull();
  });
});
