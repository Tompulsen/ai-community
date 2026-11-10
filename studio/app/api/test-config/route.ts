import { getServerSideConfig } from "@/app/config/server";
import { auth } from "@/app/api/auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // 认证校验
  const authResult = await auth(req);
  if (authResult.error) {
    return NextResponse.json(
      { error: true, msg: authResult.msg || "未授权访问" },
      { status: 401 },
    );
  }

  const config = getServerSideConfig();
  const url = config.modelsApiUrl;
  const hasKey = !!config.apiKey;

  if (!url) {
    return NextResponse.json({
      error: "MODELS_API_URL is not set",
      hint: "Please add MODELS_API_URL in Vercel Environment Variables",
    });
  }

  const target = `${url.replace(/\/$/, "")}/models`;

  try {
    const headers: Record<string, string> = {};
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const res = await fetch(target, { method: "GET", headers });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    const modelCount = Array.isArray(data?.data) ? data.data.length : 0;

    return NextResponse.json({
      status: res.status,
      url: target,
      hasApiKey: hasKey,
      modelCount,
      models:
        modelCount > 0
          ? data.data.slice(0, 3).map((m: any) => m.id)
          : undefined,
      raw: modelCount === 0 ? data : undefined,
    });
  } catch (e) {
    return NextResponse.json({
      error: (e as Error).message,
      url: target,
      hasApiKey: hasKey,
    });
  }
}
