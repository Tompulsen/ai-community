import assert from 'node:assert/strict'
import test from 'node:test'
import { Writable } from 'node:stream'
import { setImmediate as turn } from 'node:timers/promises'
import { readGenerationStream, GenerationStreamError } from './creation/stream.ts'
import { createTextLifecycle } from './creation/text-lifecycle.ts'
import { createEventWriter } from './creation/event-writer.ts'
import { textGenerationTimeouts } from '../shared/studio/creation-limits.ts'

const input = { kind: 'text', model: 'test', prompt: 'hello', chatOptions: { stream: true, format: 'chat-completions' } }
const frame = value => new TextEncoder().encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)
const content = text => ({ choices: [{ delta: { content: text } }] })

for (const format of ['chat-completions', 'responses', 'claude']) {
  test(`${format} preserves a queue rejection inside HTTP 200 SSE`, async () => {
    const error = { code: 'gateway_queue_full', message: 'Too many pending requests, please retry later' }
    const body = Buffer.concat([Buffer.from(': heartbeat\n\n'), frame(format === 'responses' ? { response: { error } } : { error }), frame('[DONE]')])
    await assert.rejects(readGenerationStream(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
      { ...input, chatOptions: { ...input.chatOptions, format } }, () => {}), error => {
      assert(error instanceof GenerationStreamError)
      assert.equal(error.partial.errorCode, 'MODEL_BUSY')
      assert.equal(error.partial.errorStatus, 429)
      assert.equal(error.partial.status, 'failed')
      assert.match(error.message, /模型服务繁忙/)
      assert.doesNotMatch(error.message, /已保留已生成内容/)
      return true
    })
  })
}

test('queue errors after partial text preserve uncertainty and usage', async () => {
  const body = Buffer.concat([frame({ ...content('{"schemaVersion":'), usage: { completion_tokens: 7 } }),
    frame({ error: { code: 'gateway_queue_full', message: 'Too many pending requests, please retry later' } })])
  await assert.rejects(readGenerationStream(new Response(body), input, () => {}), error => {
    assert.equal(error.partial.status, 'indeterminate')
    assert.equal(error.partial.outputs[0].text, '{"schemaVersion":')
    assert.equal(error.partial.usage.outputTokens, 7)
    assert.equal(error.partial.errorCode, 'MODEL_BUSY')
    return true
  })
})

test('an empty interrupted stream does not claim saved content or a queue rejection', async () => {
  await assert.rejects(readGenerationStream(new Response(': heartbeat\n\n'), input, () => {}), error => {
    assert.equal(error.partial.status, 'indeterminate')
    assert.equal(error.partial.errorCode, 'GENERATION_ERROR')
    assert.doesNotMatch(error.message, /已保留已生成内容/)
    assert.match(error.message, /未收到完整回答/)
    return true
  })
})

test('queue rejection after tool progress stays uncertain and never exposes an unfinished tool call', async () => {
  const body = Buffer.concat([frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'build', arguments: '{' } }] } }] }),
    frame({ error: { code: 'gateway_queue_full' } })])
  await assert.rejects(readGenerationStream(new Response(body), input, () => {}), error => {
    assert.equal(error.partial.status, 'indeterminate')
    assert.equal(error.partial.errorCode, 'MODEL_BUSY')
    assert.equal(error.partial.toolCalls, undefined)
    assert.deepEqual(error.partial.outputs, [])
    return true
  })
})

for (const [format, delta] of [
  ['responses', { type: 'response.function_call_arguments.delta', delta: '{' }],
  ['claude', { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } }],
]) test(`${format} keeps earlier tool-only progress uncertain after an idle event and queue failure`, async () => {
  const body = Buffer.concat([frame(delta), frame({ type: 'ping' }), frame({ error: { code: 'gateway_queue_full' } })])
  await assert.rejects(readGenerationStream(new Response(body), { ...input, chatOptions: { ...input.chatOptions, format } }, () => {}), error => {
    assert.equal(error.partial.status, 'indeterminate')
    assert.equal(error.partial.errorCode, 'MODEL_BUSY')
    assert.equal(error.partial.toolCalls, undefined)
    return true
  })
})

function live(t, request = input) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const lifecycle = createTextLifecycle()
  let stream, cancelled = false
  const response = new Response(new ReadableStream({ start(controller) { stream = controller }, cancel() { cancelled = true } }))
  lifecycle.receivedResponse()
  const result = readGenerationStream(response, request, () => {}, { signal: lifecycle.signal, progress: lifecycle.progress })
    .then(value => ({ value }), error => ({ error }))
  t.after(lifecycle.dispose)
  return { lifecycle, result, cancelled: () => cancelled,
    async send(value, elapsed = 60_000) {
      t.mock.timers.tick(elapsed)
      if (!cancelled) stream.enqueue(frame(value))
      await turn()
    },
    async finish() { stream.enqueue(frame('[DONE]')); stream.close(); return result },
  }
}

test('first response has its own deadline and disposed generation timers cannot fire later', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const first = createTextLifecycle()
  t.mock.timers.tick(textGenerationTimeouts.response)
  assert.equal(first.signal.aborted, true)
  assert.match(first.signal.reason.message, /首次响应/)
  const completed = createTextLifecycle()
  completed.receivedResponse(); completed.progress(); completed.dispose()
  t.mock.timers.tick(textGenerationTimeouts.total * 2)
  assert.equal(completed.signal.aborted, false)
})

test('continuous text, reasoning and tool arguments stay alive beyond the old three-minute cutoff', async t => {
  const f = live(t)
  await f.send(content('你好🌊'))
  await f.send({ choices: [{ delta: { reasoning_content: '思考' } }] })
  await f.send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'lookup', arguments: '{' } }] } }] })
  await f.send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"query":"test"}' } }] } }] })
  assert.equal(f.lifecycle.signal.aborted, false)
  const { value } = await f.finish()
  assert.equal(value.status, 'succeeded')
  assert.equal(value.outputs[0].text, '你好🌊')
  assert.equal(value.reasoning, '思考')
  assert.equal(value.toolCalls[0].function.arguments, '{"query":"test"}')
})

test('heartbeat-only upstream traffic expires and partial text, reasoning and usage survive without tool execution', async t => {
  const f = live(t)
  await f.send({ choices: [{ delta: { content: '已生成', reasoning_content: '已有推理',
    tool_calls: [{ index: 0, id: 'unfinished', function: { name: 'unsafe', arguments: '{' } }] } }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }, 0)
  for (let index = 0; index < 6; index++) await f.send({ choices: [] }, 50_000)
  const { error } = await f.result
  assert(error instanceof GenerationStreamError)
  assert.match(f.lifecycle.signal.reason.message, /长时间未返回/)
  assert.equal(f.cancelled(), true)
  assert.equal(error.partial.status, 'indeterminate')
  assert.equal(error.partial.outputs[0].text, '已生成')
  assert.equal(error.partial.reasoning, '已有推理')
  assert.deepEqual(error.partial.usage, { inputTokens: 3, outputTokens: 2 })
  assert.equal(error.partial.toolCalls, undefined)
})

test('continuous progress still respects the thirty-minute total deadline and retains its partial answer', async t => {
  const f = live(t)
  for (let index = 0; index < 30; index++) await f.send(content('a'))
  const { error } = await f.result
  assert.match(f.lifecycle.signal.reason.message, /最长生成时间/)
  assert.equal(error.partial.outputs[0].text, 'a'.repeat(29))
  assert.equal(error.partial.status, 'indeterminate')
})

for (const [format, token] of [
  ['responses', { type: 'response.reasoning_summary_text.delta', delta: '思考' }],
  ['claude', { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '思考' } }],
  ['gemini', { candidates: [{ content: { parts: [{ thought: true, text: '思考' }] } }] }],
]) test(`${format} thinking-only streams renew the idle deadline`, async t => {
  const f = live(t, { ...input, chatOptions: { ...input.chatOptions, format } })
  for (let index = 0; index < 6; index++) await f.send(token, 240_000)
  assert.equal(f.lifecycle.signal.aborted, false)
  const { value } = await f.finish()
  assert.equal(value.reasoning, '思考'.repeat(6))
})

test('10,000 fragmented Unicode events use linear append traffic and retain final usage; old clients receive snapshots', async () => {
  const text = '字🌊'.repeat(10_000)
  for (const append of [true, false]) {
    const wire = []
    const output = new Writable({ write(chunk, _encoding, done) { wire.push(chunk.toString()); done() } })
    const writer = createEventWriter(output, append)
    const bytes = Buffer.concat([...Array.from({ length: 10_000 }, () => frame(content('字🌊'))),
      frame({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 10_000, total_tokens: 10_010 } }), frame('[DONE]')])
    let offset = 0
    const response = new Response(new ReadableStream({ pull(controller) {
      if (offset === bytes.length) { controller.close(); return }
      controller.enqueue(bytes.subarray(offset, offset += Math.min(193, bytes.length - offset)))
    } }))
    const result = await readGenerationStream(response, input, writer.emit)
    writer.emit({ type: 'result', ...result }); writer.end()
    const events = wire.join('').split('\n\n').filter(value => value.startsWith('data: ')).map(value => JSON.parse(value.slice(6)))
    const deltas = events.filter(event => event.type === 'delta')
    assert.equal(append ? deltas.map(event => event.text).join('') : deltas.at(-1).text, text)
    assert.equal(result.outputs[0].text, text)
    assert.deepEqual(events.at(-1).usage, { inputTokens: 10, outputTokens: 10_000 })
    assert.equal(deltas.every(event => event.append === true), append)
    assert(Buffer.byteLength(wire.join('')) < Buffer.byteLength(text) * 4)
  }
})

test('backpressure preserves queued order through end and clears the drain listeners', async () => {
  const frames = [], writes = []
  const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) { frames.push(chunk.toString()); writes.push(done) } })
  const writer = createEventWriter(output, true)
  writer.emit({ type: 'delta', text: 'first', reasoning: '' })
  writer.emit({ type: 'delta', text: 'first second', reasoning: '' })
  writer.emit({ type: 'result', status: 'succeeded' }); writer.end()
  while (writes.length) { writes.shift()(); await turn() }
  assert.equal(frames.length, 3)
  assert.match(frames[1], /"text":" second"/)
  assert.match(frames[2], /"type":"result"/)
  assert.equal(output.writableFinished, true)
  assert.equal(output.listenerCount('drain'), 0)
})

test('stalled browsers have bounded buffering and detach without blocking generation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const output = new Writable({ highWaterMark: 1, write() {} })
  const writer = createEventWriter(output, true)
  for (let index = 1; index < 100; index++) writer.emit({ type: 'delta', text: 'x'.repeat(index * 10_000) })
  assert.equal(output.destroyed, true)
  assert(output.writableLength <= 256 * 1024)
  assert.equal(output.listenerCount('drain'), 0)
  const stalled = new Writable({ highWaterMark: 1, write() {} })
  const other = createEventWriter(stalled, true)
  other.emit({ type: 'delta', text: 'small' })
  t.mock.timers.tick(15_000)
  assert.equal(stalled.destroyed, true)
  other.end(); writer.end()
})

test('final result backpressure remains bounded after end is requested', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const output = new Writable({ highWaterMark: 1, write() {} })
  const writer = createEventWriter(output, true)
  writer.emit({ type: 'result', status: 'succeeded' }); writer.end()
  assert.equal(output.writableFinished, false)
  t.mock.timers.tick(15_000)
  assert.equal(output.destroyed, true)
  assert.equal(output.listenerCount('drain'), 0)
})

test('the final SSE marker completes without waiting for EOF, preserving usage after finish_reason', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(frame({ choices: [{ delta: { content: 'finished' }, finish_reason: 'stop' }] }))
    controller.enqueue(frame({ choices: [], usage: { completion_tokens: 17 } }))
    controller.enqueue(frame('[DONE]'))
  }, cancel() { cancelled = true } }))
  const result = await readGenerationStream(response, input, () => {})
  assert.equal(result.status, 'succeeded')
  assert.equal(result.outputs[0].text, 'finished')
  assert.equal(result.usage.outputTokens, 17)
  assert.equal(cancelled, true)
})
