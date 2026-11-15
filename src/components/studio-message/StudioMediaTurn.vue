<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Copy, Download, ImagePlus, Maximize, Pencil, Play, RefreshCw, Trash2, Upload } from '@lucide/vue'
import { copyCreationImage, downloadCreation, mediaSource, resumeCreation, type CreationDestination, type CreationTask } from '../../native-studio'
import type { NativeChat } from '../../native-chat'
import { isConversationBusy } from '../../studio-conversations'
import { deleteMediaTurns, mediaVersion, selectMediaVersion } from '../../studio-image-conversation'
import { errorMessage, notify } from '../../state'
import StudioMessageFrame from './StudioMessageFrame.vue'
import StudioAiStatus from './StudioAiStatus.vue'
import StudioCreationImage from './StudioCreationImage.vue'

const props = defineProps<{ task: CreationTask; conversation: NativeChat; role: 'user' | 'assistant' }>()
const emit = defineEmits<{
  action: [action: 'editTask' | 'regenerate' | 'useTask' | 'chooseReference', task: CreationTask, index?: number]
  publish: [task: CreationTask, destination: CreationDestination]
  preview: [task: CreationTask, index: number]
}>()
const error = ref(''), now = ref(Date.now())
const busy = computed(() => isConversationBusy(props.conversation))
const working = computed(() => ['submitting', 'running'].includes(props.task.phase))
const version = computed(() => mediaVersion(props.conversation, props.task.id))
const phases: Record<string, string> = { submitting: '正在提交', running: '正在生成', paused: '等待已暂停', complete: '生成完成', error: '生成失败', attention: '需要核对' }
const elapsed = computed(() => {
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
function remove() {
  if (busy.value || !confirm('删除 1 轮对话记录？生成图片仍保留在图库。')) return
  void perform(() => deleteMediaTurns(props.conversation, [props.task.id]))
}
</script>

<template>
  <StudioMessageFrame :role="role" :model="task.model" :created-at="task.createdAt" :class="role === 'user' ? 'creation-request' : 'creation-response'" :aria-label="role === 'user' ? '已发送的创作请求' : '模型生成结果'">
    <template #status>
      <template v-if="role === 'assistant'">
        <StudioAiStatus v-if="working" class="task-status" :state="task.preview ? 'writing' : 'thinking'" :label="task.kind === 'video' ? '正在生成视频' : task.preview ? '正在生成图片' : undefined" :timer="false" :elapsed="elapsed" />
        <template v-else><span class="task-status" :class="{ 'studio-sr-only': task.phase === 'complete', 'task-error': task.phase === 'error' || task.phase === 'attention' }" :role="task.phase === 'error' || task.phase === 'attention' ? 'alert' : 'status'">{{ phases[task.phase] }}</span><span v-if="elapsed" class="task-elapsed">{{ elapsed }}</span></template>
      </template>
    </template>
    <template v-if="role === 'user'">
      <div class="creation-request-body message-bubble"><p>{{ task.prompt }}</p><div v-if="task.references.length" class="sent-references"><img v-for="(file, index) in task.references" :key="file.url" :src="mediaSource(file.url)" :alt="`参考图 ${index + 1}：${file.name}`" loading="lazy" /></div></div>
      <div class="creation-turn-tools message-actions"><button class="icon-button" type="button" aria-label="编辑并重新生成" title="编辑并重新生成" :disabled="busy" @click="emit('action', 'editTask', task)"><Pencil :size="15" /></button><button class="icon-button" type="button" aria-label="删除此轮消息" title="删除此轮消息" :disabled="busy" @click="remove"><Trash2 :size="15" /></button></div>
    </template>
    <template v-else>
      <progress v-if="working && task.progress != null" class="generation-progress" :value="task.progress" max="100" aria-label="模型返回的生成进度" />
      <p v-if="task.error" class="task-message">{{ task.error }}</p>
      <div v-if="task.phase === 'paused' || task.phase === 'attention' || task.phase === 'error'" class="creation-recovery"><button v-if="task.phase !== 'error'" class="button subtle btn" @click="perform(() => resumeCreation(task))"><Play :size="15" />继续查询</button><button v-else class="button subtle btn" @click="emit('action', 'editTask', task)"><Pencil :size="15" />编辑后重试</button></div>
      <img v-if="task.preview && task.phase !== 'complete'" class="stream-preview" :src="mediaSource(task.preview)" alt="生成中的预览" />
      <div v-if="task.urls.length" class="creation-media"><figure v-for="(url, index) in task.urls" :key="url">
        <template v-if="task.kind === 'video'"><video :src="mediaSource(url, false, 'video')" controls playsinline preload="metadata" @dblclick="emit('preview', task, index)" /><button class="icon-button video-expand" type="button" title="放大视频" aria-label="放大视频" @click="emit('preview', task, index)"><Maximize :size="17" /></button></template>
        <template v-else><StudioCreationImage :src="mediaSource(url) || ''" :alt="task.prompt" :label="`查看大图：预览生成图片 ${index + 1}`" @open="emit('preview', task, index)" /><figcaption class="creation-image-tools"><button class="icon-button" type="button" :aria-label="`使用第 ${index + 1} 张图片继续创作`" title="使用此图继续创作" :disabled="busy || task.phase !== 'complete'" @click="emit('action', 'chooseReference', task, index)"><ImagePlus :size="16" /></button><button class="icon-button" type="button" :aria-label="`复制第 ${index + 1} 张图片`" title="复制图片" @click="perform(async () => { await copyCreationImage(task, index); notify('图片已复制') })"><Copy :size="16" /></button></figcaption></template>
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
  </StudioMessageFrame>
</template>

<style scoped>
.creation-request-body p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.sent-references { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }.sent-references img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; }
.creation-turn-tools, .creation-image-tools, .creation-versions, .creation-message-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.creation-turn-tools { justify-content: flex-end; margin-top: 12px; }.creation-image-tools { margin-top: 4px; }
.creation-turn-tools .icon-button, .creation-image-tools .icon-button { width: 32px; min-height: 32px; }
.creation-versions { margin-top: 8px; width: fit-content; }.creation-versions output, .task-elapsed { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.creation-message-actions { margin-top: 12px; gap: 4px 12px; }
.generation-progress { display: block; width: min(100%, 360px); height: 4px; margin-bottom: 12px; accent-color: var(--muted); }
.task-status { color: var(--muted); font-size: 12px; }.task-error { color: var(--danger, #b64646); }
.task-message { color: var(--amber); font-size: 14px; line-height: 24px; margin-block: 0 16px; overflow-wrap: anywhere; }
.creation-recovery { margin-bottom: 12px; }.stream-preview { display: block; max-width: 100%; max-height: 480px; }
.creation-media { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 16px; width: min(880px, 100%); }
.creation-media figure { position: relative; margin: 0; min-width: 0; }.video-expand { position: absolute; top: 8px; right: 8px; color: white; background: rgb(0 0 0 / 65%); }
.creation-media video { width: 100%; max-height: 600px; display: block; object-fit: contain; }
.creation-text pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 28px; margin: 0; max-width: 72ch; }
@media (min-width: 1000px) { .creation-media { gap: 4px; }.creation-media video { height: min(440px, 32dvh); background: var(--surface); } }
@media (max-width: 639px) { .creation-message-actions { gap: 4px; }.creation-media video { max-height: 44dvh; } }
@media (pointer: coarse), (max-width: 639px) { .creation-turn-tools .icon-button, .creation-image-tools .icon-button { min-height: 44px; width: 44px; } }
@media (hover: hover) and (pointer: fine) { .creation-turn-tools { opacity: 0; }.creation-request:hover .creation-turn-tools, .creation-request:focus-within .creation-turn-tools { opacity: 1; } }
</style>
