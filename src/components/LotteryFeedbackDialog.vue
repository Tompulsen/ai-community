<script lang="ts">
export interface LotteryAward {
  prizeId: string; name: string; description: string; amountCents: number
  status: 'pending' | 'fulfilled' | 'empty'; note?: string; legacyPoints?: string | null
  rewardKind?: 'charity'; validityHours?: number; points?: string | null; expiresAt?: number | null
  rewardPoints?: number; source?: 'checkin'
}
export interface LotteryDraw { id: string; createdAt: string; prizes: LotteryAward[]; source?: 'checkin' }
export interface LotteryNotice {
  title: string; message: string; resetsAt?: string
  supportAmount?: string; shortfall?: string
  action?: 'support' | 'account' | 'refresh' | 'tasks'
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Check, Clock3, Gift, X } from '@lucide/vue'
import { api, queryString, session } from '../state'
import { accountBalance, balancePoints, refreshAccountBalance } from '../account-balance'
import { formatPoints } from '../../shared/studio/community-wallet'

const props = defineProps<{
  draw?: LotteryDraw | null; notice?: LotteryNotice | null; chances: number; refreshing: boolean
  rewardAmount: (award: LotteryAward) => string; rewardExpiry: (award: LotteryAward) => string
}>()
const emit = defineEmits<{ close: []; refresh: []; records: []; tasks: []; update: [draw: LotteryDraw] }>()
const id = `lottery-feedback-${useId()}`
const dialog = ref<HTMLDialogElement>()
const closing = ref<HTMLButtonElement>()
const checking = ref(false), receiptError = ref(''), walletReady = ref(false), walletLoading = ref(false)
const pending = computed(() => props.draw?.prizes.some(award => award.status === 'pending'))
const won = computed(() => props.draw?.prizes.some(award => award.status !== 'empty'))
const title = computed(() => props.draw
  ? !props.draw.prizes.length ? '奖励结果待核对' : won.value ? pending.value ? props.draw.source === 'checkin' ? '签到成功，奖励发放中' : '恭喜抽中奖励' : '恭喜获得积分' : '本次抽奖结果'
  : props.notice?.title)
const resetLabel = computed(() => {
  const time = Date.parse(props.notice?.resetsAt ?? '')
  return Number.isFinite(time) ? new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(time) : ''
})
const identity = () => `${session.user?.id || ''}:${session.user?.accountId || session.user?.id || ''}`
const owner = identity()
let active = true, reads = 0, walletRevision = 0
let opener: HTMLElement | null = null, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined
const current = () => active && owner === identity()

async function refreshWallet() {
  const request = ++walletRevision
  walletReady.value = false; walletLoading.value = true
  await refreshAccountBalance(true)
  if (!current() || request !== walletRevision) return
  walletReady.value = true; walletLoading.value = false
}
async function readReceipt() {
  if (!current() || !props.draw || checking.value) return
  clearTimeout(timer)
  checking.value = true; receiptError.value = ''
  controller = new AbortController()
  const reading = controller, drawId = props.draw.id
  const timeout = setTimeout(() => reading.abort(), 15000)
  try {
    const response = await api<{ items: LotteryDraw[] }>(`/api/lottery/records${queryString({ drawId })}`, {
      signal: reading.signal, expectedAccount: session.user?.accountId || session.user?.id,
    })
    if (!current() || reading.signal.aborted || props.draw?.id !== drawId) return
    const receipt = response.items.find(item => item.id === drawId)
    if (!receipt || !receipt.prizes.length) throw new Error('RECEIPT_UNAVAILABLE')
    const delivered = receipt.prizes.some((award, index) => award.status === 'fulfilled' && props.draw?.prizes[index]?.status !== 'fulfilled')
    emit('update', receipt)
    if (delivered) void refreshWallet()
    reads++
    if (receipt.prizes.some(award => award.status === 'pending') && reads < 5) timer = setTimeout(readReceipt, 3000)
  } catch {
    if (current() && !reading.signal.aborted) receiptError.value = '暂时无法查询到账状态，可稍后刷新或查看奖励记录。'
    else if (current()) receiptError.value = '到账状态查询超时，请稍后刷新。'
  } finally {
    clearTimeout(timeout)
    if (current()) checking.value = false
  }
}
function refreshResult() {
  reads = 0
  void refreshWallet()
  void readReceipt()
}
function stop() { active = false; clearTimeout(timer); controller?.abort() }
function close() { stop(); emit('close') }
watch(identity, stop, { flush: 'sync' })
onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal(); closing.value?.focus()
  if (props.draw) {
    void refreshWallet()
    if (pending.value || !props.draw.prizes.length) timer = setTimeout(readReceipt, 1500)
  }
})
onBeforeUnmount(() => {
  stop(); dialog.value?.close()
  if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="lottery-feedback compact-dialog" :aria-labelledby="`${id}-title`" @cancel.prevent="close">
      <header class="feedback-heading">
        <span class="feedback-icon" aria-hidden="true"><Gift v-if="draw && won" :size="28" /><Clock3 v-else-if="notice?.resetsAt" :size="28" /><Check v-else :size="28" /></span>
        <h2 :id="`${id}-title`" aria-live="polite">{{ title }}</h2>
        <button ref="closing" type="button" class="icon-button" :aria-label="draw?.source === 'checkin' ? '关闭签到提示' : '关闭抽奖提示'" @click="close"><X :size="20" aria-hidden="true" /></button>
      </header>
      <div class="feedback-body">
        <template v-if="draw">
          <div class="feedback-awards" aria-live="polite" aria-atomic="true">
            <div v-for="(award, index) in draw.prizes" :key="index" class="feedback-award">
              <p>{{ award.name }}</p>
              <strong>{{ award.status === 'empty' ? '本次未中奖' : rewardAmount(award) }}</strong>
              <span :class="{ 'award-pending': award.status === 'pending' }">{{ award.status === 'pending' ? '正在发放 · 尚未到账' : award.status === 'fulfilled' ? '已到账' : '下次继续加油' }}</span>
              <small v-if="award.rewardKind === 'charity'">{{ rewardExpiry(award) }}</small>
            </div>
            <p v-if="!draw.prizes.length">抽奖凭证已保存，请刷新结果或查看奖励记录。</p>
          </div>
          <p v-if="pending" class="feedback-note">奖励已记录，到账可能需要一点时间。无需再次{{ draw.source === 'checkin' ? '签到' : '抽奖' }}，可稍后在奖励记录中查看。</p>
          <p v-if="receiptError" role="status" class="feedback-note">{{ receiptError }}</p>
          <section class="feedback-wallet" :aria-labelledby="`${id}-balance`" aria-live="polite" :aria-busy="walletLoading || accountBalance.loading">
            <h3 :id="`${id}-balance`">当前可用积分</h3>
            <p v-if="walletLoading || accountBalance.loading" class="feedback-note">正在更新积分余额…</p>
            <template v-else-if="walletReady && accountBalance.points">
              <strong class="feedback-total">{{ balancePoints }} <small>积分</small></strong>
              <dl><div><dt>福利积分</dt><dd>{{ formatPoints(accountBalance.points.charityPoints) }}</dd></div><div><dt>账户积分</dt><dd>{{ formatPoints(accountBalance.points.permanentPoints) }}</dd></div></dl>
            </template>
            <template v-else>
              <p class="feedback-note">{{ accountBalance.error || '当前积分余额暂不可用，请刷新或到积分账户查看。' }}</p>
              <button type="button" class="text-link" @click="refreshWallet">重新读取余额</button>
            </template>
          </section>
          <button type="button" class="text-link feedback-refresh" :disabled="checking || walletLoading" @click="refreshResult">{{ checking ? '正在核对…' : '刷新到账状态' }}</button>
        </template>
        <template v-else-if="notice">
          <p class="feedback-message">{{ notice.message }}</p>
          <div v-if="resetLabel" class="feedback-reset"><span>下次开放时间</span><strong><time :datetime="notice.resetsAt">{{ resetLabel }}</time></strong><span>北京时间 · 每天 00:00 统一重置</span></div>
          <div v-if="notice.supportAmount" class="feedback-support"><span>当前累计支持 <strong>{{ notice.supportAmount }}</strong></span><strong v-if="notice.shortfall">还差 {{ notice.shortfall }}</strong></div>
          <p class="feedback-note">可用抽奖机会：<strong>{{ chances }} 次</strong>。未使用的机会会保留。</p>
          <p v-if="notice.action === 'support'" class="feedback-note">累计支持达标后长期开放抽奖福利，无需每天重复支持。参与时仍需有抽奖机会，并遵守每日次数和名额限制。</p>
          <button type="button" class="text-link feedback-refresh" :disabled="refreshing" @click="emit('refresh')">{{ refreshing ? '正在核验…' : '重新核验' }}</button>
        </template>
      </div>
      <footer class="feedback-footer">
        <button v-if="draw" type="button" class="button" @click="emit('records')">查看奖励记录</button>
        <RouterLink v-else-if="notice?.action === 'support' || notice?.action === 'account'" to="/account?tab=balance" class="button primary" @click="close">{{ notice.action === 'support' ? '去支持社区' : '前往积分账户' }}</RouterLink>
        <button v-else-if="notice?.action === 'tasks'" type="button" class="button primary" @click="emit('tasks')">获取抽奖机会</button>
        <button type="button" class="button" :class="{ primary: draw || !notice?.action || notice.action === 'refresh' }" @click="close">知道了</button>
      </footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.lottery-feedback { width: 480px; border-radius: 20px; overflow-y: auto; overscroll-behavior: contain; }
.feedback-heading { position: relative; display: grid; justify-items: center; gap: 12px; padding: 28px 52px 20px; text-align: center; }
.feedback-heading h2 { font-size: 22px; line-height: 1.4; text-wrap: balance; }
.feedback-heading > button { position: absolute; top: 12px; right: 12px; min-width: 44px; min-height: 44px; }
.feedback-icon { display: grid; place-items: center; width: 56px; height: 56px; color: var(--blue); background: var(--blue-soft); border-radius: 50%; }
.feedback-body { display: grid; gap: 16px; padding: 0 24px 24px; }
.feedback-body p { margin: 0; }
.feedback-message { line-height: 1.75; }
.feedback-awards { display: grid; gap: 12px; }
.feedback-award { display: grid; gap: 8px; text-align: center; padding: 16px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
.feedback-award > strong { font-size: 26px; line-height: 1.4; overflow-wrap: anywhere; color: var(--blue); }
.feedback-award > span { font-size: 13px; }
.feedback-note, .feedback-award small { color: var(--muted); font-size: 13px; line-height: 1.7; }
.feedback-wallet { display: grid; gap: 8px; border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.feedback-wallet h3 { font-size: 14px; font-weight: 500; }
.feedback-total { font-size: 28px; line-height: 1.35; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.feedback-total small { font-size: 13px; font-weight: 400; color: var(--muted); }
.feedback-wallet dl { display: grid; gap: 6px; margin: 4px 0 0; font-size: 13px; }
.feedback-wallet dl > div { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.feedback-wallet dt { color: var(--muted); }
.feedback-wallet dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.feedback-reset { display: grid; gap: 8px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; }
.feedback-reset span { font-size: 13px; color: var(--muted); }
.feedback-reset strong { font-size: 20px; line-height: 1.5; }
.feedback-support { display: flex; gap: 8px; justify-content: space-between; flex-wrap: wrap; padding-block: 12px; border-block: 1px solid var(--border); font-size: 14px; }
.feedback-refresh { min-height: 44px; justify-self: start; }
.feedback-footer { display: flex; flex-wrap: wrap; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--border); }
.feedback-footer > .button { flex: 1; min-height: 44px; white-space: nowrap; }
@media (max-width: 480px) {
  .feedback-heading { padding: 24px 48px 16px; }
  .feedback-heading h2 { font-size: 20px; }
  .feedback-body { padding: 0 16px 16px; }
  .feedback-footer { padding: 16px; }
  .feedback-award > strong { font-size: 23px; }
}
</style>
