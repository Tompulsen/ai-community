/*
 * SPDX-FileCopyrightText: 2026 Community contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { AccountSessionBinding, AppConfig } from './types.ts'
import { NewApiError, readNativeAccount } from './native-account/index.ts'

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

export async function readAccountSession(config: AppConfig, req: Pick<IncomingMessage, 'headers'>): Promise<StudioAccount> {
  const cookie = accountSessionCookie(req)
  if (!cookie) return failure(401, 'NEW_API_LOGIN_REQUIRED', '请先登录章鱼账号。')
  const origin = new URL(config.url)
  try {
    const account = await readNativeAccount(new Request(new URL('/api/new-api/session', origin), {
      headers: { Cookie: cookie, Accept: 'application/json', Host: origin.host, Origin: origin.origin,
        'x-forwarded-host': origin.host, 'x-forwarded-proto': origin.protocol.slice(0, -1) },
    }))
    if (account.binding.issuer !== accountCenter(config))
      return failure(503, 'SSO_IDENTITY', '章鱼账号服务配置不一致。')
    return account
  } catch (error) {
    if (error instanceof NewApiError)
      return failure(error.status === 403 ? 401 : error.status, error.code, error.message)
    throw error
  }
}

export const readStudioAccount = readAccountSession

export function accountSessionVerifier(config: AppConfig) {
  const cache = new Map<string, { until: number; account: StudioAccount }>()
  return async (req: Pick<IncomingMessage, 'headers'>, fresh = false) => {
    const key = accountSessionHash(req)
    if (!key) return readAccountSession(config, req)
    const previous = cache.get(key)
    if (!fresh && previous && previous.until > Date.now()) return previous.account
    try {
      const account = await readAccountSession(config, req)
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

export const studioAccountVerifier = accountSessionVerifier
