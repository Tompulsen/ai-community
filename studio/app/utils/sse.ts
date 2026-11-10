/**
 * SSE (Server-Sent Events) 流式解析器
 * 参考 GPT-image-playground，不依赖外部库
 */

/** 从 SSE 块中提取 data 行内容 */
export function parseServerSentEventBlock(block: string): string | null {
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data === "[DONE]") return null;
      if (data) return data;
    }
  }
  return null;
}

/** 检查流式响应中是否有 error 事件 */
export function getStreamEventErrorMessage(event: Record<string, unknown>): string | null {
  if (event.error) {
    const message =
      typeof event.error === "string"
        ? event.error
        : (event.error as Record<string, unknown>)?.message || JSON.stringify(event.error);
    return `上游返回错误: ${message}`;
  }
  return null;
}

/** 读取 SSE 流，逐事件调用 onEvent */
export async function readJsonServerSentEvents(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  if (!response.body) throw new Error("接口未返回可读取的流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let hasDataLine = false;

  const processBlock = async (block: string) => {
    if (block.split(/\r?\n/).some((line) => line.startsWith("data:"))) hasDataLine = true;
    const data = parseServerSentEventBlock(block);
    if (!data) return;

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error(`流式响应解析失败: ${data.slice(0, 100)}`);
    }
    if (typeof event !== "object" || event === null) return;

    const errorMessage = getStreamEventErrorMessage(event as Record<string, unknown>);
    if (errorMessage) throw new Error(errorMessage);

    await onEvent(event as Record<string, unknown>);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx = buffer.search(/\r?\n\r?\n/);
    while (sepIdx >= 0) {
      const block = buffer.slice(0, sepIdx);
      const sep = buffer.match(/\r?\n\r?\n/)?.[0] ?? "\n\n";
      buffer = buffer.slice(sepIdx + sep.length);
      await processBlock(block);
      sepIdx = buffer.search(/\r?\n\r?\n/);
    }
  }
  if (buffer.trim()) await processBlock(buffer);
  if (!hasDataLine) throw new Error("未从流式响应中解析到有效的 data 事件");
}
