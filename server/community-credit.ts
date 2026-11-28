import type { AppConfig } from './types.ts'

export function createCommunityCreditClient(config: Pick<AppConfig, 'url' | 'newApiSso'>, fetcher: typeof fetch = fetch) {
  function creditConfig() {
    const settings = config.newApiSso
    if (typeof settings?.lotterySecret !== 'string' || settings.lotterySecret.length < 32) return null
    try { return { issuer: validIssuer(settings.issuer), secret: settings.lotterySecret } }
    catch { return null }
  }

  async function request(issuer: string | null, body?: Record<string, unknown>, signal = AbortSignal.timeout(8000), accountSubject?: string): Promise<Record<string, unknown>> {
    const settings = creditConfig()
    if (!settings || settings.issuer !== issuer) throw Object.assign(new Error('LOTTERY_CREDIT_CONFIG'), { permanent: true })
    const url = new URL(body?.reward_kind === 'charity' ? '/api/community-sso/lottery/charity' : '/api/community-sso/lottery', settings.issuer)
    if (accountSubject !== undefined) {
      url.searchParams.set('client_id', new URL(config.url).origin)
      url.searchParams.set('user_id', accountSubject)
      url.searchParams.set('basis', 'support')
    }
    const response = await fetcher(url, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.secret}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) throw Object.assign(new Error(`LOTTERY_CREDIT_HTTP_${response.status}`), {
      permanent: response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status),
    })
    let size = 0
    const chunks: Buffer[] = []
    if (!response.body) throw new Error('LOTTERY_CREDIT_RESPONSE')
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 65536) throw Object.assign(new Error('LOTTERY_CREDIT_RESPONSE'), { permanent: true })
      chunks.push(Buffer.from(chunk))
    }
    try {
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!isRecord(result)) throw new Error('LOTTERY_CREDIT_RESPONSE')
      return result
    }
    catch { throw Object.assign(new Error('LOTTERY_CREDIT_RESPONSE'), { permanent: true }) }
  }

  return { configuration: creditConfig, request }
}

function validIssuer(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('LOTTERY_CREDIT_CONFIG')
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin.length > 255) throw new Error('LOTTERY_CREDIT_CONFIG')
  return url.origin
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
