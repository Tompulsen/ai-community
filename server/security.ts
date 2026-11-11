/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import * as OTPAuth from 'otpauth'
import nodemailer from 'nodemailer'
import { appendCookie, hash, httpError, sessionCookie } from './auth.ts'
import { legacyIdTime } from './content.ts'
import type { StoredSession } from './auth.ts'
import type { PoolClient } from 'pg'
import type { RequestContext, TwoFactorProfile } from './types.ts'

interface Credential extends TwoFactorProfile { password: string | null; email: string | null; emailVerified: boolean }
interface MailSettings {
  enableEmail: boolean; email: string | null; smtpHost: string | null; smtpPort: number | null
  smtpSecure: boolean; smtpUser: string | null; smtpPass: string | null
}
async function mailSettings(ctx: RequestContext): Promise<MailSettings | undefined> {
  return (await ctx.db.query<MailSettings>(`SELECT "enableEmail",email,"smtpHost","smtpPort","smtpSecure","smtpUser","smtpPass" FROM meta LIMIT 1`)).rows[0]
}
const canMail = (settings: MailSettings | undefined) => Boolean(settings?.enableEmail && settings.email && settings.smtpHost)
export function newPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value) > 72) throw httpError(400, '新密码至少 8 个字符，且不超过 72 字节。')
  return value
}
async function throttle(ctx: RequestContext, action: string, subject: string, max = 12): Promise<void> {
  const key = `community-next:security-rate:${action}:${hash(subject)}`
  if (await ctx.redis.incr(key) === 1) await ctx.redis.expire(key, 900)
  if (Number(await ctx.redis.get(key)) > max) throw httpError(429, '操作过于频繁，请稍后重试。')
}
async function credentials(ctx: RequestContext): Promise<Credential> {
  const user = ctx.requireUser()
  const result = await ctx.db.query<Credential>(`SELECT "userId",password,email,"emailVerified",
    "twoFactorEnabled","twoFactorSecret","twoFactorBackupSecret" FROM user_profile WHERE "userId"=$1`, [user.id])
  if (!result.rows[0]) throw httpError(403, '账号不可用。')
  return result.rows[0]
}
async function verify(ctx: RequestContext): Promise<Credential> {
  const user = ctx.requireUser()
  await throttle(ctx, 'verify', user.id)
  const profile = await credentials(ctx)
  if (!profile.password || typeof ctx.body.password !== 'string' || ctx.body.password.length > 1024
    || !await bcrypt.compare(ctx.body.password, profile.password)) throw httpError(401, '当前社区密码不正确。', 'PASSWORD_REQUIRED')
  await ctx.authenticateFactor(profile, ctx.body.token, ctx.body.recoveryCode)
  return profile
}
async function change<T>(ctx: RequestContext, profile: Credential, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await ctx.db.connect()
  try {
    await client.query('BEGIN')
    const current = (await client.query<Credential>('SELECT * FROM user_profile WHERE "userId"=$1 FOR UPDATE', [profile.userId])).rows[0]
    if (!current || current.password !== profile.password || current.twoFactorEnabled !== profile.twoFactorEnabled
      || current.twoFactorSecret !== profile.twoFactorSecret) throw httpError(409, '账号安全设置已变化，请重新验证。')
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
async function rotate(client: PoolClient, userId: string): Promise<string> {
  const token = randomBytes(12).toString('base64url')
  await client.query('UPDATE "user" SET token=$2,"updatedAt"=NOW() WHERE id=$1', [userId, token])
  await client.query('DELETE FROM access_token WHERE "userId"=$1', [userId])
  return hash(token)
}
function expireSession(ctx: RequestContext): void {
  appendCookie(ctx.res, `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(ctx.config.url).protocol === 'https:' ? '; Secure' : ''}`)
}
const recoveryCodes = () => Array.from({ length: 10 }, () => randomBytes(5).toString('hex').toUpperCase())

export async function handleSecurity(ctx: RequestContext): Promise<boolean> {
  const route = ctx.url.pathname, method = ctx.req.method
  if (route === '/api/security/capabilities' && method === 'GET') {
    ctx.json(200, { emailReset: canMail(await mailSettings(ctx)) })
    return true
  }
  if (route === '/api/security/password/forgot' && method === 'POST') {
    const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw httpError(400, '请输入有效邮箱。')
    await throttle(ctx, 'reset-email', email, 3)
    await throttle(ctx, 'reset-ip', ctx.ip || ctx.req.socket.remoteAddress || 'unknown', 10)
    const settings = await mailSettings(ctx)
    if (!canMail(settings) || !settings) throw httpError(503, '本站尚未配置发信服务，请前往章鱼账户中心或联系管理员。', 'MAIL_UNAVAILABLE')
    const transport = nodemailer.createTransport({
      host: settings.smtpHost!, port: settings.smtpPort || (settings.smtpSecure ? 465 : 587), secure: settings.smtpSecure,
      ...(settings.smtpUser ? { auth: { user: settings.smtpUser, pass: settings.smtpPass || '' } } : {}),
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    })
    try { await transport.verify() } catch { throw httpError(503, '发信服务暂时不可用，请稍后重试。', 'MAIL_UNAVAILABLE') }
    const profile = (await ctx.db.query<{ userId: string }>(`SELECT p."userId" FROM user_profile p JOIN "user" u ON u.id=p."userId"
      WHERE LOWER(BTRIM(p.email))=$1 AND p."emailVerified" AND u.host IS NULL AND NOT u."isSuspended"
      AND NOT u."isDeleted" AND u."movedToUri" IS NULL LIMIT 1`, [email])).rows[0]
    if (profile) {
      const token = randomBytes(32).toString('base64url')
      await ctx.db.query(`INSERT INTO password_reset_request(id,token,"userId") VALUES($1,$2,$3)`,
        [ctx.newId(), `community:${hash(token)}`, profile.userId])
      const resetUrl = new URL('/account', ctx.config.url)
      resetUrl.searchParams.set('reset', token)
      // A generic response avoids disclosing whether an email belongs to an account.
      void transport.sendMail({ from: settings.email!, to: email, subject: '重置社区密码',
        text: `请在 30 分钟内访问以下地址重置社区密码：\n${resetUrl.href}\n\n如果不是本人申请，请忽略此邮件。` })
        .catch(async () => {
          await ctx.db.query('DELETE FROM password_reset_request WHERE token=$1', [`community:${hash(token)}`]).catch(() => {})
          console.error(JSON.stringify({ code: 'PASSWORD_RESET_MAIL_FAILED' }))
        })
    }
    ctx.json(200, { ok: true, message: '请求已受理。若邮箱已验证且符合条件，请查收重置邮件。' })
    return true
  }
  if (route === '/api/security/password/reset' && method === 'POST') {
    const token = ctx.body.resetToken
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw httpError(400, '重置链接无效。')
    const password = newPassword(ctx.body.newPassword)
    await throttle(ctx, 'reset-token', token, 8)
    const stored = (await ctx.db.query<Credential & { id: string }>(`SELECT r.id,p."userId",p.password,p.email,p."emailVerified",
      p."twoFactorEnabled",p."twoFactorSecret",p."twoFactorBackupSecret" FROM password_reset_request r
      JOIN user_profile p ON p."userId"=r."userId" JOIN "user" u ON u.id=p."userId"
      WHERE r.token=$1 AND u.host IS NULL AND NOT u."isSuspended" AND NOT u."isDeleted" AND u."movedToUri" IS NULL`,
    [`community:${hash(token)}`])).rows[0]
    if (!stored || Date.now() - (parseInt(stored.id.slice(0, 8), 36) + 946684800000) > 1800000) throw httpError(400, '重置链接已失效，请重新申请。')
    await ctx.authenticateFactor(stored, ctx.body.token, ctx.body.recoveryCode)
    const encoded = await bcrypt.hash(password, 10)
    await change(ctx, stored, async client => {
      const consumed = await client.query('DELETE FROM password_reset_request WHERE id=$1 AND token=$2 RETURNING id', [stored.id, `community:${hash(token)}`])
      if (!consumed.rowCount) throw httpError(409, '重置链接已使用。')
      await client.query('UPDATE user_profile SET password=$2 WHERE "userId"=$1', [stored.userId, encoded])
      await client.query('DELETE FROM password_reset_request WHERE "userId"=$1', [stored.userId])
      await rotate(client, stored.userId)
    })
    expireSession(ctx)
    ctx.json(200, { ok: true })
    return true
  }
  if (!route.startsWith('/api/security/')) return false
  const user = ctx.requireUser()
  if (route === '/api/security/status' && method === 'GET') {
    const [profile, settings] = await Promise.all([credentials(ctx), mailSettings(ctx)])
    ctx.json(200, { hasPassword: Boolean(profile.password), twoFactorEnabled: profile.twoFactorEnabled,
      recoveryCodesRemaining: profile.twoFactorBackupSecret?.length || 0, emailReset: canMail(settings),
      emailVerified: profile.emailVerified })
    return true
  }
  if (route === '/api/security/password' && method === 'POST') {
    const password = newPassword(ctx.body.newPassword), profile = await verify(ctx)
    const encoded = await bcrypt.hash(password, 10)
    const generation = await change(ctx, profile, async client => {
      await client.query('UPDATE user_profile SET password=$2 WHERE "userId"=$1', [user.id, encoded])
      await client.query('DELETE FROM password_reset_request WHERE "userId"=$1', [user.id])
      return rotate(client, user.id)
    })
    await ctx.redis.del(`community-next:mfa-setup:${user.id}`)
    ctx.json(200, { ok: true, user: await ctx.createSession(user.id, generation) })
    return true
  }
  if (route === '/api/security/mfa/setup' && method === 'POST') {
    const profile = await verify(ctx)
    if (profile.twoFactorEnabled) throw httpError(409, '二步验证已启用。')
    const totp = new OTPAuth.TOTP({ issuer: new URL(ctx.config.url).host, label: user.username, digits: 6, period: 30, secret: new OTPAuth.Secret({ size: 20 }) })
    await ctx.redis.set(`community-next:mfa-setup:${user.id}`, JSON.stringify({
      secret: totp.secret.base32, credential: hash(profile.password || ''), session: ctx.sessionHash,
    }), 'EX', 600)
    ctx.json(200, { secret: totp.secret.base32, uri: totp.toString(), expiresIn: 600 })
    return true
  }
  if (route === '/api/security/mfa/confirm' && method === 'POST') {
    const profile = await credentials(ctx)
    await throttle(ctx, 'mfa-confirm', user.id)
    const raw = await ctx.redis.get(`community-next:mfa-setup:${user.id}`)
    if (!raw || profile.twoFactorEnabled) throw httpError(409, '设置已过期，请重新开始。')
    const setup = JSON.parse(raw) as { secret: string; credential: string; session: string }
    if (setup.credential !== hash(profile.password || '') || setup.session !== ctx.sessionHash) throw httpError(409, '登录状态已变化，请重新设置。')
    await ctx.authenticateFactor({ ...profile, twoFactorEnabled: true, twoFactorSecret: setup.secret, twoFactorBackupSecret: [] }, ctx.body.token)
    const codes = recoveryCodes()
    const generation = await change(ctx, profile, async client => {
      await client.query(`UPDATE user_profile SET "twoFactorEnabled"=true,"twoFactorSecret"=$2,
        "twoFactorBackupSecret"=$3,"twoFactorTempSecret"=NULL WHERE "userId"=$1`, [user.id, setup.secret, codes])
      return rotate(client, user.id)
    })
    await ctx.redis.del(`community-next:mfa-setup:${user.id}`)
    ctx.json(200, { ok: true, recoveryCodes: codes, user: await ctx.createSession(user.id, generation) })
    return true
  }
  if ((route === '/api/security/mfa/disable' || route === '/api/security/mfa/recovery') && method === 'POST') {
    const profile = await verify(ctx)
    if (!profile.twoFactorEnabled) throw httpError(409, '二步验证尚未启用。')
    const codes = route.endsWith('/recovery') ? recoveryCodes() : null
    const generation = await change(ctx, profile, async client => {
      if (codes) await client.query('UPDATE user_profile SET "twoFactorBackupSecret"=$2 WHERE "userId"=$1', [user.id, codes])
      else await client.query(`UPDATE user_profile SET "twoFactorEnabled"=false,"twoFactorSecret"=NULL,
        "twoFactorBackupSecret"=NULL,"twoFactorTempSecret"=NULL WHERE "userId"=$1`, [user.id])
      return rotate(client, user.id)
    })
    ctx.json(200, { ok: true, ...(codes ? { recoveryCodes: codes } : {}), user: await ctx.createSession(user.id, generation) })
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
      if (stored.userId !== user.id || stored.tokenHash !== user.tokenHash) continue
      items.push({ id: key, current: ctx.sessionHash === key, createdAt: stored.createdAt || null, ip: stored.ip || null, userAgent: stored.userAgent || '' })
    }
    ctx.json(200, { items })
    return true
  }
  if (route === '/api/security/sessions/revoke' && method === 'POST') {
    const profile = await verify(ctx)
    if (ctx.body.all === true) {
      await change(ctx, profile, client => rotate(client, user.id))
      if (ctx.sessionHash) await ctx.redis.del(`community-next:session:${ctx.sessionHash}`)
      await ctx.redis.del(`community-next:sessions:${user.id}`, `community-next:mfa-setup:${user.id}`)
      expireSession(ctx)
      ctx.json(200, { ok: true, signedOut: true })
    } else {
      const id = ctx.body.id
      if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw httpError(400, '会话编号无效。')
      const raw = await ctx.redis.get(`community-next:session:${id}`)
      if (raw && (JSON.parse(raw) as StoredSession).userId !== user.id) throw httpError(404, '会话不存在。')
      await ctx.redis.del(`community-next:session:${id}`)
      await ctx.redis.zrem(`community-next:sessions:${user.id}`, id)
      if (id === ctx.sessionHash) expireSession(ctx)
      ctx.json(200, { ok: true, signedOut: id === ctx.sessionHash })
    }
    return true
  }
  return false
}
