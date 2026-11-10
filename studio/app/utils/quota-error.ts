/** Wallet exhaustion only. A rate limit or a token cap is not a wallet balance. */
export function isInsufficientBalance(error: unknown): boolean {
  // Read only error fields, including response bodies retained by ApiFetchError.
  // Do not stringify an arbitrary response (it may contain request credentials).
  const seen = new Set<object>();
  const details = (item: unknown, depth = 0): string => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object" || depth > 3 || seen.has(item))
      return "";
    seen.add(item);
    const record = item as Record<string, unknown>;
    return ["code", "message", "detail", "type", "error", "body", "cause"]
      .map((key) => details(record[key], depth + 1))
      .join(" ");
  };
  const value = details(error);
  if (
    /NEW_API_GROUP_TOKEN_UNAVAILABLE|rate.?limit|too many requests|subscription|订阅|套餐|令牌|密钥|token.{0,20}(quota|limit)|停用|过期/i.test(
      value,
    )
  )
    return false;
  return /insufficient[_\s-]*(?:user[_\s-]*)?(quota|balance|funds|credit)|not enough quota to pre-consume|(?:user|account)[_\s-]*quota[_\s-]*(?:not[_\s-]*enough|exhausted)|(?:用户|账户|账号)?(?:余额|额度)(?:已)?(?:不足|耗尽)|预扣(?:费)?(?:额度)?失败/i.test(
    value,
  );
}
