import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { AccountRequest } from './http.ts'
import { accountRequest, getAuthenticatedSession } from './client.ts'
import { getNewApiConfig, getNewApiImageBaseUrl, getNewApiAsyncBaseUrl, NewApiError } from './config.ts'
import { parseCommunityWallet, type CommunityWallet } from '../../shared/studio/community-wallet.ts'

export function communityWalletEnabled() {
  return process.env.COMMUNITY_WALLET_ENABLED === 'true'
}

export function communityQuotaPerPoint(): number | undefined {
  if (!communityWalletEnabled()) return undefined
  const quotaPerCny = Number(process.env.COMMUNITY_WALLET_QUOTA_PER_CNY)
  if (!Number.isSafeInteger(quotaPerCny) || quotaPerCny <= 0) {
    throw new NewApiError('积分兑换比例暂不可用，请稍后再试', 503, 'COMMUNITY_WALLET_CONFIG')
  }
  return quotaPerCny / 5000
}

export async function readCommunityWallet(req: AccountRequest): Promise<{ userId: number; points: CommunityWallet }> {
  if (!communityWalletEnabled()) throw new NewApiError('积分钱包尚未启用', 404, 'COMMUNITY_WALLET_DISABLED')
  const { session } = await getAuthenticatedSession(req, true)
  if (!session.user) throw new NewApiError('请先登录账号', 401)
  const { data } = await accountRequest(req, '/api/user/self/wallet', { reuseRequestSession: true, maxResponseBytes: 16384 })
  try {
    const points = parseCommunityWallet({
      enabled: data?.enabled, currency: data?.currency, pointsPerCny: data?.points_per_cny,
      charityPoints: data?.charity_points, permanentPoints: data?.permanent_points,
      legacyApiQuota: data?.legacy_api_quota, paidApiQuota: data?.paid_api_quota,
      totalApiQuota: data?.total_api_quota, charityExpiringAt: data?.charity_expiring_at,
    })
    return { userId: session.user.id, points }
  } catch {
    throw new NewApiError('积分余额暂不可用，请稍后刷新', 503, 'COMMUNITY_WALLET_UNAVAILABLE')
  }
}

/** Freeze the body once, so multipart boundaries and the signed bytes match. */
export async function signCommunityRequest(url: URL, userId: number, headers: Headers, body: string | FormData) {
  const signedHeaders = new Headers(headers)
  for (const key of [...signedHeaders.keys()]) {
    if (key.toLowerCase().startsWith('x-community-')) signedHeaders.delete(key)
  }
  if (!communityWalletEnabled()) return { headers: signedHeaders, body }
  const secret = process.env.COMMUNITY_WALLET_SECRET || ''
  const client = process.env.COMMUNITY_WALLET_CLIENT_ID || ''
  const idempotency = signedHeaders.get('Idempotency-Key') || ''
  if (secret.length < 32 || secret.length > 4096 || !client || client.length > 255 || /[\r\n]/.test(client)
    || !Number.isSafeInteger(userId) || userId <= 0 || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotency)) {
    throw new NewApiError('积分支付服务配置不完整，请稍后再试', 503, 'COMMUNITY_WALLET_CONFIG')
  }
  const origins = [getNewApiConfig().baseUrl, getNewApiImageBaseUrl(), getNewApiAsyncBaseUrl()]
  if (!origins.includes(url.origin) || url.username || url.password || url.hash) {
    throw new NewApiError('积分支付地址无效，请稍后再试', 503, 'COMMUNITY_WALLET_CONFIG')
  }
  const frozen = new Request(url, { method: 'POST', headers: signedHeaders, body })
  const bytes = await frozen.arrayBuffer()
  const wireHeaders = new Headers(frozen.headers)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomBytes(16).toString('hex')
  const digest = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
  const canonical = ['community-wallet-v1', client, String(userId), timestamp, nonce, 'POST', url.pathname + url.search, idempotency, digest].join('\n')
  wireHeaders.set('X-Community-Client', client)
  wireHeaders.set('X-Community-User', String(userId))
  wireHeaders.set('X-Community-Timestamp', timestamp)
  wireHeaders.set('X-Community-Nonce', nonce)
  wireHeaders.set('X-Community-Signature', createHmac('sha256', secret).update(canonical).digest('hex'))
  return { headers: wireHeaders, body: bytes }
}
