<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Copy, RefreshCw } from '@lucide/vue'
import type { ReferralStatus } from '../../shared/referral'
import { api, errorMessage, notify, session } from '../state'

const emit = defineEmits<{ status: [value: ReferralStatus | null] }>()
const status = ref<ReferralStatus | null>(null), busy = ref(false), error = ref('')
let request = 0, controller: AbortController | undefined
const points = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 20 })
const topupCondition = (value: number) => value > 0 ? `实付满 ¥${value.toFixed(2)}` : '实际支付大于 0'
const labels = { waiting_topup: '待单笔充值达标', pending: '待发放 · 自动重试', credited: '双方已到账' }
const own = computed(() => status.value?.asInvitee)
const date = (value: number) => new Date(value * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
async function load(append = false) {
  const version = ++request
  controller?.abort(); controller = new AbortController()
  busy.value = true; error.value = ''
  try {
    const data = await api<ReferralStatus>(`/api/referrals/status${append && status.value?.nextCursor ? `?cursor=${status.value.nextCursor}` : ''}`, { signal: controller.signal })
    if (version !== request) return
    status.value = { ...data, items: append ? [...(status.value?.items || []), ...data.items] : data.items }
    emit('status', status.value)
  } catch (cause) {
    if (version === request) {
      emit('status', null)
      error.value = errorMessage(cause) === 'REFERRAL_ACCOUNT_REQUIRED' ? '请先连接章鱼账号，再查看邀请福利。' : '邀请福利暂时无法读取，请稍后重试。'
    }
  } finally { if (version === request) busy.value = false }
}
async function copyInvite() {
  if (!status.value?.inviteUrl) return
  try { await navigator.clipboard.writeText(status.value.inviteUrl); notify('邀请链接已复制。') }
  catch { error.value = '复制未成功，请选中下方链接后手动复制。' }
}
watch(() => [session.user?.id, session.user?.accountId], () => { status.value = null; emit('status', null); void load() }, { immediate: true })
onBeforeUnmount(() => { request++; controller?.abort() })
</script>

<template>
  <section class="panel-section referral-benefits" aria-labelledby="referral-heading">
    <div class="section-heading"><h2 id="referral-heading">邀请朋友，共享积分</h2><button type="button" class="icon-button" aria-label="刷新邀请福利" title="刷新邀请福利" :disabled="busy" @click="load()"><RefreshCw :size="17" aria-hidden="true" /></button></div>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button type="button" class="text-button" :disabled="busy" @click="load()">重新读取</button></p>
    <p v-if="!status && busy" class="muted" role="status">正在读取邀请福利…</p>
    <template v-if="status">
      <div class="referral-intro">
        <div>
          <p v-if="status.config.enabled" class="referral-award"><span>你得 <strong>{{ points(status.config.inviterPoints) }}</strong></span><span>好友得 <strong>{{ points(status.config.inviteePoints) }}</strong></span><span class="referral-unit">积分</span></p>
          <p v-if="status.config.enabled" class="referral-condition">新朋友通过你的链接注册后，任意一笔充值{{ topupCondition(status.config.minTopupCny) }}，双方自动获得奖励。首笔未达标不影响后续领取。</p>
          <p class="caption-5 muted">仅限新注册账号，每位新人奖励一次；按单笔实付判断，不累计。赠送积分、兑换码及余额支付不计入充值；已绑定邀请按绑定时的规则发放。</p>
          <p v-if="!status.config.enabled" class="notice-inline" role="status">新邀请福利已暂停。此前已绑定的邀请继续按原规则发放。</p>
        </div>
        <div class="referral-share">
          <template v-if="session.user && status.inviteUrl">
            <button type="button" class="button primary btn" :disabled="!status.config.enabled" @click="copyInvite"><Copy :size="16" aria-hidden="true" />复制我的邀请链接</button>
            <label class="field"><span>我的邀请链接</span><input class="control" :value="status.inviteUrl" readonly @focus="($event.target as HTMLInputElement).select()" /></label>
            <p class="caption-5 muted">链接已包含邀请码，好友注册时自动绑定。</p>
          </template>
          <template v-else><RouterLink to="/account?mode=register" class="button primary btn">注册并绑定邀请</RouterLink><RouterLink to="/account" class="button subtle btn">已有账号，去登录</RouterLink></template>
        </div>
      </div>
      <div v-if="own" class="referral-own" role="status">
        <div><strong>{{ own.state === 'credited' ? `你的 ${points(own.inviteePoints)} 积分已到账` : own.state === 'pending' ? '充值已确认，奖励正在发放' : `邀请已绑定，单笔充值${topupCondition(own.minTopupCny)}即可领奖` }}</strong><p class="caption-5 muted">{{ own.state === 'waiting_topup' ? `你将获得 ${points(own.inviteePoints)} 积分，邀请人获得 ${points(own.inviterPoints)} 积分。` : '双方奖励自动入账，可在账户积分中查看。' }}</p></div>
        <RouterLink v-if="own.state === 'waiting_topup'" to="/account?tab=balance" class="button btn">前往充值</RouterLink>
      </div>
      <template v-if="session.user">
        <dl class="referral-totals"><div><dt>累计邀请新人</dt><dd>{{ points(status.invited) }} <span>人</span></dd></div><div><dt>双方已到账</dt><dd>{{ points(status.credited) }} <span>人</span></dd></div><div><dt>邀请累计所得</dt><dd>{{ points(status.earnedPoints) }} <span>积分</span></dd></div></dl>
        <div class="section-heading"><h3>我的邀请记录</h3><span class="caption-5 muted">{{ status.waiting }} 人待达标<span v-if="status.pending"> · {{ status.pending }} 人待发放</span></span></div>
        <p v-if="!status.items.length" class="muted">还没有绑定的新人。把邀请链接分享给朋友，完成注册后即可在这里查看进度。</p>
        <ul v-else class="referral-records"><li v-for="item in status.items" :key="item.inviteeId"><div><strong>新用户 {{ item.inviteeId }}</strong><p class="caption-5 muted">{{ date(item.boundAt) }} 绑定<span v-if="item.creditedAt"> · {{ date(item.creditedAt) }} 到账</span></p></div><div class="referral-record-result"><span :class="{ 'referral-credited': item.state === 'credited' }">{{ labels[item.state] }}</span><span class="caption-5 muted">{{ item.state === 'credited' ? '已获' : '可获' }} {{ points(item.inviterPoints) }} 积分</span></div></li></ul>
        <button v-if="status.nextCursor" type="button" class="button subtle btn" :disabled="busy" @click="load(true)">{{ busy ? '正在读取…' : '查看更多邀请' }}</button>
      </template>
    </template>
  </section>
</template>

<style scoped>
/* Hallmark · shape: app screen · genre: modern-minimal · theme: brand · redesign: full · signature: shared referral rewards and progress ledger · v2.0.0 */
/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4 · weakest: H, keep both rewards beside the invitation action */
.referral-benefits { display: grid; gap: var(--space-section); padding-block: var(--space-section); border: 0; }
.referral-benefits :is(h2, h3) { min-width: 0; overflow-wrap: break-word; text-wrap: balance; }
.referral-benefits > .section-heading { margin: 0; }
.referral-benefits h2 { font-size: 20px; line-height: 28px; }
.referral-benefits h3 { font-size: 18px; line-height: 28px; }
.referral-intro { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); align-items: start; gap: var(--space-page); }
.referral-intro > div { min-width: 0; }
.referral-award { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-small) var(--space-section); margin: 0 0 var(--space-control); }
.referral-award strong { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
.referral-unit { color: var(--muted); font-size: 12px; }
.referral-condition { line-height: 24px; margin-bottom: var(--space-control); max-inline-size: 60ch; text-wrap: pretty; }
.referral-intro .caption-5 { line-height: 20px; max-inline-size: 72ch; text-wrap: pretty; }
.referral-share { display: grid; align-content: start; gap: var(--space-control); min-width: 0; padding-inline-start: var(--space-page); border-inline-start: 1px solid var(--border); }
.referral-share .field { margin: 0; }
.referral-share .control { border-color: var(--control-border); }
.referral-benefits .btn { justify-self: start; min-height: var(--control-height); margin-top: 0; white-space: nowrap; }
.referral-benefits :is(button, a, input):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.referral-benefits button:not(:disabled):active { background-color: var(--surface-soft); }
.referral-benefits button.primary:not(:disabled):active { background-color: var(--blue-hover); }
.referral-benefits button:disabled { opacity: .55; cursor: not-allowed; }
.referral-own { display: flex; align-items: center; justify-content: space-between; gap: var(--space-group); padding: var(--space-group); background: var(--surface-soft); border-radius: var(--radius); }
.referral-own > div { min-width: 0; }
.referral-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-section); margin: 0; padding-block: var(--space-group); border-block: 1px solid var(--border); }
.referral-totals > div + div { padding-inline-start: var(--space-section); border-inline-start: 1px solid var(--border); }
.referral-totals dt { color: var(--muted); margin-bottom: var(--space-small); font-size: 12px; }
.referral-totals dd { margin: 0; font-size: 24px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.referral-totals dd span { font-size: 12px; color: var(--muted); }
.referral-records { list-style: none; margin: 0; padding: 0; }
.referral-records li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-group); padding-block: var(--space-group); border-top: 1px solid var(--border); }
.referral-records li > div { min-width: 0; overflow-wrap: anywhere; }
.referral-record-result { display: grid; gap: var(--space-label); text-align: end; flex-shrink: 0; }
.referral-credited { color: var(--green); }
.text-button { min-height: var(--target-size); padding: var(--space-small); text-decoration: underline; white-space: nowrap; }
@media (max-width: 700px) {
  .referral-intro { grid-template-columns: minmax(0, 1fr); gap: var(--space-section); }
  .referral-award { gap: var(--space-small) var(--space-group); }
  .referral-award strong { font-size: 24px; }
  .referral-share { padding-inline-start: 0; border: 0; }
  .referral-share .button { width: 100%; }
  .referral-totals { gap: var(--space-group); grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .referral-totals > div + div { padding-inline-start: var(--space-group); }
  .referral-totals > div:last-child { grid-column: 1 / -1; padding: var(--space-group) 0 0; border: 0; border-block-start: 1px solid var(--border); }
  .referral-own { align-items: flex-start; flex-direction: column; }
  .referral-records li { align-items: flex-start; }
}
</style>
