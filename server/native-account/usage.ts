import { accountRequest } from './client.ts'
import { NewApiError } from './config.ts'
import type { AccountRequest } from './http.ts'
import type { UsageLog, UsageRecords, UsageTotals } from '../../shared/studio/usage.ts'

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new NewApiError('消费数据格式异常，请稍后重试。', 502)
  return value
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new NewApiError('消费数据格式异常，请稍后重试。', 502)
  return value
}
const empty = (): UsageTotals => ({ consumeQuota: 0, refundQuota: 0, netQuota: 0, consumeRecords: 0, refundRecords: 0, promptTokens: 0, completionTokens: 0 })

export async function readUsage(req: AccountRequest): Promise<UsageRecords> {
  const params = req.nextUrl.searchParams
  for (const key of params.keys()) {
    if (!['page', 'size', 'start', 'end', 'model'].includes(key) || params.getAll(key).length !== 1) throw new NewApiError('消费筛选参数无效。', 400)
  }
  const now = Math.floor(Date.now() / 1000)
  function queryInteger(key: string, fallback: number, min: number, max: number) {
    const raw = params.get(key)
    const number = raw === null ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new NewApiError('消费筛选参数无效。', 400)
    return number
  }
  const page = queryInteger('page', 1, 1, 1000000), size = queryInteger('size', 20, 1, 100)
  const end = queryInteger('end', now, 1, now + 60), start = queryInteger('start', end - 7 * 86400, 1, end)
  if (end - start > 30 * 86400) throw new NewApiError('每次最多查询 30 天的消费记录。', 400)
  const query = new URLSearchParams({ p: String(page), page_size: String(size), start_timestamp: String(start), end_timestamp: String(end) })
  const selected = params.get('model')
  if (selected !== null) {
    if (Buffer.byteLength(selected, 'utf8') > 512 || /[\u0000-\u001f\u007f]/.test(selected)) throw new NewApiError('模型名称无效。', 400)
    query.set('model_name', selected)
  }
  const { data } = await accountRequest(req, `/api/log/self/usage?${query}`, { requireSuccess: true, maxResponseBytes: 2 * 1024 * 1024 })
  if (!data || !Array.isArray(data.items) || data.items.length > size || !Array.isArray(data.models) || data.models.length > 5000) throw new NewApiError('消费统计暂不可用，请稍后重试。', 502)
  const seen = new Set<string>()
  const models = data.models.map((item: any) => {
    const model = text(item?.model_name)
    if (seen.has(model)) throw new NewApiError('消费数据格式异常，请稍后重试。', 502)
    seen.add(model)
    const totals = {
      consumeQuota: integer(item.consume_quota, -Number.MAX_SAFE_INTEGER), refundQuota: integer(item.refund_quota),
      netQuota: 0, consumeRecords: integer(item.consume_records), refundRecords: integer(item.refund_records),
      promptTokens: integer(item.prompt_tokens), completionTokens: integer(item.completion_tokens),
    }
    totals.netQuota = integer(totals.consumeQuota - totals.refundQuota, -Number.MAX_SAFE_INTEGER)
    return { model, totals }
  }) as UsageRecords['models']
  const summary = empty()
  for (const item of models) {
    if (selected !== null && item.model !== selected) continue
    for (const key of Object.keys(summary) as (keyof UsageTotals)[]) summary[key] = integer(summary[key] + item.totals[key], -Number.MAX_SAFE_INTEGER)
  }
  const items = data.items.map((item: any): UsageLog => {
    if (!item || ![2, 6].includes(item.type) || (selected !== null && item.model_name !== selected)) throw new NewApiError('消费数据格式异常，请稍后重试。', 502)
    return { id: integer(item.id), created_at: integer(item.created_at, start, end), model_name: text(item.model_name),
      token_name: text(item.token_name), prompt_tokens: integer(item.prompt_tokens), completion_tokens: integer(item.completion_tokens),
      quota: integer(item.quota, -Number.MAX_SAFE_INTEGER), type: item.type }
  })
  return { items, models, summary, total: integer(summary.consumeRecords + summary.refundRecords), page, size, start, end }
}
