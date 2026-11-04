/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import type { entities } from 'misskey-js';
import { $i } from '@/i.js';
import { instance } from '@/instance.js';
import { misskeyApi } from '@/utility/misskey-api.js';

// Keep drafts and uncertain delivery across route changes, isolated by account and note.
const savedDrafts = new Map<string, { text: string; uncertain: boolean }>();

function isPublic(note: entities.Note) {
	return !note.isHidden && !note.deletedAt && note.visibility === 'public' && note.cw == null;
}

function isHeart(reaction: string | null | undefined) { return reaction?.replaceAll('\uFE0F', '') === '❤'; }

function errorCode(error: unknown): string | undefined {
	return error != null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

export function useWorkInteractions(getNoteId: () => string | null) {
	const active = ref(true);
	const state = ref<'loading' | 'ready' | 'error' | 'unavailable'>('loading');
	const note = ref<entities.Note | null>(null);
	const comments = ref<entities.Note[]>([]);
	const commentsFailed = ref(false);
	const refreshing = ref(false);
	const myReaction = ref<string | null | undefined>(undefined);
	const reactionBusy = ref(false);
	const reactionFailed = ref(false);
	const draft = ref('');
	const commentState = ref<'idle' | 'sending' | 'sent' | 'rejected' | 'uncertain'>('idle');
	const controllers = new Set<AbortController>();
	let readController: AbortController | undefined;
	let generation = 0;
	let readGeneration = 0;
	let draftKey = '';
	let restoringDraft = false;
	const liked = computed(() => isHeart(myReaction.value));
	const otherReaction = computed(() => !!myReaction.value && !liked.value);
	const likes = computed(() => Object.entries(note.value?.reactions ?? {}).reduce((sum, [key, value]) => sum + (isHeart(key) ? value : 0), 0));
	const maxLength = computed(() => instance.maxNoteTextLength || 1000);
	const draftLength = computed(() => Array.from(draft.value).length);
	const busy = computed(() => reactionBusy.value || commentState.value === 'sending');
	const canComment = computed(() => !!$i && state.value === 'ready' && !!draft.value.trim() && draftLength.value <= maxLength.value && !busy.value && commentState.value !== 'uncertain');

	function context() {
		const id = getNoteId();
		const userId = $i?.id;
		const version = generation;
		return { id, valid: () => active.value && version === generation && id === getNoteId() && userId === $i?.id };
	}

	async function write<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const controller = new AbortController();
		controllers.add(controller);
		const timer = window.setTimeout(() => controller.abort(), 15000);
		try { return await request(controller.signal); } finally { window.clearTimeout(timer); controllers.delete(controller); }
	}

	async function refresh() {
		const current = context();
		if (!current.id || !active.value) return;
		const ticket = ++readGeneration;
		readController?.abort();
		const controller = new AbortController();
		readController = controller;
		const timer = window.setTimeout(() => controller.abort(), 12000);
		const valid = () => current.valid() && ticket === readGeneration;
		refreshing.value = true;
		try {
			// Validate eligibility as a guest, even when the viewer is an administrator.
			const publicNote = await misskeyApi('notes/show', { noteId: current.id }, null, controller.signal);
			if (!valid()) return;
			if (publicNote.id !== current.id || !isPublic(publicNote)) {
				note.value = null; comments.value = []; state.value = 'unavailable'; return;
			}
			note.value = publicNote;
			state.value = 'ready';
			const [replies, personal] = await Promise.allSettled([
				misskeyApi('notes/replies', { noteId: current.id, limit: 12 }, null, controller.signal),
				$i ? misskeyApi('notes/show', { noteId: current.id }, undefined, controller.signal) : Promise.resolve(null),
			]);
			if (!valid()) return;
			commentsFailed.value = replies.status === 'rejected';
			comments.value = replies.status === 'fulfilled' ? replies.value.filter(reply => reply.replyId === current.id && isPublic(reply) && !!reply.text?.trim()).slice(0, 2) : [];
			myReaction.value = personal.status === 'fulfilled' ? personal.value?.myReaction ?? null : undefined;
		} catch (error) {
			if (!valid()) return;
			note.value = null; comments.value = []; myReaction.value = undefined;
			state.value = errorCode(error) === 'NO_SUCH_NOTE' ? 'unavailable' : 'error';
		} finally {
			window.clearTimeout(timer);
			if (valid()) refreshing.value = false;
		}
	}

	async function toggleLike() {
		const current = context();
		if (!$i || !current.id || state.value !== 'ready' || busy.value || refreshing.value || myReaction.value === undefined) return;
		reactionBusy.value = true;
		reactionFailed.value = false;
		try {
			if (liked.value) await write(signal => misskeyApi('notes/reactions/delete', { noteId: current.id! }, undefined, signal));
			else await write(signal => misskeyApi('notes/reactions/create', { noteId: current.id!, reaction: '❤️' }, undefined, signal));
		} catch { if (current.valid()) reactionFailed.value = true; } finally {
			// Never invent a successful count, including duplicate / stale reaction errors.
			if (current.valid()) { await refresh(); if (current.valid()) reactionBusy.value = false; }
		}
	}

	async function sendComment() {
		const current = context();
		if (!current.id || !canComment.value) return;
		const submittedDraft = draft.value;
		commentState.value = 'sending';
		try {
			const result = await write(signal => misskeyApi('notes/create', { replyId: current.id!, text: submittedDraft.trim(), visibility: 'public' }, undefined, signal));
			if (!current.valid()) return;
			if (!result.createdNote?.id) throw new Error('Unconfirmed reply');
			if (draft.value === submittedDraft) draft.value = '';
			commentState.value = 'sent';
			// A reply can be visibility-restricted by server policy; only guest-visible replies enter this list.
			await refresh();
		} catch (error) {
			if (!current.valid()) return;
			// A transport failure does not prove that notes/create failed to persist a reply.
			const rejected = error != null && typeof error === 'object' && 'kind' in error && error.kind === 'client';
			commentState.value = rejected ? 'rejected' : 'uncertain';
			await refresh();
		}
	}

	function reset() {
		generation++; readGeneration++; readController?.abort();
		for (const controller of controllers) controller.abort();
		controllers.clear();
		note.value = null; comments.value = []; myReaction.value = undefined;
		state.value = 'loading'; refreshing.value = false; commentsFailed.value = false;
		reactionBusy.value = false; reactionFailed.value = false;
		draft.value = ''; commentState.value = 'idle';
	}

	function saveDraft() {
		if (!draftKey || restoringDraft) return;
		const uncertain = commentState.value === 'sending' || commentState.value === 'uncertain';
		if (draft.value || uncertain) savedDrafts.set(draftKey, { text: draft.value, uncertain });
		else savedDrafts.delete(draftKey);
	}

	watch([getNoteId, () => $i?.id], ([noteId, userId]) => {
		saveDraft(); restoringDraft = true; reset();
		draftKey = noteId && userId ? `${userId}:${noteId}` : '';
		const saved = savedDrafts.get(draftKey);
		draft.value = saved?.text ?? '';
		commentState.value = saved?.uncertain ? 'uncertain' : 'idle';
		restoringDraft = false;
		void refresh();
	}, { immediate: true });
	watch([draft, commentState], saveDraft, { flush: 'sync' });
	onActivated(() => { if (!active.value) { active.value = true; void refresh(); } });
	onDeactivated(() => {
		saveDraft(); active.value = false; generation++; readGeneration++; readController?.abort();
		for (const controller of controllers) controller.abort();
		if (commentState.value === 'sending') commentState.value = 'uncertain';
		reactionBusy.value = false; refreshing.value = false;
	});
	onBeforeUnmount(() => { saveDraft(); active.value = false; restoringDraft = true; reset(); });
	watch(draft, () => { if (commentState.value === 'sent' || commentState.value === 'rejected') commentState.value = 'idle'; }, { flush: 'sync' });

	return { state, note, comments, commentsFailed, refreshing, myReaction, liked, otherReaction, likes, reactionBusy, reactionFailed, draft, draftLength, maxLength, commentState, busy, canComment, refresh, toggleLike, sendComment };
}
