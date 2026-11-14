<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { session } from '../state'
import { accountBalance, balanceDescription, balanceNumber, refreshAccountBalance } from '../account-balance'

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
  <RouterLink to="/account?tab=balance" class="account-balance" :class="{ unavailable: accountBalance.amount === null }" :aria-label="accountBalance.amount === null ? '账户与余额' : `账户与余额，${balanceDescription}`" :title="accountBalance.amount === null ? '查看账户与余额' : balanceDescription" :aria-busy="accountBalance.loading">
    <span>{{ balanceNumber }}{{ accountBalance.amount !== null && accountBalance.currency ? ' ' + accountBalance.currency : '' }}</span>
  </RouterLink>
</template>

<style scoped>
.account-balance { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none; min-height: 44px; max-width: 160px; padding: 8px; border-radius: 6px; color: var(--ink); }
.account-balance > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
.account-balance:hover { background: var(--surface); }.account-balance.unavailable { color: var(--muted); }
@media (max-width: 639px) { .account-balance { flex: 0 1 auto; min-width: 44px; max-width: 108px; padding-inline: 4px; } }
</style>
