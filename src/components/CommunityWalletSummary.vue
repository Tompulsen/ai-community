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
.point-balances { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 32px; margin: 0; }
.point-balances > div { min-width: 0; }
.point-balances dt { color: var(--muted); font-size: 14px; line-height: 24px; }
.point-balances .point-amount { margin: 4px 0 8px; color: var(--ink); font-size: 28px; line-height: 36px; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.point-balances dd > span { margin-left: 8px; font-size: 14px; font-weight: 400; white-space: nowrap; }
@media (max-width: 480px) { .point-balances { grid-template-columns: minmax(0, 1fr); gap: 20px; } }
</style>
