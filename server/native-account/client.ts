import type { AccountRequest } from "./http.ts";
import { assertNormalSession } from "./transport.ts";
import { isIP } from "node:net";
import {
  constants,
  createCipheriv,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { NewApiError, requireNewApiConfig } from "./config.ts";
import {
  type AccountSession,
  type AccountUser,
  getSessionId,
  readSessionById,
  removeSessionById,
  saveSession,
  withSessionLock,
} from "./session.ts";

type UpstreamEnvelope = {
  success?: boolean;
  message?: string;
  code?: string;
  data?: any;
  url?: unknown;
};

export async function upstream(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    accessToken?: string;
    refreshToken?: string;
    upstreamSessionId?: string;
    clientIp?: string;
    userAgent?: string;
    paymentEnvelope?: boolean;
    maxResponseBytes?: number;
  } = {},
) {
  const config = requireNewApiConfig();
  const headers = new Headers({
    Accept: "application/json",
    Origin: config.publicUrl,
    "Content-Type": "application/json",
  });
  if (options.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  }
  if (options.refreshToken) {
    headers.set("Cookie", `new_api_refresh=${options.refreshToken}`);
  }
  if (options.upstreamSessionId) {
    headers.set("X-Auth-Session", options.upstreamSessionId);
  }
  if (options.clientIp) {
    headers.set("X-Real-IP", options.clientIp);
    headers.set("X-Forwarded-For", options.clientIp);
  }
  if (options.userAgent) headers.set("User-Agent", options.userAgent);
  let response: Response;
  try {
    response = await fetch(config.baseUrl + path, {
      method: options.method || "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new NewApiError("无法连接账号服务，请稍后重试", 502);
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after") || "";
    throw new NewApiError(
      "账号操作过于频繁，请稍后重试",
      429,
      "NEW_API_RATE_LIMIT",
      /^\d{1,6}$/.test(retryAfter) ? retryAfter : undefined,
    );
  }
  let json: UpstreamEnvelope;
  try {
    if (options.maxResponseBytes && response.body) {
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > options.maxResponseBytes) throw new Error("Account response too large");
        chunks.push(chunk);
      }
      json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as UpstreamEnvelope;
    } else json = await response.json() as UpstreamEnvelope;
  } catch {
    if (!response.ok) {
      throw new NewApiError("账号服务请求失败，请稍后重试", response.status);
    }
    throw new NewApiError("账号服务返回了无法识别的响应", 502);
  }
  if (
    !response.ok ||
    json.success === false ||
    (options.paymentEnvelope &&
      json.success !== true &&
      json.message !== "success")
  ) {
    // Some account servers encode a deleted token as HTTP 200 + this error.
    const missingToken =
      (options.method || "GET") === "GET" &&
      /^\/api\/token\/[1-9]\d*$/.test(path) &&
      [200, 400, 404].includes(response.status) &&
      json.success === false &&
      typeof json.message === "string" &&
      json.message.trim().toLowerCase() === "record not found";
    throw new NewApiError(
      options.paymentEnvelope && typeof json.data === "string"
        ? json.data.slice(0, 300)
        : typeof json.message === "string"
        ? json.message.slice(0, 300)
        : "账号服务请求失败",
      missingToken ? 404 : response.ok ? 400 : response.status,
      typeof json.code === "string" ? json.code : "NEW_API_UPSTREAM",
    );
  }
  const cookies = response.headers.getSetCookie?.() || [
    response.headers.get("set-cookie") || "",
  ];
  const refreshToken = cookies
    .map((cookie) => cookie.match(/(?:^|,\s*)new_api_refresh=([^;,\s]*)/)?.[1])
    .find(Boolean);
  return {
    data: json.data,
    refreshToken,
    url:
      options.paymentEnvelope && typeof json.url === "string"
        ? json.url
        : undefined,
  };
}

export function upstreamRequestHints(req: AccountRequest) {
  const candidate = req.headers.get("x-real-ip")?.trim() || "";
  return {
    clientIp:
      process.env.NEW_API_TRUST_PROXY === "true" && isIP(candidate)
        ? candidate
        : undefined,
    userAgent: req.headers.get("user-agent")?.slice(0, 512),
  };
}

export function sanitizeUser(user: any): AccountUser {
  if (!Number.isSafeInteger(user?.id) || user.id <= 0
    || typeof user.username !== "string" || !user.username || user.username.length > 128
    || /[\u0000-\u001f\u007f]/.test(user.username)
    || (user.display_name !== undefined && typeof user.display_name !== "string")) {
    throw new NewApiError("账号服务返回了无效的用户信息", 502);
  }
  return {
    id: user.id,
    username: String(user.username || ""),
    display_name: String(user.display_name || user.username || ""),
    quota: Number(user.quota || 0),
    used_quota: Number(user.used_quota || 0),
    request_count: Number(user.request_count || 0),
    group: String(user.group || ""),
  };
}

export function authBundle(data: any, refreshToken?: string) {
  if (
    typeof data?.access_token !== "string" ||
    !data.access_token ||
    !Number.isFinite(data.access_expires_at) ||
    typeof data.session?.sid !== "string" ||
    !data.session.sid ||
    !refreshToken
  ) {
    throw new NewApiError(
      "当前账号服务的登录协议不兼容，请检查章鱼后台版本",
      502,
    );
  }
  return {
    user: sanitizeUser(data.user),
    accessToken: data.access_token as string,
    accessExpiresAt: data.access_expires_at as number,
    upstreamSessionId: data.session.sid as string,
    refreshToken,
  };
}

export async function loginCredentials(
  username: string,
  password: string,
  encrypted: boolean,
) {
  if (!encrypted) return { username, password };
  const { data } = await upstream("/api/user/login/encryption-key");
  if (
    !data?.enabled ||
    typeof data.kid !== "string" ||
    typeof data.public_key !== "string"
  ) {
    throw new NewApiError("无法获取登录加密公钥，请稍后重试", 502);
  }
  const secret = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  cipher.setAAD(Buffer.from(`password-v2:${data.kid}`));
  const ciphertext = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const wrapped = publicEncrypt(
    {
      key: data.public_key,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
      oaepLabel: Buffer.from("password-v2"),
    },
    secret,
  );
  return {
    username,
    password_encrypted: [
      "v2",
      wrapped.toString("base64"),
      iv.toString("base64"),
      ciphertext.toString("base64"),
    ].join("."),
    encryption_key_id: data.kid,
  };
}

export function assertExpectedUser(req: AccountRequest, userId: number) {
  const expected = req.headers.get("x-new-api-user");
  if (expected !== null && expected !== String(userId)) {
    throw new NewApiError(
      "当前账号已在其他页面变更，请刷新后重试",
      409,
      "NEW_API_ACCOUNT_CHANGED",
    );
  }
}

const requestSessions = new WeakMap<
  AccountRequest,
  ReturnType<typeof authenticateSession>
>();

/** Model proxies may reuse one snapshot; account mutations must read afresh. */
export function getAuthenticatedSession(
  req: AccountRequest,
  reuseRequestSession = false,
) {
  if (!reuseRequestSession) return authenticateSession(req);
  let pending = requestSessions.get(req);
  if (!pending) {
    pending = authenticateSession(req);
    requestSessions.set(req, pending);
  }
  return pending;
}

async function authenticateSession(req: AccountRequest) {
  requireNewApiConfig();
  const id = getSessionId(req);
  if (!id)
    throw new NewApiError("请先登录章鱼账号", 401, "NEW_API_LOGIN_REQUIRED");
  return withSessionLock(id, async () => {
    let session = await readSessionById(id);
    if (!session?.user || !session.accessToken || !session.refreshToken) {
      throw new NewApiError("请先登录章鱼账号", 401, "NEW_API_LOGIN_REQUIRED");
    }
    assertNormalSession(req, session);
    assertExpectedUser(req, session.user.id);
    if ((session.accessExpiresAt || 0) <= Date.now() / 1000 + 30) {
      try {
        const refreshed = await upstream("/api/user/auth/refresh", {
          method: "POST",
          refreshToken: session.refreshToken,
          upstreamSessionId: session.upstreamSessionId,
          ...upstreamRequestHints(req),
        });
        const bundle = authBundle(refreshed.data, refreshed.refreshToken);
        if (bundle.user.id !== session.user.id) {
          throw new NewApiError("账号会话不匹配，请重新登录", 401);
        }
        session = { ...session, ...bundle, version: session.version + 1 };
        await saveSession(id, session);
      } catch (error) {
        if (error instanceof NewApiError && error.status === 401) {
          await removeSessionById(id);
        }
        throw error;
      }
    }
    return { id, session };
  });
}

export async function accountRequest(
  req: AccountRequest,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    reuseRequestSession?: boolean;
    paymentEnvelope?: boolean;
    maxResponseBytes?: number;
  } = {},
) {
  const { reuseRequestSession, ...requestOptions } = options;
  const { id, session } = await getAuthenticatedSession(
    req,
    reuseRequestSession,
  );
  try {
    const result = await upstream(path, {
      ...requestOptions,
      accessToken: session.accessToken,
      ...upstreamRequestHints(req),
    });
    if (path === "/api/user/self" && sanitizeUser(result.data).id !== session.user?.id)
      throw new NewApiError("账号已变化，请重新登录", 401, "NEW_API_ACCOUNT_CHANGED");
    return result;
  } catch (error) {
    if (error instanceof NewApiError && error.status === 401) {
      await removeSessionById(id);
    }
    throw error;
  }
}

export function publicSession(session: AccountSession | null) {
  return {
    authenticated: Boolean(session?.user && session.accessToken),
    user: session?.user || null,
    selectedTokenId: session?.selectedTokenId || null,
  };
}

export function assertSameOrigin(req: AccountRequest) {
  const origin = req.headers.get("origin");
  let valid = false;
  try {
    const parsed = new URL(origin || "");
    valid =
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.host === req.headers.get("host");
  } catch {}
  if (!valid || req.headers.get("sec-fetch-site") === "cross-site") {
    throw new NewApiError(
      "请求来源无效，请刷新页面后重试",
      403,
      "NEW_API_CSRF",
    );
  }
}
