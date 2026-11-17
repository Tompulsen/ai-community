<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { session } from '../state'
import { accountBalance, balanceDescription, balanceNumber, refreshAccountBalance } from '../account-balance'
import { formatLegacyPoints, formatPoints } from '../../shared/studio/community-wallet'

const route = useRoute()
function refreshVisible() { if (document.visibilityState !== 'hidden') void refreshAccountBalance() }
watch(() => [session.user?.id, session.user?.accountId, route.path], refreshVisible, { immediate: true })
onMounted(() => {
  window.addEventListener('focus', refreshVisible)
  document.addEventListener('visibilitychange', refreshVisible)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshVisible)
  document.removeEventListener('visibilitychange', refreshVisible)
})
</script>

<template>
  <RouterLink v-wallet-prefetch to="/account?tab=balance" class="account-balance" :class="{ unavailable: accountBalance.amount === null && !accountBalance.points, 'with-points': accountBalance.points }" :aria-label="accountBalance.points ? `我的账户，${balanceDescription}` : accountBalance.amount === null ? '我的账户' : `我的账户，${balanceNumber}${accountBalance.currency ? ' ' + accountBalance.currency : ''}`" :aria-description="balanceDescription" :title="accountBalance.amount === null && !accountBalance.points ? '查看我的账户' : balanceDescription" :aria-busy="accountBalance.loading">
    <span v-if="accountBalance.points" class="points-compact"><span>公益 {{ formatPoints(accountBalance.points.charityPoints) }} 积分</span><span>永久 {{ formatPoints(accountBalance.points.permanentPoints) }} 积分</span><span v-if="accountBalance.points.legacyApiQuota !== 0">{{ accountBalance.points.legacyApiQuota < 0 ? '历史欠额' : '历史/API' }} {{ accountBalance.points.legacyPoints === undefined ? '暂不可用' : `${formatLegacyPoints(accountBalance.points.legacyPoints)} 积分` }}</span></span>
    <span v-else>{{ balanceNumber }}{{ accountBalance.amount !== null && accountBalance.currency ? ' ' + accountBalance.currency : '' }}</span>
  </RouterLink>
</template>

<style scoped>
.account-balance { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none; min-height: 44px; max-width: 160px; padding: 8px; border-radius: 6px; color: var(--ink); }
.account-balance.with-points { padding-block: 4px; }
.account-balance > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
.account-balance > .points-compact { display: grid; gap: 2px; font-size: 12px; line-height: 16px; }.points-compact > span { overflow: hidden; text-overflow: ellipsis; }
.account-balance:hover { background: var(--surface); }.account-balance.unavailable { color: var(--muted); }
@media (max-width: 639px) { .account-balance { flex: 0 1 auto; min-width: 44px; max-width: 108px; padding: 4px; } }
</style>
