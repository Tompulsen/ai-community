<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Tags, X, ArrowDownWideNarrow, SearchX, LayoutGrid, Image, Video, FileText } from '@lucide/vue'
import WorkCard from '../components/WorkCard.vue'
import BentoGrid from '../components/BentoGrid.vue'
import CommunityAds from '../components/CommunityAds.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import GooeyInput from '../components/GooeyInput.vue'
import { api, errorMessage, loadSession, queryString, session } from '../state'
import { kindLabels, type Work } from '../data'

const route = useRoute()
const router = useRouter()
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const kind = ref(typeof route.query.kind === 'string' ? route.query.kind : 'all')
const tag = ref(typeof route.query.tag === 'string' ? route.query.tag : '')
const order = ref('featured')
const showTags = ref(false)
const filterCount = computed(() => Number(kind.value !== 'all') + Number(!!tag.value))
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
    if (order.value === 'following') {
      await loadSession()
      if (active.signal.aborted) return
      if (!session.user) { works.value = []; nextCursor.value = null; return }
    }
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
function clearConditions() { query.value = ''; tag.value = '' }
function reset() { clearConditions(); kind.value = 'all'; order.value = 'featured' }
</script>

<template>
  <div class="page-container discover-page">
    <h1 class="discover-heading-sr">首页</h1>
    <div class="discovery-toolbar">
      <div class="discover-filters">
        <button class="tag-button all-works" :class="{ active: kind === 'all' }" :aria-pressed="kind === 'all'" aria-label="推荐" @click="kind = 'all'"><LayoutGrid :size="16" aria-hidden="true" /><span>推荐</span></button>
        <button class="button btn subtle filter-toggle" :class="{ selected: showTags || filterCount }" :aria-expanded="showTags" aria-controls="discover-tags" @click="showTags = !showTags"><Tags :size="16" aria-hidden="true" /><span>标签</span><span v-if="filterCount" class="filter-count">{{ filterCount }}</span></button>
        <label class="sort-control"><ArrowDownWideNarrow :size="16" aria-hidden="true" /><select v-model="order" aria-label="浏览方式"><option value="featured">推荐</option><option value="latest">最新</option><option value="following">关注</option></select></label>
      </div>
      <GooeyInput v-model="query" class="discover-search" />
    </div>
    <div v-if="showTags" id="discover-tags" class="tag-filter" aria-label="标签筛选">
      <div class="filter-section"><span class="filter-label">作品类型</span><div class="category-tabs" role="group" aria-label="作品类型">
        <button v-for="(label, value) in kindLabels" :key="value" class="tag-button" :class="{ active: kind === value }" :aria-pressed="kind === value" :aria-label="value === 'resource' ? `资源，${label}` : label" @click="kind = value"><component :is="categoryIcons[value]" :size="16" aria-hidden="true" /><span>{{ value === 'resource' ? '资源' : label }}</span></button>
      </div></div>
      <div class="filter-section"><span class="filter-label">内容标签</span><div class="content-tags"><button class="tag-button" :class="{ active: !tag }" :aria-pressed="!tag" @click="tag = ''">所有标签</button><button v-for="item in tags" :key="item.id" class="tag-button" :class="{ active: tag === item.name }" :aria-pressed="tag === item.name" @click="tag = tag === item.name ? '' : item.name">{{ item.name }}</button></div></div>
    </div>
    <div v-if="query || tag || kind !== 'all'" class="search-result"><div class="active-conditions"><span v-if="kind !== 'all'">类型：{{ kind === 'resource' ? '资源' : kindLabels[kind as keyof typeof kindLabels] }}</span><span v-if="query">搜索：{{ query }}</span><span v-if="tag">标签：{{ tag }}</span></div><button v-if="query || tag" class="text-link" @click="clearConditions">清除条件 <X :size="13" /></button></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load()">重试</button></p>
    <ContentSkeleton v-if="loading && !works.length" layout="works" label="正在加载作品…" />
    <BentoGrid v-else-if="works.length" class="discover-grid"><WorkCard v-for="(work, index) in works" :key="work.id" :work="work" :eager="index < 3" /></BentoGrid>
    <div v-else-if="!error && order === 'following' && session.ready && !session.user" class="empty-state"><SearchX :size="32" /><h2>登录后查看关注的作品</h2><RouterLink to="/account" class="button primary btn">登录</RouterLink></div>
    <div v-else-if="!error" class="empty-state"><SearchX :size="32" /><h2>{{ order === 'following' ? '还没有关注的作品' : '没有找到相关作品' }}</h2><p>试试其他关键词，或恢复默认浏览。</p><button class="button btn subtle" @click="reset">恢复默认</button></div>
    <div v-if="nextCursor" class="feed-end"><button class="button btn" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多' }}</button></div>
    <CommunityAds :slots="['communityAd1', 'communityAd2', 'communityAd3', 'communityAd4']" />
  </div>
</template>

<style scoped>
.discover-heading-sr { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.discover-page { padding-top: 24px; }
.discovery-toolbar { display: grid; grid-template-columns: max-content minmax(180px, 320px); justify-content: space-between; gap: 24px; padding-bottom: 16px; margin-bottom: 24px; }
.discover-filters { display: flex; align-items: center; gap: 8px; min-width: 0; }
.all-works { flex: none; gap: 8px; font-size: 14px; white-space: nowrap; }
.filter-toggle { min-height: 44px; }
.sort-control { flex: none; width: 104px; min-height: 44px; padding-inline: 8px; }
.sort-control select { width: 100%; min-width: 0; min-height: 42px; padding-block: 10px; }
.tag-filter { display: grid; gap: 16px; padding: 0 0 20px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
.filter-section { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; align-items: start; }
.filter-label { padding-block: 12px; font-size: 12px; line-height: 20px; color: var(--muted); }
.category-tabs, .content-tags { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
.category-tabs .tag-button { gap: 8px; font-size: 14px; }
.tag-button { min-height: 44px; }
.search-result { gap: 12px; margin-bottom: 20px; }
.active-conditions { display: flex; flex-wrap: wrap; gap: 4px 16px; min-width: 0; overflow-wrap: anywhere; }
.search-result .text-link { flex-shrink: 0; min-height: 44px; }
.feed-end { padding-top: 32px; }
@media (max-width: 639px) {
  .discovery-toolbar { grid-template-columns: minmax(0, 1fr); gap: 12px; margin-bottom: 20px; }
  .all-works { padding-inline: 8px; }
  .discover-filters .filter-toggle { min-width: 88px; padding-inline: 8px; }
  .sort-control { margin-left: auto; }
  .discover-search { --gooey-collapsed-width: 100%; }
  .filter-section { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .filter-label { padding-block: 0; }
}
</style>
