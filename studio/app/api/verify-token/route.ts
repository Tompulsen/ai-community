import { NextResponse } from "next/server";
import { auth } from "@/app/api/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 轻量级 token 验证端点
 * 仅检查 auth，不返回任何配置数据
 * 用于 password-guard 定期验证 token 是否仍然有效
 */
export async function GET(req: Request) {
  const authResult = await auth(req as any);
  if (authResult.error) {
    return NextResponse.json(
      { ok: false, msg: authResult.msg || "未授权" },
      { status: 401 },
    );
  }
  return NextResponse.json({ ok: true });
}
