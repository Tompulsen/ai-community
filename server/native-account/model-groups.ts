import { createHash, randomBytes } from "node:crypto";
import type { AccountRequest } from "./http.ts";
import {
  accountRequest,
  readAccountToken,
  forgetAccountToken,
  authBundle,
  getAuthenticatedSession,
  upstream,
  upstreamRequestHints,
} from "./client.ts";
import { NewApiError, requireNewApiConfig } from "./config.ts";
import { getNewApiRedis, withSessionLock } from "./session.ts";
import { nativeRequestsEnabled } from '../creation/request-store.ts';

type Binding =
  | { tokenId: number }
  | { pendingName: string; createdTokenId?: number; replacedTokenId?: number };

const SYSTEM_TOKEN_NAME = "系统创建";
type GroupRequest = (
  path: string,
  options?: { method?: string; body?: unknown },
) => ReturnType<typeof accountRequest>;

const shared = globalThis as typeof globalThis & {
  __octopusModelGroups?: Map<string, string>;
};
const memory = (shared.__octopusModelGroups ??= new Map());

function bindingKey(userId: number, group: string) {
  const hash = createHash("sha256")
    .update(JSON.stringify([requireNewApiConfig().baseUrl, userId, group]))
    .digest("hex");
  return `octopus:new-api:model-group:${hash}`;
}

async function readBinding(key: string): Promise<Binding | null> {
  const store = getNewApiRedis();
  const raw = store ? await store.get(key) : memory.get(key);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (
    (Number.isSafeInteger(value.tokenId) && value.tokenId > 0) ||
    (typeof value.pendingName === "string" &&
      value.pendingName &&
      (value.createdTokenId === undefined ||
        (Number.isSafeInteger(value.createdTokenId) &&
          value.createdTokenId > 0)) &&
      (value.replacedTokenId === undefined ||
        (Number.isSafeInteger(value.replacedTokenId) &&
          value.replacedTokenId > 0)))
  )
    return value;
  throw new NewApiError("分组密钥记录异常，请联系管理员", 503);
}

/** A timed-out lock holder must never overwrite a newer binding. */
async function compareBinding(
  key: string,
  expected: Binding | null,
  next: Binding | null,
) {
  const before = expected ? JSON.stringify(expected) : "";
  const after = next ? JSON.stringify(next) : "";
  const store = getNewApiRedis();
  if (store) {
    return (
      (await store.eval(
        "if (redis.call('get', KEYS[1]) or '') ~= ARGV[1] then return 0 end if ARGV[2] == '' then redis.call('del', KEYS[1]) else redis.call('set', KEYS[1], ARGV[2]) end return 1",
        1,
        key,
        before,
        after,
      )) === 1
    );
  }
  if ((memory.get(key) || "") !== before) return false;
  if (after) memory.set(key, after);
  else memory.delete(key);
  return true;
}

function usable(token: any, group: string) {
  return (
    token?.group === group &&
    (group !== "auto" || !token.auto_groups?.length) &&
    token.status === 1 &&
    (token.expired_time === -1 || token.expired_time > Date.now() / 1000) &&
    (token.unlimited_quota === true || token.remain_quota > 0)
  );
}

const unavailable = () =>
  new NewApiError(
    "该分组绑定的密钥已停用、过期、额度不足或被修改，请在管理密钥中处理；不会自动创建替代密钥",
    409,
    "NEW_API_GROUP_TOKEN_UNAVAILABLE",
  );
const uncertain = () =>
  new NewApiError(
    "密钥创建结果待确认，请稍后重试，或在管理密钥中核对并选择后重试；不会重复创建",
    409,
    "NEW_API_GROUP_TOKEN_PENDING",
  );

async function groupToken(
  request: GroupRequest,
  tokenId: number,
  group: string,
  allowMissing = false,
  userId?: number,
) {
  let token: any;
  try {
    ({ data: token } = await request(`/api/token/${tokenId}`));
  } catch (error) {
    if (error instanceof NewApiError && error.status === 404) {
      if (allowMissing) return;
      throw unavailable();
    }
    throw error;
  }
  if (token?.id !== tokenId || !usable(token, group)
    || (userId !== undefined && (token.user_id !== userId || token.cross_group_retry === true))) throw unavailable();
  return tokenId;
}

async function listTokens(request: GroupRequest) {
  const tokens: any[] = [];
  const seen = new Set<number>();
  let loaded = 0;
  for (let page = 1; ; page++) {
    const { data } = await request(`/api/token/?p=${page}&page_size=100`);
    if (
      !Array.isArray(data?.items) ||
      !Number.isSafeInteger(data.total) ||
      data.total < 0
    )
      throw uncertain();
    loaded += data.items.length;
    for (const token of data.items) {
      if (
        !Number.isSafeInteger(token?.id) || token.id < 1 || seen.has(token.id)
      )
        throw uncertain();
      seen.add(token.id);
      tokens.push(token);
    }
    if (loaded > data.total) throw uncertain();
    if (loaded === data.total) break;
    if (!data.items.length || page >= 1000) throw uncertain();
  }
  return tokens;
}

async function matchingTokens(
  request: GroupRequest,
  group: string,
  name: string,
) {
  return (await listTokens(request))
    .filter(token => token.name === name && token.group === group)
    .map(token => token.id as number);
}

export function reusableSystemToken(token: any, userId: number, group: string) {
  return (
    usable(token, group) &&
    token.user_id === userId &&
    token.name === SYSTEM_TOKEN_NAME &&
    token.expired_time === -1 &&
    token.unlimited_quota === true &&
    token.model_limits_enabled === false &&
    (token.allow_ips === null || token.allow_ips === "") &&
    token.cross_group_retry === false &&
    (token.auto_groups == null ||
      (Array.isArray(token.auto_groups) && token.auto_groups.length === 0))
  );
}

async function recoverCreation(
  request: GroupRequest,
  group: string,
  name: string,
) {
  const matches = await matchingTokens(request, group, name);
  if (
    matches.length !== 1 ||
    !Number.isSafeInteger(matches[0]) ||
    matches[0] < 1
  )
    throw uncertain();
  return matches[0];
}

/** Resolves a group key without exposing its secret or changing manual keys. */
export async function resolveModelGroup(req: AccountRequest, group: string, create = true) {
  const tokenId = await resolveGroup(req, group, undefined, false, create);
  if (!tokenId && create) throw unavailable();
  return tokenId;
}

/** Search uses Auto, never a selected key from another chat group. */
export async function resolveSystemAutoToken(req: AccountRequest) {
  const tokenId = await resolveGroup(req, "auto", undefined, true);
  if (!tokenId) throw unavailable();
  return tokenId;
}

/** Restore an initialized Auto key, including interrupted provisioning. */
export async function recoverLoginAuto(
  req: AccountRequest,
  credentials: ReturnType<typeof authBundle>,
) {
  const binding = await readBinding(bindingKey(credentials.user.id, "auto"));
  if (!binding) return;
  return initializeLoginAuto(req, credentials);
}

/** Login uses the same account/group lock and durable creation record as switching. */
export async function initializeLoginAuto(
  req: AccountRequest,
  credentials: ReturnType<typeof authBundle>,
) {
  const tokenId = await resolveGroup(req, "auto", credentials);
  if (!tokenId) return {};
  const { data } = await upstream(`/api/token/${tokenId}/key`, {
    method: "POST",
    accessToken: credentials.accessToken,
    ...upstreamRequestHints(req),
  });
  if (typeof data?.key !== "string" || !data.key) throw unavailable();
  return {
    selectedTokenId: tokenId,
    selectedKey: data.key.startsWith("sk-") ? data.key : `sk-${data.key}`,
  };
}

async function resolveGroup(
  req: AccountRequest,
  group: string,
  login?: ReturnType<typeof authBundle>,
  systemAuto = false,
  create = true,
) {
  const { session } = login
    ? { session: login }
    : await getAuthenticatedSession(req, true);
  const userId = session.user!.id;
  const durable = req.database && nativeRequestsEnabled(userId) ? req.database : undefined;
  const request: GroupRequest = login
    ? (path, options) =>
        upstream(path, {
          ...options,
          accessToken: login.accessToken,
          ...upstreamRequestHints(req),
        })
    : (path, options) => durable && !options?.method && /^\/api\/token\/[1-9]\d*$/.test(path)
      ? readAccountToken(req, Number(path.split('/').pop()))
      : accountRequest(req, path, { ...options, reuseRequestSession: true });
  // Verify available groups even when a key was bound on a previous visit.
  const { data: groups } = await request("/api/user/self/groups");
  if (group && !Object.prototype.hasOwnProperty.call(groups || {}, group))
    throw new NewApiError("该分组不可用，请刷新分组列表");
  const groupKey = bindingKey(userId, group);
  const key = durable ? `${groupKey}:native` : systemAuto ? `${groupKey}:web-search` : groupKey;
  const read = async (id: string) => durable
    ? (await durable.query<{ binding: Binding }>('SELECT binding FROM community_group_credential WHERE key=$1', [id])).rows[0]?.binding ?? null
    : readBinding(id);
  const compare = async (id: string, before: Binding | null, after: Binding | null, provenance?: string) => {
    if (!durable) return compareBinding(id, before, after);
    const result = before === null
      ? await durable.query("INSERT INTO community_group_credential (key,binding,provenance) VALUES ($1,$2,COALESCE($3,'native-create')) ON CONFLICT (key) DO NOTHING RETURNING key", [id, JSON.stringify(after), provenance ?? null])
      : after === null
      ? await durable.query('DELETE FROM community_group_credential WHERE key=$1 AND binding=$2::jsonb RETURNING key', [id, JSON.stringify(before)])
      : await durable.query('UPDATE community_group_credential SET binding=$3,provenance=COALESCE($4,provenance),version=version+1,updated_at=now() WHERE key=$1 AND binding=$2::jsonb RETURNING key', [id, JSON.stringify(before), JSON.stringify(after), provenance ?? null]);
    return result.rows.length === 1;
  };
  return withSessionLock(`model-group:${groupKey}`, async () => {
    const { session: current } = login
      ? { session: { ...login, selectedTokenId: undefined } }
      : await getAuthenticatedSession(req);
    if (current.user?.id !== userId)
      throw new NewApiError("账号已变化，请刷新", 409);
    let replacedTokenId: number | undefined;
    const rememberSystemToken = async (tokenId: number | undefined) => {
      if (!durable && systemAuto && tokenId) {
        const chatBinding = await readBinding(groupKey);
        // Reuse a provisioned system key when returning to Auto; preserve manual bindings.
        if (
          !chatBinding ||
          ("tokenId" in chatBinding && chatBinding.tokenId === replacedTokenId)
        ) {
          await compareBinding(groupKey, chatBinding, { tokenId });
        }
      }
      return tokenId;
    };
    let binding = await read(key);
    const legacy = durable && create ? await Promise.all([groupKey, `${groupKey}:web-search`].map(async key => ({ key, binding: await readBinding(key) }))) : [];
    for (const entry of legacy) {
      const old = entry.binding;
      if (!old || !('pendingName' in old)) continue;
      if (!binding || !('pendingName' in binding) || old.pendingName !== binding.pendingName
        || (old.createdTokenId !== undefined && old.createdTokenId !== binding.createdTokenId)
        || (old.replacedTokenId !== undefined && old.replacedTokenId !== binding.replacedTokenId)) throw uncertain();
      // The durable intent survives while its matching legacy snapshot is retired.
      if (!(await compareBinding(entry.key, old, null))) throw uncertain();
      entry.binding = null;
    }
    let selected: any;
    if (current.selectedTokenId && (durable ? create && !(binding && 'pendingName' in binding) : !systemAuto)) {
      try {
        ({ data: selected } = await request(
          `/api/token/${current.selectedTokenId}`,
        ));
      } catch (error) {
        if (!(error instanceof NewApiError) || error.status !== 404)
          throw error;
      }
    }
    if (durable && selected && (selected.id !== current.selectedTokenId || selected.user_id !== userId)) throw unavailable();
    // Idle preloading only reads confirmed keys; provisioning is a foreground action.
    if (!create && binding && "pendingName" in binding) return;
    if (binding && "pendingName" in binding) {
      replacedTokenId = binding.replacedTokenId;
    }
    if (
      selected?.group === group &&
      (durable || group !== "auto" || !selected.auto_groups?.length)
    ) {
      if (!usable(selected, group) || (durable && selected.cross_group_retry === true)) throw unavailable();
      if (!(binding && 'tokenId' in binding && binding.tokenId === selected.id)
        && !(await compare(key, binding, { tokenId: selected.id }, 'account-reuse')))
        throw new NewApiError("分组正在切换，请重试", 409);
      return selected.id as number;
    }
    // Preserve the initial/current key for the group being left.
    if (
      !durable && selected &&
      typeof selected.group === "string" &&
      (selected.group !== "auto" || !selected.auto_groups?.length)
    ) {
      await compareBinding(bindingKey(userId, selected.group), null, {
        tokenId: selected.id,
      });
    }
    if (binding && "tokenId" in binding) {
      const existing = await groupToken(
        request,
        binding.tokenId,
        group,
        !login,
        durable ? userId : undefined,
      );
      if (existing) {
        return rememberSystemToken(existing);
      }
      if (!create) return;
      // Explicit switching and system search may replace a confirmed deleted key.
      // Disabled, expired, edited and ambiguous keys keep their binding.
      replacedTokenId = binding.tokenId;
      if (!durable) {
        if (!(await compare(key, binding, null)))
          throw new NewApiError("分组记录已更新，请重试", 409);
        binding = null;
      }
    }

    if (!create) return;
    if (!binding || "tokenId" in binding) {
      const previous = binding;
      if (durable) {
        if (new Set(legacy.flatMap(({ binding }) => binding && 'tokenId' in binding ? [binding.tokenId] : [])).size > 1)
          throw new NewApiError("旧分组密钥记录存在冲突，请在管理密钥中选择后重试；不会另建密钥", 409, "NEW_API_CREDENTIAL_VERIFICATION_REQUIRED");
        for (const { binding: old } of legacy) {
          if (!old || !('tokenId' in old)) continue;
          const tokenId = await groupToken(request, old.tokenId, group, true, userId);
          if (tokenId) {
            if (!(await compare(key, binding, { tokenId }, 'account-reuse')))
              throw new NewApiError("分组记录已更新，请重试", 409);
            return tokenId;
          }
        }
      }
      const tokens = await listTokens(request);
      if (durable && tokens.some(token => token.user_id !== userId || typeof token.group !== 'string')) throw unavailable();
      const matches = tokens.filter(token => token.group === group && (durable || token.name === SYSTEM_TOKEN_NAME));
      if (matches.length) {
        if (durable) {
          const candidate = matches.filter(token => token.user_id === userId && token.cross_group_retry !== true && usable(token, group)).sort((a, b) => a.id - b.id)[0];
          if (!candidate) throw unavailable();
          const tokenId = await groupToken(request, candidate.id, group, false, userId);
          if (!(await compare(key, binding, { tokenId: tokenId! }, 'account-reuse')))
            throw new NewApiError("分组记录已更新，请重试", 409);
          return tokenId;
        }
        const candidate = matches
          .filter(token => reusableSystemToken(token, userId, group))
          .sort((a, b) => a.id - b.id)[0];
        if (!candidate) throw unavailable();
        // Recheck detail before binding; list metadata may already be stale.
        const { data: token } = await request(`/api/token/${candidate.id}`);
        if (token?.id !== candidate.id || !reusableSystemToken(token, userId, group))
          throw unavailable();
        const tokenId = candidate.id as number;
        if (!(await compareBinding(key, null, { tokenId })))
          throw new NewApiError("系统密钥记录已更新，请重试", 409);
        return rememberSystemToken(tokenId);
      }
      if (login && tokens.length) return;
      // Retain PG provenance while removing only pointers to the confirmed deleted key.
      for (const { key: legacyKey, binding: old } of legacy) {
        if (old && !(await compareBinding(legacyKey, old, null)))
          throw new NewApiError("分组记录已更新，请重试", 409);
      }
      binding = {
        pendingName: `${SYSTEM_TOKEN_NAME}-${randomBytes(8).toString("hex")}`,
        ...((durable || systemAuto) && replacedTokenId ? { replacedTokenId } : {}),
      };
      if (!(await compare(key, previous, binding)))
        throw new NewApiError("分组正在准备，请重试", 409);
      try {
        await request("/api/token/", {
          method: "POST",
          body: {
            name: binding.pendingName,
            group,
            expired_time: -1,
            unlimited_quota: true,
            remain_quota: 0,
            model_limits_enabled: false,
            model_limits: "",
            allow_ips: "",
            cross_group_retry: false,
            auto_groups: [],
          },
        });
      } catch (error) {
        // Explicit rejections cannot have created a key. Ambiguous failures
        // keep the pending name so subsequent requests only reconcile by GET.
        if (
          error instanceof NewApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          ![408, 409].includes(error.status)
        ) {
          await compare(key, binding, previous);
          throw error;
        }
      }
    }
    const tokenId =
      binding.createdTokenId ??
      (await recoverCreation(request, group, binding.pendingName));
    // Record the ID before renaming so a lost update response cannot cause
    // another creation or make the temporary name impossible to recover.
    if (!binding.createdTokenId) {
      const created = { ...binding, createdTokenId: tokenId };
      if (!(await compare(key, binding, created)))
        throw new NewApiError("分组记录已更新，请重试", 409);
      binding = created;
    }
    const { data: token } = await request(`/api/token/${tokenId}`);
    if (!usable(token, group)) throw unavailable();
    if (durable && (token.id !== tokenId || !reusableSystemToken({ ...token, name: SYSTEM_TOKEN_NAME }, userId, group)
      || ![SYSTEM_TOKEN_NAME, binding.pendingName].includes(token.name))) throw unavailable();
    if (token.name === binding.pendingName) {
      await request("/api/token/", {
        method: "PUT",
        body: {
          id: tokenId,
          name: SYSTEM_TOKEN_NAME,
          status: token.status,
          group: token.group,
          expired_time: token.expired_time,
          remain_quota: token.remain_quota,
          unlimited_quota: token.unlimited_quota,
          model_limits_enabled: token.model_limits_enabled,
          model_limits: token.model_limits,
          allow_ips: token.allow_ips,
          cross_group_retry: token.cross_group_retry,
          auto_groups: token.auto_groups ?? [],
        },
      });
      if (durable) forgetAccountToken(req, tokenId);
    }
    if (!(await compare(key, binding, { tokenId })))
      throw new NewApiError("分组记录已更新，请重试", 409);
    return rememberSystemToken(await groupToken(request, tokenId, group));
  });
}
