<!-- Adapted from octopus_chat message-sources.tsx (MIT). -->
<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown, ExternalLink } from '@lucide/vue'
import type { StudioMessageSource } from '../../studio-message-types'
import { safeToolUrl } from '../../../shared/studio/tool-result'

const props = defineProps<{ sources: StudioMessageSource[] }>()
const safeSources = computed(() => props.sources.flatMap((source, index) => {
  const url = safeToolUrl(source.url)
  return url ? [{ ...source, url, number: source.number ?? index + 1, domain: new URL(url).hostname }] : []
}))
</script>

<template>
  <details v-if="safeSources.length" class="message-sources" data-testid="message-sources" data-chat-scroll-isolation>
    <summary><span>来源 · {{ safeSources.length }}</span><ChevronDown :size="14" aria-hidden="true" /></summary>
    <ol>
      <li v-for="source in safeSources" :key="source.url">
        <span class="source-number">{{ source.number }}</span>
        <a :href="source.url" target="_blank" rel="noopener noreferrer">
          <span class="source-title">{{ source.title || source.domain }}</span>
          <span class="source-domain">{{ source.domain }}</span>
          <span v-if="source.snippet" class="source-snippet">{{ source.snippet }}</span>
        </a>
        <ExternalLink :size="14" aria-hidden="true" />
      </li>
    </ol>
  </details>
</template>

<style scoped>
.message-sources { min-width: 0; margin-top: 16px; color: var(--ink); font-size: 13px; line-height: 20px; }
summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 36px; padding: 4px 8px; border-radius: 6px; color: var(--muted); cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }summary:hover { color: var(--ink); background: var(--state-hover); }summary:active { color: var(--ink); background: var(--state-pressed); }summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
details[open] summary > svg { transform: rotate(180deg); }
ol { display: grid; gap: 16px; margin: 8px 0 0; padding: 0 8px; list-style: none; }
li { display: grid; grid-template-columns: 22px minmax(0, 1fr) 14px; align-items: start; gap: 8px; }
li > svg { color: var(--muted); margin-top: 3px; }.source-number { color: var(--muted); font-variant-numeric: tabular-nums; }
a { display: grid; gap: 3px; min-width: 0; color: inherit; text-decoration: none; overflow-wrap: anywhere; }a:hover .source-title { text-decoration: underline; text-underline-offset: 3px; }a:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); border-radius: 4px; }
.source-title { font-weight: 500; }.source-domain, .source-snippet { color: var(--muted); font-size: 12px; }
@media (pointer: coarse), (max-width: 600px) { summary { min-height: 44px; } }
</style>
