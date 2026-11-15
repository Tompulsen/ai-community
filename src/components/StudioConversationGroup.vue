<!-- List interactions adapted from octopus_chat chat-list.tsx (MIT). -->
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { GripVertical, Image as ImageIcon, LoaderCircle, MessageSquare, Pencil, Video } from '@lucide/vue'
import { VueDraggable } from 'vue-draggable-plus'
import type { NativeChat } from '../native-chat'
import { conversationKind, isConversationBusy } from '../studio-conversations'

const props = defineProps<{
  items: NativeChat[]
  activeId: string
  selecting: boolean
  selectedIds: Set<string>
  disabled?: boolean
  sortable?: boolean
  onReorder: (source: string, target: string) => Promise<boolean>
}>()
const emit = defineEmits<{ select: [id: string]; toggle: [id: string]; rename: [chat: NativeChat] }>()
const rows = ref<NativeChat[]>([...props.items])
let previousIds: string[] = []
watch(() => props.items, value => { rows.value = [...value] })
async function reordered(event: { oldIndex?: number; newIndex?: number }) {
  const from = event.oldIndex, to = event.newIndex
  if (from === undefined || to === undefined || from === to) return
  const source = previousIds[from], target = previousIds[to]
  if (!source || !target || !await props.onReorder(source, target)) rows.value = [...props.items]
}
async function keyboardMove(event: KeyboardEvent, id: string, direction: number) {
  if (!event.altKey || props.disabled || props.selecting || !props.sortable) return
  event.preventDefault(); event.stopPropagation()
  const trigger = event.currentTarget as HTMLButtonElement
  const index = props.items.findIndex(chat => chat.id === id)
  const target = props.items[index + direction]
  if (target) {
    await props.onReorder(id, target.id)
    await nextTick()
    if (trigger.isConnected) trigger.focus({ preventScroll: true })
  }
}
const icon = (chat: NativeChat) => ({ text: MessageSquare, image: ImageIcon, video: Video })[conversationKind(chat)]
</script>

<template>
  <VueDraggable v-model="rows" class="conversation-group" :animation="0" handle=".conversation-drag-handle" draggable=".conversation-row" :disabled="disabled || selecting || !sortable" :delay="180" :delay-on-touch-only="true" :touch-start-threshold="5" ghost-class="conversation-drag-ghost" @start="previousIds = rows.map(chat => chat.id)" @end="reordered">
    <div v-for="chat in rows" :key="chat.id" class="conversation-row" :data-conversation-id="chat.id" :data-project-id="chat.projectId || ''">
      <label v-if="selecting" class="conversation-record studio-record" :data-kind="conversationKind(chat)" :class="{ selected: selectedIds.has(chat.id) }">
        <input type="checkbox" :aria-label="`选择对话：${chat.topic}`" :checked="selectedIds.has(chat.id)" :disabled="disabled" @change="emit('toggle', chat.id)" />
        <span>{{ chat.topic }}</span><LoaderCircle v-if="isConversationBusy(chat)" :size="14" aria-label="尚未结束" />
      </label>
      <template v-else>
        <button type="button" class="conversation-record studio-record" :data-kind="conversationKind(chat)" :class="{ active: chat.id === activeId }" :aria-current="chat.id === activeId ? 'page' : undefined" :title="chat.topic" :disabled="disabled" @click="emit('select', chat.id)">
          <component :is="icon(chat)" :size="17" aria-hidden="true" /><span>{{ chat.topic }}</span><LoaderCircle v-if="isConversationBusy(chat)" :size="14" aria-label="尚未结束" />
        </button>
        <button type="button" class="row-tool conversation-rename" :aria-label="`重命名对话：${chat.topic}`" title="重命名对话" :disabled="disabled" @click="emit('rename', chat)"><Pencil :size="14" /></button>
        <button type="button" class="row-tool conversation-drag-handle" :aria-label="`调整会话顺序：${chat.topic}`" title="拖动排序，Alt + 方向键调整" :disabled="disabled || !sortable" @keydown.up="keyboardMove($event, chat.id, -1)" @keydown.down="keyboardMove($event, chat.id, 1)"><GripVertical :size="15" /></button>
      </template>
    </div>
  </VueDraggable>
</template>

<style scoped>
.conversation-group { min-width: 0; }
.conversation-row { display: flex; align-items: center; gap: 0; min-width: 0; border-radius: 8px; }
.conversation-record { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; min-height: 48px; padding: 8px 10px; text-align: left; border: 0; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; }
.conversation-record > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-record > svg, .conversation-record > input { flex: none; }
.conversation-record > input { width: 16px; height: 16px; margin: 0; accent-color: var(--ink); }
.conversation-record.active, .conversation-record.selected, .conversation-record:hover { color: var(--ink); background: var(--surface-soft); }
.row-tool { display: grid; place-items: center; flex: none; width: 26px; height: 36px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer; }
.row-tool:hover { color: var(--ink); background: var(--surface-soft); }
.conversation-drag-handle { cursor: grab; touch-action: none; }
.conversation-drag-handle:active { cursor: grabbing; }
.row-tool:disabled, .conversation-record:disabled { cursor: default; opacity: .55; }
.conversation-drag-ghost { opacity: .45; }
.conversation-record:focus-visible, .row-tool:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
@media (hover: hover) and (pointer: fine) { .row-tool { opacity: 0; }.conversation-row:hover .row-tool, .conversation-row:focus-within .row-tool { opacity: 1; } }
@media (pointer: coarse), (max-width: 639px) { .row-tool { width: 36px; height: 44px; }.conversation-record { padding-inline: 8px; } }
</style>
