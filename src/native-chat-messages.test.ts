import { beforeEach, expect, it, vi } from 'vitest'
import type { NativeMessage } from './native-chat'
import type { StudioToolActivity } from './studio-message-types'
import type { ChatApiFormat } from '../shared/studio/chat-api-format'

const mocks = vi.hoisted(() => ({
  write: vi.fn(async (_key: string, _snapshot: unknown) => {}),
  read: vi.fn(), api: vi.fn(), submit: vi.fn(), confirm: vi.fn(() => true),
  modelFormat: vi.fn<() => ChatApiFormat | undefined>(), configuredModelFormat: vi.fn<() => ChatApiFormat | undefined>(),
}))
vi.mock('./state', async () => {
  const { reactive } = await import('vue')
  return { session: reactive({ user: null as any }), api: mocks.api, errorMessage: (error: Error) => error.message }
})
vi.mock('./native-studio', () => ({
  creation: { tasks: [], modelTokenId: 7, selectedGroup: 'default' },
  resumeCreation: vi.fn(), stopCreation: vi.fn(), submitCreation: mocks.submit,
}))
vi.mock('./model-preferences', () => ({ modelFormat: mocks.modelFormat, configuredModelFormat: mocks.configuredModelFormat }))
vi.mock('../shared/studio/chat-persistence', () => ({ readChatSnapshot: mocks.read, writeChatSnapshot: mocks.write }))
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  mocks.read.mockReset(); mocks.write.mockReset().mockResolvedValue(undefined)
  mocks.modelFormat.mockReset(); mocks.configuredModelFormat.mockReset()
  mocks.submit.mockReset().mockImplementation(async (_input, update) => {
    const task = { id: 'task', owner: '17', phase: 'complete', text: '回答', toolCalls: [] }
    update?.(task)
    return task
  })
  mocks.api.mockReset().mockResolvedValue({ ok: true }); mocks.confirm.mockReturnValue(true)
  vi.stubGlobal('window', { confirm: mocks.confirm })
})

async function fixture() {
  const { session } = await import('./state')
  const logic = await import('./native-chat')
  session.user = { id: '17', accountId: '17' } as any
  logic.newChat()
  logic.chats.ready = true
  const chat = logic.chats.sessions[0]!
  return { ...logic, session, chat }
}
function optionSource(): NativeMessage {
  return { id: 'source', role: 'assistant', content: '选择方向', interactions: { options: {
    id: 'q', question: '方向', selection: 'single', options: [{ id: 'a', label: '第一项' }, { id: 'b', label: '第二项' }],
  } } }
}
function toolSource() {
  const tool: StudioToolActivity = { id: 'call', name: 'mcp_original', servers: ['original'], arguments: { x: 1 }, status: 'complete', result: { old: true }, requestId: 'original-request' }
  const source: NativeMessage = { id: 'source', role: 'assistant', content: '工具完成', tools: [tool], toolRounds: [
    { role: 'assistant', content: '', tool_calls: [{ id: 'call', type: 'function', function: { name: tool.name, arguments: '{"x":1}' } }] },
    { role: 'tool', content: '{"old":true}', tool_call_id: 'call' },
  ] }
  return source
}
it('uses the configured format for automatic chats without replacing the stored setting', async () => {
  const p = await fixture()
  const prepare = vi.spyOn(await import('../shared/studio/video-input'), 'prepareVideoMessages')
  mocks.configuredModelFormat.mockReturnValue('responses')
  await p.sendChat(p.chat, '自动格式', [], 'model')
  expect(mocks.submit.mock.calls[0]?.[0]).toMatchObject({ apiFormat: 'auto', chatOptions: { format: 'responses' } })
  expect(prepare).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ format: 'responses' }))
  prepare.mockRestore()
  expect(p.chat.settings.format).toBe('chat-completions')
})
for (const format of ['chat-completions', 'responses'] as const) {
  it(`preserves a legacy ${format} selection and keeps model and conversation overrides above it`, async () => {
    const p = await fixture()
    delete p.chat.formatAutomatic
    p.chat.settings.format = format
    mocks.configuredModelFormat.mockReturnValue('claude')
    await p.sendChat(p.chat, '保留旧格式', [], 'model')
    expect(mocks.submit.mock.calls.at(-1)?.[0]).toMatchObject({ apiFormat: format, chatOptions: { format } })
    mocks.modelFormat.mockReturnValue('gemini')
    await p.sendChat(p.chat, '保留模型手选', [], 'model')
    expect(mocks.submit.mock.calls.at(-1)?.[0]).toMatchObject({ apiFormat: 'gemini', chatOptions: { format: 'gemini' } })
    p.chat.formatOverride = 'responses'
    await p.sendChat(p.chat, '保留对话手选', [], 'model')
    expect(mocks.submit.mock.calls.at(-1)?.[0]).toMatchObject({ apiFormat: 'responses', chatOptions: { format: 'responses' } })
  })
}
it('shows compression only during real summary calls and marks completion after context preparation succeeds', async () => {
  const p = await fixture()
  p.chat.compressionThreshold = 500
  p.chat.messages.push({ id: 'old', role: 'user', content: '历史记录'.repeat(1000) })
  let release!: () => void
  mocks.submit.mockImplementationOnce(async () => new Promise(resolve => {
    release = () => resolve({ id: 'summary', phase: 'complete', text: '精简摘要' })
  }))
  const sending = p.sendChat(p.chat, '继续', [], 'model')
  await vi.waitFor(() => expect(p.chat.messages.at(-1)?.contextCompressing).toBe(true))
  expect(p.chat.messages.at(-1)?.contextCompressed).toBeUndefined()
  release()
  await sending
  expect(p.chat.messages.at(-1)).toMatchObject({ contextCompressing: false, contextCompressed: true })
  expect(mocks.submit).toHaveBeenCalledTimes(2)
})
it('clears compression immediately when stopped and does not submit the answer after a late summary', async () => {
  const p = await fixture()
  p.chat.compressionThreshold = 500
  p.chat.messages.push({ id: 'old', role: 'user', content: '历史记录'.repeat(1000) })
  let release!: () => void
  mocks.submit.mockImplementationOnce(async () => new Promise(resolve => {
    release = () => resolve({ id: 'summary', phase: 'complete', text: '精简摘要' })
  }))
  const sending = p.sendChat(p.chat, '继续', [], 'model')
  await vi.waitFor(() => expect(p.chat.messages.at(-1)?.contextCompressing).toBe(true))
  p.stopChat(p.chat)
  expect(p.chat.messages.at(-1)).toMatchObject({ contextCompressing: false, interrupted: true })
  release()
  await sending
  expect(mocks.submit).toHaveBeenCalledTimes(1)
  expect(p.chat.messages.at(-1)?.contextCompressed).toBeUndefined()
})
it('does not label invalid summaries as successfully compressed', async () => {
  const p = await fixture()
  p.chat.compressionThreshold = 500
  p.chat.messages.push({ id: 'old', role: 'user', content: '历史记录'.repeat(1000) })
  mocks.submit.mockResolvedValueOnce({ id: 'summary', phase: 'complete', text: '过长'.repeat(10000) })
  await p.sendChat(p.chat, '继续', [], 'model')
  expect(p.chat.messages.at(-1)).toMatchObject({ contextCompressing: false, interrupted: true })
  expect(p.chat.messages.at(-1)?.contextCompressed).toBeUndefined()
  expect(p.chat.messages[0]?.content).toBe('历史记录'.repeat(1000))
})
it('shows a tool-level failure even when a manually rerun MCP request returns HTTP success', async () => {
  const p = await fixture(), source = toolSource()
  p.chat.settings.mcpServers = ['original']; p.chat.messages.push(source)
  const message = p.chat.messages[0]!, tool = message.tools![0]!
  mocks.api.mockResolvedValueOnce({ isError: true, content: [{ type: 'text', text: '工具参数无效' }] })
  await expect(p.rerunMessageTool(p.chat, message, tool, { x: 2 })).rejects.toThrow('已保留上次结果')
  expect(tool).toMatchObject({ status: 'error', error: expect.stringContaining('工具执行失败'), result: { old: true } })
})
it('formats quoted input only for the request, preserving visible and persisted text', async () => {
  const p = await fixture()
  const quote = { messageId: 'old', role: 'assistant' as const, text: '引用原文' }
  expect(await p.sendChat(p.chat, '解释', [], 'model', undefined, undefined, { quote })).toBe(true)
  expect(p.chat.messages[0]).toMatchObject({ content: '解释', quote })
  const input = mocks.submit.mock.calls[0]![0]
  expect(input.chatOptions.messages.at(-1).content).toBe('引用内容：\n> 引用原文\n\n解释')
  expect(input.chatOptions.messages[0].content).toContain(p.chat.messages[1]!.id)
  expect(mocks.write.mock.calls.at(-1)![1]).toMatchObject({ state: { sessions: [{ messages: [{ content: '解释', quote }, { content: '回答' }] }] } })
})
it('preserves an explicitly renamed default title after sending', async () => {
  const p = await fixture()
  p.chat.topic = '新对话'
  p.chat.renamed = true
  expect(await p.sendChat(p.chat, '不要替换手动名称', [], 'model')).toBe(true)
  expect(p.chat.topic).toBe('新对话')
})
it('binds final interactions to the actual assistant ID and hides the footer while streaming', async () => {
  const p = await fixture()
  mocks.submit.mockImplementationOnce(async (_input, update) => {
    const id = p.chat.messages.at(-1)!.id
    const task = { id: 'task', owner: '17', phase: 'complete', text: '正文\n```chat-ui\n' + JSON.stringify({ version: 1, messageId: id, suggestions: ['继续'] }) + '\n```' }
    update(task)
    expect(p.chat.messages.at(-1)).toMatchObject({ content: '正文', interactions: undefined, streaming: true })
    return task
  })
  await p.sendChat(p.chat, '问题', [], 'model')
  expect(p.chat.messages.at(-1)).toMatchObject({ content: '正文', interactions: { suggestions: ['继续'] }, streaming: false })
})
it('submits valid choices once and persists the receipt before requesting the model', async () => {
  const p = await fixture(); p.chat.messages.push(optionSource())
  const source = p.chat.messages[0]!
  mocks.submit.mockImplementationOnce(async () => {
    expect(source.optionReceipt).toMatchObject({ selectedIds: ['b'], userMessageId: p.chat.messages[1]!.id })
    expect(mocks.write.mock.calls[0]![1]).toMatchObject({ state: { sessions: [{ messages: [{ optionReceipt: { selectedIds: ['b'] } }, {}, {}] }] } })
    return { id: 'task', phase: 'error', text: '', error: 'upstream failed' }
  })
  expect(await p.submitMessageOptions(p.chat, source, ['b'], 'model')).toBe(true)
  expect(p.chat.messages[1]!.content).toBe('针对“方向”，我的选择：\n- 第二项')
  expect(await p.submitMessageOptions(p.chat, source, ['a'], 'model')).toBe(false)
  expect(mocks.submit).toHaveBeenCalledTimes(1)
})
it('rejects invalid selections and rolls back unsaved choices without requesting the model', async () => {
  const p = await fixture(); p.chat.messages.push(optionSource())
  const source = p.chat.messages[0]!
  expect(await p.submitMessageOptions(p.chat, source, ['missing'], 'model')).toBe(false)
  mocks.write.mockRejectedValueOnce(new Error('disk full'))
  expect(await p.submitMessageOptions(p.chat, source, ['a'], 'model')).toBe(false)
  expect(p.chat.messages.map(message => message.id)).toEqual(['source'])
  expect(source.optionReceipt).toBeUndefined()
  expect(mocks.submit).not.toHaveBeenCalled()
})
it('does not write a previous account after switching during the first save', async () => {
  const p = await fixture(); p.chat.messages.push(optionSource())
  let release!: () => void
  mocks.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  const sending = p.submitMessageOptions(p.chat, p.chat.messages[0]!, ['a'], 'model')
  await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1))
  p.session.user = { id: '18', accountId: '18' } as any
  release()
  await sending
  expect(p.chats.sessions).toEqual([])
  expect(mocks.submit).not.toHaveBeenCalled()
  expect(mocks.write).toHaveBeenCalledTimes(1)
})
it('edits assistant content locally and restores it if saving fails', async () => {
  const p = await fixture(); p.chat.messages.push(optionSource())
  const source = p.chat.messages[0]!
  const metadata = source.interactions
  mocks.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.editAssistantMessage(p.chat, source, '未保存')).rejects.toThrow('disk full')
  expect(source.content).toBe('选择方向'); expect(source.interactions).toBe(metadata)
  source.optionReceipt = { selectedIds: ['a'], userMessageId: 'original-response' }
  await p.editAssistantMessage(p.chat, source, '更正文案')
  expect(source.content).toBe('更正文案'); expect(source.interactions).toBeUndefined()
  expect(source.optionReceipt).toEqual({ selectedIds: ['a'], userMessageId: 'original-response' })
  mocks.write.mockRejectedValueOnce(new Error('disk full'))
  await expect(p.editAssistantMessage(p.chat, source, '未保存')).rejects.toThrow('disk full')
  expect(source.content).toBe('更正文案')
  expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.api).not.toHaveBeenCalled()
})
it('reruns only the original enabled tool with confirmation and updates future model context', async () => {
  const p = await fixture(); p.chat.settings.mcpServers = ['original']; p.chat.messages.push(toolSource())
  const source = p.chat.messages[0]!, tool = source.tools![0]!
  await p.rerunMessageTool(p.chat, source, tool, { x: 2 })
  expect(mocks.confirm).toHaveBeenCalledTimes(1)
  expect(mocks.api).toHaveBeenCalledWith('/api/creation/mcp/call', expect.objectContaining({ expectedAccount: '17', body: expect.objectContaining({ servers: ['original'], name: 'mcp_original', arguments: { x: 2 } }) }))
  expect(tool).toMatchObject({ status: 'complete', result: { ok: true }, arguments: { x: 2 } })
  expect(tool.requestId).not.toBe('original-request')
  expect(source.toolRounds?.[0]?.tool_calls?.[0]?.function.arguments).toBe('{"x":2}')
  expect(source.toolRounds?.[1]?.content).toBe('{"ok":true}')
})
it('never executes unregistered, disabled or unconfirmed tools and preserves the result on failure', async () => {
  const p = await fixture(); p.chat.settings.mcpServers = ['original']; p.chat.messages.push(toolSource())
  const source = p.chat.messages[0]!, tool = source.tools![0]!
  await expect(p.rerunMessageTool(p.chat, source, { ...tool, name: 'forged' }, {})).rejects.toThrow()
  p.chat.settings.mcpServers = []
  await expect(p.rerunMessageTool(p.chat, source, tool, {})).rejects.toThrow()
  p.chat.settings.mcpServers = ['original']; mocks.confirm.mockReturnValueOnce(false)
  await p.rerunMessageTool(p.chat, source, tool, { x: 2 })
  expect(mocks.api).not.toHaveBeenCalled()
  mocks.api.mockRejectedValueOnce(new Error('unknown remote result'))
  await expect(p.rerunMessageTool(p.chat, source, tool, { x: 3 })).rejects.toThrow()
  expect(tool).toMatchObject({ status: 'error', result: { old: true }, error: 'unknown remote result' })
  expect(p.chats.busy[p.chat.id]).toBe(false)
})
it('stops waiting for a rerun and ignores its late response', async () => {
  const p = await fixture(); p.chat.settings.mcpServers = ['original']; p.chat.messages.push(toolSource())
  const source = p.chat.messages[0]!, tool = source.tools![0]!
  let resolve!: (value: unknown) => void
  mocks.api.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const rerunning = p.rerunMessageTool(p.chat, source, tool, { x: 2 })
  await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1))
  p.stopChat(p.chat)
  expect(tool.status).toBe('stopped')
  expect(mocks.api.mock.calls[0]![1].signal.aborted).toBe(true)
  resolve({ late: true }); await rerunning
  expect(tool).toMatchObject({ status: 'stopped', result: { old: true } })
})
it('restores pending and archived tool steps without rerunning any request', async () => {
  const p = await fixture()
  const source = toolSource(); source.tools![0]!.status = 'running'
  const archived = { ...toolSource(), id: 'archived' }; archived.tools![0]!.status = 'pending'
  mocks.read.mockResolvedValueOnce({ state: { sessions: [{ ...p.chat, messages: [source], messageBranches: [archived] }], activeId: p.chat.id } })
  p.chats.ready = false
  await p.loadChats()
  const messages = [...p.chats.sessions[0]!.messages, ...p.chats.sessions[0]!.messageBranches || []]
  expect(messages.filter(message => message.tools).every(message => message.tools![0]!.status === 'stopped')).toBe(true)
  expect(mocks.api).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled()
})
it('keeps automatic tool request IDs bound to the original task and call, with explicit approval', async () => {
  const p = await fixture(); p.chat.settings.mcpServers = ['original']
  mocks.submit.mockResolvedValueOnce({ id: 'original-task', phase: 'complete', text: '', toolCalls: [{ id: 'original-call', type: 'function', function: { name: 'mcp_original', arguments: '{"x":1}' } }] })
  expect(await p.sendChat(p.chat, '执行工具', [], 'model')).toBe(true)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('original-task:original-call'))
  const expectedId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  expect(mocks.api).toHaveBeenCalledWith('/api/creation/mcp/call', expect.objectContaining({ body: expect.objectContaining({ requestId: expectedId, arguments: { x: 1 } }) }))
  expect(mocks.confirm).toHaveBeenCalledTimes(1)
  expect(p.chat.messages.at(-1)!.tools?.[0]).toMatchObject({ status: 'complete', result: { ok: true }, requestId: expectedId })
  expect(mocks.submit).toHaveBeenCalledTimes(2)
})
it('does not execute an automatic tool when approval is declined', async () => {
  const p = await fixture(); p.chat.settings.mcpServers = ['original']
  mocks.submit.mockResolvedValueOnce({ id: 'task', phase: 'complete', text: '', toolCalls: [{ id: 'call', type: 'function', function: { name: 'mcp_original', arguments: '{}' } }] })
  mocks.confirm.mockReturnValueOnce(false)
  expect(await p.sendChat(p.chat, '执行工具', [], 'model')).toBe(true)
  expect(mocks.api).not.toHaveBeenCalled()
  expect(p.chat.messages.at(-1)!.tools?.[0]).toMatchObject({ status: 'stopped', error: expect.stringContaining('未执行') })
})
it('rolls back a failed edited user branch before any model request', async () => {
  const p = await fixture()
  p.chat.messages.push({ id: 'user', role: 'user', content: [{ type: 'text', text: '原文' }, { type: 'image_url', image_url: { url: '/api/cache/reference.png' } }] }, { id: 'answer', role: 'assistant', content: '原回答' })
  const user = p.chat.messages[0]!
  mocks.write.mockRejectedValueOnce(new Error('disk full'))
  expect(await p.sendChat(p.chat, '新内容', [], 'model', undefined, user)).toBe(false)
  expect(p.chat.messages.map(message => message.id)).toEqual(['user', 'answer'])
  expect(p.chat.messages[0]!.content).toEqual([{ type: 'text', text: '原文' }, { type: 'image_url', image_url: { url: '/api/cache/reference.png' } }])
  expect(mocks.submit).not.toHaveBeenCalled()
})
it('remaps quote and option receipt links when cloning a chat', async () => {
  const p = await fixture()
  const source = optionSource()
  source.optionReceipt = { selectedIds: ['a'], userMessageId: 'response' }
  p.chat.messages.push(source, { id: 'response', role: 'user', content: '选择', quote: { messageId: 'source', role: 'assistant', text: '选择方向' }, optionResponse: { sourceMessageId: 'source', optionsId: 'q', selectedIds: ['a'] } })
  p.cloneChat(p.chat)
  const copy = p.chats.sessions[0]!
  expect(copy.id).not.toBe(p.chat.id)
  expect(copy.messages[1]!.quote?.messageId).toBe(copy.messages[0]!.id)
  expect(copy.messages[1]!.optionResponse?.sourceMessageId).toBe(copy.messages[0]!.id)
  expect(copy.messages[0]!.optionReceipt?.userMessageId).toBe(copy.messages[1]!.id)
})
it('regenerates an attachment-only original user message without inventing uploaded files', async () => {
  const p = await fixture()
  const content = [{ type: 'image_url' as const, image_url: { url: '/api/cache/reference.png' } }]
  p.chat.messages.push({ id: 'user', role: 'user', content }, { id: 'answer', role: 'assistant', content: '原回答' })
  expect(await p.sendChat(p.chat, '', [], 'model', p.chat.messages[0])).toBe(true)
  expect(mocks.submit).toHaveBeenCalledTimes(1)
  expect(mocks.submit.mock.calls[0]![0].chatOptions.messages.at(-1).content).toEqual(content)
  expect(p.chat.messages[0]).toMatchObject({ id: 'user', content })
  expect(p.chat.messages.at(-1)!.content).toBe('回答')
  expect(await p.sendChat(p.chat, '', [], 'model', { id: 'missing', role: 'user', content })).toBe(false)
  p.chats.sessions = []
  expect(await p.sendChat(p.chat, '', [], 'model', p.chat.messages[0])).toBe(false)
  expect(mocks.submit).toHaveBeenCalledTimes(1)
})
