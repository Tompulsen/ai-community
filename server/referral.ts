import { referralConfigSchema, referralStatusSchema } from '../shared/referral.ts'
import { newApiOrigin } from './account.ts'
import type { RequestContext } from './types.ts'

function fail(code: string, statusCode = 503): never {
  throw Object.assign(new Error(code), { code, statusCode })
}

export async function handleReferral(ctx: RequestContext, fetcher: typeof fetch = fetch): Promise<boolean> {
  const path = ctx.url.pathname, method = ctx.req.method
  if (path !== '/api/referrals/status' && path !== '/api/admin/referrals/config') return false
  const admin = path.startsWith('/api/admin/')
  if (admin) ctx.requireAdmin()
  if (method === 'PATCH' && admin) fail('REFERRAL_CONFIG_CENTRALIZED', 405)
  if (method !== 'GET') return false
  const config = ctx.config.newApiSso
  if (!config || typeof config.issuer !== 'string' || typeof config.lotterySecret !== 'string' || config.lotterySecret.length < 32) fail('REFERRAL_UNAVAILABLE')
  const issuer = newApiOrigin(config.issuer), origin = new URL(ctx.config.url).origin
  let accountId = 0
  if (ctx.user) {
    const { rows } = await ctx.db.query<{ subject: string }>('SELECT subject FROM external_account WHERE issuer=$1 AND "userId"=$2', [issuer, ctx.user.id])
    const subject = rows[0]?.subject
    if (typeof subject !== 'string' || !/^[1-9]\d{0,14}$/.test(subject) || !Number.isSafeInteger(Number(subject))) fail('REFERRAL_ACCOUNT_REQUIRED', 409)
    accountId = Number(subject)
  }
  const rawCursor = ctx.url.searchParams.get('cursor') ?? '0'
  if (!/^\d{1,15}$/.test(rawCursor) || !Number.isSafeInteger(Number(rawCursor))) fail('REFERRAL_INVALID', 400)
  const body = { action: admin ? 'config' : 'status', cursor: Number(rawCursor) }
  const response = await fetcher(new URL('/api/community-sso/referrals', issuer), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.lotterySecret}` },
    body: JSON.stringify({ ...body, client_id: origin, user_id: accountId }),
  })
  if (!response.ok) fail(response.status === 409 ? 'REFERRAL_CONFLICT' : 'REFERRAL_UNAVAILABLE', response.status === 409 ? 409 : 503)
  if (!response.body) fail('REFERRAL_UNAVAILABLE')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 65536) fail('REFERRAL_UNAVAILABLE')
    chunks.push(Buffer.from(chunk))
  }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('REFERRAL_UNAVAILABLE') }
  if (admin) {
    const result = referralConfigSchema.safeParse(value)
    if (!result.success) fail('REFERRAL_UNAVAILABLE')
    ctx.json(200, result.data)
  } else {
    const result = referralStatusSchema.safeParse(value)
    if (!result.success || (!accountId && result.data.code)) fail('REFERRAL_UNAVAILABLE')
    ctx.json(200, { ...result.data, inviteUrl: result.data.code ? `${origin}/activities?aff=${result.data.code}` : '' })
  }
  return true
}
