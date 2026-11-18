<script setup lang="ts">
import { formatPoints, type CommunityWallet } from '../../shared/studio/community-wallet'
defineProps<{ wallet: CommunityWallet }>()
</script>

<template>
  <section class="community-wallet-summary" aria-label="社区积分">
    <dl class="point-balances">
      <div><dt>福利积分</dt><dd class="point-amount">{{ formatPoints(wallet.charityPoints) }}<span>积分</span></dd></div>
      <div><dt>永久积分</dt><dd class="point-amount">{{ formatPoints(wallet.permanentPoints) }}<span>积分</span></dd></div>
    </dl>
  </section>
</template>

<style scoped>
.community-wallet-summary { min-width: 0; width: 100%; }
.point-balances { display: flex; flex-wrap: wrap; gap: 4px 24px; margin: 0; }
.point-balances > div { display: flex; align-items: baseline; gap: 8px; min-width: 0; max-width: 100%; }
.point-balances dt { flex: none; color: var(--muted); font-size: 12px; line-height: 24px; }
.point-balances .point-amount { min-width: 0; margin: 0; color: var(--ink); font-size: 18px; line-height: 24px; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.point-balances dd > span { margin-left: 4px; font-size: 12px; font-weight: 400; white-space: nowrap; }
</style>
