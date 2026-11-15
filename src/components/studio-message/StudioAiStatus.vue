<!-- Adapted from octopus_chat ai-status.tsx (MIT). -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AlertCircle, BrainCircuit, Check, Globe2, PencilLine } from '@lucide/vue'
import StudioMatrixOrb from './StudioMatrixOrb.vue'

const props = withDefaults(defineProps<{ state?: 'thinking' | 'researching' | 'writing' | 'done' | 'error'; label?: string; timer?: boolean; elapsed?: string }>(), { state: 'thinking', timer: true })
const seconds = ref(0), active = computed(() => props.state !== 'done' && props.state !== 'error')
const labels = { thinking: '正在思考', researching: '正在搜索', writing: '正在生成', done: '已完成', error: '执行失败' }
const icons = { thinking: BrainCircuit, researching: Globe2, writing: PencilLine, done: Check, error: AlertCircle }
let interval: ReturnType<typeof setInterval> | undefined
watch(() => active.value && props.timer, running => {
  clearInterval(interval)
  if (!running) return
  seconds.value = 0
  const start = Date.now()
  interval = setInterval(() => { seconds.value = Math.floor((Date.now() - start) / 1000) }, 1000)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(interval))
</script>

<template>
  <span class="ai-status" :data-state="state" :data-active="active" role="status">
    <StudioMatrixOrb v-if="state === 'thinking'" /><component v-else :is="icons[state]" :size="16" aria-hidden="true" />
    <span>{{ label ?? labels[state] }}</span>
    <span v-if="elapsed || timer && active" class="ai-elapsed" :class="{ 'task-elapsed': elapsed }" aria-hidden="true">{{ elapsed || (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`) }}</span>
  </span>
</template>

<style scoped>
.ai-status { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; min-height: 32px; color: var(--muted); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
.ai-status svg { flex: none; }
.ai-elapsed { min-width: 5ch; font-variant-numeric: tabular-nums; }
.ai-status[data-state="error"] { color: var(--danger, #b64646); }
</style>
