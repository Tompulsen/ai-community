<script setup lang="ts">
import { Receipt } from '@lucide/vue'
import { session } from '../state'
import StudioUsageLogs from '../components/StudioUsageLogs.vue'
</script>
<template>
  <div class="page-container usage-page">
    <StudioUsageLogs v-if="session.user" standalone />
    <div v-else-if="session.ready" class="empty-state"><Receipt :size="30" /><h1>登录后查看消费记录</h1><p>查看自己的积分消耗与模型用量。</p><RouterLink to="/account?returnTo=/usage-logs" class="button primary btn">登录</RouterLink></div>
    <p v-else class="muted" role="status">正在读取账号…</p>
  </div>
</template>
<style scoped>
.usage-page { max-width: 1280px; padding-bottom: 32px; }
</style>
