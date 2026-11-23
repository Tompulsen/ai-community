import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCreationPayload, creationRelayPath, creationTaskPath, normalizeCreationTask, resolveCreationModelSettings, validateCreationInput } from './creation-contract.ts'
import { modelTypesSchema } from '../shared/studio/model-types.ts'
import { readGenerationStream } from './creation/stream.ts'

test('model configuration only accepts existing interfaces and type-specific automatic parameters', () => {
  const accepted = [
    { id: 'alias-image', kind: 'image', apiFormat: 'images', protocol: 'sync', remark: 'Only administrators can read this.',
      image: { autoResolution: '2k', autoQuality: 'high', autoAspectRatio: '16:9', autoBackground: 'transparent' } },
    { id: 'alias-chat', kind: 'text', apiFormat: 'responses', text: { autoReasoningEffort: 'high' } },
    { id: 'alias-video', kind: 'video', apiFormat: 'openai', protocol: 'async',
      video: { autoResolution: '720p', autoAspectRatio: '9:16', parameterFormat: 'seedance' } },
  ]
  assert.deepEqual(modelTypesSchema.parse(accepted), accepted)
  for (const invalid of [
    { ...accepted[0], apiFormat: 'responses' }, { ...accepted[0], apiFormat: 'https://private/generate' },
    { ...accepted[0], image: { api_key: 'private' } }, { ...accepted[0], image: { autoQuality: 'ultra' } },
    { ...accepted[0], apiFormat: 'chat-completions', protocol: 'async' },
    { ...accepted[0], id: 'gemini-3.1-flash-image-preview', apiFormat: 'auto', protocol: 'async' },
    { ...accepted[0], text: {} }, { ...accepted[1], protocol: 'async' },
    { ...accepted[2], video: { parameterFormat: 'native-seedance-url' } },
    { ...accepted[2], video: { autoAspectRatio: '0:9' } }, { ...accepted[1], remark: 'x'.repeat(2001) },
  ]) assert.equal(modelTypesSchema.safeParse([invalid]).success, false)
})

test('automatic image selections use backend settings while explicit selections and original input survive', () => {
  const setting = modelTypesSchema.parse([{ id: 'custom-image', kind: 'image', apiFormat: 'images', protocol: 'async',
    remark: 'Private operator note', image: { autoResolution: '2k', autoQuality: 'high', autoAspectRatio: '16:9', autoBackground: 'transparent' } }])[0]
  const make = patch => validateCreationInput({ kind: 'image', model: setting.id, prompt: 'water',
    size: 'auto', aspect_ratio: 'auto', apiFormat: 'auto', protocol: 'auto', imageOptions: {}, ...patch })
  const input = make({}), original = structuredClone(input)
  const resolved = resolveCreationModelSettings(input, setting), payload = buildCreationPayload(resolved)
  const sent = JSON.parse(payload.body)
  assert.equal(payload.path, 'async-images/v1/tasks')
  assert.equal(sent.size, '2560x1440')
  assert.equal(sent.quality, 'high')
  assert.equal(sent.background, 'transparent')
  assert.equal(Object.hasOwn(sent, 'remark'), false)
  assert.deepEqual(input, original)
  const explicit = resolveCreationModelSettings(make({ protocol: 'sync', size: '1024x1536', aspect_ratio: '2:3',
    imageOptions: { resolution: '1k', quality: 'low', imageBackground: 'opaque' } }), setting)
  assert.equal(explicit.protocol, 'sync')
  assert.equal(explicit.aspect_ratio, '2:3')
  assert.equal(explicit.imageOptions.resolution, '1k')
  assert.equal(explicit.imageOptions.quality, 'low')
  assert.equal(explicit.imageOptions.imageBackground, 'opaque')
  const manualPayload = JSON.parse(buildCreationPayload(explicit).body)
  assert.equal(manualPayload.size, '1024x1536')
  assert.equal(manualPayload.background, 'opaque')
  const jpeg = resolveCreationModelSettings(make({ imageOptions: { imageOutputFormat: 'jpeg' } }), setting)
  assert.equal(JSON.parse(buildCreationPayload(jpeg).body).output_format, 'png')
  const manualRatio = resolveCreationModelSettings(make({ aspect_ratio: '9:16', size: 'auto' }), setting)
  assert.equal(JSON.parse(buildCreationPayload(manualRatio).body).size, '1440x2560')
  const legacySize = resolveCreationModelSettings(make({ aspect_ratio: '9:16', size: '720x1280' }), setting)
  assert.equal(JSON.parse(buildCreationPayload(legacySize).body).size, '720x1280')
  const exactSize = resolveCreationModelSettings(make({ aspect_ratio: '9:16', size: '720x1280', exactSize: true }), setting)
  assert.equal(JSON.parse(buildCreationPayload(exactSize).body).size, '720x1280')
  assert.deepEqual(resolveCreationModelSettings(input, { ...setting, id: 'other-model' }).imageOptions, input.imageOptions)
})

test('automatic image interface follows configuration even when a model alias disagrees with name recognition', () => {
  for (const [model, apiFormat, path] of [
    ['custom-image-alias', 'chat-completions', 'v1/chat/completions'],
    ['gemini-3.1-flash-image-preview', 'images', 'v1/images/generations'],
  ]) {
    const input = validateCreationInput({ kind: 'image', model, prompt: 'water', apiFormat: 'auto',
      protocol: 'auto', size: '1024x1536', imageOptions: { seed: '42' } })
    const resolved = resolveCreationModelSettings(input, { id: model, kind: 'image', apiFormat })
    const payload = buildCreationPayload(resolved), body = JSON.parse(payload.body)
    assert.equal(payload.path, path)
    if (apiFormat === 'images') { assert.equal(body.seed, 42); assert.equal(body.size, '1024x1536') }
    else { assert.equal(resolved.size, 'auto'); assert.equal(resolved.imageOptions.seed, ''); assert(body.messages.length) }
  }
})

test('automatic text interface and reasoning use model settings without replacing explicit parameters', () => {
  const setting = { id: 'alias-text', kind: 'text', apiFormat: 'responses', text: { autoReasoningEffort: 'high' } }
  const make = (apiFormat, reasoningEffort = 'auto') => validateCreationInput({ kind: 'text', model: setting.id,
    prompt: 'water', apiFormat, chatOptions: { messages: [{ role: 'user', content: 'water' }], format: 'chat-completions', reasoningEffort } })
  const automatic = resolveCreationModelSettings(make('auto'), setting)
  assert.equal(automatic.chatOptions.format, 'responses')
  assert.equal(automatic.chatOptions.reasoningEffort, 'high')
  assert.equal(buildCreationPayload(automatic).path, 'v1/responses')
  const explicit = resolveCreationModelSettings(make('claude', 'low'), setting)
  assert.equal(explicit.chatOptions.reasoningEffort, 'low')
  assert.equal(buildCreationPayload(explicit).path, 'v1/messages')
  assert.equal(resolveCreationModelSettings(make(undefined), setting).chatOptions.format, 'chat-completions')
  assert.throws(() => resolveCreationModelSettings(make('auto'), { ...setting, kind: 'image' }), { statusCode: 400 })
  assert.throws(() => validateCreationInput({ ...make('auto'), apiFormat: 'images' }), { statusCode: 400 })
})

test('Gemini native images follow model defaults, preserve explicit formats and send safe image history', () => {
  const setting = modelTypesSchema.parse([{ id: 'native-image', kind: 'image', apiFormat: 'gemini',
    image: { autoResolution: '2k', autoAspectRatio: '16:9' } }])[0]
  const image = 'data:image/png;base64,aW1hZ2U='
  const input = validateCreationInput({ kind: 'image', model: setting.id, prompt: 'Blue background',
    apiFormat: 'auto', protocol: 'auto', imageOptions: {}, referenceUrls: [image],
    imageContext: { turns: [{ prompt: 'A cat', images: [image], references: [image] }] } })
  const original = structuredClone(input)
  const resolved = resolveCreationModelSettings(input, setting)
  const payload = buildCreationPayload(resolved), body = JSON.parse(payload.body)
  assert.equal(payload.path, 'v1beta/models/native-image:generateContent')
  assert.deepEqual(body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } })
  assert.equal(body.contents.length, 1)
  assert.equal(body.contents[0].role, 'user')
  assert.match(body.contents[0].parts[0].text, /A cat[\s\S]*Blue background/)
  assert.deepEqual(body.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } })
  assert.equal(body.contents[0].parts.length, 2)
  assert.deepEqual(input, original)
  assert.equal(buildCreationPayload({ ...resolved, imageOptions: { ...resolved.imageOptions, imageStream: true } }).path,
    'v1beta/models/native-image:streamGenerateContent?alt=sse')
  const manual = resolveCreationModelSettings(validateCreationInput({ ...original, apiFormat: 'images' }), setting)
  assert.equal(buildCreationPayload(manual).path, 'v1/images/edits')
  const explicit = resolveCreationModelSettings(validateCreationInput({ ...original, aspect_ratio: '9:16', imageOptions: { resolution: '4k' } }), setting)
  assert.deepEqual(JSON.parse(buildCreationPayload(explicit).body).generationConfig.imageConfig, { aspectRatio: '9:16', imageSize: '4K' })
  assert.equal(buildCreationPayload({ kind: 'image', model: 'gemini-3-pro-image', prompt: 'old request' }).path, 'v1/chat/completions')
  assert.equal(modelTypesSchema.safeParse([{ ...setting, protocol: 'async' }]).success, false)
  for (const patch of [{ n: 2 }, { protocol: 'async' }, { model: '../escape' }, { referenceUrls: ['https://private.example/image'] }])
    assert.throws(() => buildCreationPayload({ ...resolved, ...patch }), { statusCode: 400 })
})

test('Gemini image results ignore thought images and report safety blocks and unsupported results', () => {
  const part = { inlineData: { mimeType: 'image/webp', data: 'aW1hZ2U=' } }
  const response = { candidates: [{ content: { parts: [{ ...part, thought: true }, { text: 'Image' }, part] }, finishReason: 'STOP' }] }
  assert.deepEqual(normalizeCreationTask('image', response), { status: 'succeeded', outputs: [{ url: 'data:image/webp;base64,aW1hZ2U=' }] })
  assert.equal(normalizeCreationTask('image', { promptFeedback: { blockReason: 'SAFETY' } }).status, 'failed')
  assert.equal(normalizeCreationTask('image', { candidates: [{ ...response.candidates[0], finishReason: 'IMAGE_SAFETY' }] }).status, 'failed')
  assert.equal(normalizeCreationTask('image', { candidates: [{ content: { parts: [{ ...part, thought: true }] }, finishReason: 'STOP' }] }).status, 'indeterminate')
  assert.equal(normalizeCreationTask('image', { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'text/html', data: 'aW1hZ2U=' } }] } }] }).status, 'indeterminate')
})

test('Gemini image streams handle fragmented native parts and require a terminal candidate', async () => {
  const input = { kind: 'image', model: 'native-image', prompt: 'Image', apiFormat: 'gemini' }
  const thought = { inlineData: { mimeType: 'image/png', data: 'dGhvdWdodA==' }, thought: true }
  const image = { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }
  const event = (parts, finishReason) => `data: ${JSON.stringify({ candidates: [{ content: { parts }, ...(finishReason ? { finishReason } : {}) }] })}\r\n\r\n`
  const wire = new TextEncoder().encode(event([thought]) + event([image]) + event([], 'STOP'))
  const response = new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < wire.length; index += 7) controller.enqueue(wire.slice(index, index + 7))
    controller.close()
  } }))
  const previews = [], result = await readGenerationStream(response, input, event => previews.push(event.url))
  assert.equal(result.status, 'succeeded')
  assert.deepEqual(result.outputs, [{ url: 'data:image/png;base64,aW1hZ2U=' }])
  assert.deepEqual(previews, ['data:image/png;base64,aW1hZ2U='])
  await assert.rejects(readGenerationStream(new Response(event([image]) + 'data: [DONE]\n\n'), input, () => {}), /中断/)
  const blocked = await readGenerationStream(new Response(event([], 'IMAGE_SAFETY')), input, () => {})
  assert.equal(blocked.status, 'failed')
})

test('Gemini converted image responses retain Markdown images across text parts without exposing thoughts', () => {
  const image = `data:${'image/png'};base64,${Buffer.from('image').toString('base64')}`
  const remote = 'https://media.example/converted.png'
  const parts = [{ text: '![Image](https://media.example/thought.png)', thought: true },
    { text: `![Image](${remote})\n![Generated ` }, { text: `Image](${image})` },
    { inlineData: { mimeType: 'image/png', data: Buffer.from('image').toString('base64') } }]
  const response = { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] }
  const result = normalizeCreationTask('image', response)
  assert.equal(result.status, 'succeeded')
  assert.deepEqual(new Set(result.outputs.map(output => output.url)), new Set([remote, image]))
  assert.equal(result.outputs.length, 2)
  assert.equal(normalizeCreationTask('image', { candidates: [{ content: { parts }, finishReason: 'IMAGE_SAFETY' }] }).status, 'failed')
  for (const text of ['No image was generated.', '![Image](javascript:alert)', '![Image](data:text/html;base64,aGk=)']) {
    assert.equal(normalizeCreationTask('image', { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }).status, 'indeterminate')
  }
  const tooMany = Array.from({ length: 11 }, (_, index) => `![Image](https://media.example/${index}.png)`).join('\n')
  assert.equal(normalizeCreationTask('image', { candidates: [{ content: { parts: [{ text: tooMany }] }, finishReason: 'STOP' }] }).status, 'indeterminate')
})

test('Gemini converted image streams join long Markdown across events and keep block and truncation checks', async () => {
  const input = { kind: 'image', model: 'native-image', prompt: 'Image', apiFormat: 'gemini' }
  const image = `data:${'image/png'};base64,${Buffer.alloc(192, 1).toString('base64')}`
  const markdown = `![Generated Image](${image})`
  const frame = (parts, finishReason) => `data: ${JSON.stringify({ candidates: [{ content: { parts }, ...(finishReason ? { finishReason } : {}) }] })}\r\n\r\n`
  const thoughts = frame([{ text: '![Image](https://media.example/thought.png)', thought: true }])
  const wire = thoughts + [...markdown].map(text => frame([{ text }])).join('')
  const previews = [], result = await readGenerationStream(new Response(wire + frame([], 'STOP')), input, event => previews.push(event.url))
  assert.deepEqual(result.outputs, [{ url: image }])
  assert.deepEqual(previews, [image])
  await assert.rejects(readGenerationStream(new Response(wire + 'data: [DONE]\n\n'), input, () => {}), /中断/)
  assert.equal((await readGenerationStream(new Response(wire + frame([], 'IMAGE_SAFETY')), input, () => {})).status, 'failed')
  await assert.rejects(readGenerationStream(new Response(frame(Array(65).fill({ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }), 'STOP')), input, () => {}), /超过限制/)
})

test('automatic video configuration selects parameter families without changing the task interface', () => {
  for (const parameterFormat of ['openai', 'xai', 'seedance', 'gemini']) {
    const setting = { id: 'custom-video', kind: 'video', apiFormat: 'openai', protocol: 'async',
      video: { autoResolution: '720p', autoAspectRatio: '9:16', parameterFormat } }
    const input = validateCreationInput({ kind: 'video', model: setting.id, prompt: 'water', duration: 8, size: 'auto',
      aspect_ratio: 'auto', apiFormat: 'auto', protocol: 'auto', videoOptions: { mode: 'text-to-video', generateAudio: true } })
    const payload = buildCreationPayload(resolveCreationModelSettings(input, setting), [], [], setting.video)
    const sent = typeof payload.body === 'string' ? JSON.parse(payload.body) : Object.fromEntries(payload.body.entries())
    const metadata = typeof sent.metadata === 'string' ? JSON.parse(sent.metadata) : sent.metadata
    assert.equal(payload.path, 'async-videos/v1/tasks')
    assert.equal(metadata.resolution, '720p')
    if (parameterFormat === 'gemini') assert.equal(metadata.aspectRatio, '9:16')
    else if (parameterFormat === 'seedance') { assert.equal(metadata.ratio, '9:16'); assert.equal(metadata.generate_audio, true) }
    else assert.equal(metadata.aspect_ratio, '9:16')
  }
  const input = validateCreationInput({ kind: 'video', model: 'veo-3.1', prompt: 'water', duration: 8, size: 'auto',
    aspect_ratio: 'auto', videoOptions: { mode: 'text-to-video' } })
  const forcedOpenai = buildCreationPayload(input, [], [], { parameterFormat: 'openai' })
  assert(forcedOpenai.body instanceof FormData, 'an explicit OpenAI parameter format bypasses model-name inference')
})

test('backend automatic video ratio survives an automatic resolution and manual resolutions', () => {
  const setting = { id: 'custom-video', kind: 'video', video: { autoAspectRatio: '9:16', parameterFormat: 'seedance' } }
  for (const resolution of ['auto', '720p']) {
    const input = validateCreationInput({ kind: 'video', model: setting.id, prompt: 'water', duration: 8, size: 'auto',
      aspect_ratio: 'auto', videoOptions: { mode: 'text-to-video', resolution } })
    const payload = buildCreationPayload(resolveCreationModelSettings(input, setting), [], [], setting.video)
    assert.equal(JSON.parse(payload.body).metadata.ratio, '9:16')
  }
})

test('unconfigured automatic video ratios remain upstream defaults across compatible parameter families', () => {
  for (const parameterFormat of ['openai', 'xai', 'seedance', 'gemini']) {
    const input = validateCreationInput({ kind: 'video', model: 'custom-video', prompt: 'water', duration: 8,
      apiFormat: 'auto', protocol: 'auto', size: 'auto', aspect_ratio: 'auto', videoOptions: { mode: 'text-to-video' } })
    const payload = buildCreationPayload(resolveCreationModelSettings(input), [], [], { parameterFormat })
    const sent = typeof payload.body === 'string' ? JSON.parse(payload.body) : Object.fromEntries(payload.body.entries())
    const metadata = typeof sent.metadata === 'string' ? JSON.parse(sent.metadata) : sent.metadata
    for (const source of [sent, metadata ?? {}]) {
      for (const key of ['size', 'resolution', 'aspectRatio', 'aspect_ratio', 'ratio']) assert.equal(source[key], undefined)
    }
  }
})

test('image conversation context is bounded, image-only and cannot introduce arbitrary media schemes', () => {
  const image = 'https://media.example/previous.png'
  const context = { turns: [{ prompt: '一只猫', images: [image] }] }
  const input = validateCreationInput({ kind: 'image', model: 'gpt-image-2', prompt: '换成蓝色背景', imageContext: context })
  assert.deepEqual(input.imageContext, context)
  for (const patch of [
    { kind: 'video' }, { imageContext: null }, { imageContext: { turns: Array(21).fill(context.turns[0]) } },
    { imageContext: { turns: [{ prompt: '猫', images: Array(17).fill(image) }] } },
    { imageContext: { turns: [{ prompt: '猫'.repeat(32001), images: [image] }] } },
    { imageContext: { turns: [{ prompt: '猫', images: ['file:///private'] }] } },
    { imageContext: { turns: [{ prompt: '猫', images: ['blob:other-account'] }] } },
    { imageContext: { turns: [{ prompt: '猫', images: [image], references: ['file:///private'] }] } },
    { imageContext: { turns: [{ prompt: '猫', images: [image], references: Array(16).fill(image) }] } },
    { imageContext: { turns: [{ prompt: '猫', images: ['/api/creation/media?path=api/user/self'] }] } },
  ]) assert.throws(() => validateCreationInput({ ...input, ...patch }), { statusCode: 400 })
})

test('Images requests retain ordered creation instructions and references while Gemini receives actual multimodal history', () => {
  const image = 'data:image/png;base64,aW1hZ2U='
  const input = { kind: 'image', model: 'gpt-image-2', prompt: '背景换蓝色', referenceUrls: [image],
    imageContext: { turns: [{ prompt: '一只猫', images: [image] }, { prompt: '戴上帽子', images: [image] }] } }
  const edit = buildCreationPayload(input)
  assert.equal(edit.path, 'v1/images/edits')
  assert.match(edit.body.get('prompt'), /1\. 一只猫\n2\. 戴上帽子/)
  assert.match(edit.body.get('prompt'), /当前要求：\n背景换蓝色$/)
  assert.equal(edit.body.getAll('image[]').length, 1)
  assert.equal(input.prompt, '背景换蓝色', 'UI/publication prompt stays the original turn')
  const chat = JSON.parse(buildCreationPayload({ ...input, model: 'gemini-3.1-flash-image-preview', imageOptions: { imageStream: true } }).body)
  assert.deepEqual(chat.messages.map(message => message.role), ['user', 'assistant', 'user', 'assistant', 'user'])
  assert.equal(chat.messages[0].content, '一只猫')
  assert.equal(chat.messages[1].content[0].image_url.url, image)
  assert.equal(chat.messages.at(-1).content[0].text, '背景换蓝色')
  assert.equal(chat.stream, true)
  assert.throws(() => buildCreationPayload({ ...input, prompt: 'x'.repeat(32000) }), { statusCode: 400 })
  const attached = JSON.parse(buildCreationPayload({ ...input, model: 'gemini-3.1-flash-image-preview',
    imageContext: { turns: [{ prompt: '让参考中的人物合影', references: [image, 'https://media.example/person.png'], images: [image] }] } }).body)
  assert.deepEqual(attached.messages[0].content, [{ type: 'text', text: '让参考中的人物合影' },
    { type: 'image_url', image_url: { url: image } }, { type: 'image_url', image_url: { url: 'https://media.example/person.png' } }])
  assert.deepEqual(attached.messages[1].content, [{ type: 'image_url', image_url: { url: image } }])
})

test('Gemini image chat streams parse fragmented Markdown and image blocks instead of the Images event protocol', async () => {
  const image = 'data:image/png;base64,aW1hZ2U='
  const input = { kind: 'image', model: 'gemini-3.1-flash-image-preview', prompt: '猫' }
  const events = [
    { choices: [{ delta: { content: '![Generated Image](' } }] },
    { choices: [{ delta: { content: `${image})` } }] },
    { choices: [{ delta: { content: [{ type: 'image_url', image_url: { url: 'https://media.example/image.png' } }] }, finish_reason: 'stop' }] },
  ]
  const wire = events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
  const chunks = new TextEncoder().encode(wire), previews = []
  const response = new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < chunks.length; index += 7) controller.enqueue(chunks.slice(index, index + 7))
    controller.close()
  } }))
  const result = await readGenerationStream(response, input, event => previews.push(event))
  assert.equal(result.status, 'succeeded')
  assert.deepEqual(result.outputs, [{ url: image }, { url: 'https://media.example/image.png' }])
  assert(previews.some(event => event.type === 'preview' && event.url === image))
  await assert.rejects(readGenerationStream(new Response(`data: ${JSON.stringify(events[0])}\n\n`), input, () => {}), /中断/)
})

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

test('image requests allow ten outputs while retaining the separate sixteen-reference limit', () => {
  const input = { kind: 'image', model: 'gpt-image-2', prompt: 'Images', n: 10,
    referenceUrls: Array(16).fill('https://media.example/reference.png') }
  const accepted = validateCreationInput(input)
  assert.equal(accepted.n, 10)
  assert.equal(accepted.referenceUrls.length, 16)
  for (const n of [11, 16]) assert.throws(() => validateCreationInput({ ...input, n }), {
    statusCode: 400, code: 'INVALID_CREATION_REQUEST', message: '生成数量须为 1 至 10。',
  })
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

test('image quality auto is omitted while explicit qualities survive JSON and multipart in both protocols', () => {
  for (const quality of [undefined, 'auto', 'low', 'medium', 'high', 'xhigh', 'max']) {
    for (const protocol of ['openai', 'async']) for (const referenceUrls of [[], ['https://media.example/reference.png']]) {
      const input = validateCreationInput({ kind: 'image', model: 'gpt-image-2', prompt: 'Image',
        protocol, referenceUrls, imageOptions: { quality } })
      const { body } = buildCreationPayload(input, [{ blob: new Blob(['image'], { type: 'image/png' }), name: 'reference.png' }])
      const payload = body instanceof FormData ? Object.fromEntries(body.entries()) : JSON.parse(body)
      assert.equal(Object.hasOwn(payload, 'quality'), Boolean(quality && quality !== 'auto'))
      if (quality && quality !== 'auto') assert.equal(payload.quality, quality)
      assert.equal(input.imageOptions.quality, quality || 'auto')
    }
  }
})

test('async Images payloads omit streaming fields in JSON and multipart without changing synchronous requests', () => {
  for (const imageStream of [false, true]) for (const referenceUrls of [[], ['https://media.example/reference.png']]) {
    const input = validateCreationInput({ kind: 'image', model: 'gpt-image-2', prompt: 'Image',
      referenceUrls, imageOptions: { imageStream, imagePartialImages: 2 } })
    for (const protocol of ['openai', 'async']) {
      const { body } = buildCreationPayload({ ...input, protocol },
        [{ blob: new Blob(['image'], { type: 'image/png' }), name: 'reference.png' }])
      const payload = body instanceof FormData ? Object.fromEntries(body.entries()) : JSON.parse(body)
      assert.equal(Object.hasOwn(payload, 'stream'), protocol === 'openai')
      assert.equal(Object.hasOwn(payload, 'partial_images'), protocol === 'openai' && imageStream)
      if (protocol === 'openai') assert.equal(payload.stream, body instanceof FormData ? String(imageStream) : imageStream)
    }
    assert.equal(input.imageOptions.imageStream, imageStream)
  }
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

test('all final video payloads reject invalid durations with an actionable 400', () => {
  for (const protocol of ['openai', 'async']) for (const videoOptions of [undefined, { mode: 'text-to-video', resolution: '720p' }]) {
    const input = validateCreationInput({ kind: 'video', model: 'sora-2', prompt: 'Video', duration: 5, protocol, videoOptions })
    assert.throws(() => buildCreationPayload(input), {
      statusCode: 400, code: 'INVALID_CREATION_REQUEST', message: '当前模型和生成方式仅支持 4 / 8 / 12 秒，请调整视频时长',
    })
  }
})

test('unknown video models can use the compatible protocol without a local model registration', () => {
  for (const videoOptions of [undefined, { mode: 'text-to-video', resolution: '480p' }]) {
    const input = validateCreationInput({ kind: 'video', model: 'unknown-video-model', prompt: 'Video', duration: 8, videoOptions })
    const payload = buildCreationPayload(input)
    assert.equal(payload.path, 'v1/videos')
    assert.equal(payload.body.get('model'), 'unknown-video-model')
    assert.equal(payload.body.get('seconds'), '8')
  }
})

test('video request builder errors become safe actionable 400 responses', () => {
  const input = validateCreationInput({ kind: 'video', model: 'seedance-2-0', prompt: 'Video', duration: 8,
    videoOptions: { mode: 'text-to-video', resolution: '720p', customParameters: '{"input_reference":"unsupported"}' } })
  assert.throws(() => buildCreationPayload(input), {
    statusCode: 400, code: 'INVALID_CREATION_REQUEST', message: 'Seedance 兼容格式请使用参考素材或 metadata.content 传入参考图',
  })
  const malformed = validateCreationInput({ ...input, model: 'sora-2',
    videoOptions: { mode: 'text-to-video', resolution: '720p', customParameters: '{"metadata":"not-json"}' } })
  assert.throws(() => buildCreationPayload(malformed), {
    statusCode: 400, code: 'INVALID_CREATION_REQUEST', message: '视频参数格式无效，请检查自定义参数。',
  })
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
  const inherited = validateCreationInput({ ...input, size: '1200x900', exactSize: true, imageOptions: { seed: '42' } })
  assert.equal(inherited.size, 'auto')
  assert.equal(inherited.exactSize, undefined)
  assert.equal(inherited.imageOptions.seed, '')
  assert.deepEqual(JSON.parse(buildCreationPayload(inherited).body), body)
})

test('OpenAI video uses existing multipart transport while compatible model families retain JSON metadata', () => {
  const input = { kind: 'video', model: 'sora-2', prompt: 'Video', duration: 8, size: '1280x720', aspect_ratio: '16:9' }
  const openai = buildCreationPayload(input)
  assert.equal(openai.path, 'v1/videos')
  assert(openai.body instanceof FormData)
  assert.equal(openai.body.get('seconds'), '8')
  assert.equal(openai.body.get('size'), '1280x720')
  const seedance = buildCreationPayload({ ...input, model: 'seedance-2-0', referenceUrls: ['https://media.example/reference.png'] })
  assert.equal(seedance.path, 'v1/videos')
  assert.equal(JSON.parse(seedance.body).metadata.content[0].role, 'reference_image')
  const grok = JSON.parse(buildCreationPayload({ ...input, model: 'grok-imagine-video', referenceUrls: ['https://media.example/reference.png'] }).body)
  assert.equal(grok.input_reference, 'https://media.example/reference.png')
  assert.equal(grok.metadata.aspect_ratio, '16:9')
  assert.equal(buildCreationPayload({ ...input, protocol: 'async' }).path, 'async-videos/v1/tasks')
  assert.throws(() => buildCreationPayload({ ...input, n: 2 }), { statusCode: 400 })
})

test('Veo preserves embedded PNG/JPEG/WebP references and requires remote images to be converted first', () => {
  const input = { kind: 'video', model: 'veo-3', prompt: 'Video', aspect_ratio: '9:16', duration: 8 }
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
  for (const status of ['queued', 'running', 'unknown', undefined]) {
    assert.equal(normalizeCreationTask('video', { id: 'job-1', status, message: 'Provider message' }).status, 'pending')
  }
})

test('download stages require an explicit active upstream state and never override failures', () => {
  for (const kind of ['image', 'video']) {
    for (const status of ['saving', 'downloading']) {
      const task = normalizeCreationTask(kind, { data: { id: 'job-1', status } })
      assert.equal(task.status, 'pending')
      assert.equal(task.stage, 'downloading')
      assert.deepEqual(task.outputs, [])
    }
    for (const status of ['queued', 'running', 'failed', 'save_failed', 'indeterminate', 'completed']) {
      assert.equal(normalizeCreationTask(kind, { id: 'job-1', status, progress: 99 }).stage, undefined)
    }
    const failure = normalizeCreationTask(kind, { success: false, data: { id: 'job-1', status: 'saving' } })
    assert.equal(failure.status, 'failed')
    assert.equal(failure.stage, undefined)
  }
})

test('task state aliases preserve terminal failure messages and IDs', () => {
  const result = normalizeCreationTask('video', { id: 'job-1', state: 'error', message: 'Provider failed' })
  assert.deepEqual(result, { id: 'job-1', upstreamId: 'job-1', status: 'failed', outputs: [], error: 'Provider failed' })
})

test('explicit unsuccessful task responses cannot stay pending', () => {
  for (const value of [
    { id: 'job-1', success: false, message: 'Provider failed' },
    { success: false, message: 'Provider failed', data: { id: 'job-1', status: 'queued' } },
  ]) {
    assert.deepEqual(normalizeCreationTask('video', value),
      { id: 'job-1', upstreamId: 'job-1', status: 'failed', outputs: [], error: 'Provider failed' })
  }
})

test('outer task failures override inner queued states and keep the original error', () => {
  for (const failure of [
    { success: false, error: { message: 'Provider failed' } },
    { error: 'Provider failed' },
    { fail_reason: 'Provider failed' },
    { status: 'failed', message: 'Provider failed' },
    { state: 'error', message: 'Provider failed' },
  ]) {
    assert.deepEqual(normalizeCreationTask('video', { ...failure, data: { id: 'job-1', status: 'queued' } }),
      { id: 'job-1', upstreamId: 'job-1', status: 'failed', outputs: [], error: 'Provider failed' })
  }
})

test('task error codes supply safe fallback reasons without replacing provider messages or terminal states', () => {
  for (const [error, message, expected] of [
    [{ code: 'missing_upstream_image' }, undefined, '上游未返回有效图片链接或图片数据'],
    [{ code: 'provider_task_failed' }, undefined, '上游返回错误：provider_task_failed'],
    [{ code: 'constructor' }, undefined, '上游返回错误：constructor'],
    [{ code: '<private-provider-url>' }, undefined, '生成失败。'],
    ['供应商原始错误', undefined, '供应商原始错误'],
    [{ code: 'missing_upstream_image', message: '供应商原始错误' }, undefined, '供应商原始错误'],
    [{ code: 'missing_upstream_image' }, '供应商说明', '供应商说明'],
  ]) {
    assert.deepEqual(normalizeCreationTask('image', { id: 'job_1', status: 'failed', error, message }),
      { id: 'job_1', upstreamId: 'job_1', status: 'failed', outputs: [], error: expected })
  }
  for (const status of ['save_failed', 'indeterminate', 'expired']) {
    const result = normalizeCreationTask('image', { id: 'job_1', status, error: { code: 'image_storage_capacity_reached' } })
    assert.equal(result.status, status)
    assert.equal(result.upstreamId, 'job_1')
    assert.equal(result.error, '图片保存空间不足，勿重复生成，请联系管理员')
  }
  const wrapped = normalizeCreationTask('image', { error: { message: '供应商原始错误' },
    data: { id: 'job_1', status: 'failed', error: { code: 'missing_upstream_image' } } })
  assert.equal(wrapped.error, '供应商原始错误')
  assert.deepEqual(normalizeCreationTask('video', { id: 'job_1', status: 'indeterminate', error: { code: 'generation_outcome_unknown' } }),
    { id: 'job_1', upstreamId: 'job_1', status: 'indeterminate', outputs: [], error: '暂时无法确认生成结果，原任务记录已保留，请核对使用记录，避免重复生成。' })
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
