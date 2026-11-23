import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import { useStreamingContent } from './use-studio-typewriter'

const hooks = vi.hoisted(() => ({ mounted: [] as (() => void)[], unmounted: [] as (() => void)[] }))
vi.mock('vue', async original => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => hooks.mounted.push(callback),
  onBeforeUnmount: (callback: () => void) => hooks.unmounted.push(callback),
}))

let scope: EffectScope, documentState: EventTarget & { hidden: boolean }
beforeEach(() => {
  vi.useFakeTimers()
  hooks.mounted.length = hooks.unmounted.length = 0
  documentState = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('document', documentState)
  scope = effectScope()
})
afterEach(() => {
  hooks.unmounted.forEach(callback => callback())
  scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function fixture() {
  const content = ref('initial'), streaming = ref(true)
  const result = scope.run(() => useStreamingContent(content, streaming, 40))!
  hooks.mounted.forEach(callback => callback())
  return { content, streaming, ...result }
}

it('coalesces bursts without postponing output while new packets keep arriving', () => {
  const { content, displayed } = fixture()
  for (let index = 0; index < 4; index++) {
    content.value += String(index)
    vi.advanceTimersByTime(10)
  }
  expect(displayed.value).toBe('initial0123')
  content.value += '4'
  content.value += '5'
  expect(displayed.value).toBe('initial0123')
  vi.advanceTimersByTime(40)
  expect(displayed.value).toBe('initial012345')
})

it('flushes the latest packet immediately when generation stops', () => {
  const { content, streaming, displayed } = fixture()
  content.value += ' final'
  streaming.value = false
  expect(displayed.value).toBe(content.value)
  expect(vi.getTimerCount()).toBe(0)
})

it('flushes replacements and truncations without combining different answers', () => {
  const { content, displayed } = fixture()
  content.value = 'replacement'
  expect(displayed.value).toBe('replacement')
  content.value = 'replace'
  expect(displayed.value).toBe('replace')
})

it('shows the pending content before a background tab pauses its timers', () => {
  const { content, displayed } = fixture()
  content.value += ' background'
  documentState.hidden = true
  documentState.dispatchEvent(new Event('visibilitychange'))
  expect(displayed.value).toBe(content.value)
  expect(vi.getTimerCount()).toBe(0)
})

it('cleans up its timer and listener when its message is unmounted', () => {
  const { content, displayed } = fixture()
  content.value += ' pending'
  hooks.unmounted.forEach(callback => callback())
  expect(vi.getTimerCount()).toBe(0)
  documentState.hidden = true
  documentState.dispatchEvent(new Event('visibilitychange'))
  expect(displayed.value).toBe('initial')
})
