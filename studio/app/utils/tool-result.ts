const MAX_JSON_LENGTH = 200_000;
export const MAX_TOOL_TEXT_LENGTH = 20_000;
export const MAX_TOOL_TABLE_ROWS = 30;
export const MAX_TOOL_TABLE_COLUMNS = 8;

export function waitForToolResult<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("已停止等待。", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

export function restoreInterruptedToolCalls(
  messages: Array<{
    tools?: Array<{ isError?: boolean; errorMsg?: string }>;
  }>,
) {
  for (const message of messages) {
    for (const tool of message.tools ?? []) {
      if (tool.isError === undefined) {
        tool.isError = true;
        tool.errorMsg = "页面已刷新，执行状态未确认。";
      }
    }
  }
}

export function isToolRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseToolValue(content?: string): unknown {
  if (!content) return undefined;
  if (content.length <= MAX_JSON_LENGTH) {
    try {
      return JSON.parse(content);
    } catch {}
  }
  return content;
}

export function getToolResult(content?: string): unknown {
  const value = parseToolValue(content);
  if (!isToolRecord(value)) return value;
  if (value.structuredContent !== undefined) return value.structuredContent;
  if (!Array.isArray(value.content)) return value;
  const blocks = value.content;
  if (
    blocks.length > 0 &&
    blocks.every(
      (block) =>
        isToolRecord(block) &&
        block.type === "text" &&
        typeof block.text === "string",
    )
  ) {
    const text = blocks.map((block) => block.text).join("\n\n");
    return parseToolValue(text);
  }
  return value;
}

export function getToolArguments(
  content?: string,
): Record<string, unknown> | null {
  const value = parseToolValue(content ?? "{}");
  return isToolRecord(value) ? value : null;
}

export function formatToolValue(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function getToolTable(value: unknown) {
  if (!Array.isArray(value) || !value.length || !value.every(isToolRecord))
    return null;
  const columns = [...new Set(value.flatMap((row) => Object.keys(row)))].slice(
    0,
    MAX_TOOL_TABLE_COLUMNS,
  );
  if (!columns.length) return null;
  return {
    columns,
    rows: value.slice(0, MAX_TOOL_TABLE_ROWS),
    totalRows: value.length,
  };
}

export function parseToolArgumentInput(
  original: unknown,
  input: string,
): unknown {
  if (typeof original === "string") return input;
  if (typeof original === "number") {
    if (!input.trim() || !Number.isFinite(Number(input)))
      throw new Error("请输入有效数字");
    return Number(input);
  }
  if (typeof original === "boolean") return input === "true";
  try {
    return JSON.parse(input);
  } catch {
    throw new Error("请输入有效的 JSON");
  }
}

export function safeToolUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
