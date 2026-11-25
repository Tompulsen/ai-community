import { describe, expect, it } from 'vitest'
import { insufficientCreditsCode, insufficientCreditsMessage, isInsufficientCredits } from '../shared/studio/insufficient-credits'

describe('community credit failures', () => {
  it.each([
    { error: { code: 'insufficient_user_quota', message: '用户额度不足, 剩余额度: 0' } },
    { error: { type: 'insufficient_user_quota' } },
    { data: { error: { code: 'insufficient_user_quota' } } },
    { errorCode: insufficientCreditsCode, error: insufficientCreditsMessage },
    new Error(insufficientCreditsMessage),
    { type: 'response.failed', response: { error: { code: 'insufficient_user_quota', message: '额度已用尽' } } },
    '网关提交失败（HTTP 403）：用户额度不足, 剩余额度: $0.00',
    '预扣费额度失败, 用户剩余额度: 1, 需要预扣费额度: 20',
    'Insufficient user quota, remaining quota: 1',
    'Not enough quota to pre-consume for this request: 1 remaining, 20 required',
  ])('recognizes only confirmed wallet failures: %j', value => expect(isInsufficientCredits(value)).toBe(true))

  it.each([
    { errorStatus: 403, error: '无权使用此模型' },
    { error: { code: 'insufficient_user_quota', message: '订阅额度不足或未配置订阅' } },
    { error: { code: 'insufficient_user_quota', message: 'Subscription quota is insufficient or no subscription is configured' } },
    { error: { code: 'insufficient_quota', message: 'Upstream quota exceeded' } },
    { error: { code: 'pre_consume_token_quota_failed', message: '用户额度不足, 剩余额度: 0' } },
    { errorCode: 'GENERATION_ERROR', error: '网关提交失败（HTTP 403）：用户额度不足, 剩余额度: 0' },
    '令牌额度不足', '渠道额度不足', 'too many requests', '连接失败',
    '模型回答：用户额度不足', '生成服务未能完成本次技能调用，请核对任务与使用记录。',
  ])('does not mislabel another failure: %j', value => expect(isInsufficientCredits(value)).toBe(false))
})
