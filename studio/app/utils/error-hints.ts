import { CONTEXT_LIMIT_MESSAGE, isContextLimitError } from "./context-error";

/**
 * 带解决提示的错误消息
 * 根据超时时间给出不同的诊断建议
 * 文案友好、可操作，避免技术术语吓到用户
 */

/** 根据请求耗时给出网络错误提示 */
export function getNetworkErrorHint(
  elapsedSeconds: number,
  usesProxy = false,
): string | null {
  if (elapsedSeconds <= 5) {
    if (usesProxy) {
      return "连接失败，请检查代理服务是否正常运行";
    }
    return "连接失败，请检查网络后重试";
  }

  if (elapsedSeconds <= 15) {
    return "请求发送失败，可能是服务器暂时不可用，请稍后重试";
  }

  if (elapsedSeconds >= 55 && elapsedSeconds <= 75) {
    return "请求超时（约 60 秒），可能是网关超时限制，图片类操作请尝试减小尺寸后重试";
  }

  if (elapsedSeconds >= 110 && elapsedSeconds <= 140) {
    return "请求超时（约 120 秒），可能是 CDN 超时限制，请稍后重试";
  }

  return "请求超时，请稍后重试";
}

/** 根据 HTTP 状态码给出友好提示 */
export function getHttpErrorHint(status: number): string {
  switch (status) {
    case 400:
      return "请求参数有误，请检查输入内容";
    case 401:
      return "访问已过期，请重新输入密码";
    case 403:
      return "没有权限访问此功能";
    case 404:
      return "请求的接口不存在，请刷新页面后重试";
    case 429:
      return "请求过于频繁，请稍后再试";
    case 500:
      return "服务器内部错误，请稍后重试";
    case 502:
      return "网关连接异常，请稍后重试";
    case 503:
      return "服务暂时不可用，请稍后重试";
    case 504:
      return "网关响应超时，请稍后重试";
    default:
      return `请求失败（${status}），请稍后重试`;
  }
}

/** 获取用户可读的错误信息（优先级：hint > message > fallback） */
export function getUserFriendlyError(
  error: Error | { message?: string; status?: number },
): string {
  const message = error?.message || "";
  const status = (error as any)?.status;
  if (isContextLimitError(message)) return CONTEXT_LIMIT_MESSAGE;

  // HTTP 状态码提示
  if (status) {
    return getHttpErrorHint(status);
  }

  // 网络错误关键词匹配
  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes("failed to fetch") ||
    lowerMsg.includes("networkerror") ||
    lowerMsg.includes("network")
  ) {
    return "网络连接失败，请检查网络后重试";
  }

  if (lowerMsg.includes("timeout") || lowerMsg.includes("abort")) {
    return "请求超时，请稍后重试";
  }

  if (lowerMsg.includes("quota") || lowerMsg.includes("额度")) {
    return "账户额度不足，请检查余额";
  }

  if (lowerMsg.includes("insufficient")) {
    return "余额不足，请充值后重试";
  }

  if (lowerMsg.includes("rate limit") || lowerMsg.includes("429")) {
    return "请求过于频繁，请稍后再试";
  }

  if (lowerMsg.includes("not supported model")) {
    return "当前渠道不支持该模型，请更换模型后重试";
  }

  // 默认
  return message || "操作失败，请稍后重试";
}
