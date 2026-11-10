import { NextRequest } from "next/server";
import { handleEdgeProxy } from "../_proxy";

export const runtime = "nodejs";

export function POST(req: NextRequest) {
  return handleEdgeProxy(req, "videos");
}
