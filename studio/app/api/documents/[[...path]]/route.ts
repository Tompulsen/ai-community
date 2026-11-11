import { NextRequest, NextResponse } from "next/server";
import {
  assertSameOrigin,
  getAuthenticatedSession,
} from "@/app/lib/new-api/client";
import { NewApiError } from "@/app/lib/new-api/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const id = "[a-fA-F0-9-]{36}";
const routes: Record<string, RegExp> = {
  GET: new RegExp(
    `^(?:capabilities|assets|jobs/${id}|assets/${id}/versions|assets/${id}/[1-9][0-9]{0,5}/(?:structure|changes|download))$`,
  ),
  POST: new RegExp(`^(?:jobs|upload|jobs/${id}/retry)$`),
  DELETE: new RegExp(`^jobs/${id}$`),
};
async function handler(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
) {
  try {
    const resource = (await context.params).path?.join("/") || "";
    if (!routes[req.method]?.test(resource))
      return new NextResponse(null, { status: 404 });
    if (req.method !== "GET") assertSameOrigin(req);
    if (req.headers.get("sec-fetch-site") === "cross-site")
      return new NextResponse(null, { status: 403 });
    const { session } = await getAuthenticatedSession(req, true);
    const origin = process.env.DOCUMENT_SERVICE_URL;
    const secret = process.env.DOCUMENT_SERVICE_SECRET;
    if (!origin || !secret || secret.length < 32) {
      return NextResponse.json(
        { error: "文档服务暂未就绪，请稍后重试。", enabled: false },
        { status: 503 },
      );
    }
    const upstream = new URL(resource, origin.replace(/\/$/, "") + "/");
    if (resource === "assets" && req.nextUrl.searchParams.has("sessionId"))
      upstream.searchParams.set(
        "sessionId",
        req.nextUrl.searchParams.get("sessionId")!.slice(0, 128),
      );
    const headers: Record<string, string> = {
      Authorization: `Bearer ${secret}`,
      "X-Document-Owner": `user-${session.user!.id}`,
    };
    for (const name of [
      "content-type",
      "idempotency-key",
      "x-file-name",
      "x-chat-session",
    ]) {
      const value = req.headers.get(name);
      if (value) headers[name] = value;
    }
    let bytes: Uint8Array | undefined;
    if (req.method === "POST") {
      const limit = resource === "upload" ? 20 * 1024 * 1024 : 600 * 1024;
      if (Number(req.headers.get("content-length")) > limit)
        return new NextResponse(null, { status: 413 });
      const reader = req.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (reader) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > limit)
            return NextResponse.json(
              { error: "文件或计划超过大小限制" },
              { status: 413 },
            );
          chunks.push(chunk.value);
        }
      } finally {
        await reader?.cancel();
      }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    const response = await fetch(upstream, {
      method: req.method,
      headers,
      body: bytes,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const outgoing = new Headers({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of [
      "content-type",
      "content-disposition",
      "content-length",
    ]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new NextResponse(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof NewApiError
            ? error.message
            : "文档服务暂时不可用，请稍后重试。",
      },
      {
        status: error instanceof NewApiError ? error.status : 502,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
export { handler as GET, handler as POST, handler as DELETE };
