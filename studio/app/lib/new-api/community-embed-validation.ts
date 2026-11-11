import { NextRequest } from "next/server";
import { NewApiError, requireNewApiConfig } from "./config";
import type { AccountSession } from "./session";

export const EMBED_HEADER = "x-community-embed";
export const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
export type CommunityBinding = {
  community: string;
  studio: string;
  issuer: string;
  subject: string;
  userId: string;
  tokenHash: string;
  context: string;
};

function origin(value: string | undefined): string {
  const parsed = new URL(value || "invalid");
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("Invalid community configuration");
  return parsed.origin;
}

export function embedConfig() {
  const api = requireNewApiConfig();
  const secret = process.env.COMMUNITY_SSO_SECRET || "";
  if (secret.length < 32 || !api.redisUrl)
    throw new Error("Embedded studio unavailable");
  return {
    community: origin(process.env.COMMUNITY_SSO_ORIGIN),
    studio: origin(process.env.STUDIO_PUBLIC_ORIGIN),
    issuer: origin(api.publicUrl),
    secret,
  };
}

export function embedContext(req: NextRequest): string | null {
  const context = req.headers.get(EMBED_HEADER);
  if (context !== null) {
    if (!OPAQUE.test(context))
      throw new NewApiError(
        "请从社区重新进入制作页面",
        403,
        "COMMUNITY_CONTEXT_REQUIRED",
      );
    return context;
  }
  // Passive media and downloads cannot set headers. The dedicated document URL
  // carries the non-secret context; only a same-origin referrer may supply it.
  let embeddedReferrer = false;
  let referrer: URL | undefined;
  try {
    referrer = new URL(req.headers.get("referer") || "");
    embeddedReferrer = referrer.pathname === "/studio/community-embed";
  } catch {}
  if (
    embeddedReferrer &&
    referrer?.origin === embedConfig().studio
  ) {
    const mediaContext = referrer.searchParams.get("context") || "";
    if (OPAQUE.test(mediaContext)) return mediaContext;
  }
  if (
    embeddedReferrer ||
    req.cookies.getAll().some((cookie) => /^__Host-octopus-embed-[A-Za-z0-9_-]{43}$/.test(cookie.name))
  )
    throw new NewApiError(
      "请重新连接社区制作空间",
      401,
      "COMMUNITY_CONTEXT_REQUIRED",
    );
  return null;
}

export function embeddedCookie(context: string): string {
  if (!OPAQUE.test(context)) throw new Error("Invalid embedded context");
  return `__Host-octopus-embed-${context}`;
}

export function assertSessionTransport(
  req: NextRequest,
  session: AccountSession,
) {
  const context = embedContext(req);
  const binding = session.communityEmbed;
  if (
    context
      ? !binding ||
        binding.context !== context ||
        String(session.user?.id) !== binding.subject
      : Boolean(binding)
  ) {
    throw new NewApiError(
      "社区账号已变化，请重新进入制作空间",
      401,
      "COMMUNITY_ACCOUNT_CHANGED",
    );
  }
}

export async function communityRequest(
  path: "exchange" | "validate",
  body: object,
) {
  const config = embedConfig();
  const response = await fetch(
    `${process.env.COMMUNITY_INTERNAL_URL || config.community}/api/newapi/studio/${path}`,
    {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.secret}`,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok)
    throw new NewApiError(
      "社区登录已变化或已过期，请重新进入",
      401,
      "COMMUNITY_ACCOUNT_CHANGED",
    );
  return response.json();
}

export async function validateCommunityBinding(binding: CommunityBinding) {
  const config = embedConfig();
  if (
    binding.community !== config.community ||
    binding.studio !== config.studio ||
    binding.issuer !== config.issuer
  )
    throw new NewApiError(
      "制作空间配置已变化，请重新进入",
      401,
      "COMMUNITY_ACCOUNT_CHANGED",
    );
  const result = await communityRequest("validate", {
    userId: binding.userId,
    tokenHash: binding.tokenHash,
    subject: binding.subject,
    issuer: binding.issuer,
    context: binding.context,
  });
  if (result?.valid !== true)
    throw new NewApiError(
      "社区账号已变化，请重新进入",
      401,
      "COMMUNITY_ACCOUNT_CHANGED",
    );
}

export async function validateEmbeddedSession(
  req: NextRequest,
  session: AccountSession,
) {
  assertSessionTransport(req, session);
  if (session.communityEmbed)
    await validateCommunityBinding(session.communityEmbed);
}
