/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { accountCenter } from './account-session.ts'
import type { Queryable, RequestContext } from './types.ts'

export interface PublicIdentity {
  accountId: string
  username: string
}

interface VerifiedIdentity {
  issuer: string
  subject: string
  userId: string
  username: string
}

function validSubject(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
}

function validUsername(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

export async function rememberPublicIdentity(db: Queryable, identity: VerifiedIdentity): Promise<void> {
  let validIssuer = false
  try {
    const url = new URL(identity.issuer)
    validIssuer = url.protocol === 'https:' && url.origin === identity.issuer
  } catch { /* Only a verified account origin can own a public snapshot. */ }
  if (!validIssuer || !validSubject(identity.subject) || !validUsername(identity.username)
    || typeof identity.userId !== 'string' || !identity.userId || identity.userId.length > 32) {
    throw Object.assign(new Error('章鱼账号返回了无效的公开身份。'), { statusCode: 502, code: 'SSO_IDENTITY' })
  }
  await db.query(`UPDATE external_account SET username=$4
    WHERE issuer=$1 AND subject=$2 AND "userId"=$3 AND username IS DISTINCT FROM $4`,
  [identity.issuer, identity.subject, identity.userId, identity.username])
}

export async function readPublicIdentities(
  ctx: Pick<RequestContext, 'db' | 'config'>,
  userIds: readonly string[],
): Promise<Map<string, PublicIdentity>> {
  const identities = new Map<string, PublicIdentity>()
  const ids = [...new Set(userIds)]
  if (!ids.length) return identities
  const { rows } = await ctx.db.query<{ userId: string; subject: unknown; username: unknown }>(
    'SELECT subject,username,"userId" FROM external_account WHERE issuer=$1 AND "userId"=ANY($2::varchar[])',
    [accountCenter(ctx.config), ids])
  const requested = new Set(ids)
  for (const row of rows) {
    if (!requested.has(row.userId) || !validSubject(row.subject)) continue
    identities.set(row.userId, { accountId: row.subject, username: validUsername(row.username) ? row.username : '' })
  }
  return identities
}
