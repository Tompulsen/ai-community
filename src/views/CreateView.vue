<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Copy, Eraser, Images, ListChecks, Menu, MoreVertical, Receipt, KeyRound, CircleDollarSign, Settings, SquarePen, Trash2, Undo2 } from '@lucide/vue'
import { api, errorMessage, session, sessionStatus } from '../state'
import { chats, chatDeletion, loadChats, newChat, saveChats, undoRemovedChats } from '../native-chat'
import { armStudioEntryStart, claimStudioEntryStart, clearStudioEntry, readStudioEntry } from '../studio-entry'
import { modelChoices, modelsForKind } from '../model-preferences'
import { activateConversation, conversationKind, syncMediaConversations } from '../studio-conversations'
import type { Work, WorkFile } from '../data'
import StudioWorkspace from '../components/StudioWorkspace.vue'
import StudioSidebar from '../components/StudioSidebar.vue'
import StudioConversationTitle from '../components/StudioConversationTitle.vue'
import StudioPopover from '../components/StudioPopover.vue'
import StudioSubmitPreference from '../components/StudioSubmitPreference.vue'
import StudioLibraryDialog from '../components/StudioLibraryDialog.vue'
import StudioSourceReferences from '../components/StudioSourceReferences.vue'
import StudioPublishDialog from '../components/StudioPublishDialog.vue'
import { creation, initializeCreation, selectCreationGroup, waitCreationGroup, type CreationTask, type CreationDestination } from '../native-studio'
import { restoreRemixModels } from '../studio-remix-models'
import StudioRemixDialog from '../components/StudioRemixDialog.vue'
import type { StudioFile } from '../use-studio-materials'
import '../studio-composer.css'
const StudioChat = defineAsyncComponent(() => import('../components/StudioChat.vue'))
const StudioAccountTools = defineAsyncComponent(() => import('../components/StudioAccountTools.vue'))
import type { StudioKind } from '../studio-state'
const route = useRoute(), router = useRouter()
const source = ref<Work | null>(null), error = ref('')
const sourceLoading = ref(false), sourceIssue = ref(''), sourceRetry = ref(0), sourceCanFallback = ref(false)
let sourceOwner: string | undefined
const preparingRemix = computed(() => route.query.prepare === '1')
const importingRemix = ref(false)
let previousRemixGroup: string | null | undefined
const sourceBlocked = computed(() => sourceLoading.value || Boolean(sourceIssue.value) || preparingRemix.value || importingRemix.value)
const accountTool = ref<'' | 'prices' | 'logs' | 'keys'>('')
const accountMenu = ref<InstanceType<typeof StudioPopover>>()
const sidebarMedia = window.matchMedia('(min-width: 1000px)')
const menuInSidebar = ref(sidebarMedia.matches)
function moveMenu() { accountMenu.value?.close(); menuInSidebar.value = sidebarMedia.matches }
onMounted(() => sidebarMedia.addEventListener('change', moveMenu))
let entryLive = true
onBeforeUnmount(() => { entryLive = false; revision++; sidebarMedia.removeEventListener('change', moveMenu) })
const sidebar = ref<InstanceType<typeof StudioSidebar>>(), mobileGallery = ref<InstanceType<typeof StudioLibraryDialog>>()
const pendingNew = ref(false)
type MediaAction = 'editTask' | 'regenerate' | 'useTask' | 'chooseReference'
const workspace = ref<InstanceType<typeof StudioWorkspace>>(), chat = ref<InstanceType<typeof StudioChat>>()
const remixReady = computed(() => !sourceLoading.value && !creation.groupsLoading && !creation.groupSwitching && !creation.modelsLoading && !!chat.value?.ready && (kind.value === 'text' || !!workspace.value))
const publisher = ref<InstanceType<typeof StudioPublishDialog>>()
const kind = computed<StudioKind>(() => route.params.kind === 'video' || route.params.kind === 'text' ? route.params.kind : 'image')
const currentConversation = computed(() => chats.sessions.find(item => item.id === chats.activeId))
const mobileModel = computed(() => (kind.value === 'text' ? chat.value?.model : workspace.value?.model) || '')
const accountHeading = computed(() => ({ prices: '模型广场', logs: '消费记录', keys: '密钥' })[accountTool.value || 'prices'])
async function openSettings() { sidebar.value?.close(); await nextTick(); accountMenu.value?.open() }
watch(() => session.user?.id, async id => {
  if (!id) return
  await initializeCreation(); await loadChats()
  if (session.user?.id === id) await syncMediaConversations()
}, { immediate: true })
watch(() => [chats.ready, creation.loaded, creation.tasks.filter(task => task.kind !== 'text').map(task => [task.id, task.conversationId, task.phase, task.prompt])], () => {
  void syncMediaConversations().catch(cause => { error.value = errorMessage(cause) })
}, { deep: true })
watch([kind, () => chats.ready, () => creation.loaded], async () => {
  if (!chats.ready || !creation.loaded) return
  const requestedKind = kind.value, owner = session.user?.id
  await syncMediaConversations()
  if (kind.value !== requestedKind || owner !== session.user?.id || route.query.reuse || route.query.entry) return
  const active = chats.sessions.find(chat => chat.id === chats.activeId)
  const preferred = active || chats.sessions[0] || newChat(requestedKind)
  preferred.composerKind = requestedKind
  activateConversation(preferred.id)
}, { immediate: true })
watch([() => route.query.conversation, workspace, () => chats.ready, () => creation.loaded], async () => {
  const id = route.query.conversation, entryStart = route.query.start === '1'
  if (typeof id !== 'string' || !chats.ready || !creation.loaded) return
  const selected = chats.sessions.find(chat => chat.id === id)
  if (!selected) return
  activateConversation(id)
  await nextTick()
  if (chats.activeId === id && !entryStart) workspace.value?.openConversation()
}, { flush: 'post' })
let revision = 0
watch([() => route.query.from, () => route.query.remix, () => session.user?.id, sourceRetry], async () => {
  const current = ++revision
  const sourceId = typeof route.query.from === 'string' ? route.query.from : typeof route.query.remix === 'string' ? route.query.remix : ''
  sourceLoading.value = Boolean(sourceId); sourceIssue.value = ''; sourceCanFallback.value = false
  const previousSource = preparingRemix.value && source.value?.id === sourceId && sourceOwner === session.user?.id ? source.value : null
  if (sourceOwner !== session.user?.id) previousRemixGroup = undefined
  source.value = previousSource; error.value = ''
  if (!session.user || current !== revision) return
  if (sourceId) {
    let next: Work | null = null
    try {
      const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(sourceId)}`, { signal: AbortSignal.timeout(20000) })
      if (current !== revision) return
      next = { ...result.work, prompt: result.work.generation?.prompt ?? (result.work.prompt || result.work.body || ''), model: result.work.generation?.model || result.work.model }
      sourceOwner = session.user.id; sourceCanFallback.value = true
      await initializeCreation(); await loadChats(); await waitCreationGroup()
      if (current !== revision) return
      const conversation = typeof route.query.conversation === 'string' ? chats.sessions.find(item => item.id === route.query.conversation) : currentConversation.value
      // A saved conversation owns its model and draft; the source is only a reference now.
      if (!preparingRemix.value && conversation?.sourceWorkId === sourceId && (conversation.messages.length || kind.value === 'text' || conversation.mediaDrafts?.[kind.value])) return
      await restoreRemixModels(next, () => current === revision, group => {
        if (preparingRemix.value && previousRemixGroup === undefined) previousRemixGroup = group
      })
    } catch (cause) { if (current === revision) sourceIssue.value = errorMessage(cause) }
    finally { if (current === revision) { source.value = next || previousSource; sourceLoading.value = false } }
  }
}, { immediate: true })
async function importRemix(files: StudioFile[], background = false) {
  if (!source.value || !remixReady.value || sourceIssue.value || importingRemix.value || !preparingRemix.value) return
  const current = revision, owner = session.user?.id, original = source.value
  importingRemix.value = true
  try {
    const applied = kind.value === 'text' ? chat.value?.applyRemix(original, files) : await workspace.value?.applyRemix(original, files, true)
    if (current !== revision || owner !== session.user?.id) return
    if (!applied) { sourceIssue.value = '工作台尚未就绪，请稍后重试。'; return }
    const { prepare: _, ...query } = route.query
    await router.replace({ query })
    if (background && kind.value !== 'text') {
      importingRemix.value = false
      await nextTick()
      if (current !== revision || owner !== session.user?.id || !workspace.value) return
      if (original.model && workspace.value.model !== original.model) { error.value = '原作模型未能恢复，请确认工作台模型后再生成。'; return }
      await workspace.value.generateBackground(() => {
        if (owner === session.user?.id && current === revision) void router.replace('/work/' + original.id).catch(cause => { error.value = errorMessage(cause) })
      })
    }
  } finally { importingRemix.value = false }
}
function sourceFallback() {
  if (source.value?.generation) source.value = { ...source.value, generation: { ...source.value.generation, parameters: undefined } }
  sourceIssue.value = ''
}
async function cancelRemix() {
  if (importingRemix.value) return
  const id = source.value?.id || route.query.remix, owner = session.user?.id
  if (typeof id !== 'string') return
  ++revision; importingRemix.value = true; source.value = null
  try {
    await waitCreationGroup()
    if (owner !== session.user?.id) return
    if (previousRemixGroup && previousRemixGroup !== creation.selectedGroup) await selectCreationGroup(previousRemixGroup)
    if (owner === session.user?.id) await router.replace('/work/' + id)
  } finally { importingRemix.value = false }
}
function switchKind(value: StudioKind) { sidebar.value?.close(); accountTool.value = ''; void router.replace({ path: `/create/${value}`, query: route.query }) }
function openAccount(value: 'prices' | 'logs' | 'keys') { accountTool.value = value; accountMenu.value?.close() }
function newCreation() { sidebar.value?.close(); accountMenu.value?.close(); accountTool.value = ''; pendingNew.value = true }
function clearContext() {
  accountMenu.value?.close()
  if (kind.value === 'text') void chat.value?.clearContext()
  else void workspace.value?.clearContext()
}
function syncSource(id?: string) {
  if (route.query.entry || route.query.start) return
  if (id && (route.query.remix === id || route.query.from === id)) return
  source.value = null
  void router.replace({ query: id ? { remix: id } : {} })
}
watch([workspace, () => chat.value?.ready], () => {
  const active = chats.sessions.find(item => item.id === chats.activeId)
  if (!active || (kind.value === 'text' ? !chat.value?.ready : !workspace.value)) return
  if (!route.query.remix && !route.query.from && !route.query.reuse) syncSource(kind.value === 'text' ? chat.value?.sourceWorkId : workspace.value?.sourceWorkId)
}, { flush: 'post' })
function selectReferences(files: WorkFile[]) { if (kind.value === 'text') void chat.value?.applySourceReferences(files); else workspace.value?.applySourceReferences(files) }
function share(task: CreationTask, destination: CreationDestination, content?: string) { mobileGallery.value?.close(); void publisher.value?.open(task, destination, content) }
function reuse(task: CreationTask) {
  mobileGallery.value?.close(); accountTool.value = ''
  void router.replace({ path: `/create/${task.kind}`, query: { reuse: task.id } })
}
function createImage() { mobileGallery.value?.close(); switchKind('image'); pendingNew.value = true }
function openConversation(id: string) {
  const selected = activateConversation(id)
  if (!selected) return
  const mode = selected.composerKind || conversationKind(selected)
  accountTool.value = ''
  void router.replace({ path: `/create/${mode}`, query: { ...(mode === 'text' ? {} : { conversation: id }), ...(selected.sourceWorkId ? { remix: selected.sourceWorkId } : {}) } })
}
async function mediaAction(action: MediaAction, task: CreationTask, index = 0) {
  if (task.kind === 'text' || task.owner !== session.user?.id) return
  const owner = session.user?.id, activeId = chats.activeId
  await router.replace({ path: `/create/${task.kind}`, query: route.query })
  await nextTick()
  if (owner !== session.user?.id || activeId !== chats.activeId || kind.value !== task.kind || !workspace.value) return
  if (action === 'chooseReference') workspace.value.chooseReference(task, index)
  else await workspace.value[action](task)
}
async function undoConversation() {
  const owner = session.user?.id, activeId = chats.activeId
  try { await undoRemovedChats(); if (owner === session.user?.id && chats.activeId !== activeId) openConversation(chats.activeId) }
  catch (cause) { if (owner === session.user?.id) error.value = errorMessage(cause) }
}
watch([() => route.query.reuse, workspace, chat, () => creation.loaded, () => chats.ready, pendingNew], async () => {
  if (!creation.loaded || !chats.ready || (kind.value === 'text' ? !chat.value : !workspace.value)) return
  if (pendingNew.value) {
    pendingNew.value = false
    if (kind.value === 'text') chat.value!.createChat()
    else workspace.value!.newCreation()
  } else if (typeof route.query.reuse === 'string') {
    const reuseId = route.query.reuse, owner = session.user?.id
    const task = creation.tasks.find(task => task.id === reuseId && task.owner === owner && task.kind === kind.value)
    let restored = false
    if (task) {
      restored = kind.value === 'text' ? await chat.value!.useTask(task) : await workspace.value!.useTask(task)
    } else error.value = '未找到这条生成记录，请从作品库重新选择。'
    if (owner === session.user?.id && route.query.reuse === reuseId) {
      const { reuse: _, ...query } = route.query
      void router.replace({ query: restored ? task?.sourceWorkId ? { remix: task.sourceWorkId } : {} : query })
    }
  }
}, { flush: 'post' })
let entryGroupAttempt = ''
watch([() => route.query.entry, () => session.user?.id, () => chats.ready, () => creation.loaded, () => creation.modelsLoaded, () => creation.groupsLoading, () => creation.groupSwitching, () => creation.modelsLoading, kind], async (_, __, onCleanup) => {
  const id = route.query.entry, owner = session.user?.id
  if (typeof id !== 'string' || !owner || !chats.ready || !creation.loaded || !creation.modelsLoaded || creation.groupsLoading || creation.groupSwitching || creation.modelsLoading) return
  let cancelled = false
  onCleanup(() => { cancelled = true })
  try {
    const entry = readStudioEntry(id)
    if (entry.owner && entry.owner !== owner) throw new Error('账号已切换，请返回首页重新提交创作。')
    if (entry.kind !== kind.value) throw new Error('创作类型已改变，请返回首页重新提交。')
    const parameters = entry.parameters
    if (parameters?.group && parameters.group !== creation.selectedGroup) {
      if (!creation.groups.some(group => group.id === parameters.group)) throw new Error('首页所选模型分组当前不可用，请返回首页重新选择。')
      if (entryGroupAttempt === id) throw new Error(creation.groupsError || '无法恢复首页所选模型分组，请返回首页重试。')
      entryGroupAttempt = id
      await selectCreationGroup(parameters.group)
      return
    }
    if (parameters?.tokenId && parameters.tokenId !== creation.modelTokenId) throw new Error('模型密钥已改变，请返回首页确认模型后重新发送。')
    if (parameters?.model && !modelsForKind(entry.kind).some(model => model.id === parameters.model)) throw new Error('首页所选模型当前不可用，请返回首页重新选择。')
    if (parameters?.model) modelChoices[entry.kind] = ''
    const next = newChat(entry.kind)
    if (entry.kind === 'text') {
      const { model, settings, system, skillIds, search, compressionThreshold, sendMemory, toolContext, files } = entry.parameters
      Object.assign(next, { textModel: model, settings, formatOverride: settings.format, system, skillIds, search, compressionThreshold, sendMemory, toolContext, draft: entry.prompt, draftFiles: files })
    } else next.mediaDrafts = { [entry.kind]: { ...entry.parameters, prompt: entry.prompt, references: entry.references } }
    await saveChats(true)
    if (cancelled || !entryLive || owner !== session.user?.id || route.query.entry !== id || kind.value !== entry.kind) return
    armStudioEntryStart(next.id, owner)
    clearStudioEntry(id)
    await router.replace({ query: { conversation: next.id, start: '1' } })
  } catch (cause) { if (!cancelled && entryLive && owner === session.user?.id) error.value = errorMessage(cause) }
}, { immediate: true, flush: 'post' })
const entryReady = computed(() => kind.value === 'text' ? chat.value?.canSend : workspace.value?.canGenerate && !workspace.value.restoringParameters)
watch([() => route.query.start, () => route.query.conversation, workspace, chat, entryReady, () => chats.activeId, () => chats.ready, () => creation.loaded, () => creation.modelsLoaded, () => creation.modelsLoading, () => creation.groupSwitching, () => creation.groupsLoading], async () => {
  const id = route.query.conversation, owner = session.user?.id
  if (route.query.start !== '1' || typeof id !== 'string' || id !== chats.activeId || !owner || !chats.ready || !creation.loaded || !entryReady.value || !creation.modelsLoaded || creation.modelsLoading || creation.groupsLoading || creation.groupSwitching) return
  const target = kind.value === 'text' ? chat.value : workspace.value, requestedKind = kind.value
  await nextTick()
  if (!entryLive || kind.value !== requestedKind || owner !== session.user?.id || chats.activeId !== id || route.query.conversation !== id || route.query.start !== '1' || (kind.value === 'text' ? chat.value : workspace.value) !== target || !entryReady.value || !claimStudioEntryStart(id, owner)) return
  const pending = requestedKind === 'text' ? chat.value!.send() : workspace.value!.generateBackground(() => {})
  const { start: _, ...query } = route.query
  await router.replace({ query })
  await pending
}, { flush: 'post' })
</script>

<template>
  <div class="page-container create-page">
    <div v-if="sessionStatus !== 'guest'" :inert="!session.user || undefined"><StudioSidebar ref="sidebar" :kind="kind" :account-tool="accountTool" @kind="switchKind" @new="newCreation" @reuse="reuse" @prices="openAccount('prices')" @library="mobileGallery?.open()" @conversation="openConversation" @settings="openSettings" /></div>
    <header class="studio-page-toolbar" :class="{ 'studio-content-toolbar': !accountTool || accountTool === 'prices' }">
      <h1 v-if="accountTool && accountTool !== 'prices'">账户工具</h1>
      <button v-if="session.user" class="studio-tool mobile-studio-navigation" type="button" aria-label="打开侧边栏" title="打开侧边栏" aria-controls="studio-sidebar-drawer" :aria-expanded="sidebar?.visible || false" @click="sidebar?.open()"><Menu :size="23" /></button>
      <div class="studio-mobile-title">
        <strong v-if="accountTool">{{ accountHeading }}</strong>
        <StudioConversationTitle v-else-if="currentConversation" :conversation="currentConversation" />
        <strong v-else>章鱼工作台</strong>
        <span v-if="!accountTool" class="studio-mobile-model" :title="mobileModel">{{ kind === 'image' ? '图片生成' : kind === 'video' ? '视频生成' : '对话' }}<template v-if="mobileModel"> / {{ mobileModel }}</template></span>
      </div>
      <button v-if="session.user" class="studio-tool mobile-new-creation" type="button" title="新建创作" aria-label="新建创作" @click="newCreation"><SquarePen :size="22" /></button>
      <Teleport v-if="session.user" defer to="#studio-sidebar-menu" :disabled="!menuInSidebar">
        <StudioLibraryDialog ref="mobileGallery" @reuse="reuse" @publish="share" @create="createImage" />
        <StudioPopover ref="accountMenu" label="创作台菜单" :trigger-label="menuInSidebar ? '创作台菜单：设置' : undefined" :width="300">
          <template #trigger><Settings v-if="menuInSidebar" :size="20" /><MoreVertical v-else :size="22" /><span v-if="menuInSidebar">设置</span></template>
          <template v-if="!menuInSidebar"><button v-if="accountTool" class="studio-command" @click="accountTool = ''; accountMenu?.close()"><ArrowLeft :size="17" />返回创作</button><button class="studio-command" @click="accountMenu?.close(); mobileGallery?.open()"><Images :size="17" />作品库</button></template>
          <button class="studio-command" @click="openAccount('prices')"><CircleDollarSign :size="17" />模型价格</button>
          <button class="studio-command" @click="openAccount('logs')"><Receipt :size="17" />消费记录</button>
          <button class="studio-command" @click="openAccount('keys')"><KeyRound :size="17" />密钥</button>
          <StudioSubmitPreference />
          <template v-if="!menuInSidebar && !accountTool && currentConversation"><button class="studio-command" :disabled="chat?.busy" @click="clearContext"><Eraser :size="17" />清除上下文</button><button class="studio-command" :disabled="chat?.busy" @click="accountMenu?.close(); chat?.duplicate()"><Copy :size="17" />复制对话</button><button v-if="chat?.hasMedia" class="studio-command" @click="accountMenu?.close(); chat?.toggleSelection()"><ListChecks :size="17" />多选消息</button><button class="studio-command danger" :disabled="chat?.busy" @click="accountMenu?.close(); chat?.remove()"><Trash2 :size="17" />删除对话</button></template>
        </StudioPopover>
      </Teleport>
    </header>
    <div v-if="chatDeletion.count" class="mobile-conversation-undo" role="status"><span>已删除 {{ chatDeletion.count }} 个对话</span><button type="button" class="studio-tool" @click="undoConversation"><Undo2 :size="15" />撤销删除</button></div>
    <div v-if="sessionStatus === 'guest'" class="empty-state"><h2>登录后开始创作</h2><RouterLink :to="{ path: '/account', query: { returnTo: route.fullPath } }" class="button primary btn">登录</RouterLink><RouterLink to="/discover" class="text-link"><ArrowLeft :size="16" />返回社区</RouterLink></div>
    <template v-else><div v-if="source && !preparingRemix" class="source-label"><RouterLink :to="`/work/${source.id}`" :title="source.title">同款 · {{ source.title }}</RouterLink><StudioSourceReferences :source="source" :selected="(kind === 'text' ? chat?.referenceUrls : workspace?.referenceUrls) || []" :disabled="kind === 'text' ? !chat?.ready || chat?.uploading : !workspace || workspace?.uploading" @select="selectReferences" /></div><p v-if="error" class="form-error" role="alert">{{ error }}</p><div v-if="accountTool" class="studio-account-view" :class="{ 'studio-prices-view': accountTool === 'prices' }"><button v-if="accountTool !== 'prices'" class="studio-tool" @click="accountTool = ''"><ArrowLeft :size="16" />返回创作</button><StudioAccountTools :view="accountTool" :model="kind === 'text' ? chat?.model : workspace?.model" /></div>
      <p v-if="sourceLoading" role="status">正在恢复原作配置…</p><button v-if="preparingRemix && !source" type="button" class="text-link" :disabled="importingRemix" @click="cancelRemix">返回作品</button>
      <p v-if="sourceIssue && (!preparingRemix || !source)" class="form-error" role="alert">{{ sourceIssue }} <button v-if="sourceCanFallback" type="button" class="text-link" @click="sourceFallback">使用当前配置</button><button type="button" class="text-link" @click="sourceRetry++">重新读取原作</button></p>
      <StudioChat v-show="!accountTool" ref="chat" :inert="!session.user || undefined" :mode="kind" :header-visible="!accountTool" :source="!preparingRemix && source?.kind === 'resource' ? source : null" :source-blocked="sourceBlocked" :remix-preparing="preparingRemix" @prices="openAccount('prices')" @keys="openAccount('keys')" @publish="share" @source="syncSource" @conversation="openConversation" @media-action="mediaAction" />
      <StudioWorkspace v-if="kind !== 'text'" v-show="!accountTool" ref="workspace" :inert="!session.user || undefined" :kind="kind" :source="!preparingRemix && source?.kind === kind ? source : null" :source-blocked="sourceBlocked" :remix-preparing="preparingRemix" @prices="openAccount('prices')" @keys="openAccount('keys')" @publish="share" @source="syncSource" @model="sourceIssue && sourceCanFallback && sourceFallback()" />
      <StudioRemixDialog v-if="source && preparingRemix" :key="source.id + session.user?.id" :source="source" :issue="sourceIssue" :loading="sourceLoading" :can-fallback="sourceCanFallback" :ready="remixReady" :busy="importingRemix" @apply="importRemix" @background="files => importRemix(files, true)" @cancel="cancelRemix" @retry="sourceRetry++" @fallback="sourceFallback" />
    </template><StudioPublishDialog ref="publisher" />
  </div>
</template>

<style scoped>
.create-page { display: flex; flex-direction: column; flex: 1; min-height: 0; max-width: none; padding: 8px 24px 16px; }
.create-page > .native-studio { margin-block-start: auto; }
.studio-page-toolbar { display: flex; align-items: center; gap: 24px; flex: none; min-height: 48px; margin-bottom: 8px; }
.studio-page-toolbar h1 { flex: none; margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; white-space: nowrap; }
.studio-page-toolbar > .studio-tool { margin-left: auto; }
.studio-account-view { flex: 1; min-height: 0; overflow-y: auto; padding-block: 16px; }
.studio-prices-view { padding-top: 0; }
.create-page > .empty-state { border-block: 1px solid var(--border); min-height: 440px; }
.source-label { display: flex; align-items: center; justify-content: space-between; flex: none; gap: 8px; margin-block: 0 8px; color: var(--muted); font-size: 13px; }
.source-label > a { color: var(--ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-studio-navigation, .mobile-new-creation, .studio-mobile-title { display: none; }
.mobile-conversation-undo { display: flex; align-items: center; justify-content: space-between; flex: none; gap: 8px; padding: 4px 0 8px; color: var(--muted); font-size: 12px; }
@media (min-width: 1000px) {
  .mobile-conversation-undo { display: none; }
  .create-page { padding: 8px 40px 24px; --studio-content-width: 1760px; }
  .studio-page-toolbar { width: min(100%, var(--studio-content-width)); margin-inline: auto; min-height: 56px; margin-bottom: 16px; }
  .studio-content-toolbar { display: none; }
  .studio-page-toolbar h1 { font-size: 24px; line-height: 32px; }
  .source-label, .studio-account-view { width: min(100%, var(--studio-content-width)); margin-inline: auto; }
}
@media (max-width: 639px) { .create-page { padding: 0 12px 8px; }.studio-page-toolbar { gap: 16px; margin-bottom: 0; }.studio-page-toolbar h1 { font-size: 14px; }.create-page > .empty-state { min-height: 360px; } }
@media (max-width: 999px) {
  .create-page { padding: 0 12px 8px; }
  .studio-page-toolbar { gap: 4px; min-height: 64px; margin-bottom: 4px; padding-block: 6px; }
  .studio-page-toolbar h1 { display: none; }
  .mobile-studio-navigation, .mobile-new-creation { display: inline-flex; flex: none; }
  .studio-page-toolbar :deep(> .studio-tool) { width: 44px; height: 44px; min-width: 44px; padding: 8px; }
  .studio-mobile-title { display: flex; flex-direction: column; flex: 1; gap: 1px; min-width: 0; padding-inline: 4px; }
  .studio-mobile-title > strong { font-size: 15px; line-height: 24px; font-weight: 500; }
  .studio-mobile-title :deep(.conversation-title-trigger), .studio-mobile-title :deep(.conversation-title-input) { min-height: 28px; padding: 2px 0; font-size: 15px; line-height: 24px; }
  .studio-mobile-title :deep(.conversation-title-trigger) { max-width: 100%; }
  .studio-mobile-title :deep(.conversation-title-trigger svg), .studio-mobile-title :deep(.conversation-message-count) { display: none; }
  .studio-mobile-title :deep(.conversation-title-row) { min-width: 0; }
  .studio-mobile-model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11px; line-height: 16px; }
  .studio-page-toolbar > .studio-tool { margin-left: 0; }
}

@media (max-width: 999px) {
  .create-page { background: var(--canvas); padding-inline: 10px; }
  .studio-page-toolbar { min-height: 56px; padding: 4px 0; margin-bottom: 0; border-bottom: 1px solid var(--border); }
  .studio-mobile-title > strong { font-weight: 600; }
  .create-page :deep(.studio-composer), .create-page :deep(.studio-popover-panel) { border-radius: 16px; }
  .create-page :deep(textarea), .create-page :deep(input:not([type="range"]):not([type="checkbox"])) { font-size: 16px; }
  .create-page > .empty-state { flex: 1; min-height: 240px; border: 0; }
}

</style>
