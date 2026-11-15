import { describe, expect, it } from 'vitest'
import { createMessageQuote, formatQuoteInput, readMessageQuote } from '../shared/studio/message-quote'
import { extractMessageInteractions, formatOptionResponse, validateOptionSelection, type MessageInteractionOptions } from '../shared/studio/message-interactions'
import { getToolResult, getToolTable, parseToolArgumentInput, restoreInterruptedToolCalls, safeToolUrl, waitForToolResult } from '../shared/studio/tool-result'

const definition: MessageInteractionOptions = { id: 'q', question: '选择内容', selection: 'multiple', options: [{ id: 'a', label: '甲' }, { id: 'b', label: '乙' }], minSelections: 1, maxSelections: 2 }
const footer = (id = 'answer') => '正文\n```chat-ui\n' + JSON.stringify({ version: 1, messageId: id, suggestions: ['继续', '继续'], options: definition }) + '\n```'

describe('reused message interaction protocol', () => {
  it('extracts only a complete final footer bound to its answer and deduplicates suggestions', () => {
    expect(extractMessageInteractions(footer(), 'answer')).toEqual({ content: '正文', interactions: { suggestions: ['继续'], options: definition } })
    expect(extractMessageInteractions(footer('other'), 'answer')).toEqual({ content: footer('other') })
    const invalid = '正文\n```chat-ui\n{"version":1,"messageId":"answer","options":{}}\n```'
    expect(extractMessageInteractions(invalid, 'answer')).toEqual({ content: invalid })
  })
  it('hides partial or interrupted metadata without making controls executable', () => {
    expect(extractMessageInteractions(footer().slice(0, -4), 'answer', 'stream')).toEqual({ content: '正文' })
    expect(extractMessageInteractions('正文\n```cha', 'answer', 'stream')).toEqual({ content: '正文' })
    expect(extractMessageInteractions(footer(), 'answer', 'interrupted')).toEqual({ content: '正文' })
  })
  it('leaves nested examples and nontrailing protocol blocks inert', () => {
    const nested = '````text\n' + footer() + '\n````'
    expect(extractMessageInteractions(nested, 'answer')).toEqual({ content: nested })
    expect(extractMessageInteractions(footer() + '\n后续正文', 'answer')).toEqual({ content: footer() + '\n后续正文' })
  })
  it('rejects duplicate, unknown and out-of-bounds choices and formats in definition order', () => {
    expect(validateOptionSelection(definition, ['b', 'a'])).toEqual(['a', 'b'])
    for (const ids of [[], ['a', 'a'], ['missing']]) expect(validateOptionSelection(definition, ids)).toBeUndefined()
    expect(validateOptionSelection({ ...definition, selection: 'single', maxSelections: 1 }, ['a', 'b'])).toBeUndefined()
    expect(formatOptionResponse(definition, ['b', 'a'])).toBe('针对“选择内容”，我的选择：\n- 甲\n- 乙')
  })
})

it('preserves quote text and rejects malformed restored quote metadata', () => {
  const quote = createMessageQuote({ id: 'original', role: 'assistant' }, '第一行\n第二行')!
  expect(formatQuoteInput('请解释', quote)).toBe('引用内容：\n> 第一行\n> 第二行\n\n请解释')
  expect(quote.text).toBe('第一行\n第二行')
  expect(readMessageQuote({ ...quote, role: 'tool' })).toBeUndefined()
  expect(createMessageQuote({ id: 'x', role: 'assistant' }, ' ')).toBeUndefined()
})

describe('reused tool result helpers', () => {
  it('unwraps text JSON and structured data, caps tables and validates links and typed arguments', () => {
    expect(getToolResult('{"content":[{"type":"text","text":"{\\"ok\\":true}"}]}')).toEqual({ ok: true })
    expect(getToolResult('{"structuredContent":{"x":1}}')).toEqual({ x: 1 })
    const table = getToolTable(Array.from({ length: 40 }, (_, i) => ({ index: i })))!
    expect(table.rows).toHaveLength(30); expect(table.totalRows).toBe(40)
    expect(safeToolUrl('javascript:alert(1)')).toBeNull()
    expect(safeToolUrl('https://user:secret@example.com')).toBeNull()
    expect(parseToolArgumentInput(2, '3')).toBe(3)
    expect(() => parseToolArgumentInput(2, 'bad')).toThrow()
    expect(parseToolArgumentInput('2', '3')).toBe('3')
  })
  it('restores unresolved calls as stopped while preserving completed results', () => {
    const messages = [{ tools: [{ status: 'running' }, { status: 'pending' }, { status: 'complete', result: { ok: true } }] }]
    restoreInterruptedToolCalls(messages)
    expect(messages[0]!.tools.map(tool => tool.status)).toEqual(['stopped', 'stopped', 'complete'])
    expect(messages[0]!.tools[2]).toMatchObject({ result: { ok: true } })
  })
  it('settles cancellation while a tool operation itself remains pending', async () => {
    const controller = new AbortController()
    const waiting = waitForToolResult(new Promise(() => {}), controller.signal)
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
  })
})
