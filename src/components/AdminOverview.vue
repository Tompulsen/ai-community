<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, ArrowUpRight, ChevronRight, Flag, Gift, Globe, Image, Megaphone, RefreshCw, Settings2, ShieldCheck, Tags, Users } from '@lucide/vue'
import ContentSkeleton from './ContentSkeleton.vue'
import { kindLabels, type Work, type WorkStatus } from '../data'

const props = defineProps<{ works: Work[]; loading: boolean; error: string; updatedAt: string; isAdmin: boolean }>()
const emit = defineEmits<{ refresh: []; review: [status: WorkStatus | 'all']; navigate: [tab: 'reports' | 'site' | 'settings' | 'tags' | 'ads' | 'users' | 'lottery'] }>()
const pending = computed(() => props.works.filter(work => work.status === 'pending' || work.revisionPending))
const summary = computed(() => [
  { label: '待审核', value: pending.value.length, status: 'pending' as const, hint: '含作品修改' },
  { label: '已公开', value: props.works.filter(work => work.status === 'published').length, status: 'published' as const, hint: '正在社区展示' },
  { label: '未通过', value: props.works.filter(work => work.status === 'rejected').length, status: 'rejected' as const, hint: '含已撤下作品' },
])
const shortcuts = computed(() => [
  { id: 'reports' as const, label: '举报处理', description: '核对举报与处理结果', icon: Flag },
  ...(props.isAdmin ? [
    { id: 'site' as const, label: '站点设置', description: '社区名称与品牌标识', icon: Globe },
    { id: 'settings' as const, label: '社区设置', description: '发布、推荐与上传规则', icon: Settings2 },
    { id: 'tags' as const, label: '内容标签', description: '图片、视频与资源分类', icon: Tags },
    { id: 'users' as const, label: '用户管理', description: '账号状态与违规记录', icon: Users },
    { id: 'ads' as const, label: '广告位', description: '广告内容与图片预览', icon: Megaphone },
    { id: 'lottery' as const, label: '抽奖管理', description: '奖项、次数与发放记录', icon: Gift },
  ] : []),
])
</script>

<template>
  <section class="panel-section admin-overview" :aria-busy="loading">
    <div class="section-heading"><div><h2>管理概览</h2><p class="form-note">查看近期投稿与待办，快速进入常用管理。</p></div><button class="button subtle btn" :disabled="loading" @click="emit('refresh')"><RefreshCw :size="16" aria-hidden="true" />刷新</button></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" @click="emit('refresh')">重试</button></p>
    <ContentSkeleton v-if="loading" label="正在加载管理概览…" />
    <template v-else-if="!error">
      <div class="overview-summary">
        <div class="summary-heading"><h3>近期投稿</h3><span>最近载入 {{ works.length }} 条 · {{ updatedAt }} 更新</span></div>
        <div class="overview-metrics"><button v-for="metric in summary" :key="metric.label" class="overview-metric" @click="emit('review', metric.status)"><span>{{ metric.label }}<ArrowUpRight :size="16" aria-hidden="true" /></span><strong :class="metric.status">{{ metric.value }}</strong><small>{{ metric.hint }}</small></button></div>
        <p class="form-note">统计仅基于最近载入的投稿，待审核包含已公开作品的修改。</p>
      </div>
      <div class="overview-columns">
        <section class="overview-queue"><div class="section-heading"><h3>待办作品</h3><button class="text-link" @click="emit('review', 'pending')">进入审核<ArrowRight :size="15" aria-hidden="true" /></button></div>
          <ul v-if="pending.length" class="queue-list"><li v-for="work in pending.slice(0, 5)" :key="work.id"><RouterLink :to="'/work/' + work.id" class="queue-work"><span class="queue-cover"><img v-if="work.cover" :src="work.cover" alt="" loading="lazy" /><Image v-else :size="20" aria-hidden="true" /></span><span><strong>{{ work.title }}</strong><small>{{ work.author }} · {{ kindLabels[work.kind] }}</small><small v-if="work.revisionPending" class="revision-label">修改待审核</small><small v-else>{{ new Date(work.date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</small></span><ChevronRight :size="16" aria-hidden="true" /></RouterLink></li></ul>
          <div v-else class="overview-empty"><ShieldCheck :size="28" aria-hidden="true" /><h3>近期投稿中没有待办</h3><p>进入审核列表，检查更早的待审核内容。</p><button class="button btn" @click="emit('review', 'pending')">查看审核队列</button></div>
        </section>
        <section class="overview-shortcuts"><h3>常用管理</h3><button v-for="item in shortcuts" :key="item.id" class="shortcut" @click="emit('navigate', item.id)"><component :is="item.icon" :size="18" aria-hidden="true" /><span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span><ChevronRight :size="16" aria-hidden="true" /></button></section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.admin-overview { padding-top: 0; border-bottom: 0; }
.admin-overview > .section-heading { align-items: start; }
.admin-overview > .section-heading > div { flex: 1; min-width: 0; }
.admin-overview > .section-heading .form-note { margin-top: 8px; font-size: 14px; }
.overview-summary { padding: 24px; background: var(--surface); border-radius: 8px; }
.summary-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
h3 { font-size: 16px; font-weight: 500; }
.summary-heading > span { color: var(--muted); font-size: 12px; }
.overview-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; padding-block: 24px; }
.overview-metric { display: grid; gap: 8px; text-align: left; border-radius: 4px; }
.overview-metric > span { display: flex; align-items: center; gap: 12px; color: var(--muted); }
.overview-metric:hover > span { color: var(--ink); }
.overview-metric strong { font-size: 32px; line-height: 40px; font-weight: 500; font-variant-numeric: tabular-nums; }
.overview-metric .pending { color: var(--amber); }
.overview-metric .published { color: var(--green); }
small { color: var(--muted); font-size: 12px; line-height: 20px; }
.overview-columns { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(260px, 1fr); gap: 32px; padding-top: 32px; }
.overview-columns .section-heading { margin-bottom: 12px; }
.overview-columns .text-link { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; }
.queue-list { margin: 0; padding: 0; list-style: none; }
.queue-list li { padding-block: 14px; border-bottom: 1px solid var(--border); }
.queue-work { display: flex; align-items: center; gap: 12px; min-width: 0; }
.queue-work > span:nth-child(2) { min-width: 0; flex: 1; display: grid; gap: 4px; }
.queue-work strong { font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.queue-work:hover strong { color: var(--blue-hover); }
.queue-work .revision-label { color: var(--amber); }
.queue-work > svg { flex-shrink: 0; color: var(--muted); }
.queue-cover { width: 48px; height: 60px; flex: 0 0 48px; display: grid; place-items: center; overflow: hidden; background: var(--surface-soft); color: var(--muted); border-radius: 4px; }
.queue-cover img { width: 100%; height: 100%; object-fit: cover; }
.overview-shortcuts > h3 { margin: 12px 0; }
.shortcut { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px; text-align: left; border-radius: 6px; }
.shortcut:hover { background: var(--surface); }
.shortcut > svg { color: var(--muted); flex-shrink: 0; }
.shortcut > span { flex: 1; min-width: 0; display: grid; gap: 4px; }
.shortcut strong { font-size: 14px; font-weight: 500; }
.overview-empty { min-height: 250px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 12px; text-align: center; }
.overview-empty > svg { color: var(--green); }
.overview-empty p { color: var(--muted); font-size: 12px; }
@media (max-width: 1100px) { .overview-columns { grid-template-columns: minmax(0, 1fr); } .overview-shortcuts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } .overview-shortcuts h3 { grid-column: 1 / -1; } }
@media (max-width: 639px) {
  .overview-summary { padding: 16px; }
  .overview-metrics { gap: 12px; }
  .overview-metric strong { font-size: 28px; }
  .overview-metric > span svg { display: none; }
  .overview-shortcuts { grid-template-columns: minmax(0, 1fr); }
}
</style>
