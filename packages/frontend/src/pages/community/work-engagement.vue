<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" data-testid="work-engagement">
	<div :class="$style.actions">
		<button type="button" class="_button" :title="t.comment" :aria-label="`${t.comment} ${replyCount}`" :aria-expanded="showComments" @click="openComment"><i class="ti ti-message-circle" aria-hidden="true"></i><span>{{ format(replyCount) }}</span></button>
		<button type="button" class="_button" :class="{ [$style.active]: repostState === 'sent' }" :title="repostState === 'sent' ? t.reposted : t.repost" :aria-label="`${repostState === 'sent' ? t.reposted : t.repost} ${repostCount}`" :disabled="working || busy || repostState === 'sent' || repostState === 'uncertain'" @click="onRepost"><i class="ti ti-repeat" aria-hidden="true"></i><span>{{ format(repostCount) }}</span></button>
		<button type="button" class="_button" :class="{ [$style.liked]: liked }" :aria-pressed="liked" :title="liked ? t.liked : t.like" :aria-label="`${liked ? t.liked : t.like} ${likeCount}`" :disabled="working || busy" @click="onLike"><i :class="liked ? 'ti ti-heart-filled' : 'ti ti-heart'" aria-hidden="true"></i><span>{{ format(likeCount) }}</span></button>
		<span :class="$style.views" :title="t.viewHint" :aria-label="`${t.views} ${viewsCount ?? work.viewsCount ?? '—'}`"><i class="ti ti-chart-bar" aria-hidden="true"></i><span>{{ format(viewsCount ?? work.viewsCount) }}</span></span>
		<button type="button" class="_button" :aria-label="t.share" :title="t.share" @click="share"><i class="ti ti-share-2" aria-hidden="true"></i></button>
	</div>
	<p v-if="actionFailed || reactionFailed" :class="$style.feedback" role="alert">{{ t.interactionFailed }} <button type="button" class="_button" @click="refresh">{{ t.retry }}</button></p>
	<p v-if="repostState === 'rejected' || repostState === 'uncertain'" :class="$style.feedback" role="status">{{ repostState === 'uncertain' ? t.repostUncertain : t.repostFailed }}</p>
	<p v-if="shareFailed" :class="$style.feedback" role="alert">{{ t.shareFailed }} <MkA :to="workPath(work.id)">{{ work.title }}</MkA></p>
	<slot name="afterActions"></slot>
	<section v-if="showComments" :class="$style.discussion" :aria-label="t.comments">
		<header v-if="discussion" :class="$style.commentHeading"><h2>{{ t.comments }} <span>{{ format(replyCount) }}</span></h2><button type="button" class="_button" :aria-label="t.refresh" :disabled="refreshing || busy" @click="refresh"><i class="ti ti-refresh" aria-hidden="true"></i></button></header>
		<form v-if="$i" :class="$style.composer" @submit.prevent="sendComment">
			<label><textarea ref="input" v-model="draft" :placeholder="t.commentPlaceholder" :aria-label="t.comment" :readonly="commentState === 'sending'" rows="2" data-testid="work-comment-input"></textarea></label>
			<div :class="$style.send"><span v-if="draftLength" :class="{ [$style.error]: draftLength > maxLength }">{{ draftLength }} / {{ maxLength }}</span><button type="submit" class="_button" :disabled="!canComment" data-testid="work-send-comment">{{ commentState === 'sending' ? t.sending : t.send }}</button></div>
		</form>
		<button v-else type="button" class="_button" :class="$style.signin" @click="requestLogin">{{ t.login }}</button>
		<p v-if="commentState === 'sent'" :class="$style.feedback" role="status">{{ t.sent }}</p>
		<p v-if="commentState === 'rejected' || commentState === 'uncertain'" :class="$style.feedback" role="alert">{{ commentState === 'uncertain' ? t.uncertain : t.commentFailed }} <button v-if="commentState === 'uncertain'" type="button" class="_button" @click="acknowledgeRetry">{{ t.retrySend }}</button></p>
		<p v-if="state === 'loading'" :class="$style.feedback" role="status">{{ t.loading }}</p>
		<p v-else-if="state === 'error' || state === 'unavailable'" :class="$style.feedback" role="alert">{{ state === 'unavailable' ? t.unavailable : t.failed }} <button type="button" class="_button" @click="refresh">{{ t.retry }}</button></p>
		<p v-if="commentsFailed" :class="$style.feedback" role="alert">{{ t.commentsFailed }} <button type="button" class="_button" @click="refresh">{{ t.retry }}</button></p>
		<ul v-if="comments.length" :class="$style.comments"><li v-for="reply in comments" :key="reply.id"><MkA :to="`/@${reply.user.username}`" :class="$style.avatar"><MkAvatar :user="reply.user" :link="false" :preview="false"/></MkA><div :class="$style.reply"><div :class="$style.replyHeader"><MkA :to="`/@${reply.user.username}`"><strong>{{ reply.user.name || reply.user.username }}</strong></MkA><time :datetime="reply.createdAt">{{ date(reply.createdAt) }}</time></div><p v-if="reply.text"><Mfm :text="reply.text" :plain="true"/></p><MkA v-if="reply.files?.length" :to="`/notes/${reply.id}`" :class="$style.attachment">{{ t.attachmentComment }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div></li></ul>
		<p v-else-if="state === 'ready' && !commentsFailed" :class="$style.empty">{{ t.emptyComments }}</p>
		<button v-if="commentsMore" type="button" class="_button" :class="$style.more" :disabled="loadingComments || refreshing" @click="loadMoreComments">{{ t.loadMore }}</button>
	</section>
</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref } from 'vue';
import type { CommunityWork } from './types.js';
import { workText as t, workPath } from './interactions-copy.js';
import { useWorkInteractions } from '@/pages/home/use-work-interactions.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';

const props = defineProps<{ work: CommunityWork; discussion?: boolean; viewsCount?: number }>();
const showComments = ref(!!props.discussion);
const input = ref<HTMLTextAreaElement>();
const { state, note, comments, commentsFailed, commentsMore, loadingComments, loadMoreComments, refreshing, myReaction, liked, otherReaction, likes, reactionFailed, draft, draftLength, maxLength, commentState, busy, canComment, refresh, toggleLike, sendComment, repost, repostState } = useWorkInteractions(() => props.work.approvedNoteId, { immediate: !!props.discussion, publicOnly: false, loadComments: () => showComments.value, commentLimit: 20 });
const working = ref(false);
const actionFailed = ref(false);
const shareFailed = ref(false);
const likeCount = computed(() => note.value ? likes.value : props.work.likesCount);
const replyCount = computed(() => note.value?.repliesCount ?? props.work.repliesCount);
const repostCount = computed(() => note.value?.renoteCount ?? props.work.renotesCount);
const format = (value?: number) => value == null ? '—' : new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

let active = true;
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

function deactivate() { active = false; disposeLogin?.(); disposeLogin = undefined; loginOpening = false; }

onActivated(() => { active = true; });
onDeactivated(deactivate);
onBeforeUnmount(deactivate);

async function openComment() {
	showComments.value = true;
	await nextTick();
	if (props.discussion && state.value === 'ready') input.value?.focus();
	else { await refresh(); input.value?.focus(); }
}

async function action(callback: () => Promise<void>) {
	if (!$i) { requestLogin(); return; }
	if (working.value || busy.value) return;
	working.value = true; actionFailed.value = false;
	try {
		await refresh();
		if (state.value !== 'ready') { actionFailed.value = true; return; }
		await callback();
	} catch { actionFailed.value = true; } finally { working.value = false; }
}

async function onLike() {
	const wantLiked = !liked.value;
	await action(async () => {
		if (myReaction.value === undefined) { actionFailed.value = true; return; }
		if (liked.value === wantLiked) return;
		if (otherReaction.value && (await os.confirm({ type: 'question', text: t.replaceReaction })).canceled) return;
		await toggleLike();
	});
}

async function onRepost() { await action(repost); }

async function share() {
	shareFailed.value = false;
	try { await navigator.clipboard.writeText(new URL(workPath(props.work.id), window.location.origin).href); os.toast(t.copied); } catch { shareFailed.value = true; }
}

async function acknowledgeRetry() { if (!(await os.confirm({ type: 'warning', text: t.retryWarning })).canceled) commentState.value = 'idle'; }
</script>

<style lang="scss" module>
.root { min-width: 0; color: var(--MI_THEME-fg); font-size: 14px; line-height: 1.55; }
.root button, .root textarea { font: inherit; }
.root :focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 6px 0; color: var(--MI_THEME-fg); font-variant-numeric: tabular-nums; }
.actions > button, .views { display: inline-flex; gap: 7px; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; border-radius: 22px; padding: 0 8px; }
.actions i { font-size: 20px; }
.actions > button { transition: background-color .15s, color .15s; &:hover:not(:disabled) { background: var(--MI_THEME-buttonBg); } &:disabled { opacity: .6; cursor: default; } }
.actions .liked { color: var(--MI_THEME-love); }
.actions .active { color: var(--MI_THEME-accent); }
.commentHeading { display: flex; justify-content: space-between; align-items: center; margin: 12px 0 4px; h2 { font-size: 16px; margin: 0; } h2 span { margin-left: 6px; opacity: .7; font-weight: normal; } button { width: 44px; height: 44px; } }
.composer { border: 1px solid var(--MI_THEME-divider); border-radius: 12px; padding: 12px; margin: 10px 0; label { display: block; } textarea { box-sizing: border-box; display: block; width: 100%; resize: vertical; min-height: 64px; max-height: 180px; border: none; color: inherit; background: transparent; line-height: 1.65; } }
.send { display: flex; align-items: center; justify-content: flex-end; gap: 12px; font-size: 12px; button { min-height: 40px; padding: 8px 16px; border-radius: 20px; color: var(--MI_THEME-fgOnAccent); background: var(--MI_THEME-accent); font-weight: 600; } button:disabled { opacity: .45; cursor: not-allowed; } }
.signin, .more { display: block; min-height: 44px; width: 100%; padding: 10px; color: var(--MI_THEME-accent); }
.feedback { margin: 8px 0; font-size: 13px; overflow-wrap: anywhere; button, a { color: var(--MI_THEME-accent); text-decoration: underline; min-height: 40px; } }
.error { color: var(--MI_THEME-error); }
.comments { list-style: none; margin: 0; padding: 0; li { display: flex; align-items: flex-start; gap: 10px; padding: 16px 0; border-bottom: 1px solid var(--MI_THEME-divider); } }
.avatar { display: block; flex: 0 0 34px; width: 34px; height: 34px; > * { width: 100%; height: 100%; } }
.reply { flex: 1; min-width: 0; p { margin: 5px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; } }
.replyHeader { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; strong { font-size: 13px; } time { font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); } }
.attachment { display: inline-block; margin-top: 8px; color: var(--MI_THEME-accent); }
.empty { padding: 20px 0; margin: 0; color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }
@media (max-width: 360px) { .actions { gap: 0; font-size: 12px; } .actions > button, .views { gap: 4px; padding: 0 4px; } }
@media (prefers-reduced-motion: reduce) { .actions > button { transition: none; } }
</style>
