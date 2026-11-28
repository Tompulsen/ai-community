<script setup lang="ts">
import { combineAbortSignals } from '../abort-signals'
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { ChevronDown, Coins, Wallet } from '@lucide/vue'
import { formatPoints, parseCommunityWalletLots, type CommunityWallet, type CommunityWalletLots } from '../../shared/studio/community-wallet'
import { displayWalletQuota, type WalletOverview } from '../../shared/studio/wallet'
import { loadWallet } from '../wallet-prefetch'
import { api, errorMessage, session } from '../state'

const props = defineProps<{ wallet: CommunityWallet }>()
const emit = defineEmits<{ refresh: [] }>()
const detailsId = useId()
const expanded = ref(false), loading = ref(false), loaded = ref(false), error = ref('')
const details = ref<CommunityWalletLots>({ items: [], nextCursor: null, sharedPoints: '0' })
const currentTime = ref(Date.now())
const balanceDisplay = ref<WalletOverview>(), balanceLoading = ref(false), balanceError = ref(false)
const currentBalance = computed(() => balanceDisplay.value ? displayWalletQuota(props.wallet.totalApiQuota, balanceDisplay.value) : null)
const identity = () => `${session.user?.id || ''}:${session.user?.accountId || session.user?.id || ''}`
let revision = 0, active = true, lastRefresh = 0, controller: AbortController | undefined
let balanceRevision = 0
let timer: ReturnType<typeof setInterval> | undefined
async function loadBalanceDisplay(force = false) {
  const owner = identity(), current = ++balanceRevision
  balanceLoading.value = true; balanceError.value = false
  try {
    const display = await loadWallet('topup', force)
    if (!active || current !== balanceRevision || owner !== identity()) return
    if (displayWalletQuota(props.wallet.totalApiQuota, display) === null) throw new Error('余额展示暂不可用')
    balanceDisplay.value = display
  } catch {
    if (active && current === balanceRevision && owner === identity()) { balanceDisplay.value = undefined; balanceError.value = true }
  } finally {
    if (active && current === balanceRevision && owner === identity()) balanceLoading.value = false
  }
}
const expirySeconds = computed(() => props.wallet.charityExpiringAt === null ? null : Math.max(0, Math.ceil((props.wallet.charityExpiringAt * 1000 - currentTime.value) / 1000)))
function countdown(expiresAt: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt * 1000 - currentTime.value) / 1000))
  const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds % 3600 / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
  return `${seconds >= 86400 ? `${Math.floor(seconds / 86400)}天 ` : ''}${clock}`
}
function resetDetails() {
  revision++; controller?.abort(); controller = undefined
  details.value = { items: [], nextCursor: null, sharedPoints: '0' }
  loading.value = false; loaded.value = false; error.value = ''
}
async function loadDetails(append = false) {
  if (!active || loading.value) return
  const cursor = append ? details.value.nextCursor : null
  const account = session.user?.accountId || session.user?.id
  if (!account || append && !cursor) return
  const owner = identity(), current = revision
  loading.value = true; error.value = ''
  controller = new AbortController()
  try {
    const combined = combineAbortSignals([controller.signal, AbortSignal.timeout(15000)])
    const result = await api<{ success: boolean; data: { userId: number } & CommunityWalletLots }>(
      `/api/new-api/wallet/point-lots${cursor ? `?cursor=${cursor}` : ''}`,
      { expectedAccount: account, signal: combined.signal }).finally(combined.dispose)
    if (!active || current !== revision || owner !== identity()) return
    if (result.success !== true || String(result.data?.userId) !== account) throw new Error('账号已变化，请刷新福利明细。')
    const page = parseCommunityWalletLots(result.data)
    details.value = { ...page, items: append ? [...details.value.items.filter(item => !page.items.some(next => next.id === item.id)), ...page.items] : page.items }
    loaded.value = true
  } catch (cause) {
    if (active && current === revision && owner === identity()) error.value = errorMessage(cause)
  } finally {
    if (active && current === revision) { loading.value = false; controller = undefined }
  }
}
function toggleDetails() {
  expanded.value = !expanded.value
  if (expanded.value && !loaded.value) void loadDetails()
}
function sourceName(source: string) {
  return source === 'community_lottery' ? '活动抽奖' : source === 'qxchat_legacy' ? '历史福利' : '福利发放'
}
function updateTime() {
  if (!active || document.visibilityState === 'hidden') return
  currentTime.value = Date.now()
  if (expirySeconds.value === 0 && currentTime.value - lastRefresh >= 15000) {
    lastRefresh = currentTime.value
    emit('refresh')
  }
}
watch(identity, () => { resetDetails(); expanded.value = false }, { flush: 'sync' })
watch(identity, () => { balanceDisplay.value = undefined; void loadBalanceDisplay() }, { immediate: true, flush: 'sync' })
watch(() => props.wallet, () => {
  resetDetails(); currentTime.value = Date.now()
  if (expanded.value) void loadDetails()
  void loadBalanceDisplay()
})
onMounted(() => {
  timer = setInterval(updateTime, 1000)
  window.addEventListener('focus', updateTime)
  document.addEventListener('visibilitychange', updateTime)
})
onBeforeUnmount(() => {
  active = false; balanceRevision++; resetDetails(); clearInterval(timer)
  window.removeEventListener('focus', updateTime)
  document.removeEventListener('visibilitychange', updateTime)
})
</script>

<template>
  <section class="community-wallet-summary" aria-label="社区积分">
    <dl class="point-balances">
      <div class="points-stat"><dt><Coins :size="16" aria-hidden="true" /><button v-if="wallet.charityDetailsAvailable" type="button" class="welfare-toggle" :aria-expanded="expanded" :aria-controls="detailsId" @click="toggleDetails">积分<ChevronDown :size="14" aria-hidden="true" /></button><template v-else>积分</template></dt><dd class="point-amount">{{ formatPoints(wallet.charityPoints) }}<span>积分</span></dd><dd class="balance-caption">抽奖、签到等福利积分</dd></div>
      <div class="balance-stat" :aria-busy="balanceLoading"><dt><Wallet :size="16" aria-hidden="true" />当前余额</dt><dd class="point-amount">{{ currentBalance ?? (balanceLoading ? '正在读取…' : '—') }}</dd><dd v-if="balanceError" class="balance-caption"><button type="button" class="text-link" :disabled="balanceLoading" @click="loadBalanceDisplay(true)">余额读取失败，重试</button></dd><dd v-else class="balance-caption balance-source">与账户中心一致</dd></div>
    </dl>
    <p v-if="wallet.charityExpiringAt !== null" class="welfare-expiry">
      <template v-if="expirySeconds"><template v-if="wallet.charityExpiringPoints">其中 {{ formatPoints(wallet.charityExpiringPoints) }} 积分</template><template v-else>有福利积分</template>将在 <time role="timer" aria-live="off" :datetime="`PT${expirySeconds}S`">{{ countdown(wallet.charityExpiringAt) }}</time> 后过期</template>
      <template v-else>部分福利积分已到期，正在刷新余额。</template>
    </p>
    <div v-show="expanded" :id="detailsId" class="welfare-details" aria-label="福利积分明细">
      <p class="welfare-details-title">福利积分明细</p>
      <p v-if="error" class="form-error" role="alert">{{ error }} <button type="button" class="text-link" :disabled="loading" @click="loadDetails()">重新读取</button></p>
      <p v-if="loading && !loaded" class="muted" role="status">正在读取福利明细…</p>
      <ul v-if="details.items.length" class="welfare-lots">
        <li v-for="lot in details.items" :key="lot.id"><span>{{ sourceName(lot.source) }}</span><strong>{{ formatPoints(lot.points) }} 积分</strong><time v-if="lot.expiresAt !== null" class="welfare-validity" :datetime="new Date(lot.expiresAt * 1000).toISOString()">{{ lot.expiresAt * 1000 <= currentTime ? '已到期' : `剩余 ${countdown(lot.expiresAt)}` }}</time></li>
      </ul>
      <p v-if="loaded && details.sharedPoints !== '0'" class="welfare-shared">历史福利 {{ formatPoints(details.sharedPoints) }} 积分，具体有效期以原记录为准。</p>
      <p v-if="loaded && !details.items.length && details.sharedPoints === '0'" class="muted">暂无可用的福利积分。</p>
      <button v-if="details.nextCursor" type="button" class="text-link" :disabled="loading" @click="loadDetails(true)">{{ loading ? '正在读取…' : '加载更多' }}</button>
    </div>
  </section>
</template>

<style scoped>
.community-wallet-summary { min-width: 0; width: 100%; }
.point-balances { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; max-width: 680px; margin: 0; padding-block: 8px; }
.point-balances > div { display: grid; align-content: start; gap: 8px; min-width: 0; }
.point-balances > div + div { border-left: 1px solid var(--border); padding-left: 24px; }
.point-balances dt { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; line-height: 24px; }
.point-balances dt > svg { flex: none; }
.point-balances .point-amount { min-width: 0; margin: 0; color: var(--ink); font-size: clamp(20px, 2.4vw, 28px); line-height: 1.3; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.point-amount > span { margin-left: 6px; font-size: 12px; font-weight: 400; white-space: nowrap; color: var(--muted); }
.point-balances .balance-caption { margin: 0; color: var(--muted); font-size: 12px; line-height: 20px; }
.balance-caption .text-link { min-height: 44px; text-align: left; }
.welfare-toggle { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; margin-block: -10px; padding: 0; color: inherit; font: inherit; }
.welfare-toggle:hover, .welfare-toggle[aria-expanded="true"] { color: var(--ink); }
.welfare-toggle:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.welfare-toggle[aria-expanded="true"] > svg { transform: rotate(180deg); }
.welfare-expiry { margin: 8px 0 0; color: var(--muted); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
.welfare-expiry time { font-variant-numeric: tabular-nums; }
.welfare-details { margin-top: 12px; font-size: 12px; line-height: 20px; }
.welfare-details-title { margin: 0 0 4px; font-weight: 500; color: var(--ink); }
.welfare-lots { list-style: none; margin: 0; padding: 0; }
.welfare-lots li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 12px; padding-block: 8px; border-bottom: 1px solid var(--border); }
.welfare-lots li > * { min-width: 0; overflow-wrap: anywhere; }
.welfare-lots strong { font-weight: 500; font-variant-numeric: tabular-nums; }
.welfare-validity { grid-column: 1 / -1; color: var(--muted); font-variant-numeric: tabular-nums; }
.welfare-shared { margin-top: 8px; color: var(--muted); }
.welfare-details > .text-link { min-height: 44px; }
@media (max-width: 639px) {
  .point-balances { gap: 12px; }
  .point-balances > div + div { padding-left: 12px; }
}
@media (max-width: 359px) {
  .point-balances { grid-template-columns: minmax(0, 1fr); gap: 8px; padding-block: 4px; }
  .point-balances > div { grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 0 8px; }
  .point-balances > div + div { border-left: 0; border-top: 1px solid var(--border); padding: 8px 0 0; }
  .point-balances .point-amount { font-size: 18px; text-align: right; }
  .point-balances .balance-caption { grid-column: 1 / -1; }
  .point-balances .balance-source { display: none; }
}
</style>
