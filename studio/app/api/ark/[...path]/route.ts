import { NextRequest, NextResponse } from "next/server";
import { handleEdgeProxy } from "../../v1/_proxy";

export const runtime = "nodejs";

async function proxy(req: NextRequest, path: string[]) {
  const allowed =
    path[0] === "contents" &&
    path[1] === "generations" &&
    path[2] === "tasks" &&
    ((req.method === "POST" && path.length === 3) ||
      (req.method === "GET" &&
        path.length === 4 &&
        /^[A-Za-z0-9_-]{1,200}$/.test(path[3])));
  if (!allowed || req.nextUrl.searchParams.size)
    return NextResponse.json(
      { error: true, message: "Seedance 视频接口路径无效" },
      { status: 400 },
    );
  const subpath = `api/v3/${path.join("/")}`;
  return handleEdgeProxy(req, subpath, { upstreamPath: subpath });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, (await params).path);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, (await params).path);
}
