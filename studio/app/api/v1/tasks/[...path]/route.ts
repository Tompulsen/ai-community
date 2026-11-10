import { NextRequest, NextResponse } from "next/server";
import { handleEdgeProxy } from "../../_proxy";

export const runtime = "nodejs";

async function proxy(req: NextRequest, path: string[]) {
  const id = /^[A-Za-z0-9_-]{1,200}$/;
  const allowed =
    (path.length === 1 && id.test(path[0])) ||
    (req.method === "GET" &&
      id.test(path[0]) &&
      path[1] === "artifacts" &&
      (path.length === 2 ||
        (path.length === 4 &&
          /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,199}$/.test(path[2]) &&
          path[3] === "content")));
  if (!allowed)
    return NextResponse.json(
      { error: true, message: "任务接口路径无效" },
      { status: 400 },
    );
  return handleEdgeProxy(req, `tasks/${path.join("/")}`);
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
