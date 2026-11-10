export { estimateTokenLength } from "./token-estimate";

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

interface TokenPayload {
  verified: boolean;
  ts: number;
  sig: string;
}

/** 客户端验证旧版 token（只检查格式和过期时间，不验证签名） */
export function verifyTokenClient(token: string): boolean {
  try {
    const decoded = JSON.parse(
      typeof atob !== "undefined"
        ? atob(token)
        : Buffer.from(token, "base64").toString("utf-8"),
    ) as TokenPayload;
    if (Date.now() - decoded.ts > TOKEN_EXPIRY_MS) return false;
    return decoded.verified === true;
  } catch {
    return false;
  }
}
