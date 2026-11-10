<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="root" :class="[$style.root, { [$style.previewLayout]: previewComments, [$style.immersive]: immersive }]" :data-motion="prefer.s.animation" data-testid="work-engagement">
	<div :class="$style.main" data-testid="work-main">
	<slot></slot>
	<div :class="$style.actions" data-testid="work-actions">
		<slot name="beforeActions"><div v-if="immersive" :class="$style.authorControl">
			<MkA :to="`/@${work.author.username}`" :class="$style.authorAvatar" :aria-label="t.viewAuthor"><MkAvatar v-if="author" :user="author" :link="false" :preview="false"/><span v-else>{{ (work.author.name || work.author.username).slice(0, 1) }}</span></MkA>
			<button v-if="!ownWork" type="button" class="_button" :class="[$style.follow, { [$style.followed]: following || followPending }]" :aria-label="followLabel" :title="followLabel" :aria-pressed="following || followPending" :aria-busy="followBusy" :disabled="followBusy" data-testid="work-follow" @click="onFollow"><i :class="followPending ? 'ti ti-clock' : following ? 'ti ti-check' : 'ti ti-plus'" aria-hidden="true"></i></button>
		</div><button v-else-if="discussion && !ownWork" type="button" class="_button" :class="[$style.desktopFollow, { [$style.active]: following || followPending }]" :aria-label="followLabel" :aria-pressed="following || followPending" :aria-busy="followBusy" :disabled="followBusy" data-testid="work-follow" @click="onFollow"><i :class="followPending ? 'ti ti-clock' : following ? 'ti ti-user-check' : 'ti ti-user-plus'" aria-hidden="true"></i>{{ following ? t.following : followPending ? t.followPending : t.follow }}</button></slot>
		<button ref="commentTrigger" type="button" class="_button" :class="[$style.commentAction, { [$style.active]: showComments }]" :title="!discussion && !previewComments && showComments ? t.closeComments : t.comment" :aria-label="`${t.comment} ${replyCount}`" :aria-expanded="showComments" @click="openComment"><i :class="immersive ? 'ti ti-message-circle-filled' : 'ti ti-message-circle'" aria-hidden="true"></i><span>{{ format(replyCount) }}</span></button>
		<button v-if="!immersive" type="button" class="_button" :class="{ [$style.active]: repostState === 'sent', [$style.reposted]: repostConfirmed }" :title="repostState === 'sent' ? t.reposted : t.repost" :aria-label="`${repostState === 'sent' ? t.reposted : t.repost} ${repostCount}`" :aria-busy="activeAction === 'repost' || repostState === 'sending'" :disabled="working || busy || repostState === 'sent' || repostState === 'uncertain'" @click="onRepost"><i class="ti ti-repeat" aria-hidden="true"></i><span>{{ format(repostCount) }}</span></button>
		<button type="button" class="_button" :class="[$style.likeAction, { [$style.liked]: liked, [$style.likeConfirmed]: liked && reactionFeedback === t.liked }]" :aria-pressed="liked" :aria-busy="activeAction === 'like' || reactionBusy" :title="liked ? t.liked : t.like" :aria-label="`${liked ? t.liked : t.like} ${likeCount}`" :disabled="working || busy" @click="onLike"><i :class="liked || immersive ? 'ti ti-heart-filled' : 'ti ti-heart'" aria-hidden="true"></i><span>{{ format(likeCount) }}</span></button>
		<span :class="$style.views" :title="t.viewHint" :aria-label="`${t.views} ${viewsCount ?? work.viewsCount ?? '—'}`"><i class="ti ti-chart-bar" aria-hidden="true"></i><span>{{ format(viewsCount ?? work.viewsCount) }}</span></span>
		<button v-if="immersive || discussion" type="button" class="_button" :class="[$style.favoriteAction, { [$style.favorited]: favorite }]" :aria-label="favorite ? t.favorited : t.favorite" :aria-pressed="!!favorite" :aria-busy="favoriteBusy" :disabled="favoriteBusy || !work.approvedNoteId" data-testid="work-favorite" @click="onFavorite"><i :class="immersive || favorite ? 'ti ti-star-filled' : 'ti ti-star'" aria-hidden="true"></i><span>{{ favorite ? t.favorited : t.favorite }}</span></button>
		<button v-if="immersive" ref="shareTrigger" type="button" class="_button" :class="$style.shareAction" :aria-label="t.shareWork" :aria-expanded="showShare" data-testid="work-share" @click="openShare"><i class="ti ti-share-3" aria-hidden="true"></i><span>{{ format(repostCount) }}</span></button>
		<button v-else type="button" class="_button" :class="{ [$style.copied]: shareState === 'copied' }" :aria-label="shareState === 'copied' ? t.copied : t.share" :title="shareState === 'copied' ? t.copied : t.share" :aria-busy="shareState === 'copying'" :disabled="shareState === 'copying'" @click="share"><i :class="shareState === 'copied' ? 'ti ti-check' : 'ti ti-share-2'" aria-hidden="true"></i></button>
		<ReportButton v-if="!immersive" :submissionId="work.id" :authorId="work.author.id" @login="requestLogin"/>
		<div v-if="immersive && $slots.remixAction" :class="$style.remixAction"><slot name="remixAction"></slot></div>
	</div>
	<div :class="$style.feedbackStack">
	<p v-if="working" :class="$style.feedback" role="status">{{ activeAction === 'like' ? t.updatingLike : activeAction === 'repost' ? t.reposting : t.refreshingInteraction }}</p>
	<p v-else-if="reactionFeedback" :class="$style.feedback" role="status">{{ reactionFeedback }}</p>
	<p v-if="!working && repostState === 'sent'" :class="$style.feedback" role="status">{{ t.repostSuccess }}</p>
	<p v-if="actionFailed || reactionFailed" :class="$style.feedback" role="alert">{{ t.interactionFailed }} <button type="button" class="_button" :disabled="working || busy" @click="retryInteraction">{{ t.retry }}</button></p>
	<p v-if="!working && (repostState === 'rejected' || repostState === 'uncertain')" :class="$style.feedback" role="status">{{ repostState === 'uncertain' ? t.repostUncertain : t.repostFailed }}</p>
	<p v-if="shareFailed" :class="$style.feedback" role="alert">{{ t.shareFailed }} <MkA :to="workPath(work.id)">{{ work.title }}</MkA></p>
	<p v-if="followFailed" :class="$style.feedback" role="alert">{{ t.followFailed }} <button type="button" class="_button" :disabled="followBusy" @click="readAuthor">{{ t.retry }}</button></p>
	<p v-if="favoriteFailed" :class="$style.feedback" role="alert">{{ t.favoriteFailed }} <button type="button" class="_button" :disabled="favoriteBusy" @click="readFavorite">{{ t.refreshFavorite }}</button></p>
	</div>
	<slot name="afterActions"></slot>
	</div>
	<Teleport defer to="#misskey-popup-container" :disabled="!immersive">
	<div v-if="showComments || previewComments" ref="sheetLayer" :class="immersive ? $style.sheetLayer : $style.discussionContainer" :style="immersive ? { zIndex: sheetZIndex } : undefined" @click.self="immersive && closeComments()">
	<Transition :css="prefer.s.animation" :enterActiveClass="$style.discussionEnter" :enterFromClass="$style.discussionFrom">
	<section v-if="showComments || previewComments" ref="commentPanel" :role="immersive ? 'dialog' : undefined" :aria-modal="immersive ? true : undefined" :style="immersive ? { zIndex: sheetZIndex } : undefined" :tabindex="immersive ? -1 : undefined" :class="[$style.discussion, { [$style.commentSheet]: immersive, [$style.previewDiscussion]: previewComments, [$style.withoutComments]: previewComments && !comments.length }]" :aria-label="previewComments ? t.commentPreview : t.comments" :aria-busy="refreshingComments || loadingComments" data-testid="work-discussion" @keydown="sheetKeydown">
		<header v-if="discussion || previewComments || immersive" :class="$style.commentHeading"><h2>{{ previewComments ? t.commentPreview : t.comments }} <span>{{ format(replyCount) }}</span></h2><button type="button" class="_button" :aria-label="t.refresh" :title="t.refresh" :aria-busy="refreshing" :disabled="refreshing || busy || working" @click="refresh"><i class="ti ti-refresh" aria-hidden="true"></i></button><button v-if="immersive" type="button" class="_button" :class="$style.closeSheet" :aria-label="t.closeComments" @click="closeComments"><i class="ti ti-x" aria-hidden="true"></i></button></header>
		<template v-for="part in previewComments || immersive ? ['comments', 'composer'] : ['composer', 'comments']" :key="part">
		<div v-if="part === 'composer'" :class="$style.commentEntry">
		<button v-if="previewComments && !showComments && $i" type="button" class="_button" :class="$style.commentPrompt" @click="openComment"><i class="ti ti-message-circle" aria-hidden="true"></i>{{ t.writeComment }}<i class="ti ti-pencil" aria-hidden="true"></i></button>
		<form v-else-if="$i" :class="$style.composer" @submit.prevent="submitComment">
			<label><textarea :ref="el => { input = (el as HTMLTextAreaElement | null) ?? undefined; }" v-model="draft" :placeholder="t.commentPlaceholder" :aria-label="t.comment" :readonly="commentState === 'sending'" :rows="immersive ? 1 : 2" data-testid="work-comment-input" @keydown="onCommentKeydown"></textarea></label>
			<div :class="$style.send"><span v-if="draftLength" :class="{ [$style.error]: draftLength > maxLength }">{{ draftLength }} / {{ maxLength }}</span><button type="submit" class="_button" :disabled="!canSubmitComment" data-testid="work-send-comment">{{ commentState === 'sending' ? t.sending : t.send }}</button></div>
			<p :class="$style.keyboardHint">{{ t.commentShortcut }}</p>
		</form>
		<button v-else :ref="el => { signin = (el as HTMLButtonElement | null) ?? undefined; }" type="button" class="_button" :class="$style.signin" @click="requestLogin">{{ t.login }}</button>
		<p v-if="draftLength > maxLength" :class="[$style.feedback, $style.error]" role="alert">{{ t.commentTooLong }}</p>
		<p v-if="commentState === 'sent'" :class="$style.feedback" role="status">{{ t.sent }}</p>
		<p v-if="commentState === 'rejected' || commentState === 'uncertain'" :class="$style.feedback" role="alert">{{ commentState === 'uncertain' ? t.uncertain : t.commentFailed }} <button v-if="commentState === 'uncertain'" type="button" class="_button" @click="acknowledgeRetry">{{ t.retrySend }}</button></p>
		</div>
		<div v-else :class="immersive ? $style.commentBody : $style.discussionContainer">
		<p v-if="state === 'loading' || (refreshingComments && !comments.length)" :class="$style.feedback" role="status">{{ state === 'loading' ? t.loading : t.loadingComments }}</p>
		<p v-else-if="state === 'error' || state === 'unavailable'" :class="$style.feedback" role="alert">{{ state === 'unavailable' ? t.unavailable : t.failed }} <button type="button" class="_button" @click="refresh">{{ t.retry }}</button></p>
		<p v-if="commentsFailed" :class="$style.feedback" role="alert">{{ t.commentsFailed }} <button type="button" class="_button" @click="refresh">{{ t.retry }}</button></p>
		<p v-if="deleteNotice || deleteError" :ref="el => { deleteFeedback = (el as HTMLElement | null) ?? undefined; }" :class="$style.feedback" :role="deleteError ? 'alert' : 'status'" tabindex="-1">{{ deleteError || deleteNotice }}</p>
		<div v-if="comments.length" :ref="el => { viewport = (el as HTMLElement | null) ?? undefined; }" :class="{ [$style.previewViewport]: previewComments }" data-testid="comment-viewport">
		<ul :ref="el => { list = (el as HTMLElement | null) ?? undefined; }" :class="$style.comments"><li v-for="(reply, index) in comments" :key="reply.id" :class="{ [$style.hiddenComment]: previewComments && index >= visibleCount }" :aria-hidden="previewComments && index >= visibleCount ? true : undefined" :inert="previewComments && index >= visibleCount" data-testid="work-comment"><MkA :to="`/@${reply.user.username}`" :class="$style.avatar"><MkAvatar :user="reply.user" :link="false" :preview="false"/></MkA><div :class="$style.reply"><div :class="$style.replyHeader"><MkA :to="`/@${reply.user.username}`"><strong>{{ reply.user.name || reply.user.username }}</strong></MkA><time v-if="!immersive" :datetime="reply.createdAt">{{ date(reply.createdAt) }}</time><button v-if="canDeleteComment(reply)" type="button" class="_button" :class="$style.deleteComment" :disabled="!!deletingCommentId" :aria-label="t.deleteComment" data-testid="delete-work-comment" @click="removeComment(reply)"><i class="ti ti-trash" aria-hidden="true"></i>{{ deletingCommentId === reply.id ? t.deletingComment : t.deleteComment }}</button><ReportButton :submissionId="work.id" :noteId="reply.id" :authorId="reply.user.id" @login="requestLogin"/></div><p v-if="reply.text && reply.cw == null"><Mfm :text="reply.text" :plain="true"/></p><div v-if="reply.renote && !reply.renote.isHidden && !reply.renote.deletedAt" :class="$style.remixPreview" data-testid="comment-work-preview"><MkMediaList v-if="reply.renote.files?.length && reply.renote.cw == null" :mediaList="reply.renote.files" :user="reply.renote.user"/><MkNoteSimple v-else :note="reply.renote"/><MkA :to="commentWorkPath(reply.text) ?? `/notes/${reply.renote.id}`" :class="$style.attachment">{{ t.videoDetail }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div><div v-if="!reply.isHidden && !reply.deletedAt && (reply.files?.length || reply.cw != null)" :class="$style.remixPreview" data-testid="comment-result-preview"><MkMediaList v-if="reply.files?.length && reply.cw == null" :mediaList="reply.files" :user="reply.user"/><MkNoteSimple v-else :note="reply"/><MkA :to="`/notes/${reply.id}`" :class="$style.attachment">{{ t.attachmentComment }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div><div v-if="immersive" :class="$style.commentMeta"><time :datetime="reply.createdAt">{{ date(reply.createdAt) }}</time><MkA :to="`/notes/${reply.id}`">{{ t.reply }}<span v-if="reply.repliesCount"> · {{ format(reply.repliesCount) }}</span></MkA><WorkCommentLike :note="reply" @login="requestLogin"/></div></div></li></ul>
		</div>
		<p v-else-if="state === 'ready' && !refreshingComments && !commentsFailed" :class="$style.empty">{{ replyCount ? t.noPreviewComments : t.emptyComments }}</p>
		<div v-if="previewComments && (replyCount || comments.length)" :ref="el => { footer = (el as HTMLElement | null) ?? undefined; }" :class="$style.previewFooter"><MkA :to="workPath(work.id)" data-testid="all-comments">{{ t.allComments }}<i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div>
		<button v-else-if="!previewComments && commentsMore" type="button" class="_button" :class="$style.more" :disabled="loadingComments || refreshing" @click="loadMoreComments">{{ loadingComments ? t.loadingComments : t.loadMore }}</button>
		</div>
		</template>
	</section>
	</Transition>
	</div>
	<div v-if="showShare && immersive" ref="shareLayer" :class="$style.sheetLayer" :style="{ zIndex: shareZIndex }" @click.self="closeShare" @keydown="sheetKeydown">
		<section ref="sharePanel" role="dialog" aria-modal="true" :aria-label="t.shareWork" tabindex="-1" :class="$style.shareSheet" data-testid="work-share-sheet">
			<header><h2>{{ t.shareWork }}</h2><button type="button" class="_button" :aria-label="t.closeShare" @click="closeShare"><i class="ti ti-x" aria-hidden="true"></i></button></header>
			<div :class="$style.shareOptions">
				<button v-if="nativeSharing" type="button" class="_button" @click="nativeShare"><i class="ti ti-share" aria-hidden="true"></i>{{ t.nativeShare }}</button>
				<button type="button" class="_button" :disabled="shareState === 'copying'" @click="share"><i class="ti ti-link" aria-hidden="true"></i>{{ shareState === 'copied' ? t.copied : t.copyLink }}</button>
				<button type="button" class="_button" :disabled="working || busy || repostState === 'sent' || repostState === 'uncertain'" @click="onRepost"><i class="ti ti-repeat" aria-hidden="true"></i>{{ repostState === 'sent' ? t.reposted : t.repost }}</button>
				<ReportButton :submissionId="work.id" :authorId="work.author.id" @login="requestLogin"/>
			</div>
			<p v-if="repostState === 'sent'" role="status">{{ t.repostSuccess }}</p><p v-else-if="repostState === 'uncertain' || repostState === 'rejected'" role="alert">{{ repostState === 'uncertain' ? t.repostUncertain : t.repostFailed }}</p>
			<p v-if="actionFailed" role="alert">{{ t.interactionFailed }}</p>
			<p v-if="shareFailed" role="alert">{{ t.shareUnavailable }} <MkA :to="workPath(work.id)">{{ work.title }}</MkA></p>
		</section>
	</div>
	</Teleport>
</div>
</template>

<script setup lang="ts">
import { url } from '@@/js/config.js';
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import ReportButton from './report-button.vue';
import WorkCommentLike from './work-comment-like.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import MkNoteSimple from '@/components/MkNoteSimple.vue';
import type { CommunityWork } from './types.js';
import { workText as t, workPath } from './interactions-copy.js';
import { useCommentPreview } from './use-comment-preview.js';
import { useWorkSocial } from './use-work-social.js';
import { useWorkInteractions } from '@/pages/home/use-work-interactions.js';
import type { entities } from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { prefer } from '@/preferences.js';
import { focusTrap } from '@/utility/focus-trap.js';

const props = defineProps<{ work: CommunityWork; discussion?: boolean; previewComments?: boolean; viewsCount?: number; immersive?: boolean }>();
const emit = defineEmits<{ (event: 'discussionChange', value: boolean): void }>();

function commentWorkPath(text: string | null) {
	const lastLine = text?.split('\n').at(-1);
	if (!lastLine) return null;
	try {
		const target = new URL(lastLine);
		return target.origin === new URL(url).origin && /^\/community\/work\/[a-zA-Z0-9]+$/.test(target.pathname) ? target.pathname : null;
	} catch { return null; }
}

const showComments = ref(!!props.discussion && !props.immersive);
const showShare = ref(false);
const shareLayer = ref<HTMLElement>();
const sharePanel = ref<HTMLElement>();
const shareTrigger = ref<HTMLButtonElement>();
const shareZIndex = ref(0);
const nativeSharing = typeof navigator.share === 'function';
let releaseShare: (() => void) | undefined;
const commentPanel = ref<HTMLElement>();
const sheetLayer = ref<HTMLElement>();
const commentTrigger = ref<HTMLButtonElement>();
const sheetZIndex = ref(0);
let releaseSheet: (() => void) | undefined;

function closeComments() { showComments.value = false; void nextTick(() => commentTrigger.value?.focus({ preventScroll: true })); }

function sheetKeydown(event: KeyboardEvent) {
	if (!props.immersive) return;
	if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (showShare.value) closeShare(); else closeComments(); }
	const panel = showShare.value ? sharePanel.value : commentPanel.value;
	if (event.key !== 'Tab' || !panel) return;
	const controls = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], textarea:not(:disabled)')].filter(el => el.getClientRects().length && !el.closest('[inert]'));
	const first = controls[0], last = controls.at(-1);
	if (event.shiftKey && (window.document.activeElement === first || window.document.activeElement === panel)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

watch([showComments, showShare, () => props.immersive], ([show, sharing, immersive]) => {
	releaseSheet?.(); releaseSheet = undefined;
	emit('discussionChange', (show || sharing) && !!immersive);
	if (show && immersive) sheetZIndex.value = os.claimZIndex('middle');
}, { flush: 'sync' });
watch([showComments, sheetLayer, () => props.immersive], ([show, panel, immersive]) => {
	if (show && immersive && panel && !releaseSheet) releaseSheet = focusTrap(panel).release;
}, { flush: 'post' });
watch([showShare, shareLayer], ([show, layer]) => {
	releaseShare?.(); releaseShare = undefined;
	if (show && layer) releaseShare = focusTrap(layer).release;
}, { flush: 'post' });

function closeShare() { showShare.value = false; releaseShare?.(); releaseShare = undefined; void nextTick(() => shareTrigger.value?.focus({ preventScroll: true })); }

async function openShare() { showComments.value = false; shareZIndex.value = os.claimZIndex('middle'); showShare.value = true; await nextTick(); sharePanel.value?.focus({ preventScroll: true }); }

async function nativeShare() {
	const request = shareGeneration;
	try { await navigator.share({ title: props.work.title, url: new URL(workPath(props.work.id), window.location.origin).href }); } catch (error) { if (active && request === shareGeneration && !(error instanceof Error && error.name === 'AbortError')) shareFailed.value = true; }
}

const { author, favorite, following, followPending, ownWork, followBusy, favoriteBusy, followFailed, favoriteFailed, toggleFavorite, toggleFollow, readAuthor, readFavorite } = useWorkSocial(() => props.work, () => !!(props.immersive || props.discussion));
const followLabel = computed(() => following.value ? t.unfollow : followPending.value ? t.cancelFollow : t.follow);

async function onFavorite() { if (!$i) { void requestLogin(); return; } await toggleFavorite(); }

async function onFollow() { if (!$i) { void requestLogin(); return; } await toggleFollow(async () => !(await os.confirm({ type: 'question', text: following.value ? t.unfollowConfirm : followPending.value ? t.cancelFollowConfirm : t.followConfirm })).canceled); }

const previewVisible = ref(false);
const input = ref<HTMLTextAreaElement>();
const signin = ref<HTMLButtonElement>();
const { state, note, comments, commentsFailed, commentsMore, loadingComments, loadMoreComments, refreshing, refreshingComments, myReaction, liked, otherReaction, likes, reactionBusy, reactionFailed, draft, draftLength, maxLength, commentState, busy, canComment, refresh, refreshNote, toggleLike, sendComment, repost, repostState } = useWorkInteractions(() => props.work.approvedNoteId, { immediate: !!props.discussion || !!props.immersive, publicOnly: false, loadComments: () => showComments.value || (props.previewComments === true && previewVisible.value), commentLimit: 20 });
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

function clearFeedback() { deleteGeneration++; deleteController?.abort(); deletingCommentId.value = ''; deleteNotice.value = ''; deleteError.value = ''; actionGeneration++; activeAction.value = null; actionFailed.value = false; reactionFeedback.value = ''; shareGeneration++; window.clearTimeout(shareTimer); shareState.value = 'idle'; shareFailed.value = false; repostConfirmed.value = false; }

function deactivate() { if (props.immersive) showComments.value = false; showShare.value = false; releaseShare?.(); releaseShare = undefined; releaseSheet?.(); releaseSheet = undefined; active = false; clearFeedback(); disposeLogin?.(); disposeLogin = undefined; loginOpening = false; }

onActivated(() => { active = true; });
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
watch([() => props.work.id, () => props.work.approvedNoteId, () => $i?.id], clearFeedback);

const deletingCommentId = ref('');
const deleteNotice = ref('');
const deleteError = ref('');
const deleteFeedback = ref<HTMLElement>();
let deleteGeneration = 0;
let deleteController: AbortController | undefined;
const canDeleteComment = (reply: entities.Note) => !!$i && !!props.work.approvedNoteId && reply.replyId === props.work.approvedNoteId && ($i.id === reply.userId || $i.id === props.work.author.id);

async function removeComment(reply: entities.Note) {
	if (!active || deletingCommentId.value || !canDeleteComment(reply)) return;
	const ticket = ++deleteGeneration, actorId = $i?.id, workId = props.work.id, noteId = props.work.approvedNoteId;
	const valid = () => active && ticket === deleteGeneration && actorId === $i?.id && workId === props.work.id && noteId === props.work.approvedNoteId;
	deletingCommentId.value = reply.id; deleteNotice.value = ''; deleteError.value = '';
	let timer: number | undefined;
	try {
		const { canceled } = await os.confirm({ type: 'warning', title: t.deleteComment, text: t.deleteCommentConfirm });
		if (canceled || !valid() || !canDeleteComment(reply)) return;
		const controller = deleteController = new AbortController();
		timer = window.setTimeout(() => controller.abort(), 15000);
		await misskeyApi('community/comments/delete', { submissionId: workId, noteId: reply.id }, undefined, controller.signal);
		if (!valid()) return;
		comments.value = comments.value.filter(item => item.id !== reply.id);
		deleteNotice.value = t.commentDeleted;
		await refresh();
		if (valid()) { await nextTick(); deleteFeedback.value?.focus({ preventScroll: true }); }
	} catch {
		if (valid()) { deleteError.value = t.deleteCommentFailed; await refresh(); }
	} finally {
		window.clearTimeout(timer);
		if (valid()) { deletingCommentId.value = ''; deleteController = undefined; }
	}
}

async function openComment() {
	if (!props.discussion && !props.previewComments && showComments.value) { showComments.value = false; return; }
	showShare.value = false;
	showComments.value = true;
	await nextTick();
	if (props.immersive) commentPanel.value?.focus({ preventScroll: true });
	else (input.value ?? signin.value)?.focus();
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
@use './work-palette.scss';
.deleteComment { display: inline-flex; align-items: center; gap: 4px; min-height: 36px; padding: 4px 8px; color: var(--MI_THEME-error); font-size: .82em; white-space: nowrap; &:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; } &:disabled { opacity: .5; cursor: wait; } }
.remixPreview { margin-block: 10px; max-width: 420px; min-width: 0; overflow: hidden; border: 1px solid var(--MI_THEME-divider); border-radius: 10px; padding: 8px; }
.root { min-width: 0; color: var(--MI_THEME-fg); font-size: 14px; line-height: 1.55; }
.root button, .root textarea { font: inherit; }
.root :focus-visible { outline: 2px solid var(--MI_THEME-fg); outline-offset: 3px; }
.actions { flex-wrap: wrap; display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 6px 0; color: var(--MI_THEME-fg); font-variant-numeric: tabular-nums; }
.actions > button, .views { display: inline-flex; gap: 7px; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border-radius: 8px; padding: 0 8px; }
.actions i { font-size: 20px; }
.actions > button { transition: background-color .15s, color .15s; &:hover:not(:disabled) { background: var(--MI_THEME-buttonBg); } &:disabled { opacity: .6; cursor: default; } }
.actions .liked { color: var(--MI_THEME-love); }
.actions .copied { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); }
.actions .copied i { animation: confirm .22s var(--community-ease, ease-out); }
@keyframes confirm { from { transform: scale(.75); } to { transform: scale(1); } }
.actions .active { color: var(--MI_THEME-fg); background: var(--MI_THEME-accentedBg); }
.actions .desktopFollow { flex-basis: 100%; margin-bottom: 8px; background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-weight: 600; }
.actions .favorited { color: var(--MI_THEME-accent); }
.commentHeading { display: flex; align-items: center; gap: 8px; margin: 12px 0 4px; h2 { font-size: 16px; margin: 0; } h2 span { margin-left: 6px; opacity: .7; font-weight: normal; } button { flex-shrink: 0; width: 44px; height: 44px; border-radius: 8px; color: var(--MI_THEME-fgTransparentWeak); &:hover:not(:disabled) { background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); } &:disabled { opacity: .6; } } }
.composer { border: 1px solid var(--MI_THEME-inputBorder); border-radius: var(--MI-radius, 12px); padding: 12px; margin: 12px 0; &:focus-within { outline: 2px solid var(--MI_THEME-fg); outline-offset: 2px; } label { display: block; } textarea { box-sizing: border-box; display: block; width: 100%; resize: vertical; min-height: 72px; max-height: 180px; border: none; color: inherit; background: transparent; line-height: 1.65; &:focus-visible { outline: none; } } }
.send { display: flex; align-items: center; justify-content: flex-end; gap: 12px; font-size: 12px; button { min-height: 44px; padding: 8px 16px; border-radius: 20px; color: var(--MI_THEME-fgOnAccent); background: var(--MI_THEME-accent); font-weight: 600; } button:disabled { opacity: .45; cursor: not-allowed; } }
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
.previewDiscussion .keyboardHint { font-size: 12px; }
.commentPrompt { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; margin-top: 8px; padding: 8px 12px; border: 1px solid var(--MI_THEME-inputBorder); border-radius: 8px; background: var(--MI_THEME-input); text-align: left; color: var(--MI_THEME-fgTransparentWeak); i:last-child { margin-left: auto; } &:hover { border-color: var(--MI_THEME-accent); color: var(--MI_THEME-fg); } }
.previewViewport { position: relative; min-width: 0; max-height: clamp(180px, 34svh, 360px); overflow: clip; }
.previewViewport .comments li { padding: 12px 0; gap: 8px; }
.previewViewport .reply p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; font-size: 13px; }
.previewViewport .replyHeader { gap: 2px 8px; a { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } time { flex-shrink: 0; font-size: 11px; } }
.previewViewport .attachment { font-size: 12px; }
.hiddenComment { visibility: hidden; }
.previewFooter { flex: 0 0 auto; a { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 44px; padding-block: 8px; color: var(--MI_THEME-accent); font-size: 12px; font-weight: 600; } a:hover { text-decoration: underline; } }
@container (min-width: 900px) {
	.previewLayout { display: grid; grid-template-columns: minmax(0, 1fr) clamp(260px, 28%, 320px); gap: 24px; align-items: stretch; }
	.previewDiscussion { margin-top: 0; padding: 0 0 0 20px; border-top: 0; border-left: 1px solid var(--MI_THEME-divider); }
	.previewViewport { flex: 1 1 0; height: 0; min-height: 80px; max-height: none; .comments { position: absolute; inset: 0 0 auto; } }
	.previewDiscussion.withoutComments { align-self: start; }
}
@container (max-width: 600px) {
	.actions { column-gap: 0; font-size: 12px; }
	.actions > button, .views { gap: 3px; padding-inline: 2px; }
	.actions i { font-size: 18px; }
	.actions > span:not(.views) > button:not(:disabled) { width: 44px; padding-inline: 0; }
	.actions > span:not(.views) > button:not(:disabled) > span { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
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

.root.immersive { @include work-palette.immersive; position: relative; height: 100%; color: var(--work-stage-fg); }
.immersive .main { position: relative; height: 100%; }
.immersive .actions { position: absolute; bottom: calc(16px + var(--work-actions-inset, 0px)); right: max(10px, env(safe-area-inset-right)); display: flex; flex-direction: column; flex-wrap: nowrap; gap: 13px; width: 52px; padding: 0; color: var(--work-stage-fg); text-shadow: 0 1px 3px var(--work-stage); }
.immersive .actions > button { display: flex; flex-direction: column; gap: 1px; width: 48px; min-height: 49px; padding: 0; font-size: 12px; background: transparent; }
.immersive .actions i { font-size: 31px; filter: drop-shadow(0 1px 2px var(--work-stage)); }
.immersive .actions .authorControl { order: 0; }
.immersive .actions .likeAction { order: 1; }
.immersive .actions .commentAction { order: 2; }
.immersive .actions .favoriteAction { order: 3; }
.immersive .actions .shareAction { order: 4; }
.immersive .actions .remixAction { order: 5; }
.immersive .actions .views { display: none; }
.immersive .actions .liked { color: var(--MI_THEME-love); }
.immersive .actions .favorited { color: var(--work-stage-accent); }
.immersive .actions .copied { color: var(--work-stage-accent); }
.authorControl { position: relative; display: grid; place-items: start center; width: 52px; height: 67px; }
.authorAvatar { display: grid; place-items: center; width: 44px; height: 44px; border: 2px solid var(--work-stage-fg); border-radius: 50%; overflow: hidden; box-sizing: border-box; background: var(--work-stage-border); font-size: 20px; text-shadow: none; > * { width: 100%; height: 100%; display: grid; place-items: center; } }
.authorControl .follow { display: grid; place-items: center; position: absolute; width: 44px; height: 44px; bottom: 0; padding: 0; i { position: relative; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--work-stage-accent); color: var(--MI_THEME-fgOnAccent); text-shadow: none; font-size: 18px; filter: none; } }
.authorControl .followed i { background: var(--MI_THEME-panel); color: var(--work-stage-accent); }
.remixAction { width: 52px; }
.immersive .feedbackStack { position: absolute; top: 62px; left: 16px; right: 76px; z-index: 2; max-height: 35%; overflow: auto; }
.immersive .feedbackStack .feedback { padding: 8px 12px; border-radius: 6px; background: var(--work-stage); color: var(--work-stage-fg); }
.discussionContainer { display: contents; }
.sheetLayer { @include work-palette.immersive; position: fixed; inset: 0; display: flex; align-items: flex-end; background: color-mix(in srgb, var(--work-stage) 8%, transparent); }
.commentSheet, .shareSheet {
	position: relative; width: 100%; box-sizing: border-box; border-radius: 16px 16px 0 0; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); font-size: 14px; line-height: 1.55;
	button, textarea { font: inherit; }
	:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; }
}
.commentSheet { display: flex; flex-direction: column; height: min(64dvh, 680px); min-height: min(260px, 64dvh); max-height: 84dvh; overflow: hidden; }
.commentSheet .commentHeading { flex: 0 0 auto; padding: 12px 18px 6px; margin: 0; border-bottom: 1px solid var(--MI_THEME-divider); h2 { padding-block: 10px; font-size: 16px; font-weight: 700; } h2 span { color: var(--MI_THEME-fg); font-weight: 700; opacity: 1; } }
.commentSheet .closeSheet { margin-left: auto; }
.commentBody { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 18px 10px; }
.commentSheet .commentEntry { flex: 0 0 auto; max-height: 45%; overflow: auto; padding: 10px 14px max(10px, env(safe-area-inset-bottom)); border-top: 1px solid var(--MI_THEME-divider); }
.commentSheet .composer { display: flex; align-items: flex-end; gap: 8px; padding: 6px 6px 6px 14px; margin: 0; border: 0; border-radius: 24px; background: var(--MI_THEME-input); label { flex: 1; min-width: 0; } textarea { min-height: 40px; max-height: 100px; padding: 8px 0; resize: none; font-size: 16px; line-height: 1.5; } }
.commentSheet .send { flex: 0 0 auto; align-self: center; gap: 4px; flex-direction: column; button { min-height: 44px; padding: 8px 12px; border-radius: 22px; font-size: 13px; } }
.commentSheet .keyboardHint { display: none; }
.commentSheet .signin { margin: 0; border: 0; border-radius: 24px; text-align: left; padding-inline: 18px; color: var(--MI_THEME-fgTransparentWeak); }
.commentSheet .comments li { padding: 16px 0; gap: 12px; border: 0; }
.commentSheet .avatar { flex-basis: 38px; width: 38px; height: 38px; }
.commentSheet .replyHeader { min-height: 22px; gap: 4px; strong { color: var(--MI_THEME-fgTransparentWeak); font-weight: 400; } > a { flex: 1; } > span { margin-left: auto; } }
.commentSheet .reply p { margin-top: 3px; font-size: 16px; line-height: 1.55; }
.commentSheet .replyHeader .deleteComment { font-size: 0; padding: 0 6px; i { font-size: 15px; } }
.commentSheet .replyHeader > span > button { min-height: 32px; padding: 0 6px; > span { display: none; } }
.commentMeta { display: flex; gap: 16px; align-items: center; font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); a { display: inline-flex; min-height: 36px; align-items: center; } }
.commentSheet .remixPreview { border: 0; padding: 0; max-width: min(260px, 100%); }
.commentSheet.discussionFrom { transform: translateY(24px); }
.shareSheet { padding: 12px 18px max(24px, env(safe-area-inset-bottom)); header { display: flex; align-items: center; justify-content: space-between; } h2 { font-size: 16px; margin: 0; } header button { width: 44px; height: 44px; font-size: 20px; } p { font-size: 13px; } }
.shareOptions { display: flex; align-items: stretch; gap: 10px; padding-block: 18px; > button, > span { flex: 1; min-width: 0; } > button, > span > button { display: flex; width: 100%; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 80px; padding: 8px 2px; border: 0; border-radius: 10px; background: var(--MI_THEME-buttonBg); font-size: 12px; &:active { background: var(--MI_THEME-buttonHoverBg); } } i { font-size: 24px; color: var(--MI_THEME-accent); } }
@media (max-height: 640px) { .immersive .actions { gap: 3px; bottom: calc(10px + var(--work-actions-inset, 0px)); } .immersive .actions i { font-size: 25px; } .immersive .actions > button { min-height: 44px; } .authorControl { height: 67px; } .authorControl .follow i { font-size: 17px; } }
@media (prefers-reduced-motion: reduce) { .commentSheet { transition: none; } }
@media (max-height: 560px) { .immersive .actions { display: grid; grid-template-columns: repeat(2, 44px); gap: 4px; width: 92px; bottom: calc(10px + var(--work-actions-inset, 0px)); } .immersive .actions > a { margin-bottom: 0; } }
</style>
