import { session } from './state'
export async function studioAccount<T>(route: string, method = 'GET', body?: unknown): Promise<T> {
  if (!/^(?:status|session|model-pricing|wallet(?:\/(?:quote|pay|subscription|redeem))?|logs(?:\?[\w=&-]+)?|tokens(?:\/[1-9]\d*(?:\/select)?)?(?:\?[\w=&-]+)?|groups|auto-groups)$/.test(route)) throw new Error('账号接口无效。')
  const owner = session.user?.id, account = session.user?.accountId || owner
  if (!account) throw new Error('请先登录。')
  const response = await fetch(`/api/new-api/${route}`, { method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'X-New-Api-User': account, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000) })
  const data = await response.json()
  if (session.user?.id !== owner) throw new Error('账号已切换，请重新操作。')
  if (!response.ok || data.success !== true) throw new Error(data.message || '账号服务暂时不可用。')
  return data.data as T
}
