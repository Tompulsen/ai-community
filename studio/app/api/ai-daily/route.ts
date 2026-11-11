import { NextRequest, NextResponse } from "next/server";
import { dailyIndexSchema, dailyReportSchema } from "@/app/utils/ai-daily";
import { dailyFreshness } from "@/app/utils/ai-daily-cache";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DailyResponse = {
  body: string;
  etag: string;
  upstreamEtag: string | null;
  cacheControl: string;
  expires: number;
};
const cache = new Map<string, DailyResponse>();
const pending = new Map<string, Promise<DailyResponse>>();

async function readDaily(date: string | null): Promise<DailyResponse> {
  const key = date ?? "";
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved;
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const request = (async () => {
    const response = await fetch(
      "https://aihot.news/api/v1/dailies" + (date ? "/" + date : "?limit=7"),
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "aihot-api/2.0.0",
          ...(saved?.upstreamEtag
            ? { "If-None-Match": saved.upstreamEtag }
            : {}),
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok && !(response.status === 304 && saved)) {
      throw new DailyError(
        response.status === 429 ? 429 : 502,
        response.status === 429 ? response.headers.get("retry-after") : null,
      );
    }
    let result: DailyResponse;
    if (response.status === 304 && saved) {
      result = { ...saved };
    } else {
      const data: unknown = await response.json();
      const parsed = date
        ? dailyReportSchema.parse(data)
        : dailyIndexSchema.parse(data);
      if ("report" in parsed && parsed.report.date !== date) {
        throw new Error("Daily date mismatch");
      }
      // Serialize once, keeping attribution and optional service notices intact.
      const body = JSON.stringify(data);
      result = {
        body,
        etag: `"${createHash("sha256").update(body).digest("hex")}"`,
        upstreamEtag: response.headers.get("etag"),
        cacheControl:
          response.headers.get("cache-control") ??
          `public, max-age=${date ? 300 : 60}`,
        expires: 0,
      };
    }
    result.upstreamEtag = response.headers.get("etag") ?? result.upstreamEtag;
    result.cacheControl =
      response.headers.get("cache-control") ?? result.cacheControl;
    const freshnessHeaders = new Headers(response.headers);
    freshnessHeaders.set("cache-control", result.cacheControl);
    const lifetime = dailyFreshness(freshnessHeaders);
    result.expires = Date.now() + lifetime * 1000;
    cache.delete(key);
    if (lifetime > 0) {
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
    }
    return result;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}

class DailyError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: string | null,
  ) {
    super("Daily unavailable");
  }
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (
    date !== null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + "T00:00:00Z")) ||
      new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
  ) {
    return NextResponse.json(
      { error: "日报日期无效" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const result = await readDaily(date);
    const remaining = Math.max(
      0,
      Math.floor((result.expires - Date.now()) / 1000),
    );
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control":
        remaining > 0
          ? `public, max-age=${remaining}, must-revalidate`
          : "no-store",
      ETag: result.etag,
    };
    const matches = req.headers
      .get("if-none-match")
      ?.split(",")
      .some((value) => {
        const tag = value.trim();
        return tag === "*" || tag.replace(/^W\//, "") === result.etag;
      });
    return new NextResponse(matches ? null : result.body, {
      status: matches ? 304 : 200,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "日报暂时无法读取，请稍后重试" },
      {
        status: error instanceof DailyError ? error.status : 502,
        headers: {
          "Cache-Control": "no-store",
          ...(error instanceof DailyError && error.retryAfter
            ? { "Retry-After": error.retryAfter }
            : {}),
        },
      },
    );
  }
}
