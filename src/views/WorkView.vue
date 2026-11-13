<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Bookmark, Copy, Eye, Flag, Heart, ImagePlus, MessageSquare, Repeat2, Send, WandSparkles, X } from '@lucide/vue'
import { api, errorMessage, notify, pendingActions, queryString, safeExternalUrl, session, toggleWork, uploadFile } from '../state'
import { kindLabels, type Creator, type Work, type WorkComment, type WorkFile } from '../data'
import WorkCard from '../components/WorkCard.vue'
import FollowButton from '../components/FollowButton.vue'
import BentoGrid from '../components/BentoGrid.vue'
import WorkMedia from '../components/WorkMedia.vue'
import WorkCommentItem from '../components/WorkCommentItem.vue'
import { queueBackgroundWork } from '../studio-state'

const route = useRoute()
const work = ref<Work | null>(null)
const files = computed<WorkFile[]>(() => work.value?.files?.length ? work.value.files : work.value?.video ? [{ id: 'video', name: work.value.title, type: 'video/mp4', url: work.value.video }] : work.value?.cover ? [{ id: 'cover', name: work.value.title, type: 'image/jpeg', url: work.value.cover }] : [])
const related = ref<Work[]>([])
const loading = ref(true), error = ref('')
const comments = ref<WorkComment[]>([]), commentsCursor = ref<string | null>(null)
const commentsLoading = ref(false), commentText = ref(''), commentFiles = ref<WorkFile[]>([]), commentError = ref(''), commentBusy = ref(false)
const replyTo = ref<WorkComment | null>(null), commentInput = ref<HTMLTextAreaElement>(), commentsRefresh = ref(0)
const reposting = ref(false), reportDialog = ref<HTMLDialogElement>(), reportComment = ref<WorkComment | null>(null), reportReason = ref(''), reportError = ref(''), reporting = ref(false)
const shareDialog = ref<HTMLDialogElement>(), recipients = ref<Creator[]>([]), recipient = ref(''), shareError = ref(''), sharing = ref(false), shareRequestId = ref(crypto.randomUUID())
let controller: AbortController | undefined

async function load() {
  controller?.abort()
  const active = new AbortController(); controller = active
  loading.value = true; error.value = ''; work.value = null; comments.value = []; commentsCursor.value = null; related.value = []
  replyTo.value = null; commentText.value = ''; commentFiles.value = []
  try {
    const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(String(route.params.id))}`, { signal: active.signal })
    if (active.signal.aborted) return
    work.value = result.work
    if (['published', 'approved'].includes(result.work.status)) {
      void loadComments(false, active.signal)
      void api<{ viewsCount?: number }>(`/api/works/${encodeURIComponent(result.work.id)}/view`, { method: 'POST', body: {}, signal: active.signal }).then(value => { if (work.value?.id === result.work.id && value.viewsCount !== undefined) work.value.viewsCount = value.viewsCount }).catch(() => {})
    }
    void api<{ items: Work[] }>('/api/works', { signal: active.signal }).then(list => { if (!active.signal.aborted) related.value = list.items.filter(item => item.id !== result.work.id).slice(0, 5) }).catch(() => {})
  } catch (cause) { if (!active.signal.aborted) error.value = errorMessage(cause) }
  finally { if (!active.signal.aborted) loading.value = false }
}
watch(() => route.params.id, () => { void load() }, { immediate: true })
onBeforeUnmount(() => controller?.abort())
async function copyPrompt() {
  try { await navigator.clipboard.writeText(work.value?.prompt || ''); notify('提示词已复制。') }
  catch { notify('复制失败，请选择文字复制。') }
}
async function loadComments(append = false, signal?: AbortSignal) {
  if (!work.value) return
  const id = work.value.id
  commentsLoading.value = true; commentError.value = ''
  try {
    const result = await api<{ items: WorkComment[]; nextCursor?: string | null }>(`/api/works/${encodeURIComponent(id)}/comments${queryString({ cursor: append ? commentsCursor.value || undefined : undefined })}`, { signal })
    if (work.value?.id !== id) return
    comments.value = append ? [...comments.value, ...result.items] : result.items; commentsCursor.value = result.nextCursor || null
    if (!append && /^#comment-[a-zA-Z0-9]+$/.test(route.hash)) { await nextTick(); document.getElementById(route.hash.slice(1))?.scrollIntoView({ block: 'center' }) }
  } catch (cause) { if (!signal?.aborted && work.value?.id === id) commentError.value = errorMessage(cause) }
  finally { if (!signal?.aborted && work.value?.id === id) commentsLoading.value = false }
}
async function chooseCommentFiles(event: Event) {
  const input = event.target as HTMLInputElement, selected = [...(input.files || [])]; input.value = ''
  if (commentFiles.value.length + selected.length > 16) { commentError.value = '评论最多添加 16 个文件。'; return }
  commentBusy.value = true; commentError.value = ''
  try { for (const file of selected) commentFiles.value.push(await uploadFile(file, controller?.signal)) }
  catch (cause) { commentError.value = errorMessage(cause) }
  finally { commentBusy.value = false }
}
async function reply(comment: WorkComment) { replyTo.value = comment; await nextTick(); commentInput.value?.focus(); commentInput.value?.scrollIntoView({ block: 'center' }) }
async function postComment() {
  if (!work.value || (!commentText.value.trim() && !commentFiles.value.length) || commentBusy.value) return
  commentBusy.value = true; commentError.value = ''
  try {
    const result = await api<{ comment: WorkComment }>(`/api/works/${encodeURIComponent(work.value.id)}/comments`, { method: 'POST', body: { text: commentText.value.trim(), replyToId: replyTo.value?.id, fileIds: commentFiles.value.map(file => file.id) } })
    if (replyTo.value) { replyTo.value.repliesCount = (replyTo.value.repliesCount || 0) + 1; commentsRefresh.value++ } else comments.value.unshift(result.comment)
    work.value.repliesCount = (work.value.repliesCount || 0) + 1
    replyTo.value = null; commentText.value = ''; commentFiles.value = []; notify('评论已发布。')
  } catch (cause) { commentError.value = errorMessage(cause) }
  finally { commentBusy.value = false }
}
async function repost() {
  if (!work.value || reposting.value) return
  if (!session.user) { notify('请先登录后转发。'); return }
  reposting.value = true
  try {
    const result = await api<{ work?: Work; renotesCount?: number }>(`/api/works/${encodeURIComponent(work.value.id)}/repost`, { method: 'POST', body: { active: !work.value.renoted, requestId: crypto.randomUUID() } })
    if (result.work) Object.assign(work.value, result.work)
    else { work.value.renotesCount = result.renotesCount ?? (work.value.renotesCount || 0) + (work.value.renoted ? -1 : 1); work.value.renoted = !work.value.renoted }
    notify(work.value.renoted ? '已转发作品。' : '已取消转发。')
  } catch (cause) { notify(errorMessage(cause)) }
  finally { reposting.value = false }
}
function openReport(comment: WorkComment | null = null) { reportComment.value = comment; reportReason.value = ''; reportError.value = ''; reportDialog.value?.showModal() }
async function report() {
  if (!work.value || reporting.value || !reportReason.value.trim()) return
  reporting.value = true; reportError.value = ''
  try { await api(`/api/works/${encodeURIComponent(work.value.id)}/report`, { method: 'POST', body: { reason: reportReason.value.trim(), commentId: reportComment.value?.id } }); reportDialog.value?.close(); notify('举报已提交。') }
  catch (cause) { reportError.value = errorMessage(cause) }
  finally { reporting.value = false }
}
async function openShare() {
  if (!session.user) { notify('请先登录后分享。'); return }
  shareError.value = ''; shareDialog.value?.showModal()
  try { recipients.value = (await api<{ items: Creator[] }>(`/api/users/${encodeURIComponent(session.user.id)}/following`)).items }
  catch (cause) { shareError.value = errorMessage(cause) }
}
async function share() {
  if (!recipient.value || !work.value || sharing.value) return
  sharing.value = true; shareError.value = ''
  try { await api(`/api/messages/${encodeURIComponent(recipient.value)}`, { method: 'POST', body: { text: '', sharedWorkId: work.value.id, requestId: shareRequestId.value } }); shareRequestId.value = crypto.randomUUID(); shareDialog.value?.close(); notify('作品已通过私信分享。') }
  catch (cause) { shareError.value = errorMessage(cause) }
  finally { sharing.value = false }
}
</script>

<template>
  <div v-if="loading" class="empty-state" role="status">正在加载作品…</div>
  <div v-else-if="work" class="page-container detail-page">
    <div class="detail-topbar"><RouterLink to="/discover" class="back-link"><ArrowLeft :size="16" />返回发现</RouterLink></div>
    <div class="detail-layout"><WorkMedia class="detail-visual" :files="files" :references="work.referenceFiles" :title="work.title" :body="work.body" :resource="work.kind === 'resource'" />
      <aside class="detail-info"><div class="detail-title"><h1>{{ work.title }}</h1></div><RouterLink :to="{ path: '/community', query: { creator: work.authorId } }" class="creator-line"><span class="avatar blue"><img v-if="work.avatarUrl" :src="work.avatarUrl" :alt="work.author" /><span v-else>{{ work.avatar || work.author.slice(0, 1) }}</span></span><div><strong>{{ work.author }}</strong><span class="caption-5">{{ new Date(work.date).toLocaleDateString('zh-CN') }} 发布</span></div></RouterLink>
        <FollowButton :user-id="work.authorId" author />
        <div class="detail-actions"><button class="button btn subtle" :class="{ selected: work.liked }" :aria-label="`喜欢作品，${work.likes} 赞`" :aria-pressed="work.liked" :disabled="pendingActions.has(`liked:${work.id}`)" @click="toggleWork(work, 'liked')"><Heart :size="17" />{{ work.likes }}</button><button class="button btn subtle" :class="{ selected: work.saved }" :aria-pressed="work.saved" :disabled="pendingActions.has(`saved:${work.id}`)" @click="toggleWork(work, 'saved')"><Bookmark :size="17" />{{ work.saved ? '已收藏' : '收藏' }}</button><button class="button btn subtle" :aria-pressed="!!work.renoted" :disabled="reposting" @click="repost"><Repeat2 :size="17" />{{ work.renotesCount || 0 }}</button><button class="icon-button" aria-label="通过私信分享作品" title="私信分享" @click="openShare"><Send :size="17" /></button><button v-if="session.user" class="icon-button" aria-label="举报作品" title="举报作品" @click="openReport()"><Flag :size="17" /></button></div>
        <p v-if="work.viewsCount !== undefined" class="muted view-count"><Eye :size="15" />{{ work.viewsCount }} 次浏览</p><section v-if="work.body && work.kind !== 'resource' && work.body.trim() !== (work.prompt || '').trim()" class="detail-description"><h2>创作说明</h2><p class="work-body">{{ work.body }}</p></section>
        <section class="prompt-section"><div class="section-heading"><h2>提示词</h2><button class="icon-button" aria-label="复制提示词" title="复制提示词" @click="copyPrompt"><Copy :size="16" /></button></div><p>{{ work.prompt || '作者未公开提示词。' }}</p></section>
        <dl class="work-properties"><div><dt>作品类型</dt><dd>{{ kindLabels[work.kind] }}</dd></div><div v-if="work.model"><dt>模型</dt><dd>{{ work.model }}</dd></div><div v-if="work.license"><dt>授权许可</dt><dd>{{ work.license }}</dd></div><div v-if="safeExternalUrl(work.sourceUrl)"><dt>来源</dt><dd><a :href="safeExternalUrl(work.sourceUrl)" target="_blank" rel="noopener noreferrer" class="text-link">查看原始来源</a></dd></div></dl>
        <div class="work-tags"><RouterLink v-for="tag in work.tags" :key="tag" :to="{ path: '/discover', query: { tag } }" class="tag-button">{{ tag }}</RouterLink></div><div class="detail-create"><RouterLink :to="{ path: '/create', query: { from: work.id } }" class="button btn primary remix-button"><WandSparkles :size="18" />带入创作</RouterLink><button v-if="work.kind !== 'resource' && work.prompt" class="button btn subtle remix-button" @click="queueBackgroundWork(work)"><WandSparkles :size="18" />后台生成同款</button></div>
      </aside>
    <section v-if="['published', 'approved'].includes(work.status)" class="related-section work-comments" aria-labelledby="comments-heading">
      <div class="section-heading"><h2 id="comments-heading">评论<span v-if="work.repliesCount"> · {{ work.repliesCount }}</span></h2><MessageSquare :size="18" /></div>
      <form v-if="session.user" class="stack" @submit.prevent="postComment"><div v-if="replyTo" class="reply-banner"><span>回复 {{ replyTo.author }}</span><button type="button" class="icon-button" aria-label="取消回复" @click="replyTo = null"><X :size="16" /></button></div><label class="field"><span>{{ replyTo ? '回复内容' : '发表评论' }}</span><textarea ref="commentInput" v-model="commentText" class="control" maxlength="3000" rows="3" :disabled="commentBusy" /></label><div v-if="commentFiles.length" class="comment-files"><span v-for="(file, index) in commentFiles" :key="file.id" class="tag-button">{{ file.name }}<button type="button" class="icon-button" :aria-label="`移除 ${file.name}`" :disabled="commentBusy" @click="commentFiles.splice(index, 1)"><X :size="14" /></button></span></div><div class="comment-submit"><label class="button btn subtle"><ImagePlus :size="16" />添加附件<input type="file" multiple :disabled="commentBusy" aria-label="评论附件" @change="chooseCommentFiles" /></label><button class="button btn primary" :disabled="commentBusy || (!commentText.trim() && !commentFiles.length)"><Send :size="16" />{{ commentBusy ? '正在提交…' : '发布评论' }}</button></div></form>
      <RouterLink v-else to="/account" class="text-link">登录后发表评论</RouterLink><p v-if="commentError" class="form-error" role="alert">{{ commentError }} <button class="text-link" @click="loadComments()">刷新评论</button></p><p v-if="commentsLoading && !comments.length" class="form-note" role="status">正在加载评论…</p>
      <WorkCommentItem v-for="comment in comments" :key="comment.id" :comment="comment" :work-id="work.id" :refresh="commentsRefresh" @reply="reply" @report="openReport" @deleted="comments = comments.filter(item => item.id !== $event.id)" /><p v-if="!commentsLoading && !comments.length && !commentError" class="form-note">暂无评论</p><button v-if="commentsCursor" class="button btn" :disabled="commentsLoading" @click="loadComments(true)">加载更多评论</button>
    </section></div>
    <section v-if="related.length" class="related-section related-works"><div class="section-heading"><h2>更多作品</h2><RouterLink to="/discover" class="text-link">全部作品</RouterLink></div><BentoGrid><WorkCard v-for="item in related" :key="item.id" :work="item" /></BentoGrid></section>
    <dialog ref="reportDialog" class="compact-dialog" aria-labelledby="report-heading"><div class="dialog-heading"><h2 id="report-heading">{{ reportComment ? '举报评论' : '举报作品' }}</h2><button class="icon-button" aria-label="关闭举报" :disabled="reporting" @click="reportDialog?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="report"><label class="field"><span>举报原因</span><textarea v-model="reportReason" class="control" required rows="4" maxlength="2000" :disabled="reporting" /></label><p v-if="reportError" role="alert" class="form-error">{{ reportError }}</p><button class="button btn primary" :disabled="reporting || !reportReason.trim()"><Flag :size="16" />提交举报</button></form></dialog>
    <dialog ref="shareDialog" class="compact-dialog" aria-labelledby="share-heading"><div class="dialog-heading"><h2 id="share-heading">私信分享作品</h2><button class="icon-button" aria-label="关闭私信分享" :disabled="sharing" @click="shareDialog?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="share"><label class="field"><span>接收人</span><select v-model="recipient" class="control" required><option value="">选择创作者</option><option v-for="person in recipients" :key="person.id" :value="person.id">{{ person.name || person.username }}</option></select></label><p class="form-note">互相关注后可分享作品。</p><p v-if="shareError" class="form-error" role="alert">{{ shareError }}</p><button class="button btn primary" :disabled="sharing || !recipient"><Send :size="16" />分享作品</button><RouterLink to="/messages" class="text-link">打开私信</RouterLink></form></dialog>
  </div>
  <div v-else class="empty-state"><h1>作品无法打开</h1><p role="alert">{{ error || '作品不存在或你没有访问权限。' }}</p><button class="button btn" @click="load">重试</button><RouterLink to="/discover" class="text-link">返回发现</RouterLink></div>
</template>

<style scoped>
.detail-topbar { margin-bottom: 24px; }
.detail-topbar .back-link { margin: 0; min-height: 40px; color: var(--muted); }
.detail-topbar .back-link:hover { color: var(--ink); }
.detail-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; column-gap: 28px; row-gap: 32px; align-items: start; }
.detail-visual { grid-column: 1; grid-row: 1; }
.detail-info { grid-column: 2; grid-row: 1 / span 2; position: sticky; top: calc(var(--header-height, 64px) + 24px); max-height: calc(100svh - var(--header-height, 64px) - var(--mobile-nav-height, 0px) - 48px); overflow-y: auto; scrollbar-gutter: stable; padding: 0 0 0 24px; border-left: 1px solid var(--border); }
.detail-title h1 { color: var(--ink); font-size: 22px; line-height: 32px; text-wrap: pretty; }
.creator-line { margin: 20px 0; }
.detail-actions { gap: 6px; margin-bottom: 16px; }
.detail-description { margin-top: 24px; }
.detail-description h2, .prompt-section h2 { color: var(--ink); font-size: 14px; line-height: 22px; font-weight: 500; }
.prompt-section { margin-top: 24px; padding: 20px 0; }
.prompt-section .section-heading { margin-bottom: 12px; }
.prompt-section p { color: var(--muted); font-size: 14px; line-height: 24px; }
.work-properties { gap: 12px; margin: 20px 0; font-size: 12px; }
.work-tags { margin: 16px 0; }
.detail-create { display: grid; gap: 8px; padding-top: 8px; }
.detail-create .remix-button { width: 100%; margin: 0; }
.work-comments { grid-column: 1; grid-row: 2; min-width: 0; margin: 0; padding-top: 24px; border-top: 1px solid var(--border); }
.work-comments > .section-heading { margin-bottom: 20px; }
.work-comments h2, .related-works h2 { font-size: 18px; line-height: 28px; }
.related-works { padding-top: 32px; border-top: 1px solid var(--border); }
.avatar { overflow: hidden; }.avatar img { width: 100%; height: 100%; object-fit: cover; }
.view-count, .comment-submit, .reply-banner, .comment-files { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.comment-submit, .reply-banner { justify-content: space-between; }.comment-submit input[type=file] { display: none; }
.view-count { font-size: 12px; line-height: 20px; }
.reply-banner { padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.work-body { color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 12px; font-size: 14px; line-height: 24px; }
.prompt-section p { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 360px; overflow-y: auto; }.work-properties dd { overflow-wrap: anywhere; }.detail-actions { flex-wrap: wrap; }
@media (max-width: 1099px) { .detail-layout { grid-template-columns: minmax(0, 1fr) 272px; column-gap: 24px; }.detail-info { padding-left: 20px; } }
@media (max-width: 899px) {
  .detail-layout { grid-template-columns: minmax(0, 1fr); gap: 28px; }
  .detail-visual { grid-column: 1; grid-row: 1; }
  .detail-info { grid-column: 1; grid-row: 2; position: static; max-height: none; overflow: visible; max-width: none; padding: 0; border-left: 0; }
  .work-comments { grid-column: 1; grid-row: 3; }
  .detail-title h1 { font-size: 24px; line-height: 32px; }
  .detail-description, .prompt-section { max-width: 72ch; }
}
@media (max-width: 639px) { .detail-topbar { margin-bottom: 16px; }.detail-layout { gap: 24px; }.related-works { margin-top: 32px; padding-top: 24px; } }
</style>
