/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { Redis } from 'ioredis'
import bcrypt from 'bcryptjs'
import { lotteryInviter } from './business/lottery.ts'
import type { Database, Queryable, RequestContext, TwoFactorProfile } from './types.ts'

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

interface Pending {
  browser: string
  issuer: string
  verifier: string
  returnTo: string
  lotteryInviterId?: string
  link?: LinkProof
}

interface Completion {
  userId: string
  issuer: string
  subject: string
  tokenHash: string
  returnTo: string
  link?: LinkProof
  identity?: Identity
}

interface StudioLaunch extends Completion {
  kind: 'text' | 'image' | 'video'
  studio: string
  context?: string
  sessionHash: string | null
}

interface CredentialRow extends Omit<TwoFactorProfile, 'userId'> {
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
  preservedUsernames: string[]
  prohibitedWordsForNameOfUser: string[]
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
const PREFIX = 'community-next:oauth:'
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
    || typeof value.sub !== 'string' || !/^[1-9]\d{0,18}$/.test(value.sub)) throw new Error('SSO_IDENTITY')
  for (const field of ['preferred_username', 'name']) {
    if (typeof value[field] !== 'string' || value[field].length > 128) throw new Error('SSO_IDENTITY')
  }
  return { sub: value.sub, preferred_username: value.preferred_username as string, name: value.name as string }
}

export function newApiReturnPath(value: unknown): string {
  return typeof value === 'string'
    && /^\/(?:account|discover|activities|community(?:\/lottery)?|create(?:\/(?:text|image|video))?(?:\?remix=[a-zA-Z0-9]{1,32})?)$/.test(value)
    ? value : '/account'
}

export function verifyStudioBearer(authorization: string | undefined, secret: unknown): boolean {
  return typeof secret === 'string' && secret.length >= 32
    && timingSafeEqual(Buffer.from(accountHash(authorization ?? '')), Buffer.from(accountHash(`Bearer ${secret}`)))
}

function issuer(ctx: RequestContext): string {
  if (!ctx.config.newApiSso?.issuer) fail('SSO_UNAVAILABLE', 503)
  newApiOrigin(ctx.config.url)
  return newApiOrigin(ctx.config.newApiSso.issuer)
}

function studio(ctx: RequestContext): { origin: string; secret: string } {
  const origin = newApiOrigin(ctx.config.url)
  const secret = ctx.config.newApiSso?.studioSecret
  issuer(ctx)
  if (typeof secret !== 'string' || secret.length < 32) fail('STUDIO_UNAVAILABLE', 503)
  return { origin, secret }
}

function flowCookie(ctx: RequestContext, value: string, age: number): void {
  const previous = ctx.res.getHeader('Set-Cookie')
  const cookies = previous ? (Array.isArray(previous) ? previous : [String(previous)]) : []
  ctx.res.setHeader('Set-Cookie', [...cookies, `${COOKIE}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`])
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

async function consume(redis: Redis, key: string, expected: string): Promise<boolean> {
  return await redis.eval('if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end', 1, key, expected) === 1
}

async function rateLimit(ctx: RequestContext, key: string, maximum: number, seconds = 60): Promise<void> {
  const actor = ctx.user?.id ?? ctx.ip ?? ctx.req.socket?.remoteAddress ?? 'unknown'
  const counter = Number(await ctx.redis.eval('local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],ARGV[1]) end; return n', 1,
    `community-next:rate:${key}:${accountHash(actor)}`, seconds))
  if (counter > maximum) fail('SSO_RATE_LIMIT', 429)
}

async function upstreamJson(url: string, { body, token }: { body?: Record<string, string>; token?: string } = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body) fail('SSO_UPSTREAM', 502)
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 1024 * 1024) fail('SSO_UPSTREAM', 502)
    chunks.push(Buffer.from(chunk))
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!isRecord(value)) fail('SSO_UPSTREAM', 502)
    return value
  }
  catch { fail('SSO_UPSTREAM', 502) }
}

async function availableUser(db: Queryable, userId: string, lock = false): Promise<CredentialUser> {
  const { rows } = await db.query<CredentialRow>(`SELECT u.id,u.username,u.name,u.token,p.password,p."twoFactorEnabled",p."twoFactorSecret",p."twoFactorBackupSecret"
    FROM "user" u JOIN user_profile p ON p."userId"=u.id
    WHERE u.id=$1 AND u.host IS NULL AND NOT u."isDeleted" AND NOT u."isSuspended" AND u."movedToUri" IS NULL${lock ? ' FOR UPDATE OF u,p' : ''}`, [userId])
  if (!rows[0]?.token) fail('SSO_ACCOUNT_UNAVAILABLE')
  return { ...rows[0], userId: rows[0].id, token: rows[0].token }
}

const credentialHash = (user: CredentialUser) => accountHash(JSON.stringify([user.password, user.twoFactorEnabled, user.twoFactorSecret]))

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
  const { rows: metaRows } = await ctx.db.query<SignupMeta>('SELECT "rootUserId","preservedUsernames","prohibitedWordsForNameOfUser" FROM meta LIMIT 1')
  const meta = metaRows[0]
  if (!meta?.rootUserId) fail('SSO_NOT_INITIALIZED', 503)
  const fallback = `na_${createHash('sha256').update(`${accountIssuer}:${identity.sub}`).digest('hex').slice(0, 16)}`
  const candidates = [...new Set([identity.preferred_username, fallback, `na_${randomBytes(8).toString('hex')}`])]
  for (const username of candidates) {
    if (!/^[a-zA-Z0-9_]{1,20}$/.test(username)) continue
    const lower = username.toLowerCase()
    if ((meta.preservedUsernames ?? []).some(value => value.toLowerCase() === lower)
      || (meta.prohibitedWordsForNameOfUser ?? []).some(value => value && lower.includes(value.toLowerCase()))) continue
    const result = await transaction(ctx.db, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`external-account:${accountIssuer}:${identity.sub}`])
      const { rows: mappings } = await client.query<{ userId: string | null }>('SELECT "userId" FROM external_account WHERE issuer=$1 AND subject=$2', [accountIssuer, identity.sub])
      if (mappings.length) {
        if (!mappings[0].userId) fail('SSO_ACCOUNT_UNAVAILABLE')
        return availableUser(client, mappings[0].userId)
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`signup:username:${lower}`])
      const { rows: duplicate } = await client.query('SELECT 1 FROM "user" WHERE "usernameLower"=$1 AND host IS NULL UNION ALL SELECT 1 FROM used_username WHERE username=$1 LIMIT 1', [lower])
      if (duplicate.length) return null
      const id = ctx.newId()
      const nativeToken = randomBytes(12).toString('base64url')
      const password = await bcrypt.hash(random(), 8)
      await client.query('INSERT INTO "user" (id,username,"usernameLower",host,token,name) VALUES ($1,$2,$3,NULL,$4,$5)', [id, username, lower, nativeToken, (identity.name || username).slice(0, 50)])
      await client.query('INSERT INTO user_profile ("userId","autoAcceptFollowed",password,email,"emailVerified") VALUES ($1,true,$2,NULL,false)', [id, password])
      await client.query('INSERT INTO used_username (username,"createdAt") VALUES ($1,NOW())', [lower])
      await client.query('INSERT INTO external_account (issuer,subject,"userId","createdAt") VALUES ($1,$2,$3,NOW())', [accountIssuer, identity.sub, id])
      const inviter = lotteryInviter(inviterId)
      if (inviter && inviter !== id) {
        await client.query(`INSERT INTO community_lottery_referral ("userId","inviterId","createdAt")
          SELECT $1,id,NOW() FROM "user" WHERE id=$2 AND host IS NULL AND NOT "isDeleted" AND NOT "isSuspended" AND "movedToUri" IS NULL`, [id, inviter])
      }
      return availableUser(client, id)
    })
    if (result) return result
  }
  fail('SSO_PROVISION', 409)
}

async function start(ctx: RequestContext) {
  await rateLimit(ctx, 'newapi-start', 10)
  const accountIssuer = issuer(ctx)
  let link: LinkProof | undefined
  if (ctx.user) {
    const user = await availableUser(ctx.db, ctx.user.id)
    if (typeof ctx.body.password !== 'string' || ctx.body.password.length > 1024
      || !user.password || !await bcrypt.compare(ctx.body.password, user.password)) fail('SSO_LINK_AUTH')
    if (user.twoFactorEnabled) await ctx.authenticateFactor(user, ctx.body.token, ctx.body.recoveryCode)
    link = { userId: user.id, tokenHash: accountHash(user.token), credentialHash: credentialHash(user), sessionHash: ctx.sessionHash }
  }
  const browser = random(), state = random(), verifier = random()
  await ctx.redis.set(`${PREFIX}state:${state}`, JSON.stringify({
    browser: accountHash(browser), issuer: accountIssuer, verifier,
    returnTo: newApiReturnPath(ctx.body.returnTo),
    lotteryInviterId: link ? undefined : lotteryInviter(ctx.body.lotteryInviterId), link,
  }), 'EX', 600)
  flowCookie(ctx, browser, 600)
  const url = new URL('/community-authorize', accountIssuer)
  url.search = new URLSearchParams({
    client_id: new URL(ctx.config.url).origin, redirect_uri: new URL('/api/newapi/callback', ctx.config.url).href,
    response_type: 'code', scope: 'identity', state, code_challenge: accountHash(verifier), code_challenge_method: 'S256',
  }).toString()
  return { url: url.href, authorizationUrl: url.href }
}

async function callback(ctx: RequestContext): Promise<void> {
  try {
    const state = ctx.url.searchParams.get('state'), code = ctx.url.searchParams.get('code')
    const browser = readFlowCookie(ctx.req.headers.cookie)
    if (!state || !code || !OPAQUE.test(state) || !OPAQUE.test(code) || !browser) fail('SSO_FLOW')
    const key = `${PREFIX}state:${state}`, raw = await ctx.redis.get(key)
    if (!raw) fail('SSO_FLOW')
    const pending = JSON.parse(raw) as Pending
    if (pending.browser !== accountHash(browser) || pending.issuer !== issuer(ctx) || !await consume(ctx.redis, key, raw)) fail('SSO_FLOW')
    if (pending.link) await checkLink(ctx, pending.link)
    const token = await upstreamJson(`${pending.issuer}/api/community-sso/token`, { body: {
      grant_type: 'authorization_code', client_id: new URL(ctx.config.url).origin,
      redirect_uri: new URL('/api/newapi/callback', ctx.config.url).href, code, code_verifier: pending.verifier,
    } })
    if (!token || token.token_type !== 'Bearer' || typeof token.access_token !== 'string' || !OPAQUE.test(token.access_token)) fail('SSO_TOKEN')
    const identity = newApiIdentity(await upstreamJson(`${pending.issuer}/api/community-sso/userinfo`, { token: token.access_token }))
    const user = pending.link ? await checkLink(ctx, pending.link) : await provision(ctx, pending.issuer, identity, pending.lotteryInviterId)
    await ctx.redis.set(`${PREFIX}complete:${accountHash(browser)}`, JSON.stringify({
      userId: user.id, issuer: pending.issuer, subject: identity.sub, tokenHash: accountHash(user.token),
      returnTo: pending.returnTo, link: pending.link, identity: pending.link ? identity : undefined,
    }), 'EX', 300)
    redirect(ctx, '/account?newapi=complete')
  } catch {
    flowCookie(ctx, '', 0)
    redirect(ctx, '/account?newapi=error')
  }
}

async function finish(ctx: RequestContext) {
  await rateLimit(ctx, 'newapi-finish', 15, 600)
  const browser = readFlowCookie(ctx.req.headers.cookie)
  if (!browser) fail('SSO_FLOW')
  const key = `${PREFIX}complete:${accountHash(browser)}`, raw = await ctx.redis.get(key)
  if (!raw) fail('SSO_FLOW')
  const complete = JSON.parse(raw) as Completion
  if (complete.issuer !== issuer(ctx)) fail('SSO_CONFIG')
  if (complete.link) {
    const user = await checkLink(ctx, complete.link)
    if (ctx.body.confirmLink !== true) return {
      requiresLinkConfirmation: true, communityUsername: user.username,
      newApiUsername: complete.identity?.preferred_username, subject: complete.subject,
      returnTo: newApiReturnPath(complete.returnTo),
    }
    if (!await consume(ctx.redis, key, raw)) fail('SSO_FLOW')
    await bindExternalAccount(ctx, complete.issuer, complete.subject, complete.link)
    flowCookie(ctx, '', 0)
    return { linked: true, returnTo: newApiReturnPath(complete.returnTo) }
  }
  const user = await availableUser(ctx.db, complete.userId)
  if (accountHash(user.token) !== complete.tokenHash) fail('SSO_FLOW')
  const { rows } = await ctx.db.query('SELECT 1 FROM external_account WHERE issuer=$1 AND subject=$2 AND "userId"=$3', [complete.issuer, complete.subject, user.id])
  if (!rows.length) fail('SSO_FLOW')
  if (user.twoFactorEnabled) {
    if (!ctx.body.token && !ctx.body.recoveryCode) return { requiresTotp: true }
    await ctx.authenticateFactor(user, ctx.body.token, ctx.body.recoveryCode)
  }
  if (!await consume(ctx.redis, key, raw)) fail('SSO_FLOW')
  const publicUser = await ctx.createSession(user.id, accountHash(user.token))
  flowCookie(ctx, '', 0)
  return { user: publicUser, returnTo: newApiReturnPath(complete.returnTo) }
}

async function studioStart(ctx: RequestContext) {
  const currentUser = ctx.requireUser()
  const sessionHash = ctx.sessionHash
  if (!sessionHash) fail('STUDIO_ACCOUNT')
  await rateLimit(ctx, 'studio-start', 30)
  const { origin } = studio(ctx)
  const { kind, context } = ctx.body
  if (typeof kind !== 'string' || !['text', 'image', 'video'].includes(kind) || (context !== undefined && (typeof context !== 'string' || !OPAQUE.test(context)))) fail('STUDIO_REQUEST', 400)
  const user = await availableUser(ctx.db, currentUser.id), accountIssuer = issuer(ctx)
  const { rows } = await ctx.db.query<{ subject: string }>('SELECT subject FROM external_account WHERE issuer=$1 AND "userId"=$2', [accountIssuer, user.id])
  if (!rows.length) fail('NEW_API_ACCOUNT_REQUIRED', 409)
  if (context) {
    const owner = `${user.id}:${accountHash(user.token)}`
    const accepted = await ctx.redis.eval('local v=redis.call("GET",KEYS[1]); if v and v~=ARGV[1] then return 0 end; redis.call("SET",KEYS[1],ARGV[1],"EX",900); return 1',
      1, `newapi:context:${accountHash(context)}`, owner)
    if (accepted !== 1) fail('STUDIO_CONTEXT_EXPIRED', 409)
    await ctx.redis.set(`community-next:studio-session:${accountHash(context)}`, sessionHash, 'EX', 900)
  }
  const code = random()
  const returnTo = newApiReturnPath(ctx.body.returnTo).startsWith(`/create/${kind}`) ? newApiReturnPath(ctx.body.returnTo) : `/create/${kind}`
  await ctx.redis.set(`newapi:studio:${accountHash(code)}`, JSON.stringify({
    userId: user.id, issuer: accountIssuer, subject: rows[0].subject,
    tokenHash: accountHash(user.token), returnTo, kind, studio: origin, context, sessionHash,
  }), 'EX', 120)
  if (context) return { code, origin, subject: rows[0].subject, userId: user.id }
  const target = new URL('/studio/api/new-api/community/start', origin)
  target.searchParams.set('code', code)
  return { url: target.href }
}

async function studioExchange(ctx: RequestContext) {
  const { origin, secret } = studio(ctx)
  if (!verifyStudioBearer(ctx.req.headers.authorization, secret)) fail('STUDIO_AUTH')
  await rateLimit(ctx, 'studio-exchange', 300)
  if (typeof ctx.body.code !== 'string' || !OPAQUE.test(ctx.body.code)) fail('STUDIO_CODE')
  const key = `newapi:studio:${accountHash(ctx.body.code)}`, raw = await ctx.redis.get(key)
  if (!raw) fail('STUDIO_CODE')
  const launch = JSON.parse(raw) as StudioLaunch
  if (launch.issuer !== issuer(ctx) || launch.studio !== origin) fail('STUDIO_CONFIG')
  if (!launch.sessionHash || !await ctx.redis.exists(`community-next:session:${launch.sessionHash}`)) fail('STUDIO_ACCOUNT')
  const user = await availableUser(ctx.db, launch.userId)
  const { rows } = await ctx.db.query('SELECT 1 FROM external_account WHERE issuer=$1 AND subject=$2 AND "userId"=$3', [launch.issuer, launch.subject, user.id])
  if (accountHash(user.token) !== launch.tokenHash || !rows.length || !await consume(ctx.redis, key, raw)) fail('STUDIO_ACCOUNT')
  return {
    issuer: launch.issuer, subject: launch.subject, kind: launch.kind, studio: origin,
    returnTo: launch.returnTo, ...(launch.context ? { context: launch.context, userId: user.id, tokenHash: launch.tokenHash } : {}),
  }
}

async function studioContext(ctx: RequestContext) {
  const currentUser = ctx.requireUser()
  const { context, action } = ctx.body
  if (typeof context !== 'string' || !OPAQUE.test(context) || typeof action !== 'string' || !['renew', 'revoke'].includes(action)) fail('STUDIO_REQUEST', 400)
  await rateLimit(ctx, 'studio-context', 300)
  const user = await availableUser(ctx.db, currentUser.id), key = `newapi:context:${accountHash(context)}`
  const owner = `${user.id}:${accountHash(user.token)}`
  const sessionKey = `community-next:studio-session:${accountHash(context)}`
  if (action === 'renew' && await ctx.redis.get(sessionKey) !== ctx.sessionHash) fail('STUDIO_CONTEXT_EXPIRED')
  const changed = await ctx.redis.eval('local v=redis.call("GET",KEYS[1]); if v~=ARGV[1] and not (ARGV[2]=="revoked" and (not v or v=="revoked")) then return 0 end; redis.call("SET",KEYS[1],ARGV[2],"EX",ARGV[3]); return 1',
    1, key, owner, action === 'revoke' ? 'revoked' : owner, action === 'revoke' ? 604800 : 120)
  if (changed !== 1) fail('STUDIO_CONTEXT_EXPIRED')
  if (action === 'revoke') await ctx.redis.del(sessionKey)
  else await ctx.redis.expire(sessionKey, 120)
  return { valid: true }
}

async function studioValidate(ctx: RequestContext) {
  const { secret } = studio(ctx)
  if (!verifyStudioBearer(ctx.req.headers.authorization, secret)) fail('STUDIO_AUTH')
  const input = ctx.body
  if (typeof input.userId !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(input.userId) || input.issuer !== issuer(ctx)
    || typeof input.subject !== 'string' || !/^[1-9]\d{0,18}$/.test(input.subject)
    || typeof input.tokenHash !== 'string' || !OPAQUE.test(input.tokenHash)
    || typeof input.context !== 'string' || !OPAQUE.test(input.context)) fail('STUDIO_REQUEST')
  const user = await availableUser(ctx.db, input.userId)
  const owner = `${user.id}:${input.tokenHash}`, contextHash = accountHash(input.context)
  if (accountHash(user.token) !== input.tokenHash || await ctx.redis.get(`newapi:context:${contextHash}`) !== owner) fail('STUDIO_ACCOUNT_CHANGED')
  const sessionHash = await ctx.redis.get(`community-next:studio-session:${contextHash}`)
  if (!sessionHash || !await ctx.redis.exists(`community-next:session:${sessionHash}`)) fail('STUDIO_ACCOUNT_CHANGED')
  const { rows } = await ctx.db.query('SELECT 1 FROM external_account WHERE issuer=$1 AND subject=$2 AND "userId"=$3', [input.issuer, input.subject, user.id])
  if (!rows.length) fail('STUDIO_ACCOUNT_CHANGED')
  return { valid: true }
}

export async function readAccountBalance(ctx: Pick<RequestContext, 'config' | 'req'>, subject: string | null | undefined, fetcher: typeof fetch = fetch): Promise<AccountBalance | null> {
  const upstream = ctx.config.communityStudioUpstream || process.env.COMMUNITY_STUDIO_UPSTREAM
  if (!upstream || !subject) return null
  const cookies = String(ctx.req.headers.cookie ?? '').split(';').map(value => value.trim())
    .filter(value => value.startsWith('octopus_new_api_session='))
  if (cookies.length !== 1 || !OPAQUE.test(cookies[0].slice('octopus_new_api_session='.length))) return null
  try {
    const destination = new URL(upstream), origin = new URL(ctx.config.url)
    if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password
      || destination.pathname !== '/' || destination.search || destination.hash) return null
    const headers = { Cookie: cookies[0], Host: origin.host, Origin: origin.origin,
      'x-forwarded-host': origin.host, 'x-forwarded-proto': origin.protocol.slice(0, -1) }
    const read = async (path: string): Promise<Record<string, unknown>> => {
      const response = await fetcher(new URL(path, destination), { headers, redirect: 'error', signal: AbortSignal.timeout(8000) })
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
    const [session, status] = await Promise.all([read('/studio/api/new-api/session'), read('/studio/api/new-api/status')])
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
  if (method === 'GET' && path === '/api/newapi/callback') { await callback(ctx); return true }
  if (method === 'GET' && path === '/auth/newapi') { redirect(ctx, '/account?newapi=complete'); return true }
  if (!path.startsWith('/api/account') && !path.startsWith('/api/newapi/')) return false
  let result: unknown
  if (method === 'GET' && path === '/api/newapi/config') {
    try { result = { enabled: true, issuer: issuer(ctx), studioOrigin: studio(ctx).origin, studioPath: '/studio' } }
    catch { result = { enabled: false } }
  } else if (method === 'GET' && path === '/api/account') {
    const accountIssuer = issuer(ctx)
    const { rows } = ctx.user ? await ctx.db.query<{ subject: string }>('SELECT subject FROM external_account WHERE issuer=$1 AND "userId"=$2', [accountIssuer, ctx.user.id]) : { rows: [] }
    let studioReady = false
    try { studio(ctx); studioReady = true } catch {}
    const balance = rows.length ? await readAccountBalance(ctx, rows[0].subject) : null
    result = { linked: rows.length > 0, issuer: accountIssuer, subject: rows[0]?.subject ?? null,
      balance: null, ...balance, accountUrl: accountIssuer, studioReady }
  } else if (method === 'POST' && ['/api/account/connect', '/api/newapi/start'].includes(path)) result = await start(ctx)
  else if (method === 'POST' && ['/api/account/finish', '/api/newapi/finish'].includes(path)) result = await finish(ctx)
  else if (method === 'POST' && path === '/api/newapi/studio/start') result = await studioStart(ctx)
  else if (method === 'POST' && path === '/api/newapi/studio/exchange') result = await studioExchange(ctx)
  else if (method === 'POST' && path === '/api/newapi/studio/context') result = await studioContext(ctx)
  else if (method === 'POST' && path === '/api/newapi/studio/validate') result = await studioValidate(ctx)
  else return false
  ctx.json(200, result)
  return true
}
