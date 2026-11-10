import { NextRequest, NextResponse } from "next/server";
import { handleEdgeProxy } from "../../../_proxy";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(taskId))
    return NextResponse.json(
      { error: true, message: "视频任务标识无效" },
      { status: 400 },
    );
  return handleEdgeProxy(req, `videos/${taskId}/content`);
}
