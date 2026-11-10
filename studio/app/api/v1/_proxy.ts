/**
 * Shared Node.js model proxy, including server-side account sessions.
 * 给 images/generations / videos/* / models / embeddings 使用
 * Edge Runtime 在 Vercel Hobby 有 30s 超时（Node.js 仅 10s）
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/api/auth";
import { limitModelRequest } from "@/app/lib/model-rate-limit";
import { createProxyLifecycle } from "@/app/utils/proxy-lifecycle";
import { isUnsupportedReasoningError } from "@/app/utils/reasoning-fallback";
import {
  modelBodyLimit,
  readRequestBody,
  RequestBodyError,
} from "@/app/utils/request-body";
import {
  CONTEXT_LIMIT_MESSAGE,
  isContextLimitError,
} from "@/app/utils/context-error";
import {
  relayErrorResponse,
  relayHeaders,
  resolveRelayCredentials,
} from "@/app/lib/new-api/relay";

const UPSTREAM_TIMEOUT_MS = 360_000; // 6分钟（Docker 无限制；Vercel Edge 上限 30s Hobby / 60s Pro）

export async function handleEdgeProxy(
  req: NextRequest,
  subpath: string,
  options?: { method?: string; upstreamPath?: string; gemini?: boolean },
) {
  // OPTIONS 预检
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  // 认证
  const authResult = await auth(req);
  if (authResult.error) {
    return NextResponse.json(
      { error: true, msg: authResult.msg || "未授权访问" },
      { status: 401 },
    );
  }

  let credentials;
  try {
    await limitModelRequest(req, subpath);
    credentials = await resolveRelayCredentials(req, subpath);
  } catch (error) {
    return relayErrorResponse(error);
  }
  const { baseUrl, apiKey } = credentials;
  let lifecycle: ReturnType<typeof createProxyLifecycle> | undefined;

  try {
    const searchParams = req.nextUrl.searchParams.toString();
    const fetchUrl = `${baseUrl}/${options?.upstreamPath || `v1/${subpath}`}${
      searchParams ? `?${searchParams}` : ""
    }`;

    // Multipart image edits must retain the original binary bytes and boundary.
    const requestBody = ["GET", "HEAD"].includes(options?.method || req.method)
      ? undefined
      : await readRequestBody(req, modelBodyLimit(subpath));

    // 构建请求头
    const mediaRequest =
      req.method === "GET" &&
      /(?:\/content|^v1beta\/files\/[A-Za-z0-9_-]+:download)$/.test(subpath);
    const headers = relayHeaders(req, apiKey, mediaRequest);
    if (options?.gemini) {
      headers.set("x-goog-api-key", apiKey);
      if (new URL(baseUrl).hostname.endsWith(".googleapis.com"))
        headers.delete("authorization");
    }

    // 上游请求（对 502/504 网络抖动重试 1 次）
    lifecycle = createProxyLifecycle(req.signal, UPSTREAM_TIMEOUT_MS);

    let upstreamRes: Response | undefined;
    // Do not replay a paid job after an ambiguous upstream failure.
    const retries = ["GET", "HEAD"].includes(options?.method || req.method)
      ? 1
      : 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        upstreamRes = await fetch(fetchUrl, {
          headers,
          method: options?.method || req.method,
          body: requestBody,
          redirect: "manual",
          signal: lifecycle.signal,
        });
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
    if (mediaRequest) {
      let currentUrl = fetchUrl;
      for (
        let hop = 0;
        [301, 302, 303, 307, 308].includes(upstreamRes.status);
        hop++
      ) {
        const location: string | null = upstreamRes.headers.get("location");
        void upstreamRes.body?.cancel().catch(() => {});
        if (!location || hop >= 3) throw new Error("视频文件跳转次数过多");
        const next: URL = new URL(location, currentUrl);
        const sameOrigin = next.origin === new URL(baseUrl).origin;
        if (
          next.username ||
          next.password ||
          (!sameOrigin &&
            (next.protocol !== "https:" ||
              next.port ||
              !/(?:^|\.)(?:googleapis\.com|googleusercontent\.com|blob\.core\.windows\.net|amazonaws\.com)$/.test(
                next.hostname,
              )))
        )
          throw new Error("视频文件跳转地址不受支持");
        const publicHeaders = new Headers({ Accept: "video/*" });
        for (const name of ["range", "if-range"]) {
          const value = headers.get(name);
          if (value) publicHeaders.set(name, value);
        }
        upstreamRes = await fetch(next.href, {
          method: "GET",
          headers: sameOrigin ? headers : publicHeaders,
          redirect: "manual",
          signal: lifecycle.signal,
        });
        currentUrl = next.href;
      }
    }
    const responseBody = lifecycle.stream(upstreamRes.body);

    // 响应头
    const newHeaders = new Headers(upstreamRes.headers);
    newHeaders.delete("www-authenticate");
    newHeaders.delete("content-encoding");
    newHeaders.delete("content-length");
    newHeaders.delete("set-cookie");
    newHeaders.set("X-Accel-Buffering", "no");
    if (mediaRequest) newHeaders.set("Cache-Control", "private, no-store");

    // 上游错误
    if (!upstreamRes.ok) {
      const errorBody = await new Response(responseBody).text();
      let errorMessage = errorBody;
      let reasoningUnsupported = false;
      try {
        const errorJson = JSON.parse(errorBody);
        reasoningUnsupported =
          subpath === "chat/completions" &&
          /^v1beta\/models\/[A-Za-z0-9][A-Za-z0-9._:-]*:(?:generateContent|streamGenerateContent)$/.test(
            options?.upstreamPath ?? "",
          ) &&
          isUnsupportedReasoningError(upstreamRes.status, errorJson);
        errorMessage =
          errorJson.error?.message || errorJson.message || errorBody;
      } catch {}
      const contextLimit = isContextLimitError(errorMessage);
      const status = contextLimit ? 400 : upstreamRes.status;
      const clientMessage = contextLimit
        ? CONTEXT_LIMIT_MESSAGE
        : process.env.NODE_ENV === "production"
        ? `请求失败 (${upstreamRes.status})`
        : errorMessage;
      console.error(
        "[Edge Proxy Upstream Error]",
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
