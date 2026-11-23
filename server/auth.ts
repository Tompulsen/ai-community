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
import { AccountRequest, revokeAccountSession } from './native-account/index.ts'
import { isNewApiEnabled } from './native-account/config.ts'
import { accountRequestFromNode } from './web-request.ts'
import type { AppConfig, Database, PublicUser, Queryable, RequestContext, SessionUser } from './types.ts'

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

interface UserPermissionsRow extends UserRow {
  roles: RoleRow[]
  assignedRoleIds: string[]
  rootUserId: string | null
}

const legacySessionCookie = 'community_session'
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
  const { rows } = await db.query<UserPermissionsRow>(`SELECT u.id,u.username,u.name,u.host,u.token,u."createdAt",u."isSuspended",u."isDeleted",
    u."movedToUri",u."isLocked",u."isBot",u."isCat",u."isExplorable",u."followersCount",u."followingCount",
    u."notesCount",u."avatarId",u."bannerId",p.description AS bio,
    (SELECT COALESCE(jsonb_agg(granted),'[]'::jsonb) FROM
      (SELECT id,target,"condFormula","isAdministrator","isModerator" FROM role WHERE "isAdministrator" OR "isModerator") granted) AS roles,
    (SELECT COALESCE(jsonb_agg(a."roleId"),'[]'::jsonb) FROM role_assignment a
      WHERE a."userId"=u.id AND (a."expiresAt" IS NULL OR a."expiresAt">NOW())) AS "assignedRoleIds",
    (SELECT "rootUserId" FROM meta LIMIT 1) AS "rootUserId"
    FROM "user" u JOIN user_profile p ON p."userId"=u.id WHERE u.id=$1`, [userId])
  const user = rows[0]
  if (!user || user.host !== null || user.isSuspended || user.isDeleted || user.movedToUri || !user.token) return null
  const { roles, assignedRoleIds, rootUserId, token, ...profile } = user
  const assigned = new Set(assignedRoleIds)
  const applicable = roles.filter(role => role.target === 'manual' ? assigned.has(role.id) : roleCondition(role.condFormula, user, assigned))
  const isAdmin = rootUserId === user.id || applicable.some(role => role.isAdministrator)
  const isModerator = isAdmin || applicable.some(role => role.isModerator)
  return { ...profile, isAdmin, isModerator, tokenHash: hash(token) }
}

async function canUpdateProfileMedia(db: Queryable, user: SessionUser): Promise<boolean> {
  type Policy = { priority?: number; useDefault?: boolean; value?: boolean }
  const [meta, roles, assignments] = await Promise.all([
    db.query<{ policies: { canUpdateBioMedia?: boolean } | null }>('SELECT policies FROM meta LIMIT 1'),
    db.query<Pick<RoleRow, 'id' | 'target' | 'condFormula'> & { policies: { canUpdateBioMedia?: Policy } | null }>('SELECT id,target,"condFormula",policies FROM role'),
    db.query<{ roleId: string }>('SELECT "roleId" FROM role_assignment WHERE "userId"=$1 AND ("expiresAt" IS NULL OR "expiresAt">NOW())', [user.id]),
  ])
  const fallback = meta.rows[0]?.policies?.canUpdateBioMedia !== false
  const assigned = new Set(assignments.rows.map(row => row.roleId))
  const entries = roles.rows.filter(role => role.target === 'manual' ? assigned.has(role.id) : roleCondition(role.condFormula, user, assigned))
    .map(role => role.policies?.canUpdateBioMedia ?? { priority: 0, useDefault: true })
  if (!entries.length) return fallback
  const priority = (entry: Policy) => entry.priority === 2 ? 2 : entry.priority === 1 ? 1 : 0
  const highest = Math.max(...entries.map(priority))
  return entries.filter(entry => priority(entry) === highest).some(entry => entry.useDefault ? fallback : entry.value === true)
}

export function authServices({ db, config }: { db: Database; redis: Redis; config: AppConfig }) {
  const secure = new URL(config.url).protocol === 'https:' ? '; Secure' : ''
  const verifyAccount = accountSessionVerifier(config)
  async function authenticate(req: IncomingMessage): Promise<{ user: SessionUser | null; sessionHash: string | null }> {
    if (req.method === 'POST' && new URL(req.url || '/', config.url).pathname === '/api/session/logout') {
      return { user: null, sessionHash: null }
    }
    const sessionHash = accountSessionHash(req)
    if (!sessionHash) return { user: null, sessionHash: null }
    let account
    const fresh = !['GET', 'HEAD'].includes(req.method || 'GET') || req.url?.startsWith('/api/session')
      || req.url?.startsWith('/api/security/') || req.url?.startsWith('/api/account/') || req.url?.startsWith('/api/admin/')
    try {
      account = await verifyAccount(req, fresh)
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 401) throw error
      return { user: null, sessionHash: null }
    }
    if (account.binding.issuer !== accountCenter(config) || account.binding.sessionHash !== sessionHash
      || !/^[1-9]\d*$/.test(account.binding.subject) || !Number.isSafeInteger(Number(account.binding.subject))) {
      return { user: null, sessionHash: null }
    }
    const user = await getUser(db, account.binding.subject)
    const mapping = user && await db.query('SELECT 1 FROM external_account WHERE issuer=$1 AND subject=$2 AND "userId"=$3',
      [account.binding.issuer, account.binding.subject, user.id])
    if (!user || user.id !== account.binding.subject || !mapping?.rows.length) {
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
      if (String(req.headers.cookie || '').split(';').some(value => value.trim().startsWith(`${legacySessionCookie}=`)))
        appendCookie(res, `${legacySessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
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
      if (isNewApiEnabled()) await revokeAccountSession(new AccountRequest(accountRequestFromNode(req, config.url)))
      verifyAccount.invalidate(req)
      appendCookie(res, `${legacySessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
      appendCookie(res, `octopus_new_api_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
      ctx.json(200, { user: null })
      return true
    }
    if (url.pathname === '/api/profile' && req.method === 'PATCH') {
      const currentUser = ctx.requireUser()
      if (Object.keys(body).some(key => !['name', 'bio', 'avatarId', 'bannerId'].includes(key))) throw httpError(400, '个人资料包含不支持修改的字段。')
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const bio = body.bio ?? ''
      if (('name' in body && (!name || name.length > 8)) || typeof bio !== 'string' || bio.length > 100) throw httpError(400, '昵称最多 8 个字符，个人简介最多 100 个字符。')
      if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(name) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(bio)) throw httpError(400, '名称或个人简介包含无效字符。')
      const profileFiles: Record<string, string | null> = {}
      for (const field of ['avatarId', 'bannerId'] as const) if (field in body) {
        const fileId = body[field]
        if (fileId !== null && (typeof fileId !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(fileId))) throw httpError(400, '资料图片编号无效。')
        profileFiles[field] = fileId as string | null
      }
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        const newFiles = (['avatarId', 'bannerId'] as const).map(field => profileFiles[field] !== currentUser[field] ? profileFiles[field] : null).filter(Boolean)
        if (newFiles.length && !await canUpdateProfileMedia(client, currentUser)) throw httpError(403, '当前账号暂不能更换头像或封面。')
        for (const fileId of newFiles) {
          const file = await client.query<{ id: string; isSensitive: boolean }>(`SELECT id,"isSensitive" FROM drive_file WHERE id=$1 AND "userId"=$2
            AND type IN ('image/jpeg','image/png','image/webp','image/gif','image/avif') FOR SHARE`, [fileId, currentUser.id])
          if (!file.rows.length) throw httpError(400, '请选择自己上传的图片。')
          if (file.rows[0]!.isSensitive) throw httpError(400, '敏感图片不能用作头像或封面。')
        }
        if ('name' in body) await client.query('UPDATE "user" SET name=$2,"updatedAt"=NOW() WHERE id=$1', [currentUser.id, name])
        else await client.query('UPDATE "user" SET "updatedAt"=NOW() WHERE id=$1', [currentUser.id])
        for (const [field, fileId] of Object.entries(profileFiles)) {
          await client.query(`UPDATE "user" SET "${field}"=$2 WHERE id=$1`, [currentUser.id, fileId])
        }
        if ('bio' in body) await client.query('UPDATE user_profile SET description=$2 WHERE "userId"=$1', [currentUser.id, bio])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
      ctx.json(200, { user: publicUser({ ...currentUser, ...('name' in body ? { name } : {}), ...('bio' in body ? { bio } : {}), ...profileFiles }) })
      return true
    }
    return false
  }
  return { authenticate, handleAuth }
}
