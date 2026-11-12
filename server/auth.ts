/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Redis } from 'ioredis'
import { accountCenter, accountSessionHash, accountSessionVerifier } from './account-session.ts'
import { rememberPublicIdentity } from './public-identity.ts'
import type { AccountSessionBinding, AppConfig, Database, PublicUser, Queryable, RequestContext, SessionUser } from './types.ts'

interface RoleUser {
  id: string
  createdAt: Date | string | null
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
  account?: AccountSessionBinding
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
    ...(user.accountId ? { accountId: user.accountId } : {}),
    isAdmin: user.isAdmin, isModerator: user.isModerator, avatarId: user.avatarId || null, bannerId: user.bannerId || null,
    avatarUrl: user.avatarId ? `/legacy-files/${encodeURIComponent(user.avatarId)}?variant=thumbnail` : null,
    bannerUrl: user.bannerId ? `/legacy-files/${encodeURIComponent(user.bannerId)}?variant=web` : null,
  } : null
}

export function roleCondition(formula: unknown, user: Partial<RoleUser>, assigned: ReadonlySet<string>, depth = 0): boolean {
  if (!formula || typeof formula !== 'object' || depth > 12) return false
  const condition = formula as Record<string, unknown>
  const child = (value: unknown) => roleCondition(value, user, assigned, depth + 1)
  const createdAt = user.createdAt instanceof Date ? user.createdAt.getTime()
    : typeof user.createdAt === 'string' ? Date.parse(user.createdAt) : NaN
  const age = (Date.now() - createdAt) / 1000
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
  const { rows } = await db.query<UserRow>(`SELECT u.id,u.username,u.name,u.host,u.token,u."createdAt",u."isSuspended",u."isDeleted",
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

export function authServices({ db, redis, config }: { db: Database; redis: Redis; config: AppConfig }) {
  const secure = new URL(config.url).protocol === 'https:' ? '; Secure' : ''
  const verifyAccount = accountSessionVerifier(config)
  function cookie(res: ServerResponse, value: string, maxAge: number): void {
    appendCookie(res, `${sessionCookie}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`)
  }
  async function createSession(userId: string, res: ServerResponse, req?: IncomingMessage, expectedTokenHash?: string, account?: AccountSessionBinding): Promise<PublicUser> {
    const user = await getUser(db, userId)
    if (!user) throw httpError(403, '此账号当前不可用。')
    if (expectedTokenHash && user.tokenHash !== expectedTokenHash) throw httpError(409, '账号安全设置已变化，请重新登录。', 'CREDENTIAL_CHANGED')
    if (!account || account.issuer !== accountCenter(config) || userId !== account.subject
      || !/^[1-9]\d*$/.test(account.subject) || !Number.isSafeInteger(Number(account.subject))) {
      throw httpError(409, '社区账号必须与章鱼账号编号一致。', 'ACCOUNT_IDENTITY_REQUIRED')
    }
    const token = randomBytes(32).toString('base64url')
    const sessionHash = hash(token)
    const stored: StoredSession = { userId, tokenHash: user.tokenHash, createdAt: new Date().toISOString(),
      ip: req?.socket.remoteAddress || null, userAgent: String(req?.headers['user-agent'] || '').slice(0, 512), ...(account ? { account } : {}) }
    await redis.set(`community-next:session:${sessionHash}`, JSON.stringify(stored), 'EX', ttl)
    await redis.zadd(`community-next:sessions:${userId}`, Date.now(), sessionHash)
    await redis.expire(`community-next:sessions:${userId}`, ttl)
    cookie(res, token, ttl)
    return publicUser(user)
  }
  async function authenticate(req: IncomingMessage): Promise<{ user: SessionUser | null; sessionHash: string | null }> {
    if (req.method === 'POST' && new URL(req.url || '/', config.url).pathname === '/api/session/logout') {
      return { user: null, sessionHash: null }
    }
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
    if (!session.account || session.userId !== session.account.subject
      || session.account.issuer !== accountCenter(config)
      || session.account.sessionHash !== accountSessionHash(req)) {
      await redis.del(`community-next:session:${sessionHash}`)
      return { user: null, sessionHash: null }
    }
    let account
    const fresh = req.url?.startsWith('/api/session') || req.url?.startsWith('/api/security/') || req.url?.startsWith('/api/account/')
    try {
      account = await verifyAccount(req, fresh)
      if (account.binding.subject !== session.account.subject || account.binding.issuer !== session.account.issuer) {
        await redis.del(`community-next:session:${sessionHash}`)
        return { user: null, sessionHash: null }
      }
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 401) throw error
      await redis.del(`community-next:session:${sessionHash}`)
      return { user: null, sessionHash: null }
    }
    const user = await getUser(db, session.userId)
    const mapping = user && await db.query('SELECT 1 FROM external_account WHERE issuer=$1 AND subject=$2 AND "userId"=$3',
      [session.account.issuer, session.account.subject, user.id])
    if (!user || user.tokenHash !== session.tokenHash || !mapping?.rows.length) {
      await redis.del(`community-next:session:${sessionHash}`)
      return { user: null, sessionHash: null }
    }
    if (fresh) await rememberPublicIdentity(db, {
      issuer: account.binding.issuer, subject: account.binding.subject, userId: user.id, username: account.username,
    })
    return { user: { ...user, accountId: account.binding.subject, username: account.username }, sessionHash }
  }
  async function handleAuth(ctx: RequestContext): Promise<boolean> {
    const { req, res, url, body, user } = ctx
    if (url.pathname === '/api/session' && req.method === 'GET') {
      ctx.json(200, { user: publicUser(user), authentication: 'zhangyu', accountUrl: accountCenter(config) })
      return true
    }
    if (url.pathname === '/api/registration' && req.method === 'GET') {
      ctx.json(200, { enabled: false, authentication: 'zhangyu', accountUrl: accountCenter(config) })
      return true
    }
    if (req.method === 'POST' && ['/api/session/login', '/api/session/register'].includes(url.pathname)) {
      throw httpError(410, '社区已统一使用章鱼账号，请在登录页继续。', 'ACCOUNT_LOGIN_REQUIRED')
    }
    if (url.pathname === '/api/session/logout' && req.method === 'POST') {
      cookie(res, '', 0)
      appendCookie(res, `octopus_new_api_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
      const token = readCookies(req.headers.cookie)[sessionCookie]
      if (/^[A-Za-z0-9_-]{43}$/.test(token || '')) {
        const sessionHash = hash(token)
        const raw = await redis.get(`community-next:session:${sessionHash}`)
        await redis.del(`community-next:session:${sessionHash}`)
        if (raw) {
          try {
            const stored = JSON.parse(raw) as StoredSession
            if (typeof stored.userId === 'string') await redis.zrem(`community-next:sessions:${stored.userId}`, sessionHash)
          } catch { /* A malformed record must not block clearing the browser session. */ }
        }
      }
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
  return { authenticate, createSession, handleAuth }
}
