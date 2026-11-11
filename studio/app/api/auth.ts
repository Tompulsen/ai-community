import { NextRequest } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import { verifyAccessToken } from "@/app/utils/access-token";

export async function auth(req: NextRequest) {
  const config = getServerSideConfig();

  // 如果未设置访问密码，则跳过认证
  if (config.accessPasswords.length === 0) {
    return { error: false };
  }

  // 从请求头或 Cookie 中获取 token
  const authHeader = req.headers.get("Authorization");
  const token =
    (authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.cookies.get("site_access_token")?.value
    )?.trim() || "";

  // 使用 HMAC token 验证（恒定时间比较，防止计时攻击）
  // 逐个尝试所有密码，只要有一个匹配即通过
  let isValid = false;
  if (token) {
    for (const pw of config.accessPasswords) {
      if (await verifyAccessToken(token, pw)) {
        isValid = true;
        break;
      }
    }
  }

  if (!isValid) {
    return {
      error: true,
      msg: "未授权访问，请先验证密码",
    };
  }

  return {
    error: false,
  };
}
