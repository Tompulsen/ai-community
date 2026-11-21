<!-- List interactions adapted from octopus_chat chat-list.tsx (MIT). -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { GripVertical, Image as ImageIcon, LoaderCircle, MessageSquare, MoreHorizontal, Video } from '@lucide/vue'
import { VueDraggable } from 'vue-draggable-plus'
import { conversationGenerating, type NativeChat } from '../native-chat'
import { conversationKind } from '../studio-conversations'
import { formatChatTime } from '../../shared/studio/chat-time'

const props = defineProps<{
  items: NativeChat[]
  activeId: string
  selecting: boolean
  selectedIds: Set<string>
  disabled?: boolean
  sortable?: boolean
  now: number
  menuId?: string
  onReorder: (source: string, target: string) => Promise<boolean>
}>()
const emit = defineEmits<{ select: [id: string]; toggle: [id: string]; menu: [event: MouseEvent, chat: NativeChat] }>()
const times = computed(() => new Map(props.items.map(chat => [chat.id, formatChatTime(chat.lastUpdate, props.now)])))
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
        <span>{{ chat.topic }}</span><LoaderCircle v-if="conversationGenerating(chat)" :size="14" aria-label="尚未结束" />
      </label>
      <template v-else>
        <button type="button" class="conversation-record studio-record" :data-kind="conversationKind(chat)" :class="{ active: chat.id === activeId }" :aria-label="chat.topic" :aria-current="chat.id === activeId ? 'page' : undefined" :title="chat.topic" :disabled="disabled" @click="emit('select', chat.id)">
          <component :is="icon(chat)" :size="17" aria-hidden="true" /><span>{{ chat.topic }}</span><LoaderCircle v-if="conversationGenerating(chat)" :size="14" aria-label="尚未结束" /><time v-else-if="times.get(chat.id)?.iso" :datetime="times.get(chat.id)!.iso" :title="times.get(chat.id)!.full" aria-hidden="true">{{ times.get(chat.id)!.label }}</time>
        </button>
        <button type="button" class="row-tool conversation-more" :aria-label="`对话操作：${chat.topic}`" title="对话操作" aria-haspopup="menu" :aria-expanded="menuId === chat.id" :disabled="disabled" @click="emit('menu', $event, chat)"><MoreHorizontal :size="15" /></button>
        <button type="button" class="row-tool conversation-drag-handle" :aria-label="`调整会话顺序：${chat.topic}`" title="拖动排序，Alt + 方向键调整" :disabled="disabled || !sortable" @keydown.up="keyboardMove($event, chat.id, -1)" @keydown.down="keyboardMove($event, chat.id, 1)"><GripVertical :size="15" /></button>
      </template>
    </div>
  </VueDraggable>
</template>

<style scoped>
.conversation-group { min-width: 0; }
.conversation-row { --conversation-tool-size: 26px; position: relative; display: flex; align-items: center; gap: 0; min-width: 0; border-radius: 8px; }
.conversation-record { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; min-height: 32px; padding: 4px 8px; text-align: left; border: 0; border-radius: 6px; color: var(--muted); background: transparent; font-size: 13px; line-height: 20px; cursor: pointer; }
.conversation-row > button.conversation-record { padding-inline-end: calc(var(--conversation-tool-size) * 2 + 12px); }
.conversation-record > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-record > svg, .conversation-record > input { flex: none; }
.conversation-record > time { flex: none; max-width: 9ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.conversation-record > input { width: 16px; height: 16px; margin: 0; accent-color: var(--ink); }
.conversation-row:hover > .conversation-record:not(:disabled):not(:has(:disabled)) { color: var(--ink); background: var(--state-hover); }
.conversation-record.active, .conversation-record.selected { color: var(--ink); background: var(--state-selected); }
.conversation-row:hover > .conversation-record:is(.active, .selected):not(:disabled):not(:has(:disabled)), .conversation-record:active:not(:disabled):not(:has(:disabled)) { color: var(--ink); background: var(--state-pressed); }
.conversation-row:hover > .conversation-record:not(:disabled):not(:has(:disabled)) > time, .conversation-record:is(.active, .selected) > time { color: var(--ink); }
.row-tool { position: absolute; z-index: 1; inset-block: 0; margin-block: auto; display: grid; place-items: center; width: var(--conversation-tool-size); height: 28px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer; }
.conversation-more { inset-inline-end: calc(var(--conversation-tool-size) + 6px); }
.conversation-drag-handle { inset-inline-end: 6px; }
.row-tool:hover:not(:disabled) { color: var(--ink); background: var(--state-hover); }
.row-tool[aria-expanded="true"] { color: var(--ink); background: var(--state-selected); }
.row-tool[aria-expanded="true"]:hover:not(:disabled), .row-tool:active:not(:disabled) { color: var(--ink); background: var(--state-pressed); }
.conversation-drag-handle { cursor: grab; touch-action: none; }
.conversation-drag-handle:active { cursor: grabbing; }
.row-tool:disabled, .conversation-record:disabled { cursor: default; opacity: .55; }
.conversation-drag-ghost { opacity: .45; }
.conversation-record:focus-visible, .row-tool:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
@media (hover: hover) and (pointer: fine) { .row-tool { opacity: 0; }.conversation-row:hover .row-tool, .conversation-row:focus-within .row-tool { opacity: 1; } }
@media (pointer: coarse), (max-width: 639px) { .conversation-row { --conversation-tool-size: 36px; }.row-tool { height: 44px; }.conversation-record { min-height: 44px; padding-inline: 8px; } }
</style>
