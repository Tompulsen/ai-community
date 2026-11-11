import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { getServerSideConfig } from "../config/server";
import { accountRequest, getAuthenticatedSession } from "../lib/new-api/client";
import { isNewApiEnabled } from "../lib/new-api/config";

export async function authorizeMcp() {
  // Managing host processes requires an explicit deployment-side allowlist.
  const allowed = (process.env.MCP_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[1-9]\d*$/.test(value));
  if (
    !getServerSideConfig().enableMcp ||
    !isNewApiEnabled() ||
    allowed.length === 0
  ) {
    throw new Error("MCP 未启用或没有操作权限");
  }
  const req = new NextRequest("http://localhost/mcp", {
    headers: new Headers(await headers()),
  });
  const { session } = await getAuthenticatedSession(req);
  if (!session.user || !allowed.includes(String(session.user.id))) {
    throw new Error("没有 MCP 操作权限");
  }
  const { data } = await accountRequest(req, "/api/user/self");
  if (
    !Number.isSafeInteger(data?.id) ||
    data.id <= 0 ||
    data?.id !== session.user.id ||
    !Number.isInteger(data.role) ||
    data.role < 10
  ) {
    throw new Error("没有 MCP 操作权限");
  }
}
