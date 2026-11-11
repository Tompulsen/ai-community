import { getServerSideConfig } from "@/app/config/server";
import { auth } from "@/app/api/auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // 认证校验：生产环境必须验证访问密码
  const authResult = await auth(req);
  if (authResult.error) {
    return NextResponse.json(
      { error: true, msg: authResult.msg || "未授权访问" },
      { status: 401 },
    );
  }

  const config = getServerSideConfig();
  return NextResponse.json({
    baseUrl: config.baseUrl || "(未配置，将使用默认地址)",
    apiKey: config.apiKey ? "已配置 (隐藏)" : "(未配置)",
    modelsApiUrl: config.modelsApiUrl || "(未配置)",
  });
}
