<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, ChevronRight, Bookmark, Copy, Eye, Flag, Heart, ImagePlus, MessageSquare, Repeat2, Send, WandSparkles, X } from '@lucide/vue'
import { api, errorMessage, notify, pendingActions, queryString, safeExternalUrl, session, toggleWork, uploadFile } from '../state'
import { kindLabels, type Creator, type Work, type WorkComment, type WorkFile } from '../data'
import RelatedWorks from '../components/RelatedWorks.vue'
import FollowButton from '../components/FollowButton.vue'
import WorkMedia from '../components/WorkMedia.vue'
import WorkCommentItem from '../components/WorkCommentItem.vue'

const mobile = inject<Ref<boolean>>('mobile-community', ref(false))
const mediaBrowser = ref<InstanceType<typeof WorkMedia>>()
function openRelated() { mediaBrowser.value?.pause(); relatedDialog.value?.showModal() }
const commentsDialog = ref<HTMLDialogElement>(), relatedDialog = ref<HTMLDialogElement>()
watch(mobile, () => { commentsDialog.value?.close(); relatedDialog.value?.close() })
const route = useRoute()
const work = ref<Work | null>(null)
const promptExpanded = ref(false)
const longPrompt = computed(() => (work.value?.prompt?.length || 0) > 180 || (work.value?.prompt?.split('\n').length || 0) > 4)
const files = computed<WorkFile[]>(() => work.value?.files?.length ? work.value.files : work.value?.video ? [{ id: 'video', name: work.value.title, type: 'video/mp4', url: work.value.video }] : work.value?.cover ? [{ id: 'cover', name: work.value.title, type: 'image/jpeg', url: work.value.cover }] : [])
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
  commentsDialog.value?.close(); relatedDialog.value?.close()
  loading.value = true; error.value = ''; work.value = null; comments.value = []; commentsCursor.value = null
  replyTo.value = null; commentText.value = ''; commentFiles.value = []; promptExpanded.value = false
  try {
    const result = await api<{ work: Work }>(`/api/works/${encodeURIComponent(String(route.params.id))}`, { signal: active.signal })
    if (active.signal.aborted) return
    work.value = result.work
    if (['published', 'approved'].includes(result.work.status)) {
      void loadComments(false, active.signal)
      void api<{ viewsCount?: number }>(`/api/works/${encodeURIComponent(result.work.id)}/view`, { method: 'POST', body: {}, signal: active.signal }).then(value => { if (work.value?.id === result.work.id && value.viewsCount !== undefined) work.value.viewsCount = value.viewsCount }).catch(() => {})
    }
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
    if (!append && /^#comment-[a-zA-Z0-9]+$/.test(route.hash)) { await nextTick(); if (mobile.value) commentsDialog.value?.showModal(); document.getElementById(route.hash.slice(1))?.scrollIntoView({ block: 'center' }) }
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
async function reply(comment: WorkComment) { replyTo.value = comment; await focusComments(); }
async function focusComments() {
  mediaBrowser.value?.pause()
  if (mobile.value && !commentsDialog.value?.open) commentsDialog.value?.showModal()
  await nextTick()
  if (commentInput.value) commentInput.value.focus()
  else document.getElementById('comments-heading')?.scrollIntoView({ block: 'nearest' })
}
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
    <header v-if="!mobile" class="detail-toolbar"><RouterLink to="/discover" class="detail-return"><ArrowLeft :size="20" aria-hidden="true" /><span>返回发现</span></RouterLink><div class="detail-context"><span>{{ kindLabels[work.kind] }}作品</span><span v-if="work.viewsCount !== undefined"><Eye :size="16" aria-hidden="true" />{{ work.viewsCount.toLocaleString('zh-CN') }} 次浏览</span></div></header>
    <div class="detail-layout">
      <Teleport to="#mobile-related-content" :disabled="!mobile" defer><RelatedWorks :key="work.id" :work="work" /></Teleport>
      <article class="detail-focus" :key="work.id" aria-label="作品详情">
        <div class="detail-visual-column">
          <button v-if="mobile" type="button" class="mobile-related-toggle icon-button" aria-label="更多作品" aria-haspopup="dialog" @click="openRelated"><ChevronRight :size="22" /></button>
          <WorkMedia ref="mediaBrowser" class="detail-visual" :files="files" :references="work.referenceFiles" :title="work.title" :body="work.body" :resource="work.kind === 'resource'" />
        </div>
        <section class="detail-info" aria-label="作品信息与评论">
          <div class="detail-info-scroll">
            <div class="detail-creator">
              <RouterLink :to="{ path: '/community', query: { creator: work.authorId } }" class="creator-line"><span class="avatar blue"><img v-if="work.avatarUrl" :src="work.avatarUrl" :alt="work.author" /><span v-else>{{ work.avatar || work.author.slice(0, 1) }}</span></span><div><strong>{{ work.author }}</strong><span class="caption-5">{{ new Date(work.date).toLocaleDateString('zh-CN') }} 发布</span></div></RouterLink>
              <FollowButton :user-id="work.authorId" author />
            </div>
            <h1>{{ work.title }}</h1>
            <section v-if="work.body && work.kind !== 'resource' && work.body.trim() !== (work.prompt || '').trim()" class="detail-description"><h2 class="sr-only">创作说明</h2><p class="work-body">{{ work.body }}</p></section>
            <div class="detail-create">
              <RouterLink :to="{ path: `/create/${work.kind === 'resource' ? 'text' : work.kind}`, query: { remix: work.id, prepare: '1' } }" class="button btn primary remix-button"><WandSparkles :size="20" aria-hidden="true" /><span>制作同款</span><ChevronRight :size="18" aria-hidden="true" /></RouterLink>
              <span v-if="work.viewsCount !== undefined" class="muted view-count"><Eye :size="14" />{{ work.viewsCount }} 次浏览</span>
            </div>
            <details class="detail-metadata" :open="!mobile">
              <summary>提示词与作品信息</summary>
              <section class="prompt-section"><div class="section-heading"><h2>提示词</h2><button class="icon-button" aria-label="复制提示词" title="复制提示词" @click="copyPrompt"><Copy :size="16" /></button></div><p id="work-prompt" :class="{ 'prompt-collapsed': longPrompt && !promptExpanded }">{{ work.prompt || '作者未公开提示词。' }}</p><button v-if="longPrompt" class="text-link prompt-expand" :aria-expanded="promptExpanded" aria-controls="work-prompt" @click="promptExpanded = !promptExpanded">{{ promptExpanded ? '收起提示词' : '展开全部提示词' }}</button></section>
              <dl class="work-properties"><div><dt>作品类型</dt><dd>{{ kindLabels[work.kind] }}</dd></div><div v-if="work.model"><dt>模型</dt><dd>{{ work.model }}</dd></div><div v-if="work.license"><dt>授权许可</dt><dd>{{ work.license }}</dd></div><div v-if="safeExternalUrl(work.sourceUrl)"><dt>来源</dt><dd><a :href="safeExternalUrl(work.sourceUrl)" target="_blank" rel="noopener noreferrer" class="text-link">查看原始来源</a></dd></div></dl>
              <div v-if="work.tags.length" class="work-tags"><RouterLink v-for="tag in work.tags" :key="tag" :to="{ path: '/discover', query: { tag } }" class="tag-button">{{ tag }}</RouterLink></div>
            </details>
            <Teleport to="#mobile-work-comments" :disabled="!mobile" defer>
            <section v-if="['published', 'approved'].includes(work.status)" class="work-comments" aria-labelledby="comments-heading">
              <div class="section-heading"><h2 id="comments-heading">评论<span v-if="work.repliesCount"> · {{ work.repliesCount }}</span></h2></div>
              <p v-if="commentsLoading && !comments.length" class="form-note" role="status">正在加载评论…</p>
              <WorkCommentItem v-for="comment in comments" :key="comment.id" :comment="comment" :work-id="work.id" :refresh="commentsRefresh" @reply="reply" @report="openReport" @deleted="comments = comments.filter(item => item.id !== $event.id)" />
              <p v-if="!commentsLoading && !comments.length && !commentError" class="form-note">暂无评论</p>
              <button v-if="commentsCursor" class="button btn" :disabled="commentsLoading" @click="loadComments(true)">加载更多评论</button>
            </section>
            </Teleport>
          </div>
          <div class="detail-actions">
            <button class="icon-button like-work" :class="{ selected: work.liked }" :aria-label="`喜欢作品，${work.likes} 赞`" :aria-pressed="work.liked" :disabled="pendingActions.has(`liked:${work.id}`)" @click="toggleWork(work, 'liked')"><Heart :size="20" :fill="work.liked ? 'currentColor' : 'none'" /><span>{{ work.likes }}</span></button>
            <button v-if="['published', 'approved'].includes(work.status)" class="icon-button" aria-label="跳转评论" title="发表评论" @click="focusComments"><MessageSquare :size="20" /></button>
            <button class="icon-button" aria-label="通过私信分享作品" title="私信分享" @click="openShare"><Send :size="20" /></button>
            <button class="icon-button" :aria-label="`转发作品，${work.renotesCount || 0} 次转发`" :aria-pressed="!!work.renoted" :disabled="reposting" title="转发作品" @click="repost"><Repeat2 :size="20" /></button>
            <button v-if="session.user" class="icon-button" aria-label="举报作品" title="举报作品" @click="openReport()"><Flag :size="18" /></button>
            <button class="button btn subtle save-detail" :aria-pressed="work.saved" :disabled="pendingActions.has(`saved:${work.id}`)" @click="toggleWork(work, 'saved')"><Bookmark :size="17" :fill="work.saved ? 'currentColor' : 'none'" />{{ work.saved ? '已收藏' : '收藏' }}</button>
          </div>
          <Teleport to="#mobile-work-comment-entry" :disabled="!mobile" defer>
          <div v-if="['published', 'approved'].includes(work.status)" class="detail-comment-entry">
            <p v-if="commentError" class="form-error" role="alert">{{ commentError }} <button class="text-link" @click="loadComments()">刷新评论</button></p>
            <form v-if="session.user" class="comment-composer" @submit.prevent="postComment">
              <div v-if="replyTo" class="reply-banner"><span>回复 {{ replyTo.author }}</span><button type="button" class="icon-button" aria-label="取消回复" @click="replyTo = null"><X :size="16" /></button></div>
              <div v-if="commentFiles.length" class="comment-files"><span v-for="(file, index) in commentFiles" :key="file.id" class="tag-button">{{ file.name }}<button type="button" class="icon-button" :aria-label="`移除 ${file.name}`" :disabled="commentBusy" @click="commentFiles.splice(index, 1)"><X :size="14" /></button></span></div>
              <div class="comment-input-row">
                <textarea ref="commentInput" v-model="commentText" class="control" :aria-label="replyTo ? '回复内容' : '发表评论'" :placeholder="replyTo ? `回复 ${replyTo.author}` : '添加评论'" maxlength="3000" rows="1" :disabled="commentBusy" />
                <label class="icon-button comment-upload" title="添加附件"><ImagePlus :size="20" /><input type="file" multiple :disabled="commentBusy" aria-label="评论附件" @change="chooseCommentFiles" /></label>
                <button class="icon-button" aria-label="发布评论" :aria-busy="commentBusy" title="发布评论" :disabled="commentBusy || (!commentText.trim() && !commentFiles.length)"><Send :size="20" /></button>
              </div>
            </form>
            <RouterLink v-else :to="{ path: '/account', query: { returnTo: route.fullPath } }" class="comment-login text-link">登录后发表评论</RouterLink>
          </div>
          </Teleport>
        </section>
      </article>
    </div>
    <dialog ref="commentsDialog" class="mobile-comments-dialog" aria-labelledby="mobile-comments-heading" @click="($event.target === commentsDialog) && commentsDialog?.close()"><div class="dialog-heading"><h2 id="mobile-comments-heading">评论<span v-if="work.repliesCount"> · {{ work.repliesCount }}</span></h2><button class="icon-button" aria-label="关闭评论" @click="commentsDialog?.close()"><X :size="20" /></button></div><div id="mobile-work-comments" /><div id="mobile-work-comment-entry" /></dialog>
    <dialog ref="relatedDialog" class="mobile-related-dialog" aria-labelledby="mobile-related-heading" @click="($event.target === relatedDialog) && relatedDialog?.close()"><div class="dialog-heading"><h2 id="mobile-related-heading">同类作品</h2><button class="icon-button" aria-label="关闭更多作品" @click="relatedDialog?.close()"><X :size="20" /></button></div><div id="mobile-related-content" /></dialog>
    <dialog ref="reportDialog" class="compact-dialog" aria-labelledby="report-heading"><div class="dialog-heading"><h2 id="report-heading">{{ reportComment ? '举报评论' : '举报作品' }}</h2><button class="icon-button" aria-label="关闭举报" :disabled="reporting" @click="reportDialog?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="report"><label class="field"><span>举报原因</span><textarea v-model="reportReason" class="control" required rows="4" maxlength="2000" :disabled="reporting" /></label><p v-if="reportError" role="alert" class="form-error">{{ reportError }}</p><button class="button btn primary" :disabled="reporting || !reportReason.trim()"><Flag :size="16" />提交举报</button></form></dialog>
    <dialog ref="shareDialog" class="compact-dialog" aria-labelledby="share-heading"><div class="dialog-heading"><h2 id="share-heading">私信分享作品</h2><button class="icon-button" aria-label="关闭私信分享" :disabled="sharing" @click="shareDialog?.close()"><X :size="20" /></button></div><form class="dialog-body stack" @submit.prevent="share"><label class="field"><span>接收人</span><select v-model="recipient" class="control" required><option value="">选择创作者</option><option v-for="person in recipients" :key="person.id" :value="person.id">{{ person.name || person.username }}</option></select></label><p class="form-note">互相关注后可分享作品。</p><p v-if="shareError" class="form-error" role="alert">{{ shareError }}</p><button class="button btn primary" :disabled="sharing || !recipient"><Send :size="16" />分享作品</button><RouterLink to="/messages" class="text-link">打开私信</RouterLink></form></dialog>
  </div>
  <div v-else class="empty-state"><h1>作品无法打开</h1><p role="alert">{{ error || '作品不存在或你没有访问权限。' }}</p><button class="button btn" @click="load">重试</button><RouterLink to="/discover" class="text-link">返回发现</RouterLink></div>
</template>

<style scoped>
.detail-page { --detail-height: clamp(540px, calc(100svh - var(--header-height) - 80px), 1080px); max-width: 2000px; padding-top: 8px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.detail-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; margin-bottom: 12px; font-size: 13px; }
.detail-return { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding-right: 12px; }
.detail-return:hover { color: var(--blue); }
.detail-context, .detail-context > span { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.detail-context { gap: 24px; }
.detail-layout { display: grid; grid-template-columns: clamp(180px, 18vw, 260px) minmax(0, 1fr); gap: 20px; align-items: start; }
.detail-focus { display: grid; grid-template-columns: minmax(0, 1fr) clamp(300px, 26vw, 380px); height: var(--detail-height); min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.detail-visual-column { position: relative; min-width: 0; min-height: 0; background: var(--canvas); }
.detail-visual { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow-y: auto; }
.detail-visual :deep(.media-stage) { display: flex; flex-direction: column; flex: 1 0 320px; min-height: 0; border: 0; border-radius: 0; }
.detail-visual :deep(.detail-media) { flex: 1; height: 0; min-height: 0; background: var(--canvas); }
.detail-visual :deep(.detail-media > img), .detail-visual :deep(.detail-media > video) { max-height: 100%; object-fit: contain; }
.detail-visual :deep(.media-controls) { min-height: 52px; padding: 4px 8px; gap: 4px; grid-template-columns: max-content max-content; justify-content: space-between; }
.detail-visual :deep(.media-file-name) { display: none; }
.detail-visual :deep(.resource-article) { flex: 1 0 auto; padding: 28px; }
.detail-visual :deep(.resource-article pre) { font-size: 14px; line-height: 24px; }
.detail-info { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 0 16px; border-left: 1px solid var(--border); }
.detail-actions { flex: none; flex-wrap: wrap; gap: 4px; min-height: 60px; margin: 0; padding-block: 8px; border-block: 1px solid var(--border); }
.detail-actions .icon-button { width: 40px; min-width: 40px; height: 44px; min-height: 44px; padding: 0; }
.detail-actions .like-work { width: auto; gap: 6px; padding-inline: 4px; font-size: 14px; font-weight: 500; }
.like-work.selected { color: var(--danger); }
.save-detail { min-height: 44px; margin-left: auto; padding-inline: 12px; }
.detail-info-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-wrap: anywhere; padding-block: 24px; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.detail-info h1 { font-size: 24px; line-height: 34px; font-weight: 600; overflow-wrap: anywhere; margin-top: 24px; text-wrap: pretty; }
.detail-creator { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-top: 0; }
.creator-line { margin: 0; gap: 8px; min-width: 0; }
.creator-line .avatar { width: 40px; height: 40px; flex: none; }
.creator-line > div { min-width: 0; }
.creator-line strong { overflow-wrap: anywhere; }
.detail-creator :deep(.follow-button) { padding-inline: 8px; font-size: 12px; }
.detail-description { margin-top: 16px; }
.work-body, .prompt-section p { color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 24px; }
.detail-create { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
.remix-button { width: 100%; min-height: 48px; margin: 0; padding-inline: 16px; font-size: 15px; gap: 10px; }
.remix-button > span { flex: 1; text-align: left; }
.view-count { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; line-height: 20px; }
.detail-metadata { margin-top: 24px; border-top: 1px solid var(--border); }
.detail-metadata > summary { min-height: 48px; padding-block: 14px; color: var(--ink); font-size: 13px; font-weight: 500; cursor: pointer; }
.detail-metadata > summary:hover { color: var(--ink); }
.prompt-section { padding: 0; }
.prompt-section p { color: var(--ink); }
.prompt-section .prompt-collapsed { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.prompt-expand { display: inline-flex; align-items: center; min-height: 44px; font-size: 13px; }
.prompt-section .section-heading { margin-bottom: 8px; }
.prompt-section h2 { font-size: 14px; line-height: 22px; font-weight: 500; }
.work-properties { gap: 8px; margin: 16px 0; font-size: 12px; }
.work-properties > div { display: flex; gap: 16px; align-items: baseline; justify-content: space-between; }
.work-properties dt { flex: none; }
.work-properties dd { text-align: right; }
.work-properties dd { overflow-wrap: anywhere; }
.work-tags { margin: 16px 0; }
.work-comments { min-width: 0; margin-top: 12px; padding-top: 16px; border-top: 1px solid var(--border); }
.work-comments > .section-heading { margin-bottom: 12px; }
.work-comments h2 { font-size: 14px; line-height: 22px; font-weight: 500; }
.work-comments :deep(.comment-item) { padding-block: 12px; border-bottom: 0; }
.work-comments :deep(.avatar) { width: 28px; height: 28px; }
.work-comments :deep(.comment-text) { font-size: 14px; line-height: 22px; }
.work-comments :deep(.comment-actions) { gap: 4px; margin-top: 4px; }
.work-comments :deep(.comment-actions .button) { min-height: 32px; padding: 4px 8px; font-size: 12px; background: transparent; }
.detail-comment-entry { flex: none; padding-block: 12px; }
.comment-composer { display: flex; flex-direction: column; gap: 8px; }
.comment-input-row { display: flex; align-items: flex-end; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 8px; }
.comment-input-row:focus-within { outline: 2px solid var(--focus-ring); outline-offset: var(--focus-outline-offset); }
.comment-input-row textarea { flex: 1; width: 0; min-width: 0; min-height: 44px; max-height: 144px; padding: 10px 8px; border: 0; outline: 0; background: transparent; resize: vertical; font-size: 14px; line-height: 24px; }
.comment-input-row .icon-button { width: 36px; min-width: 36px; min-height: 44px; }
.comment-upload { position: relative; overflow: hidden; }
.comment-upload input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.comment-login { display: flex; align-items: center; min-height: 44px; font-size: 14px; }
.avatar { overflow: hidden; }.avatar img { width: 100%; height: 100%; object-fit: cover; }
.reply-banner, .comment-files { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.reply-banner { justify-content: space-between; color: var(--muted); font-size: 12px; }
.comment-files .tag-button { max-width: 100%; overflow-wrap: anywhere; white-space: normal; }
@media (min-width: 1000px) {
  .detail-create .view-count { display: none; }
}
@media (max-width: 767px) {
  .detail-focus { grid-template-columns: minmax(0, 1fr); height: auto; min-height: 0; overflow: visible; }
  .detail-visual { height: auto; max-height: none; overflow: visible; }
  .detail-visual :deep(.media-stage) { flex: auto; }
  .detail-visual :deep(.detail-media) { flex: none; height: auto; min-height: 240px; }
  .detail-visual :deep(.detail-media > img), .detail-visual :deep(.detail-media > video) { height: auto; max-height: 52svh; }
  .detail-actions { gap: 0; }
  .detail-info { padding-inline: 12px; }
  .detail-info-scroll { overflow: visible; }
  .detail-info h1 { font-size: 18px; line-height: 26px; }
  .detail-comment-entry { background: var(--canvas); }
  .detail-actions .icon-button, .comment-input-row .icon-button { min-width: 44px; width: 44px; min-height: 44px; height: 44px; }
  .comment-input-row textarea { font-size: 16px; }
  .work-comments :deep(.comment-actions .button) { min-height: 44px; }
}
@media (pointer: coarse) {
  .detail-actions .icon-button, .comment-input-row .icon-button { min-width: 44px; min-height: 44px; }
  .work-comments :deep(.comment-actions .button) { min-height: 44px; }
}

@media (max-width: 999px) {
  .detail-page { padding: 0; }
  .detail-layout { display: block; }
  .detail-focus { --canvas: #0b1011; --surface: #172426; --ink: #fff; --muted: #d0d9da; position: relative; top: auto; display: block; height: calc(100dvh - var(--header-height)); min-height: 400px; border: 0; border-radius: 0; overflow: hidden; background: #0b1011; color: #fff; }
  .detail-visual-column { position: absolute; inset: 0; }
  .detail-visual { height: 100%; overflow: auto; padding-bottom: 260px; }
  .detail-visual :deep(.media-stage) { position: relative; flex: 1 0 100%; min-height: 140px; }
  .detail-visual:has(.material-tray) :deep(.media-stage) { flex: 1 0 140px; }
  .detail-visual :deep(.media-controls) { position: absolute; z-index: 2; top: 8px; left: 8px; right: 8px; border: 0; border-radius: 12px; background: #172426c9; }
  .detail-visual :deep(.detail-media) { height: 100%; flex: 1; min-height: 0; background: #0b1011; }
  .detail-visual :deep(.detail-media:has(> video)) { width: calc(100% - 64px); }
  .detail-visual :deep(.detail-media > img), .detail-visual :deep(.detail-media > video) { width: 100%; height: 100%; max-height: 100%; object-fit: contain; }
  .detail-visual :deep(.resource-article) { padding: 24px 20px; background: #0b1011; }
  .detail-info { display: contents; border: 0; }
  .detail-info-scroll { position: absolute; bottom: 0; left: 0; right: 60px; max-height: 260px; padding: 38px 14px 16px; background: linear-gradient(transparent, #0b1011ed 34%); overflow-y: auto; display: flex; flex-direction: column; }
  .detail-info-scroll:has(.detail-metadata[open]) { max-height: calc(100% - 12px); padding-top: 16px; background: #172426f5; border-radius: 16px 16px 0 0; }
  .detail-creator { order: -1; margin: 0 0 8px; }
  .creator-line { margin: 0; }
  .creator-line .avatar { width: 28px; height: 28px; }
  .creator-line strong { font-size: 13px; }
  .creator-line .caption-5 { display: none; }
  .detail-info h1 { margin-top: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
  .detail-description { margin-top: 6px; }
  .work-body { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 12px; line-height: 20px; }
  .detail-info-scroll:has(.detail-metadata[open]) .work-body { display: block; }
  .detail-create { margin-top: 8px; }
  .detail-create .remix-button { min-height: 44px; background: var(--blue); color: var(--action-ink); border: 0; border-radius: 10px; padding-inline: 12px; }
  .view-count { font-size: 10px; }
  .detail-metadata { margin-top: 0; border: 0; }
  .remix-button { width: auto; font-size: 12px; }
  .remix-button > svg:last-child { display: none; }
  .detail-metadata > summary { min-height: 44px; font-size: 12px; color: #d0d9da; }
  .detail-actions { position: absolute; right: 6px; bottom: 16px; display: flex; flex-direction: column; flex-wrap: nowrap; align-items: center; gap: 6px; padding: 0; min-height: 0; width: 48px; border: 0; }
  .detail-actions .icon-button, .detail-actions .save-detail { display: flex; flex-direction: column; justify-content: center; gap: 2px; width: 48px; min-width: 44px; min-height: 48px; height: auto; margin: 0; padding: 4px; border: 0; border-radius: 24px; background: #0b1011a6; color: #fff; font-size: 11px; }
  .detail-actions .selected, .detail-actions [aria-pressed="true"] { color: var(--blue); }
  .mobile-related-toggle { position: absolute; z-index: 3; left: 0; top: 35%; width: 32px; height: 48px; border-radius: 0 12px 12px 0; background: #172426cc; color: #fff; }
  .mobile-comments-dialog { position: fixed; inset: auto 0 0; width: 100%; max-width: 100%; max-height: min(82dvh, calc(100dvh - 24px)); margin: 0; padding: 0 0 env(safe-area-inset-bottom); border-radius: 20px 20px 0 0; overflow: auto; }
  .mobile-comments-dialog[open] { display: flex; flex-direction: column; }
  .mobile-comments-dialog .dialog-heading { flex: none; }
  #mobile-work-comments { flex: 1; min-height: 100px; overflow-y: auto; padding: 0 16px; }
  #mobile-work-comments .work-comments { margin: 0; padding: 0 0 16px; border: 0; }
  #mobile-work-comments .work-comments > .section-heading { display: none; }
  #mobile-work-comment-entry { flex: none; padding: 0 12px; border-top: 1px solid var(--border); }
  #mobile-work-comment-entry .detail-comment-entry { background: transparent; }
  .mobile-related-dialog { position: fixed; inset: 0 auto 0 0; width: min(90vw, 420px); height: 100dvh; max-height: 100dvh; max-width: 90vw; margin: 0; padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); border-radius: 0 16px 16px 0; }
  .mobile-related-dialog[open] { display: flex; flex-direction: column; overflow: hidden; }
  .mobile-related-dialog > .dialog-heading { flex: none; }
  #mobile-related-content { flex: 1; min-height: 0; padding: 0 12px 16px; }
}

</style>
