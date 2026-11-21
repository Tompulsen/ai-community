<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RefreshCw } from '@lucide/vue'
import { isClownPrize, type PublicLotteryDraw, type PublicLotteryPage } from '../../shared/lottery-public'
import { formatPoints } from '../../shared/studio/community-wallet'
import { api, errorMessage, queryString } from '../state'

const records = ref<PublicLotteryDraw[]>([]), nextCursor = ref<string | null>(null), snapshot = ref<string | null>(null)
const loading = ref(true), error = ref(''), loaded = ref(false)
let sequence = 0, controller: AbortController | undefined
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
async function load(more = false) {
  if (more && (loading.value || !nextCursor.value || !snapshot.value)) return
  const id = ++sequence
  controller?.abort(); controller = new AbortController()
  loading.value = true; error.value = ''
  try {
    const data = await api<PublicLotteryPage>('/api/lottery/public-records' + queryString(more ? { cursor: nextCursor.value!, snapshot: snapshot.value! } : {}), { signal: controller.signal })
    if (id !== sequence) return
    records.value = more ? [...records.value, ...data.items.filter(item => !records.value.some(previous => previous.id === item.id))] : data.items
    nextCursor.value = data.nextCursor; snapshot.value = data.snapshot; loaded.value = true
  } catch (cause) { if (id === sequence) error.value = errorMessage(cause) }
  finally { if (id === sequence) loading.value = false }
}
onMounted(() => load())
onBeforeUnmount(() => { sequence++; controller?.abort() })
defineExpose({ refresh: () => load() })
</script>

<template>
  <section class="lottery-public-results" aria-labelledby="lottery-public-title">
    <header class="section-heading"><div><h2 id="lottery-public-title">中奖动态</h2><p class="muted">所有用户的抽奖记录，按最近参与排序。昵称已脱敏，中奖积分为该次奖励，并非当前账户余额。</p></div><button type="button" class="icon-button" aria-label="刷新中奖动态" :disabled="loading" @click="load()"><RefreshCw :size="18" aria-hidden="true" /></button></header>
    <p v-if="loading && !loaded" role="status">正在读取中奖动态…</p>
    <div v-if="error" class="form-error" role="alert"><p>中奖动态读取失败：{{ error }}</p><button type="button" class="button btn" :disabled="loading" @click="load()">重新读取中奖动态</button></div>
    <div v-if="records.length" class="public-result-table">
      <table aria-labelledby="lottery-public-title"><thead><tr><th scope="col">参与用户</th><th scope="col">奖项与中奖积分</th><th scope="col">抽奖次数</th><th scope="col">抽奖时间</th></tr></thead><tbody>
        <tr v-for="record in records" :key="record.id">
          <td data-label="参与用户"><strong>{{ record.participant }}</strong></td>
          <td data-label="奖项与中奖积分"><ul class="public-awards"><li v-for="(prize, index) in record.prizes" :key="index"><div class="public-prize-name"><span v-if="isClownPrize(prize.name)" role="img" aria-label="小丑奖">🤡</span><span v-else>{{ prize.name }}</span></div><div class="public-prize-amount"><template v-if="prize.status === 'fulfilled' && prize.points !== null"><strong>{{ formatPoints(prize.points) }} {{ prize.rewardKind === 'charity' ? '福利积分' : '永久积分' }}</strong><span class="public-award-status">已到账</span></template><span v-else-if="prize.status === 'fulfilled'">发放记录待核对</span><span v-else-if="prize.status === 'pending'" class="public-pending">待发放</span><span v-else class="muted">未中奖</span></div></li></ul></td>
          <td data-label="抽奖次数"><div>本次 {{ record.drawCount }} 次</div><p class="muted">{{ record.totalDrawCount === null ? '累计次数待核对' : `累计 ${formatPoints(record.totalDrawCount)} 次` }}</p></td>
          <td data-label="抽奖时间"><time :datetime="record.createdAt" :title="new Date(record.createdAt).toLocaleString('zh-CN')">{{ date(record.createdAt) }}</time></td>
        </tr>
      </tbody></table>
    </div>
    <p v-else-if="loaded && !loading && !error" class="public-empty">还没有抽奖记录，参与后会在这里展示。</p>
    <button v-if="nextCursor" type="button" class="button btn public-more" :disabled="loading" @click="load(true)">{{ loading ? '正在读取…' : '查看更多抽奖记录' }}</button>
    <p v-else-if="records.length" class="muted public-end">已展示全部记录</p>
  </section>
</template>

<style scoped>
.lottery-public-results { border-top: 1px solid var(--border); padding-block: var(--space-section); min-width: 0; }
.lottery-public-results > .section-heading { display: grid; grid-template-columns: minmax(0, 1fr) var(--target-size); align-items: start; gap: var(--space-group); margin-bottom: var(--space-group); }
.lottery-public-results h2 { margin: 0 0 var(--space-small); font-size: 20px; line-height: 28px; }
.lottery-public-results header p { margin: 0; line-height: 24px; font-size: 12px; text-wrap: pretty; }
.public-result-table { min-width: 0; }
.public-result-table table { width: 100%; border-collapse: collapse; text-align: start; table-layout: fixed; }
.public-result-table th { color: var(--muted); font-size: 12px; font-weight: 400; }
.public-result-table :is(th, td) { padding: var(--space-group) var(--space-control); border-bottom: 1px solid var(--border); vertical-align: top; text-align: start; overflow-wrap: anywhere; }
.public-result-table :is(th, td):first-child { padding-left: 0; width: 18%; }
.public-result-table :is(th, td):nth-child(2) { width: 44%; }
.public-result-table :is(th, td):last-child { padding-right: 0; }
.public-result-table p { margin: var(--space-small) 0 0; font-size: 12px; }
.public-awards { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-control); }
.public-prize-name { font-size: 12px; color: var(--muted); margin-bottom: var(--space-label); }
.public-prize-name [role=img] { font-size: 22px; }
.public-prize-amount { display: flex; flex-wrap: wrap; gap: var(--space-small) var(--space-control); align-items: baseline; font-variant-numeric: tabular-nums; }
.public-prize-amount strong { font-weight: 500; }
.public-award-status { color: var(--green); font-size: 12px; white-space: nowrap; }
.public-pending { color: var(--muted); }
.public-more { margin-top: var(--space-group); min-height: var(--target-size); }
.public-empty, .public-end { padding-block: var(--space-group); }
.public-end { font-size: 12px; }
.lottery-public-results :is(button, [tabindex]):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
@media (max-width: 700px) {
  .public-result-table :is(table, tbody, tr, td) { display: block; width: 100%; }
  .public-result-table thead { display: none; }
  .public-result-table tr { padding-block: var(--space-group); border-bottom: 1px solid var(--border); }
  .public-result-table td, .public-result-table td:first-child, .public-result-table td:nth-child(2) { display: grid; grid-template-columns: 6em minmax(0, 1fr); gap: var(--space-small) var(--space-control); padding: var(--space-small) 0; border: 0; width: 100%; }
  .public-result-table td::before { content: attr(data-label); color: var(--muted); font-size: 12px; line-height: 22px; }
  .public-result-table td > p { grid-column: 2; margin: 0; }
}
</style>
