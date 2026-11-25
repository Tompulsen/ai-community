export const generationErrorCode = 'GENERATION_ERROR'
export const insufficientCreditsCode = 'INSUFFICIENT_CREDITS'
export const insufficientCreditsMessage = '当前可用积分不足以再次调用该模型，请获取积分后重试。'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'

/** Only user wallet failures qualify; a 403 or an upstream account limit does not. */
export function isInsufficientCredits(value: unknown): boolean {
  const root = record(value) ? value : {}
  const data = record(root.data) ? root.data : root
  const error = data.error ?? root.error ?? (record(data.response) ? data.response.error : undefined) ?? value
  const failure = record(error) ? error : {}
  const message = typeof error === 'string' ? error : typeof failure.message === 'string' ? failure.message
    : typeof data.message === 'string' ? data.message : ''
  // New API also uses insufficient_user_quota for subscription-only failures.
  if (/订阅|subscription|令牌|token quota|渠道|channel|upstream.*quota/i.test(message)) return false
  const code = root.errorCode ?? data.errorCode ?? failure.code ?? root.code ?? failure.type
  if (code === insufficientCreditsCode || code === 'insufficient_user_quota') return true
  if (code && code !== 'new_api_error') return false
  return /^(?:(?:网关提交|网关响应处理|生成任务|上游提交|社区提交接口)失败(?:（HTTP \d{3}）)?：)?(?:当前可用积分不足以再次调用该模型|用户额度不足(?:[,，:：]|$)|预扣费额度失败[,，]\s*用户剩余额度|Insufficient user quota(?:[,，:：]|$)|Not enough quota to pre-consume for this request:)/i.test(message.trim())
}
