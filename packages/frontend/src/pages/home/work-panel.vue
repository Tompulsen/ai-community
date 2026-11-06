<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.panel" data-testid="home-popular-work">
	<header :class="$style.heading"><span><i class="ti ti-flame" aria-hidden="true"></i> {{ homeText.popularTitle }}</span><span :class="$style.badge">{{ homeText.popularBadge }}{{ homeText.popularBadgeMore }}</span></header>
	<div v-if="state !== 'ready'" :class="$style.loading" role="status">
		<p>{{ state === 'loading' ? homeText.popularLoading : state === 'unavailable' ? homeText.workUnavailable : homeText.workLoadFailed }}</p>
		<button v-if="state !== 'loading'" type="button" class="_button" :class="$style.button" :disabled="refreshing" @click="refresh">{{ homeText.retry }}</button>
	</div>
	<template v-else>
		<div :class="$style.top">
			<section :class="[$style.card, $style.mediaCard]" :aria-label="homeText.workPreview" data-testid="home-work-media">
				<div :class="$style.cardHeading"><span><i :class="categoryIcon" aria-hidden="true"></i> {{ categoryLabel }}</span><MkA :to="notePath" :class="$style.detailLink" :aria-label="`${homeText.viewWork}: ${work.title}`" data-testid="home-popular-link"><i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div>
				<div :class="$style.media">
					<video v-if="videoUrl && !mediaFailed" :key="videoUrl" :src="videoUrl" :poster="coverUrl || undefined" controls playsinline preload="none" :aria-label="work.title" data-testid="home-popular-video" @error="mediaFailed = true"></video>
					<img v-else-if="coverUrl && !mediaFailed" :src="coverUrl" :alt="work.title" decoding="async" data-testid="home-popular-cover" @error="mediaFailed = true"/>
					<div v-else :class="$style.excerpt"><i :class="categoryIcon" aria-hidden="true"></i><strong>{{ work.title }}</strong><span>{{ homeText.viewWork }}</span></div>
				</div>
			</section>
			<section :class="[$style.card, $style.promptCard]" :aria-label="homeText.workPrompt" data-testid="home-work-prompt">
				<h2><i class="ti ti-sparkles" aria-hidden="true"></i> {{ homeText.workPrompt }}</h2>
				<p :class="$style.prompt" tabindex="0">{{ work.text || homeText.noPrompt }}</p>
				<button type="button" class="_button" :class="[$style.button, $style.remix]" :disabled="copying" data-testid="home-work-remix" @click="remix"><i class="ti ti-wand" aria-hidden="true"></i> {{ copying ? homeText.copying : homeText.remix }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></button>
				<small :class="$style.remixHint">{{ work.text ? homeText.remixHint : homeText.remixEmptyHint }}</small>
				<div v-if="copyFailed" :class="$style.feedback" role="alert">{{ homeText.copyFailed }} <MkA :to="creationPath" :class="$style.textLink">{{ homeText.continueCreating }}</MkA></div>
			</section>
		</div>
		<section :class="[$style.card, $style.discussion]" :aria-label="homeText.workDiscussion" data-testid="home-work-discussion">
			<div :class="$style.workInfo">
				<div :class="$style.identity"><h2><MkA :to="notePath">{{ work.title }}</MkA></h2><p>{{ work.author.name || `@${work.author.username}` }}<span v-if="work.model"> · {{ work.model }}</span></p></div>
				<button type="button" class="_button" :class="[$style.like, { [$style.liked]: liked }]" :aria-pressed="liked" :disabled="busy || refreshing || openingLogin || (!!$i && myReaction === undefined)" data-testid="home-work-like" @click="$i ? toggleLike() : requestLogin()"><i :class="liked ? 'ti ti-heart-filled' : 'ti ti-heart'" aria-hidden="true"></i><span>{{ otherReaction ? homeText.replaceReaction : liked ? homeText.liked : homeText.like }}</span><strong>{{ likes }}</strong></button>
			</div>
			<p v-if="otherReaction" :class="$style.feedback">{{ homeText.replaceReactionHint }}</p>
			<div v-if="reactionFailed || ($i && myReaction === undefined && !refreshing)" :class="$style.feedback" role="alert">{{ homeText.reactionFailed }} <button type="button" class="_button" :class="$style.textLink" :disabled="busy || refreshing" @click="refresh">{{ homeText.refreshComments }}</button></div>
			<div :class="$style.commentHeading"><h3><i class="ti ti-message-circle" aria-hidden="true"></i> {{ homeText.recentComments }}</h3><div :class="$style.commentActions"><button type="button" class="_button" :class="$style.refresh" :disabled="busy || refreshing" :aria-label="homeText.refreshComments" @click="refresh"><i class="ti ti-refresh" aria-hidden="true"></i></button><MkA :to="notePath" :class="$style.textLink">{{ homeText.allComments }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA></div></div>
			<div :aria-busy="refreshing" data-testid="home-work-comments">
				<p v-if="commentsFailed" :class="$style.feedback" role="alert">{{ homeText.commentsFailed }}</p>
				<ul v-else-if="comments.length" :class="$style.comments"><li v-for="reply in comments" :key="reply.id"><span :class="$style.avatar" aria-hidden="true">{{ (reply.user.name || reply.user.username).slice(0, 1) }}</span><div><strong>{{ reply.user.name || reply.user.username }}</strong><p>{{ reply.text }}</p></div></li></ul>
				<p v-else :class="$style.empty">{{ refreshing ? homeText.commentsLoading : homeText.noComments }}</p>
			</div>
			<form v-if="$i" :class="$style.form" @submit.prevent="sendComment">
				<textarea v-model="draft" :aria-label="homeText.writeComment" :placeholder="homeText.writeComment" rows="2" :disabled="commentState === 'sending'" data-testid="home-work-comment-input"></textarea>
				<div :class="$style.formActions"><span :class="{ [$style.overLimit]: draftLength > maxLength }">{{ draftLength }} / {{ maxLength }}</span><button type="submit" class="_button" :class="[$style.button, $style.send]" :disabled="!canComment" data-testid="home-work-comment-send">{{ commentState === 'sending' ? homeText.sendingComment : homeText.sendComment }} <i class="ti ti-arrow-up" aria-hidden="true"></i></button></div>
			</form>
			<button v-else type="button" class="_button" :class="$style.loginComment" :disabled="openingLogin" data-testid="home-work-comment-login" @click="requestLogin"><span>{{ homeText.commentLogin }}</span><i class="ti ti-arrow-right" aria-hidden="true"></i></button>
			<p v-if="commentState === 'sent'" :class="$style.feedback" role="status">{{ commentsFailed ? homeText.commentSentRefreshFailed : homeText.commentSent }}</p>
			<p v-if="commentState === 'rejected'" :class="$style.feedback" role="alert">{{ homeText.commentRejected }}</p>
			<div v-if="commentState === 'uncertain'" :class="$style.feedback" role="alert"><p>{{ homeText.commentUncertain }}</p><MkA :to="notePath" :class="$style.textLink">{{ homeText.allComments }}</MkA> <button type="button" class="_button" :class="$style.textLink" @click="acknowledgeRetry">{{ homeText.commentRetryConfirm }}</button></div>
		</section>
	</template>
</div>
</template>

<script lang="ts" setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { url as siteUrl } from '@@/js/config.js';
import { homeText } from './copy.js';
import { normalizeHomeImageUrl } from './image.js';
import { useWorkInteractions } from './use-work-interactions.js';
import type { CommunityWork } from '@/pages/community/types.js';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';
import { getStaticImageUrl } from '@/utility/media-proxy.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';

const props = defineProps<{ work: CommunityWork }>();
const router = useRouter();
const { state, note, comments, commentsFailed, refreshing, myReaction, liked, otherReaction, likes, reactionFailed, draft, draftLength, maxLength, commentState, busy, canComment, refresh, toggleLike, sendComment } = useWorkInteractions(() => props.work.approvedNoteId);
const categoryLabel = computed(() => props.work.category === 'video' ? homeText.popularVideo : props.work.category === 'image' ? homeText.popularImage : homeText.popularResource);
const categoryIcon = computed(() => props.work.category === 'video' ? 'ti ti-video' : props.work.category === 'image' ? 'ti ti-photo' : 'ti ti-file-text');
const notePath = computed(() => `/community/work/${props.work.id}`);
const creationPath = computed(() => `/create/${props.work.category === 'resource' ? 'text' : props.work.category}`);
const mediaFailed = ref(false);
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion = ref(motionPreference.matches);
const updateMotion = () => { reduceMotion.value = motionPreference.matches; };
motionPreference.addEventListener('change', updateMotion);
const safeFiles = computed(() => note.value?.files?.filter(file => !file.isSensitive) ?? []);
const videoUrl = computed(() => props.work.category === 'video' ? normalizeHomeImageUrl(safeFiles.value.find(file => file.type.startsWith('video/'))?.url, siteUrl) : null);
const coverUrl = computed(() => {
	const file = safeFiles.value.find(item => item.type.startsWith('image/')) ?? safeFiles.value.find(item => item.type.startsWith('video/') && item.thumbnailUrl);
	const source = file ? normalizeHomeImageUrl(file.type.startsWith('image/') ? file.url : file.thumbnailUrl, siteUrl) : null;
	return source && (reduceMotion.value || prefer.s.disableShowingAnimatedImages) ? getStaticImageUrl(source) : source;
});
const copying = ref(false);
const copyFailed = ref(false);
const openingLogin = ref(false);
let active = true;
let actionRequest = 0;
let loginRequest = 0;
let disposeLogin: (() => void) | undefined;

async function remix() {
	if (copying.value || state.value !== 'ready') return;
	const ticket = ++actionRequest;
	const path = creationPath.value;
	copying.value = true; copyFailed.value = false;
	try {
		if (props.work.text) await navigator.clipboard.writeText(props.work.text);
		if (!active || ticket !== actionRequest) return;
		if (props.work.text) os.toast(homeText.promptCopied);
		router.push(path);
	} catch { if (active && ticket === actionRequest) copyFailed.value = true; } finally {
		if (ticket === actionRequest) copying.value = false;
	}
}

async function requestLogin() {
	if ($i || openingLogin.value || !active) return;
	const request = ++loginRequest;
	openingLogin.value = true;
	try {
		const component = await import('@/components/MkSigninDialog.vue');
		if (!active || request !== loginRequest) return;
		const { dispose } = await os.popupAsyncWithDialog(Promise.resolve(component.default), { autoSet: true, message: homeText.interactionLogin }, { closed: () => { dispose(); if (request === loginRequest) { openingLogin.value = false; disposeLogin = undefined; } } });
		if (!active || request !== loginRequest) { dispose(); return; }
		disposeLogin = dispose;
	} catch {
		if (!active || request !== loginRequest) return;
		openingLogin.value = false;
		await os.alert({ type: 'error', text: homeText.loginError });
	}
}

async function acknowledgeRetry() {
	const ticket = actionRequest;
	const result = await os.confirm({ type: 'warning', text: homeText.commentRetryWarning });
	if (active && ticket === actionRequest && !result.canceled) commentState.value = 'idle';
}

function disposeActions() { active = false; actionRequest++; loginRequest++; disposeLogin?.(); disposeLogin = undefined; openingLogin.value = false; copying.value = false; }

watch(() => props.work.id, () => { mediaFailed.value = false; copyFailed.value = false; actionRequest++; });
onActivated(() => { active = true; });
onDeactivated(disposeActions);
onBeforeUnmount(() => { disposeActions(); motionPreference.removeEventListener('change', updateMotion); });
</script>

<style lang="scss" module>
.panel { --home-ink: var(--home-stage-fg); --home-muted: var(--home-stage-muted); --home-paper: var(--home-stage); --home-cream: var(--home-stage-panel); --home-lime: var(--home-stage-panel); --home-yellow: var(--home-stage-panel); --home-coral: var(--home-stage-panel); --home-accent: var(--home-stage-accent); color-scheme: dark; padding: clamp(16px, 3.4cqw, 28px); color: var(--home-ink); font-family: var(--home-font); }
.panel button, .panel a, .panel textarea, .prompt { &:focus-visible { outline: 3px solid var(--home-ink); outline-offset: 4px; } }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 22px; font-size: clamp(15px, 3cqw, 20px); font-weight: 750; }
.badge { background: var(--home-lime); border: 1px solid var(--home-stage-line); border-radius: 6px; padding: 5px 8px; font-size: 11px; white-space: nowrap; }
.top { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 16px; align-items: stretch; }
.card { min-width: 0; border-radius: 10px; }
.mediaCard { background: var(--home-yellow); display: flex; flex-direction: column; overflow: hidden; }
.cardHeading { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding-left: 14px; font-size: 12px; font-weight: 700; border-bottom: 1px solid var(--home-stage-line); }
.detailLink { width: 44px; height: 44px; display: grid; place-items: center; font-size: 21px; &:hover { background: var(--home-lime); } }
.media { position: relative; display: grid; flex: 1; min-height: 180px; height: clamp(180px, 36cqw, 310px); > img, > video { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; object-fit: contain; } }
.excerpt { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 16px; padding: 22px; text-align: center; overflow-wrap: anywhere; > i { font-size: 44px; } > span { font-size: 12px; } }
.promptCard { background: var(--home-coral); display: flex; flex-direction: column; padding: 16px; h2 { margin: 0 0 12px; font-size: 14px; line-height: 1.6; } }
.prompt { margin: 0 0 18px; max-height: 134px; min-height: 70px; flex: 1; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.8; scrollbar-width: thin; }
.button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; border: 1px solid transparent; border-radius: 8px; padding: 8px 12px; background: var(--home-ink); color: var(--home-paper); font-size: 13px; font-weight: 750; transition: transform .15s ease-out; &:hover:not(:disabled) { transform: translateY(-2px); } &:active:not(:disabled) { transform: translateY(1px); } &:disabled { opacity: .6; cursor: not-allowed; } }
.remix { width: 100%; }
.remixHint { margin-top: 9px; font-size: 11px; line-height: 1.6; }
.discussion { margin-top: 24px; padding: 0; background: var(--home-paper); }
.workInfo { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid color-mix(in srgb, var(--home-ink) 20%, transparent); }
.identity { min-width: 0; h2 { margin: 0; font-size: 17px; line-height: 1.55; overflow-wrap: anywhere; } p { margin: 5px 0 0; font-size: 11px; color: var(--home-muted); overflow-wrap: anywhere; } }
.like { flex-shrink: 0; display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; max-width: 45%; min-height: 44px; padding: 8px 12px; border: 1px solid var(--home-stage-line); border-radius: 8px; background: var(--home-paper); font-size: 12px; > i { font-size: 19px; } &:hover:not(:disabled), &.liked { background: var(--home-stage-panel); color: var(--home-stage-accent); } &:disabled { opacity: .65; cursor: not-allowed; } }
.commentHeading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 5px 0; h3 { font-size: 12px; margin: 0; } }
.commentActions { display: flex; align-items: center; gap: 8px; }
.refresh { display: grid; place-items: center; width: 36px; height: 44px; font-size: 16px; &:hover { color: var(--home-accent); } }
.textLink { display: inline-flex; align-items: center; gap: 3px; min-height: 30px; font-size: 11px; text-decoration: underline !important; text-underline-offset: 3px; }
.comments { display: grid; gap: 12px; list-style: none; margin: 0 0 14px; padding: 0; li { display: flex; gap: 9px; min-width: 0; > div { min-width: 0; flex: 1; } strong { display: block; font-size: 11px; color: var(--home-muted); font-weight: 500; overflow-wrap: anywhere; } p { margin: 3px 0 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; white-space: pre-wrap; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; } } }
.avatar { flex-shrink: 0; display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--home-stage-line); border-radius: 50%; background: var(--home-yellow); font-size: 13px; }
.comments li:nth-child(even) .avatar { background: var(--home-lime); }
.empty { color: var(--home-muted); font-size: 12px; margin: 4px 0 16px; line-height: 1.7; }
.loginComment { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 44px; padding: 11px 13px; border: 1px solid var(--home-stage-line); border-radius: 8px; background: var(--home-cream); font-size: 12px; text-align: left; &:hover { background: var(--home-yellow); } }
.form { textarea { display: block; box-sizing: border-box; width: 100%; min-height: 64px; resize: vertical; max-height: 180px; border: 1px solid var(--home-stage-line); border-radius: 8px; padding: 10px 12px; font: inherit; font-size: 13px; color: var(--home-ink); background: var(--home-cream); } }
.formActions { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 8px; font-size: 11px; color: var(--home-muted); }
.send { min-height: 40px; background: var(--home-stage-accent); color: var(--home-stage); }
.overLimit { font-weight: 750; color: var(--home-ink); }
.feedback { font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; margin: 10px 0 0; > p { margin: 0; } }
.loading { padding: 80px 12px; text-align: center; line-height: 1.8; font-size: 14px; }
@container (max-width: 500px) { .top { grid-template-columns: minmax(0, 1fr); gap: 18px; } .mediaCard, .promptCard { transform: none; } .media { height: 230px; } .prompt { min-height: 0; max-height: 145px; } .discussion { padding: 14px; } .identity h2 { font-size: 15px; } .workInfo { gap: 10px; } }
@container (max-width: 340px) { .panel { padding: 13px; } .heading { font-size: 14px; gap: 6px; } .badge { font-size: 10px; padding: 4px 7px; } .workInfo { flex-wrap: wrap; } .like { max-width: 100%; } .commentActions { gap: 2px; } }
@media (prefers-reduced-motion: reduce) { .button { transition: none; &:hover:not(:disabled), &:active:not(:disabled) { transform: none; } } }
</style>
