import { NextRequest } from "next/server";
import { proxyGeminiChat } from "../../gemini-proxy";
import { proxyGeminiVideo } from "../../gemini-video-proxy";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return path[path.length - 1]?.endsWith(":predictLongRunning")
    ? proxyGeminiVideo(req, path)
    : proxyGeminiChat(req, path);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyGeminiVideo(req, (await params).path);
}

export const runtime = "nodejs";
export const maxDuration = 600;
