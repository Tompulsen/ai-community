import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { buildCreationPayload, validateCreationInput } from './creation-contract.ts'
import { imageOptionsSchema, videoOptionsSchema, chatOptionsSchema } from '../shared/studio/options.ts'
import { readGenerationStream } from './creation/stream.ts'
import { handleStudioTools } from './studio-tools.ts'
import { videoCapabilities } from '../shared/studio/video-capabilities.ts'
const image = { kind: 'image', model: 'gpt-image-2', prompt: 'water', aspect_ratio: '16:9' }
const options = imageOptionsSchema.parse({ resolution: '2k', quality: 'high', imageBackground: 'transparent', imageOutputFormat: 'jpeg' })
const video = { kind: 'video', model: 'sora-2', prompt: 'water', duration: 8, aspect_ratio: '16:9', size: '1280x720' }
const png = 'data:image/png;base64,aGVsbG8='
function fragmented(value) {
  const bytes = new TextEncoder().encode(value)
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
test('image presets and output options use the existing exact sizes and transparent JPEG conversion', () => {
  const payload = JSON.parse(buildCreationPayload(validateCreationInput({ ...image, imageOptions: options })).body)
  assert.equal(payload.size, '2560x1440')
  assert.equal(payload.output_format, 'png')
  assert.equal(payload.background, 'transparent')
  assert.equal(payload.quality, 'high')
  assert(!('output_compression' in payload))
  assert.throws(() => validateCreationInput({ ...image, protocol: 'async', imageOptions: { ...options, imageStream: true } }), /同步/)
})
test('video capability rules validate final custom overrides, preserving the old first-last roles', () => {
  assert.deepEqual(videoCapabilities('sora-2').durations, [4, 8, 12])
  assert.deepEqual(videoCapabilities('veo-3.1', 'reference-to-video').durations, [8])
  assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, duration: 7, videoOptions: { mode: 'text-to-video' } })), /4 \/ 8 \/ 12/)
  assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, model: 'unknown-video', videoOptions: { mode: 'text-to-video' } })), /尚未配置/)
  const sent = JSON.parse(buildCreationPayload(validateCreationInput({ ...video, model: 'doubao-seedance-2-0', referenceUrls: [png, png], videoOptions: { mode: 'first-last-frame', generateAudio: true } })).body)
  assert.deepEqual(sent.metadata.content.map(part => part.role), ['first_frame', 'last_frame'])
  assert.equal(sent.metadata.generate_audio, true)
  assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, videoOptions: { mode: 'text-to-video', customParameters: '{"seconds":30}' } })), /时长/)
  assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, videoOptions: { mode: 'text-to-video', customParameters: '{"model":"another"}' } })), /受保护/)
  assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, videoOptions: { mode: 'text-to-video', customParameters: '{"images":["http://127.0.0.1/private"]}' } })), /远程素材/)
})
test('chat formats retain real multi-turn history, attachment bytes and advanced parameters', () => {
  const messages = [{ role: 'user', content: 'previous' }, { role: 'assistant', content: 'answer' }, { role: 'user', content: [{ type: 'file', file: { filename: 'report.pdf', file_data: 'data:application/pdf;base64,aGVsbG8=' } }] }]
  for (const format of ['chat-completions', 'responses', 'gemini', 'claude']) {
    const config = chatOptionsSchema.parse({ messages, format, temperature: 0.3, max_tokens: 2345, reasoningEffort: 'high' })
    const payload = buildCreationPayload(validateCreationInput({ kind: 'text', model: 'test-model', prompt: 'read report', chatOptions: config }))
    const body = JSON.parse(payload.body)
    assert(payload.body.includes('aGVsbG8='))
    assert(payload.body.includes('previous'))
    assert(payload.body.includes('2345'))
    assert(!payload.body.includes('apiKey'))
    if (format === 'responses') assert.equal(body.max_output_tokens, 2345)
    if (format === 'chat-completions') assert.equal(body.reasoning_effort, 'high')
  }
  assert.throws(() => validateCreationInput({ kind: 'text', model: 'test', prompt: 'read', chatOptions: { messages: [{ role: 'user', content: [{ type: 'file', file: { filename: 'private', file_data: 'http://localhost/private' } }] }] } }), /本地文件/)
})
test('legacy reasoning model payload compatibility and completed stream tails are preserved', async () => {
  for (const model of ['o3', 'gpt-5']) {
    const input = validateCreationInput({ kind: 'text', model, prompt: 'hello', chatOptions: { messages: [{ role: 'user', content: 'hello' }], max_tokens: 1234 } })
    const body = JSON.parse(buildCreationPayload(input).body)
    assert.equal(body.max_completion_tokens, 1234)
    assert.equal(body.temperature, 1)
    assert(!('max_tokens' in body))
  }
  const input = validateCreationInput({ kind: 'text', model: 'chat', prompt: 'hello', chatOptions: { messages: [{ role: 'user', content: 'hello' }] } })
  const result = await readGenerationStream(fragmented('data: {"choices":[{"delta":{"content":"<thi"},"finish_reason":"stop"}]}\n\n'), input, () => {})
  assert.equal(result.outputs[0].text, '<thi')
})
test('streaming images distinguish previews from final output and preserve original MIME', async () => {
  const events = []
  const stream = fragmented('event: image_generation.partial_image\r\ndata: {"partial_image_b64":"aGVsbG8="}\r\n\r\nevent: image_generation.completed\r\ndata: {"b64_json":"aGVsbG8=","output_format":"webp"}')
  const result = await readGenerationStream(stream, { ...image, imageOptions: options }, event => events.push(event))
  assert.equal(events[0].type, 'preview')
  assert.equal(result.outputs[0].url, 'data:image/webp;base64,aGVsbG8=')
  await assert.rejects(readGenerationStream(fragmented('data: {"type":"image_generation.partial_image","partial_image_b64":"aGVsbG8="}\n\n'), image, () => {}), /未收到最终图片/)
})
test('fragmented text streams retain reasoning and usage, while truncated paid streams stay uncertain', async () => {
  const input = { kind: 'text', model: 'test', prompt: 'hello', chatOptions: chatOptionsSchema.parse({ messages: [{ role: 'user', content: 'hello' }] }) }
  const stream = 'data: {"choices":[{"delta":{"reasoning_content":"想一想","content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":3}}\n\ndata: [DONE]\n\n'
  const result = await readGenerationStream(fragmented(stream), input, () => {})
  assert.equal(result.outputs[0].text, '你好世界')
  assert.equal(result.reasoning, '想一想')
  assert.equal(result.usage.inputTokens, 8)
  await assert.rejects(readGenerationStream(fragmented('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'), input, () => {}), /中断/)
})
test('search uses per-account request IDs without replay, and MCP remains closed to regular users', async t => {
  const values = new Map(), calls = []
  const app = Fastify()
  t.after(() => app.close())
  app.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || error.status || 500).send({ error: error.message }))
  app.all('/api/creation/*', async (request, reply) => {
    const accountId = String(request.headers['x-account'] || '17')
    const ctx = { request, reply, req: request.raw, res: reply.raw, body: request.body || {}, config: { url: 'https://community.example' }, url: new URL(request.url, 'https://community.example'),
      user: { id: accountId, accountId, isAdmin: false }, requireUser() { return this.user },
      redis: { async eval() { return 1 }, async get(key) { return values.get(key) || null }, async set(key, value, ...flags) { if (flags.includes('NX') && values.has(key)) return null; values.set(key, value); return 'OK' } },
      json(status, value) { reply.code(status).send(value) } }
    await handleStudioTools(ctx, { retrieve: async (_kind, query, _signal, req) => { calls.push(req.headers.get('x-new-api-user')); return { sources: [{ title: 'Reference', url: 'https://example.org', snippet: query }] } } })
    return reply
  })
  const search = (account, query = 'models') => app.inject({ method: 'POST', url: '/api/creation/search', headers: { 'x-account': account }, payload: { requestId: 'search-1', query, mode: 'quick' } })
  assert.equal((await search('17')).statusCode, 200)
  assert.equal((await search('17')).statusCode, 200)
  assert.equal((await search('17', 'different')).statusCode, 409)
  assert.equal((await search('18')).statusCode, 200)
  assert.deepEqual(calls, ['17', '18'])
  assert.equal((await app.inject({ method: 'POST', url: '/api/creation/mcp/call', payload: {} })).statusCode, 403)
  assert.equal((await app.inject('/api/creation/mcp/status')).json().enabled, false)
})
