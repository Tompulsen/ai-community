<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowDownLeft, ChevronLeft, ChevronRight, Receipt, RefreshCw } from '@lucide/vue'
import { session, errorMessage } from '../state'
import { studioAccount } from '../studio-account'
import type { UsageRecords } from '../../shared/studio/usage'

defineProps<{ standalone?: boolean }>()
const days = ref(7), model = ref<string | null>(null), page = ref(1)
const loading = ref(false), error = ref(''), data = ref<UsageRecords>()
const models = ref<UsageRecords['models']>([])
const currency = ref({ quotaPerUnit: 0, currencySymbol: '' })
const end = ref(Math.floor(Date.now() / 1000))
const identity = computed(() => `${session.user?.id || ''}:${session.user?.accountId || ''}`)
let revision = 0, controller: AbortController | undefined, previousIdentity = ''
const count = (value: number) => value.toLocaleString('zh-CN')
const number = (quota: number) => currency.value.quotaPerUnit > 0 ? (quota / currency.value.quotaPerUnit).toLocaleString('zh-CN', { maximumFractionDigits: 6 }) : '—'
const amount = (quota: number) => `${currency.value.currencySymbol} ${number(quota)}`
const date = (seconds: number) => new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false })
const pageCount = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / 20)))
const title = computed(() => currency.value.currencySymbol === '积分' ? '积分净消耗' : '净消耗')

async function load() {
  const current = ++revision, owner = identity.value
  controller?.abort(); controller = new AbortController()
  data.value = undefined; error.value = ''
  if (!session.user) { loading.value = false; return }
  loading.value = true
  const query = new URLSearchParams({ page: String(page.value), size: '20', start: String(end.value - days.value * 86400), end: String(end.value) })
  if (model.value !== null) query.set('model', model.value)
  try {
    const [result, status] = await Promise.all([
      studioAccount<UsageRecords>(`logs?${query}`, 'GET', undefined, controller.signal),
      studioAccount<typeof currency.value>('status', 'GET', undefined, controller.signal),
    ])
    if (current !== revision || owner !== identity.value) return
    if (!Number.isFinite(status.quotaPerUnit) || status.quotaPerUnit <= 0 || !status.currencySymbol) throw new Error('积分换算暂不可用，请稍后重试。')
    currency.value = status; data.value = result; models.value = result.models || []
  } catch (cause) {
    if (current === revision && owner === identity.value) error.value = errorMessage(cause)
  } finally { if (current === revision) loading.value = false }
}
watch([identity, days, model], ([owner, period], previous) => {
  page.value = 1
  if (owner !== previousIdentity) {
    previousIdentity = owner; models.value = []; currency.value = { quotaPerUnit: 0, currencySymbol: '' }
    ++revision; controller?.abort(); data.value = undefined; error.value = ''
    end.value = Math.floor(Date.now() / 1000)
    if (days.value !== 7 || model.value !== null) { days.value = 7; model.value = null; return }
  }
  if (period !== previous?.[1]) end.value = Math.floor(Date.now() / 1000)
  void load()
}, { immediate: true })
onBeforeUnmount(() => { ++revision; controller?.abort() })
function refresh() { page.value = 1; end.value = Math.floor(Date.now() / 1000); void load() }
function changePage(value: number) { page.value = value; void load() }
function reset() { days.value = 7; model.value = null }
</script>

<template>
  <section class="usage-records" aria-label="消费记录" :aria-busy="loading">
    <header class="usage-heading">
      <div><component :is="standalone ? 'h1' : 'h2'">消费记录</component><p>每一次创作，消耗清晰可见</p></div>
      <button class="button subtle btn usage-refresh" :disabled="loading" aria-label="刷新消费记录" @click="refresh"><RefreshCw :size="16" aria-hidden="true" /><span>刷新</span></button>
    </header>
    <div class="usage-filters">
      <label class="field"><span>时间范围</span><select v-model="days" class="control" aria-label="时间范围"><option :value="1">近 24 小时</option><option :value="7">近 7 天</option><option :value="30">近 30 天</option></select></label>
      <label class="field usage-model"><span>模型</span><select v-model="model" class="control" aria-label="模型"><option :value="null">全部模型</option><option v-if="model !== null && !models.some(item => item.model === model)" :value="model">{{ model || '未标注模型' }}</option><option v-for="item in models" :key="item.model" :value="item.model">{{ item.model || '未标注模型' }}</option></select></label>
      <button v-if="days !== 7 || model !== null" class="button subtle btn usage-reset" @click="reset">重置筛选</button>
    </div>
    <p v-if="error" class="usage-error" role="alert">{{ error }}<button class="button subtle btn" @click="load">重试</button></p>
    <p v-if="loading" class="usage-state muted" role="status">正在读取消费记录与统计…</p>
    <template v-if="data && !error">
      <div class="usage-summary" aria-label="所选区间用量统计">
        <article class="usage-metric usage-primary" :aria-label="title"><span>{{ title }}</span><strong>{{ data.summary ? number(data.summary.netQuota) : '—' }}<small>{{ currency.currencySymbol }}</small></strong><p>消费减去同期退回</p></article>
        <article class="usage-metric" aria-label="消费积分"><span>消费{{ currency.currencySymbol === '积分' ? '积分' : '总额' }}</span><strong>{{ data.summary ? number(data.summary.consumeQuota) : '—' }}<small>{{ currency.currencySymbol }}</small></strong><p>{{ data.summary ? count(data.summary.consumeRecords) : '—' }} 条消费记录</p></article>
        <article class="usage-metric" aria-label="退回积分"><span>退回{{ currency.currencySymbol === '积分' ? '积分' : '总额' }}</span><strong>{{ data.summary ? number(data.summary.refundQuota) : '—' }}<small>{{ currency.currencySymbol }}</small></strong><p>{{ data.summary ? count(data.summary.refundRecords) : '—' }} 条退回记录</p></article>
        <article class="usage-metric usage-tokens" aria-label="输入输出用量"><span>输入 / 输出 Tokens</span><strong>{{ data.summary ? count(data.summary.promptTokens) : '—' }}<small>/ {{ data.summary ? count(data.summary.completionTokens) : '—' }}</small></strong><p>以模型实际报告为准</p></article>
      </div>
      <p class="usage-scope">{{ model === null ? '全部模型' : model || '未标注模型' }} · 当前账号的全部密钥 · {{ date(data.start || end - days * 86400) }} — {{ date(data.end || end) }}</p>
      <details class="usage-explanation"><summary>统计说明</summary><p>统计覆盖所选时段的全部消费与退回记录，不包含充值。一次调用可能产生预扣、补扣或退回，因此记录数不等于调用次数。退回按到账时间计入，净消耗可能为负；未结算任务以当前已记录金额为准。图片、视频的 Tokens 为 0 不代表没有积分消耗。</p></details>
      <div class="usage-detail-heading"><component :is="standalone ? 'h2' : 'h3'">消费明细</component><span class="muted" role="status">共 {{ count(data.total) }} 条记录</span></div>
      <div v-if="data.items.length" class="usage-table-wrap">
        <table class="usage-table"><caption class="studio-sr-only">当前筛选条件下的消费与退回明细，第 {{ page }} 页</caption><thead><tr><th scope="col">时间</th><th scope="col">模型 / 密钥</th><th scope="col">输入 / 输出 Tokens</th><th scope="col">类型</th><th scope="col">积分变动</th></tr></thead>
          <tbody><tr v-for="item in data.items" :key="item.id"><td>{{ date(item.created_at) }}</td><td class="usage-model-cell"><strong>{{ item.model_name || '未标注模型' }}</strong><small>{{ item.token_name || '未命名密钥' }}</small></td><td>{{ count(item.prompt_tokens) }} / {{ count(item.completion_tokens) }}</td><td><span class="usage-kind" :class="{ refund: item.type === 6 }">{{ item.type === 6 ? '退回' : '消费' }}</span></td><td class="usage-amount" :class="{ refund: item.type === 6 }">{{ (item.type === 6 ? item.quota : -item.quota) > 0 ? '+' : '−' }} {{ amount(Math.abs(item.quota)) }}</td></tr></tbody>
        </table>
      </div>
      <div v-if="data.items.length" class="usage-cards" aria-label="消费明细列表"><article v-for="item in data.items" :key="item.id" class="usage-record"><div class="usage-record-top"><strong>{{ item.model_name || '未标注模型' }}</strong><span class="usage-amount" :class="{ refund: item.type === 6 }">{{ (item.type === 6 ? item.quota : -item.quota) > 0 ? '+' : '−' }} {{ number(Math.abs(item.quota)) }}<small>{{ currency.currencySymbol }}</small></span></div><div class="usage-record-meta"><span class="usage-kind" :class="{ refund: item.type === 6 }"><ArrowDownLeft v-if="item.type === 6" :size="12" aria-hidden="true" />{{ item.type === 6 ? '退回' : '消费' }}</span><time :datetime="new Date(item.created_at * 1000).toISOString()">{{ date(item.created_at) }}</time></div><dl><div><dt>密钥</dt><dd>{{ item.token_name || '未命名密钥' }}</dd></div><div><dt>输入 / 输出 Tokens</dt><dd>{{ count(item.prompt_tokens) }} / {{ count(item.completion_tokens) }}</dd></div></dl></article></div>
      <div v-else class="usage-empty"><Receipt :size="28" aria-hidden="true" /><component :is="standalone ? 'h2' : 'h3'">暂无消费记录</component><p>所选时段与模型没有消费或退回记录，可调整筛选条件。</p></div>
      <nav v-if="data.total > 20 || page > 1" class="usage-pagination" aria-label="消费明细分页"><span>第 {{ page }} / {{ pageCount }} 页</span><div><button class="icon-button" aria-label="上一页" :disabled="loading || page <= 1" @click="changePage(page - 1)"><ChevronLeft :size="20" /></button><button class="icon-button" aria-label="下一页" :disabled="loading || page >= pageCount" @click="changePage(page + 1)"><ChevronRight :size="20" /></button></div></nav>
    </template>
  </section>
</template>

<style scoped>
.usage-records { min-width: 0; padding-top: 20px; }
.usage-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; }
.usage-heading h1, .usage-heading h2 { font-size: 24px; font-weight: 650; letter-spacing: -.5px; }
.usage-heading p { color: var(--muted); font-size: 13px; margin-top: 6px; }
.usage-refresh, .usage-reset { min-height: 44px; flex-shrink: 0; }
.usage-filters { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.usage-filters .field { width: 180px; min-width: 0; font-size: 13px; }
.usage-filters .usage-model { flex: 1; min-width: 160px; max-width: 480px; }
.usage-filters select { width: 100%; min-height: 44px; padding-right: 32px; text-overflow: ellipsis; }
.usage-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.usage-metric { min-width: 0; padding: 20px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.usage-metric > span { color: var(--muted); font-size: 13px; }
.usage-metric strong { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px; margin-block: 12px 8px; font-size: 25px; line-height: 1.3; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.usage-metric strong small { font-size: 12px; font-weight: 400; color: var(--muted); }
.usage-metric p { color: var(--muted); font-size: 12px; }
.usage-primary { background: color-mix(in srgb, var(--blue) 9%, var(--surface)); border-color: color-mix(in srgb, var(--blue) 24%, var(--border)); }
.usage-primary strong, .usage-primary > span, .usage-primary p, .usage-primary strong small { color: var(--ink); }
.usage-tokens strong { font-size: 22px; }
.usage-scope { color: var(--muted); font-size: 12px; line-height: 1.7; margin-top: 16px; overflow-wrap: anywhere; }
.usage-explanation { color: var(--muted); font-size: 12px; margin-block: 4px 16px; }
.usage-explanation summary { width: fit-content; min-height: 44px; align-content: center; cursor: pointer; }
.usage-explanation p { line-height: 1.8; max-width: 880px; padding-bottom: 12px; }
.usage-detail-heading { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin: 12px 0 16px; }
.usage-detail-heading > :first-child { font-size: 16px; font-weight: 600; }
.usage-detail-heading > span { font-size: 12px; }
.usage-table-wrap { border: 1px solid var(--border); border-radius: 12px; overflow-x: auto; }
.usage-table { border-collapse: collapse; width: 100%; font-size: 13px; text-align: left; }
.usage-table th { font-weight: 500; background: var(--surface); color: var(--muted); white-space: nowrap; }
.usage-table td, .usage-table th { padding: 16px; border-bottom: 1px solid var(--border); }
.usage-table td:first-child { white-space: nowrap; color: var(--muted); font-size: 12px; }
.usage-table tr:last-child td { border-bottom: 0; }
.usage-model-cell { max-width: 280px; overflow-wrap: anywhere; }
.usage-model-cell strong { font-weight: 500; }
.usage-model-cell small { display: block; color: var(--muted); margin-top: 6px; }
.usage-kind { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; font-size: 12px; color: var(--ink); background: var(--state-hover); border-radius: 5px; white-space: nowrap; }
.usage-amount { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.refund { color: var(--blue); }
.usage-cards { display: none; }
.usage-empty { padding: 48px 16px; display: grid; justify-items: center; gap: 12px; text-align: center; border: 1px dashed var(--border); border-radius: 12px; }
.usage-empty > svg, .usage-empty p { color: var(--muted); }
.usage-empty h2, .usage-empty h3 { font-size: 16px; }
.usage-empty p { max-width: 340px; font-size: 13px; line-height: 1.7; }
.usage-pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-block: 16px; color: var(--muted); font-size: 13px; }
.usage-pagination > div { display: flex; gap: 8px; }
.usage-pagination button { min-width: 44px; min-height: 44px; border: 1px solid var(--border); border-radius: 8px; }
.usage-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 10px; margin-block: 16px; }
.usage-state { padding-block: 32px; font-size: 14px; }
@media (max-width: 1199px) { .usage-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 699px) {
  .usage-records { padding-top: 8px; }
  .usage-heading { margin-bottom: 20px; }
  .usage-heading h1, .usage-heading h2 { font-size: 22px; }
  .usage-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .usage-filters .field, .usage-filters .usage-model { width: auto; min-width: 0; max-width: none; }
  .usage-filters select { font-size: 16px; padding-inline: 10px 24px; }
  .usage-reset { justify-self: start; grid-column: 1 / -1; }
  .usage-summary { gap: 10px; }
  .usage-metric { padding: 14px 12px; border-radius: 12px; }
  .usage-metric strong, .usage-tokens strong { font-size: 20px; }
  .usage-metric > span { font-size: 12px; }
  .usage-table-wrap { display: none; }
  .usage-cards { display: grid; gap: 10px; }
  .usage-record { padding: 16px 14px; border: 1px solid var(--border); border-radius: 12px; }
  .usage-record-top { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
  .usage-record-top > strong { min-width: 0; font-size: 14px; font-weight: 550; overflow-wrap: anywhere; }
  .usage-record-top .usage-amount { text-align: right; font-size: 16px; max-width: 55%; overflow-wrap: anywhere; white-space: normal; }
  .usage-record-top .usage-amount small { display: block; color: var(--muted); font-size: 11px; font-weight: 400; margin-top: 3px; }
  .usage-record-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-block: 10px 14px; }
  .usage-record-meta time { color: var(--muted); font-size: 11px; }
  .usage-record dl { display: grid; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px; font-size: 12px; }
  .usage-record dl div { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
  .usage-record dt { color: var(--muted); flex-shrink: 0; }
  .usage-record dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
}
</style>
