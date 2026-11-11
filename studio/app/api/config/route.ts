import { NextResponse } from "next/server";

import { getPublicServerConfig } from "../../config/public-server";

declare global {
  type DangerConfig = ReturnType<typeof getPublicServerConfig>;
}

async function handle() {
  return NextResponse.json(getPublicServerConfig());
}

export const GET = handle;
export const POST = handle;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
