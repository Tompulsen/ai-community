<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { X, SearchX, RefreshCw, LayoutGrid, SlidersHorizontal, ChevronLeft, ChevronRight } from '@lucide/vue'
import WorkCard from '../components/WorkCard.vue'
import BentoGrid from '../components/BentoGrid.vue'
import CommunityAds from '../components/CommunityAds.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import DiscoveryComposer from '../components/DiscoveryComposer.vue'
import GooeyInput from '../components/GooeyInput.vue'
import { api, errorMessage, loadSession, notify, session } from '../state'
import { kindLabels, type WorkSummary } from '../data'
import { clearFeedPreferences, feedSnapshot, readPreferences, rememberBatch, rememberExposure, rememberSearchTags } from '../feed-preferences'
import { discoveryCache, saveDiscoveryCache } from '../discovery-cache'
import type { FeedRequest } from '../../shared/recommendation'

const mobile = inject<Ref<boolean>>('mobile-community', ref(false))
const filtersOpen = ref(false)
const route = useRoute()
const router = useRouter()
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const kind = ref(typeof route.query.kind === 'string' ? route.query.kind : 'all')
const tag = ref(typeof route.query.tag === 'string' ? route.query.tag : '')
const readOrder = (value: unknown): FeedRequest['sort'] => value === 'latest' || value === 'following' || value === 'featured' ? value : 'recommended'
const order = ref(readOrder(route.query.sort))
const hasConditions = computed(() => !!query.value || !!tag.value || kind.value !== 'all' || order.value !== 'recommended')
const isFiltered = computed(() => !!query.value || !!tag.value || kind.value !== 'all' || order.value === 'following')
const browseModes = [{ value: 'recommended', label: '发现' }, { value: 'latest', label: '最新' }, { value: 'featured', label: '热门' }, { value: 'following', label: '关注' }] as const
const tagRail = ref<HTMLElement>()
const canScrollBack = ref(false), canScrollForward = ref(false)
let railObserver: ResizeObserver | undefined
const works = ref<WorkSummary[]>([])
const tags = ref<{ id: string; name: string; category: WorkSummary['kind'] }[]>([])
const loading = ref(false)
const error = ref('')
const nextCursor = ref<string | null>(null)
const feedEnd = ref<HTMLElement>()
const retryAppend = ref(false), refreshRequired = ref(false)
let pageObserver: IntersectionObserver | undefined
let restoring = false
const feedStatus = ref(''), preferenceDialog = ref<HTMLDialogElement>()
const grid = ref<InstanceType<typeof BentoGrid>>()
let exposureObserver: IntersectionObserver | undefined
let batch: FeedRequest | undefined
const owner = () => session.user?.id || 'guest'
const cached = discoveryCache
const restored = cached && cached.owner === owner() && cached.path === route.fullPath && cached.position === window.history.state?.position && Date.now() - cached.at < 30 * 60000
if (restored) { works.value = cached.works; nextCursor.value = cached.cursor; batch = cached.batch }
saveDiscoveryCache(undefined)
let controller: AbortController | undefined
let searchTimer: ReturnType<typeof setTimeout>

async function load(append = false, learnSearch = false) {
  if (append && (loading.value || !nextCursor.value || !batch || batch.kind !== kind.value || batch.query !== query.value.trim() || batch.tag !== tag.value || batch.sort !== order.value)) return
  controller?.abort()
  const active = new AbortController()
  controller = active
  loading.value = true
  error.value = ''
  retryAppend.value = append; refreshRequired.value = false
  const expectedOwner = owner()
  const expectedConditions = conditionsKey()
  try {
    await loadSession()
    if (active.signal.aborted || expectedOwner !== owner()) return
    if (order.value === 'following') {
      if (!session.user) { works.value = []; nextCursor.value = null; return }
    }
    const request: FeedRequest = append && batch ? { ...batch, cursor: nextCursor.value || undefined } : {
      kind: kind.value as FeedRequest['kind'], query: query.value.trim(), tag: tag.value, sort: order.value,
      seed: crypto.randomUUID(), ...feedSnapshot(expectedOwner),
    }
    const result = await api<{ items: WorkSummary[]; nextCursor: string | null; replaced?: boolean | null }>('/api/works/feed', {
      method: 'POST', body: request, signal: active.signal,
    })
    if (active.signal.aborted || expectedOwner !== owner() || controller !== active || expectedConditions !== conditionsKey()) return
    if (append && result.nextCursor && result.nextCursor === request.cursor) throw Object.assign(new Error('加载未能继续，请刷新作品列表后重试。'), { status: 409 })
    const existing = new Set(append ? works.value.map(work => work.id) : [])
    const added = result.items.filter(work => !existing.has(work.id) && !!existing.add(work.id))
    works.value = append ? [...works.value, ...added] : added
    nextCursor.value = result.nextCursor
    if (!append) {
      batch = request
      rememberBatch(expectedOwner, added.map(work => work.id))
      if (learnSearch && added.length && (request.query || request.tag)) void tagsRequest.then(items => {
        if (!active.signal.aborted && expectedOwner === owner() && expectedConditions === conditionsKey()) rememberSearchTags(expectedOwner, request.query, request.tag, items, request.kind, Date.now(), added)
      })
      feedStatus.value = result.replaced === false
        ? '当前条件下暂无更多可替换的作品，可以尝试其他标签。' : result.replaced ? '已为你换入其他作品。' : ''
    }
    await nextTick(); observeCards()
  } catch (cause) {
    if (!active.signal.aborted) { error.value = errorMessage(cause); refreshRequired.value = (cause as { status?: number })?.status === 409 }
  } finally { if (!active.signal.aborted) loading.value = false }
}
function conditionsKey() { return JSON.stringify([query.value.trim(), kind.value, tag.value, order.value]) }
let lastConditions = conditionsKey()
function applyConditions(refresh = false) {
  clearTimeout(searchTimer)
  const key = conditionsKey()
  if (!refresh && key === lastConditions && !controller?.signal.aborted) return
  lastConditions = key
  void router.replace({ query: { ...route.query, q: query.value || undefined, kind: kind.value === 'all' ? undefined : kind.value, tag: tag.value || undefined, sort: order.value === 'recommended' ? undefined : order.value } })
  void load(false, true)
}
watch([query, kind, tag, order], ([, nextKind, nextTag, nextOrder], [, previousKind, previousTag, previousOrder]) => {
  clearTimeout(searchTimer)
  if (conditionsKey() === lastConditions && !controller?.signal.aborted) return
  controller?.abort()
  if (nextKind !== previousKind || nextTag !== previousTag || nextOrder !== previousOrder) applyConditions()
  else searchTimer = setTimeout(() => applyConditions(), 180)
})
watch(() => route.query, value => {
  query.value = typeof value.q === 'string' ? value.q : ''
  kind.value = typeof value.kind === 'string' ? value.kind : 'all'
  tag.value = typeof value.tag === 'string' ? value.tag : ''
  order.value = readOrder(value.sort)
  applyConditions()
})
function observeCards() {
  exposureObserver?.disconnect()
  for (const card of grid.value?.$el?.querySelectorAll('[data-work-id]') ?? []) exposureObserver?.observe(card)
}
function observeNextPage() {
  pageObserver?.disconnect()
  if (!restoring && feedEnd.value && nextCursor.value && !loading.value && !error.value) pageObserver?.observe(feedEnd.value)
}
watch([loading, error, nextCursor, feedEnd], observeNextPage, { flush: 'post' })
function clearPreferences() {
  clearFeedPreferences(owner()); preferenceDialog.value?.close(); notify('已清除当前浏览器的推荐偏好。')
  void load()
}
onBeforeRouteLeave(to => {
  if (batch && batch.kind === kind.value && batch.query === query.value.trim() && batch.tag === tag.value && batch.sort === order.value && to.path.startsWith('/work/')) saveDiscoveryCache({ owner: owner(), path: route.fullPath,
    position: window.history.state?.position, works: works.value, cursor: nextCursor.value, batch, scroll: window.scrollY, at: Date.now() })
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
onMounted(async () => {
  railObserver = new ResizeObserver(updateRail)
  if (tagRail.value) railObserver.observe(tagRail.value)
  updateRail()
  exposureObserver = new IntersectionObserver(entries => {
    if (document.visibilityState !== 'visible') return
    const ids = entries.filter(entry => entry.isIntersecting && entry.intersectionRatio >= .5).map(entry => (entry.target as HTMLElement).dataset.workId!).filter(Boolean)
    if (ids.length) rememberExposure(owner(), ids)
  }, { threshold: .5 })
  observeCards()
  pageObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && !loading.value && !error.value && !restoring) void load(true)
  }, { rootMargin: '160px 0px' })
  if (restored) {
    restoring = true
    await nextTick()
    window.scrollTo({ top: cached.scroll })
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    restoring = false
  }
  observeNextPage()
})
const cleanupTimer = setInterval(() => readPreferences(owner()), 60000)
watch(tags, async () => { await nextTick(); updateRail() })
onBeforeUnmount(() => { clearTimeout(searchTimer); clearInterval(cleanupTimer); controller?.abort(); railObserver?.disconnect(); exposureObserver?.disconnect(); pageObserver?.disconnect() })
const tagsRequest = api<{ items: typeof tags.value }>('/api/tags').then(result => { tags.value = result.items; return result.items }).catch(() => [])
if (!restored) void load(false, Boolean(query.value || tag.value))
function clearConditions() { query.value = ''; tag.value = ''; applyConditions() }
function reset() { query.value = ''; tag.value = ''; kind.value = 'all'; order.value = 'recommended'; applyConditions() }
</script>

<template>
  <div class="page-container discover-page">
    <h1 class="discover-heading-sr">首页</h1>
    <DiscoveryComposer />
    <Teleport to="#mobile-discovery-filters" :disabled="!mobile" defer>
    <div v-if="mobile" class="mobile-filter-actions"><button type="button" class="button btn subtle" :disabled="loading" @click="applyConditions(true)"><RefreshCw :size="16" />刷新</button><button type="button" class="button btn subtle" :aria-expanded="filtersOpen" aria-controls="discovery-filters" @click="filtersOpen = !filtersOpen"><SlidersHorizontal :size="16" />筛选<span v-if="hasConditions" class="filter-dot" /></button><button type="button" class="text-link" :disabled="!hasConditions" @click="reset">清除条件</button></div>
    <div v-show="!mobile || filtersOpen" id="discovery-filters" class="discovery-toolbar">
      <form v-if="!mobile" class="discovery-search header-search-slot" role="search" aria-label="作品搜索" @submit.prevent="applyConditions(true)"><GooeyInput v-model="query" persistent placeholder="搜索作品、提示词或创作者" /></form>
      <div v-if="!mobile" class="browse-modes" role="group" aria-label="浏览方式">
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
    <div class="feed-actions"><p class="form-note" role="status" aria-live="polite">{{ feedStatus }}</p><button class="text-link" @click="preferenceDialog?.showModal()">推荐偏好</button><button class="button btn subtle" :disabled="loading" @click="applyConditions(true)"><RefreshCw :size="16" aria-hidden="true" />{{ loading ? '加载中…' : order === 'recommended' ? '换一批' : '刷新' }}</button></div>
    <div v-if="isFiltered" class="feed-scope form-note"><span>{{ order === 'following' ? '当前仅显示已关注作者的作品。' : '当前仅显示符合筛选条件的作品。' }}</span><button class="text-link" @click="reset">查看全部作品</button></div>
    <div v-if="query || tag || (!mobile && kind !== 'all')" class="search-result"><div class="active-conditions"><span v-if="kind !== 'all'">类型：{{ kind === 'resource' ? '资源' : kindLabels[kind as keyof typeof kindLabels] }}</span><span v-if="query">搜索：{{ query }}</span><span v-if="tag">标签：{{ tag }}</span></div><button v-if="query || tag" class="text-link" @click="clearConditions">清除条件 <X :size="13" /></button></div>
    <p v-if="error && !retryAppend" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load()">重试</button></p>
    <ContentSkeleton v-if="loading && !works.length" layout="works" label="正在加载作品…" />
    <BentoGrid v-else-if="works.length" ref="grid" class="discover-grid"><WorkCard v-for="(work, index) in works" :key="work.id" :work="work" :eager="index < 3" /></BentoGrid>
    <div v-else-if="!error && order === 'following' && session.ready && !session.user" class="empty-state"><SearchX :size="32" /><h2>登录后查看关注的作品</h2><RouterLink to="/account" class="button primary btn">登录</RouterLink></div>
    <div v-else-if="!error" class="empty-state discovery-empty"><SearchX v-if="hasConditions" :size="32" /><LayoutGrid v-else :size="32" aria-hidden="true" /><h2>{{ order === 'following' ? '还没有关注的作品' : hasConditions ? '没有找到相关作品' : '这里还没有作品' }}</h2><p>{{ hasConditions ? '试试其他关键词，或恢复默认浏览。' : '第一份已公开的作品会出现在这里。' }}</p><button v-if="hasConditions" class="button btn subtle" @click="reset">恢复默认</button></div>
    <div ref="feedEnd" class="feed-end">
      <p v-if="error && retryAppend" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="load(!refreshRequired)">{{ refreshRequired ? '刷新作品列表' : '重试加载' }}</button></p>
      <template v-else-if="nextCursor"><p class="form-note" role="status" aria-live="polite">{{ loading ? '正在加载更多作品…' : '继续下滑，自动加载更多作品' }}</p><button class="button btn" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多' }}</button></template>
      <p v-else-if="works.length && !loading && !error" class="form-note" role="status">{{ isFiltered ? '符合当前条件的作品已全部加载。' : '当前可见的公开作品已全部加载。' }}</p>
    </div>
    <CommunityAds :slots="['communityAd1', 'communityAd2', 'communityAd3', 'communityAd4']" />
    <dialog ref="preferenceDialog" class="dialog feed-preferences-dialog" aria-labelledby="feed-preferences-title"><h2 id="feed-preferences-title">推荐偏好</h2><p>根据近期浏览作品的标签推荐内容。偏好仅保留在当前浏览器，不同步到其他设备。</p><p>最多保留 20 个标签偏好，7 天无新互动后失效；近期作品记录最多 120 条，24 小时后失效。搜索词不加入推荐记录。</p><div class="dialog-actions"><button class="button btn subtle" @click="preferenceDialog?.close()">关闭</button><button class="button btn primary" @click="clearPreferences">清除推荐偏好</button></div></dialog>
  </div>
</template>

<style scoped>
.discover-heading-sr { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.feed-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 16px; }
.feed-actions > p { flex: 1; min-width: 0; margin: 0; }
.feed-actions > button { min-height: 44px; }
.feed-scope { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 12px; }
.feed-scope button, .feed-end button { min-height: 44px; }
.feed-preferences-dialog { width: min(440px, calc(100vw - 32px)); padding: 24px; }
.feed-preferences-dialog p { color: var(--muted); line-height: 1.7; }
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
.tag-navigation { position: relative; display: flex; align-items: center; min-width: 0; padding: 4px 0; }
.tag-navigation::before { content: ""; position: absolute; left: -12px; top: 50%; width: 1px; height: 16px; transform: translateY(-50%); background: var(--border); }
.tag-rail { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; border-radius: 14px; }
.tag-rail::-webkit-scrollbar { display: none; }
.tag-rail > .category-tabs, .content-tags { display: flex; align-items: center; flex: none; gap: 4px; width: auto; }
.content-tags { position: relative; margin-left: 20px; padding-left: 20px; }
.content-tags::before { content: ""; position: absolute; left: 0; top: 50%; width: 1px; height: 16px; transform: translateY(-50%); background: var(--border); }
.mobile-all-tags { display: none; }
.rail-option { min-height: 28px; padding: 2px 10px; border: 2px solid transparent; border-radius: 14px; color: var(--muted); line-height: 20px; white-space: nowrap; font-weight: 500; }
.browse-mode:hover:not(:disabled), .rail-option:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }
.browse-mode, .rail-option { transition: background-color .2s ease-in-out, color .2s ease-in-out, border-color .2s ease-in-out, box-shadow .2s ease-in-out; }
.browse-mode.active, .rail-option.active { background: var(--state-selected); color: var(--ink); }
.browse-mode.active:hover:not(:disabled), .rail-option.active:hover:not(:disabled), .browse-mode:active:not(:disabled), .rail-option:active:not(:disabled) { background: var(--state-pressed); color: var(--ink); }
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
  .filter-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink); }
  .discovery-toolbar { grid-template-columns: minmax(0, 1fr); margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--border); }
  .browse-modes, .tag-navigation { grid-column: 1; grid-row: auto; }
  .browse-modes { width: 100%; }
  .browse-mode { flex: 1; }
  .tag-rail { flex-wrap: wrap; gap: 6px; overflow: visible; }
  .tag-rail > .category-tabs, .content-tags { display: flex; flex-wrap: wrap; gap: 4px; width: 100%; }
  .tag-navigation:not(:has(.content-tags)) { display: flex; }
  .tag-scroll-controls { display: none; }
  .discover-page > .empty-state { min-height: calc(100svh - var(--header-height) - var(--mobile-nav-height) - 28px); border: 0; padding: 24px 12px; }
  .discovery-empty h2 { font-size: 18px; font-weight: 600; }
  .discovery-empty p { font-size: 13px; }
  .search-result { margin-bottom: 8px; font-size: 12px; }
}
</style>
