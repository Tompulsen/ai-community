<!-- Adapted from octopus_chat/app/components/context-usage.tsx (MIT). -->
<script setup lang="ts">
import { computed } from 'vue'
import { Database, Gauge } from '@lucide/vue'
import type { ChatMessage } from '../../shared/studio/types'
import { getResponseMetrics } from '../../shared/studio/chat-response-metrics'
import StudioPopover from './StudioPopover.vue'

const props = defineProps<{ messages: ChatMessage[] }>()
const metrics = computed(() => getResponseMetrics(props.messages))
const decimal = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })
const speed = computed(() => metrics.value.outputTokensPerSecond === undefined ? '— tok/s' : `${decimal.format(metrics.value.outputTokensPerSecond)} tok/s`)
const cache = computed(() => metrics.value.cacheHitPercent === undefined ? '—' : `${decimal.format(metrics.value.cacheHitPercent)}%`)
const speedNote = computed(() => {
  const value = metrics.value
  if (value.speedIsPrevious) return `本次暂无可用统计，显示上一轮输出速度${value.speedIsEstimated ? '（估算）' : ''}。`
  if (value.outputTokensPerSecond !== undefined) return value.speedIsEstimated
    ? '按已输出内容实时估算；完成后有 token 用量时校准。不含首字前等待。'
    : '按接口输出 token 用量与客户端记录的生成时间计算，不含首字前等待。'
  return value.pending ? '等待首个输出，随后实时显示估算速度。' : '暂无可用的生成耗时或 token 统计，发送消息后显示。'
})
const cacheNote = computed(() => metrics.value.cacheIsPrevious ? '本次未提供缓存统计，显示上一轮缓存命中率。'
  : metrics.value.cacheHitPercent !== undefined ? '接口返回的缓存输入 token 占本次输入 token 的比例。'
  : metrics.value.pending ? '等待本次请求的缓存统计。' : '接口尚未提供缓存用量。')
</script>
<template>
  <div class="response-metrics" role="group" aria-label="对话输出统计">
    <StudioPopover label="输出速度" :trigger-label="`输出速度：${speed}${metrics.speedIsPrevious ? '（上一轮）' : metrics.speedIsEstimated ? '（估算）' : ''}`" :width="300">
      <template #trigger><Gauge :size="14" /><span>{{ speed }}</span><small v-if="metrics.speedIsPrevious">上轮</small><small v-else-if="metrics.speedIsEstimated">估算</small></template>
      <div class="metric-details"><strong>{{ speed }}</strong><p>{{ speedNote }}</p></div>
    </StudioPopover>
    <StudioPopover label="缓存命中" :trigger-label="`缓存命中：${cache}${metrics.cacheIsPrevious ? '（上一轮）' : ''}`" :width="300">
      <template #trigger><Database :size="14" /><span>{{ cache }}</span><small v-if="metrics.cacheIsPrevious">上轮</small></template>
      <div class="metric-details"><strong>{{ cache }}</strong><p>{{ cacheNote }}</p></div>
    </StudioPopover>
  </div>
</template>
<style scoped>
.response-metrics { display: flex; flex: none; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px; min-width: 0; margin-block: 4px; color: var(--muted); }
.response-metrics :deep(> .studio-tool) { min-height: 28px; padding: 3px 6px; gap: 5px; font-size: 12px; font-variant-numeric: tabular-nums; }
.response-metrics :deep(> .studio-tool > span) { min-width: 5ch; text-align: start; }.response-metrics :deep(> .studio-tool:first-child > span) { min-width: 9ch; }
small { font-size: 11px; color: var(--muted); }.metric-details { display: grid; gap: 8px; font-size: 13px; line-height: 22px; }.metric-details strong { font-weight: 500; font-variant-numeric: tabular-nums; }.metric-details p { margin: 0; color: var(--muted); }
@media (pointer: coarse), (max-width: 600px) { .response-metrics :deep(> .studio-tool) { min-height: 44px; } }
</style>
