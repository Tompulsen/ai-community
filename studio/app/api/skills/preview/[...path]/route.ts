import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (process.env.NODE_ENV !== "development")
    return new NextResponse(null, { status: 404 });
  const name = (await params).path.join("/");
  if (
    name !== "catalog.json" &&
    name !== "catalog-v2.json" &&
    !/^[a-z0-9-]+\/SKILL\.md$/.test(name)
  )
    return new NextResponse(null, { status: 404 });
  try {
    const body = await readFile(
      path.join(
        process.cwd(),
        "skills",
        name === "catalog-v2.json" ? "catalog.json" : name,
      ),
      "utf8",
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": name.endsWith(".json")
          ? "application/json"
          : "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
