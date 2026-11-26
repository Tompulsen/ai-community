import { isInsufficientCredits } from './insufficient-credits.ts'

export const modelBusyCode = 'MODEL_BUSY'
export const modelBusyMessage = '模型服务繁忙，请稍后重试，或手动选择其他模型。原请求不会自动重新提交。'
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'

export function isModelBusy(value: unknown, status?: number): boolean {
  if (isInsufficientCredits(value)) return false
  const root = record(value) ? value : {}
  const data = record(root.data) ? root.data : root
  const error = data.error ?? (record(data.response) ? data.response.error : undefined) ?? value
  const failure = record(error) ? error : {}
  const code = root.errorCode ?? data.errorCode ?? failure.code ?? root.code ?? failure.type
  if ([modelBusyCode, 'gateway_queue_full', 'rate_limit_exceeded', 'rate_limited', 'too_many_requests'].includes(String(code))) return true
  // Quota, permission and unrelated provider failures must keep their own diagnosis.
  if (code && !['GENERATION_ERROR', 'new_api_error', 'openai_error'].includes(String(code))) return false
  const message = typeof error === 'string' ? error : typeof failure.message === 'string' ? failure.message : ''
  if (/quota|额度|余额|积分|订阅|subscription|permission|权限/i.test(message)) return false
  return /^(?:.*?失败(?:（HTTP \d{3}）)?：)?Too many pending requests(?:,|$)/i.test(message.trim())
    || code !== 'GENERATION_ERROR' && (status === 429 || root.errorStatus === 429)
}
