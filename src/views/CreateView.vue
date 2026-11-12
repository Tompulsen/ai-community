<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpRight, FileText, Image, Video } from '@lucide/vue'
import { api, errorMessage, loadSession, session } from '../state'
import type { Work } from '../data'
import StudioWorkspace from '../components/StudioWorkspace.vue'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import type { StudioKind } from '../studio-state'
const route = useRoute(), router = useRouter()
const source = ref<Work | null>(null), error = ref('')
const kind = computed<StudioKind>(() => route.params.kind === 'video' || route.params.kind === 'text' ? route.params.kind : 'image')
let revision = 0
watch(() => [route.params.kind, route.query.from, route.query.remix, session.user?.id], async () => {
  const current = ++revision
  await loadSession()
  if (!session.user || current !== revision) return
  const sourceId = typeof route.query.from === 'string' ? route.query.from : typeof route.query.remix === 'string' ? route.query.remix : ''
  source.value = null; error.value = ''
  if (sourceId) {
    try {
      const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(sourceId)}`)
      if (current === revision) source.value = result.work
    } catch (cause) { if (current === revision) error.value = errorMessage(cause) }
  }
}, { immediate: true })
function switchKind(value: StudioKind) { void router.replace({ path: `/create/${value}`, query: route.query }) }
</script>

<template>
  <div class="page-container create-page">
    <div class="page-heading"><h1>创作台</h1><RouterLink to="/library" class="button btn subtle">我的作品<ArrowUpRight :size="15" /></RouterLink></div>
    <ContentSkeleton v-if="!session.ready" layout="form" label="正在加载账号…" />
    <div v-else-if="!session.user" class="empty-state"><h2>登录后开始创作</h2><RouterLink :to="{ path: '/account', query: { returnTo: route.fullPath } }" class="button primary btn">登录</RouterLink></div>
    <template v-else><div class="tabs" aria-label="创作类型"><button class="tab" :class="{ active: kind === 'image' }" :aria-pressed="kind === 'image'" @click="switchKind('image')"><Image :size="18" />图片</button><button class="tab" :class="{ active: kind === 'video' }" :aria-pressed="kind === 'video'" @click="switchKind('video')"><Video :size="18" />视频</button><button class="tab" :class="{ active: kind === 'text' }" :aria-pressed="kind === 'text'" @click="switchKind('text')"><FileText :size="18" />文本</button></div><p v-if="source" class="source-label">来自作品：<RouterLink :to="`/work/${source.id}`">{{ source.title }}</RouterLink></p><p v-if="error" class="form-error" role="alert">{{ error }}</p><StudioWorkspace :kind="kind" :source="source" /></template>
  </div>
</template>

<style scoped>
.create-page > .tabs { margin-bottom: 24px; }
.create-page > .empty-state { border-block: 1px solid var(--border); min-height: 440px; }
.source-label { margin-block: 0 16px; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
.source-label a { color: var(--ink); }
@media (max-width: 639px) { .create-page > .empty-state { min-height: 360px; } }
</style>
