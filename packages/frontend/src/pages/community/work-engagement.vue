<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="root" :class="[$style.root, { [$style.previewLayout]: previewComments }]" :data-motion="prefer.s.animation" data-testid="work-engagement">
	<div :class="$style.main" data-testid="work-main">
	<slot></slot>
	<div :class="$style.actions" data-testid="work-actions">
		<button type="button" class="_button" :class="{ [$style.active]: showComments }" :title="!discussion && !previewComments && showComments ? t.closeComments : t.comment" :aria-label="`${t.comment} ${replyCount}`" :aria-expanded="showComments" @click="openComment"><i class="ti ti-message-circle" aria-hidden="true"></i><span>{{ format(replyCount) }}</span></button>
		<button type="button" class="_button" :class="{ [$style.active]: repostState === 'sent', [$style.reposted]: repostConfirmed }" :title="repostState === 'sent' ? t.reposted : t.repost" :aria-label="`${repostState === 'sent' ? t.reposted : t.repost} ${repostCount}`" :aria-busy="activeAction === 'repost' || repostState === 'sending'" :disabled="working || busy || repostState === 'sent' || repostState === 'uncertain'" @click="onRepost"><i class="ti ti-repeat" aria-hidden="true"></i><span>{{ format(repostCount) }}</span></button>
		<button type="button" class="_button" :class="{ [$style.liked]: liked, [$style.likeConfirmed]: liked && reactionFeedback === t.liked }" :aria-pressed="liked" :aria-busy="activeAction === 'like' || reactionBusy" :title="liked ? t.liked : t.like" :aria-label="`${liked ? t.liked : t.like} ${likeCount}`" :disabled="working || busy" @click="onLike"><i :class="liked ? 'ti ti-heart-filled' : 'ti ti-heart'" aria-hidden="true"></i><span>{{ format(likeCount) }}</span></button>
		<span :class="$style.views" :title="t.viewHint" :aria-label="`${t.views} ${viewsCount ?? work.viewsCount ?? '—'}`"><i class="ti ti-chart-bar" aria-hidden="true"></i><span>{{ format(viewsCount ?? work.viewsCount) }}</span></span>
		<button type="button" class="_button" :class="{ [$style.copied]: shareState === 'copied' }" :aria-label="shareState === 'copied' ? t.copied : t.share" :title="shareState === 'copied' ? t.copied : t.share" :aria-busy="shareState === 'copying'" :disabled="shareState === 'copying'" @click="share"><i :class="shareState === 'copied' ? 'ti ti-check' : 'ti ti-share-2'" aria-hidden="true"></i></button>
	</div>
	<p v-if="working" :class="$style.feedback" role="status">{{ activeAction === 'like' ? t.updatingLike : activeAction === 'repost' ? t.reposting : t.refreshingInteraction }}</p>
	<p v-else-if="reactionFeedback" :class="$style.feedback" role="status">{{ reactionFeedback }}</p>
	<p v-if="!working && repostState === 'sent'" :class="$style.feedback" role="status">{{ t.repostSuccess }}</p>
	<p v-if="actionFailed || reactionFailed" :class="$style.feedback" role="alert">{{ t.interactionFailed }} <button type="button" class="_button" :disabled="working || busy" @click="retryInteraction">{{ t.retry }}</button></p>
	<p v-if="!working && (repostState === 'rejected' || repostState === 'uncertain')" :class="$style.feedback" role="status">{{ repostState === 'uncertain' ? t.repostUncertain : t.repostFailed }}</p>
	<p v-if="shareFailed" :class="$style.feedback" role="alert">{{ t.shareFailed }} <MkA :to="workPath(work.id)">{{ work.title }}</MkA></p>
	<slot name="afterActions"></slot>
	</div>
	<Transition :css="prefer.s.animation" :enterActiveClass="$style.discussionEnter" :enterFromClass="$style.discussionFrom">
	<section v-if="showComments || previewComments" :class="[$style.discussion, { [$style.previewDiscussion]: previewComments }]" :aria-label="previewComments ? t.commentPreview : t.comments" :aria-busy="refreshingComments || loadingComments" data-testid="work-discussion">
		<header v-if="discussion || previewComments" :class="$style.commentHeading"><h2>{{ previewComments ? t.commentPreview : t.comments }} <span>{{ format(replyCount) }}</span></h2><button type="button" class="_button" :aria-label="t.refresh" :disabled="refreshing || busy || working" @click="refresh"><i class="ti ti-refresh" aria-hidden="true"></i></button></header>
		<template v-for="part in previewComments ? ['comments', 'composer'] : ['composer', 'comments']" :key="part">
		<div v-if="part === 'composer'" :class="$style.commentEntry">
		<button v-if="previewComments && !showComments && $i" type="button" class="_button" :class="$style.commentPrompt" @click="openComment"><i class="ti ti-message-circle" aria-hidden="true"></i>{{ t.writeComment }}<i class="ti ti-pencil" aria-hidden="true"></i></button>
		<form v-else-if="$i" :class="$style.composer" @submit.prevent="submitComment">
			<label><textarea :ref="el => { input = (el as HTMLTextAreaElement | null) ?? undefined; }" v-model="draft" :placeholder="t.commentPlaceholder" :aria-label="t.comment" :readonly="commentState === 'sending'" rows="2" data-testid="work-comment-input" @keydown="onCommentKeydown"></textarea></label>
			<div :class="$style.send"><span v-if="draftLength" :class="{ [$style.error]: draftLength > maxLength }">{{ draftLength }} / {{ maxLength }}</span><button type="submit" class="_button" :disabled="!canSubmitComment" data-testid="work-send-comment">{{ commentState === 'sending' ? t.sending : t.send }}</button></div>
			<p :class="$style.keyboardHint">{{ t.commentShortcut }}</p>
		</form>
		<button v-else :ref="el => { signin = (el as HTMLButtonElement | null) ?? undefined; }" type="button" class="_button" :class="$style.signin" @click="requestLogin">{{ t.login }}</button>
		<p v-if="draftLength > maxLength" :class="[$style.feedback, $style.error]" role="alert">{{ t.commentTooLong }}</p>
		<p v-if="commentState === 'sent'" :class="$style.feedback" role="status">{{ t.sent }}</p>
		<p v-if="commentState === 'rejected' || commentState === 'uncertain'" :class="$style.feedback" role="alert">{{ commentState === 'uncertain' ? t.uncertain : t.commentFailed }} <button v-if="commentState === 'uncertain'" type="button" class="_button" @click="acknowledgeRetry">{{ t.retrySend }}</button></p>
		</div>
		<template v-else>
		<p v-if="state === 'loading' || (refreshingComments && !comments.length)" :class="$style.feedback" role="status">{{ state === 'loading' ? t.loading : t.loadingComments }}</p>
		<p v-else-if="state === 'error' || state === 'unavailable'" :class="$style.feedback" role="alert">{{ state === 'unavailable' ? t.unavailable : t.failed }} <button type="button" class="_button" @click="refresh">{{ t.retry }}</button></p>
		<p v-if="commentsFailed" :class="$style.feedback" role="alert">{{ t.commentsFailed }} <button type="button" class="_button" @click="refresh">{{ t.retry }}</button></p>
		<div v-if="comments.length" :ref="el => { viewport = (el as HTMLElement | null) ?? undefined; }" :class="{ [$style.previewViewport]: previewComments }" data-testid="comment-viewport">
		<ul :ref="el => { list = (el as HTMLElement | null) ?? undefined; }" :class="$style.comments"><li v-for="(reply, index) in comments" :key="reply.id" :class="{ [$style.hiddenComment]: previewComments && index >= visibleCount }" :aria-hidden="previewComments && index >= visibleCount ? true : undefined" :inert="previewComments && index >= visibleCount" data-testid="work-comment"><MkA :to="`/@${reply.user.username}`" :class="$style.avatar"><MkAvatar :user="reply.user" :link="false" :preview="false"/></MkA><div :class="$style.reply"><div :class="$style.replyHeader"><MkA :to="`/@${reply.user.username}`"><strong>{{ reply.user.name || reply.user.username }}</strong></MkA><time :datetime="reply.createdAt">{{ date(reply.createdAt) }}</time></div><p v-if="reply.text"><Mfm :text="reply.text" :plain="true"/></p><MkA v-if="reply.files?.length" :to="`/notes/${reply.id}`" :class="$style.attachment">{{ t.attachmentComment }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div></li></ul>
		</div>
		<p v-else-if="state === 'ready' && !refreshingComments && !commentsFailed" :class="$style.empty">{{ replyCount ? t.noPreviewComments : t.emptyComments }}</p>
		<div v-if="previewComments" :ref="el => { footer = (el as HTMLElement | null) ?? undefined; }" :class="$style.previewFooter"><MkA :to="workPath(work.id)" data-testid="all-comments">{{ t.allComments }}<i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div>
		<button v-else-if="commentsMore" type="button" class="_button" :class="$style.more" :disabled="loadingComments || refreshing" @click="loadMoreComments">{{ loadingComments ? t.loadingComments : t.loadMore }}</button>
		</template>
		</template>
	</section>
	</Transition>
</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import type { CommunityWork } from './types.js';
import { workText as t, workPath } from './interactions-copy.js';
import { useCommentPreview } from './use-comment-preview.js';
import { useWorkInteractions } from '@/pages/home/use-work-interactions.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{ work: CommunityWork; discussion?: boolean; previewComments?: boolean; viewsCount?: number }>();
const showComments = ref(!!props.discussion);
const previewVisible = ref(false);
const input = ref<HTMLTextAreaElement>();
const signin = ref<HTMLButtonElement>();
const { state, note, comments, commentsFailed, commentsMore, loadingComments, loadMoreComments, refreshing, refreshingComments, myReaction, liked, otherReaction, likes, reactionBusy, reactionFailed, draft, draftLength, maxLength, commentState, busy, canComment, refresh, refreshNote, toggleLike, sendComment, repost, repostState } = useWorkInteractions(() => props.work.approvedNoteId, { immediate: !!props.discussion, publicOnly: false, loadComments: () => showComments.value || (props.previewComments === true && previewVisible.value), commentLimit: 20 });
const { root, viewport, list, footer, inView, visibleCount, schedule } = useCommentPreview(() => !!props.previewComments, () => comments.value, fillPreview);
watch(inView, value => { previewVisible.value = value; });
let emptyPages = 0;
let fillingPreview = false;
let previewVersion = 0;
watch(refreshingComments, value => { if (value) { emptyPages = 0; previewVersion++; } else schedule(); });
watch([commentsMore, loadingComments, showComments, refreshing, inView], () => {
	if (!comments.value.length) void fillPreview();
	schedule();
}, { flush: 'post' });

async function fillPreview() {
	if (!inView.value || !commentsMore.value || refreshing.value || loadingComments.value || fillingPreview || commentsFailed.value || emptyPages >= 3) return;
	const current = props.work.approvedNoteId;
	const version = previewVersion;
	const before = comments.value.length;
	fillingPreview = true;
	try {
		await loadMoreComments();
		// Stop after consecutive pages containing no eligible comments, not after a fixed number of previews.
		if (current === props.work.approvedNoteId && version === previewVersion) emptyPages = comments.value.length === before ? emptyPages + 1 : 0;
	} finally { fillingPreview = false; }
	await nextTick();
	if (!comments.value.length) void fillPreview();
	schedule();
}

const activeAction = ref<'like' | 'repost' | 'refresh' | null>(null);
const working = computed(() => activeAction.value !== null);
const canSubmitComment = computed(() => canComment.value && !working.value);
const reactionFeedback = ref('');
const actionFailed = ref(false);
const shareFailed = ref(false);
const shareState = ref<'idle' | 'copying' | 'copied'>('idle');
const repostConfirmed = ref(false);
let shareGeneration = 0;
let shareTimer: number | undefined;
const likeCount = computed(() => note.value ? likes.value : props.work.likesCount);
const replyCount = computed(() => note.value?.repliesCount ?? props.work.repliesCount);
const repostCount = computed(() => note.value?.renoteCount ?? props.work.renotesCount);
const format = (value?: number) => value == null ? '—' : new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

let active = true;
let actionGeneration = 0;
let loginOpening = false;
let disposeLogin: (() => void) | undefined;

async function requestLogin() {
	if (!active || loginOpening) return;
	loginOpening = true;
	try {
		const component = await import('@/components/MkSigninDialog.vue');
		if (!active) return;
		const { dispose } = await os.popupAsyncWithDialog(Promise.resolve(component.default), { autoSet: true, message: t.loginHint }, { closed: () => { dispose(); disposeLogin = undefined; loginOpening = false; } });
		if (!active) { dispose(); return; }
		disposeLogin = dispose;
	} catch { actionFailed.value = true; loginOpening = false; }
}

function clearFeedback() { actionGeneration++; activeAction.value = null; actionFailed.value = false; reactionFeedback.value = ''; shareGeneration++; window.clearTimeout(shareTimer); shareState.value = 'idle'; shareFailed.value = false; repostConfirmed.value = false; }

function deactivate() { active = false; clearFeedback(); disposeLogin?.(); disposeLogin = undefined; loginOpening = false; }

onActivated(() => { active = true; });
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
watch(() => props.work.approvedNoteId, clearFeedback);

async function openComment() {
	if (!props.discussion && !props.previewComments && showComments.value) { showComments.value = false; return; }
	showComments.value = true;
	await nextTick();
	(input.value ?? signin.value)?.focus();
}

async function submitComment() {
	if (!canSubmitComment.value) return;
	await sendComment();
	if (active && commentState.value === 'sent') input.value?.focus();
}

function onCommentKeydown(event: KeyboardEvent) {
	if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || (!event.ctrlKey && !event.metaKey) || event.shiftKey || event.altKey) return;
	event.preventDefault();
	void submitComment();
}

async function action(kind: 'like' | 'repost' | 'refresh', callback?: (valid: () => boolean) => Promise<void>) {
	if (!$i) { requestLogin(); return; }
	if (working.value || busy.value) return;
	const ticket = ++actionGeneration;
	const valid = () => active && ticket === actionGeneration;
	activeAction.value = kind; actionFailed.value = false; reactionFailed.value = false; reactionFeedback.value = '';
	try {
		const verified = await refreshNote();
		if (!valid()) return;
		if (!verified) { actionFailed.value = true; return; }
		await callback?.(valid);
	} catch { if (valid()) actionFailed.value = true; } finally { if (ticket === actionGeneration) activeAction.value = null; }
}

async function onLike() {
	const wantLiked = !liked.value;
	await action('like', async valid => {
		if (myReaction.value === undefined) { actionFailed.value = true; return; }
		if (liked.value === wantLiked) { reactionFeedback.value = wantLiked ? t.liked : t.unliked; return; }
		if (otherReaction.value && (await os.confirm({ type: 'question', text: t.replaceReaction })).canceled) return;
		if (!valid()) return;
		await toggleLike();
		if (valid() && !reactionFailed.value && state.value === 'ready' && liked.value === wantLiked) reactionFeedback.value = wantLiked ? t.liked : t.unliked;
	});
}

async function onRepost() { await action('repost', async valid => { await repost(); if (valid() && repostState.value === 'sent') repostConfirmed.value = true; }); }

async function retryInteraction() { await action('refresh'); }

async function share() {
	if (!active || shareState.value === 'copying') return;
	const request = ++shareGeneration;
	window.clearTimeout(shareTimer);
	shareFailed.value = false;
	shareState.value = 'copying';
	try {
		await navigator.clipboard.writeText(new URL(workPath(props.work.id), window.location.origin).href);
		if (!active || request !== shareGeneration) return;
		shareState.value = 'copied';
		os.toast(t.copied);
		shareTimer = window.setTimeout(() => { shareState.value = 'idle'; }, 2200);
	} catch {
		if (!active || request !== shareGeneration) return;
		shareState.value = 'idle';
		shareFailed.value = true;
	}
}

async function acknowledgeRetry() { if (!(await os.confirm({ type: 'warning', text: t.retryWarning })).canceled) commentState.value = 'idle'; }
</script>

<style lang="scss" module>
.root { min-width: 0; color: var(--MI_THEME-fg); font-size: 14px; line-height: 1.55; }
.root button, .root textarea { font: inherit; }
.root :focus-visible { outline: 2px solid var(--MI_THEME-fg); outline-offset: 3px; }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 6px 0; color: var(--MI_THEME-fg); font-variant-numeric: tabular-nums; }
.actions > button, .views { display: inline-flex; gap: 7px; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border-radius: 8px; padding: 0 8px; }
.actions i { font-size: 20px; }
.actions > button { transition: background-color .15s, color .15s; &:hover:not(:disabled) { background: var(--MI_THEME-buttonBg); } &:disabled { opacity: .6; cursor: default; } }
.actions .liked { color: var(--MI_THEME-love); }
.actions .copied { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); }
.actions .copied i { animation: confirm .22s var(--community-ease, ease-out); }
@keyframes confirm { from { transform: scale(.75); } to { transform: scale(1); } }
.actions .active { color: var(--MI_THEME-fg); background: var(--MI_THEME-accentedBg); }
.commentHeading { display: flex; justify-content: space-between; align-items: center; margin: 12px 0 4px; h2 { font-size: 16px; margin: 0; } h2 span { margin-left: 6px; opacity: .7; font-weight: normal; } button { width: 44px; height: 44px; } }
.composer { border: 1px solid var(--MI_THEME-inputBorder); border-radius: var(--MI-radius, 12px); padding: 12px; margin: 12px 0; &:focus-within { outline: 2px solid var(--MI_THEME-fg); outline-offset: 2px; } label { display: block; } textarea { box-sizing: border-box; display: block; width: 100%; resize: vertical; min-height: 72px; max-height: 180px; border: none; color: inherit; background: transparent; line-height: 1.65; &:focus-visible { outline: none; } } }
.send { display: flex; align-items: center; justify-content: flex-end; gap: 12px; font-size: 12px; button { min-height: 44px; padding: 8px 16px; border-radius: 20px; color: var(--MI_THEME-panel); background: var(--MI_THEME-fg); font-weight: 600; } button:disabled { opacity: .45; cursor: not-allowed; } }
.keyboardHint { margin: 8px 0 0; font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); }
.signin, .more { display: block; box-sizing: border-box; min-height: 44px; width: 100%; padding: 10px; margin: 12px 0; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius, 12px); background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); &:hover:not(:disabled) { background: var(--MI_THEME-buttonHoverBg); } &:disabled { opacity: .6; } }
.feedback { margin: 8px 0; font-size: 13px; overflow-wrap: anywhere; button, a { color: var(--MI_THEME-accent); text-decoration: underline; min-height: 40px; } }
.error { color: var(--MI_THEME-error); }
.comments { list-style: none; margin: 0; padding: 0; li { display: flex; align-items: flex-start; gap: 10px; padding: 16px 0; border-bottom: 1px solid var(--MI_THEME-divider); } }
.avatar { display: block; flex: 0 0 34px; width: 34px; height: 34px; > * { width: 100%; height: 100%; } }
.reply { flex: 1; min-width: 0; p { margin: 5px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; } }
.replyHeader { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; strong { font-size: 13px; } time { font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); } }
.attachment { display: inline-block; margin-top: 8px; color: var(--MI_THEME-accent); }
.empty { padding: 20px 0; margin: 0; color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }
.main { min-width: 0; }
.previewLayout .main { display: flex; flex-direction: column; }
.previewLayout .actions { margin-top: auto; }
.previewDiscussion { display: flex; flex-direction: column; min-width: 0; min-height: 0; margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--MI_THEME-divider); }
.previewDiscussion .commentHeading { flex: 0 0 auto; gap: 4px; margin: 0; h2 { font-size: 14px; } }
.previewDiscussion .commentEntry { flex: 0 0 auto; }
.previewDiscussion .composer { margin: 8px 0 0; padding: 10px; textarea { min-height: 52px; max-height: 120px; } }
.previewDiscussion .signin { margin: 8px 0 0; }
.previewDiscussion .keyboardHint { font-size: 11px; }
.commentPrompt { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; margin-top: 8px; padding: 8px 12px; border: 1px solid var(--MI_THEME-inputBorder); border-radius: 8px; background: var(--MI_THEME-input); text-align: left; color: var(--MI_THEME-fgTransparentWeak); i:last-child { margin-left: auto; } &:hover { border-color: var(--MI_THEME-accent); color: var(--MI_THEME-fg); } }
.previewViewport { position: relative; min-width: 0; max-height: clamp(180px, 34svh, 360px); overflow: clip; }
.previewViewport .comments li { padding: 12px 0; gap: 8px; }
.previewViewport .reply p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; font-size: 13px; }
.previewViewport .replyHeader { gap: 2px 8px; a { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } time { flex-shrink: 0; font-size: 11px; } }
.previewViewport .attachment { font-size: 12px; }
.hiddenComment { visibility: hidden; }
.previewFooter { flex: 0 0 auto; a { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 44px; padding-block: 8px; color: var(--MI_THEME-accent); font-size: 12px; font-weight: 600; } a:hover { text-decoration: underline; } }
@container (min-width: 760px) {
	.previewLayout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 30%); gap: 24px; align-items: stretch; }
	.previewDiscussion { margin-top: 0; padding: 0 0 0 20px; border-top: 0; border-left: 1px solid var(--MI_THEME-divider); }
	.previewViewport { flex: 1 1 0; height: 0; min-height: 80px; max-height: none; .comments { position: absolute; inset: 0 0 auto; } }
	.previewDiscussion .empty { flex: 1; }
}
@media (max-width: 360px) { .actions { gap: 0; font-size: 12px; } .actions > button, .views { gap: 4px; padding: 0 4px; } }
.actions > button { position: relative; transition: background-color 160ms, color 160ms, transform 180ms var(--community-ease, ease-out); > i { transition: transform 220ms var(--community-ease, ease-out); } &:hover:not(:disabled) > i, &:focus-visible:not(:disabled) > i { transform: translateY(-2px); } &:active:not(:disabled) { transform: scale(.94); } }
.actions .liked { background: color-mix(in srgb, var(--MI_THEME-love) 8%, transparent); }
.actions .likeConfirmed > i { animation: likeConfirm 400ms var(--community-ease, ease-out); }
.actions .likeConfirmed::after { content: ''; position: absolute; inset: 5px; border: 1px solid var(--MI_THEME-love); border-radius: inherit; pointer-events: none; animation: likeRipple 420ms var(--community-ease, ease-out) both; }
.actions .reposted > i { animation: repostConfirm 380ms var(--community-ease, ease-out); }
.discussionEnter { transition: opacity 180ms ease, transform 240ms var(--community-ease, ease-out); }
.discussionFrom { opacity: .4; transform: translateY(-7px); }
.composer { transition: border-color 180ms; &:focus-within { border-color: var(--MI_THEME-accent); outline-color: var(--MI_THEME-accent); } }
.send button { transition: transform 180ms var(--community-ease, ease-out), background-color 180ms; &:active:not(:disabled) { transform: scale(.96); } }
@keyframes likeConfirm { 0% { transform: scale(.7); } 45% { transform: scale(1.22); } 100% { transform: scale(1); } }
@keyframes likeRipple { from { opacity: .6; transform: scale(.7); } to { opacity: 0; transform: scale(1.2); } }
@keyframes repostConfirm { from { transform: rotate(-90deg) scale(.8); } to { transform: rotate(0) scale(1); } }
@mixin quietMotion { .actions > button, .actions > button > i, .actions > button::after, .discussion, .composer, .send button { animation: none; transition: none; transform: none !important; } .actions .likeConfirmed::after { display: none; } .discussionFrom { opacity: 1; } }
.root[data-motion='false'] { @include quietMotion; }
@media (prefers-reduced-motion: reduce) { .root { @include quietMotion; } }
@media (hover: none) { .keyboardHint { display: none; } }
</style>
