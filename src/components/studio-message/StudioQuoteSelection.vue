<!-- Adapted from octopus_chat message-quote.tsx / message-selection.ts (MIT). -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { Quote } from '@lucide/vue'
import { createMessageQuote, type MessageQuote } from '../../../shared/studio/message-quote'

const props = defineProps<{ container?: HTMLElement; disabled?: boolean }>()
const emit = defineEmits<{ quote: [quote: MessageQuote] }>()
const snapshot = ref<{ quote: MessageQuote; left: number; top: number }>()
const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const element = (node: Node | null) => node instanceof Element ? node : node?.parentElement
let stop: (() => void) | undefined

onMounted(() => {
  stop = watchEffect(onCleanup => {
    const container = props.container
    snapshot.value = undefined
    if (!container || props.disabled) return
    let frame: number | undefined
    const update = () => {
      frame = undefined
      snapshot.value = undefined
      const selection = document.getSelection()
      if (!selection?.rangeCount || selection.isCollapsed) return
      const range = selection.getRangeAt(0)
      const start = element(range.startContainer), end = element(range.endContainer)
      const message = start?.closest<HTMLElement>('[data-quotable-message]')
      const role = message?.dataset.messageRole
      if (!message || !container.contains(message) || end?.closest('[data-quotable-message]') !== message ||
        start?.closest(editable) || end?.closest(editable) || document.activeElement?.closest(editable) ||
        !message.dataset.messageId || (role !== 'user' && role !== 'assistant')) return
      for (let index = 0; index < selection.rangeCount; index++) {
        const selected = selection.getRangeAt(index)
        if (!message.contains(selected.startContainer) || !message.contains(selected.endContainer)) return
      }
      const quote = createMessageQuote({ id: message.dataset.messageId, role }, selection.toString())
      if (!quote) return
      const bounds = range.getBoundingClientRect(), body = container.getBoundingClientRect()
      const viewport = window.visualViewport
      const viewportLeft = viewport?.offsetLeft ?? 0, viewportTop = viewport?.offsetTop ?? 0
      const left = Math.max(body.left, viewportLeft + 8), top = Math.max(body.top, viewportTop + 8)
      const right = Math.min(body.right, viewportLeft + (viewport?.width ?? innerWidth) - 8)
      const bottom = Math.min(body.bottom, viewportTop + (viewport?.height ?? innerHeight) - 8)
      const width = 88, height = 44
      if (bounds.width <= 0 || bounds.height <= 0 || bounds.right <= left || bounds.left >= right ||
        bounds.bottom <= top || bounds.top >= bottom || right - left < width || bottom - top < height) return
      const above = bounds.top - height - 8, below = bounds.bottom + 8
      const touch = window.matchMedia('(pointer: coarse)').matches
      const preferred = touch && below + height <= bottom ? below : above >= top ? above : below
      snapshot.value = {
        quote,
        left: Math.max(left, Math.min(bounds.left, right - width)),
        top: Math.max(top, Math.min(preferred, bottom - height)),
      }
    }
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(update) }
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        document.getSelection()?.removeAllRanges(); snapshot.value = undefined
      } else schedule()
    }
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('keyup', keyUp)
    document.addEventListener('pointerup', schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    schedule()
    onCleanup(() => {
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('keyup', keyUp)
      document.removeEventListener('pointerup', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      if (frame !== undefined) cancelAnimationFrame(frame)
    })
  })
})
onBeforeUnmount(() => stop?.())
function quoteSelection() {
  const quote = snapshot.value?.quote
  if (!quote || props.disabled) return
  document.getSelection()?.removeAllRanges()
  snapshot.value = undefined
  emit('quote', quote)
}
</script>

<template>
  <Teleport to="body">
    <button v-if="snapshot && !disabled" type="button" class="quote-selection" :style="{ left: `${snapshot.left}px`, top: `${snapshot.top}px` }" aria-label="引用选中文字" data-chat-scroll-isolation @pointerdown.prevent @mousedown.prevent @click="quoteSelection">
      <Quote :size="16" aria-hidden="true" /><span>引用</span>
    </button>
  </Teleport>
</template>

<style scoped>
.quote-selection { position: fixed; z-index: 210; display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 88px; height: 44px; padding: 8px 12px; border: 0; border-radius: 6px; background: var(--popover-surface); box-shadow: var(--popover-shadow); color: var(--ink); font: inherit; font-size: 14px; cursor: pointer; touch-action: manipulation; user-select: none; }
.quote-selection:hover:not(:disabled) { background: var(--state-hover); }.quote-selection:active:not(:disabled) { background: var(--state-pressed); }.quote-selection:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
</style>
