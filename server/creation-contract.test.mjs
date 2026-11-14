import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCreationPayload, creationRelayPath, creationTaskPath, normalizeCreationTask, validateCreationInput } from './creation-contract.ts'

test('creation input keeps model parameters but cannot forward account credentials or arbitrary endpoints', () => {
  const input = validateCreationInput({ kind: 'image', model: 'gpt-image-2', prompt: 'An image', n: 2,
    size: '1024x1024', requestId: 'request-1', referenceUrls: ['https://media.example/reference.png'],
    apiKey: 'private', baseUrl: 'http://internal', accountId: 'other', protocol: 'async' })
  assert.equal(input.model, 'gpt-image-2')
  assert.equal(input.protocol, 'async')
  assert.equal(input.n, 2)
  assert.equal('apiKey' in input, false)
  assert.equal('baseUrl' in input, false)
  assert.equal('accountId' in input, false)
  for (const patch of [{ kind: 'unknown' }, { prompt: '  ' }, { n: 0 }, { n: 17 }, { duration: -1 },
    { requestId: '../escape' }, { sourceWorkId: '../../work' }, { protocol: 'guess-provider' },
    { referenceUrls: ['file:///private'] }, { referenceUrls: ['https://secret@media.example/file'] }]) {
    assert.throws(() => validateCreationInput({ kind: 'image', model: 'image-model', prompt: 'An image', ...patch }),
      { statusCode: 400, code: 'INVALID_CREATION_REQUEST' })
  }
})

test('relay allowlist admits existing generation protocols and read-only task/media routes', () => {
  for (const path of ['v1/images/generations', 'v1/images/edits', 'v1/chat/completions', 'v1/responses',
    'v1/videos', 'v1/videos/generations', 'async-images/v1/tasks', 'async-images/v1/edits', 'async-videos/v1/tasks']) {
    assert.equal(creationRelayPath('POST', path), path)
  }
  for (const path of ['v1/models', 'v1/images/generations?task_id=job-1', 'v1/videos/job_1/content',
    'async-images/v1/tasks/job_1', 'v1/tasks/job/artifacts/video.mp4/content',
    'api/v3/contents/generations/tasks/job', 'v1beta/models/veo/operations/job',
    'v1beta/files/file_1:download?alt=media']) {
    assert.equal(creationRelayPath('GET', path), path)
  }
  for (const path of ['https://other.example/api', '/v1/videos', 'v1/../user', 'v1/videos/%2e%2e',
    'v1/videos/job?redirect=http://internal', 'v1/tasks/job/artifacts/../../content',
    'v1/images/generations?task_id=x&url=http://internal', 'api/user/self']) {
    assert.equal(creationRelayPath('GET', path), null, path)
  }
  assert.equal(creationRelayPath('POST', 'async-videos/v1/edits'), null)
  assert.equal(creationRelayPath('DELETE', 'v1/videos/job'), null)
})

test('generation payloads preserve explicit sync/async and multipart reference uploads', () => {
  const input = { kind: 'image', model: 'gpt-image-2', prompt: 'Image', size: '1024x1024', n: 2 }
  const direct = buildCreationPayload(input)
  assert.equal(direct.path, 'v1/images/generations')
  assert.equal(direct.contentType, 'application/json')
  assert.deepEqual(JSON.parse(direct.body), { model: input.model, prompt: input.prompt, size: input.size, n: 2, response_format: 'url' })
  assert.equal(buildCreationPayload({ ...input, protocol: 'async' }).path, 'async-images/v1/tasks')
  const edit = buildCreationPayload({ ...input, protocol: 'async', referenceUrls: ['https://media.example/reference.png'] },
    [{ blob: new Blob(['image'], { type: 'image/png' }), name: 'reference.png' }])
  assert.equal(edit.path, 'async-images/v1/edits')
  assert(edit.body instanceof FormData)
  assert.equal(edit.contentType, undefined, 'The runtime must retain the generated multipart boundary')
  assert.equal(edit.body.get('image[]').name, 'reference.png')
  assert.throws(() => buildCreationPayload({ ...input, referenceUrls: ['http://internal/reference'] }), { statusCode: 400 })
})

test('remix image requests retain exact size and an explicit seed through JSON and multipart', () => {
  const input = validateCreationInput({ kind: 'image', model: 'gpt-image-2', prompt: '同款',
    size: '1200x900', aspect_ratio: '4:3', n: 3, imageOptions: { resolution: '2k', quality: 'high', seed: '0' } })
  const body = JSON.parse(buildCreationPayload(input).body)
  assert.equal(body.size, '1200x900')
  assert.equal(body.seed, 0)
  assert.equal(body.n, 3)
  const edit = buildCreationPayload({ ...input, protocol: 'async', referenceUrls: ['https://media.example/ref.png'] }, [{ blob: new Blob(['image'], { type: 'image/png' }) }])
  assert.equal(edit.body.get('size'), '1200x900')
  assert.equal(edit.body.get('seed'), '0')
  assert.throws(() => validateCreationInput({ ...input, imageOptions: { seed: '9007199254740992' } }), { statusCode: 400 })
})

test('remix compatible video requests retain exact size and seed metadata', () => {
  const input = validateCreationInput({ kind: 'video', model: 'sora-2', prompt: '同款视频',
    size: '720x1280', aspect_ratio: '9:16', duration: 8, videoOptions: { mode: 'text-to-video', resolution: '720p', seed: '42' } })
  const payload = buildCreationPayload(input)
  assert.equal(payload.body.get('size'), '720x1280')
  assert.equal(JSON.parse(payload.body.get('metadata')).seed, 42)
})

test('Gemini image models retain their existing single chat-completions transport with image references', () => {
  const reference = `data:${'image/jpeg'};base64,/9j/2Q==`
  const input = { kind: 'image', model: 'gemini-3.1-flash-image-preview', prompt: 'Image', referenceUrls: [reference] }
  const payload = buildCreationPayload(input)
  assert.equal(payload.path, 'v1/chat/completions')
  const body = JSON.parse(payload.body)
  assert.equal(body.stream, false)
  assert.deepEqual(body.messages, [{ role: 'user', content: [
    { type: 'text', text: input.prompt }, { type: 'image_url', image_url: { url: reference } },
  ] }])
  assert.equal(buildCreationPayload({ ...input, model: 'gemini-nano-banana', referenceUrls: [] }).path, 'v1/chat/completions')
  assert.equal(buildCreationPayload({ ...input, model: 'gpt-image-2', referenceUrls: [] }).path, 'v1/images/generations')
  assert.throws(() => buildCreationPayload({ ...input, protocol: 'async' }), { statusCode: 400 })
  assert.throws(() => buildCreationPayload({ ...input, n: 2 }), { statusCode: 400 })
  assert.throws(() => buildCreationPayload({ ...input, imageOptions: { seed: '42' } }), { statusCode: 400 })
  assert.throws(() => buildCreationPayload({ ...input, size: '1200x900', exactSize: true }), { statusCode: 400 })
})

test('OpenAI video uses existing multipart transport while compatible model families retain JSON metadata', () => {
  const input = { kind: 'video', model: 'sora-2', prompt: 'Video', duration: 8, size: '1280x720', aspect_ratio: '16:9' }
  const openai = buildCreationPayload(input)
  assert.equal(openai.path, 'v1/videos')
  assert(openai.body instanceof FormData)
  assert.equal(openai.body.get('seconds'), '8')
  assert.equal(openai.body.get('size'), '1280x720')
  const seedance = buildCreationPayload({ ...input, model: 'seedance-2', referenceUrls: ['https://media.example/reference.png'] })
  assert.equal(seedance.path, 'v1/videos')
  assert.equal(JSON.parse(seedance.body).metadata.content[0].role, 'reference_image')
  const grok = JSON.parse(buildCreationPayload({ ...input, model: 'grok-imagine-video', referenceUrls: ['https://media.example/reference.png'] }).body)
  assert.equal(grok.input_reference, 'https://media.example/reference.png')
  assert.equal(grok.metadata.aspect_ratio, '16:9')
  assert.equal(buildCreationPayload({ ...input, protocol: 'async' }).path, 'async-videos/v1/tasks')
  assert.throws(() => buildCreationPayload({ ...input, n: 2 }), { statusCode: 400 })
})

test('Veo preserves embedded PNG/JPEG/WebP references and requires remote images to be converted first', () => {
  const input = { kind: 'video', model: 'veo-3', prompt: 'Video', aspect_ratio: '9:16' }
  for (const [mime, bytes] of [['image/png', 'iVBORw0KGgo='], ['image/jpeg', '/9j/2Q=='], ['image/webp', 'UklGRg==']]) {
    const reference = `data:${mime};base64,${bytes}`
    const validated = validateCreationInput({ ...input, referenceUrls: [reference] })
    for (const prepared of [[], [{ blob: new Blob([Buffer.from(bytes, 'base64')], { type: mime }), name: 'reference' }]]) {
      const payload = buildCreationPayload(validated, prepared)
      assert.equal(payload.contentType, 'application/json')
      const body = JSON.parse(payload.body)
      assert.deepEqual(body.images, [reference])
      assert.equal(body.metadata.aspectRatio, '9:16')
    }
  }
  const remote = { ...input, referenceUrls: ['https://media.example/reference.png'] }
  assert.throws(() => buildCreationPayload(remote), { statusCode: 400 })
  assert.throws(() => buildCreationPayload(remote, [{ blob: new Blob(['image'], { type: 'image/png' }) }]),
    { statusCode: 400, message: 'Veo 参考图须先转换为图片 Base64。' })
})

test('historical tasks preserve the submitted protocol and reject path injection', () => {
  assert.equal(creationTaskPath('image', 'job_1', 'async'), 'async-images/v1/tasks/job_1')
  assert.equal(creationTaskPath('video', 'job_1', 'async'), 'async-videos/v1/tasks/job_1')
  assert.equal(creationTaskPath('image', 'job_1', 'legacy'), 'v1/images/generations?task_id=job_1')
  assert.equal(creationTaskPath('video', 'job_1', 'openai'), 'v1/videos/job_1')
  assert.equal(creationTaskPath('video', 'job_1', 'plugin'), 'v1/tasks/job_1')
  assert.equal(creationTaskPath('video', 'job_1', 'seedance'), 'api/v3/contents/generations/tasks/job_1')
  assert.equal(creationTaskPath('video', 'models/veo/operations/job_1', 'gemini'), 'v1beta/models/veo/operations/job_1')
  for (const id of ['../secret', '%2e%2e', 'job?url=secret', '']) assert.throws(() => creationTaskPath('video', id), { statusCode: 400 })
})

test('a running job never becomes complete merely because it contains a preview URL', () => {
  const result = normalizeCreationTask('video', { id: 'job-1', status: 'running', progress: '42%', video: { url: 'https://media.example/preview.mp4' } })
  assert.equal(result.status, 'pending')
  assert.equal(result.upstreamId, 'job-1')
  assert.equal(result.progress, 42)
  assert.deepEqual(result.outputs, [])
  assert.equal(normalizeCreationTask('image', { id: 'job', status: 'unknown', data: [{ url: 'https://media.example/preview.png' }] }).status, 'pending')
})

test('completed image/text results and protected OpenAI video media keep their actual outputs', () => {
  assert.deepEqual(normalizeCreationTask('image', { data: [{ url: 'https://media.example/image.png' }, { b64_json: 'aW1hZ2U=' }] }).outputs,
    [{ url: 'https://media.example/image.png' }, { b64_json: 'aW1hZ2U=' }])
  assert.equal(normalizeCreationTask('image', { data: [{ url: 'https://media.example/image.png' }] }).status, 'succeeded')
  assert.deepEqual(normalizeCreationTask('text', { choices: [{ message: { content: 'Text result' } }] }).outputs, [{ text: 'Text result' }])
  const video = normalizeCreationTask('video', { id: 'job_1', status: 'completed' }, undefined, 'openai')
  assert.equal(video.status, 'succeeded')
  assert.equal(video.mediaPath, 'videos/job_1/content')
  assert.deepEqual(normalizeCreationTask('video', { status: 'succeeded', video_url: 'https://media.example/video.mp4' }).outputs,
    [{ url: 'https://media.example/video.mp4' }])
})

test('image chat results preserve multimodal and Markdown image URLs without accepting active content', () => {
  const embedded = `data:${'image/webp'};base64,UklGRg==`
  const multimodal = normalizeCreationTask('image', { choices: [{ message: { content: [
    { type: 'text', text: 'An image' }, { type: 'image_url', image_url: { url: embedded } },
    { type: 'image_url', image_url: { url: 'https://media.example/image.png' } },
  ] } }] })
  assert.equal(multimodal.status, 'succeeded')
  assert.deepEqual(multimodal.outputs, [{ url: embedded }, { url: 'https://media.example/image.png' }])
  const markdown = normalizeCreationTask('image', { choices: [{ message: { content: `An image\n\n![Generated Image](${embedded})` } }] })
  assert.equal(markdown.status, 'succeeded')
  assert.deepEqual(markdown.outputs, [{ url: embedded }])
  assert.deepEqual(normalizeCreationTask('image', { data: [{ b64_json: embedded }] }).outputs, [{ url: embedded }])
  const untrusted = normalizeCreationTask('image', { choices: [{ message: { content: [
    { type: 'image_url', image_url: { url: 'javascript:alert(1)' } },
    { type: 'image_url', image_url: { url: `data:${'image/svg+xml'};base64,PHN2Zz4=` } },
  ] } }] })
  assert.deepEqual(untrusted.outputs, [])
  assert.equal(normalizeCreationTask('image', { choices: [{ message: { content: `![Image](${embedded})` } }], status: 'running' }).status, 'pending')
})

test('historical Gemini/XAI/plugin video results retain their selected protocol and protected content routes', () => {
  for (const response of [
    { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://media.example/v1beta/files/file_1:download?alt=media' } }] } },
    { generatedVideos: [{ video: { uri: 'https://media.example/v1beta/files/file_1' } }] },
  ]) {
    const completed = normalizeCreationTask('video', { name: 'models/veo/operations/job_1', done: true, response }, undefined, 'gemini')
    assert.equal(completed.status, 'succeeded')
    assert.equal(completed.mediaPath, 'v1beta/files/file_1:download?alt=media')
    assert.equal(normalizeCreationTask('video', { done: false, response }, undefined, 'gemini').status, 'pending')
  }
  assert.equal(normalizeCreationTask('video', { done: true, response: {} }, undefined, 'gemini').status, 'indeterminate')
  const xai = { video: { url: 'https://media.example/video.mp4' } }
  assert.equal(normalizeCreationTask('video', xai, 'job_1', 'xai').status, 'succeeded')
  assert.equal(normalizeCreationTask('video', { ...xai, status: 'running' }, 'job_1', 'xai').status, 'pending')
  const plugin = normalizeCreationTask('video', { status: 'completed', artifacts: [{ mime_type: 'video/mp4', key: 'video.mp4' }] },
    'job_1', 'plugin')
  assert.equal(plugin.status, 'succeeded')
  assert.equal(plugin.mediaPath, 'tasks/job_1/artifacts/video.mp4/content')
  assert.equal(normalizeCreationTask('video', { status: 'completed', artifacts: [{ type: 'video', key: '../private' }] },
    'job_1', 'plugin').status, 'indeterminate')
})

test('ambiguous saved outcomes remain explicit and do not suggest replaying a paid request', () => {
  for (const status of ['save_failed', 'indeterminate', 'expired']) {
    const result = normalizeCreationTask('image', { id: 'job_1', status, data: [{ url: 'https://media.example/image.png' }] })
    assert.equal(result.status, status)
    assert.deepEqual(result.outputs, [])
    assert(result.error)
  }
  assert.equal(normalizeCreationTask('image', { id: 'job', status: 'completed' }).status, 'indeterminate')
  assert.equal(normalizeCreationTask('video', { id: 'job', status: 'cancelled' }).status, 'failed')
  assert.equal(normalizeCreationTask('image', { status: 'succeeded', data: [{ url: 'javascript:alert(1)' }] }).status, 'indeterminate')
})
