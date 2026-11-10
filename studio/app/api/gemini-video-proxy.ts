import { NextRequest, NextResponse } from "next/server";
import { handleEdgeProxy } from "./v1/_proxy";

export function proxyGeminiVideo(req: NextRequest, path: string[]) {
  const subpath = path.join("/");
  const download =
    req.method === "GET" &&
    /^files\/[A-Za-z0-9_-]{1,200}:download$/.test(subpath);
  const allowed =
    (req.method === "POST" &&
      /^models\/[A-Za-z0-9][A-Za-z0-9._-]*:predictLongRunning$/.test(
        subpath,
      )) ||
    (req.method === "GET" &&
      /^models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9_-]+$/.test(subpath)) ||
    download;
  const query = [...req.nextUrl.searchParams];
  if (
    !allowed ||
    query.some(
      ([key, value]) => !download || key !== "alt" || value !== "media",
    )
  )
    return Promise.resolve(
      NextResponse.json(
        { error: true, message: "Gemini 视频接口路径无效" },
        { status: 400 },
      ),
    );
  return handleEdgeProxy(req, `v1beta/${subpath}`, {
    upstreamPath: `v1beta/${subpath}`,
    gemini: true,
  });
}
