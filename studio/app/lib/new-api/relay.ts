import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import {
  accountRequest,
  assertSameOrigin,
  getAuthenticatedSession,
  upstreamRequestHints,
} from "./client";
import {
  getNewApiConfig,
  getNewApiImageBaseUrl,
  getNewApiAsyncBaseUrl,
  isNewApiEnabled,
  NewApiError,
} from "./config";
import { resolveSystemAutoToken } from "./model-groups";

const IMAGE_RELAY_PATHS = new Set([
  "images/generations",
  "images/edits",
  "images/variations",
]);

const accountChecks = new WeakMap<NextRequest, Promise<unknown>>();

function verifyAccount(req: NextRequest) {
  let pending = accountChecks.get(req);
  if (!pending) {
    pending = accountRequest(req, "/api/user/self", {
      reuseRequestSession: true,
    });
    accountChecks.set(req, pending);
  }
  return pending;
}

async function authenticatedRelaySession(req: NextRequest) {
  if (!["GET", "HEAD"].includes(req.method)) assertSameOrigin(req);
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    throw new NewApiError("请求来源无效", 403, "NEW_API_CSRF");
  }
  const { session } = await getAuthenticatedSession(req, true);
  // A saved model key must not outlive a revoked dashboard login session.
  await verifyAccount(req);
  return session;
}

export async function resolveRelayCredentials(
  req: NextRequest,
  subpath?: string,
) {
  if (isNewApiEnabled()) {
    const session = await authenticatedRelaySession(req);
    const baseUrl =
      (subpath && /^async-(images|videos)\/v1\//.test(subpath)
        ? getNewApiAsyncBaseUrl()
        : subpath && IMAGE_RELAY_PATHS.has(subpath.replace(/\/$/, ""))
        ? getNewApiImageBaseUrl()
        : undefined) || getNewApiConfig().baseUrl;
    const expectedToken = req.headers.get("x-new-api-token");
    if (
      expectedToken !== null &&
      (expectedToken !== String(session.selectedTokenId) ||
        !session.selectedKey)
    ) {
      if (
        !/^[1-9]\d*$/.test(expectedToken) ||
        !Number.isSafeInteger(Number(expectedToken))
      )
        throw new NewApiError("请求密钥标识无效", 400);
      // Read an owned historical key without changing the current model selection.
      const { data: token } = await accountRequest(
        req,
        `/api/token/${expectedToken}`,
      );
      if (
        !session.user ||
        token?.id !== Number(expectedToken) ||
        token?.user_id !== session.user.id
      )
        throw new NewApiError("无法读取此请求的密钥", 403);
      const { data } = await accountRequest(
        req,
        `/api/token/${expectedToken}/key`,
        {
          method: "POST",
        },
      );
      if (typeof data?.key !== "string" || !data.key.trim())
        throw new NewApiError("此请求的密钥已不可用", 409);
      const key = data.key.trim();
      return {
        baseUrl,
        apiKey: key.startsWith("sk-") ? key : `sk-${key}`,
      };
    }
    if (!session.selectedKey || !session.selectedTokenId) {
      throw new NewApiError(
        "请在“账号与密钥”中选择一个聊天密钥",
        409,
        "NEW_API_TOKEN_REQUIRED",
      );
    }
    return {
      baseUrl,
      apiKey: session.selectedKey,
    };
  }
  const config = getServerSideConfig();
  const custom = req.headers
    .get("x-api-key")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const apiKey = custom || config.apiKey;
  if (!apiKey) {
    throw new NewApiError("请填写 API Key 或配置 MODEL_API_KEY", 500);
  }
  return { baseUrl: config.baseUrl.replace(/\/+$/, ""), apiKey };
}

export async function resolveWebSearchCredentials(req: NextRequest) {
  if (!isNewApiEnabled()) {
    throw new NewApiError("联网搜索需要登录账号", 503);
  }
  await authenticatedRelaySession(req);
  const tokenId = await resolveSystemAutoToken(req);
  const { data } = await accountRequest(req, `/api/token/${tokenId}/key`, {
    method: "POST",
  });
  if (typeof data?.key !== "string" || !data.key.trim()) {
    throw new NewApiError(
      "无法读取 Auto 系统密钥，请在“账号与密钥”中检查",
      409,
    );
  }
  const key = data.key.trim();
  return {
    baseUrl: getNewApiConfig().baseUrl,
    apiKey: key.startsWith("sk-") ? key : `sk-${key}`,
  };
}

export function relayHeaders(
  req: NextRequest,
  apiKey: string,
  mediaRequest = false,
) {
  const headers = new Headers({
    Authorization: `Bearer ${apiKey}`,
    "Cache-Control": "no-store",
  });
  // Only model-request headers cross the trust boundary. Account cookies and
  // dashboard credentials must never reach the model relay.
  for (const name of [
    "content-type",
    "accept",
    "openai-organization",
    "idempotency-key",
  ]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (mediaRequest) {
    const range = req.headers.get("range");
    if (range && /^bytes=\d+-\d*$/.test(range) && range.length < 100) {
      headers.set("Range", range);
      const validator = req.headers.get("if-range");
      if (validator && validator.length <= 200)
        headers.set("If-Range", validator);
    }
  }
  if (isNewApiEnabled()) {
    const { clientIp, userAgent } = upstreamRequestHints(req);
    if (clientIp) {
      headers.set("X-Real-IP", clientIp);
      headers.set("X-Forwarded-For", clientIp);
    }
    if (userAgent) headers.set("User-Agent", userAgent);
  }
  return headers;
}

export function relayErrorResponse(error: unknown) {
  const known = error instanceof NewApiError;
  return NextResponse.json(
    {
      error: true,
      message: known ? error.message : "账号服务暂时不可用",
      code: known ? error.code : "NEW_API_UNAVAILABLE",
    },
    {
      status: known ? error.status : 503,
      headers: {
        "Cache-Control": "private, no-store",
        ...(known && error.retryAfter
          ? { "Retry-After": error.retryAfter }
          : {}),
      },
    },
  );
}
