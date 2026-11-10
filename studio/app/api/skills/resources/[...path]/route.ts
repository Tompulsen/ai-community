import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESOURCE_BASE =
  "https://raw.githubusercontent.com/qzq00767/octopus-skills/main/skills/";

function resourceError(status: number) {
  return new NextResponse(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const parts = (await params).path;
  const catalog =
    parts.length === 1 &&
    (parts[0] === "catalog.json" || parts[0] === "catalog-v2.json");
  const document =
    parts.length === 2 &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(parts[0]) &&
    parts[1] === "SKILL.md";
  if (!catalog && !document) return resourceError(404);

  const maxBytes = catalog ? 128000 : 32000;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  req.signal.addEventListener("abort", cancel, { once: true });
  if (req.signal.aborted) controller.abort();
  const timeout = setTimeout(cancel, 15000);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    response = await fetch(RESOURCE_BASE + parts.join("/"), {
      headers: { Accept: catalog ? "application/json" : "text/plain" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      return resourceError(
        [404, 410, 429].includes(response.status) ? response.status : 502,
      );
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      return resourceError(413);
    }
    if (!response.body) return resourceError(502);
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) return resourceError(413);
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new NextResponse(body, {
      headers: {
        "Content-Type": catalog
          ? "application/json; charset=utf-8"
          : "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=60, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return resourceError(
      req.signal.aborted ? 499 : controller.signal.aborted ? 504 : 502,
    );
  } finally {
    clearTimeout(timeout);
    req.signal.removeEventListener("abort", cancel);
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    } else {
      await response?.body?.cancel().catch(() => {});
    }
  }
}
