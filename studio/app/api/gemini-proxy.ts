import { NextRequest, NextResponse } from "next/server";
import { handleEdgeProxy } from "./v1/_proxy";

export function proxyGeminiChat(req: NextRequest, path: string[]) {
  if (
    path.length !== 2 ||
    path[0] !== "models" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*:(?:generateContent|streamGenerateContent)$/.test(
      path[1],
    ) ||
    Array.from(req.nextUrl.searchParams).some(
      ([key, value]) => key !== "alt" || value !== "sse",
    )
  ) {
    return Promise.resolve(
      NextResponse.json(
        { error: true, message: "不支持的 Gemini 聊天请求路径" },
        { status: 400 },
      ),
    );
  }
  return handleEdgeProxy(req, "chat/completions", {
    upstreamPath: `v1beta/${path.join("/")}`,
  });
}
