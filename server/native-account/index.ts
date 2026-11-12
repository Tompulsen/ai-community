import { createHash } from "node:crypto"
import { AccountRequest, AccountResponse } from "./http.ts"
import { handle } from "./routes.ts"
import { accountRequest, sanitizeUser } from "./client.ts"
import { getNewApiConfig, NewApiError } from "./config.ts"
import { SESSION_COOKIE } from "./session.ts"

export async function handleAccountRequest(request: Request): Promise<Response> {
  const req = request instanceof AccountRequest ? request : new AccountRequest(request)
  const prefix = /^\/(?:studio\/)?api\/new-api\/(.+?)\/?$/.exec(req.nextUrl.pathname)
  if (!prefix) return AccountResponse.json({ success: false, message: "接口不存在" }, { status: 404 })
  return handle(req, prefix[1]!.split("/"))
}

export async function readNativeAccount(request: Request) {
  const req = request instanceof AccountRequest ? request : new AccountRequest(request)
  const { data } = await accountRequest(req, "/api/user/self", { reuseRequestSession: true, maxResponseBytes: 65536 })
  const user = sanitizeUser(data)
  const cookie = req.cookies.get(SESSION_COOKIE)?.value
  if (!cookie) throw new NewApiError("请先登录章鱼账号", 401, "NEW_API_LOGIN_REQUIRED")
  return {
    binding: {
      issuer: getNewApiConfig().publicUrl,
      subject: String(user.id),
      sessionHash: createHash("sha256").update(cookie).digest("hex"),
    },
    username: user.username,
    name: (user.display_name || user.username).slice(0, 128),
  }
}

export { AccountRequest, AccountResponse } from "./http.ts"
export { accountRequest, getAuthenticatedSession, upstream, publicSession } from "./client.ts"
export { getNewApiConfig, getNewApiAsyncBaseUrl, getNewApiImageBaseUrl, NewApiError } from "./config.ts"
export { resolveModelGroup, resolveSystemAutoToken } from "./model-groups.ts"
export { resolveRelayCredentials, relayHeaders, relayErrorResponse } from "./relay.ts"
export { readSessionById, saveSession, removeSessionById, getNewApiRedis } from "./session.ts"
