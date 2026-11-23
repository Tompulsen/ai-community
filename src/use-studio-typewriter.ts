// Vue adaptation of octopus_chat/app/components/use-typewriter.ts (MIT).
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useReducedMotion } from './studio-motion'

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined
function takeCharacters(text: string, count: number) {
  if (!segmenter) return Array.from(text).slice(0, count).join('')
  let result = ''
  for (const { segment } of segmenter.segment(text)) { result += segment; if (--count <= 0) break }
  return result
}

export function useStudioTypewriter(content: Ref<string>, streaming: Ref<boolean>, instant: Ref<boolean>) {
  const displayed = ref(content.value), reduced = useReducedMotion()
  let frame = 0, lastTime = 0, credit = 0, deadline: number | undefined
  let wasStreaming = streaming.value
  const cancel = () => { cancelAnimationFrame(frame); frame = 0 }
  function flush() { cancel(); displayed.value = content.value; credit = 0; deadline = undefined; wasStreaming = streaming.value }
  function advance(now: number) {
    frame = 0
    if (document.hidden || reduced.value || instant.value || deadline !== undefined && now >= deadline) { flush(); return }
    const elapsed = now - lastTime
    if (elapsed >= 24) {
      lastTime = now
      let remaining = content.value.slice(displayed.value.length)
      const last = remaining.charCodeAt(remaining.length - 1)
      if (streaming.value && last >= 0xd800 && last <= 0xdbff) remaining = remaining.slice(0, -1)
      const catchUp = deadline === undefined ? 250 : Math.max(32, deadline - now)
      credit += Math.min(elapsed, 64) * Math.max(72, remaining.length * 1000 / catchUp) / 1000
      const count = Math.min(streaming.value ? 512 : remaining.length, Math.floor(credit))
      if (count > 0) { credit -= count; displayed.value += takeCharacters(remaining, count) }
    }
    if (displayed.value !== content.value) frame = requestAnimationFrame(advance)
    else { credit = 0; wasStreaming = streaming.value }
  }
  watch([content, streaming, instant, reduced], () => {
    const animate = streaming.value || wasStreaming
    wasStreaming = streaming.value || displayed.value !== content.value
    if (!animate || instant.value || reduced.value || document.hidden || !content.value.startsWith(displayed.value)) { flush(); return }
    if (streaming.value) deadline = undefined
    else if (displayed.value !== content.value) deadline ??= performance.now() + 320
    if (!frame && displayed.value !== content.value) { lastTime = performance.now(); frame = requestAnimationFrame(advance) }
  }, { flush: 'sync' })
  onMounted(() => document.addEventListener('visibilitychange', flush))
  onBeforeUnmount(() => { cancel(); document.removeEventListener('visibilitychange', flush) })
  return { displayed: computed(() => instant.value ? content.value : displayed.value), active: computed(() => streaming.value || displayed.value !== content.value) }
}

export function useStreamingContent(content: Readonly<Ref<string>>, streaming: Readonly<Ref<boolean | undefined>>, delay: number) {
  const displayed = ref(content.value)
  let timer: ReturnType<typeof setTimeout> | undefined
  function flush() { clearTimeout(timer); timer = undefined; displayed.value = content.value }
  watch([content, streaming], () => {
    if (!streaming.value || document.hidden || !content.value.startsWith(displayed.value)) flush()
    else if (displayed.value !== content.value && timer === undefined) timer = setTimeout(flush, delay)
  }, { flush: 'sync' })
  const hidden = () => { if (document.hidden) flush() }
  onMounted(() => document.addEventListener('visibilitychange', hidden))
  onBeforeUnmount(() => { clearTimeout(timer); document.removeEventListener('visibilitychange', hidden) })
  return { displayed, flush }
}
