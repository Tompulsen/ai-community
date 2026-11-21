<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RefreshCw } from '@lucide/vue'
import { lotteryPointUnits, type PublicLotteryParticipant, type PublicLotterySummary } from '../../shared/lottery-public'
import { formatPoints } from '../../shared/studio/community-wallet'
import { api, errorMessage } from '../state'

const records = ref<PublicLotteryParticipant[]>([]), visibleCount = ref(20), sort = ref('points-desc')
const loading = ref(true), error = ref(''), loaded = ref(false)
let sequence = 0, controller: AbortController | undefined
const sorted = computed(() => [...records.value].sort((a, b) => {
  const points = sort.value.startsWith('points')
  const left = points ? lotteryPointUnits(a.totalPoints) : BigInt(a.drawCount)
  const right = points ? lotteryPointUnits(b.totalPoints) : BigInt(b.drawCount)
  const order = left < right ? -1 : left > right ? 1 : 0
  return (sort.value.endsWith('asc') ? order : -order) || a.id.localeCompare(b.id)
}))
const visible = computed(() => sorted.value.slice(0, visibleCount.value))
watch(sort, () => { visibleCount.value = 20 })
async function load() {
  const id = ++sequence
  controller?.abort(); controller = new AbortController()
  loading.value = true; error.value = ''
  try {
    const data = await api<PublicLotterySummary>('/api/lottery/public-summary', { signal: controller.signal })
    if (id !== sequence) return
    records.value = data.items; visibleCount.value = 20; loaded.value = true
  } catch (cause) { if (id === sequence) error.value = errorMessage(cause) }
  finally { if (id === sequence) loading.value = false }
}
onMounted(() => load())
onBeforeUnmount(() => { sequence++; controller?.abort() })
defineExpose({ refresh: () => load() })
</script>

<template>
  <section class="lottery-public-results" aria-labelledby="lottery-public-title">
    <header class="section-heading"><div><h2 id="lottery-public-title">用户抽奖统计</h2><p class="muted">每位用户合并展示。积分为历次已核验到账的中奖总额，包含已使用或已到期的奖励；当前余额请到我的账户查看。昵称已脱敏。</p></div><button type="button" class="icon-button" aria-label="刷新抽奖统计" :disabled="loading" @click="load()"><RefreshCw :size="18" aria-hidden="true" /></button></header>
    <div class="public-result-controls"><label for="lottery-public-sort">排序方式</label><select id="lottery-public-sort" v-model="sort"><option value="points-desc">中奖积分：从高到低</option><option value="points-asc">中奖积分：从低到高</option><option value="draws-desc">抽奖次数：从多到少</option><option value="draws-asc">抽奖次数：从少到多</option></select><span v-if="loaded" class="muted" role="status">共 {{ formatPoints(String(records.length)) }} 位参与用户</span></div>
    <p v-if="loading" role="status">正在读取抽奖统计…</p>
    <div v-if="error" class="form-error" role="alert"><p>抽奖统计读取失败：{{ error }}</p><button type="button" class="button btn" :disabled="loading" @click="load()">重新读取抽奖统计</button></div>
    <div v-if="records.length" class="public-result-table">
      <table aria-labelledby="lottery-public-title"><thead><tr><th scope="col">参与用户</th><th scope="col" :aria-sort="sort.startsWith('points') ? sort.endsWith('asc') ? 'ascending' : 'descending' : undefined">累计中奖积分</th><th scope="col" :aria-sort="sort.startsWith('draws') ? sort.endsWith('asc') ? 'ascending' : 'descending' : undefined">抽奖总次数</th><th scope="col">奖励状态</th></tr></thead><tbody>
        <tr v-for="record in visible" :key="record.id">
          <td data-label="参与用户"><strong>{{ record.participant }}</strong></td>
          <td data-label="累计中奖积分"><div class="public-points"><strong>{{ formatPoints(record.totalPoints) }} 积分</strong><p class="muted">福利积分 {{ formatPoints(record.charityPoints) }}<br>永久积分 {{ formatPoints(record.permanentPoints) }}</p></div></td>
          <td data-label="抽奖总次数"><strong>{{ formatPoints(record.drawCount) }} 次</strong></td>
          <td data-label="奖励状态"><ul class="public-award-status"><li>已到账 {{ formatPoints(record.fulfilledCount) }} 次</li><li v-if="record.pendingCount !== '0'">待发放 {{ formatPoints(record.pendingCount) }} 次</li><li v-if="record.unverifiedCount !== '0'">待核对 {{ formatPoints(record.unverifiedCount) }} 次</li><li v-if="record.emptyCount !== '0'">未中奖 {{ formatPoints(record.emptyCount) }} 次</li></ul></td>
        </tr>
      </tbody></table>
    </div>
    <p v-else-if="loaded && !loading && !error" class="public-empty">还没有抽奖记录，参与后会在这里展示。</p>
    <button v-if="visibleCount < records.length" type="button" class="button btn public-more" @click="visibleCount += 20">查看更多用户</button>
    <p v-else-if="records.length" class="muted public-end">已展示全部参与用户</p>
  </section>
</template>

<style scoped>
.lottery-public-results { border-top: 1px solid var(--border); padding-block: var(--space-section); min-width: 0; }
.lottery-public-results > .section-heading { display: grid; grid-template-columns: minmax(0, 1fr) var(--target-size); align-items: start; gap: var(--space-group); margin-bottom: var(--space-group); }
.lottery-public-results h2 { margin: 0 0 var(--space-small); font-size: 20px; line-height: 28px; }
.lottery-public-results header p { margin: 0; line-height: 24px; font-size: 12px; text-wrap: pretty; }
.public-result-controls { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-control); margin-bottom: var(--space-group); font-size: 12px; }
.public-result-controls select { min-width: 0; max-width: 100%; min-height: var(--target-size); padding: var(--space-control); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--ink); font: inherit; }
.public-result-controls > span { margin-left: auto; }
.public-result-table { min-width: 0; }
.public-result-table table { width: 100%; border-collapse: collapse; text-align: start; table-layout: fixed; }
.public-result-table th { color: var(--muted); font-size: 12px; font-weight: 400; }
.public-result-table :is(th, td) { padding: var(--space-group) var(--space-control); border-bottom: 1px solid var(--border); vertical-align: top; text-align: start; overflow-wrap: anywhere; }
.public-result-table :is(th, td):first-child { padding-left: 0; width: 18%; }
.public-result-table :is(th, td):nth-child(2) { width: 38%; }
.public-result-table :is(th, td):nth-child(3) { width: 18%; }
.public-result-table :is(th, td):last-child { padding-right: 0; }
.public-result-table p { margin: var(--space-small) 0 0; font-size: 12px; }
.public-result-table strong { font-weight: 500; font-variant-numeric: tabular-nums; }
.public-points strong { font-size: 16px; }
.public-award-status { list-style: none; padding: 0; margin: 0; font-size: 12px; line-height: 24px; color: var(--muted); }
.public-more { margin-top: var(--space-group); min-height: var(--target-size); }
.public-empty, .public-end { padding-block: var(--space-group); }
.public-end { font-size: 12px; }
.lottery-public-results :is(button, select, [tabindex]):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
@media (max-width: 700px) {
  .public-result-table :is(table, tbody, tr, td) { display: block; width: 100%; }
  .public-result-table thead { display: none; }
  .public-result-table tr { padding-block: var(--space-group); border-bottom: 1px solid var(--border); }
  .public-result-table td, .public-result-table td:first-child, .public-result-table td:nth-child(2), .public-result-table td:nth-child(3) { display: grid; grid-template-columns: 6em minmax(0, 1fr); gap: var(--space-small) var(--space-control); padding: var(--space-small) 0; border: 0; width: 100%; }
  .public-result-table td::before { content: attr(data-label); color: var(--muted); font-size: 12px; line-height: 22px; }
  .public-result-table td > p { grid-column: 2; margin: 0; }
  .public-result-controls > span { width: 100%; margin-left: 0; }
}
</style>
