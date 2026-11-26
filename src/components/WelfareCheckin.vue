<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { CalendarCheck, Check } from '@lucide/vue'
import type { WelfareStatus } from '../../shared/welfare-points'
import { api, errorMessage, session } from '../state'
import LotteryFeedbackDialog, { type LotteryDraw, type LotteryAward } from './LotteryFeedbackDialog.vue'
import { formatPoints } from '../../shared/studio/community-wallet'

const props = defineProps<{ welfare: WelfareStatus; chances: number }>()
const emit = defineEmits<{ refresh: []; records: [] }>()
const busy = ref(false), error = ref(''), result = ref<LotteryDraw | null>(null), recovery = ref(false)
const claimButton = ref<HTMLButtonElement>()
async function closeResult() { result.value = null; await nextTick(); claimButton.value?.focus({ preventScroll: true }) }
const identity = () => `${session.user?.id || ''}:${session.user?.accountId || session.user?.id || ''}`
const storageKey = () => `community:checkin:${identity()}`
let revision = 0, controller: AbortController | undefined
const unavailable = computed(() => !props.welfare.pool?.ready ? '今日福利额度正在核对，请稍后刷新。'
  : props.welfare.pool.remaining < props.welfare.checkin.minPoints ? '今日剩余额度不足，暂不能领取签到奖励。北京时间次日 00:00 重置后再来。' : '')
const amount = (award: LotteryAward) => award.status === 'fulfilled' && !award.points ? '福利积分，数额待核对'
  : `${formatPoints(award.points ?? String(award.rewardPoints ?? 0))} 福利积分`
const expiry = (award: LotteryAward) => award.expiresAt
  ? `有效至 ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(award.expiresAt * 1000)}（北京时间）`
  : '首次到账后 24 小时有效'
function pendingId() { try { return sessionStorage.getItem(storageKey()) } catch { return null } }
function restore() { recovery.value = !!pendingId() }
watch(identity, () => { revision++; controller?.abort(); busy.value = false; error.value = ''; result.value = null; restore() }, { immediate: true, flush: 'sync' })
async function claim() {
  if (!session.user || busy.value) return
  const key = storageKey(), owner = identity(), request = ++revision
  const current = () => request === revision && owner === identity()
  let requestId = pendingId()
  if (!requestId && props.welfare.checkin.claimed) {
    if (!props.welfare.checkin.drawId) return
    busy.value = true; error.value = ''
    controller = new AbortController()
    const abort = controller, timeout = setTimeout(() => abort.abort(), 15000)
    try {
      const value = await api<{ items: LotteryDraw[] }>(`/api/lottery/records?drawId=${encodeURIComponent(props.welfare.checkin.drawId)}`, { expectedAccount: session.user.id, signal: abort.signal })
      if (current()) { result.value = value.items[0] ?? null; if (!result.value) error.value = '签到记录暂不可用，请刷新后重试。' }
    } catch { if (current()) error.value = '签到记录暂不可用，请刷新后重试。' }
    finally { clearTimeout(timeout); if (current()) busy.value = false }
    return
  }
  if (!requestId && unavailable.value) { error.value = unavailable.value; emit('refresh'); return }
  requestId ||= crypto.randomUUID()
  try { sessionStorage.setItem(key, requestId) } catch { /* Server daily uniqueness also protects retries when storage is unavailable. */ }
  recovery.value = true; busy.value = true; error.value = ''
  controller = new AbortController()
  const abort = controller, timeout = setTimeout(() => abort.abort(), 15000)
  try {
    const draw = await api<LotteryDraw>('/api/lottery/checkin', { method: 'POST', body: { requestId }, signal: abort.signal, expectedAccount: session.user.id })
    if (!current()) return
    try { sessionStorage.removeItem(key) } catch { /* Reusing the saved request only retrieves its original receipt. */ }
    recovery.value = false; result.value = draw; emit('refresh')
  } catch (cause) {
    if (!current()) return
    const code = errorMessage(cause), messages: Record<string, string> = {
      WELFARE_POOL_EXHAUSTED: '今日剩余福利积分不足，无法领取。北京时间次日 00:00 重置后再来。',
      WELFARE_CHECKIN_DISABLED: '每日签到暂未开放，请稍后再来。', WELFARE_UNAVAILABLE: '奖励发放服务暂不可用，请稍后重试。',
      LOTTERY_ACCOUNT_REQUIRED: '请先连接章鱼账号，再领取签到奖励。', LOTTERY_FORBIDDEN: '当前账号暂不能领取奖励。',
    }
    if (messages[code]) { try { sessionStorage.removeItem(key) } catch {} recovery.value = false }
    error.value = messages[code] || '签到结果尚未确认，请点击“核对签到结果”。不会重复发奖。'
    emit('refresh')
  } finally { clearTimeout(timeout); if (current()) busy.value = false }
}
onBeforeUnmount(() => { revision++; controller?.abort() })
</script>

<template>
  <section v-if="welfare.checkin.enabled" class="checkin-card" aria-labelledby="daily-checkin-heading">
    <CalendarCheck :size="26" aria-hidden="true" />
    <div class="checkin-copy"><h2 id="daily-checkin-heading">每日签到<span v-if="welfare.checkin.claimed"><Check :size="14" aria-hidden="true" />今日已签到</span></h2>
      <p v-if="welfare.checkin.claimed">本次获得 <strong>{{ welfare.checkin.points?.toLocaleString('zh-CN') }}</strong> 福利积分 · {{ welfare.checkin.status === 'fulfilled' ? '已到账' : '待到账' }}</p>
      <p v-else>签到随机领 <strong>{{ welfare.checkin.minPoints.toLocaleString('zh-CN') }}–{{ welfare.checkin.maxPoints.toLocaleString('zh-CN') }}</strong> 福利积分</p>
      <small>到账后 24 小时有效 · 每人每天一次 · 北京时间 00:00 重置</small>
      <p v-if="error" class="checkin-error" role="alert">{{ error }}</p>
      <p v-else-if="unavailable && !welfare.checkin.claimed" class="checkin-error" role="status">{{ unavailable }}</p>
    </div>
    <button v-if="session.user" ref="claimButton" type="button" class="button primary btn" :disabled="busy" :aria-busy="busy" @click="claim">{{ busy ? '正在核对…' : recovery ? '核对签到结果' : welfare.checkin.claimed ? '查看签到奖励' : '立即签到' }}</button>
    <RouterLink v-else to="/account?returnTo=%2Factivities" class="button primary btn">登录后签到</RouterLink>
  </section>
  <LotteryFeedbackDialog v-if="result" :draw="result" :chances="chances" :refreshing="false" :reward-amount="amount" :reward-expiry="expiry"
    @close="closeResult" @update="result = $event; emit('refresh')" @records="result = null; emit('records')" @refresh="emit('refresh')" />
</template>

<style scoped>
.checkin-card { display: flex; align-items: center; gap: 18px; padding: 24px 0; border-bottom: 1px solid var(--border); }
.checkin-card > svg { flex: none; color: var(--accent); }
.checkin-copy { flex: 1; min-width: 0; }
.checkin-copy h2 { margin: 0 0 6px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 18px; }
.checkin-copy h2 span { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: var(--muted); }
.checkin-copy p { margin: 0 0 6px; line-height: 1.6; overflow-wrap: anywhere; }
.checkin-copy strong { font-variant-numeric: tabular-nums; }
.checkin-copy small { color: var(--muted); line-height: 1.6; }
.checkin-copy .checkin-error { margin-top: 8px; font-size: 14px; }
.checkin-card > .button { flex: none; min-height: 44px; }
@media (max-width: 600px) { .checkin-card { display: grid; grid-template-columns: 26px minmax(0,1fr); gap: 12px; align-items: start; }.checkin-card > .button { grid-column: 2; justify-self: start; } }
</style>
