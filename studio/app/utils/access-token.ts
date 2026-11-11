/**
 * 访问令牌工具函数
 * - 生成 HMAC-SHA256 token（不可逆）
 * - 恒定时间比较（防计时攻击）
 * 使用 Web Crypto API，兼容 Edge Runtime 和 Node.js
 */

/**
 * 生成访问 token
 * token = HMAC-SHA256(password, "access-token-v1")
 * 不可逆：即使 token 被截获，也无法还原出密码
 */
export async function generateAccessToken(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("access-token-v1"),
  );
  // 将 ArrayBuffer 转为 hex 字符串
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 恒定时间字符串比较，防止计时攻击 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** 验证 token 是否有效 */
export async function verifyAccessToken(
  token: string,
  password: string,
): Promise<boolean> {
  const expected = await generateAccessToken(password);
  return safeCompare(token, expected);
}
