import { NextRequest } from "next/server";
import { handleEdgeProxy } from "@/app/api/v1/_proxy";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  return handleEdgeProxy(req, `videos/${(await params).taskId}`, {
    method: "GET",
  });
}
