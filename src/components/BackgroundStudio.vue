<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, Minus, TriangleAlert } from '@lucide/vue'
import { creation, type CreationTask } from '../native-studio'
import { session } from '../state'
const route = useRoute(), router = useRouter()
const hidden = ref(false), index = ref(0)
const tasks = computed(() => creation.tasks.slice(0, 20))
const task = computed(() => tasks.value[Math.min(index.value, tasks.value.length - 1)])
function open(value: CreationTask) { creation.selectedId = value.id; void router.push(`/create/${value.kind}`) }
</script>

<template>
  <aside v-if="session.user && task && !route.path.startsWith('/create')" class="background-dock" :class="{ minimized: hidden }" aria-label="后台生成任务">
    <button v-if="hidden" class="button btn" @click="hidden = false"><LoaderCircle v-if="tasks.some(item => ['submitting', 'running'].includes(item.phase))" :size="17" /><CheckCircle2 v-else :size="17" />生成任务 · {{ tasks.length }}</button>
    <template v-else><div class="dock-heading"><strong>生成任务 · {{ index + 1 }}/{{ tasks.length }}</strong><button class="icon-button" aria-label="收起生成任务" title="收起" @click="hidden = true"><Minus :size="17" /></button></div><div class="dock-content"><component :is="['submitting', 'running'].includes(task.phase) ? LoaderCircle : task.phase === 'complete' ? CheckCircle2 : TriangleAlert" :size="20" /><div><strong>{{ task.phase === 'complete' ? '生成完成' : ['submitting', 'running'].includes(task.phase) ? '正在生成' : '任务已保留' }}</strong><p>{{ task.prompt || task.model }}</p></div></div><div class="dock-actions"><button class="button primary btn" @click="open(task)">查看任务<ArrowUpRight :size="15" /></button><button class="icon-button" aria-label="上一个任务" title="上一个任务" :disabled="tasks.length < 2" @click="index = (index + tasks.length - 1) % tasks.length"><ChevronLeft :size="17" /></button><button class="icon-button" aria-label="下一个任务" title="下一个任务" :disabled="tasks.length < 2" @click="index = (index + 1) % tasks.length"><ChevronRight :size="17" /></button></div></template>
  </aside>
</template>

<style scoped>
.background-dock { position: fixed; z-index: 45; right: 24px; bottom: 24px; width: min(320px, calc(100vw - 32px)); border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: 0 12px 32px #1a263314; overflow: hidden; }
.background-dock.minimized { width: auto; }
.dock-heading { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 4px 16px; border-bottom: 1px solid var(--border); }
.dock-content { display: flex; align-items: flex-start; gap: 12px; padding: 16px; }
.dock-content > div { min-width: 0; }
.dock-content p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; margin-top: 4px; }
.dock-actions { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 12px 12px; }
@media (max-width: 999px) { .background-dock { right: 16px; bottom: calc(80px + env(safe-area-inset-bottom)); } }
</style>
