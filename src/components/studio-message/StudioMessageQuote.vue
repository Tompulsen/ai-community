<!-- Adapted from octopus_chat message-quote.tsx (MIT). -->
<script setup lang="ts">
import { computed } from 'vue'
import { Quote, X } from '@lucide/vue'
import type { MessageQuote } from '../../../shared/studio/message-quote'

const props = defineProps<{ quote: MessageQuote; onRemove?: () => void }>()
const label = computed(() => props.quote.role === 'assistant' ? 'AI 回复' : props.quote.role === 'user' ? '你的消息' : '系统消息')
</script>

<template>
  <div class="message-quote" :data-testid="onRemove ? 'composer-quote' : 'message-quote'" data-chat-scroll-isolation>
    <div class="quote-heading">
      <span><Quote :size="14" aria-hidden="true" />引用 · {{ label }}</span>
      <button v-if="onRemove" type="button" aria-label="取消引用" title="取消引用" @click="onRemove"><X :size="16" aria-hidden="true" /></button>
    </div>
    <div class="quote-excerpt">{{ quote.text }}</div>
  </div>
</template>

<style scoped>
.message-quote { min-width: 0; max-width: 100%; margin-bottom: 8px; padding: 8px 12px; border-radius: 8px; background: var(--surface-soft); color: var(--ink); font-size: 14px; line-height: 20px; }
.quote-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; margin-bottom: 4px; }
.quote-heading > span { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }.quote-heading svg { flex: none; }
.quote-heading button { display: grid; place-items: center; flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; color: var(--ink); background: transparent; cursor: pointer; }
.quote-heading button:hover { color: var(--ink); background: var(--state-hover); }.quote-heading button:active { color: var(--ink); background: var(--state-pressed); }.quote-heading button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.quote-excerpt { max-height: 80px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (pointer: coarse), (max-width: 600px) { .quote-heading button { width: 44px; height: 44px; } }
</style>
