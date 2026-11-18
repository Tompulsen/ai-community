<!-- Adapted from octopus_chat/app/components/account-wallet.tsx (MIT / NextChat). -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowUpRight, ChevronDown, Ticket } from '@lucide/vue'
import { session, errorMessage } from '../state'
import { accountBalance, refreshAccountBalance } from '../account-balance'
import { studioAccount } from '../studio-account'
import { cachedWalletQuote, defaultWalletAmount, invalidateWalletCache, loadWallet, loadWalletQuote, walletPricingKey } from '../wallet-prefetch'
import { safeWalletPaymentUrl, type WalletOverview, type WalletPayment, type WalletPlan, type WalletQuote, type WalletRedemption, type WalletSection } from '../../shared/studio/wallet'
import { formatCnyPoints } from '../../shared/studio/community-wallet'

const props = defineProps<{ walletEnabled?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const data = ref<WalletOverview>(), quote = ref<WalletQuote>(), payment = ref<WalletPayment>(), selectedPlan = ref<WalletPlan>()
const pointsEnabled = computed(() => props.walletEnabled || data.value?.quotaPerPoint !== undefined)
const paymentForm = ref<HTMLFormElement>()
const tab = ref<WalletSection>('topup')
const amount = ref(''), method = ref(''), code = ref('')
const loading = ref(false), busy = ref(false), quoting = ref(false), launched = ref(false), redemptionOpen = ref(false)
const error = ref(''), quoteError = ref(''), notice = ref('')
let revision = 0, loadRevision = 0, quoteRevision = 0, quotePricing = '', quoteTimer: ReturnType<typeof setTimeout> | undefined
const identity = () => `${session.user?.id || ''}:${session.user?.accountId || session.user?.id || ''}`
const accountId = () => Number(session.user?.accountId || session.user?.id)
const numericAmount = computed(() => Number(amount.value))
const validAmount = computed(() => !!data.value && Number.isSafeInteger(numericAmount.value) &&
  numericAmount.value >= data.value.topup.minAmount &&
  (data.value.quotaDisplayType !== 'TOKENS' || numericAmount.value % data.value.quotaPerUnit === 0))
const paymentOrder = computed(() => data.value?.history.find(order => order.tradeNo === payment.value?.tradeNo))
const canPay = computed(() => !!data.value?.topup.enabled && !!method.value && !busy.value && !loading.value &&
  (tab.value !== 'topup' || (!quoting.value && !quoteError.value)))
const canOpenPayment = computed(() => !!payment.value && !busy.value && !loading.value && !error.value && !launched.value &&
  (!paymentOrder.value || paymentOrder.value.status === 'pending') &&
  payment.value.userId === accountId() && !!safeWalletPaymentUrl(payment.value.action))
const tabs = [{ id: 'topup', label: '余额充值' }, { id: 'plans', label: '套餐与订阅' }, { id: 'history', label: '充值记录' }] as const
const statusLabel = (value: string) => ({ success: '已到账', pending: '待支付', expired: '已过期', failed: '失败', active: '生效中', cancelled: '已取消', canceled: '已取消' }[value] || value)

async function request<T extends { userId: number }>(path: string, body?: object): Promise<T> {
  const current = revision, owner = identity(), userId = accountId()
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('请先登录章鱼账号。')
  const result = await studioAccount<T>(path, body ? 'POST' : 'GET', body)
  if (current !== revision || owner !== identity() || result?.userId !== userId) throw new Error('账号已变化，请重新读取充值信息。')
  return result
}
function mergeSection(result: WalletOverview, section: WalletSection) {
  const previous = data.value
  data.value = {
    ...result,
    plans: section === 'plans' ? result.plans : previous?.plans || [],
    subscriptions: section === 'plans' ? result.subscriptions : previous?.subscriptions || [],
    history: section === 'history' ? result.history : previous?.history || [],
    historyTotal: section === 'history' ? result.historyTotal : previous?.historyTotal || 0,
  }
}
async function load(force = false) {
  const current = revision, read = ++loadRevision, section = tab.value
  loading.value = true; error.value = ''
  try {
    const [result, history] = await Promise.all([
      loadWallet(section, force),
      payment.value && section !== 'history' ? loadWallet('history', force) : undefined,
    ])
    if (current !== revision || read !== loadRevision) return
    mergeSection(result, section)
    if (history) mergeSection(history, 'history')
    if (!amount.value) amount.value = String(defaultWalletAmount(result))
    if (!result.topup.paymentMethods.some(item => item.type === method.value)) method.value = result.topup.paymentMethods[0]?.type || ''
    if (force) updateQuote()
  } catch (cause) { if (current === revision && read === loadRevision) error.value = errorMessage(cause) }
  finally { if (current === revision && read === loadRevision) loading.value = false }
}
watch(identity, () => {
  revision++; loadRevision++; quoteRevision++; clearTimeout(quoteTimer)
  data.value = undefined; quote.value = undefined; payment.value = undefined; selectedPlan.value = undefined
  amount.value = ''; method.value = ''; code.value = ''; error.value = ''; quoteError.value = ''; notice.value = ''
  busy.value = false; loading.value = false; quoting.value = false; quotePricing = ''; launched.value = false; redemptionOpen.value = false
  if (session.user) void load()
}, { immediate: true, flush: 'sync' })
watch(tab, () => { if (session.user) void load() }, { flush: 'sync' })
function updateQuote() {
  const current = ++quoteRevision
  clearTimeout(quoteTimer); quoting.value = false; quoteError.value = ''
  if (tab.value !== 'topup') return
  if (!validAmount.value || !data.value?.topup.enabled) { quote.value = undefined; return }
  const owner = revision, value = numericAmount.value, config = data.value, pricing = walletPricingKey(config)
  if (quote.value?.amount !== value || quotePricing !== pricing) quote.value = undefined
  const cached = cachedWalletQuote(value, config)
  if (cached) { quote.value = cached; quotePricing = pricing; return }
  quoting.value = true
  const read = async () => {
    try {
      const result = await loadWalletQuote(value, config)
      if (current === quoteRevision && owner === revision) { quote.value = result; quotePricing = pricing }
    } catch (cause) { if (current === quoteRevision && owner === revision) quoteError.value = errorMessage(cause) }
    finally { if (current === quoteRevision && owner === revision) quoting.value = false }
  }
  if (config.topup.amountOptions.includes(value) || value === defaultWalletAmount(config)) void read()
  else quoteTimer = setTimeout(read, 250)
}
watch([numericAmount, () => data.value ? walletPricingKey(data.value) : '', tab], updateQuote)
function invalidateQuotes() {
  invalidateWalletCache(); quoteRevision++; clearTimeout(quoteTimer); quoting.value = false
}
async function refresh() {
  if (busy.value || loading.value) return
  const current = revision
  busy.value = true; notice.value = ''
  try {
    invalidateQuotes()
    await load(true)
    if (current !== revision) return
    await refreshAccountBalance()
    if (current !== revision) return
    emit('refresh')
    launched.value = false
    if (!error.value) notice.value = accountBalance.amount === null && !accountBalance.points
      ? '订单状态已刷新，余额读取失败，请稍后刷新余额。'
      : paymentOrder.value?.status === 'success' ? '订单已到账，请以账户实时余额为准。' : '已刷新余额和订单状态。'
  } finally { if (current === revision) busy.value = false }
}
async function pay(plan?: WalletPlan) {
  if (!canPay.value || (!plan && (!validAmount.value || quote.value?.amount !== numericAmount.value))) return
  const current = revision, expectedMoney = plan ? plan.currency === 'CNY' ? plan.priceAmount : undefined : quote.value?.money
  let automatic = false
  busy.value = true; error.value = ''; notice.value = ''; launched.value = false
  try {
    const result = await request<WalletPayment>(plan ? 'wallet/subscription' : 'wallet/pay', plan
      ? { planId: plan.id, paymentMethod: method.value, expectedPrice: { amount: plan.priceAmount, currency: plan.currency } }
      : { amount: numericAmount.value, paymentMethod: method.value })
    if (current !== revision) return
    if (!safeWalletPaymentUrl(result.action)) throw new Error('支付地址无效，请刷新订单确认。')
    payment.value = result; selectedPlan.value = undefined
    const requiresConfirmation = expectedMoney === undefined || Number(result.money) !== Number(expectedMoney)
    automatic = !requiresConfirmation
    notice.value = requiresConfirmation
      ? expectedMoney === undefined ? `订单实付金额为 ¥ ${result.money}，请确认后打开支付页。` : `实付金额已变化为 ¥ ${result.money}，请确认后打开支付页。`
      : '订单已创建，正在前往支付页。'
  } catch (cause) {
    if (current === revision) error.value = `${errorMessage(cause)} 如订单结果未确认，请刷新页面核对充值记录。`
  } finally { if (current === revision) busy.value = false }
  if (automatic) {
    await nextTick()
    if (current === revision) submitPayment()
  }
}
function submitPayment() {
  if (!canOpenPayment.value || !paymentForm.value) return
  launched.value = true
  try { HTMLFormElement.prototype.submit.call(paymentForm.value) }
  catch {
    launched.value = false
    notice.value = '无法打开支付页，请点击继续支付重试。'
  }
}
async function redeem() {
  if (busy.value || loading.value || !data.value?.topup.redemptionEnabled || !code.value.trim()) return
  const current = revision
  busy.value = true; error.value = ''; notice.value = ''
  try {
    await request<WalletRedemption>('wallet/redeem', { key: code.value.trim() })
    if (current !== revision) return
    code.value = ''
    invalidateQuotes()
    await Promise.all([refreshAccountBalance(), load(true)])
    if (current !== revision) return
    emit('refresh')
    notice.value = accountBalance.amount === null && !accountBalance.points ? '兑换成功，但余额读取失败，请刷新余额，勿重复兑换。' : '兑换成功，请以刷新后的账户余额为准。'
  } catch (cause) {
    if (current === revision) error.value = `${errorMessage(cause)} 若结果未确认，请先刷新余额，勿重复提交。`
  } finally { if (current === revision) busy.value = false }
}
function quota(value: number) {
  const wallet = data.value
  if (!wallet) return '—'
  if (pointsEnabled.value) return wallet.quotaPerPoint && wallet.quotaPerPoint > 0
    ? `${(value / wallet.quotaPerPoint).toLocaleString('zh-CN', { maximumFractionDigits: 6 })} 积分` : '—'
  const total = wallet.quotaDisplayType === 'TOKENS' ? value : value / wallet.quotaPerUnit * wallet.creditExchangeRate
  return `${total.toLocaleString('zh-CN', { maximumFractionDigits: 4 })} ${wallet.currencySymbol}`
}
function orderTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '时间未知'
  const legacy = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(value))
  const calendar = legacy ? `${legacy[1]}-${legacy[2]}-${legacy[3]}T${legacy[4]}:${legacy[5]}:${legacy[6]}` : undefined
  const date = new Date(calendar ? `${calendar}Z` : value * 1000)
  if (!Number.isFinite(date.getTime()) || (calendar && date.toISOString().slice(0, 19) !== calendar)) return '时间未知'
  return date.toLocaleString('zh-CN', { timeZone: calendar ? 'UTC' : undefined, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function duration(plan: WalletPlan) {
  return plan.durationUnit === 'custom' ? `${plan.customSeconds / 3600} 小时`
    : `${plan.durationValue} ${{ year: '年', month: '个月', day: '天', hour: '小时' }[plan.durationUnit] || plan.durationUnit}`
}
function limitReached(plan: WalletPlan) {
  return plan.maxPurchases > 0 && (data.value?.subscriptions.filter(item => item.planId === plan.id).length || 0) >= plan.maxPurchases
}
function refreshVisible() { if (payment.value && document.visibilityState === 'visible') void refresh() }
onMounted(() => { window.addEventListener('focus', refreshVisible); document.addEventListener('visibilitychange', refreshVisible) })
onBeforeUnmount(() => {
  revision++; loadRevision++; quoteRevision++; clearTimeout(quoteTimer)
  payment.value = undefined
  window.removeEventListener('focus', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible)
})
</script>

<template>
  <section class="account-wallet panel-section" aria-labelledby="wallet-heading">
    <div class="section-heading"><h2 id="wallet-heading">充值与套餐</h2></div>
    <p v-if="error" class="notice-inline" role="alert">{{ error }} <button class="text-link" :disabled="loading" @click="load()">重新读取</button></p>
    <p v-if="notice" class="wallet-notice" role="status">{{ notice }}</p>
    <p v-if="loading" class="muted" role="status">正在读取充值信息…</p>
    <template v-if="data">
      <div v-if="payment" class="wallet-checkout">
        <button class="text-link" :disabled="busy" @click="payment = undefined; launched = false; notice = ''"><ArrowLeft :size="16" />返回充值</button>
        <dl class="info-list"><div><dt>实付金额</dt><dd class="wallet-money">¥ {{ payment.money }}</dd></div><div v-if="pointsEnabled && payment.kind === 'topup'"><dt>预计到账</dt><dd>{{ formatCnyPoints(payment.money) }} 永久积分</dd></div><div><dt>订单号</dt><dd>{{ payment.tradeNo }}</dd></div><div><dt>状态</dt><dd>{{ paymentOrder ? statusLabel(paymentOrder.status) : '待支付' }}</dd></div></dl>
        <div class="wallet-actions">
          <form ref="paymentForm" :action="payment.action" method="POST" target="_self" @submit.prevent="submitPayment">
            <input v-for="(value, name) in payment.fields" :key="name" type="hidden" :name="name" :value="value" />
            <button class="button primary btn" type="submit" :disabled="!canOpenPayment">{{ launched ? '正在跳转…' : '继续支付' }}<ArrowUpRight :size="16" /></button>
          </form>
          <button class="button subtle btn" :disabled="busy || loading" @click="refresh">我已支付，刷新余额</button>
        </div>
      </div>
      <template v-else>
        <div class="wallet-tabs" role="group" aria-label="钱包内容">
          <button v-for="item in tabs" :key="item.id" :aria-pressed="tab === item.id" :disabled="busy" @click="tab = item.id; selectedPlan = undefined">{{ item.label }}</button>
        </div>
        <div v-if="tab === 'topup'" class="wallet-section">
          <form v-if="data.topup.enabled" class="wallet-topup-form" @submit.prevent="pay()">
            <div class="wallet-topup-fields">
            <label class="field"><span>{{ pointsEnabled ? '充值档位' : '充值金额' }}</span><input v-model="amount" class="control" type="number" :min="data.topup.minAmount" step="1" inputmode="numeric" :disabled="busy" /></label>
            <div v-if="data.topup.amountOptions.length" class="wallet-amounts" role="group" aria-label="快捷充值金额"><button v-for="value in data.topup.amountOptions" :key="value" type="button" :aria-pressed="numericAmount === value" :disabled="busy" @click="amount = String(value)"><span>{{ value }}</span><small v-if="data.topup.discounts?.[value]">{{ Math.round((1 - data.topup.discounts[value]!) * 100) }}% 优惠</small></button></div>
            <p v-if="!validAmount" class="form-note">请输入不小于 {{ data.topup.minAmount }} 的整数金额。<template v-if="data.quotaDisplayType === 'TOKENS'">数量须为 {{ data.quotaPerUnit }} tokens 的整数倍。</template></p>
            <fieldset class="wallet-methods"><legend>支付方式</legend><label v-for="item in data.topup.paymentMethods" :key="item.type"><input v-model="method" type="radio" name="wallet-topup-method" :value="item.type" :disabled="busy" />{{ item.name }}</label></fieldset>
            </div>
            <div class="wallet-quote"><div><span class="muted">实付金额</span><strong>¥ {{ quote?.amount === numericAmount ? quote.money : quoteError ? '暂不可用' : validAmount ? '计算中…' : '—' }}</strong><template v-if="pointsEnabled"><small v-if="quote?.amount === numericAmount" aria-label="预计到账积分">预计到账 {{ formatCnyPoints(quote.money) }} 永久积分</small></template><small v-else-if="validAmount">预计到账 {{ quota(data.quotaDisplayType === 'TOKENS' ? numericAmount : numericAmount * data.quotaPerUnit) }}</small></div><button class="button primary btn" type="submit" :disabled="!canPay || !validAmount || quote?.amount !== numericAmount">确认金额，去支付<ArrowUpRight :size="16" /></button><p v-if="quoteError" class="form-error" role="alert">{{ quoteError }} <button type="button" class="text-link" :disabled="busy || loading" @click="updateQuote">重新报价</button></p></div>
          </form>
          <p v-else class="muted">当前暂无可用的在线充值方式。</p>
          <div v-if="data.topup.redemptionEnabled" class="wallet-redemption">
            <button class="text-link wallet-redemption-toggle" :aria-expanded="redemptionOpen" aria-controls="wallet-redemption-form" @click="redemptionOpen = !redemptionOpen"><Ticket :size="17" aria-hidden="true" />使用兑换码<ChevronDown :size="15" aria-hidden="true" /></button>
            <form v-if="redemptionOpen" id="wallet-redemption-form" class="wallet-redeem" @submit.prevent="redeem"><label class="field"><span class="wallet-redeem-label">兑换码</span><input v-model="code" class="control" placeholder="请输入兑换码" autocomplete="off" maxlength="256" :disabled="busy" /></label><button class="button subtle btn" type="submit" :disabled="busy || !code.trim()">兑换</button><a v-if="safeWalletPaymentUrl(data.topup.redemptionUrl)" :href="data.topup.redemptionUrl" class="text-link" target="_blank" rel="noopener noreferrer">获取兑换码<ArrowUpRight :size="15" /></a></form>
          </div>
        </div>
        <div v-else-if="loading || error" class="wallet-section" />
        <div v-else-if="tab === 'plans'" class="wallet-section">
          <div v-if="data.topup.paymentMethods.length" class="wallet-methods" role="group" aria-label="套餐支付方式"><label v-for="item in data.topup.paymentMethods" :key="item.type"><input v-model="method" type="radio" name="wallet-plan-method" :value="item.type" :disabled="busy" />{{ item.name }}</label></div>
          <div v-if="data.plans.length" class="wallet-plans">
            <article v-for="plan in data.plans" :key="plan.id" class="wallet-plan">
              <div><h3>{{ plan.title }}</h3><p class="muted">{{ plan.subtitle }}</p></div>
              <p class="wallet-plan-price">{{ plan.priceAmount.toFixed(2) }} {{ plan.currency }} <span class="muted">/ {{ duration(plan) }}</span></p>
              <p>额度 {{ plan.totalAmount > 0 ? quota(plan.totalAmount) : '不限量' }}</p>
              <p v-if="plan.resetPeriod && plan.resetPeriod !== 'never'" class="muted">额度重置：{{ ({ daily: '每日', weekly: '每周', monthly: '每月', custom: `每 ${plan.resetSeconds} 秒` } as Record<string, string>)[plan.resetPeriod] || plan.resetPeriod }}</p>
              <p v-if="plan.maxPurchases > 0" class="muted">每账号限购 {{ plan.maxPurchases }} 次</p>
              <button class="button subtle btn" :disabled="!canPay || limitReached(plan)" @click="selectedPlan = plan">{{ limitReached(plan) ? '已达购买上限' : '选择套餐' }}</button>
              <div v-if="selectedPlan?.id === plan.id" class="wallet-plan-confirm"><p>确认购买 {{ plan.title }}，{{ plan.priceAmount.toFixed(2) }} {{ plan.currency }}？</p><div class="wallet-actions"><button class="button primary btn" :disabled="!canPay" @click="pay(plan)">确认并创建订单</button><button class="text-link" :disabled="busy" @click="selectedPlan = undefined">返回</button></div></div>
            </article>
          </div>
          <p v-else class="muted">暂无可购买的套餐。</p>
          <h3 class="wallet-subheading">已有订阅</h3>
          <div v-for="item in data.subscriptions" :key="item.id" class="wallet-subscription"><strong>{{ data.plans.find(plan => plan.id === item.planId)?.title || `套餐 ${item.planId}` }}</strong><span>{{ statusLabel(item.status === 'active' && item.endTime * 1000 <= Date.now() ? 'expired' : item.status) }}</span><span>已用 {{ quota(item.amountUsed) }} / {{ item.amountTotal > 0 ? quota(item.amountTotal) : '不限量' }}</span><span>到期 {{ orderTime(item.endTime) }}</span><span v-if="item.nextResetTime > 0">下次重置 {{ orderTime(item.nextResetTime) }}</span></div>
          <p v-if="!data.subscriptions.length" class="muted">暂无订阅。</p>
        </div>
        <div v-else class="wallet-section"><p class="muted wallet-history-total">最近 {{ data.history.length }} 笔，共 {{ data.historyTotal }} 笔</p><p v-if="pointsEnabled" class="form-note">历史订单按实付金额折合积分，仅供对照；永久积分以实时钱包为准。</p><div v-if="data.history.length" class="table-scroll"><table><thead><tr><th>时间</th><th>订单号</th><th>{{ pointsEnabled ? '实付折合积分' : '充值金额' }}</th><th>实付人民币</th><th>状态</th></tr></thead><tbody><tr v-for="order in data.history" :key="order.id"><td>{{ orderTime(order.createdAt) }}</td><td>{{ order.tradeNo }}</td><td>{{ pointsEnabled ? order.status === 'success' ? `${formatCnyPoints(order.money)} 积分` : '—' : quota(order.amount * data.quotaPerUnit) }}</td><td>¥ {{ order.money.toFixed(2) }}</td><td>{{ statusLabel(order.status) }}</td></tr></tbody></table></div><p v-else class="muted">暂无充值记录。</p></div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.account-wallet { --wallet-summary-width: 224px; --wallet-column-gap: 24px; min-width: 0; padding-bottom: 0; border-bottom: 0; }
.account-wallet > .section-heading { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.wallet-tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.wallet-tabs button { min-height: 44px; padding: 8px 12px; color: var(--muted); border-radius: 6px; }
.wallet-tabs button[aria-pressed="true"] { color: var(--ink); background: var(--surface-soft); }
.wallet-section { padding-top: 16px; min-width: 0; }
.wallet-topup-form { display: grid; grid-template-columns: minmax(0, 1fr) var(--wallet-summary-width); align-items: start; gap: var(--wallet-column-gap); }
.wallet-topup-fields { display: grid; gap: 12px; min-width: 0; }.wallet-topup-fields > .field { font-size: 13px; }.wallet-topup-fields .control { min-width: 0; width: 100%; min-height: 44px; }
.wallet-topup-fields > .form-note { margin: 0; }
.wallet-amounts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.wallet-amounts button { display: grid; grid-template-rows: 20px 16px; align-content: center; justify-items: center; gap: 0; min-width: 0; min-height: 56px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; font-variant-numeric: tabular-nums; }
.wallet-amounts button > span { font-size: 15px; line-height: 24px; }
.wallet-amounts button[aria-pressed="true"] { border-color: var(--focus-ring); background: var(--surface-soft); }
.wallet-amounts small { font-size: 11px; line-height: 16px; white-space: nowrap; color: var(--muted); }
.wallet-methods { display: flex; flex-wrap: wrap; gap: 8px; border: 0; padding: 0; margin: 0; }
.wallet-methods legend { padding: 0; margin-bottom: 8px; font-size: 13px; font-weight: 500; }
.wallet-methods label { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; cursor: pointer; }
.wallet-methods label:has(:checked) { border-color: var(--focus-ring); background: var(--surface-soft); }
.wallet-methods input { margin: 0; accent-color: var(--ink); }
.wallet-quote { position: sticky; top: 24px; display: grid; gap: 16px; min-width: 0; padding: 0 0 0 24px; border-left: 1px solid var(--border); }
.wallet-quote > div { display: grid; gap: 6px; }
.wallet-quote strong, .wallet-money { font-size: 28px; line-height: 36px; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.wallet-quote > div > span, .wallet-quote small { font-size: 12px; line-height: 20px; }.wallet-quote small { color: var(--muted); overflow-wrap: anywhere; }.wallet-quote > .button { width: 100%; min-height: 44px; padding-inline: 10px; font-size: 13px; }
.wallet-redemption { max-width: calc(100% - var(--wallet-summary-width) - var(--wallet-column-gap)); margin-top: 24px; border-top: 1px solid var(--border); padding-top: 8px; }
.wallet-redemption-toggle { min-height: 44px; gap: 8px; color: var(--muted); font-size: 13px; }
.wallet-redemption-toggle:hover, .wallet-redemption-toggle[aria-expanded="true"] { color: var(--ink); }
.wallet-redemption-toggle[aria-expanded="true"] > svg:last-child { transform: rotate(180deg); }
.wallet-redeem { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 8px 12px; margin-top: 8px; }
.wallet-redeem-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.wallet-redeem .control { width: 100%; min-width: 0; height: 44px; min-height: 44px; font-size: 13px; }
.wallet-redeem > .button { min-width: 80px; height: 44px; min-height: 44px; align-self: end; margin: 0; font-size: 13px; }
.wallet-redeem > a { grid-column: 1 / -1; justify-self: start; min-height: 44px; font-size: 13px; }
.wallet-plans { margin-top: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.wallet-plan { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 20px; border: 1px solid var(--border); border-radius: 8px; }
.wallet-plan p { overflow-wrap: anywhere; }
.wallet-plan > .button { margin-top: auto; }
.wallet-plan-price { font-weight: 500; font-variant-numeric: tabular-nums; }
.wallet-plan-price > span { font-weight: 400; }
.wallet-plan-confirm { display: grid; gap: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
.wallet-subheading { margin: 32px 0 16px; }
.wallet-subscription { display: flex; flex-wrap: wrap; gap: 8px 24px; padding-block: 16px; border-bottom: 1px solid var(--border); }
.wallet-subscription > strong { flex-basis: 100%; }
.wallet-subscription > span { font-size: 12px; color: var(--muted); }
.wallet-checkout { display: grid; gap: 24px; }
.wallet-checkout dd { overflow-wrap: anywhere; }
.wallet-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.wallet-notice { margin-bottom: 16px; color: var(--ink); }
.wallet-history-total { margin-bottom: 12px; }
.account-wallet th, .account-wallet td { white-space: nowrap; }
@media (max-width: 999px) {
  .wallet-plans, .wallet-topup-form { grid-template-columns: minmax(0, 1fr); }
  .account-wallet:has(.wallet-topup-form) { padding-bottom: 240px; }
  :global(html:has(.wallet-topup-form)) { scroll-padding-bottom: calc(var(--mobile-nav-height) + 256px); }
  .wallet-section { padding-top: 8px; }
  .wallet-topup-form { gap: 0; }
  .wallet-topup-fields { gap: 8px; }
  .wallet-topup-fields > .field { gap: 4px; }
  .wallet-amounts button { min-height: 48px; padding: 4px; }
  .wallet-quote { position: fixed; z-index: 18; inset: auto 0 var(--mobile-nav-height); grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 12px; max-height: min(44dvh, 240px); overflow: auto; overscroll-behavior: contain; padding: 8px max(12px, env(safe-area-inset-right)) 8px max(12px, env(safe-area-inset-left)); border-left: 0; border-top: 1px solid var(--border); background: var(--surface); }
  .wallet-quote > div { gap: 0; }
  .wallet-quote strong { font-size: 24px; line-height: 28px; }
  .wallet-quote > .button { width: auto; min-height: 48px; }
  .wallet-quote > .form-error { grid-column: 1 / -1; }
  .wallet-redemption { max-width: none; }
  .wallet-tabs { gap: 0; }.wallet-tabs button { padding-inline: 10px; font-size: 12px; }.wallet-methods { gap: 8px; }
}
</style>
