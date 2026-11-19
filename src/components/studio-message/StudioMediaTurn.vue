<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Copy, Download, Maximize, Pencil, Play, RefreshCw, Trash2, Upload } from '@lucide/vue'
import { copyCreationImage, creationRequestTimedOut, downloadCreation, mediaSource, resumeCreation, type CreationDestination, type CreationTask } from '../../native-studio'
import { chats, type NativeChat } from '../../native-chat'
import { confirmStudioDelete } from '../../studio-confirm'
import { isConversationBusy } from '../../studio-conversations'
import { deleteMediaTurns, mediaVersion, selectMediaVersion } from '../../studio-image-conversation'
import { errorMessage, notify, session } from '../../state'
import StudioMessageFrame from './StudioMessageFrame.vue'
import StudioAiStatus from './StudioAiStatus.vue'
import StudioCreationImage from './StudioCreationImage.vue'
import StudioContextMenu, { type StudioMenuAction } from './StudioContextMenu.vue'

const props = defineProps<{ task: CreationTask; conversation: NativeChat; role: 'user' | 'assistant' }>()
const emit = defineEmits<{
  action: [action: 'editTask' | 'regenerate' | 'useTask' | 'chooseReference', task: CreationTask, index?: number]
  publish: [task: CreationTask, destination: CreationDestination]
  preview: [task: CreationTask, index: number]
}>()
const error = ref(''), now = ref(Date.now())
const busy = computed(() => isConversationBusy(props.conversation))
const menu = ref<InstanceType<typeof StudioContextMenu>>()
const menuIndex = ref(0)
function openMenu(event: MouseEvent) {
  const root = event.currentTarget as HTMLElement, figure = (event.target as Element).closest('figure')
  const index = figure ? [...root.querySelectorAll('.creation-media > figure')].indexOf(figure) : -1
  menuIndex.value = Math.max(0, index)
  void menu.value?.open(event)
}
const menuItems = computed<StudioMenuAction[]>(() => {
  const task = props.task
  const items: StudioMenuAction[] = props.role === 'user' ? [
    { label: '复制提问', icon: Copy, run: async () => { await navigator.clipboard.writeText(task.prompt); notify('已复制。') } },
    { label: '编辑并重新生成', icon: Pencil, disabled: busy.value, run: () => emit('action', 'editTask', task) },
  ] : [
    ...(task.urls.length ? [{ label: task.kind === 'video' ? '放大视频' : '查看大图', icon: Maximize, run: () => emit('preview', task, menuIndex.value) },
      { label: task.kind === 'video' ? '下载视频' : '下载图片', icon: Download, run: () => perform(() => downloadCreation(task, menuIndex.value)) }] : []),
    ...(task.kind === 'image' && task.urls.length ? [{ label: '复制图片', icon: Copy, run: () => perform(async () => { await copyCreationImage(task, menuIndex.value); notify('图片已复制') }) }] : []),
    { label: '重新生成此轮', icon: RefreshCw, disabled: busy.value, run: () => emit('action', 'regenerate', task) },
  ]
  return [...items, { label: '删除此轮消息', icon: Trash2, danger: true, disabled: busy.value, run: remove }]
})
watch(() => [session.user?.id, props.conversation.id, props.task.id], () => menu.value?.close())
const working = computed(() => ['submitting', 'running'].includes(props.task.phase))
const timedOut = computed(() => creationRequestTimedOut(props.task))
const version = computed(() => mediaVersion(props.conversation, props.task.id))
const phases: Record<string, string> = { submitting: '正在提交', running: '正在生成', paused: '等待已暂停', complete: '生成完成', error: '生成失败', attention: '结果待确认' }
const elapsed = computed(() => {
  if (timedOut.value || props.task.phase === 'paused' || props.task.phase === 'attention') return ''
  const end = working.value ? now.value : props.task.settledAt
  if (!Number.isFinite(end)) return ''
  const seconds = Math.max(0, Math.floor((end! - props.task.createdAt) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
})
let timer: ReturnType<typeof setInterval> | undefined
watch(working, value => {
  clearInterval(timer); now.value = Date.now()
  if (value) timer = setInterval(() => { now.value = Date.now() }, 1000)
}, { immediate: true })
onUnmounted(() => clearInterval(timer))
async function perform(operation: () => Promise<unknown>) {
  error.value = ''
  try { await operation() } catch (cause) { error.value = errorMessage(cause) }
}
async function remove() {
  const chat = props.conversation, task = props.task
  if (busy.value || !await confirmStudioDelete('删除 1 轮对话记录？生成图片仍保留在图库。', () => chats.activeId === chat.id && chats.sessions.includes(chat) && props.task === task && !busy.value)) return
  await perform(() => deleteMediaTurns(chat, [task.id]))
}
</script>

<template>
  <StudioMessageFrame :role="role" :model="task.model" :created-at="task.createdAt" :class="[role === 'user' ? 'creation-request' : 'creation-response', { 'compact-image-response': role === 'assistant' && task.kind === 'image' }]" :aria-label="role === 'user' ? '已发送的创作请求' : '模型生成结果'" tabindex="-1" @contextmenu="openMenu">
    <template #status>
      <template v-if="role === 'assistant'">
        <StudioAiStatus v-if="working" class="task-status" :state="task.preview ? 'writing' : 'thinking'" :label="task.kind === 'video' ? '正在生成视频' : task.preview ? '正在生成图片' : undefined" :timer="false" :elapsed="elapsed" />
        <template v-else><span class="task-status" :class="{ 'studio-sr-only': task.phase === 'complete', 'task-error': task.phase === 'error' }" :role="task.phase === 'error' ? 'alert' : 'status'">{{ task.phase === 'error' && timedOut ? '请求超时' : phases[task.phase] }}</span><span v-if="elapsed" class="task-elapsed">{{ elapsed }}</span></template>
      </template>
    </template>
    <template v-if="role === 'user'">
      <div class="creation-request-body message-bubble"><p>{{ task.prompt }}</p><div v-if="task.references.length" class="sent-references"><img v-for="(file, index) in task.references" :key="file.url" :src="mediaSource(file.url)" :alt="`参考图 ${index + 1}：${file.name}`" loading="lazy" /></div></div>
      <div class="creation-turn-tools message-actions"><button class="icon-button" type="button" aria-label="编辑并重新生成" title="编辑并重新生成" :disabled="busy" @click="emit('action', 'editTask', task)"><Pencil :size="15" /></button><button class="icon-button" type="button" aria-label="删除此轮消息" title="删除此轮消息" :disabled="busy" @click="remove"><Trash2 :size="15" /></button></div>
    </template>
    <template v-else>
      <progress v-if="working && task.progress != null" class="generation-progress" :value="task.progress" max="100" aria-label="模型返回的生成进度" />
      <p v-if="task.error && task.phase === 'error'" class="task-message">{{ task.error }}</p>
      <div v-if="task.phase === 'paused' || task.phase === 'attention' || task.phase === 'error'" class="creation-recovery">
        <button v-if="task.phase !== 'error'" class="studio-tool" @click="perform(() => resumeCreation(task))"><Play :size="15" />查询结果</button><button v-else class="button subtle btn" @click="emit('action', 'editTask', task)"><Pencil :size="15" />编辑后重试</button>
        <details v-if="task.error && task.phase !== 'error'" class="task-details"><summary>查看详情</summary><p>{{ task.error }}</p></details>
      </div>
      <img v-if="task.preview && task.phase !== 'complete'" class="stream-preview" :src="mediaSource(task.preview)" alt="生成中的预览" />
      <div v-if="task.urls.length" class="creation-media"><figure v-for="(url, index) in task.urls" :key="url">
        <template v-if="task.kind === 'video'"><video :src="mediaSource(url, false, 'video')" controls playsinline preload="metadata" @dblclick="emit('preview', task, index)" /><button class="icon-button video-expand" type="button" title="放大视频" aria-label="放大视频" @click="emit('preview', task, index)"><Maximize :size="17" /></button></template>
        <StudioCreationImage v-else :src="mediaSource(url) || ''" :alt="task.prompt" :label="`查看大图：预览生成图片 ${index + 1}`" @open="emit('preview', task, index)" />
      </figure></div>
      <div v-else-if="task.text" class="creation-text"><pre>{{ task.text }}</pre></div>
      <div v-if="task.phase === 'complete'" class="creation-message-actions" role="group" aria-label="生成结果操作">
        <button class="studio-tool" @click="emit('publish', task, 'community')"><Upload :size="15" />发布作品</button>
        <button v-for="(url, index) in task.urls" :key="url" class="studio-tool" @click="perform(() => downloadCreation(task, index))"><Download :size="16" />下载{{ task.urls.length > 1 ? ` ${index + 1}` : '' }}</button>
        <button v-if="!task.urls.length && task.text" class="studio-tool" @click="perform(() => downloadCreation(task))"><Download :size="16" />下载文本</button>
        <button v-if="task.kind !== 'video' && task.sourceWorkId" class="studio-tool" @click="emit('publish', task, 'source-comment')"><Upload :size="15" />发送到源作品评论区</button>
        <button class="studio-tool" @click="emit('action', 'useTask', task)"><Pencil :size="15" />复用参数</button>
        <button class="icon-button" type="button" aria-label="重新生成此轮" title="重新生成此轮" :disabled="busy" @click="emit('action', 'regenerate', task)"><RefreshCw :size="16" /></button>
      </div>
      <div v-if="version.total > 1" class="creation-versions" role="group" aria-label="生成版本"><button class="icon-button" type="button" aria-label="上一个版本" title="上一个版本" :disabled="busy || version.index === 0" @click="perform(() => selectMediaVersion(conversation, task.id, -1))"><ChevronLeft :size="16" /></button><output aria-label="当前生成版本">{{ version.index + 1 }} / {{ version.total }}</output><button class="icon-button" type="button" aria-label="下一个版本" title="下一个版本" :disabled="busy || version.index >= version.total - 1" @click="perform(() => selectMediaVersion(conversation, task.id, 1))"><ChevronRight :size="16" /></button></div>
    </template>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <StudioContextMenu ref="menu" :items="menuItems" />
  </StudioMessageFrame>
</template>

<style scoped>
.creation-request-body p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.sent-references { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }.sent-references img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; }
.creation-turn-tools, .creation-versions, .creation-message-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.creation-turn-tools { justify-content: flex-end; margin-top: 12px; }
.creation-turn-tools .icon-button { width: 32px; min-height: 32px; }
.creation-versions { margin-top: 8px; width: fit-content; }.creation-versions output, .task-elapsed { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.creation-message-actions { margin-top: 12px; gap: 4px 12px; }
.compact-image-response :deep(.message-heading) { min-height: 28px; margin-bottom: 8px; gap: 6px; }
.compact-image-response :deep(.message-avatar) { width: 24px; height: 24px; }
.compact-image-response .creation-message-actions { margin-top: 8px; gap: 4px 8px; }
.compact-image-response .creation-media { width: min(680px, 100%); grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); }
.generation-progress { display: block; width: min(100%, 360px); height: 4px; margin-bottom: 12px; accent-color: var(--muted); }
.task-status { color: var(--muted); font-size: 12px; }.task-error { color: var(--danger, #b64646); }
.task-message { color: var(--danger); font-size: 14px; line-height: 24px; margin-block: 0 16px; overflow-wrap: anywhere; }
.creation-recovery { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 8px; }
.task-details { color: var(--muted); font-size: 12px; line-height: 20px; }.task-details summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; }.task-details p { margin: 0; max-width: 65ch; overflow-wrap: anywhere; }
.stream-preview { display: block; max-width: 100%; max-height: 480px; }
.creation-media { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 16px; width: min(880px, 100%); }
.creation-media figure { position: relative; margin: 0; min-width: 0; }.video-expand { position: absolute; top: 8px; right: 8px; color: white; background: rgb(0 0 0 / 65%); }
.creation-media video { width: 100%; max-height: 600px; display: block; object-fit: contain; }
.creation-text pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 28px; margin: 0; max-width: 72ch; }
@media (min-width: 1000px) { .creation-media { gap: 4px; }.creation-media video { height: min(440px, 32dvh); background: var(--surface); } }
@media (max-width: 639px) { .creation-message-actions { gap: 4px; }.creation-media video { max-height: 44dvh; } }
@media (pointer: coarse), (max-width: 639px) { .creation-turn-tools .icon-button { min-height: 44px; width: 44px; } }
@media (hover: hover) and (pointer: fine) { .creation-turn-tools { opacity: 0; }.creation-request:hover .creation-turn-tools, .creation-request:focus-within .creation-turn-tools { opacity: 1; } }
</style>
