export interface UsageTotals {
  consumeQuota: number
  refundQuota: number
  netQuota: number
  consumeRecords: number
  refundRecords: number
  promptTokens: number
  completionTokens: number
}
export interface UsageLog {
  id: number
  created_at: number
  model_name: string
  token_name: string
  prompt_tokens: number
  completion_tokens: number
  quota: number
  type: 2 | 6
}
export interface UsageRecords {
  items: UsageLog[]
  models: { model: string; totals: UsageTotals }[]
  summary: UsageTotals
  total: number
  page: number
  size: number
  start: number
  end: number
}
