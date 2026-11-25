<script setup lang="ts">
import { computed } from 'vue'
import { safeExternalUrl } from '../state'

const props = defineProps<{ text: string }>()
const parts = computed(() => {
  const result: { text: string; href?: string }[] = []
  let offset = 0
  // Keep prose punctuation outside links without truncating balanced URL brackets.
  const matches = props.text.matchAll(/(?<![\w@])(?:https?:\/\/|www\.)[^\s<>"'`，。！？；：、（）【】《》〈〉「」『』〔〕“”‘’]+/giu)
  for (const match of matches) {
    let text = match[0], previous: string
    do {
      previous = text
      text = text.replace(/[.,!?;:]+$/u, '')
      for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
        while (text.endsWith(close) && text.split(close).length > text.split(open).length) text = text.slice(0, -1)
      }
    } while (text !== previous)
    const href = safeExternalUrl(/^www\./i.test(text) ? `https://${text}` : text)
    if (!href) continue
    result.push({ text: props.text.slice(offset, match.index) }, { text, href })
    offset = match.index + text.length
  }
  result.push({ text: props.text.slice(offset) })
  return result
})
</script>

<template>
  <p class="announcement-text"><template v-for="(part, index) in parts" :key="index"><a v-if="part.href" :href="part.href" target="_blank" rel="noopener noreferrer" :aria-label="`${part.text}（在新标签页打开）`" title="在新标签页打开">{{ part.text }}</a><template v-else>{{ part.text }}</template></template></p>
</template>

<style scoped>
.announcement-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.announcement-text a { color: var(--blue); text-decoration: underline; text-underline-offset: 3px; }
.announcement-text a:hover { text-decoration-thickness: 2px; }
.announcement-text a:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; border-radius: 2px; }
</style>
