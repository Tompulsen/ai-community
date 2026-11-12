<script setup lang="ts">
import { ref, watch } from 'vue'
import { Download, Flag, Heart, MessageSquare, Trash2, X } from '@lucide/vue'
import type { WorkComment } from '../data'
import { api, errorMessage, notify, queryString, session } from '../state'

const props = defineProps<{ comment: WorkComment; workId: string; depth?: number; refresh?: number }>()
const emit = defineEmits<{ reply: [comment: WorkComment]; report: [comment: WorkComment]; deleted: [comment: WorkComment] }>()
const expanded = ref(false)
const replies = ref<WorkComment[]>([])
const cursor = ref<string | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const confirm = ref<HTMLDialogElement>()
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
  <article :id="`comment-${comment.id}`" class="comment-item">
    <div class="comment-heading"><RouterLink :to="{ path: '/community', query: { creator: comment.authorId || comment.userId } }" class="comment-author"><span class="avatar blue"><img v-if="comment.authorAvatarUrl" :src="comment.authorAvatarUrl" :alt="comment.author" /><span v-else>{{ comment.author.slice(0, 1) }}</span></span><strong>{{ comment.author }}</strong></RouterLink><time v-if="comment.date" class="caption-5">{{ new Date(comment.date).toLocaleString('zh-CN') }}</time></div>
    <p class="comment-text">{{ comment.text }}</p>
    <div v-if="comment.files?.length" class="comment-media"><a v-for="file in comment.files" :key="file.id" :href="file.url" target="_blank" rel="noopener noreferrer"><img v-if="file.type.startsWith('image/')" :src="file.thumbnailUrl || file.url" :alt="file.name" loading="lazy" /><video v-else-if="file.type.startsWith('video/')" :src="file.url" controls playsinline preload="metadata" /><span v-else>{{ file.name }}<Download :size="14" /></span></a></div>
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
.comment-media img, .comment-media video { max-width: 100%; width: 200px; max-height: 240px; object-fit: contain; border-radius: 4px; }
.comment-replies { margin-left: 16px; }
.comment-replies-flat { margin-left: 0; }
.avatar { overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
</style>
