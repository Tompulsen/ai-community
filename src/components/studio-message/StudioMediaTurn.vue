<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue'
import { ChevronLeft, ChevronRight, Copy, ImageUp, Maximize, MessageCircleReply, Pin, PinOff, RefreshCw, Square, Trash2 } from '@lucide/vue'
import { copyCreationImage, creationRequestTimedOut, downloadCreationSelection, mediaSource, resumeCreation, stopCreation, type CreationDestination, type CreationTask } from '../../native-studio'
import { chats, togglePinnedMessage, type NativeChat } from '../../native-chat'
import { branchMessages } from '../../../shared/studio/chat-branches'
import { confirmStudioDelete } from '../../studio-confirm'
import { chooseImageDownloadFormat } from '../../image-download-choice'
import { isConversationBusy } from '../../studio-conversations'
import { deleteMediaTurns, mediaVersion, selectMediaVersion } from '../../studio-image-conversation'
import { errorMessage, notify, session } from '../../state'
import StudioMessageFrame from './StudioMessageFrame.vue'
import StudioInsufficientCredits from '../StudioInsufficientCredits.vue'
import { isInsufficientCredits } from '../../../shared/studio/insufficient-credits'
import StudioAiStatus from './StudioAiStatus.vue'
import StudioCreationImage from './StudioCreationImage.vue'
import StudioInlineVideo from './StudioInlineVideo.vue'
import StudioBrowserSave from '../StudioBrowserSave.vue'
import StudioContextMenu, { type StudioMenuAction } from './StudioContextMenu.vue'
import StudioMessageActions, { type MessageAction } from './StudioMessageActions.vue'

const props = defineProps<{ task: CreationTask; conversation: NativeChat; role: 'user' | 'assistant' }>()
const emit = defineEmits<{
  action: [action: 'continueTask', task: CreationTask]
  publish: [task: CreationTask, destination: CreationDestination]
  preview: [task: CreationTask, index: number, editor?: boolean]
}>()
const error = ref(''), now = ref(Date.now())
const videoSizes = ref<Record<string, { width: number; height: number }>>({})
watch(() => [session.user?.id, props.task.id], () => { videoSizes.value = {} })
function videoMetadata(url: string, event: Event) {
  const video = event.target as HTMLVideoElement
  if (video.videoWidth && video.videoHeight) videoSizes.value[url] = { width: video.videoWidth, height: video.videoHeight }
}
const busy = computed(() => isConversationBusy(props.conversation))
const downloading = ref(false)
const menuId = `media-menu-${useId()}`
let downloadController: AbortController | undefined
onUnmounted(() => downloadController?.abort())
watch([() => session.user?.id, () => props.task.id], () => downloadController?.abort())
const pinMessageId = computed(() => {
  const answer = branchMessages(props.conversation).find(message => message.role === 'assistant' && 'taskId' in message && message.taskId === props.task.id)
  return props.role === 'assistant' ? answer?.id : answer?.parentId
})
const pinned = computed(() => !!pinMessageId.value && !!props.conversation.pinnedMessageIds?.includes(pinMessageId.value))
async function pin() {
  if (!pinMessageId.value || props.task.kind === 'video') return
  await perform(async () => {
    const value = await togglePinnedMessage(props.conversation, pinMessageId.value!)
    if (value !== undefined) notify(value ? '已固定至当前对话上下文' : '已取消固定')
  })
}
async function downloadAll() {
  if (downloading.value) return
  downloading.value = true
  await perform(async () => {
    const task = props.task, owner = session.user?.id, controller = new AbortController()
    downloadController = controller
    const hasImages = task.kind === 'image' && task.urls.length > 0
    const format = hasImages ? await chooseImageDownloadFormat(controller.signal, () => props.task === task && owner === session.user?.id) : undefined
    if (hasImages && !format || controller.signal.aborted) return
    const items = task.urls.length ? task.urls.map((_, index) => ({ task, index })) : [{ task, index: 0 }]
    await downloadCreationSelection(items, controller.signal, format)
  })
  downloadController = undefined
  downloading.value = false
}
const actions = computed<MessageAction[]>(() => {
  const task = props.task, result = props.role === 'assistant'
  if (!result) return [
    ...(task.kind !== 'video' ? [{ icon: 'pin' as const, label: pinned.value ? '取消固定' : '固定到上下文', hint: pinned.value ? '取消固定此条提问' : '固定此条提问，不包含生成图片', pressed: pinned.value, disabled: busy.value || !pinMessageId.value, run: pin }] : []),
    { icon: 'copy', label: '复制提示词', run: copyPrompt },
  ]
  return [
    { icon: 'edit', label: '继续创作', hint: task.kind === 'image' ? '恢复原参数，生成图片作为可移除参考图；发送后追加新一轮' : '恢复原提问、参考素材和参数；发送后追加新一轮', disabled: busy.value, run: () => emit('action', 'continueTask', task) },
    ...(task.phase === 'complete' ? [
      { icon: 'download', label: task.kind === 'video' ? '下载视频' : task.urls.length ? '下载图片' : '下载文本', hint: downloading.value ? '正在准备下载' : task.urls.length > 1 ? `下载全部 ${task.urls.length} 张图片` : undefined, disabled: downloading.value, run: downloadAll },
      { icon: 'publish', label: '发布作品', menuId: task.kind === 'image' && task.sourceWorkId ? `${menuId}-publish` : undefined, expanded: task.kind === 'image' && task.sourceWorkId ? publishMenu.value?.visible || false : undefined, run: openPublish },
    ] satisfies MessageAction[] : []),
    { icon: 'more', label: '更多', menuId, expanded: menu.value?.visible || false, run: openMore },
  ]
})
const menu = ref<InstanceType<typeof StudioContextMenu>>()
const publishMenu = ref<InstanceType<typeof StudioContextMenu>>()
const menuIndex = ref(0)
function openMore(event: MouseEvent) {
  menuIndex.value = 0
  if (menu.value?.visible) menu.value.close()
  else void menu.value?.open(event)
}
function openPublish(event: MouseEvent) {
  if (props.task.kind !== 'image' || !props.task.sourceWorkId) emit('publish', props.task, 'community')
  else if (publishMenu.value?.visible) publishMenu.value.close()
  else void publishMenu.value?.open(event)
}
function openMenu(event: MouseEvent) {
  const root = event.currentTarget as HTMLElement, figure = (event.target as Element).closest('figure')
  const index = figure ? [...root.querySelectorAll('.creation-media > figure')].indexOf(figure) : -1
  menuIndex.value = Math.max(0, index)
  void menu.value?.open(event)
}
const menuItems = computed<StudioMenuAction[]>(() => {
  const task = props.task
  return [
    ...(props.role === 'assistant' && task.kind === 'image' && task.urls.length ? [{ label: '复制图片', icon: Copy, run: () => perform(async () => { await copyCreationImage(task, menuIndex.value); notify('图片已复制') }) }] : []),
    ...(task.kind !== 'video' ? [{ label: pinned.value ? '取消固定' : '固定到上下文', icon: pinned.value ? PinOff : Pin, disabled: busy.value || !pinMessageId.value, run: pin }] : []),
    { label: '删除本轮对话', icon: Trash2, danger: true, disabled: busy.value, run: remove },
  ]
})
const publishItems: StudioMenuAction[] = [
  { label: '发布到社区', icon: ImageUp, run: () => emit('publish', props.task, 'community') },
  { label: '发送到源作品评论区', icon: MessageCircleReply, run: () => emit('publish', props.task, 'source-comment') },
]
watch(() => [session.user?.id, props.conversation.id, props.task.id], () => { menu.value?.close(); publishMenu.value?.close() })
const working = computed(() => ['submitting', 'running'].includes(props.task.phase))
const insufficient = computed(() => !working.value && !!props.task.error && isInsufficientCredits(props.task))
const timedOut = computed(() => creationRequestTimedOut(props.task))
const canQuery = computed(() => {
  const task = props.task
  return (task.phase === 'attention' || task.phase === 'paused') && task.resultStatus !== 'expired'
    && (!timedOut.value || task.serverTracked) && !task.customApiBase && (!task.legacy || !!task.upstreamId && task.tokenId != null)
})
const version = computed(() => props.task.kind === 'video' ? mediaVersion(props.conversation, props.task.id) : { index: 0, total: 1 })
const phases: Record<string, string> = { submitting: '正在提交', running: '正在生成中', paused: '已停止等待', complete: '生成完成', error: '生成失败', attention: '请求异常' }
const stages: Record<string, string> = { preparing: '准备素材中', queued: '等待提交', generating: '正在生成中', saving: '正在保存图片', downloading: '下载中' }
const activityLabel = computed(() => stages[props.task.stage || ''] || (props.task.phase === 'submitting' ? phases.submitting : phases.running))
const elapsed = computed(() => {
  if (timedOut.value || props.task.phase === 'paused' || props.task.phase === 'attention') return ''
  const end = working.value ? now.value : props.task.settledAt
  if (!Number.isFinite(end)) return ''
  // Keep total elapsed time on the browser clock; stage timestamps come from the server.
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
function copyPrompt() {
  return perform(async () => { await navigator.clipboard.writeText(props.task.prompt); notify('提示词已复制') })
}
async function remove() {
  const chat = props.conversation, task = props.task
  const scope = task.kind === 'video' ? '删除本轮提问、视频回复及其备选版本？' : '删除本轮提问和对应图片回复？共用提问仍有其他图片时会保留。'
  if (busy.value || !await confirmStudioDelete(`${scope}后续对话和已保存到作品库的内容不会删除。`, () => chats.activeId === chat.id && chats.sessions.includes(chat) && props.task === task && !busy.value)) return
  await perform(() => deleteMediaTurns(chat, [task.id]))
}
</script>

<template>
  <StudioMessageFrame :role="role" :model="task.model" :created-at="task.createdAt" :class="[role === 'user' ? 'creation-request' : 'creation-response', { 'compact-image-response': role === 'assistant' && task.kind === 'image' }]" :aria-label="role === 'user' ? '已发送的创作请求' : '模型生成结果'" tabindex="-1" @contextmenu="openMenu">
    <template #status>
      <template v-if="role === 'assistant'">
        <span v-if="working" class="task-activity">
          <StudioAiStatus class="task-status" :state="task.preview ? 'writing' : 'thinking'" :label="activityLabel" :timer="false" :elapsed="elapsed" />
          <button class="icon-button task-stop" type="button" title="停止本页等待，上游任务继续执行" aria-label="停止等待" @click="stopCreation(task)"><Square :size="14" aria-hidden="true" /></button>
        </span>
        <template v-else-if="!insufficient"><span class="task-status" :class="{ 'studio-sr-only': task.phase === 'complete', 'task-error': task.phase === 'error' || task.phase === 'attention' }" :role="task.phase === 'error' || task.phase === 'attention' ? 'alert' : 'status'">{{ timedOut ? '请求超时' : phases[task.phase] }}</span><span v-if="elapsed" class="task-elapsed">{{ elapsed }}</span></template>
      </template>
    </template>
    <template v-if="role === 'user'">
      <div class="creation-request-body message-bubble"><p>{{ task.prompt }}</p><div v-if="task.references.length" class="sent-references"><template v-for="(file, index) in task.references" :key="file.url"><StudioInlineVideo v-if="file.type?.startsWith('video/')" class="sent-video" :src="file.url" :label="`源视频：${file.name}`" /><audio v-else-if="file.type?.startsWith('audio/')" :src="mediaSource(file.url, false, 'video')" :aria-label="`参考音频：${file.name}`" controls preload="none" /><StudioCreationImage v-else :src="file.url" :alt="`参考图 ${index + 1}：${file.name}`" label="" thumbnail /></template></div></div>
      <StudioMessageActions class="creation-turn-tools message-actions" label="提问操作" :actions="actions" />
    </template>
    <template v-else>
      <StudioInsufficientCredits v-if="insufficient" />
      <p v-else-if="task.error && (!working || task.errorStage === '任务查询')" class="task-message" :class="{ muted: task.phase === 'paused' }">{{ task.error }}</p>
      <div v-if="canQuery" class="creation-recovery"><button class="button subtle btn" @click="perform(() => resumeCreation(task))"><RefreshCw :size="15" />查询原结果</button></div>
      <img v-if="task.preview && task.phase !== 'complete'" class="stream-preview" :src="mediaSource(task.preview, true)" alt="生成中的预览" />
      <div v-if="task.urls.length" class="creation-media" :class="{ 'video-results': task.kind === 'video' }"><figure v-for="(url, index) in task.urls" :key="url" :style="task.kind === 'video' ? { '--video-ratio': (videoSizes[url]?.width || 640) / (videoSizes[url]?.height || 360) } : undefined">
        <template v-if="task.kind === 'video'">
          <StudioInlineVideo :src="url" :poster="task.poster" :label="`生成视频 ${index + 1}`" @loadedmetadata="videoMetadata(url, $event)" @expand="emit('preview', task, index)" />
          <button class="icon-button video-expand" type="button" title="放大视频" aria-label="放大视频" @click="emit('preview', task, index)"><Maximize :size="17" /></button>
        </template>
        <StudioCreationImage v-else :key="`${task.owner}:${task.id}`" :src="url" :preview="task.urls.length === 1 ? task.preview : undefined" :alt="task.prompt" :label="`查看大图：预览生成图片 ${index + 1}`" editable @open="emit('preview', task, index)" @edit="emit('preview', task, index, true)" />
      </figure></div>
      <div v-else-if="task.text" class="creation-text"><pre>{{ task.text }}</pre></div>
      <StudioBrowserSave :task="task" />
      <StudioMessageActions v-if="!working" class="creation-message-actions" label="生成结果操作" :actions="actions" />
      <div v-if="version.total > 1" class="creation-versions" role="group" aria-label="生成版本"><button class="icon-button" type="button" aria-label="上一个版本" title="上一个版本" :disabled="busy || version.index === 0" @click="perform(() => selectMediaVersion(conversation, task.id, -1))"><ChevronLeft :size="16" /></button><output aria-label="当前生成版本">{{ version.index + 1 }} / {{ version.total }}</output><button class="icon-button" type="button" aria-label="下一个版本" title="下一个版本" :disabled="busy || version.index >= version.total - 1" @click="perform(() => selectMediaVersion(conversation, task.id, 1))"><ChevronRight :size="16" /></button></div>
    </template>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <StudioContextMenu :id="menuId" ref="menu" :items="menuItems" />
    <StudioContextMenu :id="`${menuId}-publish`" ref="publishMenu" label="发布作品" :items="publishItems" />
  </StudioMessageFrame>
</template>

<style scoped>
.creation-request-body p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.sent-references { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }.sent-references img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; }.sent-references video { width: 240px; max-width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: contain; border-radius: 6px; }.sent-references audio { width: 288px; max-width: 100%; height: 40px; }
.creation-versions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.creation-turn-tools { justify-content: flex-end; }
.creation-versions { margin-top: 8px; width: fit-content; }.creation-versions output, .task-elapsed { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.compact-image-response :deep(.message-heading) { min-height: 28px; margin-bottom: 8px; gap: 6px; }
.compact-image-response :deep(.message-avatar) { width: 24px; height: 24px; }
.compact-image-response .creation-media { width: min(680px, 100%); grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); }
.task-activity { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }
.task-stop { width: 32px; height: 32px; min-height: 32px; color: var(--muted); }
.task-status { color: var(--muted); font-size: 12px; }.task-error { color: var(--danger, #b64646); }
.task-message { color: var(--danger); font-size: 14px; line-height: 24px; margin-block: 0 16px; overflow-wrap: anywhere; }
.creation-recovery { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 8px; }
.stream-preview { display: block; max-width: 100%; max-height: 480px; }
.creation-media { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 16px; width: min(880px, 100%); }
.creation-media figure { position: relative; margin: 0; min-width: 0; }.video-expand { position: absolute; top: 8px; right: 8px; color: white; background: rgb(0 0 0 / 65%); }
.video-results { --video-max-height: min(360px, 36dvh); display: flex; align-items: flex-start; flex-wrap: wrap; width: min(640px, 100%); max-width: 100%; }
.video-results figure { width: min(100%, calc(var(--video-max-height) * var(--video-ratio))); max-width: 100%; }
.creation-media video { width: 100%; height: auto; aspect-ratio: auto 16 / 9; max-width: 100%; max-height: var(--video-max-height); display: block; object-fit: contain; }
.sent-video { width: 240px; max-width: 100%; }
.creation-text pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 28px; margin: 0; max-width: 72ch; }
@media (min-width: 1000px) { .creation-media { gap: 4px; } }
@media (max-width: 639px) { .video-results { --video-max-height: 32dvh; } }
@media (pointer: coarse), (max-width: 639px) { .task-stop { min-height: 44px; width: 44px; } }
</style>
