<script setup lang="ts">
import { watch } from 'vue'
import { CircleDollarSign, Compass, FolderOpen, Sparkles, SquarePen } from '@lucide/vue'
import { session } from '../state'
import { site } from '../site'
import { loadChats } from '../native-chat'
import { initializeCreation, type CreationTask } from '../native-studio'
import type { StudioKind } from '../studio-state'
import StudioConversations from './StudioConversations.vue'

defineProps<{ kind: StudioKind; accountTool: string }>()
const emit = defineEmits<{ kind: [value: StudioKind]; new: []; reuse: [task: CreationTask]; prices: []; conversation: [id: string] }>()
watch(() => session.user?.id, async id => {
  if (id) { await initializeCreation(); await loadChats() }
}, { immediate: true })
</script>

<template>
  <aside class="studio-sidebar" aria-label="创作导航与历史">
    <div class="studio-sidebar-brand">
      <RouterLink to="/discover" class="studio-brand" :aria-label="`${site.brand}首页`"><img v-if="site.logoUrl" :src="site.logoUrl" width="32" height="32" alt="" /><strong>{{ site.brand }}</strong></RouterLink>
      <button class="studio-tool" aria-label="新建创作" title="新建创作" @click="emit('new')"><SquarePen :size="19" /></button>
    </div>
    <nav class="studio-sidebar-links" aria-label="工作台导航">
      <button class="studio-sidebar-create" :class="{ active: !accountTool }" :aria-pressed="!accountTool" @click="emit('kind', kind)"><Sparkles :size="20" /><span>创作</span></button>
      <RouterLink to="/discover"><Compass :size="20" /><span>探索社区</span></RouterLink>
      <RouterLink to="/library"><FolderOpen :size="20" /><span>我的作品</span></RouterLink>
    </nav>
    <section class="studio-sidebar-history" aria-label="会话记录">
      <StudioConversations unified :kind="kind" @select="emit('conversation', $event)" @reuse="emit('reuse', $event)" />
    </section>
    <div class="studio-sidebar-bottom"><button @click="emit('prices')"><CircleDollarSign :size="18" />模型定价</button><div id="studio-sidebar-menu" /></div>
  </aside>
</template>

<style scoped>
.studio-sidebar { position: fixed; inset: 0 auto 0 0; z-index: 40; display: flex; flex-direction: column; width: var(--studio-sidebar-width, 248px); padding: 20px 16px 16px; background: var(--studio-sidebar-surface, var(--surface)); }
.studio-sidebar-brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; margin-bottom: 32px; }
.studio-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }.studio-brand img { flex: none; border-radius: 8px; }.studio-brand strong { font-size: 18px; font-weight: 600; white-space: nowrap; }
.studio-sidebar-links { display: grid; gap: 4px; }
.studio-sidebar-links a, .studio-sidebar-create, .studio-sidebar-bottom > :is(button, a) { display: flex; align-items: center; justify-content: flex-start; gap: 12px; width: 100%; min-height: 44px; padding: 12px; font-size: 14px; text-align: left; color: var(--muted); border: 0; border-radius: 8px; }
.studio-sidebar-links a:hover, .studio-sidebar-create:hover, .studio-sidebar-bottom > :is(button, a):hover { background: var(--surface-soft); color: var(--ink); }
.studio-sidebar-create.active { color: var(--ink); }
.studio-sidebar-history { display: flex; flex-direction: column; flex: 1; min-height: 0; margin-top: 32px; }
.studio-sidebar-bottom { display: grid; gap: 4px; padding-top: 16px; }
#studio-sidebar-menu:empty { display: none; }
#studio-sidebar-menu :deep(> .studio-tool) { justify-content: flex-start; gap: 12px; width: 100%; min-height: 44px; padding: 12px; font-size: 14px; border-radius: 8px; }
@media (max-width: 999px) { .studio-sidebar { display: none; } }
</style>
