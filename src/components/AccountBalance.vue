<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { session } from '../state'
import { accountBalance, balanceDescription, balanceNumber, balancePoints, refreshAccountBalance } from '../account-balance'

const route = useRoute()
let refreshTimer: ReturnType<typeof setInterval> | undefined
let expiryTimer: ReturnType<typeof setTimeout> | undefined
function refreshVisible() { if (document.visibilityState !== 'hidden') void refreshAccountBalance() }
watch(() => [session.user?.id, session.user?.accountId, route.path], refreshVisible, { immediate: true })
watch(() => accountBalance.points?.charityExpiringAt, expiry => {
  clearTimeout(expiryTimer)
  if (expiry && expiry * 1000 > Date.now()) {
    expiryTimer = setTimeout(refreshVisible, Math.min(2_147_483_647, expiry * 1000 - Date.now() + 50))
  }
})
onMounted(() => {
  refreshTimer = setInterval(refreshVisible, 15_000)
  window.addEventListener('focus', refreshVisible)
  document.addEventListener('visibilitychange', refreshVisible)
})
onBeforeUnmount(() => {
  clearInterval(refreshTimer)
  clearTimeout(expiryTimer)
  window.removeEventListener('focus', refreshVisible)
  document.removeEventListener('visibilitychange', refreshVisible)
})
</script>

<template>
  <RouterLink v-wallet-prefetch to="/account?tab=balance" class="account-balance" :class="{ unavailable: accountBalance.amount === null && !accountBalance.points }" :aria-label="accountBalance.points ? `我的账户，${balanceDescription}` : accountBalance.amount === null ? '我的账户' : `我的账户，${balanceNumber}${accountBalance.currency ? ' ' + accountBalance.currency : ''}`" :aria-description="balanceDescription" :title="accountBalance.amount === null && !accountBalance.points ? '查看我的账户' : balanceDescription" :aria-busy="accountBalance.loading">
    <span v-if="accountBalance.points">{{ balancePoints }} 积分</span>
    <span v-else>{{ balanceNumber }}{{ accountBalance.amount !== null && accountBalance.currency ? ' ' + accountBalance.currency : '' }}</span>
  </RouterLink>
</template>

<style scoped>
.account-balance { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none; min-height: 44px; max-width: 160px; padding: 8px; border-radius: 6px; color: var(--ink); }
.account-balance > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
.account-balance:hover { background: var(--surface); }.account-balance.unavailable { color: var(--muted); }
@media (max-width: 639px) { .account-balance { flex: 0 1 auto; min-width: 44px; max-width: 108px; padding-inline: 4px; } }
</style>
