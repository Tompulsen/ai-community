import { AccountRequest, AccountResponse } from "./http.ts";
import { readModelPricing } from "./model-pricing.ts";
import { readWallet, quoteWallet, createWalletPayment, redeemWallet } from "./wallet.ts";
import { communityQuotaPerPoint, readCommunityWallet, readCommunityWalletLots } from "./community-wallet.ts";
import { assertNormalRequest } from "./transport.ts";
import { readRequestBody, RequestBodyError } from "./request-body.ts";
import {
  accountRequest,
  assertExpectedUser,
  assertSameOrigin,
  authBundle,
  getAuthenticatedSession,
  loginCredentials,
  publicSession,
  sanitizeUser,
  upstream,
  upstreamRequestHints,
} from "./client.ts";
import {
  getNewApiConfig,
  NewApiError,
  requireNewApiConfig,
} from "./config.ts";
import {
  createSession,
  deleteSession,
  getSessionId,
  readSession,
  readSessionById,
  removeSessionById,
  saveSession,
  withSessionLock,
} from "./session.ts";
import {
  initializeLoginAuto,
  recoverLoginAuto,
  resolveModelGroup,
} from "./model-groups.ts";

const NO_CACHE = { "Cache-Control": "private, no-store" };

function ok(data?: unknown) {
  return AccountResponse.json({ success: true, data }, { headers: NO_CACHE });
}
async function body(req: AccountRequest) {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new NewApiError("请求必须使用 JSON 格式", 415);
  }
  let text: string;
  try {
    // A 20,000-character UTF-8 body needs at most 60,000 bytes.
    text = (await readRequestBody(req, 60_000))?.toString("utf8") ?? "";
  } catch (error) {
    if (error instanceof RequestBodyError) {
      throw new NewApiError(
        error.status === 413 ? "请求内容过长" : error.message,
        error.status,
      );
    }
    throw error;
  }
  if (text.length > 20000) throw new NewApiError("请求内容过长", 413);
  try {
    const value = JSON.parse(text || "{}");
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new Error();
    }
    return value as Record<string, any>;
  } catch {
    throw new NewApiError("请求内容无效", 400);
  }
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new NewApiError("数字参数无效", 400);
  }
  return number;
}

function pagination(req: AccountRequest) {
  const page = integer(req.nextUrl.searchParams.get("page") || 1, 1);
  const size = integer(req.nextUrl.searchParams.get("size") || 20, 1, 100);
  return { page, size, query: `p=${page}&page_size=${size}` };
}

function safeToken(token: any) {
  return {
    id: token.id,
    name: token.name,
    status: token.status,
    created_time: token.created_time,
    accessed_time: token.accessed_time,
    expired_time: token.expired_time,
    remain_quota: token.remain_quota,
    used_quota: token.used_quota,
    unlimited_quota: token.unlimited_quota,
    model_limits_enabled: token.model_limits_enabled,
    model_limits: token.model_limits,
    group: token.group,
    allow_ips: token.allow_ips,
    cross_group_retry: token.cross_group_retry,
    auto_groups: token.auto_groups,
  };
}

function tokenForm(input: Record<string, any>, existing?: any) {
  const name = String(input.name ?? existing?.name ?? "").trim();
  if (!name || Buffer.byteLength(name, "utf8") > 50) {
    throw new NewApiError("密钥名称不能超过 50 字节，中文约 16 字");
  }
  const expired = integer(
    input.expired_time ?? existing?.expired_time ?? -1,
    -1,
  );
  if (expired !== -1 && expired <= Date.now() / 1000) {
    throw new NewApiError("有效期必须晚于当前时间");
  }
  const limits = String(input.model_limits ?? existing?.model_limits ?? "");
  const group = input.group ?? existing?.group ?? "";
  if (typeof group !== "string" || group !== group.trim()) {
    throw new NewApiError("分组参数无效");
  }
  if (limits.length > 8000 || group.length > 128) {
    throw new NewApiError("模型或分组参数过长");
  }
  const autoGroups = input.auto_groups ?? existing?.auto_groups ?? [];
  if (
    !Array.isArray(autoGroups) ||
    autoGroups.length > 100 ||
    autoGroups.some(
      (item) =>
        typeof item !== "string" ||
        !item ||
        item === "auto" ||
        item !== item.trim() ||
        item.length > 128,
    ) ||
    new Set(autoGroups).size !== autoGroups.length ||
    (input.cross_group_retry !== undefined &&
      typeof input.cross_group_retry !== "boolean")
  ) {
    throw new NewApiError("多分组参数无效");
  }
  const changedToSingle =
    existing && existing.group !== group && group !== "auto";
  const changedToAuto =
    existing && existing.group !== "auto" && group === "auto";
  return {
    ...(existing ? { id: existing.id, status: existing.status } : {}),
    name,
    group,
    expired_time: expired,
    remain_quota: integer(input.remain_quota ?? existing?.remain_quota ?? 0, 0),
    unlimited_quota:
      input.unlimited_quota === undefined
        ? Boolean(existing?.unlimited_quota)
        : input.unlimited_quota === true,
    model_limits_enabled:
      input.model_limits_enabled === undefined
        ? Boolean(existing?.model_limits_enabled)
        : input.model_limits_enabled === true,
    model_limits: limits,
    allow_ips: existing ? existing.allow_ips : "",
    cross_group_retry:
      changedToSingle || changedToAuto
        ? false
        : existing
        ? input.cross_group_retry ?? Boolean(existing.cross_group_retry)
        : false,
    auto_groups: changedToSingle ? [] : autoGroups,
  };
}

async function validateTokenGroups(
  req: AccountRequest,
  token: ReturnType<typeof tokenForm>,
  existing?: any,
) {
  const changed =
    !existing ||
    token.group !== existing.group ||
    (token.group === "auto" &&
      JSON.stringify(token.auto_groups) !==
        JSON.stringify(existing.auto_groups ?? []));
  if (!changed || !token.group) return;
  const { data: groups } = await accountRequest(req, "/api/user/self/groups");
  if (!Object.prototype.hasOwnProperty.call(groups || {}, token.group)) {
    throw new NewApiError("该分组不可用，请刷新分组列表");
  }
  if (token.group !== "auto") return;
  const { data: settings } = await accountRequest(
    req,
    "/api/token/auto-groups",
  );
  if (!Number.isSafeInteger(settings?.max_count) || settings.max_count < 1) {
    throw new NewApiError("多分组设置无效，请联系管理员", 502);
  }
  if (
    token.auto_groups.length > settings.max_count ||
    token.auto_groups.some(
      (group) => !Object.prototype.hasOwnProperty.call(groups || {}, group),
    )
  ) {
    throw new NewApiError("所选分组不可用或超过数量上限，请刷新分组列表");
  }
}

function usableToken(token: any) {
  return (
    token?.status === 1 &&
    (token.expired_time === -1 || token.expired_time > Date.now() / 1000) &&
    (token.unlimited_quota === true || token.remain_quota > 0)
  );
}

async function singleDefaultSelection(
  req: AccountRequest,
  bundle: ReturnType<typeof authBundle>,
) {
  // A newly registered account can use its sole default key regardless of its
  // name. Empty accounts get one Auto key through the shared provisioning flow.
  try {
    const recovered = await recoverLoginAuto(req, bundle);
    if (recovered?.selectedTokenId) return recovered;
    const { data } = await upstream("/api/token/?p=1&page_size=2", {
      accessToken: bundle.accessToken,
      ...upstreamRequestHints(req),
    });
    if (
      data?.total === 0 &&
      Array.isArray(data.items) &&
      data.items.length === 0
    ) {
      return await initializeLoginAuto(req, bundle);
    }
    if (
      data?.total !== 1 ||
      !Array.isArray(data.items) ||
      data.items.length !== 1
    ) {
      return {};
    }
    const token = data.items[0];
    if (
      (token?.group !== "" &&
        (token?.group !== "auto" || token.auto_groups?.length)) ||
      token.unlimited_quota !== true ||
      token.expired_time !== -1 ||
      !usableToken(token)
    ) {
      return {};
    }
    const selectedTokenId = integer(token.id, 1);
    const { data: result } = await upstream(
      `/api/token/${selectedTokenId}/key`,
      {
        method: "POST",
        accessToken: bundle.accessToken,
        ...upstreamRequestHints(req),
      },
    );
    if (typeof result?.key !== "string" || !result.key) return {};
    return {
      selectedTokenId,
      selectedKey: result.key.startsWith("sk-")
        ? result.key
        : `sk-${result.key}`,
    };
  } catch {
    // An unavailable or ambiguous default key must not block account login.
    return {};
  }
}

async function updateSelection(
  req: AccountRequest,
  tokenId?: number,
  key?: string,
) {
  const id = getSessionId(req);
  if (!id) throw new NewApiError("请重新登录", 401);
  await withSessionLock(id, async () => {
    const session = await readSessionById(id);
    if (!session?.user) throw new NewApiError("请重新登录", 401);
    session.selectedTokenId = tokenId;
    session.selectedKey = key;
    session.version++;
    await saveSession(id, session);
  });
}

async function selectAccountToken(
  req: AccountRequest,
  tokenId: number,
  expectedGroup?: string,
) {
  const { data: token } = await accountRequest(req, `/api/token/${tokenId}`);
  if (!usableToken(token)) {
    throw new NewApiError("该密钥已停用、过期或额度不足");
  }
  if (expectedGroup !== undefined && token.group !== expectedGroup)
    throw new NewApiError("密钥分组已改变，请重新选择分组", 409);
  const { data } = await accountRequest(req, `/api/token/${tokenId}/key`, {
    method: "POST",
  });
  if (typeof data?.key !== "string" || !data.key)
    throw new NewApiError("无法读取此密钥", 502);
  const key = data.key.startsWith("sk-") ? data.key : `sk-${data.key}`;
  await updateSelection(req, tokenId, key);
}

async function clearSelection(req: AccountRequest, tokenId: number, clearSelected = true) {
  const id = getSessionId(req);
  if (!id) return;
  await withSessionLock(id, async () => {
    const session = await readSessionById(id);
    if (session && (session.preparedKeys?.[String(tokenId)] ||
      (clearSelected && session.selectedTokenId === tokenId))) {
      if (clearSelected && session.selectedTokenId === tokenId) {
        delete session.selectedTokenId;
        delete session.selectedKey;
      }
      delete session.preparedKeys?.[String(tokenId)];
      session.version++;
      await saveSession(id, session);
    }
  });
}

async function status(localOnly = false) {
  const config = getNewApiConfig();
  const quotaPerPoint = communityQuotaPerPoint();
  const base = {
    enabled: config.enabled,
    configured: config.configured,
    publicUrl: config.enabled ? config.publicUrl : "",
    passwordLoginEnabled: false,
    registerEnabled: false,
    passwordRegisterEnabled: false,
    emailVerificationEnabled: false,
    userAgreementEnabled: false,
    privacyPolicyEnabled: false,
    turnstileSiteKey: "",
    quotaPerUnit: quotaPerPoint ?? 500000,
    currencySymbol: quotaPerPoint ? "积分" : "额度",
  };
  if (localOnly || !config.enabled || !config.configured) return ok(base);
  const { data } = await upstream("/api/status");
  const type = data.quota_display_type;
  const rate =
    type === "CNY"
      ? Number(data.usd_exchange_rate || 1)
      : type === "CUSTOM"
      ? Number(data.custom_currency_exchange_rate || 1)
      : 1;
  return ok({
    ...base,
    passwordLoginEnabled: data.password_login_enabled !== false,
    registerEnabled: data.register_enabled === true,
    passwordRegisterEnabled: data.password_register_enabled === true,
    emailVerificationEnabled: data.email_verification === true,
    userAgreementEnabled: data.user_agreement_enabled === true,
    privacyPolicyEnabled: data.privacy_policy_enabled === true,
    turnstileSiteKey: data.turnstile_check ? data.turnstile_site_key || "" : "",
    pointsPerUsd: quotaPerPoint && Number.isSafeInteger(data.quota_per_unit) && data.quota_per_unit > 0
      ? data.quota_per_unit / quotaPerPoint : undefined,
    quotaPerUnit: quotaPerPoint ?? (
      type === "TOKENS"
        ? 1
        : Number(data.quota_per_unit || 500000) / (rate > 0 ? rate : 1)),
    currencySymbol:
      quotaPerPoint ? "积分" : type === "CNY"
        ? "¥"
        : type === "CUSTOM"
        ? data.custom_currency_symbol || "额度"
        : type === "TOKENS"
        ? "Tokens"
        : "$",
  });
}

async function browserSession(req: AccountRequest) {
  if (!(await readSession(req))?.user) return publicSession(null);
  const { data } = await accountRequest(req, "/api/user/self", {
    reuseRequestSession: true,
    maxResponseBytes: 65536,
  });
  const { session } = await getAuthenticatedSession(req, true);
  return publicSession({ ...session, user: sanitizeUser(data) });
}

function validFlow(data: any) {
  return typeof data?.flow_token === "string" && data.flow_token.length > 0 && data.flow_token.length <= 4096 &&
    Number.isFinite(data.expires_at) && data.expires_at > Date.now() / 1000;
}

async function finishLogin(
  req: AccountRequest,
  result: Awaited<ReturnType<typeof upstream>>,
  expectedPrevious?: { id: string; version: number },
) {
  if (result.data?.requires_identity_selection === true) {
    const data = result.data;
    const validText = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
    if (!validFlow(data) || !Array.isArray(data.candidates) || data.candidates.length < 1 || data.candidates.length > 4 ||
      data.candidates.some((candidate: any) => !validText(candidate?.selection_id, 256) || !validText(candidate?.username, 128) || !validText(candidate?.account_label, 256)) ||
      new Set(data.candidates.map((candidate: any) => candidate.selection_id)).size !== data.candidates.length) {
      throw new NewApiError("账号服务返回了无效的账号选择，请重新登录", 502);
    }
    const candidates = data.candidates.map((candidate: any) => ({ selection_id: candidate.selection_id as string, username: candidate.username as string, account_label: candidate.account_label as string }));
    const res = ok({ requiresIdentitySelection: true, candidates, expiresAt: data.expires_at });
    await createSession(req, res, { flowToken: data.flow_token, flowExpiresAt: data.expires_at, identityCandidates: candidates }, expectedPrevious);
    return res;
  }
  if (result.data?.require_verification) {
    if (!validFlow(result.data) || !Array.isArray(result.data.methods) || !result.data.methods.some((method: any) => method?.method === "2fa" && method.available === true)) {
      throw new NewApiError("此账号需要其他验证方式，请前往账号中心处理", 400);
    }
    const res = ok({ requires2fa: true });
    await createSession(req, res, { flowToken: result.data.flow_token, flowExpiresAt: result.data.expires_at }, expectedPrevious);
    return res;
  }
  const credentials = authBundle(result.data, result.refreshToken);
  const bundle = { ...credentials, ...(await singleDefaultSelection(req, credentials)) };
  const res = ok(publicSession({ ...bundle, createdAt: 0, expiresAt: 0, version: 0 }));
  await createSession(req, res, bundle, expectedPrevious);
  return res;
}

export async function revokeAccountSession(req: AccountRequest) {
  const id = getSessionId(req);
  if (!id) return;
  await withSessionLock(id, async () => {
    const session = await readSessionById(id);
    if (session?.user) assertExpectedUser(req, session.user.id);
    if (session?.refreshToken) {
      try {
        await upstream("/api/user/auth/logout", {
          method: "POST",
          refreshToken: session.refreshToken,
          upstreamSessionId: session.upstreamSessionId,
          ...upstreamRequestHints(req),
        });
      } catch {
        // Local logout remains effective even when the upstream is offline.
      }
    }
    await removeSessionById(id);
  });
}

export async function handle(
  req: AccountRequest,
  path: string[],
) {
  try {
    const route = path.join("/");
    assertNormalRequest(req);
    if (req.method === "GET" && route === "status") {
      return await status(
        req.nextUrl.searchParams.get("scope") === "workspace",
      );
    }
    if (
      req.method === "GET" &&
      route === "bootstrap" &&
      !getNewApiConfig().enabled
    ) {
      return ok({ config: { authentication: "zhangyu" }, session: publicSession(null) });
    }
    requireNewApiConfig();
    if (req.method !== "GET") assertSameOrigin(req);
    if (req.headers.get("sec-fetch-site") === "cross-site") {
      throw new NewApiError("请求来源无效", 403);
    }
    if (req.method === "GET" && route === "bootstrap") {
      return ok({
        config: { authentication: "zhangyu", accountUrl: getNewApiConfig().publicUrl },
        session: await browserSession(req),
      });
    }

    if (req.method === "GET" && route === "model-pricing") {
      return ok(await readModelPricing(req));
    }
    if (req.method === "GET" && route === "wallet") return ok(await readWallet(req));
    if (req.method === "GET" && route === "wallet/points") return ok(await readCommunityWallet(req));
    if (req.method === "GET" && route === "wallet/point-lots") return ok(await readCommunityWalletLots(req));
    if (req.method === "GET" && route === "wallet/topup") return ok(await readWallet(req, "topup"));
    if (req.method === "GET" && route === "wallet/plans") return ok(await readWallet(req, "plans"));
    if (req.method === "GET" && route === "wallet/history") return ok(await readWallet(req, "history"));
    if (req.method === "POST" && route === "wallet/quote") return ok(await quoteWallet(req, await body(req)));
    if (req.method === "POST" && route === "wallet/pay") return ok(await createWalletPayment(req, await body(req), "topup"));
    if (req.method === "POST" && route === "wallet/subscription") return ok(await createWalletPayment(req, await body(req), "subscription"));
    if (req.method === "POST" && route === "wallet/redeem") return ok(await redeemWallet(req, await body(req)));

    if (req.method === "POST" && (route === "registration-code" || route === "register")) {
      const input = await body(req);
      const settings = (await upstream("/api/status")).data;
      if (settings?.register_enabled !== true || settings?.password_register_enabled !== true) {
        throw new NewApiError("当前平台未开放密码注册", 403, "NEW_API_REGISTRATION_DISABLED");
      }
      const turnstileToken = input.turnstile_token === undefined ? "" : input.turnstile_token;
      if (typeof turnstileToken !== "string" || turnstileToken.length > 2048) {
        throw new NewApiError("人机验证信息无效");
      }
      if (settings.turnstile_check && !turnstileToken.trim()) {
        throw new NewApiError("请先完成人机验证");
      }
      const email = input.email === undefined ? "" : input.email;
      const code = input.verification_code === undefined ? "" : input.verification_code;
      if (typeof email !== "string" || email.length > 50 ||
        (email && !/^[^\s@]+@[^\s@]+$/.test(email)) ||
        typeof code !== "string" || code.length > 128 || /[\u0000-\u001f\u007f]/.test(code)) {
        throw new NewApiError("请输入有效的邮箱和验证码");
      }
      const query = new URLSearchParams();
      if (turnstileToken) query.set("turnstile", turnstileToken);
      if (route === "registration-code") {
        if (settings.email_verification !== true) {
          throw new NewApiError("当前平台未启用注册邮箱验证", 403);
        }
        if (!email) throw new NewApiError("请输入邮箱");
        query.set("email", email);
        await upstream(`/api/verification?${query}`, {
          ...upstreamRequestHints(req),
          requireSuccess: true,
          maxResponseBytes: 65536,
        });
        return ok({ sent: true });
      }
      const username = typeof input.username === "string" ? input.username.trim() : "";
      const password = input.password;
      const affCode = input.aff_code === undefined ? "" : input.aff_code;
      if (!username || [...username].length > 20 || /[\u0000-\u001f\u007f]/.test(username) ||
        typeof password !== "string" || [...password].length < 8 || [...password].length > 128) {
        throw new NewApiError("用户名最多 20 个字符，密码须为 8 至 128 个字符");
      }
      if (typeof affCode !== "string" || (affCode && !/^[a-zA-Z0-9]{1,32}$/.test(affCode))) {
        throw new NewApiError("邀请码无效");
      }
      if (settings.email_verification === true && (!email || !code)) {
        throw new NewApiError("请输入邮箱和验证码");
      }
      await upstream(`/api/user/register${query.size ? `?${query}` : ""}`, {
        method: "POST",
        body: {
          username, password,
          ...(email ? { email } : {}),
          ...(code ? { verification_code: code } : {}),
          ...(affCode ? { aff_code: affCode } : {}),
        },
        ...upstreamRequestHints(req),
        requireSuccess: true,
        maxResponseBytes: 65536,
      });
      return ok({ registered: true });
    }

    if (req.method === "POST" && route === "login") {
      const input = await body(req);
      const username = String(input.username || "").trim();
      const password = String(input.password || "");
      const turnstileToken = String(input.turnstile_token || "");
      if (
        !username ||
        !password ||
        username.length > 128 ||
        password.length > 1024
      ) {
        throw new NewApiError("请输入有效的用户名和密码");
      }
      const statusData = (await upstream("/api/status")).data;
      if (statusData.password_login_enabled === false) {
        throw new NewApiError(
          "当前平台未开放密码登录，请前往账号中心登录",
          400,
        );
      }
      if (statusData.turnstile_check && !turnstileToken) {
        throw new NewApiError("请先完成人机验证");
      }
      const result = await upstream(
        `/api/user/login${
          turnstileToken
            ? `?turnstile=${encodeURIComponent(turnstileToken)}`
            : ""
        }`,
        {
          method: "POST",
          body: await loginCredentials(
            username,
            password,
            Boolean(statusData.password_login_encryption_enabled),
          ),
          ...upstreamRequestHints(req),
        },
      );
      return await finishLogin(req, result);
    }

    if (req.method === "POST" && route === "login-select") {
      const input = await body(req);
      const id = getSessionId(req);
      if (!id) throw new NewApiError("验证已过期，请重新登录", 401);
      const claimed = await withSessionLock(id, async () => {
        const pending = await readSession(req);
        if (!pending?.flowToken || !pending.identityCandidates || (pending.flowExpiresAt || 0) <= Date.now() / 1000) {
          throw new NewApiError("验证已过期，请重新登录", 401);
        }
        if (typeof input.selection_id !== "string" || !pending.identityCandidates.some(candidate => candidate.selection_id === input.selection_id)) {
          throw new NewApiError("请选择已验证的账号", 400);
        }
        // Claim before contacting upstream so a double click cannot consume the flow twice.
        await saveSession(id, { ...pending, flowToken: undefined, version: pending.version + 1 });
        return { token: pending.flowToken, version: pending.version + 1 };
      });
      const result = await upstream("/api/user/login/select", {
        method: "POST", body: { flow_token: claimed.token, selection_id: input.selection_id },
        ...upstreamRequestHints(req),
      });
      return await finishLogin(req, result, { id, version: claimed.version });
    }

    if (req.method === "POST" && route === "login-cancel") {
      const id = getSessionId(req);
      if (id) await withSessionLock(id, async () => {
        const pending = await readSession(req);
        if (pending && !pending.user) await removeSessionById(id);
      });
      return ok();
    }

    if (req.method === "POST" && route === "login-2fa") {
      const input = await body(req);
      const pending = await readSession(req);
      if (
        !pending?.flowToken ||
        pending.identityCandidates ||
        (pending.flowExpiresAt || 0) <= Date.now() / 1000
      ) {
        throw new NewApiError("验证已过期，请重新登录", 401);
      }
      const code = String(input.code || "").trim();
      if (!/^[A-Za-z0-9-]{6,32}$/.test(code)) {
        throw new NewApiError("请输入有效的验证码或恢复码");
      }
      const result = await upstream("/api/user/login/verify", {
        method: "POST",
        body: { flow_token: pending.flowToken, method: "2fa", code },
        ...upstreamRequestHints(req),
      });
      return await finishLogin(req, result, { id: getSessionId(req)!, version: pending.version });
    }

    if (req.method === "POST" && route === "logout") {
      await revokeAccountSession(req);
      const res = ok();
      await deleteSession(req, res);
      return res;
    }

    if (req.method === "GET" && route === "session") {
      return ok(await browserSession(req));
    }

    if (req.method === "GET" && route === "login-identifiers") {
      const { data } = await accountRequest(req, "/api/user/self/login-identifiers", { maxResponseBytes: 32768 });
      const valid = (value: unknown) => typeof value === "string" && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
      if (!valid(data?.username) || !data.username || !valid(data.email) || !Array.isArray(data.login_identifiers) || data.login_identifiers.length > 64 || data.login_identifiers.some((value: unknown) => !valid(value) || !value)) {
        throw new NewApiError("无法读取登录账号信息，请稍后重试", 502);
      }
      return ok({ username: data.username, email: data.email, login_identifiers: data.login_identifiers });
    }

    if (req.method === "GET" && route === "groups") {
      const { data } = await accountRequest(req, "/api/user/self/groups");
      return ok(
        Object.entries(data || {}).map(([name, value]: [string, any]) => ({
          id: name,
          name,
          ratio: value.ratio,
          description: String(value.desc || ""),
        })),
      );
    }

    if (req.method === "GET" && route === "auto-groups") {
      try {
        const { data } = await accountRequest(req, "/api/token/auto-groups");
        if (
          !Array.isArray(data?.groups) ||
          data.groups.some((group: unknown) => typeof group !== "string") ||
          !Number.isSafeInteger(data.max_count) ||
          data.max_count < 1
        ) {
          throw new NewApiError("账号服务返回了无效的多分组设置", 502);
        }
        return ok({
          supported: true,
          defaultGroups: data.groups,
          maxCount: data.max_count,
        });
      } catch (error) {
        if (!(error instanceof NewApiError) || error.status !== 404)
          throw error;
        return ok({ supported: false, defaultGroups: [], maxCount: 0 });
      }
    }

    if (req.method === "GET" && route === "model-groups") {
      const { session } = await getAuthenticatedSession(req);
      const [{ data: groups }, token] = await Promise.all([
        accountRequest(req, "/api/user/self/groups"),
        session.selectedTokenId
          ? accountRequest(req, `/api/token/${session.selectedTokenId}`)
              .then(({ data }) => data)
              .catch((error) => {
                if (!(error instanceof NewApiError) || error.status !== 404)
                  throw error;
                return null;
              })
          : null,
      ]);
      const selectedGroup =
        typeof token?.group === "string" ? token.group : null;
      return ok({
        selectedGroup,
        selectedAutoGroups:
          token?.group === "auto" ? token.auto_groups ?? [] : [],
        groups: [
          ...Object.entries(groups || {})
            .filter(([id]) => id !== "")
            .sort(([a], [b]) => (a === "auto" ? -1 : b === "auto" ? 1 : 0))
            .map(([id, value]: [string, any]) => ({
              id,
              name: id,
              ratio: value.ratio,
              description: String(value.desc || ""),
            })),
        ],
      });
    }
    if (req.method === "POST" && route === "model-groups/select") {
      const { group } = await body(req);
      if (
        typeof group !== "string" ||
        group !== group.trim() ||
        group.length > 128
      )
        throw new NewApiError("分组参数无效");
      const tokenId = await resolveModelGroup(req, group);
      if (!tokenId) throw new NewApiError("该分组密钥暂不可用", 409);
      await selectAccountToken(req, tokenId, group);
      return ok({ selectedTokenId: tokenId, group });
    }

    if (req.method === "GET" && route === "tokens") {
      const { page, size, query } = pagination(req);
      const { data } = await accountRequest(req, "/api/token/?" + query);
      return ok({
        items: (data?.items || []).map(safeToken),
        total: Number(data?.total || 0),
        page,
        size,
      });
    }
    if (req.method === "POST" && route === "tokens") {
      const token = tokenForm(await body(req));
      await validateTokenGroups(req, token);
      await accountRequest(req, "/api/token/", {
        method: "POST",
        body: token,
      });
      return ok();
    }

    const tokenMatch = /^tokens\/([1-9]\d*)(\/select)?$/.exec(route);
    if (tokenMatch) {
      const tokenId = integer(tokenMatch[1], 1);
      if (req.method === "POST" && tokenMatch[2]) {
        await selectAccountToken(req, tokenId);
        return ok({ selectedTokenId: tokenId });
      }
      const { data: token } = await accountRequest(
        req,
        `/api/token/${tokenId}`,
      );
      if (!tokenMatch[2] && req.method === "PUT") {
        const updated = tokenForm(await body(req), token);
        await validateTokenGroups(req, updated, token);
        await accountRequest(req, "/api/token/", {
          method: "PUT",
          body: updated,
        });
        await clearSelection(req, tokenId, false);
        return ok();
      }
      if (!tokenMatch[2] && req.method === "PATCH") {
        const input = await body(req);
        const status = integer(input.status, 1, 2);
        await accountRequest(req, "/api/token/?status_only=true", {
          method: "PUT",
          body: { id: tokenId, status },
        });
        await clearSelection(req, tokenId, status === 2);
        return ok();
      }
      if (!tokenMatch[2] && req.method === "DELETE") {
        await accountRequest(req, `/api/token/${tokenId}`, {
          method: "DELETE",
        });
        await clearSelection(req, tokenId);
        return ok();
      }
    }

    if (req.method === "GET" && route === "logs") {
      const { page, size, query } = pagination(req);
      const end = Math.floor(Date.now() / 1000);
      const { data } = await accountRequest(
        req,
        `/api/log/self?${query}&type=2&start_timestamp=${
          end - 7 * 86400
        }&end_timestamp=${end}`,
      );
      return ok({
        items: (data?.items || []).map((log: any) => ({
          id: log.id,
          created_at: log.created_at,
          model_name: log.model_name,
          token_name: log.token_name,
          prompt_tokens: log.prompt_tokens,
          completion_tokens: log.completion_tokens,
          quota: log.quota,
          type: log.type,
          content: log.content,
        })),
        total: Number(data?.total || 0),
        page,
        size,
      });
    }
    throw new NewApiError("接口不存在", 404);
  } catch (error) {
    const known = error instanceof NewApiError;
    return AccountResponse.json(
      {
        success: false,
        message: known ? error.message : "账号服务暂时不可用，请稍后重试",
        code: known ? error.code : "NEW_API_UNAVAILABLE",
      },
      {
        status: known ? error.status : 503,
        headers: {
          ...NO_CACHE,
          ...(known && error.retryAfter
            ? { "Retry-After": error.retryAfter }
            : {}),
        },
      },
    );
  }
}
