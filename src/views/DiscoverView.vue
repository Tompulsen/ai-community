<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, SlidersHorizontal, X, ArrowDownWideNarrow, SearchX, LayoutGrid, Image, Video, FileText } from '@lucide/vue'
import WorkCard from '../components/WorkCard.vue'
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
      <div class="discover-title"><h1>发现</h1><p class="muted">一些值得停留的创作。</p></div>
      <label class="search-control discover-search"><Search :size="20" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索作品" placeholder="搜索作品、提示词或创作者" /><button v-if="query" type="button" class="icon-button" aria-label="清除搜索" title="清除搜索" @click="query = ''"><X :size="16" /></button></label>
    </div>
    <div class="discovery-toolbar">
      <div class="tabs category-tabs" role="group" aria-label="作品类型">
        <button class="tab" :class="{ active: kind === 'all' }" :aria-pressed="kind === 'all'" aria-label="全部作品" @click="kind = 'all'"><LayoutGrid :size="16" aria-hidden="true" /><span class="category-label">全部作品</span><span class="category-label-short" aria-hidden="true">全部</span></button>
        <button v-for="(label, value) in kindLabels" :key="value" class="tab" :class="{ active: kind === value }" :aria-pressed="kind === value" :aria-label="value === 'resource' ? `资源，${label}` : label" @click="kind = value"><component :is="categoryIcons[value]" :size="16" aria-hidden="true" /><span class="category-label">{{ label }}</span><span class="category-label-short" aria-hidden="true">{{ value === 'resource' ? '资源' : label }}</span></button>
      </div>
      <div class="toolbar-options"><button class="button subtle filter-toggle" :class="{ selected: showTags || tag }" :aria-expanded="showTags" aria-controls="discover-tags" @click="showTags = !showTags"><SlidersHorizontal :size="16" /><span>筛选</span><span v-if="tag" class="filter-count">1</span></button><label class="sort-control"><ArrowDownWideNarrow :size="16" /><select v-model="order" aria-label="作品排序"><option value="featured">精选推荐</option><option value="latest">最新发布</option><option value="following">我的关注</option></select></label></div>
    </div>
    <div v-if="showTags" id="discover-tags" class="tag-filter" aria-label="标签筛选"><button class="tag-button" :class="{ active: !tag }" :aria-pressed="!tag" @click="tag = ''">所有标签</button><button v-for="item in tags" :key="item.id" class="tag-button" :class="{ active: tag === item.name }" :aria-pressed="tag === item.name" @click="tag = tag === item.name ? '' : item.name">{{ item.name }}</button></div>
    <div v-if="query || tag" class="search-result"><span>{{ works.length }} 件作品<span v-if="tag"> · {{ tag }}</span></span><button class="text-link" @click="reset">重置条件 <X :size="13" /></button></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load()">重试</button></p>
    <ContentSkeleton v-if="loading && !works.length" layout="works" label="正在加载作品…" />
    <div v-else-if="works.length" class="works-grid"><WorkCard v-for="work in works" :key="work.id" :work="work" /></div>
    <div v-else-if="!error" class="empty-state"><SearchX :size="32" /><h2>{{ order === 'following' ? '还没有关注的作品' : '没有找到相关作品' }}</h2><p>试试其他关键词，或清除筛选条件。</p><button class="button subtle" @click="reset">清除筛选</button></div>
    <div v-if="nextCursor" class="feed-end"><button class="button" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多' }}</button></div>
    <CommunityAds :slots="['communityAd1', 'communityAd2', 'communityAd3', 'communityAd4']" />
  </div>
</template>
