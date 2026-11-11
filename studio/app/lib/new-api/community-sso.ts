import { createHash, randomBytes } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import {
  accountRequest,
  authBundle,
  getAuthenticatedSession,
  sanitizeUser,
  upstream,
  upstreamRequestHints,
} from "./client";
import { NewApiError, requireNewApiConfig } from "./config";
import {
  AccountSession,
  createSession,
  getNewApiRedis,
  getSessionId,
  readSession,
} from "./session";

const COOKIE = "__Host-octopus-community";
const PREFIX = "octopus:community-sso:";
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const random = () => randomBytes(32).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest("base64url");
type Kind = "text" | "image" | "video";
type Pending = {
  browser: string;
  subject: string;
  kind: Kind;
  verifier: string;
  oldSession: string | null;
  issuer: string;
  community: string;
  studio: string;
};
type Selection = (
  req: NextRequest,
  credentials: ReturnType<typeof authBundle>,
) => Promise<{ selectedTokenId?: number; selectedKey?: string }>;

function origin(raw: string | undefined) {
  const u = new URL(raw || "invalid");
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw new Error("Invalid SSO origin");
  return u.origin;
}

function config() {
  const api = requireNewApiConfig();
  const community = origin(process.env.COMMUNITY_SSO_ORIGIN);
  const studio = origin(process.env.STUDIO_PUBLIC_ORIGIN);
  const secret = process.env.COMMUNITY_SSO_SECRET || "";
  if (secret.length < 32 || !api.redisUrl)
    throw new Error("Community sign-in not configured");
  return { community, studio, secret, issuer: origin(api.publicUrl) };
}

function cookie(res: NextResponse, value: string, maxAge: number) {
  res.cookies.set(COOKIE, value, {
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

function redirectTo(url: string) {
  const res = NextResponse.redirect(url, 303);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

async function revoke(
  session?: Pick<AccountSession, "refreshToken" | "upstreamSessionId"> | null,
) {
  if (!session?.refreshToken) return;
  await upstream("/api/user/auth/logout", {
    method: "POST",
    refreshToken: session.refreshToken,
    upstreamSessionId: session.upstreamSessionId,
  });
}

async function start(req: NextRequest) {
  const cfg = config();
  const code = req.nextUrl.searchParams.get("code") || "";
  if (!OPAQUE.test(code)) throw new Error("Invalid launch");
  const response = await fetch(cfg.community + "/api/newapi/studio/exchange", {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.secret}`,
    },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) throw new Error("Launch expired");
  const launch = await response.json();
  if (
    launch.issuer !== cfg.issuer ||
    launch.studio !== cfg.studio ||
    typeof launch.subject !== "string" ||
    !/^[1-9]\d{0,15}$/.test(launch.subject) ||
    !Number.isSafeInteger(Number(launch.subject)) ||
    !["text", "image", "video"].includes(launch.kind)
  )
    throw new Error("Invalid launch identity");
  const existing = await readSession(req);
  if (existing?.user && String(existing.user.id) === launch.subject) {
    try {
      const { session } = await getAuthenticatedSession(req);
      const { data } = await accountRequest(req, "/api/user/self");
      if (String(data?.id) === launch.subject && session.user?.id === data.id)
        return redirectTo(cfg.studio + "/studio/");
    } catch {
      /* A stale login needs original-site authorization again. */
    }
  }
  const state = random(),
    browser = random(),
    verifier = random();
  const res = redirectTo(cfg.studio + "/studio/");
  let oldSession = getSessionId(req);
  if (!(await readSession(req)))
    oldSession = (await createSession(req, res, { communityPending: true })).id;
  const pending: Pending = {
    browser: hash(browser),
    subject: launch.subject,
    kind: launch.kind,
    verifier,
    oldSession,
    issuer: cfg.issuer,
    community: cfg.community,
    studio: cfg.studio,
  };
  const store = getNewApiRedis();
  if (!store) throw new Error("SSO store unavailable");
  await store.set(PREFIX + hash(state), JSON.stringify(pending), "EX", 600);
  const target = new URL("/community-authorize", cfg.issuer);
  target.search = new URLSearchParams({
    client_id: cfg.studio,
    redirect_uri: cfg.studio + "/api/new-api/community/callback",
    response_type: "code",
    scope: "chat_session",
    expected_subject: pending.subject,
    state,
    code_challenge: hash(verifier),
    code_challenge_method: "S256",
  }).toString();
  res.headers.set("Location", target.href);
  cookie(res, browser, 600);
  return res;
}

async function callback(req: NextRequest, select: Selection) {
  const cfg = config();
  const state = req.nextUrl.searchParams.get("state") || "";
  const code = req.nextUrl.searchParams.get("code") || "";
  const browser = req.cookies.get(COOKIE)?.value || "";
  if (![state, code, browser].every((v) => OPAQUE.test(v)))
    throw new Error("Invalid callback");
  const store = getNewApiRedis();
  if (!store) throw new Error("SSO store unavailable");
  const key = PREFIX + hash(state),
    raw = await store.get(key);
  if (!raw) throw new Error("Callback expired");
  const pending = JSON.parse(raw) as Pending;
  if (
    pending.browser !== hash(browser) ||
    pending.issuer !== cfg.issuer ||
    pending.community !== cfg.community ||
    pending.studio !== cfg.studio ||
    pending.oldSession !== getSessionId(req)
  )
    throw new Error("Browser or account changed");
  if (
    (await store.eval(
      'if redis.call("GET",KEYS[1]) == ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end',
      1,
      key,
      raw,
    )) !== 1
  )
    throw new Error("Callback already used");
  let credentials: ReturnType<typeof authBundle> | undefined;
  let revokeOnFailure:
    | Pick<AccountSession, "refreshToken" | "upstreamSessionId">
    | undefined;
  let adopted = false;
  try {
    const result = await upstream("/api/studio-sso/token", {
      method: "POST",
      body: {
        grant_type: "authorization_code",
        client_id: cfg.studio,
        redirect_uri: cfg.studio + "/api/new-api/community/callback",
        code,
        code_verifier: pending.verifier,
        expected_subject: pending.subject,
      },
      ...upstreamRequestHints(req),
    });
    revokeOnFailure = {
      refreshToken: result.refreshToken,
      upstreamSessionId:
        typeof result.data?.session?.sid === "string"
          ? result.data.session.sid
          : result.refreshToken?.split(".")[0],
    };
    credentials = authBundle(result.data, result.refreshToken);
    const { data } = await upstream("/api/user/self", {
      accessToken: credentials.accessToken,
    });
    const user = sanitizeUser(data);
    if (String(user.id) !== pending.subject || credentials.user.id !== user.id)
      throw new Error("Account mismatch");
    credentials.user = user;
    const previous = await readSession(req);
    if (!previous || !pending.oldSession)
      throw new Error("Previous login no longer exists");
    const bundle = { ...credentials, ...(await select(req, credentials)) };
    const res = redirectTo(cfg.studio + "/studio/");
    await createSession(req, res, bundle, {
      id: pending.oldSession,
      version: previous.version,
    });
    adopted = true;
    cookie(res, "", 0);
    // A replaced chat login must not accumulate active upstream sessions.
    after(async () => {
      try {
        await revoke(previous);
      } catch {
        /* The new verified login is already returned. */
      }
    });
    return res;
  } finally {
    if (revokeOnFailure && !adopted) {
      try {
        await revoke(revokeOnFailure);
      } catch {
        /* Original local session stays intact on failure. */
      }
    }
  }
}

export async function handleCommunitySso(
  req: NextRequest,
  route: string,
  select: Selection,
) {
  if (!["community/start", "community/callback"].includes(route)) return null;
  // Only these top-level navigation routes accept cross-site traffic. All other
  // account endpoints and model relays retain their original CSRF checks.
  if (
    req.method !== "GET" ||
    (req.headers.has("sec-fetch-dest") &&
      req.headers.get("sec-fetch-dest") !== "document") ||
    (req.headers.has("sec-fetch-mode") &&
      req.headers.get("sec-fetch-mode") !== "navigate")
  )
    throw new NewApiError("请从社区重新进入制作页面", 403);
  try {
    return route === "community/start"
      ? await start(req)
      : await callback(req, select);
  } catch {
    let back = "/";
    try {
      back = config().community + "/community";
    } catch {
      /* No untrusted return URL. */
    }
    const res = new NextResponse(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>登录未完成 · Sign-in incomplete</title><body style="font-family:system-ui;background:#f5f6fa;color:#20242e;max-width:34rem;margin:12vh auto;padding:24px"><h1>暂时无法进入制作页面</h1><p>登录请求已过期，或当前账号发生了变化。请返回社区，使用对应的章鱼账号重新进入。</p><p>Sign-in expired or the account changed. Return to the community and continue with the matching 章鱼 account.</p><a href="${back}">返回社区 · Back to community</a></body></html>`,
      {
        status: 400,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        },
      },
    );
    cookie(res, "", 0);
    return res;
  }
}
