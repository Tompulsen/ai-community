<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowUpRight, FileText, Image, Video, Receipt, KeyRound, CircleDollarSign, MoreHorizontal } from '@lucide/vue'
import { api, errorMessage, loadSession, session } from '../state'
import type { Work } from '../data'
import StudioWorkspace from '../components/StudioWorkspace.vue'
import StudioPopover from '../components/StudioPopover.vue'
import '../studio-composer.css'
const StudioChat = defineAsyncComponent(() => import('../components/StudioChat.vue'))
const StudioAccountTools = defineAsyncComponent(() => import('../components/StudioAccountTools.vue'))
import ContentSkeleton from '../components/ContentSkeleton.vue'
import type { StudioKind } from '../studio-state'
const route = useRoute(), router = useRouter()
const source = ref<Work | null>(null), error = ref('')
const accountTool = ref<'' | 'prices' | 'logs' | 'keys'>('')
const accountMenu = ref<InstanceType<typeof StudioPopover>>()
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
function switchKind(value: StudioKind) { accountTool.value = ''; void router.replace({ path: `/create/${value}`, query: route.query }) }
function openAccount(value: 'prices' | 'logs' | 'keys') { accountTool.value = value; accountMenu.value?.close() }
</script>

<template>
  <div class="page-container create-page">
    <header class="studio-page-toolbar"><h1>创作台</h1><div v-if="session.user" class="tabs" aria-label="创作类型"><button class="tab" :class="{ active: kind === 'image' && !accountTool }" :aria-pressed="kind === 'image' && !accountTool" @click="switchKind('image')"><Image :size="16" />图片</button><button class="tab" :class="{ active: kind === 'video' && !accountTool }" :aria-pressed="kind === 'video' && !accountTool" @click="switchKind('video')"><Video :size="16" />视频</button><button class="tab" :class="{ active: kind === 'text' && !accountTool }" :aria-pressed="kind === 'text' && !accountTool" @click="switchKind('text')"><FileText :size="16" />对话</button></div><StudioPopover v-if="session.user" ref="accountMenu" label="创作台菜单" :width="240"><template #trigger><MoreHorizontal :size="20" /></template><button class="studio-command" @click="openAccount('prices')"><CircleDollarSign :size="17" />模型价格</button><button class="studio-command" @click="openAccount('logs')"><Receipt :size="17" />消费记录</button><button class="studio-command" @click="openAccount('keys')"><KeyRound :size="17" />密钥</button><RouterLink to="/library" class="studio-command"><ArrowUpRight :size="17" />我的作品</RouterLink></StudioPopover></header>
    <ContentSkeleton v-if="!session.ready" layout="form" label="正在加载账号…" />
    <div v-else-if="!session.user" class="empty-state"><h2>登录后开始创作</h2><RouterLink :to="{ path: '/account', query: { returnTo: route.fullPath } }" class="button primary btn">登录</RouterLink></div>
    <template v-else><p v-if="source" class="source-label">来自作品：<RouterLink :to="`/work/${source.id}`">{{ source.title }}</RouterLink></p><p v-if="error" class="form-error" role="alert">{{ error }}</p><div v-if="accountTool" class="studio-account-view"><button class="studio-tool" @click="accountTool = ''"><ArrowLeft :size="16" />返回创作</button><StudioAccountTools :view="accountTool" /></div><StudioChat v-else-if="kind === 'text'" /><StudioWorkspace v-else :kind="kind" :source="source" /></template>
  </div>
</template>

<style scoped>
.create-page { display: flex; flex-direction: column; flex: 1; min-height: 0; max-width: none; padding: 8px 24px 16px; }
.studio-page-toolbar { display: flex; align-items: center; gap: 24px; flex: none; min-height: 48px; margin-bottom: 8px; }
.studio-page-toolbar h1 { flex: none; margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; white-space: nowrap; }
.studio-page-toolbar .tabs { margin: 0; gap: 24px; border: 0; }
.studio-page-toolbar .tab { min-height: 44px; padding: 8px 0; }
.studio-page-toolbar > .studio-tool { margin-left: auto; }
.studio-account-view { flex: 1; min-height: 0; overflow-y: auto; padding-block: 16px; }
.create-page > .empty-state { border-block: 1px solid var(--border); min-height: 440px; }
.source-label { margin-block: 0 16px; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
.source-label a { color: var(--ink); }
@media (max-width: 639px) { .create-page { padding: 0 12px 8px; }.studio-page-toolbar { gap: 16px; margin-bottom: 0; }.studio-page-toolbar .tabs { gap: 16px; }.studio-page-toolbar h1 { font-size: 14px; }.create-page > .empty-state { min-height: 360px; } }
@media (max-width: 359px) { .studio-page-toolbar, .studio-page-toolbar .tabs { gap: 12px; } }
</style>
