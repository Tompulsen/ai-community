import { NextRequest } from "next/server";
import { checkRateLimit } from "../utils/rate-limit";
import { getClientIp } from "../utils/request-ip";
import { getAuthenticatedSession } from "./new-api/client";
import { isNewApiEnabled, NewApiError } from "./new-api/config";

function queryLimit(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export async function limitModelRequest(req: NextRequest, path?: string) {
  const subpath = path ?? req.nextUrl.pathname.replace(/^\/api\/(?:v1\/)?/, "");
  const query =
    req.method === "GET" &&
    (/^async-(?:images|videos)\/v1\/tasks\/[A-Za-z0-9_-]+$/.test(subpath) ||
      /^videos\/[A-Za-z0-9_-]+$/.test(subpath) ||
      /^tasks\/[A-Za-z0-9_-]+(?:\/artifacts)?$/.test(subpath) ||
      /^(?:api\/v3|ark)\/contents\/generations\/tasks\/[A-Za-z0-9_-]+$/.test(
        subpath,
      ) ||
      /^v1beta\/models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9_-]+$/.test(
        subpath,
      ) ||
      (subpath === "images/generations" &&
        req.nextUrl.searchParams.has("task_id")));
  const identity = isNewApiEnabled()
    ? "account:" + (await getAuthenticatedSession(req, true)).session.user!.id
    : "ip:" + getClientIp(req);
  const result = checkRateLimit(
    `${query ? "model-query" : "model"}:${identity}`,
    query
      ? {
          maxRequests: queryLimit(process.env.MODEL_QUERY_RATE_LIMIT_MAX, 600),
          windowMs:
            queryLimit(process.env.MODEL_QUERY_RATE_LIMIT_WINDOW, 60) * 1000,
        }
      : undefined,
  );
  if (!result.allowed) {
    throw new NewApiError(
      "请求过于频繁，请稍后再试",
      429,
      "MODEL_RATE_LIMIT",
      String(result.retryAfter),
    );
  }
}
