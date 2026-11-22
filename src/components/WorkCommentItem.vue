<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Download, Flag, Heart, MessageSquare, RefreshCw, Trash2, Video, X } from '@lucide/vue'
import type { WorkComment, WorkFile } from '../data'
import { api, errorMessage, notify, queryString, session } from '../state'

const props = defineProps<{ comment: WorkComment; workId: string; depth?: number; refresh?: number }>()
const emit = defineEmits<{ reply: [comment: WorkComment]; report: [comment: WorkComment]; deleted: [comment: WorkComment] }>()
function imageSource(file: WorkFile) {
  // Display variants preserve animation, including GIFs sanitized to WebP; thumbnails contain only the first frame.
  return /^\/legacy-files\/[a-zA-Z0-9]{1,32}$/.test(file.url) ? `${file.url}?variant=webpublic` : file.url
}
const expanded = ref(false)
const replies = ref<WorkComment[]>([])
const cursor = ref<string | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const confirm = ref<HTMLDialogElement>()
const element = ref<HTMLElement>(), mediaStalled = ref(false), mediaError = ref('')
const processing = computed(() => props.comment.files?.some(file => file.processing === 'pending' || file.processing === 'processing'))
let mediaTimer: ReturnType<typeof setTimeout> | undefined, mediaController: AbortController | undefined
let observer: IntersectionObserver | undefined, visible = false, mediaAttempts = 0, mediaFailures = 0, disposed = false
function scheduleMedia() {
  clearTimeout(mediaTimer)
  if (disposed || !visible || document.hidden || !processing.value || mediaController || mediaAttempts >= 12 || mediaFailures >= 3) return
  mediaTimer = setTimeout(() => { void refreshMedia() }, 5000)
}
async function refreshMedia(manual = false) {
  if (mediaController || disposed) return
  if (manual) { mediaAttempts = 0; mediaFailures = 0 }
  const current = props.comment, controller = new AbortController(); mediaController = controller
  mediaAttempts++; mediaError.value = ''
  try {
    const result = await api<{ files: WorkFile[] }>(`/api/works/${encodeURIComponent(props.workId)}/comments/${encodeURIComponent(current.id)}/files`, { signal: controller.signal })
    if (!disposed && props.comment === current && !controller.signal.aborted) { current.files = result.files; mediaFailures = 0 }
  } catch (cause) { if (!controller.signal.aborted) { mediaFailures++; mediaError.value = errorMessage(cause) } }
  finally {
    if (mediaController === controller) mediaController = undefined
    mediaStalled.value = Boolean(processing.value && (mediaAttempts >= 12 || mediaFailures >= 3))
    scheduleMedia()
  }
}
watch(processing, scheduleMedia)
function mediaVisibility() { if (document.hidden) clearTimeout(mediaTimer); else scheduleMedia() }
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting)
    if (!visible) { clearTimeout(mediaTimer); mediaController?.abort() }
    else scheduleMedia()
  })
  if (element.value) observer.observe(element.value)
  document.addEventListener('visibilitychange', mediaVisibility)
})
onBeforeUnmount(() => { disposed = true; clearTimeout(mediaTimer); mediaController?.abort(); observer?.disconnect(); document.removeEventListener('visibilitychange', mediaVisibility) })
async function load(append = false) {
  if (loading.value) return
  loading.value = true; error.value = ''
  try {
    const result = await api<{ items: WorkComment[]; nextCursor?: string | null }>(`/api/works/${encodeURIComponent(props.workId)}/comments${queryString({ parentId: props.comment.id, cursor: append ? cursor.value || undefined : undefined })}`)
    replies.value = append ? [...replies.value, ...result.items] : result.items
    cursor.value = result.nextCursor || null
  } catch (cause) { error.value = errorMessage(cause) }
  finally { loading.value = false }
}
async function showReplies() { expanded.value = !expanded.value; if (expanded.value && !replies.value.length) await load() }
watch(() => props.refresh, () => { if (expanded.value) void load() })
async function like() {
  if (!session.user) { notify('请先登录后点赞。'); return }
  if (busy.value) return
  busy.value = true
  try {
    const result = await api<{ comment?: WorkComment; liked?: boolean; likesCount?: number; likes?: number }>(`/api/works/${encodeURIComponent(props.workId)}/comments/${encodeURIComponent(props.comment.id)}/like`, { method: 'POST', body: { active: !props.comment.liked } })
    if (result.comment) Object.assign(props.comment, result.comment)
    else { props.comment.likesCount = result.likesCount ?? result.likes ?? (props.comment.likesCount ?? props.comment.likes ?? 0) + (props.comment.liked ? -1 : 1); props.comment.liked = result.liked ?? !props.comment.liked }
  } catch (cause) { notify(errorMessage(cause)) }
  finally { busy.value = false }
}
async function remove() {
  if (busy.value) return
  busy.value = true
  try {
    await api(`/api/works/${encodeURIComponent(props.workId)}/comments/${encodeURIComponent(props.comment.id)}`, { method: 'DELETE' })
    confirm.value?.close(); emit('deleted', props.comment)
  } catch (cause) { error.value = errorMessage(cause) }
  finally { busy.value = false }
}
function removed(child: WorkComment) { replies.value = replies.value.filter(item => item.id !== child.id); props.comment.repliesCount = Math.max(0, (props.comment.repliesCount || 0) - 1) }
</script>

<template>
  <article ref="element" :id="`comment-${comment.id}`" class="comment-item">
    <div class="comment-heading"><RouterLink :to="{ path: '/community', query: { creator: comment.authorId || comment.userId } }" class="comment-author"><span class="avatar blue"><img v-if="comment.authorAvatarUrl" :src="comment.authorAvatarUrl" :alt="comment.author" /><span v-else>{{ comment.author.slice(0, 1) }}</span></span><strong>{{ comment.author }}</strong></RouterLink><time v-if="comment.date" class="caption-5">{{ new Date(comment.date).toLocaleString('zh-CN') }}</time></div>
    <p class="comment-text">{{ comment.text }}</p>
    <div v-if="comment.files?.length" class="comment-media"><figure v-for="file in comment.files" :key="file.id"><a :href="file.url" target="_blank" rel="noopener noreferrer"><img v-if="file.type.startsWith('image/')" :src="imageSource(file)" :alt="file.name" loading="lazy" /><video v-else-if="file.type.startsWith('video/') && (!file.processing || file.processing === 'ready')" :src="file.url" controls playsinline preload="metadata" /><span v-else><Video v-if="file.type.startsWith('video/')" :size="18" />{{ file.name }}<Download :size="14" /></span></a><figcaption v-if="file.processing && file.processing !== 'ready'" role="status">{{ file.processing === 'failed' ? '素材处理失败，原文件已保留' : '素材处理中' }}</figcaption></figure></div>
    <p v-if="mediaError && mediaStalled" class="form-error" role="alert">{{ mediaError }}</p><button v-if="mediaStalled" type="button" class="text-link media-refresh" @click="refreshMedia(true)"><RefreshCw :size="14" />刷新素材状态</button>
    <RouterLink v-if="comment.sourceWorkId" :to="`/work/${comment.sourceWorkId}`" class="text-link">查看同款作品</RouterLink>
    <div class="comment-actions"><button class="button subtle btn" :aria-pressed="!!comment.liked" :disabled="busy" :aria-label="`点赞评论，${comment.likesCount ?? comment.likes ?? 0} 赞`" @click="like"><Heart :size="15" />{{ comment.likesCount ?? comment.likes ?? 0 }}</button><button v-if="session.user" class="button subtle btn" @click="emit('reply', comment)"><MessageSquare :size="15" />回复</button><button v-if="comment.repliesCount || expanded" class="text-link" :aria-expanded="expanded" @click="showReplies">{{ expanded ? '收起回复' : `查看 ${comment.repliesCount} 条回复` }}</button><button v-if="session.user && !comment.owned" class="icon-button" aria-label="举报评论" title="举报评论" @click="emit('report', comment)"><Flag :size="15" /></button><button v-if="comment.removable" class="icon-button" aria-label="删除评论" title="删除评论" @click="confirm?.showModal()"><Trash2 :size="15" /></button></div>
    <p v-if="error" class="form-error" role="alert">{{ error }}<button class="text-link" @click="load()">重试</button></p>
    <div v-if="expanded" class="comment-replies" :class="{ 'comment-replies-flat': (depth || 0) >= 3 }"><p v-if="loading && !replies.length" class="form-note" role="status">正在加载回复…</p><WorkCommentItem v-for="item in replies" :key="item.id" :comment="item" :work-id="workId" :depth="(depth || 0) + 1" :refresh="refresh" @reply="emit('reply', $event)" @report="emit('report', $event)" @deleted="removed" /><button v-if="cursor" class="button subtle btn" :disabled="loading" @click="load(true)">更多回复</button></div>
    <dialog ref="confirm" class="compact-dialog" aria-label="删除评论确认"><div class="dialog-heading"><h2>删除评论？</h2><button class="icon-button" aria-label="取消删除" :disabled="busy" @click="confirm?.close()"><X :size="20" /></button></div><div class="dialog-body stack"><p>评论删除后无法恢复。</p><p v-if="error" class="form-error" role="alert">{{ error }}</p><button class="button danger btn" :disabled="busy" @click="remove"><Trash2 :size="16" />确认删除</button></div></dialog>
  </article>
</template>

<style scoped>
.comment-item { padding: 20px 0; border-bottom: 1px solid var(--border); min-width: 0; }
.comment-heading, .comment-author, .comment-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.comment-heading { justify-content: space-between; }
.comment-text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 12px 0; }
.comment-actions { margin-top: 12px; }
.comment-media { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.comment-media figure { margin: 0; min-width: 0; max-width: 100%; }.comment-media a { display: block; overflow-wrap: anywhere; }.comment-media figcaption { color: var(--muted); font-size: 12px; margin-top: 4px; }.media-refresh { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; }
.comment-media img, .comment-media video { max-width: 100%; width: 200px; max-height: 240px; object-fit: contain; border-radius: 4px; }
.comment-replies { margin-left: 16px; }
.comment-replies-flat { margin-left: 0; }
.avatar { overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
</style>
