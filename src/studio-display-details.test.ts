import { expect, it } from 'vitest'
import { formatChatTime } from '../shared/studio/chat-time'
import { getResponseMetrics } from '../shared/studio/chat-response-metrics'
import type { ChatMessage } from '../shared/studio/types'

const answer = (values: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a', role: 'assistant', content: '回答',
  responseMetrics: { usage: { inputTokens: 100, outputTokens: 60, cachedInputTokens: 20 }, generationDurationMs: 2000 },
  ...values,
})
it('formats same-day times, older dates, past years and invalid timestamps', () => {
  const now = new Date(2026, 10, 15, 18).getTime()
  const date = new Date(2026, 10, 15, 10, 30)
  expect(formatChatTime(date.getTime(), now).label).toBe(date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }))
  for (const older of [new Date(2026, 10, 14), new Date(2025, 10, 14)]) {
    expect(formatChatTime(older.getTime(), now).label).toBe(older.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(older.getFullYear() !== 2026 ? { year: 'numeric' } : {}) }))
  }
  expect(formatChatTime(Number.NaN, now)).toEqual({ label: '', full: '', iso: '' })
})
it('uses reported output and cache counts after completion', () => {
  expect(getResponseMetrics([answer()])).toEqual({ outputTokensPerSecond: 30, cacheHitPercent: 20, pending: false })
})
it('uses live progress and live usage without needing completed response metrics', () => {
  expect(getResponseMetrics([answer({ streaming: true, responseMetrics: undefined, generationProgress: { outputTokens: 25, durationMs: 1000 }, usage: { inputTokens: 100, cachedInputTokens: 0 } })]))
    .toMatchObject({ outputTokensPerSecond: 25, cacheHitPercent: 0, pending: true, speedIsEstimated: true })
})
it('marks previous statistics while waiting for a new answer', () => {
  expect(getResponseMetrics([answer(), answer({ id: 'b', streaming: true, responseMetrics: undefined })]))
    .toMatchObject({ outputTokensPerSecond: 30, cacheHitPercent: 20, speedIsPrevious: true, cacheIsPrevious: true, pending: true })
})
it('does not fabricate stats for failed messages or inconsistent usage', () => {
  expect(getResponseMetrics([answer({ error: '失败' })]).outputTokensPerSecond).toBeUndefined()
  expect(getResponseMetrics([answer({ responseMetrics: { usage: { inputTokens: 10, cachedInputTokens: 11 }, generationDurationMs: 0 } })]))
    .toMatchObject({ outputTokensPerSecond: undefined, cacheHitPercent: undefined })
})
