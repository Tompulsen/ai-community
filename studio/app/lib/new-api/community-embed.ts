import { createHash, randomBytes } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import {
  accountRequest,
  assertSameOrigin,
  authBundle,
  getAuthenticatedSession,
  sanitizeUser,
  upstream,
  upstreamRequestHints,
} from "./client";
import {
  AccountSession,
  SESSION_COOKIE,
  getNewApiRedis,
  readSessionById,
  saveSession,
  removeSessionById,
  withSessionLock,
} from "./session";
import {
  CommunityBinding,
  OPAQUE,
  bindingForRequest,
  communityRequest,
  embedConfig,
  embedContext,
  embeddedCookie,
  validateCommunityBinding,
} from "./community-embed-validation";
import { NewApiError } from "./config";

const PREFIX = "octopus:community-embed:";
const FLOW_COOKIE = "__Host-octopus-embed-authorization";
const TTL = 7 * 24 * 60 * 60;
const random = () => randomBytes(32).toString("base64url");
const hash = (text: string) =>
  createHash("sha256").update(text).digest("base64url");
type Kind = "text" | "image" | "video";
type Launch = CommunityBinding & { kind: Kind; returnTo?: string; generation?: string };
type Pending = { launch: Launch; browser: string; verifier: string };
type Selection = (
  req: NextRequest,
  credentials: ReturnType<typeof authBundle>,
) => Promise<{ selectedTokenId?: number; selectedKey?: string }>;

function store() {
  const redis = getNewApiRedis();
  if (!redis) throw new Error("Session store unavailable");
  return redis;
}
function returnPath(value: unknown, kind: Kind = "text") {
  return typeof value === "string" &&
    /^\/create\/(text|image|video)(\?remix=[a-zA-Z0-9]{1,32})?$/.test(value)
    ? value
    : `/create/${kind}`;
}
function grantKey(launch: CommunityBinding) {
  return (
    PREFIX +
    "grant:" +
    hash(
      JSON.stringify([
        launch.community,
        launch.studio,
        launch.issuer,
        launch.subject,
        launch.userId,
        launch.tokenHash,
        launch.context,
      ]),
    )
  );
}
function json(data: object) {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
function redirect(target: string) {
  const res = NextResponse.redirect(target, 303);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
function flowCookie(res: NextResponse, value: string, maxAge: number, state: string) {
  res.cookies.set(`${FLOW_COOKIE}-${hash(state)}`, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}
async function consume(key: string, value: string) {
  return (
    (await store().eval(
      'if redis.call("GET",KEYS[1]) == ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end',
      1,
      key,
      value,
    )) === 1
  );
}
async function revoke(
  session: Pick<AccountSession, "refreshToken" | "upstreamSessionId">,
) {
  if (session.refreshToken)
    await upstream("/api/user/auth/logout", {
      method: "POST",
      refreshToken: session.refreshToken,
      upstreamSessionId: session.upstreamSessionId,
    });
}

async function initialize(req: NextRequest) {
  assertSameOrigin(req);
  const config = embedConfig();
  const context = embedContext(req);
  const input = await req.json();
  if (!context || typeof input.code !== "string" || !OPAQUE.test(input.code))
    throw new Error("Invalid launch");
  const data = await communityRequest("exchange", { code: input.code });
  if (
    data.issuer !== config.issuer ||
    data.studio !== config.studio ||
    data.context !== context ||
    !["text", "image", "video"].includes(data.kind) ||
    typeof data.subject !== "string" ||
    !/^[1-9]\d{0,15}$/.test(data.subject) ||
    !Number.isSafeInteger(Number(data.subject)) ||
    typeof data.userId !== "string" ||
    !/^[a-zA-Z0-9]{1,32}$/.test(data.userId) ||
    typeof data.tokenHash !== "string" ||
    !OPAQUE.test(data.tokenHash)
  )
    throw new Error("Invalid identity");
  const launch: Launch = {
    community: config.community,
    studio: config.studio,
    issuer: data.issuer,
    subject: data.subject,
    userId: data.userId,
    tokenHash: data.tokenHash,
    context,
    kind: data.kind,
    returnTo: returnPath(data.returnTo, data.kind),
  };
  const id = await store().get(grantKey(launch));
  const session = id ? await readSessionById(id) : null;
  if (
    id &&
    session?.communityEmbed &&
    session.user &&
    String(session.user.id) === launch.subject &&
    grantKey(session.communityEmbed) === grantKey(launch)
  ) {
    await validateCommunityBinding(launch);
    const res = json({
      status: "verify",
      subject: launch.subject,
      userId: launch.userId,
      kind: launch.kind,
    });
    res.cookies.set(embeddedCookie(context), id, {
      secure: true,
      httpOnly: true,
      sameSite: "none",
      partitioned: true,
      path: "/",
      maxAge: Math.max(1, Math.floor(session.expiresAt - Date.now() / 1000)),
    });
    return res;
  }
  const loginId = req.cookies.get(SESSION_COOKIE)?.value || "";
  if (!OPAQUE.test(loginId))
    throw new NewApiError("请先登录章鱼账号", 401, "NEW_API_LOGIN_REQUIRED");
  const { expiresAt, removedContexts } = await withSessionLock(loginId, async () => {
    const login = await readSessionById(loginId);
    if (!login?.user || !login.accessToken || !login.refreshToken)
      throw new NewApiError("请先登录章鱼账号", 401, "NEW_API_LOGIN_REQUIRED");
    if (login.communityEmbed || String(login.user.id) !== launch.subject)
      throw new NewApiError(
        "章鱼账号已变化，请重新登录社区",
        409,
        "NEW_API_ACCOUNT_CHANGED",
      );
    await validateCommunityBinding(launch);
    // All contexts keep the same refresh chain and lock as the account login.
    const bindings: [string, CommunityBinding][] = [
      ...Object.entries(login.communityBindings || {}).filter(([key]) => key !== context),
      [context, launch],
    ];
    const removedContexts = bindings.slice(0, Math.max(0, bindings.length - 16))
      .map(([key]) => key);
    login.communityBindings = Object.fromEntries(bindings.slice(-16));
    login.version++;
    await saveSession(loginId, login);
    return { expiresAt: login.expiresAt, removedContexts };
  });
  const res = json({
    status: "verify",
    subject: launch.subject,
    userId: launch.userId,
    kind: launch.kind,
  });
  res.cookies.set(embeddedCookie(context), loginId, {
    secure: true,
    httpOnly: true,
    sameSite: "none",
    partitioned: true,
    path: "/",
    maxAge: Math.max(1, Math.floor(expiresAt - Date.now() / 1000)),
  });
  for (const previousContext of removedContexts) {
    res.cookies.set(embeddedCookie(previousContext), "", {
      secure: true,
      httpOnly: true,
      sameSite: "none",
      partitioned: true,
      path: "/",
      maxAge: 0,
    });
  }
  return res;
}

async function authorize(req: NextRequest) {
  if (
    req.headers.has("sec-fetch-dest") &&
    req.headers.get("sec-fetch-dest") !== "document"
  )
    throw new Error("Top-level authorization required");
  const config = embedConfig();
  const ticket = req.nextUrl.searchParams.get("ticket") || "";
  if (!OPAQUE.test(ticket)) throw new Error("Invalid authorization");
  const key = PREFIX + "authorize:" + hash(ticket),
    raw = await store().get(key);
  if (!raw || !(await consume(key, raw)))
    throw new Error("Authorization expired");
  const launch = JSON.parse(raw) as Launch;
  await validateCommunityBinding(launch);
  const state = random(),
    browser = random(),
    verifier = random();
  const pending: Pending = { launch, browser: hash(browser), verifier };
  await store().set(
    PREFIX + "state:" + hash(state),
    JSON.stringify(pending),
    "EX",
    600,
  );
  const target = new URL("/community-authorize", config.issuer);
  target.search = new URLSearchParams({
    client_id: config.studio,
    redirect_uri: config.studio + "/api/new-api/community/callback",
    response_type: "code",
    scope: "chat_session",
    expected_subject: launch.subject,
    state,
    code_challenge: hash(verifier),
    code_challenge_method: "S256",
  }).toString();
  const res = redirect(target.href);
  flowCookie(res, browser, 600, state);
  return res;
}

async function callback(
  req: NextRequest,
  select: Selection,
  raw: string,
  key: string,
) {
  const config = embedConfig(),
    pending = JSON.parse(raw) as Pending;
  const code = req.nextUrl.searchParams.get("code") || "",
    browser = req.cookies.get(`${FLOW_COOKIE}-${hash(req.nextUrl.searchParams.get("state") || "")}`)?.value || "";
  if (
    ![code, browser].every((v) => OPAQUE.test(v)) ||
    pending.browser !== hash(browser)
  )
    throw new Error("Invalid browser");
  await validateCommunityBinding(pending.launch);
  if (
    !pending.launch.generation ||
    (await store().get(grantKey(pending.launch) + ":generation")) !==
      pending.launch.generation
  )
    throw new Error("Authorization superseded");
  if (!(await consume(key, raw))) throw new Error("Authorization already used");
  let issued:
    | Pick<AccountSession, "refreshToken" | "upstreamSessionId">
    | undefined;
  let adopted = false;
  let id: string | undefined;
  try {
    const result = await upstream("/api/studio-sso/token", {
      method: "POST",
      body: {
        grant_type: "authorization_code",
        client_id: config.studio,
        redirect_uri: config.studio + "/api/new-api/community/callback",
        code,
        code_verifier: pending.verifier,
        expected_subject: pending.launch.subject,
      },
      ...upstreamRequestHints(req),
    });
    issued = {
      refreshToken: result.refreshToken,
      upstreamSessionId:
        typeof result.data?.session?.sid === "string"
          ? result.data.session.sid
          : result.refreshToken?.split(".")[0],
    };
    const credentials = authBundle(result.data, result.refreshToken);
    const user = sanitizeUser(
      (
        await upstream("/api/user/self", {
          accessToken: credentials.accessToken,
        })
      ).data,
    );
    if (
      String(user.id) !== pending.launch.subject ||
      credentials.user.id !== user.id
    )
      throw new Error("Account mismatch");
    const selection = await select(req, credentials);
    await validateCommunityBinding(pending.launch);
    const now = Math.floor(Date.now() / 1000);
    const session: AccountSession = {
      ...credentials,
      user,
      ...selection,
      communityEmbed: pending.launch,
      createdAt: now,
      expiresAt: now + TTL,
      version: 1,
    };
    id = random();
    await saveSession(id, session);
    // Publish one independent refresh chain. The standalone chat session is untouched.
    const grant = grantKey(pending.launch);
    const published = (await store().eval(
      'if redis.call("GET",KEYS[2])~=ARGV[1] then return {0,""} end; local old=redis.call("GET",KEYS[1]) or ""; redis.call("SET",KEYS[1],ARGV[2],"EX",ARGV[3]); redis.call("DEL",KEYS[2]); return {1,old}',
      2,
      grant,
      grant + ":generation",
      pending.launch.generation!,
      id,
      TTL,
    )) as [number, string];
    if (published[0] !== 1) throw new Error("Authorization superseded");
    const oldId = published[1];
    adopted = true;
    if (oldId && oldId !== id)
      after(async () => {
        try {
          await withSessionLock(oldId, async () => {
            const previous = await readSessionById(oldId);
            await removeSessionById(oldId);
            if (previous) await revoke(previous);
          });
        } catch {}
      });
    const res = redirect(config.community + returnPath(pending.launch.returnTo, pending.launch.kind));
    if (OPAQUE.test(req.nextUrl.searchParams.get("state") || "")) flowCookie(res, "", 0, req.nextUrl.searchParams.get("state")!);
    return res;
  } finally {
    if (!adopted) {
      if (id) try { await removeSessionById(id); } catch { /* Upstream revocation must still run. */ }
      if (issued)
        try {
          await revoke(issued);
        } catch {}
    }
  }
}

export async function handleCommunityEmbed(
  req: NextRequest,
  route: string,
  select: Selection,
) {
  let callbackRaw: string | null = null,
    callbackKey = "";
  let returnTo = returnPath(req.nextUrl.searchParams.get("returnTo"));
  if (route === "community/callback" && req.method === "GET") {
    const state = req.nextUrl.searchParams.get("state") || "";
    if (OPAQUE.test(state)) {
      callbackKey = PREFIX + "state:" + hash(state);
      callbackRaw = await store().get(callbackKey);
    }
    if (!callbackRaw) return null;
  } else if (!route.startsWith("community/embedded/")) return null;
  try {
    if (callbackRaw) {
      const pending = JSON.parse(callbackRaw) as Pending;
      returnTo = returnPath(pending.launch.returnTo, pending.launch.kind);
      return await callback(req, select, callbackRaw, callbackKey);
    }
    if (route === "community/embedded/authorize" && req.method === "GET")
      return await authorize(req);
    if (route === "community/embedded/init" && req.method === "POST")
      return await initialize(req);
    if (route === "community/embedded/verify" && req.method === "POST") {
      assertSameOrigin(req);
      if (!embedContext(req)) throw new Error("Embedded session required");
      const { session } = await getAuthenticatedSession(req, true);
      const user = sanitizeUser(
        (await accountRequest(req, "/api/user/self", { reuseRequestSession: true })).data,
      );
      const binding = bindingForRequest(req, session);
      if (!binding || String(user.id) !== binding.subject)
        throw new Error("Account mismatch");
      return json({
        status: "ready",
        context: binding.context,
        subject: String(user.id),
        userId: binding.userId,
        username: user.username,
      });
    }
    return json({ status: "error", code: "COMMUNITY_INVALID_REQUEST" });
  } catch (error) {
    if (req.method === "GET") {
      // Only fixed codes and Fetch Metadata are logged; tickets and credentials stay private.
      console.warn("[Community studio] Authorization failed", {
        stage: route === "community/callback" ? "callback" : "authorize",
        code: error instanceof NewApiError ? error.code :
          error instanceof Error && error.message === "Top-level authorization required" ? "NAVIGATION_REQUIRED" :
          error instanceof Error && error.message === "Authorization expired" ? "AUTHORIZATION_EXPIRED" : "AUTHORIZATION_FAILED",
        destination: req.headers.get("sec-fetch-dest")?.slice(0, 32) || "missing",
        mode: req.headers.get("sec-fetch-mode")?.slice(0, 32) || "missing",
      });
      const target = new URL(returnTo, embedConfig().community);
      target.searchParams.set("studio", "authorization-failed");
      const res = redirect(target.href);
      if (OPAQUE.test(req.nextUrl.searchParams.get("state") || "")) flowCookie(res, "", 0, req.nextUrl.searchParams.get("state")!);
      return res;
    }
    return NextResponse.json(
      {
        status: "error",
        code:
          error instanceof NewApiError
            ? error.code
            : "COMMUNITY_CONNECTION_FAILED",
      },
      {
        status: error instanceof NewApiError ? error.status : 400,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
