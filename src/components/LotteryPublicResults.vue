<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CalendarDays, Coins } from '@lucide/vue'
import { lotteryPointUnits, type PublicLotteryPeriod, type PublicLotterySummary } from '../../shared/lottery-public'
import { lotteryDay } from '../../shared/lottery-daily'
import { formatPoints } from '../../shared/studio/community-wallet'
import { api, errorMessage } from '../state'

const data = ref<PublicLotterySummary | null>(null), visibleCount = ref(20), dayCount = ref(7), sort = ref('points-desc')
const period = ref<PublicLotteryPeriod>('today'), today = ref(lotteryDay(new Date()).date)
const start = ref(today.value), end = ref(today.value), formError = ref('')
const periods: { value: PublicLotteryPeriod; label: string }[] = [
  { value: 'today', label: '今日' }, { value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' },
  { value: 'all', label: '全部' }, { value: 'custom', label: '自定义' },
]
const loading = ref(true), error = ref('')
let sequence = 0, controller: AbortController | undefined
const records = computed(() => data.value?.items ?? [])
const rangeLabel = computed(() => {
  const range = data.value?.range
  return !range ? '' : range.period === 'all' ? '全部历史' : range.start === range.end ? range.start : range.start + ' 至 ' + range.end + ' · ' + range.days + ' 天'
})
const sorted = computed(() => [...records.value].sort((a, b) => {
  const points = sort.value.startsWith('points')
  const left = points ? lotteryPointUnits(a.totalPoints) : BigInt(a.drawCount)
  const right = points ? lotteryPointUnits(b.totalPoints) : BigInt(b.drawCount)
  const order = left < right ? -1 : left > right ? 1 : 0
  return (sort.value.endsWith('asc') ? order : -order) || a.id.localeCompare(b.id)
}))
const visible = computed(() => sorted.value.slice(0, visibleCount.value))
watch(sort, () => { visibleCount.value = 20 })
function choosePeriod(value: PublicLotteryPeriod) {
  period.value = value; formError.value = ''; data.value = null; error.value = ''
  if (value === 'custom') { sequence++; controller?.abort(); loading.value = false }
  else void load()
}
async function load() {
  today.value = lotteryDay(new Date()).date
  formError.value = ''
  const query = new URLSearchParams({ period: period.value })
  if (period.value === 'custom') {
    const days = (Date.parse(end.value) - Date.parse(start.value)) / 86_400_000 + 1
    if (!start.value || !end.value || !Number.isFinite(days) || days < 1 || days > 366 || end.value > today.value) {
      formError.value = '请选择有效的起止日期，最多 366 天，结束日期不能晚于今天。'; return
    }
    query.set('start', start.value); query.set('end', end.value)
  }
  const id = ++sequence
  controller?.abort(); controller = new AbortController()
  loading.value = true; error.value = ''
  try {
    const result = await api<PublicLotterySummary>('/api/lottery/public-summary?' + query, { signal: controller.signal })
    if (id !== sequence) return
    data.value = result; visibleCount.value = 20; dayCount.value = 7
  } catch (cause) { if (id === sequence) error.value = errorMessage(cause) }
  finally { if (id === sequence) loading.value = false }
}
onMounted(() => load())
onBeforeUnmount(() => { sequence++; controller?.abort() })
defineExpose({ refresh: () => load(), loading })
</script>

<template>
  <section class="lottery-public-results" aria-labelledby="lottery-public-title">
    <header class="section-heading">
      <div><h2 id="lottery-public-title">排行榜</h2></div>
    </header>
    <div class="public-periods" role="group" aria-label="统计时间范围">
      <button v-for="item in periods" :key="item.value" type="button" :aria-pressed="period === item.value" @click="choosePeriod(item.value)">{{ item.label }}</button>
    </div>
    <form v-if="period === 'custom'" class="public-dates" @submit.prevent="load()">
      <label>开始日期<input v-model="start" type="date" required :max="today" aria-describedby="lottery-date-help" :aria-invalid="!!formError"></label>
      <label>结束日期<input v-model="end" type="date" required :min="start" :max="today" aria-describedby="lottery-date-help" :aria-invalid="!!formError"></label>
      <button class="button" type="submit" :disabled="loading">查询统计</button>
      <p id="lottery-date-help" class="muted">包含起止当天，最多查询 366 天。</p>
      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
    </form>
    <p v-if="loading" class="public-feedback" role="status">正在读取排行榜…</p>
    <div v-if="error" class="form-error" role="alert"><p>排行榜读取失败：{{ error }}</p><button type="button" class="button" :disabled="loading" @click="load()">重新读取排行榜</button></div>
    <template v-if="data">
      <p class="public-range" role="status"><CalendarDays :size="16" aria-hidden="true" /><span>{{ rangeLabel }}</span><span class="muted">北京时间</span><time :datetime="data.updatedAt" class="muted">更新于 {{ new Date(data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) }}</time></p>
      <dl class="public-overview">
        <div class="public-total"><dt><Coins :size="18" aria-hidden="true" />{{ data.range.period === 'today' ? '今日已发放积分' : '所选期间已发放积分' }}</dt><dd>{{ formatPoints(data.totals.totalPoints) }}<small>积分</small></dd><dd class="public-detail">福利积分 {{ formatPoints(data.totals.charityPoints) }}<span>账户积分 {{ formatPoints(data.totals.permanentPoints) }}</span></dd></div>
        <div><dt>抽奖总次数</dt><dd>{{ formatPoints(data.totals.drawCount) }}<small>次</small></dd><dd class="public-detail">按抽奖发生日期统计</dd></div>
        <div><dt>参与用户</dt><dd>{{ formatPoints(data.totals.participantCount) }}<small>位</small></dd><dd class="public-detail">期间抽奖或收到奖励</dd></div>
      </dl>
      <p class="public-note muted">积分按实际到账日期统计，包含已使用或已到期奖励；待发放和待核对金额不计入。昵称已脱敏。</p>
      <p v-if="data.totals.undatedPoints !== '0'" class="public-note">历史总额含 {{ formatPoints(data.totals.undatedPoints) }} 积分的到账日期待核对，未归入每日发放。</p>
      <section v-if="data.daily.length" class="public-daily" aria-labelledby="lottery-daily-title">
        <div class="public-subheading"><h3 id="lottery-daily-title">每日发放</h3><span class="muted">由近到远 · 已到账积分</span></div>
        <ul class="public-day-list">
          <li v-for="day in data.daily.slice(0, dayCount)" :key="day.date"><time :datetime="day.date">{{ day.date }}<small v-if="day.date === today">今日</small></time><div><strong>{{ formatPoints(day.totalPoints) }} <small>积分</small></strong><span class="muted">抽奖 {{ formatPoints(day.drawCount) }} 次 · 到账 {{ formatPoints(day.fulfilledCount) }} 次</span></div></li>
        </ul>
        <button v-if="dayCount < data.daily.length" type="button" class="button public-more" @click="dayCount += 30">查看更多日期（剩余 {{ data.daily.length - dayCount }} 天）</button>
      </section>
      <section class="public-users" aria-labelledby="lottery-users-title">
        <div class="public-subheading"><h3 id="lottery-users-title">用户排行</h3><span class="muted">共 {{ formatPoints(String(records.length)) }} 位</span></div>
        <div class="public-result-controls"><label for="lottery-public-sort">排序方式</label><select id="lottery-public-sort" v-model="sort"><option value="points-desc">中奖积分：从高到低</option><option value="points-asc">中奖积分：从低到高</option><option value="draws-desc">抽奖次数：从多到少</option><option value="draws-asc">抽奖次数：从少到多</option></select></div>
        <div v-if="records.length" class="public-result-table">
          <table aria-labelledby="lottery-users-title"><thead><tr><th scope="col">参与用户</th><th scope="col" :aria-sort="sort.startsWith('points') ? sort.endsWith('asc') ? 'ascending' : 'descending' : undefined">已到账积分</th><th scope="col" :aria-sort="sort.startsWith('draws') ? sort.endsWith('asc') ? 'ascending' : 'descending' : undefined">抽奖次数</th><th scope="col">奖励状态</th></tr></thead><tbody>
            <tr v-for="record in visible" :key="record.id">
              <td data-label="参与用户"><strong>{{ record.participant }}</strong></td>
              <td data-label="已到账积分"><div class="public-points"><strong>{{ formatPoints(record.totalPoints) }} 积分</strong><p class="muted">福利积分 {{ formatPoints(record.charityPoints) }}<br>账户积分 {{ formatPoints(record.permanentPoints) }}</p></div></td>
              <td data-label="抽奖次数"><strong>{{ formatPoints(record.drawCount) }} 次</strong></td>
              <td data-label="奖励状态"><ul class="public-award-status"><li>已到账 {{ formatPoints(record.fulfilledCount) }} 次</li><li v-if="record.pendingCount !== '0'">待发放 {{ formatPoints(record.pendingCount) }} 次</li><li v-if="record.unverifiedCount !== '0'">待核对 {{ formatPoints(record.unverifiedCount) }} 次</li><li v-if="record.emptyCount !== '0'">未中奖 {{ formatPoints(record.emptyCount) }} 次</li></ul></td>
            </tr>
          </tbody></table>
        </div>
        <p v-else class="public-empty">所选日期还没有抽奖记录或到账奖励，试试其他日期。</p>
        <button v-if="visibleCount < records.length" type="button" class="button public-more" @click="visibleCount += 20">查看更多用户</button>
        <p v-else-if="records.length" class="muted public-end">已展示全部参与用户。跨日补发计入到账当天，到账次数可能与抽奖次数不同。</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.lottery-public-results { padding-block: var(--space-section); min-width: 0; }
.lottery-public-results > .section-heading { margin-bottom: var(--space-group); }
.lottery-public-results h2 { margin: 0 0 var(--space-small); font-size: 20px; line-height: 28px; }
.lottery-public-results header p, .public-note { margin: 0; line-height: 22px; font-size: 12px; text-wrap: pretty; }
.lottery-public-results :is(button, select, input) { min-height: var(--target-size, 44px); }
.public-periods { display: inline-grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-soft); max-width: 100%; }
.public-periods button { padding: 8px 16px; border-radius: 4px; white-space: nowrap; color: var(--muted); }
.public-periods button[aria-pressed="true"] { background: var(--ink); color: var(--canvas); font-weight: 600; }
.public-periods button:hover:not([aria-pressed="true"]) { color: var(--ink); background: var(--surface); }
.public-dates { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 220px) max-content; align-items: end; gap: 12px; margin-top: 16px; }
.public-dates label { display: grid; gap: 8px; min-width: 0; font-size: 12px; }
.public-dates input, .public-result-controls select { min-width: 0; width: 100%; max-width: 100%; padding: 8px 12px; border: 1px solid var(--control-border); border-radius: var(--radius); background: var(--surface); color: var(--ink); font: inherit; }
.public-dates p { grid-column: 1 / -1; margin: 0; font-size: 12px; }
.public-feedback { padding-block: 16px; }
.public-range { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 20px 0 12px; font-size: 12px; }
.public-overview { display: grid; grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0 0 12px; }
.public-overview > div { padding: 20px; border: 1px solid var(--border); border-radius: var(--radius); min-width: 0; background: var(--surface); }
.public-overview .public-total { background: var(--blue-soft); }
.public-overview dt { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.public-overview dd { margin: 12px 0 8px; font-size: clamp(24px, 2.6vw, 36px); line-height: 1.25; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.public-overview dd small { margin-left: 8px; font-size: 12px; font-weight: 400; }
.public-overview .public-detail { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; line-height: 20px; font-weight: 400; margin: 0; color: var(--muted); }
.public-note + .public-note { margin-top: 8px; }
.public-daily, .public-users { margin-top: 24px; min-width: 0; }
.public-subheading { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.public-subheading h3 { font-size: 16px; line-height: 24px; margin: 0; font-weight: 500; }
.public-subheading > span { font-size: 12px; }
.public-day-list { list-style: none; padding: 0; margin: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
.public-day-list li { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr); align-items: center; gap: 12px; padding: 12px 16px; }
.public-day-list li + li { border-top: 1px solid var(--border); }
.public-day-list time { font-variant-numeric: tabular-nums; font-size: 12px; }
.public-day-list time small { margin-left: 8px; color: var(--muted); }
.public-day-list li > div { display: grid; gap: 4px; text-align: right; min-width: 0; overflow-wrap: anywhere; }
.public-day-list strong { font-weight: 500; font-variant-numeric: tabular-nums; }
.public-day-list strong small, .public-day-list li > div > span { font-size: 12px; font-weight: 400; }
.public-result-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; font-size: 12px; }
.public-result-controls select { width: auto; }
.public-result-table table { width: 100%; border-collapse: collapse; text-align: start; table-layout: fixed; }
.public-result-table th { color: var(--muted); font-size: 12px; font-weight: 400; background: var(--surface-soft); }
.public-result-table :is(th, td) { padding: 16px; border-bottom: 1px solid var(--border); vertical-align: top; text-align: start; overflow-wrap: anywhere; }
.public-result-table :is(th, td):first-child { width: 20%; }
.public-result-table :is(th, td):nth-child(2) { width: 36%; }
.public-result-table :is(th, td):nth-child(3) { width: 18%; }
.public-result-table p { margin: 8px 0 0; font-size: 12px; line-height: 20px; }
.public-result-table strong { font-weight: 500; font-variant-numeric: tabular-nums; }
.public-points strong { font-size: 16px; }
.public-award-status { display: flex; flex-wrap: wrap; gap: 4px 12px; list-style: none; padding: 0; margin: 0; font-size: 12px; line-height: 24px; color: var(--muted); }
.public-more { margin-top: 16px; }
.public-empty { padding: 24px 16px; border: 1px dashed var(--border); border-radius: var(--radius); text-align: center; color: var(--muted); }
.public-end { margin: 16px 0 0; font-size: 12px; line-height: 22px; }
.lottery-public-results :is(button, select, input):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
@media (max-width: 700px) {
  .public-periods { display: grid; width: 100%; }
  .public-periods button { padding-inline: 4px; font-size: 12px; }
  .public-dates { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .public-dates button { grid-column: 1 / -1; }
  .public-dates input { padding-inline: 8px; }
  .public-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .public-overview > div { padding: 16px; }
  .public-overview .public-total { grid-column: 1 / -1; }
  .public-overview .public-total dd:not(.public-detail) { font-size: 32px; }
  .public-day-list li { padding: 12px; }
  .public-day-list time small { display: block; margin: 4px 0 0; }
  .public-result-table :is(table, tbody, tr, td) { display: block; width: 100%; }
  .public-result-table thead { display: none; }
  .public-result-table tr { padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .public-result-table tr + tr { margin-top: 12px; }
  .public-result-table td, .public-result-table td:first-child, .public-result-table td:nth-child(2), .public-result-table td:nth-child(3) { display: grid; grid-template-columns: 5em minmax(0, 1fr); gap: 8px; padding: 6px 0; border: 0; width: 100%; }
  .public-result-table td::before { content: attr(data-label); color: var(--muted); font-size: 12px; line-height: 22px; }
}
</style>
