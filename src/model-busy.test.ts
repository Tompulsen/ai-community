import { expect, it } from 'vitest'
import { isModelBusy } from '../shared/studio/model-busy'

it.each([
  { error: { code: 'gateway_queue_full', message: 'Too many pending requests, please retry later' } },
  { response: { error: { code: 'rate_limit_exceeded' } } },
  { errorCode: 'MODEL_BUSY' },
  { errorStatus: 429, error: 'Too many requests' },
  '网关提交失败（HTTP 429）：Too many pending requests, please retry later',
])('recognizes model throttling without relying on outer HTTP 200: %j', error => expect(isModelBusy(error)).toBe(true))

it.each([
  { error: { code: 'insufficient_user_quota', message: '用户额度不足' } },
  { error: { code: 'insufficient_quota', message: 'Upstream quota exceeded' } },
  { error: '订阅额度不足' },
  { error: { code: 'permission_denied', message: 'Too many requests' } },
  { errorCode: 'GENERATION_ERROR', errorStatus: 429, error: '网关提交失败（HTTP 429）：视频生成队列已满，本次请求未提交至模型，请稍后重试。' },
])('preserves wallet, quota and permission failures even under HTTP 429: %j', error => expect(isModelBusy(error, 429)).toBe(false))

it('does not infer queue rejection from an interrupted stream', () => {
  expect(isModelBusy({ errorStatus: 200, error: '流式回答中断' })).toBe(false)
})

it('recognizes the observed legacy queue message even with a generic classification', () => {
  expect(isModelBusy({ errorCode: 'GENERATION_ERROR', errorStatus: 429, error: '网关提交失败（HTTP 429）：Too many pending requests, please retry later' })).toBe(true)
})
