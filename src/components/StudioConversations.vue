<!-- Selection/project interactions adapted from octopus_chat chat-list.tsx (MIT). -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, Folder, FolderInput, FolderPlus, ListChecks, LoaderCircle, Pencil, Search, Trash2, Undo2, X } from '@lucide/vue'
import { chats, removeChats, chatDeletion, undoRemovedChats, type NativeChat } from '../native-chat'
import { createConversationProject, isConversationBusy, moveConversations, removeConversationProject, renameConversation, renameConversationProject, reorderConversation } from '../studio-conversations'
import { errorMessage, session } from '../state'
import type { CreationTask } from '../native-studio'
import type { StudioKind } from '../studio-state'
import StudioConversationGroup from './StudioConversationGroup.vue'

defineProps<{ unified?: boolean; kind?: StudioKind }>()
const emit = defineEmits<{ select: [id: string]; reuse: [task: CreationTask] }>()
const query = ref(''), selecting = ref(false), selectedIds = ref(new Set<string>()), pending = ref(false), error = ref('')
const root = ref<HTMLElement>(), selectionTrigger = ref<HTMLButtonElement>(), dialog = ref<HTMLDialogElement>(), nameInput = ref<HTMLInputElement>()
const closedProjects = ref(new Set<string>())
type Editor = { kind: 'rename'; id: string } | { kind: 'project-create' } | { kind: 'project-rename'; id: string } | { kind: 'move'; ids: string[] }
const editor = ref<Editor>(), editorName = ref(''), projectTarget = ref(''), dialogError = ref('')
let dialogOwner = '', returnFocus: HTMLElement | null = null
const owner = () => `${session.user?.id || ''}:${session.user?.accountId || ''}`
const conversations = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return chats.sessions
  return chats.sessions.filter(chat => `${chat.topic} ${chat.messages.map(message => typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text || '').join(' ')).join(' ')}`.toLowerCase().includes(keyword))
})
const groups = computed(() => [
  { id: '', name: '', items: conversations.value.filter(chat => !chat.projectId) },
  ...chats.projects.map(project => ({ id: project.id, name: project.name, items: conversations.value.filter(chat => chat.projectId === project.id) })),
].filter(group => !query.value.trim() || group.items.length))
const selected = computed(() => conversations.value.filter(chat => selectedIds.value.has(chat.id)))
const allSelected = computed(() => conversations.value.length > 0 && selected.value.length === conversations.value.length)
const busySelected = computed(() => selected.value.some(isConversationBusy))
const dialogTitle = computed(() => ({ rename: '重命名对话', 'project-create': '新建项目', 'project-rename': '重命名项目', move: '移至项目' })[editor.value?.kind || 'rename'])
function cancelSelection(focus = false) {
  selecting.value = false; selectedIds.value = new Set(); error.value = ''
  if (focus) selectionTrigger.value?.focus()
}
function toggleSelection() {
  if (selecting.value) cancelSelection()
  else { selecting.value = true; closedProjects.value = new Set() }
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
async function deleteSelected() {
  if (pending.value || !selected.value.length || busySelected.value) return
  const ids = selected.value.map(chat => chat.id), activeId = chats.activeId
  if (!window.confirm(`确认删除选中的 ${ids.length} 个对话？`)) return
  if (await run(() => removeChats(ids))) {
    cancelSelection(true)
    if (chats.activeId !== activeId) emit('select', chats.activeId)
  }
}
async function undoDelete() {
  const activeId = chats.activeId
  if (await run(undoRemovedChats) && chats.activeId !== activeId) emit('select', chats.activeId)
}
async function reorder(source: string, target: string) { return run(() => reorderConversation(source, target)) }
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
  if (!value || dialogOwner !== owner() || pending.value) return
  const acceptedOwner = dialogOwner
  const success = await run(async () => {
    if (value.kind === 'rename') await renameConversation(value.id, editorName.value)
    else if (value.kind === 'project-create') await createConversationProject(editorName.value)
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
async function removeProject(id: string, name: string) {
  if (pending.value || !window.confirm(`删除项目“${name}”？其中的对话会移到未归类。`)) return
  await run(() => removeConversationProject(id))
}
watch(() => conversations.value.map(chat => chat.id), ids => {
  const visible = new Set(ids)
  selectedIds.value = new Set([...selectedIds.value].filter(id => visible.has(id)))
})
watch(owner, () => {
  cancelSelection(); query.value = ''; pending.value = false; closedProjects.value = new Set()
  returnFocus = null; closeEditor()
})
onMounted(() => document.addEventListener('keydown', escape, true))
onBeforeUnmount(() => { document.removeEventListener('keydown', escape, true); dialog.value?.close() })
</script>

<template>
  <div ref="root" class="studio-conversations">
    <div class="conversation-search">
      <label v-if="!unified"><Search :size="15" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索对话" placeholder="搜索记录" :disabled="pending" /></label>
      <button ref="selectionTrigger" type="button" class="studio-tool" aria-label="多选对话" title="多选对话" :aria-pressed="selecting" :disabled="pending || !chats.sessions.length" @click="toggleSelection"><ListChecks :size="17" /></button>
      <button type="button" class="studio-tool project-create" aria-label="新建项目" title="新建项目" :disabled="pending" @click="openEditor({ kind: 'project-create' })"><FolderPlus :size="17" /></button>
    </div>
    <nav class="conversation-records" :aria-label="unified ? '全部会话' : '历史对话'">
      <section v-for="group in groups" :key="group.id" class="conversation-section" :data-project-id="group.id">
        <header v-if="group.id" class="project-heading">
          <button type="button" class="project-toggle" :aria-label="`项目：${group.name}`" :title="group.name" :aria-expanded="!closedProjects.has(group.id)" :disabled="pending || selecting" @click="toggleProject(group.id)"><ChevronDown :size="14" :class="{ collapsed: closedProjects.has(group.id) }" /><Folder :size="15" /><span>{{ group.name }}</span></button>
          <button type="button" class="project-tool" :aria-label="`重命名项目：${group.name}`" title="重命名项目" :disabled="pending" @click="openEditor({ kind: 'project-rename', id: group.id }, group.name)"><Pencil :size="14" /></button>
          <button type="button" class="project-tool" :aria-label="`删除项目：${group.name}`" title="删除项目" :disabled="pending" @click="removeProject(group.id, group.name)"><Trash2 :size="14" /></button>
        </header>
        <p v-else-if="chats.projects.length && group.items.length" class="unfiled-label">未归类</p>
        <StudioConversationGroup v-if="!closedProjects.has(group.id)" :items="group.items" :active-id="chats.activeId" :selecting="selecting" :selected-ids="selectedIds" :disabled="pending" :sortable="!query.trim()" :on-reorder="reorder" @select="emit('select', $event)" @toggle="toggle" @rename="rename" />
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
        <label v-if="editor.kind === 'move'" class="field"><span>项目</span><select v-model="projectTarget" class="control" :disabled="pending"><option value="">未归类对话</option><option v-for="project in chats.projects" :key="project.id" :value="project.id">{{ project.name }}</option><option value="__new">新建项目…</option></select></label>
        <label v-if="editor.kind !== 'move' || projectTarget === '__new'" class="field"><span>{{ editor.kind === 'rename' ? '对话名称' : '项目名称' }}</span><input ref="nameInput" v-model="editorName" class="control" type="text" :maxlength="editor.kind === 'rename' ? 100 : 80" required :disabled="pending" autocomplete="off" /></label>
        <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
        <footer><button type="button" class="button subtle btn" :disabled="pending" @click="closeEditor">取消</button><button type="submit" class="button subtle btn" :disabled="pending || (editor.kind !== 'move' || projectTarget === '__new') && !editorName.trim()"><LoaderCircle v-if="pending" :size="15" />{{ pending ? '正在保存' : editor.kind === 'move' ? '移动' : '保存' }}</button></footer>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.studio-conversations { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.conversation-search { display: flex; align-items: center; gap: 4px; flex: none; }
.conversation-search label { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; min-height: 40px; padding: 4px 8px; color: var(--muted); }
.conversation-search input { min-width: 0; width: 100%; padding: 8px 0; border: 0; outline: none; background: transparent; font-size: 12px; color: var(--ink); }
.conversation-search label:focus-within { outline: 1px solid var(--muted); border-radius: 6px; }
.project-create { margin-left: auto; }
.conversation-records { flex: 1; min-height: 0; overflow-y: auto; margin-top: 8px; scrollbar-color: var(--border) transparent; }
.conversation-section { min-width: 0; }
.project-heading { display: flex; align-items: center; gap: 0; margin-top: 12px; min-width: 0; }
.project-toggle { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; min-height: 40px; padding: 4px 6px; border: 0; border-radius: 6px; text-align: start; color: var(--muted); background: transparent; font-size: 12px; cursor: pointer; }
.project-toggle span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.project-toggle svg { flex: none; }.project-toggle .collapsed { transform: rotate(-90deg); }
.project-tool { display: grid; place-items: center; flex: none; width: 26px; height: 36px; padding: 0; border: 0; border-radius: 5px; color: var(--muted); background: transparent; cursor: pointer; }
.project-toggle:hover, .project-tool:hover { color: var(--ink); background: var(--surface-soft); }.project-tool:disabled, .project-toggle:disabled { cursor: default; opacity: .55; }
.project-toggle:focus-visible, .project-tool:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.unfiled-label { margin: 12px 8px 4px; color: var(--muted); font-size: 12px; }
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
@media (pointer: coarse), (max-width: 639px) { .project-tool { width: 36px; height: 44px; }.conversation-dialog .control { min-height: 44px; font-size: 16px; }.conversation-dialog footer button { min-height: 44px; } }
</style>
