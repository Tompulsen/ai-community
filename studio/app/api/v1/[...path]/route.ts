import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/api/auth";
import { limitModelRequest } from "@/app/lib/model-rate-limit";
import { createProxyLifecycle } from "@/app/utils/proxy-lifecycle";
import {
  modelBodyLimit,
  readRequestBody,
  RequestBodyError,
} from "@/app/utils/request-body";
import { proxyFetch } from "@/app/utils/proxy-fetch";
import { isUnsupportedReasoningError } from "@/app/utils/reasoning-fallback";
import {
  CONTEXT_LIMIT_MESSAGE,
  isContextLimitError,
} from "@/app/utils/context-error";
import {
  relayErrorResponse,
  relayHeaders,
  resolveRelayCredentials,
} from "@/app/lib/new-api/relay";

// 白名单路径：只允许转发这些路径（其余端点由 Edge 路由处理）
const ALLOWED_PATHS = new Set([
  // 聊天（需 Node.js 流式响应）
  "chat/completions",
  "responses",
  "messages",
  // 图像编辑/变体（需 Node.js multipart 支持）
  "images/edits",
  "images/variations",
  // 用量/订阅查询
  "dashboard/billing/usage",
  "dashboard/billing/subscription",
]);

// 动态路径前缀（支持路径参数）
const ALLOWED_PATH_PREFIXES: string[] = [];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return handleRequest(req, await params);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return handleRequest(req, await params);
}

async function handleRequest(req: NextRequest, params: { path: string[] }) {
  // OPTIONS 预检请求
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  // ═══════════════════════════════════════════════════════════════
  // 核心问题 1: 认证机制是否生效 ✅
  // ═══════════════════════════════════════════════════════════════
  const authResult = await auth(req);
  if (authResult.error) {
    return NextResponse.json(
      { error: true, msg: authResult.msg || "未授权访问" },
      { status: 401 },
    );
  }

  // 路径校验
  const subpath = params.path.join("/");
  const basePath = subpath.split("?")[0];

  // 白名单校验：精确匹配或前缀匹配
  const isAllowed =
    ALLOWED_PATHS.has(basePath) ||
    ALLOWED_PATH_PREFIXES.some((prefix) => basePath.startsWith(prefix));

  if (!isAllowed) {
    return NextResponse.json(
      { error: true, msg: `路径 ${basePath} 不在允许列表中` },
      { status: 403 },
    );
  }

  // 获取服务器配置
  let credentials;
  try {
    await limitModelRequest(req, basePath);
    credentials = await resolveRelayCredentials(req, basePath);
  } catch (error) {
    return relayErrorResponse(error);
  }
  const { baseUrl, apiKey } = credentials;
  let lifecycle: ReturnType<typeof createProxyLifecycle> | undefined;

  try {
    // 构建上游请求 URL：https://zhangyuapi.com/v1/chat/completions
    const searchParams = req.nextUrl.searchParams.toString();
    const fetchUrl = `${baseUrl}/v1/${subpath}${
      searchParams ? `?${searchParams}` : ""
    }`;

    // ═══════════════════════════════════════════════════════════════
    // 请求体处理
    // 按实际字节数限制请求体，保留 JSON 和 multipart 的原始内容。
    // ═══════════════════════════════════════════════════════════════
    const requestBody = ["GET", "HEAD"].includes(req.method)
      ? undefined
      : await readRequestBody(req, modelBodyLimit(basePath));

    // ═══════════════════════════════════════════════════════════════
    // 核心问题 5: 请求头完整透传 ✅
    // 继承客户端原始头，仅覆盖必要的字段
    // ═══════════════════════════════════════════════════════════════
    const headers = relayHeaders(req, apiKey);
    if (basePath === "messages") headers.set("anthropic-version", "2023-06-01");

    // 发起上游请求（对 502/504 网络抖动重试 1 次）
    // 超时 10 分钟，覆盖图片生成等慢接口
    lifecycle = createProxyLifecycle(req.signal, 600000);

    let upstreamRes: Response | undefined;
    const retries = ["GET", "HEAD"].includes(req.method) ? 1 : 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        upstreamRes = await proxyFetch(fetchUrl, {
          headers,
          method: req.method,
          body: requestBody,
          redirect: "manual",
          signal: lifecycle.signal,
          // @ts-ignore — Node.js 18+ 要求 ReadableStream body 带此选项
          duplex: "half",
        });
        // 非 502/504 直接跳出，不重试
        if (upstreamRes.status !== 502 && upstreamRes.status !== 504) break;
        if (attempt < retries) {
          void upstreamRes.body?.cancel().catch(() => {});
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      } catch (e: any) {
        if (attempt < retries && !lifecycle.signal.aborted) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        lifecycle.dispose();
        if (lifecycle.signal.aborted) {
          return NextResponse.json(
            {
              error: true,
              message: req.signal.aborted
                ? "请求已取消"
                : "上游响应超时，请稍后重试",
            },
            { status: req.signal.aborted ? 499 : 504 },
          );
        }
        return NextResponse.json(
          { error: true, message: `网络错误: ${e.message}` },
          { status: 502 },
        );
      }
    }
    if (!upstreamRes) {
      lifecycle.dispose();
      return NextResponse.json(
        { error: true, message: "上游请求失败" },
        { status: 502 },
      );
    }
    const responseBody = lifecycle.stream(upstreamRes.body);

    // ═══════════════════════════════════════════════════════════════
    // 响应头完整透传 ✅
    // 仅移除敏感头，保留传输相关头
    // ═══════════════════════════════════════════════════════════════
    const newHeaders = new Headers(upstreamRes.headers);
    newHeaders.delete("www-authenticate");
    newHeaders.delete("content-encoding");
    newHeaders.delete("content-length");
    newHeaders.delete("set-cookie");
    newHeaders.set("X-Accel-Buffering", "no");

    // 上游返回错误时，透传错误信息
    if (!upstreamRes.ok) {
      const errorBody = await new Response(responseBody).text();

      let errorMessage = errorBody;
      let reasoningUnsupported = false;
      try {
        const errorJson = JSON.parse(errorBody);
        reasoningUnsupported =
          ["chat/completions", "responses", "messages"].includes(basePath) &&
          isUnsupportedReasoningError(upstreamRes.status, errorJson);
        errorMessage =
          errorJson.error?.message || errorJson.message || errorBody;
      } catch {
        // 保持原始错误信息
      }

      const contextLimit = isContextLimitError(errorMessage);
      const status = contextLimit ? 400 : upstreamRes.status;
      const clientMessage = contextLimit
        ? CONTEXT_LIMIT_MESSAGE
        : process.env.NODE_ENV === "production"
        ? `请求失败 (${upstreamRes.status})`
        : errorMessage;

      console.error(
        "[V1 API Upstream Error]",
        upstreamRes.status,
        errorMessage,
      );

      return NextResponse.json(
        {
          error: true,
          message: clientMessage,
          statusCode: status,
          ...(reasoningUnsupported ? { reasoningUnsupported: true } : {}),
        },
        {
          status,
          headers: upstreamRes.headers.has("retry-after")
            ? { "Retry-After": upstreamRes.headers.get("retry-after")! }
            : undefined,
        },
      );
    }

    // 流式响应透传（聊天接口）
    return new Response(responseBody, {
      headers: newHeaders,
      status: upstreamRes.status,
    });
  } catch (e: any) {
    lifecycle?.dispose();
    if (e instanceof RequestBodyError) {
      return NextResponse.json(
        { error: true, message: e.message },
        { status: e.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (lifecycle?.signal.aborted || e.name === "AbortError") {
      return NextResponse.json(
        {
          error: true,
          message: req.signal.aborted ? "请求已取消" : "请求超时，请稍后重试",
        },
        { status: req.signal.aborted ? 499 : 504 },
      );
    }
    return NextResponse.json(
      { error: true, message: `网络错误: ${e.message}` },
      { status: 502 },
    );
  }
}

export const runtime = "nodejs";
export const maxDuration = 600;
