import { NextRequest } from "next/server";
import { handleEdgeProxy } from "@/app/api/v1/_proxy";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  return handleEdgeProxy(_req, "models");
}
