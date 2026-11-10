<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<div :class="$style.root">
	<p :class="$style.hint">{{ room ? t.privateOnly : t.rules }}</p>
	<template v-if="user">
		<p v-if="!canWrite" :class="$style.hint" role="status">{{ $i.policies.chatAvailability !== 'available' ? t.unavailable : t.mutualRequired }}</p>
		<button v-if="!canWrite" type="button" class="_textButton" :class="$style.refresh" :disabled="refreshing || sending" @click="refreshRelation">{{ refreshing ? t.refreshingRelation : t.refreshRelation }}</button>
		<div :class="$style.actions">
			<button type="button" class="_button" :class="$style.action" :disabled="!canWrite || sending" :aria-expanded="showWorks" @click="toggleWorks"><i class="ti ti-photo" aria-hidden="true"></i>{{ t.shareWork }}</button>
			<button type="button" class="_button" :class="$style.action" :disabled="!canWrite || sending" @click="chooseEmoji"><i class="ti ti-mood-happy" aria-hidden="true"></i>{{ t.sendEmoji }}</button>
		</div>
		<section v-if="showWorks" :class="$style.picker" :aria-label="t.chooseWork" :aria-busy="loadingWorks">
			<form :class="$style.search" @submit.prevent="loadWorks(false)">
				<input v-model="query" type="search" :placeholder="t.searchWorks" :aria-label="t.searchWorks" :disabled="sending"/>
				<button type="submit" class="_button" :disabled="loadingWorks || sending">{{ t.findWork }}</button>
			</form>
			<p v-if="worksError" role="alert">{{ t.worksFailed }} <button type="button" class="_textButton" :disabled="loadingWorks" @click="loadWorks(!!cursor && works.length > 0)">{{ t.retry }}</button></p>
			<p v-if="loadingWorks" role="status">{{ t.loadingWorks }}</p>
			<p v-else-if="!works.length && !worksError" role="status">{{ t.noWorks }}</p>
			<div :class="$style.works">
				<button v-for="work in works" :key="work.id" type="button" class="_button" :class="$style.work" :disabled="!canWrite || sending" @click="selectWork(work)">
					<img v-if="thumbnail(work)" :src="thumbnail(work)!" alt="" loading="lazy"/>
					<i v-else class="ti ti-photo" aria-hidden="true"></i>
					<span><strong>{{ work.title }}</strong><small>{{ work.author.name || work.author.username }}</small></span>
				</button>
				<button v-if="cursor" type="button" class="_textButton" :class="$style.more" :disabled="loadingWorks || sending" @click="loadWorks(true)">{{ t.moreWorks }}</button>
			</div>
		</section>
		<div v-if="selection" :class="$style.selection" role="status">
			<span v-if="selection.work"><i class="ti ti-photo" aria-hidden="true"></i> {{ selection.work.title }}</span>
			<Mfm v-else :text="selection.text" :plain="true"/>
			<button type="button" class="_button" :disabled="sending" :aria-label="t.removeSelection" @click="selection = null"><i class="ti ti-x" aria-hidden="true"></i></button>
		</div>
		<p v-else :class="$style.hint">{{ t.selectHint }}</p>
		<p v-if="error" :class="$style.error" role="alert">{{ error }}</p>
		<div :class="$style.footer"><button type="button" class="_button" :class="$style.send" :disabled="!canWrite || !selection || sending" @click="send"><i class="ti ti-send" aria-hidden="true"></i>{{ sending ? t.sending : t.send }}</button></div>
	</template>
</div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { entities } from 'misskey-js';
import { emojiRegex } from '@misskey-dev/emoji-data/regex';
import type { CommunityWork } from '../community/types.js';
import { chatText as t } from './copy.js';
import { canPrivateMessage, communityWorkMessage, privateMessageError } from './private-message.js';
import { ensureSignin } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { customEmojisMap } from '@/custom-emojis.js';
import MkEmojiPickerDialog from '@/components/MkEmojiPickerDialog.vue';
import * as os from '@/os.js';

const props = defineProps<{ user?: entities.UserDetailed | null; room?: entities.ChatRoom | null }>();
const emit = defineEmits<{ (event: 'sent', message: entities.ChatMessageLite): void }>();
const $i = ensureSignin();
const peer = ref(props.user);
const canWrite = computed(() => $i.policies.chatAvailability === 'available' && !!peer.value && canPrivateMessage(peer.value, $i.id));
const sending = ref(false);
const refreshing = ref(false);
const error = ref('');
const selection = ref<{ text: string; work?: CommunityWork } | null>(null);
const showWorks = ref(false);
const query = ref('');
const works = ref<CommunityWork[]>([]);
const cursor = ref<string | null>(null);
const loadingWorks = ref(false);
const worksError = ref(false);
let version = 0;
let loadedQuery = '';
let disposed = false;
let closePicker: (() => void) | undefined;

watch(() => props.user, (user, previous) => {
	peer.value = user;
	if (user?.id !== previous?.id) {
		selection.value = null;
		error.value = '';
	}
});

async function refreshRelation() {
	const userId = props.user?.id;
	if (!userId || refreshing.value || sending.value || disposed) return;
	refreshing.value = true;
	try {
		const current = await misskeyApi('users/show', { userId });
		if (!disposed && props.user?.id === userId) { peer.value = current; error.value = ''; }
	} catch {
		if (!disposed && props.user?.id === userId) error.value = t.relationFailed;
	} finally {
		if (!disposed) refreshing.value = false;
	}
}

function onVisible() {
	if (!window.document.hidden) void refreshRelation();
}

onMounted(() => window.document.addEventListener('visibilitychange', onVisible));
onActivated(() => { void refreshRelation(); });

function thumbnail(work: CommunityWork) {
	const file = work.files[0];
	return file && !file.isSensitive ? file.thumbnailUrl || (file.type.startsWith('image/') ? file.url : null) : null;
}

async function toggleWorks() {
	if (!canWrite.value || sending.value) return;
	showWorks.value = !showWorks.value;
	if (showWorks.value && !works.value.length) await loadWorks(false);
}

async function loadWorks(append: boolean) {
	const request = ++version;
	const requestedQuery = query.value.trim();
	append = append && requestedQuery === loadedQuery;
	loadedQuery = requestedQuery;
	loadingWorks.value = true;
	worksError.value = false;
	if (!append) { works.value = []; cursor.value = null; }
	try {
		const result = await misskeyApi('community/works', { limit: 12, query: requestedQuery, untilId: append ? cursor.value ?? undefined : undefined });
		if (disposed || request !== version) return;
		works.value = append ? [...works.value, ...result.items.filter(work => !works.value.some(existing => existing.id === work.id))] : result.items;
		cursor.value = result.nextCursor;
	} catch {
		if (!disposed && request === version) worksError.value = true;
	} finally {
		if (!disposed && request === version) loadingWorks.value = false;
	}
}

function selectWork(work: CommunityWork) {
	if (!canWrite.value || sending.value) return;
	selection.value = { text: communityWorkMessage(work.id), work };
	showWorks.value = false;
	error.value = '';
}

function chooseEmoji(event: MouseEvent) {
	if (!canWrite.value || sending.value) return;
	closePicker?.();
	const { dispose } = os.popup(MkEmojiPickerDialog, { anchorElement: event.currentTarget as HTMLElement, showPinned: false, choseAndClose: true }, {
		done: (emoji: string) => {
			if (disposed || !canWrite.value || sending.value) return;
			const name = /^:([\w+-]+):$/.exec(emoji)?.[1];
			if (!(name ? customEmojisMap.has(name) : new RegExp(emojiRegex.source).exec(emoji)?.[0] === emoji)) {
				error.value = t.chooseEmojiHint;
				return;
			}
			selection.value = { text: emoji };
			showWorks.value = false;
			error.value = '';
		},
		closed: () => { dispose(); closePicker = undefined; },
	});
	closePicker = dispose;
}

async function send() {
	if (!canWrite.value || !selection.value || sending.value || !peer.value) return;
	sending.value = true;
	error.value = '';
	const userId = peer.value.id;
	const content = selection.value.text;
	try {
		const current = await misskeyApi('users/show', { userId });
		if (disposed || props.user?.id !== userId) return;
		peer.value = current;
		if (!canPrivateMessage(current, $i.id)) { error.value = t.mutualRequired; return; }
		const message = await misskeyApi('chat/messages/create-to-user', { toUserId: userId, text: content });
		if (disposed || props.user?.id !== userId) return;
		emit('sent', message);
		selection.value = null;
	} catch (failure) {
		if (!disposed) error.value = privateMessageError(failure);
	} finally {
		if (!disposed) sending.value = false;
	}
}

onBeforeUnmount(() => { disposed = true; version++; closePicker?.(); window.document.removeEventListener('visibilitychange', onVisible); });
</script>

<style module lang="scss">
.root { padding: 14px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-panel); min-width: 0; }
.hint { margin: 0 0 12px; font-size: 13px; line-height: 1.6; }
.refresh { min-height: 44px; margin-bottom: 12px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.action, .send { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 14px; border-radius: var(--MI-radius); }
.action { background: var(--MI_THEME-buttonBg); }
.action:hover:not(:disabled) { background: var(--MI_THEME-buttonHoverBg); }
.root button:disabled { opacity: .5; cursor: not-allowed; }
.root :is(button, input):focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; }
.picker { padding-block: 8px; }
.search { display: flex; gap: 8px; margin-bottom: 10px; }
.search input { min-width: 0; flex: 1; min-height: 44px; padding: 8px 10px; box-sizing: border-box; font: inherit; font-size: 16px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-bg); color: var(--MI_THEME-fg); }
.search > button { padding: 0 12px; min-height: 44px; }
.works { max-height: min(260px, 35dvh); overflow-y: auto; overscroll-behavior: contain; }
.work { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px; border-radius: var(--MI-radius); text-align: start; }
.work:hover:not(:disabled) { background: var(--MI_THEME-buttonHoverBg); }
.work img { width: 48px; height: 48px; flex-shrink: 0; object-fit: cover; border-radius: var(--MI-radius); }
.work > span { min-width: 0; display: grid; gap: 4px; }
.work strong { font-size: 14px; overflow-wrap: anywhere; }
.work small { font-size: 12px; }
.more { min-height: 44px; width: 100%; }
.selection { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 6px 12px; margin-bottom: 12px; background: var(--MI_THEME-buttonBg); border-radius: var(--MI-radius); }
.selection > :first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.selection > button { flex-shrink: 0; width: 44px; height: 44px; }
.footer { display: flex; justify-content: flex-end; }
.send { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.error { font-size: 14px; color: var(--MI_THEME-error); overflow-wrap: anywhere; }
</style>
