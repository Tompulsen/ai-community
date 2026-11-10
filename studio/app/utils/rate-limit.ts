const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupTimer !== null) return;
  if (typeof setInterval === "undefined") return;

  cleanupTimer = setInterval(
    () => {
      const now = Date.now();
      for (const [key, val] of rateLimitMap) {
        if (now > val.resetTime) rateLimitMap.delete(key);
      }
      if (rateLimitMap.size === 0 && cleanupTimer !== null) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
    },
    5 * 60 * 1000,
  );
}

function integer(value: unknown, fallback: number, minimum = 1) {
  if (value == null || (typeof value === "string" && !value.trim()))
    return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : fallback;
}

function getConfig(limits?: { maxRequests?: number; windowMs?: number }) {
  const maxRequests = integer(
    limits?.maxRequests,
    integer(process.env.RATE_LIMIT_MAX, 100, 0),
    0,
  );
  const windowMs = integer(
    limits?.windowMs,
    integer(process.env.RATE_LIMIT_WINDOW, 60) * 1000,
  );
  const enabled = process.env.ENABLE_RATE_LIMIT !== "false";
  return { maxRequests, windowMs, enabled };
}

export function checkRateLimit(
  ip: string,
  limits?: { maxRequests?: number; windowMs?: number },
): {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
} {
  const { maxRequests, windowMs, enabled } = getConfig(limits);

  if (!enabled) {
    return { allowed: true, remaining: maxRequests, retryAfter: 0 };
  }

  // 标准化 IP 地址，移除 IPv6 前缀
  const normalizedIp = ip.replace(/^::ffff:/, "").trim() || "unknown";

  const now = Date.now();
  const record = rateLimitMap.get(normalizedIp);

  if (!record || now >= record.resetTime) {
    rateLimitMap.set(normalizedIp, { count: 1, resetTime: now + windowMs });
    ensureCleanup();
    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - 1),
      retryAfter: 0,
    };
  }

  if (record.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((record.resetTime - now) / 1000)),
    };
  }

  record.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - record.count,
    retryAfter: 0,
  };
}
