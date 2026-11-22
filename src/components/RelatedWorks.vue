<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronRight } from '@lucide/vue'
import type { Work } from '../data'
import { api } from '../state'
import BentoGrid from './BentoGrid.vue'
import WorkCard from './WorkCard.vue'

const props = defineProps<{ work: Work }>()
const tags = computed(() => [...new Set(props.work.tags)])
const items = ref<Work[]>([]), nextCursor = ref<string | null>(null)
const loading = ref(false), failed = ref(false)
const content = ref<HTMLElement>(), moreButton = ref<HTMLButtonElement>()
let controller: AbortController | undefined

async function loadMore() {
  if (loading.value || !tags.value.length || !controller) return
  if (document.activeElement === moreButton.value) content.value?.focus({ preventScroll: true })
  const active = controller, selected = props.work, cursor = nextCursor.value
  const params = new URLSearchParams({ kind: selected.kind, sort: 'latest', limit: '20' })
  for (const tag of tags.value) params.append('tag', tag)
  if (cursor) params.set('cursor', cursor)
  loading.value = true; failed.value = false
  try {
    const page = await api<{ items: Work[]; nextCursor?: string | null }>(`/api/works?${params}`, { signal: AbortSignal.any([active.signal, AbortSignal.timeout(15000)]) })
    if (active !== controller) return
    const known = new Set([selected.id, ...items.value.map(item => item.id)])
    items.value.push(...page.items.filter(item => {
      if (known.has(item.id) || item.kind !== selected.kind || !['published', 'approved'].includes(item.status) || !item.tags.some(tag => tags.value.includes(tag))) return false
      known.add(item.id)
      return true
    }))
    nextCursor.value = page.nextCursor && page.nextCursor !== cursor ? page.nextCursor : null
  } catch { if (active === controller) failed.value = true }
  finally { if (active === controller) loading.value = false }
}

watch(() => [props.work.id, props.work.kind, ...tags.value], () => {
  controller?.abort(); controller = new AbortController()
  items.value = []; nextCursor.value = null; loading.value = false; failed.value = false
  void loadMore()
}, { immediate: true })
onBeforeUnmount(() => { controller?.abort(); controller = undefined })
</script>

<template>
  <aside class="related-works" aria-label="同类作品">
    <header class="related-heading"><h2>同类作品</h2><RouterLink to="/discover" class="text-link">全部作品<ChevronRight :size="14" aria-hidden="true" /></RouterLink></header>
    <p v-if="tags.length" class="related-tags">{{ tags.map(tag => `# ${tag}`).join(' · ') }}</p>
    <div ref="content" class="related-content" tabindex="-1" :aria-busy="loading">
      <BentoGrid v-if="items.length" class="related-grid"><WorkCard v-for="item in items" :key="item.id" :work="item" thumbnail-only /></BentoGrid>
      <p v-if="loading" class="related-state" role="status">正在加载同类作品…</p>
      <p v-else-if="failed" class="related-state" role="alert">同类作品暂时无法加载。</p>
      <p v-else-if="!items.length" class="related-state" role="status">{{ tags.length ? '暂无相同标签的同类作品。' : '该作品暂无标签，暂时无法推荐同类作品。' }}</p>
      <button v-if="!loading && (failed || nextCursor)" ref="moreButton" class="button btn subtle related-more" @click="loadMore">{{ failed ? '重试加载' : '加载更多' }}</button>
    </div>
  </aside>
</template>

<style scoped>
.related-works { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: var(--detail-height); }
.related-heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px 8px; flex: none; }
.related-heading h2 { font-size: 15px; line-height: 24px; font-weight: 600; }
.related-heading .text-link { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; font-size: 12px; }
.related-tags { flex: none; padding-bottom: 12px; color: var(--muted); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
.related-content { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; padding: 2px 4px 8px 0; }
.related-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 8px; --card-row-gap: 8; }
.related-state { padding: 20px 4px; color: var(--muted); font-size: 13px; line-height: 22px; }
.related-more { width: 100%; min-height: 44px; margin-top: 8px; }
@media (max-width: 999px) {
  .related-works { height: 100%; }
  .related-heading { justify-content: flex-end; }
  .related-heading h2 { display: none; }
}
</style>
