<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SlidersHorizontal, X, ArrowDownWideNarrow, SearchX, LayoutGrid, Image, Video, FileText } from '@lucide/vue'
import WorkCard from '../components/WorkCard.vue'
import BentoGrid from '../components/BentoGrid.vue'
import CommunityAds from '../components/CommunityAds.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import { api, errorMessage, queryString } from '../state'
import { kindLabels, type Work } from '../data'

const route = useRoute()
const router = useRouter()
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const kind = ref(typeof route.query.kind === 'string' ? route.query.kind : 'all')
const tag = ref(typeof route.query.tag === 'string' ? route.query.tag : '')
const order = ref('featured')
const showTags = ref(false)
const works = ref<Work[]>([])
const tags = ref<{ id: string; name: string }[]>([])
const loading = ref(false)
const error = ref('')
const nextCursor = ref<string | null>(null)
const categoryIcons = { image: Image, video: Video, resource: FileText }
let controller: AbortController | undefined
let searchTimer: ReturnType<typeof setTimeout>

async function load(append = false) {
  controller?.abort()
  const active = new AbortController()
  controller = active
  loading.value = true
  error.value = ''
  try {
    const result = await api<{ items: Work[]; nextCursor: string | null }>(`/api/works${queryString({
      kind: kind.value === 'all' ? undefined : kind.value, query: query.value.trim(), tag: tag.value, sort: order.value,
      cursor: append ? nextCursor.value || undefined : undefined,
    })}`, { signal: active.signal })
    works.value = append ? [...works.value, ...result.items] : result.items
    nextCursor.value = result.nextCursor
  } catch (cause) {
    if (!active.signal.aborted) error.value = errorMessage(cause)
  } finally { if (!active.signal.aborted) loading.value = false }
}
watch([query, kind, tag, order], () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void router.replace({ query: { ...route.query, q: query.value || undefined, kind: kind.value === 'all' ? undefined : kind.value, tag: tag.value || undefined } })
    void load()
  }, 180)
})
watch(() => route.query, value => {
  query.value = typeof value.q === 'string' ? value.q : ''
  kind.value = typeof value.kind === 'string' ? value.kind : 'all'
  tag.value = typeof value.tag === 'string' ? value.tag : ''
})
onBeforeUnmount(() => { clearTimeout(searchTimer); controller?.abort() })
void load()
void api<{ items: typeof tags.value }>('/api/tags').then(result => { tags.value = result.items }).catch(() => {})
function reset() { query.value = ''; kind.value = 'all'; tag.value = ''; order.value = 'featured' }
</script>

<template>
  <div class="page-container discover-page">
    <div class="page-heading discover-heading">
      <div class="discover-title"><h1>发现作品</h1><span v-if="works.length" class="discover-count">{{ works.length }} 件作品</span></div>
      <label class="search-control discover-search"><span class="search-field-label">搜索作品</span><input v-model="query" type="search" aria-label="搜索作品" placeholder="标题、提示词或创作者" /><button v-if="query" type="button" class="icon-button" aria-label="清除搜索" title="清除搜索" @click="query = ''"><X :size="16" /></button></label>
    </div>
    <div class="discovery-toolbar">
      <div class="tabs category-tabs" role="group" aria-label="作品类型">
        <button class="tab" :class="{ active: kind === 'all' }" :aria-pressed="kind === 'all'" aria-label="全部作品" @click="kind = 'all'"><LayoutGrid :size="16" aria-hidden="true" /><span class="category-label">全部作品</span><span class="category-label-short" aria-hidden="true">全部</span></button>
        <button v-for="(label, value) in kindLabels" :key="value" class="tab" :class="{ active: kind === value }" :aria-pressed="kind === value" :aria-label="value === 'resource' ? `资源，${label}` : label" @click="kind = value"><component :is="categoryIcons[value]" :size="16" aria-hidden="true" /><span class="category-label">{{ label }}</span><span class="category-label-short" aria-hidden="true">{{ value === 'resource' ? '资源' : label }}</span></button>
      </div>
      <div class="toolbar-options"><button class="button btn subtle filter-toggle" :class="{ selected: showTags || tag }" :aria-expanded="showTags" aria-controls="discover-tags" @click="showTags = !showTags"><SlidersHorizontal :size="16" /><span>筛选</span><span v-if="tag" class="filter-count">1</span></button><label class="sort-control"><ArrowDownWideNarrow :size="16" /><select v-model="order" aria-label="作品排序"><option value="featured">精选推荐</option><option value="latest">最新发布</option><option value="following">我的关注</option></select></label></div>
    </div>
    <div v-if="showTags" id="discover-tags" class="tag-filter" aria-label="标签筛选"><button class="tag-button" :class="{ active: !tag }" :aria-pressed="!tag" @click="tag = ''">所有标签</button><button v-for="item in tags" :key="item.id" class="tag-button" :class="{ active: tag === item.name }" :aria-pressed="tag === item.name" @click="tag = tag === item.name ? '' : item.name">{{ item.name }}</button></div>
    <div v-if="query || tag" class="search-result"><span>{{ works.length }} 件作品<span v-if="tag"> · {{ tag }}</span></span><button class="text-link" @click="reset">重置条件 <X :size="13" /></button></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load()">重试</button></p>
    <ContentSkeleton v-if="loading && !works.length" layout="works" label="正在加载作品…" />
    <BentoGrid v-else-if="works.length" class="discover-grid"><WorkCard v-for="(work, index) in works" :key="work.id" :work="work" :eager="index < 3" /></BentoGrid>
    <div v-else-if="!error" class="empty-state"><SearchX :size="32" /><h2>{{ order === 'following' ? '还没有关注的作品' : '没有找到相关作品' }}</h2><p>试试其他关键词，或清除筛选条件。</p><button class="button btn subtle" @click="reset">清除筛选</button></div>
    <div v-if="nextCursor" class="feed-end"><button class="button btn" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多' }}</button></div>
    <CommunityAds :slots="['communityAd1', 'communityAd2', 'communityAd3', 'communityAd4']" />
  </div>
</template>

<style scoped>
.discover-heading { display: grid; min-height: 48px; margin-bottom: 24px; grid-template-columns: minmax(0, 1fr) minmax(280px, 400px); gap: 24px; }
.discover-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; }
.discover-title h1 { color: var(--ink); font-size: 26px; line-height: 36px; }
.discover-count { color: var(--muted); font-size: 12px; line-height: 20px; font-variant-numeric: tabular-nums; }
.discover-search { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); min-height: 44px; padding-inline: 12px; }
.discover-search input { min-height: 42px; padding-block: 10px; }
.search-field-label { font-size: 12px; color: var(--muted); white-space: nowrap; padding-right: 12px; border-right: 1px solid var(--border); }
.discover-search:hover { border-color: var(--muted); }
.discover-search:focus-within { background: var(--surface); border-color: var(--blue); outline-color: var(--blue-soft); }
.discovery-toolbar { padding-bottom: 20px; margin-bottom: 24px; gap: 16px; }
.discovery-toolbar .category-tabs { background: transparent; border-radius: 0; padding: 0; gap: 8px; }
.category-tabs .tab { min-height: 40px; padding-inline: 12px; }
.toolbar-options { gap: 12px; }
.tag-filter { padding: 0 0 20px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
.search-result { margin-bottom: 20px; }
.feed-end { padding-top: 32px; }
@media (max-width: 899px) {
  .discover-heading { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .discover-search { max-width: none; }
  .discovery-toolbar { align-items: flex-start; }
}
@media (max-width: 639px) {
  .discover-title h1 { font-size: 24px; line-height: 32px; }
  .discover-heading { margin-bottom: 20px; gap: 16px; }
  .discovery-toolbar { row-gap: 16px; padding-bottom: 16px; margin-bottom: 20px; }
  .discovery-toolbar .category-tabs { gap: 4px; }
  .category-tabs .tab { min-height: 44px; padding-inline: 8px; }
  .toolbar-options { width: 100%; justify-content: space-between; }
  .discover-search input, .button.filter-toggle { min-height: 44px; }
}
</style>
