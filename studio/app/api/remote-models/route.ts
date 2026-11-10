import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import { auth } from "@/app/api/auth";
import {
  relayErrorResponse,
  relayHeaders,
  resolveRelayCredentials,
} from "@/app/lib/new-api/relay";
import { isNewApiEnabled } from "@/app/lib/new-api/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_CACHE = { "Cache-Control": "private, no-store" };

/**
 * 从 MODELS_API_URL 获取模型列表（服务端代理，不暴露 API Key）
 */
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
  if (isNewApiEnabled()) {
    try {
      const { baseUrl, apiKey } = await resolveRelayCredentials(req);
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: relayHeaders(req, apiKey),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      return NextResponse.json(data, {
        status: res.status,
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      return relayErrorResponse(error);
    }
  }
  // 优先使用 MODELS_API_URL，回退到 BASE_URL/v1
  const modelsUrl = config.modelsApiUrl || config.baseUrl;

  if (!modelsUrl) {
    return NextResponse.json({ data: [] }, { headers: NO_CACHE });
  }

  // 如果使用 MODELS_API_URL，直接拼接 /models（用户应配置完整路径含 /v1）
  // 如果回退到 BASE_URL，需要拼接 /v1/models
  const target = config.modelsApiUrl
    ? `${modelsUrl.replace(/\/+$/, "")}/models`
    : `${modelsUrl.replace(/\/+$/, "")}/v1/models`;

  try {
    const headers: Record<string, string> = {};

    // 用户自定义 API Key 优先，回退到服务端 API Key
    const customApiKey = req.headers
      .get("x-api-key")
      ?.replace(/^Bearer\s+/i, "")
      .trim();
    if (customApiKey) {
      headers["Authorization"] = `Bearer ${customApiKey}`;
    } else if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const res = await fetch(target, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after") || "";
      return NextResponse.json(
        {
          error: true,
          message: `获取模型列表失败（HTTP ${res.status}），请检查接口和密钥后重试`,
        },
        {
          status: res.status >= 400 ? res.status : 502,
          headers: {
            ...NO_CACHE,
            ...(/^\d{1,6}$/.test(retryAfter)
              ? { "Retry-After": retryAfter }
              : {}),
          },
        },
      );
    }

    const json = await res.json();
    if (!Array.isArray(json?.data)) {
      return NextResponse.json(
        {
          error: true,
          message: "服务商返回的模型列表格式无效，请检查接口配置",
        },
        { status: 502, headers: NO_CACHE },
      );
    }
    return NextResponse.json(json, { headers: NO_CACHE });
  } catch (e) {
    const timedOut =
      e !== null &&
      typeof e === "object" &&
      "name" in e &&
      (e.name === "TimeoutError" || e.name === "AbortError");
    return NextResponse.json(
      {
        error: true,
        message: timedOut
          ? "获取模型列表超时，请稍后重试"
          : "无法获取模型列表，请检查接口配置后重试",
      },
      { status: timedOut ? 504 : 502, headers: NO_CACHE },
    );
  }
}
