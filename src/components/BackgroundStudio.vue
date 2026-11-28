<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Grip, LoaderCircle, Minus, X } from '@lucide/vue'
import { creation, initializeCreation, readCreationImage, type CreationTask } from '../native-studio'
import { errorMessage, session } from '../state'

const route = useRoute(), router = useRouter()
const hidden = ref(false), selectedId = ref(''), error = ref('')
const unread = ref<string[]>([]), dock = ref<HTMLElement>(), handle = ref<HTMLButtonElement>()
const point = ref<{ x: number; y: number }>(), dragging = ref(false)
let pointer: { id: number; x: number; y: number; left: number; top: number; target: HTMLElement } | undefined
const position = computed(() => point.value ? { left: `${point.value.x}px`, top: `${point.value.y}px`, right: 'auto', bottom: 'auto' } : {})
const studioPage = computed(() => route.path === '/create' || route.path.startsWith('/create/'))
const active = (phase: string) => ['submitting', 'running'].includes(phase)
const labels = { submitting: '正在提交', running: '正在生成', complete: '生成完成', error: '生成失败', paused: '已停止等待', attention: '结果待确认' }
const chatState = shallowRef<typeof import('../native-chat').chats>()
watch(() => session.user?.id, async owner => {
  chatState.value = undefined
  if (!owner) return
  await initializeCreation()
  if (owner !== session.user?.id) return
  const { chats, loadChats } = await import('../native-chat')
  if (owner !== session.user?.id) return
  await loadChats()
  if (owner === session.user?.id) chatState.value = chats
}, { immediate: true })
const deletedTasks = computed(() => new Set(chatState.value?.sessions.flatMap(chat => chat.deletedMediaTaskIds || [])))
const deletedConversations = computed(() => new Set(chatState.value?.deletedMediaConversationIds))
function visible(value: CreationTask) {
  return chatState.value?.ready && !deletedTasks.value.has(value.id)
    && !deletedConversations.value.has(`${value.kind}:${value.conversationId || value.id}`)
}
watch(() => ({
  owner: session.user?.id, studio: studioPage.value,
  phases: new Map(creation.tasks.filter(item => item.owner === session.user?.id).map(item => [item.id, item.phase])),
  restoring: new Set(creation.restoringTaskIds),
}), (current, previous) => {
  if (current.owner !== previous?.owner) { hidden.value = false; selectedId.value = ''; point.value = undefined; error.value = ''; stopDrag() }
  if (!current.owner || current.owner !== previous?.owner || current.studio) unread.value = []
  else {
    const settled = [...current.phases].filter(([id, phase]) => !active(phase) && !current.restoring.has(id)
      && (active(previous?.phases.get(id) || '') || phase === 'complete' && previous?.restoring.has(id))).map(([id]) => id)
    unread.value = [...new Set([...unread.value, ...settled])].filter(id => current.phases.has(id))
  }
  // Recovery can finish before this async component mounts; consume this page's events once.
  const recovered = [...creation.recoveredTaskIds].filter(id => current.phases.get(id) === 'complete' && !current.restoring.has(id))
  if (current.owner && !current.studio) unread.value = [...new Set([...unread.value, ...recovered])]
  for (const id of recovered) creation.recoveredTaskIds.delete(id)
}, { immediate: true, flush: 'sync' })
const tasks = computed(() => creation.tasks.filter(item => item.owner === session.user?.id && visible(item)
  && !creation.restoringTaskIds.has(item.id) && (active(item.phase) || unread.value.includes(item.id))))
const task = computed(() => tasks.value.find(item => item.id === selectedId.value) || tasks.value[0])
const preview = ref('')
watch([() => session.user?.id, () => !hidden.value && !studioPage.value && task.value?.kind === 'image' && task.value.phase === 'complete' ? task.value.urls[0] : undefined], ([, url], _, cleanup) => {
  preview.value = ''
  if (!url) return
  const controller = new AbortController()
  let objectUrl = ''
  cleanup(() => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); preview.value = '' })
  void readCreationImage(url, controller.signal, true).then(blob => {
    if (!controller.signal.aborted) preview.value = objectUrl = URL.createObjectURL(blob)
  }).catch(() => { /* The result remains accessible from the task even if its preview fails. */ })
}, { immediate: true })
const index = computed(() => tasks.value.findIndex(item => item.id === task.value?.id))
const running = computed(() => tasks.value.filter(item => active(item.phase)).length)
const summary = computed(() => [running.value ? `${running.value} 项进行中` : '', tasks.value.length - running.value ? `${tasks.value.length - running.value} 项待查看` : ''].filter(Boolean).join(' · '))
watch(() => task.value?.id, id => { selectedId.value = id || ''; error.value = '' })
watch(() => task.value && ['error', 'attention'].includes(task.value.phase) && !studioPage.value ? task.value.id : '', (id, _, cleanup) => {
  if (!id) return
  const timer = setTimeout(() => { void dismiss(id) }, 8000)
  cleanup(() => clearTimeout(timer))
})
const progress = computed(() => typeof task.value?.progress === 'number' && Number.isFinite(task.value.progress) ? Math.max(0, Math.min(100, task.value.progress)) : undefined)
async function open(value: CreationTask) {
  const owner = session.user?.id
  error.value = ''
  try {
    const [{ chats, loadChats }, { ensureMediaConversation, syncMediaConversations }] = await Promise.all([import('../native-chat'), import('../studio-conversations')])
    await loadChats(); await syncMediaConversations()
    if (!owner || owner !== session.user?.id || value.owner !== owner || !visible(value)) return
    creation.selectedId = value.id
    const conversation = value.kind === 'text' ? chats.sessions.find(chat => chat.messages.some(message => message.taskId === value.id)) : ensureMediaConversation(value.kind, value)
    await router.push({ path: `/create/${value.kind}`, query: conversation ? { conversation: conversation.id } : { reuse: value.id } })
  } catch (cause) { if (owner === session.user?.id) error.value = errorMessage(cause) }
}
function clamp(x: number, y: number) {
  const rect = dock.value?.getBoundingClientRect(), viewport = window.visualViewport
  const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0
  const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight
  const bottom = innerWidth < 1000 ? 80 : 8
  return { x: Math.max(left + 8, Math.min(x, left + width - (rect?.width || 300) - 8)), y: Math.max(top + 8, Math.min(y, top + height - (rect?.height || 200) - bottom)) }
}
function resize() { if (point.value) point.value = clamp(point.value.x, point.value.y) }
function startDrag(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || pointer || !dock.value) return
  const rect = dock.value.getBoundingClientRect(), target = event.currentTarget as HTMLElement
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, target }
  target.setPointerCapture(event.pointerId)
}
function moveDrag(event: PointerEvent) {
  if (!pointer || event.pointerId !== pointer.id) return
  const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y
  if (!dragging.value && Math.hypot(dx, dy) < 4) return
  dragging.value = true; point.value = clamp(pointer.left + dx, pointer.top + dy)
}
function stopDrag() {
  const previous = pointer; pointer = undefined; dragging.value = false
  if (previous?.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id)
}
function moveByKey(event: KeyboardEvent) {
  const delta: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }
  const step = delta[event.key], rect = dock.value?.getBoundingClientRect()
  if (!step || !rect) return
  event.preventDefault(); point.value = clamp(rect.left + step[0], rect.top + step[1])
}
async function toggle() { hidden.value = !hidden.value; stopDrag(); await nextTick(); resize(); handle.value?.focus() }
async function dismiss(id: string) {
  const focused = dock.value?.contains(document.activeElement)
  unread.value = unread.value.filter(value => value !== id)
  error.value = ''; stopDrag()
  await nextTick(); resize(); if (focused) handle.value?.focus()
}
const observer = new ResizeObserver(resize)
watch(dock, element => { observer.disconnect(); if (element) observer.observe(element) }, { flush: 'post' })
onMounted(() => { window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', resize) })
onBeforeUnmount(() => { stopDrag(); observer.disconnect(); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize) })
</script>

<template>
  <aside v-if="session.user && task && !studioPage" ref="dock" class="background-dock" :class="{ minimized: hidden, dragging }" :style="position" aria-label="后台生成任务">
    <div class="dock-heading">
      <button ref="handle" class="icon-button dock-drag" aria-label="拖动生成小窗" title="拖动移动，也可用方向键移动" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag" @keydown="moveByKey"><Grip :size="18" /></button>
      <button v-if="hidden" class="dock-restore" aria-label="展开生成任务" :aria-expanded="false" @click="toggle"><span>{{ labels[task.phase] }}</span><span class="caption-5">{{ summary }}</span></button>
      <template v-else><div class="dock-title"><strong>后台生成</strong><span class="caption-5 muted">{{ summary }}</span></div><button class="icon-button" aria-label="收起生成任务" :aria-expanded="true" title="隐藏小窗，生成继续" @click="toggle"><Minus :size="18" /></button><button v-if="!active(task.phase)" class="icon-button" aria-label="关闭此提醒" title="关闭提醒，任务记录保留在工作台" @click="dismiss(task.id)"><X :size="18" /></button></template>
    </div>
    <template v-if="!hidden">
      <div class="dock-content" role="status"><CheckCircle2 v-if="task.phase === 'complete'" :size="20" aria-hidden="true" /><LoaderCircle v-else-if="active(task.phase)" :size="20" aria-hidden="true" /><CircleAlert v-else :size="20" aria-hidden="true" /><div><strong>{{ labels[task.phase] }}<span v-if="progress !== undefined && task.phase === 'running'"> · {{ Math.round(progress) }}%</span></strong><p>{{ task.prompt || task.model }}</p><span class="caption-5 muted">{{ task.model }}</span></div></div>
      <button v-if="preview" class="dock-preview" aria-label="打开生成结果" @click="open(task)"><img :src="preview" alt="本次生成的图片" decoding="async" /></button>
      <p v-if="error || task.error && !active(task.phase)" class="dock-error" :class="task.phase === 'paused' ? 'muted' : 'form-error'" :role="task.phase === 'paused' ? 'status' : 'alert'">{{ error || task.error }}</p>
      <p v-if="task.phase === 'error' || task.phase === 'attention'" class="dock-note caption-5 muted">{{ task.phase === 'attention' ? '尚未确认生成结果，可在工作台查询原任务。此提醒稍后自动关闭。' : '记录已保留在工作台，此提醒稍后自动关闭。' }}</p>
      <div class="dock-actions"><button class="button primary btn" @click="open(task)">{{ task.phase === 'complete' ? '查看结果' : '查看任务' }}<ArrowUpRight :size="15" /></button><template v-if="tasks.length > 1"><span class="dock-page caption-5 muted">第 {{ index + 1 }} / {{ tasks.length }} 项</span><button class="icon-button" aria-label="上一个任务" @click="selectedId = tasks[(index + tasks.length - 1) % tasks.length]!.id"><ChevronLeft :size="18" /></button><button class="icon-button" aria-label="下一个任务" @click="selectedId = tasks[(index + 1) % tasks.length]!.id"><ChevronRight :size="18" /></button></template></div>
    </template>
  </aside>
</template>

<style scoped>
.background-dock { position: fixed; z-index: 45; right: 24px; bottom: 24px; width: min(320px, calc(100vw - 32px)); max-height: calc(100dvh - 100px); overflow-y: auto; border-radius: 8px; background: var(--surface); color: var(--ink); box-shadow: 0 8px 32px #0003; }
.background-dock.minimized { width: auto; max-width: calc(100vw - 16px); }
.dock-heading { display: flex; align-items: center; gap: 4px; padding: 4px; border-bottom: 1px solid var(--border); }
.minimized .dock-heading { border: 0; }
.dock-title { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 2px; }
.dock-heading strong { font-size: 14px; }
.dock-title > span { font-size: 12px; }
.background-dock .icon-button { width: 44px; height: 44px; flex-shrink: 0; }
.dock-drag { touch-action: none; cursor: grab; user-select: none; }
.dragging .dock-drag { cursor: grabbing; }
.dock-restore { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-height: 44px; padding: 0 12px 0 4px; }
.dock-content { display: flex; align-items: flex-start; gap: 12px; padding: 16px; }
.dock-content > svg { flex: none; }
.dock-content > div { min-width: 0; }
.dock-content strong { font-size: 14px; }
.dock-content p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font-size: 13px; line-height: 20px; margin: 4px 0; }
.dock-content .muted { overflow-wrap: anywhere; }
.dock-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 0 12px 12px; }
.dock-actions .button { min-height: 44px; }
.dock-page { margin-left: auto; }
.dock-note { margin: 0 16px 12px; }
.dock-preview { display: block; margin: 0 16px 12px; width: calc(100% - 32px); }
.dock-preview img { display: block; width: 100%; max-height: 180px; object-fit: contain; }
.dock-error { margin: 0 16px 12px; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
@media (max-width: 999px) { .background-dock { right: 16px; bottom: calc(80px + env(safe-area-inset-bottom)); } }
</style>
