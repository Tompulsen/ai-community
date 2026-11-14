<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeft, CircleDollarSign, Compass, FileText, FolderOpen, LoaderCircle, MessageSquare, Search, Sparkles, SquarePen, Video } from '@lucide/vue'
import { session } from '../state'
import { site } from '../site'
import { chats, loadChats, saveChats } from '../native-chat'
import { creation, initializeCreation, mediaSource, type CreationTask } from '../native-studio'
import type { StudioKind } from '../studio-state'

const props = defineProps<{ kind: StudioKind; accountTool: string }>()
const emit = defineEmits<{ kind: [value: StudioKind]; new: []; reuse: [task: CreationTask]; prices: []; conversation: [id: string] }>()
const query = ref('')
const tasks = computed(() => creation.tasks.filter(task => task.kind === props.kind && task.owner === session.user?.id && task.prompt.toLowerCase().includes(query.value.toLowerCase())))
const conversations = computed(() => chats.sessions.filter(chat => chat.topic.toLowerCase().includes(query.value.toLowerCase())))
watch(() => session.user?.id, async id => {
  if (id) { await initializeCreation(); await loadChats() }
}, { immediate: true })
function selectConversation(id: string) {
  chats.activeId = id
  void saveChats()
  emit('conversation', id)
}
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
    <section class="studio-sidebar-history" :aria-label="kind === 'text' ? '对话记录' : '创作记录'">
      <h2>{{ kind === 'text' ? '对话记录' : '创作记录' }}</h2>
      <label class="studio-history-search"><Search :size="15" /><input v-model="query" aria-label="搜索创作记录" placeholder="搜索记录" type="search" /></label>
      <div class="studio-sidebar-records">
        <template v-if="kind === 'text'"><button v-for="item in conversations" :key="item.id" class="studio-record" :class="{ active: item.id === chats.activeId }" :title="item.topic" @click="selectConversation(item.id)"><MessageSquare :size="17" /><span>{{ item.topic }}</span><LoaderCircle v-if="chats.busy[item.id]" :size="14" /></button><p v-if="!conversations.length" class="studio-sidebar-empty">{{ query ? '没有匹配的记录' : '暂无对话记录' }}</p></template>
        <template v-else><button v-for="task in tasks" :key="task.id" class="studio-record" :class="{ active: task.id === creation.selectedId }" :title="task.prompt || task.model" @click="emit('reuse', task)"><img v-if="task.kind === 'image' && task.urls[0]" :src="mediaSource(task.urls[0], true)" alt="" loading="lazy" /><Video v-else-if="task.kind === 'video'" :size="17" /><FileText v-else :size="17" /><span>{{ task.prompt || task.model }}</span><LoaderCircle v-if="task.phase === 'running' || task.phase === 'submitting'" :size="14" /></button><p v-if="!tasks.length" class="studio-sidebar-empty">{{ query ? '没有匹配的记录' : '暂无创作记录' }}</p></template>
      </div>
    </section>
    <div class="studio-sidebar-bottom"><button @click="emit('prices')"><CircleDollarSign :size="18" />模型定价</button><div id="studio-sidebar-menu" /><RouterLink to="/discover"><ArrowLeft :size="18" />返回社区</RouterLink></div>
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
.studio-sidebar-history h2 { padding: 0 12px; margin: 0 0 12px; color: var(--muted); font-size: 12px; font-weight: 500; line-height: 20px; }
.studio-history-search { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 12px; color: var(--muted); }
.studio-history-search input { width: 100%; min-width: 0; padding: 8px 0; border: 0; background: transparent; outline: none; font-size: 12px; }.studio-history-search:focus-within { outline: 2px solid var(--blue); border-radius: 6px; }
.studio-sidebar-records { overflow-y: auto; min-height: 0; margin-top: 8px; scrollbar-color: var(--border) transparent; }
.studio-record { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 8px 12px; text-align: left; border-radius: 8px; color: var(--muted); }
.studio-record > img { flex: none; width: 28px; height: 28px; object-fit: cover; border-radius: 4px; }.studio-record > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-record.active, .studio-record:hover { color: var(--ink); background: var(--surface-soft); }
.studio-sidebar-empty { padding: 8px 12px; font-size: 12px; line-height: 20px; color: var(--muted); }
.studio-sidebar-bottom { display: grid; gap: 4px; padding-top: 16px; }
#studio-sidebar-menu:empty { display: none; }
#studio-sidebar-menu :deep(> .studio-tool) { justify-content: flex-start; gap: 12px; width: 100%; min-height: 44px; padding: 12px; font-size: 14px; border-radius: 8px; }
@media (max-width: 999px) { .studio-sidebar { display: none; } }
</style>
