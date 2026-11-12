<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { X, SearchX, ChevronLeft, ChevronRight } from '@lucide/vue'
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
    void router.replace({ query: { ...route.query, q: query.value || undefined, kind: kind.value === 'all' ? undefined : kind.value, tag: tag.value || undefined } })
    void load()
  }, 180)
})
watch(() => route.query, value => {
  query.value = typeof value.q === 'string' ? value.q : ''
  kind.value = typeof value.kind === 'string' ? value.kind : 'all'
  tag.value = typeof value.tag === 'string' ? value.tag : ''
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
    <div class="discovery-toolbar">
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
            <button v-for="item in tags" :key="item.id" class="rail-option" :class="{ active: tag === item.name }" :aria-pressed="tag === item.name" @click="tag = tag === item.name ? '' : item.name">{{ item.name }}</button>
          </div>
        </div>
        <div v-if="canScrollBack || canScrollForward" class="tag-scroll-controls">
          <button v-show="canScrollBack" class="icon-button" aria-label="向前浏览标签" title="向前浏览标签" :disabled="!canScrollBack" @click="scrollTags(-1)"><ChevronLeft :size="17" /></button>
          <button v-show="canScrollForward" class="icon-button" aria-label="向后浏览标签" title="向后浏览标签" :disabled="!canScrollForward" @click="scrollTags(1)"><ChevronRight :size="17" /></button>
        </div>
      </div>
    </div>
    <Teleport to="#header-search"><GooeyInput v-model="query" /></Teleport>
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
.discovery-toolbar { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: center; gap: 24px; padding-bottom: 20px; margin-bottom: 24px; }
.browse-modes { display: flex; align-items: center; padding: 3px; border: 1px solid var(--border); border-radius: 18px; }
.browse-mode { min-height: 28px; min-width: 60px; padding: 2px 10px; border: 2px solid transparent; border-radius: 14px; color: var(--muted); line-height: 20px; font-weight: 500; white-space: nowrap; }
.browse-mode:hover { color: var(--ink); }
.tag-navigation { display: flex; align-items: center; min-width: 0; border: 1px solid var(--border); border-radius: 18px; padding: 3px; }
.tag-rail { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; border-radius: 14px; }
.tag-rail::-webkit-scrollbar { display: none; }
.category-tabs, .content-tags { display: flex; align-items: center; flex: none; gap: 4px; }
.content-tags { margin-left: 12px; padding-left: 12px; border-left: 1px solid var(--border); }
.rail-option { min-height: 28px; padding: 2px 10px; border: 2px solid transparent; border-radius: 14px; color: var(--muted); line-height: 20px; white-space: nowrap; font-weight: 500; }
.rail-option:hover { color: var(--ink); }
.browse-mode, .rail-option { transition: background-color .2s ease-in-out, color .2s ease-in-out, border-color .2s ease-in-out, box-shadow .2s ease-in-out; }
.browse-mode.active, .rail-option.active { background: #202020; color: var(--ink); box-shadow: inset 4px 4px 10px #141414, inset -4px -4px 10px #2c2c2c; }
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
@media (pointer: coarse), (max-width: 639px) {
  .browse-modes, .tag-navigation { padding: 0; border: 0; box-shadow: inset 0 0 0 1px var(--border); }
  .browse-mode, .rail-option { min-height: 36px; border-radius: 18px; }
  .tag-rail { border-radius: 18px; }
  .tag-scroll-controls .icon-button { width: 36px; height: 36px; min-height: 36px; min-width: 36px; }
}
@media (max-width: 639px) {
  .discovery-toolbar { grid-template-columns: minmax(0, 1fr); gap: 12px; margin-bottom: 20px; }
  .browse-modes { grid-column: 1 / -1; justify-self: start; }
}
</style>
