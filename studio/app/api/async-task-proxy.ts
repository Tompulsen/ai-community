import { NextRequest, NextResponse } from "next/server";
import { handleEdgeProxy } from "./v1/_proxy";

export function proxyAsyncTask(
  req: NextRequest,
  kind: "images" | "videos",
  path: string[],
) {
  const submit =
    req.method === "POST" &&
    path.length === 1 &&
    (path[0] === "tasks" || (kind === "images" && path[0] === "edits"));
  const query =
    req.method === "GET" &&
    path.length === 2 &&
    path[0] === "tasks" &&
    /^[A-Za-z0-9_-]{1,200}$/.test(path[1]);
  if (!submit && !query) {
    return NextResponse.json(
      { error: true, message: "不支持的异步任务接口" },
      { status: 404 },
    );
  }
  const subpath = `async-${kind}/v1/${path.join("/")}`;
  return handleEdgeProxy(req, subpath, { upstreamPath: subpath });
}
