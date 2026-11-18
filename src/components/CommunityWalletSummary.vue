<script setup lang="ts">
import { formatPoints, type CommunityWallet } from '../../shared/studio/community-wallet'
defineProps<{ wallet: CommunityWallet }>()
</script>

<template>
  <section class="community-wallet-summary" aria-label="社区积分">
    <dl class="point-balances">
      <div><dt>福利积分</dt><dd class="point-amount">{{ formatPoints(wallet.charityPoints) }}<span>积分</span></dd><dd class="point-note">QX 有效积分合计，与 QX 共用余额</dd><dd class="point-note">消费和限时积分过期后自动更新</dd></div>
      <div><dt>永久积分</dt><dd class="point-amount">{{ formatPoints(wallet.permanentPoints) }}<span>积分</span></dd><dd class="point-note">New API 全部可用余额折算的积分</dd><dd class="point-note">与账户中心共用同一份余额</dd></div>
    </dl>
    <p class="points-rule">¥ 1 = 5,000 积分。社区优先使用福利积分，不足部分使用永久积分。</p>
  </section>
</template>

<style scoped>
.community-wallet-summary { min-width: 0; width: 100%; }
.point-balances { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 32px; margin: 0; }
.point-balances > div { min-width: 0; }
.point-balances dt { color: var(--muted); font-size: 14px; line-height: 24px; }
.point-balances .point-amount { margin: 4px 0 8px; color: var(--ink); font-size: 28px; line-height: 36px; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.point-balances dd > span { margin-left: 8px; font-size: 14px; font-weight: 400; white-space: nowrap; }
.point-note, .points-rule { margin: 0; color: var(--muted); font-size: 13px; line-height: 21px; }
.points-rule { margin-top: 12px; }
@media (max-width: 480px) { .point-balances { grid-template-columns: minmax(0, 1fr); gap: 20px; } }
</style>
