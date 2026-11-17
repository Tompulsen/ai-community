<script setup lang="ts">
import { formatLegacyPoints, formatPoints, type CommunityWallet } from '../../shared/studio/community-wallet'
defineProps<{ wallet: CommunityWallet }>()
const expiry = (timestamp: number) => new Date(timestamp * 1000).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <section class="community-wallet-summary" aria-label="社区积分">
    <dl class="point-balances">
      <div><dt>公益积分</dt><dd class="point-amount">{{ formatPoints(wallet.charityPoints) }}<span>积分</span></dd><dd class="point-note">仅限社区使用</dd><dd v-if="wallet.charityExpiringAt" class="point-note">最近一批到期：{{ expiry(wallet.charityExpiringAt) }}</dd></div>
      <div><dt>永久积分</dt><dd class="point-amount">{{ formatPoints(wallet.permanentPoints) }}<span>积分</span></dd><dd class="point-note">充值实付本金换算的积分</dd><dd class="point-note">与账户中心共用同一份充值余额</dd></div>
      <div v-if="wallet.legacyApiQuota !== 0" class="legacy-balance"><dt>{{ wallet.legacyApiQuota < 0 ? '历史欠额（折合积分）' : '历史 API 额度（折合积分）' }}</dt><dd v-if="wallet.legacyPoints !== undefined" class="point-amount">{{ formatLegacyPoints(wallet.legacyPoints) }}<span>积分</span></dd><dd v-else class="point-note">历史额度折合积分暂不可用，请前往账户中心查看。</dd><dd class="point-note">{{ wallet.legacyApiQuota < 0 ? '账户中心的历史欠额，不计入社区可用积分。' : '仅限账户中心及原 API 使用，不计入社区可用积分。' }}</dd></div>
    </dl>
    <p class="points-rule">100 积分 = ¥ 0.02。社区优先使用公益积分，不足部分使用永久积分。</p>
  </section>
</template>

<style scoped>
.community-wallet-summary { min-width: 0; width: 100%; }
.point-balances { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 32px; margin: 0; }
.point-balances > div { min-width: 0; }
.point-balances > .legacy-balance { grid-column: 1 / -1; border-top: 1px solid var(--border); padding-top: 16px; }
.point-balances dt { color: var(--muted); font-size: 14px; line-height: 24px; }
.point-balances .point-amount { margin: 4px 0 8px; color: var(--ink); font-size: 28px; line-height: 36px; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.point-balances dd > span { margin-left: 8px; font-size: 14px; font-weight: 400; white-space: nowrap; }
.point-note, .points-rule { margin: 0; color: var(--muted); font-size: 13px; line-height: 21px; }
.points-rule { margin-top: 12px; }
@media (max-width: 480px) { .point-balances { grid-template-columns: minmax(0, 1fr); gap: 20px; } }
</style>
