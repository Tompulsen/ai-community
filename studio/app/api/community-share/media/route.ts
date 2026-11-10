import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, getAuthenticatedSession } from "@/app/lib/new-api/client";
import { embedContext } from "@/app/lib/new-api/community-embed-validation";
import { NewApiError } from "@/app/lib/new-api/config";
import { fetchPublicMedia, PublicImageError } from "@/app/utils/public-image-fetch";
import { readRequestBody, RequestBodyError } from "@/app/utils/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 256 * 1024 * 1024;
const active = new Set<string>();
const recent = new Map<string, { count: number; expires: number }>();
const NO_CACHE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Authenticated, bounded public-media import. Never forwards account credentials upstream. */
export async function POST(request: NextRequest) {
  let release: (() => void) | undefined;
  try {
    assertSameOrigin(request);
    if (!embedContext(request)) throw new NewApiError("Embedded session required", 401);
    const { session } = await getAuthenticatedSession(request, true);
    const grant = session.communityEmbed;
    if (!grant || !session.user || String(session.user.id) !== grant.subject) throw new NewApiError("Account mismatch", 401);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new PublicImageError("JSON required", 415);
    let input: { url?: unknown; kind?: unknown; maxBytes?: unknown };
    try { input = JSON.parse((await readRequestBody(request, 12000))?.toString("utf8") || "{}"); } catch (error) { if (error instanceof RequestBodyError) throw error; throw new PublicImageError("Invalid request", 400); }
    if (!input || typeof input.url !== "string" || input.url.length > 8000 || !["image", "video"].includes(String(input.kind)) || !Number.isSafeInteger(input.maxBytes) || Number(input.maxBytes) < 1) throw new PublicImageError("Invalid request", 400);
    const owner = grant.subject, now = Date.now();
    for (const [key, value] of recent) if (value.expires <= now) recent.delete(key);
    const rate = recent.get(owner) || { count: 0, expires: now + 300000 };
    if (active.has(owner) || active.size >= 16 || rate.count >= 60) throw new PublicImageError("Please retry later", 429);
    active.add(owner); rate.count++; recent.set(owner, rate);
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, 120000);
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    let released = false;
    release = () => { if (released) return; released = true; clearTimeout(timer); request.signal.removeEventListener("abort", abort); controller.abort(); active.delete(owner); };
    const response = await fetchPublicMedia(input.url, input.kind as "image" | "video", Math.min(MAX_BYTES, Number(input.maxBytes)), controller.signal);
    const reader = response.body!.getReader();
    const unlock = release;
    let outputController: ReadableStreamDefaultController, finished = false;
    const stream = new ReadableStream({
      start(output) { outputController = output; },
      async pull(output) {
        try {
          const item = await reader.read();
          if (finished) return;
          if (item.done) { finished = true; output.close(); unlock(); } else output.enqueue(item.value);
        } catch (error) { if (!finished) { finished = true; output.error(error); } unlock(); }
      },
      async cancel() { finished = true; try { await reader.cancel(); } finally { unlock(); } },
    });
    controller.signal.addEventListener("abort", () => {
      if (!finished) { finished = true; outputController.error(new Error("Media import interrupted")); }
      void reader.cancel().catch(() => {}).finally(unlock);
    }, { once: true });
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(NO_CACHE)) headers.set(name, value);
    return new NextResponse(stream, { headers });
  } catch (error) {
    release?.();
    // An upstream 401 is a media failure, not an expired studio identity.
    const status = error instanceof NewApiError || error instanceof RequestBodyError ? error.status : error instanceof PublicImageError && [400, 413, 415, 429, 504].includes(error.status) ? error.status : 502;
    return NextResponse.json({ error: "Media could not be imported" }, { status, headers: NO_CACHE });
  }
}
