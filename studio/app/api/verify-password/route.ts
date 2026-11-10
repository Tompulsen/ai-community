import { getServerSideConfig } from "@/app/config/server";
import { NextRequest, NextResponse } from "next/server";
import { generateAccessToken, safeCompare } from "@/app/utils/access-token";
import { getClientIp } from "@/app/utils/request-ip";
import {
  getAttempt,
  setAttempt,
  deleteAttempt,
  cleanupExpired,
} from "@/app/utils/attempt-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 暴力破解防护
const MAX_ATTEMPTS = 15;
const WINDOW_MS = 10 * 60 * 1000; // 10 分钟窗口

export async function GET() {
  const config = getServerSideConfig();
  return NextResponse.json({ enabled: config.accessPasswords.length > 0 });
}

export async function POST(req: NextRequest) {
  const config = getServerSideConfig();

  if (config.accessPasswords.length === 0) {
    return NextResponse.json({ ok: true, msg: "无需密码" });
  }

  const ip = getClientIp(req);

  // 暴力破解防护（持久化存储，冷启动不丢失）
  const now = Date.now();
  const record = getAttempt(ip);
  if (record && now < record.resetTime && record.count >= MAX_ATTEMPTS) {
    const remaining = Math.ceil((record.resetTime - now) / 1000);
    return NextResponse.json(
      {
        ok: false,
        msg: `尝试次数过多，请 ${remaining} 秒后再试`,
      },
      { status: 429 },
    );
  }

  try {
    const { password } = await req.json();

    if (!password) {
      return NextResponse.json(
        { ok: false, msg: "请输入密码" },
        { status: 400 },
      );
    }

    // 逐个比对所有密码（逗号分隔），匹配任意一个即可
    const inputPassword = String(password).trim();
    const matchedPassword = config.accessPasswords.find((p) =>
      safeCompare(inputPassword, p),
    );

    if (matchedPassword) {
      // 验证成功，清除该 IP 的失败计数
      deleteAttempt(ip);
      // 返回 HMAC token（基于匹配到的密码生成），而非明文密码
      const token = await generateAccessToken(matchedPassword);
      return NextResponse.json({ ok: true, token });
    }

    // 记录失败次数
    let currentCount: number;
    if (!record || now > record.resetTime) {
      setAttempt(ip, { count: 1, resetTime: now + WINDOW_MS });
      currentCount = 1;
      cleanupExpired();
    } else {
      currentCount = record.count + 1;
      setAttempt(ip, { count: currentCount, resetTime: record.resetTime });
    }

    const remaining = MAX_ATTEMPTS - currentCount;
    return NextResponse.json(
      {
        ok: false,
        msg:
          remaining > 3
            ? "密码错误，请重新输入"
            : `密码错误，剩余 ${remaining} 次尝试机会`,
      },
      { status: 401 },
    );
  } catch {
    return NextResponse.json(
      { ok: false, msg: "请求格式错误" },
      { status: 400 },
    );
  }
}
