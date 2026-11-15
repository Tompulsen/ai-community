<!-- Selection adapted from octopus_chat app/components/chat-list.tsx (MIT). -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ListChecks, LoaderCircle, MessageSquare, Search, Trash2, X } from '@lucide/vue'
import { chats, removeChats } from '../native-chat'
import { errorMessage, session } from '../state'

const emit = defineEmits<{ select: [id: string] }>()
const query = ref(''), selecting = ref(false), selectedIds = ref(new Set<string>()), deleting = ref(false), error = ref('')
const selectionTrigger = ref<HTMLButtonElement>()
const conversations = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return chats.sessions
  return chats.sessions.filter(chat => `${chat.topic} ${chat.messages.map(message => typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text || '').join(' ')).join(' ')}`.toLowerCase().includes(keyword))
})
const selected = computed(() => conversations.value.filter(chat => selectedIds.value.has(chat.id)))
const allSelected = computed(() => conversations.value.length > 0 && selected.value.length === conversations.value.length)
const busySelected = computed(() => selected.value.some(chat => chats.busy[chat.id]))
function cancelSelection(focus = false) {
  selecting.value = false; selectedIds.value = new Set(); error.value = ''
  if (focus) selectionTrigger.value?.focus()
}
function toggle(id: string) {
  if (deleting.value) return
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function toggleAll() {
  selectedIds.value = allSelected.value ? new Set() : new Set(conversations.value.map(chat => chat.id))
}
function escape(event: KeyboardEvent) {
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('dialog[open], [popover]:popover-open') && !target.closest('.studio-conversations')) return
  if (event.key === 'Escape' && selecting.value && !deleting.value) {
    event.preventDefault(); event.stopImmediatePropagation(); cancelSelection(true)
  }
}
async function deleteSelected() {
  if (deleting.value || !selected.value.length || busySelected.value) return
  const ids = selected.value.map(chat => chat.id), owner = session.user?.id
  if (!window.confirm(`确认删除选中的 ${ids.length} 个对话？`)) return
  deleting.value = true; error.value = ''
  try {
    await removeChats(ids)
    if (session.user?.id !== owner) return
    cancelSelection(true); emit('select', chats.activeId)
  } catch (cause) { if (session.user?.id === owner) error.value = errorMessage(cause) }
  finally { deleting.value = false }
}
watch(() => conversations.value.map(chat => chat.id), ids => {
  const visible = new Set(ids)
  selectedIds.value = new Set([...selectedIds.value].filter(id => visible.has(id)))
})
watch(() => [session.user?.id, session.user?.accountId], () => { cancelSelection(); query.value = '' })
onMounted(() => document.addEventListener('keydown', escape, true))
onBeforeUnmount(() => document.removeEventListener('keydown', escape, true))
</script>

<template>
  <div class="studio-conversations">
    <div class="conversation-search">
      <label><Search :size="15" aria-hidden="true" /><input v-model="query" type="search" aria-label="搜索对话" placeholder="搜索记录" :disabled="deleting" /></label>
      <button ref="selectionTrigger" type="button" class="studio-tool" aria-label="多选对话" title="多选对话" :aria-pressed="selecting" :disabled="deleting || !chats.sessions.length" @click="selecting ? cancelSelection() : selecting = true"><ListChecks :size="17" /></button>
    </div>
    <nav class="conversation-records" aria-label="历史对话">
      <template v-for="chat in conversations" :key="chat.id">
        <label v-if="selecting" class="conversation-record studio-record" :class="{ selected: selectedIds.has(chat.id) }">
          <input type="checkbox" :aria-label="`选择对话：${chat.topic}`" :checked="selectedIds.has(chat.id)" :disabled="deleting" @change="toggle(chat.id)" /><span>{{ chat.topic }}</span><LoaderCircle v-if="chats.busy[chat.id]" :size="14" aria-label="正在生成" />
        </label>
        <button v-else type="button" class="conversation-record studio-record" :class="{ active: chat.id === chats.activeId }" :aria-current="chat.id === chats.activeId ? 'page' : undefined" :title="chat.topic" @click="emit('select', chat.id)"><MessageSquare :size="17" aria-hidden="true" /><span>{{ chat.topic }}</span><LoaderCircle v-if="chats.busy[chat.id]" :size="14" aria-label="正在生成" /></button>
      </template>
      <p v-if="!conversations.length" class="conversation-empty">{{ query ? '没有匹配的记录' : '暂无对话记录' }}</p>
    </nav>
    <div v-if="selecting" class="conversation-selection" role="toolbar" aria-label="对话多选">
      <button type="button" class="studio-tool" :aria-label="allSelected ? '取消全选' : '全选'" :title="allSelected ? '取消全选' : '全选'" :disabled="deleting || !conversations.length" @click="toggleAll"><ListChecks :size="18" /></button>
      <span role="status">已选 {{ selected.length }} 项</span>
      <button type="button" class="studio-tool" aria-label="删除所选" :title="busySelected ? '请先停止所选对话' : '删除所选'" :disabled="deleting || !selected.length || busySelected" @click="deleteSelected"><LoaderCircle v-if="deleting" :size="17" /><Trash2 v-else :size="17" /></button>
      <button type="button" class="studio-tool" aria-label="取消多选" title="取消多选" :disabled="deleting" @click="cancelSelection(true)"><X :size="18" /></button>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.studio-conversations { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.conversation-search { display: flex; align-items: center; gap: 4px; flex: none; }
.conversation-search label { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; min-height: 40px; padding: 4px 12px; color: var(--muted); }
.conversation-search input { min-width: 0; width: 100%; padding: 8px 0; border: 0; outline: none; background: transparent; font-size: 12px; }
.conversation-search label:focus-within { outline: 1px solid var(--muted); border-radius: 6px; }
.conversation-records { flex: 1; min-height: 0; overflow-y: auto; margin-top: 8px; scrollbar-color: var(--border) transparent; }
.conversation-record { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 8px 12px; text-align: left; border-radius: 8px; color: var(--muted); cursor: pointer; }
.conversation-record > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-record > svg, .conversation-record > input { flex: none; }
.conversation-record > input { width: 16px; height: 16px; margin: 0; accent-color: var(--ink); }
.conversation-record.active, .conversation-record.selected, .conversation-record:hover { color: var(--ink); background: var(--surface-soft); }
.conversation-empty { margin: 0; padding: 8px 12px; font-size: 12px; line-height: 20px; color: var(--muted); }
.conversation-selection { display: flex; align-items: center; gap: 4px; flex: none; padding-top: 8px; color: var(--muted); }
.conversation-selection > span { flex: 1; min-width: 0; white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.conversation-selection .studio-tool { min-width: 36px; min-height: 44px; }
.form-error { font-size: 12px; margin-top: 8px; overflow-wrap: anywhere; }
</style>
