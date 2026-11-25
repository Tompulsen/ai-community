<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRight, Wallet } from '@lucide/vue'
import { accountBalance, balanceDescription, balancePoints, refreshAccountBalance } from '../account-balance'

const ways = [
  { label: '活动抽奖福利', to: '/activities' },
  { label: '推广福利', to: '/activities?tab=tasks&section=invite' },
  { label: '在线支持社区（￥）', to: '/account?tab=balance' },
]
onMounted(() => { void refreshAccountBalance() })
</script>

<template>
  <section class="credits-notice" aria-label="积分不足">
    <div class="credits-heading"><Wallet :size="18" aria-hidden="true" /><strong>积分不足</strong></div>
    <p class="credits-explanation" role="alert">当前可用积分不足以再次调用该模型，请获取积分后重试。</p>
    <div class="credits-balance" role="status" aria-live="polite" :aria-busy="accountBalance.loading">
      <span v-if="accountBalance.loading">正在读取当前可用积分…</span>
      <span v-else-if="accountBalance.points">当前可用积分 <strong>{{ balancePoints }}</strong></span>
      <span v-else-if="accountBalance.amount !== null">{{ balanceDescription }}</span>
      <span v-else>当前可用积分暂无法读取</span>
      <button type="button" class="text-link" :disabled="accountBalance.loading" aria-label="刷新当前可用积分" @click="refreshAccountBalance(true)">{{ accountBalance.error ? '重新读取' : '刷新' }}</button>
    </div>
    <div class="credits-ways-heading"><strong>获取积分</strong><span>查看各项参与条件与奖励</span></div>
    <ul class="credits-ways">
      <li v-for="way in ways" :key="way.to"><span>{{ way.label }}</span><RouterLink :to="way.to" :aria-label="`获取积分：${way.label}`">获取<ArrowRight :size="15" aria-hidden="true" /></RouterLink></li>
    </ul>
  </section>
</template>

<style scoped>
.credits-notice { width: 100%; max-width: 440px; min-width: 0; box-sizing: border-box; margin-block: 12px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-soft); color: var(--ink); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.credits-heading { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.credits-heading svg { color: var(--muted); flex: none; }
.credits-explanation { margin: 8px 0 0; }
.credits-balance { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0 12px; }
.credits-balance strong { margin-inline-start: 6px; font-variant-numeric: tabular-nums; }
.credits-balance button { min-height: 44px; min-width: 44px; }
.credits-ways-heading { display: flex; flex-wrap: wrap; gap: 4px 12px; padding-top: 12px; border-top: 1px solid var(--border); }
.credits-ways-heading span { color: var(--muted); font-size: 12px; }
.credits-ways { list-style: none; padding: 4px 0 0; margin: 0; }
.credits-ways li { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; }
.credits-ways a { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; min-height: 44px; min-width: 56px; flex: none; color: var(--blue); font-weight: 600; text-decoration: none; }
.credits-ways a:hover { text-decoration: underline; }
.credits-notice :is(a, button):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: 4px; }
</style>
