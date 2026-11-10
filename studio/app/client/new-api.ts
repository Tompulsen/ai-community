import Locale from "../locales";
import type { ModelPricing } from "../utils/model-pricing";
import type {
  WalletOverview,
  WalletQuote,
  WalletPayment,
  WalletRedemption,
} from "../utils/wallet";
import {
  consumeWorkspaceSession,
  discardWorkspaceSession,
  getWorkspaceBootstrapRevision,
  peekWorkspaceSession,
} from "../utils/workspace-bootstrap";
import {
  confirmLocalIdentity,
  confirmLocalToken,
  getLocalTokenId,
} from "../utils/local-workspace";

export interface NewApiStatus {
  enabled: boolean;
  configured: boolean;
  publicUrl: string;
  passwordLoginEnabled: boolean;
  turnstileSiteKey: string;
  quotaPerUnit: number;
  currencySymbol: string;
}

export interface NewApiUser {
  id: number;
  username: string;
  display_name: string;
  quota: number;
  used_quota: number;
  request_count: number;
  group: string;
}

export interface NewApiSession {
  authenticated: boolean;
  user: NewApiUser | null;
  selectedTokenId: number | null;
}

export interface NewApiToken {
  id: number;
  name: string;
  status: number;
  created_time: number;
  accessed_time: number;
  expired_time: number;
  remain_quota: number;
  used_quota: number;
  unlimited_quota: boolean;
  model_limits_enabled: boolean;
  model_limits: string;
  group: string;
  allow_ips?: string;
  cross_group_retry?: boolean;
  auto_groups?: string[];
}

export interface NewApiTokenInput {
  name: string;
  group: string;
  expired_time: number;
  remain_quota: number;
  unlimited_quota: boolean;
  model_limits_enabled: boolean;
  model_limits: string;
  allow_ips?: string;
  cross_group_retry?: boolean;
  auto_groups?: string[];
}

export interface NewApiGroup {
  id: string;
  name: string;
  ratio: number | "auto";
  description: string;
}

export interface NewApiAutoGroups {
  supported: boolean;
  defaultGroups: string[];
  maxCount: number;
}

export interface NewApiModelGroups {
  groups: NewApiGroup[];
  selectedGroup: string | null;
  selectedAutoGroups?: string[];
}

export interface NewApiLog {
  id: number;
  created_at: number;
  model_name: string;
  token_name: string;
  prompt_tokens: number;
  completion_tokens: number;
  quota: number;
  type: number;
  content: string;
}

export interface NewApiPage<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

type LoginResult = NewApiSession | { requires2fa: true };

export const NEW_API_CHANNEL = "octopus-new-api-session";
export const NEW_API_TAB_ID = Math.random().toString(36).slice(2);
let expectedUserId: number | null = null;
let sessionRevision = 0;
let sessionRequest: Promise<NewApiSession> | undefined;
let confirmedSession: NewApiSession | undefined;
let confirmedSessionAt = 0;
let confirmedWorkspaceRevision = -1;
let initialReadinessSession:
  | {
      session: NewApiSession;
      revision: number;
      workspaceRevision: number;
      pending?: Promise<NewApiSession>;
    }
  | undefined;
let initialReadinessConsumed = false;
const groupSnapshots = new Map<
  string,
  { data: NewApiModelGroups; at: number }
>();
const groupRequests = new Map<string, Promise<NewApiModelGroups>>();
const groupSelections = new Map<
  string,
  Promise<{ selectedTokenId: number; group: string }>
>();
let sourceRevision = 0;
const GROUP_TTL = 5 * 60_000;
const accountReads = new Map<
  string,
  { data?: unknown; at: number; pending?: Promise<unknown> }
>();
let accountReadRevision = 0;

function clearAccountReads() {
  accountReadRevision++;
  accountReads.clear();
}

function accountRead<T>(
  path: string,
  userId: number | undefined,
  ttl: number,
  force = false,
): Promise<T> {
  if (userId === undefined && path !== "status")
    return request<T>(path, "GET", undefined, userId);
  const key = JSON.stringify([userId, path]);
  const cached = accountReads.get(key);
  if (!force && cached?.data !== undefined && Date.now() - cached.at < ttl)
    return Promise.resolve(cached.data as T);
  if (cached?.pending) return cached.pending as Promise<T>;
  const entry = { at: 0 } as {
    data?: unknown;
    at: number;
    pending?: Promise<unknown>;
  };
  const revision = accountReadRevision;
  entry.pending = request<T>(path, "GET", undefined, userId)
    .then((data) => {
      if (revision === accountReadRevision && accountReads.get(key) === entry) {
        entry.data = data;
        entry.at = Date.now();
      }
      return data;
    })
    .finally(() => {
      entry.pending = undefined;
    });
  accountReads.set(key, entry);
  if (accountReads.size > 40)
    accountReads.delete(accountReads.keys().next().value!);
  return entry.pending as Promise<T>;
}

export function invalidateNewApiModelSource() {
  clearAccountReads();
  discardWorkspaceSession();
  sessionRevision++;
  sourceRevision++;
  sessionRequest = undefined;
  confirmedSession = undefined;
  initialReadinessSession = undefined;
  groupSnapshots.clear();
  groupRequests.clear();
  groupSelections.clear();
}

export type NewApiSelection = {
  userId: number;
  tokenId: number;
  group?: string;
};

function sourceKey(userId: number, tokenId: number | null) {
  return JSON.stringify([userId, tokenId]);
}

export function getCachedModelSource() {
  const session = confirmedSession;
  if (
    !session?.authenticated ||
    session.user?.id !== expectedUserId ||
    session.selectedTokenId !== getLocalTokenId()
  )
    return undefined;
  const snapshot = groupSnapshots.get(
    sourceKey(session.user.id, session.selectedTokenId),
  );
  return snapshot ? { session, modelGroups: snapshot.data } : undefined;
}

function cacheGroups(key: string, data: NewApiModelGroups, at = Date.now()) {
  groupSnapshots.delete(key);
  groupSnapshots.set(key, { data, at });
  if (groupSnapshots.size > 20)
    groupSnapshots.delete(groupSnapshots.keys().next().value!);
}

// Share concurrent reads, but never reuse an in-flight read after an account
// or key change (including changes broadcast from another tab).
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    initialReadinessConsumed = true;
    initialReadinessSession = undefined;
  });
  window.addEventListener("new-api-session-changed", (event) => {
    clearAccountReads();
    discardWorkspaceSession();
    sessionRevision++;
    sourceRevision++;
    sessionRequest = undefined;
    initialReadinessSession = undefined;
    groupRequests.clear();
    groupSelections.clear();
    const selection = (event as CustomEvent<NewApiSelection | undefined>)
      .detail;
    if (
      selection &&
      confirmedSession?.user?.id === selection.userId &&
      expectedUserId === selection.userId
    ) {
      // confirmLocalToken already points to the new key at this point.
      const oldGroups = groupSnapshots.get(
        sourceKey(selection.userId, confirmedSession.selectedTokenId),
      );
      confirmedSession = {
        ...confirmedSession,
        selectedTokenId: selection.tokenId,
      };
      if (selection.group !== undefined && oldGroups) {
        cacheGroups(
          sourceKey(selection.userId, selection.tokenId),
          {
            ...oldGroups.data,
            selectedGroup: selection.group,
            selectedAutoGroups: [],
          },
          oldGroups.at,
        );
      }
    } else {
      confirmedSession = undefined;
      groupSnapshots.clear();
    }
  });
}

export function setNewApiExpectedUser(id: number | null) {
  if (id !== expectedUserId) clearAccountReads();
  if (id !== confirmedSession?.user?.id) confirmedSessionAt = 0;
  expectedUserId = id;
  // null also means "identity not yet checked"; only confirmed sessions switch.
}

export function getExpectedNewApiUserId() {
  return expectedUserId;
}

export class NewApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "NewApiError";
  }
}

export function notifyNewApiSessionChanged(selection?: NewApiSelection) {
  clearAccountReads();
  sessionRevision++;
  window.dispatchEvent(
    new CustomEvent("new-api-session-changed", { detail: selection }),
  );
  const message = { type: "session-changed", source: NEW_API_TAB_ID };
  if (typeof BroadcastChannel === "function") {
    const channel = new BroadcastChannel(NEW_API_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } else {
    try {
      window.localStorage.setItem(
        NEW_API_CHANNEL,
        JSON.stringify({ ...message, at: Date.now() }),
      );
    } catch {}
  }
}

async function request<T>(
  path: string,
  method = "GET",
  body?: object,
  userId: number | null = expectedUserId,
  signal?: AbortSignal,
): Promise<T> {
  const headers = new Headers();
  if (body) headers.set("Content-Type", "application/json");
  if (
    userId !== null &&
    !["status", "session", "login", "login-2fa"].includes(path)
  ) {
    headers.set("X-New-Api-User", String(userId));
  }
  const controller = method === "GET" ? new AbortController() : undefined;
  const cancel = () => controller?.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = controller
    ? setTimeout(() => controller.abort(), 15000)
    : undefined;
  try {
    const response = await fetch(`/studio/api/new-api/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      ...(controller ? { signal: controller.signal } : {}),
      ...(body
        ? {
            body: JSON.stringify(body),
          }
        : {}),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      if ([401, 403, 409].includes(response.status)) {
        window.dispatchEvent(new Event("new-api-session-changed"));
      }
      throw new NewApiError(
        typeof result?.message === "string" && result.message
          ? result.message
          : Locale.Account.RequestFailed,
        response.status,
      );
    }
    return result.data as T;
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new NewApiError("请求超时，请稍后重试", 408);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    clearTimeout(timeout);
  }
}

/** Read startup guidance without consuming the session needed by access.fetch. */
export function getInitialAccountReadinessSession() {
  const initial = initialReadinessSession;
  const session = initial?.session ?? peekWorkspaceSession();
  if (
    initialReadinessConsumed ||
    !session ||
    session.selectedTokenId !== getLocalTokenId() ||
    (session.authenticated
      ? session.user?.id !== expectedUserId
      : expectedUserId !== null) ||
    (initial &&
      (initial.revision !== sessionRevision ||
        initial.workspaceRevision !== getWorkspaceBootstrapRevision() ||
        (initial.session !== confirmedSession &&
          (!initial.pending || initial.pending !== sessionRequest))))
  )
    return undefined;
  return session;
}

/** Only the first readiness mount may consume this document's verified bootstrap. */
export function getAccountReadinessSession(useInitialSession = false) {
  const initial = initialReadinessSession;
  const canUseInitial =
    useInitialSession &&
    initial !== undefined &&
    initial.session === getInitialAccountReadinessSession();
  initialReadinessSession = undefined;
  initialReadinessConsumed = true;
  if (!sessionRequest && canUseInitial && initial) {
    const pending = Promise.resolve(initial.session).finally(() => {
      if (sessionRequest === pending) sessionRequest = undefined;
    });
    sessionRequest = pending;
  }
  const pending = newApiClient.session();
  const revision = sessionRevision;
  return pending.then((session) => {
    if (
      revision !== sessionRevision ||
      session !== confirmedSession ||
      session.selectedTokenId !== getLocalTokenId() ||
      (expectedUserId !== null && session.user?.id !== expectedUserId)
    ) {
      throw new NewApiError("账号或密钥已变更，请重试", 409);
    }
    return session;
  });
}

async function walletRequest<T extends { userId: number }>(
  path: string,
  method: "GET" | "POST",
  body: object | undefined,
  userId: number | null,
  signal?: AbortSignal,
): Promise<T> {
  if (
    userId === null ||
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    userId !== expectedUserId
  )
    throw new NewApiError("账号已变化，请刷新充值页面后重试", 409);
  const revision = sessionRevision;
  const data = await request<T>(path, method, body, userId, signal);
  if (
    signal?.aborted ||
    revision !== sessionRevision ||
    userId !== expectedUserId ||
    data.userId !== userId
  )
    throw new NewApiError(
      "账号已变化，当前支付信息已关闭，请刷新余额确认",
      409,
    );
  return data;
}

export const newApiClient = {
  walletOverview: (signal?: AbortSignal, userId = expectedUserId) =>
    walletRequest<WalletOverview>("wallet", "GET", undefined, userId, signal),
  walletQuote: (amount: number, userId = expectedUserId) =>
    walletRequest<WalletQuote>("wallet/quote", "POST", { amount }, userId),
  walletPay: (amount: number, paymentMethod: string, userId = expectedUserId) =>
    walletRequest<WalletPayment>(
      "wallet/pay",
      "POST",
      { amount, paymentMethod },
      userId,
    ),
  walletSubscriptionPay: (
    planId: number,
    paymentMethod: string,
    userId = expectedUserId,
    expectedPrice?: { amount: number; currency: string },
  ) =>
    walletRequest<WalletPayment>(
      "wallet/subscription",
      "POST",
      { planId, paymentMethod, ...(expectedPrice ? { expectedPrice } : {}) },
      userId,
    ),
  walletRedeem: (key: string, userId = expectedUserId) =>
    walletRequest<WalletRedemption>("wallet/redeem", "POST", { key }, userId),
  async modelPricing(signal?: AbortSignal): Promise<ModelPricing> {
    const revision = sessionRevision;
    const userId = expectedUserId;
    const data = await request<ModelPricing>(
      "model-pricing",
      "GET",
      undefined,
      userId,
      signal,
    );
    if (
      signal?.aborted ||
      revision !== sessionRevision ||
      userId !== expectedUserId ||
      (userId !== null && data.userId !== userId)
    )
      throw new Error("账号已变化，请重新读取价格");
    return data;
  },
  status: () => accountRead<NewApiStatus>("status", undefined, 60_000),
  session(reuseVerified = false): Promise<NewApiSession> {
    if (sessionRequest) return sessionRequest;
    if (
      reuseVerified &&
      confirmedSession?.authenticated &&
      expectedUserId !== null &&
      confirmedSession.user?.id === expectedUserId &&
      confirmedSession.selectedTokenId === getLocalTokenId() &&
      confirmedWorkspaceRevision === getWorkspaceBootstrapRevision() &&
      Date.now() - confirmedSessionAt < 15_000
    )
      return Promise.resolve(confirmedSession);
    initialReadinessSession = undefined;
    const revision = ++sessionRevision;
    const initial = consumeWorkspaceSession();
    const pending = (
      initial ? Promise.resolve(initial) : request<NewApiSession>("session")
    )
      .then((session) => {
        if (revision === sessionRevision) {
          if (
            confirmedSession?.user?.id !== session.user?.id ||
            confirmedSession?.selectedTokenId !== session.selectedTokenId ||
            confirmedSession?.user?.group !== session.user?.group
          ) {
            clearAccountReads();
            sourceRevision++;
            groupRequests.clear();
          }
          if (
            confirmedSession?.user?.id !== session.user?.id ||
            confirmedSession?.user?.group !== session.user?.group
          ) {
            groupSnapshots.clear();
          }
          confirmedSession = session;
          confirmedSessionAt = Date.now();
          confirmLocalToken(session.selectedTokenId);
          confirmLocalIdentity(session.authenticated ? session.user!.id : null);
          confirmedWorkspaceRevision = getWorkspaceBootstrapRevision();
          if (initial && !initialReadinessConsumed) {
            initialReadinessSession = {
              session,
              revision,
              workspaceRevision: getWorkspaceBootstrapRevision(),
            };
          }
        }
        return session;
      })
      .finally(() => {
        if (sessionRequest === pending) sessionRequest = undefined;
        if (initialReadinessSession?.pending === pending)
          initialReadinessSession = undefined;
      });
    sessionRequest = pending;
    // Keep the verified handoff readable before the confirmation microtask runs.
    if (initial && !initialReadinessConsumed) {
      initialReadinessSession = {
        session: initial,
        revision,
        workspaceRevision: getWorkspaceBootstrapRevision(),
        pending,
      };
    }
    return pending;
  },
  async login(username: string, password: string, turnstileToken?: string) {
    const result = await request<LoginResult>("login", "POST", {
      username,
      password,
      ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
    });
    if (!("requires2fa" in result)) {
      confirmLocalIdentity(result.user!.id);
      notifyNewApiSessionChanged();
    }
    return result;
  },
  async login2fa(code: string) {
    const result = await request<NewApiSession>("login-2fa", "POST", { code });
    confirmLocalIdentity(result.user!.id);
    notifyNewApiSessionChanged();
    return result;
  },
  async logout(userId?: number) {
    await request<void>("logout", "POST", {}, userId);
    confirmLocalIdentity(null);
    notifyNewApiSessionChanged();
  },
  tokens: (page = 1, size = 20, userId?: number, force = false) =>
    accountRead<NewApiPage<NewApiToken>>(
      `tokens?page=${page}&size=${size}`,
      userId,
      15_000,
      force,
    ),
  async createToken(token: NewApiTokenInput, userId?: number) {
    await request<void>("tokens", "POST", token, userId);
    clearAccountReads();
  },
  async updateToken(id: number, token: NewApiTokenInput, userId?: number) {
    await request<void>(`tokens/${id}`, "PUT", token, userId);
    notifyNewApiSessionChanged();
  },
  async setTokenStatus(id: number, status: 1 | 2, userId?: number) {
    await request<void>(`tokens/${id}`, "PATCH", { status }, userId);
    notifyNewApiSessionChanged();
  },
  async deleteToken(id: number, userId?: number) {
    await request<void>(`tokens/${id}`, "DELETE", undefined, userId);
    notifyNewApiSessionChanged();
  },
  async selectToken(id: number, userId?: number) {
    const revision = sourceRevision;
    const result = await request<{ selectedTokenId: number }>(
      `tokens/${id}/select`,
      "POST",
      {},
      userId,
    );
    if (revision !== sourceRevision) {
      throw new NewApiError("账号或密钥已变更，请重试", 409);
    }
    confirmLocalToken(result.selectedTokenId);
    notifyNewApiSessionChanged();
    return result;
  },
  modelGroups(userId = expectedUserId ?? undefined, force = false) {
    if (userId === undefined) return request<NewApiModelGroups>("model-groups");
    const key = sourceKey(userId, getLocalTokenId());
    const cached = groupSnapshots.get(key);
    if (!force && cached && Date.now() - cached.at < GROUP_TTL)
      return Promise.resolve(cached.data);
    const existing = groupRequests.get(key);
    if (existing) return existing;
    const revision = sourceRevision;
    const pending = request<NewApiModelGroups>(
      "model-groups",
      "GET",
      undefined,
      userId,
    )
      .then((data) => {
        if (revision === sourceRevision) cacheGroups(key, data);
        return data;
      })
      .finally(() => {
        if (groupRequests.get(key) === pending) groupRequests.delete(key);
      });
    groupRequests.set(key, pending);
    return pending;
  },
  selectModelGroup(group: string, userId = expectedUserId ?? undefined) {
    const key = JSON.stringify([userId, group]);
    const existing = groupSelections.get(key);
    if (existing) return existing;
    const revision = sourceRevision;
    const pending = request<{ selectedTokenId: number; group: string }>(
      "model-groups/select",
      "POST",
      { group },
      userId,
    )
      .then((result) => {
        if (revision !== sourceRevision)
          throw new NewApiError("账号或密钥已变更，请重试", 409);
        confirmLocalToken(result.selectedTokenId);
        notifyNewApiSessionChanged(
          userId === undefined
            ? undefined
            : { userId, tokenId: result.selectedTokenId, group: result.group },
        );
        return result;
      })
      .finally(() => {
        if (groupSelections.get(key) === pending) groupSelections.delete(key);
      });
    groupSelections.set(key, pending);
    return pending;
  },
  groups: (userId?: number, force = false) =>
    accountRead<NewApiGroup[]>("groups", userId, 60_000, force),
  autoGroups: (userId?: number, force = false) =>
    accountRead<NewApiAutoGroups>("auto-groups", userId, 60_000, force),
  logs: (page = 1, size = 20, userId?: number, force = false) =>
    accountRead<NewApiPage<NewApiLog>>(
      `logs?page=${page}&size=${size}`,
      userId,
      15_000,
      force,
    ),
};
