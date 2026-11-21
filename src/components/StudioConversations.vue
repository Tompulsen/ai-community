<!-- Selection/project interactions adapted from octopus_chat chat-list.tsx (MIT). -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Check, ChevronDown, Folder, FolderInput, FolderMinus, FolderOpen, ListChecks, LoaderCircle, MoreHorizontal, Pencil, Plus, Search, Settings2, Trash2, Undo2, X } from '@lucide/vue'
import { chats, removeChats, chatDeletion, saveChats, undoRemovedChats, type NativeChat } from '../native-chat'
import { createConversationProject, isConversationBusy, moveConversations, removeConversationProject, renameConversation, renameConversationProject, reorderConversation } from '../studio-conversations'
import { errorMessage, session } from '../state'
import type { CreationTask } from '../native-studio'
import type { StudioKind } from '../studio-state'
import StudioConversationGroup from './StudioConversationGroup.vue'
import { createImeGuard } from '../../shared/studio/ime-input'
import StudioContextMenu, { type StudioMenuAction } from './studio-message/StudioContextMenu.vue'
import { confirmStudioDelete } from '../studio-confirm'
import StudioChatParameters from './StudioChatParameters.vue'
import { modelFormat } from '../model-preferences'

defineProps<{ unified?: boolean; kind?: StudioKind }>()
const emit = defineEmits<{ select: [id: string]; reuse: [task: CreationTask] }>()
const query = ref(''), selecting = ref(false), selectedIds = ref(new Set<string>()), pending = ref(false), error = ref('')
const root = ref<HTMLElement>(), selectionTrigger = ref<HTMLButtonElement>(), dialog = ref<HTMLDialogElement>(), nameInput = ref<HTMLInputElement>()
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
const closedProjects = ref(new Set<string>())
const projectsOpen = ref(true), conversationsOpen = ref(true), creating = ref(false), projectName = ref(''), createError = ref('')
const createInput = ref<HTMLInputElement>(), createTrigger = ref<HTMLButtonElement>()
const createPanelId = `project-create-${useId()}`, createIme = createImeGuard()
let createOwner = ''
const projectMenu = ref<InstanceType<typeof StudioContextMenu>>(), menuProjectId = ref('')
const conversationMenu = ref<InstanceType<typeof StudioContextMenu>>(), menuConversationId = ref('')
const conversationMenuItems = computed<StudioMenuAction[]>(() => {
  const chat = chats.sessions.find(item => item.id === menuConversationId.value)
  if (!chat) return []
  const acceptedOwner = owner()
  const action = (run: () => unknown) => () => { if (acceptedOwner === owner() && chats.sessions.includes(chat)) return run() }
  return [
    { label: `重命名对话：${chat.topic}`, text: '重命名', icon: Pencil, disabled: pending.value, run: action(() => rename(chat)) },
    { label: '移至项目', icon: FolderInput, disabled: pending.value, run: action(() => openEditor({ kind: 'move', ids: [chat.id] })) },
    ...(chat.projectId ? [{ label: '移出项目', icon: FolderMinus, disabled: pending.value, run: action(() => run(() => moveConversations([chat.id]))) }] : []),
    { label: '对话设置', icon: Settings2, disabled: pending.value || isConversationBusy(chat), run: action(() => openEditor({ kind: 'settings', id: chat.id })) },
    { label: '多选对话', icon: ListChecks, disabled: pending.value, run: action(() => { toggleSelection(); selectedIds.value = new Set([chat.id]) }) },
    { label: `删除对话：${chat.topic}`, text: '删除对话', icon: Trash2, danger: true, disabled: pending.value || isConversationBusy(chat), run: action(() => deleteConversation(chat)) },
  ]
})
function openConversationMenu(event: MouseEvent, chat: NativeChat) { menuConversationId.value = chat.id; void conversationMenu.value?.open(event) }
const projectMenuItems = computed<StudioMenuAction[]>(() => {
  const project = chats.projects.find(item => item.id === menuProjectId.value)
  if (!project) return []
  return [
    { label: `重命名项目：${project.name}`, text: '重命名', icon: Pencil, disabled: pending.value, run: () => openEditor({ kind: 'project-rename', id: project.id }, project.name) },
    { label: `删除项目：${project.name}`, text: '删除项目', icon: Trash2, danger: true, disabled: pending.value, run: () => removeProject(project.id, project.name) },
  ]
})
function openProjectMenu(event: MouseEvent, id: string) { menuProjectId.value = id; void projectMenu.value?.open(event) }
function projectCount(id: string) { return chats.sessions.filter(chat => chat.projectId === id).length }
type Editor = { kind: 'rename'; id: string } | { kind: 'settings'; id: string } | { kind: 'project-rename'; id: string } | { kind: 'move'; ids: string[] }
const editor = ref<Editor>(), editorName = ref(''), projectTarget = ref(''), dialogError = ref('')
let dialogOwner = '', returnFocus: HTMLElement | null = null
const owner = () => `${session.user?.id || ''}:${session.user?.accountId || ''}`
const conversations = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return chats.sessions
  return chats.sessions.filter(chat => `${chat.topic} ${chat.messages.map(message => typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text || '').join(' ')).join(' ')}`.toLowerCase().includes(keyword))
})
const groups = computed(() => [
  ...chats.projects.map(project => ({ id: project.id, name: project.name, items: conversations.value.filter(chat => chat.projectId === project.id) })),
  { id: '', name: '', items: conversations.value.filter(chat => !chat.projectId) },
].filter(group => !group.id || !query.value.trim() || group.items.length))
const selected = computed(() => conversations.value.filter(chat => selectedIds.value.has(chat.id)))
const allSelected = computed(() => conversations.value.length > 0 && selected.value.length === conversations.value.length)
const busySelected = computed(() => selected.value.some(isConversationBusy))
const dialogTitle = computed(() => ({ rename: '重命名对话', 'project-rename': '重命名项目', move: '移至项目', settings: '对话设置' })[editor.value?.kind || 'rename'])
const editingChat = computed(() => { const value = editor.value; return value?.kind === 'settings' ? chats.sessions.find(chat => chat.id === value.id) : undefined })
const editingFormat = computed(() => editingChat.value?.formatOverride || modelFormat(editingChat.value?.textModel || editingChat.value?.model || '') || editingChat.value?.settings.format)
function changeFormat(event: Event) {
  if (!editingChat.value || dialogOwner !== owner()) return
  editingChat.value.formatOverride = (event.target as HTMLSelectElement).value as NativeChat['settings']['format']
  void saveChats()
}
function cancelSelection(focus = false) {
  selecting.value = false; selectedIds.value = new Set(); error.value = ''
  if (focus) selectionTrigger.value?.focus()
}
function toggleSelection() {
  if (selecting.value) cancelSelection()
  else { selecting.value = true; closedProjects.value = new Set(); projectsOpen.value = true; conversationsOpen.value = true }
}
function toggle(id: string) {
  if (pending.value) return
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function toggleAll() { selectedIds.value = allSelected.value ? new Set() : new Set(conversations.value.map(chat => chat.id)) }
function toggleProject(id: string) {
  const next = new Set(closedProjects.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  closedProjects.value = next
}
function escape(event: KeyboardEvent) {
  if (!root.value?.getClientRects().length) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('dialog[open], [popover]:popover-open') && !target.closest('.studio-conversations')) return
  if (dialog.value?.open) return
  if (event.key === 'Escape' && creating.value && !pending.value && !createIme.isComposing(event)) {
    event.preventDefault(); event.stopImmediatePropagation(); cancelCreate(); return
  }
  if (event.key === 'Escape' && selecting.value && !pending.value) {
    event.preventDefault(); event.stopImmediatePropagation(); cancelSelection(true)
  }
}
async function run(action: () => Promise<unknown>, localError = false): Promise<boolean> {
  if (pending.value) return false
  const acceptedOwner = owner()
  pending.value = true; error.value = ''; dialogError.value = ''
  try { await action(); return acceptedOwner === owner() }
  catch (cause) { if (acceptedOwner === owner()) { if (localError) dialogError.value = errorMessage(cause); else error.value = errorMessage(cause) }; return false }
  finally { if (acceptedOwner === owner()) pending.value = false }
}
async function openCreate() {
  if (pending.value) return
  createOwner = owner(); projectName.value = ''; createError.value = ''; creating.value = true; projectsOpen.value = true
  await nextTick()
  if (createOwner === owner() && creating.value) createInput.value?.focus()
}
function cancelCreate(focus = true) {
  creating.value = false; projectName.value = ''; createError.value = ''
  if (focus) createTrigger.value?.focus({ preventScroll: true })
}
async function createProject() {
  if (!creating.value || pending.value || createOwner !== owner() || createIme.isComposing({ key: 'Enter' })) return
  if (!projectName.value.trim()) { createError.value = '请输入项目名称'; createInput.value?.focus(); return }
  let id = ''
  const acceptedOwner = owner()
  if (await run(async () => { id = await createConversationProject(projectName.value) }, true)) {
    cancelCreate(false); closedProjects.value.delete(id)
    await nextTick()
    if (acceptedOwner === owner()) root.value?.querySelector<HTMLButtonElement>(`[data-project-id="${CSS.escape(id)}"] .project-toggle`)?.focus({ preventScroll: true })
  } else if (acceptedOwner === owner()) createError.value = dialogError.value
}
async function deleteSelected() {
  if (pending.value || !selected.value.length || busySelected.value) return
  const ids = selected.value.map(chat => chat.id), activeId = chats.activeId
  if (!await confirmStudioDelete(`确认删除选中的 ${ids.length} 个对话？`, () => !pending.value && ids.every(id => {
    const chat = chats.sessions.find(item => item.id === id)
    return chat && !isConversationBusy(chat)
  }))) return
  if (await run(() => removeChats(ids))) {
    cancelSelection(true)
    if (chats.activeId !== activeId) emit('select', chats.activeId)
  }
}
async function deleteConversation(chat: NativeChat) {
  if (pending.value || isConversationBusy(chat) || !await confirmStudioDelete(`删除对话“${chat.topic}”？`, () => !pending.value && chats.sessions.includes(chat) && !isConversationBusy(chat))) return
  const activeId = chats.activeId
  if (await run(() => removeChats([chat.id])) && chats.activeId !== activeId) emit('select', chats.activeId)
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>(`[data-conversation-id="${CSS.escape(chats.activeId)}"] .conversation-record`)?.focus({ preventScroll: true })
}
async function undoDelete() {
  const activeId = chats.activeId
  if (await run(undoRemovedChats) && chats.activeId !== activeId) emit('select', chats.activeId)
}
async function reorder(source: string, target: string) { return run(() => reorderConversation(source, target)) }
function positionEditor() {
  if (!dialog.value?.open) return
  const viewport = window.visualViewport, height = viewport?.height || innerHeight
  dialog.value.style.setProperty('--conversation-viewport-height', `${height}px`)
  dialog.value.style.setProperty('--conversation-viewport-bottom', `${Math.max(0, innerHeight - (viewport?.offsetTop || 0) - height)}px`)
}
async function openEditor(value: Editor, name = '') {
  if (pending.value) return
  const openingOwner = owner()
  dialogOwner = openingOwner; returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  editor.value = value; editorName.value = name; dialogError.value = ''
  const activeEditor = editor.value
  projectTarget.value = value.kind === 'move' ? chats.sessions.find(chat => value.ids.includes(chat.id))?.projectId || '' : ''
  await nextTick()
  if (owner() !== openingOwner || editor.value !== activeEditor) return
  dialog.value?.showModal()
  positionEditor()
  nameInput.value?.focus()
}
function rename(chat: NativeChat) { void openEditor({ kind: 'rename', id: chat.id }, chat.topic) }
function closeEditor() {
  dialog.value?.close(); editor.value = undefined; dialogError.value = ''
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  returnFocus = null
}
async function saveEditor() {
  const value = editor.value
  if (!value || value.kind === 'settings' || dialogOwner !== owner() || pending.value) return
  const acceptedOwner = dialogOwner
  const success = await run(async () => {
    if (value.kind === 'rename') await renameConversation(value.id, editorName.value)
    else if (value.kind === 'project-rename') await renameConversationProject(value.id, editorName.value)
    else {
      let target = projectTarget.value || undefined
      if (target === '__new') {
        target = await createConversationProject(editorName.value)
        if (acceptedOwner !== owner() || editor.value !== value) return
        projectTarget.value = target
      }
      await moveConversations(value.ids, target)
    }
  }, true)
  if (success) {
    if (value.kind === 'move') { closedProjects.value = new Set(); cancelSelection(true) }
    closeEditor()
  }
}
async function chooseProject(id: string) {
  if (pending.value || editor.value?.kind !== 'move') return
  projectTarget.value = id
  if (id === '__new') { await nextTick(); nameInput.value?.focus(); return }
  await saveEditor()
}
function alreadyInProject(id: string) {
  const value = editor.value
  return value?.kind === 'move' && value.ids.length > 0 && value.ids.every(chatId => chats.sessions.some(chat => chat.id === chatId && (chat.projectId || '') === id))
}
async function removeProject(id: string, name: string) {
  if (pending.value || !await confirmStudioDelete(`删除项目“${name}”？其中的对话会移到未归类，聊天记录会保留。`, () => !pending.value && chats.projects.some(project => project.id === id))) return
  await run(() => removeConversationProject(id))
}
watch(() => conversations.value.map(chat => chat.id), ids => {
  const visible = new Set(ids)
  selectedIds.value = new Set([...selectedIds.value].filter(id => visible.has(id)))
})
watch(owner, () => {
  projectMenu.value?.close(); menuProjectId.value = ''
  conversationMenu.value?.close(); menuConversationId.value = ''
  cancelSelection(); cancelCreate(false); query.value = ''; pending.value = false; closedProjects.value = new Set()
  projectsOpen.value = true; conversationsOpen.value = true
  returnFocus = null; closeEditor()
})
watch(() => [chats.sessions.map(chat => chat.id), selecting.value], () => {
  if (selecting.value || !chats.sessions.some(chat => chat.id === menuConversationId.value)) { conversationMenu.value?.close(); menuConversationId.value = '' }
  if (editor.value?.kind === 'settings' && !editingChat.value) closeEditor()
})
onMounted(() => {
  document.addEventListener('keydown', escape, true); clock = setInterval(() => { now.value = Date.now() }, 60_000)
  window.addEventListener('resize', positionEditor); window.visualViewport?.addEventListener('resize', positionEditor); window.visualViewport?.addEventListener('scroll', positionEditor)
})
onBeforeUnmount(() => {
  clearInterval(clock); document.removeEventListener('keydown', escape, true); dialog.value?.close()
  window.removeEventListener('resize', positionEditor); window.visualViewport?.removeEventListener('resize', positionEditor); window.visualViewport?.removeEventListener('scroll', positionEditor)
})
</script>

<template>
  <div ref="root" class="studio-conversations">
    <div v-if="!unified" class="conversation-search">
      <label><Search :size="15" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索对话" placeholder="搜索记录" :disabled="pending" /></label>
    </div>
    <nav class="conversation-records" :aria-label="unified ? '全部会话' : '历史对话'">
      <header class="conversation-section-heading">
        <button type="button" class="conversation-section-toggle" aria-label="项目" :aria-expanded="projectsOpen" @click="projectsOpen = !projectsOpen"><span>项目</span><ChevronDown :size="13" :class="{ collapsed: !projectsOpen }" /></button>
        <button ref="createTrigger" type="button" class="studio-tool project-create" aria-label="新建项目" title="新建项目" :aria-expanded="creating && projectsOpen" :aria-controls="createPanelId" :disabled="pending" @click="openCreate"><Plus :size="16" /></button>
      </header>
      <form v-if="creating && projectsOpen" :id="createPanelId" class="project-create-form" aria-label="新建项目" @submit.prevent="createProject" @keydown.enter="createIme.blocks($event) && $event.preventDefault()" @keyup="createIme.release">
        <input ref="createInput" v-model="projectName" aria-label="项目名称" placeholder="项目名称" maxlength="80" autocomplete="off" :disabled="pending" :aria-invalid="Boolean(createError)" :aria-describedby="createError ? `${createPanelId}-error` : undefined" @input="createError = ''" @compositionstart="createIme.start" @compositionend="createIme.end" />
        <button type="submit" class="project-create-action" aria-label="确认创建项目" title="创建项目" :disabled="pending"><LoaderCircle v-if="pending" :size="16" /><Check v-else :size="16" /></button>
        <button type="button" class="project-create-action" aria-label="取消新建项目" title="取消" :disabled="pending" @click="cancelCreate()"><X :size="16" /></button>
        <p v-if="createError" :id="`${createPanelId}-error`" class="project-create-error" role="alert">{{ createError }}</p>
      </form>
      <section v-for="group in groups" v-show="!group.id || projectsOpen" :key="group.id" class="conversation-section" :data-project-id="group.id">
        <header v-if="group.id" class="project-heading">
          <button type="button" class="project-toggle" :aria-label="`项目：${group.name}`" :title="group.name" :aria-expanded="!closedProjects.has(group.id)" :disabled="pending || selecting" @click="toggleProject(group.id)"><ChevronDown :size="13" :class="{ collapsed: closedProjects.has(group.id) }" /><Folder v-if="closedProjects.has(group.id)" :size="15" /><FolderOpen v-else :size="15" /><span>{{ group.name }}</span><span class="project-count" :aria-label="`${projectCount(group.id)} 个对话`">{{ projectCount(group.id) }}</span></button>
          <button type="button" class="project-tool" :aria-label="`项目操作：${group.name}`" title="项目操作" aria-haspopup="menu" :aria-expanded="menuProjectId === group.id && projectMenu?.visible || false" :disabled="pending" @click="openProjectMenu($event, group.id)"><MoreHorizontal :size="16" /></button>
        </header>
        <header v-else class="conversation-section-heading conversation-list-heading">
          <button type="button" class="conversation-section-toggle" aria-label="对话" :aria-expanded="conversationsOpen" @click="conversationsOpen = !conversationsOpen"><span>对话</span><ChevronDown :size="13" :class="{ collapsed: !conversationsOpen }" /></button>
          <button :ref="element => { selectionTrigger = element as HTMLButtonElement }" type="button" class="studio-tool" aria-label="多选对话" title="多选对话" :aria-pressed="selecting" :disabled="pending || !chats.sessions.length" @click="toggleSelection"><ListChecks :size="17" /></button>
        </header>
        <StudioConversationGroup v-if="!closedProjects.has(group.id) && (group.id || conversationsOpen)" :items="group.items" :active-id="chats.activeId" :selecting="selecting" :selected-ids="selectedIds" :disabled="pending" :sortable="!query.trim()" :now="now" :menu-id="conversationMenu?.visible ? menuConversationId : undefined" :on-reorder="reorder" @select="emit('select', $event)" @toggle="toggle" @menu="openConversationMenu" />
        <p v-if="group.id && !closedProjects.has(group.id) && !group.items.length" class="conversation-empty">暂无对话</p>
      </section>
      <p v-if="!conversations.length && (!chats.projects.length || query)" class="conversation-empty">{{ query ? '没有匹配的记录' : '暂无会话记录' }}</p>
    </nav>
    <div v-if="selecting" class="conversation-selection" role="toolbar" aria-label="对话多选">
      <button type="button" class="studio-tool" :aria-label="allSelected ? '取消全选' : '全选'" :title="allSelected ? '取消全选' : '全选'" :disabled="pending || !conversations.length" @click="toggleAll"><ListChecks :size="18" /></button>
      <span role="status">已选 {{ selected.length }} 项</span>
      <button type="button" class="studio-tool" aria-label="移至项目" title="移至项目" :disabled="pending || !selected.length" @click="openEditor({ kind: 'move', ids: selected.map(chat => chat.id) })"><FolderInput :size="17" /></button>
      <button type="button" class="studio-tool" aria-label="删除所选" :title="busySelected ? '请先停止或核对所选对话' : '删除所选'" :disabled="pending || !selected.length || busySelected" @click="deleteSelected"><LoaderCircle v-if="pending" :size="17" /><Trash2 v-else :size="17" /></button>
      <button type="button" class="studio-tool" aria-label="取消多选" title="取消多选" :disabled="pending" @click="cancelSelection(true)"><X :size="18" /></button>
    </div>
    <div v-if="chatDeletion.count" class="conversation-undo"><span role="status">已删除 {{ chatDeletion.count }} 个对话</span><button type="button" class="studio-tool" :disabled="pending" @click="undoDelete"><Undo2 :size="15" />撤销删除</button></div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <dialog ref="dialog" class="conversation-dialog" :aria-label="dialogTitle" @cancel="pending && $event.preventDefault()" @close="editor && closeEditor()">
      <form v-if="editor" @submit.prevent="saveEditor">
        <header><h2>{{ dialogTitle }}</h2><button type="button" class="icon-button" :aria-label="`关闭${dialogTitle}`" :title="`关闭${dialogTitle}`" :disabled="pending" @click="closeEditor"><X :size="18" /></button></header>
        <div v-if="editor.kind === 'move'" class="project-destinations" role="group" aria-label="选择目标项目">
          <button v-for="project in chats.projects" :key="project.id" type="button" class="studio-command" :aria-label="`移至项目：${project.name}`" :aria-pressed="alreadyInProject(project.id)" :disabled="pending || alreadyInProject(project.id)" @click="chooseProject(project.id)"><Folder :size="18" /><span>{{ project.name }}</span><Check v-if="alreadyInProject(project.id)" :size="16" /></button>
          <button type="button" class="studio-command" :aria-pressed="alreadyInProject('')" :disabled="pending || alreadyInProject('')" @click="chooseProject('')"><FolderOpen :size="18" /><span>未归类对话</span><Check v-if="alreadyInProject('')" :size="16" /></button>
          <button type="button" class="studio-command" :aria-pressed="projectTarget === '__new'" :disabled="pending" @click="chooseProject('__new')"><Plus :size="18" /><span>新建项目</span></button>
        </div>
        <StudioChatParameters v-if="editor.kind === 'settings' && editingChat" :key="editingChat.id" :chat="editingChat" :format="editingFormat" @format="changeFormat" />
        <label v-else-if="editor.kind !== 'move' || projectTarget === '__new'" class="field"><span>{{ editor.kind === 'rename' ? '对话名称' : '项目名称' }}</span><input ref="nameInput" v-model="editorName" class="control" type="text" :maxlength="editor.kind === 'rename' ? 100 : 80" required :disabled="pending" autocomplete="off" /></label>
        <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
        <footer><button type="button" class="button subtle btn" :disabled="pending" @click="closeEditor">{{ editor.kind === 'settings' ? '完成' : '取消' }}</button><button v-if="editor.kind !== 'settings' && (editor.kind !== 'move' || projectTarget === '__new')" type="submit" class="button subtle btn" :disabled="pending || !editorName.trim()"><LoaderCircle v-if="pending" :size="15" />{{ pending ? '正在保存' : editor.kind === 'move' ? '创建并移动' : '保存' }}</button></footer>
      </form>
    </dialog>
    <StudioContextMenu ref="projectMenu" label="项目操作" :items="projectMenuItems" />
    <StudioContextMenu ref="conversationMenu" label="对话操作" :items="conversationMenuItems" />
  </div>
</template>

<style scoped>
.studio-conversations { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.conversation-search { display: flex; align-items: center; gap: 4px; flex: none; }
.conversation-search label { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; min-height: 40px; padding: 4px 8px; color: var(--muted); }
.conversation-search input { min-width: 0; width: 100%; padding: 8px 0; border: 0; outline: none; background: transparent; font-size: 12px; color: var(--ink); }
.conversation-search label:focus-within { outline: 1px solid var(--muted); border-radius: 6px; }
.conversation-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 4px; min-width: 0; padding-inline: 8px 4px; }
.conversation-section-toggle { display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 4px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 13px; text-align: start; cursor: pointer; }
.conversation-section-toggle .collapsed { transform: rotate(-90deg); }
.conversation-section-heading > .studio-tool, .project-create-action { display: grid; place-items: center; flex: none; width: 28px; height: 28px; min-height: 28px; padding: 6px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; }
.conversation-section-toggle:hover:not(:disabled), .conversation-section-heading > .studio-tool:hover:not(:disabled), .project-create-action:hover:not(:disabled) { background: var(--state-hover); color: var(--ink); }
.conversation-section-heading > .studio-tool:is([aria-expanded="true"], [aria-pressed="true"]) { background: var(--state-selected); color: var(--ink); }
.conversation-section-toggle:active:not(:disabled), .conversation-section-heading > .studio-tool:active:not(:disabled), .project-create-action:active:not(:disabled), .conversation-section-heading > .studio-tool:is([aria-expanded="true"], [aria-pressed="true"]):hover:not(:disabled) { background: var(--state-pressed); color: var(--ink); }
.conversation-list-heading { margin-top: 12px; }
.project-create-form { display: grid; grid-template-columns: minmax(0, 1fr) 28px 28px; align-items: center; gap: 4px; margin: 4px 0; padding-inline: 8px 4px; }
.project-create-form input { width: 100%; min-width: 0; min-height: 32px; padding: 4px 8px; border: 0; border-radius: 6px; background: var(--surface-soft); color: var(--ink); font-size: 13px; line-height: 20px; }
.project-create-error { grid-column: 1 / -1; margin: 0; color: var(--danger); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
.conversation-section-toggle:focus-visible, .project-create-action:focus-visible, .project-create-form input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.conversation-records { flex: 1; min-height: 0; overflow-y: auto; margin-top: 8px; scrollbar-color: var(--border) transparent; }
.conversation-section { min-width: 0; }
.project-heading { display: flex; align-items: center; gap: 0; margin-top: 12px; min-width: 0; }
.project-toggle { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; min-height: 40px; padding: 4px 6px; border: 0; border-radius: 6px; text-align: start; color: var(--muted); background: transparent; font-size: 12px; cursor: pointer; }
.project-toggle span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.project-toggle svg { flex: none; }.project-toggle .collapsed { transform: rotate(-90deg); }
.project-tool { display: grid; place-items: center; flex: none; width: 26px; height: 36px; padding: 0; border: 0; border-radius: 5px; color: var(--muted); background: transparent; cursor: pointer; }
.project-toggle:hover:not(:disabled), .project-tool:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }.project-tool:disabled, .project-toggle:disabled { cursor: default; opacity: .55; }
.project-tool[aria-expanded="true"] { color: var(--ink); background: var(--state-selected); }
.project-toggle:active:not(:disabled), .project-tool:active:not(:disabled), .project-tool[aria-expanded="true"]:hover:not(:disabled) { color: var(--ink); background: var(--state-pressed); }
.project-toggle > .project-count { flex: none; color: var(--muted); min-width: 2ch; font-size: 11px; font-variant-numeric: tabular-nums; text-align: end; }
.project-toggle:is(:hover, :active):not(:disabled) > .project-count { color: var(--ink); }
.conversation-section[data-project-id]:not([data-project-id=""]) :deep(.conversation-group) { padding-inline-start: 12px; }
.project-destinations { display: grid; gap: 4px; max-height: 45dvh; overflow-y: auto; }.project-destinations .studio-command > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }.project-destinations button:disabled { opacity: .5; }
.project-toggle:focus-visible, .project-tool:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.conversation-empty { margin: 0; padding: 8px; font-size: 12px; line-height: 20px; color: var(--muted); }
.conversation-selection { display: flex; align-items: center; gap: 2px; flex: none; padding-top: 8px; color: var(--muted); }
.conversation-selection > span { flex: 1; min-width: 0; white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.conversation-selection .studio-tool { min-width: 32px; min-height: 44px; padding-inline: 5px; }
.conversation-undo { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px; padding: 8px 4px; color: var(--muted); font-size: 12px; }
.conversation-undo .studio-tool { gap: 5px; font-size: 12px; }
.form-error { font-size: 12px; margin-top: 8px; overflow-wrap: anywhere; }
.conversation-dialog { width: min(400px, calc(100vw - 32px)); padding: 20px; border: 0; border-radius: 8px; color: var(--ink); background: var(--canvas); }
.conversation-dialog form { display: grid; gap: 16px; }.conversation-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.conversation-dialog h2 { margin: 0; font-size: 16px; font-weight: 500; }.conversation-dialog footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.conversation-dialog .field { font-size: 13px; }.conversation-dialog .control { border: 0; background: var(--surface-soft); }.conversation-dialog::backdrop { background: #0009; }
@media (hover: hover) and (pointer: fine) { .project-tool { opacity: 0; }.project-heading:hover .project-tool, .project-heading:focus-within .project-tool { opacity: 1; } }
@media (pointer: coarse), (max-width: 639px) { .project-create-form { grid-template-columns: minmax(0, 1fr) 44px 44px; }.conversation-section-heading > .studio-tool, .project-create-action { width: 44px; height: 44px; min-height: 44px; }.project-create-form input { min-height: 44px; font-size: 16px; }.project-tool { width: 36px; height: 44px; }.conversation-dialog .control { min-height: 44px; font-size: 16px; }.conversation-dialog footer button { min-height: 44px; } }
@media (max-width: 600px) { .conversation-dialog { position: fixed; inset: auto 0 var(--conversation-viewport-bottom, 0px); margin: 0; width: 100%; max-width: 100%; max-height: calc(var(--conversation-viewport-height, 100dvh) * .8); padding: 16px max(16px, env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); border-radius: 24px 24px 0 0; overscroll-behavior: contain; }.conversation-dialog header { position: sticky; top: -16px; z-index: 1; background: var(--canvas); min-height: 44px; } }
</style>
