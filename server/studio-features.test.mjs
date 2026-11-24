import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { buildCreationPayload, resolveCreationModelSettings, validateCreationInput } from './creation-contract.ts'
import { imageOptionsSchema, videoOptionsSchema, chatOptionsSchema } from '../shared/studio/options.ts'
import { readGenerationStream } from './creation/stream.ts'
import { handleStudioTools } from './studio-tools.ts'
import { normalizeVideoParameters, videoCapabilities } from '../shared/studio/video-capabilities.ts'
import { resolveVideoModelSetting } from './video-models.ts'
import { videoModelSettingSchema } from '../shared/studio/model-types.ts'
const image = { kind: 'image', model: 'gpt-image-2', prompt: 'water', aspect_ratio: '16:9' }
const options = imageOptionsSchema.parse({ resolution: '2k', quality: 'high', imageBackground: 'transparent', imageOutputFormat: 'jpeg' })
const video = { kind: 'video', model: 'sora-2', prompt: 'water', duration: 8, aspect_ratio: '16:9', size: '1280x720' }
const png = 'data:image/png;base64,aGVsbG8='
test('official relay models map resolution tiers without inventing pixel sizes', () => {
  for (const [model, maximum] of [['火山2.0 Fast官转', 15], ['火山2.0 Mini官转', 15], ['火山2.5官转', 30]]) {
    const setting = resolveVideoModelSetting(model)
    assert.equal(videoModelSettingSchema.safeParse(setting).success, true)
    for (const protocol of ['openai', 'async']) for (const resolution of ['720p', '1080p', '2k']) {
      const input = validateCreationInput({ ...video, model, protocol, duration: maximum,
        videoOptions: { mode: 'text-to-video', resolution } })
      const original = structuredClone(input)
      const payload = buildCreationPayload(input)
      assert.equal(payload.path, protocol === 'async' ? 'async-videos/v1/tasks' : 'v1/videos')
      assert.equal(payload.body.has('size'), false)
      assert.equal(payload.body.get('seconds'), String(maximum))
      assert.equal(JSON.parse(payload.body.get('metadata')).resolution, `tier_${resolution}`)
      assert.deepEqual(input, original)
    }
    for (const customParameters of ['{"size":"1280x720"}', '{"frame_rate":0}', '{"resolution":"tier_2k"}', '{"resolution":"4k"}']) {
      assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, model,
        videoOptions: { mode: 'text-to-video', customParameters } })), /不支持参数|分辨率/)
    }
    for (const duration of [3, maximum + 1]) assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, model, duration })), /时长/)
  }
  const setting = resolveVideoModelSetting('火山2.5官转')
  assert.equal(normalizeVideoParameters({ model: '火山2.5官转', mode: 'text-to-video', resolution: '2k', duration: 10,
    size: '1280x720', aspectRatio: '16:9' }, setting).size, 'auto')
  assert.equal(videoModelSettingSchema.safeParse({ resolutions: ['720p'], resolutionValues: { '2k': 'tier_2k' } }).success, false)
  assert.equal(videoModelSettingSchema.safeParse({ resolutions: ['2k'], sizes: { '2k': { '1:1': '2x2' } } }).success, false)
})
test('upscale uses one verified video and measured duration with optional prompt', () => {
  const model = 'DMC 视频超分', setting = resolveVideoModelSetting(model)
  assert.equal(videoModelSettingSchema.safeParse(setting).success, true)
  const source = { mediaType: 'video', blob: new Blob(['video'], { type: 'video/mp4' }), durationSeconds: 2.51, name: 'source.mp4' }
  for (const protocol of ['openai', 'async']) for (const resolution of ['auto', '720p', '1080p', '2k', '4k']) {
    const input = validateCreationInput({ ...video, model, protocol, prompt: '', duration: 1,
      referenceUrls: ['/legacy-files/owned-source'], videoOptions: { mode: 'text-to-video', resolution } })
    const payload = buildCreationPayload(input, [source])
    assert.equal(payload.body.get('seconds'), '3')
    assert.equal(payload.body.get('resolution'), resolution === 'auto' ? '1080p' : resolution)
    assert.equal(payload.body.get('frame_rate'), '0')
    assert.deepEqual(JSON.parse(payload.body.get('metadata')), { operation: 'upscale' })
    assert.equal(payload.body.get('input_videos').type, 'video/mp4')
    for (const key of ['prompt', 'size', 'aspect_ratio', 'input_reference']) assert.equal(payload.body.has(key), false)
    assert.equal(input.duration, 1)
  }
  const base = validateCreationInput({ ...video, model, prompt: '', referenceUrls: ['/legacy-files/owned-source'], videoOptions: { mode: 'text-to-video' } })
  assert.equal(buildCreationPayload({ ...base, prompt: '保留原画细节' }, [source]).body.get('prompt'), '保留原画细节')
  assert.throws(() => buildCreationPayload({ ...base, prompt: '超'.repeat(8001) }, [source]), /24,000/)
  assert.throws(() => buildCreationPayload(base), /源视频/)
  for (const durationSeconds of [0, NaN, Infinity, 3600.01]) assert.throws(() => buildCreationPayload(base, [{ ...source, durationSeconds }]), /源视频/)
  assert.throws(() => buildCreationPayload({ ...base, videoOptions: videoOptionsSchema.parse({ mode: 'text-to-video', customParameters: '{"seconds":1}' }) }, [source]), /自定义参数/)
  assert.throws(() => buildCreationPayload({ ...base, model: 'unknown-video' }, [source]), /提示词/)
  assert.throws(() => resolveCreationModelSettings({ ...base, model: 'unknown-video' }), /提示词/)
})
test('editable video parameters follow model and mode limits without changing the source snapshot', () => {
  const draft = { model: 'sd2.0-fast-720p', mode: 'text-to-video', resolution: '480p', duration: 8, aspectRatio: '16:9', size: '854x480' }
  const snapshot = structuredClone(draft)
  assert.deepEqual(normalizeVideoParameters(draft, resolveVideoModelSetting(draft.model)), { ...draft, resolution: '720p', size: '1280x720' })
  assert.deepEqual(draft, snapshot)
  assert.equal(normalizeVideoParameters({ ...draft, model: 'sd2.0-fast-480p', resolution: '720p' }, resolveVideoModelSetting('sd2.0-fast-480p')).resolution, '480p')
  assert.deepEqual(normalizeVideoParameters({ ...draft, model: 'sora-2', resolution: 'auto', duration: 7 }, resolveVideoModelSetting('sora-2')),
    { ...draft, model: 'sora-2', resolution: 'auto', duration: 8 })
  assert.equal(normalizeVideoParameters({ ...draft, model: 'grok-imagine-video-1.5', mode: 'reference-to-video', resolution: '1080p' }, resolveVideoModelSetting('grok-imagine-video-1.5')).resolution, '720p')
  assert.equal(normalizeVideoParameters({ ...draft, model: 'veo-3.1', mode: 'reference-to-video', duration: 4 }, resolveVideoModelSetting('veo-3.1')).duration, 8)
  assert.deepEqual(normalizeVideoParameters({ ...draft, model: 'unknown' }), { ...draft, model: 'unknown' })
  const settings = { resolutions: ['540p', '1080p'], autoResolution: '1080p' }
  const custom = { ...draft, model: 'configured-video', duration: 23 }
  assert.deepEqual(normalizeVideoParameters(custom, settings), { ...custom, resolution: '1080p', size: '1920x1080' })
  assert.deepEqual(normalizeVideoParameters({ ...custom, resolution: '540p' }, settings), { ...custom, resolution: '540p' })
})
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
  assert.deepEqual(videoCapabilities('sora-2', 'text-to-video', resolveVideoModelSetting('sora-2')).durations, [4, 8, 12])
  assert.deepEqual(videoCapabilities('veo-3.1', 'reference-to-video', resolveVideoModelSetting('veo-3.1')).durations, [8])
  assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, duration: 7, videoOptions: { mode: 'text-to-video' } })), /4 \/ 8 \/ 12/)
  assert.equal(buildCreationPayload(validateCreationInput({ ...video, model: 'unknown-video', videoOptions: { mode: 'text-to-video' } })).body.get('model'), 'unknown-video')
  const sent = JSON.parse(buildCreationPayload(validateCreationInput({ ...video, model: 'doubao-seedance-2-0', referenceUrls: [png, png], videoOptions: { mode: 'first-last-frame', generateAudio: true } })).body)
  assert.deepEqual(sent.metadata.content.map(part => part.role), ['first_frame', 'last_frame'])
  assert.equal(sent.metadata.generate_audio, true)
  assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, videoOptions: { mode: 'text-to-video', customParameters: '{"seconds":30}' } })), /时长/)
  assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, videoOptions: { mode: 'text-to-video', customParameters: '{"model":"another"}' } })), /受保护/)
  assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, videoOptions: { mode: 'text-to-video', customParameters: '{"images":["http://127.0.0.1/private"]}' } })), /远程素材/)
})
test('SD-compatible aliases reuse the working workbench range without changing existing model limits', () => {
  for (const [model, resolution] of [['sd2.0-fast-480p', '480p'], ['sd2.0-mini-480p', '480p'], ['sd2.0-fast-720p', '720p']]) {
    for (const protocol of ['openai', 'async']) for (const duration of [3, 8, 30]) {
      const payload = buildCreationPayload(validateCreationInput({ ...video, model, duration, protocol, size: 'auto',
        videoOptions: { mode: 'text-to-video', resolution } }))
      assert.equal(payload.body.get('model'), model)
      assert.equal(payload.body.get('seconds'), String(duration))
      assert.equal(payload.body.has('size'), false)
      assert.equal(JSON.parse(payload.body.get('metadata')).resolution, resolution)
      assert.equal(payload.path, protocol === 'async' ? 'async-videos/v1/tasks' : 'v1/videos')
    }
    assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, model, duration: 31, size: 'auto',
      videoOptions: { mode: 'text-to-video', resolution } })), /时长/)
    assert.throws(() => buildCreationPayload(validateCreationInput({ ...video, model, size: '1920x1080',
      videoOptions: { mode: 'text-to-video', resolution } })), /分辨率/)
  }
  assert.deepEqual(videoCapabilities('sd2.0-mini-720p', 'text-to-video', resolveVideoModelSetting('sd2.0-mini-720p')).durations, Array.from({ length: 12 }, (_, index) => index + 4))
  assert.equal(videoCapabilities('unknown-video-model'), undefined)
})
test('automatic video size is omitted from multipart and JSON reference requests', () => {
  const automatic = buildCreationPayload(validateCreationInput({ ...video, size: 'auto',
    videoOptions: { mode: 'text-to-video', resolution: 'auto' } }))
  assert.equal(automatic.body.has('size'), false)
  const references = buildCreationPayload(validateCreationInput({ ...video, size: 'auto', referenceUrls: [png],
    videoOptions: { mode: 'reference-to-video', resolution: 'auto' } }))
  assert.equal(Object.hasOwn(JSON.parse(references.body), 'size'), false)
  const explicit = buildCreationPayload(validateCreationInput({ ...video,
    videoOptions: { mode: 'text-to-video', resolution: '720p' } }))
  assert.equal(explicit.body.get('size'), '1280x720')
})
test('backend video resolution settings govern automatic requests without replacing explicit selections', () => {
  const setting = { autoResolution: '720p', resolutions: ['480p', '720p', '1080p'] }
  const fields = payload => typeof payload.body === 'string' ? JSON.parse(payload.body) : Object.fromEntries(payload.body.entries())
  const metadata = sent => typeof sent.metadata === 'string' ? JSON.parse(sent.metadata) : sent.metadata
  const make = values => validateCreationInput({ ...video, model: 'configured-video', size: 'auto',
    videoOptions: { mode: 'text-to-video', resolution: 'auto' }, ...values })
  for (const protocol of ['openai', 'async']) {
    const input = make({ protocol }), original = structuredClone(input)
    const automatic = fields(buildCreationPayload(input, [], [], setting))
    assert.equal(automatic.size, '1280x720')
    assert.equal(metadata(automatic).resolution, '720p')
    assert.deepEqual(input, original)
    const explicit = fields(buildCreationPayload(make({ protocol, size: '1920x1080',
      videoOptions: { mode: 'text-to-video', resolution: '1080p' } }), [], [], setting))
    assert.equal(explicit.size, '1920x1080')
    assert.equal(metadata(explicit).resolution, '1080p')
    const adaptive = fields(buildCreationPayload(make({ protocol, aspect_ratio: 'auto' }), [], [], setting))
    assert.equal(adaptive.size, undefined)
    assert.equal(metadata(adaptive).resolution, '720p')
    for (const fallback of [undefined, { ...setting, autoResolution: 'auto' }]) {
      const upstream = fields(buildCreationPayload(input, [], [], fallback))
      assert.equal(upstream.size, undefined)
      assert.equal(metadata(upstream)?.resolution, undefined)
    }
    const custom = fields(buildCreationPayload(make({ protocol,
      videoOptions: { mode: 'text-to-video', resolution: 'auto', customParameters: '{"metadata":{"resolution":"1080p"}}' } }), [], [], setting))
    assert.equal(custom.size, undefined)
    assert.equal(metadata(custom).resolution, '1080p')
    const customSize = fields(buildCreationPayload(make({ protocol, size: '854x480', exactSize: true }), [], [], setting))
    assert.equal(customSize.size, '854x480')
    assert.equal(metadata(customSize).resolution, '480p')
    assert.throws(() => buildCreationPayload(make({ protocol, size: '4K', exactSize: true }), [], [], setting), { statusCode: 400 })
  }
})
test('configured resolution choices override built-in tiers while unknown models retain generic safety checks', () => {
  const limits = videoCapabilities('sora-2', 'text-to-video', resolveVideoModelSetting('sora-2', { autoResolution: '1080p', resolutions: ['720p', '1080p'] }))
  assert.deepEqual(limits.resolutions, ['720p', '1080p'])
  assert.deepEqual(limits.durations, [4, 8, 12])
  assert.deepEqual(videoCapabilities('new-video', 'text-to-video', { autoResolution: '540p' }).resolutions, [])
  const make = customParameters => validateCreationInput({ ...video, model: 'new-video', size: 'auto',
    videoOptions: { mode: 'text-to-video', resolution: 'auto', customParameters } })
  for (const custom of ['{"seconds":-1}', '{"seconds":3601}', '{"seconds":1.5}', '{"seconds":true}',
    '{"size":"1280x0"}', '{"size":"999999x720"}', '{"resolution":"anything"}', 'null', '[]']) {
    assert.throws(() => buildCreationPayload(make(custom)), { statusCode: 400 })
  }
  const payload = buildCreationPayload(make('{"resolution":"540p"}'))
  assert.equal(payload.body.get('resolution'), '540p')
})
test('an automatic resolution default alone does not restrict an unknown model manual selection', () => {
  const input = validateCreationInput({ ...video, model: 'new-video', size: '854x480',
    videoOptions: { mode: 'text-to-video', resolution: '480p' } })
  const payload = buildCreationPayload(input, [], [], { autoResolution: '720p' })
  assert.equal(payload.body.get('size'), '854x480')
  assert.equal(JSON.parse(payload.body.get('metadata')).resolution, '480p')
})
test('2160p backend settings accept automatic and explicitly sized 4k video requests', () => {
  for (const automatic of [true, false]) {
    const setting = { autoResolution: automatic ? '2160p' : '720p', resolutions: ['720p', '2160p'] }
    const input = validateCreationInput({ ...video, model: 'new-video', size: automatic ? 'auto' : '3840x2160',
      videoOptions: { mode: 'text-to-video', resolution: 'auto' } })
    const payload = buildCreationPayload(input, [], [], setting)
    assert.equal(payload.body.get('size'), '3840x2160')
    assert.equal(JSON.parse(payload.body.get('metadata')).resolution, '2160p')
  }
})
test('automatic backend resolution reaches vendor metadata and reference JSON through the existing formats', () => {
  for (const model of ['sora-2', 'veo-3.1', 'seedance-2-0', 'grok-imagine-video']) {
    const payload = buildCreationPayload(validateCreationInput({ ...video, model, size: 'auto',
      videoOptions: { mode: 'text-to-video', resolution: 'auto' } }), [], [], { autoResolution: '720p' })
    const sent = typeof payload.body === 'string' ? JSON.parse(payload.body) : Object.fromEntries(payload.body.entries())
    const metadata = typeof sent.metadata === 'string' ? JSON.parse(sent.metadata) : sent.metadata
    assert.equal(metadata.resolution, '720p')
  }
  const payload = buildCreationPayload(validateCreationInput({ ...video, size: 'auto', referenceUrls: [png],
    videoOptions: { mode: 'reference-to-video', resolution: 'auto' } }), [], [], { autoResolution: '720p' })
  const sent = JSON.parse(payload.body)
  assert.equal(sent.size, '1280x720')
  assert.equal(sent.metadata.resolution, '720p')
})
test('server video defaults preserve mode limits and accept administrator overrides without stale inherited defaults', () => {
  assert.equal(videoCapabilities('sora-2'), undefined)
  assert.equal(resolveVideoModelSetting('unknown-video'), undefined)
  assert.deepEqual(videoCapabilities('grok-imagine-video', 'reference-to-video', resolveVideoModelSetting('grok-imagine-video')).durations,
    Array.from({ length: 10 }, (_, index) => index + 1))
  const override = resolveVideoModelSetting('grok-imagine-video-1.5', { resolutions: ['1080p'], durations: [6, 12],
    modes: { 'first-last-frame': { durations: [6] } } })
  assert.deepEqual(videoCapabilities('grok-imagine-video-1.5', 'reference-to-video', override).resolutions, ['1080p'])
  assert.deepEqual(videoCapabilities('grok-imagine-video-1.5', 'first-last-frame', override).durations, [6])
  assert.deepEqual(videoCapabilities('veo-3.1', 'reference-to-video', resolveVideoModelSetting('veo-3.1', { resolutions: ['720p'] })).durations, [8])
  const mapped = resolveVideoModelSetting('grok-imagine-video-1.5', { sizes: { '1080p': { '16:9': '1920x1080' } } })
  assert.deepEqual(videoCapabilities('grok-imagine-video-1.5', 'reference-to-video', mapped).resolutions, ['1080p'])
  const firstLast = buildCreationPayload(validateCreationInput({ ...video, model: 'configured-video', duration: 4,
    referenceUrls: [png, png], videoOptions: { mode: 'first-last-frame' } }), [], [],
    { resolutions: ['720p'], durations: [4, 8], modes: { 'first-last-frame': { durations: [4] }, 'reference-to-video': { durations: [8] } } })
  assert.equal(JSON.parse(firstLast.body).seconds, '4')
  const modeSetting = { resolutions: ['720p', '1080p'], autoResolution: '1080p', durations: [8, 10], autoDuration: 10,
    modes: { 'reference-to-video': { resolutions: ['720p'], durations: [8] } } }
  const automaticReference = validateCreationInput({ ...video, model: 'configured-video', duration: undefined, size: 'auto',
    referenceUrls: [png], videoOptions: { mode: 'reference-to-video', resolution: 'auto' } })
  const resolvedReference = resolveCreationModelSettings(automaticReference, { id: 'configured-video', kind: 'video', video: modeSetting })
  assert.equal(resolvedReference.duration, 8)
  for (const request of [automaticReference, resolvedReference]) {
    const sent = JSON.parse(buildCreationPayload(request, [], [], modeSetting).body)
    assert.equal(sent.seconds, '8')
    assert.equal(sent.metadata.resolution, '720p')
    assert.equal(sent.size, '1280x720')
  }
  for (const stored of [{ resolutions: ['540p'] }, { durations: [4, 8, 12] }, { aspectRatios: ['1:1'] },
    { resolutions: ['1080p'], aspectRatios: ['9:16'] }, { autoResolution: '540p' }, { autoDuration: 20 },
    { sizes: { '768p': { '16:9': '1368x768' } } }]) {
    const resolved = resolveVideoModelSetting('MiniMax H3视频生成', stored)
    assert.equal(videoModelSettingSchema.safeParse(resolved).success, true, JSON.stringify(stored))
  }
  const narrowed = resolveVideoModelSetting('MiniMax H3视频生成', { resolutions: ['1080p'], durations: [4, 8, 12], aspectRatios: ['9:16'] })
  assert.equal(narrowed.autoResolution, '1080p')
  assert.equal(narrowed.autoDuration, 4)
  assert.equal(narrowed.autoAspectRatio, '9:16')
  assert.deepEqual(narrowed.sizes, { '1080p': { '9:16': '1080x1920' } })
  for (const model of ['MiniMax H3视频生成', 'configured-video']) {
    const mapped = resolveVideoModelSetting(model, { sizes: { '768p': { '16:9': '1368x768' } } })
    assert.deepEqual(mapped.resolutions, ['768p'])
    assert.deepEqual(mapped.aspectRatios, ['16:9'])
    assert.equal(videoModelSettingSchema.safeParse(mapped).success, true)
  }
})
test('H3 backend defaults and exact dimensions reach both video protocols while preserving explicit duration', () => {
  const model = 'MiniMax H3视频生成', setting = resolveVideoModelSetting(model)
  assert.equal(videoModelSettingSchema.safeParse(setting).success, true)
  const fields = payload => typeof payload.body === 'string' ? JSON.parse(payload.body) : Object.fromEntries(payload.body.entries())
  const make = values => validateCreationInput({ kind: 'video', model, prompt: 'water', size: 'auto',
    aspect_ratio: 'auto', videoOptions: { mode: 'text-to-video' }, ...values })
  const input = make({}), snapshot = structuredClone(input)
  const automatic = fields(buildCreationPayload(input))
  assert.equal(automatic.seconds, '10')
  assert.equal(automatic.size, '1368x768')
  assert.equal(JSON.parse(automatic.metadata).resolution, '768p')
  assert.deepEqual(input, snapshot)
  assert.equal(resolveCreationModelSettings(input).duration, 10)
  for (const protocol of ['openai', 'async']) for (const [resolution, ratios] of Object.entries(setting.sizes)) {
    for (const [aspect_ratio, expected] of Object.entries(ratios)) {
      const payload = buildCreationPayload(make({ protocol, duration: 4, aspect_ratio,
        videoOptions: { mode: 'text-to-video', resolution } }))
      const sent = fields(payload)
      assert.equal(sent.size, expected)
      assert.equal(sent.seconds, '4')
      assert.equal(JSON.parse(sent.metadata).resolution, resolution)
      assert.equal(payload.path, protocol === 'async' ? 'async-videos/v1/tasks' : 'v1/videos')
    }
  }
  const resolved = resolveCreationModelSettings(make({ videoOptions: { mode: 'text-to-video', resolution: '768p' } }))
  assert.equal(resolved.size, '1368x768')
  assert.equal(resolved.aspect_ratio, '16:9')
})
test('H3 final JSON and multipart validation rejects custom bypasses before a request is returned', () => {
  const model = 'MiniMax H3视频生成'
  const invalid = [
    { seconds: 3 }, { seconds: 16 }, { seconds: 4.5 }, { duration: 16 }, { durationSeconds: 16 },
    { duration_seconds: 16 }, { resolution: '720p' }, { resolution_name: '480p' },
    { aspect_ratio: '2:1' }, { aspectRatio: '2:1' }, { ratio: '2:1' },
    { size: '1366x768' }, { size: '2000x768' }, { frame_rate: 30 },
    { resolution: '768p', aspect_ratio: '16:9', size: '768x768' },
  ]
  for (const mode of ['text-to-video', 'reference-to-video']) for (const custom of invalid) {
    for (const parameters of [custom, { metadata: custom }]) {
      const input = validateCreationInput({ kind: 'video', model, prompt: 'water', size: 'auto',
        referenceUrls: mode === 'reference-to-video' ? [png] : [],
        videoOptions: { mode, customParameters: JSON.stringify(parameters) } })
      assert.throws(() => buildCreationPayload(input), { statusCode: 400 }, JSON.stringify({ mode, parameters }))
    }
  }
  const valid = buildCreationPayload(validateCreationInput({ kind: 'video', model, prompt: 'water', duration: 15,
    aspect_ratio: '16:9', size: '1368x768', videoOptions: { mode: 'text-to-video', resolution: '768p' } }))
  assert.equal(valid.body.get('seconds'), '15')
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
