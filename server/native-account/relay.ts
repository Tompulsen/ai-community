import { AccountRequest, AccountResponse } from "./http.ts";
import {
  accountRequest,
  readAccountToken,
  assertSameOrigin,
  getAuthenticatedSession,
  upstreamRequestHints,
} from "./client.ts";
import {
  getNewApiConfig,
  getNewApiImageBaseUrl,
  getNewApiAsyncBaseUrl,
  isNewApiEnabled,
  NewApiError,
} from "./config.ts";
import { resolveSystemAutoToken } from "./model-groups.ts";
import { getSessionId, preparedModelKey, readSessionById, rememberModelKey, saveSession, withSessionLock, type AccountSession } from "./session.ts";

const IMAGE_RELAY_PATHS = new Set([
  "images/generations",
  "images/edits",
  "images/variations",
]);

const accountChecks = new WeakMap<AccountRequest, Promise<unknown>>();

function verifyAccount(req: AccountRequest) {
  let pending = accountChecks.get(req);
  if (!pending) {
    pending = accountRequest(req, "/api/user/self", {
      reuseRequestSession: true,
      maxResponseBytes: 65536,
    });
    accountChecks.set(req, pending);
  }
  return pending;
}

async function authenticatedRelaySession(req: AccountRequest) {
  if (!["GET", "HEAD"].includes(req.method)) assertSameOrigin(req);
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    throw new NewApiError("请求来源无效", 403, "NEW_API_CSRF");
  }
  const { session } = await getAuthenticatedSession(req, true);
  return session;
}

function requestedGroup(req: AccountRequest) {
  const value = req.headers.get("x-new-api-group");
  if (value === null) return;
  let group: string;
  try { group = decodeURIComponent(value); }
  catch { throw new NewApiError("请求分组无效", 400); }
  if (!group || group !== group.trim() || group.length > 200 || /[\u0000-\u001f\u007f]/u.test(group))
    throw new NewApiError("请求分组无效", 400);
  return group;
}

async function relayTokenKey(req: AccountRequest, session: AccountSession, tokenId: number, group?: string) {
  if (group !== undefined || tokenId !== session.selectedTokenId || !session.selectedKey) {
    const { data: token } = await readAccountToken(req, tokenId);
    if (!session.user || token?.id !== tokenId || token?.user_id !== session.user.id)
      throw new NewApiError("无法读取此请求的密钥", 403);
    // Secrets may be cached; the actual billing group must be checked on every new send.
    if (group !== undefined && (token.group !== group || token.status !== 1 ||
      !(token.expired_time === -1 || token.expired_time > Date.now() / 1000) ||
      !(token.unlimited_quota === true || token.remain_quota > 0)))
      throw new NewApiError("分组密钥已改变或不可用，请重新选择分组", 409, "NEW_API_GROUP_TOKEN_UNAVAILABLE");
  }
  const cached = preparedModelKey(session, tokenId);
  if (cached) return cached;
  const { data } = await accountRequest(req, `/api/token/${tokenId}/key`, {
    method: "POST", reuseRequestSession: true,
  });
  if (typeof data?.key !== "string" || !data.key.trim())
    throw new NewApiError("此请求的密钥已不可用", 409);
  const key = data.key.trim().startsWith("sk-") ? data.key.trim() : `sk-${data.key.trim()}`;
  await rememberModelKey(req, session, tokenId, key);
  return key;
}

export async function resolveRelayCredentials(
  req: AccountRequest,
  subpath?: string,
) {
  if (isNewApiEnabled()) {
    const session = await authenticatedRelaySession(req);
    const baseUrl =
      (subpath && /^async-(images|videos)\/v1\//.test(subpath)
        ? getNewApiAsyncBaseUrl()
        : subpath && IMAGE_RELAY_PATHS.has(subpath.replace(/^v1\//, "").replace(/\/$/, ""))
        ? getNewApiImageBaseUrl()
        : undefined) || getNewApiConfig().baseUrl;
    const expectedToken = req.headers.get("x-new-api-token");
    if (expectedToken !== null && (!/^[1-9]\d*$/.test(expectedToken) || !Number.isSafeInteger(Number(expectedToken))))
      throw new NewApiError("请求密钥标识无效", 400);
    const group = requestedGroup(req);
    const tokenId = expectedToken !== null ? Number(expectedToken) : session.selectedTokenId;
    if (group !== undefined && !tokenId)
      throw new NewApiError("分组密钥尚未准备，请重新选择分组", 409, "NEW_API_TOKEN_REQUIRED");
    if (tokenId) {
      const [, key] = await Promise.all([
        verifyAccount(req), relayTokenKey(req, session, tokenId, group),
      ]);
      return {
        baseUrl,
        apiKey: key,
        tokenId,
        userId: session.user!.id,
      };
    }
    // A saved model key must not outlive a revoked dashboard login session.
    await verifyAccount(req);
    if (!session.selectedKey || !session.selectedTokenId) {
      const tokenId = await resolveSystemAutoToken(req);
      const { data: result } = await accountRequest(req, `/api/token/${tokenId}/key`, { method: "POST", reuseRequestSession: true });
      if (typeof result?.key !== "string" || !result.key.trim())
        throw new NewApiError("此账号的创作密钥暂时不可用", 409, "NEW_API_TOKEN_REQUIRED");
      const key = result.key.trim();
      const id = getSessionId(req);
      if (!id) throw new NewApiError("请先登录章鱼账号", 401, "NEW_API_LOGIN_REQUIRED");
      await withSessionLock(id, async () => {
        const current = await readSessionById(id);
        if (!current?.user || current.user.id !== session.user?.id)
          throw new NewApiError("账号已变化，请重新登录", 401, "NEW_API_ACCOUNT_CHANGED");
        if (!current.selectedKey || !current.selectedTokenId) {
          current.selectedTokenId = tokenId;
          current.selectedKey = key.startsWith("sk-") ? key : `sk-${key}`;
          current.version++;
          await saveSession(id, current);
        }
        session.selectedTokenId = current.selectedTokenId;
        session.selectedKey = current.selectedKey;
      });
    }
    return {
      baseUrl,
      apiKey: session.selectedKey!,
      tokenId: session.selectedTokenId!,
      userId: session.user!.id,
    };
  }
  throw new NewApiError("章鱼账号服务尚未配置", 503, "NEW_API_DISABLED");
}

export async function resolveWebSearchCredentials(req: AccountRequest) {
  if (!isNewApiEnabled()) {
    throw new NewApiError("联网搜索需要登录账号", 503);
  }
  const session = await authenticatedRelaySession(req);
  await verifyAccount(req);
  const tokenId = await resolveSystemAutoToken(req);
  const key = await relayTokenKey(req, session, tokenId, "auto");
  return {
    baseUrl: getNewApiConfig().baseUrl,
    apiKey: key.startsWith("sk-") ? key : `sk-${key}`,
    userId: session.user!.id,
  };
}

export function relayHeaders(
  req: AccountRequest,
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
  return AccountResponse.json(
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
