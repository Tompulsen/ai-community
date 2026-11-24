<script setup lang="ts">
import { LayoutGrid } from '@lucide/vue'
import { session } from '../state'
import StudioModelPrices from '../components/StudioModelPrices.vue'
</script>
<template>
  <div class="page-container models-page">
    <StudioModelPrices v-if="session.user" standalone />
    <div v-else-if="session.ready" class="empty-state"><LayoutGrid :size="30" aria-hidden="true" /><h1>登录后查看模型广场</h1><p>按文本、图片和视频筛选模型，查看各分组价格。</p><RouterLink to="/account?returnTo=/models" class="button primary btn">登录</RouterLink></div>
    <p v-else class="muted" role="status">正在读取账号…</p>
  </div>
</template>
<style scoped>
.models-page { max-width: 1600px; padding-bottom: 32px; }
.models-page > .model-prices { padding-top: 0; }
</style>
