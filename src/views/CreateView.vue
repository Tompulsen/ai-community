<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Images, Receipt, KeyRound, CircleDollarSign, MoreHorizontal, PanelLeft, SquarePen } from '@lucide/vue'
import { api, errorMessage, loadSession, session } from '../state'
import type { Work, WorkFile } from '../data'
import StudioWorkspace from '../components/StudioWorkspace.vue'
import StudioSidebar from '../components/StudioSidebar.vue'
import StudioPopover from '../components/StudioPopover.vue'
import StudioGallery from '../components/StudioGallery.vue'
import StudioSourceReferences from '../components/StudioSourceReferences.vue'
import StudioPublishDialog from '../components/StudioPublishDialog.vue'
import { creation, initializeCreation, loadCreationGroups, loadCreationModels, selectCreationGroup, waitCreationGroup, type CreationTask, type CreationDestination } from '../native-studio'
import { readRemixParameters } from '../../shared/studio/remix-parameters'
import { modelKind } from '../model-preferences'
import '../studio-composer.css'
const StudioChat = defineAsyncComponent(() => import('../components/StudioChat.vue'))
const StudioAccountTools = defineAsyncComponent(() => import('../components/StudioAccountTools.vue'))
import ContentSkeleton from '../components/ContentSkeleton.vue'
import type { StudioKind } from '../studio-state'
const route = useRoute(), router = useRouter()
const source = ref<Work | null>(null), error = ref('')
const sourceLoading = ref(false), sourceIssue = ref(''), sourceRetry = ref(0)
const sourceBlocked = computed(() => sourceLoading.value || Boolean(sourceIssue.value))
const accountTool = ref<'' | 'prices' | 'logs' | 'keys'>('')
const accountMenu = ref<InstanceType<typeof StudioPopover>>()
const sidebarMedia = window.matchMedia('(min-width: 1000px)')
const menuInSidebar = ref(sidebarMedia.matches)
function moveMenu() { accountMenu.value?.close(); menuInSidebar.value = sidebarMedia.matches }
onMounted(() => sidebarMedia.addEventListener('change', moveMenu))
onBeforeUnmount(() => { revision++; sidebarMedia.removeEventListener('change', moveMenu) })
const navigationMenu = ref<InstanceType<typeof StudioPopover>>(), mobileGallery = ref<InstanceType<typeof StudioPopover>>()
const mobileLibraryLoaded = ref(false), pendingNew = ref(false)
const workspace = ref<InstanceType<typeof StudioWorkspace>>(), chat = ref<InstanceType<typeof StudioChat>>()
const publisher = ref<InstanceType<typeof StudioPublishDialog>>()
const kind = computed<StudioKind>(() => route.params.kind === 'video' || route.params.kind === 'text' ? route.params.kind : 'image')
let revision = 0
watch(() => [route.params.kind, route.query.from, route.query.remix, session.user?.id, sourceRetry.value], async () => {
  const current = ++revision
  const sourceId = typeof route.query.from === 'string' ? route.query.from : typeof route.query.remix === 'string' ? route.query.remix : ''
  sourceLoading.value = Boolean(sourceId); sourceIssue.value = ''
  await loadSession()
  if (!session.user || current !== revision) return
  source.value = null; error.value = ''
  if (sourceId) {
    let next: Work | null = null
    try {
      const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(sourceId)}`)
      if (current !== revision) return
      next = result.work
      const parameters = readRemixParameters(next.generation?.parameters)
      if (next.generation?.parameters !== undefined && (!parameters || parameters.kind !== (next.kind === 'resource' ? 'text' : next.kind))) throw new Error('原作生成参数无效，请使用当前配置。')
      await initializeCreation(); await waitCreationGroup()
      if (current !== revision) return
      await loadCreationGroups()
      if (current !== revision) return
      if (creation.groupsError) throw new Error(creation.groupsError)
      if (parameters?.group && creation.selectedGroup !== parameters.group) {
        if (!creation.groups.some(group => group.id === parameters.group)) throw new Error(`当前账号无法使用原作分组“${parameters.group}”，请选择可用配置。`)
        await selectCreationGroup(parameters.group)
        if (current !== revision) return
        if (creation.groupsError || creation.selectedGroup !== parameters.group) throw new Error(creation.groupsError || '未能恢复原作分组，请确认当前配置。')
      } else await loadCreationModels()
      if (current !== revision) return
      if (creation.modelsError) throw new Error(creation.modelsError)
      const originalModel = creation.models.find(model => model.id === next!.model)
      if (next.model && (!originalModel || modelKind(originalModel) !== (next.kind === 'resource' ? 'text' : next.kind))) throw new Error(`原作模型“${next.model}”在当前分组不可用，请选择替代模型。`)
    } catch (cause) { if (current === revision) sourceIssue.value = errorMessage(cause) }
    finally { if (current === revision) { source.value = next; sourceLoading.value = false } }
  }
}, { immediate: true })
function switchKind(value: StudioKind) { navigationMenu.value?.close(); accountTool.value = ''; void router.replace({ path: `/create/${value}`, query: route.query }) }
function openAccount(value: 'prices' | 'logs' | 'keys') { accountTool.value = value; accountMenu.value?.close() }
function newCreation() { accountTool.value = ''; pendingNew.value = true }
function syncSource(id?: string) {
  if (id && (route.query.remix === id || route.query.from === id)) return
  source.value = null
  void router.replace({ query: id ? { remix: id } : {} })
}
watch([workspace, () => chat.value?.ready], () => {
  if (!route.query.remix && !route.query.from && !route.query.reuse) syncSource(kind.value === 'text' ? chat.value?.sourceWorkId : workspace.value?.sourceWorkId)
}, { flush: 'post' })
function selectReferences(files: WorkFile[]) { if (kind.value === 'text') void chat.value?.applySourceReferences(files); else workspace.value?.applySourceReferences(files) }
function share(task: CreationTask, destination: CreationDestination) { mobileGallery.value?.close(); void publisher.value?.open(task, destination) }
function reuse(task: CreationTask) {
  mobileGallery.value?.close(); accountTool.value = ''
  void router.replace({ path: `/create/${task.kind}`, query: { reuse: task.id } })
}
function openConversation() { accountTool.value = ''; if (kind.value !== 'text') switchKind('text') }
watch([() => route.query.reuse, workspace, chat, () => chat.value?.ready, () => creation.loaded, pendingNew], () => {
  if (!creation.loaded || (kind.value === 'text' ? !chat.value?.ready : !workspace.value)) return
  if (pendingNew.value) {
    pendingNew.value = false
    if (kind.value === 'text') chat.value!.createChat()
    else workspace.value!.newCreation()
  } else if (typeof route.query.reuse === 'string') {
    const task = creation.tasks.find(task => task.id === route.query.reuse && task.owner === session.user?.id && task.kind === kind.value)
    if (task) {
      if (kind.value === 'text') chat.value!.useTask(task)
      else workspace.value!.useTask(task)
    } else error.value = '未找到这条生成记录，请从作品库重新选择。'
    void router.replace({ query: task?.sourceWorkId ? { remix: task.sourceWorkId } : {} })
  }
}, { flush: 'post' })
</script>

<template>
  <div class="page-container create-page">
    <StudioSidebar v-if="session.user" :kind="kind" :account-tool="accountTool" @kind="switchKind" @new="newCreation" @reuse="reuse" @prices="openAccount('prices')" @conversation="openConversation" />
    <header class="studio-page-toolbar">
      <h1>{{ accountTool ? '账户工具' : kind === 'text' ? '对话' : '今天' }}</h1>
      <div v-if="session.user" class="mobile-studio-navigation"><StudioPopover ref="navigationMenu" label="创作导航" :width="280"><template #trigger><PanelLeft :size="19" /></template><p class="navigation-current">当前：{{ kind === 'image' ? '图片生成' : kind === 'video' ? '视频生成' : '对话' }}</p><RouterLink to="/discover" class="studio-command" @click="navigationMenu?.close()"><ArrowLeft :size="17" />返回社区</RouterLink></StudioPopover></div>
      <div v-if="session.user" class="mobile-studio-destinations"><StudioPopover ref="mobileGallery" label="作品库" :width="880" @toggle="mobileLibraryLoaded ||= $event"><template #trigger><Images :size="18" /><span>作品库</span></template><StudioGallery v-if="mobileLibraryLoaded" embedded @reuse="reuse" @publish="share" /></StudioPopover><button class="studio-tool" @click="openAccount('prices')"><CircleDollarSign :size="18" /><span>模型定价</span></button><button class="studio-tool mobile-new-creation" title="新建创作" aria-label="新建创作" @click="newCreation"><SquarePen :size="19" /></button></div>
      <Teleport v-if="session.user" defer to="#studio-sidebar-menu" :disabled="!menuInSidebar"><StudioPopover ref="accountMenu" label="创作台菜单" :width="260"><template #trigger><MoreHorizontal :size="20" /><span v-if="menuInSidebar">更多</span></template><button class="studio-command" @click="openAccount('prices')"><CircleDollarSign :size="17" />模型价格</button><button class="studio-command" @click="openAccount('logs')"><Receipt :size="17" />消费记录</button><button class="studio-command" @click="openAccount('keys')"><KeyRound :size="17" />密钥</button></StudioPopover></Teleport>
    </header>
    <ContentSkeleton v-if="!session.ready" layout="form" label="正在加载账号…" />
    <div v-else-if="!session.user" class="empty-state"><h2>登录后开始创作</h2><RouterLink :to="{ path: '/account', query: { returnTo: route.fullPath } }" class="button primary btn">登录</RouterLink></div>
    <template v-else><div v-if="source" class="source-label"><RouterLink :to="`/work/${source.id}`" :title="source.title">同款 · {{ source.title }}</RouterLink><StudioSourceReferences :source="source" :selected="(kind === 'text' ? chat?.referenceUrls : workspace?.referenceUrls) || []" :disabled="kind === 'text' ? !chat?.ready || chat?.uploading : !workspace || workspace?.uploading" @select="selectReferences" /></div><p v-if="error" class="form-error" role="alert">{{ error }}</p><div v-if="accountTool" class="studio-account-view"><button class="studio-tool" @click="accountTool = ''"><ArrowLeft :size="16" />返回创作</button><StudioAccountTools :view="accountTool" /></div>
      <p v-if="sourceLoading" role="status">正在恢复原作配置…</p>
      <p v-if="sourceIssue" class="form-error" role="alert">{{ sourceIssue }} <button v-if="source" type="button" class="text-link" @click="sourceIssue = ''">使用当前配置</button><button type="button" class="text-link" @click="sourceRetry++">重新读取原作</button></p>
      <StudioChat v-if="kind === 'text'" v-show="!accountTool" ref="chat" :source="source" :source-blocked="sourceBlocked" @prices="openAccount('prices')" @keys="openAccount('keys')" @publish="share" @source="syncSource" />
      <StudioWorkspace v-else v-show="!accountTool" ref="workspace" :kind="kind" :source="source" :source-blocked="sourceBlocked" @prices="openAccount('prices')" @keys="openAccount('keys')" @publish="share" @source="syncSource" />
    </template><StudioPublishDialog ref="publisher" />
  </div>
</template>

<style scoped>
.create-page { display: flex; flex-direction: column; flex: 1; min-height: 0; max-width: none; padding: 8px 24px 16px; }
.studio-page-toolbar { display: flex; align-items: center; gap: 24px; flex: none; min-height: 48px; margin-bottom: 8px; }
.studio-page-toolbar h1 { flex: none; margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; white-space: nowrap; }
.studio-page-toolbar > .studio-tool { margin-left: auto; }
.studio-account-view { flex: 1; min-height: 0; overflow-y: auto; padding-block: 16px; }
.create-page > .empty-state { border-block: 1px solid var(--border); min-height: 440px; }
.source-label { display: flex; align-items: center; justify-content: space-between; flex: none; gap: 8px; margin-block: 0 8px; color: var(--muted); font-size: 13px; }
.source-label > a { color: var(--ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-studio-navigation, .mobile-studio-destinations { display: none; }
.navigation-current { font-size: 14px; color: var(--muted); margin: 0 8px 12px; }
@media (min-width: 1000px) {
  .create-page { padding: 8px 40px 24px; --studio-content-width: 1760px; }
  .studio-page-toolbar { width: min(100%, var(--studio-content-width)); margin-inline: auto; min-height: 56px; margin-bottom: 16px; }
  .studio-page-toolbar h1 { font-size: 24px; line-height: 32px; }
  .source-label, .studio-account-view { width: min(100%, var(--studio-content-width)); margin-inline: auto; }
}
@media (max-width: 639px) { .create-page { padding: 0 12px 8px; }.studio-page-toolbar { gap: 16px; margin-bottom: 0; }.studio-page-toolbar h1 { font-size: 14px; }.create-page > .empty-state { min-height: 360px; } }
@media (max-width: 359px) { .studio-page-toolbar { gap: 12px; } }
@media (max-width: 639px) {
  .studio-page-toolbar { gap: 0; min-height: 52px; border-bottom: 1px solid var(--border); margin-bottom: 8px; padding-block: 4px; }
  .studio-page-toolbar h1 { display: none; }
  .mobile-studio-navigation, .mobile-studio-destinations { display: flex; align-items: center; gap: 0; }
  .mobile-studio-destinations { flex: 1; justify-content: space-around; min-width: 0; }
  .mobile-studio-destinations > .studio-tool { padding-inline: 4px; font-size: 13px; }
  .studio-page-toolbar > .studio-tool { margin-left: 0; }
}
</style>
