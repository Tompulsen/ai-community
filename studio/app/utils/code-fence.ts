/**
 * 去除 Markdown 代码围栏
 * 用于处理从 LLM 复制粘贴的 JSON 配置
 */
export function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/);
  return match ? match[1].trim() : trimmed;
}
