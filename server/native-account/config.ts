export function isNewApiEnabled() {
  return Boolean(process.env.NEW_API_BASE_URL?.trim());
}

export function getNewApiImageBaseUrl() {
  const configured = process.env.NEW_API_IMAGE_BASE_URL?.trim();
  if (!configured) return undefined;
  const url = new URL(configured);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("NEW_API_IMAGE_BASE_URL must be an HTTP(S) origin");
  }
  return url.origin;
}

export function getNewApiConfig() {
  const url = new URL(process.env.NEW_API_BASE_URL || "http://localhost");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("NEW_API_BASE_URL must be an HTTP(S) origin");
  }
  const publicUrl = new URL(process.env.NEW_API_PUBLIC_URL || url.origin);
  if (!["http:", "https:"].includes(publicUrl.protocol)) {
    throw new Error("NEW_API_PUBLIC_URL must be an HTTP(S) URL");
  }
  const secret = process.env.NEW_API_SESSION_SECRET || "";
  const redisUrl = process.env.NEW_API_REDIS_URL || "";
  return {
    enabled: isNewApiEnabled(),
    baseUrl: url.origin,
    publicUrl: publicUrl.origin,
    secret,
    redisUrl,
    configured:
      secret.length >= 32 &&
      (process.env.NODE_ENV !== "production" || Boolean(redisUrl)),
  };
}

export function getNewApiAsyncBaseUrl() {
  const url = new URL(
    process.env.NEW_API_ASYNC_BASE_URL?.trim() || getNewApiConfig().publicUrl,
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("NEW_API_ASYNC_BASE_URL must be an HTTP(S) origin");
  }
  return url.origin;
}

export class NewApiError extends Error {
  status: number;
  code: string;
  retryAfter?: string;
  constructor(
    message: string,
    status = 400,
    code = "NEW_API_ERROR",
    retryAfter?: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.name = "NewApiError";
  }
}

export function requireNewApiConfig() {
  const config = getNewApiConfig();
  if (!config.enabled) {
    throw new NewApiError("账号接入尚未启用", 503, "NEW_API_DISABLED");
  }
  if (!config.configured) {
    throw new NewApiError("账号服务配置不完整，请联系管理员", 503);
  }
  return config;
}
