/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Redis } from 'ioredis'
import bcrypt from 'bcryptjs'
import * as OTPAuth from 'otpauth'
import type { AppConfig, Database, PublicUser, Queryable, RequestContext, SessionUser, TwoFactorProfile } from './types.ts'

interface RoleUser {
  id: string
  host: string | null
  isSuspended: boolean
  isLocked: boolean
  isBot: boolean
  isCat: boolean
  isExplorable: boolean
  followersCount: number
  followingCount: number
  notesCount: number
}

interface UserRow extends RoleUser {
  username: string
  name: string | null
  bio: string | null
  token: string | null
  isDeleted: boolean
  movedToUri: string | null
  avatarId?: string | null
  bannerId?: string | null
}

interface RoleRow {
  id: string
  target: string
  condFormula: unknown
  isAdministrator: boolean
  isModerator: boolean
}

export interface StoredSession {
  userId: string
  tokenHash: string
  createdAt?: string
  ip?: string | null
  userAgent?: string
}

interface LoginProfile extends TwoFactorProfile {
  id: string
  password: string | null
  token: string | null
}

export const sessionCookie = 'community_session'
const ttl = 7 * 24 * 60 * 60
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const newId = () => Math.max(0, Date.now() - 946684800000).toString(36).padStart(8, '0') + randomBytes(8).toString('hex')
export const httpError = (statusCode: number, message: string, code?: string) => Object.assign(new Error(message), { statusCode, code })

export function readCookies(header: string = ''): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const offset = part.indexOf('=')
    if (offset < 1) continue
    try { cookies[part.slice(0, offset).trim()] = decodeURIComponent(part.slice(offset + 1)) } catch { /* Ignore malformed cookie values. */ }
  }
  return cookies
}

export function appendCookie(res: ServerResponse, value: string): void {
  const previous = res.getHeader('Set-Cookie')
  res.setHeader('Set-Cookie', [...(previous ? Array.isArray(previous) ? previous : [String(previous)] : []), value])
}

export function publicUser(user: SessionUser): PublicUser
export function publicUser(user: null | undefined): null
export function publicUser(user: SessionUser | null | undefined): PublicUser | null
export function publicUser(user: SessionUser | null | undefined): PublicUser | null {
  return user ? {
    id: user.id, name: user.name || user.username, username: user.username, bio: user.bio || '',
    isAdmin: user.isAdmin, isModerator: user.isModerator, avatarId: user.avatarId || null, bannerId: user.bannerId || null,
    avatarUrl: user.avatarId ? `/legacy-files/${encodeURIComponent(user.avatarId)}?variant=thumbnail` : null,
    bannerUrl: user.bannerId ? `/legacy-files/${encodeURIComponent(user.bannerId)}?variant=web` : null,
  } : null
}

export function roleCondition(formula: unknown, user: Partial<RoleUser>, assigned: ReadonlySet<string>, depth = 0): boolean {
  if (!formula || typeof formula !== 'object' || depth > 12) return false
  const condition = formula as Record<string, unknown>
  const child = (value: unknown) => roleCondition(value, user, assigned, depth + 1)
  const age = typeof user.id === 'string' ? (Date.now() - (parseInt(user.id.slice(0, 8), 36) + 946684800000)) / 1000 : NaN
  switch (condition.type) {
    case 'and': return Array.isArray(condition.values) && condition.values.every(child)
    case 'or': return Array.isArray(condition.values) && condition.values.some(child)
    case 'not': return Boolean(condition.value) && !child(condition.value)
    case 'isLocal': return user.host === null
    case 'isRemote': return user.host !== null
    case 'roleAssignedTo': return typeof condition.roleId === 'string' && assigned.has(condition.roleId)
    case 'isSuspended': return user.isSuspended === true
    case 'isLocked': return user.isLocked === true
    case 'isBot': return user.isBot === true
    case 'isCat': return user.isCat === true
    case 'isExplorable': return user.isExplorable === true
    case 'createdLessThan': return typeof condition.sec === 'number' && Number.isFinite(condition.sec) && age < condition.sec
    case 'createdMoreThan': return typeof condition.sec === 'number' && Number.isFinite(condition.sec) && age > condition.sec
    case 'followersLessThanOrEq': return typeof condition.value === 'number' && Number.isFinite(condition.value) && (user.followersCount ?? NaN) <= condition.value
    case 'followersMoreThanOrEq': return typeof condition.value === 'number' && Number.isFinite(condition.value) && (user.followersCount ?? NaN) >= condition.value
    case 'followingLessThanOrEq': return typeof condition.value === 'number' && Number.isFinite(condition.value) && (user.followingCount ?? NaN) <= condition.value
    case 'followingMoreThanOrEq': return typeof condition.value === 'number' && Number.isFinite(condition.value) && (user.followingCount ?? NaN) >= condition.value
    case 'notesLessThanOrEq': return typeof condition.value === 'number' && Number.isFinite(condition.value) && (user.notesCount ?? NaN) <= condition.value
    case 'notesMoreThanOrEq': return typeof condition.value === 'number' && Number.isFinite(condition.value) && (user.notesCount ?? NaN) >= condition.value
    default: return false
  }
}

export async function getUser(db: Queryable, userId: string): Promise<SessionUser | null> {
  const { rows } = await db.query<UserRow>(`SELECT u.id,u.username,u.name,u.host,u.token,u."isSuspended",u."isDeleted",
    u."movedToUri",u."isLocked",u."isBot",u."isCat",u."isExplorable",u."followersCount",u."followingCount",
    u."notesCount",u."avatarId",u."bannerId",p.description AS bio FROM "user" u JOIN user_profile p ON p."userId"=u.id WHERE u.id=$1`, [userId])
  const user = rows[0]
  if (!user || user.host !== null || user.isSuspended || user.isDeleted || user.movedToUri || !user.token) return null
  const [roles, assignments, meta] = await Promise.all([
    db.query<RoleRow>('SELECT id,target,"condFormula","isAdministrator","isModerator" FROM role WHERE "isAdministrator" OR "isModerator"'),
    db.query<{ roleId: string }>('SELECT "roleId" FROM role_assignment WHERE "userId"=$1 AND ("expiresAt" IS NULL OR "expiresAt">NOW())', [userId]),
    db.query<{ rootUserId: string | null }>('SELECT "rootUserId" FROM meta LIMIT 1'),
  ])
  const assigned = new Set(assignments.rows.map(row => row.roleId))
  const applicable = roles.rows.filter(role => role.target === 'manual' ? assigned.has(role.id) : roleCondition(role.condFormula, user, assigned))
  const isAdmin = meta.rows[0]?.rootUserId === user.id || applicable.some(role => role.isAdministrator)
  const isModerator = isAdmin || applicable.some(role => role.isModerator)
  const { token, ...profile } = user
  return { ...profile, isAdmin, isModerator, tokenHash: hash(token) }
}

export async function authenticateFactor(db: Queryable, redis: Redis, profile: TwoFactorProfile, token: unknown): Promise<void> {
  if (!profile.twoFactorEnabled) return
  if (typeof token !== 'string' || !token.trim()) throw httpError(401, '请输入两步验证码或备用码。', 'MFA_REQUIRED')
  const normalizedToken = token.trim()
  const backup = profile.twoFactorBackupSecret?.some(value => {
    const expected = Buffer.from(value), actual = Buffer.from(normalizedToken)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  })
  if (backup) {
    const used = await db.query(`UPDATE user_profile SET "twoFactorBackupSecret"=array_remove("twoFactorBackupSecret",$2)
      WHERE "userId"=$1 AND $2=ANY("twoFactorBackupSecret") RETURNING "userId"`, [profile.userId, normalizedToken])
    if (used.rowCount === 1) return
    throw httpError(401, '备用码已使用。', 'MFA_INVALID')
  }
  if (!/^\d{6}$/.test(normalizedToken) || !profile.twoFactorSecret) throw httpError(401, '两步验证码无效。', 'MFA_INVALID')
  const now = Date.now()
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(profile.twoFactorSecret), digits: 6, period: 30 })
  const delta = totp.validate({ token: normalizedToken, window: 1, timestamp: now })
  if (delta === null) throw httpError(401, '两步验证码无效。', 'MFA_INVALID')
  const key = `2fa:used:${profile.userId}:${createHash('sha256').update(profile.twoFactorSecret).digest('base64url')}:${totp.counter({ timestamp: now }) + delta}`
  if (await redis.set(key, normalizedToken, 'EX', 90, 'NX') !== 'OK') throw httpError(401, '验证码已使用，请等待下一个验证码。', 'MFA_REPLAY')
}

export function authServices({ db, redis, config }: { db: Database; redis: Redis; config: AppConfig }) {
  const secure = new URL(config.url).protocol === 'https:' ? '; Secure' : ''
  const dummy = bcrypt.hashSync(randomBytes(24).toString('base64url'), 10)
  function cookie(res: ServerResponse, value: string, maxAge: number): void {
    appendCookie(res, `${sessionCookie}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`)
  }
  async function createSession(userId: string, res: ServerResponse, req?: IncomingMessage, expectedTokenHash?: string): Promise<PublicUser> {
    const user = await getUser(db, userId)
    if (!user) throw httpError(403, '此账号当前不可用。')
    if (expectedTokenHash && user.tokenHash !== expectedTokenHash) throw httpError(409, '账号安全设置已变化，请重新登录。', 'CREDENTIAL_CHANGED')
    const token = randomBytes(32).toString('base64url')
    const sessionHash = hash(token)
    const stored: StoredSession = { userId, tokenHash: user.tokenHash, createdAt: new Date().toISOString(),
      ip: req?.socket.remoteAddress || null, userAgent: String(req?.headers['user-agent'] || '').slice(0, 512) }
    await redis.set(`community-next:session:${sessionHash}`, JSON.stringify(stored), 'EX', ttl)
    await redis.zadd(`community-next:sessions:${userId}`, Date.now(), sessionHash)
    await redis.expire(`community-next:sessions:${userId}`, ttl)
    cookie(res, token, ttl)
    return publicUser(user)
  }
  async function authenticate(req: IncomingMessage): Promise<{ user: SessionUser | null; sessionHash: string | null }> {
    const token = readCookies(req.headers.cookie)[sessionCookie]
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) return { user: null, sessionHash: null }
    const sessionHash = hash(token)
    const raw = await redis.get(`community-next:session:${sessionHash}`)
    if (!raw) return { user: null, sessionHash: null }
    let session: StoredSession
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || !('userId' in parsed) || typeof parsed.userId !== 'string'
        || !('tokenHash' in parsed) || typeof parsed.tokenHash !== 'string') return { user: null, sessionHash: null }
      session = parsed as StoredSession
    } catch { return { user: null, sessionHash: null } }
    const user = await getUser(db, session.userId)
    if (!user || user.tokenHash !== session.tokenHash) {
      await redis.del(`community-next:session:${sessionHash}`)
      return { user: null, sessionHash: null }
    }
    return { user, sessionHash }
  }
  async function handleAuth(ctx: RequestContext): Promise<boolean> {
    const { req, res, url, body, user } = ctx
    const recordSignin = (userId: string, success: boolean) => db.query(
      'INSERT INTO signin(id,"userId",ip,headers,success) VALUES($1,$2,$3,$4,$5)',
      [newId(), userId, req.socket.remoteAddress || null, JSON.stringify({ 'user-agent': String(req.headers['user-agent'] || '').slice(0, 512) }), success])
    if (url.pathname === '/api/session' && req.method === 'GET') {
      ctx.json(200, { user: publicUser(user) })
      return true
    }
    if (url.pathname === '/api/registration' || url.pathname === '/api/session/register') {
      const meta = (await db.query<{
        rootUserId: string | null; disableRegistration: boolean; emailRequiredForSignup: boolean;
        enableEmail: boolean; enableActiveEmailValidation: boolean; preservedUsernames: string[];
        prohibitedWordsForNameOfUser: string[]; bannedEmailDomains: string[];
        enableHcaptcha: boolean; enableRecaptcha: boolean; enableMcaptcha: boolean; enableTurnstile: boolean; enableTestcaptcha: boolean;
      }>(`SELECT "rootUserId","disableRegistration","emailRequiredForSignup","enableEmail","enableActiveEmailValidation",
        "preservedUsernames","prohibitedWordsForNameOfUser","bannedEmailDomains",
        "enableHcaptcha","enableRecaptcha","enableMcaptcha","enableTurnstile","enableTestcaptcha" FROM meta LIMIT 1`)).rows[0]
      const captcha = meta && [meta.enableHcaptcha, meta.enableRecaptcha, meta.enableMcaptcha, meta.enableTurnstile, meta.enableTestcaptcha].some(Boolean)
      const verification = Boolean(meta?.enableEmail && meta.enableActiveEmailValidation)
      if (url.pathname === '/api/registration' && req.method === 'GET') {
        ctx.json(200, { enabled: Boolean(meta?.rootUserId && !captcha && !(verification && meta.emailRequiredForSignup)),
          inviteRequired: meta?.disableRegistration !== false, emailRequired: Boolean(meta?.emailRequiredForSignup),
          emailVerificationRequired: verification, captchaRequired: Boolean(captcha) })
        return true
      }
      if (url.pathname !== '/api/session/register' || req.method !== 'POST') return false
      if (user) throw httpError(409, '请先退出当前账号。')
      if (!meta?.rootUserId || captcha) throw httpError(503, '注册暂不可用，请使用章鱼账号登录。')
      const username = typeof body.username === 'string' ? body.username.trim() : ''
      const lower = username.toLowerCase()
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!/^[a-zA-Z0-9_]{1,20}$/.test(username) || meta.preservedUsernames?.some(name => name.toLowerCase() === lower) ||
        meta.prohibitedWordsForNameOfUser?.some(word => word && lower.includes(word.toLowerCase()))) throw httpError(400, '用户名不可用，请使用 1–20 位字母、数字或下划线。')
      if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) throw httpError(400, '密码长度应为 8–128 字符。')
      if ((meta.emailRequiredForSignup && !email) || (email && (email.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) throw httpError(400, '请填写有效邮箱。')
      if (email && meta.bannedEmailDomains?.some(domain => email.endsWith(`@${domain.toLowerCase()}`) || email.split('@')[1]?.endsWith(`.${domain.toLowerCase()}`))) throw httpError(400, '此邮箱域名不可用。')
      if (verification && email) throw httpError(503, '邮箱验证服务尚未接入，请使用章鱼账号登录。')
      const limit = `community-next:signup:${hash(req.socket.remoteAddress || '')}`
      const attempts = await redis.incr(limit)
      if (attempts === 1) await redis.expire(limit, 3600)
      if (attempts > 10) throw httpError(429, '注册尝试过于频繁，请稍后重试。')
      const password = await bcrypt.hash(body.password, 12)
      const userId = newId()
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`signup:username:${lower}`])
        const policy = (await client.query<{ disableRegistration: boolean }>('SELECT "disableRegistration" FROM meta LIMIT 1 FOR SHARE')).rows[0]
        let ticketId: string | undefined
        if (policy?.disableRegistration !== false) {
          if (typeof body.invite !== 'string' || body.invite.length > 128) throw httpError(403, '注册需要有效邀请码。')
          const ticket = (await client.query<{ id: string }>('SELECT id FROM registration_ticket WHERE code=$1 AND "usedAt" IS NULL AND "pendingUserId" IS NULL AND ("expiresAt" IS NULL OR "expiresAt">NOW()) FOR UPDATE', [body.invite.trim()])).rows[0]
          if (!ticket) throw httpError(403, '邀请码已使用或过期。')
          ticketId = ticket.id
        }
        if ((await client.query('SELECT 1 FROM "user" WHERE "usernameLower"=$1 AND host IS NULL UNION ALL SELECT 1 FROM used_username WHERE username=$1 LIMIT 1', [lower])).rows.length) throw httpError(409, '用户名已使用。')
        await client.query('INSERT INTO "user"(id,username,"usernameLower",host,token,name) VALUES($1,$2,$3,NULL,$4,$2)', [userId, username, lower, randomBytes(12).toString('base64url')])
        await client.query('INSERT INTO user_profile("userId","autoAcceptFollowed",password,email,"emailVerified") VALUES($1,true,$2,$3,false)', [userId, password, email || null])
        await client.query('INSERT INTO used_username(username,"createdAt") VALUES($1,NOW())', [lower])
        if (ticketId) await client.query('UPDATE registration_ticket SET "usedAt"=NOW(),"usedById"=$2 WHERE id=$1', [ticketId, userId])
        if (typeof body.lotteryInviterId === 'string' && /^[a-zA-Z0-9]{1,32}$/.test(body.lotteryInviterId)) {
          await client.query(`INSERT INTO community_lottery_referral("userId","inviterId","createdAt")
            SELECT $1,id,NOW() FROM "user" WHERE id=$2 AND host IS NULL AND NOT "isDeleted" AND NOT "isSuspended"`, [userId, body.lotteryInviterId])
        }
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
      ctx.json(201, { user: await createSession(userId, res) })
      return true
    }
    if (url.pathname === '/api/session/login' && req.method === 'POST') {
      const identifier = typeof body.login === 'string' ? body.login.trim().toLowerCase() : ''
      if (!identifier || identifier.length > 128 || typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw httpError(400, '请输入账号和密码。')
      const limiter = `community-next:login:${hash(identifier + ':' + req.socket.remoteAddress)}`
      const attempts = await redis.incr(limiter)
      if (attempts === 1) await redis.expire(limiter, 600)
      if (attempts > 20) throw httpError(429, '登录尝试过于频繁，请稍后重试。')
      const result = await db.query<LoginProfile>(`SELECT u.id,u.token,p.password,p."userId",p."twoFactorEnabled",p."twoFactorSecret",p."twoFactorBackupSecret"
        FROM "user" u JOIN user_profile p ON p."userId"=u.id WHERE u.host IS NULL
        AND NOT u."isSuspended" AND NOT u."isDeleted" AND u."movedToUri" IS NULL
        AND ${identifier.includes('@') ? 'LOWER(BTRIM(p.email))=$1' : 'u."usernameLower"=$1'} LIMIT 1`, [identifier])
      const profile = result.rows[0]
      const same = await bcrypt.compare(body.password, profile?.password || dummy)
      if (!profile?.password || !profile.token || !same) {
        if (profile) await recordSignin(profile.id, false)
        throw httpError(401, '账号或密码不正确。', 'INVALID_CREDENTIALS')
      }
      if (!profile.twoFactorEnabled) {
        const policy = (await db.query<Record<string, boolean>>('SELECT "enableHcaptcha","enableRecaptcha","enableMcaptcha","enableTurnstile","enableTestcaptcha" FROM meta LIMIT 1')).rows[0]
        // shortcut: disabled legacy captcha providers stay fail-closed until their UI adapters are migrated.
        if (policy && Object.values(policy).some(Boolean)) throw httpError(503, '请通过章鱼账号登录，当前验证码服务尚未接入。', 'CAPTCHA_REQUIRED')
      }
      try { await authenticateFactor(db, redis, profile, body.token || body.recoveryCode) }
      catch (error) { await recordSignin(profile.id, false); throw error }
      const loggedIn = await createSession(profile.id, res, req, hash(profile.token))
      await recordSignin(profile.id, true)
      await redis.del(limiter)
      ctx.json(200, { user: loggedIn })
      return true
    }
    if (url.pathname === '/api/session/logout' && req.method === 'POST') {
      if (ctx.sessionHash) await redis.del(`community-next:session:${ctx.sessionHash}`)
      if (ctx.sessionHash && user) await redis.zrem(`community-next:sessions:${user.id}`, ctx.sessionHash)
      cookie(res, '', 0)
      ctx.json(200, { user: null })
      return true
    }
    if (url.pathname === '/api/profile' && req.method === 'PATCH') {
      const currentUser = ctx.requireUser()
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const bio = body.bio ?? ''
      if (!name || name.length > 50 || typeof bio !== 'string' || bio.length > 1500) throw httpError(400, '名称或个人简介超出限制。')
      const profileFiles: Record<string, string | null> = {}
      for (const field of ['avatarId', 'bannerId'] as const) if (field in body) {
        const fileId = body[field]
        if (fileId !== null && (typeof fileId !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(fileId))) throw httpError(400, '资料图片编号无效。')
        profileFiles[field] = fileId as string | null
      }
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        for (const fileId of Object.values(profileFiles)) if (fileId) {
          const file = await client.query(`SELECT id FROM drive_file WHERE id=$1 AND "userId"=$2
            AND type IN ('image/jpeg','image/png','image/webp','image/gif','image/avif') FOR SHARE`, [fileId, currentUser.id])
          if (!file.rowCount) throw httpError(400, '请选择自己上传的图片。')
        }
        await client.query('UPDATE "user" SET name=$2,"updatedAt"=NOW() WHERE id=$1', [currentUser.id, name])
        for (const [field, fileId] of Object.entries(profileFiles)) {
          await client.query(`UPDATE "user" SET "${field}"=$2 WHERE id=$1`, [currentUser.id, fileId])
        }
        await client.query('UPDATE user_profile SET description=$2 WHERE "userId"=$1', [currentUser.id, bio])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
      ctx.json(200, { user: publicUser({ ...currentUser, name, bio, ...profileFiles }) })
      return true
    }
    return false
  }
  return { authenticate, createSession, handleAuth, authenticateFactor: (profile: TwoFactorProfile, token: unknown, recoveryCode?: unknown) => authenticateFactor(db, redis, profile, token || recoveryCode) }
}
