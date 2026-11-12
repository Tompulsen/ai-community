/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { AccountSessionBinding, AppConfig } from './types.ts'

const COOKIE = 'octopus_new_api_session'
const OPAQUE = /^[A-Za-z0-9_-]{43}$/
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex')

export interface StudioAccount {
  binding: AccountSessionBinding
  username: string
  name: string
}

function failure(statusCode: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { statusCode, code })
}

export function accountSessionCookie(req: Pick<IncomingMessage, 'headers'>): string | null {
  const matches = String(req.headers.cookie ?? '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(`${COOKIE}=`))
  if (matches.length !== 1 || !OPAQUE.test(matches[0]!.slice(COOKIE.length + 1))) return null
  return matches[0]!
}

export function accountSessionHash(req: Pick<IncomingMessage, 'headers'>): string | null {
  const cookie = accountSessionCookie(req)
  return cookie ? fingerprint(cookie.slice(COOKIE.length + 1)) : null
}

export function accountCenter(config: AppConfig): string {
  const url = new URL(config.newApiSso?.issuer || 'https://zhangyuapi.com')
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return failure(503, 'SSO_UNAVAILABLE', '章鱼账号暂时不可用。')
  }
  return url.origin
}

export async function readStudioAccount(config: AppConfig, req: Pick<IncomingMessage, 'headers'>, fetcher: typeof fetch = fetch): Promise<StudioAccount> {
  const cookie = accountSessionCookie(req)
  if (!cookie) return failure(401, 'NEW_API_LOGIN_REQUIRED', '请先登录章鱼账号。')
  const destination = new URL(config.communityStudioUpstream || process.env.COMMUNITY_STUDIO_UPSTREAM || 'http://studio:3000')
  const origin = new URL(config.url)
  if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password
    || destination.pathname !== '/' || destination.search || destination.hash) return failure(503, 'STUDIO_UNAVAILABLE', '章鱼账号连接配置无效。')
  let response: Response
  try {
    response = await fetcher(new URL('/studio/api/new-api/session', destination), {
      headers: { Cookie: cookie, Accept: 'application/json', Host: origin.host, Origin: origin.origin,
        'x-forwarded-host': origin.host, 'x-forwarded-proto': origin.protocol.slice(0, -1) },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
    })
  } catch { return failure(502, 'STUDIO_UNAVAILABLE', '无法确认章鱼账号，请稍后重试。') }
  if (response.status === 401 || response.status === 403) return failure(401, 'NEW_API_LOGIN_REQUIRED', '章鱼账号登录已失效，请重新登录。')
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/json')) {
    return failure(502, 'STUDIO_UNAVAILABLE', '无法确认章鱼账号，请稍后重试。')
  }
  let envelope: { success?: unknown; data?: { authenticated?: unknown; user?: { id?: unknown; username?: unknown; display_name?: unknown } } }
  try {
    const chunks: Uint8Array[] = []
    let length = 0
    for await (const chunk of response.body) {
      length += chunk.length
      if (length > 65536) throw new Error('Oversized account response')
      chunks.push(chunk)
    }
    envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch { return failure(502, 'STUDIO_UNAVAILABLE', '章鱼账号返回了无效的登录信息。') }
  const user = envelope?.data?.user
  if (envelope?.success !== true || envelope.data?.authenticated !== true) {
    return failure(401, 'NEW_API_LOGIN_REQUIRED', '请先登录章鱼账号。')
  }
  if (!user || typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0
    || typeof user.username !== 'string' || !user.username || user.username.length > 128
    || /[\u0000-\u001f\u007f]/.test(user.username)
    || (user.display_name !== undefined && typeof user.display_name !== 'string')) {
    return failure(502, 'SSO_IDENTITY', '章鱼账号返回了无效的用户信息。')
  }
  return {
    binding: { issuer: accountCenter(config), subject: String(user.id), sessionHash: accountSessionHash(req)! },
    username: user.username, name: (typeof user.display_name === 'string' ? user.display_name : user.username).slice(0, 128),
  }
}

export function studioAccountVerifier(config: AppConfig) {
  const cache = new Map<string, { until: number; account: StudioAccount }>()
  return async (req: Pick<IncomingMessage, 'headers'>, fresh = false) => {
    const key = accountSessionHash(req)
    if (!key) return readStudioAccount(config, req)
    const previous = cache.get(key)
    if (!fresh && previous && previous.until > Date.now()) return previous.account
    try {
      const account = await readStudioAccount(config, req)
      if (cache.size >= 512) for (const [id, item] of cache) if (item.until <= Date.now()) cache.delete(id)
      if (cache.size >= 512) cache.delete(cache.keys().next().value!)
      cache.set(key, { until: Date.now() + 5000, account })
      return account
    } catch (error) {
      cache.delete(key)
      throw error
    }
  }
}
