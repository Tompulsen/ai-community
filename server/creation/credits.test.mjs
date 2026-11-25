import assert from 'node:assert/strict'
import test from 'node:test'
import { readGenerationStream } from './stream.ts'
import { isInsufficientCredits } from '../../shared/studio/insufficient-credits.ts'
import { normalizeNativeChat } from '../creation-contract.ts'

test('native JSON errors preserve explicit non-wallet classification', () => {
  for (const format of ['chat-completions', 'responses', 'messages', 'gemini']) {
    const result = normalizeNativeChat(format, { error: { code: 'pre_consume_token_quota_failed', message: '用户额度不足, 剩余额度: 0' } })
    assert.equal(result.status, 'failed')
    assert.equal(isInsufficientCredits(result), false)
  }
})

for (const kind of ['text', 'image']) for (const insufficient of [true, false]) {
  test(`${kind} streams retain ${insufficient ? 'wallet' : 'non-wallet'} classification`, async () => {
    const error = insufficient ? { code: 'insufficient_user_quota', message: '额度已用尽' }
      : { code: 'pre_consume_token_quota_failed', message: '用户额度不足, 剩余额度: 0' }
    const event = { type: 'response.failed', response: { error } }
    const response = new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    await assert.rejects(readGenerationStream(response, { kind, model: 'gpt-5', prompt: 'test', chatOptions: { format: 'responses' } }, () => {}), cause => {
      assert.equal(isInsufficientCredits(cause), insufficient)
      if (kind === 'text') { assert.equal(cause.partial.status, 'indeterminate'); assert.deepEqual(cause.partial.outputs, []) }
      return true
    })
  })
}
