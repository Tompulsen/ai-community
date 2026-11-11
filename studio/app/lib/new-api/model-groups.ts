import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import {
  accountRequest,
  authBundle,
  getAuthenticatedSession,
  upstream,
  upstreamRequestHints,
} from "./client";
import { NewApiError, requireNewApiConfig } from "./config";
import { getNewApiRedis, withSessionLock } from "./session";

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
  if (!usable(token, group)) throw unavailable();
  return tokenId;
}

async function matchingTokens(
  request: GroupRequest,
  group: string,
  name: string,
) {
  const matches: number[] = [];
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
      if (token.name === name && token.group === group) matches.push(token.id);
    }
    if (loaded >= data.total) break;
    if (!data.items.length || page >= 1000) throw uncertain();
  }
  return matches;
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
export async function resolveModelGroup(req: NextRequest, group: string) {
  const tokenId = await resolveGroup(req, group);
  if (!tokenId) throw unavailable();
  return tokenId;
}

/** Search follows the user's system Auto key, never their current chat key. */
export async function resolveSystemAutoToken(req: NextRequest) {
  const tokenId = await resolveGroup(req, "auto", undefined, true);
  if (!tokenId) throw unavailable();
  return tokenId;
}

/** Restore an initialized Auto key, including interrupted provisioning. */
export async function recoverLoginAuto(
  req: NextRequest,
  credentials: ReturnType<typeof authBundle>,
) {
  const binding = await readBinding(bindingKey(credentials.user.id, "auto"));
  if (!binding) return;
  return initializeLoginAuto(req, credentials);
}

/** Login uses the same account/group lock and durable creation record as switching. */
export async function initializeLoginAuto(
  req: NextRequest,
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
  req: NextRequest,
  group: string,
  login?: ReturnType<typeof authBundle>,
  systemAuto = false,
) {
  const { session } = login
    ? { session: login }
    : await getAuthenticatedSession(req);
  const userId = session.user!.id;
  const request: GroupRequest = login
    ? (path, options) =>
        upstream(path, {
          ...options,
          accessToken: login.accessToken,
          ...upstreamRequestHints(req),
        })
    : (path, options) => accountRequest(req, path, options);
  // Verify available groups even when a key was bound on a previous visit.
  const { data: groups } = await request("/api/user/self/groups");
  if (group && !Object.prototype.hasOwnProperty.call(groups || {}, group))
    throw new NewApiError("该分组不可用，请刷新分组列表");
  const groupKey = bindingKey(userId, group);
  const key = systemAuto ? `${groupKey}:web-search` : groupKey;
  return withSessionLock(`model-group:${groupKey}`, async () => {
    const { session: current } = login
      ? { session: { ...login, selectedTokenId: undefined } }
      : await getAuthenticatedSession(req);
    if (current.user?.id !== userId)
      throw new NewApiError("账号已变化，请刷新", 409);
    let replacedTokenId: number | undefined;
    const rememberSystemToken = async (tokenId: number | undefined) => {
      if (systemAuto && tokenId) {
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
    let selected: any;
    if (!systemAuto && current.selectedTokenId) {
      try {
        ({ data: selected } = await request(
          `/api/token/${current.selectedTokenId}`,
        ));
      } catch (error) {
        if (!(error instanceof NewApiError) || error.status !== 404)
          throw error;
      }
    }
    let binding = await readBinding(key);
    if (binding && "pendingName" in binding) {
      replacedTokenId = binding.replacedTokenId;
    }
    if (
      selected?.group === group &&
      (group !== "auto" || !selected.auto_groups?.length)
    ) {
      if (!usable(selected, group)) throw unavailable();
      if (!(await compareBinding(key, binding, { tokenId: selected.id })))
        throw new NewApiError("分组正在切换，请重试", 409);
      return selected.id as number;
    }
    // Preserve the initial/current key for the group being left.
    if (
      selected &&
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
      );
      if (existing) return rememberSystemToken(existing);
      // Explicit switching and system search may replace a confirmed deleted key.
      // Disabled, expired, edited and ambiguous keys keep their binding.
      replacedTokenId = binding.tokenId;
      if (!(await compareBinding(key, binding, null)))
        throw new NewApiError("分组记录已更新，请重试", 409);
      binding = null;
    }

    if (!binding) {
      if (systemAuto) {
        const matches = await matchingTokens(request, group, SYSTEM_TOKEN_NAME);
        if (matches.length > 1) throw uncertain();
        if (matches.length === 1) {
          const tokenId = matches[0];
          if (!Number.isSafeInteger(tokenId) || tokenId < 1) throw uncertain();
          await groupToken(request, tokenId, group);
          if (!(await compareBinding(key, null, { tokenId }))) {
            throw new NewApiError("系统密钥记录已更新，请重试", 409);
          }
          return rememberSystemToken(tokenId);
        }
      }
      if (login) {
        // Recheck under the shared lock; another login may already have created it.
        const { data } = await request("/api/token/?p=1&page_size=2");
        if (
          data?.total !== 0 ||
          !Array.isArray(data.items) ||
          data.items.length !== 0
        )
          return;
      }
      binding = {
        pendingName: `${SYSTEM_TOKEN_NAME}-${randomBytes(8).toString("hex")}`,
        ...(systemAuto && replacedTokenId ? { replacedTokenId } : {}),
      };
      if (!(await compareBinding(key, null, binding)))
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
          await compareBinding(key, binding, null);
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
      if (!(await compareBinding(key, binding, created)))
        throw new NewApiError("分组记录已更新，请重试", 409);
      binding = created;
    }
    const { data: token } = await request(`/api/token/${tokenId}`);
    if (!usable(token, group)) throw unavailable();
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
    }
    if (!(await compareBinding(key, binding, { tokenId })))
      throw new NewApiError("分组记录已更新，请重试", 409);
    return rememberSystemToken(await groupToken(request, tokenId, group));
  });
}
