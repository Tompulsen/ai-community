<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { X, SearchX, RefreshCw, LayoutGrid, SlidersHorizontal, ChevronLeft, ChevronRight } from '@lucide/vue'
import WorkCard from '../components/WorkCard.vue'
import BentoGrid from '../components/BentoGrid.vue'
import CommunityAds from '../components/CommunityAds.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import DiscoveryComposer from '../components/DiscoveryComposer.vue'
import GooeyInput from '../components/GooeyInput.vue'
import { api, errorMessage, loadSession, queryString, session } from '../state'
import { kindLabels, type Work } from '../data'

const mobile = inject<Ref<boolean>>('mobile-community', ref(false))
const filtersOpen = ref(false)
const route = useRoute()
const router = useRouter()
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const kind = ref(typeof route.query.kind === 'string' ? route.query.kind : 'all')
const tag = ref(typeof route.query.tag === 'string' ? route.query.tag : '')
const order = ref(typeof route.query.sort === 'string' ? route.query.sort : 'featured')
const hasConditions = computed(() => !!query.value || !!tag.value || kind.value !== 'all' || order.value !== 'featured')
const browseModes = [{ value: 'featured', label: '推荐' }, { value: 'latest', label: '最新' }, { value: 'following', label: '关注' }]
const tagRail = ref<HTMLElement>()
const canScrollBack = ref(false), canScrollForward = ref(false)
let railObserver: ResizeObserver | undefined
const works = ref<Work[]>([])
const tags = ref<{ id: string; name: string }[]>([])
const loading = ref(false)
const error = ref('')
const nextCursor = ref<string | null>(null)
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
    void router.replace({ query: { ...route.query, q: query.value || undefined, kind: kind.value === 'all' ? undefined : kind.value, tag: tag.value || undefined, sort: order.value === 'featured' ? undefined : order.value } })
    void load()
  }, 180)
})
watch(() => route.query, value => {
  query.value = typeof value.q === 'string' ? value.q : ''
  kind.value = typeof value.kind === 'string' ? value.kind : 'all'
  tag.value = typeof value.tag === 'string' ? value.tag : ''
  order.value = typeof value.sort === 'string' ? value.sort : 'featured'
})
function updateRail() {
  const rail = tagRail.value
  if (!rail) return
  canScrollBack.value = rail.scrollLeft > 1
  canScrollForward.value = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1
}
function scrollTags(direction: number) {
  const rail = tagRail.value
  rail?.scrollBy({ left: direction * rail.clientWidth * 0.75, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}
onMounted(() => {
  railObserver = new ResizeObserver(updateRail)
  if (tagRail.value) railObserver.observe(tagRail.value)
  updateRail()
})
watch(tags, async () => { await nextTick(); updateRail() })
onBeforeUnmount(() => { clearTimeout(searchTimer); controller?.abort(); railObserver?.disconnect() })
void load()
void api<{ items: typeof tags.value }>('/api/tags').then(result => { tags.value = result.items }).catch(() => {})
function clearConditions() { query.value = ''; tag.value = '' }
function reset() { clearConditions(); kind.value = 'all'; order.value = 'featured' }
</script>

<template>
  <div class="page-container discover-page">
    <h1 class="discover-heading-sr">首页</h1>
    <DiscoveryComposer />
    <Teleport to="#mobile-discovery-filters" :disabled="!mobile" defer>
    <div v-if="mobile" class="mobile-filter-actions"><button type="button" class="button btn subtle" :disabled="loading" @click="load()"><RefreshCw :size="16" />刷新</button><button type="button" class="button btn subtle" :aria-expanded="filtersOpen" aria-controls="discovery-filters" @click="filtersOpen = !filtersOpen"><SlidersHorizontal :size="16" />筛选<span v-if="hasConditions" class="filter-dot" /></button><button type="button" class="text-link" :disabled="!hasConditions" @click="reset">清除条件</button></div>
    <div v-show="!mobile || filtersOpen" id="discovery-filters" class="discovery-toolbar">
      <form v-if="!mobile" class="discovery-search header-search-slot" role="search" aria-label="作品搜索" @submit.prevent="load()"><GooeyInput v-model="query" persistent placeholder="搜索作品、提示词或创作者" /></form>
      <div class="browse-modes" role="group" aria-label="浏览方式">
        <button v-for="mode in browseModes" :key="mode.value" class="browse-mode" :class="{ active: order === mode.value }" :aria-pressed="order === mode.value" @click="order = mode.value">{{ mode.label }}</button>
      </div>
      <div class="tag-navigation">
        <div ref="tagRail" class="tag-rail" role="region" aria-label="类型和标签" tabindex="0" @scroll.passive="updateRail">
          <div class="category-tabs" role="group" aria-label="作品类型">
            <button class="rail-option" :class="{ active: kind === 'all' && !tag }" :aria-pressed="kind === 'all' && !tag" @click="kind = 'all'; tag = ''">全部</button>
            <button v-for="(label, value) in kindLabels" :key="value" class="rail-option" :class="{ active: kind === value }" :aria-pressed="kind === value" :aria-label="value === 'resource' ? `资源，${label}` : label" @click="kind = value">{{ value === 'resource' ? '资源' : label }}</button>
          </div>
          <div v-if="tags.length" class="content-tags" role="group" aria-label="内容标签">
            <button class="rail-option mobile-all-tags" :class="{ active: !tag }" :aria-pressed="!tag" @click="tag = ''">全部标签</button>
            <button v-for="item in tags" :key="item.id" class="rail-option" :class="{ active: tag === item.name }" :aria-pressed="tag === item.name" @click="tag = tag === item.name ? '' : item.name">{{ item.name }}</button>
          </div>
        </div>
        <div v-if="canScrollBack || canScrollForward" class="tag-scroll-controls">
          <button v-show="canScrollBack" class="icon-button" aria-label="向前浏览标签" title="向前浏览标签" :disabled="!canScrollBack" @click="scrollTags(-1)"><ChevronLeft :size="17" /></button>
          <button v-show="canScrollForward" class="icon-button" aria-label="向后浏览标签" title="向后浏览标签" :disabled="!canScrollForward" @click="scrollTags(1)"><ChevronRight :size="17" /></button>
        </div>
      </div>
    </div>
    </Teleport>
    <div v-if="query || tag || (!mobile && kind !== 'all')" class="search-result"><div class="active-conditions"><span v-if="kind !== 'all'">类型：{{ kind === 'resource' ? '资源' : kindLabels[kind as keyof typeof kindLabels] }}</span><span v-if="query">搜索：{{ query }}</span><span v-if="tag">标签：{{ tag }}</span></div><button v-if="query || tag" class="text-link" @click="clearConditions">清除条件 <X :size="13" /></button></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load()">重试</button></p>
    <ContentSkeleton v-if="loading && !works.length" layout="works" label="正在加载作品…" />
    <BentoGrid v-else-if="works.length" class="discover-grid"><WorkCard v-for="(work, index) in works" :key="work.id" :work="work" :eager="index < 3" /></BentoGrid>
    <div v-else-if="!error && order === 'following' && session.ready && !session.user" class="empty-state"><SearchX :size="32" /><h2>登录后查看关注的作品</h2><RouterLink to="/account" class="button primary btn">登录</RouterLink></div>
    <div v-else-if="!error" class="empty-state discovery-empty"><SearchX v-if="hasConditions" :size="32" /><LayoutGrid v-else :size="32" aria-hidden="true" /><h2>{{ order === 'following' ? '还没有关注的作品' : hasConditions ? '没有找到相关作品' : '这里还没有作品' }}</h2><p>{{ hasConditions ? '试试其他关键词，或恢复默认浏览。' : '第一份已公开的作品会出现在这里。' }}</p><button v-if="hasConditions" class="button btn subtle" @click="reset">恢复默认</button></div>
    <div v-if="nextCursor" class="feed-end"><button class="button btn" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多' }}</button></div>
    <CommunityAds :slots="['communityAd1', 'communityAd2', 'communityAd3', 'communityAd4']" />
  </div>
</template>

<style scoped>
.discover-heading-sr { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.discover-page { max-width: none; padding-top: 16px; }
.discovery-toolbar { display: grid; grid-template-columns: max-content minmax(0, 1fr) minmax(220px, 320px); align-items: center; gap: 24px; padding-bottom: 0; margin-bottom: 24px; }
.discovery-search { grid-column: 3; grid-row: 1; position: relative; width: 100%; height: 44px; min-width: 0; }
.browse-modes { grid-column: 1; grid-row: 1; }
.tag-navigation { grid-column: 2; grid-row: 1; }
@media (min-width: 1000px) and (max-width: 1279px) {
  .discovery-toolbar { grid-template-columns: minmax(0, 1fr) 260px; gap: 12px 24px; }
  .tag-navigation { grid-column: 1; grid-row: 2; }
  .discovery-search { grid-column: 2; grid-row: 1 / 3; }
}
.browse-modes { display: flex; align-items: center; padding: 4px; border-radius: 18px; }
.browse-mode { min-height: 28px; min-width: 60px; padding: 2px 10px; border: 2px solid transparent; border-radius: 14px; color: var(--muted); line-height: 20px; font-weight: 500; white-space: nowrap; }
.browse-mode:hover { color: var(--ink); }
.tag-navigation { position: relative; display: flex; align-items: center; min-width: 0; padding: 4px 0; }
.tag-navigation::before { content: ""; position: absolute; left: -12px; top: 50%; width: 1px; height: 16px; transform: translateY(-50%); background: var(--border); }
.tag-rail { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; border-radius: 14px; }
.tag-rail::-webkit-scrollbar { display: none; }
.tag-rail > .category-tabs, .content-tags { display: flex; align-items: center; flex: none; gap: 4px; width: auto; }
.content-tags { position: relative; margin-left: 20px; padding-left: 20px; }
.content-tags::before { content: ""; position: absolute; left: 0; top: 50%; width: 1px; height: 16px; transform: translateY(-50%); background: var(--border); }
.mobile-all-tags { display: none; }
.rail-option { min-height: 28px; padding: 2px 10px; border: 2px solid transparent; border-radius: 14px; color: var(--muted); line-height: 20px; white-space: nowrap; font-weight: 500; }
.rail-option:hover { color: var(--ink); }
.browse-mode, .rail-option { transition: background-color .2s ease-in-out, color .2s ease-in-out, border-color .2s ease-in-out, box-shadow .2s ease-in-out; }
.browse-mode.active, .rail-option.active { background: var(--surface-soft); color: var(--ink); }
.rail-option:focus-visible, .browse-mode:focus-visible { outline-offset: -3px; }
.tag-scroll-controls { display: flex; flex: none; }
.tag-scroll-controls .icon-button { width: 28px; height: 28px; min-height: 28px; min-width: 28px; border-radius: 50%; }
.tag-scroll-controls .icon-button:disabled { opacity: .3; }
.search-result { gap: 12px; margin-bottom: 20px; }
.active-conditions { display: flex; flex-wrap: wrap; gap: 4px 16px; min-width: 0; overflow-wrap: anywhere; }
.search-result .text-link { flex-shrink: 0; min-height: 44px; }
.feed-end { padding-top: 32px; }
@media (prefers-reduced-motion: reduce) {
  .browse-mode, .rail-option { transition: none; }
}
@media (pointer: coarse), (max-width: 999px) {
  .browse-modes, .tag-navigation { padding: 0; }
  .browse-mode, .rail-option { min-height: 44px; border-radius: 22px; }
  .browse-modes { border-radius: 22px; }
  .tag-rail { border-radius: 0; }
  .tag-scroll-controls .icon-button { width: 44px; height: 44px; min-height: 44px; min-width: 44px; }
}
@media (max-width: 999px) {
  .discovery-toolbar { grid-template-columns: minmax(0, 1fr); gap: 8px; margin-bottom: 16px; }
  .browse-modes { grid-column: 1 / -1; justify-self: start; }
  .tag-navigation::before, .tag-rail > .category-tabs, .content-tags::before { display: none; }
  .tag-navigation:not(:has(.content-tags)) { display: none; }
  .content-tags { margin: 0; padding: 0; }
  .mobile-all-tags { display: block; }
}
@media (max-width: 999px) {
  .mobile-filter-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .mobile-filter-actions .button { gap: 6px; min-height: 44px; padding-inline: 10px; }
  .mobile-filter-actions .text-link { margin-left: auto; min-height: 44px; }
  .filter-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--blue); }
  .discovery-toolbar { grid-template-columns: minmax(0, 1fr); margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--border); }
  .browse-modes, .tag-navigation { grid-column: 1; grid-row: auto; }
  .browse-modes { width: 100%; }
  .browse-mode { flex: 1; }
  .tag-rail { flex-wrap: wrap; gap: 6px; overflow: visible; }
  .tag-rail > .category-tabs, .content-tags { display: flex; flex-wrap: wrap; gap: 4px; width: 100%; }
  .tag-navigation:not(:has(.content-tags)) { display: flex; }
  .tag-scroll-controls { display: none; }
  .browse-mode.active, .rail-option.active { color: var(--blue-hover); background: var(--blue-soft); }
  .discover-page > .empty-state { min-height: calc(100svh - var(--header-height) - var(--mobile-nav-height) - 28px); border: 0; padding: 24px 12px; }
  .discovery-empty h2 { font-size: 18px; font-weight: 600; }
  .discovery-empty p { font-size: 13px; }
  .search-result { margin-bottom: 8px; font-size: 12px; }
}
</style>
