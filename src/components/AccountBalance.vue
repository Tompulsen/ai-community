<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Coins } from '@lucide/vue'
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
  <button type="button" class="account-balance" :class="{ unavailable: accountBalance.amount === null }" :aria-label="balanceDescription" :title="balanceDescription" :aria-busy="accountBalance.loading" :disabled="accountBalance.loading" @click="refreshAccountBalance">
    <Coins :size="19" aria-hidden="true" /><span>{{ balanceNumber }}</span>
  </button>
</template>

<style scoped>
.account-balance { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none; min-height: 44px; max-width: 160px; padding: 8px; border-radius: 6px; color: var(--ink); }
.account-balance > svg { flex: none; color: var(--amber); }
.account-balance > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
.account-balance:hover { background: var(--surface); }.account-balance.unavailable { color: var(--muted); }.account-balance:disabled { opacity: 1; }
@media (max-width: 639px) { .account-balance { flex: 0 1 auto; min-width: 44px; max-width: 108px; padding-inline: 4px; }.account-balance > svg { width: 17px; height: 17px; } }
</style>
