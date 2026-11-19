<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Grip, LoaderCircle, Minus, RefreshCw } from '@lucide/vue'
import { creation, mediaSource, resumeCreation, type CreationTask } from '../native-studio'
import { errorMessage, session } from '../state'

const route = useRoute(), router = useRouter()
const hidden = ref(false), index = ref(0), error = ref(''), checking = ref(false)
const unread = ref<string[]>([]), dock = ref<HTMLElement>(), handle = ref<HTMLButtonElement>()
const point = ref<{ x: number; y: number }>(), dragging = ref(false)
let pointer: { id: number; x: number; y: number; left: number; top: number; target: HTMLElement } | undefined
const position = computed(() => point.value ? { left: `${point.value.x}px`, top: `${point.value.y}px`, right: 'auto', bottom: 'auto' } : {})
const studioPage = computed(() => route.path === '/create' || route.path.startsWith('/create/'))
const active = (phase: string) => ['submitting', 'running'].includes(phase)
const labels = { submitting: '正在提交', running: '正在生成', complete: '生成完成', error: '生成失败', paused: '已停止等待', attention: '结果待确认' }
watch(() => ({
  owner: session.user?.id, studio: studioPage.value,
  phases: new Map(creation.tasks.filter(item => item.owner === session.user?.id).map(item => [item.id, item.phase])),
}), (current, previous) => {
  if (current.owner !== previous?.owner) { hidden.value = false; point.value = undefined; error.value = ''; checking.value = false; stopDrag() }
  if (!current.owner || current.owner !== previous?.owner || current.studio) unread.value = []
  else {
    const settled = [...current.phases].filter(([id, phase]) => !active(phase) && active(previous?.phases.get(id) || '')).map(([id]) => id)
    unread.value = [...new Set([...unread.value, ...settled])].filter(id => current.phases.has(id))
  }
  index.value = 0
}, { immediate: true, flush: 'sync' })
const tasks = computed(() => creation.tasks.filter(item => item.owner === session.user?.id && (active(item.phase) || ['paused', 'attention'].includes(item.phase) || unread.value.includes(item.id))))
const task = computed(() => tasks.value[Math.min(index.value, tasks.value.length - 1)])
const progress = computed(() => typeof task.value?.progress === 'number' && Number.isFinite(task.value.progress) ? Math.max(0, Math.min(100, task.value.progress)) : undefined)
async function open(value: CreationTask) {
  const owner = session.user?.id
  error.value = ''
  try {
    const [{ chats, loadChats }, { ensureMediaConversation, syncMediaConversations }] = await Promise.all([import('../native-chat'), import('../studio-conversations')])
    await loadChats(); await syncMediaConversations()
    if (!owner || owner !== session.user?.id || value.owner !== owner) return
    creation.selectedId = value.id
    const conversation = value.kind === 'text' ? chats.sessions.find(chat => chat.messages.some(message => message.taskId === value.id)) : ensureMediaConversation(value.kind, value)
    await router.push({ path: `/create/${value.kind}`, query: conversation ? { conversation: conversation.id } : { reuse: value.id } })
  } catch (cause) { if (owner === session.user?.id) error.value = errorMessage(cause) }
}
async function check() {
  const value = task.value, owner = session.user?.id
  if (!value || checking.value) return
  checking.value = true; error.value = ''
  try { await resumeCreation(value) }
  catch (cause) { if (owner === session.user?.id) error.value = errorMessage(cause) }
  finally { if (owner === session.user?.id) checking.value = false }
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
const observer = new ResizeObserver(resize)
watch(dock, element => { observer.disconnect(); if (element) observer.observe(element) }, { flush: 'post' })
onMounted(() => { window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', resize) })
onBeforeUnmount(() => { stopDrag(); observer.disconnect(); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize) })
</script>

<template>
  <aside v-if="session.user && task && !studioPage" ref="dock" class="background-dock" :class="{ minimized: hidden, dragging }" :style="position" aria-label="后台生成任务">
    <div class="dock-heading">
      <button ref="handle" class="icon-button dock-drag" aria-label="拖动生成小窗" title="拖动移动，也可用方向键移动" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag" @keydown="moveByKey"><Grip :size="18" /></button>
      <button v-if="hidden" class="dock-restore" aria-label="展开生成任务" @click="toggle"><span>{{ labels[task.phase] }}</span><span class="caption-5">{{ tasks.length }} 个任务</span></button>
      <template v-else><strong>后台生成 · {{ index + 1 }}/{{ tasks.length }}</strong><button class="icon-button" aria-label="收起生成任务" title="隐藏小窗，生成继续" @click="toggle"><Minus :size="18" /></button></template>
    </div>
    <template v-if="!hidden">
      <div class="dock-content" role="status" aria-live="polite"><CheckCircle2 v-if="task.phase === 'complete'" :size="20" /><LoaderCircle v-else-if="active(task.phase)" :size="20" /><CircleAlert v-else :size="20" /><div><strong>{{ labels[task.phase] }}<span v-if="progress !== undefined && task.phase === 'running'"> · {{ Math.round(progress) }}%</span></strong><p>{{ task.prompt || task.model }}</p><span class="caption-5 muted">{{ task.model }}</span></div></div>
      <button v-if="task.kind === 'image' && task.phase === 'complete' && task.urls[0]" class="dock-preview" aria-label="打开生成结果" @click="open(task)"><img :src="mediaSource(task.urls[0])" alt="本次生成的图片" /></button>
      <p v-if="error || task.phase === 'error' && task.error" class="dock-error form-error" role="alert">{{ error || task.error }}</p>
      <details v-if="task.error && (task.phase === 'paused' || task.phase === 'attention')" :key="task.id" class="dock-note muted"><summary>查看详情</summary><p>{{ task.error }}</p></details>
      <div class="dock-actions"><button class="button primary btn" @click="open(task)">{{ task.phase === 'complete' ? '查看结果' : '查看任务' }}<ArrowUpRight :size="15" /></button><button v-if="task.phase === 'paused' || task.phase === 'attention'" class="button btn" :disabled="checking" @click="check"><RefreshCw :size="16" />{{ checking ? '查询中…' : '查询结果' }}</button><template v-if="tasks.length > 1"><button class="icon-button" aria-label="上一个任务" @click="index = (index + tasks.length - 1) % tasks.length"><ChevronLeft :size="18" /></button><button class="icon-button" aria-label="下一个任务" @click="index = (index + 1) % tasks.length"><ChevronRight :size="18" /></button></template></div>
    </template>
  </aside>
</template>

<style scoped>
.background-dock { position: fixed; z-index: 45; right: 24px; bottom: 24px; width: min(320px, calc(100vw - 32px)); max-height: calc(100dvh - 100px); overflow-y: auto; border-radius: 8px; background: var(--surface); color: var(--ink); box-shadow: 0 8px 32px #0003; }
.background-dock.minimized { width: auto; max-width: calc(100vw - 16px); }
.dock-heading { display: flex; align-items: center; gap: 4px; padding: 4px; border-bottom: 1px solid var(--border); }
.minimized .dock-heading { border: 0; }
.dock-heading strong { flex: 1; font-size: 14px; }
.background-dock .icon-button { width: 44px; height: 44px; flex-shrink: 0; }
.dock-drag { touch-action: none; cursor: grab; user-select: none; }
.dragging .dock-drag { cursor: grabbing; }
.dock-restore { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px 0 4px; }
.dock-content { display: flex; align-items: flex-start; gap: 12px; padding: 16px; }
.dock-content > svg { flex: none; }
.dock-content > div { min-width: 0; }
.dock-content strong { font-size: 14px; }
.dock-content p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font-size: 13px; line-height: 20px; margin: 4px 0; }
.dock-content .muted { overflow-wrap: anywhere; }
.dock-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 0 12px 12px; }
.dock-actions .button { min-height: 44px; }
.dock-preview { display: block; margin: 0 16px 12px; width: calc(100% - 32px); }
.dock-preview img { display: block; width: 100%; max-height: 180px; object-fit: contain; }
.dock-error, .dock-note { margin: 0 16px 12px; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
.dock-note summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; }.dock-note p { margin: 0; }
@media (max-width: 999px) { .background-dock { right: 16px; bottom: calc(80px + env(safe-area-inset-bottom)); } }
</style>
