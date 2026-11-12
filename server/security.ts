/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { httpError } from './auth.ts'
import { accountCenter } from './account-session.ts'
import { legacyIdTime } from './content.ts'
import type { StoredSession } from './auth.ts'
import type { RequestContext } from './types.ts'

export async function handleSecurity(ctx: RequestContext): Promise<boolean> {
  const route = ctx.url.pathname, method = ctx.req.method
  if (route === '/api/security/capabilities' && method === 'GET') {
    ctx.json(200, { external: true, emailReset: false, accountUrl: accountCenter(ctx.config) })
    return true
  }
  if (route.startsWith('/api/security/password') && method === 'POST') {
    throw httpError(410, '密码与安全设置已统一至章鱼账户中心。', 'ACCOUNT_LOGIN_REQUIRED')
  }
  if (route === '/api/security/sessions/revoke' && method === 'POST') {
    throw httpError(410, '请前往章鱼账户中心管理登录设备。', 'ACCOUNT_LOGIN_REQUIRED')
  }
  if (!route.startsWith('/api/security/')) return false
  const user = ctx.requireUser()
  if (route === '/api/security/status' && method === 'GET') {
    ctx.json(200, { external: true, hasPassword: false, emailReset: false, emailVerified: false,
      accountUrl: accountCenter(ctx.config) })
    return true
  }
  if (route === '/api/security/logins' && method === 'GET') {
    const cursor = ctx.url.searchParams.get('cursor')
    if (cursor && !/^[a-zA-Z0-9]{1,32}$/.test(cursor)) throw httpError(400, '分页编号无效。')
    const rows = (await ctx.db.query<{ id: string; ip: string | null; headers: Record<string, string>; success: boolean }>(
      'SELECT id,ip,headers,success FROM signin WHERE "userId"=$1 AND ($2::varchar IS NULL OR id<$2) ORDER BY id DESC LIMIT 31', [user.id, cursor])).rows
    ctx.json(200, { items: rows.slice(0, 30).map(row => ({ id: row.id, ip: row.ip, userAgent: row.headers?.['user-agent'] || '',
      success: row.success, date: new Date(legacyIdTime(row.id, ctx.config.id)).toISOString() })),
    nextCursor: rows.length > 30 ? rows[29]!.id : null })
    return true
  }
  if (route === '/api/security/sessions' && method === 'GET') {
    const hashes = await ctx.redis.zrevrange(`community-next:sessions:${user.id}`, 0, 49)
    if (ctx.sessionHash && !hashes.includes(ctx.sessionHash)) hashes.unshift(ctx.sessionHash)
    const items = []
    for (const key of hashes) {
      const raw = await ctx.redis.get(`community-next:session:${key}`)
      if (!raw) continue
      const stored = JSON.parse(raw) as StoredSession
      if (stored.userId !== user.id || stored.tokenHash !== user.tokenHash || !stored.account) continue
      items.push({ id: key, current: ctx.sessionHash === key, createdAt: stored.createdAt || null, ip: stored.ip || null, userAgent: stored.userAgent || '' })
    }
    ctx.json(200, { items })
    return true
  }
  return false
}
