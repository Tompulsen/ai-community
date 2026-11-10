export function getMessageError(content: string, isError = false) {
  const match = content.match(/^([\s\S]*?)```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  const summary = match[1].trim().replace(/^New API 登录/, "章鱼登录");
  const knownError =
    /^(?:服务器暂时不可用|请求过于频繁|访问已过期|没有权限访问|章鱼登录)/.test(
      summary,
    );
  if (!isError && !knownError) return null;
  try {
    const data = JSON.parse(match[2]);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const isEnvelope =
      "error" in data ||
      data.cloudflare_error === true ||
      (typeof data.status === "number" && data.status >= 400);
    if (!isEnvelope) return null;
    return { summary, details: JSON.stringify(data, null, 2) };
  } catch {
    return null;
  }
}
