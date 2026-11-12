import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { sealData, unsealData } from "iron-session";
import { Redis } from "ioredis";
import { AccountRequest, AccountResponse } from "./http.ts";
import { NewApiError, requireNewApiConfig } from "./config.ts";
import {
  type CommunityBinding,
  assertNormalRequest,
  assertNormalSession,
} from "./transport.ts";

export const SESSION_COOKIE = "octopus_new_api_session";
const SESSION_TTL = 7 * 24 * 60 * 60;
const PREFIX = "octopus:new-api:";

export interface AccountUser {
  id: number;
  username: string;
  display_name: string;
  quota: number;
  used_quota: number;
  request_count: number;
  group: string;
}

export interface AccountSession {
  communityEmbed?: CommunityBinding;
  communityBindings?: Record<string, CommunityBinding>;
  communityPending?: boolean;
  user?: AccountUser;
  accessToken?: string;
  accessExpiresAt?: number;
  refreshToken?: string;
  upstreamSessionId?: string;
  flowToken?: string;
  flowExpiresAt?: number;
  selectedTokenId?: number;
  selectedKey?: string;
  createdAt: number;
  expiresAt: number;
  version: number;
}

type StoredSession = { value: string; expires: number };
type SessionState = {
  memory: Map<string, StoredSession>;
  locks: Map<string, Promise<void>>;
  redis?: Redis;
};

const shared = globalThis as typeof globalThis & {
  __octopusNewApiSessions?: SessionState;
};
const state: SessionState = (shared.__octopusNewApiSessions ??= {
  memory: new Map(),
  locks: new Map(),
});
const leaseContext = new AsyncLocalStorage<{ id: string; owner: string }>();

function redis() {
  const { redisUrl } = requireNewApiConfig();
  if (!redisUrl) return null;
  if (!state.redis || state.redis.status === "end") {
    state.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      commandTimeout: 5000,
      retryStrategy: (attempt) =>
        attempt <= 3 ? Math.min(attempt * 200, 1000) : null,
    });
    // Connection errors are surfaced by the awaited operation, without logging credentials.
    state.redis.on("error", () => {});
  }
  return state.redis;
}

export { redis as getNewApiRedis };

export function getSessionId(req: AccountRequest): string | null {
  assertNormalRequest(req);
  const id =
    req.cookies.get(SESSION_COOKIE)?.value || "";
  return /^[A-Za-z0-9_-]{43}$/.test(id) ? id : null;
}

export async function readSessionById(id: string) {
  const config = requireNewApiConfig();
  const store = redis();
  let value: string | null;
  if (store) {
    value = await store.get(PREFIX + id);
  } else {
    const entry = state.memory.get(id);
    if (entry && entry.expires > Date.now()) {
      value = entry.value;
    } else {
      state.memory.delete(id);
      value = null;
    }
  }
  if (!value) return null;
  try {
    const session = await unsealData<AccountSession>(value, {
      password: config.secret,
    });
    if (!session.expiresAt || session.expiresAt <= Date.now() / 1000) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function readSession(req: AccountRequest) {
  const id = getSessionId(req);
  const session = id ? await readSessionById(id) : null;
  if (session) assertNormalSession(req, session);
  return session;
}

export async function saveSession(id: string, session: AccountSession) {
  const config = requireNewApiConfig();
  const ttl = Math.max(
    1,
    Math.min(SESSION_TTL, Math.floor(session.expiresAt - Date.now() / 1000)),
  );
  const value = await sealData(session, {
    password: config.secret,
    ttl,
  });
  const store = redis();
  if (store) {
    const lease = leaseContext.getStore();
    if (lease?.id === id) {
      const saved = await store.eval(
        "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3]) return 1",
        2,
        PREFIX + "lock:" + id,
        PREFIX + id,
        lease.owner,
        value,
        ttl,
      );
      if (saved !== 1) {
        throw new NewApiError("会话更新超时，请重试", 409);
      }
    } else {
      await store.set(PREFIX + id, value, "EX", ttl);
    }
  } else {
    for (const [key, entry] of state.memory) {
      if (entry.expires <= Date.now()) state.memory.delete(key);
    }
    if (!state.memory.has(id) && state.memory.size >= 1000) {
      throw new NewApiError("本地会话已满，请稍后再试", 503);
    }
    state.memory.set(id, { value, expires: Date.now() + ttl * 1000 });
  }
}

export async function removeSessionById(id: string) {
  const store = redis();
  if (store) await store.del(PREFIX + id);
  else state.memory.delete(id);
}

function cookieOptions(req: AccountRequest) {
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0];
  return {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production" ||
      req.nextUrl.protocol === "https:" ||
      forwardedProto === "https",
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function createSession(
  req: AccountRequest,
  res: AccountResponse,
  session: Omit<AccountSession, "createdAt" | "expiresAt" | "version">,
  expectedPrevious?: { id: string; version: number },
) {
  assertNormalRequest(req);
  const id = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const ttl = session.flowToken
    ? 300
    : session.communityPending
    ? 600
    : SESSION_TTL;
  const fullSession: AccountSession = {
    ...session,
    createdAt: now,
    expiresAt: now + ttl,
    version: 1,
  };
  const oldId = getSessionId(req);
  if (expectedPrevious) {
    if (oldId !== expectedPrevious.id)
      throw new NewApiError("账号已变更，请重新进入", 409);
    await withSessionLock(oldId, async () => {
      const current = await readSessionById(oldId);
      if (!current || current.version !== expectedPrevious.version)
        throw new NewApiError("账号已变更，请重新进入", 409);
      await saveSession(id, fullSession);
      try {
        const store = redis();
        if (store) {
          const owner = leaseContext.getStore()?.owner;
          if (!owner) throw new NewApiError("会话更新超时，请重试", 409);
          const removed = await store.eval(
            "if redis.call('get', KEYS[1]) ~= ARGV[1] or redis.call('exists', KEYS[2]) == 0 then return 0 end redis.call('del', KEYS[2]) return 1",
            2,
            PREFIX + "lock:" + oldId,
            PREFIX + oldId,
            owner,
          );
          if (removed !== 1)
            throw new NewApiError("账号已变更，请重新进入", 409);
        } else {
          await removeSessionById(oldId);
        }
      } catch (error) {
        await removeSessionById(id);
        throw error;
      }
    });
  } else {
    await saveSession(id, fullSession);
    if (oldId) await withSessionLock(oldId, () => removeSessionById(oldId));
  }
  res.cookies.set(SESSION_COOKIE, id, {
    ...cookieOptions(req),
    maxAge: ttl,
  });
  return { id, session: fullSession };
}

export async function deleteSession(req: AccountRequest, res: AccountResponse) {
  const id = getSessionId(req);
  if (id) await withSessionLock(id, () => removeSessionById(id));
  res.cookies.set(SESSION_COOKIE, "", {
    ...cookieOptions(req),
    maxAge: 0,
  });
}

// Refresh tokens rotate upstream. Serialize every read-modify-write operation by session.
export async function withSessionLock<T>(
  id: string,
  action: () => Promise<T>,
): Promise<T> {
  const store = redis();
  if (store) {
    const key = PREFIX + "lock:" + id;
    const owner = randomUUID();
    const deadline = Date.now() + 12000;
    let acquired = false;
    while (Date.now() < deadline) {
      if ((await store.set(key, owner, "PX", 30000, "NX")) === "OK") {
        acquired = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (!acquired) {
      throw new NewApiError("会话正在更新，请稍后重试", 409);
    }
    try {
      return await leaseContext.run({ id, owner }, action);
    } finally {
      await store.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        owner,
      );
    }
  }
  const previous = state.locks.get(id) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.locks.set(id, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (state.locks.get(id) === current) state.locks.delete(id);
  }
}
