<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Copy, RefreshCw } from '@lucide/vue'
import type { ReferralStatus } from '../../shared/referral'
import { accountCenterUrl, api, errorMessage, notify, session } from '../state'

const status = ref<ReferralStatus | null>(null), busy = ref(false), error = ref('')
let request = 0, controller: AbortController | undefined
const points = (value: number) => value.toLocaleString('zh-CN')
const labels = { waiting_topup: '待新人充值', pending: '待发放 · 自动重试', credited: '双方已到账' }
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
  } catch (cause) {
    if (version === request) error.value = errorMessage(cause) === 'REFERRAL_ACCOUNT_REQUIRED' ? '请先连接章鱼账号，再查看邀请福利。' : '邀请福利暂时无法读取，请稍后重试。'
  } finally { if (version === request) busy.value = false }
}
async function copyInvite() {
  if (!status.value?.inviteUrl) return
  try { await navigator.clipboard.writeText(status.value.inviteUrl); notify('邀请链接已复制。') }
  catch { error.value = '复制未成功，请选中下方链接后手动复制。' }
}
watch(() => [session.user?.id, session.user?.accountId], () => { status.value = null; void load() }, { immediate: true })
onBeforeUnmount(() => { request++; controller?.abort() })
</script>

<template>
  <section class="panel-section referral-benefits" aria-labelledby="referral-heading">
    <div class="section-heading"><h2 id="referral-heading">邀请朋友，共享积分</h2><button class="icon-button" aria-label="刷新邀请福利" :disabled="busy" @click="load()"><RefreshCw :size="17" /></button></div>
    <p v-if="error" class="form-error" role="alert">{{ error }} <button class="text-button" :disabled="busy" @click="load()">重新读取</button></p>
    <p v-if="!status && busy" class="muted" role="status">正在读取邀请福利…</p>
    <template v-if="status">
      <div class="referral-intro">
        <div>
          <p class="referral-award"><span>你得 <strong>{{ points(status.config.inviterPoints) }}</strong></span><span>好友得 <strong>{{ points(status.config.inviteePoints) }}</strong></span><span class="referral-unit">永久积分</span></p>
          <p class="referral-condition">新朋友通过你的链接注册并绑定邀请码，首次成功充值后，双方自动到账。充值金额不限，实际支付须大于 0。</p>
          <p class="caption-5 muted">仅限新注册账号，每位新人奖励一次。赠送积分、兑换码及余额支付不计入充值；已绑定邀请按绑定时的奖励额度发放。</p>
          <p v-if="!status.config.enabled" class="notice-inline" role="status">新邀请福利已暂停。此前已绑定的邀请继续按原规则发放。</p>
        </div>
        <div class="referral-share">
          <template v-if="session.user && status.inviteUrl">
            <button class="button primary btn" :disabled="!status.config.enabled" @click="copyInvite"><Copy :size="16" />复制我的邀请链接</button>
            <label class="field"><span>我的邀请链接</span><input class="control" :value="status.inviteUrl" readonly @focus="($event.target as HTMLInputElement).select()" /></label>
            <p class="caption-5 muted">链接已包含邀请码，好友注册时自动绑定。</p>
          </template>
          <template v-else><a v-if="accountCenterUrl('register')" :href="accountCenterUrl('register')" class="button primary btn">注册并绑定邀请</a><RouterLink to="/account" class="button subtle btn">已有账号，去登录</RouterLink></template>
        </div>
      </div>
      <div v-if="own" class="referral-own" role="status">
        <div><strong>{{ own.state === 'credited' ? `你的 ${points(own.inviteePoints)} 永久积分已到账` : own.state === 'pending' ? '充值已确认，奖励正在发放' : '邀请已绑定，完成首次充值即可领奖' }}</strong><p class="caption-5 muted">{{ own.state === 'waiting_topup' ? `你将获得 ${points(own.inviteePoints)} 永久积分，邀请人获得 ${points(own.inviterPoints)} 积分。` : '双方奖励自动入账，可在账户积分中查看。' }}</p></div>
        <RouterLink v-if="own.state === 'waiting_topup'" to="/account?tab=balance" class="button btn">前往充值</RouterLink>
      </div>
      <template v-if="session.user">
        <dl class="referral-totals"><div><dt>已绑定新人</dt><dd>{{ points(status.invited) }} <span>人</span></dd></div><div><dt>双方已到账</dt><dd>{{ points(status.credited) }} <span>人</span></dd></div><div><dt>邀请累计所得</dt><dd>{{ points(status.earnedPoints) }} <span>永久积分</span></dd></div></dl>
        <div class="section-heading"><h3>我的邀请记录</h3><span class="caption-5 muted">{{ status.invited - status.credited - status.pending }} 人待充值<span v-if="status.pending"> · {{ status.pending }} 人待发放</span></span></div>
        <p v-if="!status.items.length" class="muted">还没有绑定的新人。把邀请链接分享给朋友，完成注册后即可在这里查看进度。</p>
        <ul v-else class="referral-records"><li v-for="item in status.items" :key="item.inviteeId"><div><strong>新用户 {{ item.inviteeId }}</strong><p class="caption-5 muted">{{ date(item.boundAt) }} 绑定<span v-if="item.creditedAt"> · {{ date(item.creditedAt) }} 到账</span></p></div><div class="referral-record-result"><span :class="{ 'referral-credited': item.state === 'credited' }">{{ labels[item.state] }}</span><span class="caption-5 muted">{{ item.state === 'credited' ? '已获' : '可获' }} {{ points(item.inviterPoints) }} 积分</span></div></li></ul>
        <button v-if="status.nextCursor" class="button subtle btn" :disabled="busy" @click="load(true)">{{ busy ? '正在读取…' : '查看更多邀请' }}</button>
      </template>
    </template>
  </section>
</template>

<style scoped>
.referral-benefits { display: grid; gap: 24px; }
.referral-intro { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(240px, 1fr); gap: 32px; }
.referral-award { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 24px; margin: 0 0 16px; }
.referral-award strong { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
.referral-unit { color: var(--muted); }
.referral-condition { line-height: 1.7; margin-bottom: 12px; }
.referral-share { display: grid; align-content: start; gap: 12px; min-width: 0; }
.referral-share .btn { justify-self: start; min-height: 44px; }
.referral-own { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; background: var(--surface-soft); border-radius: 6px; }
.referral-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin: 0; }
.referral-totals dt { color: var(--muted); margin-bottom: 8px; }
.referral-totals dd { margin: 0; font-size: 24px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.referral-totals dd span { font-size: 14px; color: var(--muted); }
.referral-records { list-style: none; margin: 0; padding: 0; }
.referral-records li { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 0; border-top: 1px solid var(--border); }
.referral-record-result { display: grid; gap: 4px; text-align: right; flex-shrink: 0; }
.referral-credited { color: var(--green); }
.text-button { min-height: 44px; padding: 8px; text-decoration: underline; }
@media (max-width: 700px) {
  .referral-intro { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .referral-award { gap: 8px 16px; }
  .referral-award strong { font-size: 24px; }
  .referral-totals { gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .referral-totals > div:last-child { grid-column: 1 / -1; }
  .referral-own { align-items: flex-start; flex-direction: column; }
  .referral-records li { align-items: flex-start; }
}
</style>
