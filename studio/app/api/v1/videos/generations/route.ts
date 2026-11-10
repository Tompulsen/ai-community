import { NextRequest } from "next/server";
import { handleEdgeProxy } from "@/app/api/v1/_proxy";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleEdgeProxy(req, "videos/generations");
}
