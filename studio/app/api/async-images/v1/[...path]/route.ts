import { NextRequest } from "next/server";
import { proxyAsyncTask } from "../../../async-task-proxy";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyAsyncTask(req, "images", (await params).path);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyAsyncTask(req, "images", (await params).path);
}
