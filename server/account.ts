/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import bcrypt from 'bcryptjs'
import { lotteryInviter } from './business/lottery.ts'
import { readAccountSession } from './account-session.ts'
import { handleAccountRequest, getNewApiConfig } from './native-account/index.ts'
import { rememberPublicIdentity } from './public-identity.ts'
import { hash as sessionTokenHash, publicUser } from './auth.ts'
import type { Database, Queryable, RequestContext } from './types.ts'

interface Identity {
  sub: string
  preferred_username: string
  name: string
}

interface LinkProof {
  userId: string
  tokenHash: string
  credentialHash: string
  sessionHash: string | null
}

interface CredentialRow {
  id: string
  username: string
  name: string | null
  token: string | null
  password: string | null
}

interface CredentialUser extends CredentialRow {
  userId: string
  token: string
}

interface ExternalAccountRow {
  issuer: string
  subject: string
  userId: string | null
}

interface SignupMeta {
  rootUserId: string | null
}

interface AccountBalance {
  balance: number
  quota: number
  quotaPerUnit: number
  currencySymbol: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const COOKIE = '__Host-community-next-oauth'
const OPAQUE = /^[A-Za-z0-9_-]{43}$/
const random = () => randomBytes(32).toString('base64url')
export const accountHash = (value: string) => createHash('sha256').update(value).digest('base64url')

function fail(code: string, statusCode = 403): never {
  throw Object.assign(new Error(code), { statusCode, code })
}

export function newApiOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' || url.origin.length > 255) throw new Error('SSO_CONFIG')
  return url.origin
}

export function newApiIdentity(value: unknown): Identity {
  if (!isRecord(value)
    || typeof value.sub !== 'string' || !/^[1-9]\d{0,18}$/.test(value.sub)
    || !Number.isSafeInteger(Number(value.sub))) throw new Error('SSO_IDENTITY')
  for (const field of ['preferred_username', 'name']) {
    if (typeof value[field] !== 'string' || value[field].length > 128) throw new Error('SSO_IDENTITY')
  }
  if (!value.preferred_username || /[\u0000-\u001f\u007f-\u009f]/.test(value.preferred_username as string)) throw new Error('SSO_IDENTITY')
  return { sub: value.sub, preferred_username: value.preferred_username as string, name: value.name as string }
}

export function newApiReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f\\#]/.test(value)) return '/account'
  const path = value.split('?')[0]!
  if (!/^\/(?:discover|work\/[a-zA-Z0-9]{1,32}|create(?:\/(?:text|image|video))?|library|activities|community|account|messages(?:\/[a-zA-Z0-9]{1,32})?)$/.test(path)) return '/account'
  const query = value.slice(path.length + 1)
  try { decodeURIComponent(query) } catch { return '/account' }
  const id = /^[a-zA-Z0-9]{1,32}$/
  const allowed: Record<string, RegExp> = { publish: /^1$/, invite: id }
  switch (path.split('/')[1]) {
    case 'discover':
      Object.assign(allowed, { kind: /^(all|image|video|resource)$/, q: /^[^\u0000-\u001f\u007f\\]{0,500}$/,
        tag: /^[^\u0000-\u001f\u007f\\]{1,100}$/, sort: /^(featured|latest|following)$/ })
      break
    case 'create': Object.assign(allowed, { from: id, remix: id }); break
    case 'library': allowed.tab = /^(all|draft|pending|published|rejected|saved)$/; break
    case 'community': Object.assign(allowed, { creator: id, tab: /^(creators|announcements)$/ }); break
    case 'account': allowed.tab = /^(profile|balance|security)$/; break
    case 'messages': allowed.peer = id; break
  }
  const seen = new Set<string>()
  for (const [key, item] of new URLSearchParams(query)) {
    if (seen.has(key) || /[\u0000-\u001f\u007f\\]/.test(item) || !Object.hasOwn(allowed, key) || !allowed[key]!.test(item)) return '/account'
    seen.add(key)
  }
  return value
}

function issuer(ctx: RequestContext): string {
  if (!ctx.config.newApiSso?.issuer) fail('SSO_UNAVAILABLE', 503)
  newApiOrigin(ctx.config.url)
  return newApiOrigin(ctx.config.newApiSso.issuer)
}

function nativeReady(ctx: RequestContext): boolean {
  const account = getNewApiConfig()
  return account.enabled && account.configured && account.publicUrl === issuer(ctx)
}

export function readFlowCookie(header: string = ''): string | null {
  const values = header.split(';').map(value => value.trim()).filter(value => value.startsWith(`${COOKIE}=`))
  if (values.length !== 1) return null
  const value = values[0].slice(COOKIE.length + 1)
  return OPAQUE.test(value) ? value : null
}

function redirect(ctx: RequestContext, path: string): void {
  void ctx.reply.headers(ctx.res.getHeaders()).code(303).header('Location', path)
    .header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').send()
}

async function rateLimit(ctx: RequestContext, key: string, maximum: number, seconds = 60): Promise<void> {
  const actor = ctx.user?.id ?? ctx.ip ?? ctx.req.socket?.remoteAddress ?? 'unknown'
  const counter = Number(await ctx.redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],ARGV[1]) end; return n', 1,
    `community-next:rate:${key}:${accountHash(actor)}`, seconds))
  if (counter > maximum) fail('SSO_RATE_LIMIT', 429)
}

async function availableUser(db: Queryable, userId: string, lock = false): Promise<CredentialUser> {
  const { rows } = await db.query<CredentialRow>(`SELECT u.id,u.username,u.name,u.token,p.password
    FROM "user" u JOIN user_profile p ON p."userId"=u.id
    WHERE u.id=$1 AND u.host IS NULL AND NOT u."isDeleted" AND NOT u."isSuspended" AND u."movedToUri" IS NULL${lock ? ' FOR UPDATE OF u,p' : ''}`, [userId])
  if (!rows[0]?.token) fail('SSO_ACCOUNT_UNAVAILABLE')
  return { ...rows[0], userId: rows[0].id, token: rows[0].token }
}

const credentialHash = (user: CredentialUser) => accountHash(user.password || '')

async function transaction<T>(db: Database, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
}

async function checkLink(ctx: RequestContext, proof: LinkProof, lock = false, db: Queryable = ctx.db): Promise<CredentialUser> {
  if (!ctx.user || proof.userId !== ctx.user.id || !proof.sessionHash || proof.sessionHash !== ctx.sessionHash) fail('SSO_LINK_CHANGED')
  const user = await availableUser(db, proof.userId, lock)
  if (accountHash(user.token) !== proof.tokenHash || credentialHash(user) !== proof.credentialHash) fail('SSO_LINK_CHANGED')
  return user
}

export async function bindExternalAccount(ctx: RequestContext, accountIssuer: string, subject: string, proof: LinkProof): Promise<void> {
  return transaction(ctx.db, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`external-account:${accountIssuer}:${subject}`])
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`external-account-user:${accountIssuer}:${proof.userId}`])
    const user = await checkLink(ctx, proof, true, client)
    const { rows } = await client.query<ExternalAccountRow>('SELECT issuer,subject,"userId" FROM external_account WHERE issuer=$1 AND (subject=$2 OR "userId"=$3)', [accountIssuer, subject, user.id])
    if (rows.some(row => (row.subject === subject && row.userId !== user.id) || (row.userId === user.id && row.subject !== subject))) fail('SSO_LINK_CONFLICT', 409)
    if (!rows.some(row => row.subject === subject)) {
      await client.query('INSERT INTO external_account (issuer,subject,"userId","createdAt") VALUES ($1,$2,$3,NOW())', [accountIssuer, subject, user.id])
    }
  })
}

async function provision(ctx: RequestContext, accountIssuer: string, identity: Identity, inviterId?: string): Promise<CredentialUser> {
  identity = newApiIdentity(identity)
  const { rows: metaRows } = await ctx.db.query<SignupMeta>('SELECT "rootUserId" FROM meta LIMIT 1')
  const meta = metaRows[0]
  if (!meta?.rootUserId) fail('SSO_NOT_INITIALIZED', 503)
  return transaction(ctx.db, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`external-account:${accountIssuer}:${identity.sub}`])
    const { rows: mappings } = await client.query<{ userId: string | null }>('SELECT "userId" FROM external_account WHERE issuer=$1 AND subject=$2', [accountIssuer, identity.sub])
    if (mappings.length) {
      if (!mappings[0].userId) fail('SSO_ACCOUNT_UNAVAILABLE')
      if (mappings[0].userId !== identity.sub) fail('ACCOUNT_ID_MIGRATION_REQUIRED', 409)
      return availableUser(client, mappings[0].userId)
    }
    const { rows: occupied } = await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [identity.sub])
    if (occupied.length) fail('ACCOUNT_ID_CONFLICT', 409)
    const username = identity.preferred_username, lower = username.toLowerCase()
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`signup:username:${lower}`])
    const { rows: duplicate } = await client.query('SELECT 1 FROM "user" WHERE "usernameLower"=$1 AND host IS NULL LIMIT 1', [lower])
    if (duplicate.length) fail('ACCOUNT_USERNAME_CONFLICT', 409)
    const id = identity.sub
    const nativeToken = randomBytes(12).toString('base64url')
    const password = await bcrypt.hash(random(), 8)
    await client.query('INSERT INTO "user" (id,username,"usernameLower",host,token,name) VALUES ($1,$2,$3,NULL,$4,$5)', [id, username, lower, nativeToken, (identity.name || username).slice(0, 50)])
    await client.query('INSERT INTO user_profile ("userId","autoAcceptFollowed",password,email,"emailVerified") VALUES ($1,true,$2,NULL,false)', [id, password])
    await client.query('INSERT INTO used_username (username,"createdAt") VALUES ($1,NOW()) ON CONFLICT (username) DO NOTHING', [lower])
    await client.query('INSERT INTO external_account (issuer,subject,"userId","createdAt") VALUES ($1,$2,$3,NOW())', [accountIssuer, identity.sub, id])
    const inviter = lotteryInviter(inviterId)
    if (inviter && inviter !== id) {
      await client.query(`INSERT INTO community_lottery_referral ("userId","inviterId","createdAt")
        SELECT $1,id,NOW() FROM "user" WHERE id=$2 AND host IS NULL AND NOT "isDeleted" AND NOT "isSuspended" AND "movedToUri" IS NULL`, [id, inviter])
    }
    return availableUser(client, id)
  })
}

async function synchronizeSession(ctx: RequestContext) {
  await rateLimit(ctx, 'account-session', 30)
  const account = await readAccountSession(ctx.config, ctx.req)
  const user = await provision(ctx, account.binding.issuer, {
    sub: account.binding.subject, preferred_username: account.username, name: account.name,
  }, lotteryInviter(ctx.body.lotteryInviterId))
  await rememberPublicIdentity(ctx.db, {
    issuer: account.binding.issuer, subject: account.binding.subject, userId: user.id, username: account.username,
  })
  let result
  if (ctx.user?.id === user.id) result = publicUser(ctx.user)
  else {
    result = await ctx.createSession(user.id, sessionTokenHash(user.token), account.binding)
    await ctx.db.query('INSERT INTO signin(id,"userId",ip,headers,success) VALUES($1,$2,$3,$4,true)',
      [ctx.newId(), user.id, ctx.ip || ctx.req.socket.remoteAddress || null,
        JSON.stringify({ 'user-agent': String(ctx.req.headers['user-agent'] || '').slice(0, 512) })])
  }
  return { user: { ...result, accountId: account.binding.subject, username: account.username },
    returnTo: newApiReturnPath(ctx.body.returnTo ?? '/discover') }
}

export async function readAccountBalance(ctx: Pick<RequestContext, 'config' | 'req'>, subject: string | null | undefined, fetcher?: typeof fetch): Promise<AccountBalance | null> {
  if (!subject) return null
  const cookies = String(ctx.req.headers.cookie ?? '').split(';').map(value => value.trim())
    .filter(value => value.startsWith('octopus_new_api_session='))
  if (cookies.length !== 1 || !OPAQUE.test(cookies[0].slice('octopus_new_api_session='.length))) return null
  try {
    const origin = new URL(ctx.config.url)
    const headers = { Cookie: cookies[0], Host: origin.host, Origin: origin.origin,
      'x-forwarded-host': origin.host, 'x-forwarded-proto': origin.protocol.slice(0, -1) }
    const read = async (path: string): Promise<Record<string, unknown>> => {
      const request = new Request(new URL(path, origin), { headers, redirect: 'error', signal: AbortSignal.timeout(8000) })
      const response = fetcher ? await fetcher(new URL(request.url), { headers, signal: request.signal }) : await handleAccountRequest(request)
      if (!response.ok || !response.body) throw new Error()
      const length = Number(response.headers.get('content-length'))
      if (length > 65536) throw new Error()
      let size = 0
      const chunks: Buffer[] = []
      for await (const chunk of response.body) {
        size += chunk.length
        if (size > 65536) throw new Error()
        chunks.push(Buffer.from(chunk))
      }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!isRecord(value)) throw new Error()
      return value
    }
    const [session, status] = await Promise.all([read('/api/new-api/session'), read('/api/new-api/status')])
    const sessionData = isRecord(session.data) ? session.data : null
    const statusData = isRecord(status.data) ? status.data : null
    const user = isRecord(sessionData?.user) ? sessionData.user : null
    const scale = statusData?.quotaPerUnit
    if (session.success !== true || sessionData?.authenticated !== true || String(user?.id) !== subject
      || typeof user?.quota !== 'number' || !Number.isSafeInteger(user.quota) || user.quota < 0 || status.success !== true
      || typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return null
    return { balance: user.quota / scale, quota: user.quota, quotaPerUnit: scale,
      currencySymbol: typeof statusData?.currencySymbol === 'string' ? statusData.currencySymbol.slice(0, 16) : '' }
  } catch { return null }
}

export async function handleAccount(ctx: RequestContext): Promise<boolean> {
  const path = ctx.url.pathname, method = ctx.req.method
  if (method === 'POST' && ['/api/account/connect', '/api/newapi/start', '/api/account/finish', '/api/newapi/finish'].includes(path)) {
    fail('ACCOUNT_LOGIN_REQUIRED', 410)
  }
  if (path.startsWith('/api/newapi/studio/')) fail('STUDIO_EMBED_REMOVED', 410)
  if (method === 'GET' && ['/api/newapi/callback', '/auth/newapi'].includes(path)) { redirect(ctx, '/account'); return true }
  if (!path.startsWith('/api/account') && !path.startsWith('/api/newapi/')) return false
  let result: unknown
  if (method === 'GET' && path === '/api/newapi/config') {
    try { result = { enabled: nativeReady(ctx), authentication: 'zhangyu', issuer: issuer(ctx), accountUrl: issuer(ctx), studioOrigin: new URL(ctx.config.url).origin, studioPath: '/create', creation: 'native' } }
    catch { result = { enabled: false } }
  } else if (method === 'GET' && path === '/api/account') {
    const accountIssuer = issuer(ctx)
    const { rows } = ctx.user ? await ctx.db.query<{ subject: string }>('SELECT subject FROM external_account WHERE issuer=$1 AND "userId"=$2', [accountIssuer, ctx.user.id]) : { rows: [] }
    let studioReady = false
    try { studioReady = nativeReady(ctx) } catch {}
    const balance = rows.length ? await readAccountBalance(ctx, rows[0].subject) : null
    result = { linked: rows.length > 0, issuer: accountIssuer, subject: rows[0]?.subject ?? null,
      balance: null, ...balance, accountUrl: accountIssuer, studioReady }
  } else if (method === 'POST' && path === '/api/account/session') result = await synchronizeSession(ctx)
  else return false
  ctx.json(200, result)
  return true
}
