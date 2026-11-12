import { NewApiError } from "./config.ts"
import type { AccountSession } from "./session.ts"

export interface CommunityBinding {
  community: string
  studio: string
  issuer: string
  subject: string
  userId: string
  tokenHash: string
  context: string
}

export function assertNormalRequest(req: Request) {
  if (req.headers.has("x-community-embed"))
    throw new NewApiError("请从社区原生创作页面继续", 403, "COMMUNITY_CONTEXT_REQUIRED")
}

export function assertNormalSession(req: Request, session: AccountSession) {
  assertNormalRequest(req)
  if (session.communityEmbed)
    throw new NewApiError("请重新登录章鱼账号", 401, "COMMUNITY_ACCOUNT_CHANGED")
}
