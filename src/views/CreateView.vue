<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Image, Video, FileText, ArrowUpRight, Copy, X } from '@lucide/vue'
import { api, errorMessage, loadSession, notify, session } from '../state'
import type { Work } from '../data'
import ContentSkeleton from '../components/ContentSkeleton.vue'
import { studioAnchor, studioSession, type StudioKind } from '../studio-state'
const route = useRoute()
const kind = computed({ get: () => studioSession.kind, set: (value: StudioKind) => { studioSession.kind = value } })
const source = computed(() => studioSession.source)
const anchor = ref<HTMLElement>()
const error = ref('')
let loadId = 0
watch(() => [route.params.kind, route.query.from, route.query.remix, session.user?.id], async () => {
  const current = ++loadId
  await loadSession()
  if (!session.user || current !== loadId) return
  studioSession.enabled = true
  if (route.params.kind === 'image' || route.params.kind === 'video' || route.params.kind === 'text') kind.value = route.params.kind
  const sourceId = typeof route.query.from === 'string' ? route.query.from : typeof route.query.remix === 'string' ? route.query.remix : ''
  studioSession.source = null; error.value = ''
  if (sourceId) {
    try {
      const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(sourceId)}`)
      if (current !== loadId) return
      studioSession.source = result.work
      kind.value = result.work.kind === 'resource' ? 'text' : result.work.kind
    } catch (cause) { if (current === loadId) error.value = errorMessage(cause) }
  }
}, { immediate: true })
watch(anchor, value => { studioAnchor.value = value || null }, { flush: 'post' })
onBeforeUnmount(() => { loadId++; if (studioAnchor.value === anchor.value) studioAnchor.value = null })
async function copyPrompt() {
  try { await navigator.clipboard.writeText(source.value?.prompt || ''); notify('提示词已复制。') }
  catch { notify('复制失败，请选择文字复制。') }
}
</script>

<template>
  <div class="page-container create-page">
    <div class="page-heading"><div><h1>创作</h1></div><div class="workbench-actions"><button v-if="studioSession.enabled" class="icon-button" aria-label="关闭工作台" title="关闭工作台" @click="studioSession.enabled = false"><X :size="18" /></button><RouterLink to="/library" class="button btn subtle">我的作品<ArrowUpRight :size="15" /></RouterLink></div></div>
    <ContentSkeleton v-if="!session.ready" layout="form" label="正在加载账号…" />
    <div v-else-if="!session.user" class="empty-state"><h2>登录后开始创作</h2><RouterLink to="/account" class="button primary btn">登录</RouterLink></div>
    <template v-else><div class="tabs" aria-label="创作类型"><button class="tab" :class="{ active: kind === 'image' }" :aria-pressed="kind === 'image'" @click="kind = 'image'"><Image :size="18" />图片</button><button class="tab" :class="{ active: kind === 'video' }" :aria-pressed="kind === 'video'" @click="kind = 'video'"><Video :size="18" />视频</button><button class="tab" :class="{ active: kind === 'text' }" :aria-pressed="kind === 'text'" @click="kind = 'text'"><FileText :size="18" />文本</button></div><section v-if="source" class="panel-section"><div class="section-heading"><h2>{{ source.title }}</h2><button class="button subtle btn" @click="copyPrompt"><Copy :size="16" />复制提示词</button></div><p class="creation-source-prompt">{{ source.prompt }}</p></section><p v-if="error" class="form-error" role="alert">{{ error }}</p><div v-if="studioSession.enabled" ref="anchor" class="studio-anchor" aria-label="创作工作台区域"></div><div v-else class="empty-state"><button class="button primary btn" @click="studioSession.enabled = true">打开工作台</button></div></template>
  </div>
</template>

<style scoped>
.studio-anchor { height: max(480px, calc(100svh - var(--header-height) - var(--mobile-nav-height) - 184px)); min-height: 480px; }
.workbench-actions { display: flex; align-items: center; gap: 8px; }
.create-page > .tabs { margin-bottom: 20px; }
.studio-anchor { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.create-page > .empty-state { border-block: 1px solid var(--border); min-height: 440px; }
@media (max-width: 639px) {
  .studio-anchor { border-radius: 6px; }
  .create-page > .empty-state { min-height: 360px; }
}
</style>
