<script setup lang="ts">
import { computed } from 'vue'
import { ShieldCheck, ShieldX, LoaderCircle, RefreshCw } from '@lucide/vue'
import { moderateCreation, type CreationTask } from '../native-studio'

const props = defineProps<{ task: CreationTask; content?: string }>()
const state = computed(() => props.task.moderation?.state || 'checking')
const label = computed(() => ({ checking: '正在检查作品内容…', passed: '初审通过，发布后立即公开', rejected: '初审未通过，暂不能发布', unavailable: '检查暂未完成，暂不能发布', disabled: '未启用自动初审，发布后立即公开' })[state.value])
</script>

<template>
  <section v-if="task.phase === 'complete' && task.purpose !== 'document'" class="creation-moderation" :class="{ blocked: state === 'rejected' || state === 'unavailable' }" :aria-busy="state === 'checking'">
    <div class="moderation-copy" role="status" aria-live="polite">
      <LoaderCircle v-if="state === 'checking'" class="spin" :size="17" aria-hidden="true" />
      <ShieldX v-else-if="state === 'rejected' || state === 'unavailable'" :size="17" aria-hidden="true" />
      <ShieldCheck v-else :size="17" aria-hidden="true" />
      <div><p>{{ label }}</p><small v-if="task.moderation?.reason">{{ task.moderation.reason }}</small><small v-else-if="task.kind === 'video' && state === 'passed'">视频画面已抽帧检查；音轨未检查。</small></div>
    </div>
    <button v-if="state === 'unavailable' || state === 'rejected'" type="button" class="button subtle btn" @click="moderateCreation(task, true, content)"><RefreshCw :size="15" aria-hidden="true" />重新检查</button>
  </section>
</template>

<style scoped>
.creation-moderation { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; margin-top: 8px; border: 1px solid var(--border); border-radius: 10px; color: var(--muted); font-size: 12px; }
.moderation-copy { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.moderation-copy > svg { flex-shrink: 0; margin-top: 2px; }
.moderation-copy p { margin: 0; }
.moderation-copy small { display: block; margin-top: 4px; overflow-wrap: anywhere; }
.blocked { border-color: var(--danger); }
.creation-moderation button { min-height: 44px; flex-shrink: 0; }
.spin { animation: moderation-spin 1.2s linear infinite; }
@keyframes moderation-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
@media (max-width: 480px) { .creation-moderation { align-items: flex-start; flex-direction: column; } }
</style>
